/**
 * Small numeric / easing helpers shared by the geometry builders and the
 * animators.  Deliberately dependency-free so the whole model can also be
 * exercised from plain Node in the test-suite.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp(invLerp(a, b, v), 0, 1));
export const mix = lerp;

/** Hermite smoothstep. */
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Perlin's improved quintic — C2 continuous, used for all cycle blends. */
export const smootherstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Wrap into [0,1). */
export const wrap01 = (t) => ((t % 1) + 1) % 1;

export const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInCubic = (t) => Math.pow(clamp(t, 0, 1), 3);

/**
 * Symmetric smooth cycle pulse: 0 outside [0,1], rising/falling smoothly.
 * Used for transient events inside a cycle (foot lift-off, head thrust...).
 */
export function pulse(t, attack = 0.25, release = 0.25) {
  if (t <= 0 || t >= 1) return 0;
  if (t < attack) return smootherstep(t / attack);
  if (t > 1 - release) return smootherstep((1 - t) / release);
  return 1;
}

/** Deterministic 1-D value noise, period `p` (used for organic micro-motion). */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n) => {
    let s = Math.sin((n * 127.1 + seed * 311.7) * 43758.5453);
    return s - Math.floor(s);
  };
  const u = smootherstep(f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

/** Multi-octave noise, returns roughly [-1,1]. */
export function fbm1(x, octaves = 3, seed = 0) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise1(x * Math.pow(2, o), seed + o) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Catmull-Rom through scalar samples, uniform parameterisation. */
export function spline(samples, t) {
  const n = samples.length;
  if (n === 1) return samples[0];
  const x = clamp(t, 0, 1) * (n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const f = x - i;
  const p0 = samples[Math.max(i - 1, 0)];
  const p1 = samples[i];
  const p2 = samples[i + 1];
  const p3 = samples[Math.min(i + 2, n - 1)];
  const f2 = f * f;
  const f3 = f2 * f;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * f3)
  );
}
