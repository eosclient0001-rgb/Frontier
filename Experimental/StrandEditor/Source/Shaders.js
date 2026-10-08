//============================================================================================================================================
//                                                                 SHADERS.JS
//============================================================================================================================================
// 📦 GLSL 3.00 ES sources for strands, sparks, dust, background, glow, composite and text.

// 📝 Strands are generated entirely in the vertex shader from gl_VertexID. No geometry is uploaded, so changing a
//    count, a shape or a colour costs one uniform update and every animation is evaluated on the GPU.

export const Header = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

export const HashChunk = `
uniform int Seed;

uint HashBits(uint Key)
{
    Key ^= Key >> 16u;
    Key *= 0x7feb352du;
    Key ^= Key >> 15u;
    Key *= 0x846ca68bu;
    Key ^= Key >> 16u;
    return Key;
}

float Unit(float Id, float Salt)
{
    uint Key = uint(Id) * 747796405u + uint(Salt) * 2891336453u + uint(Seed) * 196613u;
    return float(HashBits(Key)) * (1.0 / 4294967296.0);
}
`;

export const UniformChunk = `
uniform int Shape;
uniform int StrandCount;
uniform int SegmentCount;
uniform float Length;
uniform float Spread;
uniform float Amplitude;
uniform float Frequency;
uniform vec3 Direction;
uniform float Ruffle;
uniform float SheetWidth;
uniform float Ripple;
uniform float Waves;
uniform float PhaseSpread;
uniform float LoopFraction;
uniform int Harmonic;
uniform int WindowCycles;
uniform mat3 ModelRotation;
uniform vec3 ModelPosition;
uniform float ModelScale;
uniform mat4 ViewProjection;
uniform vec3 CameraPosition;
`;

// 📝 Every time term is an integer multiple of the loop phase, so each animation repeats exactly at LoopSeconds.
export const CurveChunk = `
const float Tau = 6.283185307;

vec3 BezierAt(float S, float Id)
{
    vec3 Axis = length(Direction) > 1e-5 ? normalize(Direction) : vec3(1.0, 0.0, 0.0);
    vec3 Up = abs(Axis.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 Lateral = normalize(cross(Up, Axis));
    vec3 Normal = cross(Axis, Lateral);
    float Angle = Tau * Unit(Id, 1.0);
    float Radius = Spread * sqrt(Unit(Id, 2.0));
    vec3 Root = (Lateral * cos(Angle) + Normal * sin(Angle)) * Radius;
    float TipAngle = Tau * Unit(Id, 3.0);
    float TipRadius = Spread * 1.6 * sqrt(Unit(Id, 4.0));
    vec3 Reach = Axis * Length + (Lateral * cos(TipAngle) + Normal * sin(TipAngle)) * TipRadius;
    float K = max(1.0, floor(Frequency + 0.5));
    float Wt = Tau * LoopFraction * float(Harmonic);
    float P1 = Tau * Unit(Id, 5.0);
    float P2 = Tau * Unit(Id, 6.0);
    float P3 = Tau * Unit(Id, 7.0);
    float P4 = Tau * Unit(Id, 8.0);
    vec3 Control1 = Root + Axis * (Length * 0.34) + (Lateral * sin(K * Wt + P1) + Normal * cos(2.0 * K * Wt + P2)) * Amplitude;
    vec3 Control2 = Reach - Axis * (Length * 0.34) + (Lateral * sin(K * Wt + P3) + Normal * sin(2.0 * K * Wt + P4)) * Amplitude;
    float U = 1.0 - S;
    return U * U * U * Root + 3.0 * U * U * S * Control1 + 3.0 * U * S * S * Control2 + S * S * S * Reach;
}

vec3 BloomAt(float S, float Id)
{
    float Z = 1.0 - 2.0 * Unit(Id, 1.0);
    float Azimuth = Tau * Unit(Id, 2.0);
    float Ring = sqrt(max(0.0, 1.0 - Z * Z));
    vec3 Heading = normalize(vec3(Ring * cos(Azimuth), Z * 0.55, Ring * sin(Azimuth)) + vec3(1e-5));
    float Reach = Length * (0.6 + 0.4 * Unit(Id, 3.0));
    float Frill = 1.0 + Ruffle * 0.2 * sin(5.0 * atan(Heading.z, Heading.x) + Tau * LoopFraction * float(Harmonic));
    float Distance = Reach * Frill * S;
    vec3 Sideways = vec3(-sin(Azimuth), 0.0, cos(Azimuth));
    float K = max(1.0, floor(Frequency + 0.5));
    float Curl = Amplitude * sin(Tau * K * S + Tau * Unit(Id, 4.0) + Tau * LoopFraction * float(Harmonic)) * S;
    return Heading * Distance + Sideways * Curl;
}

vec3 WaveAt(float S, float Id)
{
    float Across = (Id + 0.5) / float(StrandCount) - 0.5;
    float Along = (S - 0.5) * Length;
    float Wt = Tau * LoopFraction * float(Harmonic);
    float Lift = Ripple * (sin(Along * Waves + Wt + Across * PhaseSpread * Tau) * 0.7
                         + sin(Across * SheetWidth * Waves * 0.5 - 2.0 * Wt + Along * 0.35) * 0.3);
    return vec3(Along, Across * SheetWidth, Lift);
}

vec3 CurveAt(float S, float Id)
{
    if (Shape == 1) return BloomAt(S, Id);
    if (Shape == 2) return WaveAt(S, Id);
    return BezierAt(S, Id);
}

// 📝 The light head of a strand moves along it once per pulse; sparks and streaks read the same head.
float HeadOf(float Id)
{
    return fract(Unit(Id, 9.0) + float(WindowCycles) * LoopFraction);
}
`;

