//============================================================================================================================================
//                                                                 SHADERS.JS
//============================================================================================================================================
// 📦 GLSL 3.00 ES sources for strands, sparks, dust, background, glow, composite and text.

// 📝 Strands are generated entirely in the vertex shader from gl_VertexID. No geometry is uploaded, so changing a
//    count, a shape or a colour costs one uniform update and every animation is evaluated on the GPU.

export const VersionLine = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

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
uniform int FollowPath;
uniform int FlowerCount;
uniform int Petals;
uniform float Cup;
uniform float TrailLength;
uniform int PulseRate;
uniform float PulseDepth;
uniform int PulseShape;
uniform int PathSamples;
uniform highp sampler2D PathTexture;
`;

// 📝 Pulse curves are periodic in the loop, so a pulse lands on the same brightness at the seam. Shapes: 0 Breathe is an
//    eased sine that rests at the bottom and crests mid-cycle; 1 Heartbeat is two short beats then rest; 2 Ripple uses
//    the Breathe curve with each fibre's cycle delayed by its arc position, so the pulse runs outward from the root.
//    3 Sweep is one front that runs along the fibre once per cycle, then holds and fades; see SweepLevel.
export const PulseChunk = `
const float Tau = 6.283185307;

float PeriodicGap(float First, float Second)
{
    float Gap = abs(fract(First) - fract(Second));
    return min(Gap, 1.0 - Gap);
}

float PulseLevel(float Cycle)
{
    if (PulseShape == 1)
    {
        float FirstBeat = exp(-pow(PeriodicGap(Cycle, 0.10) / 0.045, 2.0));
        float SecondBeat = 0.55 * exp(-pow(PeriodicGap(Cycle, 0.27) / 0.055, 2.0));
        return clamp(FirstBeat + SecondBeat, 0.0, 1.0);
    }
    return 0.5 - 0.5 * cos(Tau * Cycle);
}

// 📝 Sweep is one front that runs from the start of the fibre (Position 0) to its end (Position 1) over the first 45 % of
//    each cycle, lighting what it passes, with a brighter ridge on the front. The lit part holds to 75 % and fades to dark
//    by the end of the cycle, so the next sweep starts from darkness and the loop closes on itself. Periodic and bounded.
float SweepLevel(float Position, float Cycle)
{
    float Front = -0.03 + 1.06 * min(Cycle / 0.45, 1.0);
    // 📝 The lit part fades in from the seam while the front runs, and is full once the front has completed the loop, so the
    //    completed plateau has no step where the fibre closes. The ridge dissolves as it nears the end, for the same reason.
    float Done = smoothstep(1.0, 1.01, Front - 0.02);
    float Origin = mix(smoothstep(0.0, 0.04, Position), 1.0, Done);
    float Body = Origin * (1.0 - smoothstep(Front - 0.02, Front + 0.005, Position));
    float Offset = (Position - (Front - 0.012)) / 0.012;
    float Ridge = Origin * exp(-0.5 * Offset * Offset) * smoothstep(0.0, 0.04, Cycle) * (1.0 - smoothstep(0.85, 1.0, Front - 0.012));
    float Hold = 1.0 - smoothstep(0.75, 1.0, Cycle);
    return clamp(Hold * clamp(0.65 * Body + 0.35 * Ridge, 0.0, 1.0), 0.0, 1.0);
}

// 📝 Brightness factor for a fibre at arc position Along. Depth 0 leaves the layer unchanged; depth 1 swings from dark to full.
float PulseFactorAt(float Along)
{
    if (PulseRate == 0 || PulseDepth <= 0.0) return 1.0;
    if (PulseShape == 3) return 1.0 - PulseDepth + PulseDepth * SweepLevel(Along, fract(float(PulseRate) * LoopFraction));
    float Phase = float(PulseRate) * LoopFraction - (PulseShape == 2 ? Along : 0.0);
    return 1.0 - PulseDepth + PulseDepth * PulseLevel(fract(Phase));
}

