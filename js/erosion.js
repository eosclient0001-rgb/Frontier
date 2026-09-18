import { particleErode } from './particle-erosion.js';
/* ============================================================
 * Frontier · SDF Terrain Lab — Fluvial erosion engine v3
 *
 * A complete replacement for the old particle/hydraulic solvers.
 * This is the standard geomorphological landscape-evolution
 * equation — the one every reference implementation (INRIA
 * analytical stream power, OpenLEM, Landlab SharedStreamPower,
 * the GRASS/WRF toolchains) is built on:
 *
 *     dh/dt = -K · A^m · S^n     fluvial incision (stream power law)
 *             + D · ∇²h          hillslope diffusion (Laplacian)
 *             + sediment capacity routing (alluvial fans)
 *
 *   A = drainage area through the cell (D8 contributing area ×
 *       cell area, m²)
 *   S = local slope to the steepest-descent neighbour (m/m)
 *   K = erodibility (user slider), m ≈ 0.4-0.5, n ≈ 1-1.2
 *
 * WHY THIS LOOKS DIFFERENT FROM THE OLD ENGINES — the key insight
 * taken from the researched implementations: MATURITY COMES FROM
 * MANY ITERATIONS WITH DIFFUSION RUNNING EVERY ITERATION.
 * A 2-voxel rill decays by (1-D)^iterations — it is gone in ~25
 * iterations at D=0.15. Real channels re-incise faster than they
 * decay (their A is large), so they survive; everything else is
 * smoothed away. Few iterations → raw carve pattern (the old
 * "parallel stripe" artifact). Many iterations → clean convex
 * hillslopes + a deep dendritic channel network + flattened
 * valley floors. That mature state is what Gaea renders.
 *
 * SDF CONVERSION NOTE: the standard algorithm is defined on a
 * scalar elevation field. Our SDF h[] IS that scalar field
 * (signed distance from the sea plane, in metres), so the mapping
 * is direct: areas in m² (flow × voxel²), slopes in m/m over
 * true neighbour distances, and every per-iteration cut is clamped
 * to cutFraction × voxel — the cut depth stays proportional to
 * grid resolution (fine grids cut finer slices, never aliased).
 *
 * REFERENCES (researched before this rewrite):
 *  · INRIA "Physically-based analytical erosion" (EG 2024) —
 *    stream power + Laplacian hillslope term, m≈0.4, n≈1,
 *    unconditionally stable implicit stepping
 *  · INRIA uplift-tree terrain (HAL 2023) — dh/dt = u − A^m S^n + ∆h
 *  · OpenLEM (open source landform evolution) — SPIM + diffusion, D8
 *  · Landlab SharedStreamPower — k_bedrock·A^m·S^n + transport term
 *  · mustartt/hydraulic-erosion, Vehxx/Rainfall — thousands of
 *    iterations for a mature landscape
 * ============================================================ */

import { mulberry32, Perlin2D, subseed, fbm01 } from './noise.js';

const NEI = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2],
];

