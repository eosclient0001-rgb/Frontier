/*==========================================================================================================================================
                                                   PATHREPLAYFOOTPRINT.H
==========================================================================================================================================*/
// 🧩 Float32 receiver and facet footprints shared by replay shaders and native scene exporters.
#pragma once

#include <array>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   GPU INPUT FOOTPRINTS
//------------------------------------------------------------------------------------------------------------------------

// 📝 These match SurfacePoint and FacetCorners in LightInfluence.slang.
struct alignas(16) PathReplayReceiver
{
    std::array<float, 4> PositionHit{}, NormalRoughness{}, ViewMetallic{}, AlbedoIor{}, ResidualSpecular{},
        ExpectedDirect{}, MotionPositionToken{}, MotionNormal{}, MotionPixel{};
};
struct alignas(16) PathReplayFacet
{
    std::array<float, 4> A{}, B{}, C{}, NormalA{}, NormalB{}, NormalC{}, AlbedoRoughness{}, OpticalToken{},
        Emissive{};
};
static_assert(sizeof(PathReplayReceiver) == 144 && alignof(PathReplayReceiver) == 16);
static_assert(sizeof(PathReplayFacet) == 144 && alignof(PathReplayFacet) == 16);

} // namespace Frontier
