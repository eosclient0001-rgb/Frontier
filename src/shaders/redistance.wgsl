// ===========================================================================
//  redistance.wgsl — restore the signed-distance property.
//
//  Every erosion step degrades |∇φ| = 1. Left alone the field stops being a
//  true distance function, and the ray-marcher (which trusts φ as a safe step
//  size) starts overshooting the surface and punching holes in the terrain.
//
//  This is one sweep of a Godunov-style reinitialisation:
//
//        ∂φ/∂τ = sign(φ₀) · (1 − |∇φ|)
//
//  driving |∇φ| back toward 1 while holding the zero crossing in place. A few
//  sweeps per frame is plenty to keep the field healthy without visibly
//  smoothing the geometry.
// ===========================================================================

#include "sim_common.wgsl"

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (c.x >= VOLX || c.y >= VOLY || c.z >= VOLZ) { return; }

  let vox = loadVox(c);
  let d0 = vox.r;
  let vs = VOXEL_SIZE.x;

  // Far from the surface the exact value does not matter; just keep it
  // monotone and cheap.
  if (abs(d0) > vs * 6.0) {
    textureStore(dstVol, c, vox);
    return;
  }

  // One-sided differences.
  let dxm = (d0 - loadD(c - vec3i(1, 0, 0))) / VOXEL_SIZE.x;
  let dxp = (loadD(c + vec3i(1, 0, 0)) - d0) / VOXEL_SIZE.x;
  let dym = (d0 - loadD(c - vec3i(0, 1, 0))) / VOXEL_SIZE.y;
  let dyp = (loadD(c + vec3i(0, 1, 0)) - d0) / VOXEL_SIZE.y;
  let dzm = (d0 - loadD(c - vec3i(0, 0, 1))) / VOXEL_SIZE.z;
  let dzp = (loadD(c + vec3i(0, 0, 1)) - d0) / VOXEL_SIZE.z;

  // Smoothed sign, so the zero level set does not jitter.
  let sgn = d0 / sqrt(d0 * d0 + vs * vs);

  var grad2 = 0.0;
  if (sgn > 0.0) {
    let a = max(dxm, 0.0); let b = min(dxp, 0.0);
    let e = max(dym, 0.0); let f = min(dyp, 0.0);
    let g = max(dzm, 0.0); let h = min(dzp, 0.0);
    grad2 = max(a * a, b * b) + max(e * e, f * f) + max(g * g, h * h);
  } else {
    let a = min(dxm, 0.0); let b = max(dxp, 0.0);
    let e = min(dym, 0.0); let f = max(dyp, 0.0);
    let g = min(dzm, 0.0); let h = max(dzp, 0.0);
    grad2 = max(a * a, b * b) + max(e * e, f * f) + max(g * g, h * h);
  }

  let grad = sqrt(max(grad2, 1e-12));

  // Pseudo-time step, CFL-limited.
  let dtau = 0.4 * vs;
  var d = d0 + dtau * sgn * (1.0 - grad);

  let p = voxelCenterToWorld(c);
  d = max(d, domainSDF(p));

  textureStore(dstVol, c, vec4f(d, vox.g, vox.b, vox.a));
}
