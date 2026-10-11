// =================================================================================================

#include "atmosphere.wgsl"
//  sky-sh.wgsl — project sky radiance onto nine spherical harmonics
// -------------------------------------------------------------------------------------------------
//  This is the terrain's ambient light: valleys facing away from the sun really are cooler than
//  scree facing it, instead of everything being lit by one flat hemisphere term.
//
//  The solar disc is deliberately excluded — it subtends 0.00006 sr and would alias badly at any
//  practical sample count. Direct sun light is evaluated analytically in the terrain shader.
// =================================================================================================

// --- pass 2: sky irradiance as spherical harmonics -------------------------------------------------

@group(0) @binding(0) var<uniform> P2: AtmoParams;
@group(0) @binding(1) var transLut: texture_2d<f32>;
@group(0) @binding(2) var lutSampler: sampler;
@group(0) @binding(3) var<storage, read_write> SH: SkySH;

var<workgroup> partial: array<vec3f, 64>;

fn basis(dir: vec3f, k: i32) -> f32 {
  let x = dir.x;
  let y = dir.y;
  let z = dir.z;
  if (k == 0) { return 0.282095; }
  if (k == 1) { return 0.488603 * y; }
  if (k == 2) { return 0.488603 * z; }
  if (k == 3) { return 0.488603 * x; }
  if (k == 4) { return 1.092548 * x * y; }
  if (k == 5) { return 1.092548 * y * z; }
  if (k == 6) { return 0.315392 * (3.0 * z * z - 1.0); }
  if (k == 7) { return 1.092548 * x * z; }
  return 0.546274 * (x * x - y * y);
}

@compute @workgroup_size(64)
fn irradianceSH(
  @builtin(workgroup_id) wid: vec3u,
  @builtin(local_invocation_index) tid: u32
) {
  let k = i32(wid.x);
  let steps = max(i32(P2.p5.y), 4);
  let refAlt = P2.p5.z;
  let dTheta = 3.14159265 / f32(THETA_N);
  let dPhi = 6.28318531 / f32(PHI_N);
  let perThread = DIR_TOTAL / i32(SH_THREADS);

  var acc = vec3f(0.0);
  for (var s = 0; s < perThread; s = s + 1) {
    let index = i32(tid) + s * i32(SH_THREADS);
    if (index >= DIR_TOTAL) { break; }
    let ti = index / PHI_N;
    let pj = index - ti * PHI_N;
    let theta = (f32(ti) + 0.5) * dTheta;
    let phi = (f32(pj) + 0.5) * dPhi;
    let st = sin(theta);
    let dir = vec3f(st * cos(phi), cos(theta), st * sin(phi));
    // Solid angle of this cell.
    let dw = st * dTheta * dPhi;
    // The lower hemisphere belongs to the terrain, not the sky; fade it out and let the ground
    // bounce term carry that energy.
    let horizon = smoothstep(-0.12, 0.08, dir.y);
    if (horizon <= 0.0) { continue; }
    let L = skyRadiance(transLut, lutSampler, P2, refAlt, dir, steps, false);
    acc = acc + L * basis(dir, k) * dw * horizon;
  }

  partial[tid] = acc;
  workgroupBarrier();

  if (tid == 0u) {
    var total = vec3f(0.0);
    for (var i = 0u; i < SH_THREADS; i = i + 1u) {
      total = total + partial[i];
    }
    SH.c[k] = vec4f(total, 0.0);
  }
}