function smooth(a, b, x) {
  const t = (x - a) / (b - a);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * D8 flow accumulation (O'Callaghan & Mark) with a coherent meander
 * field.
 *
 * Pure steepest descent on a radially symmetric dome routes every
 * stream straight outward — parallel radial spokes. Real drainage
 * networks wander because fine terrain structure rotates the local
 * descent direction. A low-frequency Perlin field biases each cell's
 * descent direction by up to ±~35°, coherently over ~10 m. The bias
 * is isotropic (zero net drift), so it produces MEANDERS and
 * confluences, not a one-sided sideways slide.
 *
 * Returns flow (contributing area in cells), pits, ascending-height
 * order, and downIdx (chosen downhill neighbour per cell).
 */
export function computeFlow(h, N, voxel, jitterRng, seed = 1, mScale = 0.06, mAmp = 0.4, seaLevel = -Infinity) {
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

  const meanderN = new Perlin2D(subseed((seed ^ 0x51ab77) >>> 0, 77));
  const ANG = new Float32Array(8);
  for (let k = 0; k < 8; k++) ANG[k] = Math.atan2(NEI[k][1], NEI[k][0]);
  // cells receiving flow routed over a pit spill (breach candidates)
  const spillMark = new Uint8Array(size);

  // ---- depression routing (O'Callaghan & Mark extension, à la
  // Landlab DepressionFinderAndRouter) ----
  // On a closed island every enclosed pit becomes a lake unless the
  // flow is routed OVER the lowest surrounding spill (pour-water
  // level). Routing over spits lets the erosion cut the rim, drain
  // the basin and mature it — what actually happens in nature.
  // fill[] is computed with a bucket (radix) Dijkstra: pour levels
  // are bounded by the terrain's height span, so 2048 height buckets
  // give an O(N²) pass at a tiny constant.
  const fill = new Float64Array(size).fill(Infinity);
  {
    const B = 2048;
    const spanF = Math.max(hMax - hMin, 1e-6);
    const bucketOf = (v) => {
      const b = ((v - hMin) / spanF * B) | 0;
      return b < 0 ? 0 : b >= B ? B - 1 : b;
    };
    const q = new Array(B);
    for (let b = 0; b < B; b++) q[b] = [];
    const push = (v, i) => q[bucketOf(v)].push(i);
    const done = new Uint8Array(size);
    let qmin = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (i === 0 || j === 0 || i === N - 1 || j === N - 1) {
        const idx = j * N + i;
        fill[idx] = h[idx];
        push(h[idx], idx);
      }
    }
    for (;;) {
      while (qmin < B && q[qmin].length === 0) qmin++;
      if (qmin >= B) break;
      const idx = q[qmin].pop();
      if (done[idx]) continue;
      done[idx] = 1;
      const fv = fill[idx];
      const cx = idx % N, cy = (idx / N) | 0;
      for (let k = 0; k < 4; k++) {
        const ox = k === 0 ? 1 : k === 1 ? -1 : 0;
        const oy = k === 2 ? 1 : k === 3 ? -1 : 0;
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (done[ni]) continue;
        const nf = h[ni] > fv ? h[ni] : fv;
        if (nf < fill[ni] - 1e-9) {
          fill[ni] = nf;
          push(nf, ni);
        }
      }
    }
  }

  const flatEps = 0.015 * voxel;
  // process strictly from highest cell to lowest so upflow is settled first
  for (let i = size - 1; i >= 0; i--) {
    const idx = order[i];
    const cx = idx % N, cy = (idx / N) | 0;
    const cur = h[idx];

    // The meander bias fades out near the coast: on the flat lowland
    // shelf (S≈0) a biased tie-break makes rivers random-walk for
    // 10+ m before reaching the sea. Pure steepest descent there
    // runs a straight river to the waterline.
    const coast = smooth(seaLevel + 0.3, seaLevel + 2.5, cur);
    const amp = mAmp * coast;

    let best = -1, bestH = cur;
    let minH = cur;
    let bestScore = -1;
    const phi = amp > 0.01 ? meanderN.noise(cx * mScale, cy * mScale) * Math.PI : 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nh = h[ny * N + nx];
      if (nh >= cur - 1e-9) continue;
      if (nh < minH) minH = nh;
      const score = (cur - nh) * (1 + 0.5 * amp * Math.cos(ANG[k] - phi));
      if (best < 0 || score > bestScore) { best = ny * N + nx; bestScore = score; bestH = nh; }
    }
    if (best < 0) {
      // pit: route over the lowest surrounding spill (lowest pour-
      // water level) so the basin drains and the erosion can cut it
      pits[idx] = 1;
      let spill = -1, spillF = Infinity;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (fill[ni] < spillF) { spillF = fill[ni]; spill = ni; }
      }
      if (spill < 0) continue;
      best = spill;
      spillMark[best] = 1;
      flow[best] += flow[idx];
      continue;
    }
    // near-flat jitter (full land only): among neighbours within
    // flatEps of the min, pick one at random — breaks symmetry on
    // plateaus without letting coastal shelves random-walk
    if (coast >= 0.999 && cur - minH < flatEps) {
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
  return { flow, pits, order, downIdx, spillMark };
}

/**
 * Stream power + hillslope diffusion erosion on the SDF field.
 *
 * Each iteration (highest → lowest):
 *   1. FLUVIAL INCISION  e = K · A^m · S^n  (clamped to cutFraction ×
 *      voxel — the voxel-matched cut — boosted ×(1+0.8·valley) on
 *      the base terrain's canyon-attractor sectors; fully
 *      slope-controlled so channels stop cutting where the
 *      gradient relaxes and valley floors flatten)
 *   2. SEDIMENT          yield-limited bedload routed downstream:
 *      35% of each cell's incised material joins the load; where
 *      load exceeds transport capacity ∝ A^0.6·(0.25+S) the excess
 *      deposits (the diffusion below spreads it into smooth
 *      alluvial fans at piedmonts and confluences)
 *   3. (every iteration) HILLSLOPE DIFFUSION  h += D · ∇²h — raises
 *      concavities, lowers convexities; the process that smooths
 *      interfluves, flattens valley floors, and erases everything
 *      that doesn't re-incise fast enough to survive
 *
 * Flow is recomputed every 4 iterations (the network evolves slowly).
 *
 * @returns {{carvedM3:number, depositedM3:number, flow:Float32Array,
 *            flowMax:number, pits:Uint8Array}}
 */
export async function streamPowerErode({
  h, N, voxel, seed,
  iterations = 64,
  K = 8e-3,
  m = 0.45,
  n = 1.2,
  D = 0.15,
  cutFraction = 0.22,
  erodibility = 0.6,
  sedimentOn = true,
  minFlowA = 0,
  seaLevel, bedrock,
  mScale = 0.06, mAmp = 0.4,
  valley = null,
  erosionMap, depositMap, pointsMap, channelsMap,
  yieldControl = null,
}) {
  const size = N * N;
  const cellArea = voxel * voxel;
  const cutPerStep = voxel * cutFraction; // voxel-matched cut cap
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  let carved = 0, deposited = 0, flowMax = 1;

  let ff = computeFlow(h, N, voxel, rng, seed, mScale, mAmp, seaLevel);

  for (let it = 0; it < iterations; it++) {
    const { flow, pits, order, downIdx, spillMark } = ff;
    const load = sedimentOn ? new Float32Array(size) : null;

    // ---- 1) incision + sediment routing (highest → lowest) ----
    // order[] is sorted ASCENDING by height, so walk it backwards:
    // every cell is processed before its downhill neighbour, which is
    // what lets the sediment load accumulate down the channel.
    for (let ii = size - 1; ii >= 0; ii--) {
      const idx = order[ii];
      if (pits[idx]) continue;
      const down = downIdx[idx];
      if (down < 0) continue;
      const cur = h[idx];
      if (cur < seaLevel + 0.3) continue; // keep the coastline clean

      const cx = idx % N, cy = (idx / N) | 0;
      const dx = (down % N) - cx, dy = ((down / N) | 0) - cy;
      const dist = (dx !== 0 && dy !== 0) ? voxel * Math.SQRT2 : voxel;
      const drop = cur - h[down];
      if (drop <= 0) continue;
      const S = drop / dist;
      const A = flow[idx] * cellArea; // drainage area, m²

      // micro-scale pass: diffuse runoff (A below minFlowA) does NOT
      // cut — only cells where the water has concentrated into a
      // thread erode. Stream-power feedback (lower cell → more flow →
      // cuts more) then amplifies those threads into a branching rill
      // network. The incoming load is passed through unchanged.
      if (minFlowA > 0 && A < minFlowA) {
        if (load) load[down] += load[idx];
        continue;
      }

      // stream power incision depth (m per iteration) — fully
      // slope-controlled: where the gradient relaxes the channel
      // stops cutting and a flat valley floor forms (that
      // equilibrium is what makes mature landscapes read as real)
      let e = K * erodibility * Math.pow(A, m) * Math.pow(S, n);
      // canyon attractor: the base terrain's drainage valleys get a
      // boost (Gaea-style guided main canyons) — multiplicative, so
      // cutting still needs slope and still equilibrates
      const cany = valley ? valley[idx] : 0;
      if (cany > 0.02) e *= (1 + 0.8 * cany);
      const aboveSea = cur - seaLevel;
      if (aboveSea < 4) e *= smooth(aboveSea, -2, 4);
      // breach boost: cells carrying a pit's routed flow over a rim
      // cut much faster — an overtopped lake cuts its outlet fast,
      // which is what drains enclosed basins into real catchments
      let eCap = cutPerStep * (1 + 1.5 * cany) * (spillMark[idx] ? 2.2 : 1);
      if (e > eCap) e = eCap;
      const avail = cur - bedrock;
      if (e > avail) e = avail;

      // ---- sediment: yield-limited bedload ----
      // Only a fraction of the material incised this iteration is
      // transportable bedload (the rest is winnowed into suspension
      // and leaves with the water). Transport capacity
      // ∝ A^0.6·(0.25+S) holds in steep, wide reaches and collapses
      // where the gradient relaxes — so the load drops as smooth
      // alluvial fans at piedmonts and confluences (diffusion
      // spreads each point deposit over the following iterations).
      let l = load ? load[idx] : 0;
      if (load) {
        const cap = 0.025 * erodibility * Math.pow(A, 0.6) * (0.25 + S);
        const incoming = l + e * 0.35; // arrived load + this cell's yield
        let carried;
        if (incoming > cap) {
          const excess = incoming - cap;
          const dp = Math.min(excess, cutPerStep);
          h[idx] += dp;
          depositMap[idx] += dp;
          deposited += dp * cellArea;
          // OVERBANK: when the channel is grossly overloaded the
          // water spills its banks — the excess load drops onto the
          // adjacent floodplain, which is what builds broad, low
          // alluvial flats along big rivers
          if (excess > cap) {
            const spill = (excess - cap) * 0.30;
            const sp1x = -dy, sp1y = dx, sp2x = dy, sp2y = -dx;
            for (let s = 0; s < 2; s++) {
              const px = s === 0 ? sp1x : sp2x, py = s === 0 ? sp1y : sp2y;
              const nx2 = cx + px, ny2 = cy + py;
              if (nx2 < 0 || ny2 < 0 || nx2 >= N || ny2 >= N) continue;
              const si = ny2 * N + nx2;
              const sd = spill * 0.5;
              h[si] += sd;
              depositMap[si] += sd;
              deposited += sd * cellArea;
            }
          }
          carried = incoming - dp;
        } else {
          carried = incoming; // flow carries it all
        }
        // canyons export their load so floors don't fill and stop
        // cutting (fans form at the canyon mouths instead)
        const inCanyon = valley && (valley[idx] > 0.15 || valley[down] > 0.15);
        load[down] += inCanyon ? carried * 0.9 : carried;
      }

      if (e > 1e-9) {
        h[idx] -= e;
        erosionMap[idx] += e;
        carved += e * cellArea;
        // V-profile: shave the two banks perpendicular to the flow
        // direction so channels read as ~3-cell gullies with shaded
        // walls (what real rivers cut) instead of 1-cell slits —
        // and so a breached rim becomes a notch, not a pit
        if (channelsMap) channelsMap[idx] += e;
        const p1x = -dy, p1y = dx, p2x = dy, p2y = -dx;
        for (let s = 0; s < 2; s++) {
          const px = s === 0 ? p1x : p2x, py = s === 0 ? p1y : p2y;
          const nx2 = cx + px, ny2 = cy + py;
          if (nx2 < 0 || ny2 < 0 || nx2 >= N || ny2 >= N) continue;
          const si = ny2 * N + nx2;
          const se = e * 0.5;
          h[si] -= se;
          erosionMap[si] += se;
          carved += se * cellArea;
          if (channelsMap) channelsMap[si] += se;
        }
        // heavy, concentrated cutting = "impact points" (Gaea points
        // layer analog: where the flow hit hard, over and over)
        if (pointsMap && e > cutPerStep * 0.5) pointsMap[idx] += e;
      }
    }

    // ---- 2) hillslope diffusion (full Laplacian, 4-neighbour) ----
    // raises concavities, lowers convexities. D ≤ 0.25 is uncondi-
    // tionally stable. This is the term that makes the landscape
    // MATURE: fine carve patterns decay as (1-D)^iterations.
    for (let j = 0; j < N; j++) {
      const row = j * N;
      for (let i = 0; i < N; i++) {
        const c = row + i;
        const cur = h[c];
        let sum = 0, cnt = 0;
        if (i > 0) { sum += h[c - 1]; cnt++; }
        if (i < N - 1) { sum += h[c + 1]; cnt++; }
        if (j > 0) { sum += h[c - N]; cnt++; }
        if (j < N - 1) { sum += h[c + N]; cnt++; }
        const lap = (sum - cnt * cur) / cnt;
        if (lap > 1e-5 || lap < -1e-5) h[c] = cur + D * lap;
      }
    }

    // FAN SMOOTHING: cells carrying deposited sediment relax toward
    // their neighbourhood — this is what turns point deposits into
    // smooth alluvial fans and braid-bar mounds (every 4 iters).
    if (sedimentOn && (it & 3) === 3) {
      for (let j = 1; j < N - 1; j++) {
        for (let i = 1; i < N - 1; i++) {
          const c = j * N + i;
          const d = depositMap[c];
          if (d < 0.02) continue;
          const w = d > 0.1 ? 1 : d * 10;
          const lap = (h[c - 1] + h[c + 1] + h[c - N] + h[c + N] - 4 * h[c]) * 0.25;
          h[c] += 0.08 * lap * w;
        }
      }
    }

    // the network evolves slowly — recompute flow every 4 iterations
    if ((it & 3) === 3 || it === iterations - 1) {
      ff = computeFlow(h, N, voxel, rng, seed, mScale, mAmp, seaLevel);
      flowMax = 1;
      for (let f = 0; f < size; f++) if (ff.flow[f] > flowMax) flowMax = ff.flow[f];
    }

    // yield to the event loop so the UI can paint progress
    if (yieldControl && (it & 3) === 3) await yieldControl(it + 1, iterations);
  }

  return { carvedM3: carved, depositedM3: deposited, flow: ff.flow, flowMax, pits: ff.pits };
}

/**
 * Water bodies (Gaea-style):
 *  · LAKES  — enclosed basins found by "pouring water" (Dijkstra from
 *             the map rim). Covered cells are raised to a flat level
 *             so the mesh shows a real flat lake surface.
 *  · RIVERS — the most-concentrated flow channels on land, kept where
 *             the terrain has a carved concave gully floor.
 * Mutates `h` to fill lake basins.
 *
 * @returns {{river:Float32Array, lake:Float32Array, water:Float32Array,
 *            lakeCount:number, riverCount:number}}
 */
export function detectWaterBodies(h, N, flow, seaLevel,
  { voxel, minLakeM2 = 18, minLakeDepth = 0.30, riverPercentile = 0.996 } = {}) {
  const size = N * N;
  const river = new Float32Array(size);
  const lake = new Float32Array(size);
  // minimum lake SIZE in m² (resolution-independent): micro-basins
  // stay as invisible terrain texture, only real water bodies fill
  const minLakeArea = Math.max(12, minLakeM2 / (voxel * voxel));

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

/**
 * Drain small enclosed basins by cutting their lowest spill rim.
 * On a closed island every enclosed pit becomes a lake, and a short
 * erosion run can't breach every one — so small basins (potholes,
 * dead-end spur bowls) are cut through explicitly: in nature they
 * don't persist; only basins larger than `maxLakeAreaM2` survive and
 * become the landscape's lakes.
 */
export function drainSmallBasins(h, N, voxel, seaLevel, maxLakeAreaM2 = 1500) {
  const size = N * N;
  const maxCells = Math.max(50, maxLakeAreaM2 / (voxel * voxel));
  for (let pass = 0; pass < 10; pass++) {
    let breached = false;
    const seen = new Uint8Array(size);
    const stack = new Int32Array(size);
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const c = j * N + i;
        const hc = h[c];
        // only on-land basins can become visible lakes
        if (hc < seaLevel + 0.3) continue;
        // is it a pit (no strictly lower 8-neighbour)? and what is
        // the lowest rim neighbour (the spill)?
        let isPit = true, spill = Infinity, spillIdx = -1;
        for (let k = 0; k < 8; k++) {
          const nx = i + NEI[k][0], ny = j + NEI[k][1];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const ni = ny * N + nx, nh = h[ni];
          if (nh < hc - 1e-9) isPit = false;
          if (nh < spill) { spill = nh; spillIdx = ni; }
        }
        if (!isPit || spillIdx < 0) continue;
        // basin size: everything below the spill rim that is reachable
        // from the pit (flood fill, 4-connected)
        let count = 0, sp = 0;
        stack[sp++] = c;
        seen[c] = 1;
        while (sp > 0 && count < maxCells) {
          const x = stack[--sp];
          count++;
          const x0 = x % N, y0 = (x / N) | 0;
          for (let k = 0; k < 4; k++) {
            const nx = x0 + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const ny = y0 + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
            const ni = ny * N + nx;
            if (seen[ni] || h[ni] > spill + 1e-9) continue;
            seen[ni] = 1;
            stack[sp++] = ni;
          }
        }
        if (count < maxCells) {
          // cut an outlet ramp: from the lowest rim cell, walk to the
          // lowest neighbour, lowering each step by 0.2 × voxel
          // below the previous, until the terrain itself drops below
          // the ramp (the outer flank slopes to the coast, so the
          // descent continues on its own from there)
          let cur = spillIdx, guard = 0;
          let level = hc;
          while (guard++ < 150) {
            level -= 0.2 * voxel;
            if (h[cur] <= level + 1e-9) break; // terrain takes over
            const cutAmt = h[cur] - level;
            h[cur] = level;
            let next = -1, nextH = Infinity;
            const x0 = cur % N, y0 = (cur / N) | 0;
            for (let k = 0; k < 8; k++) {
              const nx = x0 + NEI[k][0], ny = y0 + NEI[k][1];
              if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
              const ni = ny * N + nx;
              if (h[ni] < nextH) { nextH = h[ni]; next = ni; }
            }
            if (next < 0 || next === c) break;
            // V-profile banks on the breach channel: a 3-cell-wide
            // notch instead of a 1-cell slit (which would stay a
            // metre-deep pit forever)
            const stx = (next % N) - x0, sty = ((next / N) | 0) - y0;
            for (let s = 0; s < 2; s++) {
              const px = s === 0 ? -sty : sty, py = s === 0 ? stx : -stx;
              const bx = x0 + px, by = y0 + py;
              if (bx < 1 || by < 1 || bx >= N - 1 || by >= N - 1) continue;
              const bi = by * N + bx;
              h[bi] = Math.min(h[bi], level + Math.max(0.5 * cutAmt, 0.3 * voxel));
            }
            cur = next;
          }
          breached = true;
        }
      }
    }
    if (!breached) break;
  }
}

