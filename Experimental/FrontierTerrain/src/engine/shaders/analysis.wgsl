// ---------------------------------------------------------------------------
// Terrain analysis and texturing passes:
//   attr_main    slope, curvature, wetness/flow, horizon ambient occlusion,
//                plus histograms (heights and slopes) for the UI
//   shadow_main  soft directional shadows by ray-marching the height field
//   splat_main   evaluates the texture layer stack into 8 material weights
//   thumb_main   small previews (hillshade, material mask, slope/flow/ao)
// ---------------------------------------------------------------------------
struct TL {
  a: vec4<f32>, // enabled, opacity, sharp, heightBlend
  b: vec4<f32>, // altOn, altMin, altMax, altFeather
  c: vec4<f32>, // slopeOn, slopeMin, slopeMax, slopeFeather
  d: vec4<f32>, // curvOn, curvMode, curvThr, curvFeather
  e: vec4<f32>, // flowOn, flowMin, cavOn, cavMin
  f: vec4<f32>, // noiseAmt, noiseScale, matType, materialScale
  g: vec4<f32>, // tint.rgb, detail
  h: vec4<f32>, // roughness, seedOffset, 0, 0
};
struct TexU {
  hdr: vec4<f32>, // N, base layer index, cell, maxH
  ext: vec4<f32>, // unused
  L: array<TL, 8>,
};

@group(0) @binding(0) var<uniform> U: Uni;
@group(0) @binding(1) var<storage, read> H: array<f32>;
@group(0) @binding(2) var<storage, read> flowRaw: array<u32>;
@group(0) @binding(3) var<storage, read> flowMaxB: array<u32>;
@group(0) @binding(4) var<storage, read_write> A: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> hist: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> SH: array<f32>;
@group(0) @binding(7) var<storage, read_write> S0: array<u32>;
@group(0) @binding(8) var<storage, read_write> S1: array<u32>;
@group(0) @binding(9) var<uniform> TX: TexU;
@group(0) @binding(10) var<storage, read_write> TB: array<u32>;

fn P(i: u32) -> f32 {
  let v = U.p[i >> 2u];
  return v[i & 3u];
}

const RADM: array<f32, 6> = array<f32, 6>(6.0, 12.0, 24.0, 48.0, 96.0, 160.0);

@compute @workgroup_size(8, 8)
fn attr_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = i32(U.n);
  if (gid.x >= U.n || gid.y >= U.n) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let idx = u32(y * n + x);
  let h = H[idx];
  let xl = max(x - 1, 0);
  let xr = min(x + 1, n - 1);
  let yd = max(y - 1, 0);
  let yu = min(y + 1, n - 1);
  let hl = H[u32(y * n + xl)];
  let hr = H[u32(y * n + xr)];
  let hd = H[u32(yd * n + x)];
  let hu = H[u32(yu * n + x)];
  let sc = U.maxH / U.cell;
  let gx = (hr - hl) * 0.5 * sc;
  let gz = (hu - hd) * 0.5 * sc;
  let slope = atan(length(vec2<f32>(gx, gz)));
  let lap = (hl + hr + hd + hu - 4.0 * h) * U.maxH;
  let curvM = -lap / (U.cell * U.cell);
  let curvN = clamp(curvM * 300.0, -1.0, 1.0);

  var flow = 0.0;
  if (U.mode == 1u) {
    let raw = f32(flowRaw[idx]);
    let mx = f32(max(flowMaxB[0], 1u));
    flow = log(1.0 + raw) / log(1.0 + mx);
  } else {
    flow = smoothstep(0.0, 0.5, max(curvN, 0.0)) * (1.0 - smoothstep(0.05, 0.5, slope));
  }

  var occ = 0.0;
  for (var d: u32 = 0u; d < 8u; d = d + 1u) {
    let ang = f32(d) * 0.785398163;
    let dxx = cos(ang);
    let dzz = sin(ang);
    var maxT = 0.0;
    for (var r: u32 = 0u; r < 6u; r = r + 1u) {
      let rm = RADM[r];
      let cells = rm / U.cell;
      let sx = i32(round(f32(x) + dxx * cells));
      let sy = i32(round(f32(y) + dzz * cells));
      if (sx < 0 || sy < 0 || sx >= n || sy >= n) { continue; }
      let hs = H[u32(sy * n + sx)];
      let t = (hs - h) * U.maxH / rm;
      maxT = max(maxT, t);
    }
    occ = occ + maxT / sqrt(1.0 + maxT * maxT);
  }
  let ao = clamp(1.0 - 2.2 * (occ / 8.0), 0.0, 1.0);
  A[idx] = vec4<f32>(slope, curvN, flow, ao);

  let hb = min(u32(clamp(h, 0.0, 0.999999) * 64.0), 63u);
  _ = atomicAdd(&hist[hb], 1u);
  let sb = min(u32(degrees(slope) / 90.0 * 32.0), 31u);
  _ = atomicAdd(&hist[64u + sb], 1u);
}

