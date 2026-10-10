// ---------------------------------------------------------------------------
// Terrain generation operators. Every layer produces a candidate height field
// which `combine_main` blends into the stack with its blend mode, opacity and
// mask. Heights are normalised to [0,1] (1 = maxH metres).
// Parameter slots P(i) follow the order of each kind's spec in model.ts.
// ---------------------------------------------------------------------------
@group(0) @binding(0) var<uniform> U: Uni;
@group(0) @binding(1) var<storage, read> bA: array<f32>;
@group(0) @binding(2) var<storage, read_write> bB: array<f32>;
@group(0) @binding(3) var<storage, read> bC: array<f32>;
@group(0) @binding(4) var<storage, read> flowRaw: array<u32>;
@group(0) @binding(5) var<storage, read> flowMaxB: array<u32>;

fn P(i: u32) -> f32 {
  let v = U.p[i >> 2u];
  return v[i & 3u];
}

const DX: array<i32, 8> = array<i32, 8>(1, -1, 0, 0, 1, 1, -1, -1);
const DY: array<i32, 8> = array<i32, 8>(0, 0, 1, -1, 1, -1, 1, -1);

@compute @workgroup_size(8, 8)
fn gen_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let idx = gid.y * n + gid.x;
  let uv = (vec2<f32>(gid.xy) + 0.5) / f32(n);
  let c = uv * 2.0 - 1.0;
  let so = vec2<f32>(U.seed * 17.13, U.seed * 31.71);
  var v = 0.0;
  switch U.kind {
    case 0u: { // fractal
      var q = uv * P(1u) + so;
      if (P(5u) > 0.0) {
        let wf = P(6u);
        let fmax = f32(n) / 6.0; // no octave finer than ~6 cells
        let w0 = vec2<f32>(
          fbmL(q * wf + vec2<f32>(1.7, 9.2), 4, 2.0, 0.5, 0, P(1u) * wf, fmax),
          fbmL(q * wf + vec2<f32>(8.3, 2.8), 4, 2.0, 0.5, 0, P(1u) * wf, fmax));
        q = q + (w0 - vec2<f32>(0.5)) * P(5u) * 2.0;
      }
      v = fbmL(q, i32(P(2u)), P(3u), P(4u), i32(P(0u)), P(1u), f32(n) / 6.0) * P(7u) + P(8u);
    }
    case 1u: { // cells / ridges / plateaus
      let vr = voronoi(uv * P(0u), P(1u), u32(U.seed));
      let mode = u32(P(2u) + 0.5);
      var f = 0.0;
      if (mode == 0u) {
        f = clamp(1.0 - vr.x * 1.6, 0.0, 1.0);
      } else if (mode == 1u) {
        f = 1.0 - smoothstep(0.0, 0.08, vr.y - vr.x);
      } else {
        f = mix(vr.z, floor(vr.z * 5.0) / 5.0, 0.75) * 0.8 + (1.0 - smoothstep(0.0, 0.7, vr.x)) * 0.2;
      }
      v = f * P(3u) + P(4u);
    }
    case 2u: { // continent / island shaper
      let f = P(4u);
      let wq = vec2<f32>(
        fbm(c * f + so, 5, 2.0, 0.5, 0),
        fbm(c * f + so + vec2<f32>(5.2, 1.3), 5, 2.0, 0.5, 0)) - vec2<f32>(0.5);
      let d = length(c + wq * P(2u) * 2.0);
      let m = 1.0 - smoothstep(P(0u) - P(1u), P(0u) + P(1u), d);
      v = mix(P(3u), 1.0, m);
    }
    case 3u: { // terrace
      let h = bA[idx];
      let steps = P(0u);
      let t = h * steps;
      let fl = floor(t);
      let fr = fract(t);
      let ff = mix(smoothstep(0.0, 1.0, fr), step(0.5, fr), P(1u));
      v = mix(h, (fl + ff) / steps, P(2u));
    }
    case 4u: { // levels & S-curve
      let h = bA[idx];
      var x = clamp((h - P(0u)) / max(P(1u) - P(0u), 1e-4), 0.0, 1.0);
      x = pow(x, P(2u));
      let s = P(3u);
      if (s >= 0.0) {
        x = mix(x, smoothstep(0.0, 1.0, x), s);
      } else {
        x = mix(x, 1.0 - smoothstep(0.0, 1.0, 1.0 - x), -s);
      }
      v = mix(P(4u), 1.0, x);
    }
    default: {
      v = bA[idx];
    }
  }
  bB[idx] = clamp(v, 0.0, 1.0);
}

