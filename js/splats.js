/* ============================================================
 * Frontier · SDF Terrain Lab — Splatmap channels
 *
 * Derives Gaea-style splat channels from the eroded SDF field:
 *   height · slope · curvature · flow · erosion · sediment ·
 *   peaks · points
 * and blends them into per-vertex layer weights
 * (grass / dirt / rock / sand / snow) for the splat shader.
 * ============================================================ */

import { smoothstep, clamp01 } from './mountain.js';
import { Perlin2D, fbm01 } from './noise.js';

/** All analysis channels, normalized to [0,1] for preview & blending. */
export function computeChannels({ h, N, voxel, flow, flowMax, pits, erosionMap, depositMap, pointsMap, channelsMap }) {
  const size = N * N;

  // ---- height ----
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < size; i++) { const v = h[i]; if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
  const hSpan = Math.max(hMax - hMin, 1e-6);
  const height = new Float32Array(size);

  // ---- slope & curvature (central differences on the SDF) ----
  const slope = new Float32Array(size);
  const curvature = new Float32Array(size);
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      const gx = (h[c + 1] - h[c - 1]) / (2 * voxel);
      const gz = (h[c + N] - h[c - N]) / (2 * voxel);
      slope[c] = Math.hypot(gx, gz);
      const lap = h[c + 1] + h[c - 1] + h[c + N] + h[c - N] - 4 * h[c];
      curvature[c] = lap / (voxel * voxel);
    }
  }
  // Steepness reference (m/m) — resolution-independent, normalized to
  // the terrain's own height span so a tall mountain isn't "all rock"
  // just for being tall. ~3.5% of the span per grid cell; only true
  // near-vertical cliffs cross the rock threshold.
  const slopeRef = Math.max(1.2, hSpan * 0.035);
  let cMin = Infinity, cMax = -Infinity;
  for (let i = 0; i < size; i++) { const v = curvature[i]; if (v < cMin) cMin = v; if (v > cMax) cMax = v; }
  const cSpan = Math.max(cMax - cMin, 1e-6);

  // ---- mottle: low-frequency soil variation (~11 m patches) ----
  // Modulates the layer weights in computeSplatWeights so grassland,
  // scree and dirt don't read as flat single-colour fields — the
  // "mottled" look of real ground cover (fixed seed: stable across
  // rebuilds, independent of the terrain seed).
  const mottle = new Float32Array(size);
  {
    const mN = new Perlin2D(0x5011071);
    const c2 = (N - 1) / 2;
    for (let j = 0; j < N; j++) {
      const z = (j - c2) * voxel;
      for (let i = 0; i < N; i++) {
        const x = (i - c2) * voxel;
        mottle[j * N + i] = fbm01(mN, x * 0.09 + 11.1, z * 0.09 - 6.6,
          { octaves: 2, lacunarity: 2.2, gain: 0.5 });
      }
    }
  }

  // ---- flow (log-normalized wetness) ----
  const flowN = new Float32Array(size);
  const hasFlow = !!flow && flowMax > 1;
  if (hasFlow) {
    const logF = Math.log1p(flowMax);
    for (let i = 0; i < size; i++) flowN[i] = Math.log1p(flow[i]) / logF;
  }

  // ---- erosion / sediment (blurred 3×3, then normalized by p99) ----
  const blur3 = (src) => {
    const out = new Float32Array(size);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let acc = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = i + dx, ny = j + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        acc += src[ny * N + nx]; n++;
      }
      out[j * N + i] = acc / n;
    }
    return out;
  };
  const normField = (src) => {
    let max = 0;
    for (let i = 0; i < size; i++) { const v = src[i]; if (v > max) max = v; }
    const out = new Float32Array(size);
    if (max <= 1e-9) return out;
    const sorted = Array.from(src).sort((a, b) => a - b);
    const p99 = Math.max(sorted[(size * 0.99) | 0], 1e-5);
    for (let i = 0; i < size; i++) out[i] = Math.min(1, src[i] / p99);
    return out;
  };
  const erosionN = normField(blur3(erosionMap || new Float32Array(size)));
  const sedimentN = normField(blur3(depositMap || new Float32Array(size)));
  // fine-channel layer: the micro-erosion pass's rill network, kept
  // separate from the big-river erosion so it reads as dense dark
  // branching lines (Gaea's separate Channels layer)
  const channelsN = channelsMap ? normField(blur3(channelsMap)) : new Float32Array(size);

  // ---- points: drop impact density, soft-boxed ----
  const pointsRaw = pointsMap || new Float32Array(size);
  const pointsN = new Float32Array(size);
  let pMax = 0;
  for (let i = 0; i < size; i++) if (pointsRaw[i] > pMax) pMax = pointsRaw[i];
  if (pMax > 0) {
    const R = 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const nx = i + dx, ny = j + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        acc += pointsRaw[ny * N + nx] * (dx === 0 && dy === 0 ? 1 : 0.45);
      }
      pointsN[j * N + i] = acc / (pMax * 5);
    }
  }

  // ---- peaks: dominant local maxima ----
  // A cell is a peak when it is the max of its 5×5 neighbourhood AND
  // no cell within 11×11 beats it by more than 1.5 m (drops subordinate
  // noise bumps). Blobs are then dilated + softly blurred for splats.
  const peaks = new Float32Array(size);
  const hThresh = hMin + (hMax - hMin) * 0.5;
  const R5 = 5, R2 = 2;
  for (let j = R5; j < N - R5; j++) {
    for (let i = R5; i < N - R5; i++) {
      const c = j * N + i;
      if (h[c] < hThresh) continue;
      let isMax = true;
      outer: for (let dy = -R2; dy <= R2; dy++) {
        for (let dx = -R2; dx <= R2; dx++) {
          if (h[(j + dy) * N + (i + dx)] > h[c] + 1e-9) { isMax = false; break outer; }
        }
      }
      if (!isMax) continue;
      let dominant = true;
      for (let dy = -R5; dy <= R5 && dominant; dy++) {
        for (let dx = -R5; dx <= R5; dx++) {
          if (h[(j + dy) * N + (i + dx)] > h[c] + 1.5) { dominant = false; break; }
        }
      }
      if (dominant) peaks[c] = 1;
    }
  }
  // dilate (max filter) ×2 → solid ~5-cell cores, then one 3×3 box blur
  const dilate = (src) => {
    const out = new Float32Array(size);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = i + dx, ny = j + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (src[ny * N + nx] > m) m = src[ny * N + nx];
      }
      out[j * N + i] = m;
    }
    return out;
  };
  let pm = dilate(dilate(peaks));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let acc = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = i + dx, ny = j + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      acc += pm[ny * N + nx]; n++;
    }
    peaks[j * N + i] = acc / n;
  }

  // ---- normalized height & curvature ----
  for (let i = 0; i < size; i++) {
    height[i] = (h[i] - hMin) / hSpan;
    curvature[i] = clamp01(0.5 - curvature[i] / (cSpan * 2.2));
  }

  return {
    height, slope, curvature, flowN, erosionN, sedimentN, channelsN, peaks, pointsN, mottle,
    hMin, hMax, slopeRef,
    raw: { erosionMap, depositMap, pointsMap, channelsMap },
  };
}