// Soft shadows: march towards the sun over the height field.
// P(0),P(1) = unit horizontal direction in grid cells, P(2) = tan(elevation), P(3) = softness.
@compute @workgroup_size(8, 8)
fn shadow_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let idx = gid.y * n + gid.x;
  let h0 = H[idx] * U.maxH;
  let tanE = P(2u);
  if (tanE <= 0.0) {
    SH[idx] = 0.0;
    return;
  }
  let d = vec2<f32>(P(0u), P(1u));
  let soft = max(P(3u), 1e-4);
  let fx = f32(gid.x);
  let fy = f32(gid.y);
  let fmax = f32(n - 1u);
  var vis = 1.0;
  var t = 0.0;
  for (var s: u32 = 0u; s < 640u; s = s + 1u) {
    t = t + max(1.0, t * 0.02);
    let px = fx + d.x * t;
    let py = fy + d.y * t;
    if (px < 0.0 || py < 0.0 || px > fmax || py > fmax) { break; }
    let hs = H[u32(round(py)) * n + u32(round(px))] * U.maxH;
    let dist = t * U.cell;
    let tanOcc = (hs - h0) / dist;
    let v = clamp(0.5 + (tanE - tanOcc) / soft * 0.5, 0.0, 1.0);
    vis = min(vis, v);
    if (tanE * dist > U.maxH - h0 + 2.0) { break; }
    if (vis <= 0.0) { break; }
  }
  SH[idx] = vis;
}

fn band2(x: f32, lo: f32, hi: f32, fe: f32) -> f32 {
  return smoothstep(lo - fe, lo + fe + 1e-5, x) * (1.0 - smoothstep(hi - fe, hi + fe + 1e-5, x));
}

fn pack4(v: vec4<f32>) -> u32 {
  let q = vec4<u32>(clamp(v, vec4<f32>(0.0), vec4<f32>(1.0)) * 255.0 + vec4<f32>(0.5));
  return q.x | (q.y << 8u) | (q.z << 16u) | (q.w << 24u);
}

fn unp(v: u32, b: u32) -> f32 {
  return f32((v >> (8u * b)) & 255u) / 255.0;
}

// Full texture-layer evaluation for one texel.
@compute @workgroup_size(8, 8)
fn splat_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let idx = gid.y * n + gid.x;
  let alt = H[idx] * U.maxH;
  let at = A[idx];
  let slopeDeg = degrees(at.x);
  let curv = at.y;
  let flow = at.z;
  let ao = at.w;
  let wp = vec2<f32>(f32(gid.x), f32(gid.y)) * U.cell;
  let base = u32(TX.hdr.y + 0.5);
  var w = array<f32, 8>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var i: u32 = 0u; i < 8u; i = i + 1u) {
    let L = TX.L[i];
    if (L.a.x < 0.5) { continue; }
    var m = 1.0;
    if (L.b.x > 0.5) { m = m * band2(alt, L.b.y, L.b.z, L.b.w); }
    if (L.c.x > 0.5) { m = m * band2(slopeDeg, L.c.y, L.c.z, L.c.w); }
    if (L.d.x > 0.5) {
      let md = u32(L.d.y + 0.5);
      let f = L.d.w;
      let thr = L.d.z;
      var cv = 0.0;
      if (md == 0u) {
        cv = smoothstep(thr - f, thr + f + 1e-5, curv);
      } else if (md == 1u) {
        cv = smoothstep(thr - f, thr + f + 1e-5, -curv);
      } else {
        cv = smoothstep(thr - f, thr + f + 1e-5, abs(curv));
      }
      m = m * cv;
    }
    if (L.e.x > 0.5) { m = m * smoothstep(L.e.y - 0.04, L.e.y + 0.04, flow); }
    if (L.e.z > 0.5) { m = m * smoothstep(L.e.w - 0.1, L.e.w + 0.1, 1.0 - ao); }
    if (L.f.x > 0.001) {
      let nz = fbm(wp / max(L.f.y, 1.0) + vec2<f32>(L.h.y, L.h.y * 0.37), 5, 2.0, 0.5, 0);
      m = clamp(m + (nz - 0.5) * L.f.x * 2.0, 0.0, 1.0);
    }
    var t = clamp(m * L.a.y, 0.0, 1.0);
    if (L.a.w > 0.001) {
      let hn = fbm(wp / max(L.f.w, 1.0) + vec2<f32>(L.h.y * 1.7, 3.1), 4, 2.0, 0.5, 0);
      let wd = mix(0.5, 0.02, L.a.z);
      t = smoothstep(0.5 - wd, 0.5 + wd, t + (hn - 0.5) * L.a.w);
    } else {
      let wd = mix(0.5, 0.02, L.a.z);
      t = smoothstep(0.5 - wd, 0.5 + wd, t);
    }
    if (i == base) { t = 1.0; }
    for (var k: u32 = 0u; k < 8u; k = k + 1u) {
      w[k] = w[k] * (1.0 - t);
    }
    w[i] = w[i] + t;
  }
  S0[idx] = pack4(vec4<f32>(w[0], w[1], w[2], w[3]));
  S1[idx] = pack4(vec4<f32>(w[4], w[5], w[6], w[7]));
}

