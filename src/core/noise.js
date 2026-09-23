// ============================================================================
//  noise.js — seeded gradient (Perlin) noise + multifractal builders
//  Pure ES module, no DOM. Used by both the browser worker and the Node harness.
// ============================================================================

/** Small, fast, seedable PRNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D gradient (Perlin) noise with a shuffled permutation table. */
export class GradientNoise2D {
  constructor(seed = 1337) {
    const rng = makeRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod8[i] = this.perm[i] & 7;
    }
  }

  /** Raw Perlin noise in [-1, 1]. */
  perlin(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const fx = x - X, fy = y - Y;
    const u = fade(fx), v = fade(fy);
    const xi = X & 255, yi = Y & 255;
    const perm = this.perm, pm8 = this.permMod8;

    const aa = pm8[perm[xi + perm[yi]]],
          ba = pm8[perm[xi + 1 + perm[yi]]],
          ab = pm8[perm[xi + perm[yi + 1]]],
          bb = pm8[perm[xi + 1 + perm[yi + 1]]];

    const x1 = lerp(grad2(aa, fx, fy),     grad2(ba, fx - 1, fy),     u);
    const x2 = lerp(grad2(ab, fx, fy - 1), grad2(bb, fx - 1, fy - 1), u);
    return lerp(x1, x2, v) * 1.1; // slight gain to reach ~[-1,1]
  }
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }
const GRAD_X = [1, -1, 1, -1, 0.7071, -0.7071, 0.7071, -0.7071];
const GRAD_Y = [0, 0, 1, 1, 0.7071, 0.7071, -0.7071, -0.7071];
function grad2(h, x, y) { return GRAD_X[h] * x + GRAD_Y[h] * y; }

// ---------------------------------------------------------------------------
//  Fractal builders. All operate on world-space metres.
// ---------------------------------------------------------------------------

/** Plain fractal Brownian motion. */
export function fbm(noise, x, y, { octaves = 6, lacunarity = 2.0, gain = 0.5, rot = 0.5 } = {}) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.perlin(x * freq + rot * 17.13 * o, y * freq - rot * 9.7 * o);
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/**
 * Ridged multifractal (Musgrave-style). Sharp ridge crests where the gradient
 * noise crosses zero; successive octaves are gated by a running "weight" so
 * crests break up realistically instead of forming a self-similar pattern.
 */
export function ridgedMultifractal(noise, x, y, { octaves = 6, lacunarity = 2.0, gain = 0.5, offset = 0.9, rot = 0.5 } = {}) {
  let sum = 0, amp = 1, freq = 1, weight = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1.0 - Math.abs(noise.perlin(x * freq + rot * 31.7 * o, y * freq - rot * 23.3 * o));
    n *= n;                     // sharpen crests
    n *= weight;
    weight = Math.min(1, Math.max(0, n * gain * 2.0));
    sum += n * amp;
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;            // ~[0,1], 1 at ridge crests
}

/** Hybrid multifractal — rolling basins with occasional sharp ridges. */
export function hybridMultifractal(noise, x, y, { octaves = 6, lacunarity = 2.0, gain = 0.5, offset = 0.75, rot = 0.5 } = {}) {
  let freq = 1, amp = 1, norm = 0, result = 0, weight = 1, signal;
  for (let o = 0; o < octaves; o++) {
    let n = noise.perlin(x * freq + rot * 13.1 * o, y * freq - rot * 7.9 * o) * 0.5 + 0.5;
    signal = offset - Math.abs(n - offset) * 2.0;
    signal *= signal;
    signal *= weight;
    weight = Math.min(1, Math.max(0, signal * gain * 2.4));
    result += signal * amp;
    norm += amp;
    freq *= lacunarity; amp *= gain;
  }
  return Math.min(1, Math.max(0, result / norm));
}

/**
 * Two-channel domain warp — bends field lines so ridges meander like real
 * drainage instead of running in one direction.
 */
export function warp2(noise, x, y, amp) {
  const wx = noise.perlin(x * 0.77 + 11.3, y * 0.77 - 4.7);
  const wy = noise.perlin(x * 0.77 - 8.1, y * 0.77 + 5.9);
  return [x + wx * amp, y + wy * amp];
}

/**
 * Super-elliptical peak mask. p=2 -> round dome, p>2 -> squarer ridged massif.
 * Returns 1 at the centre, 0 at radius r.
 */
export function peakMask(dx, dz, r, p) {
  const q = Math.pow(
    Math.pow(Math.abs(dx) / r, p) + Math.pow(Math.abs(dz) / r, p), 1.0 / p);
  let m = 1.0 - q;
  return m < 0 ? 0 : (m > 1 ? 1 : m * m * (3 - 2 * m) * m); // smooth, slightly shouldered
}
