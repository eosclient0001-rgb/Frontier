/* ============================================================
 * Frontier · SDF Terrain Lab — Noise foundation
 * Seeded 2D Perlin (gradient) noise, multifractal fBm,
 * ridged multifractal, and domain warping.
 * ============================================================ */

/** Deterministic 32-bit PRNG (mulberry32). Returns () => [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a seed with a salt to derive independent streams. */
export function subseed(seed, salt) {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const GRAD2 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071],
  [0.7071, -0.7071], [-0.7071, -0.7071],
];

/** Classic 2D Perlin gradient noise. Returns roughly [-1, 1]. */
export class Perlin2D {
  constructor(seed) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x, y) {
    const perm = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);

    const aa = perm[perm[X] + Y] & 7;
    const ba = perm[perm[X + 1] + Y] & 7;
    const ab = perm[perm[X] + Y + 1] & 7;
    const bb = perm[perm[X + 1] + Y + 1] & 7;

    const g = (gi, dx, dy) => GRAD2[gi][0] * dx + GRAD2[gi][1] * dy;
    const n00 = g(aa, x, y);
    const n10 = g(ba, x - 1, y);
    const n01 = g(ab, x, y - 1);
    const n11 = g(bb, x - 1, y - 1);

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  }
}

/**
 * Multifractal Brownian motion (fBm) — sum of gradient noise octaves.
 * Returns roughly [-1, 1] (normalized by the max possible amplitude).
 */
export function fbm(p, x, y, { octaves = 5, lacunarity = 2.0, gain = 0.5 } = {}) {
  let amp = 1.0, freq = 1.0, sum = 0.0, norm = 0.0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * p.noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / Math.max(norm, 1e-6);
}

/**
 * Ridged multifractal — sharp crests. Returns roughly [0, 1].
 */
export function ridged(p, x, y, { octaves = 5, lacunarity = 2.0, gain = 0.5, offset = 1.0, sharp = 2.0 } = {}) {
  let amp = 0.5, freq = 1.0, sum = 0.0, norm = 0.0;
  for (let o = 0; o < octaves; o++) {
    let n = 1.0 - Math.abs(p.noise(x * freq, y * freq));
    n = n * n;
    sum += amp * n * (offset + 0.3);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  const v = sum / Math.max(norm, 1e-6);
  return Math.min(1, Math.max(0, v));
}

/**
 * Domain warp: displaces sample coordinates with low-frequency noise
 * so ridges/blobs read as organic rather than grid-like.
 * Returns [wx, wy].
 */
export function warpCoords(p, x, y, { amount = 0.5, scale = 1.0, seed = 0 } = {}) {
  const pw = new Perlin2D(subseed(p.seed ?? 1, 777 + (seed | 0)));
  const s = scale;
  return [
    x + amount * 1.6 * pw.noise(x * s + 31.4, y * s - 17.8),
    y + amount * 1.6 * pw.noise(x * s - 51.2, y * s + 44.9),
  ];
}

/** Convenience: fbm remapped to [0,1]. */
export function fbm01(p, x, y, opts) {
  return fbm(p, x, y, opts) * 0.5 + 0.5;
}
