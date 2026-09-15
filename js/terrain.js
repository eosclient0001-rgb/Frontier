// ============================================================================
// terrain.js — pure procedural canyon heightfield generation.
// No three.js dependency: runs in the browser AND in node for testing.
//
// Pipeline:
//   seeded RNG -> river spline -> plateau + buttes + dunes -> valley carve
//   (strata-terraced) -> bed flattening -> droplet erosion (hardness-aware)
//   -> thermal erosion -> AO bake
// ============================================================================

// ------------------------------- RNG ----------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seed-derived 2D offset so every seed warps strata differently (shared with GLSL).
export function seedOffset(seed) {
  const s = Math.abs(seed | 0);
  return [(s % 89) * 1.71 + 3.1, (s % 57) * 2.33 + 7.7];
}

// --------- Shared integer-hash value noise (MUST match canyonMaterial.js) ---
// Used ONLY for the strata warp so CPU hardness and GPU color bands align.
export function makeSharedNoise() {
  function h2(ix, iy) {
    let x = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x = (x ^ (x >>> 16)) >>> 0;
    return x / 4294967296;
  }
  function noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm3(x, y) {
    return 0.5 * noise2(x, y)
         + 0.3 * noise2(x * 2.03 + 11.7, y * 2.03 + 5.3)
         + 0.2 * noise2(x * 4.11 + 7.9, y * 4.11 + 3.1);
  }
  return { noise2, fbm3 };
}

// --------------------------- Perlin (shapes) --------------------------------
export class Perlin2 {
  constructor(rand) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }
  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y; case 1: return x - y;
      case 2: return -x + y; case 3: return -x - y;
      case 4: return x; case 5: return -x;
      case 6: return y; default: return -y;
    }
  }
  noise(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xi = X & 255, yi = Y & 255;
    x -= X; y -= Y;
    const u = this.fade(x), v = this.fade(y);
    const p = this.p;
    const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
    const x1 = lerp(this.grad(aa, x, y), this.grad(ba, x - 1, y), u);
    const x2 = lerp(this.grad(ab, x, y - 1), this.grad(bb, x - 1, y - 1), u);
    return lerp(x1, x2, v) * 1.41421356;
  }
}

export function fbmP(perlin, x, y, oct = 4, lac = 2.02, gain = 0.5) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * perlin.noise(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}

export function ridgedP(perlin, x, y, oct = 3, lac = 2.1, gain = 0.5) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(perlin.noise(x * f, y * f))); n += a; a *= gain; f *= lac; }
  return s / n;
}

// ------------------------------ helpers -------------------------------------
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
export const lerp = (a, b, t) => a + (b - a) * t;
// smoothstep that also works when a > b (reversed edges)
export function sstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function distToSegT(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return { d: Math.sqrt(qx * qx + qz * qz), t };
}
function distToSeg(px, pz, ax, az, bx, bz) {
  return distToSegT(px, pz, ax, az, bx, bz).d;
}

// --------------------------- canyon configs ---------------------------------
export const TYPES = {
  grand: {
    label: 'Grand Canyon', world: 2400, depth: 320, gorgeDepth: 60,
    rimHalf: 620, bedHalf: 42, gorgeHalf: 100,
    terraces: 6, terraceMix: 0.7, profilePow: 1.3,
    plateauAmp: 14, meander1: 0.10, meander2: 0.035, meanderF1: 1.6, meanderF2: 3.7,
    wiggle: 0, tributary: true, buttes: 5, dunes: 0, braided: false,
    waterDepth: 2.4, warpAmp: 20, warpFreq: 0.004, aoStrength: 0.030, topY: 34,
    rocks: 900, rockMin: 0.8, rockMax: 6.0, bushes: 450,
    lakeCount: 3, lakeRMin: 50, lakeRMax: 130, lakeDepth: 7,
    camPos: [980, 560, 1180], camTgt: [0, -140, 0],
  },
  slot: {
    label: 'Slot Canyon', world: 420, depth: 46, gorgeDepth: 0,
    rimHalf: 62, bedHalf: 4, gorgeHalf: 0,
    terraces: 2, terraceMix: 0.25, profilePow: 1.05,
    plateauAmp: 5, meander1: 0.16, meander2: 0.05, meanderF1: 2.2, meanderF2: 5.1,
    wiggle: 0.008, tributary: false, buttes: 0, dunes: 0, braided: false,
    waterDepth: 1.0, warpAmp: 4, warpFreq: 0.02, aoStrength: 0.14, topY: 14,
    rocks: 160, rockMin: 0.3, rockMax: 1.6, bushes: 0,
    lakeCount: 0, lakeRMin: 0, lakeRMax: 0, lakeDepth: 0,
    camPos: [150, 72, 196], camTgt: [0, -16, 0],
  },
  wadi: {
    label: 'Desert Wadi', world: 1700, depth: 30, gorgeDepth: 0,
    rimHalf: 430, bedHalf: 95, gorgeHalf: 0,
    terraces: 2, terraceMix: 0.2, profilePow: 1.7,
    plateauAmp: 9, meander1: 0.08, meander2: 0.03, meanderF1: 1.4, meanderF2: 3.2,
    wiggle: 0, tributary: false, buttes: 2, dunes: 7, braided: true,
    waterDepth: 0.5, warpAmp: 8, warpFreq: 0.006, aoStrength: 0.06, topY: 24,
    rocks: 350, rockMin: 0.5, rockMax: 3.0, bushes: 260,
    lakeCount: 1, lakeRMin: 80, lakeRMax: 150, lakeDepth: 3,
    camPos: [700, 390, 920], camTgt: [0, -8, 0],
  },
};

