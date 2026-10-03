// Parametric dress generator.
//
// A dress is a single cloth "shell" sampled on a cylindrical grid (rows x cols).
// Every vertex is placed on — or offset from — the analytic mannequin surface,
// which is what lets the authoring view and the simulation agree exactly:
//
//    row i  ->  y(theta, t)      top hem profile -> bottom hem profile
//    col j  ->  theta            around the body
//    radius ->  bodySurface(y,theta) * fit + ease(t) + flare(t)
//
// Pleats displace theta (accordion folds), tiers modulate radius, trains and
// asymmetric hems modulate y at the bottom edge. Straps are separate islands
// stitched to the bodice with distance constraints.

import { clamp, lerp, smoothstep, TAU, v3 } from './math.js';
import { bodySurface, bodySigned, bodyCeiling, bodyNormal } from './body.js';

const D2R = Math.PI / 180;

const LEN = (p) => p;
const S = (u) => u * u * u * (u * (u * 6 - 15) + 10); // smootherstep

export const DRESS_STYLES = {
  aline: {
    label: 'A-Line Dress',
    topK: 'shoulder', topOff: -0.012,
    neckline: 'sweetheart', straps: true, pin: 'straps',
    flare: (u) => 0.235 * Math.pow(u, 1.35),
    ease: 0.014, sweep: 0.18,
  },
  ballgown: {
    label: 'Ball Gown',
    topK: 'shoulder', topOff: -0.010,
    neckline: 'straight', straps: false, pin: 'top',
    flare: (u) => 0.620 * Math.pow(u, 1.12),
    ease: 0.010, sweep: 0.30,
  },
  mermaid: {
    label: 'Mermaid Gown',
    topK: 'shoulder', topOff: -0.010,
    neckline: 'v', straps: true, pin: 'top',
    flare: (u) => (u < 0.52 ? 0.008 * u : 0.430 * Math.pow((u - 0.52) / 0.48, 1.7)),
    ease: 0.006, sweep: 0.42,
  },
  shift: {
    label: 'Shift Dress',
    topK: 'shoulder', topOff: -0.014,
    neckline: 'high', straps: false, pin: 'straps',
    flare: (u) => 0.050 * Math.pow(u, 1.5),
    ease: 0.032, sweep: 0.16,
  },
  empire: {
    label: 'Empire Gown',
    topK: 'underbust', topOff: 0.028,
    neckline: 'straight', straps: false, pin: 'top',
    flare: (u) => 0.330 * Math.pow(u, 1.18),
    ease: 0.012, sweep: 0.26,
  },
  tiered: {
    label: 'Tiered Dress',
    topK: 'shoulder', topOff: -0.012,
    neckline: 'straight', straps: true, pin: 'straps',
    flare: (u) => 0.200 * Math.pow(u, 1.1),
    ease: 0.020, sweep: 0.22, tiers: 3, tierAmp: 0.35,
  },
  wrap: {
    label: 'Wrap Dress',
    topK: 'shoulder', topOff: -0.012,
    neckline: 'v', straps: false, pin: 'straps',
    flare: (u) => 0.115 * Math.pow(u, 1.45),
    ease: 0.022, sweep: 0.35, diagonalHem: 0.34,
  },
  gown: {
    label: 'Goddess Gown',
    topK: 'bust', topOff: 0.020,
    neckline: 'v', straps: false, pin: 'top',
    flare: (u) => 0.270 * Math.pow(u, 1.55),
    ease: 0.026, sweep: 0.26, train: 0.16,
  },
  tunic: {
    label: 'Loose Tunic Dress',
    topK: 'shoulder', topOff: -0.012,
    neckline: 'high', straps: false, pin: 'straps',
    flare: (u) => 0.090 * Math.pow(u, 1.25),
    ease: 0.055, sweep: 0.20,
  },
};

