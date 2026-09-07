// ===========================================================================
//  erode3d.wgsl — TRUE volumetric erosion. The pass a heightmap cannot have.
//
//  Everything before this could, with effort, be done on a heightfield. This
//  pass could not. It evolves the signed-distance field directly as a level
//  set, moving the rock surface along its own normal at a locally varying
//  speed:
//
//        ∂φ/∂t = F(x) · |∇φ|
//
//  where F is the erosion rate. Because the surface is an isosurface of a full
//  3D field and not a function of (x,z), material can be removed from UNDER an
//  overhang, from the BACK of an alcove, or from the middle of a fin — and the
//  topology is free to change. Cliffs undercut and collapse; arches open,
//  widen and eventually fall. None of that is representable in 2.5D.
//
//  Five physical processes, all reading the same geology:
//
//    1. LATERAL UNDERCUTTING  — flowing water attacks the banks it touches,
//       not just the bed. Soft beds retreat beneath resistant caps. This is
//       the direct cause of overhangs and of cliff retreat by undermining.
//
//    2. DIFFERENTIAL WEATHERING — slow surface-normal retreat, inversely
//       proportional to hardness. On its own this is what carves hoodoos and
//       the stepped cliff-and-bench profile.
//
//    3. CAVERNOUS WEATHERING — salt and moisture attack concentrated in
//       concavities, which deepens hollows into true alcoves (tafoni).
//       Curvature-driven, so it is self-reinforcing exactly as in nature.
//
//    4. GRAVITATIONAL COLLAPSE — unsupported rock fails. Detected by looking
//       for air beneath rock and testing the span against the local strength.
//
//    5. AEOLIAN ABRASION — wind strips windward faces and drifts fines into
//       lee pockets.
// ===========================================================================

#include "sim_common.wgsl"

