/* ============================================================
 * Frontier · SDF Terrain Lab — Hydraulic erosion (SDF-domain)
 *
 * The terrain lives as a scalar SDF height field h[] — signed
 * distance from the sea plane to the implicit surface. Erosion
 * operates DIRECTLY on this field; the mesh is never touched.
 *
 * Two complementary solvers, both particle/flow based:
 *
 *  1. THERMAL (drop) erosion — thousands of water drops fall
 *     on the surface, follow steepest descent with jitter, carry
 *     slope-limited sediment (Taylor-style transport capacity)
 *     and deposit it where they slow down. They carve with a
 *     3×3 tool bit (U-shaped rills, not 1-cell notches) and
 *     leave sediment lobes where they stop.
 *
 *  2. HYDRAULIC flow + SEDIMENT ROUTING — D8 flow-accumulation
 *     routes every cell's water to its lowest neighbour. Each
 *     pass then walks the grid highest → lowest, moving a
 *     sediment load downstream: cells pick up material while
 *     load < transport capacity (incision) and deposit it as
 *     alluvial lobes where load > capacity (valley floors,
 *     piedmont fans). Flow is recomputed each pass so rivers
 *     re-route as they cut.
 *
 * RESOLUTION MATCH: every cut per step is clamped to
 *     maxCut = cutFraction × voxel
 * so the depth carved is always proportional to the grid
 * resolution — fine grids cut finer slices, never aliased.
 * Drop path length is given in METERS and converted to steps
 * via the voxel size, so erosion is comparable across
 * resolutions.
 * ============================================================ */

import { mulberry32, Perlin2D, subseed } from './noise.js';

const NEI = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2],
];

// 3×3 tool bit for carving (U-shaped rill): centre + neighbours
const TOOL = [
  [0, 0, 0.50], [1, 0, 0.12], [-1, 0, 0.12], [0, 1, 0.12], [0, -1, 0.12],
  [1, 1, 0.05], [1, -1, 0.05], [-1, 1, 0.05], [-1, -1, 0.05],
];
// 3×3 deposit lobe (alluvial fan / drop mound)
const LOBE = [
  [0, 0, 0.40], [1, 0, 0.13], [-1, 0, 0.13], [0, 1, 0.13], [0, -1, 0.13],
  [1, 1, 0.06], [1, -1, 0.06], [-1, 1, 0.06], [-1, -1, 0.06],
];
// 5×5 alluvial FAN — spreads hydraulic sediment into a broad piedmont
// fan at the mountain's base (the "base sedimentation"), vs the tight
// 3×3 LOBE used for thermal drop mounds.
const FAN = [
  [0, 0, 0.30],
  [1, 0, 0.09], [-1, 0, 0.09], [0, 1, 0.09], [0, -1, 0.09],
  [1, 1, 0.045], [1, -1, 0.045], [-1, 1, 0.045], [-1, -1, 0.045],
  [2, 0, 0.05], [-2, 0, 0.05], [0, 2, 0.05], [0, -2, 0.05],
  [2, 1, 0.02], [2, -1, 0.02], [-2, 1, 0.02], [-2, -1, 0.02],
  [1, 2, 0.02], [1, -2, 0.02], [-1, 2, 0.02], [-1, -2, 0.02],
  [2, 2, 0.015], [2, -2, 0.015], [-2, 2, 0.015], [-2, -2, 0.015],
];