const NECKLINES = {
  high: { label: 'High', depth: 0.00, front: 0.0 },
  straight: { label: 'Straight / Bateau', depth: 0.030, front: 0.10 },
  sweetheart: { label: 'Sweetheart', depth: 0.055, front: 0.75 },
  v: { label: 'Deep V', depth: 0.115, front: 1.0 },
  square: { label: 'Square', depth: 0.045, front: 0.35 },
  offshoulder: { label: 'Off-Shoulder', depth: 0.0, front: 0.0, dropBelow: 0.055 },
};

export const NECKLINE_OPTIONS = Object.entries(NECKLINES).map(([k, v]) => ({ value: k, label: v.label }));

// ------------------------------------------------------------------ helpers

function topHemY(style, neck, spec, theta, p) {
  const Y = (k) => spec.landmarks[k] * spec.H;
  const shoulderShelf = Y('shoulder') - 0.004 * spec.S;
  let y;
  const base = Y(style.topK) + style.topOff * spec.S;
  const sin = Math.sin(theta); // +1 => front
  const front = Math.max(0, sin);
  if (neck.dropBelow) {
    y = Y('shoulder') - neck.dropBelow * spec.S * p.neckDrop;
  } else {
    // depth blends front/back (a scoop back is symmetrical-ish)
    const dip = (neck.depth * spec.S * p.neckDrop) * smoothstep(0.0, 0.75, front);
    y = base - dip;
  }
  // never rise above the shoulder shelf, that region is neck-height
  return Math.min(y, shoulderShelf);
}

function hemY(style, spec, theta, p) {
  const Y = (k) => spec.landmarks[k] * spec.H;
  const top = Y('crotch') + 0.03 * spec.S;
  const bottom = 0.035 * spec.H;
  let y = lerp(bottom, top, clamp(p.length, 0, 1));
  // asymmetry: front hem lifts, back hem drops (a train reads instantly)
  const sin = Math.sin(theta);
  y += (style.sweep ?? 0.2) * p.hemSweep * 0.05 * spec.S * (0.5 - 0.5 * sin);
  if (style.diagonalHem) {
    y -= style.diagonalHem * spec.S * 0.5 * (1 + Math.cos(theta)) * p.hemSweep;
  }
  if (style.train) {
    y -= style.train * spec.S * Math.max(0, -sin) * 1.2;
  }
  return Math.max(0.012, y);
}

/** Radial offset (metres) applied on top of the fitted body surface. */
function radialEase(style, spec, t, p) {
  const ease = (style.ease ?? 0.015) * p.ease;
  const flap = style.flare(t) * p.flare;
  let r = ease + flap;
  if (style.tiers) {
    const n = style.tiers;
    const s = t * n;
    const f = s - Math.floor(s);
    // soft "ledge" per tier: fabric gathers then releases
    r += (style.tierAmp ?? 0.08) * p.tierAmp * (S(f) - f) * t * spec.S;
  }
  return r;
}

/** Angular pleat displacement (radians). */
function pleatAngle(t, theta, p) {
  if (p.pleats < 2 || p.pleatDepth <= 0.0005) return 0;
  const g = smoothstep(0.10, 0.85, t);
  const amp = p.pleatDepth * 0.55 * g / Math.max(4, p.pleats / 3);
  return amp * Math.sin(p.pleats * theta);
}

// ------------------------------------------------------------------ main build

