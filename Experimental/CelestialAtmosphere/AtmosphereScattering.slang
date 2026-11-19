/*============================================================================================================================================
                                                      ATMOSPHERESCATTERING.SLANG
============================================================================================================================================*/
// 🧩 Spherical Rayleigh/aerosol/ozone transport, space-entry clipping and a directional-average multiple-scattering table.

//------------------------------------------------------------------------------------------------------------------------
//                                                 GPU OPTICAL-DEPTH TABULATION
//------------------------------------------------------------------------------------------------------------------------

float3 IntegrateColumns(float3 Position, float3 Direction, float Limit, uint Steps)
{
    float3 Sum      = 0;
    float  Previous = 0;
    for (uint Index = 0; Index < Steps; ++Index)
    {
        float  Fraction = float(Index + 1) / Steps;
        float  Next     = Limit * Fraction * Fraction;
        float3 Density  = MediumDensity(length(Position + Direction * (.5 * (Previous + Next))) - Configuration(9).x);
        Sum += Density * (Next - Previous);
        Previous = Next;
    }
    return Sum;
}
float2 TransmittanceUv(float Radius, float Cosine)
{
    float Ground = Configuration(9).x, Top = Configuration(9).y;
    Radius         = clamp(Radius, Ground, Top);
    float Horizon  = sqrt(max(0, (Top - Ground) * (Top + Ground)));
    float Height   = sqrt(max(0, (Radius - Ground) * (Radius + Ground)));
    float Distance = max(0, -Radius * Cosine + sqrt(max(0, Radius * Radius * (Cosine * Cosine - 1) + Top * Top)));
    float Minimum = Top - Radius, Maximum = Height + Horizon;
    return float2(saturate((Distance - Minimum) / max(1e-5, Maximum - Minimum)), Height / Horizon);
}
float4 SampleAtmosphericTable(float2 Uv, uint Width, uint Height, uint Start)
{
    float2 Coordinate = saturate(Uv) * float2(Width - 1, Height - 1);
    uint2  Low        = min(uint2(Coordinate), uint2(Width - 2, Height - 2));
    float2 Fraction   = Coordinate - float2(Low);
    float4 A          = lerp(AtmosphericTables[Start + Low.y * Width + Low.x],
                    AtmosphericTables[Start + Low.y * Width + Low.x + 1],
                    Fraction.x);
    float4 B          = lerp(AtmosphericTables[Start + (Low.y + 1) * Width + Low.x],
                    AtmosphericTables[Start + (Low.y + 1) * Width + Low.x + 1],
                    Fraction.x);
    return lerp(A, B, Fraction.y);
}
float3 SunTransmission(float3 Position, float3 Direction)
{
    if (GroundOccluded(Position, Direction)) return 0;
    float Radius = length(Position);
    if (Radius >= Configuration(9).y)
    {
        float2 Entry = SphereInterval(Position, Direction, Configuration(9).y);
        if (Entry.x < 0 || Entry.y <= Entry.x) return 1;
        Position += Direction * (Entry.x + .001);
        Radius = length(Position);
    }
    float2 Uv = TransmittanceUv(Radius, dot(Position, Direction) / Radius);
    return exp(-SpectralDepth(SampleAtmosphericTable(Uv, TransmittanceWidth, TransmittanceHeight, 0).xyz));
}
[shader("compute")][numthreads(64, 1, 1)] void BakeAtmosphereTransmittance(uint3 Dispatch
                                                                           : SV_DispatchThreadID)
{
    uint Index = Dispatch.x;
    if (Index >= TransmittanceWidth * TransmittanceHeight) return;
    float2 Uv = float2(Index % TransmittanceWidth, Index / TransmittanceWidth) /
                float2(TransmittanceWidth - 1, TransmittanceHeight - 1);
    float Ground = Configuration(9).x, Top = Configuration(9).y;
    float Horizon  = sqrt((Top - Ground) * (Top + Ground));
    float Height   = Uv.y * Horizon;
    float Radius   = sqrt(Height * Height + Ground * Ground);
    float Distance = lerp(Top - Radius, Height + Horizon, Uv.x);
    float Cosine =
        Distance > 1e-5 ? (Horizon * Horizon - Height * Height - Distance * Distance) / (2 * Radius * Distance) : 1;
    Cosine                   = clamp(Cosine, -1, 1);
    float3 Direction         = float3(sqrt(max(0, 1 - Cosine * Cosine)), 0, Cosine);
    AtmosphericTables[Index] = float4(IntegrateColumns(float3(0, 0, Radius), Direction, Distance, 192), 1);
}

//------------------------------------------------------------------------------------------------------------------------
//                                              CLIPPED SINGLE / MULTIPLE SCATTERING
//------------------------------------------------------------------------------------------------------------------------

