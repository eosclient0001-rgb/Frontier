/*============================================================================================================================================
                                                          ATMOSPHERELIMBRASTER.H
============================================================================================================================================*/
// 🧩 Exact 1:1 port of ProjectZeroEditor SkyShader.js (perspective view) + AtmosphereCards.jsx LimbView/LimbSun/TopOutline for the
//    Atmosphere overview limb image; retained on demand (re-rasterized only when the authored atmosphere or the limb sun changes)

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/GeometricRaster/Atmosphere/AtmosphericSkySequence.h"

#include <array>
#include <cstdint>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

// SkyMedium() of SkyShader.js, read from the engine atmosphere configuration
struct LimbSkyMedium
{
    float                Planet         = 6371000.0f;                          // [m]   - Planet radius (scaled 1:12 by the limb view)
    float                Top            = 60000.0f;                            // [m]   - Atmosphere shell height (true scale)
    std::array<float, 3> Rayleigh       { 5.802e-6f, 13.558e-6f, 33.1e-6f };   // [1/m] - Molecular scattering coefficients
    float                RayleighHeight = 8000.0f;                             // [m]   - Molecular scale height
    float                Mie            = 3.996e-6f;                           // [1/m] - Aerosol scattering coefficient
    float                MieHeight      = 1200.0f;                             // [m]   - Aerosol scale height
    float                Lean           = 0.78f;                               // [-]   - Henyey-Greenstein g
    std::array<float, 3> Ozone          { 0.65e-6f, 1.881e-6f, 0.085e-6f };    // [1/m] - Ozone absorption coefficients
    std::array<float, 3> Tint           { 1.0f, 1.0f, 1.0f };                  // [-]   - Sky tint
    float                Gain           = 1.0f;                                // [x]   - Sky brightness
    std::array<float, 3> Ground         { 0.188f, 0.155f, 0.115f };            // [lin] - Ground albedo
};

// LimbView() of AtmosphereCards.jsx
struct LimbViewSetup
{
    std::array<float, 3> Eye      {};     // [m]   - Eye position (planet centre at the origin)
    std::array<float, 3> Forward  {};     // [-]   - View basis forward
    std::array<float, 3> Right    {};     // [-]   - View basis right
    std::array<float, 3> Up       {};     // [-]   - View basis up
    float                Planet   = 0.0f; // [m]   - Scaled planet radius (Planet / 12)
    float                Dip      = 0.0f; // [rad] - Horizon dip from the eye
    float                TanHalf  = 0.0f; // [-]   - tan(17 deg) vertical half field
    float                Aspect   = 1.15f;// [-]   - Width / height
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

namespace AtmosphereLimbRaster
{

inline constexpr float LimbScale       = 12.0f;     // [-] - Planet drawn at 1:12 so the air layer reads
inline constexpr float TopRangeMinimum = 10000.0f;  // [m] - Atmosphere handle lower clamp
inline constexpr float TopRangeMaximum = 120000.0f; // [m] - Atmosphere handle upper clamp

[[nodiscard]] LimbSkyMedium ResolveMedium(const GeometricRaster::AtmosphericMediumConfiguration& Medium) noexcept;
[[nodiscard]] LimbViewSetup ResolveView(const LimbSkyMedium& Medium, float Aspect) noexcept;
[[nodiscard]] std::array<float, 3> ResolveSun(const LimbViewSetup& View, float ElevationDegrees) noexcept;

// TopOutline(): screen outline of the air layer's top as image fractions (only points with -0.1 < x < 1.1)
[[nodiscard]] std::vector<std::array<float, 2>> ResolveTopOutline(const LimbViewSetup& View, float Top) noexcept;

// TopThrough(): the Atmosphere height whose outline passes through image fraction (X, Y), clamped and snapped to 500 m
[[nodiscard]] float ResolveTopThrough(const LimbViewSetup& View, float X, float Y) noexcept;

// PaintSky() fragment program evaluated per pixel into straight RGBA8 (WidthPx x HeightPx, row 0 at the top)
void RasterizeLimb(const LimbSkyMedium& Medium, float SunElevationDegrees, uint32_t WidthPx, uint32_t HeightPx, std::vector<uint8_t>& OutPixels) noexcept;

} // namespace AtmosphereLimbRaster

} // namespace Frontier
