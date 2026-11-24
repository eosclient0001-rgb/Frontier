/*============================================================================================================================================
                                                         ATMOSPHERELIMBRASTER.CPP
============================================================================================================================================*/
// 🧩 SkyShader.js fragment program (SphereHit, Densities, Extinction, SunThrough, Sky, stars, exposure, dither) in 32-bit floats like the GPU

#include "Engine/Editor/Inspectors/AtmosphereLimbRaster.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   SHADER CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

constexpr float Pi              = 3.14159265f;  // [-]   - SkyGlsl PI
constexpr float DegreesToRadian = Pi / 180.0f;  // [-]   - Rad
constexpr float SunPower        = 22.0f;        // [-]   - Light.Power default
constexpr float LimbExposure    = 0.9f;         // [-]   - LimbView Exposure
constexpr float LimbStars       = 1.0f;         // [-]   - LimbView Stars
constexpr float LimbGroundShare = 0.25f;        // [-]   - Ground drawn at 25 % of the authored albedo from orbit
constexpr int   SkySteps        = 20;           // [count] - Primary ray march steps
constexpr int   SunSteps        = 6;            // [count] - Sun transmittance march steps

using Vec3 = std::array<float, 3>;

inline Vec3  Add(const Vec3& A, const Vec3& B) noexcept { return { A[0] + B[0], A[1] + B[1], A[2] + B[2] }; }
inline Vec3  Scale(const Vec3& A, float S) noexcept { return { A[0] * S, A[1] * S, A[2] * S }; }
inline Vec3  Multiply(const Vec3& A, const Vec3& B) noexcept { return { A[0] * B[0], A[1] * B[1], A[2] * B[2] }; }
inline float Dot(const Vec3& A, const Vec3& B) noexcept { return A[0] * B[0] + A[1] * B[1] + A[2] * B[2]; }
inline float Length(const Vec3& A) noexcept { return std::sqrt(Dot(A, A)); }
inline Vec3  Normalize(const Vec3& A) noexcept { const float L = Length(A); return L > 0.0f ? Scale(A, 1.0f / L) : A; }
inline Vec3  Cross(const Vec3& A, const Vec3& B) noexcept { return { A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0] }; }
inline Vec3  ExpNegative(const Vec3& A) noexcept { return { std::exp(-A[0]), std::exp(-A[1]), std::exp(-A[2]) }; }
inline float Fract(float X) noexcept { return X - std::floor(X); }

struct SkyUniforms
{
    LimbSkyMedium Medium      {};
    Vec3          Sun         {};
    float         EyeAltitude = 0.0f;
};

struct SphereSpan
{
    float Near = -1.0f;
    float Far  = -1.0f;
};

SphereSpan SphereHit(const SkyUniforms& U, float B, float H, float Height) noexcept
{
    const float C = (H - Height) * (2.0f * U.Medium.Planet + H + Height);
    float       D = B * B - C;
    if (D < 0.0f)
    {
        return {};
    }
    D = std::sqrt(D);
    return { -B - D, -B + D };
}

Vec3 Densities(const SkyUniforms& U, float H) noexcept
{
    return { std::exp(-H / U.Medium.RayleighHeight), std::exp(-H / U.Medium.MieHeight), std::max(0.0f, 1.0f - std::fabs(H - 25000.0f) / 15000.0f) };
}

Vec3 Extinction(const SkyUniforms& U, const Vec3& N) noexcept
{
    const float Haze = U.Medium.Mie * 1.11f * N[1];
    return {
        U.Medium.Rayleigh[0] * N[0] + Haze + U.Medium.Ozone[0] * N[2],
        U.Medium.Rayleigh[1] * N[0] + Haze + U.Medium.Ozone[1] * N[2],
        U.Medium.Rayleigh[2] * N[0] + Haze + U.Medium.Ozone[2] * N[2],
    };
}

Vec3 SunThrough(const SkyUniforms& U, const Vec3& P) noexcept
{
    const float      H      = Length(P) - U.Medium.Planet;
    const float      B      = Dot(P, U.Sun);
    const SphereSpan Ground = SphereHit(U, B, H, 0.0f);
    if (Ground.Near > 0.0f)
    {
        return { 0.0f, 0.0f, 0.0f };
    }
    const float Span = SphereHit(U, B, H, U.Medium.Top).Far;
    if (Span <= 0.0f)
    {
        return { 1.0f, 1.0f, 1.0f };
    }
    const float Step  = Span / static_cast<float>(SunSteps);
    Vec3        Depth { 0.0f, 0.0f, 0.0f };
    for (int Index = 0; Index < SunSteps; ++Index)
    {
        const Vec3 Q = Add(P, Scale(U.Sun, Step * (static_cast<float>(Index) + 0.5f)));
        Depth        = Add(Depth, Scale(Extinction(U, Densities(U, Length(Q) - U.Medium.Planet)), Step));
    }
    return ExpNegative(Depth);
}