// Separable box-triangle blur. U.mode: 0 = horizontal, 1 = vertical. P(0) = radius.
@compute @workgroup_size(8, 8)
fn blur_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let idx = gid.y * n + gid.x;
  let R = i32(P(0u));
  let horiz = U.mode == 0u;
  var acc = 0.0;
  var wsum = 0.0;
  for (var k: i32 = -R; k <= R; k = k + 1) {
    let w = f32(R + 1 - abs(k));
    var sx = i32(gid.x);
    var sy = i32(gid.y);
    if (horiz) {
      sx = clamp(sx + k, 0, i32(n) - 1);
    } else {
      sy = clamp(sy + k, 0, i32(n) - 1);
    }
    acc = acc + bA[u32(sy) * n + u32(sx)] * w;
    wsum = wsum + w;
  }
  bB[idx] = acc / wsum;
}

// Thermal (talus) erosion. Pairwise antisymmetric transfer keeps mass exact.
// P(0) = tan(talus) * cell / maxH (normalised height per cell), P(1) = rate.
@compute @workgroup_size(8, 8)
fn thermal_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let idx = gid.y * n + gid.x;
  let x = i32(gid.x);
  let y = i32(gid.y);
  let h = bA[idx];
  var delta = 0.0;
  let t0 = P(0u);
  for (var d: u32 = 0u; d < 8u; d = d + 1u) {
    let nx = x + DX[d];
    let ny = y + DY[d];
    if (nx < 0 || ny < 0 || nx >= i32(n) || ny >= i32(n)) { continue; }
    let diag = select(1.0, 1.41421356, DX[d] != 0 && DY[d] != 0);
    let dh = h - bA[u32(ny) * n + u32(nx)];
    delta = delta + sign(dh) * max(abs(dh) - t0 * diag, 0.0);
  }
  bB[idx] = max(h - delta * P(1u), 0.0);
}

// River carving from the flow accumulated by hydraulic erosion.
// P(0) = depth (normalised), P(1) = threshold (0..1), P(2) = width (cells).
@compute @workgroup_size(8, 8)
fn rivers_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let idx = gid.y * n + gid.x;
  let h = bA[idx];
  let R = i32(P(2u));
  let denom = log(1.0 + max(f32(flowMaxB[0]), 1.0));
  var fmax = 0.0;
  for (var dy: i32 = -R; dy <= R; dy = dy + 1) {
    for (var dx: i32 = -R; dx <= R; dx = dx + 1) {
      let xx = clamp(i32(gid.x) + dx, 0, i32(n) - 1);
      let yy = clamp(i32(gid.y) + dy, 0, i32(n) - 1);
      let raw = f32(flowRaw[u32(yy) * n + u32(xx)]);
      fmax = max(fmax, log(1.0 + raw) / denom);
    }
  }
  let m = smoothstep(P(1u), min(P(1u) + 0.12, 1.0), fmax);
  bB[idx] = clamp(h - P(0u) * m, 0.0, 1.0);
}

fn slopeDegAt(x: i32, y: i32) -> f32 {
  let n = i32(U.n);
  let xl = max(x - 1, 0);
  let xr = min(x + 1, n - 1);
  let yd = max(y - 1, 0);
  let yu = min(y + 1, n - 1);
  let dx = (bA[u32(y) * U.n + u32(xr)] - bA[u32(y) * U.n + u32(xl)]) * 0.5 * U.maxH / U.cell;
  let dz = (bA[u32(yu) * U.n + u32(x)] - bA[u32(yd) * U.n + u32(x)]) * 0.5 * U.maxH / U.cell;
  return degrees(atan(length(vec2<f32>(dx, dz))));
}

// Blend candidate into the stack. P(0..3) = mask lo, hi, feather, invert; P(4) = scale.
@compute @workgroup_size(8, 8)
fn combine_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let idx = gid.y * n + gid.x;
  let h = bA[idx];
  let cnd = bC[idx];
  let uv = (vec2<f32>(gid.xy) + 0.5) / f32(n);
  let so = vec2<f32>(U.seed * 17.13, U.seed * 31.71);
  var m = 1.0;
  let lo = P(0u);
  let hi = P(1u);
  let fe = P(2u);
  if (U.mtype == 1u) {
    m = band(h * U.maxH, lo, hi, fe);
  } else if (U.mtype == 2u) {
    m = band(slopeDegAt(i32(gid.x), i32(gid.y)), lo, hi, fe);
  } else if (U.mtype == 3u) {
    let nz = fbm(uv * P(4u) + so, 5, 2.0, 0.5, 0);
    m = band(nz, lo, hi, fe);
  }
  if (P(3u) > 0.5) { m = 1.0 - m; }
  m = m * U.opacity;
  var r = cnd;
  if (U.mode == 1u) {
    r = h + cnd;
  } else if (U.mode == 2u) {
    r = h - cnd;
  } else if (U.mode == 3u) {
    r = h * cnd;
  } else if (U.mode == 4u) {
    r = min(h, cnd);
  } else if (U.mode == 5u) {
    r = max(h, cnd);
  }
  bB[idx] = clamp(mix(h, r, clamp(m, 0.0, 1.0)), 0.0, 1.0);
}
