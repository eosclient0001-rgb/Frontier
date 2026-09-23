import { SIZE, MIN, MAX, CELL } from "./field.js";
export const MAX_GUIDES = 8,
  MAX_DETAILS = 16,
  MIN_CUT_WIDTH = 0.8;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const unit = (v) => {
  const l = Math.hypot(...v);
  if (l < 1e-7) throw new Error("Place A and B farther apart.");
  return v.map((x) => x / l);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function makePlane(
  a,
  b,
  view,
  { tilt = 0, span = 60, depth = 60, width = 1.2, detail = false } = {},
) {
  if (![...a, ...b, ...view, tilt, span, depth, width].every(Number.isFinite))
    throw new Error("Invalid cutting plane.");
  if (Math.hypot(...sub(a, b)) < 0.15)
    throw new Error("Place B at least 15 cm from A.");
  const u = unit(sub(b, a));
  let v = sub(
    view,
    u.map((x) => x * dot(view, u)),
  );
  if (Math.hypot(...v) < 0.01) {
    const fallback = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    v = sub(
      fallback,
      u.map((x) => x * dot(fallback, u)),
    );
  }
  v = unit(v);
  const n = cross(u, v),
    angle = (tilt * Math.PI) / 180;
  v = v.map((x, k) => x * Math.cos(angle) + n[k] * Math.sin(angle));
  return {
    a: [...a],
    b: [...b],
    view: [...view],
    tilt,
    span,
    depth,
    width: detail
      ? Math.max(0.002, Math.min(0.08, width))
      : Math.max(MIN_CUT_WIDTH, Math.min(8, width)),
    detail,
    center: a.map((x, k) => (x + b[k]) * 0.5),
    u,
    v,
    n: unit(cross(u, v)),
    halfSpan: Math.max(0.25, span * 0.5),
    halfDepth: Math.max(0.25, depth * 0.5),
  };
}
export function planeDistance(p, g) {
  const r = sub(p, g.center),
    q = [
      Math.abs(dot(r, g.u)) - g.halfSpan,
      Math.abs(dot(r, g.v)) - g.halfDepth,
      Math.abs(dot(r, g.n)) - g.width * 0.5,
    ];
  return (
    Math.hypot(...q.map((x) => Math.max(0, x))) + Math.min(0, Math.max(...q))
  );
}
export function planeCorners(g) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) =>
    g.center.map(
      (x, k) => x + a * g.halfSpan * g.u[k] + b * g.halfDepth * g.v[k],
    ),
  );
}
export function clipPolygon(poly, normal, offset) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = dot(a, normal) - offset,
      db = dot(b, normal) - offset;
    if (da <= 0) out.push(a);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}
export function boundedPlane(g) {
  let poly = planeCorners(g);
  for (let k = 0; k < 3; k++) {
    const n = [0, 0, 0];
    n[k] = 1;
    poly = clipPolygon(poly, n, MAX[k]);
    n[k] = -1;
    poly = clipPolygon(poly, n, -MIN[k]);
  }
  return poly;
}

// Explicit artist selection only. The caller supplies the CURRENT GPU readback,
// never the worker's stale procedural volume. Conservative 26-neighbour topology
// treats corner/edge bridges as connected rather than deleting through them.
export function selectConnectedChunk(
  volume,
  point,
  size = SIZE,
  min = MIN,
  cell = CELL,
  eligible = null,
) {
  const [nx, ny, nz] = size,
    N = nx * ny * nz;
  if (
    !(volume instanceof Float32Array) ||
    volume.length !== N * 4 ||
    !Array.isArray(point) ||
    point.length !== 3 ||
    !point.every(Number.isFinite) ||
    (eligible && eligible.length !== N)
  )
    throw new Error("Invalid chunk selection input.");
  const index = (x, y, z) => (z * ny + y) * nx + x;
  const q = point.map((v, k) => Math.floor((v - min[k]) / cell[k]));
  let seed = -1,
    best = Infinity,
    total = 0;
  for (let i = 0; i < N; i++) if (volume[i * 4] < 0) total++;
  for (let z = Math.max(0, q[2] - 2); z <= Math.min(nz - 1, q[2] + 2); z++)
    for (let y = Math.max(0, q[1] - 2); y <= Math.min(ny - 1, q[1] + 2); y++)
      for (
        let x = Math.max(0, q[0] - 2);
        x <= Math.min(nx - 1, q[0] + 2);
        x++
      ) {
        const i = index(x, y, z);
        if (volume[i * 4] >= 0 || (eligible && !eligible[i])) continue;
        const d = [x, y, z].reduce(
          (s, v, k) => s + (min[k] + (v + 0.5) * cell[k] - point[k]) ** 2,
          0,
        );
        if (d < best) {
          best = d;
          seed = i;
        }
      }
  if (seed < 0)
    throw new Error(
      "No solid cell near that surface. Pick farther inside the piece.",
    );
  const mask = new Uint8Array(N),
    queue = new Uint32Array(N);
  let head = 0,
    tail = 1;
  queue[0] = seed;
  mask[seed] = 255;
  while (head < tail) {
    const i = queue[head++],
      x = i % nx,
      y = Math.floor(i / nx) % ny,
      z = Math.floor(i / (nx * ny));
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            zz = z + dz;
          if (xx < 0 || xx >= nx || yy < 0 || yy >= ny || zz < 0 || zz >= nz)
            continue;
          const j = index(xx, yy, zz);
          if (!mask[j] && volume[j * 4] < 0 && (!eligible || eligible[j])) {
            mask[j] = 255;
            queue[tail++] = j;
          }
        }
  }
  // Include the selected surface's partial-occupancy fringe. Do not cross into
  // other negative cells, or steal a fringe shared with another component.
  for (let h = 0; h < tail; h++) {
    const i = queue[h],
      x = i % nx,
      y = Math.floor(i / nx) % ny,
      z = Math.floor(i / (nx * ny));
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            zz = z + dz;
          if (xx < 0 || xx >= nx || yy < 0 || yy >= ny || zz < 0 || zz >= nz)
            continue;
          const j = index(xx, yy, zz);
          if (mask[j] || volume[j * 4] < 0 || (eligible && !eligible[j]))
            continue;
          let other = false;
          for (let az = -1; az <= 1 && !other; az++)
            for (let ay = -1; ay <= 1 && !other; ay++)
              for (let ax = -1; ax <= 1; ax++) {
                const bx = xx + ax,
                  by = yy + ay,
                  bz = zz + az;
                if (
                  bx < 0 ||
                  bx >= nx ||
                  by < 0 ||
                  by >= ny ||
                  bz < 0 ||
                  bz >= nz
                )
                  continue;
                const k = index(bx, by, bz);
                if (volume[k * 4] < 0 && mask[k] !== 255) {
                  other = true;
                  break;
                }
              }
          if (!other) mask[j] = 128;
        }
  }
  return {
    mask,
    count: tail,
    total,
    fraction: tail / Math.max(total, 1),
    whole: tail === total,
    volume: tail * cell[0] * cell[1] * cell[2],
  };
}
