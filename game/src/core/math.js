export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep01 = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const approach = (v, target, maxDelta) =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
/** frame-rate independent exponential smoothing */
export const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export const kmh = (mps) => mps * 3.6;
