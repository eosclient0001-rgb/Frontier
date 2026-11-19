/*==========================================================================================================================================
                                                            CLOUDTRANSPORT.SLANG
==========================================================================================================================================*/
// 🧩 Ordered spherical volume intervals, Beer attenuation and solar multiple-order scattering approximation.

#ifndef FRONTIER_PLANETARY_CLOUD_TRANSPORT
#define FRONTIER_PLANETARY_CLOUD_TRANSPORT

#include "CloudDensity.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                                  SPHERICAL INTERVALS
//------------------------------------------------------------------------------------------------------------------------

float PlanetCloudAltitude(float3 Position, float PlanetRadiusM)
{
    return length(Position) - PlanetRadiusM;
}

// 📝 Stable quadratic product avoids losing a near-surface root. Float32 planet coordinates still resolve only about
// half a metre.
float2 PlanetCloudSphere(float3 Position, float3 Direction, float RadiusM)
{
    float RadialDistanceM   = length(Position);
    float RayProjection     = dot(Position, Direction);
    float QuadraticConstant = (RadialDistanceM - RadiusM) * (RadialDistanceM + RadiusM);
    float Discriminant      = RayProjection * RayProjection - QuadraticConstant;
    if (Discriminant < 0.0) return float2(1.0, -1.0);
    float StableRoot    = -RayProjection - ((RayProjection < 0.0) ? -1.0 : 1.0) * sqrt(Discriminant);
    float CompanionRoot = (abs(StableRoot) > 1.0e-6) ? QuadraticConstant / StableRoot : StableRoot;
    return float2(min(StableRoot, CompanionRoot), max(StableRoot, CompanionRoot));
}

float PlanetCloudGroundDistance(float3 Origin, float3 Direction, float RadiusM)
{
    float2 Ground = PlanetCloudSphere(Origin, Direction, RadiusM);
    if (Ground.x > Ground.y || Ground.y <= 0.0) return 1.0e9;
    if (Ground.x > 0.0) return Ground.x;
    return (dot(Origin, Direction) < 0.0) ? 0.0 : 1.0e9;
}

