// ---------------------------------------------------------------------------
// Material bake. Evaluates the full texture-layer stack once per texel of a
// world-aligned texture (T x T over the whole world), writing:
//   albedo  (rgba16float): rgb = blended albedo, a = 1
//   detail  (rgba16float): x,y = detail normal perturbation, z = roughness
// The terrain fragment shader then only samples these, so per-frame cost is
// independent of how many material layers are used.
// mip_main downsamples each level into the mip chain.
// ---------------------------------------------------------------------------
struct TL {
  a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32>,
  e: vec4<f32>, f: vec4<f32>, g: vec4<f32>, h: vec4<f32>,
};
struct TexU {
  hdr: vec4<f32>, // N, base layer index, cell, maxH
  ext: vec4<f32>, // unused
  L: array<TL, 8>,
};
struct BakeU {
  hdr: vec4<f32>, // N, T, cell (m), maxH (m)
  ext: vec4<f32>, // half world extent (m), sea level (m), unused, unused
};

@group(0) @binding(0) var<uniform> BU: BakeU;
@group(0) @binding(1) var<storage, read> H: array<f32>;
@group(0) @binding(2) var<storage, read> S0: array<u32>;
@group(0) @binding(3) var<storage, read> S1: array<u32>;
@group(0) @binding(4) var<uniform> TX: TexU;
@group(0) @binding(5) var albOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var detOut: texture_storage_2d<rgba16float, write>;

fn ldH(x: i32, y: i32) -> f32 {
  let n = i32(BU.hdr.x);
  return H[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))];
}

fn bilH(g: vec2<f32>) -> f32 {
  let n = i32(BU.hdr.x);
  let c = clamp(g, vec2<f32>(0.0), vec2<f32>(f32(n - 1) - 0.001));
  let i0 = vec2<i32>(floor(c));
  let f = c - vec2<f32>(i0);
  let a = ldH(i0.x, i0.y);
  let b = ldH(i0.x + 1, i0.y);
  let cc = ldH(i0.x, i0.y + 1);
  let d = ldH(i0.x + 1, i0.y + 1);
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

fn unpB(v: u32, b: u32) -> f32 {
  return f32((v >> (8u * b)) & 255u) / 255.0;
}

fn splatW(g: vec2<f32>) -> array<f32, 8> {
  let n = i32(BU.hdr.x);
  let c = clamp(g, vec2<f32>(0.0), vec2<f32>(f32(n - 1) - 0.001));
  let i0 = vec2<i32>(floor(c));
  let f = c - vec2<f32>(i0);
  var w = array<f32, 8>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var q: u32 = 0u; q < 4u; q = q + 1u) {
    let ox = i32(q & 1u);
    let oy = i32((q >> 1u) & 1u);
    let wx = select(1.0 - f.x, f.x, ox == 1);
    let wy = select(1.0 - f.y, f.y, oy == 1);
    let xi = clamp(i0.x + ox, 0, n - 1);
    let yi = clamp(i0.y + oy, 0, n - 1);
    let id = u32(yi * n + xi);
    let a = S0[id];
    let b = S1[id];
    let wgt = wx * wy;
    for (var k: u32 = 0u; k < 4u; k = k + 1u) {
      w[k] = w[k] + unpB(a, k) * wgt;
      w[k + 4u] = w[k + 4u] + unpB(b, k) * wgt;
    }
  }
  return w;
}

// Weighted blend of the material stack at one world position.
fn blendEval(wp: vec3<f32>, nrm: vec3<f32>, w: array<f32, 8>) -> Mat {
  var alb = vec3<f32>(0.0);
  var rough = 0.0;
  var h = 0.0;
  var ws = 0.0;
  for (var k: u32 = 0u; k < 8u; k = k + 1u) {
    if (w[k] > 0.002) {
      let L = TX.L[k];
      let m = matEval(u32(L.f.z + 0.5), wp, nrm, max(L.f.w, 0.5));
      alb = alb + m.alb * L.g.rgb * w[k];
      rough = rough + (L.h.x * (0.75 + 0.5 * m.rough)) * w[k];
      h = h + m.h * w[k];
      ws = ws + w[k];
    }
  }
  let inv = 1.0 / max(ws, 1e-4);
  return Mat(alb * inv, rough * inv, h * inv);
}

fn detailStrength(w: array<f32, 8>) -> f32 {
  var d = 0.0;
  var ws = 0.0;
  for (var k: u32 = 0u; k < 8u; k = k + 1u) {
    d = d + TX.L[k].g.a * w[k];
    ws = ws + w[k];
  }
  return d / max(ws, 1e-4);
}

@compute @workgroup_size(8, 8)
fn bake_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let T = u32(BU.hdr.y);
  if (gid.x >= T || gid.y >= T) { return; }
  let hw = BU.ext.x;
  let cell = BU.hdr.z;
  let maxH = BU.hdr.w;
  let wxz = (vec2<f32>(gid.xy) + 0.5) / f32(T) * (2.0 * hw) - vec2<f32>(hw);
  let g = (wxz + vec2<f32>(hw)) / cell;
  let hm = bilH(g) * maxH;
  let wp = vec3<f32>(wxz.x, hm, wxz.y);
  let dhx = (bilH(g + vec2<f32>(1.0, 0.0)) - bilH(g - vec2<f32>(1.0, 0.0))) * 0.5 * maxH / cell;
  let dhz = (bilH(g + vec2<f32>(0.0, 1.0)) - bilH(g - vec2<f32>(0.0, 1.0))) * 0.5 * maxH / cell;
  let Ng = normalize(vec3<f32>(-dhx, 1.0, -dhz));
  let wts = splatW(g);
  let m0 = blendEval(wp, Ng, wts);
  let eps = max(0.12, cell * 0.02);
  let hx = blendEval(wp + vec3<f32>(eps, 0.0, 0.0), Ng, wts).h;
  let hz = blendEval(wp + vec3<f32>(0.0, 0.0, eps), Ng, wts).h;
  let kk = detailStrength(wts) * 0.35;
  let gx = (hx - m0.h) / eps * kk;
  let gz = (hz - m0.h) / eps * kk;
  textureStore(albOut, vec2<i32>(gid.xy), vec4<f32>(m0.alb, 1.0));
  textureStore(detOut, vec2<i32>(gid.xy), vec4<f32>(gx, gz, m0.rough, 1.0));
}

// Box-filter one mip level from the level above (one texel of output per 2x2 input).
@group(0) @binding(10) var srcA: texture_2d<f32>;
@group(0) @binding(11) var srcD: texture_2d<f32>;
@group(0) @binding(12) var dstA: texture_storage_2d<rgba16float, write>;
@group(0) @binding(13) var dstD: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn mip_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(dstA);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let sMax = vec2<i32>(textureDimensions(srcA)) - vec2<i32>(1);
  let base = vec2<i32>(gid.xy) * 2;
  var a = vec4<f32>(0.0);
  var d = vec4<f32>(0.0);
  for (var j: i32 = 0; j < 2; j = j + 1) {
    for (var i: i32 = 0; i < 2; i = i + 1) {
      let c = clamp(base + vec2<i32>(i, j), vec2<i32>(0), sMax);
      a = a + textureLoad(srcA, c, 0);
      d = d + textureLoad(srcD, c, 0);
    }
  }
  textureStore(dstA, vec2<i32>(gid.xy), a * 0.25);
  textureStore(dstD, vec2<i32>(gid.xy), d * 0.25);
}
