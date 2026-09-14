//============================================================================================================================================
// 📦 Project-Zero/Source/CelestialStage.h — One Scene Where ReSTIR and the Whole Celestial Port Light the Same Frame
//============================================================================================================================================
//
//    The proof the port has to survive is not "the sky renders" and "the Cornell box renders", side by side.
//    It is *one* frame in which the sky is the light source for path-traced geometry, and the geometry occludes
//    the sky — everything running at once, through Project Zero's own ReSTIR.
//
//    So this stage is the Cornell box with its ceiling opened. What that buys, concretely:
//        · The sun and sky become real illuminants — they reach the floor through the aperture, and ReSTIR's
//          GI bounces that light onto the coloured walls. Remove the sky and the room goes dark; that is the
//          negative control, and `CheckCelestialScene.sh` runs it.
//        · The geometry occludes the sky, so clouds, stars and the solar disc are seen *through* an opening,
//          which is what exercises the composite order rather than just the integrator.
//        · The original emissive ceiling luminaire stays, so the classic ReSTIR DI/GI path is still under test.
//
//    Everything the reference panel exposes is live here — atmosphere, sun, sky, stars, moons, both fogs, the
//    cloud layer, volumetric and local clouds, wind, precipitation, rainbow, lens flare and the tonemap chain.
//
//============================================================================================================================================

#pragma once

#include "CelestialIntegrator.h"
#include "PrecipitationSolver.h"
#include "RayTracingSolver.h"
#include "RendererHost.h"
#include "SceneStructure.h"
#include "../../../GeometricRaster/CameraProjection.h"
#include <string>
#include <vector>

namespace Frontier::ProjectZero {

//------------------------------------------------------------------------------------------------------------------------
//                                                  STAGE CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct CelestialStageCriteria
{
    uint32_t Width            = 960u;
    uint32_t Height           = 640u;
    uint32_t SampleCount      = 4u;                             // [count] pixel samples, for edge and star AA
    uint32_t SpatialPasses    = 2u;                             // [count] ReSTIR GI spatial resampling passes
    uint32_t IndirectRays     = 8u;                             // [count] GI candidates per pixel
    uint32_t SkyTaps          = 24u;                            // [count] hemisphere taps for sky visibility
    bool     OpenCeiling      = true;                           // cut the aperture that lets the sky in
    bool     OpenWall         = true;                           // cut the window that lets the world in
    bool     SkyLighting      = true;                           // the negative control switches this off
    bool     EmissiveLuminaire= true;                           // keep the classic Cornell ceiling light
    float    Exposure         = 1.0f;

    //    How far the room's floor stands above the celestial ground plane, in metres.
    //
    //    ⚠️ This is not decoration. The Cornell floor spans the whole room and the reference's checker plane
    //    sits at `pl_y = 0`; put both at the same height and they are COPLANAR, so every downward ray hits the
    //    floor before it can reach the ground and the entire `plane` entity is unobservable from inside — it
    //    would be integrated perfectly and never once appear in a pixel. Standing the room on a terrace is
    //    what makes the ground, its graticule, its axis lines and the two local lights visible through the
    //    window, and it is also the only arrangement in which the room can cast a shadow onto the ground.
    float    FloorElevation   = 6.0f;                           // [m]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  CELESTIAL STAGE
//------------------------------------------------------------------------------------------------------------------------

class CelestialStage
{
public:
    CelestialStage(const CelestialStageCriteria& Setup, const CelestialCriteria& Sky) noexcept;

    //    Build the room. `OpenCeiling` decides whether the roof carries an aperture.
    void                    ConstructStage() noexcept;

    //    Advance the weather clock: wind integral, precipitation pool, solved ephemeris.
    void                    Advance(float DeltaSeconds) noexcept;

    //    One full frame: primary visibility, ReSTIR DI, ReSTIR GI with spatial resampling, sky compositing,
    //    aerial perspective, precipitation, rainbow, flare and tonemap.
    void                    RenderFrame(const Frontier::CameraProjection& Camera) noexcept;

    [[nodiscard]] bool      ExportPpmImage(const std::string& OutputPath) const noexcept;

    [[nodiscard]] const std::vector<Vector3>& QueryRadianceBuffer() const noexcept { return RadianceBuffer; }
    [[nodiscard]] CelestialIntegrator&        MutableSky() noexcept               { return Sky; }
    [[nodiscard]] const CelestialIntegrator&  QuerySky() const noexcept           { return Sky; }
    [[nodiscard]] PrecipitationSolver&        MutableRain() noexcept              { return Rain; }
    [[nodiscard]] uint32_t                    QueryWidth() const noexcept         { return Criteria.Width; }
    [[nodiscard]] uint32_t                    QueryHeight() const noexcept        { return Criteria.Height; }

    //    Statistics the numeric gate asserts on, so a regression is a number and not an opinion.
    struct FrameStatistics
    {
        double   MeanLuminance      = 0.0;
        double   SkyPixelFraction   = 0.0;                      // fraction of pixels that saw the sky
        double   MeanSkyLuminance   = 0.0;
        double   MeanSurfaceLuminance = 0.0;
        uint32_t DistinctColours    = 0u;                       // a flat frame is a broken frame
        uint32_t RainPixels         = 0u;
        uint32_t GroundPixels       = 0u;                       // pixels that landed on the celestial ground
        double   MeanGroundLuminance = 0.0;
        double   RenderMilliseconds = 0.0;
    };
    [[nodiscard]] const FrameStatistics& QueryStatistics() const noexcept { return Statistics; }

private:
    [[nodiscard]] Vector3   ShadeSurface(const HitIntersection& Hit, const Vector3& ViewDirection,
                                         const Vector3& IndirectRadiance) const noexcept;
    [[nodiscard]] Vector3   SampleCosineHemisphere(const Vector3& Normal, float u1, float u2) const noexcept;
    [[nodiscard]] ObserverFrame ObserverFrameOf(const Frontier::CameraProjection& Camera) const noexcept;

    //    The panel's point and spot lights, shadow-tested against the room. Distinct from the integrator's own
    //    `LocalLightsOnSurface`, which shades the celestial ground and has no occluder to test against: inside
    //    the Cornell box the walls really do block the lamps, and the shadow is the whole point.
    [[nodiscard]] Vector3   LocalLightContribution(const Vector3& Position, const Vector3& Normal,
                                                   const Vector3& Albedo) const noexcept;

    CelestialStageCriteria      Criteria;
    RayTracingSolver            Scene;
    CelestialIntegrator         Sky;
    PrecipitationSolver         Rain;
    std::vector<Vector3>        RadianceBuffer;
    std::vector<float>          SkyMaskBuffer;
    FrameStatistics             Statistics;
    Vector3                     SunIrradiance{ 0.0f, 0.0f, 0.0f };
};

} // namespace Frontier::ProjectZero