/**
 * Gaea-style layer weights from the channels.
 * `mat` is a material preset from the splatmap library — its `rules`
 * decide where each layer lives (slope/altitude/flow gates, snow cap).
 * Returns Float32Array size*5 → [grass, dirt, rock, sand, snow] per vertex.
 */
export function computeSplatWeights({ channels, h, N, seaLevel, snowLine, mat }) {
  const size = N * N;
  const { slope, flowN, erosionN, sedimentN, peaks, pointsN, slopeRef } = channels;
  const channelsN = channels.channelsN || new Float32Array(size);
  const R = (mat && mat.rules) || {
    grassSlope: [0.15, 0.52], grassFlow: [0.55, 0.95], grassAlt: [34, 58],
    rockSlope: [0.84, 0.96], rockPeak: 0.85, dirtBelt: [0.40, 0.60],
    soilErode: [0.75, 0.95, 0.10], snowCap: 1.0,
  };
  const w = new Float32Array(size * 5);
  const mottle = channels.mottle || new Float32Array(size);
  // three phase-shifted reads of the same patch field → grass, dirt
  // and rock vary together but not in lockstep (soil mottling)
  const mG = (i) => 0.78 + 0.44 * mottle[i];
  const mD = (i) => 0.80 + 0.40 * ((mottle[i] + 0.37) % 1);
  const mR = (i) => 0.88 + 0.24 * ((mottle[i] + 0.71) % 1);

  for (let i = 0; i < size; i++) {
    const hv = h[i];
    const sl = clamp01(slope[i] / slopeRef);
    const aboveSea = hv - seaLevel;

    // snow: high & not too steep (preset snowCap can mute/remove it)
    const snow = smoothstep(snowLine - 3.0, snowLine + 3.0, hv)
      * (1 - smoothstep(0.90, 1.0, sl)) * R.snowCap;

    // rock: only the steepest upper walls + summit peaks. Moderate
    // slopes read as scree/soil, not bare wall, so the mountain has a
    // realistic grass→dirt→rock→snow breakdown instead of a bare cone.
    const rockSlope = smoothstep(R.rockSlope[0], R.rockSlope[1], sl);
    const rockPeak = peaks[i] * R.rockPeak;
    let rock = Math.max(rockSlope, rockPeak);
    // fine-channel banks carry debris, not bare wall: the micro-rill
    // network is a few cells of 1 m-scale steepness, which would
    // otherwise speckle the whole flank with rock dots
    rock *= 1 - 0.85 * channelsN[i];

    // sand: narrow beach band hugging the waterline on the dry side
    const band = 1 - smoothstep(0.10, 0.85, aboveSea);
    const flat = 1 - smoothstep(0.12, 0.38, sl);
    let sand = band * flat;

    // dirt: broad mid-slope soil/scree belt + carved/sedimented ground
    // + the fine-channel layer (dense dark branching lines, Gaea-style)
    const soilEroded = clamp01(erosionN[i] * R.soilErode[0]
      + sedimentN[i] * R.soilErode[1] + flowN[i] * R.soilErode[2]
      + channelsN[i] * 1.4);
    const dirtBelt = smoothstep(R.dirtBelt[0], R.dirtBelt[1], sl) * (1 - smoothstep(0.75, 0.90, sl));
    let dirt = clamp01(Math.max(dirtBelt * 0.85, soilEroded * 1.05 + sedimentN[i] * 0.30))
      * (1 - sand) * (1 - snow) * (1 - rockSlope * 0.7);

    // grass: low & moderate slopes (hilly foothills included), dry,
    // not beach, not alpine — preset sets the altitude ceiling
    let grass = (1 - smoothstep(R.grassSlope[0], R.grassSlope[1], sl))
      * (1 - smoothstep(R.grassFlow[0], R.grassFlow[1], flowN[i]))
      * (1 - sand) * (1 - snow) * (1 - rock)
      * (1 - smoothstep(R.grassAlt[0], R.grassAlt[1], aboveSea));

    // seabed: no grass underwater — sandy shallows over a rocky deep
    // floor. Engages only in the water (0.5 m ramp below the line),
    // never on the dry beach side.
    const sub = smoothstep(0.0, 0.5, seaLevel - hv);
    if (sub > 0) {
      const depth = Math.max(0, -aboveSea);
      const shallow = 1 - smoothstep(1.0, 5.0, depth);
      grass = 0;
      sand = Math.max(sand, sub * (0.5 + 0.5 * shallow));
      rock = Math.max(rock, sub * (1 - shallow) * 0.8);
      dirt *= 1 - 0.6 * sub;
    }

    // drop impact points darken / enrich soil (trampled paths),
    // low-frequency mottling breaks the flat colour fields up
    const wGrass = grass * (1 - 0.35 * pointsN[i]) * mG(i);
    const wDirt = dirt * (1 + 0.5 * pointsN[i]) * mD(i);
    rock *= mR(i);

    const sum = wGrass + wDirt + rock * (1 - snow) + sand + snow + 1e-6;
    w[i * 5 + 0] = wGrass / sum;
    w[i * 5 + 1] = wDirt / sum;
    w[i * 5 + 2] = (rock * (1 - snow)) / sum;
    w[i * 5 + 3] = sand / sum;
    w[i * 5 + 4] = snow / sum;
  }
  return w;
}

/** Pick the preview field for the given channel mode (null = blended albedo). */
export function previewField(mode, channels) {
  switch (mode) {
    case 'height': return channels.height;
    case 'slope': return Array.from(channels.slope).map((v) => v / (channels.slopeRef * 1.2));
    case 'curvature': return channels.curvature;
    case 'flow': return channels.flowN;
    case 'erosion': return channels.erosionN;
    case 'sediment': return channels.sedimentN;
    case 'channels': return channels.channelsN;
    case 'peaks': return channels.peaks;
    case 'points': return channels.pointsN;
    default: return null;
  }
}
