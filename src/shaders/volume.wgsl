// ===========================================================================
//  volume.wgsl — SDF volume access, sampling and gradients.
//
//  The terrain lives in a 3D signed-distance field:
//      sdf < 0  -> inside rock
//      sdf > 0  -> open air
//      sdf == 0 -> the rock surface
//
//  It is NOT a heightmap. There is exactly one height value per column in a
//  heightmap, which makes overhangs, arches, alcoves and caves unrepresentable.
//  Here the surface is an isosurface of a full 3D field, so a single vertical
//  line can enter and exit rock any number of times. Undercut cliffs and
//  natural arches are ordinary states of this representation, not special
//  cases bolted on afterwards.
// ===========================================================================

#include "geology.wgsl"

// Distances are stored in metres, in a linear r16float/r32float volume.

fn loadSDF(t: texture_3d<f32>, c: vec3i) -> f32 {
  let cc = clamp(c, vec3i(0), vec3i(VOLX - 1, VOLY - 1, VOLZ - 1));
  return textureLoad(t, cc, 0).r;
}

/// Trilinear sample of the SDF at a world position.
fn sampleSDF(t: texture_3d<f32>, s: sampler, p: vec3f) -> f32 {
  let uvw = worldToUVW(p);
  return textureSampleLevel(t, s, uvw, 0.0).r;
}

/// Trilinear sample done manually from texel loads.
/// Used in compute passes, where a filtering sampler is not always available.
fn sampleSDFManual(t: texture_3d<f32>, p: vec3f) -> f32 {
  let f = worldToVoxelF(p);
  let i = floor(f);
  let w = f - i;
  let b = vec3i(i);

  let c000 = loadSDF(t, b + vec3i(0, 0, 0));
  let c100 = loadSDF(t, b + vec3i(1, 0, 0));
  let c010 = loadSDF(t, b + vec3i(0, 1, 0));
  let c110 = loadSDF(t, b + vec3i(1, 1, 0));
  let c001 = loadSDF(t, b + vec3i(0, 0, 1));
  let c101 = loadSDF(t, b + vec3i(1, 0, 1));
  let c011 = loadSDF(t, b + vec3i(0, 1, 1));
  let c111 = loadSDF(t, b + vec3i(1, 1, 1));

  let x00 = mix(c000, c100, w.x);
  let x10 = mix(c010, c110, w.x);
  let x01 = mix(c001, c101, w.x);
  let x11 = mix(c011, c111, w.x);
  let y0 = mix(x00, x10, w.y);
  let y1 = mix(x01, x11, w.y);
  return mix(y0, y1, w.z);
}

/// Central-difference gradient in grid space (unnormalised).
fn gradSDF(t: texture_3d<f32>, c: vec3i) -> vec3f {
  let dx = loadSDF(t, c + vec3i(1, 0, 0)) - loadSDF(t, c - vec3i(1, 0, 0));
  let dy = loadSDF(t, c + vec3i(0, 1, 0)) - loadSDF(t, c - vec3i(0, 1, 0));
  let dz = loadSDF(t, c + vec3i(0, 0, 1)) - loadSDF(t, c - vec3i(0, 0, 1));
  return vec3f(dx, dy, dz) / (2.0 * VOXEL_SIZE);
}

/// Surface normal at a voxel (points away from the rock, into the air).
fn normalAt(t: texture_3d<f32>, c: vec3i) -> vec3f {
  let g = gradSDF(t, c);
  let l = length(g);
  return select(vec3f(0.0, 1.0, 0.0), g / l, l > 1e-6);
}

/// Discrete mean curvature of the isosurface, via the Laplacian of the SDF.
/// Positive on convex rock (ridges, edges, spires),
/// negative in concavities (alcoves, gullies, the inside of an arch).
/// This is what lets weathering respond to shape the way real rock does.
fn curvatureAt(t: texture_3d<f32>, c: vec3i) -> f32 {
  let center = loadSDF(t, c);
  let lap =
      loadSDF(t, c + vec3i(1, 0, 0)) + loadSDF(t, c - vec3i(1, 0, 0))
    + loadSDF(t, c + vec3i(0, 1, 0)) + loadSDF(t, c - vec3i(0, 1, 0))
    + loadSDF(t, c + vec3i(0, 0, 1)) + loadSDF(t, c - vec3i(0, 0, 1))
    - 6.0 * center;
  return lap / max(VOXEL_SIZE.x * VOXEL_SIZE.x, 1e-6);
}

// ---------------------------------------------------------------------------
//  Analytic micro-detail
//
//  Added at render time rather than baked into the grid. A 256^3 volume cannot
//  resolve centimetre-scale rock texture, but the ray-marcher can perturb the
//  surface analytically as it hits it, giving effectively unlimited detail for
//  free. Crucially the detail is driven by the SAME strata/joint fields as the
//  macro form, so it reads as one coherent rock rather than a noise overlay.
// ---------------------------------------------------------------------------
fn rockDetail(p: vec3f, n: vec3f, hardness: f32, sediment: f32) -> f32 {
  if (U.detailAmp <= 0.001) { return 0.0; }

  let f = U.detailFreq;

  // Bedding-parallel fluting: erosion picks out laminae on steep faces.
  let s = strataCoord(p);
  let lamina = sin(s * (0.55 * f)) * 0.5 + 0.5;
  let steep = 1.0 - abs(n.y);
  var d = lamina * steep * 0.85;

  // Blocky fracture-controlled relief, stronger in hard rock.
  let blocky = ridged3(p * 0.055 * f + vec3f(U.seed * 2.0), 3);
  d += blocky * (0.35 + 0.65 * hardness) * 1.15;

  // Fine granular surface, stronger in soft rock (weathers to rubble).
  let grain = fbm3(p * 0.42 * f, 3);
  d += grain * (0.9 - 0.5 * hardness) * 0.35;

  // Vertical rills on steep soft faces — rainwash channels.
  let rill = ridged2(vec2f(p.x, p.z) * 0.30 * f + vec2f(0.0, p.y * 0.02), 3);
  d += rill * steep * (1.0 - hardness) * 0.7;

  // Talus rubble. A scree apron is not a smooth ramp of sand: it is a mass of
  // loose angular blocks, and that texture is one of the most recognisable
  // things in a canyon photograph. Where the simulation has deposited
  // regolith, break the surface up with cell-noise boulders. The sediment
  // channel comes free with the SDF fetch, so this costs nothing extra.
  if (sediment > 0.01) {
    let blocks = 1.0 - voronoiEdge(p.xz * 0.55 * f + vec2f(p.y * 0.06), 0.9);
    let bedded = smoothstep(0.25, 0.75, n.y);   // rubble rests on slopes
    d += blocks * saturate(sediment) * bedded * 1.35;
  }

  return (d - 0.6) * U.detailAmp;
}

/// Detail amplitude in metres, faded out with distance so that distant rock
/// does not alias into noise and near rock stays crisp.
fn detailScale(dist: f32) -> f32 {
  let fade = 1.0 - smoothstep(U.detailDist * 0.35, U.detailDist, dist);
  return VOXEL_SIZE.x * 0.85 * fade;
}
