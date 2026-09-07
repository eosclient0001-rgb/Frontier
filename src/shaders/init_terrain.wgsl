// ===========================================================================
//  init_terrain.wgsl — build the pre-erosion landform into the SDF volume.
//
//  This produces an uplifted, jointed sedimentary block with a seed drainage
//  cut into it. Everything characteristic — the cliffs, benches, talus, side
//  canyons, alcoves — is NOT authored here. It emerges from the erosion sim.
//  This pass only supplies the initial condition and the rock structure.
// ===========================================================================

#include "volume.wgsl"

@group(0) @binding(1) var dstVol: texture_storage_3d<rgba16float, write>;

/// Path of the trunk drainage across the domain, as an x offset per z.
fn riverCenterX(z: f32) -> f32 {
  let t = z / WORLD_D;
  var x = 0.5 * WORLD_W;
  x += U.meander * WORLD_W * 0.5 * sin(t * TAU * U.meanderFreq + U.seed * 0.7);
  x += U.meander * WORLD_W * 0.22 * sin(t * TAU * U.meanderFreq * 2.31 + U.seed * 2.1);
  return x;
}

/// Initial ground height, before erosion. A heightmap is a perfectly good way
/// to express the STARTING block; it is the erosion that needs 3D.
fn initialHeight(xz: vec2f) -> f32 {
  let n = xz / vec2f(WORLD_W, WORLD_D);

  var h = U.baseHeight * WORLD_H;

  // Broad uplift / plateau warping.
  h += U.upliftAmp * WORLD_H * fbm2(n * U.upliftFreq + vec2f(U.seed * 1.3, U.seed * 2.7), 4);

  // Surface roughness.
  h += U.initRough * WORLD_H * fbm2(n * 9.0 + vec2f(U.seed * 5.1), 5);

  // Seed incision: a meandering trench that erosion will widen into a canyon.
  let cx = riverCenterX(xz.y);
  let d = abs(xz.x - cx) / max(U.incisionWidth * WORLD_W, 1.0);
  let cut = 1.0 - smoothstep(0.0, 1.0, d);
  h -= U.incisionDepth * WORLD_H * cut * cut;

  // Gentle downstream gradient so water has somewhere to go.
  h -= (xz.y / WORLD_D) * WORLD_H * 0.06;

  return h;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (c.x >= VOLX || c.y >= VOLY || c.z >= VOLZ) { return; }

  let p = voxelCenterToWorld(c);

  // Start from the height field: positive above ground, negative below.
  let h = initialHeight(p.xz);
  var d = p.y - h;

  // Convert to a reasonable distance estimate near the surface. The vertical
  // difference overestimates distance on steep slopes; dividing by the
  // gradient magnitude is the standard first-order correction.
  let e = 2.0;
  let hx = initialHeight(p.xz + vec2f(e, 0.0)) - initialHeight(p.xz - vec2f(e, 0.0));
  let hz = initialHeight(p.xz + vec2f(0.0, e)) - initialHeight(p.xz - vec2f(0.0, e));
  let grad = vec3f(-hx / (2.0 * e), 1.0, -hz / (2.0 * e));
  d = d / max(length(grad), 1.0);

  // Carve joint-controlled weakness into the block from the very start, so
  // that erosion has real structural planes to exploit rather than having to
  // invent them. Only a slight geometric expression — the rest is hardness.
  let j = jointFactor(p);
  d += (1.0 - j) * VOXEL_SIZE.x * 0.9;

  // Clip to the domain box so the world is a finite diorama with clean sides.
  d = max(d, domainSDF(p));

  // .r distance  .g sediment  .b weathering damage  .a wetness
  textureStore(dstVol, c, vec4f(d, 0.0, 0.0, 0.0));
}
