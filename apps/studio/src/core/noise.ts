/**
 * Frontier noise bank — seeded, deterministic, pure 3D value/perlin noises.
 *
 * BIT-IDENTICAL PORT SPEC (for the future C++/CUDA backend):
 * - All lattice hashes go through hash3i() (imul-based 32-bit mix, seed added first).
 * - valueNoise3: quintic fade + trilinear, output [0,1].
 * - perlin3: improved-Perlin gradients selected by hash3i() & 15, output ~[-1,1].
 * - fbm/billow/ridged normalize by accumulated amplitude (see code).
 * Keep these semantics when porting; params/scenes must reproduce exactly.
 */

// ---------------------------------------------------------------- helpers
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

// ---------------------------------------------------------------- hashing
/** 32-bit lattice hash -> [0,1). Seed is mixed in first so seed 0 is valid. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(seed | 0, 374761393) + Math.imul(x | 0, 668265263) + Math.imul(y | 0, 2147483647) * 0 + Math.imul(y | 0, 1440662683) + Math.imul(z | 0, 338563691);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash1(n: number): number {
  let h = Math.imul(n | 0, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- value noise
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = quintic(xf), v = quintic(yf), w = quintic(zf);
  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w
  );
}

// ---------------------------------------------------------------- perlin noise (improved, hash-selected gradients)
function grad3(hash: number, x: number, y: number, z: number): number {
  // 12 edge gradients of a cube (classic Perlin set).
  switch (hash & 15) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x + z; case 5: return -x + z; case 6: return x - z; case 7: return -x - z;
    case 8: return y + z; case 9: return -y + z; case 10: return y - z; case 11: return -y - z;
    case 12: return x + y; case 13: return -x + y; case 14: return -y + z; case 15: return -y - z;
    default: return 0;
  }
}

function latticeHash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(seed | 0, 374761393) ^ Math.imul(x | 0, 668265263) ^ Math.imul(y | 0, 2246822519) ^ Math.imul(z | 0, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2654435761);
  h ^= h >>> 13;
  return h | 0;
}

export function perlin3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = quintic(xf), v = quintic(yf), w = quintic(zf);
  const n000 = grad3(latticeHash(xi, yi, zi, seed), xf, yf, zf);
  const n100 = grad3(latticeHash(xi + 1, yi, zi, seed), xf - 1, yf, zf);
  const n010 = grad3(latticeHash(xi, yi + 1, zi, seed), xf, yf - 1, zf);
  const n110 = grad3(latticeHash(xi + 1, yi + 1, zi, seed), xf - 1, yf - 1, zf);
  const n001 = grad3(latticeHash(xi, yi, zi + 1, seed), xf, yf, zf - 1);
  const n101 = grad3(latticeHash(xi + 1, yi, zi + 1, seed), xf - 1, yf, zf - 1);
  const n011 = grad3(latticeHash(xi, yi + 1, zi + 1, seed), xf, yf - 1, zf - 1);
  const n111 = grad3(latticeHash(xi + 1, yi + 1, zi + 1, seed), xf - 1, yf - 1, zf - 1);
  // ~[-1,1] (classic improved-Perlin range, scaled to roughly unit).
  return lerp(
    lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
    lerp(lerp(n001, n101, u), lerp(n011, n111, u), v),
    w
  ) * 0.964;
}

// ---------------------------------------------------------------- fractals
/** Fractal Brownian motion, normalized to ~[-1,1]. */
export function fbm3(x: number, y: number, z: number, octaves: number, lacunarity = 2.02, gain = 0.5, seed = 0): number {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y, fz = z;
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin3(fx, fy, fz, seed + o * 101);
    norm += amp;
    amp *= gain;
    fx *= lacunarity; fy *= lacunarity; fz *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Billow (abs-fbm), normalized to ~[0,1]. Great for clouds/dunes/soft rock. */
export function billow3(x: number, y: number, z: number, octaves: number, lacunarity = 2.0, gain = 0.5, seed = 0): number {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y, fz = z;
  for (let o = 0; o < octaves; o++) {
    sum += amp * Math.abs(perlin3(fx, fy, fz, seed + o * 131));
    norm += amp;
    amp *= gain;
    fx *= lacunarity; fy *= lacunarity; fz *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Musgrave ridged-multifractal. Weights sharpen crests per octave.
 * Output roughly [0,1] with offset=1, gain(weight)=2, amp decay 0.55.
 * THE mountain noise — used for ranges, and inverted for canyon carving.
 */
export function ridged3(
  x: number, y: number, z: number,
  octaves: number, lacunarity = 2.1, octGain = 2.0, offset = 1.0, seed = 0
): number {
  let sum = 0, amp = 0.55, norm = 0, weight = 1;
  let fx = x, fy = y, fz = z;
  for (let o = 0; o < octaves; o++) {
    let s = offset - Math.abs(perlin3(fx, fy, fz, seed + o * 171));
    s *= s;
    s *= weight;
    weight = clamp(s * octGain, 0, 1);
    sum += s * amp;
    norm += amp;
    amp *= 0.55;
    fx *= lacunarity; fy *= lacunarity; fz *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Domain warp: displaces p by 3 fbm channels. Returns into out[3]. */
export function domainWarp3(
  x: number, y: number, z: number,
  freq: number, amp: number, seed: number, out: Float32Array | number[]
): void {
  const q1 = fbm3(x * freq, y * freq, z * freq, 3, 2.0, 0.5, seed + 11);
  const q2 = fbm3(x * freq + 5.2, y * freq + 1.3, z * freq + 3.7, 3, 2.0, 0.5, seed + 47);
  const q3 = fbm3(x * freq + 8.9, y * freq + 7.1, z * freq + 2.3, 3, 2.0, 0.5, seed + 83);
  out[0] = x + amp * q1;
  out[1] = y + amp * q2;
  out[2] = z + amp * q3;
}

/** Terrace a 0..1 signal into steps with smoothed risers. sharp in [0,1]. */
export function terrace01(v: number, steps: number, sharp: number): number {
  if (steps < 2) return v;
  const t = clamp01(v) * steps;
  const i = Math.floor(t);
  const f = t - i;
  const s = smoothstep(1 - clamp01(sharp), 1, f);
  return clamp01((i + s) / steps);
}

/**
 * Geologic strata coordinate (in band units): dipping planes + warp.
 * dip: unit-ish direction of band normal (usually mostly +Y with tilt).
 */
export function strataCoord(
  x: number, y: number, z: number,
  dipX: number, dipY: number, dipZ: number,
  freq: number, warpAmp: number, warpFreq: number, seed: number
): number {
  const w = fbm3(x * warpFreq, y * warpFreq, z * warpFreq, 3, 2.1, 0.5, seed + 301);
  return (x * dipX + y * dipY + z * dipZ) * freq + warpAmp * w;
}

/** Voronoi F1/F2 in 3D, jittered. Returns [f1, f2]. */
export function voronoi3(x: number, y: number, z: number, seed: number, out: Float32Array | number[]): void {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let f1 = 8, f2 = 8;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const px = cx + hash3(cx, cy, cz, seed + 1) * 0.9 + 0.05;
        const py = cy + hash3(cx, cy, cz, seed + 2) * 0.9 + 0.05;
        const pz = cz + hash3(cx, cy, cz, seed + 3) * 0.9 + 0.05;
        const ddx = px - x, ddy = py - y, ddz = pz - z;
        const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
      }
    }
  }
  out[0] = f1; out[1] = f2;
}
