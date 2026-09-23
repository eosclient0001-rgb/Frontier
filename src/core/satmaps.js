// ============================================================================
//  satmaps.js — Surface Attribute Maps (Gaea-style)
//
//  Derives the texturing inputs from the final SDF + erosion accumulators:
//    flow, sediment, wear, peaks, pointiness, slope, height, wetness
//  Packed into two RGBA8 textures (satA, satB) for the renderer, plus
//  individual 8-bit layers for the map gallery / export.
// ============================================================================

export const SAT_CHANNELS = [
  { key: 'flow',      label: 'Flow',       desc: 'accumulated droplet flow — drainage networks' },
  { key: 'sediment',  label: 'Sediment',   desc: 'deposited load — alluvial fans & floodplains' },
  { key: 'wear',      label: 'Wear',       desc: 'total removed material — erosion intensity' },
  { key: 'peaks',     label: 'Peaks',      desc: 'local maxima of the surface' },
  { key: 'pointiness',label: 'Pointiness', desc: 'convexity (Laplacian) — crests vs hollows' },
  { key: 'slope',     label: 'Slope',      desc: 'surface gradient magnitude' },
  { key: 'height',    label: 'Height',     desc: 'normalised elevation' },
  { key: 'wetness',   label: 'Wetness',    desc: 'smoothed flow — dampness for texturing' },
];

/**
 * @param {SDFVolume} vol
 * @param {Float32Array} colH    column heights (nx*nz, i + k*nx)
 * @param {object} acc  { flow, sediment, wear }  from erodeSDF (may be null)
 */
export function computeSatMaps(vol, colH, acc) {
  const nx = vol.nx, nz = vol.nz, N = nx * nz;
  const vox = vol.vox[0];

  const layers = {};
  for (const c of SAT_CHANNELS) layers[c.key] = new Float32Array(N);

  // height + slope + pointiness from the heightfield -------------------------
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < N; i++) {
    if (colH[i] < hMin) hMin = colH[i];
    if (colH[i] > hMax) hMax = colH[i];
  }
  const hRange = Math.max(1e-3, hMax - hMin);
  const at = (i, k) => colH[Math.min(nz - 1, Math.max(0, k)) * nx + Math.min(nx - 1, Math.max(0, i))];

  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const idx = k * nx + i;
      const h = colH[idx];
      layers.height[idx] = (h - hMin) / hRange;

      const dx = (at(i + 1, k) - at(i - 1, k)) / (2 * vox);
      const dz = (at(i, k + 1) - at(i, k - 1)) / (2 * vox);
      layers.slope[idx] = Math.min(1, Math.hypot(dx, dz) / 1.6); // saturates ~58°

      const lap = (at(i + 1, k) + at(i - 1, k) + at(i, k + 1) + at(i, k - 1) - 4 * h) / (vox * vox);
      layers.pointiness[idx] = Math.tanh(lap * 3.0); // [-1 concave .. 1 convex]
    }
  }

  // peaks: local maxima within a 5-cell window, softly dilated ----------------
  const peakR = 3;
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const h = colH[k * nx + i];
      let isMax = 1;
      for (let dk = -peakR; dk <= peakR && isMax; dk++) {
        const kk = k + dk; if (kk < 0 || kk >= nz) continue;
        for (let di = -peakR; di <= peakR; di++) {
          const ii = i + di; if (ii < 0 || ii >= nx) continue;
          if (colH[kk * nx + ii] > h) { isMax = 0; break; }
        }
      }
      layers.peaks[k * nx + i] = isMax;
    }
  }
  softDilate(layers.peaks, nx, nz, 1);

  // erosion accumulators ------------------------------------------------------
  const flow = acc ? acc.flow : new Float32Array(N);
  const sediment = acc ? acc.sediment : new Float32Array(N);
  const wear = acc ? acc.wear : new Float32Array(N);

  logNorm(flow, layers.flow, 0.6);
  linNorm(sediment, layers.sediment);
  linNorm(wear, layers.wear);
  // wetness: smoothed flow, heavier compression
  boxBlur(flow, nx, nz, 2);
  logNorm(flow, layers.wetness, 1.6);

  // ---- pack satA = (flow, sediment, wear, peaks)  satB = (pointiness, slope, height, wetness)
  const satA = new Uint8Array(N * 4), satB = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    satA[i * 4 + 0] = toU8(layers.flow[i]);
    satA[i * 4 + 1] = toU8(layers.sediment[i]);
    satA[i * 4 + 2] = toU8(layers.wear[i]);
    satA[i * 4 + 3] = toU8(layers.peaks[i]);
    satB[i * 4 + 0] = toU8(layers.pointiness[i] * 0.5 + 0.5);
    satB[i * 4 + 1] = toU8(layers.slope[i]);
    satB[i * 4 + 2] = toU8(layers.height[i]);
    satB[i * 4 + 3] = toU8(layers.wetness[i]);
  }

  // individual 8-bit layers for the gallery / export
  const maps = {};
  for (const c of SAT_CHANNELS) {
    const u8 = new Uint8Array(N);
    const src = layers[c.key];
    for (let i = 0; i < N; i++) u8[i] = toU8(c.key === 'pointiness' ? src[i] * 0.5 + 0.5 : src[i]);
    maps[c.key] = u8;
  }

  return { satA, satB, maps, heightRange: [hMin, hMax] };
}

// ---- helpers -----------------------------------------------------------------
function toU8(v) { return v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0; }

function linNorm(src, dst) {
  let m = 0;
  for (let i = 0; i < src.length; i++) if (src[i] > m) m = src[i];
  const s = 1 / Math.max(1e-6, m);
  for (let i = 0; i < src.length; i++) dst[i] = src[i] * s;
}

function logNorm(src, dst, softness = 1) {
  let m = 0;
  for (let i = 0; i < src.length; i++) { const v = Math.log1p(src[i]); dst[i] = v; if (v > m) m = v; }
  const s = 1 / Math.max(1e-6, m);
  for (let i = 0; i < src.length; i++) dst[i] = Math.pow(dst[i] * s, 1 / (1 + softness));
}

function boxBlur(a, nx, nz, r) {
  const tmp = new Float32Array(a.length);
  // separable box blur, in-place over `a`
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      let s = 0, c = 0;
      for (let di = -r; di <= r; di++) {
        const ii = i + di; if (ii < 0 || ii >= nx) continue;
        s += a[k * nx + ii]; c++;
      }
      tmp[k * nx + i] = s / c;
    }
  }
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      let s = 0, c = 0;
      for (let dk = -r; dk <= r; dk++) {
        const kk = k + dk; if (kk < 0 || kk >= nz) continue;
        s += tmp[kk * nx + i]; c++;
      }
      a[k * nx + i] = s / c;
    }
  }
}

function softDilate(a, nx, nz, r) {
  const tmp = Float32Array.from(a);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      let m = tmp[k * nx + i];
      for (let dk = -r; dk <= r; dk++) {
        const kk = k + dk; if (kk < 0 || kk >= nz) continue;
        for (let di = -r; di <= r; di++) {
          const ii = i + di; if (ii < 0 || ii >= nx) continue;
          const v = tmp[kk * nx + ii] * (dk === 0 && di === 0 ? 1 : 0.65);
          if (v > m) m = v;
        }
      }
      a[k * nx + i] = m;
    }
  }
}