Vec3 Sky(const SkyUniforms& U, const Vec3& Eye, const Vec3& Ray, float Jitter, Vec3& OutThrough, bool& OutGround) noexcept
{
    OutThrough = { 1.0f, 1.0f, 1.0f };
    OutGround  = false;
    const float      B     = Dot(Eye, Ray);
    const SphereSpan Outer = SphereHit(U, B, U.EyeAltitude, U.Medium.Top);
    if (Outer.Far <= 0.0f)
    {
        return { 0.0f, 0.0f, 0.0f };
    }
    const float      Near = std::max(Outer.Near, 0.0f);
    float            Far  = Outer.Far;
    const SphereSpan Land = SphereHit(U, B, U.EyeAltitude, 0.0f);
    if (Land.Near > 0.0f)
    {
        Far       = Land.Near;
        OutGround = true;
    }
    const float Mu     = Dot(Ray, U.Sun);
    const float PhaseR = 3.0f / (16.0f * Pi) * (1.0f + Mu * Mu);
    const float G      = U.Medium.Lean;
    const float GG     = G * G;
    const float PhaseM = 3.0f / (8.0f * Pi) * ((1.0f - GG) * (1.0f + Mu * Mu)) / ((2.0f + GG) * std::pow(std::max(1e-4f, 1.0f + GG - 2.0f * G * Mu), 1.5f));
    Vec3        Sum   { 0.0f, 0.0f, 0.0f };
    Vec3        Depth { 0.0f, 0.0f, 0.0f };
    const float Span  = Far - Near;
    for (int Index = 0; Index < SkySteps; ++Index)
    {
        const float T0   = static_cast<float>(Index) / static_cast<float>(SkySteps);
        const float T1   = static_cast<float>(Index + 1) / static_cast<float>(SkySteps);
        const float Step = (T1 - T0) * Span;
        const Vec3  P    = Add(Eye, Scale(Ray, Near + (T0 + (T1 - T0) * Jitter) * Span));
        const Vec3  N    = Densities(U, Length(P) - U.Medium.Planet);
        const Vec3  E    = Scale(Extinction(U, N), Step);
        const Vec3  Seen = ExpNegative(Add(Depth, Scale(E, 0.5f)));
        const Vec3  Sun  = SunThrough(U, P);
        for (int Channel = 0; Channel < 3; ++Channel)
        {
            Sum[Channel] += Seen[Channel] * Sun[Channel] * (U.Medium.Rayleigh[Channel] * N[0] * PhaseR + U.Medium.Mie * N[1] * PhaseM) * Step;
        }
        Depth = Add(Depth, E);
    }
    OutThrough  = ExpNegative(Depth);
    Vec3 Colour = Scale(Sum, SunPower);
    if (OutGround)
    {
        const Vec3  P        = Add(Eye, Scale(Ray, Far));
        const Vec3  Normal   = Normalize(P);
        const float Lit      = std::max(Dot(Normal, U.Sun), 0.0f);
        const Vec3  Sunlight = SunThrough(U, Add(P, Scale(Normal, 2.0f)));
        const float Edge     = std::clamp((Dot(Normal, U.Sun) + 0.12f) / 0.37f, 0.0f, 1.0f);
        const float Twilight = Edge * Edge * (3.0f - 2.0f * Edge);
        for (int Channel = 0; Channel < 3; ++Channel)
        {
            const float Skylight = U.Medium.Rayleigh[Channel] * 9000.0f * Twilight;
            Colour[Channel] += OutThrough[Channel] * U.Medium.Ground[Channel] / Pi * (Sunlight[Channel] * Lit + Skylight) * SunPower;
        }
    }
    return Multiply(Scale(Colour, U.Medium.Gain), { U.Medium.Tint[0], U.Medium.Tint[1], U.Medium.Tint[2] });
}

inline float Noise(float X, float Y) noexcept
{
    return Fract(std::sin(X * 12.9898f + Y * 78.233f) * 43758.5453f);
}