/// Fraction of the neighbourhood that is open air — a cheap ambient-exposure
/// term. Convex, exposed rock weathers faster than sheltered rock.
fn opennessAt(c: vec3i) -> f32 {
  var open = 0.0;
  var n = 0.0;
  const R = 2;
  for (var dz = -R; dz <= R; dz += 2) {
    for (var dy = -R; dy <= R; dy += 2) {
      for (var dx = -R; dx <= R; dx += 2) {
        if (dx == 0 && dy == 0 && dz == 0) { continue; }
        let d = loadD(c + vec3i(dx, dy, dz));
        open += select(0.0, 1.0, d > 0.0);
        n += 1.0;
      }
    }
  }
  return open / max(n, 1.0);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (c.x >= VOLX || c.y >= VOLY || c.z >= VOLZ) { return; }

  let vox = loadVox(c);
  var d = vox.r;
  var sedCh = vox.g;
  var damage = vox.b;
  var wetCh = vox.a;

  let p = voxelCenterToWorld(c);
  let vs = VOXEL_SIZE.x;

  // Only voxels within a narrow band of the surface need updating. This is the
  // standard narrow-band level-set optimisation and it is a large win: the
  // overwhelming majority of the volume is deep rock or open sky.
  let band = vs * 3.0;
  if (abs(d) > band) {
    // Still let deep rock dry out / stay saturated sensibly.
    textureStore(dstVol, c, vec4f(d, sedCh, damage, wetCh * 0.999));
    return;
  }

  let n = normalD(c);            // points out of the rock
  let curv = curvD(c);           // >0 convex, <0 concave
  let hard = clamp(rockHardness(p), 0.02, 1.0);
  let resist = 1.0 / (0.10 + hard * hard * 3.0);

  // Sim cell for this column.
  let sc = vec2i(clamp(c.x, 0, SIMX - 1), clamp(c.z, 0, SIMZ - 1));
  let cell = sim[simIndex(sc)];

  let dt = U.dt;
  var erode = 0.0; // metres of surface retreat this step

  // ---- 1. LATERAL UNDERCUTTING -------------------------------------------
  // The water surface in this column.
  let waterY = cell.h + cell.water;
  let above = p.y - waterY;

  if (cell.water > 0.002 && above > -vs * 2.0 && above < U.undercutReach) {
    // Attack falls off with height above the waterline: strongest at the
    // waterline itself, reaching up through the splash/capillary zone.
    let reach = 1.0 - saturate(above / max(U.undercutReach, 0.5));
    let band2 = reach * reach;

    // Only faces that actually look sideways get undercut; horizontal
    // surfaces are handled by the bed-erosion term in hydro_erode.
    let lateral = 1.0 - abs(n.y);

    // Discharge drives the attack.
    let power = cell.flowAcc * 6.0 + length(cell.vel) * cell.water * 2.0;

    erode += U.undercut * band2 * lateral * power * resist * dt * 2.2;

    wetCh = max(wetCh, reach * 0.9);
  }

  // ---- 2. DIFFERENTIAL WEATHERING ----------------------------------------
  // Slow retreat everywhere the rock is exposed, scaled by exposure.
  let openness = opennessAt(c);
  let exposure = mix(1.0, openness * 2.0, saturate(U.exposureBias));
  erode += U.weathering * resist * exposure * dt * 0.06;

  // ---- 3. CAVERNOUS WEATHERING (tafoni / alcoves) ------------------------
  // Concentrated where the surface is concave. Self-reinforcing: a hollow
  // collects moisture and salts, which deepens the hollow.
  if (curv < 0.0) {
    let concavity = saturate(-curv * vs * 4.0);
    // Needs some shelter — fully exposed faces get washed clean instead.
    let shelter = 1.0 - openness;
    erode += U.saltWeather * concavity * shelter * resist * dt * 0.5;
  }

  // ---- 4. GRAVITATIONAL COLLAPSE -----------------------------------------
  // Look downward for unsupported rock. If a voxel of rock has a substantial
  // void beneath it, the span it must bridge is compared against the strength
  // of the rock. Beyond that, it fails.
  if (d < 0.0) {
    var voidDepth = 0.0;
    var isRoof = false;
    for (var k = 1; k <= 7; k++) {
      let below = loadD(c - vec3i(0, k, 0));
      if (below > 0.0) {
        voidDepth += vs;
        isRoof = true;
      } else if (k <= 2) {
        break; // supported directly underneath
      }
    }

    if (isRoof && voidDepth > vs) {
      // Strength scales with hardness; the threshold slider sets how much
      // unsupported span the rock can bear before it lets go.
      let strength = U.collapseThresh * (0.35 + hard * 1.65) * vs * 7.0;
      let overhangRatio = voidDepth / max(strength, 1e-4);
      if (overhangRatio > 1.0) {
        let fail = saturate(overhangRatio - 1.0);
        erode += U.collapseRate * fail * dt * 1.6;
      }
    }
  }

  // ---- 5. AEOLIAN ABRASION ------------------------------------------------
  if (U.aeolian > 0.0) {
    let wd = dirFromAngles(U.windDir, 0.0);
    // Windward faces (normal opposing the wind) get sand-blasted.
    let facing = saturate(-dot(n, wd));
    // Sand is carried near the ground, so abrasion is strongest low down.
    let heightFall = exp(-max(0.0, p.y - cell.h) / 14.0);
    let dryness = 1.0 - saturate(cell.wet);
    erode += U.aeolian * facing * heightFall * dryness * resist * dt * 0.09;

    // Lee-side deposition: fines drift into sheltered pockets.
    let lee = saturate(dot(n, wd)) * saturate(-curv * vs * 2.0);
    erode -= U.aeolian * lee * heightFall * dryness * dt * 0.03;
  }

  // ---- integrate ----------------------------------------------------------
  // Level-set update. |∇φ| ≈ 1 for a well-formed SDF, so advancing the
  // interface by `erode` metres is just adding it to the distance.
  let maxStep = vs * 0.6; // CFL-style clamp: never move more than a voxel
  if (erode != erode) { erode = 0.0; }   // NaN guard
  let step = clamp(erode, -maxStep, maxStep);
  d += step;

  // Accumulate weathering damage where material was removed. Used by the
  // renderer to darken/roughen worked surfaces.
  damage = saturate(damage + max(step, 0.0) / max(vs, 1e-4) * 0.12);

  // Track sediment cover from the hydraulic layer.
  if (abs(p.y - cell.h) < vs * 2.0) {
    sedCh = mix(sedCh, saturate(cell.reg * 1.6), 0.06);
    wetCh = mix(wetCh, saturate(cell.wet), 0.05);
  } else {
    wetCh *= 0.995;
  }

  // Keep the world inside its box.
  d = max(d, domainSDF(p));

  textureStore(dstVol, c, vec4f(d, sedCh, damage, wetCh));
}