/** Fill shallow single-cell micro-pits to their lowest rim.
 * A 1-cell pit that is more than a voxel or two deep is a real
 * channel floor (breach notch, rill) and is left alone. */
export function fillMicroPits(h, N, voxel, maxDepthVoxels = 1.5) {
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i, hc = h[c];
      let mn = Infinity;
      for (let k = 0; k < 8; k++) {
        const nx = i + NEI[k][0], ny = j + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nh = h[ny * N + nx];
        if (nh < mn) mn = nh;
      }
      if (mn >= hc - 1e-9 && (mn - hc) < maxDepthVoxels * voxel) {
        h[c] = mn;
      }
    }
  }
}

/* ============================================================
 * EROSION PASS STACK (Gaea-style layering)
 *
 * Each pass is an independent, individually-simulable operator on
 * the SDF field. The user can press "Simulate" on any pass, in any
 * order, as many times as they like — every pass reads and writes
 * the live field plus the shared splat maps, so layers compose:
 *
 *   Fluvial → Debris → Braid → Micro  is the recommended stack
 *   (full water erosion, then slope failure, then braided lowland
 *    reaches, then the fine rill network — what Gaea users do by
 *    running multiple erosion layers at different strengths).
 *
 * Every pass mutates `h` in place, accumulates into the shared
 * maps {erosionMap, depositMap, pointsMap, channelsMap}, ends by
 * draining its own micro-pits, and returns the refreshed flow
 * field so the next pass (and the splats) work on current state.
 * ============================================================ */

