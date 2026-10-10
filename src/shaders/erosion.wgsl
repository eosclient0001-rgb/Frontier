// ─────────────────────────────────────────────────────────────────────────────
//  Erosion
//
//  · thermal  — thresholded diffusion, symmetric and atomic-free
//  · hydraulic — particle (droplet) erosion with fixed-point atomic deposition
//  · flow     — exact D8 flow accumulation by pointer jumping (pull form, so
//               it needs log2(path length) sweeps and no atomics at all)
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

fn res_() -> i32 { return i32(U.v0.x); }
fn inField(gid: vec3<u32>) -> bool { return i32(gid.x) < res_() && i32(gid.y) < res_(); }
fn at(gid: vec3<u32>) -> i32 { return i32(gid.y) * res_() + i32(gid.x); }
fn uvOf(gid: vec3<u32>) -> vec2<f32> {
  return (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) * U.v1.x;
}

// ── little RNG (PCG-ish) ─────────────────────────────────────────────────────
fn pcg(v: u32) -> u32 {
  var state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rnd(state: ptr<function, u32>) -> f32 {
  *state = pcg(*state);
  return f32(*state) * (1.0 / 4294967296.0);
}

// ── fixed-point field access on the atomic buffer ────────────────────────────
fn fxAt(i: i32) -> f32 { return f32(atomicLoad(&FX[i])) / HEIGHT_FIXED; }

/// Bilinear height + gradient from the 3x3 neighbourhood of atomic cells.
/// Returns (height, d/dx per cell, d/dz per cell).
fn fxSample3(pos: vec2<f32>) -> vec3<f32> {
  let r = res_();
  let i0 = vec2<i32>(floor(pos));
  let f = pos - vec2<f32>(i0);
  var h: array<f32, 9> = array<f32, 9>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var dy = 0; dy < 3; dy = dy + 1) {
    for (var dx = 0; dx < 3; dx = dx + 1) {
      let cx = clamp(i0.x + dx - 1, 0, r - 1);
      let cy = clamp(i0.y + dy - 1, 0, r - 1);
      h[dy * 3 + dx] = fxAt(cy * r + cx);
    }
  }
  let b00 = h[4];
  let b10 = h[5];
  let b01 = h[7];
  let b11 = h[8];
  let hb = mix(mix(b00, b10, f.x), mix(b01, b11, f.x), f.y);
  let gx = (b10 - b00) * (1.0 - f.y) + (b11 - b01) * f.y;
  let gz = (b01 - b00) * (1.0 - f.x) + (b11 - b10) * f.x;
  return vec3<f32>(hb, gx, gz);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Preparation / finalisation
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn erodePrep(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  atomicStore(&FX[i], i32(H[i] * HEIGHT_FIXED));
  atomicStore(&FL[i], 0);
  S[i] = H[i];               // pre-erosion snapshot for the deposition mask
}

@compute @workgroup_size(8, 8, 1)
fn erodeFinish(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let lp = LP[U.v0.y];
  let h = f32(atomicLoad(&FX[i])) / HEIGHT_FIXED;
  H[i] = h;
  let before = S[i];
  let scale = max(lp.a[4].x, 1e-4);
  AUX[i * 4 + 1] = sat(0.5 + (h - before) * scale);
}

/// Light 3x3 smoothing to knock the spikes off droplet erosion.
@compute @workgroup_size(8, 8, 1)
fn erodeSmooth(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let r = res_();
  let i = at(gid);
  let gx = i32(gid.x); let gy = i32(gid.y);
  var acc = 0.0;
  var w = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let x = clamp(gx + dx, 0, r - 1);
      let y = clamp(gy + dy, 0, r - 1);
      let kk = f32(abs(dx) + abs(dy));
      let ww = exp(-kk * 0.7);
      acc += H[y * r + x] * ww;
      w += ww;
    }
  }
  S[i] = mix(H[i], acc / w, sat(lp.a[0].w));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Thermal erosion — material slumps once the repose angle is exceeded
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn erodeThermal(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let r = res_();
  let i = at(gid);
  let gx = i32(gid.x); let gy = i32(gid.y);
  let hc = H[i];
  let talus = max(lp.a[0].x, 1e-7);
  let rate = sat(lp.a[0].y);
  let diag = 1.4142135624;

  var delta = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let x = gx + dx; let y = gy + dy;
      // borders drain away instead of piling up
      var hn: f32;
      if (x < 0 || y < 0 || x >= r || y >= r) {
        hn = hc - talus * 2.0;
      } else {
        hn = H[y * r + x];
      }
      let d = hn - hc;
      let t = talus * select(1.0, diag, dx != 0 && dy != 0);
      delta += sign(d) * max(abs(d) - t, 0.0);
    }
  }
  S[i] = hc + delta * 0.125 * rate;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hydraulic erosion — droplets
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(64, 1, 1)
fn erodeDroplet(@builtin(global_invocation_id) gid: vec3<u32>) {
  let total = U.v0.w;
  if (gid.x >= total) { return; }
  let lp = LP[U.v0.y];
  let r = res_();
  let rf = f32(r);
  let id = gid.x + U.v2.z;

  var rng = pcg(id * 9781u + U.v0.z * 6151u + 1u);

  let maxSteps = i32(clamp(lp.a[1].x, 4.0, 256.0));
  let inertia = sat(lp.a[1].y);
  let capacity = max(lp.a[1].z, 0.05);
  let minSlope = max(lp.a[1].w, 1e-5);
  let depositRate = sat(lp.a[2].x);
  let erodeRate = sat(lp.a[2].y);
  let evaporate = sat(lp.a[2].z);
  let gravity = max(lp.a[2].w, 0.1);
  let radius = i32(clamp(lp.a[3].x, 1.0, 4.0));
  let erosionScale = lp.a[3].y;

  var pos = vec2<f32>(rnd(&rng), rnd(&rng)) * rf;
  var dir = vec2<f32>(0.0, 0.0);
  var vel = 1.0;
  var water = 1.0;
  var sediment = 0.0;

  for (var step = 0; step < maxSteps; step++) {
    let s = fxSample3(pos);
    let hOld = s.x;
    var grad = vec2<f32>(s.y, s.z);
    let gl = length(grad);
    if (gl < 1e-9) { break; }
    grad = grad / gl;

    dir = normalize(mix(dir, -grad, 1.0 - inertia) + 1e-9);
    let newPos = pos + dir;
    if (newPos.x < 0.5 || newPos.y < 0.5 || newPos.x > rf - 1.5 || newPos.y > rf - 1.5) { break; }

    let s2 = fxSample3(newPos);
    let hNew = s2.x;
    let dh = hOld - hNew;                 // positive when running downhill

    let cap = max(dh * vel * water * capacity, minSlope);

    if (dh < 0.0) {
      // moving uphill: dump the load to fill the hollow
      let amount = min(-dh, sediment);
      sediment -= amount;
      depositBrush(pos, amount, radius);
      vel = max(vel * 0.4, 0.05);
    } else if (sediment > cap) {
      let amount = (sediment - cap) * depositRate;
      sediment -= amount;
      depositBrush(pos, amount, radius);
    } else {
      let amount = min((cap - sediment) * erodeRate, dh) * erosionScale;
      sediment += amount;
      erodeBrush(pos, amount, radius);
    }

    vel = sqrt(max(vel * vel + dh * gravity, 0.0001));
    water = water * (1.0 - evaporate);
    if (water < 0.01) { break; }
    pos = newPos;
  }
}

