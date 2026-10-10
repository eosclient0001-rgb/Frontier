// ─────────────────────────────────────────────────────────────────────────────
//  Post chain: TAA → bloom → depth of field → tone map.
// ─────────────────────────────────────────────────────────────────────────────

#include "frame.wgsl"

struct PostU {
  p0: vec4<f32>,   // srcTexel.xy, dstTexel.xy
  p1: vec4<f32>,   // exposure, bloom, taaBlend, reset
  p2: vec4<f32>,   // tonemap, vignette, grain, saturation
  p3: vec4<f32>,   // srcSize.xy, dstSize.xy
  p4: vec4<f32>,   // dofAmount, dofFocus, dofMax, sharpen
  p5: vec4<f32>,   // bloomThreshold, bloomKnee, frame, spare
}

@group(0) @binding(0) var<uniform> P: PostU;
@group(0) @binding(1) var texA: texture_2d<f32>;
@group(0) @binding(2) var texB: texture_2d<f32>;
@group(0) @binding(3) var texC: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var<storage, read> EXPO: array<f32>;
@group(0) @binding(6) var<uniform> F: Frame;
@group(0) @binding(7) var depthTex: texture_depth_2d;

struct FSIn {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FSIn {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let p = pos[vi];
  var o: FSIn;
  o.clip = vec4<f32>(p, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  o.uv.y = 1.0 - o.uv.y;
  return o;
}

fn lum(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }

// ─────────────────────────────────────────────────────────────────────────────
//  Temporal anti-aliasing
// ─────────────────────────────────────────────────────────────────────────────
fn worldFromDepth(uv: vec2<f32>, d: f32) -> vec3<f32> {
  let ndc = vec3<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d);
  let w = F.invViewProj * vec4<f32>(ndc, 1.0);
  return w.xyz / w.w;
}

fn rgbToYcocg(c: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
                   0.5 * (c.r - c.b),
                   -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
fn ycocgToRgb(c: vec3<f32>) -> vec3<f32> {
  let t = c.x - c.z;
  return vec3<f32>(t + c.y, c.x + c.z, t - c.y);
}

@fragment
fn fsTAA(in: FSIn) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let texel = P.p0.xy;
  let cur = textureSampleLevel(texA, samp, uv, 0.0).rgb;
  let depth = textureLoad(depthTex, vec2<i32>(in.clip.xy), 0);

  var blend = P.p1.z;
  if (P.p1.w > 0.5 || depth >= 1.0) {
    return vec4<f32>(cur, 1.0);
  }

  let world = worldFromDepth(uv, depth);
  let prevClip = F.prevViewProj * vec4<f32>(world, 1.0);
  var prevUV = prevClip.xy / max(prevClip.w, 1e-6) * 0.5 + 0.5;
  prevUV.y = 1.0 - prevUV.y;

  if (prevUV.x < 0.0 || prevUV.y < 0.0 || prevUV.x > 1.0 || prevUV.y > 1.0) {
    return vec4<f32>(cur, 1.0);
  }

  // disocclusion: the surface that now sits at prevUV must be the same one
  let prevDepth = textureLoad(depthTex, vec2<i32>(prevUV * P.p3.xy), 0);
  let prevWorld = worldFromDepth(prevUV, prevDepth);
  if (distance(prevWorld, world) > 0.04 * length(world - F.camPos.xyz) + 0.4) {
    blend = 1.0;
  }

  let hist = textureSampleLevel(texC, samp, prevUV, 0.0).rgb;

  // variance clipping on a 3x3 neighbourhood
  var m1 = vec3<f32>(0.0);
  var m2 = vec3<f32>(0.0);
  var n = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let s = textureSampleLevel(texA, samp, uv + vec2<f32>(f32(x), f32(y)) * texel, 0.0).rgb;
      m1 = m1 + s;
      m2 = m2 + s * s;
      n = n + 1.0;
    }
  }
  let mean = m1 / n;
  let sigma = sqrt(max(m2 / n - mean * mean, vec3<f32>(0.0)));
  let lo = mean - sigma * 1.25;
  let hi = mean + sigma * 1.25;
  let clipped = clamp(hist, lo, hi);

  let out = mix(clipped, cur, blend);
  return vec4<f32>(max(out, vec3<f32>(0.0)), 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bloom
// ─────────────────────────────────────────────────────────────────────────────
fn tap4(uv: vec2<f32>, t: vec2<f32>) -> vec3<f32> {
  var c = textureSampleLevel(texA, samp, uv + vec2<f32>(-t.x, -t.y), 0.0).rgb;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(t.x, -t.y), 0.0).rgb;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(-t.x, t.y), 0.0).rgb;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(t.x, t.y), 0.0).rgb;
  return c * 0.25;
}