function smooth(a, b, x) {
  const t = (x - a) / (b - a);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Carve `dh` metres with a 3×3 tool bit (centre-weighted). */
function carveKernel(h, N, cx, cy, dh, map, bedrock) {
  for (let k = 0; k < 9; k++) {
    const nx = cx + TOOL[k][0], ny = cy + TOOL[k][1];
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const ni = ny * N + nx;
    const e = Math.min(dh * TOOL[k][2], h[ni] - bedrock);
    if (e > 1e-9) {
      h[ni] -= e;
      map[ni] += e;
    }
  }
}

/** Deposit `dh` metres as a soft 3×3 lobe. */
function depositKernel(h, N, cx, cy, dh, map) {
  for (let k = 0; k < 9; k++) {
    const nx = cx + LOBE[k][0], ny = cy + LOBE[k][1];
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const ni = ny * N + nx;
    const d = dh * LOBE[k][2];
    if (d > 1e-9) {
      h[ni] += d;
      map[ni] += d;
    }
  }
}

/** Deposit `dh` metres as a broad 5×5 alluvial fan. */
function depositFan(h, N, cx, cy, dh, map) {
  for (let k = 0; k < FAN.length; k++) {
    const nx = cx + FAN[k][0], ny = cy + FAN[k][1];
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const ni = ny * N + nx;
    const d = dh * FAN[k][2];
    if (d > 1e-9) {
      h[ni] += d;
      map[ni] += d;
    }
  }
}

/**
 * Particle (thermal) erosion on the SDF field.
 * Mutates `h` in place; accumulates into the map buffers.
 *
 * @returns {{carvedM3:number, depositedM3:number, stops:number, steps:number}}
 */
export function thermalErode({
  h, N, voxel, rng,
  drops, dropSize, erodibility, traversal, cutFraction,
  bedrock, erosionMap, depositMap, pointsMap, downIdx = null,
}) {
  // world-space drop path -> grid steps (this is where resolution
  // and cut depth stay matched)
  const steps = Math.max(16, Math.round(traversal / voxel));
  const cutPerStep = voxel * cutFraction;
  const cellArea = voxel * voxel;

  let carved = 0, deposited = 0, stops = 0;
  // per-drop erosion budget (world mass): keeps gorges finite and the
  // total carved volume comparable across resolutions. Deliberately
  // small — thermal weathering is subtle texture, the hydraulic
  // network owns the visible channels (Gaea keeps these separate).
  const maxErode = dropSize * 0.05;
  // Bias drop starts toward the upper mountain: real rills form where
  // runoff concentrates on the slopes above the drainage, not as a
  // uniform carpet over the lowland. (Re-sample a few times per drop.)
  let hMinT = Infinity, hMaxT = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < hMinT) hMinT = h[i]; if (h[i] > hMaxT) hMaxT = h[i]; }
  const startThresh = hMinT + (hMaxT - hMinT) * 0.55;
  const dumpAt = (cx, cy, sediment) => {
    if (sediment <= 1e-9) return;
    const depMass = Math.min(sediment, cutPerStep * 2.5 * cellArea);
    depositKernel(h, N, cx, cy, depMass / cellArea, depositMap);
    deposited += depMass;
  };

  for (let d = 0; d < drops; d++) {
    let cx = 1 + ((rng() * (N - 2)) | 0);
    let cy = 1 + ((rng() * (N - 2)) | 0);
    // re-sample up to 3× until the start lands on the upper mountain
    for (let r = 0; r < 3; r++) {
      if (h[cy * N + cx] > startThresh) break;
      cx = 1 + ((rng() * (N - 2)) | 0);
      cy = 1 + ((rng() * (N - 2)) | 0);
    }
    let sediment = 0; // carried mass (world units, grid-independent)
    let carvedDrop = 0; // erosion spent from this drop's budget
    let st = 0;
    while (st < steps) {
      st++;
      const idx = cy * N + cx;
      const cur = h[idx];
      if (cur <= bedrock) { dumpAt(cx, cy, sediment); sediment = 0; break; }

      // steepest descent among 8 neighbours (keep two lowest for jitter)
      let best = -1, bestH = cur;
      let second = -1, secondH = cur;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nh = h[ny * N + nx];
        if (nh < bestH - 1e-9) {
          if (bestH < cur - 1e-9) { second = best; secondH = bestH; }
          best = ny * N + nx; bestH = nh;
        } else if (nh < secondH - 1e-9) {
          second = ny * N + nx; secondH = nh;
        }
      }

      if (best < 0) {
        // pit — drop stops, dumps its load as a lobe, leaves an impact point
        dumpAt(cx, cy, sediment);
        sediment = 0;
        pointsMap[idx] += 1;
        stops++;
        break;
      }

      const slope = (cur - bestH) / (voxel * NEI[kFor(best, cx, cy, N)][2]);
      if (slope < 0.0015) {
        dumpAt(cx, cy, sediment);
        sediment = 0;
        pointsMap[idx] += 1;
        stops++;
        break;
      }

      // Taylor-style transport capacity — mass ∝ slope (world units,
      // grid-independent), slope-saturated so gorges can't run away.
      // Slope-gated: rills only form where the ground is steep enough —
      // gentle mid-flanks weather to soil, they don't get rilled into a
      // uniform carpet (that is the "parallel stripe" CG artifact).
      const slopeC = Math.min(slope, 3.0);
      const slopeGate = smooth(0.20, 0.55, slope);
      const capacity = dropSize * slopeC * 0.35 * erodibility * slopeGate;
      const maxCarry = cutPerStep * cellArea; // voxel-matched cut cap

      if (sediment < capacity && carvedDrop < maxErode) {
        // erode: carry up to one voxel-fraction of depth per step
        let carry = Math.min(capacity - sediment, maxErode - carvedDrop);
        if (carry > maxCarry) carry = maxCarry;
        const avail = (cur - bedrock) * cellArea;
        if (carry > avail) carry = avail;
        if (carry > 1e-9) {
          const dh = carry / cellArea; // ≤ cutPerStep at the centre, voxel-safe
          carveKernel(h, N, cx, cy, dh, erosionMap, bedrock);
          carved += carry;
          sediment += carry;
          carvedDrop += carry;
        }
      } else {
        // deposit the excess as a lobe
        let dep = sediment - capacity;
        if (dep > maxCarry * 1.5) dep = maxCarry * 1.5;
        if (dep > 1e-9) {
          depositKernel(h, N, cx, cy, dep / cellArea, depositMap);
          deposited += dep;
          sediment -= dep;
        }
      }

      // move downhill: follow the meander-biased flow network when
      // available (rills reinforce the dendritic system instead of
      // cutting parallel radial slits); else steepest descent + jitter
      let nx;
      if (downIdx && downIdx[idx] >= 0) {
        nx = downIdx[idx];
        if (second >= 0 && rng() < 0.15) nx = second;
      } else {
        nx = best;
        if (second >= 0 && slope < 0.10 && rng() < 0.45) nx = second;
      }
      cx = nx % N;
      cy = (nx / N) | 0;
    }
  }

  return { carvedM3: carved, depositedM3: deposited, stops, steps, cutPerStep, cellArea };
}

