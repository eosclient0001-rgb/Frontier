// ===========================================================================
//  surface.wgsl — extract the drainage surface from the 3D SDF.
//
//  Runs at the start of every simulation step. For each column it finds the
//  HIGHEST rock surface and records its height and hardness.
//
//  Why a heightfield here is not a contradiction:
//  water flows over the topmost exposed surface, so the hydraulic solver is
//  correctly a 2.5D problem. The heightfield is a transient per-step *view* of
//  the SDF, never the storage format. Everything below the top surface —
//  overhangs, arches, alcoves, caves — is untouched by this pass and lives on
//  in the volume. The genuinely 3D erosion happens in erode3d.wgsl.
// ===========================================================================

#include "sim_common.wgsl"

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec2i(gid.xy);
  if (!inSim(c)) { return; }
  let idx = simIndex(c);

  // Column of voxels for this sim cell (grids are 1:1 in XZ).
  let vx = clamp(c.x, 0, VOLX - 1);
  let vz = clamp(c.y, 0, VOLZ - 1);

  // Scan down from the top for the first sign change: + (air) -> - (rock).
  var h = 0.0;
  var found = false;
  var prevD = loadD(vec3i(vx, VOLY - 1, vz));

  for (var y = VOLY - 2; y >= 0; y--) {
    let d = loadD(vec3i(vx, y, vz));
    if (prevD > 0.0 && d <= 0.0) {
      // Linear interpolation of the zero crossing between y and y+1.
      let t = prevD / max(prevD - d, 1e-6);
      h = (f32(y + 1) + 0.5 - t) * VOXEL_SIZE.y;
      found = true;
      break;
    }
    prevD = d;
  }

  if (!found) {
    // Empty column (all air): park the surface on the floor.
    h = 0.0;
  }

  var s = sim[idx];
  s.h = h;
  s.h0 = h;

  // Hardness of the rock exposed at the surface, evaluated analytically so it
  // is exact rather than voxel-limited.
  let wp = vec3f(simCellToWorldXZ(c).x, h, simCellToWorldXZ(c).y);
  s.hard = rockHardness(wp);

  sim[idx] = s;
}
