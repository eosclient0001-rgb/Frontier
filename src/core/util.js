// Frontier Road Editor — math & misc utilities

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = t => t * t * (3 - 2 * t);

let _id = 1;
export const uid = p => `${p || 'id'}${(_id++).toString(36)}${Date.now().toString(36).slice(-4)}`;

// Deterministic PRNG (mulberry32)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 2D segment intersection → {t, u, x, z} | null   (p + t·r  vs  q + u·s)
export function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az;
  const sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { t: clamp(t, 0, 1), u: clamp(u, 0, 1), x: ax + rx * t, z: az + rz * t };
}

export const fmt = (n, d = 0) => Number(n).toFixed(d);

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Growing flat arrays → indexed BufferGeometry-friendly bins
export class GeoBin {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; this.vcount = 0; }
  vert(x, y, z, nx, ny, nz, u, v) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v);
    return this.vcount++;
  }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  get triCount() { return this.idx.length / 3; }
}