/// Add material: writes +delta * weight into the brush.
fn depositBrush(pos: vec2<f32>, amount: f32, radius: i32) {
  if (amount <= 0.0) { return; }
  let r = res_();
  let c = vec2<i32>(floor(pos));
  var wsum = 0.0;
  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius; dx <= radius; dx++) {
      let dd = f32(dx * dx + dy * dy) / f32(radius * radius + 1);
      if (dd > 1.0) { continue; }
      wsum += 1.0 - sqrt(dd);
    }
  }
  if (wsum <= 0.0) { return; }
  let q = amount / wsum * HEIGHT_FIXED;
  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius; dx <= radius; dx++) {
      let dd = f32(dx * dx + dy * dy) / f32(radius * radius + 1);
      if (dd > 1.0) { continue; }
      let x = clamp(c.x + dx, 0, r - 1);
      let y = clamp(c.y + dy, 0, r - 1);
      let w = (1.0 - sqrt(dd)) * q;
      atomicAdd(&FX[y * r + x], i32(w));
    }
  }
}

/// Remove material with the same weighting.
fn erodeBrush(pos: vec2<f32>, amount: f32, radius: i32) {
  if (amount <= 0.0) { return; }
  let r = res_();
  let c = vec2<i32>(floor(pos));
  var wsum = 0.0;
  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius; dx <= radius; dx++) {
      let dd = f32(dx * dx + dy * dy) / f32(radius * radius + 1);
      if (dd > 1.0) { continue; }
      wsum += 1.0 - sqrt(dd);
    }
  }
  if (wsum <= 0.0) { return; }
  let q = -amount / wsum * HEIGHT_FIXED;
  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius; dx <= radius; dx++) {
      let dd = f32(dx * dx + dy * dy) / f32(radius * radius + 1);
      if (dd > 1.0) { continue; }
      let x = clamp(c.x + dx, 0, r - 1);
      let y = clamp(c.y + dy, 0, r - 1);
      let w = (1.0 - sqrt(dd)) * q;
      atomicAdd(&FX[y * r + x], i32(w));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  D8 flow accumulation by pointer jumping
// ─────────────────────────────────────────────────────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn flowInit(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let r = res_();
  let i = at(gid);
  let gx = i32(gid.x); let gy = i32(gid.y);
  let hc = H[i];
  var best = 0.0;
  var bi = -1;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let x = gx + dx; let y = gy + dy;
      if (x < 0 || y < 0 || x >= r || y >= r) { continue; }   // drains off the map
      let d = select(1.0, 1.4142135624, dx != 0 && dy != 0);
      let slope = (hc - H[y * r + x]) / d;
      if (slope > best) { best = slope; bi = y * r + x; }
    }
  }
  IDX[i] = bi;
  IDX2[i] = bi;
  TMP[i] = 1.0;
  TMP2[i] = 1.0;
}

