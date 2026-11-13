/*====================================================================================================================================
                                                       LANDFORMSHADERS.JS
====================================================================================================================================*/
// 🧩 GLSL ES 3.00 sources: shape masks, jump-flood coast distance, landform, sculpt brushes, spline fields, volumes, ray march

//------------------------------------------------------------------------------------------------------------------------
//                                                 SHARED PRELUDE
//------------------------------------------------------------------------------------------------------------------------

export const Prelude = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
`;

// 📝 Integer-hash gradient noise: stable for world coordinates far from the origin (sin-hash degrades past ~1e4).
export const NoiseSource = `
vec2 GradientHash(vec2 Lattice)
{
    uvec2 Bits = uvec2(ivec2(Lattice) + ivec2(1048576));
    Bits *= uvec2(1597334673u, 3812015801u);
    uint Mixed = (Bits.x ^ Bits.y) * 1597334673u;
    Mixed ^= Mixed >> 16;
    Mixed *= 2246822519u;
    Mixed ^= Mixed >> 13;
    float Angle = float(Mixed) * (6.28318530718 / 4294967295.0);
    return vec2(cos(Angle), sin(Angle));
}

float GradientNoise(vec2 Position)
{
    vec2 Cell = floor(Position);
    vec2 Local = Position - Cell;
    vec2 Ease = Local * Local * Local * (Local * (Local * 6.0 - 15.0) + 10.0);
    float A = dot(GradientHash(Cell), Local);
    float B = dot(GradientHash(Cell + vec2(1.0, 0.0)), Local - vec2(1.0, 0.0));
    float C = dot(GradientHash(Cell + vec2(0.0, 1.0)), Local - vec2(0.0, 1.0));
    float D = dot(GradientHash(Cell + vec2(1.0, 1.0)), Local - vec2(1.0, 1.0));
    return mix(mix(A, B, Ease.x), mix(C, D, Ease.x), Ease.y) * 1.41421356;
}

const mat2 OctaveRotation = mat2(0.8, -0.6, 0.6, 0.8);

float FractalNoise(vec2 Position, int OctaveCount)
{
    float Sum = 0.0;
    float Amplitude = 0.5;
    float Normalizer = 0.0;
    for (int OctaveIndex = 0; OctaveIndex < 9; OctaveIndex++)
    {
        if (OctaveIndex >= OctaveCount) break;
        Sum += Amplitude * GradientNoise(Position);
        Normalizer += Amplitude;
        Position = OctaveRotation * Position * 2.03 + vec2(17.13, 9.71);
        Amplitude *= 0.5;
    }
    return Sum / Normalizer;
}

float RidgedNoise(vec2 Position, int OctaveCount)
{
    float Sum = 0.0;
    float Amplitude = 0.5;
    float Weight = 1.0;
    float Normalizer = 0.0;
    for (int OctaveIndex = 0; OctaveIndex < 9; OctaveIndex++)
    {
        if (OctaveIndex >= OctaveCount) break;
        float Crest = 1.0 - abs(GradientNoise(Position));
        Crest *= Crest;
        Crest *= Weight;
        Weight = clamp(Crest * 1.7, 0.0, 1.0);
        Sum += Crest * Amplitude;
        Normalizer += Amplitude;
        Position = OctaveRotation * Position * 2.07 + vec2(5.31, 21.7);
        Amplitude *= 0.5;
    }
    return Sum / Normalizer;
}
`;

// 📝 Height lookup in world X/Z. HEIGHT_LINEAR uses hardware filtering (OES_texture_float_linear), else manual bilinear.
export const HeightSamplingSource = `
uniform sampler2D HeightTexture;
uniform vec4 RegionRect;