export function buildDress(spec, p, resolution = 96) {
  const style = DRESS_STYLES[p.style] ?? DRESS_STYLES.aline;
  const neck = NECKLINES[p.neckline] ?? NECKLINES.straight;
  const rows = Math.max(16, Math.round(resolution));
  const cols = Math.max(16, Math.round(resolution * 0.8));

  const positions = [];
  const uvs = [];
  const indices = [];
  const meta = [];       // per vertex: {t, row, col}
  const pins = [];       // {index, target}

  const rowsY = [];

  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    let arc = 0;
    rowsY.push([]);
    for (let j = 0; j < cols; j++) {
      const theta0 = (j / cols) * TAU;
      const yTop = topHemY(style, neck, spec, theta0, p);
      const yBot = hemY(style, spec, theta0, p);
      let y = lerp(yTop, yBot, t);

      const dTheta = pleatAngle(t, theta0, p);
      // the pleat gathers around the waist so we re-evaluate the body at the
      // displaced angle to keep the surface hugging the figure
      const theta = theta0 + dTheta;

      const surface = bodySurface(spec, y, theta);
      const r = radiiAt(spec, y);
      let dx = surface[0] - r.cx;
      let dz = surface[1] - r.cz;
      const len = Math.hypot(dx, dz) || 1e-5;
      const out = len * p.fit + radialEase(style, spec, t, p);
      const nx = dx / len, nz = dz / len;
      const x = r.cx + nx * out;
      const z = r.cz + nz * out;

      positions.push(x, y, z);
      const prev = rowsY[i][j - 1];
      if (j === 0) arc = 0;
      else arc += Math.hypot(x - rowsY[i][j - 1][0], y - rowsY[i][j - 1][1], z - rowsY[i][j - 1][2]);
      rowsY[i].push([x, y, z]);
      uvs.push(arc, y);
      meta.push({ t, row: i, col: j, theta: theta0, yTop, yBot });
    }
  }

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      const a = i * cols + j, b = i * cols + j2;
      const c = (i + 1) * cols + j2, d = (i + 1) * cols + j;
      indices.push(a, b, c, a, c, d);
    }
  }

  // ------------------------------------------------------------ straps (islands)
  const strapVertices = [];
  let strapCount = 0;
  if (style.straps && p.straps) {
    const Y = (k) => spec.landmarks[k] * spec.H;
    const shoulderY = Y('shoulder');
    const shoulderX = 0.100 * p.shoulders * spec.S;
    for (const side of [-1, 1]) {
      const spread = p.strapInset * D2R + 0.30;
      // both attach points stay on the same side of the body: thetaFront is
      // just in front of the shoulder, thetaBack mirrors it through -Z.
      const thetaFront = Math.PI / 2 - side * spread;
      const thetaBack = -Math.PI / 2 + side * (spread + 0.04);
      const yAttachF = topHemY(style, neck, spec, thetaFront, p) + 0.012 * spec.S;
      const yAttachB = topHemY(style, neck, spec, thetaBack, p) + 0.012 * spec.S;
      const surfF = bodySurface(spec, yAttachF, thetaFront);
      const surfB = bodySurface(spec, yAttachB, thetaBack);

      const pA = [surfF[0] * p.fit, yAttachF, surfF[1] * p.fit];
      const pB = [side * shoulderX * 1.35, shoulderY + 0.026 * spec.S, 0];
      const pC = [surfB[0] * p.fit, yAttachB, surfB[1] * p.fit];

      const steps = Math.max(14, Math.round(rows * 0.22));
      const width = 3;
      const halfW = p.strapWidth * 0.5 * spec.S;
      const base = positions.length / 3;
      const endVerts = { first: [], last: [] };
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        // quadratic bezier A -> B -> C
        const iu = 1 - u;
        const q = [
          iu * iu * pA[0] + 2 * iu * u * pB[0] + u * u * pC[0],
          iu * iu * pA[1] + 2 * iu * u * pB[1] + u * u * pC[1],
          iu * iu * pA[2] + 2 * iu * u * pB[2] + u * u * pC[2],
        ];
        // lift the strap over the shoulder ridge so it rests on the body
        const ceil = bodyCeiling(spec, q[0], q[2]);
        if (ceil !== null) {
          const minY = ceil + 0.008 * spec.S;
          if (q[1] < minY) q[1] = minY;
        }
        // tangent -> frame
        const tgt = v3.norm([
          2 * iu * (pB[0] - pA[0]) + 2 * u * (pC[0] - pB[0]),
          2 * iu * (pB[1] - pA[1]) + 2 * u * (pC[1] - pB[1]),
          2 * iu * (pB[2] - pA[2]) + 2 * u * (pC[2] - pB[2]),
        ]);
        // ribbon width is the surface tangent perpendicular to the path: this
        // keeps the band flat on the body with no twist at the ends
        const bn = bodyNormal(spec, q[1], q[0], q[2]);
        let sideD = v3.cross(tgt, bn);
        if (v3.len(sideD) < 1e-4) {
          const radial = v3.norm([q[0], 0.001, q[2]]);
          sideD = v3.cross(tgt, radial);
        }
        sideD = v3.norm(sideD);
        for (let j = 0; j < width; j++) {
          const w = (j / (width - 1) - 0.5) * 2 * halfW;
          const px = q[0] + sideD[0] * w, py = q[1] + sideD[1] * w, pz = q[2] + sideD[2] * w;
          const vi = positions.length / 3;
          positions.push(px, py, pz);
          uvs.push(j / (width - 1) * halfW * 2, u * 0.30 * spec.S);
          meta.push({ t: -1, row: i, col: j, strap: side, u });
          if (i === 0) endVerts.first.push(vi);
          if (i === steps) endVerts.last.push(vi);
          // pin the part that crosses the shoulder
          if (Math.abs(u - 0.5) < p.strapPinRange) {
            pins.push({ index: vi, target: [px, py, pz] });
          }
        }
      }
      for (let i = 0; i < steps; i++) {
        for (let j = 0; j < width - 1; j++) {
          const a = base + i * width + j;
          const b = a + 1;
          const c = base + (i + 1) * width + j + 1;
          const d = base + (i + 1) * width + j;
          indices.push(a, b, c, a, c, d);
        }
      }
      strapVertices.push(endVerts);
      strapCount++;
    }
  }

  const pos = new Float32Array(positions);
  const uv = new Float32Array(uvs);
  const idx = new Uint32Array(indices);
  const normals = computeNormals(pos, idx);

  return {
    positions: pos,
    normals,
    uvs: uv,
    indices: idx,
    meta,
    pins,
    straps: strapVertices,
    rows,
    cols,
    style,
    islands: buildIslands(meta),
  };
}

