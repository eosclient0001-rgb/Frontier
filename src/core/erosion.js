// ============================================================================
//  erosion.js — SDF-NATIVE hydraulic erosion
//
//  Why this is not mesh/heightmap erosion:
//   • Droplets live in 3D and flow on the *implicit isosurface* of the SDF.
//     Gravity is projected onto the local tangent plane (geometric flow), and
//     after each step the droplet is re-projected onto the evolving zero
//     level set with a Newton step  P -= SDF(P)·∇SDF(P)  — the SDF analogue
//     of snapping to a displaced mesh.
//   • Erosion/deposition are volumetric stamps carved directly into the
//     distance field (sdf += cut·K removes rock, sdf -= dep·K adds it).
//   • A narrow-band fast-sweeping redistancing keeps the field a true signed
//     DISTANCE field after carving — that is what keeps ray marching, soft
//     shadows and AO valid. A heightmap never has to do this.
//   • Talus (angle-of-repose) slumping runs on column heights extracted from
//     the field and is baked back as column-wise SDF deltas.
// ============================================================================

import { makeRng } from './noise.js';
import { drainageNetwork, streamPowerIncise } from './flow.js';

const GRAVITY = 9.81;

/**
 * @param {SDFVolume} vol
 * @param {object} p {
 *   droplets, maxSteps, inertia, capacity, minSlope, erosionRate,
 *   depositionRate, evaporation, erosionDepth (master cut scale),
 *   stampRadiusVox, gravityScale, talusAngleDeg, talusRate,
 *   reinitBandVox, seed }
 * @param {object} ctx { colH: Float32Array|null (updated in place), onProgress, isCancelled }
 * @returns {object|null} { colH, flow, sediment, wear, cut, audit:{...} }, null if cancelled
 */
