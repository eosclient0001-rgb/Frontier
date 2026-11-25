/*====================================================================================================================================
                                                        SHADERLIBRARY.JS
====================================================================================================================================*/
// 🧩 GLSL ES 3.0 sources for the terrain layer stack, sculpt stamps, sparse tunnel SDF volume, relief raymarch and plan view

//------------------------------------------------------------------------------------------------------------------------
//                                                    SHARED CHUNKS
//------------------------------------------------------------------------------------------------------------------------

export const FullscreenVertex = /* glsl */`
out vec2 vUv;
void main()
{
    vec2 Corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vUv = Corner;
    gl_Position = vec4(Corner * 2.0 - 1.0, 0.0, 1.0);
}`;

// 📝 Rectangle in normalized target space (uRect = min.xy, max.xy), rasterized as a 4-vertex strip.
export const RectVertex = /* glsl */`
uniform vec4 uRect;
out vec2 vUv;
void main()
{
    vec2 Corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
    vUv = mix(uRect.xy, uRect.zw, Corner);
    gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;

// 📝 World-space polygon fan vertices (x, z) mapped into the terrain bounds for stencil even-odd filling.
export const FanVertex = /* glsl */`
in vec2 aWorld;
uniform vec2 uOrigin;
uniform vec2 uSize;
void main()
{
    vec2 Local = (aWorld - uOrigin) / uSize;
    gl_Position = vec4(Local * 2.0 - 1.0, 0.0, 1.0);
}`;

const NoiseChunk = /* glsl */`
uint HashLattice(uvec2 V)
{
    V = V * 1664525u + 1013904223u;
    V.x += V.y * 1664525u;
    V.y += V.x * 1664525u;
    V ^= V >> 16u;
    V.x += V.y * 1664525u;
    V.y += V.x * 1664525u;
    V ^= V >> 16u;
    return V.x ^ V.y;
}

vec2 LatticeGradient(ivec2 Cell, uint Seed)
{
    uint H = HashLattice(uvec2(Cell) + uvec2(Seed * 7919u, Seed * 104729u));
    float Theta = float(H) * (6.28318530718 / 4294967296.0);
    return vec2(cos(Theta), sin(Theta));
}

float GradientNoise(vec2 P, uint Seed)
{
    vec2 Floor = floor(P);
    ivec2 I = ivec2(Floor);
    vec2 F = P - Floor;
    vec2 U = F * F * F * (F * (F * 6.0 - 15.0) + 10.0);
    float A = dot(LatticeGradient(I, Seed), F);
    float B = dot(LatticeGradient(I + ivec2(1, 0), Seed), F - vec2(1.0, 0.0));
    float C = dot(LatticeGradient(I + ivec2(0, 1), Seed), F - vec2(0.0, 1.0));
    float D = dot(LatticeGradient(I + ivec2(1, 1), Seed), F - vec2(1.0, 1.0));
    return mix(mix(A, B, U.x), mix(C, D, U.x), U.y) * 1.414;
}

float FractalNoise(vec2 P, int Octaves, uint Seed)
{
    float Sum = 0.0, Amplitude = 0.5, Norm = 0.0;
    mat2 Rotation = mat2(0.8, -0.6, 0.6, 0.8);
    for (int Octave = 0; Octave < 8; ++Octave)
    {
        if (Octave >= Octaves) break;
        Sum += Amplitude * GradientNoise(P, Seed + uint(Octave) * 31u);
        Norm += Amplitude;
        P = Rotation * P * 2.03;
        Amplitude *= 0.5;
    }
    return Sum / Norm;
}

float RidgedNoise(vec2 P, int Octaves, uint Seed)
{
    float Sum = 0.0, Amplitude = 0.5, Norm = 0.0, Weight = 1.0;
    mat2 Rotation = mat2(0.8, -0.6, 0.6, 0.8);
    for (int Octave = 0; Octave < 8; ++Octave)
    {
        if (Octave >= Octaves) break;
        float Ridge = 1.0 - abs(GradientNoise(P, Seed + uint(Octave) * 57u));
        Ridge *= Ridge;
        Sum += Ridge * Amplitude * Weight;
        Weight = clamp(Ridge * 1.6, 0.0, 1.0);
        Norm += Amplitude;
        P = Rotation * P * 2.07;
        Amplitude *= 0.5;
    }
    return Sum / Norm * 2.0 - 0.6;
}`;

// 📝 Bilinear Float32 height fetch; hardware filtering is used only when OES_texture_float_linear is present.
const HeightSampleChunk = /* glsl */`
float SampleHeightBilinear(sampler2D Field, vec2 UV)
{
#ifdef FLOAT_LINEAR
    return texture(Field, UV).r;
#else
    vec2 Size = vec2(textureSize(Field, 0));
    vec2 T = clamp(UV * Size - 0.5, vec2(0.0), Size - 1.0);
    ivec2 I = ivec2(floor(T));
    vec2 F = T - floor(T);
    ivec2 Limit = ivec2(Size) - 1;
    float A = texelFetch(Field, I, 0).r;
    float B = texelFetch(Field, min(I + ivec2(1, 0), Limit), 0).r;
    float C = texelFetch(Field, min(I + ivec2(0, 1), Limit), 0).r;
    float D = texelFetch(Field, min(I + ivec2(1, 1), Limit), 0).r;
    return mix(mix(A, B, F.x), mix(C, D, F.x), F.y);
#endif
}`;

// 📝 Nearest spline segment query with bounding-circle culling per group of samples. A group = 2 texels in
//    uGroupAtlas: (centre.x, centre.z, radius incl. max half-width, atlas row) and (first sample, sample count).
//    The minimised metric is the edge distance E = centreline distance − interpolated half-width.
//    Groups are binned per screen tile on the CPU (uBinHeader = offset, count into uBinList), so a texel visits
//    only the groups whose circle + shoulder reaches its tile — cost follows local spline density, not world total.
const SplineQueryChunk = /* glsl */`
uniform sampler2D uSampleAtlas;
uniform sampler2D uSampleHeights;
uniform sampler2D uGroupAtlas;
uniform sampler2D uBinHeader;
uniform sampler2D uBinList;
uniform vec2 uBinTiles;

struct SplineContact
{
    float E;
    float D;
    float Y;
    float HW;
    float Along;
};

ivec2 GroupTexel(int Index)
{
    return ivec2(Index & 1023, Index >> 10);
}

