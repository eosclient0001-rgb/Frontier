/* ═══════════════════════════════════════════════════════════════
   WGSL shader sources for Terrain Forge.
   All heightfields are normalized [0,1] in r32float textures;
   world height is applied at render time (heightScale).
   ═══════════════════════════════════════════════════════════════ */

export const PI = Math.PI;

/* ── Shared WGSL: hashing, simplex, fBm, ridged, billow, worley ── */
export const NOISE_LIB = /* wgsl */`
fn hash21(p: vec2f) -> f32 {
  var p3 = fract(p.xyx * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
fn mod289(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute3(x: vec3f) -> vec3f { return mod289(((x * 34.0) + 1.0) * x); }
fn snoise(p: vec2f) -> f32 {
  let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  let i0 = floor(p + dot(p, C.yy));
  let x0 = p - i0 + dot(i0, C.xx);
  let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
  var x12 = vec4f(x0.x, x0.y, x0.x, x0.y) + C.xxzz;
  x12 = vec4f(x12.x - i1.x, x12.y - i1.y, x12.z, x12.w);
  let im = i0 - floor(i0 * (1.0 / 289.0)) * 289.0;
  let pp = permute3(permute3(vec3f(0.0, i1.y, 1.0) + im.y) + vec3f(0.0, i1.x, 1.0) + im.x);
  let m = max(0.5 - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
  let m2 = m * m;
  let m4 = m2 * m2;
  let xv = 2.0 * fract(pp * C.www) - 1.0;
  let h = abs(xv) - 0.5;
  let ox = floor(xv + 0.5);
  let a0 = xv - ox;
  let mn = m4 * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
  let gx = a0.x * x0.x + h.x * x0.y;
  let gy = a0.y * x12.x + h.y * x12.y;
  let gz = a0.z * x12.z + h.z * x12.w;
  return 130.0 * dot(mn, vec3f(gx, gy, gz));
}
fn fbm(p: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  var amp = 0.5;
  var freq = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < octaves; i++) {
    sum += amp * snoise(p * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / max(norm, 1e-5);
}
fn ridged(p: vec2f, octaves: i32, sharpness: f32) -> f32 {
  var amp = 0.5;
  var freq = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  var prev = 1.0;
  for (var i = 0; i < octaves; i++) {
    var n = 1.0 - abs(snoise(p * freq));
    n = n * n;
    n *= prev;
    prev = clamp(n, 0.0, 1.0);
    sum += amp * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return pow(clamp(sum / max(norm, 1e-5), 0.0, 1.0), 1.0 / max(sharpness, 0.4));
}
fn worley(p: vec2f, jitter: f32) -> vec2f {
  let n = floor(p);
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = mix(vec2f(0.5), hash22(n + g), clamp(jitter, 0.0, 1.0));
      let r = g - f + o;
      let d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec2f(sqrt(f1), sqrt(f2));
}
fn sampleHeightBilinear(src: texture_2d<f32>, dims: vec2f, uv: vec2f) -> f32 {
  let c = clamp(uv, vec2f(0.0), vec2f(1.0)) * dims - vec2f(0.5);
  let base = floor(c);
  let t = c - base;
  let mx = vec2i(dims) - vec2i(1);
  let h00 = textureLoad(src, clamp(vec2i(base), vec2i(0), mx), 0).r;
  let h10 = textureLoad(src, clamp(vec2i(base) + vec2i(1, 0), vec2i(0), mx), 0).r;
  let h01 = textureLoad(src, clamp(vec2i(base) + vec2i(0, 1), vec2i(0), mx), 0).r;
  let h11 = textureLoad(src, clamp(vec2i(base) + vec2i(1, 1), vec2i(0), mx), 0).r;
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}
fn applyBlend(base: f32, layer: f32, w: f32, mode: u32) -> f32 {
  let weight = clamp(w, 0.0, 1.0);
  switch mode {
    case 1u: { return base + layer * weight; }                          // add
    case 2u: { return base - layer * weight; }                          // subtract
    case 3u: { return base * mix(1.0, layer, weight); }                 // multiply
    case 4u: { return max(base, mix(0.0, layer, weight)); }             // max
    case 5u: { return min(base, mix(1.0, layer, weight)); }             // min
    case 6u: { return 1.0 - (1.0 - base) * (1.0 - layer * weight); }    // screen
    default: { return mix(base, layer, weight); }                       // mix
  }
}
`;

