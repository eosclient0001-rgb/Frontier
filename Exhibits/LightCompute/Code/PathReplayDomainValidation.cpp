/*==========================================================================================================================================
                                              PATHREPLAYDOMAINVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 Exercise the engine replay domain directly, without the LightCompute scene archive or Vulkan host.

#include "Engine/Rendering/PathReplayDomain.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <limits>
#include <stdexcept>
#include <type_traits>
#include <vector>

namespace
{
using namespace Frontier;

//------------------------------------------------------------------------------------------------------------------------
//                                                    ENGINE INPUT FIXTURE
//------------------------------------------------------------------------------------------------------------------------

void Require(bool Condition, const char* Message)
{
    if (!Condition) throw std::runtime_error(Message);
}

struct ReplayInputFixture
{
    std::vector<PathReplayReceiver> Receivers{1};
    std::vector<PathReplayFacet> Surfaces{1};
    std::vector<TriangleVisibilitySpace::FloatEnclosure> Enclosures{1};
    std::vector<TriangleVisibilitySpace::FloatFacet> Corners{1};
    std::vector<float> MaterialAtlas;
    std::array<std::array<float, 4>, 12> Camera{};
    std::size_t AnalyticLightCount = 0;

    ReplayInputFixture()
    {
        auto& Facet = Surfaces[0];
        Facet.A = {0, 0, 0, 0};
        Facet.B = {1, 0, 0, 0};
        Facet.C = {0, 1, 0, 0};
        Facet.NormalA = Facet.NormalB = Facet.NormalC = {0, 0, 1, 0};
        Facet.AlbedoRoughness = {.5f, .5f, .5f, 1};
        Facet.OpticalToken = {0, 1.5f, .5f, 1};
        Facet.Emissive = {2, 1, .5f, 0};
        Corners[0] = {Facet.A, Facet.B, Facet.C};
        Enclosures[0].Minimum = {-.01f, -.01f, -.01f, 0};
        Enclosures[0].Maximum = {1.01f, 1.01f, .01f, 0};
        Enclosures[0].Links = {0, 1, 1, 0};
        auto& Receiver = Receivers[0];
        Receiver.PositionHit = {.25f, .25f, 1, 1};
        Receiver.NormalRoughness = {0, 0, 1, 1};
        Receiver.ViewMetallic = {0, 0, 1, 0};
        Receiver.AlbedoIor = {.5f, .5f, .5f, 1.5f};
        Receiver.ResidualSpecular = {0, 0, 0, .5f};
        Receiver.MotionPositionToken = {.25f, .25f, 1, 1};
    }

    [[nodiscard]] PathReplaySceneView View() const
    {
        return {Receivers, Surfaces, Enclosures, Corners, MaterialAtlas, Camera, AnalyticLightCount};
    }
};

template <class Function> bool Rejected(Function Operation)
{
    try { Operation(); }
    catch (const std::runtime_error&) { return true; }
    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  ABI AND DOMAIN GUARDS
//------------------------------------------------------------------------------------------------------------------------

void ValidateEngineReplayInput()
{
    static_assert(std::is_trivially_copyable_v<PathReplayReceiver> && std::is_standard_layout_v<PathReplayReceiver>);
    static_assert(std::is_trivially_copyable_v<PathReplayFacet> && std::is_standard_layout_v<PathReplayFacet>);
    static_assert(offsetof(PathReplayReceiver, PositionHit) == 0 && offsetof(PathReplayReceiver, NormalRoughness) == 16 &&
                  offsetof(PathReplayReceiver, ViewMetallic) == 32 && offsetof(PathReplayReceiver, AlbedoIor) == 48 &&
                  offsetof(PathReplayReceiver, ResidualSpecular) == 64 && offsetof(PathReplayReceiver, ExpectedDirect) == 80 &&
                  offsetof(PathReplayReceiver, MotionPositionToken) == 96 && offsetof(PathReplayReceiver, MotionNormal) == 112 &&
                  offsetof(PathReplayReceiver, MotionPixel) == 128);
    static_assert(offsetof(PathReplayFacet, A) == 0 && offsetof(PathReplayFacet, B) == 16 &&
                  offsetof(PathReplayFacet, C) == 32 && offsetof(PathReplayFacet, NormalA) == 48 &&
                  offsetof(PathReplayFacet, NormalB) == 64 && offsetof(PathReplayFacet, NormalC) == 80 &&
                  offsetof(PathReplayFacet, AlbedoRoughness) == 96 && offsetof(PathReplayFacet, OpticalToken) == 112 &&
                  offsetof(PathReplayFacet, Emissive) == 128);
    ReplayInputFixture Fixture;
    ValidatePathReplayDomain(Fixture.View(), {});
    auto Sources = CompilePathReplayFacetSources(Fixture.Surfaces);
    Require(Sources.size() == 1 && Sources[0] == 0, "Engine source-facet index compilation failed");
    Fixture.Surfaces[0].Emissive = {};
    Require(CompilePathReplayFacetSources(Fixture.Surfaces).empty(), "Nonemissive facet was retained");
    Fixture.Surfaces[0].Emissive[0] = 1;
    Fixture.Surfaces[0].B = Fixture.Surfaces[0].A;
    Require(Rejected([&] { (void)CompilePathReplayFacetSources(Fixture.Surfaces); }), "Degenerate source accepted");
    Fixture = ReplayInputFixture{};
    Fixture.Corners[0].A[0] = .1f;
    Require(Rejected([&] { ValidatePathReplayDomain(Fixture.View(), {}); }), "Mismatched BVH triangle accepted");
    Fixture = ReplayInputFixture{};
    Fixture.Enclosures[0].Maximum[0] = .5f;
    Require(Rejected([&] { ValidatePathReplayDomain(Fixture.View(), {}); }), "Incomplete BVH bounds accepted");
    Fixture = ReplayInputFixture{};
    Fixture.AnalyticLightCount = 1;
    Require(Rejected([&] { ValidatePathReplayDomain(Fixture.View(), {}); }), "Analytic light accepted");
    Fixture = ReplayInputFixture{};
    Fixture.Receivers[0].PositionHit[0] = std::numeric_limits<float>::infinity();
    Require(Rejected([&] { ValidatePathReplayDomain(Fixture.View(), {}); }), "Nonfinite receiver accepted");
    Fixture = ReplayInputFixture{};
    Fixture.Surfaces[0].AlbedoRoughness[3] = .249f;
    Require(Rejected([&] { ValidatePathReplayDomain(Fixture.View(), {false, true, false}); }),
            "Near-delta rough facet accepted");
    Fixture = ReplayInputFixture{};
    Require(Rejected([&] { ValidatePathReplayDomain(Fixture.View(), {false, false, false, true}); }),
            "GGX proposal accepted outside the rough-opaque domain");
    ValidatePathReplayDomain(Fixture.View(), {false, true, false, true});
    auto ShortCamera = Fixture.View();
    ShortCamera.Camera = ShortCamera.Camera.first(11);
    Require(Rejected([&] { ValidatePathReplayDomain(ShortCamera, {}); }), "Short camera span accepted");
    std::printf("ENGINE_REPLAY_DOMAIN abi=18_float4 fields source_indices=1 rejected=8 ggx_guard=1\n");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  REVISION AND HISTORY CAP
//------------------------------------------------------------------------------------------------------------------------

void ValidateEngineReplayHistory()
{
    ReplayInputFixture Fixture;
    PathReplayHistoryDomain History;
    PathReplayHistorySpecification Specification{4, .01f, {.025f, .025f, .025f},
                                                  false, true, true, false, false, true, false};
    auto Compare = [&](bool Changed, uint32_t Cap)
    {
        const auto Decision = History.Resolve(Fixture.View(), Specification);
        Require(Decision.Changed == Changed && Decision.MaximumHistory == Cap, "Unexpected replay history cap");
    };
    Compare(true, 1);
    Compare(false, 64);
    Fixture.Camera[0][0] = .1f; Compare(true, 1); Compare(false, 64);
    Fixture.Receivers[0].AlbedoIor[0] = .4f; Compare(true, 1); Compare(false, 64);
    Fixture.Surfaces[0].Emissive[0] = 3; Compare(true, 1); Compare(false, 64);
    Fixture.MaterialAtlas.push_back(.25f); Compare(true, 1); Compare(false, 64);
    Fixture.MaterialAtlas[0] = .75f; Compare(true, 1); Compare(false, 64);
    Specification.BounceCount = 3; Compare(true, 1); Compare(false, 64);
    Specification.Environment[1] = .5f; Compare(true, 1); Compare(false, 64);
    Specification.BalanceSampling = false; Compare(true, 1); Compare(false, 64);
    Specification.ImportanceRough = true; Compare(true, 1); Compare(false, 64);
    Specification.PowerWeightedFacets = true; Compare(true, 1); Compare(false, 64);
    Specification.UniformFacetMixture = true; Compare(true, 1); Compare(false, 64);
    Specification.RoughOpaque = false; Compare(true, 1); Compare(false, 64);
    Fixture.MaterialAtlas[0] = .5f;
    const auto Audit = History.Resolve(Fixture.View(), Specification, true);
    Require(Audit.Changed && Audit.MaximumHistory == 64, "Explicit full-history audit was not isolated");
    Compare(false, 64);
    auto ShortCamera = Fixture.View();
    ShortCamera.Camera = ShortCamera.Camera.first(11);
    Require(Rejected([&] { (void)History.Resolve(ShortCamera, Specification); }), "Short history camera accepted");
    Compare(false, 64);
    History.Invalidate();
    Compare(true, 1);
    std::printf("ENGINE_REPLAY_HISTORY exact_revisions=12 proposal=1 weighted_facets=1 uniform_mixture=1 "
                "in_place_atlas=1 audit=1 invalidation=1\n");
}
} // namespace

int main()
{
    try
    {
        ValidateEngineReplayInput();
        ValidateEngineReplayHistory();
        std::printf("PASS engine replay inputs, guards and bounded history revisions\n");
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::fprintf(stderr, "FAIL engine replay domain: %s\n", Error.what());
        return 1;
    }
}
