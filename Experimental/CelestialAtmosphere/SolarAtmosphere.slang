/*============================================================================================================================================
                                                        SOLARATMOSPHERE.SLANG
============================================================================================================================================*/
// 🧩 Finite solar disc, six lens components, finite-source extinction, chromosphere and quiet-Sun Thomson corona.

// 📝 The software ICD's generic sine loses relative accuracy at milliradian disc radii. Preserve the
// reused solar implementation, but evaluate its small-angle sine with a bounded Float32 polynomial.
float CelestialSine(float Angle)
{
    float Reduced = Angle - 2 * CelestialPi * floor(Angle / (2 * CelestialPi) + .5);
    if (Reduced > .5 * CelestialPi) Reduced = CelestialPi - Reduced;
    if (Reduced < -.5 * CelestialPi) Reduced = -CelestialPi - Reduced;
    float Squared = Reduced * Reduced;
    return Reduced *
           (1 + Squared *
                    (-1.0 / 6 +
                     Squared * (1.0 / 120 + Squared * (-1.0 / 5040 +
                                                       Squared * (1.0 / 362880 + Squared * (-1.0 / 39916800 +
                                                                                            Squared / 6227020800))))));
}
float CelestialCosine(float Angle)
{
    float Reduced  = Angle - 2 * CelestialPi * floor(Angle / (2 * CelestialPi) + .5);
    float Polarity = 1;
    if (Reduced > .5 * CelestialPi)
    {
        Reduced  = CelestialPi - Reduced;
        Polarity = -1;
    }
    if (Reduced < -.5 * CelestialPi)
    {
        Reduced  = -CelestialPi - Reduced;
        Polarity = -1;
    }
    float Squared = Reduced * Reduced;
    return Polarity *
           (1 + Squared * (-.5 + Squared * (1.0 / 24 +
                                            Squared * (-1.0 / 720 +
                                                       Squared * (1.0 / 40320 +
                                                                  Squared * (-1.0 / 3628800 + Squared / 479001600))))));
}
float CelestialArctangent2(float Y, float X)
{
    float Maximum = max(abs(X), abs(Y));
    if (Maximum == 0) return 0;
    float Ratio       = min(abs(X), abs(Y)) / Maximum;
    bool  UpperOctant = Ratio > .414213562373095;
    float Reduced     = UpperOctant ? (Ratio - 1) / (Ratio + 1) : Ratio;
    float Squared     = Reduced * Reduced;
    float Angle =
        Reduced *
        (1 + Squared *
                 (-1.0 / 3 +
                  Squared *
                      (1.0 / 5 +
                       Squared * (-1.0 / 7 +
                                  Squared * (1.0 / 9 + Squared * (-1.0 / 11 +
                                                                  Squared * (1.0 / 13 + Squared * (-1.0 / 15 +
                                                                                                   Squared / 17))))))));
    if (UpperOctant) Angle += .25 * CelestialPi;
    if (abs(Y) > abs(X)) Angle = .5 * CelestialPi - Angle;
    if (X < 0) Angle = CelestialPi - Angle;
    return Y < 0 ? -Angle : Angle;
}
#define sin CelestialSine
#define cos CelestialCosine
#define atan2 CelestialArctangent2
#include "../../Frontier/Engine/Rendering/Shaders/SolarOptics.slang"
#undef atan2
#undef cos
#undef sin
#include "CelestialLens.slang"

groupshared float3 CelestialBeamReduction[64];