/* ── Layer-step evaluation: one compute dispatch per stack layer ── */
export const LAYER_EVAL = /* wgsl */`
${'' /* noise lib injected by engine */}
struct StepU {
  res: vec2f,
  worldSize: f32,
  heightScale: f32,
  seed: f32,
  weight: f32,
  blend: u32,
  type: u32,
  sw: vec4f,
  p: array<vec4f, 8>,
};
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> u: StepU;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(u.res);
  if (gid.x >= u32(dims.x) || gid.y >= u32(dims.y)) { return; }
  let coord = vec2i(gid.xy);
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / u.res;
  let base = textureLoad(src, coord, 0).r;
  var h = base;
  let seedOff = vec2f(hash21(vec2f(u.seed, 1.7)) * 431.0, hash21(vec2f(u.seed, 9.1)) * 431.0);

  switch u.type {
    case 0u: { // ── mountain: ridged multifractal ──
      let scale = u.p[0].x;
      let oct = i32(u.p[0].y);
      let sharp = u.p[0].z;
      let warp = u.p[0].w;
      let height = u.p[1].x;
      var q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      if (u.sw.y > 0.5 && warp > 0.001) {
        let w1 = fbm(q * 0.32 + vec2f(11.3, 3.7), 3, 2.0, 0.5);
        let w2 = fbm(q * 0.32 + vec2f(47.9, 21.1), 3, 2.0, 0.5);
        q += vec2f(w1, w2) * warp * 1.6;
      }
      var g = ridged(q, oct, sharp);
      if (u.sw.x < 0.5) { g = clamp(fbm(q, oct, 2.0, 0.5) * 0.5 + 0.5, 0.0, 1.0); }
      h = applyBlend(h, g * height, u.weight, u.blend);
    }
    case 1u: { // ── hills: billowy fbm ──
      let scale = u.p[0].x;
      let oct = i32(u.p[0].y);
      let height = u.p[0].z;
      let billow = u.p[0].w;
      let q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      var amp = 0.5;
      var freq = 1.0;
      var sum = 0.0;
      var norm = 0.0;
      for (var i = 0; i < oct; i++) {
        var n = snoise(q * freq);
        if (u.sw.x > 0.5) { n = mix(n, 1.0 - abs(n) * 2.0, billow); }
        sum += amp * n;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
      }
      h = applyBlend(h, clamp(sum / max(norm, 1e-5) * 0.5 + 0.5, 0.0, 1.0) * height, u.weight, u.blend);
    }
    case 2u: { // ── dunes ──
      let scale = u.p[0].x;
      let height = u.p[0].y;
      let asym = u.p[0].z;
      let warp = u.p[0].w;
      let ang = u.p[1].x;
      var q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      let ca = cos(ang);
      let sa = sin(ang);
      q = vec2f(q.x * ca - q.y * sa, q.x * sa + q.y * ca);
      if (u.sw.x > 0.5 && warp > 0.001) {
        q.x += fbm(q * vec2f(0.35, 0.9), 3, 2.0, 0.5) * warp * 2.2;
      }
      let n = snoise(q);
      let shaped = n * (1.0 - asym) + pow(clamp(n * 0.5 + 0.5, 0.0, 1.0), 2.6) * asym * 2.0 - asym * 0.42;
      let d = pow(clamp(1.0 - abs(shaped), 0.0, 1.0), 1.7);
      h = applyBlend(h, d * height, u.weight, u.blend);
    }
    case 3u: { // ── canyon: inverted ridged channels ──
      let scale = u.p[0].x;
      let depth = u.p[0].y;
      let steep = u.p[0].z;
      let meander = u.p[0].w;
      var q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      if (u.sw.x > 0.5 && meander > 0.001) {
        q += vec2f(fbm(q * 0.5 + vec2f(3.1, 8.8), 3, 2.0, 0.5), fbm(q * 0.5 + vec2f(17.3, 2.9), 3, 2.0, 0.5)) * meander * 1.4;
      }
      let n = ridged(q, 5, steep);
      let ch = pow(clamp(1.0 - n, 0.0, 1.0), 1.35);
      h = applyBlend(h, ch * depth, u.weight, u.blend);
    }
    case 4u: { // ── volcano ──
      let radius = u.p[0].x;
      let height = u.p[0].y;
      let crater = u.p[0].z;
      let rim = u.p[0].w;
      let rough = u.p[1].x;
      let d = length(uv - vec2f(0.5)) * 2.0;
      var cone = clamp(1.0 - d / max(radius, 1e-3), 0.0, 1.0);
      cone = pow(cone, 1.35);
      let cd = clamp(1.0 - d / max(radius * 0.34, 1e-3), 0.0, 1.0);
      cone -= pow(cd, 1.6) * crater;
      let ring = exp(-pow((d - radius * 0.34) / max(radius * 0.16, 1e-3), 2.0));
      cone += ring * rim * 0.14;
      if (u.sw.x > 0.5) {
        let q = uv * (u.worldSize / 620.0) + seedOff;
        cone *= 1.0 + fbm(q, 5, 2.0, 0.5) * rough * 0.9;
      }
      h = applyBlend(h, clamp(cone, 0.0, 1.0) * height, u.weight, u.blend);
    }
    case 5u: { // ── plateau / mesa ──
      let scale = u.p[0].x;
      let height = u.p[0].y;
      let steps = max(2.0, u.p[0].z);
      let edge = u.p[0].w;
      let q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      let n = clamp(fbm(q, 6, 2.0, 0.5) * 0.5 + 0.5, 0.0, 1.0);
      let x = n * steps;
      let f = fract(x);
      let t = (floor(x) + pow(smoothstep(0.0, 1.0, f), edge)) / steps;
      h = applyBlend(h, t * height, u.weight, u.blend);
    }
    case 6u: { // ── craters ──
      let scale = u.p[0].x;
      let depth = u.p[0].y;
      let rim = u.p[0].z;
      let q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      let w = worley(q, 1.0);
      let bowl = 1.0 - smoothstep(0.0, 0.55, w.x);
      let ring = exp(-pow((w.x - 0.55) / 0.22, 2.0));
      let c = 1.0 - bowl * depth + ring * rim * 0.5;
      h = applyBlend(h, clamp(c, 0.0, 1.0), u.weight, u.blend);
    }
    case 7u: { // ── archipelago ──
      let scale = u.p[0].x;
      let height = u.p[0].y;
      let falloff = u.p[0].z;
      let warp = u.p[0].w;
      var q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      if (u.sw.x > 0.5 && warp > 0.001) {
        q += vec2f(fbm(q * 0.5 + vec2f(2.2, 5.4), 3, 2.0, 0.5), fbm(q * 0.5 + vec2f(9.7, 1.3), 3, 2.0, 0.5)) * warp * 1.5;
      }
      let w = worley(q, 1.0);
      let n = clamp(fbm(q * 1.3, 5, 2.0, 0.5) * 0.5 + 0.5, 0.0, 1.0);
      let isle = pow(clamp(1.0 - w.x, 0.0, 1.0), falloff) * (0.55 + 0.45 * n);
      h = applyBlend(h, isle * height, u.weight, u.blend);
    }
    case 8u: { // ── perlin fbm ──
      let scale = u.p[0].x;
      let oct = i32(u.p[0].y);
      let lac = u.p[0].z;
      let gain = u.p[0].w;
      let height = u.p[1].x;
      let q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      let n = clamp(fbm(q, oct, lac, gain) * 0.5 + 0.5, 0.0, 1.0);
      h = applyBlend(h, n * height, u.weight, u.blend);
    }
    case 9u: { // ── worley cells ──
      let scale = u.p[0].x;
      let height = u.p[0].y;
      let jitter = u.p[0].z;
      let mode = u.p[0].w;
      let q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      let w = worley(q, jitter);
      var v = w.x;
      if (mode > 1.5) { v = w.y - w.x; }
      else if (mode > 0.5) { v = w.y; }
      h = applyBlend(h, clamp(v, 0.0, 1.0) * height, u.weight, u.blend);
    }
    case 10u: { // ── gradient ramp ──
      let height = u.p[0].x;
      let ang = u.p[0].y;
      let shape = u.p[0].z;
      var v = 0.0;
      if (shape > 1.5) {
        v = clamp(1.0 - length(uv - vec2f(0.5)) * 2.0, 0.0, 1.0);
      } else if (shape > 0.5) {
        v = pow(clamp(1.0 - length(uv - vec2f(0.5)) * 2.0, 0.0, 1.0), 2.0);
      } else {
        let d = vec2f(cos(ang), sin(ang));
        v = clamp(dot(uv - vec2f(0.5), d) + 0.5, 0.0, 1.0);
      }
      h = applyBlend(h, v * height, u.weight, u.blend);
    }
    case 11u: { // ── constant ──
      h = applyBlend(h, u.p[0].x, u.weight, u.blend);
    }
    case 12u: { // ── domain warp ──
      let strength = u.p[0].x;
      let scale = u.p[0].y;
      let iters = max(1, i32(u.p[0].z));
      var q = uv;
      for (var i = 0; i < iters; i++) {
        let fi = f32(i) * 1.7;
        let wx = fbm(uv * (u.worldSize / max(scale, 1.0)) + vec2f(fi, 0.0) + seedOff, 3, 2.0, 0.5);
        let wy = fbm(uv * (u.worldSize / max(scale, 1.0)) + vec2f(0.0, fi) + seedOff + vec2f(19.7), 3, 2.0, 0.5);
        q += vec2f(wx, wy) * strength * 0.05 / f32(iters);
      }
      h = sampleHeightBilinear(src, u.res, q);
    }
    case 14u: { // ── smooth ──
      let r = max(1, i32(u.p[0].x));
      var sum = 0.0;
      var wsum = 0.0;
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          let c = clamp(coord + vec2i(dx, dy), vec2i(0), dims - vec2i(1));
          sum += textureLoad(src, c, 0).r;
          wsum += 1.0;
        }
      }
      h = applyBlend(h, sum / wsum, u.weight, u.blend);
    }
    case 15u: { // ── terrace ──
      let steps = max(2.0, u.p[0].x);
      let blend = u.p[0].y;
      let offset = u.p[0].z;
      let t = clamp(base, 0.0, 1.0);
      let x = t * steps + offset;
      let f = fract(x);
      let tread = (floor(x) + mix(f, smoothstep(0.0, 1.0, f), blend)) / steps;
      h = applyBlend(h, clamp(tread, 0.0, 1.0), u.weight, u.blend);
    }
    case 16u: { // ── levels ──
      let inLow = u.p[0].x;
      let inHigh = u.p[0].y;
      let outLow = u.p[0].z;
      let outHigh = u.p[0].w;
      let gamma = u.p[1].x;
      let t = clamp((base - inLow) / max(inHigh - inLow, 1e-4), 0.0, 1.0);
      let g = pow(t, max(gamma, 0.05));
      h = applyBlend(h, mix(outLow, outHigh, g), u.weight, u.blend);
    }
    case 17u: { // ── clamp ──
      h = applyBlend(h, clamp(base, u.p[0].x, u.p[0].y), u.weight, u.blend);
    }
    case 18u: { // ── detail noise ──
      let amount = u.p[0].x;
      let scale = u.p[0].y;
      let oct = i32(u.p[0].z);
      let rm = u.p[0].w;
      let q = uv * (u.worldSize / max(scale, 1.0)) + seedOff;
      var n = clamp(fbm(q, oct, 2.0, 0.5) * 0.5 + 0.5, 0.0, 1.0);
      if (u.sw.x > 0.5) {
        let r = ridged(q, oct, 2.0);
        n = mix(n, r, rm);
      }
      h = base + (n - 0.5) * 2.0 * amount * clamp(u.weight, 0.0, 1.0);
    }
    case 19u: { // ── slant ──
      h = base + (uv.x - 0.5) * u.p[0].x + (uv.y - 0.5) * u.p[0].y;
    }
    case 20u: { // ── curvature flow ──
      let amount = u.p[0].x;
      let mode = u.p[0].y;
      let hL = textureLoad(src, clamp(coord - vec2i(1, 0), vec2i(0), dims - vec2i(1)), 0).r;
      let hR = textureLoad(src, clamp(coord + vec2i(1, 0), vec2i(0), dims - vec2i(1)), 0).r;
      let hD = textureLoad(src, clamp(coord - vec2i(0, 1), vec2i(0), dims - vec2i(1)), 0).r;
      let hU = textureLoad(src, clamp(coord + vec2i(0, 1), vec2i(0), dims - vec2i(1)), 0).r;
      let lap = (hL + hR + hU + hD) * 0.25 - base;
      h = base - lap * amount * select(1.0, -1.0, mode > 0.5);
    }
    default: {}
  }
  textureStore(dst, coord, vec4f(h, 0.0, 0.0, 1.0));
}
`;