// Layer thickness fractions per canyon type (BOTTOM -> TOP, must sum to 1).
const STRATA_FRAC = {
  grand: [0.06, 0.06, 0.07, 0.06, 0.11, 0.08, 0.10, 0.10, 0.06, 0.11, 0.08, 0.11],
  slot: [0.09, 0.07, 0.10, 0.06, 0.11, 0.08, 0.09, 0.07, 0.10, 0.06, 0.09, 0.08],
  wadi: [0.08, 0.08, 0.09, 0.07, 0.10, 0.09, 0.08, 0.08, 0.09, 0.07, 0.09, 0.08],
};

// Choosable rock palettes. Layers BOTTOM (index 0) -> TOP (index 11).
export const STRATA_PRESETS = {
  classic: {
    label: 'Canyon Classic',
    cols: [0x38312e, 0x5c4832, 0x6f7a52, 0xa67b5b, 0x7e2f26, 0x9c5636,
           0xb4663f, 0xc98a5a, 0x8e4438, 0xd9b48c, 0xb9a37e, 0xc9bfa8],
    hard: [0.95, 0.8, 0.3, 0.6, 0.9, 0.5, 0.45, 0.6, 0.25, 0.85, 0.7, 0.9],
    xbed: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0],
  },
  antelope: {
    label: 'Antelope Red',
    cols: [0x5e2018, 0x8e3222, 0xc65a35, 0xe8a56b, 0xa03a28, 0xd97b4a,
           0x7a2a20, 0xe3c08a, 0xb84a2e, 0xe8b878, 0xc97245, 0x8e3a24],
    hard: [0.8, 0.75, 0.7, 0.65, 0.8, 0.7, 0.85, 0.6, 0.75, 0.6, 0.7, 0.8],
    xbed: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0],
  },
  sahara: {
    label: 'Sahara Gold',
    cols: [0x7d6b55, 0x9a8567, 0xc9b183, 0xb99b6e, 0xd9c49a, 0xa98f66,
           0xd3bc92, 0xc4a87c, 0xe3d3ae, 0xb9a37e, 0xd9c49a, 0xcbb691],
    hard: [0.6, 0.5, 0.55, 0.45, 0.5, 0.4, 0.55, 0.5, 0.45, 0.5, 0.55, 0.6],
    xbed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  painted: {
    label: 'Painted Desert',
    cols: [0x5e4f5e, 0x7a5f6e, 0x9a7386, 0xb98a8a, 0xd9a08a, 0xe8c39a,
           0xc9a88a, 0xa8827a, 0x8a6a72, 0xb99aa0, 0xd9c2b2, 0xe8dcc8],
    hard: [0.55, 0.45, 0.5, 0.4, 0.45, 0.5, 0.55, 0.45, 0.4, 0.5, 0.55, 0.6],
    xbed: [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  },
  bryce: {
    label: 'Bryce Amphitheater',
    cols: [0x8a4a3a, 0xb85a40, 0xd97a50, 0xe89a68, 0xf0b883, 0xf4d0a0,
           0xe8b890, 0xd98a70, 0xc05a48, 0xe09a78, 0xf2cba4, 0xf7e3c4],
    hard: [0.7, 0.5, 0.6, 0.45, 0.55, 0.4, 0.5, 0.6, 0.7, 0.5, 0.45, 0.55],
    xbed: [1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0],
  },
  basalt: {
    label: 'Basalt Mono',
    cols: [0x2e2c2c, 0x3a3735, 0x2a2828, 0x454240, 0x333131, 0x4a4642,
           0x2e2c2a, 0x3f3b38, 0x363433, 0x4c4844, 0x383534, 0x54504a],
    hard: [0.95, 0.9, 0.92, 0.85, 0.9, 0.88, 0.93, 0.86, 0.9, 0.85, 0.88, 0.9],
    xbed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};

export const TYPE_DEFAULT_STRATA = { grand: 'classic', slot: 'antelope', wadi: 'sahara' };

export function resolveStrata(type, preset) {
  if (preset && STRATA_PRESETS[preset]) return preset;
  return TYPE_DEFAULT_STRATA[type] || 'classic';
}

export function getStrata(type, bedBase, preset) {
  const cfg = TYPES[type];
  const s = STRATA_PRESETS[resolveStrata(type, preset)];
  const frac = STRATA_FRAC[type];
  const bottom = bedBase - 10;
  const top = cfg.topY;
  const bounds = [bottom];
  let acc = 0;
  for (let i = 0; i < 12; i++) {
    acc += frac[i];
    bounds.push(bottom + (top - bottom) * Math.min(acc, 1));
  }
  return { bounds, cols: s.cols.slice(), hard: s.hard.slice(), xbed: s.xbed.slice() };
}

function hardnessAt(strata, yW) {
  const b = strata.bounds;
  for (let i = 0; i < 12; i++) {
    if (yW < b[i + 1]) return strata.hard[i];
  }
  return strata.hard[11];
}

// Valley cross-section: 1 at river center -> 0 past the rim, with terraces.
function valleyProfile(d, rimHalf, bedHalf, pw, K, terrMix) {
  if (d >= rimHalf) return 0;
  if (d <= bedHalf) return 1;
  const t = 1 - (d - bedHalf) / (rimHalf - bedHalf);
  const smooth = Math.pow(t, pw);
  const f = smooth * K;
  const i = Math.floor(f);
  let fr = f - i;
  fr = fr * fr * (3 - 2 * fr);
  const terr = (Math.min(i, K - 1) + fr) / K;
  return smooth * (1 - terrMix) + terr * terrMix;
}

// --------------------------- erosion engine ---------------------------------
// Reusable droplet erosion: used once during generation AND continuously for
// live rain. Mutates the normalized grid G in place and records touched
// cells in `dirty` so the mesh can be patched incrementally.
export function createErosionEngine({ G, hardGrid, distMain, N, bedHalf, lakes }) {
  const dirty = new Uint8Array(N * N);
  const R = 2;
  const brushOff = [], brushW = [];
  for (let oz = -R; oz <= R; oz++) {
    for (let ox = -R; ox <= R; ox++) {
      const dd = ox * ox + oz * oz;
      if (dd <= R * R) {
        brushOff.push(oz * N + ox);
        brushW.push(1 - Math.sqrt(dd) / (R + 1));
      }
    }
  }
  let wSum = 0;
  for (let k = 0; k < brushW.length; k++) wSum += brushW[k];
  for (let k = 0; k < brushW.length; k++) brushW[k] /= wSum;

  function markDirty(cx, cz) {
    const m = 3;
    const i0 = Math.max(cx - m, 0), i1 = Math.min(cx + m, N - 1);
    const j0 = Math.max(cz - m, 0), j1 = Math.min(cz + m, N - 1);
    for (let j = j0; j <= j1; j++) {
      const row = j * N;
      for (let i = i0; i <= i1; i++) dirty[row + i] = 1;
    }
  }
  // 0 = fully erodible ... 1 = protected (riverbed + lake bowls stay put)
  function protection(ix, iz) {
    let p = 0;
    if (distMain) {
      const d = distMain[iz * N + ix];
      if (d < bedHalf * 3) p = Math.max(p, 1 - sstep(bedHalf, bedHalf * 3, d));
    }
    if (lakes) {
      for (let L = 0; L < lakes.length; L++) {
        const lk = lakes[L];
        const ddx = ix - lk.gx, ddz = iz - lk.gz;
        if (ddx * ddx + ddz * ddz < lk.gr * lk.gr) p = Math.max(p, 0.95);
      }
    }
    return p;
  }

  function runDroplets(count, rand, storm = 1, protect = false, onChunk = null) {
    const maxLife = 30, inertia = 0.05, capacity = 4.0;
    const erodeSpeed = 0.3 * storm, depositSpeed = 0.3, evaporate = 0.01, gravity = 4.0;
    const x0 = R, x1 = N - 1 - R;
    const CHUNK = 6000;
    for (let s = 0; s < count; s++) {
      let px = x0 + rand() * (x1 - x0);
      let pz = x0 + rand() * (x1 - x0);
      let dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
      for (let life = 0; life < maxLife; life++) {
        const ix = Math.floor(px), iz = Math.floor(pz);
        const fx = px - ix, fz = pz - iz;
        const i00 = iz * N + ix;
        const h00 = G[i00], h10 = G[i00 + 1], h01 = G[i00 + N], h11 = G[i00 + N + 1];
        const gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
        const gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
        const hOld = h00 + (h10 - h00) * fx + (h01 - h00) * fz + (h00 - h10 - h01 + h11) * fx * fz;
        dx = dx * inertia - gx * (1 - inertia);
        dz = dz * inertia - gz * (1 - inertia);
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 1e-6) {
          const a = rand() * Math.PI * 2;
          dx = Math.cos(a); dz = Math.sin(a);
        } else { dx /= len; dz /= len; }
        const nx = px + dx, nz = pz + dz;
        if (nx < x0 || nx > x1 - 1 || nz < x0 || nz > x1 - 1) break;
        const nix = Math.floor(nx), niz = Math.floor(nz);
        const nfx = nx - nix, nfz = nz - niz;
        const j00 = niz * N + nix;
        const g00 = G[j00];
        const nh = g00 + (G[j00 + 1] - g00) * nfx + (G[j00 + N] - g00) * nfz
                 + (g00 - G[j00 + 1] - G[j00 + N] + G[j00 + N + 1]) * nfx * nfz;
        const dh = nh - hOld;
        const hard = hardGrid[iz * N + ix];
        const erod = (1.35 - hard) * storm;
        let rate = 1;
        if (protect) rate = 1 - protection(ix, iz) * 0.97;
        const cap = Math.max(-dh * speed * water * capacity, 0.001);
        if (sed > cap || dh > 0) {
          const dep = (dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositSpeed) * rate;
          sed -= dep;
          G[i00] += dep * (1 - fx) * (1 - fz);
          G[i00 + 1] += dep * fx * (1 - fz);
          G[i00 + N] += dep * (1 - fx) * fz;
          G[i00 + N + 1] += dep * fx * fz;
        } else {
          let take = (cap - sed) * erodeSpeed * erod * rate;
          const maxTake = -dh + 0.001;
          if (take > maxTake) take = maxTake;
          if (take < 0) take = 0;
          sed += take;
          for (let b = 0; b < brushOff.length; b++) {
            const bi = i00 + brushOff[b];
            const nv = G[bi] - take * brushW[b];
            G[bi] = nv < 0 ? 0 : nv;
          }
        }
        const sp2 = speed * speed + (-dh) * gravity;
        speed = Math.sqrt(sp2 > 0 ? sp2 : 0);
        water *= (1 - evaporate);
        px = nx; pz = nz;
        markDirty(ix, iz);
      }
      if (onChunk && (s % CHUNK) === CHUNK - 1) onChunk(s, count);
    }
  }

  return { runDroplets, dirty, protection };
}

// ------------------------------ generator -----------------------------------
export async function generateCanyon({ type = 'grand', seed = 2026, size = 512, erosion = 1.0, strata: strataPreset = null, onProgress = null }) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const cfg = TYPES[type];
  if (!cfg) throw new Error('Unknown canyon type: ' + type);
  const progress = (f, label) => { if (onProgress) { try { onProgress(f, label); } catch (e) { /* ignore */ } } };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  progress(0.02, 'Seeding random streams');
  await tick();

  const rng = mulberry32(seed);
  const perlin = new Perlin2(mulberry32((seed ^ 0x9e3779b9) >>> 0));
  const shared = makeSharedNoise();
  const [offX, offZ] = seedOffset(seed);

  const N = size, world = cfg.world, half = world / 2;
  const depthTotal = cfg.depth + (cfg.gorgeDepth || 0);
  const bedBase = -depthTotal;
  const waterY = bedBase + cfg.waterDepth;

  // --- river path (one center-X per row) ---
  const p1 = rng() * Math.PI * 2, p2 = rng() * Math.PI * 2, p3 = rng() * Math.PI * 2;
  const seedShift = (seed % 100) * 0.37;
  const cx = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    const u = j / (N - 1);
    let x = Math.sin(u * Math.PI * 2 * cfg.meanderF1 + p1) * cfg.meander1 * world
          + Math.sin(u * Math.PI * 2 * cfg.meanderF2 + p2) * cfg.meander2 * world
          + perlin.noise(3.1 + seedShift, u * 4.0) * world * 0.02;
    if (cfg.wiggle) x += Math.sin(u * 43 + p3) * cfg.wiggle * world;
    cx[j] = x;
  }
  const riverXAt = (z) => {
    const fj = clamp(z / world + 0.5, 0, 1) * (N - 1);
    const j0 = Math.floor(fj), jt = fj - j0;
    return lerp(cx[j0], cx[Math.min(N - 1, j0 + 1)], jt);
  };

  // --- tributary (grand): bent segment joining the main channel ---
  let trib = null;
  if (cfg.tributary) {
    const uj = 0.55 + rng() * 0.2;
    const jz = (uj - 0.5) * world;
    const jx = riverXAt(jz);
    const side = rng() < 0.5 ? -1 : 1;
    const dir = rng() < 0.5 ? -1 : 1;
    const ax = side * half * 0.99;
    const az = clamp(jz + dir * world * (0.28 + rng() * 0.12), -half * 0.99, half * 0.99);
    const mx = lerp(ax, jx, 0.5) + (rng() - 0.5) * world * 0.1;
    const mz = lerp(az, jz, 0.5) + (rng() - 0.5) * world * 0.1;
    trib = {
      ax, az, mx, mz, bx: jx, bz: jz,
      rimHalf: cfg.rimHalf * 0.30, depth: cfg.depth * 0.55, bedHalf: cfg.bedHalf * 0.45,
    };
  }

  // --- buttes / mesas ---
  const buttes = [];
  if (cfg.buttes) {
    let guard = 0;
    while (buttes.length < cfg.buttes && guard++ < 80) {
      const bx = (rng() * 2 - 1) * half * 0.8;
      const bz = (rng() * 2 - 1) * half * 0.8;
      if (Math.abs(bx - riverXAt(bz)) < cfg.rimHalf * 1.25) continue;
      buttes.push({
        x: bx, z: bz,
        r: world * (0.035 + rng() * 0.05),
        h: cfg.depth * (0.22 + rng() * 0.28),
      });
    }
  }

  // --- tributary field: distance + downstream progress t (0 head -> 1 junction) ---
  function tribField(x, z) {
    if (!trib) return { d: 1e9, t: 0 };
    const a = distToSegT(x, z, trib.ax, trib.az, trib.mx, trib.mz);
    const b = distToSegT(x, z, trib.mx, trib.mz, trib.bx, trib.bz);
    return a.d < b.d ? { d: a.d, t: a.t * 0.5 } : { d: b.d, t: 0.5 + b.t * 0.5 };
  }

  // --- lakes (positions now, bowls carved after erosion so they hold water) ---
  const lakes = [];
  if (cfg.lakeCount) {
    let guard = 0;
    while (lakes.length < cfg.lakeCount && guard++ < 120) {
      const r = cfg.lakeRMin + rng() * (cfg.lakeRMax - cfg.lakeRMin);
      const lx = (rng() * 2 - 1) * (half - r - 30);
      const lz = (rng() * 2 - 1) * (half - r - 30);
      if (Math.abs(lx - riverXAt(lz)) < cfg.rimHalf * 1.35 + r) continue;
      const tf = tribField(lx, lz);
      if (tf.d < cfg.rimHalf * 0.32 + r) continue;
      let bad = false;
      for (let b = 0; b < buttes.length; b++) {
        const B = buttes[b];
        if (Math.hypot(lx - B.x, lz - B.z) < B.r + r + 40) { bad = true; break; }
      }
      if (bad) continue;
      for (let L = 0; L < lakes.length; L++) {
        if (Math.hypot(lx - lakes[L].x, lz - lakes[L].z) < lakes[L].r + r + 60) { bad = true; break; }
      }
      if (bad) continue;
      lakes.push({ x: lx, z: lz, r, depth: cfg.lakeDepth * (0.8 + rng() * 0.4), waterY: 0 });
    }
  }

  // --- carve ---
  const H = new Float32Array(N * N);
  const distMain = new Float32Array(N * N);
  progress(0.05, 'Carving canyon...');
  for (let j = 0; j < N; j++) {
    const z = -half + (world * j) / (N - 1);
    const u = j / (N - 1);
    const riverX = cx[j];
    const rimMod = 1 + 0.28 * perlin.noise(u * 3.1 + 11.0, 4.4);
    const depMod = 1 + 0.10 * perlin.noise(0.5, u * 2.3 + 7.0);
    const rimH = Math.max(cfg.rimHalf * rimMod, cfg.bedHalf * 4);
    for (let i = 0; i < N; i++) {
      const x = -half + (world * i) / (N - 1);
      const idx = j * N + i;
      const d = Math.abs(x - riverX);
      distMain[idx] = d;

      let h = perlin.noise(x * 0.0016, z * 0.0016) * cfg.plateauAmp
            + fbmP(perlin, x * 0.008, z * 0.008, 3) * cfg.plateauAmp * 0.18;

      for (let b = 0; b < buttes.length; b++) {
        const B = buttes[b];
        const dx = x - B.x, dz = z - B.z;
        const dd = Math.sqrt(dx * dx + dz * dz);
        if (dd < B.r) h += B.h * Math.pow(sstep(B.r, B.r * 0.42, dd), 0.85);
      }

      if (cfg.dunes) {
        const dm = sstep(rimH, rimH * 1.7, d);
        if (dm > 0) h += dm * cfg.dunes * ridgedP(perlin, x * 0.004 + 3.0, z * 0.004, 3);
      }

      let carve = depthTotal * depMod * valleyProfile(d, rimH, cfg.bedHalf, cfg.profilePow, cfg.terraces, cfg.terraceMix);
      if (cfg.gorgeDepth) {
        const g = 1 - sstep(0, cfg.gorgeHalf * rimMod, d);
        if (g > 0) carve += cfg.gorgeDepth * Math.pow(g, 1.4);
      }
      if (trib) {
        const tf = tribField(x, z);
        // tributary deepens + widens toward the junction so beds meet
        const rim2 = cfg.rimHalf * lerp(0.20, 0.32, tf.t);
        const dep2 = lerp(150, depthTotal * depMod, Math.pow(tf.t, 0.75));
        if (tf.d < rim2) {
          const c2 = dep2 * valleyProfile(tf.d, rim2, trib.bedHalf, 1.2, 3, 0.6);
          if (c2 > carve) carve = c2;
        }
        trib._d = tf.d; trib._t = tf.t; // reused below for confluence flatten
      }
      h -= carve;

      // confluence: blend tributary bed into the main riverbed near junction
      if (trib) {
        const wj = sstep(0.8, 0.98, trib._t) * (1 - sstep(trib.bedHalf, trib.bedHalf * 3, trib._d));
        if (wj > 0) h = lerp(h, bedBase + perlin.noise(x * 0.05 + 4.0, z * 0.05) * 0.5, wj);
      }

      const bw = 1 - sstep(cfg.bedHalf * 0.9, cfg.bedHalf * 3.0, d);
      if (bw > 0) {
        let target = bedBase + perlin.noise(x * 0.05, z * 0.05) * 0.5;
        if (cfg.braided) target += (ridgedP(perlin, x * 0.015, z * 0.008 + 9.0, 2) - 0.55) * 3.2;
        h = lerp(h, target, bw);
      }
      H[idx] = h;
    }
    if ((j & 63) === 63) { progress(0.05 + (0.25 * j) / N, 'Carving canyon...'); await tick(); }
  }

  // --- normalize for erosion ---
  progress(0.32, 'Measuring terrain...');
  await tick();
  let minH = Infinity, maxH = -Infinity;
  for (let k = 0; k < N * N; k++) { const h = H[k]; if (h < minH) minH = h; if (h > maxH) maxH = h; }
  const escale = Math.max(maxH - minH, 1e-6);
  const G = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) G[k] = (H[k] - minH) / escale;

  // --- hardness grid (same warp field as the GPU strata shader) ---
  progress(0.34, 'Surveying rock hardness...');
  await tick();
  const strata = getStrata(type, bedBase);
  const hardGrid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = -half + (world * j) / (N - 1);
    for (let i = 0; i < N; i++) {
      const x = -half + (world * i) / (N - 1);
      const idx = j * N + i;
      const w = shared.fbm3(x * cfg.warpFreq + offX, z * cfg.warpFreq + offZ);
      hardGrid[idx] = hardnessAt(strata, H[idx] + (w - 0.5) * 2 * cfg.warpAmp);
    }
    if ((j & 127) === 127) { progress(0.34 + (0.02 * j) / N, 'Surveying rock hardness...'); await tick(); }
  }

  // --- hydraulic droplet erosion (hardness-aware, shared engine) ---
  const dropCount = Math.min(340000, Math.floor(N * N * 0.55 * erosion));
  const engine = createErosionEngine({ G, hardGrid, distMain: null, N, bedHalf: cfg.bedHalf, lakes: null });
  if (dropCount > 0) {
    const drng = mulberry32((seed ^ 0x51ed2709) >>> 0);
    // run in slices so the progress bar stays alive
    let done = 0;
    while (done < dropCount) {
      const n = Math.min(12000, dropCount - done);
      engine.runDroplets(n, drng, 1, false, null);
      done += n;
      progress(0.36 + (0.40 * done) / dropCount, `Eroding with rain (${Math.round((100 * done) / dropCount)}%)`);
      await tick();
    }
  }

  // --- thermal erosion (talus) ---
  const thermIters = Math.round(28 * erosion);
  if (thermIters > 0) {
    progress(0.78, 'Settling talus slopes...');
    await tick();
    const cellWorld = world / (N - 1);
    const talus = (Math.tan((34 * Math.PI) / 180) * cellWorld) / escale;
    const delta = new Float32Array(N * N);
    for (let it = 0; it < thermIters; it++) {
      delta.fill(0);
      for (let j = 1; j < N - 1; j++) {
        const row = j * N;
        for (let i = 1; i < N - 1; i++) {
          const idx = row + i;
          const h = G[idx];
          let low = idx, lowH = h;
          const a = G[idx - 1], b = G[idx + 1], c = G[idx - N], d = G[idx + N];
          if (a < lowH) { lowH = a; low = idx - 1; }
          if (b < lowH) { lowH = b; low = idx + 1; }
          if (c < lowH) { lowH = c; low = idx - N; }
          if (d < lowH) { lowH = d; low = idx + N; }
          const drop = h - lowH;
          if (drop > talus) {
            const move = (drop - talus) * 0.35 * (1.25 - hardGrid[idx]);
            delta[idx] -= move;
            delta[low] += move;
          }
        }
      }
      for (let k = 0; k < N * N; k++) G[k] += delta[k];
      if ((it & 7) === 7) {
        progress(0.78 + (0.08 * it) / thermIters, 'Settling talus slopes...');
        await tick();
      }
    }
  }

  // --- rescale + restore riverbed below waterline ---
  for (let k = 0; k < N * N; k++) H[k] = minH + G[k] * escale;
  for (let j = 0; j < N; j++) {
    const z = -half + (world * j) / (N - 1);
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const d = distMain[idx];
      if (d < cfg.bedHalf * 3) {
        const x = -half + (world * i) / (N - 1);
        let target = bedBase + perlin.noise(x * 0.05, z * 0.05) * 0.5;
        if (cfg.braided) target += (ridgedP(perlin, x * 0.015, z * 0.008 + 9.0, 2) - 0.55) * 3.2;
        const w = 1 - sstep(cfg.bedHalf * 0.9, cfg.bedHalf * 3, d);
        // full snap in the inner bed (underwater anyway): guarantees depth
        // no matter how much sediment the storm dumped there
        H[idx] = d < cfg.bedHalf ? target : lerp(H[idx], target, w * 0.9);
        if (!cfg.braided && d < cfg.bedHalf && H[idx] > waterY - 0.3) H[idx] = waterY - 0.3;
      }
    }
  }

  // confluence restore: keep the tributary mouth at riverbed level
  if (trib) {
    for (let j = 0; j < N; j++) {
      const z = -half + (world * j) / (N - 1);
      for (let i = 0; i < N; i++) {
        const x = -half + (world * i) / (N - 1);
        const tf = tribField(x, z);
        if (tf.t < 0.8) continue;
        const wj = sstep(0.8, 0.98, tf.t) * (1 - sstep(trib.bedHalf, trib.bedHalf * 3, tf.d));
        if (wj > 0) {
          const idx = j * N + i;
          const snap = (tf.t > 0.93 && tf.d < trib.bedHalf) ? 1 : wj * 0.9;
          H[idx] = lerp(H[idx], bedBase + perlin.noise(x * 0.05 + 4.0, z * 0.05) * 0.5, snap);
        }
      }
    }
  }

  // lake bowls (carved after erosion so they hold water) + water levels
  for (let L = 0; L < lakes.length; L++) {
    const lk = lakes[L];
    const gr = Math.ceil((lk.r / world) * (N - 1)) + 1;
    const ci = Math.round(((lk.x + half) / world) * (N - 1));
    const cj = Math.round(((lk.z + half) / world) * (N - 1));
    lk.gx = ci; lk.gz = cj; lk.gr = gr;
    for (let j = Math.max(cj - gr, 0); j <= Math.min(cj + gr, N - 1); j++) {
      const z = -half + (world * j) / (N - 1);
      for (let i = Math.max(ci - gr, 0); i <= Math.min(ci + gr, N - 1); i++) {
        const x = -half + (world * i) / (N - 1);
        const d = Math.hypot(x - lk.x, z - lk.z);
        if (d < lk.r) {
          const fall = 0.5 + 0.5 * Math.cos((Math.PI * d) / lk.r);
          H[j * N + i] -= lk.depth * Math.pow(fall, 1.2);
        }
      }
    }
    lk.waterY = H[cj * N + ci] + lk.depth * 0.5;
  }

  // --- ambient occlusion / cavity bake (blur compare + depth) ---
  progress(0.90, 'Baking ambient occlusion...');
  await tick();
  const rad = Math.max(2, N >> 7);
  const tmp = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const row = j * N;
    for (let i = 0; i < N; i++) {
      let s = 0, c = 0;
      for (let o = -rad; o <= rad; o++) { s += H[row + clamp(i + o, 0, N - 1)]; c++; }
      tmp[row + i] = s / c;
    }
  }
  progress(0.94, 'Baking ambient occlusion...');
  await tick();
  const blur = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let s = 0, c = 0;
      for (let o = -rad; o <= rad; o++) { s += tmp[clamp(j + o, 0, N - 1) * N + i]; c++; }
      blur[j * N + i] = s / c;
    }
  }
  let rimAcc = 0, rimC = 0;
  for (let k = 0; k < N * N; k++) {
    if (distMain[k] > cfg.rimHalf * 1.2) { rimAcc += H[k]; rimC++; }
  }
  const rimY = rimC ? rimAcc / rimC : 0;
  const ao = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    let a = 1 - (blur[k] - H[k]) * cfg.aoStrength;
    a *= lerp(0.45, 1.0, sstep(bedBase, rimY, H[k]));
    ao[k] = clamp(a, 0, 1);
  }

  // --- flow map: direction (RG) + speed (B) + water depth (A) ---
  progress(0.96, 'Tracing water flow...');
  await tick();
  const flow = new Uint8Array(N * N * 4);
  const cell = world / (N - 1);
  const depthScale = cfg.waterDepth * 3 + 1;
  for (let j = 0; j < N; j++) {
    const jm = j > 0 ? j - 1 : 0, jp = j < N - 1 ? j + 1 : N - 1;
    let tdx = (cx[jp] - cx[jm]) / (Math.max(jp - jm, 1) * cell), tdz = 1;
    const tl = Math.hypot(tdx, tdz) || 1; tdx /= tl; tdz /= tl;
    const z = -half + (world * j) / (N - 1);
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const hx0 = H[j * N + Math.max(i - 1, 0)], hx1 = H[j * N + Math.min(i + 1, N - 1)];
      const hz0 = H[Math.max(j - 1, 0) * N + i], hz1 = H[Math.min(j + 1, N - 1) * N + i];
      const gx = (hx1 - hx0) / (2 * cell), gz = (hz1 - hz0) / (2 * cell);
      const gm = Math.hypot(gx, gz);
      let dx = gm > 1e-6 ? -gx / gm : tdx;
      let dz = gm > 1e-6 ? -gz / gm : tdz;
      // in the channel, flow follows the river tangent
      const wb = 1 - sstep(cfg.bedHalf * 1.5, cfg.bedHalf * 4, distMain[idx]);
      if (wb > 0) {
        dx = dx * (1 - wb) + tdx * wb;
        dz = dz * (1 - wb) + tdz * wb;
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      }
      // tributary beds drain toward the junction
      if (trib) {
        const x = -half + (world * i) / (N - 1);
        const tf = tribField(x, z);
        const wt = 1 - sstep(trib.bedHalf, trib.bedHalf * 3, tf.d);
        if (wt > 0) {
          let jx = trib.bx - x, jz = trib.bz - z;
          const jl = Math.hypot(jx, jz) || 1; jx /= jl; jz /= jl;
          dx = dx * (1 - wt) + jx * wt;
          dz = dz * (1 - wt) + jz * wt;
          const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        }
      }
      // lakes: nearly still water
      let calm = 1;
      for (let L = 0; L < lakes.length; L++) {
        const lk = lakes[L];
        const ddx = i - lk.gx, ddz = j - lk.gz;
        if (ddx * ddx + ddz * ddz < lk.gr * lk.gr * 0.81) { calm = 0.06; break; }
      }
      const speed = clamp(clamp(gm * 1.5, 0, 1) * 0.5 + wb * 0.45 + 0.05, 0, 1) * calm;
      const depth = clamp((waterY - H[idx]) / depthScale, 0, 1);
      const o = idx * 4;
      flow[o] = Math.round((dx * 0.5 + 0.5) * 255);
      flow[o + 1] = Math.round((dz * 0.5 + 0.5) * 255);
      flow[o + 2] = Math.round(speed * 255);
      flow[o + 3] = Math.round(depth * 255);
    }
    if ((j & 127) === 127) { progress(0.96 + (0.03 * j) / N, 'Tracing water flow...'); await tick(); }
  }

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  progress(1, 'Done');
  return {
    heights: H, ao, distMain, size: N, world,
    waterY, bedBase, rimY, strata, buttes, lakes, riverCX: cx,
    flow: { data: flow, size: N },
    erosion: { G, hardGrid, minH, escale },
    stats: { minH, maxH, genMs: Math.round(t1 - t0), dropCount, thermIters },
  };
}