// 📝 Flower heads open with the same pulse, delayed by head index, so a chain of blooms opens in sequence. Under a sweep the
//    front passes the heads in index order instead.
float FlowerOpening(float Flower)
{
    if (PulseRate == 0) return 0.0;
    if (PulseShape == 3) return PulseDepth * SweepLevel(Flower / float(FlowerCount), fract(float(PulseRate) * LoopFraction));
    return PulseDepth * PulseLevel(fract(float(PulseRate) * LoopFraction - Flower / float(FlowerCount)));
}
`;

// 📝 Every time term is an integer multiple of the loop phase, so each animation repeats exactly at LoopSeconds.
export const CurveChunk = `

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

// 📝 The path table holds the closed curve at equal arc length, so Fraction is the share of the path travelled and the
//    speed along it is even. Interpolation is linear between samples, and the last sample wraps to the first.
vec3 PathPointAt(float Fraction)
{
    float Position = fract(Fraction) * float(PathSamples);
    int Index = clamp(int(floor(Position)), 0, PathSamples - 1);
    int Next = Index + 1 < PathSamples ? Index + 1 : 0;
    float Ratio = Position - float(Index);
    vec3 From = texelFetch(PathTexture, ivec2(Index, 0), 0).xyz;
    vec3 To = texelFetch(PathTexture, ivec2(Next, 0), 0).xyz;
    return mix(From, To, Ratio);
}

vec3 PathTangentAt(float Fraction)
{
    float Step = 1.0 / float(PathSamples);
    vec3 Span = PathPointAt(Fraction + Step) - PathPointAt(Fraction - Step);
    return length(Span) > 1e-7 ? normalize(Span) : vec3(1.0, 0.0, 0.0);
}

float FlowerOf(float Id)
{
    return floor(mod(Id, float(FlowerCount)));
}

// 📝 A flower is a root cluster with petal fibres. Each fibre runs from the root to a rim whose radius follows the petal
//    lobes, curls by Ruffle, bends into a cup by Cup, and opens and closes with the flower's pulse.
vec3 FlowerAt(float S, float Id)
{
    float Lobes = float(Petals);
    float Petal = floor(Unit(Id, 2.0) * Lobes);
    float Theta = Tau * (Petal + 0.5 + 0.8 * (Unit(Id, 6.0) - 0.5)) / Lobes;
    float Lobe = pow(abs(sin(0.5 * Lobes * Theta)), 0.5);
    float Rim = Length * (0.45 + 0.55 * Lobe) * (1.0 + 0.3 * FlowerOpening(FlowerOf(Id)));
    float Root = Spread * sqrt(Unit(Id, 3.0));
    float K = max(1.0, floor(Frequency + 0.5));
    float Wt = Tau * LoopFraction * float(Harmonic);
    float Radius = mix(Root, Rim, S) + Amplitude * S * sin(Tau * K * S + Tau * Unit(Id, 4.0) + Wt);
    float Angle = Theta + 0.35 * Ruffle * sin(3.14159265 * S) * (2.0 * Unit(Id, 5.0) - 1.0);
    float Lift = Cup * Length * S * S * (0.6 + 0.4 * Unit(Id, 7.0));
    return vec3(Radius * cos(Angle), Radius * sin(Angle), Lift);
}