function thermalWeather(h, N, voxel, seed) {
  // Steep faces weather into jagged, irregular rock and shed debris;
  // a smooth cliff is a dead giveaway of CG. 1 m-scale jaggedness is
  // applied only where the surface is already steep, plus a slight
  // back-cut of over-steep faces. The raggedness also hands the
  // micro pass fresh small-scale structure to branch from.
  const jag = new Perlin2D(subseed((seed ^ 0x8e2f) >>> 0, 31));
  const c2 = (N - 1) / 2;
  const steepF = new Float32Array(N * N);
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      const gx = (h[c + 1] - h[c - 1]) / (2 * voxel);
      const gz = (h[c + N] - h[c - N]) / (2 * voxel);
      const sl = Math.hypot(gx, gz);
      const steep = smooth(1.1, 1.9, sl);
      if (steep <= 0) continue;
      const x = (i - c2) * voxel, z = (j - c2) * voxel;
      const n = fbm01(jag, x * 0.9 + 57.1, z * 0.9 - 13.6,
        { octaves: 2, lacunarity: 2.3, gain: 0.55 }) - 0.5;
      h[c] += 0.7 * n * steep;             // ±0.35 m, ~1.1 m scale
      h[c] -= 0.06 * (sl - 1.1) * steep;   // relax over-steep faces
      steepF[c] = steep;
    }
  }
  return steepF;
}

