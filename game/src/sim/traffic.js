// Non-player agents that ride the road graph:
//  - traffic cars in both carriageways (forward = same way as the player, oncoming = opposite)
//  - monorail trains on the median guideway
//  - parallel heavy-rail trains running beside the road in both directions
// Agents are kinematic: they move along section chains and never leave the graph.
import { ROAD, RAIL_PAR_LAT } from '../world/constants.js';
import { makeRng } from '../core/rng.js';

const CAR_LEN = 4.6;
const CAR_W = 1.9;
const MONO_LEN = 40;
const PAR_LEN = 118;

const CAR_COLORS = [
  [0.82, 0.84, 0.86],
  [0.18, 0.2, 0.24],
  [0.55, 0.6, 0.66],
  [0.92, 0.92, 0.9],
  [0.25, 0.34, 0.46],
  [0.7, 0.2, 0.18],
  [0.12, 0.45, 0.42],
  [0.8, 0.7, 0.5],
];

function pick(rng, list) {
  return list[Math.floor(rng.next() * list.length) % list.length];
}

export class Traffic {
  constructor(route, seed = 99) {
    this.route = route;
    this.rng = makeRng(seed);
    this.agents = [];
    this.carTarget = 48;
    this.monoTarget = 3;
    this.parTarget = 4;
    this.spawnTimer = 0;
    this.id = 1;
  }

  get cars() {
    return this.agents.filter((a) => a.kind === 'car');
  }

  get trains() {
    return this.agents.filter((a) => a.kind !== 'car');
  }

  _makeCar(dir, lat, sec, s, speed) {
    const rng = this.rng;
    return {
      id: this.id++,
      kind: 'car',
      dir,
      lat,
      sec,
      s,
      speed,
      targetSpeed: speed,
      color: pick(rng, CAR_COLORS),
      len: CAR_LEN,
      wid: CAR_W,
      dy: 0.5,
      rd: sec.dist0 + s,
      dead: false,
      kick: 0,
      cooldown: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
    };
  }

  _makeTrain(kind, dir, lat, sec, s) {
    const isMono = kind === 'mono';
    return {
      id: this.id++,
      kind,
      dir,
      lat,
      sec,
      s,
      speed: isMono ? 24 : 21,
      len: isMono ? MONO_LEN : PAR_LEN,
      wid: isMono ? 2.8 : 3.0,
      dy: isMono ? 1.6 : 2.1,
      rd: sec.dist0 + s,
      dead: false,
      kick: 0,
      cooldown: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
    };
  }