function radiiAt(spec, y) {
  const { rings } = spec;
  const n = rings.length;
  if (y <= rings[0].y) return rings[0];
  if (y >= rings[n - 1].y) return rings[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rings[mid].y <= y) lo = mid; else hi = mid;
  }
  const a = rings[lo], b = rings[hi];
  const t = (y - a.y) / Math.max(1e-6, b.y - a.y);
  return {
    cx: lerp(a.cx, b.cx, t),
    cz: lerp(a.cz, b.cz, t),
    rx: lerp(a.rx, b.rx, t),
    rz: lerp(a.rz, b.rz, t),
  };
}

/** Consecutive runs of vertices belonging to the same island (shell / straps). */
function buildIslands(meta) {
  const islands = [];
  let cur = null;
  for (let i = 0; i < meta.length; i++) {
    const key = meta[i].strap === undefined ? 'shell' : `strap${meta[i].strap}`;
    if (!cur || cur.key !== key) {
      cur = { key, start: i, end: meta.length };
      islands.push(cur);
    }
  }
  return islands;
}

export function computeNormals(pos, idx) {
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const i0 = idx[i] * 3, i1 = idx[i + 1] * 3, i2 = idx[i + 2] * 3;
    const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
    const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }
  for (let i = 0; i < pos.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

/** Per-vertex area, used to derive physical mass from areal density (kg/m^2). */
export function vertexAreas(pos, idx, vertCount) {
  const areas = new Float32Array(vertCount);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
    const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
    const area = Math.hypot(cx, cy, cz) * 0.5 / 3;
    areas[idx[i]] += area;
    areas[idx[i + 1]] += area;
    areas[idx[i + 2]] += area;
  }
  return areas;
}
