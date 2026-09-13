/**
 * Naive surface-nets polygonizer over the SDF narrow band.
 *
 * Why surface nets: no marching-cubes tables, smooth normals straight from the
 * SDF gradient (better than MC's), and quad output that shades beautifully.
 * Per-vertex bake: normal + AO (SDF cone trace) + mean curvature (Laplacian)
 * + all sim attributes (flow/erode/wet/sed/hard) for the sat-style shader.
 */
import { Volume } from '../core/volume';
import { clamp01 } from '../core/noise';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  aFlow: Float32Array;
  aErode: Float32Array;
  aWet: Float32Array;
  aSed: Float32Array;
  aAO: Float32Array;
  aCurv: Float32Array;
  aHard: Float32Array;
  aRain: Float32Array;
  indices: Uint32Array;
  vertCount: number;
  triCount: number;
}

export interface PolygonizeOptions {
  /** Full quality bakes AO + curvature (slower). Fast mode fills AO=1/curv=0. */
  bakeAO: boolean;
  bakeCurv: boolean;
}

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const _g = new Float32Array(3);

export function polygonize(vol: Volume, opts: PolygonizeOptions): MeshData {
  const res = vol.res;
  const vox = vol.vox;
  const { sdf } = vol;
  const cw = res - 1; // cells per side
  const cellVert = new Int32Array(cw * cw * cw).fill(-1);
  const cidx = (i: number, j: number, k: number) => (k * cw + j) * cw + i;
  const vidx = (i: number, j: number, k: number) => (k * res + j) * res + i;

  const pos: number[] = [];
  const cornerVals = new Float32Array(8);

  // ---- pass 1: one vertex per surface cell ---------------------------------
  for (let k = 0; k < cw; k++) {
    for (let j = 0; j < cw; j++) {
      for (let i = 0; i < cw; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const v = sdf[vidx(i + CORNERS[c][0], j + CORNERS[c][1], k + CORNERS[c][2])];
          cornerVals[c] = v;
          if (v <= 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        // Average of edge zero-crossings.
        let px = 0, py = 0, pz = 0, m = 0;
        for (let e = 0; e < 12; e++) {
          const a = cornerVals[EDGES[e][0]], b = cornerVals[EDGES[e][1]];
          const sa = a <= 0, sb = b <= 0;
          if (sa === sb) continue;
          const t = a / (a - b);
          const c0 = CORNERS[EDGES[e][0]], c1 = CORNERS[EDGES[e][1]];
          px += (i + c0[0] + (c1[0] - c0[0]) * t);
          py += (j + c0[1] + (c1[1] - c0[1]) * t);
          pz += (k + c0[2] + (c1[2] - c0[2]) * t);
          m++;
        }
        if (m === 0) continue;
        // Voxel-center lattice → world.
        pos.push(
          vol.ox + (px / m + 0.5) * vox,
          vol.oy + (py / m + 0.5) * vox,
          vol.oz + (pz / m + 0.5) * vox
        );
        cellVert[cidx(i, j, k)] = pos.length / 3 - 1;
      }
    }
  }

  // ---- pass 2: quads across sign-changing lattice edges --------------------
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (!flip) idx.push(a, b, d, a, d, c);
    else idx.push(a, d, b, a, c, d);
  };
  // X edges: (i,j,k)→(i+1,j,k), j,k in [1, res-2]
  for (let k = 1; k <= res - 2; k++) {
    for (let j = 1; j <= res - 2; j++) {
      for (let i = 0; i <= res - 2; i++) {
        const d0 = sdf[vidx(i, j, k)], d1 = sdf[vidx(i + 1, j, k)];
        if ((d0 <= 0) === (d1 <= 0)) continue;
        quad(
          cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)],
          cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)],
          d0 > d1 // base winding gives +x; flip when outward is -x
        );
      }
    }
  }
  // Y edges: base winding gives -y; keep when outward is -y (d0 > d1).
  for (let k = 1; k <= res - 2; k++) {
    for (let j = 0; j <= res - 2; j++) {
      for (let i = 1; i <= res - 2; i++) {
        const d0 = sdf[vidx(i, j, k)], d1 = sdf[vidx(i, j + 1, k)];
        if ((d0 <= 0) === (d1 <= 0)) continue;
        quad(
          cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i, j, k - 1)],
          cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)],
          d0 <= d1
        );
      }
    }
  }
  // Z edges: base winding gives +z; flip when outward is -z (d0 > d1).
  for (let k = 0; k <= res - 2; k++) {
    for (let j = 1; j <= res - 2; j++) {
      for (let i = 1; i <= res - 2; i++) {
        const d0 = sdf[vidx(i, j, k)], d1 = sdf[vidx(i, j, k + 1)];
        if ((d0 <= 0) === (d1 <= 0)) continue;
        quad(
          cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)],
          cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)],
          d0 > d1
        );
      }
    }
  }

  // ---- pass 3: bake normals + AO + curvature + attributes -------------------
  const nv = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(nv * 3);
  const aFlow = new Float32Array(nv);
  const aErode = new Float32Array(nv);
  const aWet = new Float32Array(nv);
  const aSed = new Float32Array(nv);
  const aAO = new Float32Array(nv);
  const aCurv = new Float32Array(nv);
  const aHard = new Float32Array(nv);
  const aRain = new Float32Array(nv);

  const e = vox * 0.75;
  const le = vox * 1.5;
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    // Smooth SDF-gradient normal.
    const fx1 = vol.sampleSdf(x + e, y, z), fx0 = vol.sampleSdf(x - e, y, z);
    const fy1 = vol.sampleSdf(x, y + e, z), fy0 = vol.sampleSdf(x, y - e, z);
    const fz1 = vol.sampleSdf(x, y, z + e), fz0 = vol.sampleSdf(x, y, z - e);
    _g[0] = (fx1 - fx0) / (2 * e);
    _g[1] = (fy1 - fy0) / (2 * e);
    _g[2] = (fz1 - fz0) / (2 * e);
    const gl = Math.sqrt(_g[0] * _g[0] + _g[1] * _g[1] + _g[2] * _g[2]) + 1e-9;
    const nx = _g[0] / gl, ny = _g[1] / gl, nz = _g[2] / gl;
    normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;

    aFlow[v] = vol.sample(vol.flow, x, y, z);
    aErode[v] = vol.sample(vol.erode, x, y, z);
    aWet[v] = clamp01(vol.sample(vol.wet, x, y, z));
    aSed[v] = vol.sample(vol.sed, x, y, z);
    aHard[v] = clamp01(vol.sample(vol.hard, x, y, z));
    aRain[v] = clamp01(vol.sample(vol.rain, x, y, z));

    if (opts.bakeAO) {
      // 3-tap SDF occlusion along the normal (fast Quilez-style).
      let occ = 0, sca = 1;
      for (let t = 1; t <= 3; t++) {
        const h = vox * (0.8 + 1.6 * t);
        const d = vol.sampleSdf(x + nx * h, y + ny * h, z + nz * h);
        occ += (h - d) * sca;
        sca *= 0.85;
      }
      aAO[v] = clamp01(1 - 1.9 * occ);
    } else {
      aAO[v] = 1;
    }

    if (opts.bakeCurv) {
      // Mean curvature from SDF Laplacian, reusing |grad|.
      const c = vol.sampleSdf(x, y, z);
      const lap = vol.sampleSdf(x + le, y, z) + vol.sampleSdf(x - le, y, z) +
        vol.sampleSdf(x, y + le, z) + vol.sampleSdf(x, y - le, z) +
        vol.sampleSdf(x, y, z + le) + vol.sampleSdf(x, y, z - le) - 6 * c;
      aCurv[v] = lap / (2 * Math.max(gl, 1e-4) * le * le);
    } else {
      aCurv[v] = 0;
    }
  }

  return {
    positions, normals, aFlow, aErode, aWet, aSed, aAO, aCurv, aHard, aRain,
    indices: Uint32Array.from(idx),
    vertCount: nv,
    triCount: idx.length / 3,
  };
}
