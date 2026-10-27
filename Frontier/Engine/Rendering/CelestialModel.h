/*==========================================================================================================================================
                                                       CELESTIAL MODEL
                                     ------------------------------------------------------------------
                 Solar position, twilight phases, lunar phase and a deterministic star catalogue
                      (plan §8.1: CelestialSky, NativeTwilight, NightStars, SkyProjection).
==========================================================================================================================================*/

// 🧩 Celestial model: where the sun and moon are, what the light is doing about it.
//
// Low-precision solar algorithm (NOAA/Meeus truncated series, ~0.01-0.05 degree class — far beyond
// visual needs), civil-date Julian conversion, twilight classification by solar elevation, lunar
// age/illumination from a fixed new-moon epoch, and a hash-generated star catalogue (uniform sphere,
// power-law magnitudes) that is bit-identical for a given seed on every platform. Angles in the API
// are radians unless the name says Degrees; times are Julian dates (UTC).

#pragma once

#include "AtmosphereModel.h"   // SpectrumRgb
#include "ClusterNesting.h"

#include <cstdint>
#include <vector>

namespace Frontier
{

// Julian date from a proleptic Gregorian civil date + UTC fractional hours.
[[nodiscard]] double JulianDate(int Year, unsigned Month, unsigned Day, double UtcHours) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                            SUN
//------------------------------------------------------------------------------------------------------------------------

struct SolarPosition
{
    double ElevationRad = 0.0;   // [rad] above horizon (negative below)
    double AzimuthRad   = 0.0;   // [rad] clockwise from north
    double DeclinationRad = 0.0; // [rad]
};

[[nodiscard]] SolarPosition SunPosition(double Julian, double LatitudeDeg, double LongitudeDeg) noexcept;

// Earth–Sun distance [AU] and the Sun's apparent semi-diameter [rad] for the date, from the
// same mean-anomaly series as SunPosition with orbital eccentricity 0.01670862 solved through
// Kepler's equation. The semi-diameter runs 0.00472 rad at perihelion to 0.00466 rad at
// aphelion (975″ to 945″); the mean value 0.0046524 rad is SunDiscProfile's default.
[[nodiscard]] double SolarDistanceAu(double Julian) noexcept;
[[nodiscard]] double SolarAngularRadiusRad(double Julian) noexcept;

// Unit vector toward the sun in a local frame: X = east, Y = north, Z = up.
[[nodiscard]] SpatialVector SunDirectionLocal(const SolarPosition& Position) noexcept;

enum class DayPhase : uint8_t
{
    Day,               // sun above -0.833 deg
    CivilTwilight,     // -6 .. -0.833
    NauticalTwilight,  // -12 .. -6
    AstronomicalTwilight, // -18 .. -12
    Night              // below -18
};

[[nodiscard]] DayPhase ClassifyDayPhase(double SolarElevationRad) noexcept;
[[nodiscard]] const char* DayPhaseName(DayPhase Phase) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                            MOON
//------------------------------------------------------------------------------------------------------------------------

struct LunarPhase
{
    double AgeDays = 0.0;        // [days] since new moon, [0, synodic)
    double Illumination = 0.0;   // [-] lit fraction of the disc, [0, 1]
};

inline constexpr double SynodicMonthDays = 29.530588853;
inline constexpr double NewMoonEpochJulian = 2451550.26;   // 2000-01-06 ~18:14 UTC

[[nodiscard]] LunarPhase MoonPhase(double Julian) noexcept;

// Observer–Moon distance [km] and apparent lunar semi-diameter [rad] for the date (Meeus
// chapter 47 main distance terms). The semi-diameter runs about 0.00487 rad at perigee to
// 0.00427 rad at apogee around a 0.00452 rad mean (1737.4 km lunar radius).
[[nodiscard]] double LunarDistanceKm(double Julian) noexcept;
[[nodiscard]] double LunarAngularRadiusRad(double Julian) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                       LUNAR SURFACE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Measured lunar albedo (EngineContent/CelestialMaps, JPL/USGS-derived mosaic; provenance in
//    MoonAlbedoProvenance.md). Equirectangular: U = (selenographic east longitude + π)/2π — Mare
//    Crisium at +59° east — V = (π/2 − latitude)/π. The demonstration tree carries no lunar texture,
//    so this replaces procedural-noise maria with the measured surface. Values are map albedo in
//    [0, 1] per channel (source byte / 255). The source photograph is exposure-scaled, not an
//    absolute albedo: its disc mean is 0.534, so EvaluateLunarDiscRadiance applies
//    LunarAlbedoCalibration (0.12 / 0.534 = 0.225) to place the full disc at the measured
//    lunar visual geometric albedo 0.12 (NASA Moon Fact Sheet).
class LunarAlbedoMap
{
  public:
    // Binary PPM (P6, max 255). Returns false and stays empty when the file is absent or malformed.
    bool LoadPpm(const char* Path);

    [[nodiscard]] SpectrumRgb Sample(double LongitudeEastRad, double LatitudeRad) const noexcept;
    [[nodiscard]] bool        Loaded() const noexcept { return !Values_.empty(); }
    [[nodiscard]] uint32_t    Width() const noexcept { return Width_; }
    [[nodiscard]] uint32_t    Height() const noexcept { return Height_; }

  private:
    std::vector<SpectrumRgb> Values_;   // [row][column], row 0 = north pole
    uint32_t                 Width_  = 0;
    uint32_t                 Height_ = 0;
};

// Lunar disc radiance at disc coordinates (DiscA, DiscB) in units of the apparent radius, measured
// along the projected selenographic axes: DiscA toward projected lunar east (the Mare Crisium
// side), DiscB toward projected lunar north. The caller rotates camera disc coordinates into this
// frame with its pole orientation, and supplies the sub-observer point (optical libration): the
// selenographic longitude/latitude facing the observer. Sampling is the exact orthographic
// inverse about that point. Shading is the Lommel–Seeliger law 2μ₀/(μ₀+μ), which is why a full
// Moon photographs flat with no limb darkening, times an empirical shadow-hiding phase dimming
// exp(−1.10·|g|) (quarter surface brightness ≈ 0.18 of full, matching the observed −12.7 vs −10.0
// magnitudes once the lit fraction is accounted). EarthshineStrength is an absolute radiance scale
// for the earthlit dark side, tinted blue-grey. The caller multiplies by atmospheric transmittance
// toward the Moon. Zero outside the disc.
[[nodiscard]] SpectrumRgb EvaluateLunarDiscRadiance(const LunarAlbedoMap& Map,
                                                    double                DiscA,
                                                    double                DiscB,
                                                    double                SubObserverLongitudeRad,
                                                    double                SubObserverLatitudeRad,
                                                    double                CosIncidence,
                                                    double                CosEmission,
                                                    double                PhaseAngleRad,
                                                    const SpectrumRgb&    SolarIrradiance,
                                                    double                EarthshineStrength) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                            STARS
//------------------------------------------------------------------------------------------------------------------------

struct StarRecord
{
    SpatialVector Direction{};   // unit vector (equatorial-ish frame; caller rotates)
    double        Magnitude = 0.0;   // [mag] lower is brighter
    double        ColourIndex = 0.0; // [-] blue (-1) .. red (+1), deterministic per star
};

// Deterministic catalogue: uniform sphere directions, magnitudes from a power law on the seed stream.
[[nodiscard]] std::vector<StarRecord> GenerateStarCatalogue(uint32_t Count, uint64_t Seed);

} // namespace Frontier