float4 PlanetCloudLayerSpans(float3 Origin, float3 Direction, float RadiusM, CloudDeck Layer, float LimitM)
{
    float2 Outer = PlanetCloudSphere(Origin, Direction, RadiusM + Layer.TopM);
    Outer        = float2(max(0.0, Outer.x), min(LimitM, Outer.y));
    if (Outer.y <= Outer.x) return float4(0.0);
    float2 Inner = PlanetCloudSphere(Origin, Direction, RadiusM + Layer.BottomM);
    if (Inner.y <= Outer.x || Inner.x >= Outer.y || Inner.x >= Inner.y) return float4(Outer, 0.0, 0.0);
    return float4(Outer.x, min(Outer.y, Inner.x), max(Outer.x, Inner.y), Outer.y);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SOLAR EXTINCTION
//------------------------------------------------------------------------------------------------------------------------

float3 QueryCloudRayleighExtinction(CloudSpecification Specification)
{
    return float3(5.802e-6, 13.558e-6, 33.1e-6) * max(0.0, Specification.AtmosphereStrengths.x);
}

float3 QueryCloudAerosolExtinction(CloudSpecification Specification)
{
    return float3(4.40e-6) * max(0.0, Specification.AtmosphereStrengths.y);
}

float CloudAirColumn(float ScaleHeightM, float RadiusM, float AltitudeM, float μ)
{
    // Chapman tangent limit blended to the plane-parallel secant. On the
    // downward half of a grazing ray add the tangent column on the far side.
    float AbsoluteCosine = abs(μ);
    float UpwardColumnM =
        2.0 * ScaleHeightM /
        (AbsoluteCosine + sqrt(AbsoluteCosine * AbsoluteCosine + 8.0 * ScaleHeightM / (Cloudπ * RadiusM)));
    float ClosestApproachRiseM = (RadiusM + AltitudeM) * μ * μ / (1.0 + sqrt(saturate(1.0 - μ * μ)));
    float DownwardColumnM =
        sqrt(2.0 * Cloudπ * (RadiusM + AltitudeM) * ScaleHeightM) * exp(min(9.0, ClosestApproachRiseM / ScaleHeightM)) -
        UpwardColumnM;
    return exp(-max(0.0, AltitudeM) / ScaleHeightM) * ((μ < 0.0) ? DownwardColumnM : UpwardColumnM);
}

float3 CloudSolarAirTransmittance(CloudSpecification Specification, float3 Position)
{
    float RadiusM         = length(Position);
    float AltitudeM       = max(0.0, RadiusM - Specification.RadiusM);
    float μ               = dot(Position, Specification.SunDirection) / RadiusM;
    float TangentBoundary = -sqrt(saturate(AltitudeM * (RadiusM + Specification.RadiusM) / (RadiusM * RadiusM)));
    // Finite solar disc (~0.53 degrees) across the planetary shadow boundary.
    float SolarVisibility = smoothstep(-0.00465, 0.00465, μ - TangentBoundary);
    if (SolarVisibility <= 0.0) return float3(0.0);
    float RayleighColumnM =
        CloudAirColumn(max(400.0, Specification.AirScaleHeightsM.x), Specification.RadiusM, AltitudeM, μ);
    float AerosolColumnM =
        CloudAirColumn(max(200.0, Specification.AirScaleHeightsM.y), Specification.RadiusM, AltitudeM, μ);
    float  OzoneColumnM = 15000.0 * exp(-max(0.0, AltitudeM - 25000.0) / 8000.0) / max(0.15, abs(μ));
    float3 τ            = QueryCloudRayleighExtinction(Specification) * RayleighColumnM +
               QueryCloudAerosolExtinction(Specification) * AerosolColumnM +
               Specification.AtmosphereStrengths.z * float3(0.650e-6, 1.881e-6, 0.085e-6) * OzoneColumnM;
    return SolarVisibility * exp(-τ);
}

float IntegrateCloudSolarDepth(
    CloudSpecification Specification, CloudDeck Layer, float3 Position, float2 Span, uint Steps, float FootprintM)
{
    if (Span.y <= Span.x) return 0.0;
    // 📝 Every intersected solar interval is covered; there is no 12.5 km shadow truncation or alternate weather field.
    float LengthM = Span.y - Span.x;
    float τ       = 0.0;
    float StartM  = 0.0;
    for (uint Index = 0u; Index < Steps; ++Index)
    {
        float  Fraction       = float(Index + 1u) / float(Steps);
        float  EndM           = LengthM * Fraction * Fraction;
        float  SampleM        = Span.x + 0.5 * (StartM + EndM);
        float  SegmentM       = EndM - StartM;
        float3 SamplePosition = Position + Specification.SunDirection * SampleM;
        // 📝 Endpoint weather interpolation changed condensate along a light ray. Evaluate the same world field
        // as a view sample; filtering may differ with footprint, but weather itself must never be substituted.
        CloudWeatherSample Weather = CloudWeatherAtPoint(Specification, SamplePosition, Layer.Category);
        float              Sampleσ = SamplePlanetCloudDensity(Specification, Layer, SamplePosition, Weather,
                                                              max(FootprintM, 8.0 + 0.12 * SegmentM), true);
        τ += SegmentM * Sampleσ;
        if (τ >= 18.0) return 18.0;
        StartM = EndM;
    }
    return τ;
}

float CloudSolarOpticalDepth(CloudSpecification Specification, float3 Position, uint Steps, float FootprintM = 0.0)
{
    if (!Specification.UseClouds || !Specification.UseCloudShadows || Specification.Coverage <= 0.001 ||
        Specification.Extinction <= 0.001)
        return 0.0;
    float     LimitM = PlanetCloudGroundDistance(Position, Specification.SunDirection, Specification.RadiusM);
    float     τ      = 0.0;
    CloudDeck Layer  = PlanetCloudLayer(Specification, 0u);
    float4    Spans = PlanetCloudLayerSpans(Position, Specification.SunDirection, Specification.RadiusM, Layer, LimitM);
    [loop] for (uint IntervalIndex = 0u; IntervalIndex < 2u && τ < 18.0; ++IntervalIndex)
    {
        float2 Span = IntervalIndex == 0u ? Spans.xy : Spans.zw;
        τ += IntegrateCloudSolarDepth(Specification, Layer, Position, Span, Steps, FootprintM);
    }
    return min(18.0, τ);
}

//------------------------------------------------------------------------------------------------------------------------
//                                          NORMALIZED PHASE AND REDISTRIBUTED LIGHT
//------------------------------------------------------------------------------------------------------------------------

float CloudTransportHG(float μ, float Asymmetry)
{
    float AsymmetrySquared   = Asymmetry * Asymmetry;
    float AngularDenominator = max(1.0e-4, 1.0 + AsymmetrySquared - 2.0 * Asymmetry * μ);
    return (1.0 - AsymmetrySquared) / (4.0 * Cloudπ * AngularDenominator * sqrt(AngularDenominator));
}

float CloudDualLobe(float μ, float Asymmetry, float Scale)
{
    return 0.86 * CloudTransportHG(μ, Asymmetry * Scale) + 0.14 * CloudTransportHG(μ, -0.25 * Scale);
}

float3 CloudScatteringOrderPhases(CloudSpecification Specification, float3 Direction)
{
    float μ         = dot(Direction, Specification.SunDirection);
    float Asymmetry = clamp(Specification.PhaseG, 0.40, 0.92);
    return float3(CloudDualLobe(μ, Asymmetry, 1.0), CloudDualLobe(μ, Asymmetry, 0.49),
                  CloudDualLobe(μ, Asymmetry, 0.19));
}

float3 PlanetCloudSource(
    CloudSpecification Specification, CloudDeck Layer, float3 Position, float σ, float3 OrderPhases, float FootprintM)
{
    float3 Direct = Specification.SolarIrradiance * CloudSolarAirTransmittance(Specification, Position);
    float  Solarτ = 0.0;
    if (dot(Direct, Direct) > 1.0e-6)
        Solarτ = CloudSolarOpticalDepth(Specification, Position, Specification.LightSteps, FootprintM);
    // 📝 Three attenuated angular orders approximate redistributed solar light. Reduced optical depth broadens
    // higher orders, but does not replace their depth attenuation with a bright altitude-constant source.
    // These fitted orders are not a solved, energy-conserving three-dimensional multiple-scattering field.
    float3 AttenuatedOrders = exp(-Solarτ * float3(1.0, 0.35, 0.12));
    float3 Scattered        = Direct * dot(OrderPhases * float3(1.0, 0.45, 0.20), AttenuatedOrders);

    float HeightFraction =
        saturate((PlanetCloudAltitude(Position, Specification.RadiusM) - Layer.BottomM) / (Layer.TopM - Layer.BottomM));
    float SunUp = dot(normalize(Position), Specification.SunDirection);
    float Day   = smoothstep(-0.20, 0.23, SunUp);
    float Warm  = exp(-abs(SunUp - 0.045) * 9.5) * smoothstep(-0.20, -0.025, SunUp);
    // At positive solar elevations the directional depth is also a useful
    // local proxy for sky occlusion. Do not use it as a hemispheric estimate
    // at twilight, where even a clear zenith has a long horizontal path.
    float  SkyVisibility = lerp(1.0, 0.16 + 0.84 * exp(-0.24 * Solarτ), smoothstep(0.12, 0.50, SunUp));
    float  Twilight      = smoothstep(-0.30, -0.12, SunUp);
    float3 Sky =
        Specification.SkyAmbient * (0.025 * Twilight + 0.36 * Day) * lerp(0.48, 1.0, HeightFraction) * SkyVisibility;
    float3 Bounce = (1.0 - HeightFraction) * (float3(0.032, 0.048, 0.071) * Day + float3(0.077, 0.029, 0.015) * Warm);
    return Scattered + Sky + Bounce * (dot(Specification.SolarIrradiance, float3(0.3333333)) / 16.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  ORDERED VIEW INTEGRATION
//------------------------------------------------------------------------------------------------------------------------

CloudTransportIntegral TracePlanetaryClouds(
    CloudSpecification Specification, float3 Origin, float3 Direction, float2 Pixel, float LimitM)
{
    CloudTransportIntegral Integral;
    Integral.Radiance      = float3(0.0);
    Integral.Transmittance = 1.0;
    Integral.DistanceM     = 0.0;
    if (!Specification.UseClouds || Specification.Coverage <= 0.0 || Specification.Extinction <= 0.0) return Integral;
    LimitM                  = min(LimitM, PlanetCloudGroundDistance(Origin, Direction, Specification.RadiusM));
    CloudDeck Layer         = PlanetCloudLayer(Specification, 0u);
    float4    Spans         = PlanetCloudLayerSpans(Origin, Direction, Specification.RadiusM, Layer, LimitM);
    float     ViewAltitudeM = length(Origin) - Specification.RadiusM;
    float     Jitter        = CloudBlueJitter(Pixel);
    float3    Phases        = CloudScatteringOrderPhases(Specification, Direction);
    for (uint IntervalIndex = 0u; IntervalIndex < 2u; ++IntervalIndex)
    {
        float NearM = IntervalIndex == 0u ? Spans.x : Spans.z;
        float FarM  = IntervalIndex == 0u ? Spans.y : Spans.w;
        if (FarM <= NearM) continue;
        float  LengthM     = FarM - NearM;
        float  Growth      = ViewAltitudeM > 19000.0 ? 0.0 : clamp(log(1.0 + LengthM / 1900.0), 0.1, 4.8);
        float  Denominator = max(1.0e-6, exp(Growth) - 1.0);
        float  LastM       = NearM;
        float  LitAtM      = -1.0e9;
        float3 Source      = float3(0.0);
        for (uint Index = 0u; Index < Specification.Steps && Integral.Transmittance > 0.0001; ++Index)
        {
            float  Fraction = float(Index + 1u) / float(Specification.Steps);
            float  NextM = NearM + LengthM * (Growth < 0.01 ? Fraction : (exp(Growth * Fraction) - 1.0) / Denominator);
            float  DistanceM           = NextM - LastM;
            float  SampleM             = LastM + DistanceM * (0.40 + Jitter * 0.20);
            float3 Position            = Origin + Direction * SampleM;
            float  FootprintM          = max(1.0, SampleM * Specification.PixelAngle);
            CloudWeatherSample Weather = CloudWeatherAtPoint(Specification, Position, Layer.Category);
            float σ = SamplePlanetCloudDensity(Specification, Layer, Position, Weather, FootprintM, false);
            if (σ > 1.0e-9)
            {
                float SegmentTransmittance = exp(-σ * DistanceM);
                float Weight               = Integral.Transmittance * (1.0 - SegmentTransmittance);
                float LightStrideM         = clamp(FootprintM * 0.5 + 55.0, 55.0, 160.0);
                if (SampleM - LitAtM >= LightStrideM)
                {
                    Source = PlanetCloudSource(Specification, Layer, Position, σ, Phases, FootprintM);
                    LitAtM = SampleM;
                }
                Integral.Radiance += Weight * Source;
                Integral.DistanceM += Weight * SampleM;
                Integral.Transmittance *= SegmentTransmittance;
            }
            else
            {
                LitAtM = -1.0e9;
            }
            LastM = NextM;
        }
    }
    Integral.DistanceM /= max(1.0e-9, 1.0 - Integral.Transmittance);
    return Integral;
}

#endif