fn weightAt(idx: u32, k: u32) -> f32 {
  if (k < 4u) { return unp(S0[idx], k); }
  return unp(S1[idx], k - 4u);
}

fn packRGBA(c: vec3<f32>) -> u32 {
  let q = vec3<u32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)) * 255.0 + vec3<f32>(0.5));
  return q.x | (q.y << 8u) | (q.z << 16u) | (255u << 24u);
}

fn shadeAt(xx: i32, yy: i32, n: i32) -> f32 {
  let xl = max(xx - 1, 0);
  let xr = min(xx + 1, n - 1);
  let yd = max(yy - 1, 0);
  let yu = min(yy + 1, n - 1);
  let sc = U.maxH / U.cell * f32(n - 1) / f32(max(n - 1, 1));
  let gx = (H[u32(yy * n + xr)] - H[u32(yy * n + xl)]) * 0.5 * sc;
  let gz = (H[u32(yu * n + xx)] - H[u32(yd * n + xx)]) * 0.5 * sc;
  let nrm = normalize(vec3<f32>(-gx, 1.0, -gz));
  let L = normalize(vec3<f32>(-0.6, 0.55, 0.6));
  return clamp(dot(nrm, L), 0.0, 1.0);
}

// Thumbnail renderer. U.p[0].x = output size, U.p[1].rgb = tint, U.mode = view,
// U.kind = material channel.
@compute @workgroup_size(8, 8)
fn thumb_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = u32(U.p[0].x);
  if (gid.x >= size || gid.y >= size) { return; }
  let n = i32(U.n);
  let xx = min(i32((f32(gid.x) + 0.5) / f32(size) * f32(n)), n - 1);
  let yy = min(i32((f32(gid.y) + 0.5) / f32(size) * f32(n)), n - 1);
  let idx = u32(yy * n + xx);
  let sh = shadeAt(xx, yy, n);
  var col = vec3<f32>(0.0);
  let mode = U.mode;
  if (mode == 0u) {
    let h = H[idx];
    col = vec3<f32>(0.08 + 0.9 * sh * (0.55 + 0.45 * h));
  } else if (mode == 1u) {
    let wgt = weightAt(idx, U.kind);
    col = mix(vec3<f32>(0.06), U.p[1].rgb * (0.45 + 0.55 * sh), wgt);
  } else if (mode == 2u) {
    let s = degrees(A[idx].x) / 60.0;
    col = mix(vec3<f32>(0.1, 0.25, 0.5), vec3<f32>(0.95, 0.75, 0.25), smoothstep(0.0, 0.5, s));
    col = mix(col, vec3<f32>(0.85, 0.2, 0.15), smoothstep(0.5, 1.0, s));
  } else if (mode == 3u) {
    let f = A[idx].z;
    col = mix(vec3<f32>(0.05, 0.06, 0.08), vec3<f32>(0.3, 0.75, 1.0), f);
  } else {
    col = vec3<f32>(A[idx].w);
  }
  TB[gid.y * size + gid.x] = packRGBA(col);
}