// helper: distance factor of the neighbour index (1 or sqrt2)
function kFor(idx, cx, cy, N) {
  const nx = idx % N - cx;
  const ny = ((idx / N) | 0) - cy;
  return nx !== 0 && ny !== 0 ? 4 : 0;
}

/**
 * D8 flow accumulation with a COHERENT MEANDER FIELD.
 *
 * Pure steepest-descent on a radially symmetric dome routes every
 * stream straight outward — the result is parallel radial spokes,
 * the classic CG stripe artifact. Real drainage networks wander,
 * because the terrain's fine structure rotates the local descent
 * direction. We emulate that with a low-frequency Perlin field that
 * biases each cell's descent direction by up to ±~40°, coherently
 * over ~10 m. The bias is isotropic (zero net drift over the whole
 * mountain), so this creates MEANDERS and confluences — not the
 * one-sided sideways slide of a uniform tilt.
 *
 * Returns per-cell contributing-area flow, a pit mask, the
 * processing order (ascending height) and the chosen downhill
 * neighbour per cell (downIdx — lets thermal drops follow the
 * same network).
 */
export function computeFlow(h, N, voxel, jitterRng, seed = 1, mScale = 0.035, mAmp = 0.7) {
  const size = N * N;
  const flow = new Float32Array(size);
  const pits = new Uint8Array(size);
  const downIdx = new Int32Array(size).fill(-1);
  flow.fill(1);

  // bucket sort by quantized height (fast, stable enough)
  const BUCKETS = 1024;
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < size; i++) { const v = h[i]; if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
  const span = Math.max(hMax - hMin, 1e-6);
  const bucketOf = new Int32Array(size);
  for (let i = 0; i < size; i++) bucketOf[i] = Math.min(BUCKETS - 1, ((h[i] - hMin) / span * BUCKETS) | 0);
  const counts = new Int32Array(BUCKETS);
  for (let i = 0; i < size; i++) counts[bucketOf[i]]++;
  const starts = new Int32Array(BUCKETS + 1);
  for (let b = 0; b < BUCKETS; b++) starts[b + 1] = starts[b] + counts[b];
  const order = new Uint32Array(size);
  const cursor = starts.slice(0, BUCKETS);
  for (let i = 0; i < size; i++) order[cursor[bucketOf[i]]++] = i;

  // meander field: preferred descent direction φ(x,y) in [-π, π],
  // coherent over ~10 m, deterministic per seed
  const meanderN = new Perlin2D(subseed((seed ^ 0x51ab77) >>> 0, 77));
  const MSCALE = mScale;
  const MAMP = mAmp;
  const ANG = new Float32Array(8);
  for (let k = 0; k < 8; k++) ANG[k] = Math.atan2(NEI[k][1], NEI[k][0]);

  const flatEps = 0.015 * voxel;
  // process strictly from highest cell to lowest so upflow is settled first
  for (let i = size - 1; i >= 0; i--) {
    const idx = order[i];
    const cx = idx % N, cy = (idx / N) | 0;
    const cur = h[idx];

    let best = -1, bestH = cur;
    let minH = cur;
    let bestScore = -1;
    const phi = meanderN.noise(cx * MSCALE, cy * MSCALE) * Math.PI;
    for (let k = 0; k < 8; k++) {
      const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nh = h[ny * N + nx];
      if (nh >= cur - 1e-9) continue;
      if (nh < minH) minH = nh;
      // meander-biased score: prefer neighbours whose direction
      // matches the coherent preferred direction
      const score = (cur - nh) * (1 + 0.5 * MAMP * Math.cos(ANG[k] - phi));
      if (best < 0 || score > bestScore) { best = ny * N + nx; bestScore = score; bestH = nh; }
    }
    if (best < 0) { pits[idx] = 1; continue; }
    // near-flat jitter: among neighbours within flatEps of the min, pick one at random
    if (cur - minH < flatEps) {
      const roll = jitterRng();
      let count = 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nh = h[ny * N + nx];
        if (nh <= cur - 1e-9 && nh >= minH - flatEps) count++;
      }
      let pick = 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nh = h[ny * N + nx];
        if (nh <= cur - 1e-9 && nh >= minH - flatEps) {
          if (pick === roll * count) { best = ny * N + nx; bestH = nh; break; }
          pick++;
        }
      }
    }
    downIdx[idx] = best;
    flow[best] += flow[idx];
  }
  return { flow, pits, order, downIdx };
}

/**
 * Hydraulic carving + sediment routing — Gaea-style layered erosion.
 *
 *  · PASS 0 (STRUCTURE): wider, gentler incision of the mid-flow
 *    field. The grooves it cuts bias the D8 field on the next
 *    recompute, so water converges into them (Gaea's "layering
 *    erosion" — the first pass's flow structure guides the rest).
 *  · PASSES 1..n (DOWNCUT): incision concentrates into the dominant
 *    channels only (steep fN gate) + HEADWARD EROSION — channel
 *    heads grow upstream, capturing neighbouring flow lines, which
 *    is what produces the dendritic river-tree topology (real
 *    drainage networks, not parallel radial slits).
 *  · SEDIMENT ROUTING: load follows flow; alluvial fans where the
 *    gradient relaxes (valley floors, piedmont).
 *
 * Re-runs flow accumulation on each pass so rivers re-route as they cut.
 *
 * @returns {{carvedM3:number, depositedM3:number, flowMax:number,
 *            flow:Float32Array, pits:Uint8Array}}
 */
