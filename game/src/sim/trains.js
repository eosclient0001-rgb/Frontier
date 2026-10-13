// Trains that cut across the road perpendicularly: street-level freight/commuter trains
// behind lowering level-crossing barriers, and elevated heavy-rail or monorail lines that
// pass overhead. Each rail line is a straight segment through a road section.
import { makeRng } from '../core/rng.js';
import { RAIL_HALF_LEN } from '../world/constants.js';

export const CROSS_TRAIN_LEN = 96;
const SPEED = 26;
const GATE_ZONE = 150; // barriers come down when a train is this close to the crossing

export class CrossingTrains {
  constructor(route, seed = 7) {
    this.route = route;
    this.rng = makeRng(seed);
    this.trains = [];
    this.time = 0;
    this.id = 1;
  }

  update(dt, playerDist) {
    this.time += dt;

    for (const rail of this.route.rails) {
      const dist = rail.section.dist0 + rail.s;
      const ahead = dist - playerDist;
      // trains are scheduled while the player approaches; re-armed on a cooldown
      if (ahead > -80 && ahead < 560 && this.time >= rail.nextSpawn) {
        rail.nextSpawn = this.time + this.rng.range(18, 30);
        if (this.rng.chance(0.6)) {
          const dir = this.rng.chance(0.5) ? 1 : -1;
          const tail = RAIL_HALF_LEN + CROSS_TRAIN_LEN / 2 + 12;
          this.trains.push({
            id: this.id++,
            rail,
            dir,
            c: -dir * tail,
            speed: SPEED * this.rng.range(0.9, 1.1),
            len: CROSS_TRAIN_LEN,
            kind: rail.kind === 'air-mono' ? 'mono' : 'heavy',
          });
        }
      }
    }

    for (const t of this.trains) {
      t.c += t.dir * t.speed * dt;
    }
    this.trains = this.trains.filter((t) => Math.abs(t.c) < RAIL_HALF_LEN + CROSS_TRAIN_LEN / 2 + 14);

    // barriers: target closed while a street-level train is inside the gate zone
    for (const rail of this.route.rails) {
      if (rail.kind !== 'ground') continue;
      const closing = this.trains.some((t) => t.rail === rail && Math.abs(t.c) < GATE_ZONE + t.len / 2);
      for (const g of rail.gates) {
        const target = closing ? 1 : 0;
        const rate = 0.9; // barriers swing down over about a second
        g.angle += Math.max(-rate * dt, Math.min(rate * dt, target - g.angle));
      }
    }
  }

  /** Is the given ground rail's crossing blocked right now (barrier arms down)? */
  isBlocked(rail) {
    return rail.gates.some((g) => g.angle > 0.7);
  }

  /** World-space position of a train's centre and axis (rail-aligned). */
  pose(t) {
    const r = t.rail;
    const y = r.kind === 'ground' ? r.cy : r.deckY;
    return {
      x: r.cx + r.ax * t.c,
      y,
      z: r.cz + r.az * t.c,
      ax: r.ax,
      az: r.az,
      tx: r.tx,
      tz: r.tz,
    };
  }
}
