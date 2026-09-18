//============================================================================================================================================
// 📦 Engine/Shaders/BlasBuild.slang — D9: a full wide build into the packed CWBVH layout, for topology changes
//============================================================================================================================================
// 🧩 A refit cannot cover a topology change (LOD swap, destruction, a mesh authored on the fly): the node count itself
//    moves, so the blob has to be built rather than updated. This kernel builds the SAME layout the refit writes and the
//    traversal reads — a second traversal path is the cost the plan named, and this avoids it.
//
// The build, stage by stage, all in this one entry point (the host loops the stages; `Stage` picks one):
//    Stage 0 — PREPASS     one thread per triangle: exact bounds, centroid, 30-bit Morton code (10 bits per axis,
//                          normalised against the object AABB the host passes in the push block), written as
//                          uvec2(key, primitive) into the sorted array in soup order. The root's range, [0, N), and the
//                          root's level, 0.
//    Stage 1 — PARTITION   one workgroup per node of the level. This is what replaces the sort: at level d every node's
//                          range is stably counting-sorted by the octant its keys name at depth d (`key >> (27 − 3d)`),
//                          so after d levels the array IS Morton-ordered inside every node — no radix passes, no
//                          prefix-sum over keys, one dispatch per level. Stability is not decoration: a different order
//                          inside an octant changes which triangles end up sharing a leaf, i.e. the blob's bytes, so the
//                          tile loop computes each element's rank within its octant explicitly instead of using atomics.
//                          Also records each slot's range and whether the slot is a leaf (1–3 triangles), an interior
//                          child, or empty, and the node's total leaf triangles (the format's cap is 24 per node).
//    Stage 2 — SCAN        one workgroup, exclusive prefix sum of the level's interior-child counts: every node's
//                          childBase, and the next level's base/count. Children are numbered in ASCENDING SLOT ORDER
//                          (the rank contract the traversal's imask pop depends on), which is why this is a scan over
//                          the level in node order rather than an atomic ticket per node.
//    Stage 3 — EMIT        one workgroup per node (thread 0 emits): compute each child's exact bounds from the geometry
//                          (a leaf child from its ≤ 3 triangles, an interior child from its whole range), assign the
//                          eight slots (octant preference, free-slot pool — BlasBuildMirror's TakeSlot), write the
//                          node's p/exponents/qlo/qhi, its meta bytes, its imask and childBase, hand each child its
//                          range, and set the child's level in the level table.
//    Stage 4 — RUNS        assign every node's triangleBase in node order (the leaf runs are concatenated in BFS node
//                          order, which is what makes a node's `firstTri` a bit position inside its own run) and write
//                          the leaf records from the soup.
//
// ⚠️ NOT RUN ON A GPU. No Vulkan device in the development sandbox: this file is compile-gated by
//    Tools/Build/CheckShaders.sh and text-pinned by §⑩ of Exhibits/Workbench/Traversal/TwoLevelBvhProof.cpp against the
//    CPU mirror (`BlasBuildMirror::BuildHPloc`), which §⑨a/⑨b/⑨c then walk and measure. Two parts below are
//    deliberately the simple ones and say so where they are: the scan and the run assignment are one-workgroup steps
//    (they are O(level nodes) and O(all nodes)), and the emit is single-threaded per node. Those are the first things
//    to replace with a device prefix sum once this has been run once.
//
// NOTE: GLSL source lowered by glslc -fshader-stage=compute.
#version 460
#extension GL_GOOGLE_include_directive : require

layout(local_size_x = 128, local_size_y = 1, local_size_z = 1) in;

#include "BlasLayout.slang"