SplineContact QuerySplineContact(vec2 P, vec2 CellUv)
{
    SplineContact Best = SplineContact(1e20, 1e20, 0.0, 0.0, 0.0);
    ivec2 Tile = clamp(ivec2(CellUv * uBinTiles), ivec2(0), ivec2(uBinTiles) - 1);
    vec2 Header = texelFetch(uBinHeader, Tile, 0).rg;
    int Offset = int(Header.x);
    int Count = int(Header.y);
    for (int G = 0; G < Count; ++G)
    {
        int Entry = Offset + G;
        int Index = int(texelFetch(uBinList, ivec2(Entry & 1023, Entry >> 10), 0).r) * 2;
        vec4 Sphere = texelFetch(uGroupAtlas, GroupTexel(Index), 0);
        if (distance(P, Sphere.xy) - Sphere.z > Best.E) continue;
        vec4 Span = texelFetch(uGroupAtlas, GroupTexel(Index + 1), 0);
        int Row = int(Sphere.w);
        int First = int(Span.x);
        int Samples = int(Span.y);
        vec4 A = texelFetch(uSampleAtlas, ivec2(First, Row), 0);
        float YA = texelFetch(uSampleHeights, ivec2(First, Row), 0).r;
        for (int K = 1; K < 16; ++K)
        {
            if (K >= Samples) break;
            vec4 B = texelFetch(uSampleAtlas, ivec2(First + K, Row), 0);
            float YB = texelFetch(uSampleHeights, ivec2(First + K, Row), 0).r;
            vec2 AB = B.xy - A.xy;
            float T = clamp(dot(P - A.xy, AB) / max(dot(AB, AB), 1e-6), 0.0, 1.0);
            float D = length(P - A.xy - AB * T);
            float HW = mix(A.z, B.z, T);
            float E = D - HW;
            if (E < Best.E) Best = SplineContact(E, D, mix(YA, YB, T), HW, float(First + K - 1) + T);
            A = B;
            YA = YB;
        }
    }
    return Best;
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SHAPE MASK AND JUMP FLOOD
//------------------------------------------------------------------------------------------------------------------------

export const MaskWriteFragment = /* glsl */`
uniform float uMaskLevel;
out vec4 Output;
void main()
{
    Output = vec4(uMaskLevel);
}`;

// 📝 Seed texels are mask boundary texels on either side; they store their own texel coordinate.
export const JumpFloodSeedFragment = /* glsl */`
uniform sampler2D uMask;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    ivec2 Limit = textureSize(uMask, 0) - 1;
    float M = step(0.5, texelFetch(uMask, C, 0).r);
    bool Boundary = false;
    for (int K = 0; K < 4; ++K)
    {
        ivec2 O = K == 0 ? ivec2(1, 0) : K == 1 ? ivec2(-1, 0) : K == 2 ? ivec2(0, 1) : ivec2(0, -1);
        ivec2 N = C + O;
        if (any(lessThan(N, ivec2(0))) || any(greaterThan(N, Limit))) continue;
        if (step(0.5, texelFetch(uMask, N, 0).r) != M) Boundary = true;
    }
    Output = Boundary ? vec4(vec2(C), 0.0, 0.0) : vec4(-1e6, -1e6, 0.0, 0.0);
}`;

export const JumpFloodStepFragment = /* glsl */`
uniform sampler2D uSeeds;
uniform int uStride;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    ivec2 Limit = textureSize(uSeeds, 0) - 1;
    vec2 Here = vec2(C);
    vec2 Best = texelFetch(uSeeds, C, 0).xy;
    float BestD = dot(Best - Here, Best - Here);
    for (int Y = -1; Y <= 1; ++Y)
    for (int X = -1; X <= 1; ++X)
    {
        ivec2 N = C + ivec2(X, Y) * uStride;
        if (any(lessThan(N, ivec2(0))) || any(greaterThan(N, Limit))) continue;
        vec2 Seed = texelFetch(uSeeds, N, 0).xy;
        float D = dot(Seed - Here, Seed - Here);
        if (D < BestD) { BestD = D; Best = Seed; }
    }
    Output = vec4(Best, 0.0, 0.0);
}`;

// 📝 Signed distance in metres, positive inside the filled shape; the boundary sits on the texel edge (±0.5).
export const JumpFloodResolveFragment = /* glsl */`
uniform sampler2D uSeeds;
uniform sampler2D uMask;
uniform vec2 uCell;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    vec2 Seed = texelFetch(uSeeds, C, 0).xy;
    float M = step(0.5, texelFetch(uMask, C, 0).r);
    float D = Seed.x < -1e5 ? 1e5 : length((Seed - vec2(C)) * uCell) + 0.5 * min(uCell.x, uCell.y);
    Output = vec4(M > 0.5 ? D : -D);
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    LAYER STACK EVALUATION
//------------------------------------------------------------------------------------------------------------------------

export const StackSeedFragment = /* glsl */`
uniform float uSeabed;
out vec4 Output;
void main()
{
    Output = vec4(uSeabed, 0.0, 0.0, 0.0);
}`;

// 📝 Landmass layer: shape signed distance → coastal profile + interior relief noise (world-space, seamless across cells).
// 📝 LANDMASS_INLINE 1 builds the exactness reference (noise evaluated on every texel, no early-out); the regular program
//    contains no noise code at all, so it costs a few texel fetches per texel.
export const LandmassFragment = /* glsl */`
#define LANDMASS_INLINE 0
${NoiseChunk}
uniform sampler2D uInput;
uniform sampler2D uDistance;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform int uOperation;
uniform float uElevation;
uniform float uCoastWidth;
uniform float uRelief;
uniform float uReliefScale;
uniform float uRidged;
uniform float uCoastNoise;
uniform float uOpacity;
uniform float uSeabed;
uniform int uSeed;
uniform sampler2D uNoise;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    vec4 S = texelFetch(uInput, C, 0);
    vec2 P = uOrigin + gl_FragCoord.xy / vec2(textureSize(uInput, 0)) * uSize;
    uint Seed = uint(uSeed);
    float D = texelFetch(uDistance, C, 0).r;
    float Width = max(uCoastWidth, 1.0);
    // Exact early-out: |FractalNoise| <= 1, so Dn < 0 for every texel beyond the feather reach, where Profile and
    // Inland are exactly zero and the layer reduces to the seabed clamp of the Maximum operation.
#if LANDMASS_INLINE
    vec2 Q = P / max(uReliefScale, 1.0);
    float Coast = FractalNoise(P / (Width * 1.7), 5, Seed + 101u);
    float Relief = mix(FractalNoise(Q, 7, Seed), RidgedNoise(Q, 7, Seed + 7u), uRidged);
#else
    float Reach = abs(uCoastNoise) * Width * 1.01 + 0.01;
    if (D + Reach < 0.0)
    {
        if (uOperation == 3) S.r = mix(S.r, max(S.r, uSeabed), uOpacity);
        Output = S;
        return;
    }
    vec2 Cached = texelFetch(uNoise, C, 0).rg;
    float Coast = Cached.r;
    float Relief = Cached.g;
#endif
    float Feather = Coast * uCoastNoise * Width;
    float Dn = D + Feather;
    float Profile = smoothstep(0.0, 1.0, clamp(Dn / Width, 0.0, 1.0));
    float Inland = smoothstep(0.0, 1.0, clamp(Dn / (Width * 2.5), 0.0, 1.0));
    float Contribution = uElevation * Profile + uRelief * Relief * Inland;
    float H = S.r;
    if (uOperation == 0) H = S.r + Contribution;
    else if (uOperation == 1) H = S.r - Contribution;
    else if (uOperation == 2) H = mix(S.r, uElevation + uRelief * Relief, Profile);
    else H = max(S.r, uSeabed + Contribution);
    S.r = mix(S.r, H, uOpacity);
    if (uOperation == 2) S.a = max(S.a, (Profile * (1.0 - Profile)) * 4.0 * uOpacity * step(S.r, H + 1e3));
    Output = S;
}`;

// 📝 Landmass noise cache: (coast feather noise, relief noise). Independent of the stroke geometry and of the amplitude
//    parameters, so stroke edits and Elevation / Relief / CoastNoise edits re-apply the layer with two texel fetches.
export const LandmassNoiseFragment = /* glsl */`
${NoiseChunk}
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uResolution;
uniform float uCoastWidth;
uniform float uReliefScale;
uniform float uRidged;
uniform int uSeed;
out vec4 Output;
void main()
{
    vec2 P = uOrigin + gl_FragCoord.xy / uResolution * uSize;
    uint Seed = uint(uSeed);
    float Width = max(uCoastWidth, 1.0);
    vec2 Q = P / max(uReliefScale, 1.0);
    float Coast = FractalNoise(P / (Width * 1.7), 5, Seed + 101u);
    float Relief = mix(FractalNoise(Q, 7, Seed), RidgedNoise(Q, 7, Seed + 7u), uRidged);
    Output = vec4(Coast, Relief, 0.0, 0.0);
}`;

export const SculptApplyFragment = /* glsl */`
uniform sampler2D uInput;
uniform sampler2D uSculpt;
uniform float uOpacity;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    vec4 S = texelFetch(uInput, C, 0);
    S.r += texelFetch(uSculpt, C, 0).r * uOpacity;
    Output = S;
}`;

// 📝 Spline layer. uVariant: 0 road (grade to path), 1 river (carve channel), 2 canyon (terraced cut), 3 ridge (raise).
export const SplineApplyFragment = /* glsl */`
${SplineQueryChunk}
uniform sampler2D uInput;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec4 uLayerBounds;
uniform int uVariant;
uniform float uShoulder;
uniform float uDepth;
uniform float uRise;
uniform float uTerraceStep;
uniform float uWallSteepness;
uniform float uOpacity;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    vec4 S = texelFetch(uInput, C, 0);
    vec2 P = uOrigin + gl_FragCoord.xy / vec2(textureSize(uInput, 0)) * uSize;
    if (any(lessThan(P, uLayerBounds.xy)) || any(greaterThan(P, uLayerBounds.zw))) { Output = S; return; }
    SplineContact K = QuerySplineContact(P, gl_FragCoord.xy / vec2(textureSize(uInput, 0)));
    float Reach = max(uShoulder, 0.5);
    if (K.E > Reach) { Output = S; return; }
    float Fade = 1.0 - smoothstep(0.0, Reach, K.E);
    if (uVariant == 0)
    {
        S.r = mix(S.r, K.Y, Fade * uOpacity);
        float Paved = (1.0 - smoothstep(-1.5, 0.0, K.E)) * uOpacity;
        S.g = max(S.g, Paved);
        S.b *= 1.0 - Paved;
        S.a *= 1.0 - Paved;
    }
    else if (uVariant == 1)
    {
        float U = clamp(K.D / max(K.HW, 1e-3), 0.0, 1.0);
        float Bed = K.Y - uDepth * (1.0 - U * U);
        float Target = K.E < 0.0 ? Bed : K.Y;
        float Carved = min(S.r, mix(S.r, Target, Fade));
        S.r = mix(S.r, Carved, uOpacity);
        S.b = max(S.b, (1.0 - smoothstep(-K.HW * 0.2, 0.0, K.E)) * uOpacity);
    }
    else if (uVariant == 2)
    {
        float Floor = K.Y - uDepth;
        float Wall = clamp(K.E / Reach, 0.0, 1.0);
        float Profile = pow(smoothstep(0.0, 1.0, Wall), 1.0 / max(uWallSteepness, 0.05));
        float Target = mix(Floor, S.r, Profile);
        if (uTerraceStep > 0.5)
        {
            float Relative = max(Target - Floor, 0.0) / uTerraceStep;
            float Step = floor(Relative);
            Relative = (Step + smoothstep(0.55, 1.0, Relative - Step)) * uTerraceStep;
            Target = mix(Floor + Relative, Target, smoothstep(0.85, 1.0, Wall));
        }
        S.r = mix(S.r, min(S.r, Target), uOpacity);
        float Cliff = smoothstep(-2.0, 1.0, K.E) * (1.0 - smoothstep(Reach * 0.8, Reach, K.E));
        S.a = max(S.a, Cliff * uOpacity);
    }
    else
    {
        float Crown = K.E < 0.0 ? 1.0 - 0.25 * pow(K.D / max(K.HW, 1e-3), 2.0) : 0.75;
        float Crest = K.Y + uRise * Crown;
        float Shape = K.E < 0.0 ? 1.0 : smoothstep(0.0, 1.0, Fade);
        S.r = mix(S.r, max(S.r, mix(S.r, Crest, Shape)), uOpacity);
        S.a = max(S.a, smoothstep(0.2, 0.9, Shape) * (1.0 - smoothstep(0.9, 1.0, Shape)) * uOpacity * 0.6);
    }
    Output = S;
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SPLINE SAMPLE HEIGHTS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Rows = splines, columns = samples. uRowTable.x = sample count per row. Terrain-following variants sample the
//    stack input; tunnels bore straight between the probed portal heights (floor at grade, centre 0.6 r above).
export const SampleProbeFragment = /* glsl */`
${HeightSampleChunk}
uniform sampler2D uInput;
uniform sampler2D uSampleAtlas;
uniform sampler2D uSampleArc;
uniform sampler2D uRowTable;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform int uBore;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    int Count = int(texelFetch(uRowTable, ivec2(C.y, 0), 0).x);
    if (C.x >= Count) { Output = vec4(0.0); return; }
    vec4 Sample = texelFetch(uSampleAtlas, C, 0);
    if (uBore == 0)
    {
        Output = vec4(SampleHeightBilinear(uInput, (Sample.xy - uOrigin) / uSize));
        return;
    }
    vec4 First = texelFetch(uSampleAtlas, ivec2(0, C.y), 0);
    vec4 Last = texelFetch(uSampleAtlas, ivec2(Count - 1, C.y), 0);
    float HA = SampleHeightBilinear(uInput, (First.xy - uOrigin) / uSize);
    float HB = SampleHeightBilinear(uInput, (Last.xy - uOrigin) / uSize);
    float Arc = texelFetch(uSampleArc, C, 0).r;
    Output = vec4(mix(HA, HB, Arc) + 0.6 * Sample.z);
}`;

