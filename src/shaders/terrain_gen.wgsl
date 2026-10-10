// ─────────────────────────────────────────────────────────────────────────────
//  Terrain generation — generative layers write into the scratch field, then a
//  single compositor blends them into the height field with mask + blend mode.
// ─────────────────────────────────────────────────────────────────────────────

#include "lib.wgsl"

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> LP: array<LayerParams>;
@group(0) @binding(2) var<storage, read_write> H: array<f32>;
@group(0) @binding(3) var<storage, read_write> S: array<f32>;
@group(0) @binding(4) var<storage, read_write> AUX: array<f32>;
@group(0) @binding(5) var<storage, read_write> FX: array<atomic<i32>>;
@group(0) @binding(6) var<storage, read_write> FL: array<atomic<i32>>;
@group(0) @binding(7) var<storage, read_write> TMP: array<f32>;
@group(0) @binding(8) var<storage, read_write> TMP2: array<f32>;
@group(0) @binding(9) var surf: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var<storage, read_write> IDX: array<i32>;
@group(0) @binding(11) var<storage, read_write> IDX2: array<i32>;
@group(0) @binding(12) var<storage, read_write> RED: array<f32>;

// blend modes
const BL_SET: u32 = 0u;
const BL_ADD: u32 = 1u;
const BL_SUB: u32 = 2u;
const BL_MUL: u32 = 3u;
const BL_MIN: u32 = 4u;
const BL_MAX: u32 = 5u;
const BL_AVG: u32 = 6u;
const BL_DIFF: u32 = 7u;
const BL_SCREEN: u32 = 8u;
const BL_OVERLAY: u32 = 9u;

// ── field helpers ────────────────────────────────────────────────────────────
fn res_() -> i32 { return i32(U.v0.x); }
fn inField(gid: vec3<u32>) -> bool {
  return i32(gid.x) < res_() && i32(gid.y) < res_();
}
fn at(gid: vec3<u32>) -> i32 { return i32(gid.y) * res_() + i32(gid.x); }
fn uvOf(gid: vec3<u32>) -> vec2<f32> {
  return (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) * U.v1.x;
}

/// Signed slope in [0,1] where 1 is vertical, plus the surface normal.
fn slopeNormal(uv: vec2<f32>) -> vec4<f32> {
  let r = f32(res_());
  let d = 1.0 / r;
  let hl = sampleField(&H, uv - vec2<f32>(d, 0.0), r);
  let hr = sampleField(&H, uv + vec2<f32>(d, 0.0), r);
  let hd = sampleField(&H, uv - vec2<f32>(0.0, d), r);
  let hu = sampleField(&H, uv + vec2<f32>(0.0, d), r);
  let k = U.v1.w / (2.0 / r) / U.v1.z;      // worldSize / (2*dx) * (1/heightScale)
  let gx = (hr - hl) * k;
  let gz = (hu - hd) * k;
  let n = normalize(vec3<f32>(-gx, 1.0, -gz));
  let ang = atan2(sqrt(gx * gx + gz * gz), 1.0);
  return vec4<f32>(sat(ang / (PI * 0.5)), n.x, n.y, n.z);
}

fn curvatureAt(uv: vec2<f32>) -> f32 {
  let r = f32(res_());
  let d = 1.0 / r;
  let hc = sampleField(&H, uv, r);
  let hl = sampleField(&H, uv - vec2<f32>(d, 0.0), r);
  let hr = sampleField(&H, uv + vec2<f32>(d, 0.0), r);
  let hd = sampleField(&H, uv - vec2<f32>(0.0, d), r);
  let hu = sampleField(&H, uv + vec2<f32>(0.0, d), r);
  let lap = (hl + hr + hd + hu - 4.0 * hc);
  return sat(0.5 + 0.5 * clamp(lap * 24.0, -1.0, 1.0));
}

fn auxAt(i: i32, c: i32) -> f32 { return AUX[i * 4 + c]; }