@fragment
fn fsBloomPrefilter(in: FSIn) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let t = P.p0.xy;
  var c = textureSampleLevel(texA, samp, uv, 0.0).rgb;
  // clamp fireflies before thresholding
  let br = max(max(c.r, c.g), c.b);
  if (br > 12.0) { c = c * (12.0 / br); }
  let l = lum(c);
  let knee = max(P.p5.y, 1e-4);
  let soft = clamp(l - P.p5.x + knee, 0.0, 2.0 * knee);
  let contrib = max(soft * soft / (4.0 * knee), l - P.p5.x) / max(l, 1e-5);
  return vec4<f32>(c * contrib, 1.0);
}

@fragment
fn fsBloomDown(in: FSIn) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let t = P.p0.xy;
  var c = tap4(uv, t * 0.5);
  c = c + tap4(uv + vec2<f32>(-t.x, 0.0), t * 0.5) * 0.5;
  c = c + tap4(uv + vec2<f32>(t.x, 0.0), t * 0.5) * 0.5;
  return vec4<f32>(c * 0.5, 1.0);
}

@fragment
fn fsBloomUp(in: FSIn) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let t = P.p0.xy;
  // 3x3 tent on the coarser mip, added onto the finer one
  var c = textureSampleLevel(texA, samp, uv, 0.0).rgb * 0.25;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(-t.x, 0.0), 0.0).rgb * 0.125;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(t.x, 0.0), 0.0).rgb * 0.125;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(0.0, -t.y), 0.0).rgb * 0.125;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(0.0, t.y), 0.0).rgb * 0.125;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(-t.x, -t.y), 0.0).rgb * 0.0625;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(t.x, -t.y), 0.0).rgb * 0.0625;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(-t.x, t.y), 0.0).rgb * 0.0625;
  c = c + textureSampleLevel(texA, samp, uv + vec2<f32>(t.x, t.y), 0.0).rgb * 0.0625;
  return vec4<f32>(c, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Luminance (auto exposure)
// ─────────────────────────────────────────────────────────────────────────────
@fragment
fn fsLumDown(in: FSIn) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let t = P.p0.xy;
  var c = tap4(uv, t * 0.5);
  c = c + tap4(uv + vec2<f32>(-t.x * 2.0, 0.0), t * 0.5);
  c = c + tap4(uv + vec2<f32>(t.x * 2.0, 0.0), t * 0.5);
  c = c + tap4(uv + vec2<f32>(0.0, -t.y * 2.0), t * 0.5);
  c = c + tap4(uv + vec2<f32>(0.0, t.y * 2.0), t * 0.5);
  let l = lum(c * 0.2);
  return vec4<f32>(log(max(l, 1e-6)), 0.0, 0.0, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tone map
// ─────────────────────────────────────────────────────────────────────────────
const AGX_INSET: mat3x3<f32> = mat3x3<f32>(
  0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859);
const AGX_OUTSET: mat3x3<f32> = mat3x3<f32>(
  1.1271005818144368, -0.11060664309660323, -0.016493938717834573,
  -0.1413297634984383, 1.157823702216272, -0.016493938717834573,
  -0.14132976349843826, -0.11060664309660323, 1.2519364065950405);

fn agxContrast(v: vec3<f32>) -> vec3<f32> {
  let x2 = v * v;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * v + 31.96 * x4 - 6.868 * x2 * v + 0.4298 * x2 + 0.1191 * v;
}

fn tonemapAgx(c: vec3<f32>) -> vec3<f32> {
  var v = AGX_INSET * max(c, vec3<f32>(0.0));
  v = log2(max(v, vec3<f32>(1e-10)));
  v = (v - vec3<f32>(-12.47393)) / 16.5;
  v = clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
  v = agxContrast(v);
  return clamp(AGX_OUTSET * v, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tonemapACES(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tonemapFilmic(c: vec3<f32>) -> vec3<f32> {
  // Jim Hejl / Richard Burgess-Dawson
  var x = max(c, vec3<f32>(0.0));
  x = x * 2.0;
  let a = x * (2.51 * x + 0.03);
  let b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / b, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn linearToSrgb(c: vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3<f32>(1e-5)), vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

const SPIRAL: array<vec2<f32>, 16> = array<vec2<f32>, 16>(
  vec2<f32>(0.0, 0.0), vec2<f32>(0.7071, 0.0), vec2<f32>(0.0, 0.7071),
  vec2<f32>(-0.7071, 0.0), vec2<f32>(0.0, -0.7071), vec2<f32>(0.9239, 0.3827),
  vec2<f32>(0.3827, 0.9239), vec2<f32>(-0.3827, 0.9239), vec2<f32>(-0.9239, 0.3827),
  vec2<f32>(-0.9239, -0.3827), vec2<f32>(-0.3827, -0.9239), vec2<f32>(0.3827, -0.9239),
  vec2<f32>(0.9239, -0.3827), vec2<f32>(0.5, 0.0), vec2<f32>(0.0, 0.5),
  vec2<f32>(-0.5, 0.0));

@fragment
fn fsTonemap(in: FSIn) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let exposure = select(P.p1.x, EXPO[0], P.p1.x <= 0.0);
  var col = vec3<f32>(0.0);
  let dof = P.p4.x;

  if (dof > 0.0001) {
    // cheap bokeh: spiral gather scaled by the circle of confusion
    let d = textureLoad(depthTex, vec2<i32>(in.clip.xy), 0);
    let linear = select(1.0 / mix(F.cam.w, F.cam.z, d), 1e6, d >= 1.0);
    let coc = clamp(abs(linear - P.p4.y) / max(P.p4.y, 1.0) * dof, 0.0, P.p4.z);
    let r = coc * 0.02;
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;
    let ang = hash12(in.clip.xy) * 6.2831853;
    let ca = cos(ang); let sa = sin(ang);
    for (var k = 0; k < 16; k = k + 1) {
      let o = SPIRAL[k];
      let ro = vec2<f32>(o.x * ca - o.y * sa, o.x * sa + o.y * ca);
      let w = select(1.0, 0.55, k > 4);
      acc = acc + textureSampleLevel(texA, samp, uv + ro * r, 0.0).rgb * w;
      wsum = wsum + w;
    }
    col = acc / wsum;
    if (P.p4.w > 0.0) {
      let c0 = textureSampleLevel(texA, samp, uv, 0.0).rgb;
      col = col + (c0 - col) * P.p4.w;
    }
  } else {
    col = textureSampleLevel(texA, samp, uv, 0.0).rgb;
  }

  col = col + textureSampleLevel(texB, samp, uv, 0.0).rgb * P.p1.y;
  col = col * exposure;

  let mode = P.p2.x;
  if (mode < 0.5) { col = tonemapAgx(col); }
  else if (mode < 1.5) { col = tonemapACES(col); }
  else if (mode < 2.5) { col = tonemapFilmic(col); }
  else { col = clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)); }

  // saturation around the display-referred luminance
  let l = lum(col);
  col = mix(vec3<f32>(l), col, P.p2.w);

  // subtle vignette
  let q = (uv - 0.5) * vec2<f32>(1.0, 1.0);
  let vig = 1.0 - P.p2.y * dot(q, q) * 1.6;
  col = col * clamp(vig, 0.0, 1.0);

  col = linearToSrgb(col);

  // dither to break up 8-bit banding in the sky gradient
  let d = (hash13(vec3<f32>(in.clip.xy, P.p5.z)) - 0.5) / 255.0;
  col = col + vec3<f32>(d * (1.0 + P.p2.z * 8.0));
  col = col + (hash13(vec3<f32>(in.clip.yx, P.p5.z + 3.0)) - 0.5) * P.p2.z;

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Exposure reduction (compute)
// ─────────────────────────────────────────────────────────────────────────────
@group(1) @binding(0) var<uniform> P2: PostU;
@group(1) @binding(1) var lumTex: texture_2d<f32>;
@group(1) @binding(2) var<storage, read_write> EXPO2: array<f32>;

var<workgroup> lumAcc: array<f32, 256>;

@compute @workgroup_size(256, 1, 1)
fn lumReduce(@builtin(local_invocation_index) li: u32) {
  let size = vec2<i32>(textureDimensions(lumTex, 0));
  let total = size.x * size.y;
  var acc = 0.0;
  var cnt = 0.0;
  var k = i32(li);
  loop {
    if (k >= total) { break; }
    let c = textureLoad(lumTex, vec2<i32>(k % size.x, k / size.x), 0).r;
    acc = acc + c;
    cnt = cnt + 1.0;
    k = k + 256;
  }
  lumAcc[li] = acc;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (li < s) { lumAcc[li] = lumAcc[li] + lumAcc[li + s]; }
    workgroupBarrier();
  }
  if (li != 0u) { return; }
  let avgLog = lumAcc[0] / max(f32(total), 1.0);
  let avgLum = exp(avgLog);
  let aimLum = 0.18;
  var e = aimLum / clamp(avgLum, 1e-4, 1e4);
  e = clamp(e, 0.002, 400.0);
  let prev = EXPO2[0];
  let smoothed = select(e, mix(prev, e, 0.08), prev > 0.0);
  EXPO2[0] = smoothed;
  EXPO2[1] = avgLum;
}
