/**
 * Wind erosion — saltation hops + windward abrasion + lee deposition + deflation.
 *
 * Grains ride the wind, hop along the surface (saltation), sandblast faces that
 * look into the wind (abrasion carve ∝ facing × speed², hardness-modulated),
 * strip loose fines (deflation) and dump load on lee slopes (dunes/drifts).
 */
import { Volume } from '../core/volume';
import { clamp, clamp01 } from '../core/noise';
import {
  ParticlePool, P_BALLISTIC, SimStats, newStats,
  carveSphere, depositBlob, hardnessMod, rFromVolume,
} from './particles';

export interface WindParams {
  enabled: boolean;
  rate: number;
  dirX: number; dirZ: number;  // wind direction (will be normalized)
  speed: number;              // m/s target air speed
  relax: number;              // how fast grains match air (1/s)
  turbulence: number;         // jitter amplitude
  gravity: number;
  restitution: number;
  abrasionK: number;          // carve scale
  saltRadius: number;         // m base abrasion kernel
  hardnessResist: number;
  pickup: number;
  deflateK: number;           // loose-sediment stripping rate
  depositK: number;           // lee deposition rate
  settleSpeed: number;        // below → dump load
  maxLife: number;
  poolCap: number;
  maxSpeed: number;
}

export const DEFAULT_WIND: WindParams = {
  enabled: false,
  rate: 4000,
  dirX: 1, dirZ: 0.25,
  speed: 9,
  relax: 1.6,
  turbulence: 1.4,
  gravity: 9.8,
  restitution: 0.34,
  abrasionK: 1.0,
  saltRadius: 0.7,
  hardnessResist: 0.8,
  pickup: 0.7,
  deflateK: 2.0,
  depositK: 3.0,
  settleSpeed: 1.6,
  maxLife: 12,
  poolCap: 16000,
  maxSpeed: 22,
};

const _n = new Float32Array(3);

export class WindSim {
  params: WindParams;
  pool: ParticlePool;
  stats: SimStats = newStats();
  cursor = 0;
  time = 0;
  private spawnAcc = 0;

  constructor(params: WindParams = { ...DEFAULT_WIND }) {
    this.params = params;
    this.pool = new ParticlePool(params.poolCap);
  }

  reset(): void {
    this.pool.clear(); this.stats = newStats(); this.cursor = 0; this.spawnAcc = 0;
  }

  windDir(out: Float32Array | number[]): void {
    const p = this.params;
    const l = Math.hypot(p.dirX, p.dirZ) || 1;
    out[0] = p.dirX / l; out[1] = 0; out[2] = p.dirZ / l;
  }