/* ── Hydraulic erosion: virtual pipes (Mei et al. 2007) ── */
export const EROSION_COMMON = /* wgsl */`
struct ErosionU {
  res: vec2f,
  cell: f32,
  heightScale: f32,
  dt: f32,
  rain: f32,
  evap: f32,
  kc: f32,
  ks: f32,
  kcap: f32,
  seed: f32,
  hardnessOn: f32,
  hardnessScale: f32,
  hardnessContrast: f32,
  pad0: f32,
  pad1: f32,
};
`;

export const EROSION_FLUX = /* wgsl */`
${EROSION_COMMON}
@group(0) @binding(0) var hTex: texture_2d<f32>;
@group(0) @binding(1) var wTex: texture_2d<f32>;
@group(0) @binding(2) var fTex: texture_2d<f32>;
@group(0) @binding(3) var fDst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var<uniform> u: ErosionU;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(u.res);
  if (gid.x >= u32(dims.x) || gid.y >= u32(dims.y)) { return; }
  let c = vec2i(gid.xy);
  let h = textureLoad(hTex, c, 0).r;
  let w = textureLoad(wTex, c, 0).r;
  let b = h + w;
  let inside = vec2f(f32(c.x) > 0.0 && f32(c.x) < u.res.x - 1.0, f32(c.y) > 0.0 && f32(c.y) < u.res.y - 1.0);
  var nb = vec4f(b);
  if (inside.x > 0.5) {
    nb.x = textureLoad(hTex, c - vec2i(1, 0), 0).r + textureLoad(wTex, c - vec2i(1, 0), 0).r;
    nb.y = textureLoad(hTex, c + vec2i(1, 0), 0).r + textureLoad(wTex, c + vec2i(1, 0), 0).r;
  }
  if (inside.y > 0.5) {
    nb.z = textureLoad(hTex, c - vec2i(0, 1), 0).r + textureLoad(wTex, c - vec2i(0, 1), 0).r;
    nb.w = textureLoad(hTex, c + vec2i(0, 1), 0).r + textureLoad(wTex, c + vec2i(0, 1), 0).r;
  }
  var f = textureLoad(fTex, c, 0);
  let g = 9.0;
  let dh = vec4f(b - nb.x, b - nb.y, b - nb.z, b - nb.w);
  var out = max(vec4f(0.0), f + u.dt * g * dh);
  let sum = out.x + out.y + out.z + out.w;
  if (sum > 1e-6 && sum > w) { out *= w / sum; }
  textureStore(fDst, c, out);
}
`;

