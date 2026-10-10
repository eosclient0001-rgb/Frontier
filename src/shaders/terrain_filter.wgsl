// ─────────────────────────────────────────────────────────────────────────────
//  Terrain filters — operators that reshape the existing height field.
//  Every filter writes into S; the host copies S back into H afterwards, so
//  each one stays a clean single-input / single-output pass.
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

fn slopeAngle(uv: vec2<f32>) -> f32 {
  let r = f32(res_());
  let d = 1.0 / r;
  let hl = sampleField(&H, uv - vec2<f32>(d, 0.0), r);
  let hr = sampleField(&H, uv + vec2<f32>(d, 0.0), r);
  let hd = sampleField(&H, uv - vec2<f32>(0.0, d), r);
  let hu = sampleField(&H, uv + vec2<f32>(0.0, d), r);
  let k = U.v1.w / (2.0 / r) / U.v1.z;
  let gx = (hr - hl) * k;
  let gz = (hu - hd) * k;
  return atan2(sqrt(gx * gx + gz * gz), 1.0);
}

fn curvatureAt(uv: vec2<f32>) -> f32 {
  let r = f32(res_());
  let d = 1.0 / r;
  let hc = sampleField(&H, uv, r);
  let hl = sampleField(&H, uv - vec2<f32>(d, 0.0), r);
  let hr = sampleField(&H, uv + vec2<f32>(d, 0.0), r);
  let hd = sampleField(&H, uv - vec2<f32>(0.0, d), r);
  let hu = sampleField(&H, uv + vec2<f32>(0.0, d), r);
  return sat(0.5 + 0.5 * clamp((hl + hr + hd + hu - 4.0 * hc) * 24.0, -1.0, 1.0));
}

fn auxAt(i: i32, c: i32) -> f32 { return AUX[i * 4 + c]; }

fn maskWeight(uv: vec2<f32>, i: i32) -> f32 {
  let lp = LP[U.v0.y];
  if (lp.f.z == 0u) { return sat(lp.a[8].x); }
  var c: MaskCtx;
  c.h = H[i];
  c.slope = sat(slopeAngle(uv) / (PI * 0.5));
  c.curv = curvatureAt(uv);
  c.flow = auxAt(i, 0);
  c.deposit = auxAt(i, 1);
  c.ao = auxAt(i, 3);
  c.aspect = 0.0;
  c.wxz = uv * U.v1.w;
  return sat(evalMask(&LP[U.v0.y].m, lp.f.z, c) * lp.a[8].x);
}

