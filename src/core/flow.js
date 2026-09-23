// ============================================================================
//  flow.js — drainage network analysis + stream-power incision
//
//  Particle droplets give realistic hillslope transport, but a *drainage
//  network* (the dendritic channels everyone recognises, and the "Flow" SAT
//  map) needs water routed consistently downhill over the whole domain.
//  This module does the hydrology side, and its incision pass is carved back
//  into the SDF as column deltas — the distance field stays the single
//  source of truth.
//
//   1. Priority-flood depression filling (Barnes et al. 2014)
//   2. D8 steepest-descent flow receivers
//   3. Flow accumulation in topological (filled-height) order
//   4. Stream-power incision   E = K · A^m · S^n   (m≈0.7, n≈1)
//      with a lateral term so channels cut V-shaped valleys.
// ============================================================================

/** Binary min-heap over (key, payload-index). */
class MinHeap {
  constructor(cap) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.n = 0;
  }
  push(key, val) {
    let i = this.n++;
    this.k[i] = key; this.v[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      this.swap(p, i); i = p;
    }
  }
  pop() {
    const top = this.v[0];
    this.n--;
    if (this.n > 0) {
      this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.k[l] < this.k[m]) m = l;
        if (r < this.n && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        this.swap(m, i); i = m;
      }
    }
    return top;
  }
  swap(a, b) {
    const tk = this.k[a]; this.k[a] = this.k[b]; this.k[b] = tk;
    const tv = this.v[a]; this.v[a] = this.v[b]; this.v[b] = tv;
  }
}

/**
 * Priority-flood fill + D8 receivers + flow accumulation.
 * @returns {{filled:Float32Array, recv:Int32Array, acc:Float32Array}}
 */
export function drainageNetwork(colH, nx, nz, vox, rng = Math.random) {
  const N = nx * nz;
  const filled = Float32Array.from(colH);
  const closed = new Uint8Array(N);
  const heap = new MinHeap(N);
  const at = (i, k) => colH[k * nx + i];

  // seed the heap with all boundary cells
  for (let i = 0; i < nx; i++) {
    for (const k of [0, nz - 1]) {
      const idx = k * nx + i;
      if (!closed[idx]) { closed[idx] = 1; heap.push(filled[idx], idx); }
    }
  }
  for (let k = 1; k < nz - 1; k++) {
    for (const i of [0, nx - 1]) {
      const idx = k * nx + i;
      if (!closed[idx]) { closed[idx] = 1; heap.push(filled[idx], idx); }
    }
  }

  const NB = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];
  const eps = 1e-4;

  while (heap.n > 0) {
    const c = heap.pop();
    const ci = c % nx, ck = (c / nx) | 0;
    for (let q = 0; q < 8; q++) {
      const ni = ci + NB[q][0], nk = ck + NB[q][1];
      if (ni < 0 || ni >= nx || nk < 0 || nk >= nz) continue;
      const nidx = nk * nx + ni;
      if (closed[nidx]) continue;
      closed[nidx] = 1;
      // raise to just above the current spill level if it is a depression
      const raise = filled[c] + eps;
      if (filled[nidx] < raise) filled[nidx] = raise;
      // note: for strictly-correct filling, use at(ni,nk) original height
      if (filled[nidx] < at(ni, nk)) filled[nidx] = at(ni, nk);
      heap.push(filled[nidx], nidx);
    }
  }

  // D8 receivers: steepest descent on the filled surface, with a small
  // stochastic tie-break among near-steepest neighbours so channels meander
  // instead of running ruler-straight down smooth slopes.
  const recv = new Int32Array(N).fill(-1);
  const cands = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const idx = k * nx + i;
      let bestS = 0;
      let nC = 0;
      for (let q = 0; q < 8; q++) {
        const ni = i + NB[q][0], nk = k + NB[q][1];
        if (ni < 0 || ni >= nx || nk < 0 || nk >= nz) continue;
        const s = (filled[idx] - filled[nk * nx + ni]) / NB[q][2];
        if (s > bestS) bestS = s;
      }
      if (bestS <= 0) continue;
      for (let q = 0; q < 8; q++) {
        const ni = i + NB[q][0], nk = k + NB[q][1];
        if (ni < 0 || ni >= nx || nk < 0 || nk >= nz) continue;
        const s = (filled[idx] - filled[nk * nx + ni]) / NB[q][2];
        if (s >= bestS * 0.72) cands[nC++] = nk * nx + ni;
      }
      recv[idx] = cands[(rng() * nC) | 0];
    }
  }

  // flow accumulation in descending filled order (rain = 1 per cell)
  const order = new Int32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  const keys = new Float32Array(N);
  for (let i = 0; i < N; i++) keys[i] = filled[i];
  const sorted = Array.from(order).sort((a, b) => keys[b] - keys[a]);

  const acc = new Float32Array(N).fill(1);
  for (const idx of sorted) {
    const r = recv[idx];
    if (r >= 0) acc[r] += acc[idx];
  }
  return { filled, recv, acc };
}

