/*==========================================================================================================================================
                                                             CLOUDDENSITY.SLANG
==========================================================================================================================================*/
// 🧩 Seamless three-dimensional condensate with altitude-preserving wind characteristics and a resolved cyclonic eye.

#ifndef FRONTIER_PLANETARY_CLOUD_DENSITY
#define FRONTIER_PLANETARY_CLOUD_DENSITY

#include "CloudNoise.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                                    VOLUME SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

static const float Cloudπ = 3.14159265358979323846;

struct CloudSpecification
{
    float  RadiusM;
    float  Coverage;
    float  Extinction;
    float  FloorM;
    float  ThicknessM;
    float  FeatureScale;
    float  Anvil;
    float  PhaseG;
    float  Seed;
    float  PixelAngle;
    float  UniformExtinction;
    float  TimeSeconds;
    float2 WindVelocityMps;
    float  Shear;
    float  Veer;
    float  Turbulence;
    float  CycloneSpeedMps;
    float  CycloneEyeM;
    float3 CycloneAxis;
    float3 SunDirection;
    float3 SolarIrradiance;
    float3 SkyAmbient;
    float3 AtmosphereStrengths;
    float2 AirScaleHeightsM;
    uint   Steps;
    uint   LightSteps;
    uint   Formation;
    bool   UseClouds;
    bool   UseCloudShadows;
};

struct CloudDeck
{
    float BottomM;
    float TopM;
    float Amount;
    float σ;
    uint  Category;
};

struct CloudRayInterval
{
    float NearM;
    float FarM;
    uint  Layer;
};

struct CloudTransportIntegral
{
    float3 Radiance;
    float  Transmittance;
    float  DistanceM;
};