export function hydraulicCarve({
  h, N, voxel, rng,
  passes, cutFraction, erodibility, flowExp, sedimentOn, seaLevel, bedrock,
  erosionMap, depositMap, seed = 1, initFlow = null,
  mScale = 0.035, mAmp = 1.8,
}) {
  const size = N * N;
  const cellArea = voxel * voxel;
  const cutPerStep = voxel * cutFraction * 0.90; // voxel-matched cut cap
  let carved = 0, deposited = 0, flowMax = 1;

  let { flow, pits, order } = initFlow || computeFlow(h, N, voxel, rng, seed, mScale, mAmp);
  for (let f = 0; f < size; f++) if (flow[f] > flowMax) flowMax = flow[f];

  for (let pass = 0; pass < passes; pass++) {
    const logF = Math.log1p(flowMax);
    const fN = new Float32Array(size);
    for (let i = 0; i < size; i++) fN[i] = Math.pow(Math.log1p(flow[i]) / logF, flowExp);

    // ---- Gaea layering: structure pass vs downcut passes ----
    const structural = pass === 0;
    // temporal concentration: later downcut passes tighten the gate so
    // only the dominant (high-flow) channels keep cutting — deep
    // main-stem canyons + shallow tributaries (river-order hierarchy)
    const gateLo = structural ? 0.34 : 0.50 + 0.045 * pass;
    const gateHi = structural ? 0.72 : 0.90;
    const amp = structural ? 0.65 : 1.1;

    // ---- (1) flow-weighted incision (shapes the channels) ----
    for (let idx = 0; idx < size; idx++) {
      if (pits[idx]) continue;
      const cx = idx % N, cy = (idx / N) | 0;
      const cur = h[idx];

      let bestH = Infinity;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nh = h[ny * N + nx];
        if (nh < bestH) bestH = nh;
      }
      const slope = Math.max(0, (cur - bestH) / voxel);
      const fG = fN[idx];

      // gate: only STRONGLY concentrated flow incises. This is the core
      // of the dendritic hierarchy — a few dominant channels + tributaries
      // cut, while hillslopes between them stay intact (no uniform slits).
      const fGate = smooth(gateLo, gateHi, fG);
      if (fGate <= 0.004) continue;

      // world volume moved per cell (m³) — resolution independent.
      // fG² makes incision super-linear in concentration: main stems
      // cut several times deeper than tributaries (river-order depth)
      const cellVol = 0.075 * amp * fGate * fG * fG * (0.30 + slope * 0.7) * erodibility;
      let e = cellVol / cellArea;
      if (e > cutPerStep) e = cutPerStep;
      // soften near the waterline to keep a clean coast
      const aboveSea = cur - seaLevel;
      if (aboveSea < 4) e *= smooth(aboveSea, -2, 4);
      const avail = cur - bedrock;
      if (e > avail) e = avail;
      if (e > 1e-8) {
        // carve with a soft 3×3 so channels are 2-3 voxels wide with
        // rounded banks — realistic gully width, not 1-voxel slits
        let moved = 0;
        for (let k = 0; k < 9; k++) {
          const nx = cx + TOOL[k][0], ny = cy + TOOL[k][1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const ni = ny * N + nx;
          const ce = Math.min(e * TOOL[k][2], h[ni] - bedrock);
          if (ce > 1e-12) {
            h[ni] -= ce;
            erosionMap[ni] += ce;
            moved += ce * cellArea;
          }
        }
        carved += moved;
      }
    }

    // ---- (2) headward erosion + divide capture (downcut passes) ----
    // The branching mechanism of real drainage networks: a flow HEAD
    // (a cell that receives no upstream inflow — the source of a
    // streamlet) that drains into an already-carved channel cuts a
    // small notch into the divide above it. On the next flow recompute
    // the water on the FAR side of that divide routes through the
    // notch, so the channel has captured a whole tributary basin —
    // producing Y confluences and the dendritic river-tree topology
    // instead of parallel radial grooves.
    if (!structural) {
      // channel proximity mask: cells within 5 of any eroded cell
      const near = new Uint8Array(size);
      for (let ii = 0; ii < size; ii++) if (erosionMap[ii] > 0.004) near[ii] = 1;
      const near2 = new Uint8Array(size);
      for (let d = 0; d < 5; d++) {
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const c = j * N + i;
          if (!near[c]) continue;
          near2[c] = 1;
          for (let k = 0; k < 4; k++) {
            const nx = i + NEI[k][0], ny = j + NEI[k][1];
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            near2[ny * N + nx] = 1;
          }
        }
        near.set(near2); near2.fill(0);
      }

      for (let ii = 0; ii < size; ii++) {
        const idx = order[ii];
        if (pits[idx] || flow[idx] < 2 || !near[idx]) continue;
        const cx = idx % N, cy = (idx / N) | 0;
        const cur = h[idx];
        if (cur < seaLevel + 1.0) continue;

        // head = local flow maximum (no neighbour feeds it)
        let isHead = true;
        for (let k = 0; k < 8 && isHead; k++) {
          const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          if (flow[ny * N + nx] > flow[idx] + 0.5) isHead = false;
        }
        if (!isHead) continue;

        // the head must drain (within 4 downhill steps) into a carved
        // channel — otherwise it is just hilltop rill, not a tributary
        let p = idx, feeder = false;
        for (let s = 0; s < 4 && !feeder; s++) {
          let bestN = -1, bestH = h[p];
          for (let k = 0; k < 8; k++) {
            const nx = (p % N) + NEI[k][0], ny = ((p / N) | 0) + NEI[k][1];
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            if (h[ny * N + nx] < bestH - 1e-9) { bestH = h[ny * N + nx]; bestN = ny * N + nx; }
          }
          if (bestN < 0) break;
          if (erosionMap[bestN] > 0.004) { feeder = true; break; }
          p = bestN;
        }
        if (!feeder) continue;

        // carve the head + one notch into the steepest divide above
        const dh = Math.min(cutPerStep * 0.45, cur - bedrock);
        if (dh > 1e-9) {
          h[idx] -= dh; erosionMap[idx] += dh; carved += dh * cellArea;
        }
        let divN = -1, divH = cur;
        for (let k = 0; k < 8; k++) {
          const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          if (h[ny * N + nx] > divH) { divH = h[ny * N + nx]; divN = ny * N + nx; }
        }
        if (divN >= 0) {
          const dh2 = Math.min(dh * 0.6, h[divN] - bedrock);
          if (dh2 > 1e-9) { h[divN] -= dh2; erosionMap[divN] += dh2; carved += dh2 * cellArea; }
        }
      }
    }

    // ---- (2) sediment routing: load follows the flow downstream ----
    // Cells pick up material while load < transport capacity (incision),
    // deposit alluvial lobes where load > capacity (valley floors,
    // piedmont fans), then route the remainder downhill.
    if (sedimentOn) {
      const load = new Float32Array(size);
      const capCarry = cutPerStep * cellArea;
      for (let ii = size - 1; ii >= 0; ii--) {
        const idx = order[ii];
        const cx = idx % N, cy = (idx / N) | 0;
        let l = load[idx];

        if (pits[idx]) {
          // lakebed: the load settles here
          if (l > 1e-9) {
            depositKernel(h, N, cx, cy, Math.min(l / cellArea, cutPerStep * 2), depositMap);
            deposited += l;
            l = 0;
          }
          continue;
        }

        let bestH = Infinity, bestDown = -1;
        for (let k = 0; k < 8; k++) {
          const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const nh = h[ny * N + nx];
          if (nh < bestH) { bestH = nh; bestDown = ny * N + nx; }
        }
        const slope = Math.max(0, (h[idx] - bestH) / voxel);
        // same steep gate as incision: channels transport, hillslopes deposit
        const fGate = smooth(gateLo, gateHi, fN[idx]);
        if (fGate <= 0.01) {
          // negligible flow: whatever arrived settles here as a broad fan
          if (l > 1e-9) {
            depositFan(h, N, cx, cy, Math.min(l / cellArea, cutPerStep * 1.4), depositMap);
            deposited += l;
            l = 0;
          }
          continue;
        }

        // transport capacity (mass) for this cell
        const cap = 0.9 * fGate * fN[idx] * (0.30 + slope * 0.8) * erodibility;
        const cur = h[idx];

        if (l < cap) {
          // pickup: erode to feed the load
          let pk = cap - l;
          if (pk > capCarry) pk = capCarry;
          const avail = (cur - bedrock) * cellArea;
          if (pk > avail) pk = avail;
          if (pk > 1e-9) {
            carveKernel(h, N, cx, cy, pk / cellArea, erosionMap, bedrock);
            carved += pk;
            l += pk;
          }
        } else {
          // deposit: broad alluvial FAN where the gradient relaxes
          // (valley floors, piedmont fans at the mountain's base)
          let dp = l - cap;
          if (dp > capCarry * 1.5) dp = capCarry * 1.5;
          if (dp > 1e-9) {
            depositFan(h, N, cx, cy, dp / cellArea, depositMap);
            deposited += dp;
            l -= dp;
          }
        }
        if (l > 1e-9 && bestDown >= 0) load[bestDown] += l;
      }
    }

    if (pass < passes - 1) {
      ({ flow, pits, order } = computeFlow(h, N, voxel, rng, seed, mScale, mAmp));
      flowMax = 1;
      for (let f = 0; f < size; f++) if (flow[f] > flowMax) flowMax = flow[f];
    }
  }

  // keep the final flow field for splats
  return { carvedM3: carved, depositedM3: deposited, flowMax, flow, pits };
}

