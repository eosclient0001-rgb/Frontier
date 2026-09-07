// ===========================================================================
//  sim_common.wgsl — shared state for the erosion simulation.
//
//  All hydraulic state lives in ONE storage buffer. WebGPU's default limit is
//  8 storage buffers per shader stage, so packing a struct-of-arrays into a
//  single binding keeps every pass comfortably within budget and keeps the
//  bind group layout identical across all sim passes.
//
//  64 bytes per cell, laid out in four 16-byte rows so the std430 rules put
//  everything exactly where the CPU expects it.
// ===========================================================================

#include "volume.wgsl"

struct SimCell {
  // --- row 0 ---
  h:        f32,   // terrain surface height (bedrock + regolith), metres
  water:    f32,   // water depth, metres
  sed:      f32,   // suspended sediment concentration
  reg:      f32,   // loose regolith / talus thickness, metres

  // --- row 1 ---
  flux:     vec4f, // outflow flux to -X, +X, -Z, +Z

  // --- row 2 ---
  vel:      vec2f, // depth-averaged flow velocity
  hard:     f32,   // rock hardness sampled at the surface
  sedNext:  f32,   // double buffer for semi-Lagrangian advection

  // --- row 3 ---
  h0:       f32,   // height as extracted from the SDF this step
  wet:      f32,   // long-run wetness (drives colour + weathering)
  flowAcc:  f32,   // smoothed discharge, for channel-aware shading
  talus:    f32,   // debris flux magnitude this step
}

@group(0) @binding(1) var  srcVol: texture_3d<f32>;
@group(0) @binding(2) var  dstVol: texture_storage_3d<rgba16float, write>;
@group(0) @binding(3) var<storage, read_write> sim: array<SimCell>;
@group(0) @binding(4) var  linSampler: sampler;

// ---------------------------------------------------------------------------
//  Volume channel helpers.
//    .r = signed distance (metres)   .g = sediment fraction
//    .b = weathering damage          .a = wetness
// ---------------------------------------------------------------------------
fn loadVox(c: vec3i) -> vec4f {
  let cc = clamp(c, vec3i(0), vec3i(VOLX - 1, VOLY - 1, VOLZ - 1));
  return textureLoad(srcVol, cc, 0);
}

fn loadD(c: vec3i) -> f32 { return loadVox(c).r; }

/// Central-difference gradient of the distance channel, in world units.
fn gradD(c: vec3i) -> vec3f {
  let dx = loadD(c + vec3i(1, 0, 0)) - loadD(c - vec3i(1, 0, 0));
  let dy = loadD(c + vec3i(0, 1, 0)) - loadD(c - vec3i(0, 1, 0));
  let dz = loadD(c + vec3i(0, 0, 1)) - loadD(c - vec3i(0, 0, 1));
  return vec3f(dx, dy, dz) / (2.0 * VOXEL_SIZE);
}

fn normalD(c: vec3i) -> vec3f {
  let g = gradD(c);
  let l = length(g);
  return select(vec3f(0.0, 1.0, 0.0), g / l, l > 1e-6);
}

/// Laplacian of the distance field ≈ mean curvature of the isosurface.
/// > 0 on convex rock (edges, spires), < 0 in concavities (alcoves, gullies).
fn curvD(c: vec3i) -> f32 {
  let cc = loadD(c);
  let lap =
      loadD(c + vec3i(1, 0, 0)) + loadD(c - vec3i(1, 0, 0))
    + loadD(c + vec3i(0, 1, 0)) + loadD(c - vec3i(0, 1, 0))
    + loadD(c + vec3i(0, 0, 1)) + loadD(c - vec3i(0, 0, 1))
    - 6.0 * cc;
  return lap / VOXEL_SIZE.x;
}

// ---------------------------------------------------------------------------
//  Sim-grid accessors
// ---------------------------------------------------------------------------
fn cellAt(c: vec2i) -> SimCell {
  return sim[simIndex(c)];
}

fn heightAt(c: vec2i) -> f32 {
  return sim[simIndex(c)].h;
}

fn waterAt(c: vec2i) -> f32 {
  return sim[simIndex(c)].water;
}

/// Water-surface elevation (terrain + depth).
fn surfaceAt(c: vec2i) -> f32 {
  let s = sim[simIndex(c)];
  return s.h + s.water;
}

/// Bilinear terrain height at a continuous sim-grid coordinate.
fn heightBilinear(f: vec2f) -> f32 {
  let i = floor(f);
  let w = f - i;
  let b = vec2i(i);
  let h00 = heightAt(b + vec2i(0, 0));
  let h10 = heightAt(b + vec2i(1, 0));
  let h01 = heightAt(b + vec2i(0, 1));
  let h11 = heightAt(b + vec2i(1, 1));
  return mix(mix(h00, h10, w.x), mix(h01, h11, w.x), w.y);
}

fn waterBilinear(f: vec2f) -> f32 {
  let i = floor(f);
  let w = f - i;
  let b = vec2i(i);
  let h00 = waterAt(b + vec2i(0, 0));
  let h10 = waterAt(b + vec2i(1, 0));
  let h01 = waterAt(b + vec2i(0, 1));
  let h11 = waterAt(b + vec2i(1, 1));
  return mix(mix(h00, h10, w.x), mix(h01, h11, w.x), w.y);
}

/// Terrain normal from the working heightfield.
fn terrainNormal(c: vec2i) -> vec3f {
  let hl = heightAt(c - vec2i(1, 0));
  let hr = heightAt(c + vec2i(1, 0));
  let hd = heightAt(c - vec2i(0, 1));
  let hu = heightAt(c + vec2i(0, 1));
  return normalize(vec3f(
    (hl - hr) / (2.0 * SIM_CELL.x),
    1.0,
    (hd - hu) / (2.0 * SIM_CELL.y),
  ));
}

/// Where the trunk river enters the domain (matches init_terrain.wgsl).
fn inflowCenterX(z: f32) -> f32 {
  let t = z / WORLD_D;
  var x = 0.5 * WORLD_W;
  x += U.meander * WORLD_W * 0.5 * sin(t * TAU * U.meanderFreq + U.seed * 0.7);
  x += U.meander * WORLD_W * 0.22 * sin(t * TAU * U.meanderFreq * 2.31 + U.seed * 2.1);
  return x;
}
