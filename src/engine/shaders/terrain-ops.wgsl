// =================================================================================================

#include "noise.wgsl"
//  terrain-ops.wgsl — one compute dispatch per layer in the TERRAIN STACK
// -------------------------------------------------------------------------------------------------
//  A terrain layer is a unary operator over a normalised height field: it reads `srcField`, writes
//  `dstField`, and the host ping-pongs the two. Iterative operators (smooth, thermal) are simply
//  dispatched N times. Hydraulic erosion is not here: it owns private state and lives in
//  erosion.wgsl.
//
//  Slot map — see packFieldOp() in terrain-stack.js. Every slot is a vec4f so the uniform block is
//  densely packed and the JavaScript writer needs no padding logic.
// -------------------------------------------------------------------------------------------------
//   p0 (u32) : op, res, seed, octaves
//   p1 (u32) : flags, blend, maskMode, iterations
//   p2 (f32) : cellMeters, heightMeters, opacity, ---
//   a  (f32) : frequency, lacunarity, gain, warpStrength
//   b  (f32) : fractType, sharpness, amplitude, offset
//   c  (f32) : warpFreq, slopeMin, slopeMax, feather
//   d  (f32) : steps, smoothness, amount, radius
//   e  (f32) : posX, posZ, radiusWorld, heightWorld
//   f  (f32) : craterRadius, craterDepth, roughness, gamma
//   m  (f32) : maskMin, maskMax, maskFeather, maskInvert
//   n  (f32) : maskNoiseScale, maskNoiseContrast, maskNoiseSeed, maskNoiseOctaves
// =================================================================================================

struct FieldOp {
  p0: vec4u,
  p1: vec4u,
  p2: vec4f,
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
  e: vec4f,
  f: vec4f,
  m: vec4f,
  n: vec4f,
};

@group(0) @binding(0) var<uniform> U: FieldOp;
@group(0) @binding(1) var<storage, read> srcField: array<f32>;
@group(0) @binding(2) var<storage, read_write> dstField: array<f32>;

const OP_FILL: u32 = 0u;
const OP_FRACTAL: u32 = 1u;
const OP_WARP: u32 = 2u;
const OP_TERRACE: u32 = 3u;
const OP_SMOOTH: u32 = 4u;
const OP_SHARPEN: u32 = 5u;
const OP_DETAIL: u32 = 6u;
const OP_THERMAL: u32 = 7u;
const OP_RIVER: u32 = 8u;
const OP_SEDIMENT: u32 = 9u;
const OP_SNOW: u32 = 10u;
const OP_LEVELS: u32 = 11u;
const OP_PLATEAU: u32 = 12u;
const OP_VOLCANO: u32 = 13u;
const OP_ISLAND: u32 = 14u;
const OP_CLIFF: u32 = 15u;

const BLEND_REPLACE: u32 = 0u;
const BLEND_ADD: u32 = 1u;
const BLEND_SUB: u32 = 2u;
const BLEND_MUL: u32 = 3u;
const BLEND_MAX: u32 = 4u;
const BLEND_MIN: u32 = 5u;
const BLEND_SCREEN: u32 = 6u;

// --- field access ---------------------------------------------------------------------------------

fn res() -> i32 { return i32(U.p0.y); }

fn hRaw(x: i32, y: i32) -> f32 {
  let r = res();
  let cx = clamp(x, 0, r - 1);
  let cy = clamp(y, 0, r - 1);
  return srcField[u32(cy * r + cx)];
}

fn hAt(x: i32, y: i32) -> f32 { return hRaw(x, y); }

