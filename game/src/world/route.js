// Owns the infinite road graph: generates blocks ahead of the car, prunes behind it,
// and attaches rail features (monorail runs, parallel tracks, perpendicular crossings).
import { makeRng } from '../core/rng.js';
import { Section } from './section.js';
import {
  CLEARANCE,
  KEEP_BEHIND,
  AHEAD,
  MONO_BEAM_AIR,
  MONO_BEAM_GROUND,
  RAIL_HALF_LEN,
  RAIL_AIR_H,
  TRAIN_H,
  GATE_OFFSET,
} from './constants.js';
import { planBlock } from './generator.js';

function segDist2(px, pz, x0, z0, x1, z1) {
  const ex = x1 - x0;
  const ez = z1 - z0;
  const l2 = ex * ex + ez * ez || 1;
  let t = ((px - x0) * ex + (pz - z0) * ez) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x0 + ex * t - px;
  const dz = z0 + ez * t - pz;
  return dx * dx + dz * dz;
}

export class Route {
  constructor(seed = 20260) {
    this.rng = makeRng(seed);
    this.sections = [];
    this.byId = new Map();
    this.rails = [];
    this.events = [];
    this.nextId = 1;
    this.lastKind = null;
    this.st = {
      x: 0,
      z: 0,
      h: 0,
      elev: 0,
      dist: 0,
      blocks: 0,
      openEnds: [],
      monoLeft: 0,
      monoStyle: 'air',
      parLeft: 0,
    };
    this.extendTo(AHEAD);
  }

  get frontDist() {
    return this.st.dist;
  }

  extendTo(dist) {
    let guard = 0;
    while (this.st.dist < dist && guard++ < 500) this.addBlock();
  }

  addBlock() {
    let plan = null;
    for (let tries = 0; tries < 12 && !plan; tries++) {
      const cand = planBlock(this.st, this.rng, { forceStraight: this.st.blocks === 0 });
      if (this.st.blocks === 0 || !this.conflicts(cand)) plan = cand;
    }
    if (!plan) plan = planBlock(this.st, this.rng, { forceStraight: true });
    this.commit(plan);
  }