float2 AtmosphereSegment(float3 Position, float3 Direction, out bool GroundHit)
{
    float2 Segment = SphereInterval(Position, Direction, Configuration(9).y);
    Segment.x      = max(0, Segment.x);
    float2 Ground  = SphereInterval(Position, Direction, Configuration(9).x);
    GroundHit      = Ground.y >= Ground.x && Ground.x > .0001 && Ground.x >= Segment.x && Ground.x < Segment.y;
    if (GroundHit) Segment.y = Ground.x;
    return Segment;
}
float3 MultipleRadiance(float Radius, float CosSun)
{
    float Height = saturate((Radius - Configuration(9).x) / (Configuration(9).y - Configuration(9).x));
    return SampleAtmosphericTable(float2(.5 + .5 * CosSun, sqrt(Height)), MultipleWidth, MultipleHeight, MultipleStart)
        .xyz;
}
float3 IntegrateSky(float3     Position,
                    float3     Direction,
                    bool       MultipleEnabled,
                    uint       Steps,
                    out float3 Transmission,
                    out bool   GroundHit)
{
    float2 Segment = AtmosphereSegment(Position, Direction, GroundHit);
    Transmission   = 1;
    if (Segment.y <= Segment.x) return 0;
    float3 Sun    = Configuration(4).xyz;
    float  PhaseR = RayleighPhase(dot(Direction, Sun)), PhaseM = AerosolPhase(dot(Direction, Sun));
    float3 Sum  = 0;
    float  Step = (Segment.y - Segment.x) / Steps;
    for (uint Index = 0; Index < Steps; ++Index)
    {
        float3 At      = Position + Direction * (Segment.x + (Index + .5) * Step);
        float  Radius  = length(At);
        float3 Density = MediumDensity(Radius - Configuration(9).x);
        float3 Depth   = SpectralDepth(Density * Step);
        float3 Scatter = Configuration(6).xyz * Density.x * PhaseR + Configuration(7).x * Density.y * PhaseM;
        float3 Source  = Scatter * SunTransmission(At, Sun);
        if (MultipleEnabled)
            Source += (Configuration(6).xyz * Density.x + Configuration(7).x * Density.y) *
                      MultipleRadiance(Radius, dot(At, Sun) / Radius);
        Sum += Transmission * Source * Step * SegmentWeight(Depth);
        Transmission *= exp(-Depth);
    }
    return Sum * Configuration(5).xyz * Configuration(5).w;
}
[shader("compute")][numthreads(64, 1, 1)] void BakeAtmosphereMultiple(uint3 Dispatch
                                                                      : SV_DispatchThreadID)
{
    uint Index = Dispatch.x;
    if (Index >= MultipleWidth * MultipleHeight) return;
    float2 Uv = float2(Index % MultipleWidth, Index / MultipleWidth) / float2(MultipleWidth - 1, MultipleHeight - 1);
    float  Radius   = lerp(Configuration(9).x + .02, Configuration(9).y - .01, Uv.y * Uv.y);
    float  CosSun   = 2 * Uv.x - 1;
    float3 Sun      = float3(sqrt(max(0, 1 - CosSun * CosSun)), 0, CosSun);
    float3 Position = float3(0, 0, Radius);
    float3 Radiance = 0, ReturnFraction = 0;
    const uint Directions = 32, Steps = 32;
    for (uint Sample = 0; Sample < Directions; ++Sample)
    {
        float  Cosine    = 1 - 2 * (Sample + .5) / Directions;
        float  Azimuth   = 2.399963229728653 * Sample;
        float3 Direction = Unit(float3(sqrt(1 - Cosine * Cosine) * float2(cos(Azimuth), sin(Azimuth)), Cosine));
        bool   GroundHit;
        float2 Segment      = AtmosphereSegment(Position, Direction, GroundHit);
        float  Step         = max(0, Segment.y - Segment.x) / Steps;
        float3 Transmission = 1, Single = 0, Fraction = 0;
        for (uint Part = 0; Part < Steps; ++Part)
        {
            float3 At      = Position + Direction * (Segment.x + (Part + .5) * Step);
            float3 Density = MediumDensity(length(At) - Configuration(9).x);
            float3 Depth   = SpectralDepth(Density * Step);
            float3 Scatter = Configuration(6).xyz * Density.x + Configuration(7).x * Density.y;
            float3 Weight  = Transmission * Step * SegmentWeight(Depth);
            Fraction += Weight * Scatter;
            Single += Weight *
                      (Configuration(6).xyz * Density.x * RayleighPhase(dot(Direction, Sun)) +
                       Configuration(7).x * Density.y * AerosolPhase(dot(Direction, Sun))) *
                      SunTransmission(At, Sun);
            Transmission *= exp(-Depth);
        }
        if (GroundHit)
        {
            float3 At     = Position + Direction * Segment.y;
            float3 Normal = Unit(At);
            Single += Transmission * Configuration(9).w / CelestialPi * max(0, dot(Normal, Sun)) *
                      SunTransmission(At + Normal * .01, Sun);
            Fraction += Transmission * Configuration(9).w;
        }
        Radiance += Single / Directions;
        ReturnFraction += Fraction / Directions;
    }
    // 📝 A directional-average local isotropic closure, not a claim of a converged 3D scattering solution.
    AtmosphericTables[MultipleStart + Index] =
        float4(Radiance / max(.02, 1 - ReturnFraction), max(ReturnFraction.x, max(ReturnFraction.y, ReturnFraction.z)));
}