/**
 * STREAM POWER LAW (SPL) erosion — the replacement engine.
 *
 *   dh/dt = -K · Q^m · S^n   (fluvial incision)  +  sediment diffusion
 *
 * Q = water discharge (D8 contributing area, meander-biased),
 * S = downslope gradient. Because incision scales with Q^m, a channel
 * carrying 100× the discharge cuts 5-15× faster — the network
 * self-organizes into a true river-order hierarchy, which particle
 * carving can't produce (it cuts everything at one rate, hence the
 * parallel-stripe look):
 *   · deep U-shaped main-stem canyons (high Q, sustained cutting)
 *   · progressively shallower tributary systems
 *   · smooth hillslopes between channels — no rill carpet
 * Diffusion relaxes over-steep canyon walls (V → U), builds terrace
 * shelves, and spreads bedload. Same physical model as Gaea's
 * dendritic canyon systems, applied directly to the SDF field.
 *
 * @returns {{carvedM3:number, depositedM3:number, flow:Float32Array,
 *            flowMax:number, pits:Uint8Array}}
 */
export function streamPowerCarve({
  h, N, voxel, rng, seed,
  iterations, K = 2.5e-4, m = 0.55, n = 1.4,
  cutFraction, erodibility, seaLevel, bedrock,
  mScale = 0.035, mAmp = 1.8,
  erosionMap, depositMap, valley = null,
}) {
  const size = N * N;
  const cellArea = voxel * voxel;
  const cutPerStep = voxel * cutFraction * 0.9; // voxel-matched cut cap
  let carved = 0, deposited = 0, flowMax = 1;

  let ff = computeFlow(h, N, voxel, rng, seed, mScale, mAmp);

  for (let it = 0; it < iterations; it++) {
    const { flow, pits, order, downIdx } = ff;

    // ---- incision + bedload (highest → lowest so upflow is settled) ----
    for (let ii = 0; ii < size; ii++) {
      const idx = order[ii];
      if (pits[idx]) continue;
      const cur = h[idx];
      if (cur < seaLevel + 0.4) continue; // keep the coastline clean
      const down = downIdx[idx];
      if (down < 0) continue;
      const cx = idx % N, cy = (idx / N) | 0;
      const dx = (down % N) - cx, dy = ((down / N) | 0) - cy;
      const dist = (dx !== 0 && dy !== 0) ? voxel * Math.SQRT2 : voxel;
      const drop = cur - h[down];
      if (drop <= 0) continue;
      const S = drop / dist;
      const Q = flow[idx];

      // flow gate (in contributing-cell units, scale independent):
      // only cells draining a real catchment (Q ≳ 30 cells) incise as
      // tributaries; the broad low-flow hillslopes stay smooth (grass).
      const gate = smooth(30, 300, Q);

      // CANYON ATTRACTOR: the base terrain's drainage valleys are cut
      // hard and deep — deterministic main canyons exactly where the
      // basins are (Gaea's guided channels). This term is independent
      // of the flow gate so the canyons establish even before the flow
      // network converges into them.
      const cany = valley ? valley[idx] : 0;

      // stream power: incision volume (m³) for this cell this iteration
      let v = K * Math.pow(Q, m) * Math.pow(S, n) * erodibility * gate;
      const aboveSea = cur - seaLevel;
      if (aboveSea < 4) v *= smooth(aboveSea, -2, 4);
      if (cany > 0.02) v += cutPerStep * 2.0 * cany * cellArea;
      if (v <= 1e-9) continue;
      let e = v / cellArea;
      if (e > cutPerStep * (1 + 2.5 * cany)) e = cutPerStep * (1 + 2.5 * cany);
      if (e > drop * 0.85) e = drop * 0.85; // never invert the profile
      const avail = cur - bedrock;
      if (e > avail) e = avail;
      if (e > 1e-9) {
        h[idx] -= e;
        erosionMap[idx] += e;
        carved += e * cellArea;
        // bedload: inside the canyon the load is EXPORTED downstream
        // (a canyon floor that fills in stops cutting — and shallow
        // channels don't look like canyons). On open ground the load
        // settles as the cell gradient relaxes → alluvial fans form
        // at canyon mouths / piedmont, not mid-canyon.
        const inCanyon = valley && valley[down] > 0.15;
        const dep = e * (inCanyon ? 0.12 : 0.55);
        h[down] += dep;
        depositMap[down] += dep;
        deposited += dep * cellArea;
      }
    }

    // ---- diffusion: relax over-steep walls (V → U canyons, terraces) ----
    const eq = voxel * 0.5; // equilibrium drop per step (~26°)
    for (let ii = 0; ii < size; ii++) {
      const idx = order[ii];
      const cur = h[idx];
      if (cur <= bedrock) continue;
      let lowN = -1, lowH = cur;
      for (let k = 0; k < 8; k++) {
        const nx = (idx % N) + NEI[k][0], ny = ((idx / N) | 0) + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (h[ni] < lowH) { lowH = h[ni]; lowN = ni; }
      }
      if (lowN < 0) continue;
      const drop = cur - lowH;
      if (drop > eq) {
        const moved = (drop - eq) * 0.10;
        h[idx] -= moved;
        h[lowN] += moved;
      }
    }

    // the drainage network evolves slowly — recompute flow every 2 iters
    if ((it & 1) === 1 || it === iterations - 1) {
      ff = computeFlow(h, N, voxel, rng, seed, mScale, mAmp);
      for (let f = 0; f < size; f++) if (ff.flow[f] > flowMax) flowMax = ff.flow[f];
    }
  }

  return { carvedM3: carved, depositedM3: deposited, flow: ff.flow, flowMax, pits: ff.pits };
}

