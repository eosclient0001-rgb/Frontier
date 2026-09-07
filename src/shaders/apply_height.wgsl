// ===========================================================================
//  apply_height.wgsl — couple the 2D hydraulic result back into the 3D SDF.
//
//  hydro_erode and thermal worked on a heightfield extracted from the volume.
//  This pass writes their net change (cell.h - cell.h0) back into the SDF,
//  but ONLY near the top surface of each column.
//
//  That restriction is the whole trick, and it is what keeps the hybrid
//  honest: the fast, well-understood 2.5D hydraulics get to drive the river
//  bed, while everything the heightfield could not see — the overhang above,
//  the alcove behind, the arch downstream — is left entirely to the 3D pass.
//  The two never fight, because they act on disjoint parts of the volume.
// ===========================================================================

#include "sim_common.wgsl"

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (c.x >= VOLX || c.y >= VOLY || c.z >= VOLZ) { return; }

  let vox = loadVox(c);
  var d = vox.r;
  let p = voxelCenterToWorld(c);
  let vs = VOXEL_SIZE.y;

  let sc = vec2i(clamp(c.x, 0, SIMX - 1), clamp(c.z, 0, SIMZ - 1));
  let cell = sim[simIndex(sc)];

  let delta = cell.h - cell.h0;

  if (abs(delta) > 1e-6) {
    // Distance from this voxel to the height surface the 2D solver knows about.
    let distToSurf = p.y - cell.h0;

    // Influence window: full effect at the surface, gone within a few voxels.
    // Below the surface it must also fade, or lowering the terrain would
    // punch a hole through a cave roof further down.
    let w = exp(-(distToSurf * distToSurf) / (2.0 * pow(vs * 1.8, 2.0)));

    if (w > 0.001) {
      // Raising terrain (deposition) pushes the isosurface up: d decreases.
      d -= delta * w;
    }
  }

  d = max(d, domainSDF(p));
  textureStore(dstVol, c, vec4f(d, vox.g, vox.b, vox.a));
}