export const EROSION_UPDATE = /* wgsl */`
${EROSION_COMMON}
@group(0) @binding(0) var hTex: texture_2d<f32>;
@group(0) @binding(1) var wTex: texture_2d<f32>;
@group(0) @binding(2) var sTex: texture_2d<f32>;
@group(0) @binding(3) var fTex: texture_2d<f32>;
@group(0) @binding(4) var hardTex: texture_2d<f32>;
@group(0) @binding(5) var hDst: texture_storage_2d<r32float, write>;
@group(0) @binding(6) var wDst: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var sDst: texture_storage_2d<r32float, write>;
@group(0) @binding(8) var<uniform> u: ErosionU;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(u.res);
  if (gid.x >= u32(dims.x) || gid.y >= u32(dims.y)) { return; }
  let c = vec2i(gid.xy);
  let h = textureLoad(hTex, c, 0).r;
  var w = textureLoad(wTex, c, 0).r;
  var s = textureLoad(sTex, c, 0).r;
  let f = textureLoad(fTex, c, 0);
  // inflow from neighbours' outward fluxes (they point at us)
  var inSum = 0.0;
  if (c.x > 0) { inSum += textureLoad(fTex, c - vec2i(1, 0), 0).y; }
  if (c.x < dims.x - 1) { inSum += textureLoad(fTex, c + vec2i(1, 0), 0).x; }
  if (c.y > 0) { inSum += textureLoad(fTex, c - vec2i(0, 1), 0).w; }
  if (c.y < dims.y - 1) { inSum += textureLoad(fTex, c + vec2i(0, 1), 0).z; }
  let outSum = f.x + f.y + f.z + f.w;
  w = w + u.dt * (u.rain * 0.012 - u.evap * w) + inSum - outSum;
  w = clamp(w, 0.0, 0.08);
  // velocity from flux imbalance
  let v = vec2f(f.y - f.x, f.w - f.z) * 4.0;
  let speed = length(v);
  let cap = u.kcap * speed * (0.25 + speed * 6.0);
  if (w > 1e-5) {
    if (s > cap) {
      let dep = u.ks * (s - cap);
      s -= dep;
      h = h + dep;
    } else {
      var hard = 1.0;
      if (u.hardnessOn > 0.5) { hard = textureLoad(hardTex, c, 0).r; }
      let ero = u.kc * (cap - s) * hard;
      s += ero;
      h -= ero;
    }
  } else {
    let dep = u.ks * s;
    h += dep;
    s -= dep;
  }
  h = clamp(h, 0.0, 1.0);
  s = max(s, 0.0);
  textureStore(hDst, c, vec4f(h, 0.0, 0.0, 1.0));
  textureStore(wDst, c, vec4f(w, 0.0, 0.0, 1.0));
  textureStore(sDst, c, vec4f(s, 0.0, 0.0, 1.0));
}
`;

