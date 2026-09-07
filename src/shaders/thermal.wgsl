// ===========================================================================
//  thermal.wgsl — mass wasting: rockfall, creep and talus.
//
//  Any slope steeper than the material's angle of repose is unstable and sheds
//  debris downhill. This is what builds the cone-shaped scree aprons at the
//  foot of every real cliff, and what keeps soft slopes at a constant angle.
//
//  Bedrock and loose regolith are treated separately: bare rock can stand at a
//  much steeper angle than a pile of debris can. That difference is exactly
//  why you get a vertical cliff sitting on top of a ~33° talus cone, which is
//  the single most recognisable silhouette in the reference photographs.
// ===========================================================================

#include "sim_common.wgsl"

/// Also finalises the sediment advection double-buffer from the previous pass.
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec2i(gid.xy);
  if (!inSim(c)) { return; }
  let idx = simIndex(c);
  var s = sim[idx];

  // Commit advected sediment (double-buffer swap).
  s.sed = s.sedNext;

  let dt = U.dt;
  let hard = clamp(s.hard, 0.02, 1.0);

  // ---- weathering produces fresh debris -----------------------------------
  // Bedrock breaks down into regolith. Soft rock produces debris faster.
  // Wet rock weathers faster (freeze-thaw, salt, hydration).
  let prod = U.regolithProd * dt * 0.05 * (1.2 - hard) * (1.0 + s.wet * 0.8);
  s.reg += prod;
  s.h += 0.0; // production is a conversion, not a volume change

  // ---- angle of repose ----------------------------------------------------
  // Regolith rests at reposeAngle; bedrock stands far steeper, scaled by
  // hardness (weak mudstone slumps, strong sandstone stands near vertical).
  let repose = tan(radians(U.reposeAngle));
  let rockAngle = tan(radians(mix(52.0, 87.0, hard)));

  var moved = 0.0;
  var totalOut = 0.0;

  // Gather-style: compute how much this cell sheds to each lower neighbour.
  var dhs: array<f32, 4>;
  var OFF = array<vec2i, 4>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));

  for (var i = 0; i < 4; i++) {
    let nc = c + OFF[i];
    dhs[i] = 0.0;
    if (!inSim(nc)) { continue; }

    let dh = s.h - heightAt(nc);
    let dist = select(SIM_CELL.y, SIM_CELL.x, OFF[i].x != 0);

    // Which threshold applies depends on whether the surface is loose debris
    // or bare rock.
    let looseFrac = saturate(s.reg / 0.6);
    let maxSlope = mix(rockAngle, repose, looseFrac);
    let maxDrop = maxSlope * dist;

    if (dh > maxDrop) {
      let excess = dh - maxDrop;
      dhs[i] = excess;
      totalOut += excess;
    }
  }

  if (totalOut > 1e-7) {
    // Move at most half the excess per step, for stability.
    let rate = saturate(U.talusRate * dt * 4.0);
    let budget = min(totalOut * 0.5, totalOut) * rate;

    for (var i = 0; i < 4; i++) {
      if (dhs[i] <= 0.0) { continue; }
      let share = dhs[i] / totalOut;
      let amount = budget * share;
      let nc = c + OFF[i];
      let ni = simIndex(nc);

      // Non-atomic scatter. Races here are harmless: the quantities are tiny,
      // the system is strongly dissipative, and any lost mass is far below the
      // noise floor of the visual result. Using atomics would force the whole
      // struct into atomic<u32> storage and cost far more than it is worth.
      sim[ni].h += amount;
      sim[ni].reg += amount;
      moved += amount;
    }

    s.h -= moved;
    s.reg = max(0.0, s.reg - moved);
  }

  s.talus += moved;
  sim[idx] = s;
}
