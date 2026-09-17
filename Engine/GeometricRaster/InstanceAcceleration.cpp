//============================================================================================================================================
//                                                   INSTANCEACCELERATION.CPP
//============================================================================================================================================
// 🧩 D6/D7 — object-space BLASes in one shared pair of CWBVH blobs, an instance TLAS over their world AABBs, and the
//    CPU reference trace the proofs use. The BLAS builders and the CPU walker are TraversalIndex (the same code the
//    single world-space tree uses), so "the identity case agrees" is a statement about structure, not about two
//    different builders.
//
//    ⚠️ TINYBVH_IMPLEMENTATION lives in TraversalIndex.cpp and ONLY there. This file includes tiny_bvh.h for the
//    declarations (BVH, BLASInstance, BVHNode) and links against that translation unit, which is why it must be
//    compiled with the same SIMD flags — the class layouts must not be allowed to diverge across the two TUs.

#include "InstanceAcceleration.h"
#include "TraversalIndex.h"
#include "../DeviceExchange/SwapchainExchange.h"   // TriangleIndex

// ⚠️ The layout-affecting switch must match TraversalIndex.cpp, or the two translation units disagree about the
//    classes they pass between them. -Wall -Wextra -Werror also necessitates the same suppression block: tiny_bvh.h is
//    third-party header code and is noisy about the SIMD it could not enable on this toolchain.
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wall"
#pragma GCC diagnostic ignored "-Wextra"
#endif
#define NO_DOUBLE_PRECISION_SUPPORT
#include <tiny_bvh.h>
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>