function screeDeposit(h, N, voxel, seed, steepF, depositMap) {
  // Scree: debris shed from steep walls piles at their base. A talus
  // band of loose rock at the foot of every cliff is one of the
  // things that makes a mountain read as real. Deposit (splat)
  // weight is added to moderate-slope cells sitting against a steep
  // one, modulated by noise so the aprons look organic, not banded.
  const talusN = new Perlin2D(subseed((seed ^ 0x3d4c) >>> 0, 91));
  const c2 = (N - 1) / 2;
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      const gx = (h[c + 1] - h[c - 1]) / (2 * voxel);
      const gz = (h[c + N] - h[c - N]) / (2 * voxel);
      const sl = Math.hypot(gx, gz);
      // only the apron: moderate slope, not the wall itself, not flat
      if (sl < 0.18 || sl > 1.05) continue;
      let wall = 0;
      for (let k = 0; k < 8; k++) {
        const nx = i + NEI[k][0], ny = j + NEI[k][1];
        if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
        const wv = steepF[ny * N + nx];
        if (wv > wall) wall = wv;
      }
      if (wall <= 0.05) continue;
      const x = (i - c2) * voxel, z = (j - c2) * voxel;
      const t = 0.5 + 0.5 * talusN.noise(x * 0.35 + 21.7, z * 0.35 - 8.2);
      depositMap[c] += 0.30 * wall * t;
    }
  }
}

function finalFlow(h, N, voxel, seed, seaLevel) {
  const ff = computeFlow(h, N, voxel, mulberry32((seed ^ 0x9e3779b9) >>> 0), seed, 0.06, 0.4, seaLevel);
  let flowMax = 1;
  for (let f = 0; f < h.length; f++) if (ff.flow[f] > flowMax) flowMax = ff.flow[f];
  return { flow: ff.flow, pits: ff.pits, flowMax };
}

/**
 * PASS 1 — FLUVIAL (full water erosion). Stream power incision +
 * sediment capacity routing + hillslope diffusion, then basin
 * drainage, thermal weathering and scree talus. The main pass.
 */
export async function passFluvial(cfg) {
  const { h, N, voxel, seed, seaLevel, valley, iterations, diffusion,
          mExp, nExp, erodibility, cutFraction, sedimentOn, maps, yieldControl } = cfg;
  const bedrock = Math.min(seaLevel - 14, -40);
  const res = await streamPowerErode({
    h, N, voxel, seed,
    iterations, K: 8e-3, m: mExp, n: nExp, D: diffusion,
    cutFraction, erodibility, sedimentOn, seaLevel, bedrock,
    valley, erosionMap: maps.erosionMap, depositMap: maps.depositMap, pointsMap: maps.pointsMap,
    yieldControl,
  });
  drainSmallBasins(h, N, voxel, seaLevel);
  fillMicroPits(h, N, voxel);
  const steepF = thermalWeather(h, N, voxel, seed);
  screeDeposit(h, N, voxel, seed, steepF, maps.depositMap);
  return res;
}

/**
 * PASS 2 — DEBRIS FLOWS (slope failure, the non-water erosion).
 * Cells on over-steep faces above a spatially-varying critical angle
 * collapse downslope; a ~2.2 m noise field restricts failure to
 * coherent gully corridors (so the upper flanks get rill-like debris
 * channels, not a uniform slump). Material that reaches a gentler
 * toe keeps moving and piles into fan-shaped deposits — debris fans
 * read visually differently from water-cut rills (coarser, wider,
 * fanning).
 */
export async function passDebris(cfg) {
  const { h, N, voxel, seed, seaLevel, iterations, erodibility, maps, yieldControl } = cfg;
  const size = N * N;
  const cellArea = voxel * voxel;
  const iters = Math.max(10, Math.round(iterations * 0.45));
  const failN = new Perlin2D(subseed((seed ^ 0x5e3a) >>> 0, 71));
  const c2 = (N - 1) / 2;
  const rng = mulberry32((seed ^ 0xde3b) >>> 0);
  let carved = 0, deposited = 0;
  let ff = computeFlow(h, N, voxel, rng, seed, 0.06, 0.4, seaLevel);
  for (let it = 0; it < iters; it++) {
    const { order, downIdx } = ff;
    for (let ii = size - 1; ii >= 0; ii--) {
      const idx = order[ii];
      const down = downIdx[idx];
      if (down < 0) continue;
      const cur = h[idx];
      if (cur < seaLevel + 0.5) continue;
      const cx = idx % N, cy = (idx / N) | 0;
      const dx = (down % N) - cx, dy = ((down / N) | 0) - cy;
      const dist = (dx !== 0 && dy !== 0) ? voxel * Math.SQRT2 : voxel;
      const drop = cur - h[down];
      if (drop <= 0) continue;
      const S = drop / dist;
      const x = (cx - c2) * voxel, z = (cy - c2) * voxel;
      // gully corridors: only fail inside noise channels
      const chan = failN.noise(x * 0.45 + 31.7, z * 0.45 - 14.2);
      if (chan < 0.12) continue;
      // spatially varying critical angle (~53°–68°)
      const crit = 1.25 + 0.55 * failN.noise(x * 0.21 + 3.3, z * 0.21 - 9.1);
      const over = S - crit;
      if (over <= 0) continue;
      // does the toe keep moving? (fan extension)
      const down2 = downIdx[down];
      let toe = false;
      if (down2 >= 0) {
        const d2x = (down2 % N) - (down % N), d2y = ((down2 / N) | 0) - ((down / N) | 0);
        const d2d = (d2x !== 0 && d2y !== 0) ? voxel * Math.SQRT2 : voxel;
        const d2drop = h[down] - h[down2];
        if (d2drop > 0 && d2drop / d2d < crit * 0.8) toe = true;
      }
      const fail = Math.min(over * 0.30 * erodibility * voxel, 0.22 * voxel);
      h[idx] -= fail * 0.5;
      maps.erosionMap[idx] += fail * 0.5;
      carved += fail * 0.5 * cellArea;
      h[down] += fail * 0.35;
      maps.depositMap[down] += fail * 0.35;
      deposited += fail * 0.35 * cellArea;
      if (toe && down2 >= 0) {
        h[down2] += fail * 0.15;
        maps.depositMap[down2] += fail * 0.15;
        deposited += fail * 0.15 * cellArea;
      }
    }
    if ((it & 2) === 2 || it === iters - 1) {
      ff = computeFlow(h, N, voxel, rng, seed, 0.06, 0.4, seaLevel);
    }
    if (yieldControl && (it & 3) === 3) await yieldControl(it + 1, iters);
  }
  drainSmallBasins(h, N, voxel, seaLevel);
  fillMicroPits(h, N, voxel);
  const ff2 = finalFlow(h, N, voxel, seed, seaLevel);
  return { carvedM3: carved, depositedM3: deposited, flow: ff2.flow, flowMax: ff2.flowMax, pits: ff2.pits };
}

