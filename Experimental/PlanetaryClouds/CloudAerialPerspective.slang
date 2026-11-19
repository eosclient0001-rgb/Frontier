/*==========================================================================================================================================
                                                        CLOUDAERIALPERSPECTIVE.SLANG
==========================================================================================================================================*/
// 🧩 Aerial scattering in front of premultiplied cloud radiance.

#ifndef FRONTIER_CLOUD_AERIAL_PERSPECTIVE
#define FRONTIER_CLOUD_AERIAL_PERSPECTIVE 1

#include "CloudTransport.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                                   AERIAL SCATTERING
//------------------------------------------------------------------------------------------------------------------------

struct CloudAirSegment
{
    float3 Radiance;
    float3 Transmittance;
};

CloudAirSegment IntegrateCloudAir(
    CloudSpecification Specification,
    float3             Origin,
    float3             Direction,
    float              LimitM,
    uint               Steps,
    bool               CloudShafts)
{
    CloudAirSegment Integral;
    Integral.Radiance      = float3(0.0);
    Integral.Transmittance = float3(1.0);
    float2 Atmosphere      = PlanetCloudSphere(Origin, Direction, Specification.RadiusM + 100000.0);
    float  EnterM          = max(0.0, Atmosphere.x);
    float  ExitM           = min(LimitM, Atmosphere.y);
    if (ExitM <= EnterM) return Integral;

    float  μ             = dot(Direction, Specification.SunDirection);
    float  RayleighPhase = (3.0 / (16.0 * Cloudπ)) * (1.0 + μ * μ);
    float  AerosolPhase  = CloudTransportHG(μ, 0.78);
    float3 βRayleigh     = QueryCloudRayleighExtinction(Specification);
    float3 βAerosol      = QueryCloudAerosolExtinction(Specification);
    float3 βOzone        = Specification.AtmosphereStrengths.z * float3(0.650e-6, 1.881e-6, 0.085e-6);

    // 📝 Cubic spacing around closest approach resolves dense air from either the ground or an orbital origin.
    float ClosestM = clamp(-dot(Origin, Direction), EnterM, ExitM);
    for (uint SideIndex = 0u; SideIndex < 2u; ++SideIndex)
    {
        float LengthM = SideIndex == 0u ? ClosestM - EnterM : ExitM - ClosestM;
        if (LengthM < 0.1) continue;
        float PreviousM = SideIndex == 0u ? EnterM : ClosestM;
        for (uint Index = 0u; Index < Steps; ++Index)
        {
            float Fraction       = float(Index + 1u) / float(Steps);
            float RadialFraction = SideIndex == 0u ? 1.0 - Fraction : Fraction;
            float DistanceM =
                ClosestM + LengthM * (0.30 * RadialFraction + 0.70 * RadialFraction * RadialFraction * RadialFraction) *
                               (SideIndex == 0u ? -1.0 : 1.0);
            float Δs                    = DistanceM - PreviousM;
            float MidpointM             = (DistanceM + PreviousM) * 0.5;
            PreviousM                   = DistanceM;
            float3 Position             = Origin + Direction * MidpointM;
            float  AltitudeM            = max(0.0, PlanetCloudAltitude(Position, Specification.RadiusM));
            float3 Rayleigh             = βRayleigh * exp(-AltitudeM / max(400.0, Specification.AirScaleHeightsM.x));
            float3 Aerosol              = βAerosol * exp(-AltitudeM / max(200.0, Specification.AirScaleHeightsM.y));
            float3 Ozone                = βOzone * saturate(1.0 - abs(AltitudeM - 25000.0) / 16000.0);
            float3 Extinction           = max(float3(1.0e-8), Rayleigh + Aerosol + Ozone);
            float3 SegmentTransmittance = exp(-Extinction * Δs);
            float3 SunTransmittance     = CloudSolarAirTransmittance(Specification, Position);
            float  SunUp                = dot(normalize(Position), Specification.SunDirection);
            float  Twilight             = smoothstep(-0.21, 0.095, SunUp + AltitudeM * 0.000002);
            float  Visibility           = 1.0;
            if (CloudShafts && μ > 0.69 && AltitudeM < 4300.0 && MidpointM < 65000.0 &&
                dot(SunTransmittance, SunTransmittance) > 0.0005)
            {
                Visibility = exp(-CloudSolarOpticalDepth(Specification, Position, 4u));
            }
            float3 Source = SunTransmittance * Visibility * (Rayleigh * RayleighPhase + 0.88 * Aerosol * AerosolPhase);
            Source += (Rayleigh + 0.48 * Aerosol) * Twilight * float3(0.019, 0.025, 0.034);
            Integral.Radiance += Integral.Transmittance * Specification.SolarIrradiance * Source *
                                 (1.0 - SegmentTransmittance) / Extinction;
            Integral.Transmittance *= SegmentTransmittance;
        }
    }
    return Integral;
}

// 📝 The optical centroid puts air in front of premultiplied cloud radiance. It is approximate for separated layers.
float3 CloudRadianceThroughAir(
    CloudSpecification     Specification,
    float3                 Origin,
    float3                 Direction,
    CloudTransportIntegral Cloud,
    uint                   AirSteps)
{
    if (Cloud.Transmittance >= 0.999999) return Cloud.Radiance;
    CloudAirSegment Front = IntegrateCloudAir(Specification, Origin, Direction, Cloud.DistanceM, AirSteps, false);
    return Front.Transmittance * Cloud.Radiance + (1.0 - Cloud.Transmittance) * Front.Radiance;
}

#endif