export const EROSION_HARDNESS = /* wgsl */`
${NOISE_LIB}
struct HardU {
  res: vec2f,
  worldSize: f32,
  scale: f32,
  contrast: f32,
  seed: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};
@group(0) @binding(0) var hTex: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> u: HardU;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(u.res);
  if (gid.x >= u32(dims.x) || gid.y >= u32(dims.y)) { return; }
  let c = vec2i(gid.xy);
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / u.res;
  let h = textureLoad(hTex, c, 0).r;
  let q = uv * (u.worldSize / max(u.scale, 1.0)) + vec2f(u.seed * 0.013, u.seed * 0.007);
  let warp = vec2f(fbm(q * 0.6 + 3.3, 3, 2.0, 0.5), fbm(q * 0.6 + 9.9, 3, 2.0, 0.5)) * 0.6;
  let n = clamp(fbm(q + warp, 4, 2.1, 0.55) * 0.5 + 0.5, 0.0, 1.0);
  let strata = 0.5 + 0.5 * sin(h * 34.0 + n * 5.0);
  let hard = mix(1.0, mix(n, strata, 0.45), u.contrast);
  textureStore(dst, c, vec4f(clamp(hard, 0.06, 1.0), 0.0, 0.0, 1.0));
}
`;

export const EROSION_THERMAL = /* wgsl */`
struct TherU {
  res: vec2f,
  talus: f32,
  rate: f32,
  pad0: f32,
};
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> u: TherU;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(u.res);
  if (gid.x >= u32(dims.x) || gid.y >= u32(dims.y)) { return; }
  let c = vec2i(gid.xy);
  let h = textureLoad(src, c, 0).r;
  var delta = 0.0;
  let offs = array<vec2i, 4>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));
  for (var i = 0; i < 4; i++) {
    let nc = clamp(c + offs[i], vec2i(0), dims - vec2i(1));
    if (nc.x == c.x && nc.y == c.y) { continue; }
    let hn = textureLoad(src, nc, 0).r;
    let diff = (h - hn) - u.talus;
    if (diff > 0.0) { delta -= diff * u.rate * 0.25; }
  }
  textureStore(dst, c, vec4f(clamp(h + delta, 0.0, 1.0), 0.0, 0.0, 1.0));
}
`;