//------------------------------------------------------------------------------------------------------------------------
//                                            SPECTRAL FINITE-SOURCE VISIBILITY / FLARE
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")][numthreads(64, 1, 1)] void ResolveAtmosphericSolarFlux(uint3 Thread
                                                                           : SV_GroupThreadID)
{
    uint   Lane = Thread.x;
    float3 Sum  = 0;
    float3 Sun  = Configuration(4).xyz, Right, Up;
    SolarBasis(Sun, Configuration(2).xyz, Configuration(3).xyz, Right, Up);
    for (uint Sample = Lane; Sample < SolarSourceSampleCount; Sample += 64)
    {
        float4 Source       = SolarPayload(8 + Sample);
        float3 Direction    = Unit(Sun + Right * Source.x + Up * Source.y);
        float3 Visibility   = OutputColour[SolarVisibilityStart() + Sample].xyz;
        float3 Transmission = Configuration(10).x > .5 ? SunTransmission(Configuration(0).xyz, Direction) : float3(1);
        Sum += Source.z * Visibility * Transmission;
    }
    CelestialBeamReduction[Lane] = Sum;
    GroupMemoryBarrierWithGroupSync();
    if (Lane == 0)
    {
        float3 Total = 0;
        for (uint Index = 0; Index < 64; ++Index)
            Total += CelestialBeamReduction[Index];
        Counters[23] = asuint(Total.x);
        Counters[24] = asuint(Total.y);
        Counters[25] = asuint(Total.z);
    }
}