layout(std430, binding = 0) buffer BlasNodeExtent   { vec4 BlasNodes[]; };    // D9: the node arena being built
layout(std430, binding = 1) buffer BlasLeafExtent   { vec4 BlasLeaves[]; };   // D9: the leaf arena being built
layout(std430, binding = 2) readonly buffer BlasSoupExtent { vec4 BlasSoup[]; };// D9: object-space soup, 3 × vec4 per triangle
layout(std430, binding = 3) buffer BlasSortedExtent    { uvec2 BlasSortedA[]; };   // ping (each level writes the other)
layout(std430, binding = 4) buffer BlasSortedAltExtent { uvec2 BlasSortedB[]; };   // pong
layout(std430, binding = 5) buffer BlasScratchExtent { uint BlasScratch[]; }; // per-node slot ranges + childBase + a header
layout(std430, binding = 6) buffer BlasLevelExtent   { uint BlasLevels[]; };  // written here, read by the refit kernel

// Scratch layout: [0] = the level's base node slot, [1] = the level's node count, [2] = the level index,
//    [3] = reserved. From byte 32 on, 24 uints per node slot:
//      +0..15  the eight slot ranges (lo, hi)
//      +16     the node's total leaf triangles
//      +17     the node's own range lo
//      +18     the node's own range hi
//      +19     childBase (stage 2 writes it, stage 3 reads it)
//      +20     the occupied-slot mask
const uint kBlasScratchHeader = 8u;
const uint kBlasScratchStride = 24u;

// 64 B. The object AABB comes from the host: it has one already (InstanceAcceleration::QueryBlasObjectAabb), and a
//    device-side reduction over the soup would be a second implementation of the same normalisation.
layout(push_constant) uniform BlasBuildConstants
{
    uint Stage;         // [-]   0 prepass · 1 partition · 2 scan · 3 emit · 4 runs
    uint Level;         // [lvl] the level being partitioned / emitted
    uint TriangleCount; // [cnt] triangles in the soup and in the leaf arena
    uint NodeCount;     // [cnt] node slots the arena may use (a cap, not a reservation)
    vec4 ObjectMin;     // [m]   object AABB minimum
    vec4 ObjectExtent;  // [m]   object AABB extent (a zero axis pins every key's bits on that axis to 0)
};

uint BlasNodeSlotAt(uint Slot) { return kBlasScratchHeader + kBlasScratchStride * Slot; }

// Stage 1's workgroup state. GLSL only allows `shared` at file scope, and one workgroup is one node, so a single set of
//    octant counters serves every node the level dispatches.
shared uint Cursor[8];     // where the next element of each octant goes (the scatter offsets)
shared uint Start[8];      // where that octant's run began — the slot ranges stage 3/4 read back
shared uint Octants[128];  // this tile's octant per lane (a stable rank needs the tile's own order, not atomics)
shared uint TileCount[8];

// A 10-bit fixed-point axis value, clamped: the code's precision is the tree's precision, and a centroid exactly on the
//    far face must not overflow into the next octant.
uint BlasAxisBits(float Value, float Min, float Extent)
{
    if (!(Extent > 0.0f)) return 0u;
    float F = clamp((Value - Min) / Extent, 0.0f, 1.0f);
    return uint(F * 1023.0f + 0.5f);
}

// Spread 10 bits of one axis into the even 3-bit groups of a 30-bit code (x in bit 0, y in bit 1, z in bit 2).
uint BlasSpread(uint Value)
{
    uint Result = 0u;
    for (uint Bit = 0u; Bit < 10u; ++Bit) Result |= ((Value >> Bit) & 1u) << (Bit * 3u);
    return Result;
}