/**
 * Mass wasting (talus / debris) — Gaea's "Debris" analogue.
 * Sandpile relaxation: any cell steeper than the angle of repose sheds
 * material downhill until the slope relaxes. This is what real mountains
 * do with cliffs and freshly-cut gully walls:
 *   · cliff faces slump into smooth scree (talus) cones at their base
 *   · sharp V channels widen into natural U gullies (bank slumping)
 *   · noise spikes relax into believable rounded relief
 * Mass-conserving, cheap, stable. Mutates h in place.
 */
function talusRelax(h, N, voxel, bedrock, { iterations = 3, tanAngle = 0.78, k = 0.22 } = {}) {
  const size = N * N;
  const eqDrop = voxel * tanAngle; // equilibrium drop per neighbour step
  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        const cur = h[c];
        if (cur <= bedrock) continue;
        // lowest neighbour
        let lowN = -1, lowH = cur;
        for (let kk = 0; kk < 8; kk++) {
          const nx = i + NEI[kk][0], ny = j + NEI[kk][1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const ni = ny * N + nx;
          if (h[ni] < lowH) { lowH = h[ni]; lowN = ni; }
        }
        if (lowN < 0) continue;
        const drop = cur - lowH;
        if (drop <= eqDrop) continue; // at rest — nothing moves
        const moved = Math.min((drop - eqDrop) * k, cur - bedrock);
        if (moved <= 1e-9) continue;
        h[c] -= moved;
        h[lowN] += moved;
      }
    }
  }
}