/**
 * PASS 3 — HYDRAULIC (concentrated fluvial). Stream power with NO
 * diffusion: incision is not countered by maturing, so the existing
 * network deepens into steep-walled canyons. Run after Fluvial to
 * carve the big canyons; run a couple of times for V-shaped gorges.
 */
export async function passHydraulic(cfg) {
  const { h, N, voxel, seed, seaLevel, iterations, mExp, nExp, erodibility,
          cutFraction, sedimentOn, maps, yieldControl } = cfg;
  const bedrock = Math.min(seaLevel - 14, -40);
  const res = await streamPowerErode({
    h, N, voxel, seed: (seed ^ 0x1a2b) >>> 0,
    iterations: Math.max(12, Math.round(iterations * 0.75)),
    K: 0.02, m: mExp, n: Math.max(1.2, nExp), D: 0,
    cutFraction: Math.min(0.45, cutFraction * 1.15),
    erodibility, sedimentOn, seaLevel, bedrock,
    minFlowA: 1.5, mScale: 0.06, mAmp: 0.45, valley: null,
    erosionMap: maps.erosionMap, depositMap: maps.depositMap, pointsMap: maps.pointsMap,
    yieldControl,
  });
  drainSmallBasins(h, N, voxel, seaLevel);
  fillMicroPits(h, N, voxel);
  return res;
}

/**
 * PASS 4 — RIVERS ONLY. Same stream power, but only the main
 * network (A ≥ 4 m²) incises, with a larger cut cap and bank
 * retreat — deepens riverbeds and widens the big channels without
 * touching the hillslopes. This is the "river-bed / water-stream
 * erosion" pass: run it after Fluvial to cut the river courses
 * deeper into the valley floors.
 */
export async function passRivers(cfg) {
  const { h, N, voxel, seed, seaLevel, iterations, mExp, nExp, erodibility,
          cutFraction, sedimentOn, maps, yieldControl } = cfg;
  const bedrock = Math.min(seaLevel - 14, -40);
  const res = await streamPowerErode({
    h, N, voxel, seed: (seed ^ 0x4c8e) >>> 0,
    iterations: Math.max(10, Math.round(iterations * 0.7)),
    K: 0.03, m: Math.min(0.7, mExp + 0.05), n: Math.max(1.3, nExp), D: 0.03,
    cutFraction: Math.min(0.5, cutFraction * 1.35),
    erodibility, sedimentOn, seaLevel, bedrock,
    minFlowA: 4, mScale: 0.06, mAmp: 0.4, valley: null,
    erosionMap: maps.erosionMap, depositMap: maps.depositMap, pointsMap: maps.pointsMap,
    yieldControl,
  });
  drainSmallBasins(h, N, voxel, seaLevel);
  fillMicroPits(h, N, voxel);
  return res;
}

/**
 * PASS 5 — BRAIDED RIVERS (flow splitting). In low-gradient,
 * high-discharge reaches the channel overloads: a migrating noise
 * field builds sand BARS where the flow is slow (bar > +0.45) and
 * scours channels where it's fast (< −0.25). Flow is recomputed
 * every 4 iterations, so the threads keep splitting around the new
 * bars — the canyon mouths fan out into the classic multi-thread
 * braided pattern instead of a single thread to the sea.
 */
