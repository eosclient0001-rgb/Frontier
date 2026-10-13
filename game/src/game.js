// Run state and rules: physics stepping, world queries, collisions, gates, scoring, timer.
// Pure logic: no three.js here. The renderer reads public fields and drains `events`.
import { Route } from './world/route.js';
import { Vehicle, CAR, DT } from './sim/vehicle.js';
import { queryRoad } from './sim/surface.js';
import { Traffic } from './sim/traffic.js';
import { CrossingTrains, CROSS_TRAIN_LEN } from './sim/trains.js';
import { ROAD, AHEAD, TRAIN_H } from './world/constants.js';
import { clamp } from './core/math.js';

const START_TIME = 45; // seconds on the clock
const CHECKPOINT_EVERY = 1000; // metres
const CHECKPOINT_BONUS = 14; // seconds
const NEAR_MISS_PTS = 100;
const NEAR_MISS_COOLDOWN = 2.0;
const TRAIN_PENALTY = 3;
const CAR_PENALTY = 2;

export class Game {
  constructor() {
    this.state = 'menu'; // menu | play | pause | over
    this.events = [];
    this.newRun(Math.floor(Math.random() * 1e9));
  }

  /** Build a fresh route, traffic and trains; car placed on the start straight. */
  newRun(seed) {
    this.seed = seed;
    this.runId = (this.runId || 0) + 1;
    this.route = new Route(seed);
    this.traffic = new Traffic(this.route, seed ^ 0x5bd1);
    this.crossTrains = new CrossingTrains(this.route, seed ^ 0x2f1);
    this.vehicle = new Vehicle();
    this.inp = { throttle: 0, brake: 0, steer: 0, hb: false, nitro: false };

    const first = this.route.sections[0];
    this.vehicle.placeOn({ sec: first }, 12, ROAD.MEDIAN_HALF + ROAD.LANE_W * 1.5);
    this.vehicle.vx = 22;
    this.vehicle.r = 0;

    this.acc = 0;
    this.time = 0; // run time (s)
    this.clock = START_TIME;
    this.dist = 0;
    this.bonus = 0;
    this.nextCheckpoint = CHECKPOINT_EVERY;
    this.checkpoints = 0;
    this.nearCool = new Map();
    this.cooldownTrain = 0;
    this.cooldownCar = 0;
    this.airTime = 0;
    this._impactCool = 0;
    this._gateWarned = false;
    this.safe = { sec: first, s: 12, lat: ROAD.MEDIAN_HALF + ROAD.LANE_W * 1.5 };
    this.safeTimer = 0;
    this.driftTime = 0;
    this.driftScore = 0;
    this.drifting = false;
    this.nearMisses = 0;
    this.crashes = 0;
    this.stats = { maxSpeed: 0 };
    this.route.extendTo(AHEAD);
  }

  start() {
    this.state = 'play';
    this.events.push({ type: 'start' });
  }

  togglePause() {
    if (this.state === 'play') this.state = 'pause';
    else if (this.state === 'pause') this.state = 'play';
  }

  get speedKmh() {
    return this.vehicle.speed * 3.6;
  }