// Bilinear fetch in normalised field space (used by the domain warp, which samples between texels).
fn hBilinear(fx: f32, fy: f32) -> f32 {
  let r = res();
  let x = clamp(fx, 0.0, f32(r - 1) - 1e-4);
  let y = clamp(fy, 0.0, f32(r - 1) - 1e-4);
  let x0 = i32(floor(x));
  let y0 = i32(floor(y));
  let tx = x - floor(x);
  let ty = y - floor(y);
  let h00 = hRaw(x0, y0);
  let h10 = hRaw(x0 + 1, y0);
  let h01 = hRaw(x0, y0 + 1);
  let h11 = hRaw(x0 + 1, y0 + 1);
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), ty);
}

// sin(slope angle), 0 = flat, 1 = vertical.
fn slopeAt(x: i32, y: i32) -> f32 {
  let dhx = (hRaw(x + 1, y) - hRaw(x - 1, y)) * U.p2.y / (2.0 * U.p2.x);
  let dhz = (hRaw(x, y + 1) - hRaw(x, y - 1)) * U.p2.y / (2.0 * U.p2.x);
  let g = sqrt(dhx * dhx + dhz * dhz);
  return g / sqrt(1.0 + g * g);
}

// Signed curvature: +1 convex (ridge), -1 concave (valley).
fn curvAt(x: i32, y: i32) -> f32 {
  let c = hRaw(x, y);
  let lap = (hRaw(x - 1, y) + hRaw(x + 1, y) + hRaw(x, y - 1) + hRaw(x, y + 1) - 4.0 * c);
  // Convert the discrete Laplacian into 1/m and normalise against a 250 m reference radius.
  let k = -lap * U.p2.y / (U.p2.x * U.p2.x) * 250.0;
  return clamp(k, -1.0, 1.0);
}

// Cheap 3x3 blur used by sharpen / cliff / river smoothing.
fn blurAt(x: i32, y: i32) -> f32 {
  var s = 0.0;
  var w = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let wt = select(1.0, 2.0, i == 0) * select(1.0, 2.0, j == 0);
      s += hRaw(x + i, y + j) * wt;
      w += wt;
    }
  }
  return s / w;
}

// --- mask -----------------------------------------------------------------------------------------

fn band(v: f32, lo: f32, hi: f32, feather: f32) -> f32 {
  let f = max(feather, 1e-4);
  let a = smoothstepv(lo - f, lo + f, v);
  let b = 1.0 - smoothstepv(hi - f, hi + f, v);
  return a * b;
}

fn maskAt(x: i32, y: i32) -> f32 {
  let mode = U.p1.z;
  var v = 1.0;
  var lo = U.m.x;
  var hi = U.m.y;
  if (mode == 1u) {
    v = hRaw(x, y);
  } else if (mode == 2u) {
    v = slopeAt(x, y);
  } else if (mode == 3u) {
    v = 0.5 + 0.5 * curvAt(x, y);
    lo = lo * 0.5 + 0.5;
    hi = hi * 0.5 + 0.5;
  } else if (mode == 4u) {
    let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
    let nz = fbmd2(uv * U.n.x, max(i32(U.n.w), 1), 2.0, 0.5, u32(U.n.z)).x;
    var nn = clamp(0.5 + 0.5 * nz * U.n.y, 0.0, 1.0);
    v = nn;
  } else if (mode == 5u) {
    // flow proxy: valley-ness measured as how far the cell sits below its neighbourhood
    let b = blurAt(x, y);
    v = clamp(0.5 + (b - hRaw(x, y)) * 12.0, 0.0, 1.0);
  } else if (mode == 6u) {
    let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
    v = clamp(1.0 - length(uv - vec2f(0.5)) * 2.0, 0.0, 1.0);
  } else {
    return 1.0;
  }
  var m = band(v, lo, hi, U.m.z);
  if (U.m.w > 0.5) { m = 1.0 - m; }
  return m;
}

// --- operators ------------------------------------------------------------------------------------