export const SampleSmoothFragment = /* glsl */`
uniform sampler2D uHeights;
uniform sampler2D uSampleAtlas;
uniform sampler2D uRowTable;
uniform int uRadius;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    int Count = int(texelFetch(uRowTable, ivec2(C.y, 0), 0).x);
    if (C.x >= Count) { Output = vec4(0.0); return; }
    float Sum = 0.0, Weight = 0.0;
    for (int K = -64; K <= 64; ++K)
    {
        if (K < -uRadius || K > uRadius) continue;
        int I = clamp(C.x + K, 0, Count - 1);
        float W = float(uRadius + 1 - abs(K));
        Sum += texelFetch(uHeights, ivec2(I, C.y), 0).r * W;
        Weight += W;
    }
    Output = vec4(Sum / Weight + texelFetch(uSampleAtlas, C, 0).w);
}`;

// 📝 Hillis–Steele prefix minimum along each row: rivers never flow uphill from their first control point.
export const SampleDownhillFragment = /* glsl */`
uniform sampler2D uHeights;
uniform int uStride;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    float H = texelFetch(uHeights, C, 0).r;
    if (C.x - uStride >= 0) H = min(H, texelFetch(uHeights, ivec2(C.x - uStride, C.y), 0).r);
    Output = vec4(H);
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SPARSE TUNNEL SDF VOLUME
//------------------------------------------------------------------------------------------------------------------------

// 📝 One 3D-texture slice per draw. Horseshoe section = capsule ∩ half-space above a floor 0.6 r below the centre.
export const TunnelVolumeFragment = /* glsl */`
uniform sampler2D uSampleAtlas;
uniform sampler2D uSampleHeights;
uniform sampler2D uGroupAtlas;
uniform int uGroupStart;
uniform int uGroupCount;
uniform vec3 uVolumeMin;
uniform vec3 uVolumeSize;
uniform vec3 uVolumeTexels;
uniform float uSlice;
out vec4 Output;
ivec2 GroupTexel(int Index) { return ivec2(Index & 1023, Index >> 10); }
void main()
{
    vec3 U = vec3(gl_FragCoord.xy, uSlice + 0.5) / uVolumeTexels;
    vec3 P = uVolumeMin + vec3(U.x, U.z, U.y) * uVolumeSize;
    float Best = 1e4;
    for (int G = 0; G < uGroupCount; ++G)
    {
        int Index = (uGroupStart + G) * 2;
        vec4 Sphere = texelFetch(uGroupAtlas, GroupTexel(Index), 0);
        if (distance(P.xz, Sphere.xy) - Sphere.z > Best) continue;
        vec4 Span = texelFetch(uGroupAtlas, GroupTexel(Index + 1), 0);
        int Row = int(Sphere.w);
        int First = int(Span.x);
        int Count = int(Span.y);
        vec4 SA = texelFetch(uSampleAtlas, ivec2(First, Row), 0);
        vec3 A = vec3(SA.x, texelFetch(uSampleHeights, ivec2(First, Row), 0).r, SA.y);
        float RA = SA.z;
        for (int K = 1; K < 16; ++K)
        {
            if (K >= Count) break;
            vec4 SB = texelFetch(uSampleAtlas, ivec2(First + K, Row), 0);
            vec3 B = vec3(SB.x, texelFetch(uSampleHeights, ivec2(First + K, Row), 0).r, SB.y);
            vec3 AB = B - A;
            float T = clamp(dot(P - A, AB) / max(dot(AB, AB), 1e-6), 0.0, 1.0);
            vec3 Axis = A + AB * T;
            float R = mix(RA, SB.z, T);
            float Capsule = length(P - Axis) - R;
            float Floor = (Axis.y - 0.6 * R) - P.y;
            Best = min(Best, max(Capsule, Floor));
            A = B;
            RA = SB.z;
        }
    }
    Output = vec4(Best);
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCULPT STAMPS
//------------------------------------------------------------------------------------------------------------------------

// 📝 uMode: 0 raise, 1 lower, 2 smooth, 3 flatten. Reads a blitted copy of the sculpt region (uSource) and the last
//    evaluated stack height; writes the sculpt delta. Constant cost per stamp — there is no stroke or node budget.
export const SculptStampFragment = /* glsl */`
uniform sampler2D uSource;
uniform sampler2D uHeight;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec3 uCentre;
uniform float uRadius;
uniform float uStrength;
uniform float uHardness;
uniform float uOpacity;
uniform int uMode;
in vec2 vUv;
out vec4 Output;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    vec2 Texels = vec2(textureSize(uSource, 0));
    float D = texelFetch(uSource, C, 0).r;
    vec2 P = uOrigin + gl_FragCoord.xy / Texels * uSize;
    float R = distance(P, uCentre.xy) / uRadius;
    if (R >= 1.0) { Output = vec4(D); return; }
    float Falloff = 1.0 - smoothstep(uHardness, 1.0, R);
    float H = texelFetch(uHeight, C, 0).r;
    float Gain = 1.0 / max(uOpacity, 0.05);
    if (uMode == 0) D += uStrength * uRadius * 0.012 * Falloff * Gain;
    else if (uMode == 1) D -= uStrength * uRadius * 0.012 * Falloff * Gain;
    else if (uMode == 2)
    {
        vec2 Cell = uSize / Texels;
        float Spread = max(2.0, uRadius * 0.12 / min(Cell.x, Cell.y));
        ivec2 Limit = ivec2(Texels) - 1;
        float Sum = 0.0;
        for (int K = 0; K < 12; ++K)
        {
            float Theta = float(K) * 0.5235988;
            float Ring = K % 2 == 0 ? Spread : Spread * 0.5;
            Sum += texelFetch(uHeight, clamp(C + ivec2(vec2(cos(Theta), sin(Theta)) * Ring), ivec2(0), Limit), 0).r;
        }
        D += (Sum / 12.0 - H) * Falloff * uStrength * 0.6 * Gain;
    }
    else D += (uCentre.z - H) * Falloff * uStrength * 0.35 * Gain;
    Output = vec4(D);
}`;

// 📝 Remaps a sculpt delta from previous bounds/resolution into new bounds (uvs outside the old cell read zero).
export const SculptResampleFragment = /* glsl */`
${HeightSampleChunk}
uniform sampler2D uSource;
uniform vec2 uOldOrigin;
uniform vec2 uOldSize;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uTexels;
out vec4 Output;
void main()
{
    vec2 P = uOrigin + gl_FragCoord.xy / uTexels * uSize;
    vec2 UV = (P - uOldOrigin) / uOldSize;
    float Inside = step(0.0, UV.x) * step(0.0, UV.y) * step(UV.x, 1.0) * step(UV.y, 1.0);
    Output = vec4(Inside * SampleHeightBilinear(uSource, UV));
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    DERIVED SURFACE FIELDS
//------------------------------------------------------------------------------------------------------------------------

// 📝 MRT: Surface RGBA8 = (normal.x, normal.z, ambient occlusion, slope) and Material RGBA8 = (road, water, rock, -).
export const SurfaceFieldFragment = /* glsl */`
uniform sampler2D uStack;
uniform vec2 uCell;
layout(location = 0) out vec4 SurfaceOutput;
layout(location = 1) out vec4 MaterialOutput;
void main()
{
    ivec2 C = ivec2(gl_FragCoord.xy);
    ivec2 Limit = textureSize(uStack, 0) - 1;
    vec4 S = texelFetch(uStack, C, 0);
    float L = texelFetch(uStack, clamp(C - ivec2(1, 0), ivec2(0), Limit), 0).r;
    float R = texelFetch(uStack, clamp(C + ivec2(1, 0), ivec2(0), Limit), 0).r;
    float B = texelFetch(uStack, clamp(C - ivec2(0, 1), ivec2(0), Limit), 0).r;
    float T = texelFetch(uStack, clamp(C + ivec2(0, 1), ivec2(0), Limit), 0).r;
    vec3 N = normalize(vec3((L - R) / (2.0 * uCell.x), 1.0, (B - T) / (2.0 * uCell.y)));
    float Occlusion = 0.0;
    for (int Ring = 0; Ring < 3; ++Ring)
    {
        float Metres = Ring == 0 ? 6.0 : Ring == 1 ? 24.0 : 90.0;
        for (int K = 0; K < 8; ++K)
        {
            float Theta = float(K) * 0.785398 + float(Ring) * 0.39;
            vec2 Offset = vec2(cos(Theta), sin(Theta)) * Metres;
            ivec2 Tap = clamp(C + ivec2(Offset / uCell), ivec2(0), Limit);
            float Rise = texelFetch(uStack, Tap, 0).r - S.r;
            Occlusion += clamp(Rise / Metres, 0.0, 1.0);
        }
    }
    float Ambient = clamp(1.0 - Occlusion / 24.0 * 1.6, 0.0, 1.0);
    SurfaceOutput = vec4(N.x * 0.5 + 0.5, N.z * 0.5 + 0.5, Ambient, 1.0 - N.y);
    MaterialOutput = vec4(clamp(S.gba, 0.0, 1.0), 1.0);
}`;

// 📝 2D horizon march toward the sun over the height field (half resolution). 1 = lit, 0 = shadowed.
export const ShadowFieldFragment = /* glsl */`
${HeightSampleChunk}
uniform sampler2D uStack;
uniform vec2 uSize;
uniform vec2 uSunPlanar;
uniform float uSunTangent;
in vec2 vUv;
out vec4 Output;
void main()
{
    float H0 = SampleHeightBilinear(uStack, vUv) + 0.5;
    float Cell = max(uSize.x, uSize.y) / float(textureSize(uStack, 0).x);
    float Distance = Cell * 1.5;
    float Horizon = -1e3;
    for (int K = 0; K < 40; ++K)
    {
        vec2 UV = vUv + uSunPlanar * Distance / uSize;
        if (any(lessThan(UV, vec2(0.0))) || any(greaterThan(UV, vec2(1.0)))) break;
        Horizon = max(Horizon, (SampleHeightBilinear(uStack, UV) - H0) / Distance);
        Distance *= 1.14;
    }
    Output = vec4(1.0 - smoothstep(uSunTangent - 0.06, uSunTangent + 0.06, Horizon));
}`;

export const TileMaximumFragment = /* glsl */`
uniform sampler2D uStack;
uniform int uTile;
out vec4 Output;
void main()
{
    ivec2 Corner = ivec2(gl_FragCoord.xy) * uTile;
    ivec2 Limit = textureSize(uStack, 0) - 1;
    float Peak = -1e9;
    for (int Y = -1; Y <= 16; ++Y)
    for (int X = -1; X <= 16; ++X)
    {
        if (X > uTile || Y > uTile) continue;
        Peak = max(Peak, texelFetch(uStack, clamp(Corner + ivec2(X, Y), ivec2(0), Limit), 0).r);
    }
    Output = vec4(Peak);
}`;

export const PointProbeFragment = /* glsl */`
${HeightSampleChunk}
uniform sampler2D uStack;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uPoint;
out vec4 Output;
void main()
{
    Output = vec4(SampleHeightBilinear(uStack, (uPoint - uOrigin) / uSize), 0.0, 0.0, 1.0);
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    RELIEF RAYMARCH (3D WORKSPACE)
//------------------------------------------------------------------------------------------------------------------------

const ReliefFieldChunk = /* glsl */`
${HeightSampleChunk}
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uHeightRange;
uniform sampler2D uStack;
uniform sampler2D uTileMaximum;
uniform vec2 uTileCount;
uniform int uTunnelActive;
uniform sampler3D uTunnel;
uniform vec3 uTunnelMin;
uniform vec3 uTunnelSize;
uniform int uTerrainPresent;

float TunnelDistance(vec3 P)
{
    if (uTunnelActive == 0) return 1e4;
    vec3 U = (P - uTunnelMin) / uTunnelSize;
    if (any(lessThan(U, vec3(0.0))) || any(greaterThan(U, vec3(1.0)))) return 1e4;
    return texture(uTunnel, vec3(U.x, U.z, U.y)).r;
}

// 📝 Field F = max(height bound, −tunnel). Height bound is scaled (0.45) to stay conservative on steep slopes.
float ReliefField(vec3 P, out float HeightBound, out float Carve)
{
    float H = SampleHeightBilinear(uStack, (P.xz - uOrigin) / uSize);
    HeightBound = P.y - H;
    Carve = -TunnelDistance(P);
    return max(HeightBound * 0.45, Carve);
}

vec2 IntersectBox(vec3 O, vec3 D, vec3 Lo, vec3 Hi)
{
    vec3 Inv = 1.0 / D;
    vec3 A = (Lo - O) * Inv;
    vec3 B = (Hi - O) * Inv;
    vec3 Near = min(A, B);
    vec3 Far = max(A, B);
    return vec2(max(max(Near.x, Near.y), Near.z), min(min(Far.x, Far.y), Far.z));
}

// 📝 March with tile-maximum empty-space skipping, then bisection refinement on sign change.
bool MarchRelief(vec3 O, vec3 D, float PixelAngle, out float THit, out bool CarveHit)
{
    THit = 0.0;
    CarveHit = false;
    if (uTerrainPresent == 0) return false;
    vec3 SafeD = vec3(abs(D.x) < 1e-6 ? 1e-6 : D.x, abs(D.y) < 1e-6 ? 1e-6 : D.y, abs(D.z) < 1e-6 ? 1e-6 : D.z);
    vec2 Span = IntersectBox(O, SafeD, vec3(uOrigin.x, uHeightRange.x, uOrigin.y), vec3(uOrigin.x + uSize.x, uHeightRange.y, uOrigin.y + uSize.y));
    if (Span.x > Span.y || Span.y < 0.0) return false;
    float T = max(Span.x, 0.0) + 0.01;
    float TPrevious = T;
    vec2 TileSize = uSize / uTileCount;
    for (int Step = 0; Step < 360; ++Step)
    {
        if (T > Span.y) return false;
        vec3 P = O + SafeD * T;
        vec2 Local = (P.xz - uOrigin) / TileSize;
        ivec2 Tile = clamp(ivec2(floor(Local)), ivec2(0), ivec2(uTileCount) - 1);
        float Peak = texelFetch(uTileMaximum, Tile, 0).r + 0.5;
        if (P.y > Peak)
        {
            vec2 TileLo = uOrigin + vec2(Tile) * TileSize;
            vec2 TileHi = TileLo + TileSize;
            vec2 Exit = (mix(TileLo, TileHi, step(0.0, SafeD.xz)) - P.xz) / SafeD.xz;
            float Advance = min(Exit.x, Exit.y);
            if (SafeD.y < 0.0) Advance = min(Advance, (Peak - P.y) / SafeD.y);
            TPrevious = T;
            T += max(Advance, 0.0) + max(T * 1e-4, 0.02);
            continue;
        }
        float HeightBound, Carve;
        float F = ReliefField(P, HeightBound, Carve);
        float Epsilon = T * PixelAngle * 0.6;
        if (F < Epsilon)
        {
            float A = TPrevious, B = T;
            for (int K = 0; K < 10; ++K)
            {
                float M = 0.5 * (A + B);
                float Fm = ReliefField(O + SafeD * M, HeightBound, Carve);
                if (Fm > 0.0) A = M; else B = M;
            }
            THit = B;
            ReliefField(O + SafeD * B, HeightBound, Carve);
            CarveHit = Carve > HeightBound * 0.45 - 0.05;
            return true;
        }
        TPrevious = T;
        T += max(F, T * PixelAngle * 0.8);
    }
    return false;
}`;

export const ReliefFragment = /* glsl */`
${ReliefFieldChunk}
uniform mat4 uInverseViewProjection;
uniform vec3 uCameraPosition;
uniform vec4 uViewport;
uniform float uPixelAngle;
uniform sampler2D uSurface;
uniform sampler2D uMaterial;
uniform sampler2D uShadow;
uniform vec3 uSunDirection;
uniform float uSeaLevel;
uniform int uWaterVisible;
uniform int uContours;
uniform float uContourInterval;
uniform float uSnowLine;
uniform vec4 uBrush;
uniform vec2 uCell;
out vec4 Output;

vec3 SkyRadiance(vec3 D)
{
    float Up = clamp(D.y, -0.2, 1.0);
    vec3 Sky = mix(vec3(0.46, 0.55, 0.66), vec3(0.16, 0.28, 0.48), pow(max(Up, 0.0), 0.5));
    Sky = mix(Sky, vec3(0.08, 0.085, 0.09), smoothstep(0.0, -0.2, Up));
    float Sun = max(dot(D, uSunDirection), 0.0);
    Sky += vec3(1.0, 0.85, 0.6) * (pow(Sun, 800.0) * 18.0 + pow(Sun, 12.0) * 0.18);
    return Sky;
}

vec3 OutsideGround(vec3 O, vec3 D, out float TGround)
{
    TGround = -1.0;
    if (D.y >= -1e-4) return SkyRadiance(D);
    float T = (uHeightRange.x + 1.0 - O.y) / D.y;
    if (T < 0.0) return SkyRadiance(D);
    TGround = T;
    vec2 P = (O + D * T).xz;
    float Footprint = T * uPixelAngle;
    vec2 Minor = abs(fract(P / 100.0 + 0.5) - 0.5) * 100.0;
    vec2 Major = abs(fract(P / 1000.0 + 0.5) - 0.5) * 1000.0;
    float LineMinor = 1.0 - smoothstep(0.0, Footprint * 1.5, min(Minor.x, Minor.y));
    float LineMajor = 1.0 - smoothstep(0.0, Footprint * 2.0, min(Major.x, Major.y));
    vec3 Ground = vec3(0.045) + vec3(0.05) * LineMinor * exp(-Footprint * 0.15) + vec3(0.09) * LineMajor;
    float Haze = 1.0 - exp(-T / (max(uSize.x, uSize.y) * 6.0));
    return mix(Ground, SkyRadiance(D) * 0.6, Haze);
}

vec3 TunnelNormal(vec3 P)
{
    float E = max(uTunnelSize.x, uTunnelSize.z) / 256.0;
    vec2 K = vec2(1.0, -1.0);
    return -normalize(K.xyy * TunnelDistance(P + K.xyy * E) + K.yyx * TunnelDistance(P + K.yyx * E) +
                      K.yxy * TunnelDistance(P + K.yxy * E) + K.xxx * TunnelDistance(P + K.xxx * E));
}

vec3 ShadeTerrain(vec3 P, vec3 D, float T, bool CarveHit)
{
    vec2 UV = (P.xz - uOrigin) / uSize;
    float Footprint = T * uPixelAngle;
    float Lod = max(log2(Footprint / min(uCell.x, uCell.y)), 0.0);
    vec4 Surface = textureLod(uSurface, UV, Lod);
    vec4 Material = textureLod(uMaterial, UV, Lod);
    vec2 NXZ = Surface.xy * 2.0 - 1.0;
    vec3 N = normalize(vec3(NXZ.x, sqrt(max(1.0 - dot(NXZ, NXZ), 0.02)), NXZ.y));
    float Ambient = Surface.z;
    float Shadow = textureLod(uShadow, UV, Lod).r;
    float Buried = SampleHeightBilinear(uStack, UV) - P.y;
    if (CarveHit)
    {
        N = TunnelNormal(P);
        Shadow = 0.0;
        Ambient = clamp(0.55 - Buried / 80.0, 0.08, 0.55);
    }
    // 📝 Cell side wall (ray entered through the bounds box below the surface): cross-section shading
    bool WallHit = !CarveHit && Buried > max(Footprint * 3.0, 0.75);
    if (WallHit)
    {
        vec2 Low = P.xz - uOrigin;
        vec2 High = uOrigin + uSize - P.xz;
        vec2 Nearest = min(Low, High);
        N = Nearest.x < Nearest.y ? vec3(Low.x < High.x ? -1.0 : 1.0, 0.0, 0.0) : vec3(0.0, 0.0, Low.y < High.y ? -1.0 : 1.0);
        Shadow = 0.6;
        Ambient = 0.35;
    }
    float Slope = 1.0 - N.y;
    float H = P.y;
    vec3 Sand = vec3(0.70, 0.64, 0.50);
    vec3 Grass = mix(vec3(0.22, 0.31, 0.13), vec3(0.42, 0.40, 0.24), smoothstep(80.0, uSnowLine * 0.8, H));
    vec3 Rock = mix(vec3(0.36, 0.33, 0.30), vec3(0.50, 0.46, 0.41), 0.5 + 0.5 * sin(H * 0.21));
    vec3 Strata = mix(vec3(0.56, 0.34, 0.22), vec3(0.72, 0.52, 0.36), 0.5 + 0.5 * sin(H * 0.35 + sin(H * 0.05) * 2.0));
    vec3 Albedo = mix(Sand, Grass, smoothstep(uSeaLevel + 1.0, uSeaLevel + 6.0, H));
    Albedo = mix(Albedo, Rock, smoothstep(0.18, 0.36, Slope));
    Albedo = mix(Albedo, Strata, Material.b * smoothstep(0.1, 0.3, Slope + Material.b * 0.2));
    Albedo = mix(Albedo, vec3(0.92, 0.94, 0.97), smoothstep(uSnowLine - 40.0, uSnowLine + 40.0, H) * (1.0 - smoothstep(0.35, 0.55, Slope)));
    Albedo = mix(Albedo, vec3(0.13, 0.13, 0.14), Material.r);
    Albedo = mix(Albedo, vec3(0.05, 0.13, 0.16), Material.g * 0.9);
    if (CarveHit) Albedo = mix(Rock, Strata, 0.35) * 0.9;
    if (WallHit) Albedo = mix(vec3(0.050, 0.038, 0.030), vec3(0.085, 0.066, 0.050), 0.5 + 0.5 * sin(H * 0.12)) * (1.0 - 0.6 * smoothstep(0.0, 300.0, Buried));
    vec3 Sun = vec3(1.0, 0.93, 0.82) * 2.4;
    vec3 SkyTint = vec3(0.36, 0.46, 0.62);
    float Diffuse = max(dot(N, uSunDirection), 0.0) * Shadow;
    vec3 Light = Sun * Diffuse + SkyTint * Ambient * (0.55 + 0.45 * N.y) + vec3(0.12, 0.1, 0.08) * Ambient * (1.0 - N.y);
    vec3 Colour = Albedo * Light;
    vec3 Half = normalize(uSunDirection - D);
    Colour += Sun * Material.g * pow(max(dot(N, Half), 0.0), 90.0) * Shadow * 0.8;
    if (uContours == 1 && !CarveHit)
    {
        float Rise = Footprint * length(N.xz) / max(N.y, 0.15);
        float Offset = abs(fract(H / uContourInterval + 0.5) - 0.5) * uContourInterval;
        Colour = mix(Colour, vec3(0.02), (1.0 - smoothstep(Rise * 0.6, Rise * 1.6, Offset)) * 0.55);
    }
    if (uBrush.w > 0.0)
    {
        float R = distance(P.xz, uBrush.xz);
        float Edge = Footprint * 1.6;
        float Ring = smoothstep(uBrush.w - Edge * 2.0, uBrush.w - Edge, R) * (1.0 - smoothstep(uBrush.w, uBrush.w + Edge, R));
        float Fill = (1.0 - smoothstep(0.0, uBrush.w, R)) * 0.12;
        Colour = mix(Colour, vec3(1.0, 0.71, 0.33), clamp(Ring + Fill, 0.0, 1.0));
    }
    return Colour;
}

void main()
{
    vec2 NDC = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw * 2.0 - 1.0;
    vec4 Near = uInverseViewProjection * vec4(NDC, -1.0, 1.0);
    vec4 Far = uInverseViewProjection * vec4(NDC, 1.0, 1.0);
    vec3 O = uCameraPosition;
    vec3 D = normalize(Far.xyz / Far.w - Near.xyz / Near.w);
    float THit;
    bool CarveHit;
    bool Hit = MarchRelief(O, D, uPixelAngle, THit, CarveHit);
    float TGround;
    vec3 Colour = OutsideGround(O, D, TGround);
    float TWater = (uSeaLevel - O.y) / D.y;
    vec3 PW = O + D * TWater;
    bool WaterHit = uWaterVisible == 1 && TWater > 0.0 && (!Hit || TWater < THit) && uTerrainPresent == 1 &&
                    PW.x > uOrigin.x && PW.z > uOrigin.y && PW.x < uOrigin.x + uSize.x && PW.z < uOrigin.y + uSize.y;
    if (Hit)
    {
        vec3 P = O + D * THit;
        Colour = ShadeTerrain(P, D, THit, CarveHit);
        float Haze = 1.0 - exp(-THit / (max(uSize.x, uSize.y) * 5.0));
        Colour = mix(Colour, SkyRadiance(D) * 0.9, Haze * 0.8);
    }
    if (WaterHit)
    {
        float Depth = Hit ? (THit - TWater) : 400.0;
        float Fresnel = 0.02 + 0.98 * pow(1.0 - max(-D.y, 0.0), 5.0);
        vec3 Deep = vec3(0.015, 0.06, 0.08);
        vec3 Under = mix(Colour * vec3(0.55, 0.75, 0.8), Deep, 1.0 - exp(-Depth * 0.05));
        vec3 Reflected = SkyRadiance(reflect(D, vec3(0.0, 1.0, 0.0)));
        Colour = mix(Under, Reflected, Fresnel);
        Colour += vec3(1.0, 0.9, 0.7) * pow(max(dot(reflect(D, vec3(0.0, 1.0, 0.0)), uSunDirection), 0.0), 400.0) * 4.0;
    }
    Colour = Colour / (1.0 + Colour * 0.55);
    Output = vec4(pow(clamp(Colour, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

export const ReliefPickFragment = /* glsl */`
${ReliefFieldChunk}
uniform vec3 uPickOrigin;
uniform vec3 uPickDirection;
uniform float uPixelAngle;
out vec4 Output;
void main()
{
    float THit;
    bool CarveHit;
    bool Hit = MarchRelief(uPickOrigin, uPickDirection, uPixelAngle, THit, CarveHit);
    Output = Hit ? vec4(uPickOrigin + uPickDirection * THit, CarveHit ? 2.0 : 1.0) : vec4(0.0);
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    PLAN VIEW (2D WORKSPACE)
//------------------------------------------------------------------------------------------------------------------------

export const PlanGridFragment = /* glsl */`
uniform vec4 uViewport;
uniform vec2 uCentreModulo;
uniform float uPixelsPerMetre;
uniform float uSpacing;
uniform vec2 uCentre;
out vec4 Output;
void main()
{
    vec2 Pixel = gl_FragCoord.xy - uViewport.xy - uViewport.zw * 0.5;
    vec2 Offset = vec2(Pixel.x, -Pixel.y) / uPixelsPerMetre;
    vec2 Local = uCentreModulo + Offset;
    vec2 World = uCentre + Offset;
    vec2 Minor = abs(fract(Local / uSpacing + 0.5) - 0.5) * uSpacing * uPixelsPerMetre;
    vec2 Major = abs(fract(Local / (uSpacing * 10.0) + 0.5) - 0.5) * uSpacing * 10.0 * uPixelsPerMetre;
    vec3 Colour = vec3(0.043);
    Colour = mix(Colour, vec3(0.085), 1.0 - smoothstep(0.0, 1.0, min(Minor.x, Minor.y)));
    Colour = mix(Colour, vec3(0.14), 1.0 - smoothstep(0.0, 1.2, min(Major.x, Major.y)));
    vec2 Axis = abs(World) * uPixelsPerMetre;
    Colour = mix(Colour, vec3(0.55, 0.25, 0.25), 1.0 - smoothstep(0.0, 1.2, Axis.y));
    Colour = mix(Colour, vec3(0.25, 0.32, 0.55), 1.0 - smoothstep(0.0, 1.2, Axis.x));
    Output = vec4(Colour, 1.0);
}`;

export const PlanTerrainVertex = /* glsl */`
uniform vec4 uWorldRect;
uniform vec2 uCentre;
uniform float uPixelsPerMetre;
uniform vec2 uViewportSize;
out vec2 vUv;
void main()
{
    vec2 Corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
    vUv = Corner;
    vec2 World = mix(uWorldRect.xy, uWorldRect.zw, Corner);
    vec2 Pixel = (World - uCentre) * uPixelsPerMetre * vec2(1.0, -1.0);
    gl_Position = vec4(Pixel / (uViewportSize * 0.5), 0.0, 1.0);
}`;

export const PlanTerrainFragment = /* glsl */`
${HeightSampleChunk}
uniform sampler2D uStack;
uniform sampler2D uSurface;
uniform sampler2D uMaterial;
uniform sampler2D uShadow;
uniform float uSeaLevel;
uniform int uWaterVisible;
uniform float uContourInterval;
uniform int uContours;
uniform float uActive;
uniform float uCeiling;
in vec2 vUv;
out vec4 Output;
void main()
{
    float H = SampleHeightBilinear(uStack, vUv);
    vec4 Surface = texture(uSurface, vUv);
    vec4 Material = texture(uMaterial, vUv);
    float Shadow = texture(uShadow, vUv).r;
    vec2 NXZ = Surface.xy * 2.0 - 1.0;
    vec3 N = normalize(vec3(NXZ.x, sqrt(max(1.0 - dot(NXZ, NXZ), 0.02)), NXZ.y));
    float Above = H - uSeaLevel;
    float Elevation = clamp(Above / max(uCeiling * 0.7, 1.0), 0.0, 1.0);
    vec3 Land = mix(vec3(0.36, 0.43, 0.26), vec3(0.55, 0.50, 0.36), smoothstep(0.05, 0.45, Elevation));
    Land = mix(Land, vec3(0.62, 0.58, 0.53), smoothstep(0.45, 0.8, Elevation));
    Land = mix(Land, vec3(0.93), smoothstep(0.82, 0.95, Elevation));
    Land = mix(vec3(0.70, 0.65, 0.50), Land, smoothstep(0.5, 5.0, Above));
    Land = mix(Land, vec3(0.62, 0.42, 0.30), Material.b * 0.7);
    vec3 Sea = mix(vec3(0.10, 0.25, 0.33), vec3(0.03, 0.08, 0.13), clamp(-Above / 80.0, 0.0, 1.0));
    vec3 Albedo = (Above < 0.0 && uWaterVisible == 1) ? Sea : Land;
    Albedo = mix(Albedo, vec3(0.16), Material.r);
    Albedo = mix(Albedo, vec3(0.14, 0.36, 0.48), Material.g);
    vec3 Light = normalize(vec3(-0.6, 0.75, -0.45));
    float Shade = max(dot(N, Light), 0.0) * mix(0.55, 1.0, Shadow) * 0.85 + 0.3 * Surface.z;
    vec3 Colour = Albedo * (Above < 0.0 && uWaterVisible == 1 ? 0.75 + 0.25 * Shade : Shade * 1.15);
    if (uContours == 1)
    {
        float Width = fwidth(H);
        float Offset = abs(fract(H / uContourInterval + 0.5) - 0.5) * uContourInterval;
        Colour = mix(Colour, vec3(0.0), (1.0 - smoothstep(Width * 0.5, Width * 1.5, Offset)) * 0.35);
        float Coast = abs(Above);
        Colour = mix(Colour, vec3(0.9, 0.95, 1.0), (1.0 - smoothstep(Width * 0.6, Width * 1.8, Coast)) * 0.5 * float(uWaterVisible));
    }
    Colour = mix(vec3(dot(Colour, vec3(0.33))) * 0.7, Colour, uActive);
    Output = vec4(Colour, 1.0);
}`;