export async function passBraid(cfg) {
  const { h, N, voxel, seed, seaLevel, iterations, maps, yieldControl } = cfg;
  const size = N * N;
  const cellArea = voxel * voxel;
  const iters = Math.max(16, Math.round(iterations * 0.75));
  const barN = new Perlin2D(subseed((seed ^ 0xb1ad) >>> 0, 53));
  const c2 = (N - 1) / 2;
  const rng = mulberry32((seed ^ 0xb0a1d) >>> 0);
  let carved = 0, deposited = 0;
  const braidMark = new Uint8Array(size); // where this pass worked (for local smoothing)
  let ff = computeFlow(h, N, voxel, rng, seed, 0.06, 0.4, seaLevel);
  for (let it = 0; it < iters; it++) {
    const { flow, order, pits, downIdx } = ff;
    const phase = it * 0.04; // bars migrate slowly downstream
    for (let ii = size - 1; ii >= 0; ii--) {
      const idx = order[ii];
      if (pits[idx]) continue;
      const down = downIdx[idx];
      if (down < 0) continue;
      const cur = h[idx];
      if (cur < seaLevel + 0.3) continue;
      const cx = idx % N, cy = (idx / N) | 0;
      const dx = (down % N) - cx, dy = ((down / N) | 0) - cy;
      const dist = (dx !== 0 && dy !== 0) ? voxel * Math.SQRT2 : voxel;
      const drop = cur - h[down];
      if (drop <= 0) continue;
      const S = drop / dist;
      const A = flow[idx] * cellArea;
      // the braid zone: any channel with real discharge (main river AND
      // its tributaries) once the gradient relaxes — that's where the
      // floodplain braids, fanning out at the canyon mouth
      if (A < 1.5 || S > 0.30) continue;
      const x = (cx - c2) * voxel, z = (cy - c2) * voxel;
      const bar = barN.noise(x * 0.38 + 7.7 + phase, z * 0.38 - 3.1 - phase * 0.3);
      const g = (1 - S / 0.30) * (0.35 + 0.65 * Math.min(1, A / 40));
      if (bar > 0.4) {
        // bar mound: deposit here + a 1-2 cell wide lateral shoulder
        const d = (0.22 + 0.28 * Math.min(1, A / 40)) * g * voxel;
        h[idx] += d;
        maps.depositMap[idx] += d;
        deposited += d * cellArea;
        braidMark[idx] = 1;
        const p1x = -dy, p1y = dx, p2x = dy, p2y = -dx;
        for (let s = 0; s < 2; s++) {
          const px = s === 0 ? p1x : p2x, py = s === 0 ? p1y : p2y;
          const nx2 = cx + px, ny2 = cy + py;
          if (nx2 < 0 || ny2 < 0 || nx2 >= N || ny2 >= N) continue;
          const si = ny2 * N + nx2;
          const sd = d * 0.35;
          h[si] += sd;
          maps.depositMap[si] += sd;
          deposited += sd * cellArea;
          braidMark[si] = 1;
        }
      } else if (bar < -0.3) {
        // scour: cut the active thread deeper so water concentrates
        const d = Math.min(0.12 * g * Math.pow(A, 0.12), 0.15 * voxel);
        h[idx] -= d;
        maps.erosionMap[idx] += d;
        carved += d * cellArea;
        braidMark[idx] = 1;
      }
    }
    if ((it & 3) === 3 || it === iters - 1) {
      ff = computeFlow(h, N, voxel, rng, seed, 0.06, 0.4, seaLevel);
    }
    if (yieldControl && (it & 3) === 3) await yieldControl(it + 1, iters);
  }
  // relax sharp mounds — but ONLY inside the braided zone, so the rest
  // of the landscape (rill walls etc.) is untouched
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      if (!braidMark[c]) continue;
      const lap = (h[c - 1] + h[c + 1] + h[c - N] + h[c + N] - 4 * h[c]) * 0.25;
      if (lap < -0.02) h[c] += 0.15 * lap;
    }
  }
  drainSmallBasins(h, N, voxel, seaLevel);
  fillMicroPits(h, N, voxel);
  const ff2 = finalFlow(h, N, voxel, seed, seaLevel);
  return { carvedM3: carved, depositedM3: deposited, flow: ff2.flow, flowMax: ff2.flowMax, pits: ff2.pits };
}

/**
 * PASS 6 — MICRO RILLS (fine detail). The dense 1.6–3.3 m branching
 * rill network, seeded on virtual relief (bumps added to a working
 * copy, eroded, subtracted — the rills stay, the bumps don't).
 * Also feeds the dark "Channels" splat layer.
 */
export async function passMicro(cfg) {
  const { h, N, voxel, seed, seaLevel, iterations, erodibility, detail, maps, yieldControl } = cfg;
  const size = N * N;
  const bedrock = Math.min(seaLevel - 14, -40);
  if (detail <= 0.01) {
    const ff2 = finalFlow(h, N, voxel, seed, seaLevel);
    return { carvedM3: 0, depositedM3: 0, flow: ff2.flow, flowMax: ff2.flowMax, pits: ff2.pits };
  }
  const microIters = Math.max(16, Math.round(iterations * 1.5 * detail));
  const nMicro = new Perlin2D(subseed((seed ^ 0x4b9d1e) >>> 0, 55));
  const nMicro2 = new Perlin2D(subseed((seed ^ 0x77aa3c) >>> 0, 77));
  const c2 = (N - 1) / 2;
  const hm = h.slice();
  const bumps = new Float32Array(size);
  for (let j = 0; j < N; j++) {
    const z = (j - c2) * voxel;
    for (let i = 0; i < N; i++) {
      const x = (i - c2) * voxel;
      const c = j * N + i;
      const land = smooth(seaLevel + 0.3, seaLevel + 1.8, h[c]);
      if (land <= 0) continue;
      // two virtual scales: ~3.3 m ridges (primary rill corridors)
      // + ~1.6 m ridges (the fine, intricate branching layer)
      const g = fbm01(nMicro, x * 0.30 + 17.3, z * 0.30 - 31.8,
        { octaves: 3, lacunarity: 2.3, gain: 0.5 }) - 0.5;
      const g2 = fbm01(nMicro2, x * 0.62 + 9.9, z * 0.62 - 44.4,
        { octaves: 2, lacunarity: 2.3, gain: 0.55 }) - 0.5;
      const b = (2.8 * g + 2.0 * g2) * detail * land;   // ±~2 m · detail
      bumps[c] = b;
      hm[c] += b;
    }
  }
  const micro = await streamPowerErode({
    h: hm, N, voxel, seed: (seed ^ 0x2c3f) >>> 0,
    iterations: microIters,
    K: 0.15, m: 0.45, n: 0.9, D: 0.02,
    cutFraction: 0.11,
    erodibility, sedimentOn: true,
    minFlowA: 0.5,
    seaLevel, bedrock,
    mScale: 0.12, mAmp: 0.5,
    valley: null,
    erosionMap: maps.erosionMap, depositMap: maps.depositMap,
    pointsMap: maps.pointsMap, channelsMap: maps.channelsMap,
    yieldControl,
  });
  // strip the virtual seed — rills remain, bumps vanish
  for (let i = 0; i < size; i++) hm[i] -= bumps[i];
  h.set(hm);
  // fine etching can mint fresh micro-pits — drain them too
  drainSmallBasins(h, N, voxel, seaLevel);
  fillMicroPits(h, N, voxel);
  const ff2 = finalFlow(h, N, voxel, seed, seaLevel);
  return { carvedM3: micro.carvedM3, depositedM3: micro.depositedM3, flow: ff2.flow, flowMax: ff2.flowMax, pits: ff2.pits };
}

/**
 * PASS 7 — HILLSLOPE DIFFUSION (thermal/maturation). Pure Laplacian
 * smoothing: relaxes the whole surface, flattens valley floors,
 * rounds ridges, kills over-sharp detail. Run it between erosion
 * passes to "age" the terrain, or alone to mature a raw landscape.
 */
