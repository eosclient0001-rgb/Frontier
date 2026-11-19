/*============================================================================================================================================
                                                         LUNARSCATTERING.SLANG
============================================================================================================================================*/
// 🧩 Same retained sRGB-decoded Moon texture, librated Lommel–Seeliger surface, opaque phases and optically thin lunar exosphere.

//------------------------------------------------------------------------------------------------------------------------
//                                                   RETAINED LUNAR ALBEDO / PHASE
//------------------------------------------------------------------------------------------------------------------------

float3 SampleLunarAlbedo(float Longitude, float Latitude)
{
    int    Width = int(Configuration(22).x), Height = int(Configuration(22).y);
    float2 Coordinate = float2(frac((Longitude + CelestialPi) / (2 * CelestialPi)) * Width - .5,
                               saturate((.5 * CelestialPi - Latitude) / CelestialPi) * Height - .5);
    int2   Low        = int2(floor(Coordinate));
    float2 Fraction   = Coordinate - float2(Low);
    float3 Sum        = 0;
    for (int Y = 0; Y < 2; ++Y)
        for (int X = 0; X < 2; ++X)
        {
            int Column = ((Low.x + X) % Width + Width) % Width;
            int Row    = clamp(Low.y + Y, 0, Height - 1);
            Sum += LunarAlbedo[Row * Width + Column].xyz * (X == 0 ? 1 - Fraction.x : Fraction.x) *
                   (Y == 0 ? 1 - Fraction.y : Fraction.y);
        }
    return Sum;
}
void LunarBasis(out float3 East, out float3 North)
{
    float3 Moon = Configuration(12).xyz;
    North       = Unit(Configuration(13).xyz - Moon * dot(Configuration(13).xyz, Moon));
    East        = cross(Moon, North);
}
float3 LunarSurface(float A, float B, out bool Covered)
{
    Covered = A * A + B * B <= 1;
    if (!Covered) return 0;
    float  Toward    = sqrt(max(0, 1 - A * A - B * B));
    float  Longitude = Configuration(14).x, Latitude = Configuration(14).y;
    float  SinLatitude = sin(Latitude), CosLatitude = cos(Latitude);
    float  SurfaceLatitude  = asin(clamp(Toward * SinLatitude + B * CosLatitude, -1, 1));
    float  SurfaceLongitude = Longitude + atan2(A, Toward * CosLatitude - B * SinLatitude);
    float3 Albedo           = SampleLunarAlbedo(SurfaceLongitude, SurfaceLatitude) * Configuration(19).z;
    float3 East, North;
    LunarBasis(East, North);
    float3 Normal       = East * A + North * B - Configuration(12).xyz * Toward;
    float  Cosine       = max(0, dot(Normal, Configuration(4).xyz));
    float  Phase        = acos(clamp(dot(-Configuration(12).xyz, Configuration(4).xyz), -1, 1));
    float  Law          = Cosine > 0 ? 2 * Cosine / (Cosine + max(Toward, 1e-4)) : 0;
    float  Illumination = Law * exp(-Configuration(19).w * Phase) / CelestialPi;
    return Albedo * (Configuration(5).xyz * Configuration(5).w * Illumination +
                     Configuration(13).w * Configuration(5).w * float3(.55, .65, 1));
}
float3 LunarPixel(float2 Coordinate, out float Coverage)
{
    Coverage = 0;
    if (Configuration(10).y < .5) return 0;
    float3 East, North;
    LunarBasis(East, North);
    float3 Moon = Configuration(12).xyz;
    float3 Sum  = 0;
    for (uint Y = 0; Y < 4; ++Y)
        for (uint X = 0; X < 4; ++X)
        {
            float3 Ray = CameraRay(Coordinate + (float2(X, Y) + .5) / 4 - .5);
            if (dot(Ray, Moon) <= 0) continue;
            bool   Covered;
            float3 Surface = LunarSurface(dot(Ray, East) / CelestialSine(Configuration(12).w),
                                          dot(Ray, North) / CelestialSine(Configuration(12).w),
                                          Covered);
            if (Covered) Coverage += 1.0 / 16;
            Sum += Surface / 16;
        }
    return Sum;
}

//------------------------------------------------------------------------------------------------------------------------
//                                            OPTICALLY THIN EXOSPHERE / SHADOWED GAS
//------------------------------------------------------------------------------------------------------------------------

float3 LunarExosphere(float3 Direction)
{
    if (Configuration(10).y < .5 || Configuration(5).w == 0) return 0;
    float3 Moon   = Configuration(12).xyz;
    float  Facing = dot(Direction, Moon);
    if (Facing <= 0) return 0;
    float  Radius = Configuration(19).x, Outer = Radius + Configuration(19).y;
    float3 Impact       = (Direction - Moon * Facing) * (Radius / CelestialSine(Configuration(12).w));
    float  ImpactRadius = length(Impact);
    if (ImpactRadius >= Outer) return 0;
    float HalfLength = sqrt(max(0, Outer * Outer - ImpactRadius * ImpactRadius));
    float End    = ImpactRadius < Radius ? -sqrt(max(0, Radius * Radius - ImpactRadius * ImpactRadius)) : HalfLength;
    float Step   = (End + HalfLength) / 64;
    float Column = 0;
    for (uint Index = 0; Index < 64; ++Index)
    {
        float3 At     = Impact + Moon * (-HalfLength + (Index + .5) * Step);
        float2 Shadow = SphereInterval(At, Configuration(4).xyz, Radius);
        if (Shadow.x > .0001 && Shadow.y > Shadow.x) continue;
        Column += exp(-max(0, length(At) - Radius) / Configuration(18).w) * Step;
    }
    return Configuration(18).xyz * Column * RayleighPhase(dot(Direction, Configuration(4).xyz)) * Configuration(5).xyz *
           Configuration(5).w;
}
[shader("compute")][numthreads(64, 1, 1)] void RenderLunarSurface(uint3 Dispatch
                                                                  : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x) return;
    float2 Coordinate = float2(Pixel % Extent.History.x, Pixel / Extent.History.x) + .5;
    float  Coverage;
    float3 Surface                                = LunarPixel(Coordinate, Coverage);
    float3 Gas                                    = LunarExosphere(CameraRay(Coordinate));
    OutputColour[Pixel]                           = float4(Surface + Configuration(11).z * Gas, Coverage);
    OutputColour[Extent.Dimensions.x + Pixel]     = float4(Surface, Coverage);
    OutputColour[2 * Extent.Dimensions.x + Pixel] = float4(Gas, 1);
}
