/**
 * gait.js — Speed-parameterised gait model for an adult Tyrannosaurus.
 *
 * Instead of cross-fading canned clips (which causes foot sliding and
 * "moonwalking" mid-transition), every gait parameter is a smooth function of
 * forward speed.  Walk → fast walk → run is therefore one continuum, and the
 * transition happens exactly where the biomechanics says it should:
 *
 *   • Froude number Fr = v² / (g·h), hip height h ≈ 3.06 m.
 *     Bipeds switch from walking to running near Fr ≈ 0.5-1.0; for this
 *     animal Fr = 1 at ≈ 5.4 m/s (Hutchinson 2004: "~5.0 m/s at Fr = 1").
 *   • Duty factor (fraction of the stride a foot is on the ground) > 0.5 is
 *     walking (double support), < 0.5 is running (aerial phase).  Sellers et
 *     al. 2017 (PeerJ 3420) found aerial phases only above ~5 m/s and a
 *     stress-limited top speed of ~7.7 m/s — we cap "run" at 7.2 m/s.
 *   • Walking uses inverted-pendulum mechanics: hips are HIGHEST at
 *     mid-stance.  Running uses spring-mass mechanics: hips are LOWEST at
 *     mid-stance.  The bob sign flips across the transition band.
 *   • Stride length follows trackway-derived values: ~3.4 m at a normal walk
 *     (T. rex tracks, Lockley & Hunt 1994 give min. stride 5.6 m for a fast
 *     walker), ~6.6 m at a run.
 */

export const G = 9.81;
export const HIP_HEIGHT = 3.06;

/**
 * Key poses along the speed axis.
 *   v       forward speed (m/s)
 *   T       stride period (s) — one full cycle, both feet
 *   duty    duty factor
 *   bob     vertical pelvis oscillation amplitude (m)
 *   crouch  mean pelvis drop relative to standing (m)
 *   stepH   swing-foot clearance (m)
 *   pitch   whole-body forward lean (deg, negative = nose down)
 *   sway    lateral pelvis sway amplitude (m)
 *   yaw     pelvic yaw amplitude (deg)
 *   roll    pelvic roll amplitude (deg)
 *   mtSwing extra metatarsal flexion in swing (deg)
 *   tail    tail lateral-wave amplitude (deg per joint, base)
 *   neck    neck lowering (deg, summed over the chain)
 */
export const GAIT_KEYS = [
  { v: 0.0, T: 1.90, duty: 0.70, bob: 0.000, crouch: 0.00, stepH: 0.20, pitch: 0.0, sway: 0.030, yaw: 1.5, roll: 1.0, mtSwing: 16, tail: 0.25, neck: 0 },
  { v: 1.0, T: 1.80, duty: 0.68, bob: 0.030, crouch: 0.02, stepH: 0.22, pitch: -0.5, sway: 0.050, yaw: 3.0, roll: 1.6, mtSwing: 18, tail: 0.45, neck: -2 },
  { v: 2.2, T: 1.55, duty: 0.64, bob: 0.045, crouch: 0.04, stepH: 0.26, pitch: -1.2, sway: 0.055, yaw: 4.0, roll: 2.0, mtSwing: 20, tail: 0.55, neck: -4 },
  { v: 3.5, T: 1.30, duty: 0.57, bob: 0.050, crouch: 0.07, stepH: 0.32, pitch: -2.5, sway: 0.050, yaw: 4.5, roll: 2.2, mtSwing: 20, tail: 0.55, neck: -7 },
  { v: 5.0, T: 1.08, duty: 0.47, bob: 0.075, crouch: 0.12, stepH: 0.38, pitch: -4.5, sway: 0.040, yaw: 5.0, roll: 2.0, mtSwing: 24, tail: 0.50, neck: -11 },
  { v: 7.2, T: 0.94, duty: 0.40, bob: 0.105, crouch: 0.16, stepH: 0.44, pitch: -6.5, sway: 0.030, yaw: 5.5, roll: 1.6, mtSwing: 28, tail: 0.45, neck: -15 },
];

export const WALK_SPEED = 2.2;
export const RUN_SPEED = 7.2;
export const MAX_SPEED = GAIT_KEYS[GAIT_KEYS.length - 1].v;

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Interpolate every parameter at speed v (monotone piecewise cubic-ish). */
export function gaitAt(v) {
  v = clamp(v, 0, MAX_SPEED);
  let i = 0;
  while (i < GAIT_KEYS.length - 2 && v > GAIT_KEYS[i + 1].v) i++;
  const a = GAIT_KEYS[i], b = GAIT_KEYS[i + 1];
  let t = (v - a.v) / (b.v - a.v);
  t = t * t * (3 - 2 * t) * 0.5 + t * 0.5;          // gentle ease, still monotone
  const out = {};
  for (const k of Object.keys(a)) out[k] = lerp(a[k], b[k], t);
  out.v = v;
  // bob sign: +1 inverted pendulum (walk) → -1 spring-mass (run)
  out.runW = smoothstep(3.6, 5.6, v);
  out.stride = v * out.T;                           // metres per full cycle
  out.froude = (v * v) / (G * HIP_HEIGHT);
  return out;
}

/** Human-readable gait name for the HUD. */
export function gaitName(v, duty) {
  if (v < 0.08) return 'Idle';
  if (duty >= 0.5) return v < 3.0 ? 'Walk' : 'Fast walk';
  return v < 5.8 ? 'Run (transition)' : 'Run';
}