/// Pull sweep: sum[i] += sum[jump[i]]; jump[i] = jump[jump[i]].
@compute @workgroup_size(8, 8, 1)
fn flowStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  let j = IDX[i];
  if (j >= 0) {
    TMP2[i] = TMP[i] + TMP[j];
    IDX2[i] = IDX[j];
  } else {
    TMP2[i] = TMP[i];
    IDX2[i] = -1;
  }
}

@compute @workgroup_size(8, 8, 1)
fn flowCommit(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let i = at(gid);
  TMP[i] = TMP2[i];
  IDX[i] = IDX2[i];
}

/// Log-compressed, lightly smoothed flow into the auxiliary channel.
@compute @workgroup_size(8, 8, 1)
fn flowFinalize(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let i = at(gid);
  let r = res_();
  let gx = i32(gid.x); let gy = i32(gid.y);
  let mx = max(RED[1], 1.0);
  let gamma = max(lp.a[0].y, 0.05);

  var acc = 0.0;
  var w = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let x = clamp(gx + dx, 0, r - 1);
      let y = clamp(gy + dy, 0, r - 1);
      let kk = f32(abs(dx) + abs(dy));
      let ww = exp(-kk * 0.9);
      acc += TMP[y * r + x] * ww;
      w += ww;
    }
  }
  let f = log(1.0 + acc / w) / log(1.0 + mx);
  AUX[i * 4 + 0] = sat(pow(sat(f), gamma));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reductions reused by the flow/normalise passes
// ─────────────────────────────────────────────────────────────────────────────
var<workgroup> wgMin: array<f32, 256>;
var<workgroup> wgMax: array<f32, 256>;

@compute @workgroup_size(8, 8, 1)
fn reduceMinMax(@builtin(global_invocation_id) gid: vec3<u32>,
                @builtin(local_invocation_index) li: u32,
                @builtin(workgroup_id) wid: vec3<u32>) {
  let n = u32(res_());
  let lane = li;
  let gx = (n + 7u) / 8u;
  let wgid = wid.y * gx + wid.x;
  let wgCount = gx * gx;
  let total = n * n;
  let stride = wgCount * 64u;
  let useTmp = U.v2.w > 0.5;

  var mn = 1e30;
  var mx = -1e30;
  var k = wgid * 64u + lane;
  loop {
    if (k >= total) { break; }
    var v: f32;
    if (useTmp) { v = TMP[k]; } else { v = H[k]; }
    mn = min(mn, v);
    mx = max(mx, v);
    k += stride;
  }
  wgMin[lane] = mn;
  wgMax[lane] = mx;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (lane < s) {
      wgMin[lane] = min(wgMin[lane], wgMin[lane + s]);
      wgMax[lane] = max(wgMax[lane], wgMax[lane + s]);
    }
    workgroupBarrier();
  }
  if (lane == 0u) {
    TMP2[wgid * 2u] = wgMin[0];
    TMP2[wgid * 2u + 1u] = wgMax[0];
  }
}

@compute @workgroup_size(256, 1, 1)
fn reduceFinal(@builtin(local_invocation_index) li: u32) {
  let n = u32(U.v0.w);
  var mn = 1e30;
  var mx = -1e30;
  var k = li;
  loop {
    if (k >= n) { break; }
    mn = min(mn, TMP2[k * 2u]);
    mx = max(mx, TMP2[k * 2u + 1u]);
    k += 256u;
  }
  wgMin[li] = mn;
  wgMax[li] = mx;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (li < s) {
      wgMin[li] = min(wgMin[li], wgMin[li + s]);
      wgMax[li] = max(wgMax[li], wgMax[li + s]);
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    RED[0] = wgMin[0];
    RED[1] = wgMax[0];
  }
}