  update(vol: Volume, dt: number, budgetMs: number): void {
    const p = this.params;
    if (!p.enabled) return;
    if (this.pool.cap !== p.poolCap) this.pool.resize(p.poolCap);
    const deadline = performance.now() + Math.max(0.5, budgetMs);
    dt = Math.min(dt, 0.05);
    this.time += dt;

    const wd = [0, 0, 0];
    this.windDir(wd);

    // ---- spawn on the upwind boundary --------------------------------------
    this.spawnAcc += p.rate * dt;
    let toSpawn = Math.min(Math.floor(this.spawnAcc), 2000);
    this.spawnAcc -= Math.floor(this.spawnAcc);
    const topY = vol.oy + vol.size * 0.75;
    while (toSpawn-- > 0) {
      // Pick the upwind face: |dirX|>|dirZ| → x-face else z-face.
      let x: number, z: number;
      if (Math.abs(wd[0]) >= Math.abs(wd[2])) {
        x = wd[0] > 0 ? vol.ox + vol.vox : vol.ox + vol.size - vol.vox;
        z = vol.oz + Math.random() * vol.size;
      } else {
        z = wd[2] > 0 ? vol.oz + vol.vox : vol.oz + vol.size - vol.vox;
        x = vol.ox + Math.random() * vol.size;
      }
      // Lift out of solid rock: grains must start in the air, never buried.
      let y = vol.oy + Math.random() * (topY - vol.oy);
      let lifts = 0;
      while (vol.sampleSdf(x, y, z) < p.saltRadius && lifts++ < 24) y += vol.vox * 1.5;
      if (lifts > 24) continue; // column is solid — skip this grain
      const ok = this.pool.spawn(
        x, y, z,
        wd[0] * p.speed * (0.7 + Math.random() * 0.4), -0.5 - Math.random(),
        wd[2] * p.speed * (0.7 + Math.random() * 0.4),
        0, 0, p.maxLife * (0.5 + Math.random()), P_BALLISTIC
      );
      if (!ok) break;
      this.stats.spawned++;
    }

    // ---- step ---------------------------------------------------------------
    const pool = this.pool;
    if (pool.alive === 0) { this.stats.alive = 0; return; }
    if (this.cursor >= pool.alive) this.cursor = 0;
    const start = this.cursor;
    const vox = vol.vox;
    const vRef = Math.max(p.speed, 0.1);
    let processed = 0, i = start;
    while (processed < pool.alive) {
      if (i >= pool.alive) i = 0;
      if (processed > 0 && i === start) break;
      if ((processed & 255) === 0 && performance.now() > deadline && processed > 512) break;
      processed++;
      pool.life[i] -= dt;
      const inside = vol.inBounds(pool.px[i], pool.py[i], pool.pz[i]);
      if (pool.life[i] <= 0 || !inside) {
        if (pool.sed[i] > 1e-9 && inside) {
          const r = Math.min(rFromVolume(pool.sed[i]), vox * 2);
          if (r > vox * 0.3) depositBlob(vol, pool.px[i], pool.py[i], pool.pz[i], r, this.stats);
        }
        this.stats.killed++;
        pool.kill(i);
        continue;
      }

      // Relax toward wind + gravity + cheap turbulence.
      const k = Math.min(1, p.relax * dt);
      pool.vx[i] += (wd[0] * p.speed - pool.vx[i]) * k;
      pool.vz[i] += (wd[2] * p.speed - pool.vz[i]) * k;
      pool.vy[i] += (-p.gravity * 0.55 - pool.vy[i]) * k * 0.35;
      const t = this.time, ph = pool.ph[i];
      pool.vx[i] += Math.sin(t * 2.1 + ph + pool.py[i] * 0.35) * p.turbulence * dt;
      pool.vy[i] += Math.sin(t * 2.7 + ph * 1.3 + pool.px[i] * 0.3) * p.turbulence * 0.5 * dt;
      pool.vz[i] += Math.cos(t * 1.9 + ph + pool.pz[i] * 0.35) * p.turbulence * dt;
      const spd0 = Math.hypot(pool.vx[i], pool.vy[i], pool.vz[i]);
      if (spd0 > p.maxSpeed) {
        const f = p.maxSpeed / spd0;
        pool.vx[i] *= f; pool.vy[i] *= f; pool.vz[i] *= f;
      }

      pool.px[i] += pool.vx[i] * dt;
      pool.py[i] += pool.vy[i] * dt;
      pool.pz[i] += pool.vz[i] * dt;

      const x = pool.px[i], y = pool.py[i], z = pool.pz[i];
      const d = vol.sampleSdf(x, y, z);
      const speed = Math.hypot(pool.vx[i], pool.vy[i], pool.vz[i]);
      if (d < p.saltRadius) {
        vol.normal(x, y, z, _n);
        if (d < -vol.vox * 2) {
          // Buried by a fast step: eject to the skin WITHOUT carving.
          pool.px[i] = x + _n[0] * (-d + p.saltRadius);
          pool.py[i] = y + _n[1] * (-d + p.saltRadius);
          pool.pz[i] = z + _n[2] * (-d + p.saltRadius);
          pool.vy[i] = Math.abs(pool.vy[i]) * 0.5;
          i++;
          continue;
        }
        const facing = clamp(-(_n[0] * wd[0] + _n[2] * wd[2]), 0, 1); // 1 = into the wind
        const lee = clamp(_n[0] * wd[0] + _n[2] * wd[2], 0, 1);
        if (facing > 0.03 && speed > 0.5) {
          const mod = hardnessMod(vol, x, y, z, p.hardnessResist, 0);
          const sr = speed / vRef;
          const r = clamp(p.saltRadius * (0.25 + 1.5 * facing) * Math.min(sr * sr, 4) * p.abrasionK * mod, vox * 0.6, vox * 3);
          const removed = carveSphere(vol, x, y, z, r, this.stats);
          pool.sed[i] += removed * p.pickup;
          // Deflation: strip loose fines first.
          const loose = vol.sample(vol.sed, x, y, z);
          if (loose > 0) {
            const drain = Math.min(loose * 0.5, p.deflateK * loose * speed * dt * 0.01);
            vol.splat(vol.sed, x, y, z, -drain);
            pool.sed[i] += drain * vox * vox * vox;
          }
        }
        if ((lee > 0.2 || speed < p.settleSpeed) && pool.sed[i] > 1e-10) {
          const dep = pool.sed[i] * Math.min(1, p.depositK * dt * (0.4 + lee));
          const r = clamp(rFromVolume(dep), vox * 0.3, vox * 2.5);
          const added = depositBlob(vol, x + _n[0] * vox, y + _n[1] * vox, z + _n[2] * vox, r, this.stats);
          pool.sed[i] -= Math.min(pool.sed[i], Math.max(added, dep * 0.5));
        }
        // Saltation bounce: reflect + downstream kick, stay on the skin.
        if (speed > 0.2) {
          const vn = pool.vx[i] * _n[0] + pool.vy[i] * _n[1] + pool.vz[i] * _n[2];
          if (vn < 0) {
            pool.vx[i] -= (1 + p.restitution) * vn * _n[0];
            pool.vy[i] -= (1 + p.restitution) * vn * _n[1];
            pool.vz[i] -= (1 + p.restitution) * vn * _n[2];
          }
          pool.vx[i] += wd[0] * p.speed * 0.25 * dt * 60 * 0.016;
          pool.vz[i] += wd[2] * p.speed * 0.25 * dt * 60 * 0.016;
          if (d < p.saltRadius * 0.5) {
            pool.px[i] = x + _n[0] * (p.saltRadius * 0.5 - d);
            pool.py[i] = y + _n[1] * (p.saltRadius * 0.5 - d);
            pool.pz[i] = z + _n[2] * (p.saltRadius * 0.5 - d);
          }
        }
      } else if (speed < p.settleSpeed * 0.5 && pool.sed[i] > 1e-10 && d < vox * 3) {
        // Airborne stall near ground → dust fall.
        const dep = pool.sed[i] * Math.min(1, p.depositK * dt);
        vol.splat(vol.sed, x, y, z, dep * 2);
        pool.sed[i] -= dep;
      }
      i++;
    }
    this.cursor = i >= pool.alive ? 0 : i;

    let fly = 0;
    for (let s = 0; s < pool.alive; s++) fly += pool.sed[s];
    this.stats.inFlight = fly;
    this.stats.alive = pool.alive;
    void clamp01;
  }
}
