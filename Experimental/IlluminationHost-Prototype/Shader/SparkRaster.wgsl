//============================================================================================================================================
//                                                             SPARKRASTER.WGSL
//============================================================================================================================================
// 🧩 Sparks as streaks: each one a screen-aligned quad from where the camera saw it a frame ago to where it sees it now, additive.

// 📝 Per instance (SparkSequence.js): the head (now) and the tail (a frame ago) in world space, the spark's width and its
//    blackbody radiance, the derez progress (tail w: 0 whole … 1 gone) and the spark's seed (radiance w). The head projects through this frame's camera and the tail through last frame's, so the
//    streak is the spark's motion as the camera saw it over the frame — a shutter's blur: sparks thrown off a wheel
//    stream back from a car the camera follows. The quad spans head to tail in screen space, at least a pixel wide so
//    a distant spark stays visible and never longer than a fifth of the screen (a camera cut). Across it, a hot core
//    a spark's width wide and a halo three times that wide: the glow a bright source throws onto its surroundings. The
//    head is brighter than the tail. Below 1350 K the spark derezzes: it breaks into blocks of pixels, each dropped
//    when its hash falls under the progress, so it dissolves rather than fading. Drawn over the resolved image
//    (unjittered), depth-tested against the opaque surface, added.

//! include "FrameDescriptor.wgsl"

struct SparkVarying
{
    @builtin(position) Position : vec4f,
    @location(0) Radiance       : vec3f,
    @location(1) Profile        : vec2f,   // x across [-3, 3] (core |x| < 1, halo beyond), y along [0 tail, 1 head]
    @location(2) Derez          : f32,     // 0 whole … 1 gone
    @location(3) Seed           : f32,
}

// 📐 Derez cells: 2.5 px blocks, so the dissolve reads as the pixel break-up of a derezzing object.
const DerezCellPixels = 2.5;
// 📐 Halo: the glow's width across, in spark widths; its brightness relative to the core.
const HaloWidths = 3.0;
const HaloGain = 0.12;

fn ProjectPixels(Clip: vec4f) -> vec2f
{
    return Clip.xy / Clip.w * 0.5 * Frame.ScreenExtent;
}

@vertex
fn SparkVertex(@builtin(vertex_index) VertexIndex: u32, @location(0) Head: vec4f, @location(1) Tail: vec4f,
               @location(2) Radiance: vec4f) -> SparkVarying
{
    var Varying: SparkVarying;
    let HeadClip = Frame.UnjitteredViewProjection * vec4f(Head.xyz, 1.0);
    var TailClip = Frame.PreviousUnjitteredViewProjection * vec4f(Tail.xyz, 1.0);
    if (HeadClip.w < 0.05)
    {
        Varying.Position = vec4f(0.0, 0.0, -2.0, 1.0);
        return Varying;
    }
    if (TailClip.w < 0.05)
    {
        TailClip = HeadClip;
    }
    let Up = vec3f(Frame.View[0].y, Frame.View[1].y, Frame.View[2].y);
    let HeadPixels = ProjectPixels(HeadClip);
    var TailPixels = ProjectPixels(TailClip);
    let Width = max(length(ProjectPixels(Frame.UnjitteredViewProjection * vec4f(Head.xyz + Up * Head.w, 1.0)) - HeadPixels), 1.0);
    var Along = HeadPixels - TailPixels;
    let Longest = 0.2 * Frame.ScreenExtent.y;
    if (length(Along) > Longest)
    {
        TailPixels = HeadPixels - Along * (Longest / length(Along));
        Along = HeadPixels - TailPixels;
    }
    let Length = length(Along);
    Along = select(vec2f(1.0, 0.0), Along / max(Length, 1.0e-4), Length > 1.0e-3);
    let Across = vec2f(-Along.y, Along.x);
    // 📝 Corners: (along, across) — tail end pushed back and head end forward by half a width so a still spark is a dot.
    var Corners = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
    let Corner = Corners[VertexIndex % 6u];
    // 📝 Both ends take the head's depth: the tail's clip position belongs to last frame's camera, and a streak a few
    //    centimetres long sits at one depth for the test anyway.
    let BasePixels = select(TailPixels, HeadPixels, Corner.x > 0.5);
    let Offset = Across * Corner.y * Width * 0.5 * HaloWidths + Along * (Corner.x - 0.5) * Width;
    let Pixels = BasePixels + Offset;
    Varying.Position = vec4f(Pixels / (0.5 * Frame.ScreenExtent) * HeadClip.w, HeadClip.z, HeadClip.w);
    // 📝 Energy: a spark's light spread over a streak longer than its width is shared out along it.
    let Spread = Width / max(Length + Width, Width);
    Varying.Radiance = Radiance.rgb * mix(0.35, 1.0, Spread) * Frame.EmissionScale;
    Varying.Profile = vec2f(Corner.y * HaloWidths, Corner.x);
    Varying.Derez = Tail.w;
    Varying.Seed = Radiance.w;
    return Varying;
}

@fragment
fn SparkFragment(Varying: SparkVarying) -> @location(0) vec4f
{
    // 📝 Derez: whole blocks of the spark drop out, a hash per block (seeded by the spark) against the progress.
    let Cell = floor(Varying.Position.xy / DerezCellPixels);
    let Hash = fract(sin(dot(Cell + vec2f(Varying.Seed * 131.0, Varying.Seed * 17.0), vec2f(12.9898, 78.233))) * 43758.5453);
    if (Hash < Varying.Derez)
    {
        discard;
    }
    let X = Varying.Profile.x;
    let Core = max(0.0, 1.0 - X * X);
    let Halo = HaloGain * exp(-0.7 * X * X);
    let Across = Core + Halo;
    let Head = mix(0.45, 1.0, Varying.Profile.y);
    return vec4f(Varying.Radiance * Across * Head, 0.0);
}
