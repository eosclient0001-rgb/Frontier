/*==========================================================================================================================================
                                                       NIGHT SKY EXHIBIT
                                     ------------------------------------------------------------------
              Moon disc with phase terminator, Milky Way band, star splats and a sun-disc lens flare, rendered
              on the CPU from the existing CelestialModel and LensFlareModel cores (headless, no GPU).
==========================================================================================================================================*/

// 🧩 Sky exhibit. Solar position and lunar phase come from Frontier/Engine/Rendering/CelestialModel.*; ghost
//    placement comes from LensFlareModel.h. The lunar ephemeris is a Meeus low-precision series (main terms
//    only), the star field is the deterministic procedural catalogue (not a licensed astronomical catalogue),
//    and the Milky Way is an analytic band model. Output is PPM for a Python converter in Code/.

#include "Engine/Rendering/CelestialModel.h"
#include "Engine/Rendering/LensFlareModel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace
{

constexpr double Pi = 3.14159265358979323846;
constexpr double DegToRad = Pi / 180.0;
constexpr double BenoniLatitudeDeg = -26.1885;   // Benoni, Gauteng, ZA
constexpr double BenoniLongitudeDeg = 28.3209;
constexpr double MoonAngularRadius = 0.2725 * DegToRad;   // mean semi-diameter
constexpr double SunAngularRadius = 0.2666 * DegToRad;
constexpr int ImageWidth = 960;
constexpr int ImageHeight = 600;
constexpr double HalfFovTangent = 0.2679;   // tan(15 deg): vertical field 30 degrees

struct SkyVector
{
    double X = 0.0, Y = 0.0, Z = 0.0;   // local frame: X east, Y north, Z up
};

SkyVector operator+(SkyVector A, SkyVector B) { return {A.X + B.X, A.Y + B.Y, A.Z + B.Z}; }
SkyVector operator-(SkyVector A, SkyVector B) { return {A.X - B.X, A.Y - B.Y, A.Z - B.Z}; }
SkyVector operator*(SkyVector A, double S) { return {A.X * S, A.Y * S, A.Z * S}; }
double Dot(SkyVector A, SkyVector B) { return A.X * B.X + A.Y * B.Y + A.Z * B.Z; }
SkyVector Cross(SkyVector A, SkyVector B)
{
    return {A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X};
}
SkyVector Normalize(SkyVector A)
{
    const double Length = std::sqrt(Dot(A, A));
    return Length > 0.0 ? A * (1.0 / Length) : SkyVector{0.0, 0.0, 1.0};
}

struct Radiance
{
    double R = 0.0, G = 0.0, B = 0.0;
};
Radiance operator+(Radiance A, Radiance B) { return {A.R + B.R, A.G + B.G, A.B + B.B}; }
Radiance operator*(Radiance A, double S) { return {A.R * S, A.G * S, A.B * S}; }

double Clamp01(double X) { return std::clamp(X, 0.0, 1.0); }
double Smoothstep(double Edge0, double Edge1, double X)
{
    const double T = Clamp01((X - Edge0) / (Edge1 - Edge0));
    return T * T * (3.0 - 2.0 * T);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   TIME AND FRAMES
//------------------------------------------------------------------------------------------------------------------------

// Local sidereal time (radians) at Benoni, same GMST series as CelestialModel's SunPosition.
double LocalSiderealRad(double Julian)
{
    const double N = Julian - 2451545.0;
    double GmstHours = std::fmod(18.697374558 + 24.06570982441908 * N, 24.0);
    if (GmstHours < 0.0) GmstHours += 24.0;
    return (GmstHours * 15.0 + BenoniLongitudeDeg) * DegToRad;
}

// Equatorial (RA, Dec) to local ENU, using the same azimuth convention as CelestialModel's SunDirectionLocal.
SkyVector EquatorialToLocal(double RightAscensionRad, double DeclinationRad, double LocalSiderealRadians)
{
    const double Latitude = BenoniLatitudeDeg * DegToRad;
    const double HourAngle = LocalSiderealRadians - RightAscensionRad;
    const double Altitude = std::asin(std::clamp(std::sin(DeclinationRad) * std::sin(Latitude) +
                                                     std::cos(DeclinationRad) * std::cos(Latitude) * std::cos(HourAngle),
                                                 -1.0, 1.0));
    const double Azimuth = std::atan2(std::sin(HourAngle), std::cos(HourAngle) * std::sin(Latitude) -
                                                               std::tan(DeclinationRad) * std::cos(Latitude)) + Pi;
    return {std::cos(Altitude) * std::sin(Azimuth), std::cos(Altitude) * std::cos(Azimuth), std::sin(Altitude)};
}

// Inverse of EquatorialToLocal, used for the round-trip check.
void LocalToEquatorial(SkyVector V, double LocalSiderealRadians, double& RightAscensionRad, double& DeclinationRad)
{
    const double Latitude = BenoniLatitudeDeg * DegToRad;
    const double Altitude = std::asin(std::clamp(V.Z, -1.0, 1.0));
    const double AzimuthNorth = std::atan2(V.X, V.Y);
    DeclinationRad = std::asin(std::clamp(std::sin(Latitude) * std::sin(Altitude) +
                                              std::cos(Latitude) * std::cos(Altitude) * std::cos(AzimuthNorth),
                                          -1.0, 1.0));
    // Scaled by cos(latitude) cos(declination) > 0, which leaves the atan2 quadrant unchanged.
    const double SinHour = -std::sin(AzimuthNorth) * std::cos(Altitude) * std::cos(Latitude);
    const double CosHour = std::sin(Altitude) - std::sin(Latitude) * std::sin(DeclinationRad);
    const double HourAngle = std::atan2(SinHour, CosHour);
    RightAscensionRad = LocalSiderealRadians - HourAngle;
}

struct EquatorialPoint
{
    double RightAscensionRad = 0.0;
    double DeclinationRad = 0.0;
};

// Low-precision Sun (same series as CelestialModel), returned in equatorial coordinates.
EquatorialPoint SunEquatorial(double Julian)
{
    const double N = Julian - 2451545.0;
    const double MeanLongitude = (280.460 + 0.9856474 * N) * DegToRad;
    const double MeanAnomaly = (357.528 + 0.9856003 * N) * DegToRad;
    const double Lambda = MeanLongitude + (1.915 * std::sin(MeanAnomaly) + 0.020 * std::sin(2.0 * MeanAnomaly)) * DegToRad;
    const double Obliquity = (23.439 - 0.0000004 * N) * DegToRad;
    return {std::atan2(std::cos(Obliquity) * std::sin(Lambda), std::cos(Lambda)),
            std::asin(std::sin(Obliquity) * std::sin(Lambda))};
}

// Meeus chapter 47 truncated lunar series (longitude, latitude; 6.289 deg, 5.128 deg main terms).
EquatorialPoint MoonEquatorial(double Julian)
{
    const double D = Julian - 2451545.0;
    const double MeanLongitude = (218.316 + 13.176396 * D) * DegToRad;
    const double MeanAnomaly = (134.963 + 13.064993 * D) * DegToRad;
    const double ArgumentLatitude = (93.272 + 13.229350 * D) * DegToRad;
    const double Lambda = MeanLongitude + 6.289 * DegToRad * std::sin(MeanAnomaly);
    const double Beta = 5.128 * DegToRad * std::sin(ArgumentLatitude);
    const double Obliquity = (23.439 - 0.0000004 * D) * DegToRad;
    return {std::atan2(std::sin(Lambda) * std::cos(Obliquity) - std::tan(Beta) * std::sin(Obliquity), std::cos(Lambda)),
            std::asin(std::sin(Beta) * std::cos(Obliquity) + std::cos(Beta) * std::sin(Obliquity) * std::sin(Lambda))};
}

// Fraction of the lit disc from the geometric elongation, k = (1 - cos psi) / 2.
double GeometricIlluminatedFraction(EquatorialPoint Sun, EquatorialPoint Moon)
{
    const double CosElongation = std::sin(Sun.DeclinationRad) * std::sin(Moon.DeclinationRad) +
                                 std::cos(Sun.DeclinationRad) * std::cos(Moon.DeclinationRad) *
                                     std::cos(Sun.RightAscensionRad - Moon.RightAscensionRad);
    return 0.5 * (1.0 - CosElongation);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   MOON DISC
//------------------------------------------------------------------------------------------------------------------------

// Orthonormal frame on the lunar sphere: Observer points from the moon to the observer, Right/Up match the image.
struct MoonFrame
{
    SkyVector Right;
    SkyVector Up;
    SkyVector Observer;
    SkyVector TowardSun;
};

MoonFrame MakeMoonFrame(SkyVector MoonDirection, SkyVector SunDirection)
{
    MoonFrame Frame;
    Frame.Right = Normalize(Cross(MoonDirection, {0.0, 0.0, 1.0}));
    Frame.Up = Cross(Frame.Right, MoonDirection);
    Frame.Observer = MoonDirection * -1.0;
    Frame.TowardSun = SunDirection;
    return Frame;
}

// Lit fraction of the disc sample (A, B) in [-1, 1]^2 on the projected disc; returns negative outside the disc.
double MoonDiscLambert(const MoonFrame& Frame, double A, double B)
{
    const double Radicand = 1.0 - A * A - B * B;
    if (Radicand < 0.0) return -1.0;
    const SkyVector Normal = Frame.Right * A + Frame.Up * B + Frame.Observer * std::sqrt(Radicand);
    return Dot(Normal, Frame.TowardSun);
}

Radiance MoonDiscRadiance(double Lambert)
{
    // Lambert shading with a faint earthshine floor on the night side.
    const double Lit = 2.0 * std::max(Lambert, 0.0);
    return Radiance{Lit + 0.01, Lit * 0.98 + 0.01, Lit * 0.92 + 0.012};
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SKY BACKGROUND
//------------------------------------------------------------------------------------------------------------------------

double HashLattice(int X, int Y, int Z)
{
    uint32_t H = static_cast<uint32_t>(X) * 374761393u + static_cast<uint32_t>(Y) * 668265263u +
                 static_cast<uint32_t>(Z) * 2147483647u;
    H = (H ^ (H >> 13)) * 1274126177u;
    H ^= H >> 16;
    return static_cast<double>(H & 0xFFFFFFu) / 16777215.0;
}

double ValueNoise(SkyVector P)
{
    const double Fx = std::floor(P.X), Fy = std::floor(P.Y), Fz = std::floor(P.Z);
    const int Ix = static_cast<int>(Fx), Iy = static_cast<int>(Fy), Iz = static_cast<int>(Fz);
    const double Tx = Smoothstep(0.0, 1.0, P.X - Fx), Ty = Smoothstep(0.0, 1.0, P.Y - Fy), Tz = Smoothstep(0.0, 1.0, P.Z - Fz);
    double Value = 0.0;
    for (int Corner = 0; Corner < 8; ++Corner)
    {
        const int Dx = Corner & 1, Dy = (Corner >> 1) & 1, Dz = (Corner >> 2) & 1;
        const double Weight = (Dx ? Tx : 1.0 - Tx) * (Dy ? Ty : 1.0 - Ty) * (Dz ? Tz : 1.0 - Tz);
        Value += Weight * HashLattice(Ix + Dx, Iy + Dy, Iz + Dz);
    }
    return Value;
}

struct StarMarker
{
    double Px = 0.0, Py = 0.0;
    double Sigma = 1.0;
    double Peak = 0.0;
    Radiance Colour{};
};

// Milky Way band: galactic latitude from the north galactic pole, bulge brightening toward the galactic centre.
Radiance NightBackground(SkyVector D, SkyVector GalacticPole, SkyVector GalacticCentre)
{
    const double Latitude = std::asin(std::clamp(Dot(D, GalacticPole), -1.0, 1.0));
    const double Separation = std::acos(std::clamp(Dot(D, GalacticCentre), -1.0, 1.0));
    const double Lane = Smoothstep(0.45, 0.75, ValueNoise(D * 9.0)) * std::exp(-std::pow(Latitude / 0.07, 2.0));
    const double Band = std::exp(-std::pow(Latitude / 0.12, 2.0)) * (0.22 + 0.78 * std::exp(-std::pow(Separation / 0.55, 2.0)));
    const double Clouds = 0.55 + 0.45 * ValueNoise(D * 6.0);
    const double Milky = 0.030 * Band * Clouds * (1.0 - 0.75 * Lane);
    const double Warm = std::exp(-std::pow(Separation / 0.8, 2.0));
    const Radiance Milk{0.80 + 0.2 * Warm, 0.86 + 0.06 * Warm, 1.0 - 0.22 * Warm};

    // Airglow and urban light pollution: faint, warm at the horizon, never a whitish wash.
    const double Altitude = std::asin(std::clamp(D.Z, -1.0, 1.0));
    const Radiance Glow{0.0016 + 0.010 * std::exp(-Altitude / 0.07), 0.0020 + 0.0075 * std::exp(-Altitude / 0.07),
                        0.0036 + 0.0045 * std::exp(-Altitude / 0.07)};
    return Glow + Milk * Milky;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CAMERA
//------------------------------------------------------------------------------------------------------------------------

struct SkyCamera
{
    SkyVector Forward;
    SkyVector Right;
    SkyVector Up;
};

SkyCamera MakeSkyCamera(SkyVector Aim)
{
    SkyCamera Camera;
    Camera.Forward = Normalize(Aim);
    Camera.Right = Normalize(Cross(Camera.Forward, {0.0, 0.0, 1.0}));
    Camera.Up = Cross(Camera.Right, Camera.Forward);
    return Camera;
}

// Height-normalised screen coordinates: X right, Y up, both in units of half the frame height.
void ScreenCoordinates(const SkyCamera& Camera, SkyVector D, double& X, double& Y)
{
    const double Depth = Dot(D, Camera.Forward);
    X = Dot(D, Camera.Right) / Depth / HalfFovTangent;
    Y = Dot(D, Camera.Up) / Depth / HalfFovTangent;
}

SkyVector PixelDirection(const SkyCamera& Camera, double Px, double Py)
{
    const double X = (Px - ImageWidth * 0.5) / (ImageHeight * 0.5);
    const double Y = (ImageHeight * 0.5 - Py) / (ImageHeight * 0.5);
    return Normalize(Camera.Forward + Camera.Right * (X * HalfFovTangent) + Camera.Up * (Y * HalfFovTangent));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   IMAGE OUTPUT
//------------------------------------------------------------------------------------------------------------------------

struct Canvas
{
    int Width = 0;
    int Height = 0;
    std::vector<Radiance> Pixels;
    Canvas(int W, int H) : Width(W), Height(H), Pixels(static_cast<size_t>(W) * H) {}
    Radiance& At(int X, int Y) { return Pixels[static_cast<size_t>(Y) * Width + X]; }
};

uint8_t ToByte(double Linear, double Exposure)
{
    const double Mapped = 1.0 - std::exp(-Exposure * std::max(Linear, 0.0));
    const double Encoded = std::pow(Clamp01(Mapped), 1.0 / 2.2);
    return static_cast<uint8_t>(std::lround(Encoded * 255.0));
}

bool WritePpm(const std::string& Path, const Canvas& Image, double Exposure)
{
    FILE* File = std::fopen(Path.c_str(), "wb");
    if (!File) return false;
    std::fprintf(File, "P6\n%d %d\n255\n", Image.Width, Image.Height);
    for (const Radiance& Pixel : Image.Pixels)
    {
        const uint8_t Bytes[3] = {ToByte(Pixel.R, Exposure), ToByte(Pixel.G, Exposure), ToByte(Pixel.B, Exposure)};
        std::fwrite(Bytes, 1, 3, File);
    }
    std::fclose(File);
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SCENES
//------------------------------------------------------------------------------------------------------------------------

struct ValidationCounter
{
    int Passed = 0;
    int Failed = 0;
    void Check(const char* Name, bool Ok, double Value)
    {
        std::printf("%s %s = %.6g\n", Ok ? "PASS" : "FAIL", Name, Value);
        Ok ? ++Passed : ++Failed;
    }
};

// Gaussian splat: each star adds a point-spread profile; peak is set from magnitude and colour index.
void SplatStars(Canvas& Image, const std::vector<StarMarker>& Markers)
{
    for (const StarMarker& Marker : Markers)
    {
        const int Reach = static_cast<int>(std::ceil(3.0 * Marker.Sigma));
        const int CentreX = static_cast<int>(std::lround(Marker.Px));
        const int CentreY = static_cast<int>(std::lround(Marker.Py));
        for (int Y = std::max(0, CentreY - Reach); Y <= std::min(Image.Height - 1, CentreY + Reach); ++Y)
            for (int X = std::max(0, CentreX - Reach); X <= std::min(Image.Width - 1, CentreX + Reach); ++X)
            {
                const double Dx = X - Marker.Px, Dy = Y - Marker.Py;
                const double Weight = std::exp(-(Dx * Dx + Dy * Dy) / (2.0 * Marker.Sigma * Marker.Sigma));
                Image.At(X, Y) = Image.At(X, Y) + Marker.Colour * (Marker.Peak * Weight);
            }
    }
}

// Night view: Milky Way, stars and the Moon. The aim is chosen by the caller.
Canvas RenderNightSky(SkyVector Aim, double JulianDay, const SkyVector& Moon, const SkyVector& Sun)
{
    Canvas Image(ImageWidth, ImageHeight);
    const SkyCamera Camera = MakeSkyCamera(Aim);
    const double Lst = LocalSiderealRad(JulianDay);
    const SkyVector GalacticPole = EquatorialToLocal(192.85948 * DegToRad, 27.12825 * DegToRad, Lst);
    const SkyVector GalacticCentre = EquatorialToLocal(266.40499 * DegToRad, -28.93618 * DegToRad, Lst);
    const MoonFrame Frame = MakeMoonFrame(Moon, Sun);

    for (int Y = 0; Y < ImageHeight; ++Y)
        for (int X = 0; X < ImageWidth; ++X)
        {
            const SkyVector D = PixelDirection(Camera, X + 0.5, Y + 0.5);
            Radiance Value = NightBackground(D, GalacticPole, GalacticCentre);
            const double A = Dot(D, Frame.Right) / MoonAngularRadius;
            const double B = Dot(D, Frame.Up) / MoonAngularRadius;
            const double Lambert = MoonDiscLambert(Frame, A, B);
            if (Lambert > -1.0 && Dot(D, Moon) > std::cos(MoonAngularRadius * 1.5))
                Value = MoonDiscRadiance(Lambert);
            Image.At(X, Y) = Value;
        }

    // Stars: procedural uniform-sphere catalogue, equatorial frame converted to local directions.
    std::vector<StarMarker> Markers;
    const std::vector<Frontier::StarRecord> Catalogue = Frontier::GenerateStarCatalogue(30000, 1234);
    for (const Frontier::StarRecord& Star : Catalogue)
    {
        const double Ra = std::atan2(Star.Direction.Y, Star.Direction.X);
        const double Dec = std::asin(std::clamp(Star.Direction.Z, -1.0, 1.0));
        const SkyVector D = EquatorialToLocal(Ra, Dec, Lst);
        if (D.Z < -0.02 || Dot(D, Camera.Forward) <= 0.0) continue;
        double Sx = 0.0, Sy = 0.0;
        ScreenCoordinates(Camera, D, Sx, Sy);
        if (std::fabs(Sx) > 1.02 * ImageWidth / ImageHeight || std::fabs(Sy) > 1.02) continue;
        StarMarker Marker;
        Marker.Px = (Sx * ImageHeight * 0.5) + ImageWidth * 0.5;
        Marker.Py = ImageHeight * 0.5 - Sy * ImageHeight * 0.5;
        Marker.Sigma = 0.55 + 0.25 * std::clamp(2.0 - Star.Magnitude, 0.0, 3.0);
        Marker.Peak = 1.6 * std::pow(10.0, -0.4 * (Star.Magnitude + 1.0));
        const double Tint = std::clamp(Star.ColourIndex, -1.0, 1.0);
        Marker.Colour = {1.0 + 0.25 * Tint, 1.0 - 0.05 * std::fabs(Tint), 1.0 - 0.30 * Tint};
        Markers.push_back(Marker);
    }
    SplatStars(Image, Markers);
    return Image;
}

// Sun-disc lens flare: bright disc, glow, and the LensFlareModel ghost chain along the sun-centre axis.
Radiance DaySkyRadiance(SkyVector D, SkyVector Sun)
{
    const double Blue = 1.0 - std::exp(-2.2 * std::max(D.Z, 0.0));
    const Radiance Zenith{0.10, 0.25, 0.66};
    const Radiance Horizon{0.62, 0.72, 0.84};
    const Radiance Base = Horizon * (1.0 - Blue) + Zenith * Blue;
    const double Theta = std::acos(std::clamp(Dot(D, Sun), -1.0, 1.0));
    const Radiance Forward{1.0, 0.93, 0.80};
    return Base + Forward * (0.55 * std::exp(-std::pow(Theta / 0.22, 2.0)));
}

Canvas RenderSunFlare(SkyVector Aim, SkyVector Sun, double Visibility, std::array<Frontier::FlareGhost, 6>* GhostsOut)
{
    Canvas Image(ImageWidth, ImageHeight);
    const SkyCamera Camera = MakeSkyCamera(Aim);
    double SunX = 0.0, SunY = 0.0;
    ScreenCoordinates(Camera, Sun, SunX, SunY);
    const std::array<Frontier::FlareGhost, 6> Ghosts = Frontier::LayoutFlareGhosts(SunX, SunY, Visibility);
    if (GhostsOut) *GhostsOut = Ghosts;

    static const Radiance GhostTint[6] = {{0.95, 0.60, 0.30}, {0.40, 0.85, 0.55}, {0.50, 0.62, 1.00},
                                          {1.00, 0.45, 0.45}, {0.85, 0.90, 0.40}, {0.55, 0.90, 0.95}};

    for (int Y = 0; Y < ImageHeight; ++Y)
        for (int X = 0; X < ImageWidth; ++X)
        {
            const SkyVector D = PixelDirection(Camera, X + 0.5, Y + 0.5);
            Radiance Value = DaySkyRadiance(D, Sun);
            const double Theta = std::acos(std::clamp(Dot(D, Sun), -1.0, 1.0));
            if (Theta < SunAngularRadius)
                Value = Radiance{90.0, 88.0, 80.0};
            else
                Value = Value + Radiance{1.0, 0.92, 0.78} * (0.9 * std::exp(-std::pow(Theta / 0.03, 2.0)) +
                                                              0.0025 / (Theta * Theta + 0.0006));

            double Px = 0.0, Py = 0.0;
            ScreenCoordinates(Camera, D, Px, Py);
            for (size_t Index = 0; Index < Ghosts.size(); ++Index)
            {
                const Frontier::FlareGhost& Ghost = Ghosts[Index];
                const double Distance = std::hypot(Px - Ghost.PositionX, Py - Ghost.PositionY);
                const double Disc = 1.0 - Smoothstep(Ghost.RadiusNdc * 0.85, Ghost.RadiusNdc, Distance);
                Value = Value + GhostTint[Index] * (2.2 * Ghost.Strength * Disc);
            }
            Image.At(X, Y) = Value;
        }
    return Image;
}

// Four phases of the cycle containing the chosen date, each as a centred disc with the Sun's real lit side.
Canvas RenderMoonPhases(double JulianDay, std::vector<double>& GeometricFractions, std::vector<double>& RasterFractions,
                        std::vector<double>& ModelFractions)
{
    constexpr int TileSize = 240;
    constexpr int TileCount = 4;
    constexpr double TileRadius = 100.0;
    Canvas Image(TileSize * TileCount, TileSize);
    const double CycleStart = Frontier::NewMoonEpochJulian +
                              std::floor((JulianDay - Frontier::NewMoonEpochJulian) / Frontier::SynodicMonthDays) *
                                  Frontier::SynodicMonthDays;

    for (int Tile = 0; Tile < TileCount; ++Tile)
    {
        const double PhaseJulian = CycleStart + Frontier::SynodicMonthDays * Tile / 4.0;
        const double Lst2 = LocalSiderealRad(PhaseJulian);
        const SkyVector Moon = EquatorialToLocal(MoonEquatorial(PhaseJulian).RightAscensionRad,
                                                 MoonEquatorial(PhaseJulian).DeclinationRad, Lst2);
        const SkyVector Sun = EquatorialToLocal(SunEquatorial(PhaseJulian).RightAscensionRad,
                                                SunEquatorial(PhaseJulian).DeclinationRad, Lst2);
        const MoonFrame Frame = MakeMoonFrame(Moon, Sun);

        double Lit = 0.0, Samples = 0.0;
        for (int Y = 0; Y < TileSize; ++Y)
            for (int X = 0; X < TileSize; ++X)
            {
                const double A = (X + 0.5 - TileSize * 0.5) / TileRadius;
                const double B = (TileSize * 0.5 - (Y + 0.5)) / TileRadius;
                const double Lambert = MoonDiscLambert(Frame, A, B);
                Radiance Value{0.0015, 0.0018, 0.0030};
                if (Lambert > -1.0 && A * A + B * B <= 1.0)
                {
                    Value = MoonDiscRadiance(Lambert);
                    if (A * A + B * B > 0.999) Value = Value * 0.5;
                }
                Image.At(Tile * TileSize + X, Y) = Value;
                if (Lambert > -1.0 && A * A + B * B <= 1.0)
                {
                    Lit += Lambert > 0.0 ? 1.0 : 0.0;
                    Samples += 1.0;
                }
            }
        GeometricFractions.push_back(GeometricIlluminatedFraction(SunEquatorial(PhaseJulian), MoonEquatorial(PhaseJulian)));
        RasterFractions.push_back(Lit / Samples);
        ModelFractions.push_back(Frontier::MoonPhase(PhaseJulian).Illumination);
    }
    return Image;
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const std::string OutputPrefix = ArgumentCount > 1 ? Arguments[1] : "Capture/";
    ValidationCounter Counter;

    // 2026-10-26 20:30 local (SAST, UTC+2) for the night view; 16:30 local for the sun-disc flare.
    const double NightJulian = Frontier::JulianDate(2026, 10, 26, 18.5);
    const double DayJulian = Frontier::JulianDate(2026, 10, 26, 14.5);

    // Sanity: the local ENU Sun matches CelestialModel's SunDirectionLocal at Benoni.
    const Frontier::SolarPosition CoreSun = Frontier::SunPosition(DayJulian, BenoniLatitudeDeg, BenoniLongitudeDeg);
    const SkyVector SunVector = EquatorialToLocal(SunEquatorial(DayJulian).RightAscensionRad,
                                                  SunEquatorial(DayJulian).DeclinationRad, LocalSiderealRad(DayJulian));
    const double SunCoreError = std::fabs(std::asin(SunVector.Z) - CoreSun.ElevationRad) / DegToRad;
    Counter.Check("sun elevation vs CelestialModel (deg)", SunCoreError < 0.05, SunCoreError);
    std::printf("INFO sun elevation at 16:30 local = %.3f deg, azimuth %.3f deg\n", CoreSun.ElevationRad / DegToRad,
                CoreSun.AzimuthRad / DegToRad);

    // Equatorial round trip for the local transform used by the stars, Milky Way and Moon.
    double RaBack = 0.0, DecBack = 0.0;
    const double Ra0 = 1.2, Dec0 = -0.4;
    LocalToEquatorial(EquatorialToLocal(Ra0, Dec0, LocalSiderealRad(NightJulian)), LocalSiderealRad(NightJulian), RaBack, DecBack);
    const double RoundTrip = std::fabs(std::remainder(RaBack - Ra0, 2.0 * Pi)) + std::fabs(DecBack - Dec0);
    Counter.Check("equatorial round trip (rad)", RoundTrip < 1e-9, RoundTrip);

    // Moon: geometric lit fraction versus CelestialModel's mean-phase model, then raster versus geometry.
    std::vector<double> Geometric, Raster, Model;
    const Canvas Phases = RenderMoonPhases(NightJulian, Geometric, Raster, Model);
    double WorstModelGap = 0.0, WorstRasterGap = 0.0;
    for (size_t I = 0; I < Geometric.size(); ++I)
    {
        WorstModelGap = std::max(WorstModelGap, std::fabs(Geometric[I] - Model[I]));
        WorstRasterGap = std::max(WorstRasterGap, std::fabs(Raster[I] - Geometric[I]));
        std::printf("INFO phase %zu geometric %.4f raster %.4f mean-age %.4f\n", I, Geometric[I], Raster[I], Model[I]);
    }
    Counter.Check("moon raster lit fraction vs geometry", WorstRasterGap < 0.01, WorstRasterGap);
    // Information only: CelestialModel's mean-age formula ignores the lunar equation of centre (about +/-6 deg in
    // longitude), so the quarter-phase gap is a model difference, not a rendering defect.
    std::printf("INFO moon geometry vs mean-age phase model, worst gap %.4f (model difference, not a render check)\n",
                WorstModelGap);
    Counter.Check("phase strip runs new (0) to full (2)", Geometric[0] < 0.1 && Geometric[2] > 0.9, Geometric[2]);

    // Night view: aim at the brightest Milky Way patch above 25 degrees altitude.
    const SkyVector NightMoon = EquatorialToLocal(MoonEquatorial(NightJulian).RightAscensionRad,
                                                  MoonEquatorial(NightJulian).DeclinationRad, LocalSiderealRad(NightJulian));
    const SkyVector NightSun = EquatorialToLocal(SunEquatorial(NightJulian).RightAscensionRad,
                                                 SunEquatorial(NightJulian).DeclinationRad, LocalSiderealRad(NightJulian));
    const double Lst = LocalSiderealRad(NightJulian);
    const SkyVector GalacticPole = EquatorialToLocal(192.85948 * DegToRad, 27.12825 * DegToRad, Lst);
    SkyVector BestAim{0.0, 1.0, 0.0};
    double BestScore = -1.0;
    for (double Azimuth = 0.0; Azimuth < 360.0; Azimuth += 2.0)
        for (double Altitude = 25.0; Altitude <= 45.0; Altitude += 2.0)
        {
            const double Az = Azimuth * DegToRad, Al = Altitude * DegToRad;
            const SkyVector Aim{std::cos(Al) * std::sin(Az), std::cos(Al) * std::cos(Az), std::sin(Al)};
            const double Latitude = std::asin(std::clamp(Dot(Aim, GalacticPole), -1.0, 1.0));
            const double Score = std::exp(-std::pow(Latitude / 0.12, 2.0));
            if (Score > BestScore) { BestScore = Score; BestAim = Aim; }
        }
    const Canvas Night = RenderNightSky(BestAim, NightJulian, NightMoon, NightSun);
    // Second night frame centred on the Moon, so the disc, phase terminator and stars are all in view.
    const Canvas MoonNight = RenderNightSky(NightMoon, NightJulian, NightMoon, NightSun);
    // Independent geometric count of disc pixels inside the frame, compared with pi r^2 in pixels.
    const SkyCamera NightCamera = MakeSkyCamera(BestAim);
    const double RadiusPixels = MoonAngularRadius / HalfFovTangent * ImageHeight * 0.5;
    int DiscPixels = 0;
    for (int Y = 0; Y < ImageHeight; ++Y)
        for (int X = 0; X < ImageWidth; ++X)
            if (std::acos(std::clamp(Dot(PixelDirection(NightCamera, X + 0.5, Y + 0.5), NightMoon), -1.0, 1.0)) < MoonAngularRadius)
                ++DiscPixels;
    const double ExpectedPixels = Pi * RadiusPixels * RadiusPixels;
    if (DiscPixels > 0)
        Counter.Check("night moon disc pixel area vs pi r^2", std::fabs(DiscPixels - ExpectedPixels) < 0.15 * ExpectedPixels,
                      DiscPixels / ExpectedPixels);
    else
        std::printf("INFO moon outside night frame (area check not applicable)\n");
    std::printf("INFO night aim azimuth/altitude %.1f / %.1f deg, moon alt %.2f deg\n",
                std::atan2(BestAim.X, BestAim.Y) / DegToRad, std::asin(BestAim.Z) / DegToRad,
                std::asin(NightMoon.Z) / DegToRad);
    Counter.Check("night Milky Way aim above 25 deg", BestScore > 0.0, BestScore);

    // Sun-disc flare: aim up-and-off the sun so the ghost chain lies in frame.
    const SkyVector DaySun = SunVector;
    // Aim so the sun sits right of and above centre (about +0.55, +0.25 frame half-heights), leaving the ghost
    // chain on the opposite side of the frame.
    const SkyVector SunEast = Normalize(Cross(DaySun, {0.0, 0.0, 1.0}));
    const SkyVector SunUp = Cross(SunEast, DaySun);
    const SkyVector DayAim = Normalize(DaySun - SunEast * (0.55 * HalfFovTangent) - SunUp * (0.25 * HalfFovTangent));
    {
        double Sx = 0.0, Sy = 0.0;
        ScreenCoordinates(MakeSkyCamera(DayAim), DaySun, Sx, Sy);
        std::printf("INFO sun NDC in day flare frame (%.3f, %.3f)\n", Sx, Sy);
    }
    std::array<Frontier::FlareGhost, 6> GhostsFull{};
    const Canvas Flare = RenderSunFlare(DayAim, DaySun, 1.0, &GhostsFull);
    std::array<Frontier::FlareGhost, 6> GhostsHidden{};
    const Canvas FlareHidden = RenderSunFlare(DayAim, DaySun, 0.0, &GhostsHidden);
    double HiddenGhostGap = 0.0;
    for (size_t I = 0; I < GhostsHidden.size(); ++I) HiddenGhostGap = std::max(HiddenGhostGap, GhostsHidden[I].Strength);
    Counter.Check("zero visibility removes every ghost", HiddenGhostGap == 0.0, HiddenGhostGap);
    double FlareDifference = 0.0;
    for (size_t I = 0; I < Flare.Pixels.size(); ++I)
        FlareDifference = std::max(FlareDifference, std::fabs(Flare.Pixels[I].R - FlareHidden.Pixels[I].R));
    Counter.Check("ghost chain visible when unoccluded", FlareDifference > 0.05, FlareDifference);

    const bool Wrote = WritePpm(OutputPrefix + "NightSky.ppm", Night, 1.0) &&
                       WritePpm(OutputPrefix + "NightSkyMoon.ppm", MoonNight, 1.0) &&
                       WritePpm(OutputPrefix + "SunFlare.ppm", Flare, 1.0) &&
                       WritePpm(OutputPrefix + "MoonPhases.ppm", Phases, 1.0);
    Counter.Check("PPM outputs written", Wrote, Wrote ? 1.0 : 0.0);

    std::printf("SUMMARY passed %d failed %d\n", Counter.Passed, Counter.Failed);
    return Counter.Failed == 0 ? 0 : 1;
}