  /** Walk an agent `dist` metres along its chain, respecting the agent's allowed sections. */
  _advance(ag, dist) {
    let remaining = dist;
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 20) {
      const sec = ag.sec;
      if (!sec || sec.removed) {
        ag.dead = true;
        return;
      }
      if (ag.dir > 0) {
        const room = sec.len - ag.s;
        if (remaining <= room) {
          ag.s += remaining;
          return;
        }
        remaining -= room;
        ag.s = sec.len;
        const nxt = this._choose(sec.next, ag);
        if (!nxt) {
          ag.dead = true;
          return;
        }
        ag.sec = nxt;
        ag.s = 0;
      } else {
        const room = ag.s;
        if (remaining <= room) {
          ag.s -= remaining;
          return;
        }
        remaining -= room;
        ag.s = 0;
        const prv = this._choose(sec.prev, ag);
        if (!prv) {
          ag.dead = true;
          return;
        }
        ag.sec = prv;
        ag.s = prv.len;
      }
    }
  }

  _allowed(sec, ag) {
    if (sec.removed) return false;
    if (ag.kind === 'mono') return sec.monorail;
    if (ag.kind === 'par') return sec.railPar;
    return true;
  }

  _choose(list, ag) {
    const ok = list.filter((s) => this._allowed(s, ag));
    if (!ok.length) return null;
    return ok.length === 1 ? ok[0] : pick(this.rng, ok);
  }

  _sectionsInWindow(lo, hi, filter) {
    const out = [];
    for (const sec of this.route.sections) {
      if (sec.removed) continue;
      if (sec.dist0 + sec.len < lo || sec.dist0 > hi) continue;
      if (filter && !filter(sec)) continue;
      out.push(sec);
    }
    return out;
  }

  _pickSection(lo, hi, filter) {
    const list = this._sectionsInWindow(lo, hi, filter);
    if (!list.length) return null;
    // weight by length so long roads get their share of cars
    let total = 0;
    for (const s of list) total += s.len;
    let r = this.rng.next() * total;
    for (const s of list) {
      r -= s.len;
      if (r <= 0) return { sec: s, s: this.rng.range(0, Math.max(1, s.len - 5)) };
    }
    return { sec: list[0], s: 0 };
  }

  _spawnCars(pd, budget) {
    let spawned = 0;
    let attempts = 0;
    const count = () => this.agents.reduce((n, a) => n + (a.kind === 'car' && !a.dead ? 1 : 0), 0);
    while (spawned < budget && count() < this.carTarget && attempts++ < 24) {
      const pick0 = this._pickSection(pd + 90, pd + 900, (s) => !s.railPar || s.elev === 0);
      if (!pick0) break;
      const dir = this.rng.chance(0.5) ? 1 : -1;
      const lane = this.rng.int(0, ROAD.LANES - 1);
      const lat = dir * (ROAD.MEDIAN_HALF + ROAD.LANE_W * (lane + 0.5));
      // don't stack cars on top of each other
      const crowded = this.agents.some(
        (a) =>
          a.kind === 'car' &&
          !a.dead &&
          a.sec === pick0.sec &&
          Math.abs(a.s - pick0.s) < 14 &&
          Math.abs(a.lat - lat) < 1.5,
      );
      if (crowded) continue;
      const speed = dir > 0 ? this.rng.range(15, 25) : this.rng.range(17, 27);
      const car = this._makeCar(dir, lat, pick0.sec, pick0.s, speed);
      this.agents.push(car);
      spawned++;
    }
  }

  _spawnTrains(pd) {
    const count = (k) => this.agents.reduce((n, a) => n + (a.kind === k && !a.dead ? 1 : 0), 0);
    if (count('mono') < this.monoTarget && this.rng.chance(0.02)) {
      const pick0 = this._pickSection(pd + 200, pd + 1000, (s) => s.monorail);
      if (pick0) {
        const t = this._makeTrain('mono', 1, 0, pick0.sec, pick0.s);
        this.agents.push(t);
      }
    }
    if (count('par') < this.parTarget && this.rng.chance(0.02)) {
      const pick0 = this._pickSection(pd + 150, pd + 1000, (s) => s.railPar);
      if (pick0) {
        const dir = this.rng.chance(0.5) ? 1 : -1;
        const lat = dir > 0 ? RAIL_PAR_LAT : -RAIL_PAR_LAT;
        this.agents.push(this._makeTrain('par', dir, lat, pick0.sec, pick0.s));
      }
    }
  }

  /** Advance everything, recycle agents that fell out of range, and keep the pools full. */
  update(dt, pd) {
    this.spawnTimer -= dt;
    for (const ag of this.agents) {
      if (ag.dead) continue;
      if (ag.kind === 'car') this._updateCar(ag, dt);
      else this._updateTrain(ag, dt);
      ag.rd = ag.sec ? ag.sec.dist0 + ag.s : ag.rd;
      if (ag.rd < pd - 380 || ag.rd > pd + 1250) ag.dead = true;
    }
    this.agents = this.agents.filter((a) => !a.dead);
    for (const ag of this.agents) this._pose(ag);

    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      this._spawnCars(pd, 3);
      this._spawnTrains(pd);
    }
  }

  _updateCar(ag, dt) {
    ag.cooldown = Math.max(0, ag.cooldown - dt);
    // car-following: slow to the speed of the nearest car ahead in the same lane
    let target = ag.targetSpeed;
    for (const other of this.agents) {
      if (other === ag || other.kind !== 'car' || other.dead || other.dir !== ag.dir) continue;
      if (Math.abs(other.lat - ag.lat) > 1.2) continue;
      const gap = ag.dir * (other.rd - ag.rd);
      if (gap > 0 && gap < 22) target = Math.min(target, other.speed * 0.98);
    }
    ag.speed += clampNum(target - ag.speed, -3 * dt, 2 * dt);
    ag.kick *= Math.exp(-6 * dt);
    if (Math.abs(ag.kick) > 0.01) {
      const lo = ROAD.MEDIAN_HALF + 0.9;
      const hi = ROAD.OUTER - 0.9;
      ag.lat = clampNum(ag.lat + ag.kick * dt, ag.dir > 0 ? lo : -hi, ag.dir > 0 ? hi : -lo);
    }
    this._advance(ag, ag.speed * dt);
  }

  _updateTrain(ag, dt) {
    this._advance(ag, ag.speed * dt);
  }

  _pose(ag) {
    if (!ag.sec) return;
    const p = ag.sec.point(ag.s, ag.lat, 0);
    const surfY = ag.sec.surfaceY(ag.s, ag.lat);
    ag.x = p.x;
    ag.z = p.z;
    ag.y = surfY + ag.dy + (ag.kind === 'mono' ? ag.sec.monoH || 0 : 0);
    ag.yaw = Math.atan2(p.tz * ag.dir, p.tx * ag.dir);
    ag.tx = p.tx * ag.dir;
    ag.tz = p.tz * ag.dir;
  }

  /** Oncoming / forward car footprint check against a point (player). */
  nearby(x, z, radius) {
    const out = [];
    for (const a of this.agents) {
      if (a.dead) continue;
      if (Math.hypot(a.x - x, a.z - z) < radius) out.push(a);
    }
    return out;
  }
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
