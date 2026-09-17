//============================================================================================================================================
// 📦 Engine/GeometricRaster/InstanceAcceleration.h — D6/D7 two-level acceleration: object-space BLASes + an instance TLAS
//============================================================================================================================================
// 🧩 The structure every dynamic-geometry plan in this repository converges on (Docs/DynamicGeometry.md): one
//    bottom-level tree per UNIQUE MESH, built in OBJECT space and shared by every instance of that mesh; one thin
//    top-level tree over the instances' world-space AABBs; and a per-instance transform pair that moves the ray into
//    object space at the leaf. A rigidly moved object therefore costs zero tree work — only its 112-byte row changes —
//    and the whole-scene CWBVH re-emit that D5 measured (6.31 ms for a 16.8 k-triangle showroom, growing with the
//    whole scene) stops being on the critical path for anything that moves.
//
//    Layout contract (mirrored by the intended kernel path; change both or neither):
//        CwbvhNodes[]  — one shared node blob (5 vec4 per node, Ylitie/Ylitie-style CWBVH as TraversalIndex emits it).
//                        Every BLAS's blob is appended here; BlasRecord::NodeOffset is its start in vec4 blocks.
//        CwbvhTris[]   — the same for the 3-vec4-per-triangle leaf blob.
//        TlasInstanceRecord[instance]  112 B — the world→object inverse (64 B), the world AABB, the BLAS index.
//        BlasRecord[blas]              48 B — where that BLAS' blobs live inside the shared buffers, plus its
//                        OBJECT-space AABB (what the per-frame update transforms to get the world AABB) and its
//                        primitive count.
//
//    ⚠️ t IS PRESERVED BY THE TRANSFORM. A ray (O, D) transformed by M⁻¹ gives O' + t·D' exactly, so the hit distance
//    found inside the BLAS is the distance along the world ray — no rescale, and the world hit point is simply
//    O + t·D. Normals come back with the inverse-transpose: n_world = (M⁻¹)ᵀ · n_object, which with the stored
//    column-major inverse is `vec3(dot(i0.xyz, n), dot(i1.xyz, n), dot(i2.xyz, n))`.
//
//    D6 = this structure's CPU build + trace, and the identity gate: with an identity transform the BLAS is built
//    from the same floats in the same order as the world-space tree, so its blobs are byte-identical (the property
//    BuildBottomLevel's comment pins). D7 = the per-frame path: instance rows update in place, the TLAS is rebuilt
//    (a TLAS is never refitted — tinybvh hard-errors on it, and the research guidance is the same), and the measured
//    budget for that on this class of hardware is in the proof script's output.
//
//    The CPU trace here is a REFERENCE implementation for proofs, not a frame path: it walks the TLAS with its own
//    slab test and calls each BLAS's proven CPU walker (TraversalIndex::TraceClosest, which walks the binary tree
//    deliberately — see its comment on tinybvh's unreliable CWBVH CPU traversal).
//
//    Cost units, so the numbers in the docs mean something: every offset in here is in vec4 BLOCKS (16 B), because
//    that is the unit the 5-vec4 node and 3-vec4 triangle addressing works in, both on the CPU and in
//    TraversalCWBVH.slang.

#pragma once

#include <cstdint>
#include <memory>
#include <vector>