export const EROSION_FLOW = /* wgsl */`
struct FlowU {
  res: vec2f,
  scale: f32,
  pad0: f32,
  pad1: f32,
};
@group(0) @binding(0) var fTex: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r8unorm, write>;
@group(0) @binding(2) var<uniform> u: FlowU;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(u.res);
  if (gid.x >= u32(dims.x) || gid.y >= u32(dims.y)) { return; }
  let c = vec2i(gid.xy);
  let f = textureLoad(fTex, c, 0);
  let total = f.x + f.y + f.z + f.w;
  let flow = clamp(total * u.scale, 0.0, 1.0);
  textureStore(dst, c, vec4f(flow, 0.0, 0.0, 1.0));
}
`;

/* ── Copy / clear helpers ── */
export const COPY_TEX = /* wgsl */`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  textureStore(dst, vec2i(gid.xy), textureLoad(src, vec2i(gid.xy), 0));
}
`;

export const CLEAR_TEX = /* wgsl */`
struct ClearU { value: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(0) var dst: texture_storage_2d<r32float, write>;
@group(0) @binding(1) var<uniform> u: ClearU;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  textureStore(dst, vec2i(gid.xy), vec4f(u.value, 0.0, 0.0, 1.0));
}
`;

export const CLEAR_RGBA_TEX = /* wgsl */`
struct ClearV { value: vec4f };
@group(0) @binding(0) var dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var<uniform> u: ClearV;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  textureStore(dst, vec2i(gid.xy), u.value);
}
`;