  /** Would this plan run into existing road (same level) or a rail corridor? */
  conflicts(plan) {
    const cut = this.st.dist - 220; // the immediately preceding road is adjacent by design
    for (const spec of plan.specs) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < spec.xs.length; i++) {
        minX = Math.min(minX, spec.xs[i]);
        maxX = Math.max(maxX, spec.xs[i]);
        minZ = Math.min(minZ, spec.zs[i]);
        maxZ = Math.max(maxZ, spec.zs[i]);
      }
      for (const sec of this.sections) {
        if (sec.dist0 + sec.len > cut) continue;
        if (!sec.overlapsXZ(minX - CLEARANCE, maxX + CLEARANCE, minZ - CLEARANCE, maxZ + CLEARANCE)) continue;
        const c2 = CLEARANCE * CLEARANCE;
        for (let i = 0; i < spec.xs.length; i += 3) {
          const x = spec.xs[i];
          const z = spec.zs[i];
          const y = spec.ys[i];
          for (let j = 0; j < sec.n; j += 2) {
            const dx = sec.px[j] - x;
            const dz = sec.pz[j] - z;
            if (dx * dx + dz * dz < c2 && Math.abs(sec.py[j] - y) < 8) return true;
          }
        }
      }
      // rail corridors (ground corridors are at street level, elevated ones high above)
      for (const r of this.rails) {
        for (let i = 0; i < spec.xs.length; i += 3) {
          const y = spec.ys[i];
          if (y < r.yLo || y > r.yHi) continue;
          if (segDist2(spec.xs[i], spec.zs[i], r.seg.x0, r.seg.z0, r.seg.x1, r.seg.z1) < 18 * 18) return true;
        }
      }
    }
    return false;
  }

  commit(plan) {
    const st = this.st;
    const created = plan.specs.map((spec) => {
      const sec = new Section({
        id: this.nextId++,
        kind: spec.kind,
        dist0: st.dist + spec.dist0Off,
        xs: spec.xs,
        ys: spec.ys,
        zs: spec.zs,
        bs: spec.bs,
        elev: spec.elev,
        isY: spec.isY,
      });
      this.sections.push(sec);
      this.byId.set(sec.id, sec);
      return sec;
    });

    const first = created[0];
    for (const o of st.openEnds) {
      o.next.push(first);
      first.prev.push(o);
    }
    if (plan.isY) {
      created[0].next.push(created[1], created[2]);
      created[1].prev.push(created[0]);
      created[2].prev.push(created[0]);
    }

    st.openEnds = plan.openIdx.map((i) => created[i]);
    st.x = plan.end.x;
    st.z = plan.end.z;
    st.h = plan.end.h;
    st.elev = plan.end.elev;
    st.dist += plan.advance;
    st.blocks++;
    this.lastKind = plan.lastKind;

    if (plan.isY) {
      st.monoLeft = 0;
      st.parLeft = 0;
    } else {
      this.applyFeatures(created[0], created);
    }
  }

  applyFeatures(sec, created) {
    const st = this.st;
    const rng = this.rng;

    // --- monorail guideway (median); runs of 1–3 blocks ---
    if (st.monoLeft > 0) {
      st.monoLeft--;
      sec.monorail = true;
    } else if (rng.chance(0.28)) {
      st.monoLeft = rng.int(1, 3);
      st.monoStyle = rng.chance(0.5) ? 'air' : 'ground';
      sec.monorail = true;
      st.monoLeft--;
      this.events.push({ type: 'monoStart', section: sec });
    }
    if (sec.monorail) sec.monoH = sec.elev > 0 || st.monoStyle === 'air' ? MONO_BEAM_AIR : MONO_BEAM_GROUND;

    // --- parallel heavy rail (street level only) ---
    if (sec.elev === 0 && st.parLeft > 0) {
      st.parLeft--;
      sec.railPar = true;
    } else if (sec.elev === 0 && !this.groundRailNear(st.dist, 320) && rng.chance(0.14)) {
      st.parLeft = rng.int(1, 3);
      st.parLeft--;
      sec.railPar = true;
      this.events.push({ type: 'parStart', section: sec });
    } else {
      st.parLeft = 0;
    }

    // --- perpendicular crossings: level crossings, elevated rail and elevated monorail ---
    const roll = rng.next();
    const s = sec.len * rng.range(0.4, 0.6);
    if (sec.len < 120 || sec.railPar) return;
    if (roll < 0.3 && sec.elev === 0 && !this.parNear(st.dist, 320) && !this.groundRailNear(st.dist, 200)) {
      this.tryAddRail(sec, s, 'ground', created);
    } else if (roll < 0.5) {
      this.tryAddRail(sec, s, rng.chance(0.5) ? 'air-rail' : 'air-mono', created);
    }
  }

  groundRailNear(dist, window) {
    return this.rails.some((r) => r.kind === 'ground' && Math.abs(r.section.dist0 - dist) < window);
  }

  parNear(dist, window) {
    return this.sections.some((s) => s.railPar && Math.abs(s.dist0 - dist) < window);
  }

  tryAddRail(sec, s, kind, created) {
    const p = sec.point(s, 0);
    const ax = p.rx;
    const az = p.rz;
    const half = RAIL_HALF_LEN;
    const deckY = kind === 'ground' ? p.y : p.y + RAIL_AIR_H;
    const seg = {
      x0: p.x - ax * half,
      z0: p.z - az * half,
      x1: p.x + ax * half,
      z1: p.z + az * half,
    };
    const yLo = kind === 'ground' ? p.y - 1 : deckY - 4.5;
    const yHi = kind === 'ground' ? p.y + TRAIN_H + 1 : deckY + 4.5;

    // must not hit any road that is at a conflicting height (own block excluded)
    const own = new Set(created.map((c) => c.id));
    const r2 = 18 * 18;
    for (const other of this.sections) {
      if (own.has(other.id)) continue;
      for (let j = 0; j < other.n; j += 2) {
        if (other.py[j] < yLo || other.py[j] > yHi) continue;
        if (segDist2(other.px[j], other.pz[j], seg.x0, seg.z0, seg.x1, seg.z1) < r2) return null;
      }
    }
    // rails may not cross other ground rails either
    for (const r of this.rails) {
      if (r.kind !== 'ground' || kind !== 'ground') continue;
      if (segCrossDist(seg, r.seg) < 8) return null;
    }

    const rail = {
      id: this.nextId++,
      kind,
      section: sec,
      s,
      cx: p.x,
      cy: p.y,
      cz: p.z,
      ax,
      az,
      tx: p.tx,
      tz: p.tz,
      half,
      deckY,
      seg,
      yLo,
      yHi,
      gates: kind === 'ground' ? [{ s: s - GATE_OFFSET, angle: 0 }, { s: s + GATE_OFFSET, angle: 0 }] : [],
      nextSpawn: 0,
    };
    this.rails.push(rail);
    sec.rails.push(rail);
    return rail;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  prune(playerDist) {
    const cut = playerDist - KEEP_BEHIND;
    const keep = [];
    for (const sec of this.sections) {
      if (sec.dist0 + sec.len < cut && !this.st.openEnds.includes(sec)) {
        sec.removed = true;
        this.byId.delete(sec.id);
      } else {
        keep.push(sec);
      }
    }
    this.sections = keep;
    for (const sec of keep) {
      if (sec.prev.some((p) => p.removed)) sec.prev = sec.prev.filter((p) => !p.removed);
      if (sec.next.some((p) => p.removed)) sec.next = sec.next.filter((p) => !p.removed);
    }
    this.rails = this.rails.filter((r) => !r.section.removed);
  }
}

function segCrossDist(a, b) {
  // minimum distance between two 2-D segments (approximate: sample endpoints both ways)
  const pts = [
    [a.x0, a.z0],
    [a.x1, a.z1],
  ];
  let best = Infinity;
  for (const [x, z] of pts) best = Math.min(best, Math.sqrt(segDist2(x, z, b.x0, b.z0, b.x1, b.z1)));
  for (const [x, z] of [
    [b.x0, b.z0],
    [b.x1, b.z1],
  ])
    best = Math.min(best, Math.sqrt(segDist2(x, z, a.x0, a.z0, a.x1, a.z1)));
  // midpoint crossing test
  const cross = (x0, z0, x1, z1, x2, z2, x3, z3) => {
    const d = (x1 - x0) * (z3 - z2) - (z1 - z0) * (x3 - x2);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((x2 - x0) * (z3 - z2) - (z2 - z0) * (x3 - x2)) / d;
    const u = ((x2 - x0) * (z1 - z0) - (z2 - z0) * (x1 - x0)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  if (cross(a.x0, a.z0, a.x1, a.z1, b.x0, b.z0, b.x1, b.z1)) best = 0;
  return best;
}