namespace Frontier {

struct TriangleIndex;   // DeviceExchange/SwapchainExchange.h — flat triangle, 64 B

//------------------------------------------------------------------------------------------------------------------------
//                                                    INPUT ROWS
//------------------------------------------------------------------------------------------------------------------------

// One unique mesh, in OBJECT space. The triangles are read once, at Build; the caller keeps ownership.
struct MeshPrototype
{
    const TriangleIndex* Triangles    = nullptr;   // [-] object-space triangle soup
    uint32_t             TriangleCount = 0u;       // [cnt]
};

// One instance: where a prototype is, and where its triangles live in the caller's flat world-space soup (the D5
//    convention, kept so a hit can still resolve material/UVs from the flat record exactly as the kernel does today).
struct InstanceRow
{
    float    Transform[16];     // [-] object → world, column-major (Columns[c][r] flattened c*4+r) — the same layout
                                //     InstanceRecord::World carries, so a row can be filled from it without a copy
    uint32_t BlasIndex     = 0u;   // [idx] which prototype
    uint32_t FirstTriangle = 0u;   // [idx] first world-space triangle of this instance in the flat soup
    uint32_t Flags         = 0u;   // [bit] reserved (double-sided / emissive, mirroring InstanceFlag)
};

//------------------------------------------------------------------------------------------------------------------------
//                                                GPU-FACING RECORDS
//------------------------------------------------------------------------------------------------------------------------

// 112 B — the row the kernel needs per instance, laid out as seven 16 B blocks so a device read is four vec4 loads.
//    Only the INVERSE is stored: the ray goes to object space, the hit's world position is O + t·D verbatim, and
//    normals use the inverse's transpose, so the forward matrix would be dead weight on the device.
struct TlasInstanceRecord
{
    float    Inverse[16];   // [-] world → object, column-major; 3×3 block at Columns[0..2], translation at Columns[3]
    float    AabbMin[4];    // [m] world-space AABB of this instance (conservative, from the 8 transformed corners); w = 0
    float    AabbMax[4];    // [m] the other corner; w = 0
    uint32_t BlasIndex;      // [idx] which BLAS (indexes BlasPlacement[])
    uint32_t FirstTriangle;  // [idx] where this instance's triangles begin in the flat world-space soup, so a hit's
                             //       LOCAL primitive resolves to the flat index the kernel shades from
    uint32_t Flags;          // [bit] InstanceRow::Flags
    uint32_t Pad;            // [-] 0
};
static_assert(sizeof(TlasInstanceRecord) == 112u, "TlasInstanceRecord must be 112 bytes (std430 mirror)");

// 16 B — the cut-down BLAS row the traversal reads (TraversalRecords.slang's BlasPlacement). Emitted from the
//    BlasRecord below, so the fields cannot drift; PrimitiveCount is informational for the kernel side.
struct BlasPlacement
{
    uint32_t NodeOffset;      // [vec4 blocks] start of this BLAS' nodes in CwbvhNodes[]
    uint32_t LeafOffset;      // [vec4 blocks] start of this BLAS' triangles in CwbvhTris[]
    uint32_t PrimitiveCount;  // [cnt] triangles in this BLAS
    uint32_t Reserved;        // [-] 0
};
static_assert(sizeof(BlasPlacement) == 16u, "BlasPlacement must be 16 bytes (std430 mirror)");

// 48 B — where one BLAS' blobs live inside the shared buffers, plus what the per-frame update needs from it.
struct BlasRecord
{
    uint32_t NodeOffset;        // [vec4 blocks] start of this BLAS' nodes in CwbvhNodes[]
    uint32_t NodeBlocks;        // [vec4 blocks] 5 per node
    uint32_t LeafOffset;        // [vec4 blocks] start of this BLAS' triangles in CwbvhTris[]
    uint32_t LeafBlocks;        // [vec4 blocks] 3 per triangle
    float    ObjectAabbMin[3];  // [m] object-space AABB (the update transforms its 8 corners per frame)
    float    ObjectPad;
    float    ObjectAabbMax[3];  // [m]
    uint32_t PrimitiveCount;    // [cnt] triangles in this BLAS
};
static_assert(sizeof(BlasRecord) == 48u, "BlasRecord must be 48 bytes (std430 mirror)");

//------------------------------------------------------------------------------------------------------------------------
//                                                     METRICS
//------------------------------------------------------------------------------------------------------------------------

struct InstanceAccelerationMetrics
{
    uint32_t InstanceCount   = 0u;   // [cnt]
    uint32_t BlasCount       = 0u;   // [cnt] unique meshes
    uint32_t TlasNodeCount   = 0u;   // [cnt] 32 B nodes in the top level
    uint32_t PrimitiveCount  = 0u;   // [cnt] summed over BLASes (object-space triangles)
    uint64_t NodeBytes       = 0u;   // [B] shared CWBVH node blob
    uint64_t LeafBytes       = 0u;   // [B] shared CWBVH leaf blob
    uint64_t InstanceBytes   = 0u;   // [B] TlasInstanceRecord array
    uint64_t BlasBytes       = 0u;   // [B] BlasRecord array
    float    BuildMilliseconds   = 0.0f;   // [ms] BLASes + first TLAS, wall clock
    float    UpdateMilliseconds  = 0.0f;   // [ms] last UpdateTopLevel (rows + TLAS), wall clock
    float    TlasOnlyMilliseconds= 0.0f;   // [ms] the TLAS Build alone within that update
};

//------------------------------------------------------------------------------------------------------------------------
//                                              INSTANCE ACCELERATION
//------------------------------------------------------------------------------------------------------------------------

class InstanceAcceleration
{
public:
    InstanceAcceleration() noexcept;
    ~InstanceAcceleration();
    InstanceAcceleration(const InstanceAcceleration&) = delete;
    InstanceAcceleration& operator=(const InstanceAcceleration&) = delete;

    // D6: build every prototype's BLAS in object space (HighQuality → spatial-split BLAS builds, which are then NOT
    //    refittable — the D8 trade, recorded here because the flag reaches the BLAS builders). Rows are stored and the
    //    TLAS is built over them, so a scene that never moves is one Build and nothing else.
    [[nodiscard]] bool Build(const std::vector<MeshPrototype>& Prototypes,
                             const std::vector<InstanceRow>&  Rows,
                             bool                             HighQuality = false) noexcept;