fn maskContext(uv: vec2<f32>, i: i32, lp: LayerParams) -> f32 {
  let sl = slopeNormal(uv);
  var c: MaskCtx;
  c.h = H[i];
  c.slope = sl.x;
  c.curv = curvatureAt(uv);
  c.flow = auxAt(i, 0);
  c.deposit = auxAt(i, 1);
  c.ao = auxAt(i, 3);
  // aspect: compass bearing of the downhill direction, 0..1
  c.aspect = fract(atan2(-sl.z, -sl.x) / TAU + 1.0);
  c.wxz = uv * U.v1.w;
  return evalMask(&LP[U.v0.y].m, lp.f.z, c);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Generators — all write a raw value into S
// ─────────────────────────────────────────────────────────────────────────────

@compute @workgroup_size(8, 8, 1)
fn clearField(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  H[at(gid)] = 0.0;
  S[at(gid)] = 0.0;
}

@compute @workgroup_size(8, 8, 1)
fn copyH2S(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  S[at(gid)] = H[at(gid)];
}

@compute @workgroup_size(8, 8, 1)
fn copyS2H(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  H[at(gid)] = S[at(gid)];
}

/// Fractal noise: fBm / ridged / billow / hybrid / mountain ranges.
/// a0 = (frequency, octaves, lacunarity, gain)
/// a1 = (amplitude, offset, warpAmount, warpFrequency)
/// a2 = (seed, sharpness, contrast, bias)
/// a3 = (warpOctaves, power, stretch, invert)
/// a9.x = subtype
@compute @workgroup_size(8, 8, 1)
fn genFractal(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let lp = LP[U.v0.y];
  let uv = uvOf(gid);
  let sub = lp.a[9].x;

  let seed = lp.a[2].x + f32(U.v0.z);
  let rot = lp.a[9].y;                            // domain rotation (radians)
  let cr = cos(rot); let sr = sin(rot);
  let R = mat2x2<f32>(cr, sr, -sr, cr);

  var p = R * uv * lp.a[0].x + vec2<f32>(seed * 0.731, seed * 0.317);
  let stretch = max(lp.a[3].z, 0.001);
  p = vec2<f32>(p.x / stretch, p.y * stretch);

  // domain warp
  if (lp.a[1].z != 0.0) {
    let wf = lp.a[1].w;
    let w1 = fbm2(p * wf + vec2<f32>(seed * 1.7, seed * 2.3), max(lp.a[3].x, 1.0), 2.0, 0.5).x;
    let w2 = fbm2(p * wf + vec2<f32>(seed * 5.1 + 19.3, seed * 3.7 - 7.1), max(lp.a[3].x, 1.0), 2.0, 0.5).x;
    p += vec2<f32>(w1, w2) * lp.a[1].z * lp.a[0].x;
  }

  var v: f32;
  if (sub < 0.5) {
    v = fbm2(p, lp.a[0].y, lp.a[0].z, lp.a[0].w).x;
  } else if (sub < 1.5) {
    v = ridged2(p, lp.a[0].y, lp.a[0].z, lp.a[0].w, lp.a[2].y).x;
  } else if (sub < 2.5) {
    v = billow2(p, lp.a[0].y, lp.a[0].z, lp.a[0].w).x;
  } else if (sub < 3.5) {
    // hybrid multifractal: additive detail modulated by the running sum
    var pp = p;
    var amp = 1.0;
    var sum = 0.0;
    var wgt = 0.0;
    var off = lp.a[2].y * 0.5;
    let n = i32(clamp(lp.a[0].y, 1.0, 12.0));
    for (var k = 0; k < n; k++) {
      let s = gnoise2(pp).x;
      sum += (s + off) * amp * wgt;
      wgt = sat(wgt * (s + off) * 1.4);
      amp *= lp.a[0].w;
      pp = OCT_ROT * pp * lp.a[0].z;
    }
    v = sum;
  } else {
    // mountain ranges: ridged noise stretched along one axis and re-warped
    let base = ridged2(p * 0.6, lp.a[0].y, lp.a[0].z, lp.a[0].w, lp.a[2].y).x;
    let detail = ridged2(p * 2.7 + vec2<f32>(base * 1.6), max(lp.a[0].y - 1.0, 2.0), lp.a[0].z, lp.a[0].w, lp.a[2].y).x;
    v = base * 0.75 + detail * 0.25;
  }

  v = v * 0.5 + 0.5;
  v = sat((v - 0.5) * (1.0 + lp.a[2].z) + 0.5 + lp.a[2].w);
  if (lp.a[3].w > 0.5) { v = 1.0 - v; }
  v = pow(v, max(lp.a[3].y, 0.05));
  S[i] = v * lp.a[1].x + lp.a[1].y;
}

/// Cellular / Worley: F1, F2-F1 ridges, or inverse-F1 plates.
@compute @workgroup_size(8, 8, 1)
fn genCellular(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let lp = LP[U.v0.y];
  let uv = uvOf(gid);
  let seed = lp.a[2].x + f32(U.v0.z);
  let p = uv * lp.a[0].x + vec2<f32>(seed * 0.971, seed * 0.413);
  let w = worley2(p);
  var v: f32;
  let sub = lp.a[9].x;
  if (sub < 0.5) { v = sat(1.0 - w.x); }
  else if (sub < 1.5) { v = sat(w.y - w.x); }
  else { v = sat(w.x); }
  v = sat((v - 0.5) * (1.0 + lp.a[2].z) + 0.5 + lp.a[2].w);
  S[i] = v * lp.a[1].x + lp.a[1].y;
}

/// Constant fill / offset.
@compute @workgroup_size(8, 8, 1)
fn genConst(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  S[at(gid)] = lp.a[1].x;
}

/// Impact craters: bowl + raised rim + central peak, faded by ejecta.
@compute @workgroup_size(8, 8, 1)
fn genCrater(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let lp = LP[U.v0.y];
  let uv = uvOf(gid);
  let seed = lp.a[2].x + f32(U.v0.z);
  let count = i32(clamp(lp.a[4].x, 1.0, 24.0));
  var acc = 0.0;
  for (var k = 0; k < count; k++) {
    let sk = seed + f32(k) * 17.31;
    let c = hash22(vec2<f32>(sk, sk * 1.37)) * 0.8 + 0.1;
    let rad = lp.a[0].x * (0.35 + 0.65 * hash12(vec2<f32>(sk * 2.1, sk)));
    let d = length((uv - c) * vec2<f32>(lp.a[3].z, 1.0)) / max(rad, 1e-4);
    if (d > 2.4) { continue; }
    var profile: f32;
    if (d < 0.82) {
      // bowl with a central peak
      let bowl = -1.0 + pow(sat(d / 0.82), 2.0) * 1.15;
      let peak = exp(-pow(d / 0.17, 2.0)) * 0.42;
      profile = bowl + peak;
    } else {
      // rim, decaying into an ejecta apron
      let t = (d - 0.82) / 1.58;
      profile = mix(0.16, 0.0, sat(t)) * exp(-t * 2.2);
    }
    acc += profile;
  }
  S[i] = clamp(acc, -1.0, 1.5) * lp.a[1].x + lp.a[1].y;
}

/// Wind dunes: asymmetric crests advected by a low-frequency flow field.
@compute @workgroup_size(8, 8, 1)
fn genDune(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let lp = LP[U.v0.y];
  let uv = uvOf(gid);
  let seed = lp.a[2].x + f32(U.v0.z);
  let ang = lp.a[3].z * TAU;
  let dir = vec2<f32>(cos(ang), sin(ang));
  let perp = vec2<f32>(-dir.y, dir.x);
  let warp = fbm2(uv * lp.a[1].w + vec2<f32>(seed * 0.31, seed * 0.77), 3.0, 2.0, 0.5).x;
  let s = dot(uv, dir) * lp.a[0].x + warp * lp.a[1].z;
  let t = dot(uv, perp) * lp.a[0].x * 0.35 + warp * 0.4;
  var f = fract(s / TAU);
  // asymmetric sawtooth: long windward slope, short slip face
  var v = mix(sin(s), 1.0 - 2.0 * sat(abs(f - 0.5) * 2.0), lp.a[3].y);
  v += sin(t * 2.7) * 0.06;
  v = v * 0.5 + 0.5;
  v = sat((v - 0.5) * (1.0 + lp.a[2].z) + 0.5);
  S[i] = v * lp.a[1].x + lp.a[1].y;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Compositor: blends S into H for the current layer
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn composite(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let lp = LP[U.v0.y];
  let uv = uvOf(gid);

  let m = maskContext(uv, i, lp);
  let w = sat(m * lp.a[8].x);
  if (w <= 0.0) { return; }
  let s = S[i];
  var h = H[i];
  let mode = lp.f.y;

  if (mode == BL_SET) { h = mix(h, s, w); }
  else if (mode == BL_ADD) { h = h + s * w; }
  else if (mode == BL_SUB) { h = h - s * w; }
  else if (mode == BL_MUL) { h = h * mix(1.0, s, w); }
  else if (mode == BL_MIN) { h = mix(h, min(h, s), w); }
  else if (mode == BL_MAX) { h = mix(h, max(h, s), w); }
  else if (mode == BL_AVG) { h = mix(h, (h + s) * 0.5, w); }
  else if (mode == BL_DIFF) { h = mix(h, abs(h - s), w); }
  else if (mode == BL_SCREEN) { h = mix(h, 1.0 - (1.0 - h) * (1.0 - s), w); }
  else if (mode == BL_OVERLAY) {
    let o = select(1.0 - 2.0 * (1.0 - h) * (1.0 - s), 2.0 * h * s, h < 0.5);
    h = mix(h, o, w);
  }
  H[i] = h;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Field-level utilities
// ─────────────────────────────────────────────────────────────────────────────

/// Optional island/plinth shaping: fade the borders and clamp the range.
/// a8 = (falloff, floorBias, clampLo, clampHi)
@compute @workgroup_size(8, 8, 1)
fn applyEdge(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let lp = LP[U.v0.y];
  let uv = uvOf(gid);
  let fo = lp.a[8].x;
  var h = H[i];
  if (fo > 0.0) {
    let e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    let f = sat(smoothstep(0.0, max(fo, 1e-4), e));
    h = h * f + lp.a[8].y * (1.0 - f);
  }
  H[i] = clamp(h, lp.a[8].z, lp.a[8].w);
}

@compute @workgroup_size(8, 8, 1)
fn normalizeField(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let mn = RED[0];
  let mx = RED[1];
  let lp = LP[U.v0.y];
  let lo = lp.a[8].y;
  let hi = lp.a[8].z;
  H[i] = lo + (H[i] - mn) / max(mx - mn, 1e-6) * (hi - lo);
}