export const StrandVertex = `
uniform float Width;
uniform float Taper;

out float VAlong;
out float VAcross;
out float VId;

void main()
{
    int Quad = gl_VertexID / 6;
    int Corner = gl_VertexID - Quad * 6;
    int Strand = Quad / SegmentCount;
    int Segment = Quad - Strand * SegmentCount;
    float AlongStep = (Corner == 2 || Corner == 3 || Corner == 5) ? 1.0 : 0.0;
    float SideStep = (Corner == 1 || Corner == 4 || Corner == 5) ? 1.0 : 0.0;
    float Id = float(Strand);
    float S = (float(Segment) + AlongStep) / float(SegmentCount);
    float Side = SideStep * 2.0 - 1.0;

    vec3 Centre = ModelRotation * (CurveAt(S, Id) * ModelScale) + ModelPosition;
    vec3 Ahead = CurveAt(min(S + 0.002, 1.0), Id);
    vec3 Behind = CurveAt(max(S - 0.002, 0.0), Id);
    vec3 Tangent = ModelRotation * (Ahead - Behind);
    vec3 Lateral = cross(Tangent, CameraPosition - Centre);
    float LateralLength = length(Lateral);
    Lateral = LateralLength > 1e-7 ? Lateral / LateralLength : vec3(0.0, 1.0, 0.0);

    float Profile = mix(1.0, max(0.12, pow(max(sin(3.14159265 * S), 0.0), 0.5)), Taper);
    float HalfWidth = 0.5 * Width * ModelScale * Profile;
    vec3 World = Centre + Lateral * (Side * HalfWidth);
    gl_Position = ViewProjection * vec4(World, 1.0);
    VAlong = S;
    VAcross = Side;
    VId = Id;
}
`;

export const StrandFragment = `
in float VAlong;
in float VAcross;
in float VId;

uniform float Intensity;
uniform float Core;
uniform float Halo;
uniform float Baseline;
uniform float Window;
uniform float AccentMix;
uniform vec3 ColourStart;
uniform vec3 ColourEnd;
uniform vec3 ColourAccent;

out vec4 OutColour;

void main()
{
    float Across2 = VAcross * VAcross;
    float Profile = exp(-Across2 * Core) + Halo * exp(-Across2 * Core * 0.08);
    float Head = fract(Unit(VId, 9.0) + float(WindowCycles) * LoopFraction);
    float Behind = fract(Head - VAlong);
    float Front = smoothstep(0.0, 0.05, Behind);
    float Streak = Behind < Window ? pow(1.0 - Behind / Window, 2.0) * Front : 0.0;
    float Lit = Baseline + (1.0 - Baseline) * Streak;
    float Ends = smoothstep(0.0, 0.04, VAlong) * smoothstep(1.0, 0.96, VAlong);
    vec3 Along = mix(ColourStart, ColourEnd, VAlong);
    vec3 Tint = mix(Along, ColourAccent, AccentMix * Unit(VId, 12.0));
    float Vary = 0.4 + 0.9 * Unit(VId, 13.0);
    OutColour = vec4(Tint * (Intensity * Vary * Profile * Lit * Ends), 1.0);
}
`;

