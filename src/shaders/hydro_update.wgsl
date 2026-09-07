// ===========================================================================
//  hydro_update.wgsl — shallow water, step 2: apply flux, get velocity.
// ===========================================================================

#include "sim_common.wgsl"

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec2i(gid.xy);
  if (!inSim(c)) { return; }
  let idx = simIndex(c);
  var s = sim[idx];

  let dt = U.dt;
  let lx = SIM_CELL.x;
  let lz = SIM_CELL.y;
  let area = lx * lz;

  // Inflow is the neighbour's outflow aimed at us.
  let fL = cellAt(c + vec2i(-1,  0)).flux.y; // left neighbour flowing +X
  let fR = cellAt(c + vec2i( 1,  0)).flux.x; // right neighbour flowing -X
  let fD = cellAt(c + vec2i( 0, -1)).flux.w; // down neighbour flowing +Z
  let fU = cellAt(c + vec2i( 0,  1)).flux.z; // up neighbour flowing -Z

  var inflow = fL + fR + fD + fU;

  // Walls: nothing flows in from outside the domain.
  if (c.x == 0)        { inflow -= fL; }
  if (c.x == SIMX - 1) { inflow -= fR; }
  if (c.y == 0)        { inflow -= fD; }
  if (c.y == SIMZ - 1) { inflow -= fU; }

  let outflow = s.flux.x + s.flux.y + s.flux.z + s.flux.w;
  let dV = (inflow - outflow) * dt;

  let w0 = s.water;
  var w1 = max(0.0, w0 + dV / area);

  // Depth-averaged velocity from the mean flux through the cell.
  //
  // STABILITY: v = flux / (width * depth) is singular as depth -> 0, and a
  // thin film of water over a steep slope will otherwise produce an enormous
  // velocity that drives a huge erosion spike and then a NaN. Because the sim
  // feeds back into itself, a single NaN would poison the terrain permanently.
  // So the depth used here has a hard floor, and the result is clamped to a
  // physically sane maximum.
  let wAvg = max(0.5 * (w0 + w1), 0.004);
  let vx = 0.5 * (fL - s.flux.x + s.flux.y - fR) / (lz * wAvg);
  let vz = 0.5 * (fD - s.flux.z + s.flux.w - fU) / (lx * wAvg);

  var vel = vec2f(vx, vz);
  // Reject non-finite values outright (x != x is true only for NaN).
  if (vx != vx || vz != vz) { vel = vec2f(0.0); }

  let vmax = 24.0;
  let vlen = length(vel);
  if (vlen > vmax) { vel *= vmax / vlen; }

  // Water shallower than a film carries no meaningful current.
  vel *= smoothstep(0.0, 0.006, w1);
  s.vel = vel;

  // ---- losses: evaporation + infiltration --------------------------------
  //
  // Purely multiplicative evaporation is wrong here, and visibly so: uniform
  // rain R against a loss of rate k*w equilibrates at w = R/k, i.e. a sheet of
  // standing water of uniform depth over the ENTIRE landscape. A desert looks
  // nothing like that.
  //
  // Real arid ground loses thin films almost immediately to infiltration and
  // evaporation, while a channel metres deep persists. So the loss is applied
  // as a depth-independent subtraction (a rate, not a fraction) that shallow
  // water cannot survive, plus a weak proportional term for deep water. The
  // result is dry slopes, ephemeral washes, and a perennial trunk river —
  // which is exactly the drainage pattern the reference photographs show.
  let infiltration = U.evaporation * dt * 0.35;
  w1 = max(0.0, w1 - infiltration);
  w1 *= max(0.0, 1.0 - U.evaporation * dt * 0.15);

  // Guard the depth too — a NaN here would spread to every neighbour.
  if (w1 != w1) { w1 = 0.0; }
  s.water = clamp(w1, 0.0, 400.0);

  // Smoothed discharge, used later for channel-aware shading and for the
  // undercutting term. Slow decay so it reflects a persistent drainage
  // network rather than one noisy instant.
  let q = length(s.vel) * w1;
  s.flowAcc = mix(s.flowAcc, q, 0.06);

  // Long-run wetness: where water actually persists.
  let wetTarget = saturate(w1 * 8.0);
  s.wet = mix(s.wet, wetTarget, 0.03);

  sim[idx] = s;
}