float SampleHeight(vec2 Planar)
{
#ifdef HEIGHT_LINEAR
    vec2 Coordinate = (Planar - RegionRect.xy) / RegionRect.zw;
    return texture(HeightTexture, Coordinate).r;
#else
    ivec2 Size = textureSize(HeightTexture, 0);
    vec2 Lattice = clamp((Planar - RegionRect.xy) / RegionRect.zw * vec2(Size) - 0.5, vec2(0.0), vec2(Size) - 1.0);
    ivec2 Lower = ivec2(floor(Lattice));
    ivec2 Upper = min(Lower + 1, Size - 1);
    vec2 Fraction = Lattice - vec2(Lower);
    float H00 = texelFetch(HeightTexture, Lower, 0).r;
    float H10 = texelFetch(HeightTexture, ivec2(Upper.x, Lower.y), 0).r;
    float H01 = texelFetch(HeightTexture, ivec2(Lower.x, Upper.y), 0).r;
    float H11 = texelFetch(HeightTexture, Upper, 0).r;
    return mix(mix(H00, H10, Fraction.x), mix(H01, H11, Fraction.x), Fraction.y);
#endif
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                              FULL-TARGET COVERAGE
//------------------------------------------------------------------------------------------------------------------------

export const CoverageVertex = `${Prelude}
layout(location = 0) in vec2 Corner;
void main()
{
    gl_Position = vec4(Corner, 0.0, 1.0);
}
`;

export const CopyFragment = `${Prelude}
uniform sampler2D SourceTexture;
out vec4 Output;
void main()
{
    Output = texelFetch(SourceTexture, ivec2(gl_FragCoord.xy), 0);
}
`;

// Region-anchored resample: re-projects a sculpt layer when its region moves or changes resolution (zero outside).
export const ResampleFragment = `${Prelude}
uniform sampler2D SourceTexture;
uniform vec4 SourceRect;
uniform vec4 TargetRect;
uniform vec2 TargetSize;
out vec4 Output;
void main()
{
    vec2 Planar = TargetRect.xy + gl_FragCoord.xy / TargetSize * TargetRect.zw;
    vec2 Coordinate = (Planar - SourceRect.xy) / SourceRect.zw;
    if (any(lessThan(Coordinate, vec2(0.0))) || any(greaterThan(Coordinate, vec2(1.0)))) { Output = vec4(0.0); return; }
    ivec2 Size = textureSize(SourceTexture, 0);
    vec2 Lattice = clamp(Coordinate * vec2(Size) - 0.5, vec2(0.0), vec2(Size) - 1.0);
    ivec2 Lower = ivec2(floor(Lattice));
    ivec2 Upper = min(Lower + 1, Size - 1);
    vec2 Fraction = Lattice - vec2(Lower);
    vec4 A = mix(texelFetch(SourceTexture, Lower, 0), texelFetch(SourceTexture, ivec2(Upper.x, Lower.y), 0), Fraction.x);
    vec4 B = mix(texelFetch(SourceTexture, ivec2(Lower.x, Upper.y), 0), texelFetch(SourceTexture, Upper, 0), Fraction.x);
    Output = mix(A, B, Fraction.y);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                           PLANAR SHAPE RASTERIZATION
//------------------------------------------------------------------------------------------------------------------------

export const ShapeFillVertex = `${Prelude}
layout(location = 0) in vec2 WorldPosition;
uniform vec4 DomainRect;
void main()
{
    gl_Position = vec4((WorldPosition - DomainRect.xy) / DomainRect.zw * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const ShapeFillFragment = `${Prelude}
uniform float Coverage;
out vec4 Output;
void main()
{
    Output = vec4(Coverage);
}
`;

export const ShapeStrokeVertex = `${Prelude}
layout(location = 0) in vec2 WorldPosition;
layout(location = 1) in vec4 SegmentEnds;
uniform vec4 DomainRect;
out vec2 PlanarPosition;
flat out vec4 Ends;
void main()
{
    PlanarPosition = WorldPosition;
    Ends = SegmentEnds;
    gl_Position = vec4((WorldPosition - DomainRect.xy) / DomainRect.zw * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const ShapeStrokeFragment = `${Prelude}
in vec2 PlanarPosition;
flat in vec4 Ends;
uniform float Radius;
uniform float Coverage;
out vec4 Output;
void main()
{
    vec2 Edge = Ends.zw - Ends.xy;
    float SegmentParameter = clamp(dot(PlanarPosition - Ends.xy, Edge) / max(dot(Edge, Edge), 1e-6), 0.0, 1.0);
    if (length(PlanarPosition - (Ends.xy + Edge * SegmentParameter)) > Radius) discard;
    Output = vec4(Coverage);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                         JUMP-FLOOD COAST DISTANCE FIELD
//------------------------------------------------------------------------------------------------------------------------

// 📝 A texel seeds the flood when any 4-neighbour lies on the other side of the coastline.
export const SeedInitializationFragment = `${Prelude}
uniform sampler2D MaskTexture;
out vec4 Output;
void main()
{
    ivec2 Texel = ivec2(gl_FragCoord.xy);
    ivec2 Size = textureSize(MaskTexture, 0);
    float Centre = step(0.5, texelFetch(MaskTexture, Texel, 0).r);
    float Boundary = 0.0;
    Boundary += abs(Centre - step(0.5, texelFetch(MaskTexture, clamp(Texel + ivec2( 1, 0), ivec2(0), Size - 1), 0).r));
    Boundary += abs(Centre - step(0.5, texelFetch(MaskTexture, clamp(Texel + ivec2(-1, 0), ivec2(0), Size - 1), 0).r));
    Boundary += abs(Centre - step(0.5, texelFetch(MaskTexture, clamp(Texel + ivec2( 0, 1), ivec2(0), Size - 1), 0).r));
    Boundary += abs(Centre - step(0.5, texelFetch(MaskTexture, clamp(Texel + ivec2( 0,-1), ivec2(0), Size - 1), 0).r));
    Output = Boundary > 0.0 ? vec4(gl_FragCoord.xy, 0.0, 1.0) : vec4(-1.0e6, -1.0e6, 0.0, 0.0);
}
`;

export const SeedJumpFragment = `${Prelude}
uniform sampler2D SeedTexture;
uniform int JumpDistance;
out vec4 Output;
void main()
{
    ivec2 Texel = ivec2(gl_FragCoord.xy);
    ivec2 Size = textureSize(SeedTexture, 0);
    vec2 NearestSeed = vec2(-1.0e6);
    float NearestDistance = 1.0e12;
    for (int OffsetZ = -1; OffsetZ <= 1; OffsetZ++)
    {
        for (int OffsetX = -1; OffsetX <= 1; OffsetX++)
        {
            ivec2 Probe = Texel + ivec2(OffsetX, OffsetZ) * JumpDistance;
            if (any(lessThan(Probe, ivec2(0))) || any(greaterThanEqual(Probe, Size))) continue;
            vec2 Seed = texelFetch(SeedTexture, Probe, 0).xy;
            if (Seed.x < -1.0e5) continue;
            vec2 Offset = Seed - gl_FragCoord.xy;
            float DistanceSquared = dot(Offset, Offset);
            if (DistanceSquared < NearestDistance)
            {
                NearestDistance = DistanceSquared;
                NearestSeed = Seed;
            }
        }
    }
    Output = vec4(NearestSeed, 0.0, 1.0);
}
`;

export const CoastDistanceFragment = `${Prelude}
uniform sampler2D MaskTexture;
uniform sampler2D SeedTexture;
uniform float DomainTexel;
out vec4 Output;
void main()
{
    ivec2 Texel = ivec2(gl_FragCoord.xy);
    float Inside = step(0.5, texelFetch(MaskTexture, Texel, 0).r);
    vec2 Seed = texelFetch(SeedTexture, Texel, 0).xy;
    float Distance = Seed.x < -1.0e5 ? 1.0e5 : max(length(Seed - gl_FragCoord.xy) - 0.5, 0.0) * DomainTexel;
    Output = vec4(Inside > 0.5 ? Distance : -Distance);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                FOUNDATION LANDFORM
//------------------------------------------------------------------------------------------------------------------------

export const FoundationFragment = `${Prelude}
${NoiseSource}
uniform sampler2D CoastTexture;
uniform vec4 RegionRect;
uniform vec4 DomainRect;
uniform vec2 TargetSize;
uniform float SeaFloorHeight;
uniform float ShoreHeight;
uniform float ShelfWidth;
uniform float CoastFalloff;
uniform int FalloffProfile;
uniform float PlateauHeight;
uniform float ReliefAmplitude;
uniform float ReliefScale;
uniform float RidgeBlend;
uniform float CoastNoiseAmplitude;
uniform float CoastNoiseScale;
uniform float Seed;
out vec4 Output;

float SampleCoast(vec2 Planar)
{
    ivec2 Size = textureSize(CoastTexture, 0);
    vec2 Lattice = clamp((Planar - DomainRect.xy) / DomainRect.zw * vec2(Size) - 0.5, vec2(0.0), vec2(Size) - 1.0);
    ivec2 Lower = ivec2(floor(Lattice));
    ivec2 Upper = min(Lower + 1, Size - 1);
    vec2 Fraction = Lattice - vec2(Lower);
    float A = mix(texelFetch(CoastTexture, Lower, 0).r, texelFetch(CoastTexture, ivec2(Upper.x, Lower.y), 0).r, Fraction.x);
    float B = mix(texelFetch(CoastTexture, ivec2(Lower.x, Upper.y), 0).r, texelFetch(CoastTexture, Upper, 0).r, Fraction.x);
    return mix(A, B, Fraction.y);
}

void main()
{
    vec2 Planar = RegionRect.xy + gl_FragCoord.xy / TargetSize * RegionRect.zw;
    vec2 SeedOffset = vec2(Seed * 37.17, Seed * -19.73);
    float Coast = SampleCoast(Planar) + CoastNoiseAmplitude * FractalNoise(Planar / CoastNoiseScale + SeedOffset * 0.31, 5);
    if (Coast < 0.0)
    {
        Output = vec4(mix(ShoreHeight, SeaFloorHeight, smoothstep(0.0, ShelfWidth, -Coast)));
        return;
    }
    float Rise = clamp(Coast / max(CoastFalloff, 1.0), 0.0, 1.0);
    float Profile = Rise;
    if (FalloffProfile == 0) Profile = smoothstep(0.0, 1.0, Rise);
    else if (FalloffProfile == 2) Profile = 1.0 - pow(1.0 - Rise, 3.0);
    else if (FalloffProfile == 3) Profile = smoothstep(0.0, 6.0, Coast);
    vec2 ReliefPosition = Planar / max(ReliefScale, 1.0) + SeedOffset;
    float Rolling = FractalNoise(ReliefPosition, 7) * 0.5 + 0.5;
    float Ridged = RidgedNoise(ReliefPosition * 0.8 + 3.7, 8);
    float Relief = mix(Rolling, Ridged, RidgeBlend);
    Output = vec4(ShoreHeight + Profile * PlateauHeight + ReliefAmplitude * Relief * Profile);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                              HEIGHT LAYER STACKING
//------------------------------------------------------------------------------------------------------------------------

export const LayerAccumulateFragment = `${Prelude}
uniform sampler2D InputHeightTexture;
uniform sampler2D DisplacementTexture;
uniform float Opacity;
out vec4 Output;
void main()
{
    ivec2 Texel = ivec2(gl_FragCoord.xy);
    Output = vec4(texelFetch(InputHeightTexture, Texel, 0).r + texelFetch(DisplacementTexture, Texel, 0).r * Opacity);
}
`;

// 📝 Brushes write a displacement layer only. Smooth/Flatten read the layer's input height so they act on the
//    visible surface, not on the raw displacement. Modes: 0 Raise · 1 Lower · 2 Smooth · 3 Flatten · 4 Noise · 5 Erase · 6 Terrace.
export const HeightBrushFragment = `${Prelude}
${NoiseSource}
uniform sampler2D DisplacementTexture;
uniform sampler2D InputHeightTexture;
uniform vec4 RegionRect;
uniform vec2 TargetSize;
uniform vec2 BrushCentre;
uniform float BrushRadius;
uniform float BrushHardness;
uniform float BrushAmount;
uniform float BrushBlend;
uniform int BrushMode;
uniform float FlattenHeight;
uniform float TerraceInterval;
uniform float NoiseScale;
out vec4 Output;

float SurfaceAt(ivec2 Texel)
{
    Texel = clamp(Texel, ivec2(0), ivec2(TargetSize) - 1);
    return texelFetch(InputHeightTexture, Texel, 0).r + texelFetch(DisplacementTexture, Texel, 0).r;
}

void main()
{
    ivec2 Texel = ivec2(gl_FragCoord.xy);
    float Displacement = texelFetch(DisplacementTexture, Texel, 0).r;
    vec2 Planar = RegionRect.xy + gl_FragCoord.xy / TargetSize * RegionRect.zw;
    float Normalized = length(Planar - BrushCentre) / BrushRadius;
    if (Normalized >= 1.0) { Output = vec4(Displacement); return; }
    float Weight = 1.0 - smoothstep(BrushHardness, 1.0, Normalized);
    float Surface = SurfaceAt(Texel);
    if (BrushMode == 0) Displacement += BrushAmount * Weight;
    else if (BrushMode == 1) Displacement -= BrushAmount * Weight;
    else if (BrushMode == 2)
    {
        int Stride = max(1, int(BrushRadius / (RegionRect.z / TargetSize.x) / 10.0));
        float Accumulated = 0.0;
        float WeightSum = 0.0;
        for (int OffsetZ = -2; OffsetZ <= 2; OffsetZ++)
        {
            for (int OffsetX = -2; OffsetX <= 2; OffsetX++)
            {
                float Gaussian = exp(-float(OffsetX * OffsetX + OffsetZ * OffsetZ) / 4.5);
                Accumulated += SurfaceAt(Texel + ivec2(OffsetX, OffsetZ) * Stride) * Gaussian;
                WeightSum += Gaussian;
            }
        }
        Displacement += (Accumulated / WeightSum - Surface) * Weight * BrushBlend;
    }
    else if (BrushMode == 3) Displacement += (FlattenHeight - Surface) * Weight * BrushBlend;
    else if (BrushMode == 4) Displacement += BrushAmount * Weight * FractalNoise(Planar / max(NoiseScale, 1.0), 4);
    else if (BrushMode == 5) Displacement *= 1.0 - Weight * BrushBlend;
    else if (BrushMode == 6)
    {
        float Level = floor(Surface / TerraceInterval);
        float Fraction = fract(Surface / TerraceInterval);
        float Stepped = (Level + smoothstep(0.75, 1.0, Fraction)) * TerraceInterval;
        Displacement += (Stepped - Surface) * Weight * BrushBlend;
    }
    Output = vec4(Displacement);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                 SPLINE PROFILES
//------------------------------------------------------------------------------------------------------------------------

// 📝 Centerline texel = (X, Z, manual height, arc). Modes: 0 Follow terrain · 1 Grade between end heights · 2 Manual.
export const ProfileSampleFragment = `${Prelude}
${HeightSamplingSource}
uniform sampler2D CenterlineTexture;
uniform int ProfileMode;
uniform int SampleCount;
out vec4 Output;
void main()
{
    int SampleIndex = int(gl_FragCoord.x);
    vec4 Centerline = texelFetch(CenterlineTexture, ivec2(SampleIndex, 0), 0);
    if (ProfileMode == 2) { Output = vec4(Centerline.z); return; }
    if (ProfileMode == 1)
    {
        vec4 First = texelFetch(CenterlineTexture, ivec2(0, 0), 0);
        vec4 Last = texelFetch(CenterlineTexture, ivec2(SampleCount - 1, 0), 0);
        float Parameter = Last.w > 0.0 ? Centerline.w / Last.w : 0.0;
        Output = vec4(mix(SampleHeight(First.xy), SampleHeight(Last.xy), Parameter));
        return;
    }
    Output = vec4(SampleHeight(Centerline.xy));
}
`;

export const ProfileSmoothFragment = `${Prelude}
uniform sampler2D ProfileTexture;
uniform int SampleCount;
uniform float SmoothingSamples;
out vec4 Output;
void main()
{
    int SampleIndex = int(gl_FragCoord.x);
    float Stride = max(1.0, SmoothingSamples / 48.0);
    float Sigma = max(SmoothingSamples * 0.5, 0.5);
    float Accumulated = 0.0;
    float WeightSum = 0.0;
    for (int TapIndex = -48; TapIndex <= 48; TapIndex++)
    {
        float Offset = float(TapIndex) * Stride;
        if (abs(Offset) > SmoothingSamples) continue;
        int Probe = clamp(SampleIndex + int(round(Offset)), 0, SampleCount - 1);
        float Gaussian = exp(-(Offset * Offset) / (2.0 * Sigma * Sigma));
        Accumulated += texelFetch(ProfileTexture, ivec2(Probe, 0), 0).r * Gaussian;
        WeightSum += Gaussian;
    }
    Output = vec4(Accumulated / WeightSum);
}
`;

// Hillis–Steele prefix minimum: after log2(N) rounds each sample holds the minimum of everything upstream of it.
export const ProfileDescentFragment = `${Prelude}
uniform sampler2D ProfileTexture;
uniform int Stride;
out vec4 Output;
void main()
{
    int SampleIndex = int(gl_FragCoord.x);
    float Current = texelFetch(ProfileTexture, ivec2(SampleIndex, 0), 0).r;
    if (SampleIndex >= Stride) Current = min(Current, texelFetch(ProfileTexture, ivec2(SampleIndex - Stride, 0), 0).r);
    Output = vec4(Current);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                          SPLINE DISTANCE FIELD + OPERATION
//------------------------------------------------------------------------------------------------------------------------

// 📝 Each centerline segment rasterizes a quad covering its reach; exact segment distance goes to gl_FragDepth so the
//    depth test keeps the nearest segment per texel — an exact polyline distance field at the cost of its footprint.
export const SplineFieldVertex = `${Prelude}
layout(location = 0) in vec2 WorldPosition;
layout(location = 1) in vec4 SegmentEnds;
layout(location = 2) in vec2 SampleIndices;
uniform vec4 RegionRect;
out vec2 PlanarPosition;
flat out vec4 Ends;
flat out vec2 Indices;
void main()
{
    PlanarPosition = WorldPosition;
    Ends = SegmentEnds;
    Indices = SampleIndices;
    gl_Position = vec4((WorldPosition - RegionRect.xy) / RegionRect.zw * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SplineFieldFragment = `${Prelude}
in vec2 PlanarPosition;
flat in vec4 Ends;
flat in vec2 Indices;
uniform float Reach;
out vec4 Output;
void main()
{
    vec2 Edge = Ends.zw - Ends.xy;
    float SegmentParameter = clamp(dot(PlanarPosition - Ends.xy, Edge) / max(dot(Edge, Edge), 1e-6), 0.0, 1.0);
    vec2 Offset = PlanarPosition - (Ends.xy + Edge * SegmentParameter);
    float Distance = length(Offset);
    if (Distance > Reach) discard;
    float Side = sign(Edge.x * Offset.y - Edge.y * Offset.x);
    gl_FragDepth = Distance / Reach;
    Output = vec4(Distance, mix(Indices.x, Indices.y, SegmentParameter), Side, 1.0);
}
`;

// Spline categories: 0 Road (cut + fill) · 1 River (carve channel) · 2 Canyon (deep stratified carve) · 3 Ridge (raise).
export const SplineOperationFragment = `${Prelude}
${NoiseSource}
uniform sampler2D InputHeightTexture;
uniform sampler2D FieldTexture;
uniform sampler2D ProfileTexture;
uniform vec4 RegionRect;
uniform vec2 TargetSize;
uniform int Category;
uniform int ProfileMode;
uniform int SampleCount;
uniform float HalfWidth;
uniform float Falloff;
uniform float Depth;
uniform float Roughness;
uniform float StrataInterval;
uniform float Offset;
uniform float Opacity;
out vec4 Output;

float ProfileAt(float FractionalIndex)
{
    float Clamped = clamp(FractionalIndex, 0.0, float(SampleCount - 1));
    int Lower = int(floor(Clamped));
    int Upper = min(Lower + 1, SampleCount - 1);
    return mix(texelFetch(ProfileTexture, ivec2(Lower, 0), 0).r, texelFetch(ProfileTexture, ivec2(Upper, 0), 0).r, Clamped - float(Lower)) + Offset;
}

void main()
{
    ivec2 Texel = ivec2(gl_FragCoord.xy);
    float Height = texelFetch(InputHeightTexture, Texel, 0).r;
    vec4 Field = texelFetch(FieldTexture, Texel, 0);
    if (Field.w < 0.5) { Output = vec4(Height); return; }
    vec2 Planar = RegionRect.xy + gl_FragCoord.xy / TargetSize * RegionRect.zw;
    float Distance = max(0.0, Field.x + Roughness * FractalNoise(Planar / max(HalfWidth * 3.0, 6.0), 4));
    float Profile = ProfileAt(Field.y);
    float FalloffParameter = clamp((Distance - HalfWidth) / max(Falloff, 0.01), 0.0, 1.0);
    float Influence = Distance <= HalfWidth ? 1.0 : 1.0 - smoothstep(0.0, 1.0, FalloffParameter);
    float Result = Height;
    if (Category == 0)
    {
        Result = mix(Height, Profile, Influence * Opacity);
    }
    else if (Category == 1)
    {
        float Across = Distance / max(HalfWidth, 0.01);
        float Target = Distance <= HalfWidth ? Profile - Depth * (1.0 - Across * Across) : mix(Profile, Height, smoothstep(0.0, 1.0, FalloffParameter));
        Result = min(Height, mix(Height, Target, Opacity));
    }
    else if (Category == 2)
    {
        float Floor = Profile - Depth;
        float Wall = Floor + (Height - Floor) * smoothstep(0.0, 1.0, FalloffParameter);
        if (StrataInterval > 0.5 && Distance > HalfWidth)
        {
            float Relative = max(Wall - Floor, 0.0) / StrataInterval;
            Wall = Floor + (floor(Relative) + smoothstep(0.55, 1.0, fract(Relative))) * StrataInterval;
        }
        float Target = Distance <= HalfWidth ? Floor : Wall;
        Result = min(Height, mix(Height, Target, Opacity));
    }
    else if (Category == 3)
    {
        float Reach = HalfWidth + Falloff;
        float Crest = pow(1.0 - smoothstep(0.0, 1.0, max(Distance - HalfWidth * 0.35, 0.0) / max(Reach - HalfWidth * 0.35, 0.01)), 1.4);
        float Variation = 1.0 + 0.3 * FractalNoise(Planar / max(Reach * 1.2, 8.0) + 11.0, 4);
        if (ProfileMode == 0) Result = Height + Opacity * Depth * Crest * Variation;
        else Result = max(Height, mix(Height, Profile + Depth * Crest * Variation, Influence * Opacity));
    }
    Output = vec4(Result);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                VOLUMETRIC CHANNELS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Volume texture axes: texture X = world X, texture Y = world Z, slice = world Y. Composite channels:
//    R = tunnel bore distance · G = volumetric carve distance · B = volumetric addition distance. Every channel holds
//    min(true signed distance, Clearance), so a cleared voxel means "at least Clearance metres from any edit".
export const VolumeLayerMinimumFragment = `${Prelude}
uniform sampler3D LayerTexture;
uniform int SliceIndex;
uniform float Clearance;
out vec4 Output;
void main()
{
    vec4 Layer = texelFetch(LayerTexture, ivec3(ivec2(gl_FragCoord.xy), SliceIndex), 0);
    Output = vec4(Clearance, Layer.r, Layer.g, Clearance);
}
`;

export const VolumeCopyFragment = `${Prelude}
uniform sampler3D SourceTexture;
uniform int SliceIndex;
out vec4 Output;
void main()
{
    Output = texelFetch(SourceTexture, ivec3(ivec2(gl_FragCoord.xy), SliceIndex), 0);
}
`;

export const VolumeResampleFragment = `${Prelude}
uniform sampler3D SourceTexture;
uniform vec3 SourceMinimum;
uniform vec3 SourceSize;
uniform vec3 TargetMinimum;
uniform vec3 TargetSize;
uniform vec3 TargetDimensions;
uniform int SliceIndex;
uniform float Clearance;
out vec4 Output;
void main()
{
    vec3 Lattice = vec3(gl_FragCoord.xy, float(SliceIndex) + 0.5) / TargetDimensions;
    vec3 World = TargetMinimum + vec3(Lattice.x, Lattice.z, Lattice.y) * TargetSize;
    vec3 Normalized = (World - SourceMinimum) / SourceSize;
    if (any(lessThan(Normalized, vec3(0.0))) || any(greaterThan(Normalized, vec3(1.0)))) { Output = vec4(Clearance); return; }
    Output = texture(SourceTexture, vec3(Normalized.x, Normalized.z, Normalized.y));
}
`;

// Volume brush modes: 0 Add (smooth union) · 1 Carve (smooth union into carve channel) · 2 Restore (erase both).
export const VolumeBrushFragment = `${Prelude}
${NoiseSource}
uniform sampler3D LayerTexture;
uniform int SliceIndex;
uniform vec3 VolumeMinimum;
uniform vec3 VolumeSize;
uniform vec3 VolumeDimensions;
uniform vec3 BrushCentre;
uniform float BrushRadius;
uniform float BrushBlend;
uniform float BrushRoughness;
uniform int BrushMode;
uniform float Clearance;
out vec4 Output;

float SmoothMinimum(float A, float B, float Blend)
{
    float Mixing = clamp(0.5 + 0.5 * (B - A) / Blend, 0.0, 1.0);
    return mix(B, A, Mixing) - Blend * Mixing * (1.0 - Mixing);
}

void main()
{
    vec4 Layer = texelFetch(LayerTexture, ivec3(ivec2(gl_FragCoord.xy), SliceIndex), 0);
    vec3 Lattice = vec3(gl_FragCoord.xy, float(SliceIndex) + 0.5) / VolumeDimensions;
    vec3 World = VolumeMinimum + vec3(Lattice.x, Lattice.z, Lattice.y) * VolumeSize;
    float Sphere = length(World - BrushCentre) - BrushRadius;
    Sphere += BrushRoughness * BrushRadius * 0.35 * FractalNoise(World.xz / max(BrushRadius * 0.6, 1.0) + World.y * 0.031, 3);
    float Blend = max(BrushRadius * BrushBlend, 0.01);
    if (BrushMode == 0) Layer.g = min(SmoothMinimum(Layer.g, Sphere, Blend), Clearance);
    else if (BrushMode == 1) Layer.r = min(SmoothMinimum(Layer.r, Sphere, Blend), Clearance);
    else
    {
        Layer.r = min(max(Layer.r, -Sphere), Clearance);
        Layer.g = min(max(Layer.g, -Sphere), Clearance);
    }
    Output = Layer;
}
`;

// 📝 Tunnel bore: per slice, each centerline segment expands to a quad around its X/Z footprint; segments whose
//    vertical range misses the slice are culled in the vertex shader. Cross-section = flat floor + arched roof.
export const TunnelVertex = `${Prelude}
layout(location = 0) in vec2 Corner;
layout(location = 1) in vec2 SampleIndices;
uniform sampler2D CenterlineTexture;
uniform sampler2D ProfileTexture;
uniform vec4 RegionRect;
uniform float SliceHeight;
uniform float Clearance;
uniform float HalfWidth;
uniform float BoreHeight;
uniform float Offset;
out vec2 PlanarPosition;
flat out vec3 EndA;
flat out vec3 EndB;
void main()
{
    vec2 A = texelFetch(CenterlineTexture, ivec2(int(SampleIndices.x), 0), 0).xy;
    vec2 B = texelFetch(CenterlineTexture, ivec2(int(SampleIndices.y), 0), 0).xy;
    float HeightA = texelFetch(ProfileTexture, ivec2(int(SampleIndices.x), 0), 0).r + Offset;
    float HeightB = texelFetch(ProfileTexture, ivec2(int(SampleIndices.y), 0), 0).r + Offset;
    EndA = vec3(A, HeightA);
    EndB = vec3(B, HeightB);
    float Reach = max(HalfWidth, BoreHeight) + Clearance;
    if (SliceHeight < min(HeightA, HeightB) - Clearance || SliceHeight > max(HeightA, HeightB) + BoreHeight + Clearance)
    {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        PlanarPosition = vec2(0.0);
        return;
    }
    vec2 Along = B - A;
    float Length = length(Along);
    Along = Length > 1e-5 ? Along / Length : vec2(1.0, 0.0);
    vec2 Lateral = vec2(-Along.y, Along.x);
    vec2 Origin = Corner.x < 0.0 ? A - Along * Reach : B + Along * Reach;
    PlanarPosition = Origin + Lateral * Corner.y * Reach;
    gl_Position = vec4((PlanarPosition - RegionRect.xy) / RegionRect.zw * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const TunnelFragment = `${Prelude}
in vec2 PlanarPosition;
flat in vec3 EndA;
flat in vec3 EndB;
uniform float SliceHeight;
uniform float Clearance;
uniform float HalfWidth;
uniform float BoreHeight;
out vec4 Output;
void main()
{
    vec2 Edge = EndB.xy - EndA.xy;
    float SegmentParameter = clamp(dot(PlanarPosition - EndA.xy, Edge) / max(dot(Edge, Edge), 1e-6), 0.0, 1.0);
    float Lateral = length(PlanarPosition - (EndA.xy + Edge * SegmentParameter));
    float Vertical = SliceHeight - mix(EndA.z, EndB.z, SegmentParameter);
    float ArchHeight = max(BoreHeight, HalfWidth + 0.5);
    float WallTop = ArchHeight - HalfWidth;
    vec2 BoxDelta = abs(vec2(Lateral, Vertical - WallTop * 0.5)) - vec2(HalfWidth, WallTop * 0.5);
    float Walls = length(max(BoxDelta, 0.0)) + min(max(BoxDelta.x, BoxDelta.y), 0.0);
    float Arch = length(vec2(Lateral, Vertical - WallTop)) - HalfWidth;
    Output = vec4(min(min(Walls, Arch), Clearance), Clearance, Clearance, Clearance);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                 PLANAR HILLSHADE
//------------------------------------------------------------------------------------------------------------------------

export const HillshadeFragment = `${Prelude}
${HeightSamplingSource}
uniform vec2 TargetSize;
uniform float WaterLevel;
out vec4 Output;
void main()
{
    vec2 Planar = RegionRect.xy + gl_FragCoord.xy / TargetSize * RegionRect.zw;
    float Step = RegionRect.z / TargetSize.x;
    float Height = SampleHeight(Planar);
    float GradientX = (SampleHeight(Planar + vec2(Step, 0.0)) - SampleHeight(Planar - vec2(Step, 0.0))) / (2.0 * Step);
    float GradientZ = (SampleHeight(Planar + vec2(0.0, Step)) - SampleHeight(Planar - vec2(0.0, Step))) / (2.0 * Step);
    vec3 Normal = normalize(vec3(-GradientX, 1.0, -GradientZ));
    float Shade = clamp(dot(Normal, normalize(vec3(-0.6, 0.8, -0.45))), 0.0, 1.0);
    vec3 Tint;
    if (Height < WaterLevel) Tint = mix(vec3(0.10, 0.20, 0.30), vec3(0.20, 0.38, 0.50), smoothstep(-60.0, 0.0, Height - WaterLevel));
    else Tint = mix(mix(vec3(0.34, 0.40, 0.24), vec3(0.50, 0.46, 0.36), smoothstep(30.0, 160.0, Height)), vec3(0.88), smoothstep(240.0, 330.0, Height));
    float Contour = abs(fract(Height / 25.0 + 0.5) - 0.5) * 25.0 / max(length(vec2(GradientX, GradientZ)) * Step, 1e-3);
    vec3 Colour = Tint * (0.35 + 0.75 * Shade) * mix(0.82, 1.0, smoothstep(0.0, 1.2, Contour));
    Output = vec4(Colour, 1.0);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                 VIEWPORT RAY MARCH
//------------------------------------------------------------------------------------------------------------------------

// 📝 The terrain SDF: max(heightfield slab, region box), minus tunnel/carve volumes, union additions.
//    (p.y − H) is not a true distance on steep slopes; LipschitzScale shortens steps and a bisection refines hits.
export const TerrainMarchFragment = `${Prelude}
${HeightSamplingSource}
uniform mat4 InverseViewProjection;
uniform mat4 ViewProjection;
uniform vec3 CameraPosition;
uniform vec2 ViewportSize;
uniform vec2 PickPixel;
uniform vec3 RegionMinimum;
uniform vec3 RegionMaximum;
uniform sampler3D VolumeTexture;
uniform int VolumeEnabled;
uniform int AdditionEnabled;
uniform vec3 SunDirection;
uniform int Lens;
uniform int ContoursEnabled;
uniform int ShadowsEnabled;
uniform int WaterEnabled;
uniform float ContourInterval;
uniform float WaterLevel;
uniform float PixelFootprint;
uniform vec4 Brush;
uniform int BrushVolumetric;
uniform float LipschitzScale;
out vec4 Output;

float SurfaceDistance(vec3 Position)
{
    float Distance = (Position.y - SampleHeight(Position.xz)) * LipschitzScale;
    if (VolumeEnabled == 1)
    {
        vec3 Normalized = (Position - RegionMinimum) / (RegionMaximum - RegionMinimum);
        vec4 Volume = texture(VolumeTexture, vec3(Normalized.x, Normalized.z, Normalized.y));
        Distance = max(Distance, -min(Volume.r, Volume.g));
        if (AdditionEnabled == 1) Distance = min(Distance, Volume.b);
    }
    vec3 Centre = (RegionMinimum + RegionMaximum) * 0.5;
    vec3 BoxDelta = abs(Position - Centre) - (RegionMaximum - RegionMinimum) * 0.5;
    float Box = length(max(BoxDelta, 0.0)) + min(max(BoxDelta.x, max(BoxDelta.y, BoxDelta.z)), 0.0);
    return max(Distance, Box);
}

vec2 IntersectRegion(vec3 Origin, vec3 Direction)
{
    vec3 Inverse = 1.0 / Direction;
    vec3 Near = (RegionMinimum - Origin) * Inverse;
    vec3 Far = (RegionMaximum - Origin) * Inverse;
    vec3 Lower = min(Near, Far);
    vec3 Upper = max(Near, Far);
    return vec2(max(max(Lower.x, Lower.y), Lower.z), min(min(Upper.x, Upper.y), Upper.z));
}

vec3 SurfaceNormal(vec3 Position, float Spacing)
{
    const vec2 Tetra = vec2(1.0, -1.0);
    return normalize(Tetra.xyy * SurfaceDistance(Position + Tetra.xyy * Spacing) +
                     Tetra.yyx * SurfaceDistance(Position + Tetra.yyx * Spacing) +
                     Tetra.yxy * SurfaceDistance(Position + Tetra.yxy * Spacing) +
                     Tetra.xxx * SurfaceDistance(Position + Tetra.xxx * Spacing));
}

float MarchSurface(vec3 Origin, vec3 Direction, out float Steps)
{
    vec2 Span = IntersectRegion(Origin, Direction);
    Steps = 0.0;
    if (Span.y < max(Span.x, 0.0)) return -1.0;
    float Travel = max(Span.x, 0.0);
    float Previous = Travel;
    for (int StepIndex = 0; StepIndex < 320; StepIndex++)
    {
        Steps += 1.0;
        float Distance = SurfaceDistance(Origin + Direction * Travel);
        if (Distance < 0.0)
        {
            float Lower = Previous;
            float Upper = Travel;
            for (int Bisection = 0; Bisection < 8; Bisection++)
            {
                float Middle = 0.5 * (Lower + Upper);
                if (SurfaceDistance(Origin + Direction * Middle) < 0.0) Upper = Middle; else Lower = Middle;
            }
            return Upper;
        }
        if (Distance < 0.0007 * Travel + 0.004) return Travel;
        Previous = Travel;
        Travel += max(Distance, 0.0004 * Travel + 0.01);
        if (Travel > Span.y) return -1.0;
    }
    return Travel;
}

float SunVisibility(vec3 Position, vec3 Normal)
{
    float Travel = 0.5 + 0.002 * length(Position - CameraPosition);
    float Visibility = 1.0;
    vec3 Origin = Position + Normal * 0.4;
    for (int StepIndex = 0; StepIndex < 40; StepIndex++)
    {
        vec3 Probe = Origin + SunDirection * Travel;
        if (any(lessThan(Probe, RegionMinimum)) || any(greaterThan(Probe, RegionMaximum))) break;
        float Distance = SurfaceDistance(Probe);
        Visibility = min(Visibility, 10.0 * Distance / Travel);
        if (Visibility < 0.01) break;
        Travel += clamp(Distance, 1.0, 40.0);
    }
    return clamp(Visibility, 0.0, 1.0);
}

float Occlusion(vec3 Position, vec3 Normal)
{
    float Occluded = 0.0;
    float Weight = 1.0;
    for (int SampleIndex = 1; SampleIndex <= 4; SampleIndex++)
    {
        float Spacing = 3.0 * float(SampleIndex * SampleIndex);
        Occluded += (Spacing - SurfaceDistance(Position + Normal * Spacing) / LipschitzScale) * Weight / Spacing;
        Weight *= 0.6;
    }
    return clamp(1.0 - Occluded * 0.45, 0.25, 1.0);
}

vec3 SkyColour(vec3 Direction)
{
    float Elevation = clamp(Direction.y, -1.0, 1.0);
    vec3 Horizon = vec3(0.56, 0.62, 0.68);
    vec3 Zenith = vec3(0.17, 0.27, 0.42);
    vec3 Colour = mix(Horizon, Zenith, pow(max(Elevation, 0.0), 0.6));
    if (Elevation < 0.0) Colour = mix(Horizon, vec3(0.09), min(-Elevation * 4.0, 1.0));
    return Colour + vec3(1.0, 0.85, 0.6) * pow(max(dot(Direction, SunDirection), 0.0), 600.0) * 2.0;
}

void main()
{
#ifdef PICK
    vec2 Pixel = PickPixel;
#else
    vec2 Pixel = gl_FragCoord.xy;
#endif
    vec2 Device = Pixel / ViewportSize * 2.0 - 1.0;
    vec4 NearPoint = InverseViewProjection * vec4(Device, -1.0, 1.0);
    vec4 FarPoint = InverseViewProjection * vec4(Device, 1.0, 1.0);
    vec3 Origin = CameraPosition;
    vec3 Direction = normalize(FarPoint.xyz / FarPoint.w - NearPoint.xyz / NearPoint.w);
    float Steps;
    float Travel = MarchSurface(Origin, Direction, Steps);
#ifdef PICK
    Output = Travel < 0.0 ? vec4(0.0, 0.0, 0.0, -1.0) : vec4(Origin + Direction * Travel, Travel);
    return;
#else
    vec3 Colour;
    float Depth = 1.0;
    if (Travel < 0.0)
    {
        Colour = SkyColour(Direction);
    }
    else
    {
        vec3 Position = Origin + Direction * Travel;
        vec3 Normal = SurfaceNormal(Position, max(0.25, Travel * 0.0012));
        float Terrain = SampleHeight(Position.xz);
        float Underside = smoothstep(0.5, 3.0, Terrain - Position.y);
        float Slope = 1.0 - Normal.y;
        vec3 Grass = mix(vec3(0.27, 0.33, 0.17), vec3(0.36, 0.38, 0.22), smoothstep(40.0, 140.0, Position.y));
        vec3 Rock = mix(vec3(0.40, 0.37, 0.33), vec3(0.30, 0.28, 0.26), smoothstep(0.0, 1.0, fract(Position.y / 9.0)));
        vec3 Sand = vec3(0.62, 0.56, 0.42);
        vec3 Albedo = mix(Grass, Rock, smoothstep(0.22, 0.42, Slope));
        Albedo = mix(Albedo, Sand, (1.0 - smoothstep(WaterLevel + 1.5, WaterLevel + 5.0, Position.y)) * (1.0 - smoothstep(0.2, 0.4, Slope)));
        Albedo = mix(Albedo, vec3(0.92, 0.93, 0.95), smoothstep(250.0, 300.0, Position.y + Normal.y * 25.0) * (1.0 - smoothstep(0.35, 0.55, Slope)));
        Albedo = mix(Albedo, vec3(0.30, 0.27, 0.24), Underside);
        if (any(lessThan(abs(Position - RegionMinimum), vec3(0.6))) || any(lessThan(abs(Position - RegionMaximum), vec3(0.6)))) Albedo = mix(Albedo, vec3(0.24, 0.22, 0.20), 0.6);
        if (Lens == 1) Albedo = mix(vec3(0.20, 0.55, 0.30), mix(vec3(0.95, 0.80, 0.25), vec3(0.85, 0.25, 0.20), smoothstep(0.35, 0.7, Slope)), smoothstep(0.05, 0.35, Slope));
        else if (Lens == 2)
        {
            float Normalized = clamp((Position.y - RegionMinimum.y) / (RegionMaximum.y - RegionMinimum.y), 0.0, 1.0);
            Albedo = mix(mix(vec3(0.15, 0.30, 0.60), vec3(0.30, 0.65, 0.35), smoothstep(0.0, 0.35, Normalized)), mix(vec3(0.85, 0.70, 0.35), vec3(0.95), smoothstep(0.7, 1.0, Normalized)), smoothstep(0.35, 0.7, Normalized));
        }
        else if (Lens == 3) Albedo = Normal * 0.5 + 0.5;
        float Sunlight = max(dot(Normal, SunDirection), 0.0);
        float Shadow = (ShadowsEnabled == 1 && Sunlight > 0.0) ? SunVisibility(Position, Normal) : 1.0;
        float Ambient = Occlusion(Position, Normal);
        vec3 Light = vec3(1.0, 0.94, 0.84) * Sunlight * Shadow * 1.25 + mix(vec3(0.20, 0.18, 0.16), vec3(0.34, 0.42, 0.55), Normal.y * 0.5 + 0.5) * Ambient;
        Colour = Lens == 3 ? Albedo : Albedo * Light;
        if (ContoursEnabled == 1)
        {
            float Horizontal = sqrt(max(1.0 - Normal.y * Normal.y, 1e-4)) / max(Normal.y, 0.05);
            float LineHeight = max(PixelFootprint * Travel * Horizontal * 0.9, 0.02);
            float Offset = abs(fract(Position.y / ContourInterval + 0.5) - 0.5) * ContourInterval;
            float Major = abs(fract(Position.y / (ContourInterval * 5.0) + 0.5) - 0.5) * ContourInterval * 5.0;
            Colour = mix(Colour, Colour * 0.55, (1.0 - smoothstep(0.0, LineHeight, Offset)) * 0.6);
            Colour = mix(Colour, Colour * 0.35, (1.0 - smoothstep(0.0, LineHeight * 1.6, Major)) * 0.7);
        }
        if (Brush.w > 0.0)
        {
            float Distance = BrushVolumetric == 1 ? length(Position - Brush.xyz) : length(Position.xz - Brush.xz);
            float RingWidth = max(PixelFootprint * Travel * 1.6, 0.05);
            float Ring = 1.0 - smoothstep(RingWidth * 0.5, RingWidth, abs(Distance - Brush.w));
            Colour = mix(Colour, Colour * 1.25 + vec3(0.04), (1.0 - step(Brush.w, Distance)) * 0.35);
            Colour = mix(Colour, vec3(0.97, 0.97, 0.92), Ring * 0.9);
        }
        vec4 Clip = ViewProjection * vec4(Position, 1.0);
        Depth = clamp(Clip.z / Clip.w * 0.5 + 0.5, 0.0, 1.0);
        Colour = mix(Colour, SkyColour(Direction) * 0.95, 1.0 - exp(-Travel * 0.00018));
    }
    if (WaterEnabled == 1 && abs(Direction.y) > 1e-4)
    {
        float WaterTravel = (WaterLevel - Origin.y) / Direction.y;
        vec3 WaterPoint = Origin + Direction * WaterTravel;
        bool InsideRegion = all(greaterThanEqual(WaterPoint.xz, RegionMinimum.xz)) && all(lessThanEqual(WaterPoint.xz, RegionMaximum.xz));
        if (WaterTravel > 0.0 && InsideRegion && (Travel < 0.0 || WaterTravel < Travel) && WaterLevel > RegionMinimum.y)
        {
            float Thickness = Travel < 0.0 ? 200.0 : Travel - WaterTravel;
            vec3 Deep = vec3(0.05, 0.16, 0.24);
            float Fresnel = 0.04 + 0.96 * pow(1.0 - abs(Direction.y), 5.0);
            vec3 Water = mix(Colour * vec3(0.55, 0.8, 0.85), Deep, 1.0 - exp(-Thickness * 0.09));
            Water = mix(Water, SkyColour(reflect(Direction, vec3(0.0, 1.0, 0.0))), Fresnel * 0.6);
            Colour = mix(Water, Colour, 1.0 - smoothstep(0.0, 0.6, Thickness));
            vec4 Clip = ViewProjection * vec4(WaterPoint, 1.0);
            Depth = min(Depth, clamp(Clip.z / Clip.w * 0.5 + 0.5, 0.0, 1.0));
        }
    }
    if (Lens == 4) Colour = mix(vec3(0.05, 0.1, 0.3), vec3(1.0, 0.3, 0.1), Steps / 160.0);
    gl_FragDepth = Depth;
    Output = vec4(pow(Colour, vec3(1.0 / 1.1)), 1.0);
#endif
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                 VIEWPORT OVERLAYS
//------------------------------------------------------------------------------------------------------------------------

// 📝 HeightSource: 0 = drape on the evaluated height · 1 = spline profile texture (+Offset) · 2 = explicit Y in Sample.z.
export const OverlayVertex = `${Prelude}
${HeightSamplingSource}
layout(location = 0) in vec4 Sample;
uniform mat4 ViewProjection;
uniform sampler2D ProfileTexture;
uniform int HeightSource;
uniform float Offset;
uniform float Lift;
uniform float PointSize;
void main()
{
    float Height = Sample.z;
    if (HeightSource == 0) Height = SampleHeight(Sample.xy);
    else if (HeightSource == 1) Height = texelFetch(ProfileTexture, ivec2(int(Sample.z), 0), 0).r + Offset;
    gl_Position = ViewProjection * vec4(Sample.x, Height + Lift + Sample.w, Sample.y, 1.0);
    gl_PointSize = PointSize;
}
`;

export const OverlayFragment = `${Prelude}
uniform vec4 Colour;
uniform int PointMode;
out vec4 Output;
void main()
{
    if (PointMode == 1)
    {
        vec2 Offset = gl_PointCoord * 2.0 - 1.0;
        float Radius = dot(Offset, Offset);
        if (Radius > 1.0) discard;
        Output = Radius > 0.45 ? vec4(0.05, 0.05, 0.05, Colour.a) : Colour;
        return;
    }
    Output = Colour;
}
`;
