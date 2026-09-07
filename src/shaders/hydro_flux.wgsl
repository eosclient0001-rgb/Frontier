// ===========================================================================
//  hydro_flux.wgsl — shallow water, step 1: rain + outflow flux.
//
//  Virtual-pipe model (Mei, Decaudin & Hu 2007). Each cell is connected to its
//  four neighbours by a pipe; the flow accelerates under the hydrostatic
//  pressure difference between water SURFACE elevations. This reproduces real
//  behaviour a naive "flow downhill" rule cannot: water pools, backs up behind
//  obstacles, and spreads across flats.
// ===========================================================================

#include "sim_common.wgsl"

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec2i(gid.xy);
  if (!inSim(c)) { return; }
  let idx = simIndex(c);
  var s = sim[idx];

  let dt = U.dt;

  // ---- 1. Water input -----------------------------------------------------
  // Uniform rainfall, spatially modulated so storms are patchy rather than a
  // uniform sheet — patchiness is what carves distinct tributaries.
  let wp = simCellToWorldXZ(c);
  let stormN = fbm2(wp * 0.004 + vec2f(U.simTime * 0.02, U.seed), 3) * 0.5 + 0.5;
  let storm = mix(0.55, 1.45, stormN);
  s.water += U.rain * storm * dt;

  // Trunk river entering at the upstream (z = 0) edge, in the channel.
  if (c.y < 3) {
    let cx = inflowCenterX(0.0);
    let w = max(U.incisionWidth * WORLD_W, 4.0);
    let d = abs(wp.x - cx) / w;
    let profile = exp(-d * d * 2.5);
    s.water += U.riverInflow * profile * dt;
  }

  // ---- 2. Outflow flux ----------------------------------------------------
  // Pipe acceleration from the water-surface difference to each neighbour.
  let surf = s.h + s.water;
  let A = U.pipeArea;
  let g = U.gravity;
  let lx = SIM_CELL.x;
  let lz = SIM_CELL.y;

  var f = s.flux;

  // -X, +X, -Z, +Z
  let dhL = surf - surfaceAt(c + vec2i(-1,  0));
  let dhR = surf - surfaceAt(c + vec2i( 1,  0));
  let dhD = surf - surfaceAt(c + vec2i( 0, -1));
  let dhU = surf - surfaceAt(c + vec2i( 0,  1));

  f.x = max(0.0, f.x + dt * A * g * dhL / lx);
  f.y = max(0.0, f.y + dt * A * g * dhR / lx);
  f.z = max(0.0, f.z + dt * A * g * dhD / lz);
  f.w = max(0.0, f.w + dt * A * g * dhU / lz);

  // Closed domain: no flux out through the side walls, EXCEPT the downstream
  // edge, which is the outlet that keeps the whole system draining.
  if (c.x == 0)        { f.x = 0.0; }
  if (c.x == SIMX - 1) { f.y = 0.0; }
  if (c.y == 0)        { f.z = 0.0; }
  // c.y == SIMZ-1 keeps f.w: that is the outflow boundary.

  // ---- 3. Scale so a cell cannot drain more water than it holds ----------
  let total = (f.x + f.y + f.z + f.w) * dt;
  let avail = s.water * lx * lz;
  if (total > 1e-12) {
    let k = min(1.0, avail / total);
    f *= k;
  }

  s.flux = f;
  sim[idx] = s;
}