// 📝 A trail is a bundle of fibres riding the path. Each fibre covers TrailLength of the loop behind its head. Heads share
//    one phase per flower, so a flower leaves a comet tail, and PhaseSpread spreads the heads into a stream.
vec3 TrailAt(float S, float Id)
{
    float Head = fract(Unit(Id, 9.0) * PhaseSpread / Tau + FlowerOf(Id) / float(FlowerCount) + LoopFraction * float(Harmonic));
    float Arc = fract(Head - TrailLength * (1.0 - S));
    vec3 Axis = PathTangentAt(Arc);
    vec3 Side = normalize(cross(Axis, vec3(0.0, 0.0, 1.0)));
    float Angle = Tau * Unit(Id, 3.0);
    float Radius = Spread * sqrt(Unit(Id, 4.0));
    float K = max(1.0, floor(Frequency + 0.5));
    float Wobble = Amplitude * S * sin(Tau * K * S + Tau * Unit(Id, 5.0) + Tau * LoopFraction * float(Harmonic));
    return PathPointAt(Arc) + (Side * cos(Angle) + vec3(0.0, 0.0, sin(Angle))) * Radius + Side * Wobble;
}

// 📝 A guide is a light guide: each fibre lies along the whole scene path, offset sideways by its share of the bundle, so
//    the path itself is the shape. Guides are static, so a Sweep pulse is what travels along them. Their ends meet at the seam.
vec3 GuideAt(float S, float Id)
{
    vec3 Axis = PathTangentAt(S);
    vec3 Side = normalize(cross(Axis, vec3(0.0, 0.0, 1.0)));
    float Angle = Tau * Unit(Id, 3.0);
    float Radius = Spread * sqrt(Unit(Id, 4.0));
    float K = max(1.0, floor(Frequency + 0.5));
    float Wobble = Amplitude * sin(Tau * K * S + Tau * Unit(Id, 5.0));
    return PathPointAt(S) + (Side * cos(Angle) + vec3(0.0, 0.0, sin(Angle))) * Radius + Side * Wobble;
}

// 📝 Every shape returns local coordinates. Ride-the-path layers add the path point of their flower, so one world transform
//    serves all shapes. Trails and guides already include their path position.
vec3 CurveAt(float S, float Id)
{
    if (Shape == 4) return TrailAt(S, Id);
    if (Shape == 5) return GuideAt(S, Id);
    vec3 Local = BezierAt(S, Id);
    if (Shape == 1) Local = BloomAt(S, Id);
    else if (Shape == 2) Local = WaveAt(S, Id);
    else if (Shape == 3) Local = FlowerAt(S, Id);
    if (FollowPath == 1) Local += PathPointAt(LoopFraction * float(Harmonic) + FlowerOf(Id) / float(FlowerCount));
    return Local;
}

// 📝 The light head of a strand moves along it once per pulse; sparks and streaks read the same head.
float HeadOf(float Id)
{
    return fract(Unit(Id, 9.0) + float(WindowCycles) * LoopFraction);
}
`;

export const StrandVertex = `
uniform float Thickness;
uniform float PixelScale;
uniform float ProjectionScale;
uniform float Taper;

out float VAlong;
out float VAcross;
out float VId;
out float VSigma;
out float VHalo;
out float VFade;

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

    // 📝 The core is sized in pixels, so a fibre keeps its width at any distance and never drops below one pixel of
    //    coverage. The quad is widened to the halo envelope, also in pixels, and the fragment shader reads the offset.
    vec4 Clip = ViewProjection * vec4(Centre, 1.0);
    float PixelsPerMetre = ProjectionScale / max(Clip.w, 1e-3);
    float SigmaPixels = max(0.8, Thickness * PixelScale) * 0.42466;
    float HaloPixels = max(2.4 * PixelScale, 2.0 * SigmaPixels);
    float EnvelopePixels = 3.6 * HaloPixels;
    // 📝 Guides are closed loops, so their ends are not tapered: the seam would otherwise go dark.
    float Fade = Shape == 5 ? 1.0 : mix(1.0, pow(max(sin(3.14159265 * S), 0.0), 0.5), Taper);
    vec3 World = Centre + Lateral * (Side * EnvelopePixels / max(PixelsPerMetre, 1e-6));
    gl_Position = ViewProjection * vec4(World, 1.0);
    VAlong = S;
    VAcross = Side * EnvelopePixels;
    VId = Id;
    VSigma = SigmaPixels;
    VHalo = HaloPixels;
    VFade = Fade;
}
`;

export const StrandFragment = `
in float VAlong;
in float VAcross;
in float VId;
in float VSigma;
in float VHalo;
in float VFade;

