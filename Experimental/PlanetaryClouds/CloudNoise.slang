/*==========================================================================================================================================
                                                              CLOUDNOISE.SLANG
==========================================================================================================================================*/
// 🧩 Packed 3D noise access and seamless planetary weather synthesis.

#ifndef FRONTIER_PLANETARY_CLOUD_NOISE
#define FRONTIER_PLANETARY_CLOUD_NOISE 1

// 📝 Declare the read-only volume before this include. Native execution interpolates packed texels;
// Vulkan may use filterable 3D images of the identical texels and mip chain.

//------------------------------------------------------------------------------------------------------------------------
//                                                PACKED VOLUME FOOTPRINT
//------------------------------------------------------------------------------------------------------------------------

static const uint CloudDetailOffset     = 128u * 128u * 128u;
static const uint CloudBlueOffset       = CloudDetailOffset + 64u * 64u * 64u;
static const uint CloudShapeMipOffset   = CloudBlueOffset + 64u * 64u;
static const uint CloudErosionMipOffset = CloudShapeMipOffset + (128u * 128u * 128u - 1u) / 7u;

float4 DecodeCloudTexel(uint Word)
{
    return float4(Word & 255u, (Word >> 8u) & 255u, (Word >> 16u) & 255u, Word >> 24u) * (1.0 / 255.0);
}

uint ReadCloudTexel(int3 Address, uint Resolution, uint Offset)
{
    uint3 Coordinate = uint3(Address) & (Resolution - 1u);
    return PlanetaryCloudNoise[Offset + (Coordinate.z * Resolution + Coordinate.y) * Resolution + Coordinate.x];
}

float4 SampleCloudVolume(float3 Coordinate, uint Size, uint Offset)
{
    float3 Projected = frac(Coordinate) * float(Size);
    int3   Corner    = int3(Projected);
    float3 Fraction  = Projected - float3(Corner);
    float4 X00       = lerp(DecodeCloudTexel(ReadCloudTexel(Corner, Size, Offset)),
                            DecodeCloudTexel(ReadCloudTexel(Corner + int3(1, 0, 0), Size, Offset)), Fraction.x);
    float4 X10       = lerp(DecodeCloudTexel(ReadCloudTexel(Corner + int3(0, 1, 0), Size, Offset)),
                            DecodeCloudTexel(ReadCloudTexel(Corner + int3(1, 1, 0), Size, Offset)), Fraction.x);
    float4 X01       = lerp(DecodeCloudTexel(ReadCloudTexel(Corner + int3(0, 0, 1), Size, Offset)),
                            DecodeCloudTexel(ReadCloudTexel(Corner + int3(1, 0, 1), Size, Offset)), Fraction.x);
    float4 X11       = lerp(DecodeCloudTexel(ReadCloudTexel(Corner + int3(0, 1, 1), Size, Offset)),
                            DecodeCloudTexel(ReadCloudTexel(Corner + int3(1, 1, 1), Size, Offset)), Fraction.x);
    return lerp(lerp(X00, X10, Fraction.y), lerp(X01, X11, Fraction.y), Fraction.z);
}

float4 SampleCloudShapeMip(float3 Coordinate, uint Level)
{
    uint Size   = 128u >> Level;
    uint Offset = Level == 0u ? 0u : CloudShapeMipOffset + (128u * 128u * 128u - 8u * Size * Size * Size) / 7u;
    return SampleCloudVolume(Coordinate - (0.5 / float(Size) - 0.5 / 128.0), Size, Offset);
}

float4 SampleCloudShape(float3 Coordinate, float FootprintM, float PeriodM)
{
    float Level = clamp(log2(max(1.0, FootprintM * 128.0 / max(1.0, PeriodM))), 0.0, 7.0);
#ifdef FRONTIER_CLOUD_TEXTURES
    return CloudShapeTexture.SampleLevel(CloudVolumeSampler, Coordinate + 0.5 / 128.0, Level);
#else
    if (Level <= 0.0) return SampleCloudVolume(Coordinate, 128u, 0u);
    uint NearLevel = uint(floor(Level));
    return lerp(SampleCloudShapeMip(Coordinate, NearLevel), SampleCloudShapeMip(Coordinate, min(7u, NearLevel + 1u)),
                frac(Level));
#endif
}