struct CloudWeatherSample
{
    float Moisture;
    float Type;
    float Lift;
    float Rain;
    float Bands;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 TANGENT WIND CHARACTERISTICS
//------------------------------------------------------------------------------------------------------------------------

float2 CloudRotationSinCos(float θ)
{
    // 📝 Generic software-ICD trig displaced a 6,371 km characteristic radially by up to 91 m. Bounded series
    // retain small-angle accuracy; the radial projection below removes the remaining Float32 norm roundoff.
    float Reduced  = θ - 2.0 * Cloudπ * floor(θ / (2.0 * Cloudπ) + 0.5);
    float Polarity = 1.0;
    if (Reduced > 0.5 * Cloudπ)
    {
        Reduced  = Cloudπ - Reduced;
        Polarity = -1.0;
    }
    if (Reduced < -0.5 * Cloudπ)
    {
        Reduced  = -Cloudπ - Reduced;
        Polarity = -1.0;
    }
    float θ2 = Reduced * Reduced;
    float Sine =
        Reduced *
        (1.0 + θ2 * (-1.0 / 6.0 +
                     θ2 * (1.0 / 120.0 + θ2 * (-1.0 / 5040.0 +
                                               θ2 * (1.0 / 362880.0 + θ2 * (-1.0 / 39916800.0 + θ2 / 6227020800.0))))));
    float Cosine =
        Polarity *
        (1.0 + θ2 * (-0.5 + θ2 * (1.0 / 24.0 + θ2 * (-1.0 / 720.0 + θ2 * (1.0 / 40320.0 + θ2 * (-1.0 / 3628800.0 +
                                                                                                θ2 / 479001600.0))))));
    return float2(Sine, Cosine);
}

float3 RotateCloudPosition(float3 Position, float3 Axis, float Angle)
{
    if (Angle == 0.0) return Position;
    float2 Trigonometry = CloudRotationSinCos(Angle);
    float3 Rotated      = Position * Trigonometry.y + cross(Axis, Position) * Trigonometry.x +
                     Axis * dot(Axis, Position) * (1.0 - Trigonometry.y);
    return Rotated * (length(Position) / max(1.0e-6, length(Rotated)));
}

float CloudGeodesicRadius(CloudSpecification Specification, float3 Normal)
{
    return Specification.RadiusM *
           atan2(length(cross(Specification.CycloneAxis, Normal)), dot(Specification.CycloneAxis, Normal));
}

float CloudCycloneAngularSpeed(CloudSpecification Specification, float RadiusM, float AltitudeM)
{
    float MaximumWindRadiusM = max(12000.0, Specification.CycloneEyeM * 1.8);
    float AngularSpeed       = 2.0 * Specification.CycloneSpeedMps * MaximumWindRadiusM /
                         (RadiusM * RadiusM + MaximumWindRadiusM * MaximumWindRadiusM);
    float Outflow = lerp(1.0, -0.16, smoothstep(7200.0, 14500.0, AltitudeM));
    return AngularSpeed * Outflow * exp(-pow(RadiusM / 620000.0, 4.0));
}

float3 CloudWindCoordinates(CloudSpecification Specification, float3 Position, uint Category)
{
    if (Specification.TimeSeconds == 0.0) return Position;
    float  Radius       = length(Position);
    float  AltitudeM    = Radius - Specification.RadiusM;
    float  HeightKm     = max(0.0, AltitudeM - Specification.FloorM) * 0.001;
    float  WindTurn     = HeightKm * Specification.Veer;
    float2 Trigonometry = CloudRotationSinCos(WindTurn);
    float2 Wind =
        float2(Specification.WindVelocityMps.x * Trigonometry.y - Specification.WindVelocityMps.y * Trigonometry.x,
               Specification.WindVelocityMps.x * Trigonometry.x + Specification.WindVelocityMps.y * Trigonometry.y);
    float WindSpeed = length(Wind);
    if (WindSpeed > 1.0e-5)
    {
        float3 WindAxis = float3(-Wind.y, Wind.x, 0.0) / WindSpeed;
        float  WindAngle =
            WindSpeed * Specification.TimeSeconds * (1.0 + Specification.Shear * HeightKm) / Specification.RadiusM;
        Position = RotateCloudPosition(Position, WindAxis, -WindAngle);
    }
    if (Specification.Formation == 11u)
    {
        float StormRadiusM = CloudGeodesicRadius(Specification, Position / Radius);
        float AngularSpeed = CloudCycloneAngularSpeed(Specification, StormRadiusM, AltitudeM);
        Position = RotateCloudPosition(Position, Specification.CycloneAxis, -AngularSpeed * Specification.TimeSeconds);
    }
    // 📝 The characteristic preserves radius exactly. Vertical shear deforms density; it never moves the condensate
    // below sea level.
    return Position;
}

CloudDeck PlanetCloudLayer(CloudSpecification Specification, uint Index)
{
    CloudDeck Layer;
    Layer.BottomM  = max(100.0, Specification.FloorM);
    Layer.TopM     = Layer.BottomM + max(100.0, Specification.ThicknessM);
    Layer.Amount   = Specification.Coverage;
    Layer.σ        = 0.0042 * Specification.Extinction;
    Layer.Category = 0u;
    if (Specification.Formation >= 6u && Specification.Formation <= 8u)
    {
        Layer.Category = 2u;
        Layer.σ        = (Specification.Formation == 8u ? 0.00030 : 0.00012) * Specification.Extinction;
    }
    else if (Specification.Formation == 2u || Specification.Formation == 4u || Specification.Formation == 5u)
    {
        Layer.Category = 1u;
        Layer.σ        = 0.0028 * Specification.Extinction;
    }
    if (Specification.Formation == 11u) Layer.σ = 0.0026 * Specification.Extinction;
    // 📝 A single occupied interval avoids double integration of overlapping cloud genera. The cyclone's ice canopy
    // belongs to this volume.
    if (Index != 0u) Layer.Amount = 0.0;
    return Layer;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  PLANETARY WEATHER ENVELOPE
//------------------------------------------------------------------------------------------------------------------------

CloudWeatherSample CloudWeatherAtPoint(CloudSpecification Specification, float3 Position, uint Category)
{
    float  Radius         = length(Position);
    float3 AdvectedNormal = CloudWindCoordinates(Specification, Position, Category) / Radius;
    float3 Coordinate     = RotateCloudOctave(AdvectedNormal * 13.0) + Specification.Seed * float3(0.73, -0.46, 1.17);
    float  Broad          = CloudLatticeNoise(Coordinate + float3(12.8, -7.9, 42.1));
    float  Mesoscale =
        CloudLatticeNoise(RotateCloudOctave(AdvectedNormal * 470.0) + float3(17.4, Specification.Seed, 36.1));
    CloudWeatherSample Weather;
    Weather.Moisture = saturate(0.48 + 0.57 * (Broad - 0.5) + 0.43 * (Mesoscale - 0.5));
    Weather.Type     = Mesoscale;
    Weather.Lift     = saturate(0.42 + 0.68 * (Mesoscale - 0.5));
    Weather.Rain     = smoothstep(0.50, 0.80, Weather.Moisture);
    Weather.Bands    = Broad;
    return Weather;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONVECTIVE CONDENSATE
//------------------------------------------------------------------------------------------------------------------------

float CloudCellEnvelope(float2 PositionM, float Height, float Coverage, float Seed, float ScaleM, float Expansion = 1.0)
{
    float2 Coordinate = PositionM / ScaleM;
    int2   Cell       = int2(floor(Coordinate));
    float  Envelope   = -1.0;
    for (int Y = -1; Y <= 1; ++Y)
        for (int X = -1; X <= 1; ++X)
        {
            int2   Address    = Cell + int2(X, Y);
            float4 Random     = DecodeCloudTexel(CloudLatticeHash(int3(Address, int(floor(Seed * 53.0)))));
            float2 Center     = float2(Address) + 0.5 + 0.76 * (Random.xy - 0.5);
            float  Occurrence = smoothstep(0.18, 0.65, Coverage + 0.30 * (Random.z - 0.5));
            float  Radius     = (0.19 + 0.27 * Random.w) * lerp(0.65, 1.15, Occurrence);
            if (Expansion > 1.001 && Random.z < 0.58) continue;
            Radius *= Expansion;
            float  TowerHeight = 0.30 + 0.58 * Random.z;
            float2 Tilt        = (Random.yw - 0.5) * (0.38 * Height * Height);
            float2 Offset      = (Coordinate - Center - Tilt) / Radius;
            if (dot(Offset, Offset) > 3.2) continue;
            float  Vertical  = (Height - 0.36 * TowerHeight) / max(0.1, TowerHeight * 0.64);
            float  Main      = 1.0 - sqrt(dot(Offset, Offset) + Vertical * Vertical);
            float2 BudOffset = Offset - (Random.yz - 0.5) * 0.95;
            float  BudHeight = (Height - TowerHeight * 0.70) / max(0.08, TowerHeight * 0.35);
            float  Bud       = 0.90 - sqrt(dot(BudOffset, BudOffset) * 1.65 + BudHeight * BudHeight);
            Envelope         = max(Envelope, max(Main, Bud) - (1.0 - Occurrence) * 0.75);
        }
    return Envelope;
}

float CloudConvectiveEnvelope(CloudSpecification Specification,
                              float3             Advected,
                              float              AltitudeM,
                              float              Height,
                              float              Amount,
                              float              ScaleM,
                              float              Expansion = 1.0)
{
    float3 Normal   = normalize(Advected);
    float3 SeaLevel = Advected - Normal * AltitudeM;
    float3 Weight   = smoothstep(float3(0.40), float3(0.82), abs(Normal));
    Weight *= Weight;
    float Envelope = 0.0;
    if (Weight.z > 0.0)
        Envelope += Weight.z * CloudCellEnvelope(SeaLevel.xy, Height, Amount, Specification.Seed, ScaleM, Expansion);
    if (Weight.x > 0.0)
        Envelope +=
            Weight.x * CloudCellEnvelope(SeaLevel.yz, Height, Amount, Specification.Seed + 23.0, ScaleM, Expansion);
    if (Weight.y > 0.0)
        Envelope +=
            Weight.y * CloudCellEnvelope(SeaLevel.xz, Height, Amount, Specification.Seed + 59.0, ScaleM, Expansion);
    return Envelope / max(0.001, Weight.x + Weight.y + Weight.z);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                APERIODIC SHAPE DISPLACEMENT
//------------------------------------------------------------------------------------------------------------------------

float3 EvaluateCloudShapeDisplacement(float3 Coordinate)
{
    // 📝 Unbounded, independently rotated fields bend the local noise volume without repeating its texture period.
    return float3(CloudLatticeNoise(Coordinate + float3(17.3, 43.7, 61.1)),
                  CloudLatticeNoise(RotateCloudOctave(Coordinate) + float3(53.1, 11.9, 37.7)),
                  CloudLatticeNoise(RotateCloudOctave(Coordinate * 1.19) + float3(29.3, 71.1, 13.7))) -
           0.5;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  LOCALIZED DEEP CONVECTION
//------------------------------------------------------------------------------------------------------------------------

float CloudThermalEnvelope(CloudSpecification Specification,
                           float3             Advected,
                           float              Height,
                           float2             Shape,
                           float              Detail,
                           float              Amount)
{
    float3 Normal        = normalize(Advected);
    float3 ReferenceAxis = abs(Specification.CycloneAxis.y) > 0.90 ? float3(1.0, 0.0, 0.0) : float3(0.0, 1.0, 0.0);
    float3 TangentX      = normalize(cross(ReferenceAxis, Specification.CycloneAxis));
    float3 TangentY      = cross(Specification.CycloneAxis, TangentX);
    float2 Tangent       = float2(dot(Normal, TangentX), dot(Normal, TangentY));
    float  RadiusM       = CloudGeodesicRadius(Specification, Normal);
    float2 PositionM     = Tangent * (RadiusM / max(1.0e-7, length(Tangent)));
    float  WidthM        = 2700.0 * sqrt(max(0.25, Specification.FeatureScale));
    float2 TiltM         = float2(1600.0, 500.0) * Height * Height;
    float  Envelope      = -2.0;
    for (int Index = 0; Index < 5; ++Index)
    {
        float4 Random    = DecodeCloudTexel(CloudLatticeHash(int3(Index, 71, int(Specification.Seed * 53.0))));
        float2 CenterM   = Index == 0 ? float2(0.0) : (Random.xy - 0.5) * WidthM * 2.4;
        float  Top       = Index == 0 ? 0.96 : lerp(0.50, 0.86, Random.z);
        float  Width     = WidthM * lerp(0.57, 1.0, Random.w) * lerp(0.63, 1.10, smoothstep(0.0, 0.65, Height));
        float3 Ellipsoid = float3((PositionM - CenterM - TiltM) / Width, (Height - Top * 0.42) / (Top * 0.58));
        Envelope         = max(Envelope, 1.0 - length(Ellipsoid));
    }
    float FineAmplitude = Specification.Formation == 10u ? 0.08 : 0.30;
    float Raw = 0.76 * Envelope + 0.92 * (Shape.x - 0.46) + 0.30 * (Shape.y - 0.46) + FineAmplitude * (Detail - 0.48) -
                (1.0 - Amount) * 0.13;
    if (Specification.Formation == 10u && Specification.Anvil > 0.0)
    {
        float2 AnvilCoordinate    = (PositionM - float2(3900.0, 1100.0)) / (WidthM * float2(3.4, 2.4));
        float  AnvilRadiusSquared = dot(AnvilCoordinate, AnvilCoordinate);
        float  Vertical           = (Height - 0.85) / 0.075;
        float  Anvil              = 0.52 * (1.0 - sqrt(AnvilRadiusSquared * AnvilRadiusSquared + Vertical * Vertical));
        Anvil += 0.30 * (Shape.x - 0.46) + 0.025 * (Detail - 0.48) - 0.05;
        Raw = max(Raw, Anvil * saturate(Specification.Anvil));
    }
    return Raw;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    RESOLVED CYCLONIC WEATHER
//------------------------------------------------------------------------------------------------------------------------

float CloudCycloneEnvelope(CloudSpecification Specification,
                           float3             Advected,
                           float              AltitudeM,
                           float3             Coordinate,
                           float              FootprintM,
                           out float          HeightEnvelope)
{
    float3 Normal        = normalize(Advected);
    float  RadiusM       = CloudGeodesicRadius(Specification, Normal);
    float3 ReferenceAxis = abs(Specification.CycloneAxis.y) > 0.90 ? float3(1.0, 0.0, 0.0) : float3(0.0, 1.0, 0.0);
    float3 TangentX      = normalize(cross(ReferenceAxis, Specification.CycloneAxis));
    float3 TangentY      = cross(Specification.CycloneAxis, TangentX);
    float  Azimuth       = atan2(dot(Normal, TangentY), dot(Normal, TangentX));
    float  Warp          = CloudLatticeNoise(Coordinate * 0.000013 + 31.7) - 0.5;
    float  SpiralAngle =
        2.0 * Azimuth - 5.8 * log(max(0.8, RadiusM / max(9000.0, Specification.CycloneEyeM))) + 1.8 * Warp;
    float Spiral    = pow(saturate(0.5 + 0.5 * cos(SpiralAngle)), 2.7);
    float Broken    = CloudLatticeNoise(Coordinate * 0.000026 + 53.2);
    float Central   = 1.0 - smoothstep(100000.0, 240000.0, RadiusM);
    float Outer     = 1.0 - smoothstep(210000.0, 570000.0, RadiusM);
    float Rainbands = smoothstep(0.08, 0.70, Spiral) * (0.57 + 0.43 * Broken) * Outer;
    float Eyewall   = exp(-pow((RadiusM - Specification.CycloneEyeM * 1.65) / (Specification.CycloneEyeM * 0.65), 2.0));
    float EyeRadiusM = Specification.CycloneEyeM + max(0.0, AltitudeM - 1500.0) * 0.58 +
                       1500.0 * sin(3.0 * Azimuth + 0.4) + 1100.0 * sin(Azimuth - 0.7);
    float  Eye              = smoothstep(EyeRadiusM, EyeRadiusM + 4300.0 + 1600.0 * Warp, RadiusM);
    float3 BillowCoordinate = Coordinate + 26000.0 * EvaluateCloudShapeDisplacement(Coordinate / 95000.0);
    float  BillowFootprintM = FootprintM * 1.6;
    float  MacroBillow      = SampleCloudShape(BillowCoordinate / 180000.0 + 0.713, BillowFootprintM, 180000.0).r;
    float  MesoBillow       = SampleCloudShape(BillowCoordinate / 48000.0 + 0.337, BillowFootprintM, 48000.0).r;
    float  SmallBillow      = SampleCloudShape(BillowCoordinate / 12000.0 + 0.861, BillowFootprintM, 12000.0).r;
    // 📝 Keep kilometre-scale convective relief, but do not extrude small texture cells into kilometre-high spikes.
    float ConvectiveTopM =
        12100.0 + 5800.0 * (MacroBillow - 0.47) + 2400.0 * (MesoBillow - 0.47) + 500.0 * (SmallBillow - 0.47);
    float TopM        = lerp(2900.0 + 2900.0 * Rainbands + 1500.0 * MesoBillow, ConvectiveTopM, Central);
    TopM              = max(TopM, 12500.0 * Eyewall);
    float WaterHeight = smoothstep(900.0, 1350.0, AltitudeM) * (1.0 - smoothstep(TopM - 1250.0, TopM, AltitudeM));
    // 📝 An altitude-constant ice cap erased the convective relief in the earlier capture. Ice now occupies outer outflow only.
    float Outflow = smoothstep(100000.0, 185000.0, RadiusM) * (1.0 - smoothstep(215000.0, 440000.0, RadiusM));
    float OutflowTopM =
        11900.0 + 2400.0 * (MacroBillow - 0.47) + 2000.0 * (MesoBillow - 0.47) + 350.0 * (SmallBillow - 0.47);
    float IceHeight =
        smoothstep(10000.0, 10800.0, AltitudeM) * (1.0 - smoothstep(OutflowTopM - 360.0, OutflowTopM, AltitudeM));
    // 📝 Coherent spiral coverage replaces the small cellular cutouts without filling the gaps between storm bands.
    float IceFibers   = saturate(0.51 + 0.49 * Spiral + 0.40 * (MacroBillow - 0.47) + 0.12 * (MesoBillow - 0.47));
    HeightEnvelope    = max(WaterHeight, IceHeight * Outflow) * Eye;
    float CentralMass = Central * (0.72 + 0.32 * MacroBillow + 0.16 * MesoBillow);
    float Mass        = max(CentralMass, 0.98 * Rainbands) + 0.20 * Eyewall;
    Mass              = max(Mass * WaterHeight, Outflow * IceHeight * IceFibers * 0.72);
    return Mass * Eye;
}

//------------------------------------------------------------------------------------------------------------------------
//                                               ONE DENSITY FROM GROUND TO SPACE
//------------------------------------------------------------------------------------------------------------------------

float SamplePlanetCloudDensity(CloudSpecification Specification,
                               CloudDeck          Layer,
                               float3             Position,
                               CloudWeatherSample Weather,
                               float              FootprintM,
                               bool               LightQuery)
{
    float Radius    = length(Position);
    float AltitudeM = Radius - Specification.RadiusM;
    float Height    = (AltitudeM - Layer.BottomM) / (Layer.TopM - Layer.BottomM);
    if (Height <= 0.0 || Height >= 1.0 || Layer.Amount <= 0.0) return 0.0;
    if (Specification.UniformExtinction >= 0.0) return Specification.UniformExtinction;
    float3 Advected = CloudWindCoordinates(Specification, Position, Layer.Category);
    float3 Normal   = Advected / Radius;
    if ((Specification.Formation == 9u || Specification.Formation == 10u) &&
        CloudGeodesicRadius(Specification, Normal) >= 24000.0)
        return 0.0;
    float3 Coordinate = RotateCloudOctave(Advected - float3(0.0, 0.0, Specification.RadiusM));
    Coordinate += Specification.Seed * float3(731.0, -1261.0, 3179.0);
    float  ScaleM          = max(900.0, 7200.0 * Specification.FeatureScale);
    float3 ShapeCoordinate = Coordinate / ScaleM + float3(0.143, 0.713, 0.337);
    float2 Shape           = float2(0.47, 0.47);
    float  Detail          = 0.48;
    float  ShapeFootprintM = FootprintM;
    if (Specification.Formation == 8u || Specification.Formation == 11u)
    {
        float DisplacementScale     = Specification.Formation == 8u ? 2.2 : 3.7;
        float DisplacementAmplitude = Specification.Formation == 8u ? 1.8 : 1.15;
        ShapeCoordinate +=
            DisplacementAmplitude * EvaluateCloudShapeDisplacement(Coordinate / (ScaleM * DisplacementScale));
        ShapeFootprintM *= Specification.Formation == 8u ? 2.0 : 1.4;
    }
    if (Layer.Category != 2u || Specification.Formation == 8u)
    {
        Shape            = SampleCloudShape(ShapeCoordinate, ShapeFootprintM, ScaleM).rg;
        float FineFilter = 1.0 - smoothstep(ScaleM * 0.015, ScaleM * 0.11, FootprintM);
        float Billow =
            SampleCloudShape(RotateCloudOctave(ShapeCoordinate) * 3.17 + 0.337, ShapeFootprintM, ScaleM / 3.17).g;
        Detail = lerp(0.48, Billow, FineFilter);
    }
    float Amount = saturate(Layer.Amount + 0.38 * (Weather.Moisture - 0.5));
    float Raw;
    float HeightEnvelope = smoothstep(0.0, 0.045, Height) * (1.0 - smoothstep(0.93, 1.0, Height));
    if (Specification.Formation == 11u)
    {
        float Mass = CloudCycloneEnvelope(Specification, Advected, AltitudeM, Coordinate, FootprintM, HeightEnvelope);
        Raw        = Mass - (0.30 + 0.25 * (1.0 - Amount)) + 0.20 * (Shape.x - 0.5) + 0.06 * (Detail - 0.5);
    }
    else if (Specification.Formation == 9u || Specification.Formation == 10u)
    {
        Raw = CloudThermalEnvelope(Specification, Advected, Height, Shape, Detail, Amount);
    }
    else if (Layer.Category == 2u)
    {
        float3 Fiber =
            RotateCloudOctave(Coordinate) * float3(0.000075, 0.0028, 0.00065) / max(0.3, Specification.FeatureScale);
        float Bend = CloudLatticeNoise(Coordinate * 0.00014 + 41.3);
        float Bank = CloudLatticeNoise(Coordinate * float3(0.000045, 0.000070, 0.00013) + 59.1);
        Fiber.y += 4.8 * Bend + 2.7 * Height * Height;
        Fiber.x += 0.60 * Height * Height;
        Fiber.z += 1.3 * CloudLatticeNoise(Coordinate * 0.00023 - 23.0);
        float Filter = FootprintM * 0.0028 / max(0.3, Specification.FeatureScale);
        float Strand =
            0.52 * lerp(0.5, CloudLatticeNoise(Fiber + 3.7), 1.0 - smoothstep(0.6, 1.5, Filter)) +
            0.27 * lerp(0.5, CloudLatticeNoise(Fiber * 2.13 + 16.9), 1.0 - smoothstep(0.6, 1.5, Filter * 2.13)) +
            0.14 * lerp(0.5, CloudLatticeNoise(Fiber * 4.31 + 31.4), 1.0 - smoothstep(0.6, 1.5, Filter * 4.31)) +
            0.07 * lerp(0.5, CloudLatticeNoise(Fiber * 8.73 + 59.7), 1.0 - smoothstep(0.6, 1.5, Filter * 8.73));
        float BankEnvelope = smoothstep(0.30, 0.67, Bank + (Amount - 0.6) * 0.35);
        if (Specification.Formation == 7u) BankEnvelope = lerp(0.68, 1.0, BankEnvelope);
        if (Specification.Formation == 8u)
        {
            Strand       = 0.48 * Shape.x + 0.52 * Shape.y;
            BankEnvelope = lerp(0.4, 1.0, BankEnvelope);
        }
        HeightEnvelope *= smoothstep(0.0, 0.23, Height) * (1.0 - smoothstep(0.55, 1.0, Height)) * BankEnvelope;
        Raw = Strand - lerp(0.70, 0.43, Amount) - (1.0 - HeightEnvelope) * 0.16;
    }
    else if (Layer.Category == 1u)
    {
        float Fold     = CloudLatticeNoise(Coordinate * 0.00016 + 37.1);
        float Vertical = Height + (Fold - 0.5) * 0.25;
        HeightEnvelope *= smoothstep(0.0, 0.19, Vertical) * (1.0 - smoothstep(0.66, 1.0, Vertical));
        Raw = 0.72 * Shape.x + 0.28 * Shape.y - lerp(0.64, 0.25, Amount) - (1.0 - HeightEnvelope) * 0.36;
    }
    else
    {
        float CellScaleM = ScaleM * 0.85;
        if (Specification.Formation == 1u || Specification.Formation == 3u) CellScaleM *= 0.55;
        float Envelope = CloudConvectiveEnvelope(Specification, Advected, AltitudeM, Height, Amount, CellScaleM);
        Raw            = 0.90 * Envelope + 1.05 * (Shape.x - 0.45) + 0.37 * (Shape.y - 0.45) + 0.32 * (Detail - 0.5);
        Raw -= 0.06 + (1.0 - Amount) * 0.10;
    }
    bool CoherentBoundary = Specification.Formation == 10u || Specification.Formation == 11u;
    if (Raw <= (CoherentBoundary ? 0.0 : -0.08) || HeightEnvelope <= 0.0) return 0.0;
    float ErosionFilter = 1.0 - smoothstep(24.0, 180.0, FootprintM);
    if (Raw < 0.45 && ErosionFilter > 0.0 && Layer.Category != 2u)
    {
        float3 ErosionCoordinate = Coordinate;
        ErosionCoordinate.xy +=
            CloudBoundaryCurl(Coordinate / 1700.0 + Specification.Seed) * (125.0 * Specification.Turbulence);
        float4 Erosion =
            SampleCloudErosion(ErosionCoordinate / 1550.0 + float3(0.419, 0.673, 0.613), FootprintM, 1550.0);
        float ErosionSignal = dot(Erosion - float4(0.47), float4(0.46, 0.29, 0.17, 0.08));
        float BoundaryShift = ErosionSignal * 0.64 * ErosionFilter * (1.0 - smoothstep(0.20, 0.45, Raw));
        // 📝 Fine erosion may texture a positive carrier, never reverse its sign or seed detached edge particles.
        if (CoherentBoundary) BoundaryShift = clamp(BoundaryShift, -0.35 * Raw, 0.35 * Raw);
        Raw += BoundaryShift;
    }
    float Response   = Layer.Category == 2u ? 0.14 : 0.048;
    float Condensate = smoothstep(0.0, Response, Raw) * HeightEnvelope;
    return Layer.σ * Condensate;
}

#endif
