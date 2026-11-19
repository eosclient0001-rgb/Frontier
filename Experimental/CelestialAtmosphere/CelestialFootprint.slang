/*============================================================================================================================================
                                                       CELESTIALFOOTPRINT.SLANG
============================================================================================================================================*/
// 🧩 Typed Float32 inputs, kilometre-space ray intervals and the existing solar shader's projection adapter.

static const float CelestialPi        = 3.14159265358979323846;
static const uint  TransmittanceWidth = 256, TransmittanceHeight = 64;
static const uint  MultipleWidth = 32, MultipleHeight = 16;
static const uint  MultipleStart          = TransmittanceWidth * TransmittanceHeight;
static const uint  SolarSourceSampleCount = 1536;

struct CelestialExtent
{
    uint4  Dimensions;
    uint4  Primary;
    uint4  History;
    int4   Auxiliary0;
    int4   Auxiliary1;
    float4 Constraints;
    uint4  Range;
    float4 Reserved;
};
struct StellarSource
{
    float4 DirectionMagnitude;
    float4 ColourIndex;
    float4 ProjectionFlux;
};
[[vk::binding(0, 0)]] StructuredBuffer<float>           Angles;
[[vk::binding(1, 0)]] StructuredBuffer<float4>          LunarAlbedo;
[[vk::binding(2, 0)]] StructuredBuffer<float>           GalacticContours;
[[vk::binding(3, 0)]] RWStructuredBuffer<StellarSource> Stars;
[[vk::binding(4, 0)]] StructuredBuffer<uint>            StellarBins;
[[vk::binding(5, 0)]] RWStructuredBuffer<float4>        AtmosphericTables;
[[vk::binding(6, 0)]] RWStructuredBuffer<float4>        OutputColour;
[[vk::binding(7, 0)]] RWStructuredBuffer<uint>          Counters;
[[vk::push_constant]] ConstantBuffer<CelestialExtent>   Extent;

float4 Configuration(uint Index)
{
    uint Start = 4 * Index;
    return float4(Angles[Start], Angles[Start + 1], Angles[Start + 2], Angles[Start + 3]);
}
float3 Unit(float3 Direction)
{
    return normalize(Direction);
}
float4 CameraProjection(uint Index)
{
    if (Index == 0) return Configuration(0);
    if (Index == 1) return float4(Configuration(1).xyz, 0);
    if (Index == 2) return float4(Configuration(2).xyz, Configuration(1).w * Configuration(2).w);
    return float4(Configuration(3).xyz, Configuration(1).w);
}
float3 CameraRay(float2 Pixel)
{
    float2 Ndc = 2 * Pixel / float2(Extent.History.xy) - 1;
    return Unit(Configuration(1).xyz + Ndc.x * Configuration(2).xyz * Configuration(1).w * Configuration(2).w -
                Ndc.y * Configuration(3).xyz * Configuration(1).w);
}
float PixelSolidAngle(float2 Pixel)
{
    float2 Ndc     = 2 * Pixel / float2(Extent.History.xy) - 1;
    float2 Tangent = Ndc * float2(Configuration(1).w * Configuration(2).w, Configuration(1).w);
    return 4 * Configuration(1).w * Configuration(1).w * Configuration(2).w /
           (float(Extent.History.x * Extent.History.y) * pow(1 + dot(Tangent, Tangent), 1.5));
}
float2 SphereInterval(float3 Position, float3 Direction, float Radius)
{
    float Along         = dot(Position, Direction);
    float Perpendicular = length(cross(Position, Direction));
    float Discriminant  = (Radius - Perpendicular) * (Radius + Perpendicular);
    if (Discriminant < 0) return float2(1, -1);
    float Root = sqrt(max(0, Discriminant));
    return float2(-Along - Root, -Along + Root);
}
float SphereAhead(float3 Position, float3 Direction, float Radius)
{
    float2 Interval = SphereInterval(Position, Direction, Radius);
    if (Interval.y < 0 || Interval.x > Interval.y) return -1;
    return Interval.x >= 0 ? Interval.x : Interval.y;
}
bool GroundOccluded(float3 Position, float3 Direction)
{
    // 📝 One Float32 radius ULP is about half a metre here. An inward ray on a rounded
    // ground boundary is opaque, not a ray that can see the Sun through the whole planet.
    float Radius = length(Position);
    if (Radius < Configuration(9).x - .0005) return true;
    if (Radius <= Configuration(9).x + .0005 && dot(Position, Direction) < 0) return true;
    float2 Segment = SphereInterval(Position, Direction, Configuration(9).x);
    return Segment.x > 0 && Segment.y >= Segment.x;
}
float CelestialSine(float Angle);
bool  OccludedGeometry(float3 Position, float3 Direction, float Limit)
{
    if (Configuration(24).x > .5) return true;
    if (Configuration(11).w > .5 && GroundOccluded(Position, Direction)) return true;
    if (Configuration(10).y > .5)
    {
        float Facing = dot(Direction, Configuration(12).xyz);
        if (Facing > 0 && length(cross(Direction, Configuration(12).xyz)) < CelestialSine(Configuration(12).w))
            return true;
    }
    return false;
}
float3 SpectralDepth(float3 Columns)
{
    return Configuration(6).xyz * Columns.x + (Configuration(7).x + Configuration(7).y) * Columns.y +
           Configuration(8).xyz * Columns.z;
}
float3 MediumDensity(float Altitude)
{
    Altitude = max(0, Altitude);
    return float3(exp(-Altitude / Configuration(6).w),
                  exp(-Altitude / Configuration(7).z),
                  max(0, 1 - abs(Altitude - Configuration(8).w) / Configuration(9).z));
}
float RayleighPhase(float Cosine)
{
    return 3 * (1 + Cosine * Cosine) / (16 * CelestialPi);
}
float AerosolPhase(float Cosine)
{
    float Asymmetry   = Configuration(7).w;
    float Denominator = 1 + Asymmetry * Asymmetry - 2 * Asymmetry * clamp(Cosine, -1, 1);
    return (1 - Asymmetry * Asymmetry) / (4 * CelestialPi * pow(max(Denominator, 1e-8), 1.5)) * 1.5 *
           (1 + Cosine * Cosine) / (2 + Asymmetry * Asymmetry);
}
float3 SegmentWeight(float3 Depth)
{
    return float3(Depth.x > 1e-4 ? (1 - exp(-Depth.x)) / Depth.x : 1 - .5 * Depth.x,
                  Depth.y > 1e-4 ? (1 - exp(-Depth.y)) / Depth.y : 1 - .5 * Depth.y,
                  Depth.z > 1e-4 ? (1 - exp(-Depth.z)) / Depth.z : 1 - .5 * Depth.z);
}
float4 ProbeInput(uint Index, uint Half)
{
    uint Start = 64 + Index * 8 + Half * 4;
    return float4(asfloat(Counters[Start]),
                  asfloat(Counters[Start + 1]),
                  asfloat(Counters[Start + 2]),
                  asfloat(Counters[Start + 3]));
}
