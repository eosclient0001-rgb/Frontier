// Ground-plane math: planar points, seeded randomness and value noise.
// Roads live on the X/Z ground plane; Y is height. Every helper here is allocation-light and pure.

export interface P2 {
  x: number;
  z: number;
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export const TAU = Math.PI * 2;

export function p2(x: number, z: number): P2 {
  return { x, z };
}

export function add2(a: P2, b: P2): P2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function sub2(a: P2, b: P2): P2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function scale2(a: P2, k: number): P2 {
  return { x: a.x * k, z: a.z * k };
}

export function dot2(a: P2, b: P2): number {
  return a.x * b.x + a.z * b.z;
}

// 2D cross product (z component of the 3D cross of the embedded vectors).
export function cross2(a: P2, b: P2): number {
  return a.x * b.z - a.z * b.x;
}

export function len2(a: P2): number {
  return Math.hypot(a.x, a.z);
}

export function dist2(a: P2, b: P2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function norm2(a: P2): P2 {
  const l = Math.hypot(a.x, a.z);
  return l > 1e-12 ? { x: a.x / l, z: a.z / l } : { x: 1, z: 0 };
}

// Rotate +90 degrees in the X/Z plane. For a forward tangent t this is the "left" normal.
export function leftNormal2(t: P2): P2 {
  return { x: -t.z, z: t.x };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Distance from point p to segment ab; also returns the closest point parameter (0..1) along ab.
export function closestOnSegment(p: P2, a: P2, b: P2): { t: number; d: number; q: P2 } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const ll = abx * abx + abz * abz;
  let t = ll > 1e-18 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / ll : 0;
  t = clamp(t, 0, 1);
  const q = { x: a.x + abx * t, z: a.z + abz * t };
  return { t, d: Math.hypot(p.x - q.x, p.z - q.z), q };
}

// Intersection of segments ab and cd. Returns parameters (u along ab, v along cd) or null.
export function segmentIntersection(
  a: P2,
  b: P2,
  c: P2,
  d: P2
): { u: number; v: number; p: P2 } | null {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-12) return null; // parallel or collinear: treated as no crossing
  const qpx = c.x - a.x;
  const qpz = c.z - a.z;
  const u = (qpx * sz - qpz * sx) / denom;
  const v = (qpx * rz - qpz * rx) / denom;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, p: { x: a.x + rx * u, z: a.z + rz * u } };
}

// Deterministic 32-bit PRNG (mulberry32). Same seed always yields the same road variations.
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hiInclusive: number): number {
    return Math.floor(this.range(lo, hiInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }

  // Fork an independent stream so adding one feature never reshuffles the others.
  fork(salt: number): Rng {
    return new Rng(hash32(this.state ^ Math.imul(salt | 0, 0x9e3779b1)));
  }
}

// Integer hash used to derive stable per-road seeds from ids and coordinates.
export function hash32(n: number): number {
  let h = n | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function latticeHash(ix: number, iz: number, seed: number): number {
  return hash32(Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + seed) / 4294967295;
}

// Smooth 2D value noise in [-1, 1].
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = latticeHash(ix, iz, seed);
  const b = latticeHash(ix + 1, iz, seed);
  const c = latticeHash(ix, iz + 1, seed);
  const d = latticeHash(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}

// Fractal sum of value noise, normalised to roughly [-1, 1].
export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}