namespace Frontier {

namespace
{
    double NowMilliseconds() noexcept
    {
        using Clock = std::chrono::steady_clock;
        return std::chrono::duration<double, std::milli>(Clock::now().time_since_epoch()).count();
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     HELPERS
//------------------------------------------------------------------------------------------------------------------------

bool InvertMatrix(const float Matrix[16], float OutInverse[16]) noexcept
{
    // Cofactor inverse of a column-major 4×4 (MESA's / tinybvh's form, so an inverse computed here matches the one
    //    tinybvh computes for the same input — the identity gate leans on that when it compares against a
    //    BLASInstance row).
    const float* T = Matrix;
    float* iT = OutInverse;
    iT[0]  =  T[5]*T[10]*T[15] - T[5]*T[11]*T[14] - T[9]*T[6]*T[15] + T[9]*T[7]*T[14] + T[13]*T[6]*T[11] - T[13]*T[7]*T[10];
    iT[1]  = -T[1]*T[10]*T[15] + T[1]*T[11]*T[14] + T[9]*T[2]*T[15] - T[9]*T[3]*T[14] - T[13]*T[2]*T[11] + T[13]*T[3]*T[10];
    iT[2]  =  T[1]*T[6]*T[15]  - T[1]*T[7]*T[14]  - T[5]*T[2]*T[15] + T[5]*T[3]*T[14] + T[13]*T[2]*T[7]  - T[13]*T[3]*T[6];
    iT[3]  = -T[1]*T[6]*T[11]  + T[1]*T[7]*T[10]  + T[5]*T[2]*T[11] - T[5]*T[3]*T[10] - T[9]*T[2]*T[7]   + T[9]*T[3]*T[6];
    iT[4]  = -T[4]*T[10]*T[15] + T[4]*T[11]*T[14] + T[8]*T[6]*T[15] - T[8]*T[7]*T[14] - T[12]*T[6]*T[11] + T[12]*T[7]*T[10];
    iT[5]  =  T[0]*T[10]*T[15] - T[0]*T[11]*T[14] - T[8]*T[2]*T[15] + T[8]*T[3]*T[14] + T[12]*T[2]*T[11] - T[12]*T[3]*T[10];
    iT[6]  = -T[0]*T[6]*T[15]  + T[0]*T[7]*T[14]  + T[4]*T[2]*T[15] - T[4]*T[3]*T[14] - T[12]*T[2]*T[7]  + T[12]*T[3]*T[6];
    iT[7]  =  T[0]*T[6]*T[11]  - T[0]*T[7]*T[10]  - T[4]*T[2]*T[11] + T[4]*T[3]*T[10] + T[8]*T[2]*T[7]   - T[8]*T[3]*T[6];
    iT[8]  =  T[4]*T[9]*T[15]  - T[4]*T[11]*T[13] - T[8]*T[5]*T[15] + T[8]*T[7]*T[13] + T[12]*T[5]*T[11] - T[12]*T[7]*T[9];
    iT[9]  = -T[0]*T[9]*T[15]  + T[0]*T[11]*T[13] + T[8]*T[1]*T[15] - T[8]*T[3]*T[13] - T[12]*T[1]*T[11] + T[12]*T[3]*T[9];
    iT[10] =  T[0]*T[5]*T[15]  - T[0]*T[7]*T[13]  - T[4]*T[1]*T[15] + T[4]*T[3]*T[13] + T[12]*T[1]*T[7]  - T[12]*T[3]*T[5];
    iT[11] = -T[0]*T[5]*T[11]  + T[0]*T[7]*T[10]  + T[4]*T[1]*T[11] - T[4]*T[3]*T[10] - T[8]*T[1]*T[7]   + T[8]*T[3]*T[5];
    iT[12] = -T[4]*T[9]*T[14]  + T[4]*T[10]*T[13] + T[8]*T[5]*T[14] - T[8]*T[6]*T[13] - T[12]*T[5]*T[10] + T[12]*T[6]*T[9];
    iT[13] =  T[0]*T[9]*T[14]  - T[0]*T[10]*T[13] - T[8]*T[1]*T[14] + T[8]*T[2]*T[13] + T[12]*T[1]*T[10] - T[12]*T[2]*T[9];
    iT[14] = -T[0]*T[5]*T[14]  + T[0]*T[6]*T[13]  + T[4]*T[1]*T[14] - T[4]*T[2]*T[13] - T[12]*T[1]*T[6]  + T[12]*T[2]*T[5];
    iT[15] =  T[0]*T[5]*T[10]  - T[0]*T[6]*T[9]   - T[4]*T[1]*T[10] + T[4]*T[2]*T[9]  + T[8]*T[1]*T[6]   - T[8]*T[2]*T[5];

    const float Det = T[0]*iT[0] + T[1]*iT[4] + T[2]*iT[8] + T[3]*iT[12];
    if (!(std::fabs(Det) > 1.0e-30f)) return false;
    const float Inv = 1.0f / Det;
    for (int I = 0; I < 16; ++I) iT[I] *= Inv;
    return true;
}

bool MultiplyMatrix(const float A[16], const float B[16], float Out[16]) noexcept
{
    // Column-major: element (row R, column C) lives at C * 4 + R, and (A·B) columns are B's columns through A.
    for (uint32_t Column = 0u; Column < 4u; ++Column)
        for (uint32_t Row = 0u; Row < 4u; ++Row)
        {
            float Sum = 0.0f;
            for (uint32_t K = 0u; K < 4u; ++K) Sum += A[K * 4u + Row] * B[Column * 4u + K];
            Out[Column * 4u + Row] = Sum;
        }
    return true;
}

bool RelativeMatrix(const float WorldNow[16], const float WorldRest[16], float Out[16]) noexcept
{
    float RestInverse[16];
    if (!InvertMatrix(WorldRest, RestInverse)) return false;
    return MultiplyMatrix(WorldNow, RestInverse, Out);
}

void TransformAabb(const float Matrix[16], const float Min[3], const float Max[3], float OutMin[3], float OutMax[3]) noexcept
{
    OutMin[0] = OutMin[1] = OutMin[2] =  1.0e30f;
    OutMax[0] = OutMax[1] = OutMax[2] = -1.0e30f;
    for (int Corner = 0; Corner < 8; ++Corner)
    {
        const float P[3] = { (Corner & 1) ? Max[0] : Min[0], (Corner & 2) ? Max[1] : Min[1], (Corner & 4) ? Max[2] : Min[2] };
        for (int R = 0; R < 3; ++R)
        {
            const float W = Matrix[0 * 4 + R] * P[0] + Matrix[1 * 4 + R] * P[1] + Matrix[2 * 4 + R] * P[2] + Matrix[3 * 4 + R];
            if (W < OutMin[R]) OutMin[R] = W;
            if (W > OutMax[R]) OutMax[R] = W;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

struct InstanceAcceleration::Implementation
{
    std::vector<std::unique_ptr<TraversalIndex>> Blas;            // one per prototype
    std::vector<std::vector<TriangleIndex>>      PrototypeTris;   // the object-space soup each BLAS was built from
    std::vector<tinybvh::BLASInstance>           TlasRows;        // tinybvh's row form (transform + AABB), for Build
    std::vector<tinybvh::BVHBase*>               TlasBlasList;    // pointers tinybvh stores but never dereferences (blasList == nullptr below)
    tinybvh::BVH                                 Tlas;
    bool                                         HighQuality = false;
};

InstanceAcceleration::InstanceAcceleration() noexcept : Impl(std::make_unique<Implementation>()) {}
InstanceAcceleration::~InstanceAcceleration() = default;

bool InstanceAcceleration::Build(const std::vector<MeshPrototype>& Prototypes, const std::vector<InstanceRow>& Rows,
                                 bool HighQuality) noexcept
{
    Instances.clear(); BlasRecords.clear(); BlasPlacements.clear(); NodeBlob.clear(); LeafBlob.clear();
    TlasNodePayload.clear(); TlasPrimitives.clear();
    Metrics = {};
    Impl->Blas.clear(); Impl->PrototypeTris.clear(); Impl->TlasRows.clear();
    Impl->HighQuality = HighQuality;
    if (Prototypes.empty() || Rows.empty()) return false;

    const auto Start = NowMilliseconds();

    // ── ① BLASes, in object space, one per prototype ────────────────────────────────────────────────────────────────
    Impl->Blas.reserve(Prototypes.size());
    Impl->PrototypeTris.reserve(Prototypes.size());
    BlasRecords.reserve(Prototypes.size());

    for (const MeshPrototype& P : Prototypes)
    {
        if (P.Triangles == nullptr || P.TriangleCount == 0u)
        {
            Instances.clear(); BlasRecords.clear(); BlasPlacements.clear(); NodeBlob.clear(); LeafBlob.clear();
    TlasNodePayload.clear(); TlasPrimitives.clear();
            return false;
        }

        std::vector<TriangleIndex> Tris(P.Triangles, P.Triangles + P.TriangleCount);
        float Min[3] = {  1.0e30f,  1.0e30f,  1.0e30f };
        float Max[3] = { -1.0e30f, -1.0e30f, -1.0e30f };
        for (const TriangleIndex& T : Tris)
        {
            const float V[9] = { T.VertexAlphaX, T.VertexAlphaY, T.VertexAlphaZ,
                                 T.VertexBetaX,  T.VertexBetaY,  T.VertexBetaZ,
                                 T.VertexGammaX, T.VertexGammaY, T.VertexGammaZ };
            for (int C = 0; C < 3; ++C)
                for (int A = 0; A < 3; ++A)
                {
                    const float Value = V[C * 3 + A];
                    if (Value < Min[A]) Min[A] = Value;
                    if (Value > Max[A]) Max[A] = Value;
                }
        }

        auto Blas = std::make_unique<TraversalIndex>();
        if (!Blas->BuildBottomLevel(Tris, HighQuality))
        {
            Instances.clear(); BlasRecords.clear(); BlasPlacements.clear(); NodeBlob.clear(); LeafBlob.clear();
    TlasNodePayload.clear(); TlasPrimitives.clear();
            return false;
        }

        // Append this BLAS' blobs to the shared buffers and record where they landed (vec4 blocks — the unit both the
        //   5-vec4 node addressing and the 3-vec4 triangle addressing work in, on CPU and in the shader).
        const std::vector<float>& Nodes = Blas->QueryNodeBlob();
        const std::vector<float>& Leaves = Blas->QueryLeafBlob();
        BlasRecord Record{};
        Record.NodeOffset  = static_cast<uint32_t>(NodeBlob.size() / 4u);
        Record.NodeBlocks  = static_cast<uint32_t>(Nodes.size() / 4u);
        Record.LeafOffset  = static_cast<uint32_t>(LeafBlob.size() / 4u);
        Record.LeafBlocks  = static_cast<uint32_t>(Leaves.size() / 4u);
        Record.ObjectAabbMin[0] = Min[0]; Record.ObjectAabbMin[1] = Min[1]; Record.ObjectAabbMin[2] = Min[2];
        Record.ObjectPad        = 0.0f;
        Record.ObjectAabbMax[0] = Max[0]; Record.ObjectAabbMax[1] = Max[1]; Record.ObjectAabbMax[2] = Max[2];
        Record.PrimitiveCount   = P.TriangleCount;
        NodeBlob.insert(NodeBlob.end(), Nodes.begin(), Nodes.end());
        LeafBlob.insert(LeafBlob.end(), Leaves.begin(), Leaves.end());
        BlasRecords.push_back(Record);

        BlasPlacement Placement{};
        Placement.NodeOffset     = Record.NodeOffset;
        Placement.LeafOffset     = Record.LeafOffset;
        Placement.PrimitiveCount = Record.PrimitiveCount;
        Placement.Reserved       = 0u;
        BlasPlacements.push_back(Placement);

        Metrics.PrimitiveCount += P.TriangleCount;
        Impl->Blas.push_back(std::move(Blas));
        Impl->PrototypeTris.push_back(std::move(Tris));
    }

    Metrics.BlasCount     = static_cast<uint32_t>(Impl->Blas.size());
    Metrics.NodeBytes     = NodeBlob.size() * sizeof(float);
    Metrics.LeafBytes     = LeafBlob.size() * sizeof(float);
    Metrics.BlasBytes     = BlasRecords.size() * sizeof(BlasRecord);

    // ── ② rows + TLAS ───────────────────────────────────────────────────────────────────────────────────────────────
    Instances.resize(Rows.size());
    Impl->TlasRows.resize(Rows.size());
    Impl->TlasBlasList.assign(Impl->Blas.size(), nullptr);

    if (!UpdateTopLevel(Rows)) return false;

    Metrics.BuildMilliseconds = static_cast<float>(NowMilliseconds() - Start);
    Metrics.InstanceBytes     = Instances.size() * sizeof(TlasInstanceRecord);
    return true;
}

bool InstanceAcceleration::UpdateTopLevel(const std::vector<InstanceRow>& Rows) noexcept
{
    if (Instances.size() != Rows.size() || Rows.empty()) return false;
    for (const InstanceRow& R : Rows)
        if (R.BlasIndex >= Impl->Blas.size()) return false;

    const double Start = NowMilliseconds();

    for (size_t I = 0; I < Rows.size(); ++I)
    {
        const InstanceRow& Row = Rows[I];
        const BlasRecord&  Blas = BlasRecords[Row.BlasIndex];

        TlasInstanceRecord& Out = Instances[I];
        std::memcpy(Out.Inverse, Row.Transform, sizeof(Out.Inverse));
        float Inverse[16];
        if (!InvertMatrix(Row.Transform, Inverse))
        {
            // A singular transform is a scene bug, not a frame to skip: keep the row's forward matrix out of the
            //    trace by collapsing its AABB to the origin instead of building a garbage tree.
            std::memset(Out.Inverse, 0, sizeof(Out.Inverse));
            Out.AabbMin[0] = Out.AabbMin[1] = Out.AabbMin[2] = Out.AabbMin[3] = 0.0f;
            Out.AabbMax[0] = Out.AabbMax[1] = Out.AabbMax[2] = Out.AabbMax[3] = 0.0f;
        }
        else
        {
            std::memcpy(Out.Inverse, Inverse, sizeof(Out.Inverse));
            TransformAabb(Row.Transform, Blas.ObjectAabbMin, Blas.ObjectAabbMax, Out.AabbMin, Out.AabbMax);
        }
        Out.AabbMin[3] = 0.0f;
        Out.AabbMax[3] = 0.0f;
        Out.BlasIndex     = Row.BlasIndex;
        Out.FirstTriangle = Row.FirstTriangle;
        Out.Flags         = Row.Flags;
        Out.Pad           = 0u;

        // tinybvh's row: the same transform pair and AABB, in the layout its TLAS builder reads. blasIdx is set but
        //   the BLAS pointer list passed to Build is null, so tinybvh never dereferences it (it would insist on a
        //   BLAS layout it can traverse itself, and ours are CWBVH — the CPU walker below is the reference).
        tinybvh::BLASInstance& TlasRow = Impl->TlasRows[I];
        for (int K = 0; K < 16; ++K) TlasRow.transform[K] = Row.Transform[K];
        for (int K = 0; K < 16; ++K) TlasRow.invTransform[K] = Out.Inverse[K];
        TlasRow.aabbMin = tinybvh::bvhvec3(Out.AabbMin[0], Out.AabbMin[1], Out.AabbMin[2]);
        TlasRow.aabbMax = tinybvh::bvhvec3(Out.AabbMax[0], Out.AabbMax[1], Out.AabbMax[2]);
        TlasRow.blasIdx = Row.BlasIndex;
        TlasRow.mask    = 0xFFFFFFFFu;
    }

    const double TlasStart = NowMilliseconds();
    Impl->Tlas.Build(Impl->TlasRows.data(), static_cast<uint32_t>(Impl->TlasRows.size()), nullptr,
                     static_cast<uint32_t>(Impl->Blas.size()));
    const double TlasEnd = NowMilliseconds();

    // ── the kernel's copy of the top level ──────────────────────────────────────────────────────────────────────────
    // tinybvh's 32 B node, written out as 8 floats: [min.xyz, leftFirst bits, max.xyz, primitive-count bits]. The leaf
    //    indirection through primIdx is baked into TlasPrimitives so the traversal never resolves it. Bit-casts keep
    //    the integer fields intact through a float array — the same trick the triangle blob already uses for its
    //    primitive index in v0.w.
    const uint32_t NodeCount = Impl->Tlas.usedNodes;
    TlasNodePayload.resize(size_t(NodeCount) * 8u);
    for (uint32_t N = 0u; N < NodeCount; ++N)
    {
        const tinybvh::BVH::BVHNode& Source = Impl->Tlas.bvhNode[N];
        float* Out = &TlasNodePayload[size_t(N) * 8u];
        Out[0] = Source.aabbMin.x; Out[1] = Source.aabbMin.y; Out[2] = Source.aabbMin.z;
        const uint32_t LeftFirst = Source.leftFirst;
        const uint32_t PrimCount = Source.triCount;
        std::memcpy(&Out[3], &LeftFirst, sizeof(uint32_t));
        Out[4] = Source.aabbMax.x; Out[5] = Source.aabbMax.y; Out[6] = Source.aabbMax.z;
        std::memcpy(&Out[7], &PrimCount, sizeof(uint32_t));
    }
    TlasPrimitives.assign(Impl->Tlas.primIdx, Impl->Tlas.primIdx + Impl->Tlas.idxCount);

    Metrics.InstanceCount    = static_cast<uint32_t>(Rows.size());
    Metrics.TlasNodeCount    = Impl->Tlas.usedNodes;
    Metrics.UpdateMilliseconds   = static_cast<float>(TlasEnd - Start);
    Metrics.TlasOnlyMilliseconds = static_cast<float>(TlasEnd - TlasStart);
    Metrics.InstanceBytes    = Instances.size() * sizeof(TlasInstanceRecord);
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             CPU REFERENCE TRACE (proofs)
//------------------------------------------------------------------------------------------------------------------------

bool InstanceAcceleration::TraceClosest(const float Origin[3], const float Direction[3], float MaxDistance,
                                        uint32_t& OutInstance, uint32_t& OutPrimitive, float& OutDistance) const noexcept
{
    OutInstance = 0xFFFFFFFFu; OutPrimitive = 0xFFFFFFFFu; OutDistance = MaxDistance;
    if (!Impl->Tlas.bvhNode || Instances.empty() || Impl->Tlas.usedNodes == 0u) return false;

    // ⚠️ THE DIRECTION IS NORMALISED ONCE, HERE, and then never again.
    //
    //    Normalising up front gives this function the same contract as the world path (TraversalIndex::TraceClosest →
    //    tinybvh::Ray): t is METRES and MaxDistance is metres. For the unit directions this engine traces — camera
    //    rays, light directions, the kernel's own — the division is by exactly 1.0f, i.e. a no-op, and that is what
    //    makes the identity transform BIT-IDENTICAL rather than merely close: the object-space direction is then
    //    `M⁻¹·D` with M⁻¹ = the exact identity, so the BLAS walk sees the very same ray the world tree would.
    //
    //    From there on nothing normalises (TraversalIndex::TraceClosestObjectSpace takes the direction as given, the
    //    way TraversalCWBVH.slang's TraverseClosest does with rD = 1/D), so a rigidly moved instance costs a 4×4
    //    transform and one divide — no tree work, no re-fitted bounds, no re-emitted blobs.
    const float DL = std::sqrt(Direction[0] * Direction[0] + Direction[1] * Direction[1] + Direction[2] * Direction[2]);
    if (!(DL > 0.0f)) return false;
    const float InvDL = 1.0f / DL;
    const tinybvh::bvhvec3 O(Origin[0], Origin[1], Origin[2]);
    const tinybvh::bvhvec3 D(Direction[0] * InvDL, Direction[1] * InvDL, Direction[2] * InvDL);
    const tinybvh::bvhvec3 rD = tinybvh::tinybvh_rcp(D);   // ±inf on axis-aligned rays: the slab test handles it

    // Slab test against a 32 B node AABB, in the ray's own parameterisation (t along D, not normalised).
    const auto NodeIntersect = [&](const tinybvh::bvhvec3& BMin, const tinybvh::bvhvec3& BMax, float TMax) -> bool
    {
        const float Tx0 = (BMin.x - O.x) * rD.x, Tx1 = (BMax.x - O.x) * rD.x;
        const float Ty0 = (BMin.y - O.y) * rD.y, Ty1 = (BMax.y - O.y) * rD.y;
        const float Tz0 = (BMin.z - O.z) * rD.z, Tz1 = (BMax.z - O.z) * rD.z;
        const float TMin = std::max(std::max(std::min(Tx0, Tx1), std::min(Ty0, Ty1)), std::min(Tz0, Tz1));
        const float TExit = std::min(std::min(std::max(Tx0, Tx1), std::max(Ty0, Ty1)), std::max(Tz0, Tz1));
        return TMin <= std::min(TExit, TMax) && TExit >= 0.0f;
    };

    float Best = MaxDistance;
    uint32_t StackNode[64];
    int StackCount = 0;
    StackNode[StackCount++] = 0u;   // root

    while (StackCount > 0)
    {
        const uint32_t NodeIndex = StackNode[--StackCount];
        const tinybvh::BVH::BVHNode& Node = Impl->Tlas.bvhNode[NodeIndex];
        if (!NodeIntersect(Node.aabbMin, Node.aabbMax, Best)) continue;

        if (Node.isLeaf())
        {
            for (uint32_t K = 0; K < Node.triCount; ++K)
            {
                const uint32_t InstanceIndex = Impl->Tlas.primIdx[Node.leftFirst + K];
                const TlasInstanceRecord& Row = Instances[InstanceIndex];
                if (Row.BlasIndex >= Impl->Blas.size()) continue;

                // Object space: O' = M⁻¹·O, D' = M⁻¹·D (no normalisation — t is preserved).
                const float* Inv = Row.Inverse;
                const float OO[3] = { Inv[0]*O.x + Inv[4]*O.y + Inv[8]*O.z  + Inv[12],
                                      Inv[1]*O.x + Inv[5]*O.y + Inv[9]*O.z  + Inv[13],
                                      Inv[2]*O.x + Inv[6]*O.y + Inv[10]*O.z + Inv[14] };
                const float OD[3] = { Inv[0]*D.x + Inv[4]*D.y + Inv[8]*D.z,
                                      Inv[1]*D.x + Inv[5]*D.y + Inv[9]*D.z,
                                      Inv[2]*D.x + Inv[6]*D.y + Inv[10]*D.z };

                // ⚠️ t NEEDS NO RESCALE, and that is the whole trick. The walker works in the parameterisation of the
                //    direction it is given, so for a hit at parameter t: M·(O' + t·D') = O + t·(M·D') = O + t·D — the
                //    same t, on the same world ray, in metres when the caller's D is unit. Scale, rotation and
                //    translation all come out in the wash; nothing here divides by |M⁻¹·D| or re-fits a bound. (This is
                //    also exactly what the kernel does: it hands TraverseClosest the object-space O, D and rD = 1/D.)
                float T = Best;
                uint32_t LocalPrimitive = 0u;
                if (Impl->Blas[Row.BlasIndex]->TraceClosestObjectSpace(OO, OD, Best, T, LocalPrimitive) && T < Best && T > 0.0f)
                {
                    Best = T;
                    OutInstance = InstanceIndex;
                    OutPrimitive = LocalPrimitive;
                }
            }
            continue;
        }

        if (StackCount + 2 <= 64)
        {
            StackNode[StackCount++] = Node.leftFirst;
            StackNode[StackCount++] = Node.leftFirst + 1u;
        }
        else
        {
            // 64 slots is four times the depth a balanced tree over 2^31 instances needs; if a malformed tree ever got
            //   here the honest answer is a miss, not a stack smash.
            OutInstance = 0xFFFFFFFFu; OutPrimitive = 0xFFFFFFFFu; OutDistance = MaxDistance;
            return false;
        }
    }

    if (OutInstance == 0xFFFFFFFFu) return false;
    OutDistance = Best;
    return true;
}

const std::vector<TriangleIndex>& InstanceAcceleration::QueryPrototypeTriangles(uint32_t BlasIndex) const noexcept
{
    static const std::vector<TriangleIndex> Empty;
    if (BlasIndex >= Impl->PrototypeTris.size()) return Empty;
    return Impl->PrototypeTris[BlasIndex];
}

} // namespace Frontier