export const SparkVertex = `
uniform float SparkSize;
uniform float SparkBrightness;
uniform float Sparks;
uniform vec3 ColourStart;
uniform vec3 ColourEnd;
uniform float ProjectionScale;

out vec3 VColour;

void main()
{
    float Id = float(gl_VertexID);
    if (Unit(Id, 11.0) > Sparks)
    {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        VColour = vec3(0.0);
        return;
    }
    float S = HeadOf(Id);
    vec3 World = ModelRotation * (CurveAt(S, Id) * ModelScale) + ModelPosition;
    vec4 Clip = ViewProjection * vec4(World, 1.0);
    gl_Position = Clip;
    float Depth = max(Clip.w, 0.001);
    gl_PointSize = clamp(SparkSize * ModelScale * ProjectionScale / Depth, 1.0, 48.0);
    VColour = mix(ColourStart, ColourEnd, S) * SparkBrightness * (0.6 + 0.8 * Unit(Id, 10.0));
}
`;

export const SparkFragment = `
in vec3 VColour;

out vec4 OutColour;

void main()
{
    vec2 P = gl_PointCoord * 2.0 - 1.0;
    float R2 = dot(P, P);
    float Core = exp(-R2 * 7.0) * (1.0 - smoothstep(0.7, 1.0, R2));
    OutColour = vec4(VColour * Core, 1.0);
}
`;

export const ParticleVertex = `
uniform float ParticleSize;
uniform float ParticleBrightness;
uniform float ParticleSpread;
uniform float ParticleDrift;
uniform float Bokeh;
uniform float Focus;
uniform vec3 ParticleColour;
uniform int ParticleHarmonic;
uniform float ProjectionScale;

out vec3 VColour;
out float VBokeh;

void main()
{
    float Id = float(gl_VertexID);
    vec3 Base = (vec3(Unit(Id, 1.0), Unit(Id, 2.0), Unit(Id, 3.0)) - 0.5) * (2.0 * ParticleSpread);
    float Wt = Tau * LoopFraction * float(ParticleHarmonic);
    float Angle = Tau * Unit(Id, 4.0);
    vec3 Drift = vec3(sin(Wt + Angle), sin(2.0 * Wt + 1.7 * Angle), cos(Wt + 0.6 * Angle))
               * (0.25 + 0.75 * Unit(Id, 5.0)) * (0.08 * ParticleSpread * ParticleDrift);
    vec3 World = ModelRotation * ((Base + Drift) * ModelScale) + ModelPosition;
    vec4 Clip = ViewProjection * vec4(World, 1.0);
    float Depth = max(Clip.w, 0.001);
    float IsBokeh = Unit(Id, 6.0) < Bokeh ? 1.0 : 0.0;
    float Defocus = abs(Depth - Focus) * 0.05;
    float Pixels = ParticleSize * ModelScale * ProjectionScale / Depth;
    float Size = IsBokeh > 0.5
        ? clamp(Pixels * (2.5 + 8.0 * Defocus), 4.0, 48.0)
        : clamp(Pixels * (0.6 + 0.8 * Unit(Id, 7.0)) + 1.0, 1.0, 12.0);
    gl_PointSize = Size;
    gl_Position = Clip;
    VColour = ParticleColour * ParticleBrightness * (0.5 + Unit(Id, 8.0)) * (IsBokeh > 0.5 ? 0.12 : 1.0);
    VBokeh = IsBokeh;
}
`;

export const ParticleFragment = `
in vec3 VColour;
in float VBokeh;

out vec4 OutColour;

void main()
{
    vec2 P = gl_PointCoord * 2.0 - 1.0;
    float R = length(P);
    float Sparkle = exp(-R * R * 8.0) * (1.0 - smoothstep(0.7, 1.0, R));
    float Disc = (1.0 - smoothstep(0.6, 1.0, R)) * (0.35 + 0.65 * smoothstep(0.55, 0.95, R));
    float Mask = mix(Sparkle, Disc, VBokeh);
    OutColour = vec4(VColour * Mask, 1.0);
}
`;

export const FullscreenVertex = `
out vec2 VUv;

void main()
{
    vec2 Corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    VUv = Corner;
    gl_Position = vec4(Corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BackgroundFragment = `
uniform vec3 InnerColour;
uniform vec3 OuterColour;
uniform vec2 Resolution;

