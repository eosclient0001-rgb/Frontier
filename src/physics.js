// Constraint graph construction + GPU buffer packing.
//
// Because the dress is sampled on a regular (row, col) grid, the constraint
// graph is fully analytic — no spatial hashing required:
//
//   structural : (r,c)-(r,c+1) and (r,c)-(r+1,c)     => in-plane stretch
//   shear      : the two diagonals of every quad      => in-plane shear
//   bending    : (r,c)-(r,c+2) and (r,c)-(r+2,c)      => out-of-plane stiffness
//   stitch     : strap-end -> bodice-top              => seams
//
// The `comp` field stores XPBD compliance (inverse stiffness, m/N).

import { vertexAreas } from './dress.js';

export const CON_STRIDE = 6; // 6 x 4 bytes = 24 bytes, matches WGSL struct Con

export function buildConstraints(dress, params) {
  const { rows, cols, meta, islands } = dress;
  const pos = dress.positions;
  const n = pos.length / 3;

  const list = []; // {i, j, comp, type}
  let restRef = 0;
  let count = 0;

  const stretchComp = params.stretchComp;   // e.g. 1e-6 very stiff
  const shearComp = params.shearComp;
  const bendComp = params.bendComp;
  const stitchComp = params.stitchComp;

  const at = (r, c) => r * cols + ((c % cols) + cols) % cols;

  const dist = (a, b) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    return Math.hypot(ax - bx, ay - by, az - bz);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = at(r, c);
      // horizontal structural (wraps around the body: closed tube seam)
      list.push({ i: a, j: at(r, c + 1), comp: stretchComp, type: 0 });
      // vertical structural
      if (r < rows - 1) {
        list.push({ i: a, j: at(r + 1, c), comp: stretchComp, type: 0 });
      }
      // shear: both diagonals of each quad
      if (r < rows - 1) {
        list.push({ i: a, j: at(r + 1, c + 1), comp: shearComp, type: 1 });
        list.push({ i: at(r, c + 1), j: at(r + 1, c), comp: shearComp, type: 1 });
      }
      // bending: skip-one neighbours (also wraps around the seam)
      list.push({ i: a, j: at(r, c + 2), comp: bendComp, type: 2 });
      if (r + 2 < rows) {
        list.push({ i: a, j: at(r + 2, c), comp: bendComp, type: 2 });
      }
    }
  }

  // ---- stitches: attach each strap end row to the nearest bodice top vertices
  for (const island of islands) {
    if (island.key === 'shell') continue;
    const strapVerts = [];
    for (let i = island.start; i < island.end; i++) strapVerts.push(i);
    const last = strapVerts.length - 1;
    // the first row and the last row of the strip are the two seam edges
    for (const endVert of [strapVerts[0], strapVerts[1], strapVerts[2],
      strapVerts[last], strapVerts[last - 1], strapVerts[last - 2]]) {
      if (endVert === undefined || endVert >= pos.length / 3) continue;
      const ex = pos[endVert * 3], ey = pos[endVert * 3 + 1], ez = pos[endVert * 3 + 2];
      // nearest bodice vertices from the first 4 rows of the shell
      const cands = [];
      const topRows = Math.min(4, rows);
      for (let r = 0; r < topRows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = at(r, c);
          const dx = pos[v * 3] - ex, dy = pos[v * 3 + 1] - ey, dz = pos[v * 3 + 2] - ez;
          cands.push({ v, d: dx * dx + dy * dy + dz * dz });
        }
      }
      cands.sort((x, y) => x.d - y.d);
      for (let k = 0; k < 3; k++) {
        const v = cands[k].v;
        if (v === endVert) continue;
        list.push({ i: endVert, j: v, comp: stitchComp, type: 3 });
      }
    }
  }

  // ---- pack
  const count2 = list.length;
  const buf = new ArrayBuffer(count2 * CON_STRIDE * 4);
  const u32 = new Uint32Array(buf);
  const f32 = new Float32Array(buf);
  list.forEach((con, k) => {
    const o = k * CON_STRIDE;
    u32[o + 0] = con.i;
    u32[o + 1] = con.j;
    f32[o + 2] = dist(con.i, con.j);   // rest length
    f32[o + 3] = con.comp;             // compliance
    f32[o + 4] = con.type;
    f32[o + 5] = 0;                    // lambda
  });

  return { buffer: buf, count: count2, u32, f32, list };
}

/**
 * Assemble the full GPU state for a dress: positions, velocities, inverse mass,
 * rest state, per-vertex grid info and pins.
 */
export function buildState(dress, params, pinsFromGenerator) {
  const n = dress.positions.length / 3;
  const pos = new Float32Array(n * 4);
  const vel = new Float32Array(n * 4);
  const prev = new Float32Array(n * 4);
  const rest = new Float32Array(n * 4);

  const areas = vertexAreas(dress.positions, dress.indices, n);
  const arealDensity = params.arealDensity;      // kg/m^2
  const defaultArea = 0.0004;
  const minMass = 1e-4;

  for (let i = 0; i < n; i++) {
    const a = Math.max(areas[i], defaultArea);
    const m = Math.max(a * arealDensity, minMass);
    const x = dress.positions[i * 3], y = dress.positions[i * 3 + 1], z = dress.positions[i * 3 + 2];
    pos[i * 4 + 0] = x; pos[i * 4 + 1] = y; pos[i * 4 + 2] = z; pos[i * 4 + 3] = 1 / m;
    rest[i * 4 + 0] = x; rest[i * 4 + 1] = y; rest[i * 4 + 2] = z; rest[i * 4 + 3] = 1 / m;
    prev[i * 4 + 0] = x; prev[i * 4 + 1] = y; prev[i * 4 + 2] = z;
  }

  // vertex grid info: (row, col, rows, cols) with rows=0 for non-grid islands
  const vinfo = new Uint32Array(n * 4);
  dress.meta.forEach((m, i) => {
    if (m.strap === undefined) {
      vinfo[i * 4 + 0] = m.row;
      vinfo[i * 4 + 1] = m.col;
      vinfo[i * 4 + 2] = dress.rows;
      vinfo[i * 4 + 3] = dress.cols;
    } else {
      vinfo[i * 4 + 2] = 0;
    }
  });

  // ---- pins: generator pins (straps) + bodice top rows for strapless styles
  const pinMap = new Map();
  for (const p of pinsFromGenerator) {
    pinMap.set(p.index, [p.target[0], p.target[1], p.target[2]]);
  }
  if (params.pinTopRows > 0) {
    for (let r = 0; r < params.pinTopRows && r < dress.rows; r++) {
      for (let c = 0; c < dress.cols; c++) {
        const v = r * dress.cols + c;
        pinMap.set(v, [dress.positions[v * 3], dress.positions[v * 3 + 1], dress.positions[v * 3 + 2]]);
      }
    }
  }
  // pin the very bottom row of straps too so seams don't slip
  const pinIndices = new Uint32Array(pinMap.size);
  const pinPos = new Float32Array(pinMap.size * 4);
  let k = 0;
  for (const [idx, target] of pinMap) {
    pinIndices[k] = idx;
    pinPos[k * 4 + 0] = target[0];
    pinPos[k * 4 + 1] = target[1];
    pinPos[k * 4 + 2] = target[2];
    pinPos[k * 4 + 3] = 1;
    k++;
  }

  return {
    count: n, pos, vel, prev, rest, vinfo,
    pinIndices, pinPos,
    pins: Array.from(pinMap.entries()),
  };
}