export async function passDiffuse(cfg) {
  const { h, N, voxel, seed, seaLevel, iterations, diffusion, yieldControl } = cfg;
  const iters = Math.max(8, Math.round(iterations * 0.5));
  const D = diffusion;
  for (let it = 0; it < iters; it++) {
    for (let j = 0; j < N; j++) {
      const row = j * N;
      for (let i = 0; i < N; i++) {
        const c = row + i;
        const cur = h[c];
        let sum = 0, cnt = 0;
        if (i > 0) { sum += h[c - 1]; cnt++; }
        if (i < N - 1) { sum += h[c + 1]; cnt++; }
        if (j > 0) { sum += h[c - N]; cnt++; }
        if (j < N - 1) { sum += h[c + N]; cnt++; }
        const lap = (sum - cnt * cur) / cnt;
        if (lap > 1e-5 || lap < -1e-5) h[c] = cur + D * lap;
      }
    }
    if (yieldControl && (it & 3) === 3) await yieldControl(it + 1, iters);
  }
  const ff2 = finalFlow(h, N, voxel, seed, seaLevel);
  return { carvedM3: 0, depositedM3: 0, flow: ff2.flow, flowMax: ff2.flowMax, pits: ff2.pits };
}


/**
 * PASS 8 — PARTICLE HYDRAULIC DROPS (discrete agent simulation).
 * Thousands of individual water particles rain across the mountain,
 * follow 3D momentum and slope, carrying slope-limited sediment.
 * Equipped with strict CFL cut limits and per-drop carve caps to
 * prevent infinite hole punctures / runaway trenching.
 */
export async function passParticle(cfg) {
  const { h, N, voxel, seed, seaLevel, iterations, erodibility, cutFraction, maps, yieldControl } = cfg;
  const count = Math.max(12000, Math.round(iterations * 400));
  const res = particleErode({
    h, N, voxel, seed: (seed ^ 0xfe31) >>> 0,
    particles: count,
    maxSteps: 48,
    inertia: 0.15,
    erodibility,
    cutFraction,
    depositRate: 0.35,
    bedrock: Math.min(seaLevel - 14, -40),
    seaLevel,
    erosionMap: maps.erosionMap,
    depositMap: maps.depositMap,
    pointsMap: maps.pointsMap,
    channelsMap: maps.channelsMap,
    yieldControl,
  });
  drainSmallBasins(h, N, voxel, seaLevel);
  fillMicroPits(h, N, voxel);
  const ff2 = finalFlow(h, N, voxel, seed, seaLevel);
  return { carvedM3: res.carvedM3, depositedM3: res.depositedM3, flow: ff2.flow, flowMax: ff2.flowMax, pits: ff2.pits };
}

/** The pass library — the UI renders one "Simulate" button per entry. */
export const EROSION_PASSES = {
  fluvial:   { name: 'Fluvial · stream power', desc: 'Full water erosion: incision + sediment capacity + hillslope diffusion + basin drainage + thermal weathering. The main pass — run it first.', fn: passFluvial },
  debris:    { name: 'Debris flows', desc: 'Slope failure: over-steep upper-flank faces collapse into gully channels and fan out into debris deposits at the toe. Non-water erosion.', fn: passDebris },
  hydraulic: { name: 'Hydraulic (concentrated)', desc: 'No diffusion: the existing network deepens into steep-walled canyons. Run after Fluvial for V-shaped gorges.', fn: passHydraulic },
  rivers:    { name: 'Rivers only', desc: 'Only the main network incises (A ≥ 4 m²) with a larger cut — deepens river beds and widens banks without touching hillslopes.', fn: passRivers },
  braid:     { name: 'Braided rivers', desc: 'Low-gradient reaches overload: bars build, threads split around them and migrate — multi-thread braided channels at the canyon mouths.', fn: passBraid },
  micro:     { name: 'Micro rills (detail)', desc: 'Fine 1.6–3.3 m branching rill network (the intricate detail texture). Also feeds the dark Channels splat layer.', fn: passMicro },
  particles: { name: 'Particle droplets', desc: 'Physically-simulated discrete water particles: carves realistic natural drainage channels with strict anti-hole caps.', fn: passParticle },
  diffuse:   { name: 'Hillslope diffusion', desc: 'Pure smoothing: rounds ridges, flattens valley floors, matures the surface. Run between passes to age the terrain.', fn: passDiffuse },
};
export const EROSION_PASS_ORDER = ['fluvial', 'particles', 'debris', 'hydraulic', 'rivers', 'braid', 'micro', 'diffuse'];

/**
 * One-click erosion: runs the given pass stack (default:
 * fluvial → debris → braid → micro) on the field, then refreshes
 * flow + water bodies. Mutates h; returns stats + splat fields.
 */
export async function runErosion({
  h, N, voxel, seed,
  iterations, cutFraction, erodibility, diffusion, mExp, nExp,
  sedimentOn, seaLevel, valley = null, detail = 0.65,
  stack = null, maps = null, yieldControl = null,
}) {
  const size = N * N;
  const erosionMap = maps ? maps.erosionMap : new Float32Array(size);
  const depositMap = maps ? maps.depositMap : new Float32Array(size);
  const pointsMap = maps ? maps.pointsMap : new Float32Array(size);
  const channelsMap = maps ? maps.channelsMap : new Float32Array(size);

  const passIds = stack || ['fluvial', 'particles', 'debris', 'braid', 'micro'];
  const base = {
    h, N, voxel, seed, seaLevel, valley,
    iterations, diffusion, mExp, nExp, erodibility, cutFraction,
    sedimentOn, detail,
    maps: { erosionMap, depositMap, pointsMap, channelsMap },
  };
  let carved = 0, deposited = 0, flow = null, flowMax = 1, pits = null;
  for (let pi = 0; pi < passIds.length; pi++) {
    const pass = EROSION_PASSES[passIds[pi]];
    if (!pass) continue;
    const r = await pass.fn({
      ...base,
      yieldControl: yieldControl ? (i, n) => yieldControl(pi, passIds.length, i, n) : null,
    });
    carved += r.carvedM3;
    deposited += r.depositedM3;
    flow = r.flow; flowMax = r.flowMax; pits = r.pits;
  }
  if (!flow) {
    const ff2 = finalFlow(h, N, voxel, seed, seaLevel);
    flow = ff2.flow; flowMax = ff2.flowMax; pits = ff2.pits;
  }
  // ---- water bodies (lakes filled + rivers) ----
  const wb = detectWaterBodies(h, N, flow, seaLevel, { voxel });
  return {
    erosionMap, depositMap, pointsMap, channelsMap,
    flow, pits, flowMax,
    water: wb.water, lakeCount: wb.lakeCount, riverCount: wb.riverCount,
    stats: { carvedM3: carved, depositedM3: deposited, flowMax, iterations: passIds.length },
  };
}