/**
 * Stream-power incision on the heightfield, then rebake into the SDF.
 * E = K · A^m · S^n per D8 edge; the upstream cell is lowered, with a lateral
 * fraction spread on the perpendicular neighbours to cut V-shaped valleys.
 *
 * @param {SDFVolume} vol
 * @param {Float32Array} colH  (mutated)
 * @param {object} o { rounds, kE, mExp, nExp, maxInciseVox, lateral }
 */
export function streamPowerIncise(vol, colH, scanColumn, o, rng = Math.random) {
  const nx = vol.nx, nz = vol.nz, N = nx * nz;
  const vox = vol.vox[0];
  const maxIncise = o.maxInciseVox * vox;
  const lateral = o.lateral;

  for (let round = 0; round < o.rounds; round++) {
    const { filled, recv, acc } = drainageNetwork(colH, nx, nz, vox, rng);

    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => filled[b] - filled[a]);
    const delta = new Float32Array(N);

    for (const idx of order) {
      const r = recv[idx];
      if (r < 0) continue;
      const ci = idx % nx, ck = (idx / nx) | 0;
      const ri = r % nx, rk = (r / nx) | 0;
      const dist = Math.hypot(ri - ci, rk - ck) * vox;
      const slope = Math.max((filled[idx] - filled[r]) / dist, 1e-3);
      const A = acc[idx];
      if (A < o.minAcc) continue;              // hillslopes: no channel incision
      const E = o.kE * Math.pow(A, o.mExp) * Math.pow(slope, o.nExp);
      const cut = Math.min(E, maxIncise);
      if (cut <= 0) continue;
      delta[idx] -= cut;
      // lateral V-valley: distribute a fraction perpendicular to flow dir
      const fx = ri - ci, fz = rk - ck;
      if (fx !== 0 || fz !== 0) {
        const px = -fz, pz = fx;
        const pl = Math.hypot(px, pz) || 1;
        const i1i = Math.round(ci + (px / pl)), i1k = Math.round(ck + (pz / pl));
        const i2i = Math.round(ci - (px / pl)), i2k = Math.round(ck - (pz / pl));
        for (const [qq, ww] of [[i1i, i1k], [i2i, i2k]]) {
          if (qq >= 0 && qq < nx && ww >= 0 && ww < nz) {
            delta[ww * nx + qq] -= cut * lateral;
          }
        }
      }
    }

    // apply deltas (simultaneous), respect floor
    for (let i = 0; i < N; i++) {
      colH[i] = Math.max(vol.worldY(0), colH[i] + delta[i]);
    }

    // bake THIS round's incision deltas into the SDF. Each round applies its
    // own bounded delta only (no cumulative re-application, no re-scan
    // difference — both are pathological for buried/bored columns).
    const bound = maxIncise * 1.6;   // cut + accumulated lateral hits
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        let deltaC = delta[k * nx + i];
        if (deltaC > bound) deltaC = bound;
        else if (deltaC < -bound) deltaC = -bound;
        if (deltaC > 1e-4 || deltaC < -1e-4) {
          const base = k * vol.ny * nx + i;
          for (let j = 0; j < vol.ny; j++) vol.data[base + j * nx] -= deltaC;
        }
      }
    }
  }
}