void main()
{
    const uint Thread = gl_GlobalInvocationID.x;

    // ─── stage 0: keys, and the root ─────────────────────────────────────────────────────────────────────────────────
    if (Stage == 0u)
    {
        if (Thread < TriangleCount)
        {
            const vec4 V0 = BlasSoup[3u * Thread + 0u];
            const vec4 V1 = BlasSoup[3u * Thread + 1u];
            const vec4 V2 = BlasSoup[3u * Thread + 2u];
            const vec3 Centre = (V0.xyz + V1.xyz + V2.xyz) / 3.0f;
            const uint Qx = BlasAxisBits(Centre.x, ObjectMin.x, ObjectExtent.x);
            const uint Qy = BlasAxisBits(Centre.y, ObjectMin.y, ObjectExtent.y);
            const uint Qz = BlasAxisBits(Centre.z, ObjectMin.z, ObjectExtent.z);
            const uint Key = (BlasSpread(Qx) << 2u) | (BlasSpread(Qy) << 1u) | BlasSpread(Qz);
            BlasSortedA[Thread] = uvec2(Key, Thread);
        }
        if (Thread == 0u)
        {
            BlasScratch[0] = 0u;                   // the root is node slot 0
            BlasScratch[1] = TriangleCount > 0u ? 1u : 0u;
            BlasScratch[2] = 0u;
            const uint Root = BlasNodeSlotAt(0u);
            BlasScratch[Root + 17u] = 0u;
            BlasScratch[Root + 18u] = TriangleCount;
            BlasScratch[Root + 19u] = 1u;          // a single node: childBase is where the children will start
            BlasLevels[0] = 0u;
        }
        return;
    }

    // ─── stage 1: the level's partition — this is the sort, one level at a time ──────────────────────────────────────
    if (Stage == 1u)
    {
        const uint NodeBase = BlasScratch[0];
        const uint Nodes = BlasScratch[1];
        const uint Slot = NodeBase + gl_WorkGroupID.x;
        if (gl_WorkGroupID.x >= Nodes) return;
        const uint At = BlasNodeSlotAt(Slot);
        const uint Lo = BlasScratch[At + 17u];
        const uint Hi = BlasScratch[At + 18u];
        const uint Lane = gl_LocalInvocationID.x;
        const uint Lanes = gl_WorkGroupSize.x;

        if (Lane == 0u)
        {
            for (uint S = 0u; S < 8u; ++S) { Cursor[S] = Lo; Start[S] = Lo; TileCount[S] = 0u; }
        }
        memoryBarrierShared();
        barrier();

        // The source is the array the previous level scattered into; the destination is the other one. Ping-pong keeps
        //    every node's writes disjoint, so no atomics and no ordering between nodes are needed.
        const bool UseA = (Level & 1u) == 0u;
        for (uint Tile = Lo; Tile < Hi; Tile += Lanes)
        {
            const uint Index = Tile + Lane;
            uint Key = 0u;
            uint Octant = 0u;
            if (Index < Hi)
            {
                Key = UseA ? BlasSortedA[Index].x : BlasSortedB[Index].x;
                Octant = BlasOctantAt(Key, Level);
            }
            Octants[Lane] = Octant;
            memoryBarrierShared();
            barrier();
            if (Index < Hi) atomicAdd(TileCount[Octant], 1u);
            memoryBarrierShared();
            barrier();
            if (Index < Hi)
            {
                // Stable rank inside the tile: count the same-octant lanes before this one. O(Lanes) per element, and
                //    the reason this loop does not use a global atomic ticket: the order must not depend on scheduling.
                uint Rank = 0u;
                for (uint Other = 0u; Other < Lane; ++Other) if (Octants[Other] == Octant) ++Rank;
                const uint Destination = Cursor[Octant] + Rank;
                if (UseA) BlasSortedB[Destination] = uvec2(Key, BlasSortedA[Index].y);
                else      BlasSortedA[Destination] = uvec2(Key, BlasSortedB[Index].y);
            }
            memoryBarrierShared();
            barrier();
            if (Lane == 0u) for (uint S = 0u; S < 8u; ++S) { Cursor[S] += TileCount[S]; TileCount[S] = 0u; }
            memoryBarrierShared();
            barrier();
        }

        if (Lane == 0u)
        {
            uint Mask = 0u, LeafTriangles = 0u, Interior = 0u;
            for (uint S = 0u; S < 8u; ++S)
            {
                const uint RunLo = Start[S];
                const uint RunHi = Cursor[S];
                BlasScratch[At + 2u * S + 0u] = RunLo;
                BlasScratch[At + 2u * S + 1u] = RunHi;
                const uint Count = RunHi - RunLo;
                if (Count > 0u) Mask |= 1u << S;
                if (Count > 0u && Count <= kBlasTriPerLeaf) LeafTriangles += Count;
                if (Count > kBlasTriPerLeaf) ++Interior;
            }
            BlasScratch[At + 16u] = LeafTriangles;
            BlasScratch[At + 19u] = 0u;   // childBase is stage 2's to fill
            BlasScratch[At + 20u] = Mask;
        }
        return;
    }

    // ─── stage 2: childBase, in ascending slot order ─────────────────────────────────────────────────────────────────
    // ⚠️ One workgroup, and the sum is a serial loop. It is O(level nodes); a device prefix sum replaces it without
    //    changing a byte, and the mirror's numbers (17 835 nodes for 63 854 triangles, max level 10) say it is not the
    //    expensive part of a build.
    if (Stage == 2u)
    {
        if (gl_LocalInvocationID.x != 0u || gl_WorkGroupID.x != 0u) return;
        const uint NodeBase = BlasScratch[0];
        const uint Nodes = BlasScratch[1];
        // The level's slots are dense ([NodeBase, NodeBase + Nodes)), so the children of the whole level tile the arena
        //    from NodeBase + Nodes on — and each parent's childBase is its slice of that tile, in node order, which is
        //    what puts every interior child at a HIGHER slot than its parent (§⑨c measures that invariant).
        uint Next = NodeBase + Nodes;
        for (uint I = 0u; I < Nodes; ++I)
        {
            const uint At = BlasNodeSlotAt(NodeBase + I);
            uint Interior = 0u;
            for (uint S = 0u; S < 8u; ++S)
            {
                const uint Count = BlasScratch[At + 2u * S + 1u] - BlasScratch[At + 2u * S + 0u];
                if (Count > kBlasTriPerLeaf) ++Interior;
            }
            BlasScratch[At + 19u] = Next;
            Next += Interior;
        }
        BlasScratch[0] = NodeBase + Nodes;   // the next level's base
        BlasScratch[1] = Next - (NodeBase + Nodes);
        return;
    }

    // ─── stage 3: emit the level's nodes ─────────────────────────────────────────────────────────────────────────────
    // ⚠️ Thread 0 of each workgroup emits its node: the child-bound scans below are O(child range), so this is the part
    //    a real build would parallelise across the workgroup's lanes. Kept serial here because it is the part that must
    //    match BlasBuildMirror's bytes exactly, and a serial transcription is the one that can be pinned line by line.
    if (Stage == 3u)
    {
        const uint NodeBase = BlasScratch[0];
        const uint Nodes = BlasScratch[1];
        const uint Slot = NodeBase + gl_WorkGroupID.x;
        if (gl_LocalInvocationID.x != 0u || gl_WorkGroupID.x >= Nodes) return;
        // The level being emitted is the PREVIOUS one: the partition above already moved its children into place.
        const uint EmitLevel = Level;
        const uint At = BlasNodeSlotAt(Slot);
        const bool ScatteredIsA = ((EmitLevel + 1u) & 1u) == 0u;   // the array this level's partition scattered into

        // Each child's exact bounds, from the geometry the child's range names.
        vec3 SlotMin[8];
        vec3 SlotMax[8];
        uint Occupied = BlasScratch[At + 20u];
        for (uint S = 0u; S < 8u; ++S)
        {
            SlotMin[S] = vec3( 1.0e30f);
            SlotMax[S] = vec3(-1.0e30f);
            if ((Occupied & (1u << S)) == 0u) continue;
            const uint RunLo = BlasScratch[At + 2u * S + 0u];
            const uint RunHi = BlasScratch[At + 2u * S + 1u];
            for (uint I = RunLo; I < RunHi; ++I)
            {
                const uint Primitive = ScatteredIsA ? BlasSortedA[I].y : BlasSortedB[I].y;
                const vec4 V0 = BlasSoup[3u * Primitive + 0u];
                const vec4 V1 = BlasSoup[3u * Primitive + 1u];
                const vec4 V2 = BlasSoup[3u * Primitive + 2u];
                SlotMin[S] = min(SlotMin[S], min(V0.xyz, min(V1.xyz, V2.xyz)));
                SlotMax[S] = max(SlotMax[S], max(V0.xyz, max(V1.xyz, V2.xyz)));
            }
        }

        // Slot assignment: the octant is a PREFERENCE, the free-slot pool is what keeps the children consecutive and
        //    collision-free (BlasBuildMirror::BuildHploc — a slot decides a box lane and a meta byte, while the
        //    traversal's child index comes from the imask and the stored slot).
        uint Staged[8];
        uint StagedCount = 0u;
        uint Free = 0xFFu;
        for (uint S = 0u; S < 8u; ++S)
        {
            if ((Occupied & (1u << S)) == 0u) continue;
            uint Take = 8u;
            if ((Free & (1u << S)) != 0u) Take = S;
            else for (uint F = 0u; F < 8u; ++F) if ((Free & (1u << F)) != 0u) { Take = F; break; }
            if (Take > 7u) return;                       // more than eight children: the format cannot hold this node
            Free &= ~(1u << Take);
            Staged[StagedCount++] = (S << 8u) | Take;    // (octant, stored slot), kept in ascending octant order
        }
        // Ascending STORED slot, which is the order the children are numbered in and the order the traversal ranks by.
        for (uint I = 1u; I < StagedCount; ++I)
        {
            const uint Key = Staged[I];
            uint J = I;
            while (J > 0u && (Staged[J - 1u] & 0xFFu) > (Key & 0xFFu)) { Staged[J] = Staged[J - 1u]; --J; }
            Staged[J] = Key;
        }

        vec4 Node[5];
        for (uint W = 0u; W < kBlasNodeBlocks; ++W) Node[W] = vec4(0.0f);
        vec3 EmitMin[8];
        vec3 EmitMax[8];
        uint EmitPresent = 0u;
        uint Meta = 0u, Imask = 0u, RunPosition = 0u, ChildBase = BlasScratch[At + 19u], NextChild = ChildBase;
        uint SlotOfOctant = 0u;   // stage 4 needs the mapping back: 3 bits per octant, stored slot in the low three
        for (uint I = 0u; I < StagedCount; ++I)
        {
            const uint Octant = Staged[I] >> 8u;
            const uint Store = Staged[I] & 0xFFu;
            SlotOfOctant = BlasSetByte(SlotOfOctant, Octant, Store);
            const uint Count = BlasScratch[At + 2u * Octant + 1u] - BlasScratch[At + 2u * Octant + 0u];
            EmitPresent |= 1u << Store;
            EmitMin[Store] = SlotMin[Octant];
            EmitMax[Store] = SlotMax[Octant];
            if (Count > kBlasTriPerLeaf)
            {
                // Interior child: a new node slot, its range handed over, its level recorded for the refit kernel.
                const uint Child = NextChild++;
                const uint ChildAt = BlasNodeSlotAt(Child);
                BlasScratch[ChildAt + 17u] = BlasScratch[At + 2u * Octant + 0u];
                BlasScratch[ChildAt + 18u] = BlasScratch[At + 2u * Octant + 1u];
                BlasLevels[Child] = EmitLevel + 1u;
                Meta = BlasSetByte(Meta, Store, BlasInteriorMeta(Store));
                Imask |= 1u << Store;
            }
            else
            {
                // Leaf child: its share of the node's run, in the slot's own order (the mirror's ④).
                Meta = BlasSetByte(Meta, Store, (BlasCountToUnary(Count) << 5u) | RunPosition);
                RunPosition += Count;
            }
        }
        BlasScratch[At + 21u] = SlotOfOctant;
        BlasQuantiseNode(Node, EmitMin, EmitMax, EmitPresent);
        BlasSetChildBase(Node, ChildBase);
        BlasSetImask(Node, Imask);
        for (uint S = 0u; S < 8u; ++S) BlasSetMeta(Node, S, BlasByteOf(Meta, S));
        for (uint W = 0u; W < kBlasNodeBlocks; ++W) BlasNodes[kBlasNodeBlocks * Slot + W] = Node[W];
        return;
    }

    // ─── stage 4: triangleBase, and the leaf records ─────────────────────────────────────────────────────────────────
    // The runs are concatenated in node order and, inside a node, in ascending STORED SLOT order — so a node's meta
    //    offsets are positions inside its own run, and the primitive order inside a run is the geometry's, not the soup's.
    //    Stage 3 left the octant→slot map (3 bits per octant) and each octant's range behind; that is all this needs.
    // ⚠️ One workgroup, serial over the nodes. A device prefix sum over the per-node leaf counts replaces this loop
    //    without changing a byte.
    if (Stage == 4u)
    {
        if (gl_LocalInvocationID.x != 0u || gl_WorkGroupID.x != 0u) return;
        uint Triangles = 0u;   // [cnt] leaf records written so far — the running triangleBase / 3
        for (uint Slot = 0u; Slot < NodeCount; ++Slot)
        {
            vec4 Node[5];
            for (uint W = 0u; W < kBlasNodeBlocks; ++W) Node[W] = BlasNodes[kBlasNodeBlocks * Slot + W];
            BlasSetTriBase(Node, Triangles * kBlasTriBlocks);

            const uint At = BlasNodeSlotAt(Slot);
            const uint SlotOfOctant = BlasScratch[At + 21u];
            const uint NodeDepth = BlasLevels[Slot];
            const bool SortedIsA = (NodeDepth & 1u) == 0u;

            // Pass 1: each leaf child's position inside the run, in ascending stored slot.
            uint FirstOfOctant[8];
            uint RunPosition = 0u;
            for (uint S = 0u; S < 8u; ++S)
            {
                for (uint O = 0u; O < 8u; ++O)
                {
                    if (BlasByteOf(SlotOfOctant, O) != S) continue;
                    const uint Count = BlasScratch[At + 2u * O + 1u] - BlasScratch[At + 2u * O + 0u];
                    if (Count == 0u || Count > kBlasTriPerLeaf) continue;   // empty, or an interior child
                    FirstOfOctant[O] = RunPosition;
                    RunPosition += Count;
                }
            }

            // Pass 2: the records themselves, straight out of the soup.
            for (uint O = 0u; O < 8u; ++O)
            {
                const uint RunLo = BlasScratch[At + 2u * O + 0u];
                const uint RunHi = BlasScratch[At + 2u * O + 1u];
                if (RunHi <= RunLo || (RunHi - RunLo) > kBlasTriPerLeaf) continue;
                for (uint I = RunLo; I < RunHi; ++I)
                {
                    const uint Primitive = SortedIsA ? BlasSortedA[I].y : BlasSortedB[I].y;
                    if (Primitive >= TriangleCount) continue;
                    const vec4 V0 = BlasSoup[3u * Primitive + 0u];
                    const vec4 V1 = BlasSoup[3u * Primitive + 1u];
                    const vec4 V2 = BlasSoup[3u * Primitive + 2u];
                    const uint Block = kBlasTriBlocks * (Triangles + FirstOfOctant[O] + (I - RunLo));
                    BlasLeaves[Block + 0u] = vec4(V2.xyz - V0.xyz, 0.0f);
                    BlasLeaves[Block + 1u] = vec4(V1.xyz - V0.xyz, 0.0f);
                    BlasLeaves[Block + 2u] = vec4(V0.xyz, uintBitsToFloat(Primitive));
                }
            }

            Triangles += RunPosition;
            for (uint W = 0u; W < kBlasNodeBlocks; ++W) BlasNodes[kBlasNodeBlocks * Slot + W] = Node[W];
        }
        return;
    }
}