/**
 * Gaea-style water bodies:
 *  · LAKES  — enclosed basins found by "pouring water" (Dijkstra from the
 *             map rim). Cells the water covers are raised to a flat level,
 *             so the mesh shows a real flat lake surface.
 *  · RIVERS — the deepest, most-concentrated flow channels on land,
 *             kept where the terrain has carved a concave gully floor.
 * Mutates `h` to fill lake basins.
 *
 * @returns {{river:Float32Array, lake:Float32Array, water:Float32Array,
 *            lakeCount:number, riverCount:number}}
 */
export function detectWaterBodies(h, N, flow, seaLevel,
  { minLakeArea = 15, minLakeDepth = 0.20, riverPercentile = 0.996 } = {}) {
  const size = N * N;
  const river = new Float32Array(size);
  const lake = new Float32Array(size);

  // ---- pour water: fill[i] = water surface if the terrain were flooded.
  // Dijkstra from the rim (rim cells drain to sea/edge, fill = own height).
  // Enclosed basins are the only cells where fill > h. ----
  const fill = new Float64Array(size).fill(Infinity);
  const heap = [];
  const hp = (v, i) => {
    heap.push([v, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p;
    }
  };
  const hpop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = 2 * p + 2;
        let m = p;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === p) break;
        const t = heap[m]; heap[m] = heap[p]; heap[p] = t; p = m;
      }
    }
    return top;
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (i === 0 || j === 0 || i === N - 1 || j === N - 1) {
        const idx = j * N + i;
        fill[idx] = h[idx];
        hp(h[idx], idx);
      }
    }
  }
  while (heap.length) {
    const [fv, idx] = hpop();
    const cx = idx % N, cy = (idx / N) | 0;
    for (let k = 0; k < 4; k++) {
      const ox = k === 0 ? 1 : k === 1 ? -1 : 0;
      const oy = k === 2 ? 1 : k === 3 ? -1 : 0;
      const nx = cx + ox, ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (fill[ni] !== Infinity) continue;
      const nf = Math.max(h[ni], fv);
      fill[ni] = nf;
      hp(nf, ni);
    }
  }

  // ---- lakes: connected components of cells submerged ≥ minLakeDepth,
  // above the sea, sized ≥ minLakeArea. Fill them to a flat surface. ----
  const sub = new Uint8Array(size);
  for (let i = 0; i < size; i++) if (fill[i] - h[i] >= minLakeDepth) sub[i] = 1;
  const seen = new Uint8Array(size);
  let lakeCount = 0;
  for (let s = 0; s < size; s++) {
    if (!sub[s] || seen[s]) continue;
    const comp = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      const cx = c % N, cy = (c / N) | 0;
      for (let k = 0; k < 4; k++) {
        const ox = k === 0 ? 1 : k === 1 ? -1 : 0;
        const oy = k === 2 ? 1 : k === 3 ? -1 : 0;
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (!sub[ni] || seen[ni]) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (comp.length < minLakeArea) continue;
    let lvl = -Infinity;
    for (const c of comp) if (fill[c] > lvl) lvl = fill[c];
    if (lvl < seaLevel + 0.15) continue; // skip the ocean itself
    for (const c of comp) { h[c] = lvl; lake[c] = 1; }
    lakeCount++;
  }

  // ---- rivers: top flow-percentile cells that sit in a carved concave
  // gully on land. ----
  const flowSorted = Array.from(flow).sort((a, b) => a - b);
  const rThresh = flowSorted[Math.floor(size * riverPercentile)];
  let riverCount = 0;
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      if (flow[c] < rThresh) continue;
      if (h[c] < seaLevel + 0.05) continue;
      const ch = h[c];
      const concave = (ch < h[c - 1] - 0.02 || ch < h[c + 1] - 0.02 ||
                       ch < h[c - N] - 0.02 || ch < h[c + N] - 0.02);
      if (concave) { river[c] = 1; riverCount++; }
    }
  }
  // thicken rivers to ~2 cells so they read at distance
  const dil = new Float32Array(size);
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      if (river[c]) {
        dil[c] = 1;
        dil[c - 1] = Math.max(dil[c - 1], 0.65);
        dil[c + 1] = Math.max(dil[c + 1], 0.65);
        dil[c - N] = Math.max(dil[c - N], 0.65);
        dil[c + N] = Math.max(dil[c + N], 0.65);
      }
    }
  }
  for (let i = 0; i < size; i++) river[i] = Math.max(river[i], dil[i]);

  const water = new Float32Array(size);
  for (let i = 0; i < size; i++) water[i] = Math.min(1, river[i] + lake[i]);
  return { river, lake, water, lakeCount, riverCount };
}