inline float Hash(Vec3 P) noexcept
{
    for (float& Axis : P)
    {
        Axis = Fract(Axis * 0.3183099f + 0.1f) * 17.0f;
    }
    return Fract(P[0] * P[1] * P[2] * (P[0] + P[1] + P[2]));
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                   VIEW RESOLUTION
//------------------------------------------------------------------------------------------------------------------------

namespace AtmosphereLimbRaster
{

LimbSkyMedium ResolveMedium(const GeometricRaster::AtmosphericMediumConfiguration& Medium) noexcept
{
    LimbSkyMedium Out{};
    Out.Planet         = Medium.PlanetRadiusMeters;
    Out.Top            = Medium.AtmosphereThicknessMeters;
    Out.Rayleigh       = { 5.802e-6f * Medium.RayleighStrength, 13.558e-6f * Medium.RayleighStrength, 33.1e-6f * Medium.RayleighStrength };
    Out.RayleighHeight = std::max(200.0f, Medium.RayleighScaleHeightMeters);
    Out.Mie            = 3.996e-6f * Medium.MieStrength;
    Out.MieHeight      = std::max(50.0f, Medium.MieScaleHeightMeters);
    Out.Lean           = std::clamp(Medium.MieAnisotropy, -0.95f, 0.95f);
    Out.Ozone          = { 0.65e-6f * Medium.OzoneStrength / 1.2f, 1.881e-6f * Medium.OzoneStrength / 1.2f, 0.085e-6f * Medium.OzoneStrength / 1.2f };
    Out.Tint           = { Medium.SkyTint.R, Medium.SkyTint.G, Medium.SkyTint.B };
    Out.Gain           = Medium.SkyBrightnessMultiplier;
    Out.Ground         = { Medium.GroundAlbedo.R, Medium.GroundAlbedo.G, Medium.GroundAlbedo.B };
    return Out;
}

LimbViewSetup ResolveView(const LimbSkyMedium& Medium, float Aspect) noexcept
{
    LimbViewSetup View{};
    View.Planet           = Medium.Planet / LimbScale;
    const float Altitude  = 0.42f * View.Planet;
    View.Eye              = { 0.0f, View.Planet + Altitude, 0.0f };
    View.Dip              = std::acos(View.Planet / (View.Planet + Altitude));
    View.TanHalf          = std::tan(17.0f * DegreesToRadian);
    View.Aspect           = Aspect;
    const float Pitch     = View.Dip - std::atan(0.26f * View.TanHalf);
    View.Forward          = Normalize({ 0.0f, -std::sin(Pitch), std::cos(Pitch) });
    View.Right            = Normalize(Cross(View.Forward, { 0.0f, 1.0f, 0.0f }));
    View.Up               = Cross(View.Right, View.Forward);
    return View;
}

std::array<float, 3> ResolveSun(const LimbViewSetup& View, float ElevationDegrees) noexcept
{
    const float Elevation = ElevationDegrees * DegreesToRadian;
    const Vec3  Normal { 0.0f, std::cos(View.Dip), std::sin(View.Dip) };
    return Normalize({ std::cos(Elevation) + Normal[0] * std::sin(Elevation), Normal[1] * std::sin(Elevation), Normal[2] * std::sin(Elevation) });
}

std::vector<std::array<float, 2>> ResolveTopOutline(const LimbViewSetup& View, float Top) noexcept
{
    std::vector<std::array<float, 2>> Points{};
    const float Distance = Length(View.Eye);
    const float Half     = std::asin(std::min(1.0f, (View.Planet + Top) / Distance));
    for (int Step = 0; Step <= 96; ++Step)
    {
        const float Around = (static_cast<float>(Step) / 96.0f) * Pi;
        const Vec3  Ray { std::sin(Half) * std::cos(Around), -std::cos(Half), std::sin(Half) * std::sin(Around) };
        const float Ahead = Dot(Ray, View.Forward);
        if (Ahead <= 1e-6f)
        {
            continue;
        }
        const float X = 0.5f + Dot(Ray, View.Right) / Ahead / (View.TanHalf * View.Aspect) / 2.0f;
        const float Y = 0.5f - Dot(Ray, View.Up) / Ahead / View.TanHalf / 2.0f;
        if (X > -0.1f && X < 1.1f)
        {
            Points.push_back({ X, Y });
        }
    }
    return Points;
}

float ResolveTopThrough(const LimbViewSetup& View, float X, float Y) noexcept
{
    const float Sx  = (X * 2.0f - 1.0f) * View.TanHalf * View.Aspect;
    const float Sy  = (1.0f - Y * 2.0f) * View.TanHalf;
    const Vec3  Ray = Normalize(Add(View.Forward, Add(Scale(View.Right, Sx), Scale(View.Up, Sy))));
    const float Off = std::acos(std::clamp(-Ray[1], -1.0f, 1.0f));
    const float Top = Length(View.Eye) * std::sin(Off) - View.Planet;
    return std::round(std::clamp(Top, TopRangeMinimum, TopRangeMaximum) / 500.0f) * 500.0f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  FRAGMENT EVALUATION
//------------------------------------------------------------------------------------------------------------------------

void RasterizeLimb(const LimbSkyMedium& Medium, float SunElevationDegrees, uint32_t WidthPx, uint32_t HeightPx, std::vector<uint8_t>& OutPixels) noexcept
{
    OutPixels.assign(static_cast<std::size_t>(WidthPx) * HeightPx * 4u, 255u);
    if (WidthPx == 0u || HeightPx == 0u)
    {
        return;
    }
    const LimbViewSetup View = ResolveView(Medium, static_cast<float>(WidthPx) / static_cast<float>(HeightPx));

    SkyUniforms U{};
    U.Medium        = Medium;
    U.Medium.Planet = View.Planet;
    U.Medium.Ground = { Medium.Ground[0] * LimbGroundShare, Medium.Ground[1] * LimbGroundShare, Medium.Ground[2] * LimbGroundShare };
    U.Sun           = ResolveSun(View, SunElevationDegrees);
    U.EyeAltitude   = Length(View.Eye) - View.Planet;

    for (uint32_t Row = 0u; Row < HeightPx; ++Row)
    {
        // WebGL rows start at the bottom; the canvas copy puts the last GL row at the top
        const float FragY   = static_cast<float>(HeightPx - 1u - Row) + 0.5f;
        const float ScreenY = FragY / static_cast<float>(HeightPx) * 2.0f - 1.0f;
        for (uint32_t Column = 0u; Column < WidthPx; ++Column)
        {
            const float FragX   = static_cast<float>(Column) + 0.5f;
            const float ScreenX = FragX / static_cast<float>(WidthPx) * 2.0f - 1.0f;
            const Vec3  Ray     = Normalize(Add(View.Forward, Add(Scale(View.Right, ScreenX * View.TanHalf * View.Aspect), Scale(View.Up, ScreenY * View.TanHalf))));
            const float Jitter  = Noise(FragX, FragY);

            Vec3 Through{};
            bool Ground = false;
            Vec3 Colour = Sky(U, View.Eye, Ray, Jitter, Through, Ground);

            if (LimbStars > 0.0f && !Ground)
            {
                const Vec3  Cell   { std::floor(Ray[0] * 320.0f), std::floor(Ray[1] * 320.0f), std::floor(Ray[2] * 320.0f) };
                const float Star   = (Hash(Cell) >= 0.9975f ? 1.0f : 0.0f) * Hash(Add(Cell, { 7.0f, 7.0f, 7.0f }));
                const float Bright = (Colour[0] * 0.2126f + Colour[1] * 0.7152f + Colour[2] * 0.0722f) * LimbExposure;
                for (int Channel = 0; Channel < 3; ++Channel)
                {
                    Colour[Channel] += Star * Through[Channel] * LimbStars * 0.6f * std::exp(-Bright * 40.0f);
                }
            }

            const float     Dither = (Noise(FragY + 17.0f, FragX + 17.0f) - 0.5f) / 255.0f;
            const std::size_t Base = (static_cast<std::size_t>(Row) * WidthPx + Column) * 4u;
            for (int Channel = 0; Channel < 3; ++Channel)
            {
                float Mapped = 1.0f - std::exp(-Colour[Channel] * LimbExposure);
                Mapped       = std::pow(Mapped, 1.0f / 2.2f) + Dither;
                OutPixels[Base + static_cast<std::size_t>(Channel)] = static_cast<uint8_t>(std::lround(std::clamp(Mapped, 0.0f, 1.0f) * 255.0f));
            }
            OutPixels[Base + 3u] = 255u;
        }
    }
}

} // namespace AtmosphereLimbRaster

} // namespace Frontier