uniform float Intensity;
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
    // 📝 VAcross is a pixel offset from the fibre's centre line. The core is a Gaussian about one pixel wide, so its
    //    peak is Intensity at every distance. The halo is a wider, dimmer Gaussian that carries the glow.
    float Line = exp(-0.5 * VAcross * VAcross / (VSigma * VSigma));
    float Glow = Halo * exp(-0.5 * VAcross * VAcross / (VHalo * VHalo));
    float Head = fract(Unit(VId, 9.0) + float(WindowCycles) * LoopFraction);
    float Behind = fract(Head - VAlong);
    float Front = smoothstep(0.0, 0.05, Behind);
    float Streak = Behind < Window ? pow(1.0 - Behind / Window, 2.0) * Front : 0.0;
    float Lit = Baseline + (1.0 - Baseline) * Streak;
    // 📝 Guides are closed, so their ends meet at the seam and are not faded (see GuideAt).
    float Ends = Shape == 5 ? 1.0 : smoothstep(0.0, 0.04, VAlong) * smoothstep(1.0, 0.96, VAlong);
    // 📝 Guides run their colour gradient through the seam (blue at the start, cyan mid-loop, blue again), so it never steps.
    float Phase = Shape == 5 ? 0.5 - 0.5 * cos(Tau * VAlong) : VAlong;
    vec3 Along = mix(ColourStart, ColourEnd, Phase);
    vec3 Tint = mix(Along, ColourAccent, AccentMix * Unit(VId, 12.0));
    float Vary = 0.4 + 0.9 * Unit(VId, 13.0);
    OutColour = vec4(Tint * (Intensity * Vary * (Line + Glow) * Lit * Ends * VFade * PulseFactorAt(VAlong)), 1.0);
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
    VColour = mix(ColourStart, ColourEnd, S) * SparkBrightness * (0.6 + 0.8 * Unit(Id, 10.0)) * PulseFactorAt(S);
}
`;

export const SparkFragment = `
in vec3 VColour;

out vec4 OutColour;

void main()
{
    vec2 P = gl_PointCoord * 2.0 - 1.0;
    float R2 = dot(P, P);
    float Disc = exp(-R2 * 7.0) * (1.0 - smoothstep(0.7, 1.0, R2));
    OutColour = vec4(VColour * Disc, 1.0);
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
    vec3 Origin = (vec3(Unit(Id, 1.0), Unit(Id, 2.0), Unit(Id, 3.0)) - 0.5) * (2.0 * ParticleSpread);
    float Wt = Tau * LoopFraction * float(ParticleHarmonic);
    float Angle = Tau * Unit(Id, 4.0);
    vec3 Drift = vec3(sin(Wt + Angle), sin(2.0 * Wt + 1.7 * Angle), cos(Wt + 0.6 * Angle))
               * (0.25 + 0.75 * Unit(Id, 5.0)) * (0.08 * ParticleSpread * ParticleDrift);
    vec3 World = ModelRotation * ((Origin + Drift) * ModelScale) + ModelPosition;
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
export const OutputFragment = `
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
    vec3 Toned = pow(Filmic(Light), vec3(1.0 / 2.2));
    vec2 P = (VUv - 0.5) * vec2(Resolution.x / Resolution.y, 1.0);
    float Dark = 1.0 - Vignette * smoothstep(0.3, 0.95, length(P));
    float Noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    // 📝 Output brightness is the last multiplication, so no frame can exceed it, grain included.
    // 📝 Grain multiplies the frame, so true black stays exactly zero and no dither lifts the background.
    Toned = Toned * Dark * (1.0 + 2.0 * Grain * Noise);
    OutColour = vec4(clamp(Toned * Brightness, 0.0, 1.0), 1.0);
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