export const CLEAR_R8_TEX = /* wgsl */`
struct ClearR8 { value: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(0) var dst: texture_storage_2d<r8unorm, write>;
@group(0) @binding(1) var<uniform> u: ClearR8;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  textureStore(dst, vec2i(gid.xy), vec4f(u.value, 0.0, 0.0, 1.0));
}
`;

/* ── Ambient occlusion bake (horizon-based) ── */
export const AO_BAKE = /* wgsl */`
struct AoU {
  res: vec2f,
  worldPerTexel: f32,
  heightScale: f32,
  strength: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};
@group(0) @binding(0) var hTex: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r8unorm, write>;
@group(0) @binding(2) var<uniform> u: AoU;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(u.res);
  if (gid.x >= u32(dims.x) || gid.y >= u32(dims.y)) { return; }
  let c = vec2i(gid.xy);
  let h = textureLoad(hTex, c, 0).r;
  var ao = 0.0;
  var wsum = 0.0;
  let dirs = 8;
  let steps = 6;
  for (var d = 0; d < dirs; d++) {
    let a = (f32(d) / f32(dirs)) * 6.2831853 + 0.7;
    let dir = vec2f(cos(a), sin(a));
    var maxSlope = 0.0;
    for (var s = 1; s <= steps; s++) {
      let fs = f32(s);
      let sc = c + vec2i(dir * fs * 1.6);
      let cc = clamp(sc, vec2i(0), dims - vec2i(1));
      let hn = textureLoad(hTex, cc, 0).r;
      let dist = length(vec2f(cc - c)) * u.worldPerTexel;
      let slope = (hn - h) * u.heightScale / max(dist, 1e-3);
      maxSlope = max(maxSlope, slope);
    }
    ao += clamp(1.0 - maxSlope * u.strength, 0.0, 1.0) * (1.0 - maxSlope * 0.5);
    wsum += 1.0;
  }
  let occ = clamp(ao / max(wsum, 1e-3), 0.0, 1.0);
  let mixed = mix(1.0, occ, 0.85);
  textureStore(dst, c, vec4f(mixed, 0.0, 0.0, 1.0));
}
`;

