#include "BlasDevicePayload.h"

#include "BlasBuildMirror.h"   // LevelsOf: the BFS table both the refit kernel and the host's dispatch loop need

#include <algorithm>
#include <cstring>

namespace Frontier
{
bool PackBlasSoup(const std::vector<TriangleIndex>& Triangles, std::vector<float>& OutSoup) noexcept
{
    OutSoup.assign(size_t(BlasSoupFloats(static_cast<uint32_t>(Triangles.size()))), 0.0f);
    for (size_t I = 0u; I < Triangles.size(); ++I)
    {
        const TriangleIndex& T = Triangles[I];
        float* V = &OutSoup[I * 12u];
        V[0] = T.VertexAlphaX; V[1] = T.VertexAlphaY; V[2] = T.VertexAlphaZ;
        V[4] = T.VertexBetaX;  V[5] = T.VertexBetaY;  V[6] = T.VertexBetaZ;
        V[8] = T.VertexGammaX; V[9] = T.VertexGammaY; V[10] = T.VertexGammaZ;
        // .w of each vec4 is unused by the kernels (they read .xyz), left at zero rather than carrying garbage into a
        //    buffer a shader might one day read.
    }
    return !Triangles.empty();
}

bool PackBlasLevels(const std::vector<float>& Nodes, uint32_t NodeOffset, uint32_t NodeBlocks,
                    std::vector<uint32_t>& OutLevels, uint32_t& OutMaxLevel) noexcept
{
    std::vector<uint16_t> Levels;
    BlasBuildMirror::LevelsOf(Nodes, NodeOffset, NodeBlocks, Levels, OutMaxLevel);
    if (Levels.empty()) return false;
    OutLevels.assign(Levels.size(), 0xFFFFFFFFu);
    for (size_t I = 0u; I < Levels.size(); ++I)
        if (Levels[I] != 0xFFFFu) OutLevels[I] = uint32_t(Levels[I]);
    return true;
}

bool BuildBlasBuildPayload(const std::vector<TriangleIndex>& Triangles, const float ObjectMin[3],
                           const float ObjectMax[3], uint32_t NodeSlots, BlasBuildPayload& Out) noexcept
{
    Out = BlasBuildPayload{};
    Out.TriangleCount = static_cast<uint32_t>(Triangles.size());
    if (Out.TriangleCount == 0u || NodeSlots == 0u) return false;
    if (!PackBlasSoup(Triangles, Out.Soup)) return false;

    // The object AABB the Morton codes are normalised against. ⚠️ It comes from the caller (the host already has it in
    //    the BlasRecord), not from a reduction over the soup: two reductions of the same triangles are two answers the
    //    day one of them is over a different array, and only one of them is what the placement's bounds were built from.
    for (int C = 0; C < 3; ++C)
    {
        const float Lo = std::min(ObjectMin[C], ObjectMax[C]);
        const float Hi = std::max(ObjectMin[C], ObjectMax[C]);
        Out.ObjectMin[C] = Lo;
        Out.ObjectMin[3] = 0.0f;
        Out.ObjectExtent[C] = Hi - Lo;
        Out.ObjectExtent[3] = 0.0f;
    }
    Out.NodeSlots    = NodeSlots;
    Out.ScratchWords = BlasBuildScratchWords(NodeSlots);
    Out.SortedWords  = Out.TriangleCount;
    return Out.SizesAgree();
}

bool BuildBlasDispatchPlan(uint32_t TriangleCount, uint32_t NodeSlots, std::vector<BlasDispatch>& Out) noexcept
{
    Out.clear();
    if (TriangleCount == 0u || NodeSlots == 0u) return false;

    Out.push_back({ 0u, 0u, BlasGroupCount(TriangleCount, kBlasBuildLocalSize), "prepass: keys, centroids, the root" });
    const uint32_t Cap = BlasBuildLevelCap(TriangleCount);
    for (uint32_t Level = 0u; Level < Cap; ++Level)
    {
        // One group per node SLOT: the level's own nodes are the dense range [NodeBase, NodeBase + Nodes) the scratch
        //    header holds, so the arena's capacity is a safe over-dispatch and the kernel's guard turns the rest off.
        Out.push_back({ 1u, Level, NodeSlots, "partition: this level's range in octants — also the sort" });
        Out.push_back({ 2u, Level, 1u, "scan: child numbers in ascending slot order (one workgroup)" });
        Out.push_back({ 3u, Level, NodeSlots, "emit: slots, boxes, metas, childBase" });
    }
    Out.push_back({ 4u, 0u, 1u, "runs: triangleBase in node order, then the leaf records (one workgroup)" });
    return true;
}

bool BuildBlasRefitPlan(uint32_t PrimitiveCount, uint32_t NodeCount, uint32_t MaxLevel,
                        std::vector<BlasDispatch>& Out) noexcept
{
    Out.clear();
    if (PrimitiveCount == 0u || NodeCount == 0u) return false;

    Out.push_back({ 0u, 0u, BlasGroupCount(PrimitiveCount, kBlasRefitLocalSize), "leaves: e1, e2, v0 from the deformed soup" });
    for (uint32_t Step = 0u; Step <= MaxLevel; ++Step)
    {
        const uint32_t Level = MaxLevel - Step;   // deepest first: a node is re-quantised after its children are final
        Out.push_back({ 1u, Level, BlasGroupCount(NodeCount, kBlasRefitLocalSize), "nodes: re-quantise this level" });
    }
    return true;
}
}