fn opFractal(x: i32, y: i32) -> f32 {
  let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
  let oct = max(i32(U.p0.w), 1);
  var p = uv * U.a.x + vec2f(f32(U.p0.z) * 0.0137, f32(U.p0.z) * 0.0071);
  if (U.a.w > 1e-5) {
    p = warp2(p, U.a.w, max(U.c.x, 0.001), clamp(i32(U.c.y), 2, 6), U.p0.z);
  }
  let t = i32(U.b.x);
  var v = 0.0;
  if (t == 1) {
    v = ridged2(p, oct, U.a.y, U.a.z, max(U.b.y, 0.05), U.p0.z).x * 2.0 - 1.0;
  } else if (t == 2u) {
    v = billow2(p, oct, U.a.y, U.a.z, U.p0.z).x;
  } else if (t == 3u) {
    // Voronoi plateau: cell distance sharpened into flat-topped mesas with deep clefts
    let w = worleyd2(p * 1.0, U.p0.z).x;
    v = clamp(w * 2.6 - 1.0, -1.0, 1.0);
    let d = fbmd2(p * 3.1, 4, 2.0, 0.5, U.p0.z + 61u).x;
    v = v * 0.85 + d * 0.15;
  } else {
    v = fbmd2(p, oct, U.a.y, U.a.z, U.p0.z).x;
  }
  if ((U.p1.x & 1u) != 0u) { v = -v; }
  return v * U.b.z + U.b.w;
}

fn opWarp(x: i32, y: i32) -> f32 {
  let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
  let oct = clamp(max(i32(U.p0.w), 1), 1, 6);
  let w = fbmd2(uv * U.a.x, oct, 2.0, 0.5, U.p0.z).xy;
  let r = f32(res());
  let fx = (uv.x + w.x * U.a.w * 0.25) * r - 0.5;
  let fy = (uv.y + w.y * U.a.w * 0.25) * r - 0.5;
  return hBilinear(fx, fy);
}

fn opTerrace(x: i32, y: i32) -> f32 {
  let h = hRaw(x, y);
  let steps = max(U.d.x, 1.0);
  let t = h * steps;
  let fi = floor(t);
  let fr = t - fi;
  let w = clamp(U.d.y, 0.0, 1.0) * 0.5;
  let s = select(step(0.5, fr), smoothstepv(0.5 - w, 0.5 + w, fr), w > 1e-4);
  var out = (fi + s + U.b.w * steps) / steps;
  // Keep cliffs: terracing is a sedimentary phenomenon, it should not chew through rock faces.
  let sl = slopeAt(x, y);
  let keep = 1.0 - smoothstepv(U.c.y, U.c.z, sl);
  return mix(h, out, keep);
}

fn opSmooth(x: i32, y: i32) -> f32 {
  let h = hRaw(x, y);
  var s = 0.0;
  var w = 0.0;
  let strength = clamp(U.d.z, 0.0, 1.0);
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      if (i == 0 && j == 0) {
        s += h * 4.0;
        w += 4.0;
        continue;
      }
      let wt = select(1.0, 2.0, i == 0) * select(1.0, 2.0, j == 0);
      var ww = f32(wt);
      if ((U.p1.x & 2u) != 0u) {
        // slope preserving: neighbours across a discontinuity contribute far less
        let dh = abs(hRaw(x + i, y + j) - h);
        ww = ww / (1.0 + dh * U.c.z * 60.0);
      }
      s += hRaw(x + i, y + j) * ww;
      w += ww;
    }
  }
  return mix(h, s / max(w, 1e-5), strength);
}

fn opSharpen(x: i32, y: i32) -> f32 {
  let h = hRaw(x, y);
  let b = blurAt(x, y);
  return h + (h - b) * U.d.z * 2.0;
}

fn opDetail(x: i32, y: i32) -> f32 {
  let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
  let oct = clamp(max(i32(U.p0.w), 1), 1, 8);
  let n = ridged2(uv * U.a.x, oct, U.a.y, U.a.z, 2.0, U.p0.z).x * 2.0 - 1.0;
  let sl = slopeAt(x, y);
  let m = smoothstepv(U.c.y, U.c.z, sl);
  return hRaw(x, y) + n * U.d.z * m;
}

