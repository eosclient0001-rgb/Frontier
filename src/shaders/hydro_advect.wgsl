// ===========================================================================
//  hydro_advect.wgsl — move suspended sediment with the flow.
//
//  Semi-Lagrangian backtrace: look up where this parcel of water came srcPos and
//  take its sediment. Unconditionally stable at any time step, which matters
//  because the user is dragging sliders in real time and can pick a dt that a
//  forward-Euler advection would explode on.
// ===========================================================================

#include "sim_common.wgsl"

fn sedAt(c: vec2i) -> f32 {
  return sim[simIndex(c)].sed;
}

fn sedBilinear(f: vec2f) -> f32 {
  let i = floor(f);
  let w = f - i;
  let b = vec2i(i);
  let s00 = sedAt(b + vec2i(0, 0));
  let s10 = sedAt(b + vec2i(1, 0));
  let s01 = sedAt(b + vec2i(0, 1));
  let s11 = sedAt(b + vec2i(1, 1));
  return mix(mix(s00, s10, w.x), mix(s01, s11, w.x), w.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec2i(gid.xy);
  if (!inSim(c)) { return; }
  let idx = simIndex(c);
  var s = sim[idx];

  // Backtrace in sim-grid units.
  let vGrid = s.vel * U.dt / SIM_CELL;
  let srcPos = vec2f(c) - vGrid;
  let clamped = clamp(srcPos, vec2f(0.0), vec2f(f32(SIMX - 1), f32(SIMZ - 1)));

  var newSed = sedBilinear(clamped);

  // Diffusion smooths the concentration field and stops single-cell spikes
  // from locking in stripe artefacts along the flow direction.
  if (U.sedDiffuse > 0.0) {
    let avg = 0.25 * (
        sedAt(c + vec2i(1, 0)) + sedAt(c - vec2i(1, 0))
      + sedAt(c + vec2i(0, 1)) + sedAt(c - vec2i(0, 1)));
    newSed = mix(newSed, avg, saturate(U.sedDiffuse * U.dt * 8.0));
  }

  s.sedNext = max(0.0, newSed);
  sim[idx] = s;
}