// ------------------------------ sampler -------------------------------------
export function makeSampler(data) {
  const { heights: H, ao, distMain, size: N, world } = data;
  const half = world / 2;
  const cell = world / (N - 1);
  function gridSample(arr, x, z) {
    const gx = clamp(((x + half) / world) * (N - 1), 0, N - 1.001);
    const gz = clamp(((z + half) / world) * (N - 1), 0, N - 1.001);
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const ix1 = Math.min(ix + 1, N - 1), iz1 = Math.min(iz + 1, N - 1);
    const v00 = arr[iz * N + ix], v10 = arr[iz * N + ix1];
    const v01 = arr[iz1 * N + ix], v11 = arr[iz1 * N + ix1];
    return v00 + (v10 - v00) * fx + (v01 - v00) * fz + (v00 - v10 - v01 + v11) * fx * fz;
  }
  return {
    cell,
    height: (x, z) => gridSample(H, x, z),
    ao: (x, z) => (ao ? gridSample(ao, x, z) : 1),
    distRiver: (x, z) => (distMain ? gridSample(distMain, x, z) : 1e9),
    slope: (x, z) => {
      const e = cell * 1.5;
      const dx = gridSample(H, x + e, z) - gridSample(H, x - e, z);
      const dz = gridSample(H, x, z + e) - gridSample(H, x, z - e);
      return Math.sqrt(dx * dx + dz * dz) / (2 * e);
    },
  };
}

// River center-X as a function of world z (for trails).
export function makeRiverFn(data) {
  const { riverCX: cx, size: N, world } = data;
  return (z) => {
    const fj = clamp(z / world + 0.5, 0, 1) * (N - 1);
    const j0 = Math.floor(fj), jt = fj - j0;
    return lerp(cx[j0], cx[Math.min(N - 1, j0 + 1)], jt);
  };
}