fn opThermal(x: i32, y: i32) -> f32 {
  let h = hRaw(x, y);
  let talusT = tan(clamp(U.c.x, 0.001, 1.5));     // U.c.x holds the talus angle in radians
  let rate = clamp(U.d.z, 0.0, 1.0) * 0.5;
  var delta = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      if (i == 0 && j == 0) { continue; }
      let dist = length(vec2f(f32(i), f32(j))) * U.p2.x;   // metres
      let maxDiff = talusT * dist / max(U.p2.y, 1e-3);      // normalised height units
      let diff = h - hRaw(x + i, y + j);
      if (diff > maxDiff) {
        delta -= (diff - maxDiff) * rate * 0.125;
      } else if (diff < -maxDiff) {
        delta += (-diff - maxDiff) * rate * 0.125;
      }
    }
  }
  return h + delta;
}

fn opRiver(x: i32, y: i32) -> f32 {
  // Channel incision: deepen the places that already read as drainage, then relax the banks so the
  // cut reads as a carved valley rather than a scratched line.
  let h = hRaw(x, y);
  let b = blurAt(x, y);
  let valley = clamp((b - h) * U.c.z * 8.0, 0.0, 1.0);
  let cut = pow(valley, max(U.c.y, 0.05)) * U.d.z;
  return h - cut;
}

fn opSediment(x: i32, y: i32) -> f32 {
  let h = hRaw(x, y);
  let sl = slopeAt(x, y);
  let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
  let n = fbmd2(uv * U.a.x, 4, 2.0, 0.5, U.p0.z).x;
  let m = (1.0 - smoothstepv(U.c.y, U.c.z, sl)) * (1.0 - smoothstepv(U.b.w, U.b.w + 0.25, h));
  return h + U.d.z * m * (0.65 + 0.35 * (0.5 + 0.5 * n));
}

fn opSnow(x: i32, y: i32) -> f32 {
  let h = hRaw(x, y);
  let sl = slopeAt(x, y);
  let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
  let drift = fbmd2(uv * U.a.x, 4, 2.0, 0.5, U.p0.z).x;
  let alt = smoothstepv(U.b.w - U.c.w, U.b.w + U.c.w, h + drift * U.a.w * 0.05);
  let flat = 1.0 - smoothstepv(U.c.y, U.c.z, sl);
  return h + U.d.z * alt * flat;
}

fn opLevels(x: i32, y: i32) -> f32 {
  var t = (hRaw(x, y) - U.m.x) / max(U.m.y - U.m.x, 1e-5);
  t = clamp(t, 0.0, 1.0);
  t = pow(t, max(U.f.w, 0.01));
  t = (t - 0.5) * U.c.z + 0.5 + U.b.w;
  return clamp(U.d.y + t * (U.d.z - U.d.y), -0.5, 4.0);
}

fn opPlateau(x: i32, y: i32) -> f32 {
  let h = hRaw(x, y);
  let thr = U.b.w;
  let m = smoothstepv(thr - U.c.w, thr + U.c.w, h);
  let target = thr + (h - thr) * clamp(U.d.y, 0.0, 1.0);
  return mix(h, target, m);
}

fn opVolcano(x: i32, y: i32) -> f32 {
  let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
  let c = vec2f(U.e.x, U.e.y);
  var d = length(uv - c);
  // break the perfect circle with low frequency noise on the radius
  let angN = fbmd2(uv * 3.0 + c, 4, 2.0, 0.5, U.p0.z).x;
  d = d * (1.0 + angN * U.f.z * 0.35);
  let rad = max(U.e.z, 1e-3);
  let cone = pow(clamp(1.0 - d / rad, 0.0, 1.0), max(U.c.y, 0.2));
  var out = hRaw(x, y) + cone * U.e.w;
  // caldera
  let cr = max(U.f.x, 1e-4);
  let bowl = pow(clamp(1.0 - d / cr, 0.0, 1.0), 1.7);
  out -= bowl * U.f.y;
  // flank roughness so the cone is not a mathematical solid
  let flank = fbmd2(uv * U.a.x, max(i32(U.p0.w), 1), U.a.y, U.a.z, U.p0.z + 7u).x;
  out += flank * U.f.z * cone * 0.35;
  return out;
}

