/*============================================================================================================================================
                                                            CELESTIALSCENE.H
============================================================================================================================================*/
// 🧩 Reuse the engine's atmosphere coefficients, lunar texture/ephemeris, Hipparcos rotation and finite-source solar optics.

#pragma once
#include "Frontier/Engine/Rendering/CelestialModel.h"
#include "Frontier/Engine/Rendering/SolarOpticsPayload.h"
#include "CelestialLens.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace Frontier::CelestialAtmosphereExperiment
{

//------------------------------------------------------------------------------------------------------------------------
//                                                 PROJECTION / FLOAT32 FOOTPRINTS
//------------------------------------------------------------------------------------------------------------------------

inline constexpr double   π            = 3.14159265358979323846;
inline constexpr double   Radians      = π / 180;
inline constexpr unsigned CaptureWidth = 480, CaptureHeight = 270;
using Float4 = std::array<float, 4>;
using Vector = SpatialVector;

inline Vector operator+(Vector A, Vector B)
{
    return {A.X + B.X, A.Y + B.Y, A.Z + B.Z};
}
inline Vector operator-(Vector A, Vector B)
{
    return {A.X - B.X, A.Y - B.Y, A.Z - B.Z};
}
inline Vector operator*(Vector A, double Scale)
{
    return {A.X * Scale, A.Y * Scale, A.Z * Scale};
}
inline double Dot(Vector A, Vector B)
{
    return A.X * B.X + A.Y * B.Y + A.Z * B.Z;
}
inline double Length(Vector A)
{
    return std::sqrt(Dot(A, A));
}
inline Vector Unit(Vector A)
{
    return A * (1 / std::max(1e-30, Length(A)));
}
inline Vector Cross(Vector A, Vector B)
{
    return {A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X};
}
inline Float4 Encode(Vector A, double Fourth = 0)
{
    return {float(A.X), float(A.Y), float(A.Z), float(Fourth)};
}
inline Float4 Encode(SpectrumRgb A, double Fourth = 0)
{
    return {float(A.R), float(A.G), float(A.B), float(Fourth)};
}
inline Vector Decode(Float4 A)
{
    return {A[0], A[1], A[2]};
}
inline void Enforce(bool Condition, const std::string& Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

struct alignas(16) StellarSource
{
    Float4 DirectionMagnitude{};
    Float4 ColourIndex{};
    Float4 ProjectionFlux{};
};
static_assert(sizeof(StellarSource) == 48 && offsetof(StellarSource, ColourIndex) == 16 &&
              offsetof(StellarSource, ProjectionFlux) == 32);

struct CameraProjection
{
    Vector Position{0, 0, 6360.1};
    Vector Forward{1, 0, 0}, Right{0, -1, 0}, Up{0, 0, 1};
    double Tangent = std::tan(28 * Radians);
    double Aspect  = double(CaptureWidth) / CaptureHeight;

    void Orient(Vector Toward, double VerticalDegrees)
    {
        Forward = Unit(Toward);
        Right   = Unit(Cross(Forward, std::abs(Forward.Z) < .999 ? Vector{0, 0, 1} : Vector{0, 1, 0}));
        Up      = Unit(Cross(Right, Forward));
        Tangent = std::tan(.5 * VerticalDegrees * Radians);
    }
    Vector Ray(double X, double Y, unsigned Width = CaptureWidth, unsigned Height = CaptureHeight) const
    {
        return Unit(Forward + Right * ((2 * X / Width - 1) * Tangent * Aspect) + Up * ((1 - 2 * Y / Height) * Tangent));
    }
    std::array<double, 2>
    Project(Vector Direction, unsigned Width = CaptureWidth, unsigned Height = CaptureHeight) const
    {
        const double Depth = Dot(Direction, Forward);
        return {(.5 + .5 * Dot(Direction, Right) / (Depth * Tangent * Aspect)) * Width,
                (.5 - .5 * Dot(Direction, Up) / (Depth * Tangent)) * Height};
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                               FIXED UNITS / REUSED ENGINE INPUTS
//------------------------------------------------------------------------------------------------------------------------

struct CelestialScene
{
    AtmosphereParameters    Atmosphere{};
    CameraProjection        Camera{};
    SolarOpticsParameters   Solar{};
    std::array<Float4, 64>  Configuration{};
    std::vector<StarRecord> Catalogue, ReferenceBrightCatalogue, AuthoredCatalogue;
    StarFilterProfile       StarFilter{};
    double                  Julian   = JulianDate(2026, 11, 18, 20);
    double                  Latitude = -26.1885, Longitude = 28.3209;
    Vector                  MoonDirection{.3, .4, .8660254}, MoonNorth{0, 0, 1};
    double                  MoonRadius = .004596, Exposure = 50;

    CelestialScene()
    {
        Solar.SunDirection        = Unit({1, 0, .3});
        Solar.DiscIrradiance      = {1, 1, 1};
        Solar.Disc.EdgeBlurRad    = .000035;
        Solar.Flare.GhostStrength = Solar.Flare.StarburstStrength = Solar.Flare.AnamorphicStrength = 0;
        Solar.Flare.HaloStrength = Solar.Flare.VeilingStrength = Solar.Flare.GlowStrength = 0;
        Solar.PlanetHorizonZ                                                              = -1;
        Configuration[10]                                                                 = {1, 0, 1, 0};
        Configuration[11]                                                                 = {0, 0, 1, 1};
        Configuration[14]                                                                 = {0, 0, 0, 1};
        Configuration[18] = {2.1e-17f, 5e-17f, 1.22e-16f, 50};
        Configuration[19] = {1737.4f, 300, 1, 1.10f};
        Configuration[20] = {695700, 1, 8, 2000};
        Configuration[21] = {1, 1, 0, .000035f};
        Configuration[22] = {2048, 1024, 1024, 512};
        Configuration[24] = {0, .75f, 0, 96};
        Configuration[25] = {-.0548755604f, -.8734370902f, -.4838350155f, 0};
        Configuration[26] = {.4941094279f, -.4448296300f, .7469822445f, 0};
        Configuration[27] = {-.8676661490f, -.1980763734f, .4559837762f, 0};
        Configuration[28] = {.08f, .095f, .11f, 0};
        Configuration[29] = {1, 0, 0, 0};
        Configuration[30] = {float(std::pow(10., -.4 * 26.74)), 0, 0, 0};
        Configuration[34] = {1, 1, 0, 0};
    }

    void LoadAuthoredCatalogue(const std::filesystem::path& Location)
    {
        std::ifstream Input(Location);
        Enforce(bool(Input), "Pinned authored reference field is required, not an invented catalogue expansion");
        std::string Header, Line;
        std::getline(Input, Header);
        Enforce(Header == "id,ra_deg,dec_deg,mag,bv,authored", "Unexpected pinned upstream catalogue columns");
        std::ostringstream Deep, Bright;
        Deep << "id,ra_deg,dec_deg,mag,bv\n";
        Bright << "id,ra_deg,dec_deg,mag,bv\n";
        unsigned BrightCount = 0, DeepCount = 0;
        while (std::getline(Input, Line))
        {
            const auto Classification = Line.rfind(',');
            Enforce(Classification != std::string::npos, "Authored field row lacks provenance classification");
            if (Line.substr(Classification + 1) == "1")
            {
                Deep << Line.substr(0, Classification) << '\n';
                ++DeepCount;
            }
            else
            {
                Bright << Line.substr(0, Classification) << '\n';
                ++BrightCount;
            }
        }
        std::istringstream Encoded(Deep.str()), EncodedBright(Bright.str());
        AuthoredCatalogue        = DecodeHipparcosCatalogue(Encoded, Julian, Latitude, Longitude);
        ReferenceBrightCatalogue = DecodeHipparcosCatalogue(EncodedBright, Julian, Latitude, Longitude);
        Enforce(BrightCount == 156 && DeepCount == 15200 && AuthoredCatalogue.size() == DeepCount,
                "Pinned reference star field is incomplete");
        // 📝 The requested 156 bright + 15,200 authored field is selectable, not stacked over Hipparcos duplicates.
        // The original 41,359-row measured catalogue remains separate and unmodified for astrometric validation.
    }

    void LoadCatalogue(const std::filesystem::path& Location)
    {
        std::ifstream Input(Location);
        Enforce(bool(Input), "Hipparcos catalogue is required, not a synthetic substitute");
        Catalogue = DecodeHipparcosCatalogue(Input, Julian, Latitude, Longitude);
        Enforce(Catalogue.size() > 40000, "Hipparcos catalogue is incomplete");
        std::istringstream Basis("id,ra_deg,dec_deg,mag,bv\n1,0,0,0,0\n2,90,0,0,0\n3,0,90,0,0\n");
        const auto         Axes = DecodeHipparcosCatalogue(Basis, Julian, Latitude, Longitude);
        Enforce(Axes.size() == 3, "Equatorial rotation basis missing");
        for (unsigned Axis = 0; Axis < 3; ++Axis)
            Configuration[15 + Axis] = Encode(Axes[Axis].Direction);
        const double Terrestrial = Julian + 69.184 / 86400;
        const auto   Geocentric  = MoonGeocentric(Terrestrial);
        const auto   Moon        = MoonTopocentric(Geocentric, Julian, Latitude, Longitude, 1640);
        MoonDirection            = Moon.Direction;
        MoonRadius               = Moon.AngularRadiusRad;
        // 📝 Meeus ch.53 optical libration of the retained map. Physical libration and its small
        // topocentric correction remain outside this visual approximation.
        const double Centuries   = (Terrestrial - 2451545) / 36525;
        const double Ascending   = (125.0445479 - 1934.1362891 * Centuries) * Radians;
        const double Inclination = 1.54242 * Radians;
        const double Relative    = Geocentric.LongitudeRad - Ascending;
        const double Projection =
            std::atan2(std::sin(Relative) * std::cos(Geocentric.LatitudeRad) * std::cos(Inclination) -
                           std::sin(Geocentric.LatitudeRad) * std::sin(Inclination),
                       std::cos(Relative) * std::cos(Geocentric.LatitudeRad));
        Configuration[14][0] = float(std::remainder(Geocentric.ArgumentLatitudeRad - Projection, 2 * π));
        Configuration[14][1] =
            float(std::asin(-std::sin(Relative) * std::cos(Geocentric.LatitudeRad) * std::sin(Inclination) -
                            std::sin(Geocentric.LatitudeRad) * std::cos(Inclination)));
        std::istringstream Pole("id,ra_deg,dec_deg,mag,bv\n1,273.85,66.54,0,0\n");
        MoonNorth = DecodeHipparcosCatalogue(Pole, Julian, Latitude, Longitude)[0].Direction;
    }

    std::vector<float> Compile() const
    {
        auto C = Configuration;
        C[0]   = Encode(Camera.Position);
        C[1]   = Encode(Camera.Forward, Camera.Tangent);
        C[2]   = Encode(Camera.Right, Camera.Aspect);
        C[3]   = Encode(Camera.Up, Exposure);
        C[4]   = Encode(Solar.SunDirection, Solar.Disc.AngularRadiusRad);
        C[5]   = Encode(Solar.DiscIrradiance, 1);
        C[6]   = Encode(Atmosphere.RayleighScattering, Atmosphere.RayleighScaleHeightKm);
        C[7]   = {float(Atmosphere.MieScattering),
                  float(Atmosphere.MieAbsorption),
                  float(Atmosphere.MieScaleHeightKm),
                  float(Atmosphere.MiePhaseG)};
        C[8]   = Encode(Atmosphere.OzoneAbsorption, Atmosphere.OzonePeakKm);
        C[9]   = {float(Atmosphere.GroundRadiusKm),
                  float(Atmosphere.TopRadiusKm),
                  float(Atmosphere.OzoneWidthKm),
                  float(Atmosphere.GroundAlbedo)};
        C[12]  = Encode(MoonDirection, MoonRadius);
        C[13]  = Encode(MoonNorth, Configuration[13][3]);
        std::vector<float> Result(304, 0);
        for (unsigned Entry = 0; Entry < C.size(); ++Entry)
            std::copy(C[Entry].begin(), C[Entry].end(), Result.begin() + Entry * 4);
        C[31] = {float(Solar.Flare.AnamorphicStrength),
                 float(StarFilter.Strength),
                 float(Solar.Flare.AnamorphicAngleRad),
                 float(Solar.Flare.AnamorphicLengthNdc)};
        C[32] = {float(Solar.Flare.AnamorphicThicknessNdc),
                 float(StarFilter.RotationRad),
                 float(StarFilter.ReachNdc),
                 float(StarFilter.WidthNdc)};
        for (unsigned Entry : {31u, 32u})
            std::copy(C[Entry].begin(), C[Entry].end(), Result.begin() + Entry * 4);
        auto Optics = Solar;
        if (Configuration[33][0] < .5) Optics.Flare.AnamorphicStrength = 0;
        const auto Payload = CompileSolarOpticsPayload(Optics);
        Result.insert(Result.end(), Payload.begin(), Payload.end());
        return Result;
    }

    std::vector<StellarSource>
    ProjectCatalogue(std::vector<unsigned>& Bins, unsigned Width = CaptureWidth, unsigned Height = CaptureHeight) const
    {
        const unsigned                     Columns = (Width + 15) / 16, Rows = (Height + 15) / 16;
        std::vector<std::vector<unsigned>> Tiles(Columns * Rows);
        std::vector<StellarSource>         Sources;
        const bool                         RevisedPsf = Configuration[34][1] > .5;
        const int                          Reach      = RevisedPsf ? 12 : 6;
        const auto&       VisibleBrightCatalogue = Configuration[34][0] > .5 ? ReferenceBrightCatalogue : Catalogue;
        const std::size_t MeasuredCount          = VisibleBrightCatalogue.size();
        const std::size_t AuthoredCount          = Configuration[34][0] > .5 ? AuthoredCatalogue.size() : 0;
        for (std::size_t Ordinal = 0; Ordinal < MeasuredCount + AuthoredCount; ++Ordinal)
        {
            const auto& Star =
                Ordinal < MeasuredCount ? VisibleBrightCatalogue[Ordinal] : AuthoredCatalogue[Ordinal - MeasuredCount];
            const auto Pixel = Camera.Project(Star.Direction, Width, Height);
            if (Dot(Star.Direction, Camera.Forward) <= 0 || Pixel[0] < -Reach || Pixel[1] < -Reach ||
                Pixel[0] > Width + Reach || Pixel[1] > Height + Reach)
                continue;
            const unsigned Index = unsigned(Sources.size());
            Sources.push_back({Encode(Star.Direction, Star.Magnitude),
                               {0, 0, 0, float(Star.ColourIndex)},
                               {float(Pixel[0]), float(Pixel[1]), 0, float(Ordinal >= MeasuredCount)}});
            const int LowX  = std::max(0, int(std::floor((Pixel[0] - Reach - 1) / 16)));
            const int LowY  = std::max(0, int(std::floor((Pixel[1] - Reach - 1) / 16)));
            const int HighX = std::min(int(Columns) - 1, int(std::floor((Pixel[0] + Reach + 1) / 16)));
            const int HighY = std::min(int(Rows) - 1, int(std::floor((Pixel[1] + Reach + 1) / 16)));
            for (int Y = LowY; Y <= HighY; ++Y)
                for (int X = LowX; X <= HighX; ++X)
                    Tiles[unsigned(Y) * Columns + unsigned(X)].push_back(Index);
        }
        Bins.assign(Columns * Rows + 1, 0);
        unsigned Offset = unsigned(Bins.size());
        for (unsigned Tile = 0; Tile < Tiles.size(); ++Tile)
        {
            Bins[Tile] = Offset;
            Bins.insert(Bins.end(), Tiles[Tile].begin(), Tiles[Tile].end());
            Offset += unsigned(Tiles[Tile].size());
        }
        Bins[Columns * Rows] = Offset;
        return Sources;
    }
};

} // namespace Frontier::CelestialAtmosphereExperiment