  /** Distance along the player's section chain. Falls back to the last value when off-road. */
  get playerDist() {
    const v = this.vehicle;
    return v.sec ? v.sec.dist0 + v.s : this.dist;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  toast(text, tone = 'info') {
    this.events.push({ type: 'toast', text, tone });
  }

  /** Advance the run by a frame. `input` is the raw Input object. */
  update(frameDt, input) {
    const dt = Math.min(frameDt, 0.05);
    if (this.state !== 'play') return;

    this.time += dt;
    this.inp = input.read();
    this.acc += dt;
    while (this.acc >= DT) {
      this._physStep(DT);
      this.acc -= DT;
    }
    const v = this.vehicle;
    const pd = this.playerDist;
    this.dist = Math.max(this.dist, pd);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, v.speed);

    this.route.extendTo(pd + AHEAD);
    this.route.prune(pd);
    this.crossTrains.update(dt, pd);
    this.traffic.update(dt, pd);

    this._frameCollisions(dt);
    this._drift(dt);
    this._checkpoints();

    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0;
      this.state = 'over';
      this.events.push({ type: 'over' });
    }
  }

  // ---------------------------------------------------------------- physics

  _surf = (x, y, z, hint) => queryRoad(this.route, x, y, z, hint);

  _physStep(dt) {
    const v = this.vehicle;
    const prev = { x: v.x, z: v.z, sec: v.sec, s: v.s, lat: v.lat, yaw: v.yaw, vx: v.vx, vy: v.vy };
    v.step(dt, this.inp, this._surf);

    if (v.wallHit > 0.3 && this._impactCool <= 0) {
      this._impactCool = 0.2;
      this.events.push({ type: 'wall', strength: clamp(v.wallHit / 8, 0.2, 1), x: v.x, y: v.y, z: v.z });
    }
    if (v.landed > 3) this.events.push({ type: 'land', strength: clamp(v.landed / 12, 0.2, 1) });

    // lost off the world: respawn on the last safe spot after a short fall
    if (!v.grounded) this.airTime += dt;
    else this.airTime = 0;
    if (v.lost || this.airTime > 1.6) {
      this._respawn();
      return;
    }
    if (v.grounded && v.sec) {
      this.safeTimer += dt;
      if (this.safeTimer > 0.5 && Math.abs(v.lat) < ROAD.OUTER) {
        this.safeTimer = 0;
        this.safe = { sec: v.sec, s: v.s, lat: v.lat };
      }
    }

    this._gateAndTrainCheck(prev);
  }

  _respawn() {
    const v = this.vehicle;
    const sec = this.route.byId.has(this.safe.sec?.id) ? this.safe.sec : this.route.sections[0];
    const s = this.route.byId.has(this.safe.sec?.id) ? this.safe.s : 12;
    const lat = this.route.byId.has(this.safe.sec?.id) ? this.safe.lat : ROAD.MEDIAN_HALF + ROAD.LANE_W * 1.5;
    v.placeOn({ sec }, s, lat);
    v.vx = Math.min(Math.max(v.vx, 0), 14);
    v.vy = 0;
    v.r = 0;
    v.vyW = 0;
    this.airTime = 0;
    this.clock = Math.max(0, this.clock - CAR_PENALTY);
    this.toast('RECOVERED −' + CAR_PENALTY + 's', 'bad');
    this.events.push({ type: 'impact', strength: 0.6 });
  }

  /** Level-crossing barriers and street-level trains block the car (bounce back to the previous step). */
  _gateAndTrainCheck(prev) {
    const v = this.vehicle;
    const bounce = (strength) => {
      v.x = prev.x;
      v.z = prev.z;
      v.sec = prev.sec;
      v.s = prev.s;
      v.lat = prev.lat;
      v.vx = Math.max(0, v.vx * 0.2);
      v.vy *= 0.4;
      v.r *= 0.3;
      if (this._impactCool <= 0) this.events.push({ type: 'impact', strength, x: v.x, y: v.y, z: v.z });
      this._impactCool = 0.2;
    };

    for (const rail of this.route.rails) {
      if (rail.kind !== 'ground') continue;
      for (const g of rail.gates) {
        if (g.angle < 0.5) continue;
        if (!prev.sec || prev.sec !== rail.section || v.sec !== rail.section) continue;
        if ((prev.s - g.s) * (v.s - g.s) < 0) {
          bounce(0.6);
                if (!this._gateWarned) this.toast('BARRIER DOWN — WAIT', 'bad');
          this._gateWarned = true;
          return;
        }
      }
    }
    this._gateWarned = false;

    if (this.cooldownTrain > 0) return;
    for (const t of this.crossTrains.trains) {
      if (t.rail.kind !== 'ground') continue;
      if (this._hitsTrain(t, v.x, v.z, v.y)) {
        bounce(1);
        this.cooldownTrain = 0.8;
        this.clock = Math.max(0, this.clock - TRAIN_PENALTY);
        this.crashes++;
        this.toast('TRAIN STRIKE −' + TRAIN_PENALTY + 's', 'bad');
        return;
      }
    }
  }

  /** Axis-aligned check of a car position against a rail train (length along the rail axis). */
  _hitsTrain(t, x, z, y) {
    const r = t.rail;
    const pose = this.crossTrains.pose(t);
    const dx = x - r.cx;
    const dz = z - r.cz;
    const along = dx * r.ax + dz * r.az; // coordinate along the rail axis (train travels this way)
    const across = dx * r.tx + dz * r.tz; // coordinate along the road
    const halfLen = CROSS_TRAIN_LEN / 2 + 1.3;
    if (Math.abs(along - t.c) > halfLen) return false;
    if (Math.abs(across) > 1.5 + 1.2) return false;
    if (y > pose.y + TRAIN_H / 2 + 0.2) return false; // above the train (elevated rails)
    return y > pose.y - 1.4 && y < pose.y + TRAIN_H;
  }

  // ---------------------------------------------------------------- traffic and scoring

  _frameCollisions(dt) {
    const v = this.vehicle;
    for (const k of this.nearCool.keys()) {
      const left = this.nearCool.get(k) - dt;
      if (left <= 0) this.nearCool.delete(k);
      else this.nearCool.set(k, left);
    }
    this.cooldownTrain = Math.max(0, this.cooldownTrain - dt);
    this._impactCool = Math.max(0, this._impactCool - dt);
    this.cooldownCar = Math.max(0, this.cooldownCar - dt);
    if (!v.grounded) return;

    const near = this.traffic.nearby(v.x, v.z, 6);
    for (const a of near) {
      if (a.kind !== 'car') continue;
      const dx = v.x - a.x;
      const dz = v.z - a.z;
      const d = Math.hypot(dx, dz) || 0.001;
      const nx = dx / d;
      const nz = dz / d;
      // relative speed along the car's heading is the crash strength
      const pvx = v.speed * Math.cos(v.yaw);
      const pvz = v.speed * Math.sin(v.yaw);
      const avx = a.speed * Math.cos(a.yaw);
      const avz = a.speed * Math.sin(a.yaw);
      const rel = Math.hypot(pvx - avx, pvz - avz);
      const hit = 2.6;
      if (d < hit) {
        const overlap = hit - d;
        if (this.cooldownCar <= 0) {
          v.x += nx * overlap * 0.6;
          v.z += nz * overlap * 0.6;
          const side = (-nx * Math.sin(v.yaw) + nz * Math.cos(v.yaw)) >= 0 ? 1 : -1;
          v.vx *= 0.9;
          v.r += side * 0.7;
          a.kick = clamp(a.kick - side * 2.4, -4, 4);
          const strength = clamp(rel / 20, 0.2, 1);
          if (this._impactCool <= 0) this.events.push({ type: 'impact', strength, x: v.x, y: v.y, z: v.z });
          if (v.speed > 20) {
            this.clock = Math.max(0, this.clock - 0.5);
            this.crashes++;
            this.toast('BUMP −0.5s', 'bad');
          }
          this.cooldownCar = 0.6;
        }
        continue;
      }
      // near miss: a car passes close at speed
      if (d < 4.6 && v.speed > 14 && !this.nearCool.has(a.id)) {
        this.nearCool.set(a.id, NEAR_MISS_COOLDOWN);
        this.bonus += NEAR_MISS_PTS;
        this.nearMisses++;
        this.toast('NEAR MISS +' + NEAR_MISS_PTS, 'good');
        this.events.push({ type: 'chime', up: true });
      }
    }
  }

  _drift(dt) {
    const v = this.vehicle;
    const slip = Math.abs(v.slipR);
    const drifting = v.grounded && v.speed > 12 && slip > 0.2;
    this.drifting = drifting;
    if (drifting) {
      this.driftTime += dt;
      const pts = dt * 40 * clamp(v.speed / 30, 0.4, 1.6) * clamp(slip / 0.35, 0.5, 1.4);
      this.driftScore += pts;
      this.bonus += pts;
      v.nitroLeft = Math.min(1, v.nitroLeft + dt * 0.06);
    }
    if (drifting && this.driftTime > 1.5 && Math.floor(this.driftTime) !== Math.floor(this.driftTime - dt)) {
      this.toast('DRIFT ' + Math.round(this.driftScore) + ' pts', 'info');
    }
    if (!drifting && this.driftTime > 0) {
      if (this.driftTime > 1.5) this.toast('DRIFT x' + this.driftTime.toFixed(1) + 's', 'good');
      this.driftTime = 0;
      this.driftScore = 0;
    }
  }

  _checkpoints() {
    while (this.dist >= this.nextCheckpoint) {
      this.nextCheckpoint += CHECKPOINT_EVERY;
      this.checkpoints++;
      this.clock += CHECKPOINT_BONUS;
      this.toast('CHECKPOINT +' + CHECKPOINT_BONUS + 's', 'good');
      this.events.push({ type: 'chime', up: true });
    }
  }

  get score() {
    return Math.floor(this.dist) + Math.floor(this.bonus);
  }
}