in vec2 VUv;
out vec4 OutColour;

void main()
{
    vec2 P = (VUv - 0.5) * vec2(Resolution.x / Resolution.y, 1.0);
    float D = length(P) / 0.75;
    OutColour = vec4(mix(InnerColour, OuterColour, smoothstep(0.0, 1.0, D)), 1.0);
}
`;

export const DownsampleFragment = `
uniform sampler2D Source;
uniform vec2 TexelSize;
uniform float Threshold;
uniform int Mode;

in vec2 VUv;
out vec4 OutColour;

void main()
{
    vec3 A = texture(Source, VUv + TexelSize * vec2(-0.5, -0.5)).rgb;
    vec3 B = texture(Source, VUv + TexelSize * vec2(0.5, -0.5)).rgb;
    vec3 C = texture(Source, VUv + TexelSize * vec2(-0.5, 0.5)).rgb;
    vec3 D = texture(Source, VUv + TexelSize * vec2(0.5, 0.5)).rgb;
    vec3 Mean = (A + B + C + D) * 0.25;
    if (Mode == 0) Mean = max(Mean - vec3(Threshold), vec3(0.0));
    OutColour = vec4(Mean, 1.0);
}
`;

export const BlurFragment = `
uniform sampler2D Source;
uniform vec2 BlurStep;

in vec2 VUv;
out vec4 OutColour;

void main()
{
    vec3 Sum = texture(Source, VUv).rgb * 0.2270270270;
    Sum += texture(Source, VUv + BlurStep * 1.3846153846).rgb * 0.3162162162;
    Sum += texture(Source, VUv - BlurStep * 1.3846153846).rgb * 0.3162162162;
    Sum += texture(Source, VUv + BlurStep * 3.2307692308).rgb * 0.0702702703;
    Sum += texture(Source, VUv - BlurStep * 3.2307692308).rgb * 0.0702702703;
    OutColour = vec4(Sum, 1.0);
}
`;

// 📝 Filmic curve (Narkowicz ACES fit) keeps the white-hot core of a strand from clipping to flat colour.
export const CompositeFragment = `
uniform sampler2D SceneTex;
uniform sampler2D GlowA;
uniform sampler2D GlowB;
uniform sampler2D GlowC;
uniform sampler2D GlowD;
uniform vec4 GlowWeights;
uniform float Exposure;
uniform float GlowAmount;
uniform float Saturation;
uniform float Brightness;
uniform float Vignette;
uniform float Grain;
uniform vec2 Resolution;

in vec2 VUv;
out vec4 OutColour;

vec3 Filmic(vec3 X)
{
    const float A = 2.51;
    const float B = 0.03;
    const float C = 2.43;
    const float D = 0.59;
    const float E = 0.14;
    return clamp((X * (A * X + B)) / (X * (C * X + D) + E), 0.0, 1.0);
}

void main()
{
    vec3 Scene = texture(SceneTex, VUv).rgb;
    vec3 Glow = texture(GlowA, VUv).rgb * GlowWeights.x
              + texture(GlowB, VUv).rgb * GlowWeights.y
              + texture(GlowC, VUv).rgb * GlowWeights.z
              + texture(GlowD, VUv).rgb * GlowWeights.w;
    vec3 Light = (Scene + Glow * GlowAmount) * Exposure;
    float Luma = dot(Light, vec3(0.2126, 0.7152, 0.0722));
    Light = max(mix(vec3(Luma), Light, Saturation), vec3(0.0));
    vec3 Mapped = pow(Filmic(Light), vec3(1.0 / 2.2));
    vec2 P = (VUv - 0.5) * vec2(Resolution.x / Resolution.y, 1.0);
    float Dark = 1.0 - Vignette * smoothstep(0.3, 0.95, length(P));
    float Noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    // 📝 Output brightness is the last multiplication, so no frame can exceed it, grain included.
    Mapped = Mapped * Dark + Noise * (Grain + 1.0 / 255.0);
    OutColour = vec4(clamp(Mapped * Brightness, 0.0, 1.0), 1.0);
}
`;

export const TextFragment = `
uniform sampler2D TextTex;
uniform float Brightness;

in vec2 VUv;
out vec4 OutColour;

void main()
{
    vec4 Texel = texture(TextTex, VUv);
    OutColour = vec4(Texel.rgb * Brightness, Texel.a);
}
`;
