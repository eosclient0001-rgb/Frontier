/**
 * Rain / fluvial erosion — ballistic drops → impact capsule-carve → surface flow.
 *
 * Phase 0 (ballistic): gravity + wind + drag until the SDF skin is hit.
 * Phase 1 (impact):    kinetic-energy crater carved as a capsule along the shot
 *                      line, modulated by impact angle + hardness + wetness.
 * Phase 2 (flow):      runoff advected along gravity projected on the SDF
 *                      surface; stream-power capacity detaches (groove carve)
 *                      or deposits (blob union). Runs off cliffs correctly.
 */
import { Volume } from '../core/volume';
import { clamp, clamp01 } from '../core/noise';
import {
  ParticlePool, P_BALLISTIC, P_FLOW, SimStats, newStats,
  carveCapsule, depositBlob, hardnessMod, rFromVolume,
} from './particles';

export interface RainParams {
  enabled: boolean;
  rate: number;          // drops spawned per second (while simulating)
  globalRain: number;    // 0..1 base emitter everywhere (paint adds local boost)
  dropRadius: number;    // m, collision + base crater scale
  parcelMult: number;    // water m³ per drop = dropVol * parcelMult
  gravity: number;
  windX: number; windZ: number;
  drag: number;
  energyK: number;       // crater growth with sqrt(impact energy)
  restitution: number;
  friction: number;      // impact velocity retention 0..1
  hardnessResist: number;
  wetSoften: number;
  pickup: number;        // fraction of carved mass kept as sediment
  splashKeep: number;    // water retained after splash
  flowSpeed: number;     // below this impact speed → flow phase
  manning: number;       // flow friction (1/s)
  streamK: number;       // stream-power capacity constant
  detachK: number;       // detachment rate (1/s)
  depositK: number;      // deposition rate (1/s)
  infiltrate: number;    // water loss 1/s
  evaporate: number;     // water loss 1/s
  grooveR: number;       // m, flow detachment kernel radius
  maxLife: number;
  poolCap: number;
  maxSpeed: number;
}

export const DEFAULT_RAIN: RainParams = {
  enabled: true,
  rate: 12000,
  globalRain: 0.35,
  dropRadius: 0.8,
  parcelMult: 10,
  gravity: 9.8,
  windX: 0.4, windZ: 0.2,
  drag: 0.12,
  energyK: 0.14,
  restitution: 0.16,
  friction: 0.5,
  hardnessResist: 0.75,
  wetSoften: 0.6,
  pickup: 0.85,
  splashKeep: 0.86,
  flowSpeed: 2.6,
  manning: 1.6,
  streamK: 4.5,
  detachK: 6.0,
  depositK: 8.0,
  infiltrate: 0.10,
  evaporate: 0.03,
  grooveR: 0.85,
  maxLife: 14,
  poolCap: 30000,
  maxSpeed: 34,
};

const _n = new Float32Array(3);

export class RainSim {
  params: RainParams;
  pool: ParticlePool;
  stats: SimStats = newStats();
  cursor = 0;
  private spawnAcc = 0;
  private colMax: Float32Array | null = null; // 2D column-max of painted rain

  constructor(params: RainParams = { ...DEFAULT_RAIN }) {
    this.params = params;
    this.pool = new ParticlePool(params.poolCap);
  }

  reset(): void {
    this.pool.clear();
    this.stats = newStats();
    this.cursor = 0;
    this.spawnAcc = 0;
  }

  syncCap(): void {
    if (this.pool.cap !== this.params.poolCap) this.pool.resize(this.params.poolCap);
  }

  /** Recompute column-max rain over a painted bbox (full rebuild if size changed). */
  refreshColumns(vol: Volume, i0: number, i1: number, k0: number, k1: number): void {
    const res = vol.res;
    if (!this.colMax || this.colMax.length !== res * res) {
      this.colMax = new Float32Array(res * res);
      i0 = 0; i1 = res - 1; k0 = 0; k1 = res - 1;
    }
    const rain = vol.rain;
    const a0 = Math.max(0, i0), a1 = Math.min(res - 1, i1);
    const b0 = Math.max(0, k0), b1 = Math.min(res - 1, k1);
    for (let k = b0; k <= b1; k++) {
      for (let i = a0; i <= a1; i++) {
        let m = 0;
        for (let j = 0; j < res; j++) {
          const v = rain[(k * res + j) * res + i];
          if (v > m) m = v;
        }
        this.colMax[k * res + i] = m;
      }
    }
  }