// ── blur: separable, optionally height-aware (slope blur) ────────────────────
fn blurAxis(gid: vec3<u32>, axis: i32, slopeAware: bool) -> f32 {
  let lp = LP[U.v0.y];
  let r = res_();
  let i = at(gid);
  let rad = i32(clamp(lp.a[0].x, 1.0, 64.0));
  let thr = max(lp.a[0].z, 1e-6);
  let hc = H[i];
  let src = &H;
  var acc = 0.0;
  var wsum = 0.0;
  let sigma = max(f32(rad) * 0.5, 0.5);
  for (var k = -rad; k <= rad; k++) {
    var gx = i32(gid.x);
    var gy = i32(gid.y);
    if (axis == 0) { gx += k; } else { gy += k; }
    if (gx < 0 || gy < 0 || gx >= r || gy >= r) { continue; }
    let j = gy * r + gx;
    let hj = H[j];
    var w = exp(-(f32(k) * f32(k)) / (2.0 * sigma * sigma));
    if (slopeAware) {
      let dh = abs(hj - hc) / thr;
      w *= exp(-dh * dh);
    }
    acc += hj * w;
    wsum += w;
  }
  return select(hc, acc / max(wsum, 1e-6), wsum > 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn filterBlurH(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  TMP[at(gid)] = blurAxis(gid, 0, false);
}

@compute @workgroup_size(8, 8, 1)
fn filterSlopeBlurH(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  TMP[at(gid)] = blurAxis(gid, 0, true);
}

@compute @workgroup_size(8, 8, 1)
fn filterBlurV(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let r = res_();
  let i = at(gid);
  let rad = i32(clamp(lp.a[0].x, 1.0, 64.0));
  let thr = max(lp.a[0].z, 1e-6);
  let slopeAware = lp.f.w != 0u;
  let hc = TMP[i];
  let sigma = max(f32(rad) * 0.5, 0.5);
  var acc = 0.0;
  var wsum = 0.0;
  for (var k = -rad; k <= rad; k++) {
    let gx = i32(gid.x);
    let gy = i32(gid.y) + k;
    if (gx < 0 || gy < 0 || gx >= r || gy >= r) { continue; }
    let j = gy * r + gx;
    let hj = TMP[j];
    var w = exp(-(f32(k) * f32(k)) / (2.0 * sigma * sigma));
    if (slopeAware) {
      let dh = abs(hj - hc) / thr;
      w *= exp(-dh * dh);
    }
    acc += hj * w;
    wsum += w;
  }
  let blurred = select(hc, acc / max(wsum, 1e-6), wsum > 0.0);
  let w = maskWeight(uvOf(gid), i);
  S[i] = mix(H[i], blurred, sat(w * lp.a[0].y));
}

// ── sharpen (unsharp mask on the 3x3 laplacian) ──────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn filterSharpen(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let r = res_();
  let i = at(gid);
  let uv = uvOf(gid);
  let d = 1.0 / f32(r);
  let hc = H[i];
  let hl = sampleField(&H, uv - vec2<f32>(d, 0.0), f32(r));
  let hr = sampleField(&H, uv + vec2<f32>(d, 0.0), f32(r));
  let hd = sampleField(&H, uv - vec2<f32>(0.0, d), f32(r));
  let hu = sampleField(&H, uv + vec2<f32>(0.0, d), f32(r));
  let lap = (hl + hr + hd + hu) * 0.25 - hc;
  let out = hc - lap * lp.a[0].x * 4.0;
  let w = maskWeight(uv, i);
  S[i] = mix(hc, out, sat(w));
}

// ── terrace: stepped plateaus with controllable smoothness ───────────────────
@compute @workgroup_size(8, 8, 1)
fn filterTerrace(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let i = at(gid);
  let uv = uvOf(gid);
  let steps = max(lp.a[0].x, 1.0);
  let smoothw = sat(lp.a[0].y);
  let offset = lp.a[0].z;
  let varAmt = lp.a[0].w;
  let seed = lp.a[2].x + f32(U.v0.z);

  var h = H[i];
  // per-step thickness variation keeps it from looking mechanical
  let nv = fbm2(uv * lp.a[1].x + vec2<f32>(seed * 0.31, seed * 0.77), 3.0, 2.0, 0.5).x;
  let y = (h + offset) * steps * (1.0 + nv * varAmt * 0.25);
  let fl = floor(y);
  let fr = y - fl;
  // smoothstep between steps, blended with the hard step by `smoothw`
  let soft = fr * fr * (3.0 - 2.0 * fr);
  let stepped = (fl + mix(step(0.5, fr), soft, smoothw)) / (steps * (1.0 + nv * varAmt * 0.25)) - offset;
  let w = maskWeight(uv, i);
  S[i] = mix(h, stepped, sat(w));
}

// ── curve: levels, gamma, contrast, clamp ────────────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn filterCurve(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let i = at(gid);
  let uv = uvOf(gid);
  let ib = lp.a[0].x; let iw = lp.a[0].y;
  let ob = lp.a[0].z; let ow = lp.a[0].w;
  let gamma = max(lp.a[1].x, 0.02);
  let contrast = lp.a[1].y;
  let invert = lp.a[1].z;
  let lo = lp.a[1].w; let hi = lp.a[2].x;
  let powv = max(lp.a[2].y, 0.02);

  var v = H[i];
  v = sat((v - ib) / max(iw - ib, 1e-5));
  v = sat(pow(v, gamma));
  v = sat((v - 0.5) * (1.0 + contrast) + 0.5);
  v = pow(v, powv);
  if (invert > 0.5) { v = 1.0 - v; }
  v = ob + v * (ow - ob);
  let w = maskWeight(uv, i);
  S[i] = mix(H[i], clamp(v, lo, hi), sat(w));
}

// ── snow accumulation ────────────────────────────────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn filterSnow(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let i = at(gid);
  let uv = uvOf(gid);
  let amount = lp.a[0].x;
  let line = lp.a[0].y;
  let falloff = max(lp.a[0].z, 1e-4);
  let limitDeg = lp.a[0].w;
  let seed = lp.a[1].x + f32(U.v0.z);
  let variation = lp.a[1].y;
  let melt = lp.a[1].z;

  let h = H[i];
  let sl = slopeAngle(uv);
  let alt = smoothstep(line - falloff, line + falloff, h);
  let ang = 1.0 - smoothstep(limitDeg - 0.18, limitDeg + 0.12, sl);
  let drift = fbm2(uv * lp.a[1].w * 8.0 + vec2<f32>(seed * 0.71, seed * 0.29), 4.0, 2.0, 0.5).x;
  let flowm = auxAt(i, 0);
  var acc = amount * alt * ang * (1.0 + drift * variation);
  acc *= 1.0 - melt * sat(flowm * 1.6);
  let w = maskWeight(uv, i);
  S[i] = h + acc * sat(w);
}

