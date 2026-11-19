/*==========================================================================================================================================
                                                             CLOUDCOMPUTE.SLANG
==========================================================================================================================================*/
// 🧩 Native-resolution cloud radiance and transmittance from the same Slang entry on CPU and Vulkan.

[[vk::binding(1, 0)]] StructuredBuffer<uint> PlanetaryCloudNoise;
#ifdef FRONTIER_CLOUD_TEXTURES
[[vk::binding(4, 0)]] Texture3D<float4> CloudShapeTexture;
[[vk::binding(5, 0)]] Texture3D<float4> CloudErosionTexture;
[[vk::binding(6, 0)]] SamplerState CloudVolumeSampler;
#endif
#include "CloudAerialPerspective.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                                    INPUT/OUTPUT STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct CloudCaptureFootprint
{
    float4 OriginTime;
    float4 ForwardWindX;
    float4 RightTanX;
    float4 UpTanY;
    float4 SunIntensity;
    float4 FloorThicknessCoverageExtinction;
    float4 ScaleSeedPhaseExposure;
    float4 AirWindY;
    float4 Flow;
    float4 Cyclone;
    float4 CycloneAxis;
    uint4  Selection;
    uint4  Size;
    uint4  Tile;
    uint4  Switches;
};

[[vk::binding(0, 0)]] ConstantBuffer<CloudCaptureFootprint> Capture;
[[vk::binding(2, 0)]] RWStructuredBuffer<float4>            CloudPixels;
[[vk::binding(3, 0)]] StructuredBuffer<uint>                PlanetSurface;
CloudSpecification QueryCloudSpecification()
{
    CloudSpecification Specification;
    Specification.RadiusM             = Capture.Selection.x == 2u ? 1737400.0 : 6371000.0;
    Specification.FloorM              = Capture.FloorThicknessCoverageExtinction.x;
    Specification.ThicknessM          = Capture.FloorThicknessCoverageExtinction.y;
    Specification.Coverage            = Capture.FloorThicknessCoverageExtinction.z;
    Specification.Extinction          = Capture.FloorThicknessCoverageExtinction.w;
    Specification.FeatureScale        = Capture.ScaleSeedPhaseExposure.x;
    Specification.Seed                = Capture.ScaleSeedPhaseExposure.y;
    Specification.PhaseG              = Capture.ScaleSeedPhaseExposure.z;
    Specification.PixelAngle          = 2.0 * Capture.UpTanY.w / float(Capture.Size.y);
    Specification.TimeSeconds         = Capture.OriginTime.w;
    Specification.UniformExtinction   = Capture.Switches.z != 0u ? Capture.Cyclone.z : -1.0;
    Specification.WindVelocityMps     = float2(Capture.ForwardWindX.w, Capture.AirWindY.w);
    Specification.Shear               = Capture.Flow.x;
    Specification.Veer                = Capture.Flow.y;
    Specification.Turbulence          = Capture.Flow.z;
    Specification.Anvil               = Capture.Flow.w;
    Specification.CycloneSpeedMps     = Capture.Cyclone.x;
    Specification.CycloneEyeM         = Capture.Cyclone.y;
    Specification.CycloneAxis         = normalize(Capture.CycloneAxis.xyz);
    Specification.SunDirection        = normalize(Capture.SunIntensity.xyz);
    Specification.SolarIrradiance     = float3(Capture.SunIntensity.w);
    Specification.SkyAmbient          = float3(0.37, 0.46, 0.62) * Capture.SunIntensity.w / 16.0;
    Specification.AtmosphereStrengths = Capture.Selection.x == 2u ? float3(0.0) : Capture.AirWindY.xyz;
    Specification.AirScaleHeightsM    = float2(8000.0, 1400.0);
#ifdef FRONTIER_CLOUD_FORMATION
    Specification.Formation = FRONTIER_CLOUD_FORMATION;
#else
    Specification.Formation = Capture.Selection.w;
#endif
    Specification.Steps           = Capture.Selection.y;
    Specification.LightSteps      = Capture.Selection.z;
    Specification.UseClouds       = Capture.Selection.x != 2u && Capture.Switches.x != 0u;
    Specification.UseCloudShadows = Specification.UseClouds && Capture.Switches.y != 0u;
    return Specification;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        SURFACE RADIANCE
//------------------------------------------------------------------------------------------------------------------------

float3 ReadPlanetAlbedo(uint2 Coordinate)
{
    float3 Encoded = DecodeCloudTexel(PlanetSurface[Coordinate.y * Capture.Size.z + Coordinate.x]).rgb;
    return select(Encoded <= 0.04045, Encoded / 12.92, pow((Encoded + 0.055) / 1.055, float3(2.4)));
}

float3 SamplePlanetAlbedo(float3 Normal)
{
    float  Longitude  = frac(atan2(Normal.x, Normal.z) / (2.0 * Cloudπ) + 0.5);
    float  Latitude   = acos(clamp(Normal.y, -1.0, 1.0)) / Cloudπ;
    float2 Projected  = float2(Longitude, Latitude) * float2(Capture.Size.zw) - 0.5;
    int2   Coordinate = int2(floor(Projected));
    float2 Fraction   = frac(Projected);
    int    Width      = int(Capture.Size.z);
    int    Height     = int(Capture.Size.w);
    uint   X          = uint((Coordinate.x + Width) % Width);
    uint   X1         = (X + 1u) % Capture.Size.z;
    uint   Y          = uint(clamp(Coordinate.y, 0, Height - 1));
    uint   Y1         = min(Y + 1u, Capture.Size.w - 1u);
    return lerp(lerp(ReadPlanetAlbedo(uint2(X, Y)), ReadPlanetAlbedo(uint2(X1, Y)), Fraction.x),
                lerp(ReadPlanetAlbedo(uint2(X, Y1)), ReadPlanetAlbedo(uint2(X1, Y1)), Fraction.x), Fraction.y);
}

float3 QueryGroundRadiance(
    CloudSpecification Specification,
    float3             Position,
    float3             Direction,
    float              HitM,
    float              Shadow)
{
    float3 Normal          = normalize(Position);
    float3 SunTransmission = CloudSolarAirTransmittance(Specification, Position + Normal * 2.0) * Shadow;
    float  SunCosine       = saturate(dot(Normal, Specification.SunDirection));
    float3 Irradiance      = Specification.SolarIrradiance;
    if (Capture.Selection.x == 1u)
    {
        float3 Albedo = SamplePlanetAlbedo(Normal);
        return Albedo * Irradiance * (SunCosine * SunTransmission + 0.008) / Cloudπ;
    }
    if (Capture.Selection.x == 2u) return float3(0.0);
    float3 HalfDirection      = normalize(Specification.SunDirection - Direction);
    float  Fresnel            = 0.021 + 0.979 * pow(1.0 - abs(dot(Normal, Direction)), 5.0);
    float3 ReflectedDirection = reflect(Direction, Normal);
    float  SkyHeight          = saturate(dot(ReflectedDirection, Normal));
    float  Day                = smoothstep(-0.12, 0.25, dot(Normal, Specification.SunDirection));
    float3 Sky                = lerp(float3(0.040, 0.055, 0.080), float3(0.11, 0.25, 0.46), Day);
    Sky *= lerp(1.0, 0.55, SkyHeight);
    float  Glint = pow(saturate(dot(Normal, HalfDirection)), 1800.0);
    float3 Water = float3(0.004, 0.017, 0.026) * (0.22 + 0.78 * Shadow) * (0.15 + 0.85 * Day);
    return (Water + Fresnel * Sky + SunTransmission * Glint) * Irradiance / 16.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     LINEAR LIGHT INTEGRATION
//------------------------------------------------------------------------------------------------------------------------

float4 IntegrateCloudCapture(
    CloudSpecification Specification,
    float3             Origin,
    float3             Direction,
    float2             Pixel)
{
    float                  GroundM = PlanetCloudGroundDistance(Origin, Direction, Specification.RadiusM);
    CloudTransportIntegral Cloud   = TracePlanetaryClouds(Specification, Origin, Direction, Pixel, GroundM);
    if (Capture.Tile.w == 1u) return float4(Cloud.Transmittance, Cloud.DistanceM, 0.0, 1.0);
    if (Capture.Tile.w == 3u) return float4(Cloud.Radiance, Cloud.Transmittance);
    if (Capture.Selection.x == 2u) return float4(0.0, 0.0, 0.0, 1.0);
    CloudAirSegment Air        = IntegrateCloudAir(Specification, Origin, Direction, GroundM, 32u, false);
    float3          Background = float3(0.0);
    if (GroundM < 1.0e8)
    {
        float3 Ground     = Origin + Direction * GroundM;
        float  FootprintM = max(1.0, GroundM * Specification.PixelAngle);
        float  Shadow     = exp(-CloudSolarOpticalDepth(Specification, Ground, Specification.LightSteps, FootprintM));
        Background        = QueryGroundRadiance(Specification, Ground, Direction, GroundM, Shadow);
    }
    else
    {
        float DiscDistance = length(cross(Direction, Specification.SunDirection));
        float Disc =
            dot(Direction, Specification.SunDirection) > 0.0 ? 1.0 - smoothstep(0.00445, 0.00485, DiscDistance) : 0.0;
        Background = Specification.SolarIrradiance * Disc / (Cloudπ * 0.00465 * 0.00465);
    }
    float3 Behind = Air.Radiance + Air.Transmittance * Background;
    float3 Radiance =
        Behind * Cloud.Transmittance + CloudRadianceThroughAir(Specification, Origin, Direction, Cloud, 20u);
    return float4(Radiance, Cloud.Transmittance);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      NUMERIC QUERY ENTRY
//------------------------------------------------------------------------------------------------------------------------

float4 CloudQueryInput(uint Index, uint VectorIndex)
{
    uint Offset = Index * 16u + VectorIndex * 4u;
    return float4(asfloat(PlanetSurface[Offset]), asfloat(PlanetSurface[Offset + 1u]),
                  asfloat(PlanetSurface[Offset + 2u]), asfloat(PlanetSurface[Offset + 3u]));
}

float4 InspectCloudPhysics(CloudSpecification Specification, uint Index)
{
    float4 Position   = CloudQueryInput(Index, 0u);
    float4 Direction  = CloudQueryInput(Index, 1u);
    float4 Parameters = CloudQueryInput(Index, 2u);
    float4 Controls   = CloudQueryInput(Index, 3u);
#ifdef FRONTIER_CLOUD_QUERY_SELECTION
    uint Selection = FRONTIER_CLOUD_QUERY_SELECTION;
#else
    uint Selection = uint(Position.w);
#endif
    if (Selection == 0u)
    {
        float2 Roots = PlanetCloudSphere(Position.xyz, normalize(Direction.xyz), Parameters.x);
        return float4(Roots, PlanetCloudGroundDistance(Position.xyz, normalize(Direction.xyz), Parameters.x),
                      length(Position.xyz) - Parameters.x);
    }
    if (Selection == 1u)
    {
        CloudDeck Layer = PlanetCloudLayer(Specification, 0u);
        Layer.BottomM   = Parameters.x;
        Layer.TopM      = Parameters.y;
        return PlanetCloudLayerSpans(Position.xyz, normalize(Direction.xyz), Specification.RadiusM, Layer,
                                     Parameters.z);
    }
    if (Selection == 2u)
    {
        return float4(CloudTransportHG(Position.x, Position.y), CloudDualLobe(Position.x, Position.y, 1.0),
                      CloudDualLobe(Position.x, Position.y, 0.49), CloudDualLobe(Position.x, Position.y, 0.19));
    }
    if (Selection == 3u)
    {
        float3 Advected = CloudWindCoordinates(Specification, Position.xyz, uint(Parameters.x));
        return float4(Advected, length(Advected) - length(Position.xyz));
    }
    if (Selection == 4u)
    {
        CloudDeck          Layer   = PlanetCloudLayer(Specification, 0u);
        CloudWeatherSample Weather = CloudWeatherAtPoint(Specification, Position.xyz, Layer.Category);
        float Density      = SamplePlanetCloudDensity(Specification, Layer, Position.xyz, Weather, Direction.w, false);
        float LightDensity = SamplePlanetCloudDensity(Specification, Layer, Position.xyz, Weather, Direction.w, true);
        return float4(Density, LightDensity, Weather.Moisture,
                      CloudGeodesicRadius(Specification, normalize(Position.xyz)));
    }
    if (Selection == 5u)
    {
        return float4(CloudSolarAirTransmittance(Specification, Position.xyz),
                      CloudSolarOpticalDepth(Specification, Position.xyz, Specification.LightSteps, Direction.w));
    }
    if (Selection == 6u)
    {
        Specification.PixelAngle = max(0.0, Parameters.w);
        CloudTransportIntegral Integral =
            TracePlanetaryClouds(Specification, Position.xyz, normalize(Direction.xyz), float2(0.0), Parameters.x);
        return float4(Integral.Radiance, Integral.Transmittance);
    }
    if (Selection == 7u)
    {
        CloudDeck Layer  = PlanetCloudLayer(Specification, 0u);
        float3    Phases = CloudScatteringOrderPhases(Specification, normalize(Direction.xyz));
        return float4(PlanetCloudSource(Specification, Layer, Position.xyz, Parameters.x, Phases, Direction.w),
                      CloudSolarOpticalDepth(Specification, Position.xyz, Specification.LightSteps, Direction.w));
    }
    if (Selection == 8u)
    {
        return SampleCloudShape(Position.xyz, Direction.w, Parameters.x);
    }
    if (Selection == 9u)
    {
        return SampleCloudErosion(Position.xyz, Direction.w, Parameters.x);
    }
    if (Selection == 10u)
    {
        float2 Trigonometry = CloudRotationSinCos(Position.x);
        return float4(Trigonometry, dot(Trigonometry, Trigonometry), Position.x);
    }
    return float4(-1.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                              MAIN
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")]
[numthreads(8, 8, 1)]
void CloudCaptureEntry(uint3 Coordinate : SV_DispatchThreadID)
{
    if (Coordinate.x >= Capture.Size.x || Coordinate.y >= Capture.Tile.y) return;
    uint2              Pixel         = uint2(Coordinate.x, Coordinate.y + Capture.Tile.x);
    CloudSpecification Specification = QueryCloudSpecification();

#ifdef FRONTIER_CLOUD_QUERY_ONLY
    CloudPixels[Coordinate.y * Capture.Size.x + Coordinate.x] = InspectCloudPhysics(Specification, Coordinate.x);
#else
#ifndef FRONTIER_CLOUD_BEAUTY_ONLY
    if (Capture.Tile.w == 2u)
    {
        CloudPixels[Coordinate.y * Capture.Size.x + Coordinate.x] = InspectCloudPhysics(Specification, Coordinate.x);
        return;
    }
#endif
    float3 Origin = Capture.OriginTime.xyz;
    Origin.z += Specification.RadiusM;
    float4 Integral    = float4(0.0);
    uint   SampleCount = max(1u, Capture.Tile.z);
    for (uint Index = 0u; Index < SampleCount; ++Index)
    {
        float2 Subpixel  = SampleCount == 1u
                               ? float2(0.5)
                               : frac(float2(0.5) + (float(Index) + 0.5) * float2(0.754877667, 0.569840296));
        float2 Ndc       = ((float2(Pixel) + Subpixel) / float2(Capture.Size.xy) * 2.0 - 1.0) * float2(1.0, -1.0);
        float3 Direction = normalize(Capture.ForwardWindX.xyz + Ndc.x * Capture.RightTanX.w * Capture.RightTanX.xyz +
                                     Ndc.y * Capture.UpTanY.w * Capture.UpTanY.xyz);
        Integral +=
            IntegrateCloudCapture(Specification, Origin, Direction, float2(Pixel) + float2(Index * 11u, Index * 29u));
    }
    CloudPixels[Coordinate.y * Capture.Size.x + Coordinate.x] = Integral / float(SampleCount);
#endif
}
