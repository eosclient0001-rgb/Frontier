/*==========================================================================================================================================
                                               REPLAYENDPOINTVALIDATION.H
==========================================================================================================================================*/
// 🧩 Reproduce and measure shadow segments near an explicitly sampled emissive triangle.
#pragma once
#include <bit>

namespace
{
LightComputeArchive ReplayEndpointFixture(float BlockHeight, bool Covered)
{
    auto Scene = ReplayOcclusionFixture(Covered ? -5 : 7);
    std::vector<std::array<SpatialVector,3>> Corners;
    for (auto& Facet : Scene.Surfaces)
    {
        if (Facet.Emissive[0] == 0)
            for (auto* Point : {&Facet.A, &Facet.B, &Facet.C}) (*Point)[2] = BlockHeight;
        Corners.push_back({SpatialVector{Facet.A[0],Facet.A[1],Facet.A[2]},
                           SpatialVector{Facet.B[0],Facet.B[1],Facet.B[2]},
                           SpatialVector{Facet.C[0],Facet.C[1],Facet.C[2]}});
    }
    const auto Prior = Scene.Surfaces;
    TriangleVisibilitySpace Space;
    Space.Build(Corners);
    Scene.Visibility = Space.PackFloat32();
    for (size_t I = 0; I < Scene.Surfaces.size(); ++I)
    {
        Scene.Surfaces[I] = Prior[Scene.Visibility.OriginalFacets[I]];
        Scene.Surfaces[I].A = Scene.Visibility.Corners[I].A;
        Scene.Surfaces[I].B = Scene.Visibility.Corners[I].B;
        Scene.Surfaces[I].C = Scene.Visibility.Corners[I].C;
    }
    return Scene;
}
void ValidateReplayEndpoint(const char* Driver, const std::string& Shaders)
{
    const auto Open = ReplayEndpointFixture(.999995f, false);
    const auto Near = ReplayEndpointFixture(.999995f, true);
    const auto Far = ReplayEndpointFixture(.9999f, true);
    const auto Beyond = ReplayEndpointFixture(1.000005f, true);
    LightComputeSubmission Compute(Driver);
    Compute.Prepare(Open, Shaders, false, false, false, false, true);
    DirectGpuMoments OpenMoments, NearMoments, FarMoments, BeyondMoments;
    for (uint32_t Batch = 0; Batch < 4; ++Batch)
    {
        const uint32_t Seed = 57000 + Batch * 100;
        auto Trace = [&](const LightComputeArchive& Scene, DirectGpuMoments& Samples, uint32_t Salt)
        {
            const auto Pixels = Compute.ExecuteReplay(Scene, 1, Seed + Salt, false, false, true,
                                                      {0,0,0}, .01f, false, false, false, true);
            AccumulateReplayCentres(Samples, Pixels, Scene.Width);
        };
        Trace(Open, OpenMoments, 1); Trace(Near, NearMoments, 2);
        Trace(Far, FarMoments, 3); Trace(Beyond, BeyondMoments, 4);
    }
    const double Integral = ReplayOccludedAreaIntegral(0, 7);
    const float SourceHeight = 1, BlockHeight = .999995f;
    const uint32_t Ulps = std::bit_cast<uint32_t>(SourceHeight) - std::bit_cast<uint32_t>(BlockHeight);
    std::printf("ENDPOINT_BASELINE source_z=%.9g near_blocker_z=%.9g gap=%.9g float_ulps=%u reference=%.9g "
                "open=%.9g near=%.9g farther=%.9g beyond=%.9g n=%u\n",
                SourceHeight, BlockHeight, SourceHeight - BlockHeight, Ulps, Integral, OpenMoments.Mean(),
                NearMoments.Mean(), FarMoments.Mean(), BeyondMoments.Mean(), NearMoments.Count);
    Require(Ulps > 16 && std::abs(OpenMoments.Mean()-Integral) < 6*OpenMoments.StandardError()+.002 &&
                NearMoments.Mean() > Integral * .8 && FarMoments.Mean() == 0 &&
                std::abs(BeyondMoments.Mean()-Integral) < 6*BeyondMoments.StandardError()+.002,
            "Expected endpoint shadow gap was not reproduced");
    std::printf("PASS reproduced light leak through representably separated near-source blocker\n");
}
} // namespace
