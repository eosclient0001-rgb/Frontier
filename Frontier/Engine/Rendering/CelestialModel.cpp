/*==========================================================================================================================================
                                                   CELESTIAL MODEL DEFINITION
==========================================================================================================================================*/

#include "CelestialModel.h"

#include "Engine/Foundation/DeterministicRandom.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace Frontier
{

namespace
{

constexpr double Pi = 3.14159265358979323846;
constexpr double DegToRad = Pi / 180.0;

double WrapDegrees(double Degrees) noexcept
{
    Degrees = std::fmod(Degrees, 360.0);
    return Degrees < 0.0 ? Degrees + 360.0 : Degrees;
}
double WrapPi(double Radians) noexcept
{
    while (Radians > Pi) Radians -= 2.0 * Pi;
    while (Radians < -Pi) Radians += 2.0 * Pi;
    return Radians;
}

} // namespace

double JulianDate(int Year, unsigned Month, unsigned Day, double UtcHours) noexcept
{
    const int A = (14 - static_cast<int>(Month)) / 12;
    const int Y = Year + 4800 - A;
    const int M = static_cast<int>(Month) + 12 * A - 3;
    const long JDN = static_cast<long>(Day) + (153L * M + 2) / 5 + 365L * Y + Y / 4 - Y / 100 + Y / 400 - 32045;
    return static_cast<double>(JDN) + (UtcHours - 12.0) / 24.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                            SUN
//------------------------------------------------------------------------------------------------------------------------

SolarPosition SunPosition(double Julian, double LatitudeDeg, double LongitudeDeg) noexcept
{
    const double N = Julian - 2451545.0;   // days since J2000.0

    const double MeanLongitude = WrapDegrees(280.460 + 0.9856474 * N);
    const double MeanAnomaly   = WrapDegrees(357.528 + 0.9856003 * N) * DegToRad;
    const double EclipticLongitude =
        (MeanLongitude + 1.915 * std::sin(MeanAnomaly) + 0.020 * std::sin(2.0 * MeanAnomaly)) * DegToRad;
    const double Obliquity = (23.439 - 0.0000004 * N) * DegToRad;

    const double Declination = std::asin(std::sin(Obliquity) * std::sin(EclipticLongitude));
    const double RightAscension = std::atan2(std::cos(Obliquity) * std::sin(EclipticLongitude),
                                             std::cos(EclipticLongitude));

    // Greenwich mean sidereal time (hours) -> local hour angle.
    double GmstHours = 18.697374558 + 24.06570982441908 * N;
    GmstHours = std::fmod(GmstHours, 24.0);
    if (GmstHours < 0.0) GmstHours += 24.0;
    const double LocalSiderealRad = (GmstHours * 15.0 + LongitudeDeg) * DegToRad;
    const double HourAngle = WrapPi(LocalSiderealRad - RightAscension);

    const double Latitude = LatitudeDeg * DegToRad;
    const double SinElevation = std::sin(Declination) * std::sin(Latitude) +
                                std::cos(Declination) * std::cos(Latitude) * std::cos(HourAngle);
    const double Elevation = std::asin(std::clamp(SinElevation, -1.0, 1.0));
    const double Azimuth = std::atan2(std::sin(HourAngle),
                                      std::cos(HourAngle) * std::sin(Latitude) -
                                          std::tan(Declination) * std::cos(Latitude)) + Pi;   // from north, clockwise

    SolarPosition Result;
    Result.ElevationRad   = Elevation;
    Result.AzimuthRad     = std::fmod(Azimuth, 2.0 * Pi);
    Result.DeclinationRad = Declination;
    return Result;
}

SpatialVector SunDirectionLocal(const SolarPosition& Position) noexcept
{
    const double CosEl = std::cos(Position.ElevationRad);
    // Azimuth clockwise from north: east = sin(az), north = cos(az).
    return {CosEl * std::sin(Position.AzimuthRad), CosEl * std::cos(Position.AzimuthRad),
            std::sin(Position.ElevationRad)};
}

DayPhase ClassifyDayPhase(double SolarElevationRad) noexcept
{
    const double Deg = SolarElevationRad / DegToRad;
    if (Deg > -0.833) return DayPhase::Day;
    if (Deg > -6.0) return DayPhase::CivilTwilight;
    if (Deg > -12.0) return DayPhase::NauticalTwilight;
    if (Deg > -18.0) return DayPhase::AstronomicalTwilight;
    return DayPhase::Night;
}

const char* DayPhaseName(DayPhase Phase) noexcept
{
    switch (Phase)
    {
        case DayPhase::Day: return "Day";
        case DayPhase::CivilTwilight: return "CivilTwilight";
        case DayPhase::NauticalTwilight: return "NauticalTwilight";
        case DayPhase::AstronomicalTwilight: return "AstronomicalTwilight";
        case DayPhase::Night: return "Night";
    }
    return "Night";
}

//------------------------------------------------------------------------------------------------------------------------
//                                                            MOON
//------------------------------------------------------------------------------------------------------------------------

LunarPhase MoonPhase(double Julian) noexcept
{
    double Age = std::fmod(Julian - NewMoonEpochJulian, SynodicMonthDays);
    if (Age < 0.0) Age += SynodicMonthDays;
    const double PhaseAngle = 2.0 * Pi * Age / SynodicMonthDays;
    LunarPhase Result;
    Result.AgeDays      = Age;
    Result.Illumination = 0.5 * (1.0 - std::cos(PhaseAngle));
    return Result;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       LUNAR SURFACE
//------------------------------------------------------------------------------------------------------------------------

bool LunarAlbedoMap::LoadPpm(const char* Path)
{
    Values_.clear();
    Width_ = Height_ = 0;
    FILE* File = Path != nullptr ? std::fopen(Path, "rb") : nullptr;
    if (File == nullptr)
    {
        return false;
    }
    // 📝 P6 header: magic, width, height, maximum, one whitespace byte, then binary RGB triplets.
    //    Header tokens may be separated by whitespace and #-comments; fields are read one byte at a
    //    time so the binary payload offset is exact on every platform.
    auto NextToken = [&File](char* Buffer, size_t Capacity) -> bool {
        int Byte = std::fgetc(File);
        while (Byte != EOF)
        {
            if (Byte == '#')
            {
                while (Byte != EOF && Byte != '\n') Byte = std::fgetc(File);
            }
            else if (Byte == ' ' || Byte == '\t' || Byte == '\r' || Byte == '\n')
            {
                Byte = std::fgetc(File);
            }
            else
            {
                break;
            }
        }
        size_t Count = 0;
        while (Byte != EOF && Byte != ' ' && Byte != '\t' && Byte != '\r' && Byte != '\n' && Count + 1 < Capacity)
        {
            Buffer[Count++] = static_cast<char>(Byte);
            Byte = std::fgetc(File);
        }
        Buffer[Count] = '\0';
        return Count > 0;
    };
    char   Token[32] = {};
    double Maximum   = 0.0;
    bool   HeaderOk  = NextToken(Token, sizeof Token) && std::strcmp(Token, "P6") == 0;
    if (HeaderOk && NextToken(Token, sizeof Token)) Width_ = static_cast<uint32_t>(std::strtoul(Token, nullptr, 10));
    if (HeaderOk && NextToken(Token, sizeof Token)) Height_ = static_cast<uint32_t>(std::strtoul(Token, nullptr, 10));
    if (HeaderOk && NextToken(Token, sizeof Token)) Maximum = std::strtod(Token, nullptr);
    HeaderOk = HeaderOk && Width_ >= 4 && Height_ >= 2 && Maximum >= 1.0 && Maximum <= 255.0;
    // ⚠️ NextToken leaves the stream just past the maximum token's single terminating whitespace,
    //    which is exactly where the binary payload begins; do not consume another byte here.
    if (!HeaderOk)
    {
        std::fclose(File);
        Width_ = Height_ = 0;
        return false;
    }
    std::vector<unsigned char> Bytes(static_cast<size_t>(Width_) * Height_ * 3u);
    const size_t               Read = std::fread(Bytes.data(), 1, Bytes.size(), File);
    std::fclose(File);
    if (Read != Bytes.size())
    {
        Width_ = Height_ = 0;
        return false;
    }
    Values_.resize(static_cast<size_t>(Width_) * Height_);
    const double Scale = 1.0 / Maximum;
    const auto DecodeSrgb = [Scale](unsigned char Byte) noexcept
    {
        const double Encoded = Byte * Scale;
        return Encoded <= 0.04045 ? Encoded / 12.92 : std::pow((Encoded + 0.055) / 1.055, 2.4);
    };
    for (size_t I = 0; I < Values_.size(); ++I)
    {
        Values_[I] = {DecodeSrgb(Bytes[3 * I]), DecodeSrgb(Bytes[3 * I + 1]), DecodeSrgb(Bytes[3 * I + 2])};
    }
    return true;
}

SpectrumRgb LunarAlbedoMap::Sample(double LongitudeEastRad, double LatitudeRad) const noexcept
{
    if (Values_.empty())
    {
        return {0.55, 0.54, 0.52};   // [-] featureless fallback; callers gate on Loaded() for evidence
    }
    double U = (LongitudeEastRad + Pi) / (2.0 * Pi);
    U -= std::floor(U);   // longitude wraps at the antimeridian
    const double V = std::clamp((0.5 * Pi - LatitudeRad) / Pi, 0.0, 1.0);
    const double X = U * static_cast<double>(Width_) - 0.5;
    const double Y = V * static_cast<double>(Height_) - 0.5;
    const long   X0 = static_cast<long>(std::floor(X));
    const long   Y0 = static_cast<long>(std::floor(Y));
    const double Fx = X - static_cast<double>(X0);
    const double Fy = Y - static_cast<double>(Y0);
    const auto   At = [this](long Column, long Row) noexcept {
        const long WrappedColumn = ((Column % static_cast<long>(Width_)) + static_cast<long>(Width_)) %
                                   static_cast<long>(Width_);
        const long ClampedRow = Row < 0 ? 0 : (Row >= static_cast<long>(Height_) ? static_cast<long>(Height_) - 1 : Row);
        return Values_[static_cast<size_t>(ClampedRow) * Width_ + static_cast<size_t>(WrappedColumn)];
    };
    const SpectrumRgb Top{At(X0, Y0).R * (1.0 - Fx) + At(X0 + 1, Y0).R * Fx,
                          At(X0, Y0).G * (1.0 - Fx) + At(X0 + 1, Y0).G * Fx,
                          At(X0, Y0).B * (1.0 - Fx) + At(X0 + 1, Y0).B * Fx};
    const SpectrumRgb Bottom{At(X0, Y0 + 1).R * (1.0 - Fx) + At(X0 + 1, Y0 + 1).R * Fx,
                             At(X0, Y0 + 1).G * (1.0 - Fx) + At(X0 + 1, Y0 + 1).G * Fx,
                             At(X0, Y0 + 1).B * (1.0 - Fx) + At(X0 + 1, Y0 + 1).B * Fx};
    return {Top.R * (1.0 - Fy) + Bottom.R * Fy, Top.G * (1.0 - Fy) + Bottom.G * Fy,
            Top.B * (1.0 - Fy) + Bottom.B * Fy};
}

SpectrumRgb EvaluateLunarDiscRadiance(const LunarAlbedoMap& Map,
                                      double                DiscA,
                                      double                DiscB,
                                      double                SubObserverLongitudeRad,
                                      double                SubObserverLatitudeRad,
                                      double                CosIncidence,
                                      double                CosEmission,
                                      double                PhaseAngleRad,
                                      const SpectrumRgb&    SolarIrradiance,
                                      double                EarthshineStrength) noexcept
{
    const double RadiusSquared = DiscA * DiscA + DiscB * DiscB;
    if (RadiusSquared > 1.0)
    {
        return {};
    }
    // 📐 Orthographic inverse about the sub-observer point (λ₀, φ₀). With sin c = ρ (disc-normalised
    //    radius) and cos c = √(1−ρ²): sin φ = cos c·sin φ₀ + B·cos φ₀ and
    //    λ = λ₀ + atan2(A, cos c·cos φ₀ − B·sin φ₀). At λ₀ = φ₀ = 0 these reduce to the familiar
    //    φ = asin(B), λ = atan2(A, √(1−A²−B²)) with DiscA toward selenographic east.
    const double      TowardObserver = std::sqrt(1.0 - RadiusSquared);
    const double      SinLat0        = std::sin(SubObserverLatitudeRad);
    const double      CosLat0        = std::cos(SubObserverLatitudeRad);
    const double      LatitudeRad    = std::asin(std::clamp(TowardObserver * SinLat0 + DiscB * CosLat0, -1.0, 1.0));
    const double      LongitudeRad   = SubObserverLongitudeRad +
                                       std::atan2(DiscA, TowardObserver * CosLat0 - DiscB * SinLat0);
    const SpectrumRgb Albedo         = Map.Sample(LongitudeRad, LatitudeRad);
    const double      Mu0            = CosIncidence > 0.0 ? CosIncidence : 0.0;
    const double      Mu             = CosEmission > 1.0e-4 ? CosEmission : 1.0e-4;
    // 📐 Lommel–Seeliger: at full phase μ₀ = μ everywhere, so the factor is 1 across the whole disc —
    //    the flat, limb-darkening-free full Moon. The exponential is the shadow-hiding phase law.
    const double LommelSeeliger = Mu0 > 0.0 ? 2.0 * Mu0 / (Mu0 + Mu) : 0.0;
    const double PhaseDimming   = std::exp(-1.10 * std::abs(PhaseAngleRad));
    const double LitScale       = LommelSeeliger * PhaseDimming / Pi;
    return {Albedo.R * (SolarIrradiance.R * LitScale + EarthshineStrength * 0.55),
            Albedo.G * (SolarIrradiance.G * LitScale + EarthshineStrength * 0.65),
            Albedo.B * (SolarIrradiance.B * LitScale + EarthshineStrength * 1.00)};
}

//------------------------------------------------------------------------------------------------------------------------
//                                                            STARS
//------------------------------------------------------------------------------------------------------------------------

std::vector<StarRecord> GenerateStarCatalogue(uint32_t Count, uint64_t Seed)
{
    std::vector<StarRecord> Stars;
    Stars.reserve(Count);
    DeterministicRandom Random(Seed, 0x57A2ull);
    for (uint32_t I = 0; I < Count; ++I)
    {
        // Uniform sphere: z uniform in [-1, 1], azimuth uniform.
        const double Z     = 2.0 * Random.NextUnit() - 1.0;
        const double Phi   = 2.0 * Pi * Random.NextUnit();
        const double R     = std::sqrt(std::max(1.0 - Z * Z, 0.0));
        StarRecord   Star;
        Star.Direction = {R * std::cos(Phi), R * std::sin(Phi), Z};
        // Power-law magnitudes: many faint, few bright (mag in [-1, 6], mean ~3.8).
        Star.Magnitude   = -1.0 + 7.0 * std::pow(Random.NextUnit(), 0.45);
        Star.ColourIndex = 2.0 * Random.NextUnit() - 1.0;
        Stars.push_back(Star);
    }
    return Stars;
}

} // namespace Frontier
