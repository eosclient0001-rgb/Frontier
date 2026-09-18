import { MIN, MAX } from "./field.js";
export const MAX_CELL_SITES = 64,
  MAX_PAINT_STAMPS = 24,
  PATTERN_WIDTH = 128;
const dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0);
export function capsuleDistance(p, a, b, radius) {
  const ab = b.map((v, k) => v - a[k]),
    ap = p.map((v, k) => v - a[k]),
    t = Math.max(0, Math.min(1, dot(ap, ab) / Math.max(1e-8, dot(ab, ab))));
  return Math.hypot(...ap.map((v, k) => v - ab[k] * t)) - radius;
}
export function regionDistance(p, brushes) {
  let d = Infinity;
  for (const b of brushes)
    d = Math.min(d, capsuleDistance(p, b.a, b.b, b.radius));
  return d;
}
function random(x, y, z, seed) {
  let h =
    (Math.imul(x, 374761393) ^
      Math.imul(y, 668265263) ^
      Math.imul(z, 2147483647) ^
      Math.imul(seed, 1274126177)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function generateCellPattern(
  stamps,
  {
    size = 4.5,
    variation = 0.9,
    depth = 18,
    gap = 0.8,
    seed = 4101,
    separate = true,
    detail = false,
    intact = false,
  } = {},
) {
  if (intact) {
    detail = true;
    separate = false;
  }
  if (!stamps.length) return null;
  if (stamps.length > MAX_PAINT_STAMPS)
    throw new Error(`At most ${MAX_PAINT_STAMPS} paint samples per fracture.`);
  if (
    ![size, variation, depth, gap, seed].every(Number.isFinite) ||
    size < 2 ||
    size > 12 ||
    depth < 1 ||
    depth > 50 ||
    variation < 0 ||
    variation > 1
  )
    throw new Error("Invalid cell-fracture settings.");
  const brushes = stamps.map((s) => {
    if (
      ![...s.point, ...s.view, s.radius].every(Number.isFinite) ||
      s.radius <= 0
    )
      throw new Error("Invalid paint sample.");
    const len = Math.hypot(...s.view);
    if (len < 1e-6) throw new Error("Invalid paint direction.");
    const v = s.view.map((x) => x / len);
    return {
      a: s.point.map((x, k) => x - v[k] * 0.25),
      b: s.point.map((x, k) => x + v[k] * depth),
      radius: s.radius,
    };
  });
  const lo = [...MAX],
    hi = [...MIN];
  for (const b of brushes)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.max(
        MIN[k] + 0.1,
        Math.min(lo[k], b.a[k] - b.radius, b.b[k] - b.radius),
      );
      hi[k] = Math.min(
        MAX[k] - 0.1,
        Math.max(hi[k], b.a[k] + b.radius, b.b[k] + b.radius),
      );
    }
  let effectiveSize = size,
    sites = [];
  // A deterministic jittered lattice supplies genuine 3D Voronoi sites. Increase
  // spacing rather than silently truncating one end of a large painted volume.
  for (let attempt = 0; attempt < 24; attempt++) {
    sites = [];
    const low = lo.map((x) => Math.floor(x / effectiveSize) - 1),
      high = hi.map((x) => Math.ceil(x / effectiveSize) + 1);
    outer: for (let z = low[2]; z <= high[2]; z++)
      for (let y = low[1]; y <= high[1]; y++)
        for (let x = low[0]; x <= high[0]; x++) {
          const p = [x, y, z].map(
            (v, k) =>
              (v +
                0.5 +
                (random(x, y, z, seed + k * 991) - 0.5) * variation * 0.95) *
              effectiveSize,
          );
          if (
            p.some((v, k) => v < MIN[k] || v > MAX[k]) ||
            regionDistance(p, brushes) > 0
          )
            continue;
          sites.push(p);
          if (sites.length > MAX_CELL_SITES) break outer;
        }
    if (sites.length <= MAX_CELL_SITES) break;
    effectiveSize *= 1.12;
  }
  // Ensure each disconnected painted island has local sites, even if the lattice
  // missed a narrow brush. Keep the count bounded and avoid coincident sites.
  for (const b of brushes)
    if (!sites.some((p) => capsuleDistance(p, b.a, b.b, b.radius) < 0)) {
      for (const t of [0.18, 0.62]) {
        const p = b.a.map((v, k) =>
          Math.max(MIN[k] + 0.1, Math.min(MAX[k] - 0.1, v + (b.b[k] - v) * t)),
        );
        if (
          sites.length < MAX_CELL_SITES &&
          regionDistance(p, brushes) < 0 &&
          sites.every((q) => Math.hypot(...p.map((v, k) => v - q[k])) > 0.15)
        )
          sites.push(p);
      }
    }
  if (sites.length < 2) {
    const b = brushes[0];
    for (const t of [0.25, 0.7]) {
      const p = b.a.map((v, k) =>
        Math.max(MIN[k] + 0.1, Math.min(MAX[k] - 0.1, v + (b.b[k] - v) * t)),
      );
      if (sites.every((q) => Math.hypot(...p.map((v, k) => v - q[k])) > 0.15))
        sites.push(p);
    }
  }
  return {
    sites,
    brushes,
    gap: detail
      ? Math.max(0.002, Math.min(0.08, gap))
      : Math.max(0.8, Math.min(2, gap)),
    separate: !!separate,
    detail: !!detail,
    intact: !!intact,
    requestedSize: size,
    effectiveSize,
    seed,
    variation,
    depth,
  };
}
export function cellAt(p, sites) {
  let best = Infinity,
    index = -1;
  sites.forEach((s, i) => {
    const d = s.reduce((sum, v, k) => sum + (p[k] - v) ** 2, 0);
    if (d < best) {
      best = d;
      index = i;
    }
  });
  let face = Infinity;
  sites.forEach((s, i) => {
    if (i === index) return;
    const d = s.reduce((sum, v, k) => sum + (p[k] - v) ** 2, 0),
      len = Math.hypot(...s.map((v, k) => v - sites[index][k]));
    face = Math.min(face, (d - best) / Math.max(2 * len, 1e-8));
  });
  return { index, face };
}
export function fractureRemoval(p, pattern) {
  if (pattern.intact) return -Infinity;
  const r = regionDistance(p, pattern.brushes),
    h = pattern.gap * 0.5;
  if (r > h) return -Infinity;
  const inside = Math.min(h - cellAt(p, pattern.sites).face, -r);
  return pattern.separate ? Math.max(inside, h - Math.abs(r)) : inside;
}
export function packCellPatterns(patterns) {
  const data = new Float32Array(PATTERN_WIDTH * 2 * 4);
  patterns.slice(0, 2).forEach((p, row) => {
    if (!p) return;
    if (p.sites.length > MAX_CELL_SITES || p.brushes.length > MAX_PAINT_STAMPS)
      throw new Error("Fracture pattern exceeds GPU limits.");
    const offset = row * PATTERN_WIDTH * 4;
    data.set(
      [p.sites.length, p.brushes.length, p.gap, p.separate ? 1 : 0],
      offset,
    );
    p.sites.forEach((s, i) =>
      data.set([...s, p.intact ? 1 : 0], offset + (i + 1) * 4),
    );
    p.brushes.forEach((b, i) => {
      data.set([...b.a, b.radius], offset + (65 + i) * 4);
      data.set([...b.b, 0], offset + (89 + i) * 4);
    });
  });
  return data;
}
export function uploadCellPatterns(gl, texture, patterns) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    PATTERN_WIDTH,
    2,
    0,
    gl.RGBA,
    gl.FLOAT,
    packCellPatterns(patterns),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