float4 SampleCloudErosionMip(float3 Coordinate, uint Level)
{
    uint Size = 64u >> Level;
    uint Offset =
        Level == 0u ? CloudDetailOffset : CloudErosionMipOffset + (64u * 64u * 64u - 8u * Size * Size * Size) / 7u;
    return SampleCloudVolume(Coordinate - (0.5 / float(Size) - 0.5 / 64.0), Size, Offset);
}

float4 SampleCloudErosion(float3 Coordinate, float FootprintM, float PeriodM)
{
    float Level = clamp(log2(max(1.0, FootprintM * 64.0 / max(1.0, PeriodM))), 0.0, 6.0);
#ifdef FRONTIER_CLOUD_TEXTURES
    return CloudErosionTexture.SampleLevel(CloudVolumeSampler, Coordinate + 0.5 / 64.0, Level);
#else
    if (Level <= 0.0) return SampleCloudVolume(Coordinate, 64u, CloudDetailOffset);
    uint NearLevel = uint(floor(Level));
    return lerp(SampleCloudErosionMip(Coordinate, NearLevel),
                SampleCloudErosionMip(Coordinate, min(6u, NearLevel + 1u)), frac(Level));
#endif
}

float CloudBlueJitter(float2 Pixel)
{
    uint2 Address = uint2(abs(Pixel)) & 63u;
    return (float(PlanetaryCloudNoise[CloudBlueOffset + Address.y * 64u + Address.x]) + 0.5) / 4096.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                          UNBOUNDED LATTICE AND BOUNDARY CURL
//------------------------------------------------------------------------------------------------------------------------

uint CloudLatticeHash(int3 Cell)
{
    uint Word = uint(Cell.x) * 0x9e3779b1u ^ uint(Cell.y) * 0x85ebca77u ^ uint(Cell.z) * 0xc2b2ae3du;
    Word      = (Word ^ (Word >> 16u)) * 0x7feb352du;
    Word      = (Word ^ (Word >> 15u)) * 0x846ca68bu;
    return Word ^ (Word >> 16u);
}

float CloudLatticeCorner(int3 Cell)
{
    return float(CloudLatticeHash(Cell) >> 8u) / 16777216.0;
}

float3 CloudQuintic(float3 Fraction)
{
    return Fraction * Fraction * Fraction * (Fraction * (6.0 * Fraction - 15.0) + 10.0);
}

// Unbounded integer lattice, evaluated in planetary Cartesian coordinates.
// It has neither a weather-map repeat interval nor a cubemap/dateline seam.
float CloudLatticeNoise(float3 Coordinate)
{
    int3   Cell     = int3(floor(Coordinate));
    float3 Fraction = CloudQuintic(Coordinate - float3(Cell));
    float  X00      = lerp(CloudLatticeCorner(Cell), CloudLatticeCorner(Cell + int3(1, 0, 0)), Fraction.x);
    float  X10 = lerp(CloudLatticeCorner(Cell + int3(0, 1, 0)), CloudLatticeCorner(Cell + int3(1, 1, 0)), Fraction.x);
    float  X01 = lerp(CloudLatticeCorner(Cell + int3(0, 0, 1)), CloudLatticeCorner(Cell + int3(1, 0, 1)), Fraction.x);
    float  X11 = lerp(CloudLatticeCorner(Cell + int3(0, 1, 1)), CloudLatticeCorner(Cell + int3(1, 1, 1)), Fraction.x);
    return lerp(lerp(X00, X10, Fraction.y), lerp(X01, X11, Fraction.y), Fraction.z);
}

float3 RotateCloudOctave(float3 Position)
{
    return float3(dot(Position, float3(0.80, -0.60, 0.0)), dot(Position, float3(0.48, 0.64, -0.60)),
                  dot(Position, float3(0.36, 0.48, 0.80)));
}

// Finite-difference curl of a scalar potential in the horizontal plane.
// Evaluate it only on active density boundaries.
float2 CloudBoundaryCurl(float3 Coordinate)
{
    const float DifferenceStep = 0.063;
    float       Δx             = CloudLatticeNoise(Coordinate + float3(DifferenceStep, 0.0, 0.0)) -
               CloudLatticeNoise(Coordinate - float3(DifferenceStep, 0.0, 0.0));
    float Δy = CloudLatticeNoise(Coordinate + float3(0.0, DifferenceStep, 0.0)) -
               CloudLatticeNoise(Coordinate - float3(0.0, DifferenceStep, 0.0));
    return float2(Δy, -Δx) / (2.0 * DifferenceStep);
}

#endif