float3 SolarFlux()
{
    return Configuration(5).xyz * Configuration(5).w *
           float3(asfloat(Counters[23]), asfloat(Counters[24]), asfloat(Counters[25]));
}
float2 SolarScreen()
{
    float3 Sun   = Configuration(4).xyz;
    float  Depth = dot(Sun, Configuration(1).xyz);
    return float2(dot(Sun, Configuration(2).xyz), dot(Sun, Configuration(3).xyz)) /
           (max(1e-6, Depth) * Configuration(1).w);
}
float3 SolarPixel(float2 Coordinate)
{
    float3 Sun   = Configuration(4).xyz;
    float  Depth = dot(Sun, Configuration(1).xyz);
    if (Depth <= 1e-6 || Configuration(10).z < .5 || Configuration(5).w == 0) return 0;
    float3 Right, Up;
    SolarBasis(Sun, Configuration(2).xyz, Configuration(3).xyz, Right, Up);
    float2 ScreenSun = float2(dot(Sun, Configuration(2).xyz), dot(Sun, Configuration(3).xyz)) / Depth;
    float  ScaleX = Depth * dot(Configuration(2).xyz, Right), ScaleY = Depth * dot(Configuration(3).xyz, Up);
    float  Shear     = Depth * dot(Configuration(3).xyz, Right);
    float2 PixelSize = float2(2 * Configuration(1).w * Configuration(2).w * ScaleX / Extent.History.x,
                              2 * Configuration(1).w * ScaleY / Extent.History.y);
    if (any(PixelSize <= 0)) return 0;
    float2 Ndc                  = 2 * Coordinate / float2(Extent.History.xy) - 1;
    Ndc.y                       = -Ndc.y;
    float2 Projection           = Ndc * float2(Configuration(1).w * Configuration(2).w, Configuration(1).w) - ScreenSun;
    float2 Delta                = float2(Projection.x * ScaleX + Projection.y * Shear, Projection.y * ScaleY);
    float3 Disc                 = SolarDiscPixel(Delta, PixelSize, Sun, Right, Up);
    float3 Visibility           = float3(asfloat(Counters[20]), asfloat(Counters[21]), asfloat(Counters[22]));
    float3 Beam                 = float3(asfloat(Counters[23]), asfloat(Counters[24]), asfloat(Counters[25]));
    float3 AveragedTransmission = Beam / max(1e-8, Visibility);
    float3 ResolvedTransmission =
        Configuration(10).x > .5 ? SunTransmission(Configuration(0).xyz, CameraRay(Coordinate)) : float3(1);
    float RadiusPixels   = Configuration(4).w / max(PixelSize.x, PixelSize.y);
    float ResolvedWeight = smoothstep(3, 6, RadiusPixels);
    return Disc * lerp(AveragedTransmission, ResolvedTransmission, ResolvedWeight) * Configuration(5).w;
}
float3 LensPixel(float2 Coordinate)
{
    if (dot(Configuration(4).xyz, Configuration(1).xyz) <= 0) return 0;
    float2 Pixel = float2(2 * Coordinate.x - Extent.History.x, Extent.History.y - 2 * Coordinate.y) / Extent.History.y;
    return Configuration(33).x > .5 ? SolarLensFlare(Pixel, SolarScreen(), SolarFlux())
                                    : ExperimentalLensFlare(Pixel, SolarScreen(), SolarFlux());
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SOLAR ATMOSPHERE / CORONA
//------------------------------------------------------------------------------------------------------------------------

float CoronaDensity(float Radius)
{
    // 📝 Quiet equatorial corona: Allen-type electron-density law [cm^-3], valid only outside the photosphere.
    return Configuration(20).y * 1e8 * (2.99 * pow(Radius, -16) + 1.55 * pow(Radius, -6) + .036 * pow(Radius, -1.5));
}
float3 SolarAtmosphericRadiance(float3 Direction)
{
    if (Configuration(10).z < .5 || Configuration(5).w == 0 || Configuration(21).x + Configuration(21).y == 0) return 0;
    float Facing = dot(Direction, Configuration(4).xyz);
    if (Facing <= 0) return 0;
    float Impact = length(cross(Direction, Configuration(4).xyz)) / CelestialSine(Configuration(4).w);
    float Outer  = Configuration(20).z;
    if (Impact >= Outer) return 0;
    float ExtentZ  = sqrt(max(0, Outer * Outer - Impact * Impact));
    float End      = Impact < 1 ? -sqrt(max(0, 1 - Impact * Impact)) : ExtentZ;
    float Step     = (End + ExtentZ) / 96;
    float Integral = 0;
    for (uint Index = 0; Index < 96; ++Index)
    {
        float Along    = -ExtentZ + (Index + .5) * Step;
        float Radius   = max(1, sqrt(Impact * Impact + Along * Along));
        float Dilution = 2 * CelestialPi * (1 - sqrt(max(0, 1 - 1 / (Radius * Radius))));
        float Phase    = RayleighPhase(Along / Radius);
        Integral += CoronaDensity(Radius) * 6.6524587321e-25 * Configuration(20).x * 1e5 * Dilution * Phase * Step;
    }
    float  SolidAngle   = 4 * CelestialPi * pow(CelestialSine(.5 * Configuration(4).w), 2);
    float  MeanLimb     = 1 - SolarPayload(2).x / 3 - SolarPayload(2).y / 6;
    float3 Centre       = Configuration(5).xyz / (SolidAngle * MeanLimb);
    float  Chromosphere = Impact > 1 ? 2e-5 * exp(-(Impact - 1) * Configuration(20).x / Configuration(20).w) : 0;
    return Configuration(5).w * Centre *
           (Configuration(21).x * Integral * MeanLimb + Configuration(21).y * Chromosphere * float3(1, .055, .018));
}
[shader("compute")][numthreads(64, 1, 1)] void RenderSolarAtmosphere(uint3 Dispatch
                                                                     : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x) return;
    float2 Coordinate = float2(Pixel % Extent.History.x, Pixel / Extent.History.x) + .5;
    float3 Direction  = CameraRay(Coordinate);
    float3 Disc       = SolarPixel(Coordinate);
    float3 Gas        = SolarAtmosphericRadiance(Direction);
    float  Impact     = length(cross(Direction, Configuration(4).xyz)) / CelestialSine(Configuration(4).w);
    if (Configuration(21).z > .5 && Impact < 1.035) Disc = Gas = 0;
    OutputColour[Pixel]                           = float4(Disc + Gas, 1);
    OutputColour[Extent.Dimensions.x + Pixel]     = float4(Disc, 1);
    OutputColour[2 * Extent.Dimensions.x + Pixel] = float4(Gas, 1);
}

    // 📝 Slang's single-bracket attributes require explicit layout with the C++ formatter.
    // clang-format off
[shader("compute")]
[numthreads(64, 1, 1)]
void RenderLensFlare(uint3 Dispatch : SV_DispatchThreadID)
// clang-format on
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x) return;
    float2 Coordinate                         = float2(Pixel % Extent.History.x, Pixel / Extent.History.x) + .5;
    float3 Flare                              = LensPixel(Coordinate);
    OutputColour[Pixel]                       = float4(SolarPixel(Coordinate) + Flare, 1);
    OutputColour[Extent.Dimensions.x + Pixel] = float4(Flare, 1);
}