  private sampleColMax(vol: Volume, x: number, z: number): number {
    if (!this.colMax || this.colMax.length !== vol.res * vol.res) {
      this.refreshColumns(vol, 0, vol.res - 1, 0, vol.res - 1);
    }
    const ci = Math.max(0, Math.min(vol.res - 1, Math.floor((x - vol.ox) / vol.vox)));
    const ck = Math.max(0, Math.min(vol.res - 1, Math.floor((z - vol.oz) / vol.vox)));
    return this.colMax![ck * vol.res + ci];
  }

  /** Sphere-trace downward to find the surface: drops spawn just above it. */
  private findSurfaceY(vol: Volume, x: number, z: number): number {
    const top = vol.oy + vol.size - vol.vox;
    const vox = vol.vox;
    let y = top;
    for (let i = 0; i < 48; i++) {
      const d = vol.sampleSdf(x, y, z);
      if (d < vox) return y;
      y -= Math.max(d * 0.85, vox * 0.5);
      if (y <= vol.oy) return vol.oy;
    }
    return y;
  }

  dropVol(): number {
    const r = this.params.dropRadius;
    return (4 / 3) * Math.PI * r * r * r * this.params.parcelMult;
  }

  update(vol: Volume, dt: number, budgetMs: number): void {
    const p = this.params;
    if (!p.enabled) return;
    this.syncCap();
    const deadline = performance.now() + Math.max(0.5, budgetMs);
    dt = Math.min(dt, 0.05);

    // ---- spawn -----------------------------------------------------------
    this.spawnAcc += p.rate * dt;
    let toSpawn = Math.floor(this.spawnAcc);
    this.spawnAcc -= Math.floor(this.spawnAcc);
    toSpawn = Math.min(toSpawn, 4000); // per-frame spawn cap keeps bursts smooth
    const x0 = vol.ox, z0 = vol.oz;
    const topY = vol.oy + vol.size - vol.vox;
    const dv = this.dropVol();
    let guard = toSpawn * 4 + 8;
    while (toSpawn > 0 && guard-- > 0) {
      if (performance.now() > deadline) { this.spawnAcc += toSpawn; toSpawn = 0; break; }
      const x = x0 + Math.random() * vol.size;
      const z = z0 + Math.random() * vol.size;
      // Painted storms are 2D columns: any paint in the column seeds drops.
      const mask = this.sampleColMax(vol, x, z);
      const accept = clamp01(p.globalRain * 0.55 + mask);
      if (Math.random() > accept) continue;
      // Spawn just above the local surface: precise aim, no wasted skydive.
      const sy = this.findSurfaceY(vol, x, z);
      const y = Math.min(sy + 3 + Math.random() * 4, topY);
      const ok = this.pool.spawn(
        x, y, z,
        p.windX * 0.4, -1.5 - Math.random(), p.windZ * 0.4,
        dv, 0, p.maxLife * (0.6 + Math.random() * 0.7), P_BALLISTIC
      );
      if (!ok) { toSpawn = 0; break; }
      this.stats.spawned++;
      toSpawn--;
    }

    // ---- step (round-robin under budget) ----------------------------------
    const pool = this.pool;
    const vox = vol.vox;
    const maxR = vox * 6;
    const minR = vox * 0.8;
    if (pool.alive === 0) { this.stats.alive = 0; return; }
    if (this.cursor >= pool.alive) this.cursor = 0;
    const start = this.cursor;
    let processed = 0;
    let i = start;
    // Scratch for surface projection.
    while (processed < pool.alive) {
      if (i >= pool.alive) i = 0;
      if (processed > 0 && i === start) break;
      if ((processed & 255) === 0 && performance.now() > deadline && processed > 512) break;
      processed++;

      const wMin = dv * 0.02;
      pool.life[i] -= dt;
      // Water loss.
      pool.wat[i] *= Math.max(0, 1 - (p.infiltrate + p.evaporate) * dt);
      if (pool.life[i] <= 0 || pool.wat[i] < wMin || !vol.inBounds(pool.px[i], pool.py[i], pool.pz[i])) {
        // Death: settle most of the carried sediment where we are.
        if (pool.sed[i] > 1e-9 && vol.inBounds(pool.px[i], pool.py[i], pool.pz[i])) {
          const r = Math.min(rFromVolume(pool.sed[i] * 0.8), vox * 2.5);
          if (r > minR * 0.5) depositBlob(vol, pool.px[i], pool.py[i], pool.pz[i], r, this.stats);
          else vol.splat(vol.sed, pool.px[i], pool.py[i], pool.pz[i], pool.sed[i]);
        }
        this.stats.killed++;
        pool.kill(i);
        if (i < start && start > 0) { /* start index shifted; loop guard handles */ }
        continue; // do not i++ (swapped element needs processing)
      }

      if (pool.state[i] === P_BALLISTIC) this.stepBallistic(vol, pool, i, dt, minR, maxR, dv);
      else this.stepFlow(vol, pool, i, dt, minR, maxR);
      i++;
    }
    this.cursor = i >= pool.alive ? 0 : i;

    let fly = 0;
    for (let s = 0; s < pool.alive; s++) fly += pool.sed[s];
    this.stats.inFlight = fly;
    this.stats.alive = pool.alive;
  }

