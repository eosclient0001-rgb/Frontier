// ─────────────────────────────────────────────────────────────────────────────
//  Frontier Terrain — shader library
//  Hashes, analytic-derivative noise, mask evaluation shared by every pass.
// ─────────────────────────────────────────────────────────────────────────────

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const INV_PI: f32 = 0.3183098861837907;

// Fixed-point scale used for all atomic height/flow accumulation.
const HEIGHT_FIXED: f32 = 8388608.0;   // 2^23
const FLOW_FIXED: f32 = 65536.0;       // 2^16

// ── scalar hashes ────────────────────────────────────────────────────────────
fn hash11(p: f32) -> f32 {
  var p3 = fract(vec3<f32>(p) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash13(p: vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
  var p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn hash32(p: vec2<f32>) -> vec3<f32> {
  var p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// Unit gradient from an angle-free integer hash (Dave Hoskins style).
fn grad2(i: vec2<f32>) -> vec2<f32> {
  let a = hash12(i) * TAU;
  return vec2<f32>(cos(a), sin(a));
}

// ── gradient (Perlin) noise, value + analytic derivative ─────────────────────
//  returns vec3(value, d/dx, d/dy)   with value in ~[-1,1]
fn gnoise2(p: vec2<f32>) -> vec3<f32> {
  let i = floor(p);
  let f = p - i;
  // quintic interpolant and its derivative
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

  let g00 = grad2(i + vec2<f32>(0.0, 0.0));
  let g10 = grad2(i + vec2<f32>(1.0, 0.0));
  let g01 = grad2(i + vec2<f32>(0.0, 1.0));
  let g11 = grad2(i + vec2<f32>(1.0, 1.0));

  let d00 = f - vec2<f32>(0.0, 0.0);
  let d10 = f - vec2<f32>(1.0, 0.0);
  let d01 = f - vec2<f32>(0.0, 1.0);
  let d11 = f - vec2<f32>(1.0, 1.0);

  let n00 = dot(g00, d00);
  let n10 = dot(g10, d10);
  let n01 = dot(g01, d01);
  let n11 = dot(g11, d11);

  let va = mix(n00, n10, u.x);
  let vb = mix(n01, n11, u.x);
  let v = mix(va, vb, u.y);

  let dvdx = ((n10 - n00) * (1.0 - u.y) + (n11 - n01) * u.y) * du.x;
  let dvdy = ((n01 - n00) * (1.0 - u.x) + (n11 - n10) * u.x) * du.y;

  // normalise to roughly [-1,1]
  return vec3<f32>(v * 1.4, dvdx * 1.4, dvdy * 1.4);
}

// ── simplex-ish value noise (cheap, no derivative) ───────────────────────────
fn vnoise2(p_in: vec2<f32>) -> f32 {
  let i = floor(p_in);
  let f = p_in - i;
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i + vec2<f32>(0.0, 0.0));
  let b = hash12(i + vec2<f32>(1.0, 0.0));
  let c = hash12(i + vec2<f32>(0.0, 1.0));
  let d = hash12(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// ── Worley / cellular: returns (F1, F2) ──────────────────────────────────────
fn worley2(p_in: vec2<f32>) -> vec2<f32> {
  let i = floor(p_in);
  let f = p_in - i;
  var f1 = 8.0;
  var f2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2<f32>(f32(x), f32(y));
      let o = hash22(i + g);
      let r = length(g + o - f);
      if (r < f1) { f2 = f1; f1 = r; }
      else if (r < f2) { f2 = r; }
    }
  }
  return vec2<f32>(f1, f2);
}

// Worley with a per-cell random id (used for pebble / plate variation).
fn worley2id(p_in: vec2<f32>) -> vec3<f32> {
  let i = floor(p_in);
  let f = p_in - i;
  var f1 = 8.0;
  var f2 = 8.0;
  var id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2<f32>(f32(x), f32(y));
      let h = hash32(i + g);
      let r = length(g + h.xy - f);
      if (r < f1) { f2 = f1; f1 = r; id = h.z; }
      else if (r < f2) { f2 = r; }
    }
  }
  return vec3<f32>(f1, f2, id);
}

// ── fractal sums (all return value + analytic derivative) ────────────────────
const OCT_ROT: mat2x2<f32> = mat2x2<f32>(0.8, 0.6, -0.6, 0.8);

/// Classic fBm. oct is rounded to [1,8].
fn fbm2(p_in: vec2<f32>, oct: f32, lac: f32, gain: f32) -> vec3<f32> {
  var p = p_in;
  var amp = 1.0;
  var sum = vec3<f32>(0.0);
  var norm = 0.0;
  let n = i32(clamp(oct, 1.0, 12.0));
  for (var i = 0; i < n; i++) {
    let s = gnoise2(p);
    sum += vec3<f32>(s.x, s.y, s.z) * amp;
    norm += amp;
    amp *= gain;
    p = OCT_ROT * p * lac + vec2<f32>(19.19, 7.77);
  }
  return sum / max(norm, 1e-5);
}

/// Ridged multifractal — sharp crests, the backbone of mountain ranges.
fn ridged2(p_in: vec2<f32>, oct: f32, lac: f32, gain: f32, sharp: f32) -> vec3<f32> {
  var p = p_in;
  var amp = 1.0;
  var sum = vec3<f32>(0.0);
  var norm = 0.0;
  var weight = 1.0;
  let n = i32(clamp(oct, 1.0, 12.0));
  for (var i = 0; i < n; i++) {
    let s = gnoise2(p);
    // ridge: 1 - |n|, with derivative sign flip
    var v = 1.0 - abs(s.x);
    var dv = -sign(s.x) * vec2<f32>(s.y, s.z);
    v = v * v;
    dv = dv * 2.0 * (1.0 - abs(s.x));
    let w = clamp(v * weight, 0.0, 4.0);
    let dw = select(vec2<f32>(0.0), dv * weight, v * weight < 4.0 && v * weight > 0.0);
    sum += vec3<f32>(w, dw.x, dw.y) * amp;
    norm += amp;
    amp *= gain;
    weight = clamp(w * sharp, 0.0, 1.0);
    p = OCT_ROT * p * lac + vec2<f32>(19.19, 7.77);
  }
  return sum / max(norm, 1e-5);
}

/// Billow — soft rounded lobes, good for dunes and clouds.
fn billow2(p_in: vec2<f32>, oct: f32, lac: f32, gain: f32) -> vec3<f32> {
  var p = p_in;
  var amp = 1.0;
  var sum = vec3<f32>(0.0);
  var norm = 0.0;
  let n = i32(clamp(oct, 1.0, 12.0));
  for (var i = 0; i < n; i++) {
    let s = gnoise2(p);
    let v = 2.0 * abs(s.x) - 1.0;
    let dv = 2.0 * sign(s.x) * vec2<f32>(s.y, s.z);
    sum += vec3<f32>(v, dv.x, dv.y) * amp;
    norm += amp;
    amp *= gain;
    p = OCT_ROT * p * lac + vec2<f32>(19.19, 7.77);
  }
  return sum / max(norm, 1e-5);
}

// ── interpolation helpers ────────────────────────────────────────────────────
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn sat3(x: vec3<f32>) -> vec3<f32> { return clamp(x, vec3<f32>(0.0), vec3<f32>(1.0)); }

/// Band with independent low/high feathering. 1 inside, 0 outside.
fn band(x: f32, lo: f32, hi: f32, feather: f32) -> f32 {
  let f = max(feather, 1e-4);
  return sat(smoothstep(lo - f, lo + f, x)) * (1.0 - sat(smoothstep(hi - f, hi + f, x)));
}

/// Doubly-feathered band using separate low and high feather widths.
fn band2(x: f32, lo: f32, hi: f32, fl: f32, fh: f32) -> f32 {
  let a = sat(smoothstep(lo - max(fl, 1e-4), lo + max(fl, 1e-4), x));
  let b = 1.0 - sat(smoothstep(hi - max(fh, 1e-4), hi + max(fh, 1e-4), x));
  return a * b;
}

fn remap01(v: f32, lo: f32, hi: f32) -> f32 { return sat((v - lo) / max(hi - lo, 1e-5)); }

// ─────────────────────────────────────────────────────────────────────────────
//  Mask context + evaluator
//
//  m[0] = (altLo,  altHi,  altFeatherLo, altFeatherHi)
//  m[1] = (slpLo,  slpHi,  slpFeatherLo, slpFeatherHi)
//  m[2] = (crvLo,  crvHi,  crvFeatherLo, crvFeatherHi)
//  m[3] = (flwLo,  flwHi,  flwFeatherLo, flwFeatherHi)
//  m[4] = (noiseScale, noiseOctaves, noiseContrast, noiseBias)
//  m[5] = (aspectAngle, aspectWidth, aspectFeather, noiseSeed)
//  m[6] = (depLo, depHi, depFeatherLo, depFeatherHi)
//  m[7] = (aoLo,  aoHi,  aoFeatherLo,  globalGamma)
//
//  flags bits: 0 alt, 1 slope, 2 curvature, 3 flow, 4 noise, 5 aspect,
//              6 deposition, 7 ambient occlusion, 8 invert
// ─────────────────────────────────────────────────────────────────────────────
struct MaskCtx {
  h: f32,        // normalised height 0..1
  slope: f32,    // 0..1  (0 flat, 1 vertical)
  curv: f32,     // 0..1  (0.5 flat)
  flow: f32,     // 0..1
  deposit: f32,  // 0..1  (0.5 neutral)
  ao: f32,       // 0..1
  aspect: f32,   // 0..1, compass angle / TAU
  wxz: vec2<f32>,
}

const MASK_ALT: u32 = 1u;
const MASK_SLOPE: u32 = 2u;
const MASK_CURV: u32 = 4u;
const MASK_FLOW: u32 = 8u;
const MASK_NOISE: u32 = 16u;
const MASK_ASPECT: u32 = 32u;
const MASK_DEPOSIT: u32 = 64u;
const MASK_AO: u32 = 128u;
const MASK_INVERT: u32 = 256u;

fn evalMask(mp: ptr<storage, array<vec4<f32>, 8>, read>, flags: u32, c: MaskCtx) -> f32 {
  if (flags == 0u) { return 1.0; }
  var m = 1.0;

  if ((flags & MASK_ALT) != 0u) {
    let v = band2(c.h, (*mp)[0].x, (*mp)[0].y, (*mp)[0].z, (*mp)[0].w);
    m *= v;
  }
  if ((flags & MASK_SLOPE) != 0u) {
    m *= band2(c.slope, (*mp)[1].x, (*mp)[1].y, (*mp)[1].z, (*mp)[1].w);
  }
  if ((flags & MASK_CURV) != 0u) {
    m *= band2(c.curv, (*mp)[2].x, (*mp)[2].y, (*mp)[2].z, (*mp)[2].w);
  }
  if ((flags & MASK_FLOW) != 0u) {
    m *= band2(c.flow, (*mp)[3].x, (*mp)[3].y, (*mp)[3].z, (*mp)[3].w);
  }
  if ((flags & MASK_DEPOSIT) != 0u) {
    m *= band2(c.deposit, (*mp)[6].x, (*mp)[6].y, (*mp)[6].z, (*mp)[6].w);
  }
  if ((flags & MASK_AO) != 0u) {
    m *= band2(c.ao, (*mp)[7].x, (*mp)[7].y, (*mp)[7].z, (*mp)[7].w);
  }
  if ((flags & MASK_NOISE) != 0u) {
    let sc = (*mp)[4];
    let sd = (*mp)[5].w;
    let n = fbm2(c.wxz * sc.x + vec2<f32>(sd * 13.17, sd * 7.31), max(sc.y, 1.0), 2.0, 0.5).x;
    m *= sat((n * 0.5 + 0.5) * sc.z + sc.w);
  }
  if ((flags & MASK_ASPECT) != 0u) {
    let a = (*mp)[5];
    var d = abs(c.aspect - a.x);
    d = min(d, 1.0 - d);                       // wrap on the circle
    m *= 1.0 - sat(smoothstep(a.y, a.y + max(a.z, 1e-4), d));
  }

  m = pow(sat(m), max((*mp)[7].w, 0.02));
  if ((flags & MASK_INVERT) != 0u) { m = 1.0 - m; }
  return sat(m);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Layer parameter block — one 336-byte record per layer, shared by the
//  terrain passes and the render/material passes so the mask code is identical.
// ─────────────────────────────────────────────────────────────────────────────
struct LayerParams {
  a: array<vec4<f32>, 10>,   //  0..39  generic layer/material parameters
  m: array<vec4<f32>, 8>,    // 40..71  mask parameters
  f: vec4<u32>,              // 72..75  type, blend, maskFlags, spare
  c: array<vec4<f32>, 2>,    // 76..83  colours
}

struct Uniforms {
  v0: vec4<u32>,   // res, layerIndex, seed, count
  v1: vec4<f32>,   // invRes, invRes, heightScale, worldSize
  v2: vec4<f32>,   // time, pass, dropletBase, spare
  v3: vec4<f32>,   // spare
}

// ── height field access (bilinear, clamp to edge) ────────────────────────────
fn idx2(i: vec2<i32>, res: i32) -> i32 {
  let c = clamp(i, vec2<i32>(0, 0), vec2<i32>(res - 1, res - 1));
  return c.y * res + c.x;
}

fn sampleField(F: ptr<storage, array<f32>, read_write>, uv: vec2<f32>, res: f32) -> f32 {
  let p = uv * res - 0.5;
  let fl = floor(p);
  let fr = p - fl;
  let i0 = vec2<i32>(fl);
  let r = i32(res);
  let h00 = (*F)[idx2(i0 + vec2<i32>(0, 0), r)];
  let h10 = (*F)[idx2(i0 + vec2<i32>(1, 0), r)];
  let h01 = (*F)[idx2(i0 + vec2<i32>(0, 1), r)];
  let h11 = (*F)[idx2(i0 + vec2<i32>(1, 1), r)];
  return mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);
}

fn sampleFieldR(F: ptr<storage, array<f32>, read>, uv: vec2<f32>, res: f32) -> f32 {
  let p = uv * res - 0.5;
  let fl = floor(p);
  let fr = p - fl;
  let i0 = vec2<i32>(fl);
  let r = i32(res);
  let h00 = (*F)[idx2(i0 + vec2<i32>(0, 0), r)];
  let h10 = (*F)[idx2(i0 + vec2<i32>(1, 0), r)];
  let h01 = (*F)[idx2(i0 + vec2<i32>(0, 1), r)];
  let h11 = (*F)[idx2(i0 + vec2<i32>(1, 1), r)];
  return mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);
}
