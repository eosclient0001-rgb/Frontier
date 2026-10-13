// Run state and rules: physics stepping, world queries, collisions, gates, scoring, timer.
// Pure logic: no three.js here. The renderer reads public fields and drains `events`.
import { Route } from './world/route.js';
import { Vehicle, CAR, DT } from './sim/vehicle.js';
import { obbCollide } from './sim/collide.js';
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
const AGENT_HL = 2.3; // traffic car half-length (4.6 m)
const AGENT_HW = 0.95; // traffic car half-width (1.9 m)

const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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
    // train half-length along the rail axis plus the car's half-width; train half-width across the road plus the car's half-length
    const halfLen = CROSS_TRAIN_LEN / 2 + CAR.halfW;
    if (Math.abs(along - t.c) > halfLen) return false;
    if (Math.abs(across) > 1.5 + CAR.halfL) return false;
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
    if (!v.grounded) return;

    const near = this.traffic.nearby(v.x, v.z, 7).filter((a) => a.kind === 'car');
    for (const a of near) {
      const hit = obbCollide(v.x, v.z, v.yaw, CAR.halfL, CAR.halfW, a.x, a.z, a.yaw, AGENT_HL, AGENT_HW);
      if (hit.hit) {
        this._resolveCarContact(a, hit);
      } else if (hit.gap < 1.5 && v.speed > 14 && !this.nearCool.has(a.id)) {
        // near miss: a car passes within a hand's width at speed
        this.nearCool.set(a.id, NEAR_MISS_COOLDOWN);
        this.bonus += NEAR_MISS_PTS;
        this.nearMisses++;
        this.toast('NEAR MISS +' + NEAR_MISS_PTS, 'good');
        this.events.push({ type: 'chime', up: true });
      }
    }
  }

  /**
   * Player vs. traffic car contact. Traffic is kinematic (infinite mass): the player is pushed
   * out along the separating normal, the closing velocity is reflected with a little restitution,
   * an off-centre contact yaws the car, and the traffic car is nudged sideways.
   */
  _resolveCarContact(a, hit) {
    const v = this.vehicle;
    const [nx, nz] = hit.n; // from the traffic car toward the player
    const fx = Math.cos(v.yaw);
    const fz = Math.sin(v.yaw);
    const rx = -fz;
    const rz = fx;

    // 1. positional correction (full, the traffic car does not give way)
    v.x += nx * hit.depth;
    v.z += nz * hit.depth;

    // 2. velocity: relative normal speed, bounce with restitution
    const pvx = v.vx * fx + v.vy * rx;
    const pvz = v.vx * fz + v.vy * rz;
    const avx = a.speed * Math.cos(a.yaw);
    const avz = a.speed * Math.sin(a.yaw);
    const vn = (pvx - avx) * nx + (pvz - avz) * nz; // < 0 means closing
    let J = 0;
    if (vn < 0) {
      // equal-mass impulse (a car against a car): each takes half of the closing speed, low restitution
      J = -(1 + 0.15) * vn * 0.5;
      const ntx = pvx + J * nx;
      const ntz = pvz + J * nz;
      // a little speed is scrubbed off in the collision (sliding and crumpling)
      const newX = ntx * 0.985;
      const newZ = ntz * 0.985;
      v.vx = newX * fx + newZ * fz;
      v.vy = newX * rx + newZ * rz;
    }

    // 3. yaw from off-centre contact: contact point is on the side facing the traffic car
    const along = clampNum((a.x - v.x) * fx + (a.z - v.z) * fz, -CAR.halfL, CAR.halfL);
    const ox = fx * along * 0.6 - nx * 0.9;
    const oz = fz * along * 0.6 - nz * 0.9;
    const dr = ((ox * (J * nz) - oz * (J * nx)) * CAR.mass) / CAR.Iz * 0.6;
    v.r = clampNum(v.r + dr, -2.6, 2.6);

    // 4. nudge the traffic car sideways, away from the player
    const srx = a.dir * -Math.sin(a.yaw);
    const srz = a.dir * Math.cos(a.yaw);
    const push = clampNum(-(nx * srx + nz * srz) * Math.min(J * 0.4, 4), -5, 5);
    a.kick = clampNum(a.kick + push, -5, 5);
    // equal and opposite impulse along its heading: a car that is rear-ended speeds up
    const fax = Math.cos(a.yaw);
    const faz = Math.sin(a.yaw);
    a.speed = Math.max(0, a.speed - J * (nx * fax + nz * faz));

    // 5. events, penalties (once per traffic car per cooldown)
    const strength = clampNum(J / 14, 0.2, 1);
    if (this._impactCool <= 0) {
      this._impactCool = 0.2;
      this.events.push({ type: 'impact', strength, x: v.x, y: v.y, z: v.z });
    }
    if (!this.nearCool.has(a.id) && J > 3) {
      this.nearCool.set(a.id, 1.0);
      this.crashes++;
      this.clock = Math.max(0, this.clock - 0.5);
      this.toast('BUMP −0.5s', 'bad');
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