  private stepBallistic(vol: Volume, pool: ParticlePool, i: number, dt: number, minR: number, maxR: number, dv: number): void {
    const p = this.params;
    // Integrate with CFL-ish substeps.
    const sp0 = Math.sqrt(pool.vx[i] ** 2 + pool.vy[i] ** 2 + pool.vz[i] ** 2);
    const steps = clamp(Math.ceil((sp0 * dt) / vol.vox), 1, 4);
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      pool.vx[i] += (p.windX - pool.vx[i] * p.drag) * h;
      pool.vy[i] += (-p.gravity - pool.vy[i] * p.drag) * h;
      pool.vz[i] += (p.windZ - pool.vz[i] * p.drag) * h;
      const sp = Math.sqrt(pool.vx[i] ** 2 + pool.vy[i] ** 2 + pool.vz[i] ** 2);
      if (sp > p.maxSpeed) {
        const f = p.maxSpeed / sp;
        pool.vx[i] *= f; pool.vy[i] *= f; pool.vz[i] *= f;
      }
      pool.px[i] += pool.vx[i] * h;
      pool.py[i] += pool.vy[i] * h;
      pool.pz[i] += pool.vz[i] * h;
      const d = vol.sampleSdf(pool.px[i], pool.py[i], pool.pz[i]);
      if (d < p.dropRadius) { this.impact(vol, pool, i, minR, maxR); return; }
      if (!vol.inBounds(pool.px[i], pool.py[i], pool.pz[i])) {
        if (pool.py[i] < vol.oy) { // fell out the bottom: runoff loss
          this.stats.killed++;
          pool.kill(i);
        }
        return;
      }
    }
  }

  private impact(vol: Volume, pool: ParticlePool, i: number, minR: number, maxR: number): void {
    const p = this.params;
    const x = pool.px[i], y = pool.py[i], z = pool.pz[i];
    vol.normal(x, y, z, _n);
    const vx = pool.vx[i], vy = pool.vy[i], vz = pool.vz[i];
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-6;
    const ivx = vx / speed, ivy = vy / speed, ivz = vz / speed;
    const cosA = clamp(-(ivx * _n[0] + ivy * _n[1] + ivz * _n[2]), 0, 1);
    const specE = 0.5 * speed * speed;
    const mod = hardnessMod(vol, x, y, z, p.hardnessResist, p.wetSoften);
    let r = p.dropRadius * (0.55 + p.energyK * Math.sqrt(specE)) * (0.35 + 0.65 * cosA) * mod;
    r = clamp(r, minR, maxR);

    // Capsule along the shot line: entry above → slightly past the skin.
    const ax = x - ivx * r * 1.4, ay = y - ivy * r * 1.4, az = z - ivz * r * 1.4;
    const bx = x + _n[0] * r * 0.4, by = y + _n[1] * r * 0.4, bz = z + _n[2] * r * 0.4;
    const removed = carveCapsule(vol, ax, ay, az, bx, by, bz, r, this.stats);
    pool.sed[i] += removed * p.pickup;

    // Splash: keep some water, deflect the rest.
    pool.wat[i] *= p.splashKeep;
    const vn = vx * _n[0] + vy * _n[1] + vz * _n[2];
    const rest = p.restitution;
    let rx = vx - (1 + rest) * vn * _n[0];
    let ry = vy - (1 + rest) * vn * _n[1];
    let rz = vz - (1 + rest) * vn * _n[2];
    rx *= p.friction; ry *= p.friction; rz *= p.friction;
    // Tangent jitter (splash chaos) from particle phase.
    const j = speed * 0.18;
    const ph = pool.ph[i];
    rx += Math.sin(ph * 3.1) * j; rz += Math.cos(ph * 2.3) * j;
    pool.vx[i] = rx; pool.vy[i] = ry; pool.vz[i] = rz;

    // Wet + flow splats.
    vol.splat(vol.wet, x, y, z, 0.25 * pool.wat[i] / Math.max(this.dropVol(), 1e-9));
    vol.splat(vol.flow, x, y, z, speed * pool.wat[i] * 0.5);

    const sp2 = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (sp2 < p.flowSpeed) {
      pool.state[i] = P_FLOW;
      // Seat on the skin.
      const d = vol.sampleSdf(x, y, z);
      const want = p.dropRadius * 0.5;
      if (d < want) {
        pool.px[i] = x + _n[0] * (want - d);
        pool.py[i] = y + _n[1] * (want - d);
        pool.pz[i] = z + _n[2] * (want - d);
      }
    }
  }

  private stepFlow(vol: Volume, pool: ParticlePool, i: number, dt: number, minR: number, maxR: number): void {
    const p = this.params;
    const x = pool.px[i], y = pool.py[i], z = pool.pz[i];
    vol.normal(x, y, z, _n);
    // Gravity projected on the surface = downhill pull (works on any 3D slope).
    const gdot = -p.gravity * _n[1];
    const gtx = 0 - _n[0] * gdot * -1, gty = -p.gravity - _n[1] * gdot * -1, gtz = 0 - _n[2] * gdot * -1;
    // (g_vec - n*(g_vec·n)) with g_vec=(0,-g,0): g·n = -g*ny
    const gtn = -p.gravity * _n[1];
    const ax = -_n[0] * gtn, ay = -p.gravity - _n[1] * gtn, az = -_n[2] * gtn;
    void gtx; void gty; void gtz;
    pool.vx[i] += ax * dt;
    pool.vy[i] += ay * dt;
    pool.vz[i] += az * dt;
    const fr = Math.max(0, 1 - p.manning * dt);
    pool.vx[i] *= fr; pool.vy[i] *= fr; pool.vz[i] *= fr;
    // Slight wander so rills braid instead of marching in lockstep.
    const wob = 0.35 * dt;
    pool.vx[i] += Math.sin(pool.ph[i] + y * 0.8) * wob;
    pool.vz[i] += Math.cos(pool.ph[i] * 1.7 + x * 0.8) * wob;

    pool.px[i] += pool.vx[i] * dt;
    pool.py[i] += pool.vy[i] * dt;
    pool.pz[i] += pool.vz[i] * dt;

    const nx = pool.px[i], ny = pool.py[i], nz = pool.pz[i];
    const d = vol.sampleSdf(nx, ny, nz);
    if (d > vol.vox * 4) { pool.state[i] = P_BALLISTIC; return; } // ran off a cliff
    if (d < p.dropRadius * 0.5) {
      vol.normal(nx, ny, nz, _n);
      pool.px[i] = nx + _n[0] * (p.dropRadius * 0.5 - d);
      pool.py[i] = ny + _n[1] * (p.dropRadius * 0.5 - d);
      pool.pz[i] = nz + _n[2] * (p.dropRadius * 0.5 - d);
    }

    const speed = Math.sqrt(pool.vx[i] ** 2 + pool.vy[i] ** 2 + pool.vz[i] ** 2);
    const slope = Math.min(1.5, Math.sqrt(ax * ax + ay * ay + az * az) / p.gravity);
    const cap = p.streamK * speed * (slope + 0.02) * pool.wat[i];
    if (pool.sed[i] > cap) {
      const dep = (pool.sed[i] - cap) * Math.min(1, p.depositK * dt);
      const r = clamp(rFromVolume(dep), minR * 0.6, vol.vox * 2.5);
      const added = depositBlob(vol, pool.px[i], pool.py[i], pool.pz[i], r, this.stats);
      pool.sed[i] -= Math.min(pool.sed[i], Math.max(added, dep * 0.5));
    } else {
      const want = (cap - pool.sed[i]) * Math.min(1, p.detachK * dt);
      if (want > 1e-10) {
        const mod = hardnessMod(vol, nx, ny, nz, p.hardnessResist, p.wetSoften);
        const r = clamp(Math.min(p.grooveR * mod, rFromVolume(want * 3) + vol.vox * 0.3), minR * 0.5, vol.vox * 2);
        const il = Math.max(speed, 1e-4);
        const dx = pool.vx[i] / il, dy = pool.vy[i] / il, dz = pool.vz[i] / il;
        const removed = carveCapsule(
          vol, nx - dx * vol.vox * 2, ny - dy * vol.vox * 2, nz - dz * vol.vox * 2,
          nx, ny, nz, r, this.stats
        );
        pool.sed[i] += removed * p.pickup;
      }
    }
    vol.splat(vol.wet, nx, ny, nz, 0.12 * dt * 60 * 0.016 * pool.wat[i] / Math.max(this.dropVol(), 1e-9));
    vol.splat(vol.flow, nx, ny, nz, speed * pool.wat[i] * dt * 2);
  }
}