// ── strata: warped sedimentary beds with eroded edges ────────────────────────
@compute @workgroup_size(8, 8, 1)
fn filterStrata(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let i = at(gid);
  let uv = uvOf(gid);
  let freq = max(lp.a[0].x, 0.5);
  let amp = lp.a[0].y;
  let warp = lp.a[0].z;
  let offset = lp.a[0].w;
  let seed = lp.a[2].x + f32(U.v0.z);
  let sharp = sat(lp.a[1].y);
  let erode = lp.a[1].z;

  let h = H[i];
  let n = fbm2(uv * lp.a[1].x + vec2<f32>(seed * 0.53, seed * 0.17), 4.0, 2.0, 0.5).x;
  let y = (h + offset) * freq + n * warp;
  let fl = floor(y);
  var fr = y - fl;
  let soft = smoothstep(0.0, mix(0.02, 0.75, sharp), fr);
  let stepped = (fl + soft) / freq - offset;
  // cut the exposed bed edges back where the slope is steep
  let sl = sat(slopeAngle(uv) / (PI * 0.5));
  let cut = erode * sl * (1.0 - smoothstep(0.0, 0.25, fr));
  let out = mix(h, stepped - cut * 0.02 * freq, amp);
  let w = maskWeight(uv, i);
  S[i] = mix(h, out, sat(w));
}

// ── domain warp of the whole field ───────────────────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn filterWarp(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let i = at(gid);
  let uv = uvOf(gid);
  let freq = lp.a[0].x;
  let amp = lp.a[0].y;
  let oct = max(lp.a[0].z, 1.0);
  let seed = lp.a[2].x + f32(U.v0.z);
  let r = f32(res_());

  let n1 = fbm2(uv * freq + vec2<f32>(seed * 0.31, seed * 0.77), oct, 2.0, 0.5);
  let n2 = fbm2(uv * freq + vec2<f32>(seed * 1.13 + 19.3, seed * 0.57 - 4.1), oct, 2.0, 0.5);
  let suv = uv + vec2<f32>(n1.x, n2.x) * amp;
  let warped = sampleField(&H, suv, r);
  let w = maskWeight(uv, i);
  S[i] = mix(H[i], warped, sat(w));
}

// ── river carve: cut channels along the accumulated flow ─────────────────────
@compute @workgroup_size(8, 8, 1)
fn filterCarve(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let i = at(gid);
  let uv = uvOf(gid);
  let depth = lp.a[0].x;
  let widthK = max(lp.a[0].y, 0.05);
  let sharpen = lp.a[0].z;
  let flowN = auxAt(i, 0);
  let h = H[i];

  var carve = depth * pow(sat(flowN), widthK);
  // V-shaped valley walls where the flow is strongest
  let r = f32(res_());
  let d = 1.0 / r;
  let hl = sampleField(&H, uv - vec2<f32>(d, 0.0), r);
  let hr = sampleField(&H, uv + vec2<f32>(d, 0.0), r);
  let hd = sampleField(&H, uv - vec2<f32>(0.0, d), r);
  let hu = sampleField(&H, uv + vec2<f32>(0.0, d), r);
  let ridge = max(0.0, h - (hl + hr + hd + hu) * 0.25);
  carve += sharpen * ridge * sat(flowN * 2.0);
  let w = maskWeight(uv, i);
  S[i] = h - carve * sat(w);
}

// ── clamp / level floor ──────────────────────────────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn filterClamp(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  let lp = LP[U.v0.y];
  let i = at(gid);
  let lo = lp.a[0].x;
  let hi = lp.a[0].y;
  let soft = max(lp.a[0].z, 1e-5);
  var h = H[i];
  h = h + soft * 0.5 - soft * 0.5;   // placeholder keeps the code path simple
  let cl = clamp(h, lo, hi);
  // soft knee instead of a hard clip
  let over = h - hi;
  let under = lo - h;
  var v = cl;
  if (over > 0.0) { v = hi + soft * (1.0 - exp(-over / soft)); }
  if (under > 0.0) { v = lo - soft * (1.0 - exp(-under / soft)); }
  S[i] = v;
}

// ── copy helper (S → H) so filters stay uniform ──────────────────────────────
@compute @workgroup_size(8, 8, 1)
fn copyS2H(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (!inField(gid)) { return; }
  H[at(gid)] = S[at(gid)];
}