    // D7: the per-frame path. Rows are re-read (a moved object is a new transform in the same slot), their world AABBs
    //    recomputed from the stored object AABBs, and the TLAS rebuilt. No reallocation, no BLAS touched.
    //    Returns false if the row set's shape changed (count or BLAS assignments) — that is a Build, not an update.
    [[nodiscard]] bool UpdateTopLevel(const std::vector<InstanceRow>& Rows) noexcept;

    // CPU reference trace (proofs, never a frame): closest hit through TLAS → instance → object-space BLAS. Direction
    //    may be any length; it is normalised once so MaxDistance/OutDistance are metres, matching the world tree's
    //    TraversalIndex::TraceClosest. With unit input and an identity transform this is BIT-IDENTICAL to that call —
    //    the property the D6 gate checks rather than assumes.
    [[nodiscard]] bool TraceClosest(const float Origin[3], const float Direction[3], float MaxDistance,
                                    uint32_t& OutInstance, uint32_t& OutPrimitive, float& OutDistance) const noexcept;

    [[nodiscard]] bool     IsReady()      const noexcept { return !Instances.empty(); }
    [[nodiscard]] uint32_t QueryBlasCount() const noexcept { return static_cast<uint32_t>(Instances.empty() ? 0u : Metrics.BlasCount); }

    [[nodiscard]] const std::vector<float>&                QueryNodeBlob()   const noexcept { return NodeBlob; }
    [[nodiscard]] const std::vector<float>&                QueryLeafBlob()   const noexcept { return LeafBlob; }
    // D7 upload payload: the top level exactly as the kernel reads it (8 floats per node, see the layout note above).
    [[nodiscard]] const std::vector<float>&                QueryTlasNodePayload() const noexcept { return TlasNodePayload; }
    [[nodiscard]] const std::vector<uint32_t>&             QueryTlasPrimitiveList() const noexcept { return TlasPrimitives; }
    [[nodiscard]] const std::vector<BlasPlacement>&        QueryBlasPlacements() const noexcept { return BlasPlacements; }
    [[nodiscard]] const std::vector<TlasInstanceRecord>&   QueryInstances()  const noexcept { return Instances; }
    [[nodiscard]] const std::vector<BlasRecord>&           QueryBlasRecords() const noexcept { return BlasRecords; }
    [[nodiscard]] const InstanceAccelerationMetrics&       QueryMetrics()    const noexcept { return Metrics; }

    // The prototype triangles a BLAS was built from (object space) — the identity gate and debug views read these.
    [[nodiscard]] const std::vector<TriangleIndex>&        QueryPrototypeTriangles(uint32_t BlasIndex) const noexcept;

private:
    struct Implementation;
    std::unique_ptr<Implementation> Impl;

    std::vector<TlasInstanceRecord> Instances;
    std::vector<BlasRecord>         BlasRecords;
    std::vector<BlasPlacement>      BlasPlacements;
    std::vector<float>              NodeBlob;          // shared, all BLASes appended in order
    std::vector<float>              LeafBlob;
    std::vector<float>              TlasNodePayload;   // 8 floats per top-level node, rebuilt with the TLAS
    std::vector<uint32_t>           TlasPrimitives;    // instance indices the top-level leaves point at
    InstanceAccelerationMetrics     Metrics;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     HELPERS
//------------------------------------------------------------------------------------------------------------------------
// Kept here (not in the harness) so the proof and the eventual host path cannot drift on the two conventions that
// matter: which matrix inverse is stored, and how the world AABB comes out of the object one.

// 4×4 inverse of a column-major matrix; returns false when the matrix is singular (|det| under 1e-30).
[[nodiscard]] bool InvertMatrix(const float Matrix[16], float OutInverse[16]) noexcept;

// Column-major 4×4 product: Out = A · B. Needed because the triangles a BLAS is built from are the REST-POSE
//    WORLD soup (SceneStructure::Finalise bakes each instance's World into the flat triangles), so the transform a
//    row must carry is the RELATIVE one, World_now · World_rest⁻¹ — identity for a static instance, the whole
//    transform for one whose rest place is identity (the drop bodies), and correct for anything in between.
[[nodiscard]] bool MultiplyMatrix(const float A[16], const float B[16], float Out[16]) noexcept;

// Shortest form of the above: Out = World_now · inverse(World_rest), false when the rest matrix is singular.
[[nodiscard]] bool RelativeMatrix(const float WorldNow[16], const float WorldRest[16], float Out[16]) noexcept;

// World-space AABB of an object-space AABB under a column-major matrix (the 8-corner form tinybvh's
//    BLASInstance::Update uses — kept identical so a BLASInstance row and a TlasInstanceRecord row agree).
void TransformAabb(const float Matrix[16], const float Min[3], const float Max[3], float OutMin[3], float OutMax[3]) noexcept;

} // namespace Frontier