/* ── Texture splat bake: evaluates the texture layer stack ── */
export const SPLAT_BAKE = /* wgsl */`
${NOISE_LIB}
// Texture layers are packed as 3 x vec4f per layer (24 vec4f total) so the
// uniform stride is an unambiguous 16 bytes in every implementation.
struct SplatU {
  res: vec2f,
  worldSize: f32,
  heightScale: f32,
  worldPerTexel: f32,
  count: u32,
  pad0: u32,
  pad1: u32,
  layers: array<vec4f, 24>,
};
struct TexU {
  weight: f32,
  blend: u32,
  hMin: f32,
  hMax: f32,
  sMin: f32,
  sMax: f32,
  noiseAmount: f32,
  noiseScale: f32,
  noiseContrast: f32,
  flowAmount: f32,
  aoMin: f32,
  seed: f32,
};
fn texLayer(i: u32) -> TexU {
  var L: TexU;
  let v0 = u.layers[i * 3u + 0u];
  let v1 = u.layers[i * 3u + 1u];
  let v2 = u.layers[i * 3u + 2u];
  L.weight = v0.x; L.blend = u32(v0.y); L.hMin = v0.z; L.hMax = v0.w;
  L.sMin = v1.x; L.sMax = v1.y; L.noiseAmount = v1.z; L.noiseScale = v1.w;
  L.noiseContrast = v2.x; L.flowAmount = v2.y; L.aoMin = v2.z; L.seed = v2.w;
  return L;
}
@group(0) @binding(0) var hTex: texture_2d<f32>;
@group(0) @binding(1) var aoTex: texture_2d<f32>;
@group(0) @binding(2) var flowTex: texture_2d<f32>;
@group(0) @binding(3) var dstA: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var dstB: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var<uniform> u: SplatU;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(u.res);
  if (gid.x >= u32(dims.x) || gid.y >= u32(dims.y)) { return; }
  let c = vec2i(gid.xy);
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / u.res;
  let h = textureLoad(hTex, c, 0).r;
  let ao = textureLoad(aoTex, c, 0).r;
  let flow = textureLoad(flowTex, c, 0).r;
  // slope from central differences
  let hL = textureLoad(hTex, clamp(c - vec2i(1, 0), vec2i(0), dims - vec2i(1)), 0).r;
  let hR = textureLoad(hTex, clamp(c + vec2i(1, 0), vec2i(0), dims - vec2i(1)), 0).r;
  let hD = textureLoad(hTex, clamp(c - vec2i(0, 1), vec2i(0), dims - vec2i(1)), 0).r;
  let hU = textureLoad(hTex, clamp(c + vec2i(0, 1), vec2i(0), dims - vec2i(1)), 0).r;
  let dh = vec2f(hR - hL, hU - hD) * u.heightScale / max(u.worldPerTexel, 1e-3);
  let slopeDeg = atan(length(dh)) * 57.2957795;

  var w = array<f32, 8>();
  for (var i = 0; i < 8; i++) {
    if (u32(i) >= u.count) { w[i] = 0.0; continue; }
    let L = texLayer(u32(i));
    let hs = 0.06;
    var weight = clamp(L.weight, 0.0, 1.0);
    let hm = smoothstep(L.hMin - hs, L.hMin + hs, h) * (1.0 - smoothstep(L.hMax - hs, L.hMax + hs, h));
    weight *= mix(1.0, hm, 0.92);
    let sm = smoothstep(L.sMin - 4.0, L.sMin + 4.0, slopeDeg) * (1.0 - smoothstep(L.sMax - 5.0, L.sMax + 5.0, slopeDeg));
    weight *= mix(1.0, sm, 0.92);
    if (L.noiseAmount > 0.001) {
      let q = uv * (u.worldSize / max(L.noiseScale, 1.0)) + vec2f(L.seed * 0.017, L.seed * 0.011);
      let n = clamp(fbm(q, 4, 2.0, 0.5) * 0.5 + 0.5, 0.0, 1.0);
      let nMask = smoothstep(0.5 - L.noiseContrast * 0.5, 0.5 + L.noiseContrast * 0.5, n);
      weight *= mix(1.0, nMask, L.noiseAmount);
    }
    if (L.flowAmount > 0.001) {
      weight *= mix(1.0, smoothstep(0.06, 0.4, flow), L.flowAmount);
    }
    if (L.aoMin > 0.001) {
      weight *= smoothstep(L.aoMin - 0.08, L.aoMin + 0.08, ao);
    }
    w[i] = max(weight, 0.0);
  }
  // sequential blend (bottom → top) into a fixed array, then split across two maps
  var out = array<f32, 8>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  var acc = 0.0;
  for (var i = 0; i < 8; i++) {
    if (u32(i) >= u.count) { break; }
    let L = texLayer(u32(i));
    acc = applyBlendWeight(acc, w[i], L.blend);
    out[i] = acc;
  }
  textureStore(dstA, c, vec4f(clamp(out[0], 0.0, 1.0), clamp(out[1], 0.0, 1.0), clamp(out[2], 0.0, 1.0), clamp(out[3], 0.0, 1.0)));
  textureStore(dstB, c, vec4f(clamp(out[4], 0.0, 1.0), clamp(out[5], 0.0, 1.0), clamp(out[6], 0.0, 1.0), clamp(out[7], 0.0, 1.0)));
}
fn applyBlendWeight(acc: f32, layer: f32, mode: u32) -> f32 {
  switch mode {
    case 1u: { return clamp(acc + layer, 0.0, 1.0); }
    case 2u: { return clamp(acc - layer, 0.0, 1.0); }
    case 3u: { return clamp(acc * layer, 0.0, 1.0); }
    case 4u: { return max(acc, layer); }
    case 5u: { return min(acc, layer); }
    case 6u: { return clamp(1.0 - (1.0 - acc) * (1.0 - layer), 0.0, 1.0); }
    default: { return clamp(mix(acc, layer, layer), 0.0, 1.0); }
  }
}
`;