export function erodeSDF(vol, p, ctx) {
  const { nx, ny, nz } = vol;
  const data = vol.data;
  const vox = vol.vox;
  const voxMax = Math.max(vox[0], vox[1], vox[2]);
  const colIdx = (i, k) => i + k * nx;

  let colH = ctx.colH;
  if (!colH || colH.length !== nx * nz) {
    colH = new Float32Array(nx * nz);
    scanAllColumns();
  }

  // ---- accumulation buffers for SAT maps -----------------------------------
  const flow = new Float32Array(nx * nz);
  const sediment = new Float32Array(nx * nz);
  const wear = new Float32Array(nx * nz);
  const h0 = colH.slice();                       // heights before erosion

  const rng = makeRng((p.seed >>> 0) ^ 0xE0E0E0);

  // ---- stamp kernel geometry (world-space smooth cubic) ---------------------
  const R = Math.max(0.8, p.stampRadiusVox) * voxMax;
  const ri = Math.max(1, Math.ceil(R / vox[0]) + 1);
  const rj = Math.max(1, Math.ceil(R / vox[1]) + 1);

  // ---- simulation constants -------------------------------------------------
  const dt = 0.32;
  const G = GRAVITY * (p.gravityScale || 0.9);
  const inertia = p.inertia;
  const capF = p.capacity;
  const minSlope = p.minSlope;
  const erRate = p.erosionRate * p.erosionDepth;
  const depRate = p.depositionRate;
  const evap = p.evaporation;
  const maxCarve = 0.35 * vox[1];   // never punch through a ridge in one step
  const slopeCap = 2.0;             // waterfalls don't gain infinite capacity
  const minSpeed = 1e-4;
  // Resolution-contract: a column may never be cut deeper than this. Tied to
  // the voxel size + master depth multiplier so detail and cut always match.
  // (Particles get (2.5+6·d)·vox; stream-power incision gets the remaining ~1.5.)
  const maxColumnCut = (2.5 + 6 * p.erosionDepth) * voxMax;
  const borderMargin = 2.5 * vox[0];
  const cutAcc = new Float32Array(nx * nz);   // exact integrated cut per column
  // Column-delta bakes only move near-surface cells, fading to zero at this
  // depth — deep interior (already clamped by redistancing) can never flip
  // sign, which would read as a phantom borehole.
  const bakeBand = 5 * voxMax;

  const n = [0, 0, 0], g = [0, -G, 0];
  let carveVolume = 0, depositVolume = 0, activeSteps = 0;

  const batches = 8;
  const perBatch = Math.ceil(p.droplets / batches);

  // ---- column height bounds (refreshed per batch, used for spawn sampling) --
  let hMinC = Infinity, hMaxC = -Infinity;
  function computeBounds() {
    hMinC = Infinity; hMaxC = -Infinity;
    for (let i = 0; i < colH.length; i++) {
      if (colH[i] < hMinC) hMinC = colH[i];
      if (colH[i] > hMaxC) hMaxC = colH[i];
    }
  }
  computeBounds();

  for (let b = 0; b < batches; b++) {
    const t0 = now();
    for (let dIdx = 0; dIdx < perBatch; dIdx++) {
      // ---- spawn: 85% importance-sampled by height (erosion concentrates on
      //      the massif), 15% uniform --------------------------------------
      let ci, ck, tries = 0;
      do {
        ci = 1 + ((rng() * (nx - 2)) | 0);
        ck = 1 + ((rng() * (nz - 2)) | 0);
        tries++;
        if (rng() < 0.85) {
          const hNorm = (colH[colIdx(ci, ck)] - hMinC) / Math.max(1e-3, hMaxC - hMinC);
          if (rng() > hNorm) continue;
        }
        break;
      } while (tries < 24);

      let x = vol.worldX(ci) + (rng() - 0.5) * vox[0];
      let z = vol.worldZ(ck) + (rng() - 0.5) * vox[2];
      let y = colH[colIdx(ci, ck)] + 0.1;
      let vx = 0, vy = 0, vz = 0;
      let water = 1, sed = 0;

      for (let step = 0; step < p.maxSteps; step++) {
        // ---- tangent gravity on the implicit surface ---------------------
        vol.grad(x, y, z, n);
        let nl = Math.hypot(n[0], n[1], n[2]);
        if (nl < 1e-6) break;
        n[0] /= nl; n[1] /= nl; n[2] /= nl;
        const gdn = g[1] * n[1];
        const atx = -gdn * n[0];
        const aty = -G - gdn * n[1];
        const atz = -gdn * n[2];

        vx = vx * inertia + atx * (1 - inertia) * dt;
        vy = vy * inertia + aty * (1 - inertia) * dt;
        vz = vz * inertia + atz * (1 - inertia) * dt;
        // CFL clamp: never move more than ~2 voxels per step, or the droplet
        // can jump clean through a ridge and end up stamping inside the rock.
        let sp = Math.hypot(vx, vy, vz);
        const vMax = 2.2 * voxMax / dt;
        if (sp > vMax) { const s = vMax / sp; vx *= s; vy *= s; vz *= s; sp = vMax; }

        const px = x, py = y, pz = z;
        x += vx * dt; y += vy * dt; z += vz * dt;

        // ---- Newton re-projection onto the evolving isosurface -----------
        let d = vol.sample(x, y, z);
        vol.grad(x, y, z, n);
        nl = Math.hypot(n[0], n[1], n[2]) || 1;
        const sn = Math.min(1.5 * voxMax, Math.abs(d));
        const sgn = d > 0 ? 1 : -1;
        x -= n[0] * sn * sgn; y -= n[1] * sn * sgn; z -= n[2] * sn * sgn;
        d = vol.sample(x, y, z);
        if (Math.abs(d) > 0.35 * voxMax) {   // second Newton pass if far off
          vol.grad(x, y, z, n);
          nl = Math.hypot(n[0], n[1], n[2]) || 1;
          const sn2 = Math.min(1.5 * voxMax, Math.abs(d));
          const sgn2 = d > 0 ? 1 : -1;
          x -= n[0] * sn2 * sgn2; y -= n[1] * sn2 * sgn2; z -= n[2] * sn2 * sgn2;
          d = vol.sample(x, y, z);
        }
        // droplet lost (buried or flung): abandon rather than carve blind
        if (Math.abs(d) > 1.2 * voxMax) break;

        // bounds
        if (x < borderMargin || x > vol.size[0] - borderMargin || z < borderMargin || z > vol.size[2] - borderMargin ||
            y < vox[1] || y > vol.size[1] - vox[1]) break;

        // ---- hydraulics ---------------------------------------------------
        const dh = py - y;                                   // descent this step
        const horiz = Math.hypot(x - px, z - pz);
        if (dh < 0) {
          // dropped into a local pit: fill it from the load (lake deposition)
          const fill = Math.min(sed, -dh * 0.6);
          if (fill > 1e-5) { stamp(x, y, z, -fill); sed -= fill; sediment[colIndexAt(x, z)] += fill; }
          water *= (1 - evap);
          if (water < 0.04) break;
          continue;
        }
        const slope = dh / Math.max(horiz, 1e-4);
        const waterfall = horiz < 0.3 * dh;   // vertical plunge: transport only
        const slopeEff = Math.min(slope, slopeCap);
        const cap = capF * Math.max(slopeEff, minSlope) * Math.max(sp, minSpeed) * water;

        const ciCol = colIndexAt(x, z);
        flow[ciCol] += water;

        if (waterfall) {
          water *= (1 - evap);
          if (water < 0.04) break;
          continue;
        }
        if (cap > sed) {
          // enforce the per-column cut budget (bedrock floor)
          if (cutAcc[ciCol] >= maxColumnCut) {
            const dep = Math.min(sed, Math.max(0.05, 0.3 * (sed + 0.01)));
            if (dep > 1e-5) { stamp(x, y, z, -dep); sed -= dep; sediment[ciCol] += dep; depositVolume += dep; }
          } else {
            const er = Math.min(erRate * (cap - sed), maxCarve);
            stamp(x, y, z, er);              // sdf += cut  (rock removed)
            sed += er;
            wear[ciCol] += er;
            colH[ciCol] = Math.max(vol.worldY(0), colH[ciCol] - er * 0.9); // live budget tracking
            carveVolume += er;
            activeSteps++;
          }
        } else if (sed > cap * 1.4) {          // only over-saturated drops settle
          const dep = Math.min(Math.min((sed - cap * 1.4) * depRate, sed), 0.35 * vox[1]);
          if (dep > 1e-5) {
            stamp(x, y, z, -dep);          // sdf -= dep  (material added)
            sed -= dep;
            sediment[ciCol] += dep;
            colH[ciCol] = Math.min(vol.size[1], colH[ciCol] + dep * 0.9);
            depositVolume += dep;
            activeSteps++;
          }
        }

        water *= (1 - evap);
        if (water < 0.04) break;
      }
    }

    // ---- per-batch maintenance ---------------------------------------------
    scanAllColumns();                          // exact colH after stamping
    talusRelax(p.talusAngleDeg, p.talusRate, 2);
    vol.reinitialize({ bandVox: p.reinitBandVox || 6, iters: 2 });
    ctx.onProgress && ctx.onProgress((b + 1) / batches, `Erosion batch ${b + 1}/${batches}`, now() - t0);
    computeBounds();
    if (ctx.isCancelled && ctx.isCancelled()) return null;
  }

  // ---- fluvial phase: drainage-network stream-power incision ----------------
  if (p.incisionRounds > 0) {
    const tF = now();
    streamPowerIncise(vol, colH, scanColumn, {
      rounds: p.incisionRounds,
      kE: 0.16 * (p.erosionDepth || 1),
      mExp: 0.8, nExp: 1.0,
      maxInciseVox: 0.85, lateral: 0.35, minAcc: 8,
      bake: bakeColumnDelta
    }, rng);
    ctx.onProgress && ctx.onProgress(1, 'Fluvial incision', now() - tF);
  }

  scanAllColumns();
  vol.reinitialize({ bandVox: 7, iters: 2 });
  despeckleColumns();

  // final drainage network (drives the Flow / Wetness SAT maps)
  const hydro = drainageNetwork(colH, nx, nz, vol.vox[0], rng);

  // ---- audit: measured cut vs voxel resolution ------------------------------
  let hMin = Infinity, hMax = -Infinity, h0MinV = Infinity, h0MaxV = -Infinity;
  const cut = new Float32Array(nx * nz);
  let maxCutAcc = 0;
  for (let i = 0; i < cut.length; i++) {
    cut[i] = h0[i] - colH[i];
    if (cutAcc[i] > maxCutAcc) maxCutAcc = cutAcc[i];
    if (colH[i] < hMin) hMin = colH[i];
    if (colH[i] > hMax) hMax = colH[i];
    if (h0[i] < h0MinV) h0MinV = h0[i];
    if (h0[i] > h0MaxV) h0MaxV = h0[i];
  }
  // channel statistics: cut where flow is significant (drainage lines)
  const flowSorted = Float32Array.from(flow).sort();
  const q60 = flowSorted[(flowSorted.length * 0.6) | 0] || 0;
  let chSum = 0, chN = 0, cutMax = 0, cutSum = 0;
  for (let i = 0; i < cut.length; i++) {
    cutSum += cut[i];
    if (cut[i] > cutMax) cutMax = cut[i];
    if (flow[i] > q60 && cut[i] > 0) { chSum += cut[i]; chN++; }
  }
  const channelMeanCut = chN ? chSum / chN : 0;

  return {
    colH, flow: hydro.acc, dropletFlow: flow, sediment, wear, cut,
    audit: {
      voxel: vox.slice(), voxMax,
      meanCut: cutSum / cut.length, maxCut: cutMax, maxCutIntegrated: maxCutAcc, channelMeanCut,
      carveVolume, depositVolume, activeSteps,
      droplets: p.droplets, relief: h0MaxV - hMin
    }
  };

  // ==== helpers ==============================================================

  /**
   * Volumetric stamp. amount > 0: erosion (sdf increases, surface drops).
   * amount < 0: deposition (sdf decreases, surface rises).
   */
  function stamp(wx, wy, wz, amount) {
    const hx = vox[0], hy = vox[1], hz = vox[2];
    const gi = Math.round(wx / hx - 0.5), gj = Math.round(wy / hy - 0.5), gk = Math.round(wz / hz - 0.5);
    const i0 = Math.max(0, gi - ri), i1 = Math.min(nx - 1, gi + ri);
    const j0 = Math.max(0, gj - rj), j1 = Math.min(ny - 1, gj + rj);
    const k0 = Math.max(0, gk - ri), k1 = Math.min(nz - 1, gk + ri);
    const ir = R * R;
    for (let k = k0; k <= k1; k++) {
      const dz = vol.worldZ(k) - wz;
      for (let j = j0; j <= j1; j++) {
        const dy = vol.worldY(j) - wy;
        const dyz = dz * dz + dy * dy;
        if (dyz > ir) continue;
        const rowBase = (k * ny + j) * nx;
        for (let i = i0; i <= i1; i++) {
          const dx = vol.worldX(i) - wx;
          const r2 = dx * dx + dyz;
          if (r2 > ir) continue;
          const q = 1 - r2 / ir;
          const wgt = q * q * (3 - 2 * q);
          const cell = rowBase + i;
          if (amount > 0) {
            const cc = k * nx + i;
            if (cutAcc[cc] >= maxColumnCut) continue;  // this column's budget is spent
            const before = data[cell];
            if (before > -2.5 * vox[1] && before < 2.5 * vox[1])
              cutAcc[cc] += amount * wgt;              // near-surface: counts
          }
          data[cell] += amount * wgt;
        }
      }
    }
  }

  function colIndexAt(wx, wz) {
    let i = Math.round(wx / vox[0] - 0.5);
    let k = Math.round(wz / vox[2] - 0.5);
    if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
    if (k < 0) k = 0; else if (k >= nz) k = nz - 1;
    return colIdx(i, k);
  }

  function scanAllColumns() {
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++)
        colH[colIdx(i, k)] = scanColumn(i, k);
  }

  function scanColumn(i, k) {
    let yPrev = vol.worldY(ny - 1);
    let dPrev = data[(k * ny + (ny - 1)) * nx + i];
    if (dPrev <= 0) return yPrev;
    for (let j = ny - 2; j >= 0; j--) {
      const y = vol.worldY(j);
      const d = data[(k * ny + j) * nx + i];
      if (d <= 0) {
        const t = dPrev / (dPrev - d);
        return yPrev + (y - yPrev) * t;
      }
      dPrev = d; yPrev = y;
    }
    return vol.worldY(0);
  }

  /** Angle-of-repose relaxation on column heights, baked into the SDF. */
  function talusRelax(angleDeg, rate, iters) {
    const talus = Math.tan(angleDeg * Math.PI / 180);
    const pre = colH.slice();
    for (let it = 0; it < iters; it++) {
      for (let k = 1; k < nz - 1; k++) {
        for (let i = 1; i < nx - 1; i++) {
          const c = colIdx(i, k);
          const hc = colH[c];
          let bl = -1, bh = hc;
          for (let q = 0; q < 4; q++) {
            const ni = i + (q === 0 ? -1 : q === 1 ? 1 : 0);
            const nk = k + (q === 2 ? -1 : q === 3 ? 1 : 0);
            const hn = colH[colIdx(ni, nk)];
            if (hn < bh) { bh = hn; bl = colIdx(ni, nk); }
          }
          if (bl < 0) continue;
          const slope = (hc - bh) / vox[0];
          if (slope <= talus) continue;
          const m = (slope - talus) * vox[0] * 0.5 * rate;
          colH[c] -= m;
          colH[bl] += m;
        }
      }
    }
    // bake the *intended* talus deltas into the SDF, band-faded with depth
    const bound = vox[0] * (1 + iters);
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        let delta = colH[colIdx(i, k)] - pre[colIdx(i, k)];
        if (delta > bound) { delta = bound; colH[colIdx(i, k)] = pre[colIdx(i, k)] + bound; }
        else if (delta < -bound) { delta = -bound; colH[colIdx(i, k)] = pre[colIdx(i, k)] - bound; }
        if (delta > 1e-4 || delta < -1e-4) bakeColumnDelta(i, k, delta);
      }
    }
  }

  /** Remove isolated 1-cell sign spikes inside columns (bake/stamp leftovers). */
  function despeckleColumns() {
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const base = k * ny * nx + i;
        for (let pass = 0; pass < 2; pass++) {
          for (let j = 1; j < ny - 1; j++) {
            const c = data[base + j * nx];
            const up = data[base + (j + 1) * nx];
            const dn = data[base + (j - 1) * nx];
            if (c < 0 !== up < 0 && c < 0 !== dn < 0) {
              data[base + j * nx] = dn;   // adopt neighbour sign
            }
          }
        }
      }
    }
  }

  /** Shift a column's surface by deltaC, fading to zero by |sdf| = bakeBand. */
  function bakeColumnDelta(i, k, deltaC) {
    for (let j = 0; j < ny; j++) {
      const cell = (k * ny + j) * nx + i;
      const d = data[cell];
      const ad = d < 0 ? -d : d;
      if (ad >= bakeBand) continue;
      data[cell] -= deltaC * (1 - ad / bakeBand);
    }
  }
}

function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }
