/**
 * Math & Procedural Noise Engine
 * Provides seeded PRNG, Simplex/Perlin-style gradient noise, multi-octave fBm,
 * ridged multifractal noise, 3D domain warping, and Voronoi cell noise.
 */

export function createPRNG(seed = 1337) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Permutation table for gradient noise
function buildPermTable(seed = 1337) {
  const rng = createPRNG(seed);
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    p[i] = perm[i & 255];
  }
  return p;
}

// 3D gradients
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1],
];

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + t * (b - a);
}

function grad3D(hash, x, y, z) {
  const g = GRAD3[hash & 15];
  return g[0] * x + g[1] * y + g[2] * z;
}

export class NoiseGenerator {
  constructor(seed = 1337) {
    this.seed = seed;
    this.p = buildPermTable(seed);
  }

  noise2D(x, y) {
    return this.noise3D(x, y, 0.5);
  }

  noise3D(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const fz = z - Math.floor(z);

    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);

    const p = this.p;
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;

    return lerp(
      lerp(
        lerp(grad3D(p[AA], fx, fy, fz), grad3D(p[BA], fx - 1, fy, fz), u),
        lerp(grad3D(p[AB], fx, fy - 1, fz), grad3D(p[BB], fx - 1, fy - 1, fz), u),
        v
      ),
      lerp(
        lerp(grad3D(p[AA + 1], fx, fy, fz - 1), grad3D(p[BA + 1], fx - 1, fy, fz - 1), u),
        lerp(grad3D(p[AB + 1], fx, fy - 1, fz - 1), grad3D(p[BB + 1], fx - 1, fy - 1, fz - 1), u),
        v
      ),
      w
    );
  }

  /**
   * Fractional Brownian Motion (fBm)
   */
  fBm2D(x, y, octaves = 6, lacunarity = 2.0, gain = 0.5) {
    let sum = 0;
    let amp = 1.0;
    let freq = 1.0;
    let maxAmp = 0;

    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2D(x * freq, y * freq);
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / maxAmp;
  }

  fBm3D(x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let sum = 0;
    let amp = 1.0;
    let freq = 1.0;
    let maxAmp = 0;

    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise3D(x * freq, y * freq, z * freq);
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / maxAmp;
  }

  /**
   * Ridged Multifractal Noise (creates sharp knife-edge arêtes and mountain crests)
   */
  ridged2D(x, y, octaves = 6, lacunarity = 2.0, gain = 0.5, sharpness = 2.0) {
    let sum = 0;
    let amp = 1.0;
    let freq = 1.0;
    let maxAmp = 0;
    let weight = 1.0;

    for (let i = 0; i < octaves; i++) {
      let n = Math.abs(this.noise2D(x * freq, y * freq));
      n = 1.0 - n;
      n = Math.pow(n, sharpness);
      n *= weight;
      weight = Math.min(1.0, Math.max(0.0, n * 2.0));

      sum += amp * n;
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / maxAmp;
  }

  /**
   * Domain Warped Noise for organic alpine formations
   */
  warpedNoise2D(x, y, warpAmp = 0.35, warpFreq = 1.0) {
    const qx = this.noise2D(x * warpFreq, y * warpFreq);
    const qy = this.noise2D(x * warpFreq + 5.2, y * warpFreq + 1.3);

    const rx = this.noise2D((x + warpAmp * qx) * warpFreq + 1.7, (y + warpAmp * qy) * warpFreq + 9.2);
    const ry = this.noise2D((x + warpAmp * qx) * warpFreq + 8.3, (y + warpAmp * qy) * warpFreq + 2.8);

    return this.noise2D(x + warpAmp * rx, y + warpAmp * ry);
  }

  /**
   * Voronoi / Cellular noise for rock joints and crack structures
   */
  voronoi2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    let minDist = 1e9;
    let secondDist = 1e9;

    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const hx = Math.sin(cx * 127.1 + cy * 311.7 + this.seed) * 43758.5453123;
        const hy = Math.sin(cx * 269.5 + cy * 183.3 + this.seed) * 43758.5453123;
        const px = i + (hx - Math.floor(hx));
        const py = j + (hy - Math.floor(hy));
        const d = Math.hypot(px - fx, py - fy);

        if (d < minDist) {
          secondDist = minDist;
          minDist = d;
        } else if (d < secondDist) {
          secondDist = d;
        }
      }
    }
    return { d1: minDist, d2: secondDist, edge: secondDist - minDist };
  }
}
