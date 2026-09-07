// ===========================================================================
//  hydro_erode.wgsl — erosion / deposition, and sediment advection.
//
//  Sediment transport capacity follows the classic form
//
//      C = Kc · slope · |v| · depthFactor
//
//  If the flow carries less than C it picks rock up; if it carries more it
//  drops the excess. That single asymmetry is what produces both incision in
//  steep reaches and aggradation on the valley floor — the canyon floor and
//  its point bars come out of the same rule.
//
//  The crucial addition here is that erosion is divided by ROCK HARDNESS.
//  Soft beds retreat quickly, resistant beds hold up. That single division is
//  what turns a smooth V-valley into the stepped cliff-and-bench profile of a
//  real canyon. It is the whole reason the result reads as geology.
// ===========================================================================

#include "sim_common.wgsl"

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec2i(gid.xy);
  if (!inSim(c)) { return; }
  let idx = simIndex(c);
  var s = sim[idx];

  let dt = U.dt;

  // ---- local slope --------------------------------------------------------
  let n = terrainNormal(c);
  let slope = max(sqrt(max(0.0, 1.0 - n.y * n.y)) / max(n.y, 1e-3), 0.0);
  let sinAlpha = max(slope / sqrt(1.0 + slope * slope), U.minSlope);

  let speed = length(s.vel);
  let depth = s.water;

  // Shallow, fast sheet-flow is the most erosive; very deep water shields the
  // bed (the classic "deep water protects the bed" effect).
  let depthFactor = 1.0 - exp(-depth * 6.0);
  let shield = 1.0 / (1.0 + depth * 0.35);

  // Transport capacity.
  var C = U.kCapacity * sinAlpha * speed * depthFactor * shield;
  if (depth < 1e-4) { C = 0.0; }

  // Hardness at the exposed surface: 0 = washes away, 1 = immovable.
  let hard = clamp(s.hard, 0.02, 1.0);
  // Non-linear response so the contrast between beds is emphatic. Real
  // erosion rate vs. rock strength is strongly non-linear.
  let resist = 1.0 / (0.12 + hard * hard * 2.6);

  var dh = 0.0;

  if (C > s.sed) {
    // ---- erode ----
    // Loose regolith goes first and offers no resistance — this is why talus
    // aprons get stripped before the cliff behind them is touched.
    var amount = U.kErode * (C - s.sed) * dt;
    let fromReg = min(s.reg, amount);
    s.reg -= fromReg;
    let intoRock = (amount - fromReg) * resist;

    dh = -(fromReg + intoRock);
    s.sed += fromReg + intoRock;
  } else {
    // ---- deposit ----
    let amount = U.kDeposit * (s.sed - C) * dt;
    dh = amount;
    s.sed -= amount;
    s.reg += amount; // deposited material is loose, not bedrock
  }

  // Hard clamp on how much a single step may move, and NaN rejection. The
  // simulation feeds its own output back in, so one bad value would otherwise
  // persist and spread for the rest of the session.
  if (dh != dh) { dh = 0.0; }
  dh = clamp(dh, -U.maxErode * dt * 30.0, U.maxErode * dt * 30.0);
  s.h = clamp(s.h + dh, 0.0, WORLD_H);
  s.sed = clamp(s.sed, 0.0, 32.0);
  s.reg = clamp(s.reg, 0.0, 64.0);

  s.talus = abs(dh);
  sim[idx] = s;
}