fn opIsland(x: i32, y: i32) -> f32 {
  let uv = (vec2f(f32(x), f32(y)) + 0.5) / f32(res());
  let centre = vec2f(U.e.x, U.e.y);
  var d = length((uv - centre) * vec2f(1.0, 1.0)) * 2.0;
  let warpN = fbmd2(uv * U.a.x, 4, 2.0, 0.5, U.p0.z).x;
  d += warpN * U.a.w * 0.25;
  let rad = clamp(U.e.z, 0.01, 2.0);
  var m = 1.0 - smoothstepv(rad - max(U.c.w, 1e-3), rad, d);
  if ((U.p1.x & 1u) != 0u) { m = 1.0 - m; }
  return hRaw(x, y) * m;
}

fn opCliff(x: i32, y: i32) -> f32 {
  let h = hRaw(x, y);
  let b = blurAt(x, y);
  let sl = slopeAt(x, y);
  let m = smoothstepv(U.c.y, U.c.z, sl);
  return h + (h - b) * U.d.z * 4.0 * m;
}

fn opFill(x: i32, y: i32) -> f32 {
  return U.b.w;
}

// --- composite ------------------------------------------------------------------------------------

fn applyBlend(src: f32, r: f32, w: f32, mode: u32) -> f32 {
  if (mode == BLEND_ADD) { return src + r * w; }
  if (mode == BLEND_SUB) { return src - r * w; }
  if (mode == BLEND_MUL) { return src * mix(1.0, r, w); }
  if (mode == BLEND_MAX) { return mix(src, max(src, r), w); }
  if (mode == BLEND_MIN) { return mix(src, min(src, r), w); }
  if (mode == BLEND_SCREEN) { return mix(src, 1.0 - (1.0 - src) * (1.0 - clamp(r, 0.0, 1.0)), w); }
  return mix(src, r, w);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let src = hRaw(x, y);

  var out = src;
  let op = U.p0.x;

  if (op == OP_FRACTAL) { out = opFractal(x, y); }
  else if (op == OP_WARP) { out = opWarp(x, y); }
  else if (op == OP_TERRACE) { out = opTerrace(x, y); }
  else if (op == OP_SMOOTH) { out = opSmooth(x, y); }
  else if (op == OP_SHARPEN) { out = opSharpen(x, y); }
  else if (op == OP_DETAIL) { out = opDetail(x, y); }
  else if (op == OP_THERMAL) { out = opThermal(x, y); }
  else if (op == OP_RIVER) { out = opRiver(x, y); }
  else if (op == OP_SEDIMENT) { out = opSediment(x, y); }
  else if (op == OP_SNOW) { out = opSnow(x, y); }
  else if (op == OP_LEVELS) { out = opLevels(x, y); }
  else if (op == OP_PLATEAU) { out = opPlateau(x, y); }
  else if (op == OP_VOLCANO) { out = opVolcano(x, y); }
  else if (op == OP_ISLAND) { out = opIsland(x, y); }
  else if (op == OP_CLIFF) { out = opCliff(x, y); }
  else { out = opFill(x, y); }

  var w = 1.0;
  if (U.p1.z != 0u) { w = maskAt(x, y); }
  w = clamp(w * U.p2.z, 0.0, 1.0);

  let finalV = applyBlend(src, out, w, U.p1.y);
  dstField[u32(y * r + x)] = clamp(finalV, -0.5, 4.0);
}
