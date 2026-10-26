/*==========================================================================================================================================
                                                       NIGHT SKY EXHIBIT
                                     ------------------------------------------------------------------
              Hipparcos star field, Milky Way band, Moon disc and field, single-scattering day and dusk sky, and
              a sun-disc lens flare with ghosts measured in the rendered image. CPU only, headless.
==========================================================================================================================================*/

// 🧩 Sky exhibit. Solar position and lunar phase come from CelestialModel; the single-scattering day and dusk sky
//    comes from AtmosphereModel (transmittance LUT); ghost placement comes from LensFlareModel. Stars are the open
//    Hipparcos-derived catalogue in Data/Hipparcos8.csv (XHIP via d3-celestial, BSD-3). The lunar ephemeris is a
//    Meeus low-precision series. Lunar maria are procedural noise, not a licensed or measured lunar map.

#include "Engine/Rendering/AtmosphereModel.h"
#include "Engine/Rendering/CelestialModel.h"
#include "Engine/Rendering/LensFlareModel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace
{

constexpr double Pi = 3.14159265358979323846;
constexpr double DegToRad = Pi / 180.0;
constexpr double ArcsecToRad = Pi / (180.0 * 3600.0);
constexpr double BenoniLatitudeDeg = -26.1885;   // Benoni, Gauteng, ZA
constexpr double BenoniLongitudeDeg = 28.3209;
constexpr double MoonAngularRadius = 0.2725 * DegToRad;   // mean semi-diameter
constexpr double SunAngularRadius = 0.2666 * DegToRad;
constexpr double StandardHalfTangent = 0.2679;   // tan(15 deg): 30 degree vertical field
constexpr double CatalogueEpochYearsToDate = 26.82;   // J2000.0 to 2026-10-26

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
//                                                   TIME, FRAMES AND CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

double LocalSiderealRad(double Julian)
{
    const double N = Julian - 2451545.0;
    double GmstHours = std::fmod(18.697374558 + 24.06570982441908 * N, 24.0);
    if (GmstHours < 0.0) GmstHours += 24.0;
    return (GmstHours * 15.0 + BenoniLongitudeDeg) * DegToRad;
}

// Equatorial (RA, Dec) to local ENU, same azimuth convention as CelestialModel's SunDirectionLocal.
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

void LocalToEquatorial(SkyVector V, double LocalSiderealRadians, double& RightAscensionRad, double& DeclinationRad)
{
    const double Latitude = BenoniLatitudeDeg * DegToRad;
    const double Altitude = std::asin(std::clamp(V.Z, -1.0, 1.0));
    const double AzimuthNorth = std::atan2(V.X, V.Y);
    DeclinationRad = std::asin(std::clamp(std::sin(Latitude) * std::sin(Altitude) +
                                              std::cos(Latitude) * std::cos(Altitude) * std::cos(AzimuthNorth),
                                          -1.0, 1.0));
    const double SinHour = -std::sin(AzimuthNorth) * std::cos(Altitude) * std::cos(Latitude);
    const double CosHour = std::sin(Altitude) - std::sin(Latitude) * std::sin(DeclinationRad);
    RightAscensionRad = LocalSiderealRadians - std::atan2(SinHour, CosHour);
}

struct EquatorialPoint
{
    double RightAscensionRad = 0.0;
    double DeclinationRad = 0.0;
};

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

// Meeus chapter 47, main terms (longitude 6.289 deg, latitude 5.128 deg).
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

double GeometricIlluminatedFraction(EquatorialPoint Sun, EquatorialPoint Moon)
{
    const double CosElongation = std::sin(Sun.DeclinationRad) * std::sin(Moon.DeclinationRad) +
                                 std::cos(Sun.DeclinationRad) * std::cos(Moon.DeclinationRad) *
                                     std::cos(Sun.RightAscensionRad - Moon.RightAscensionRad);
    return 0.5 * (1.0 - CosElongation);
}

// Precession from J2000 to the observation date (IAU first-order: m = 46.124, n = 20.043 arcsec per year).
EquatorialPoint PrecessFromJ2000(double RightAscensionRad, double DeclinationRad, double Years)
{
    constexpr double M = 46.124, N = 20.043;
    const double DeltaRa = (M + N * std::sin(RightAscensionRad) * std::tan(DeclinationRad)) * Years * ArcsecToRad;
    const double DeltaDec = N * std::cos(RightAscensionRad) * Years * ArcsecToRad;
    return {RightAscensionRad + DeltaRa, DeclinationRad + DeltaDec};
}

struct CatalogueStar
{
    double RightAscensionRad = 0.0;   // J2000
    double DeclinationRad = 0.0;      // J2000
    double Magnitude = 0.0;
    double ColourBv = 0.0;
};

// Reads Data/Hipparcos8.csv (id,ra_deg,dec_deg,mag,bv). Returns an empty vector if the file is missing.
std::vector<CatalogueStar> LoadHipparcosCatalogue(const std::string& Path)
{
    std::vector<CatalogueStar> Stars;
    std::ifstream File(Path);
    std::string Line;
    while (std::getline(File, Line))
    {
        if (Line.empty() || Line[0] == '#' || Line.rfind("id,", 0) == 0) continue;
        std::stringstream Fields(Line);
        std::string Id, Ra, Dec, Mag, Bv;
        if (!std::getline(Fields, Id, ',') || !std::getline(Fields, Ra, ',') || !std::getline(Fields, Dec, ',') ||
            !std::getline(Fields, Mag, ',') || !std::getline(Fields, Bv, ','))
            continue;
        CatalogueStar Star;
        Star.RightAscensionRad = std::strtod(Ra.c_str(), nullptr) * DegToRad;
        Star.DeclinationRad = std::strtod(Dec.c_str(), nullptr) * DegToRad;
        Star.Magnitude = std::strtod(Mag.c_str(), nullptr);
        Star.ColourBv = std::strtod(Bv.c_str(), nullptr);
        Stars.push_back(Star);
    }
    return Stars;
}

// Blackbody-like colour from B-V (Ballesteros temperature, Tanner Helland blackbody fit), normalised to max 1.
Radiance StarColour(double Bv)
{
    const double Temperature = 4600.0 * (1.0 / (0.92 * Bv + 1.7) + 1.0 / (0.92 * Bv + 0.62));
    const double T = Temperature / 100.0;
    const double Red = T <= 66.0 ? 255.0 : 329.698727446 * std::pow(T - 60.0, -0.1332047592);
    const double Green = T <= 66.0 ? 99.4708025861 * std::log(T) - 161.1195681661
                                   : 288.1221695283 * std::pow(T - 60.0, -0.0755148492);
    const double Blue = T >= 66.0 ? 255.0 : (T <= 19.0 ? 0.0 : 138.5177312231 * std::log(T - 10.0) - 305.0447927307);
    Radiance Colour{std::clamp(Red, 0.0, 255.0) / 255.0, std::clamp(Green, 0.0, 255.0) / 255.0,
                    std::clamp(Blue, 0.0, 255.0) / 255.0};
    const double Peak = std::max({Colour.R, Colour.G, Colour.B, 1e-6});
    return Colour * (1.0 / Peak);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   MOON
//------------------------------------------------------------------------------------------------------------------------

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

// Procedural lunar albedo on the unit sphere: dark maria from low-frequency noise plus highland grain.
// Not a measured or licensed lunar map.
double MoonAlbedo(SkyVector Normal)
{
    // Fractal sum with fine octaves so the maria edges are ragged rather than blob-shaped.
    const double Large = 0.45 * ValueNoise(Normal * 2.6) + 0.27 * ValueNoise(Normal * 5.3 + SkyVector{7.1, 3.3, 1.9}) +
                         0.14 * ValueNoise(Normal * 11.0) + 0.07 * ValueNoise(Normal * 23.0);
    const double Maria = 1.0 - Smoothstep(0.44, 0.52, Large);
    const double Grain = 0.90 + 0.20 * ValueNoise(Normal * 40.0);
    return (0.50 - 0.20 * Maria) * Grain;
}

// Lambert shading on the disc sample (A, B) in units of the angular radius; negative outside the disc.
double MoonDiscLambert(const MoonFrame& Frame, double A, double B, SkyVector* NormalOut = nullptr)
{
    const double Radicand = 1.0 - A * A - B * B;
    if (Radicand < 0.0) return -1.0;
    const SkyVector Normal = Frame.Right * A + Frame.Up * B + Frame.Observer * std::sqrt(Radicand);
    if (NormalOut) *NormalOut = Normal;
    return Dot(Normal, Frame.TowardSun);
}

Radiance MoonDiscRadiance(const MoonFrame& Frame, double A, double B)
{
    SkyVector Normal{};
    const double Lambert = MoonDiscLambert(Frame, A, B, &Normal);
    const double Albedo = MoonAlbedo(Normal);
    const double Lit = 2.4 * Albedo * std::max(Lambert, 0.0);
    const double Earthshine = 0.010 * Albedo;
    return Radiance{Lit + Earthshine, (Lit * 0.97 + Earthshine), (Lit * 0.92 + Earthshine * 1.05)};
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CAMERA AND CANVAS
//------------------------------------------------------------------------------------------------------------------------

struct SkyCamera
{
    SkyVector Forward;
    SkyVector Right;
    SkyVector Up;
    double Tangent = StandardHalfTangent;
    int Width = 0;
    int Height = 0;
};

SkyCamera MakeSkyCamera(SkyVector Aim, int Width, int Height, double Tangent)
{
    SkyCamera Camera;
    Camera.Forward = Normalize(Aim);
    Camera.Right = Normalize(Cross(Camera.Forward, {0.0, 0.0, 1.0}));
    Camera.Up = Cross(Camera.Right, Camera.Forward);
    Camera.Tangent = Tangent;
    Camera.Width = Width;
    Camera.Height = Height;
    return Camera;
}

// Height-normalised screen coordinates (X right, Y up, units of half the frame height).
void ScreenCoordinates(const SkyCamera& Camera, SkyVector D, double& X, double& Y)
{
    const double Depth = Dot(D, Camera.Forward);
    X = Dot(D, Camera.Right) / Depth / Camera.Tangent;
    Y = Dot(D, Camera.Up) / Depth / Camera.Tangent;
}

SkyVector PixelDirection(const SkyCamera& Camera, double Px, double Py)
{
    const double X = (Px - Camera.Width * 0.5) / (Camera.Height * 0.5);
    const double Y = (Camera.Height * 0.5 - Py) / (Camera.Height * 0.5);
    return Normalize(Camera.Forward + Camera.Right * (X * Camera.Tangent) + Camera.Up * (Y * Camera.Tangent));
}

struct Canvas
{
    int Width = 0;
    int Height = 0;
    std::vector<Radiance> Pixels;
    Canvas(int W, int H) : Width(W), Height(H), Pixels(static_cast<size_t>(W) * H) {}
    Radiance& At(int X, int Y) { return Pixels[static_cast<size_t>(Y) * Width + X]; }
    const Radiance& At(int X, int Y) const { return Pixels[static_cast<size_t>(Y) * Width + X]; }
};

uint8_t ToByte(double Linear, double Exposure)
{
    const double Mapped = 1.0 - std::exp(-Exposure * std::max(Linear, 0.0));
    return static_cast<uint8_t>(std::lround(std::pow(Clamp01(Mapped), 1.0 / 2.2) * 255.0));
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
//                                                   SKY MODELS
//------------------------------------------------------------------------------------------------------------------------

// Night factor from solar elevation: 0 at civil twilight and above, 1 from astronomical twilight down.
double NightFactor(double SunElevationRad)
{
    return Smoothstep(-6.0 * DegToRad, -15.0 * DegToRad, SunElevationRad);
}

// Single-scattering sky for a view direction (ENU), sun direction (ENU) and the atmosphere LUT.
Radiance ScatteredSky(const Frontier::AtmosphereParameters& Atmosphere, const Frontier::TransmittanceLut& Lut,
                      SkyVector D, SkyVector Sun)
{
    const double GroundKm = Atmosphere.GroundRadiusKm;
    const Frontier::SpectrumRgb Light = Frontier::SingleScattering(
        Atmosphere, {0.0, 0.0, GroundKm + 0.001}, {D.X, D.Y, D.Z}, {Sun.X, Sun.Y, Sun.Z},
        Frontier::SpectrumRgb{9.0, 9.0, 9.0}, &Lut, 24);
    return Radiance{Light.R, Light.G, Light.B};
}

// Night background: airglow and urban glow near the horizon, plus the Milky Way band from galactic latitude and
// a brighter bulge toward the galactic centre, with dust lanes from procedural noise.
Radiance NightBackground(SkyVector D, SkyVector GalacticPole, SkyVector GalacticCentre, double Night)
{
    const double Latitude = std::asin(std::clamp(Dot(D, GalacticPole), -1.0, 1.0));
    const double Separation = std::acos(std::clamp(Dot(D, GalacticCentre), -1.0, 1.0));
    const double Lane = Smoothstep(0.45, 0.75, ValueNoise(D * 9.0)) * std::exp(-std::pow(Latitude / 0.07, 2.0));
    const double Band = std::exp(-std::pow(Latitude / 0.12, 2.0)) * (0.30 + 0.70 * std::exp(-std::pow(Separation / 0.55, 2.0)));
    const double Clouds = 0.55 + 0.45 * ValueNoise(D * 6.0);
    const double Milky = 0.060 * Band * Clouds * (1.0 - 0.75 * Lane);
    const double Warm = std::exp(-std::pow(Separation / 0.8, 2.0));
    const Radiance Milk{0.80 + 0.2 * Warm, 0.86 + 0.06 * Warm, 1.0 - 0.22 * Warm};
    const double Altitude = std::asin(std::clamp(D.Z, -1.0, 1.0));
    const Radiance Glow{0.0016 + 0.010 * std::exp(-Altitude / 0.07), 0.0020 + 0.0075 * std::exp(-Altitude / 0.07),
                        0.0036 + 0.0045 * std::exp(-Altitude / 0.07)};
    return (Glow + Milk * Milky) * Night;
}

// Gaussian splat with peak from magnitude and colour from B-V; scaled to the image size.
struct StarSplat
{
    double Px = 0.0, Py = 0.0, Sigma = 1.0, Peak = 0.0;
    Radiance Colour{};
};

void SplatStars(Canvas& Image, const std::vector<StarSplat>& Splats, double Scale)
{
    for (const StarSplat& Splat : Splats)
    {
        const double Sigma = Splat.Sigma * Scale;
        const int Reach = static_cast<int>(std::ceil(3.0 * Sigma));
        const int CentreX = static_cast<int>(std::lround(Splat.Px));
        const int CentreY = static_cast<int>(std::lround(Splat.Py));
        for (int Y = std::max(0, CentreY - Reach); Y <= std::min(Image.Height - 1, CentreY + Reach); ++Y)
            for (int X = std::max(0, CentreX - Reach); X <= std::min(Image.Width - 1, CentreX + Reach); ++X)
            {
                const double Dx = X + 0.5 - Splat.Px, Dy = Y + 0.5 - Splat.Py;
                const double Weight = std::exp(-(Dx * Dx + Dy * Dy) / (2.0 * Sigma * Sigma));
                Image.At(X, Y) = Image.At(X, Y) + Splat.Colour * (Splat.Peak * Weight);
            }
    }
}

std::vector<StarSplat> BuildStarSplats(const std::vector<CatalogueStar>& Catalogue, const SkyCamera& Camera,
                                       double LocalSidereal, double Night)
{
    std::vector<StarSplat> Splats;
    Splats.reserve(Catalogue.size());
    for (const CatalogueStar& Star : Catalogue)
    {
        const EquatorialPoint Date = PrecessFromJ2000(Star.RightAscensionRad, Star.DeclinationRad, CatalogueEpochYearsToDate);
        const SkyVector D = EquatorialToLocal(Date.RightAscensionRad, Date.DeclinationRad, LocalSidereal);
        if (D.Z < -0.02 || Dot(D, Camera.Forward) <= 0.0) continue;
        double Sx = 0.0, Sy = 0.0;
        ScreenCoordinates(Camera, D, Sx, Sy);
        const double AspectHalf = static_cast<double>(Camera.Width) / Camera.Height;
        if (std::fabs(Sx) > 1.05 * AspectHalf || std::fabs(Sy) > 1.05) continue;
        StarSplat Splat;
        Splat.Px = Sx * Camera.Height * 0.5 + Camera.Width * 0.5;
        Splat.Py = Camera.Height * 0.5 - Sy * Camera.Height * 0.5;
        Splat.Sigma = 0.70 + 0.30 * std::clamp(3.0 - Star.Magnitude, 0.0, 4.0);
        Splat.Peak = Night * 6.0 * std::pow(10.0, -0.4 * (Star.Magnitude + 1.0));
        Splat.Colour = StarColour(Star.ColourBv);
        Splats.push_back(Splat);
    }
    return Splats;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SCENES
//------------------------------------------------------------------------------------------------------------------------

struct Counter
{
    int Passed = 0;
    int Failed = 0;
    void Check(const char* Name, bool Ok, double Value)
    {
        std::printf("%s %s = %.6g\n", Ok ? "PASS" : "FAIL", Name, Value);
        Ok ? ++Passed : ++Failed;
    }
};

struct SceneLight
{
    SkyVector Sun;
    SkyVector Moon;
    double SunElevationRad = 0.0;
    double Night = 1.0;
};

// Night field with the Milky Way, the Hipparcos catalogue and the Moon disc.
Canvas RenderNightField(SkyVector Aim, int Width, int Height, double Tangent, double LocalSidereal,
                        const SceneLight& Light, const std::vector<CatalogueStar>& Catalogue, uint32_t* StarCountOut)
{
    Canvas Image(Width, Height);
    const SkyCamera Camera = MakeSkyCamera(Aim, Width, Height, Tangent);
    const SkyVector GalacticPole = EquatorialToLocal(192.85948 * DegToRad, 27.12825 * DegToRad, LocalSidereal);
    const SkyVector GalacticCentre = EquatorialToLocal(266.40499 * DegToRad, -28.93618 * DegToRad, LocalSidereal);
    const MoonFrame Frame = MakeMoonFrame(Light.Moon, Light.Sun);
    const double Scale = static_cast<double>(Width) / 960.0;

    constexpr int Samples = 2;   // 2x2 supersampling for disc edges and star cores
    for (int Y = 0; Y < Height; ++Y)
        for (int X = 0; X < Width; ++X)
        {
            Radiance Accumulated{};
            for (int Sy = 0; Sy < Samples; ++Sy)
                for (int Sx = 0; Sx < Samples; ++Sx)
                {
                    const SkyVector D = PixelDirection(Camera, X + (Sx + 0.5) / Samples, Y + (Sy + 0.5) / Samples);
                    Radiance Value = NightBackground(D, GalacticPole, GalacticCentre, Light.Night);
                    const double MoonCos = Dot(D, Light.Moon);
                    if (MoonCos > std::cos(MoonAngularRadius * 1.25))
                    {
                        const double A = Dot(D, Frame.Right) / MoonAngularRadius;
                        const double B = Dot(D, Frame.Up) / MoonAngularRadius;
                        if (A * A + B * B <= 1.0) Value = MoonDiscRadiance(Frame, A, B);
                    }
                    Accumulated = Accumulated + Value;
                }
            Image.At(X, Y) = Accumulated * (1.0 / (Samples * Samples));
        }

    const std::vector<StarSplat> Splats = BuildStarSplats(Catalogue, Camera, LocalSidereal, Light.Night);
    SplatStars(Image, Splats, Scale);
    if (StarCountOut) *StarCountOut = static_cast<uint32_t>(Splats.size());
    return Image;
}

// Moon close-up: disc fills most of the frame, so the terminator and surface shading can be inspected.
// Disc radius is 0.42 of the frame half-height by construction (tangent = angular radius / 0.42).
Canvas RenderMoonCloseUp(SkyVector MoonDirection, SkyVector Sun, int Size, int* DiscPixelsOut)
{
    Canvas Image(Size, Size);
    const double Tangent = MoonAngularRadius / 0.42;
    const SkyCamera Camera = MakeSkyCamera(MoonDirection, Size, Size, Tangent);
    const MoonFrame Frame = MakeMoonFrame(MoonDirection, Sun);
    for (int Y = 0; Y < Size; ++Y)
        for (int X = 0; X < Size; ++X)
        {
            const SkyVector D = PixelDirection(Camera, X + 0.5, Y + 0.5);
            const double A = Dot(D, Frame.Right) / MoonAngularRadius;
            const double B = Dot(D, Frame.Up) / MoonAngularRadius;
            Radiance Value{0.0012, 0.0015, 0.0028};
            if (A * A + B * B <= 1.0)
            {
                Value = MoonDiscRadiance(Frame, A, B);
                if (DiscPixelsOut) ++*DiscPixelsOut;
            }
            Image.At(X, Y) = Value;
        }
    return Image;
}

// Four phases of the cycle containing the date, each as a centred disc with the Sun's real lit side.
Canvas RenderMoonPhases(double JulianDay, int TileSize, std::vector<double>& Geometric, std::vector<double>& Raster,
                        std::vector<double>& ModelFraction)
{
    constexpr int TileCount = 4;
    const double TileRadius = TileSize * 0.42;
    Canvas Image(TileSize * TileCount, TileSize);
    const double CycleStart = Frontier::NewMoonEpochJulian +
                              std::floor((JulianDay - Frontier::NewMoonEpochJulian) / Frontier::SynodicMonthDays) *
                                  Frontier::SynodicMonthDays;
    for (int Tile = 0; Tile < TileCount; ++Tile)
    {
        const double PhaseJulian = CycleStart + Frontier::SynodicMonthDays * Tile / 4.0;
        const double Lst = LocalSiderealRad(PhaseJulian);
        const SkyVector Moon = EquatorialToLocal(MoonEquatorial(PhaseJulian).RightAscensionRad,
                                                 MoonEquatorial(PhaseJulian).DeclinationRad, Lst);
        const SkyVector Sun = EquatorialToLocal(SunEquatorial(PhaseJulian).RightAscensionRad,
                                                SunEquatorial(PhaseJulian).DeclinationRad, Lst);
        const MoonFrame Frame = MakeMoonFrame(Moon, Sun);
        double Lit = 0.0, Samples = 0.0;
        for (int Y = 0; Y < TileSize; ++Y)
            for (int X = 0; X < TileSize; ++X)
            {
                const double A = (X + 0.5 - TileSize * 0.5) / TileRadius;
                const double B = (TileSize * 0.5 - (Y + 0.5)) / TileRadius;
                Radiance Value{0.0012, 0.0015, 0.0028};
                if (A * A + B * B <= 1.0)
                {
                    Value = MoonDiscRadiance(Frame, A, B);
                    Lit += MoonDiscLambert(Frame, A, B) > 0.0 ? 1.0 : 0.0;
                    Samples += 1.0;
                }
                Image.At(Tile * TileSize + X, Y) = Value;
            }
        Geometric.push_back(GeometricIlluminatedFraction(SunEquatorial(PhaseJulian), MoonEquatorial(PhaseJulian)));
        Raster.push_back(Lit / Samples);
        ModelFraction.push_back(Frontier::MoonPhase(PhaseJulian).Illumination);
    }
    return Image;
}

// Sun-disc flare on the scattering sky. Ghost positions come from LensFlareModel and are measured in the image.
// OnlyGhost >= 0 keeps a single ghost, so its contribution can be isolated for the rendering-level centroid check.
Canvas RenderSunFlare(SkyVector Aim, SkyVector Sun, double Visibility, const Frontier::AtmosphereParameters& Atmosphere,
                      const Frontier::TransmittanceLut& Lut, std::array<Frontier::FlareGhost, 6>* GhostsOut,
                      int OnlyGhost = -1)
{
    const int Width = 1280, Height = 800;
    Canvas Image(Width, Height);
    const SkyCamera Camera = MakeSkyCamera(Aim, Width, Height, StandardHalfTangent);
    double SunX = 0.0, SunY = 0.0;
    ScreenCoordinates(Camera, Sun, SunX, SunY);
    const std::array<Frontier::FlareGhost, 6> Ghosts = Frontier::LayoutFlareGhosts(SunX, SunY, Visibility);
    if (GhostsOut) *GhostsOut = Ghosts;
    static const Radiance GhostTint[6] = {{0.95, 0.60, 0.30}, {0.40, 0.85, 0.55}, {0.50, 0.62, 1.00},
                                          {1.00, 0.45, 0.45}, {0.85, 0.90, 0.40}, {0.55, 0.90, 0.95}};
    for (int Y = 0; Y < Height; ++Y)
        for (int X = 0; X < Width; ++X)
        {
            const SkyVector D = PixelDirection(Camera, X + 0.5, Y + 0.5);
            Radiance Value = ScatteredSky(Atmosphere, Lut, D, Sun);
            const double Theta = std::acos(std::clamp(Dot(D, Sun), -1.0, 1.0));
            if (Theta < SunAngularRadius)
                Value = Radiance{60.0, 58.0, 52.0};
            double Px = 0.0, Py = 0.0;
            ScreenCoordinates(Camera, D, Px, Py);
            for (size_t Index = 0; Index < Ghosts.size(); ++Index)
            {
                if (OnlyGhost >= 0 && static_cast<int>(Index) != OnlyGhost) continue;
                const Frontier::FlareGhost& Ghost = Ghosts[Index];
                const double Distance = std::hypot(Px - Ghost.PositionX, Py - Ghost.PositionY);
                const double Disc = 1.0 - Smoothstep(Ghost.RadiusNdc * 0.85, Ghost.RadiusNdc, Distance);
                Value = Value + GhostTint[Index] * (2.2 * Ghost.Strength * Disc);
            }
            Image.At(X, Y) = Value;
        }
    return Image;
}

// Dusk sweep: sun elevation at a fixed azimuth, with the same scattering model and night fade.
Canvas RenderDuskFrame(double SunElevationRad, const Frontier::AtmosphereParameters& Atmosphere,
                       const Frontier::TransmittanceLut& Lut, const SkyVector& GalacticPole,
                       const SkyVector& GalacticCentre, const std::vector<CatalogueStar>& Catalogue, double LocalSidereal)
{
    constexpr int Width = 480, Height = 300;
    Canvas Image(Width, Height);
    const SkyVector Sun{std::cos(SunElevationRad) * std::sin(270.0 * DegToRad),
                        std::cos(SunElevationRad) * std::cos(270.0 * DegToRad), std::sin(SunElevationRad)};
    const SkyVector Aim{std::cos(15.0 * DegToRad) * std::sin(270.0 * DegToRad),
                        std::cos(15.0 * DegToRad) * std::cos(270.0 * DegToRad), std::sin(15.0 * DegToRad)};
    const SkyCamera Camera = MakeSkyCamera(Aim, Width, Height, 0.40);
    const double Night = NightFactor(SunElevationRad);
    for (int Y = 0; Y < Height; ++Y)
        for (int X = 0; X < Width; ++X)
        {
            const SkyVector D = PixelDirection(Camera, X + 0.5, Y + 0.5);
            Radiance Value{0.03, 0.025, 0.02};   // unlit ground below the horizon
            if (D.Z >= 0.0)
            {
                const double DaySky = 1.0 - Night;
                Value = ScatteredSky(Atmosphere, Lut, D, Sun) * DaySky;
                Value = Value + NightBackground(D, GalacticPole, GalacticCentre, Night);
            }
            Image.At(X, Y) = Value;
        }
    std::vector<StarSplat> Splats = BuildStarSplats(Catalogue, Camera, LocalSidereal, Night);
    SplatStars(Image, Splats, 0.5);
    return Image;
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const std::string OutputPrefix = ArgumentCount > 1 ? Arguments[1] : "Capture/";
    const std::string CataloguePath = ArgumentCount > 2 ? Arguments[2] : "Data/Hipparcos8.csv";
    Counter Check;

    const double NightJulian = Frontier::JulianDate(2026, 10, 26, 18.5);   // 20:30 SAST
    const double DayJulian = Frontier::JulianDate(2026, 10, 26, 14.5);     // 16:30 SAST
    const double NightLst = LocalSiderealRad(NightJulian);
    const double DayLst = LocalSiderealRad(DayJulian);

    // Catalogue.
    const std::vector<CatalogueStar> Catalogue = LoadHipparcosCatalogue(CataloguePath);
    Check.Check("Hipparcos catalogue loaded (stars)", Catalogue.size() > 40000, static_cast<double>(Catalogue.size()));

    // Sun: ENU sun matches CelestialModel at Benoni.
    const Frontier::SolarPosition CoreSun = Frontier::SunPosition(DayJulian, BenoniLatitudeDeg, BenoniLongitudeDeg);
    const SkyVector DaySun = EquatorialToLocal(SunEquatorial(DayJulian).RightAscensionRad,
                                               SunEquatorial(DayJulian).DeclinationRad, DayLst);
    const double SunError = std::fabs(std::asin(DaySun.Z) - CoreSun.ElevationRad) / DegToRad;
    Check.Check("sun elevation vs CelestialModel (deg)", SunError < 0.05, SunError);
    std::printf("INFO sun at 16:30 SAST: elevation %.3f deg, azimuth %.3f deg\n", CoreSun.ElevationRad / DegToRad,
                CoreSun.AzimuthRad / DegToRad);

    // Equatorial round trip.
    double RaBack = 0.0, DecBack = 0.0;
    LocalToEquatorial(EquatorialToLocal(1.2, -0.4, NightLst), NightLst, RaBack, DecBack);
    const double RoundTrip = std::fabs(std::remainder(RaBack - 1.2, 2.0 * Pi)) + std::fabs(DecBack + 0.4);
    Check.Check("equatorial round trip (rad)", RoundTrip < 1e-9, RoundTrip);

    // Atmosphere: LUT bake and sky colour sanity (zenith blue, forward scattering toward the sun).
    Frontier::AtmosphereParameters Atmosphere;
    Frontier::TransmittanceLut Lut;
    Check.Check("transmittance LUT baked", Lut.Bake(Atmosphere), 1.0);
    const Radiance Zenith = ScatteredSky(Atmosphere, Lut, {0.0, 0.0, 1.0}, DaySun);
    const SkyVector AwayFromSun = Normalize({-DaySun.X, -DaySun.Y, 0.5});   // antisolar, about 30 deg up
    const Radiance Toward = ScatteredSky(Atmosphere, Lut, DaySun, DaySun);
    const Radiance Opposite = ScatteredSky(Atmosphere, Lut, AwayFromSun, DaySun);
    Check.Check("zenith sky is blue (B over R)", Zenith.B > Zenith.R, Zenith.B / Zenith.R);
    Check.Check("sky brighter toward the sun than away", Toward.R + Toward.G + Toward.B > Opposite.R + Opposite.G + Opposite.B,
                (Toward.R + Toward.G + Toward.B) / (Opposite.R + Opposite.G + Opposite.B));

    // Moon: geometry, raster, and the mean-age comparison as information only.
    std::vector<double> Geometric, Raster, ModelFraction;
    const Canvas Phases = RenderMoonPhases(NightJulian, 300, Geometric, Raster, ModelFraction);
    double WorstRaster = 0.0, WorstModel = 0.0;
    for (size_t I = 0; I < Geometric.size(); ++I)
    {
        WorstRaster = std::max(WorstRaster, std::fabs(Raster[I] - Geometric[I]));
        WorstModel = std::max(WorstModel, std::fabs(Geometric[I] - ModelFraction[I]));
        std::printf("INFO phase %zu geometric %.4f raster %.4f mean-age %.4f\n", I, Geometric[I], Raster[I], ModelFraction[I]);
    }
    Check.Check("moon raster lit fraction vs geometry", WorstRaster < 0.01, WorstRaster);
    std::printf("INFO moon geometry vs mean-age model, worst gap %.4f (model difference, not a render check)\n", WorstModel);
    Check.Check("phase strip runs new (0) to full (2)", Geometric[0] < 0.1 && Geometric[2] > 0.9, Geometric[2]);

    const SkyVector NightMoon = EquatorialToLocal(MoonEquatorial(NightJulian).RightAscensionRad,
                                                  MoonEquatorial(NightJulian).DeclinationRad, NightLst);
    const SkyVector NightSun = EquatorialToLocal(SunEquatorial(NightJulian).RightAscensionRad,
                                                 SunEquatorial(NightJulian).DeclinationRad, NightLst);
    const SceneLight NightLight{NightSun, NightMoon, std::asin(NightSun.Z), NightFactor(std::asin(NightSun.Z))};
    std::printf("INFO moon at 20:30 SAST: altitude %.2f deg, illuminated %.3f\n", std::asin(NightMoon.Z) / DegToRad,
                GeometricIlluminatedFraction(SunEquatorial(NightJulian), MoonEquatorial(NightJulian)));

    // Moon close-up: check the disc area in pixels against pi r^2.
    const int CloseSize = 720;
    int DiscPixels = 0;
    const Canvas Close = RenderMoonCloseUp(NightMoon, NightSun, CloseSize, &DiscPixels);
    const double ClosePixelRadius = 0.42 * CloseSize * 0.5;
    const double ExpectedDiscPixels = Pi * ClosePixelRadius * ClosePixelRadius;
    Check.Check("moon close-up disc area vs pi r^2", std::fabs(DiscPixels - ExpectedDiscPixels) < 0.03 * ExpectedDiscPixels,
                DiscPixels / ExpectedDiscPixels);

    // Night field: Milky Way aimed at the brightest band point above 25 degrees, and a field centred on the Moon.
    SkyVector BestAim{0.0, 1.0, 0.0};
    double BestScore = -1.0;
    for (double Azimuth = 0.0; Azimuth < 360.0; Azimuth += 2.0)
        for (double Altitude = 25.0; Altitude <= 45.0; Altitude += 2.0)
        {
            const double Az = Azimuth * DegToRad, Al = Altitude * DegToRad;
            const SkyVector Aim{std::cos(Al) * std::sin(Az), std::cos(Al) * std::cos(Az), std::sin(Al)};
            const SkyVector Pole = EquatorialToLocal(192.85948 * DegToRad, 27.12825 * DegToRad, NightLst);
            const double Latitude = std::asin(std::clamp(Dot(Aim, Pole), -1.0, 1.0));
            const double Score = std::exp(-std::pow(Latitude / 0.12, 2.0));
            if (Score > BestScore) { BestScore = Score; BestAim = Aim; }
        }
    uint32_t StarCountMilky = 0, StarCountMoon = 0;
    const Canvas MilkyWay = RenderNightField(BestAim, 1280, 800, StandardHalfTangent * 1.4, NightLst, NightLight, Catalogue,
                                             &StarCountMilky);
    Check.Check("night field stars drawn (Milky Way aim)", StarCountMilky > 3000, static_cast<double>(StarCountMilky));
    const Canvas MoonField = RenderNightField(NightMoon, 1280, 800, StandardHalfTangent * 1.8, NightLst, NightLight,
                                              Catalogue, &StarCountMoon);
    Check.Check("moon field stars drawn", StarCountMoon > 3000, static_cast<double>(StarCountMoon));

    // Sun-disc lens flare: aim so the sun is right of and above centre, leaving ghosts on the opposite side.
    const SkyVector SunEast = Normalize(Cross(DaySun, {0.0, 0.0, 1.0}));
    const SkyVector SunUp = Cross(SunEast, DaySun);
    const SkyVector DayAim = Normalize(DaySun - SunEast * (0.55 * StandardHalfTangent) - SunUp * (0.25 * StandardHalfTangent));
    std::array<Frontier::FlareGhost, 6> Ghosts{};
    const Canvas Flare = RenderSunFlare(DayAim, DaySun, 1.0, Atmosphere, Lut, &Ghosts);
    std::array<Frontier::FlareGhost, 6> HiddenGhosts{};
    const Canvas FlareHidden = RenderSunFlare(DayAim, DaySun, 0.0, Atmosphere, Lut, &HiddenGhosts);
    double HiddenStrength = 0.0;
    for (const Frontier::FlareGhost& Ghost : HiddenGhosts) HiddenStrength = std::max(HiddenStrength, Ghost.Strength);
    Check.Check("zero visibility removes every ghost", HiddenStrength == 0.0, HiddenStrength);

    // Rendering-level ghost check: residual (flare minus no-flare) centroid near each LensFlareModel position.
    const SkyCamera FlareCamera = MakeSkyCamera(DayAim, 1280, 800, StandardHalfTangent);
    double SunX = 0.0, SunY = 0.0;
    ScreenCoordinates(FlareCamera, DaySun, SunX, SunY);
    double CollinearityError = 0.0;
    for (size_t I = 0; I < Ghosts.size(); ++I)
    {
        const double Cross2 = Ghosts[I].PositionX * SunY - Ghosts[I].PositionY * SunX;
        CollinearityError = std::max(CollinearityError, std::fabs(Cross2));
    }
    Check.Check("ghost centres collinear with sun and frame centre", CollinearityError < 1e-12, CollinearityError);
    double WorstCentroidPixels = 0.0;
    int MeasuredGhosts = 0;
    for (size_t I = 0; I < Ghosts.size(); ++I)
    {
        if (Ghosts[I].Strength <= 0.0) continue;
        // Ghost alone: render with only this ghost, subtract the flare-off frame, and take the intensity centroid.
        const Canvas Alone = RenderSunFlare(DayAim, DaySun, 1.0, Atmosphere, Lut, nullptr, static_cast<int>(I));
        // Height-normalised units to pixels: half-height is 400 px and the frame centre is (640, 400).
        const double ExpectedX = 640.0 + Ghosts[I].PositionX * 400.0;
        const double ExpectedY = 400.0 - Ghosts[I].PositionY * 400.0;
        double SumWeight = 0.0, SumX = 0.0, SumY = 0.0;
        for (int Y = 0; Y < 800; ++Y)
            for (int X = 0; X < 1280; ++X)
            {
                const double Weight = std::max(0.0, Alone.At(X, Y).R - FlareHidden.At(X, Y).R);
                SumWeight += Weight;
                SumX += Weight * (X + 0.5);
                SumY += Weight * (Y + 0.5);
            }
        if (SumWeight <= 0.0) continue;
        ++MeasuredGhosts;
        const double Error = std::hypot(SumX / SumWeight - ExpectedX, SumY / SumWeight - ExpectedY);
        WorstCentroidPixels = std::max(WorstCentroidPixels, Error);
        std::printf("INFO ghost %zu expected (%.1f, %.1f) px, isolated centroid error %.2f px\n", I, ExpectedX, ExpectedY, Error);
    }
    Check.Check("rendered ghost centroids within 2 px", MeasuredGhosts >= 5 && WorstCentroidPixels < 2.0, WorstCentroidPixels);

    // Dusk sweep at a fixed azimuth: 14 deg above to 18 deg below the horizon.
    const SkyVector GalacticPole = EquatorialToLocal(192.85948 * DegToRad, 27.12825 * DegToRad, NightLst);
    const SkyVector GalacticCentre = EquatorialToLocal(266.40499 * DegToRad, -28.93618 * DegToRad, NightLst);
    const std::array<double, 6> DuskElevations{14.0, 2.0, -2.0, -6.0, -12.0, -18.0};
    std::vector<Canvas> Dusk;
    for (double Elevation : DuskElevations)
        Dusk.push_back(RenderDuskFrame(Elevation * DegToRad, Atmosphere, Lut, GalacticPole, GalacticCentre, Catalogue, NightLst));
    const Radiance Horizon = Dusk[2].At(240, 246);   // sample just above the horizon, toward the sun column
    Check.Check("sunset horizon is warm (R over B) at -2 deg", Horizon.R > Horizon.B, Horizon.R / Horizon.B);

    const bool Wrote = WritePpm(OutputPrefix + "NightField.ppm", MilkyWay, 1.0) &&
                       WritePpm(OutputPrefix + "MoonField.ppm", MoonField, 1.0) &&
                       WritePpm(OutputPrefix + "MoonClose.ppm", Close, 1.0) &&
                       WritePpm(OutputPrefix + "MoonPhases.ppm", Phases, 1.0) &&
                       WritePpm(OutputPrefix + "SunFlare.ppm", Flare, 1.0);
    bool WroteDusk = true;
    for (size_t I = 0; I < Dusk.size(); ++I)
        WroteDusk = WroteDusk && WritePpm(OutputPrefix + "Dusk" + std::to_string(I) + ".ppm", Dusk[I], 1.0);
    Check.Check("PPM outputs written", Wrote && WroteDusk, Wrote && WroteDusk ? 1.0 : 0.0);

    std::printf("SUMMARY passed %d failed %d\n", Check.Passed, Check.Failed);
    return Check.Failed == 0 ? 0 : 1;
}