/** One-click full hydraulic pass. Mutates h; returns stats + fields. */
export function runErosion({ h, N, voxel, seed, thermalOn, hydOn, drops, dropSize, erodibility, traversal, cutFraction, flowPasses, flowExp, sedimentOn, seaLevel, meanderScale = 0.035, meanderAmp = 1.8, solver = 'stream', valley = null }) {
  const rngT = mulberry32((seed ^ 0x2f6e2b1) >>> 0);
  const rngH = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const bedrock = Math.min(seaLevel - 14, -40);
  const size = N * N;
  const erosionMap = new Float32Array(size);
  const depositMap = new Float32Array(size);
  const pointsMap = new Float32Array(size);

  // Base flow field (with the coherent meander) computed ONCE up front:
  // thermal drops follow this network and the hydraulic pass reuses it
  // as pass 0 — one consistent drainage system across all solvers.
  const flow0 = computeFlow(h, N, voxel, rngH, seed, meanderScale, meanderAmp);

  const stats = { thermal: null, hydraulic: null };
  if (thermalOn) {
    stats.thermal = thermalErode({
      h, N, voxel, rng: rngT,
      drops, dropSize, erodibility, traversal, cutFraction, bedrock,
      erosionMap, depositMap, pointsMap, downIdx: flow0.downIdx,
    });
  }
  let flow = null, pits = null, flowMax = 0;
  if (solver === 'stream') {
    // REPLACEMENT ENGINE: stream power law (Gaea-class dendritic canyons)
    const res = streamPowerCarve({
      h, N, voxel, rng: rngH, seed,
      iterations: flowPasses, cutFraction, erodibility,
      seaLevel, bedrock, mScale: meanderScale, mAmp: meanderAmp,
      erosionMap, depositMap, valley,
    });
    stats.hydraulic = { carvedM3: res.carvedM3, depositedM3: res.depositedM3, flowMax: res.flowMax };
    flow = res.flow; pits = res.pits; flowMax = res.flowMax;
  } else if (hydOn) {
    const res = hydraulicCarve({
      h, N, voxel, rng: rngH,
      passes: flowPasses, cutFraction, erodibility, flowExp,
      sedimentOn, seaLevel, bedrock, erosionMap, depositMap,
      seed, initFlow: flow0, mScale: meanderScale, mAmp: meanderAmp,
    });
    stats.hydraulic = { carvedM3: res.carvedM3, depositedM3: res.depositedM3, flowMax: res.flowMax };
    flow = res.flow; pits = res.pits; flowMax = res.flowMax;
  } else if (thermalOn) {
    // no hydraulic: derive a cheap flow for splats from slope
    flow = new Float32Array(size); pits = new Uint8Array(size);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      let bestH = h[idx];
      for (let k = 0; k < 8; k++) {
        const nx = i + NEI[k][0], ny = j + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (h[ny * N + nx] < bestH) bestH = h[ny * N + nx];
      }
      flow[idx] = 1 + Math.max(0, (h[idx] - bestH) / voxel) * 60;
      flowMax = Math.max(flowMax, flow[idx]);
    }
  }

  let carvedM3 = 0, depositedM3 = 0;
  if (stats.thermal) { carvedM3 += stats.thermal.carvedM3; depositedM3 += stats.thermal.depositedM3; }
  if (stats.hydraulic) { carvedM3 += stats.hydraulic.carvedM3; depositedM3 += stats.hydraulic.depositedM3; }

  // ---- mass wasting (talus): relax over-steep walls into scree cones,
  // widen V channels into U gullies — the debris layer of Gaea ----
  talusRelax(h, N, voxel, bedrock);

  // ---- water bodies (lakes filled + rivers) ----
  let water = null, lakeCount = 0, riverCount = 0;
  if (flow) {
    const wb = detectWaterBodies(h, N, flow, seaLevel);
    water = wb.water;
    lakeCount = wb.lakeCount;
    riverCount = wb.riverCount;
  }

  return {
    erosionMap, depositMap, pointsMap, flow, pits, flowMax,
    water, lakeCount, riverCount,
    stats: { ...stats, carvedM3, depositedM3 },
  };
}
