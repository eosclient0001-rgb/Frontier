// Turns one road Section (plus its rails and surroundings) into merged meshes.
// Everything here is pure geometry; WorldView owns the three.js objects.
import * as THREE from 'three';
import { GeoBuilder } from './geom.js';
import { ROAD, RAIL_PAR_LAT } from '../world/constants.js';
import { makeRng, hashInt } from '../core/rng.js';

const OUT = ROAD.OUTER;
const MED = ROAD.MEDIAN_HALF;
const CW = ROAD.CARRIAGE;
const LW = ROAD.LANE_W;
const UP = [0, 1, 0];

const C = {
  asphalt: [0.2, 0.21, 0.23],
  island: [0.62, 0.63, 0.62],
  barrier: [0.78, 0.78, 0.76],
  paint: [0.95, 0.95, 0.93],
  rail: [0.62, 0.64, 0.66],
  curb: [0.7, 0.7, 0.68],
  sidewalk: [0.74, 0.74, 0.72],
  steel: [0.7, 0.72, 0.75],
  guard: [0.8, 0.82, 0.84],
  pylon: [0.78, 0.78, 0.76],
  ballast: [0.36, 0.35, 0.33],
  tie: [0.42, 0.36, 0.3],
  foliage: [0.3, 0.44, 0.32],
  trunk: [0.32, 0.26, 0.2],
  pole: [0.5, 0.52, 0.54],
  panel: [0.1, 0.12, 0.15],
  ledAmber: [1.25, 0.9, 0.5],
  lampLight: [1.7, 1.55, 1.25],
  roofAC: [0.5, 0.52, 0.54],
};

const TINTS = {
  glass: [
    [0.7, 0.78, 0.86],
    [0.62, 0.7, 0.78],
    [0.66, 0.76, 0.74],
    [0.74, 0.8, 0.84],
    [0.6, 0.66, 0.74],
  ],
  concrete: [
    [0.9, 0.88, 0.84],
    [0.82, 0.8, 0.76],
    [0.92, 0.9, 0.86],
    [0.76, 0.76, 0.74],
  ],
  white: [
    [0.94, 0.94, 0.92],
    [0.9, 0.92, 0.94],
  ],
};

/** Point on section i (sample index) at lateral lat and height dy. */
function P(sec, i, lat, dy = 0) {
  const j = Math.min(i, sec.n - 1);
  return [
    sec.px[j] + sec.rx[j] * lat,
    sec.py[j] + sec.bs[j] * lat + dy,
    sec.pz[j] + sec.rz[j] * lat,
  ];
}

function ribbon(b, key, sec, lat0, lat1, dy, col, keep = null) {
  for (let i = 0; i < sec.len; i++) {
    if (keep && !keep(i)) continue;
    b.quad(key, P(sec, i, lat0, dy), P(sec, i, lat1, dy), P(sec, i + 1, lat1, dy), P(sec, i + 1, lat0, dy), UP, col);
  }
}

function wall(b, key, sec, lat, y0, y1, col, step = 1, keep = null) {
  for (let i = 0; i < sec.len; i += step) {
    if (keep && !keep(i)) continue;
    const i1 = Math.min(i + step, sec.len);
    const n = [sec.rx[i], 0, sec.rz[i]];
    b.quad(key, P(sec, i, lat, y0), P(sec, i, lat, y1), P(sec, i1, lat, y1), P(sec, i1, lat, y0), n, col);
  }
}

const elevated = (sec, i) => sec.py[Math.min(i, sec.n - 1)] > 2;
const street = (sec, i) => sec.py[Math.min(i, sec.n - 1)] <= 2;

/** Road, markings, barriers, decks, pylons, street furniture for one section. */
export function buildRoadGeometry(sec, route, rng) {
  const b = new GeoBuilder();

  // asphalt over the whole right-of-way
  ribbon(b, 'road', sec, -OUT, OUT, 0, C.asphalt);
  // central island and reservation barrier
  ribbon(b, 'road', sec, -MED, MED, 0.2, C.island);
  wall(b, 'metal', sec, 0, 0.2, 0.95, C.barrier);
  wall(b, 'metal', sec, 0.001, 0.95, 1.0, C.barrier);

  // lane markings (solid edges, dashed dividers) on both carriageways
  for (const sgn of [1, -1]) {
    ribbon(b, 'road', sec, sgn * (MED + 0.3), sgn * (MED + 0.5), 0.03, C.paint);
    ribbon(b, 'road', sec, sgn * (MED + CW - 0.02), sgn * (MED + CW + 0.2), 0.03, C.paint);
    for (let k = 1; k < ROAD.LANES; k++) {
      const lat = sgn * (MED + k * LW);
      ribbon(b, 'road', sec, lat - 0.09, lat + 0.09, 0.03, C.paint, (i) => i % 8 < 4);
    }
  }

  // outer guard rails, kerbs and sidewalks
  for (const sgn of [1, -1]) {
    const lat = sgn * OUT;
    wall(b, 'metal', sec, lat, 0.25, 0.9, C.guard);
    wall(b, 'metal', sec, lat, 0.22, 0.26, C.guard);
    for (let i = 0; i < sec.len; i += 6) {
      const p = P(sec, i, lat, 0.45);
      b.box('metal', p[0], p[1], p[2], 0.07, 0.45, 0.07, sec.tx[i], sec.tz[i], C.guard);
    }
    ribbon(b, 'concrete', sec, sgn * (OUT + 0.05), sgn * (OUT + 0.6), 0.12, C.curb, street.bind(null, sec));
    ribbon(b, 'concrete', sec, sgn * (OUT + 0.6), sgn * (OUT + 3.2), 0.16, C.sidewalk, street.bind(null, sec));
  }

  // elevated decks: slab edges, sound walls and pylons
  for (const sgn of [1, -1]) {
    wall(b, 'concrete', sec, sgn * OUT, -1.2, 0, [0.62, 0.62, 0.6], 1, elevated.bind(null, sec));
    wall(b, 'concrete', sec, sgn * (OUT + 0.7), 0.1, 1.9, [0.84, 0.84, 0.82], 1, elevated.bind(null, sec));
    wall(b, 'concrete', sec, sgn * (OUT + 0.7) + 0.02 * sgn, 1.9, 2.0, [0.5, 0.52, 0.55], 1, elevated.bind(null, sec));
  }
  for (let i = 0; i < sec.len; i += 22) {
    if (!elevated(sec, i)) continue;
    const top = sec.py[i] - 1.2;
    for (const lat of [-(OUT - 3.5), OUT - 3.5]) {
      const p = P(sec, i, lat, 0);
      b.box('concrete', p[0], top / 2, p[2], 0.9, top / 2, 0.9, sec.tx[i], sec.tz[i], C.pylon);
    }
    if (!sec.monorail) {
      const p = P(sec, i, 0, 0);
      b.box('concrete', p[0], top / 2, p[2], 0.8, top / 2, 0.8, sec.tx[i], sec.tz[i], C.pylon);
    }
  }

  // monorail guideway: beam over the median, pylons down to the deck or street
  if (sec.monorail && sec.monoH > 0) {
    const h = sec.monoH;
    ribbon(b, 'metal', sec, -0.6, 0.6, h, [0.9, 0.92, 0.94]);
    wall(b, 'metal', sec, -0.6, h - 1.1, h, [0.88, 0.9, 0.92]);
    wall(b, 'metal', sec, 0.6, h - 1.1, h, [0.88, 0.9, 0.92]);
    for (let i = 12; i < sec.len; i += 24) {
      const base = sec.py[i];
      const colH = h - 1.1;
      const p = P(sec, i, 0, colH / 2);
      b.box('concrete', p[0], base + colH / 2 - 0.0, p[2], 0.55, colH / 2, 0.55, sec.tx[i], sec.tz[i], C.pylon);
    }
  }

  // parallel heavy-rail tracks at street level, both directions
  if (sec.railPar) {
    for (const sgn of [1, -1]) {
      const c = sgn * RAIL_PAR_LAT;
      ribbon(b, 'road', sec, c - 2.6, c + 2.6, 0.03, C.ballast);
      ribbon(b, 'metal', sec, c - 0.75, c - 0.6, 0.14, C.steel);
      ribbon(b, 'metal', sec, c + 0.6, c + 0.75, 0.14, C.steel);
      for (let i = 0; i < sec.len; i += 2) {
        const p = P(sec, i, c, 0.07);
        b.box('concrete', p[0], p[1], p[2], 0.14, 0.05, 1.35, sec.tx[i], sec.tz[i], C.tie);
      }
    }
  }

  // street lights and gantries
  for (let i = 15; i < sec.len; i += 30) {
    for (const sgn of [1, -1]) {
      const lat = sgn * (OUT + 2.3);
      const base = P(sec, i, lat, 0);
      const top = [base[0], base[1] + 7, base[2]];
      b.box('metal', base[0], base[1] + 3.5, base[2], 0.12, 3.5, 0.12, sec.tx[i], sec.tz[i], C.pole);
      const armCx = base[0] - sgn * sec.rx[i] * 0.9;
      const armCz = base[2] - sgn * sec.rz[i] * 0.9;
      b.box('metal', armCx, top[1] - 0.1, armCz, 0.1, 0.1, 0.9, sec.rx[i], sec.rz[i], C.pole);
      b.box('emissive', armCx, top[1] - 0.25, armCz, 0.4, 0.06, 0.2, sec.tx[i], sec.tz[i], C.lampLight);
    }
  }
  for (let i = 40; i < sec.len; i += 60) {
    if (!elevated(sec, i)) continue;
    for (const sgn of [1, -1]) {
      const p = P(sec, i, sgn * (OUT + 0.9), 0);
      b.box('metal', p[0], p[1] + 1.1, p[2], 0.1, 1.1, 0.1, sec.tx[i], sec.tz[i], C.pole);
    }
  }
  for (let i = 100; i < sec.len; i += 210) {
    if (!street(sec, i)) continue;
    const top = 7.2;
    for (const sgn of [1, -1]) {
      const p = P(sec, i, sgn * (OUT + 1.2), 0);
      b.box('metal', p[0], p[1] + top / 2, p[2], 0.35, top / 2, 0.35, sec.tx[i], sec.tz[i], C.pole);
    }
    const mid = P(sec, i, 0, top);
    b.box('metal', mid[0], mid[1], mid[2], 0.3, 0.3, OUT + 1.4, sec.tx[i], sec.tz[i], C.pole);
    const sign = P(sec, i, 0, top - 1.2);
    b.box('metal', sign[0], sign[1], sign[2], 0.12, 0.9, 6.6, sec.tx[i], sec.tz[i], C.panel);
    const led = P(sec, i, 0, top - 1.2);
    b.box('emissive', led[0] + sec.tx[i] * 0.14, led[1] - 0.05, led[2] + sec.tz[i] * 0.14, 0.02, 0.08, 6.2, sec.tx[i], sec.tz[i], C.ledAmber);
  }

  // trees along the plaza
  for (let i = 3; i < sec.len; i += 15) {
    if (!street(sec, i)) continue;
    for (const sgn of [1, -1]) {
      if (rng.next() < 0.3) continue;
      const base = P(sec, i, sgn * (OUT + 5.5), 0);
      b.box('concrete', base[0], base[1] + 1.2, base[2], 0.18, 1.2, 0.18, sec.tx[i], sec.tz[i], C.trunk);
      const m = new THREE.Matrix4().makeTranslation(base[0], base[1] + 3.6, base[2]);
      m.multiply(new THREE.Matrix4().makeScale(1.7, 2.0, 1.7));
      b.geometry('foliage', icoGeom(), m, [
        C.foliage[0] * (0.8 + rng.next() * 0.3),
        C.foliage[1] * (0.8 + rng.next() * 0.3),
        C.foliage[2] * (0.8 + rng.next() * 0.3),
      ]);
    }
  }

  // city blocks beyond the plaza
  buildCity(b, sec, route, rng);

  return b.build();
}

let _ico = null;
function icoGeom() {
  if (!_ico) _ico = new THREE.IcosahedronGeometry(1, 0);
  return _ico;
}

/** Modern city: glass towers, concrete blocks and white low-rise, placed beside the roads. */
function buildCity(b, sec, route, rng) {
  const lateralBase = sec.railPar ? 36 : 33;
  const others = route.sections.filter((o) => o !== sec && o.dist0 < sec.dist0 + sec.len + 500 && o.endDist > sec.dist0 - 500);
  const rails = route.rails;
  for (const sgn of [1, -1]) {
    let s = rng.range(0, 8);
    let guard = 0;
    while (s < sec.len - 4 && guard++ < 60) {
      const w = rng.range(14, 30);
      const d = rng.range(16, 28);
      const kind = rng.weighted({ tower: 0.42, block: 0.33, low: 0.25 });
      const height = kind === 'tower' ? rng.range(34, 96) : kind === 'block' ? rng.range(14, 30) : rng.range(6, 12);
      const front = lateralBase + rng.range(0, 7);
      const sc = Math.min(sec.len, s + w / 2);
      const si = Math.round(sc);
      const cp = P(sec, si, sgn * (front + d / 2), 0);
      const rad = Math.hypot(w, d) / 2 + 2;
      if (!footprintFree(cp[0], cp[2], rad, others, rails, route, sec)) {
        s += 6;
        continue;
      }
      const fx = sec.tx[si];
      const fz = sec.tz[si];
      const tint = TINTS[kind === 'low' ? 'white' : kind === 'block' ? 'concrete' : 'glass'];
      const col = rng.pick(tint);
      if (kind === 'tower') {
        b.box('concrete', cp[0], 3.5, cp[2], w / 2 + 2, 3.5, d / 2 + 2, fx, fz, [0.86, 0.86, 0.84]);
        // podium (7 m) then the tower shaft
        b.box('glass', cp[0], 7 + height / 2, cp[2], w / 2, height / 2, d / 2, fx, fz, col, 3.6);
        b.box('concrete', cp[0], 7 + height + 0.5, cp[2], w / 2 - 1, 0.5, d / 2 - 1, fx, fz, [0.82, 0.82, 0.8]);
        const ac = 2 + Math.floor(rng.next() * 3);
        for (let k = 0; k < ac; k++) {
          const ox = (rng.next() - 0.5) * (w - 6);
          const oz = (rng.next() - 0.5) * (d - 6);
          b.box('metal', cp[0] + fx * ox - fz * oz, 7 + height + 1.6, cp[2] + fz * ox + fx * oz, 1.6, 0.9, 1.1, fx, fz, C.roofAC);
        }
      } else if (kind === 'block') {
        b.box('concrete', cp[0], height / 2, cp[2], w / 2, height / 2, d / 2, fx, fz, col, 3.5);
        b.box('glass', cp[0], height + 0.5, cp[2], w / 2 - 0.8, 0.5, d / 2 - 0.8, fx, fz, [0.4, 0.44, 0.48], 3.5);
      } else {
        b.box('concrete', cp[0], height / 2, cp[2], w / 2, height / 2, d / 2, fx, fz, col, 3.5);
        // green roof strip
        b.box('foliage', cp[0], height + 0.25, cp[2], w / 2 - 1.2, 0.25, d / 2 - 1.2, fx, fz, [0.38, 0.5, 0.36]);
      }
      s += w + rng.range(5, 13);
    }
  }
}

/** True when a circle at (x,z) of radius rad clears every other road and rail. */
function footprintFree(x, z, rad, others, rails, route, self) {
  for (const o of others) {
    if (o === self) continue;
    if (x < o.minX - rad || x > o.maxX + rad || z < o.minZ - rad || z > o.maxZ + rad) continue;
    for (let j = 0; j < o.n; j += 3) {
      const dx = o.px[j] - x;
      const dz = o.pz[j] - z;
      if (dx * dx + dz * dz < (rad + 17) * (rad + 17)) return false;
    }
  }
  for (const r of rails) {
    const { x0, z0, x1, z1 } = r.seg;
    const ex = x1 - x0;
    const ez = z1 - z0;
    const l2 = ex * ex + ez * ez || 1;
    let t = ((x - x0) * ex + (z - z0) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x0 + ex * t - x;
    const dz = z0 + ez * t - z;
    if (dx * dx + dz * dz < (rad + 6) * (rad + 6)) return false;
  }
  return true;
}

/**
 * Geometry for a perpendicular rail line (level crossing or elevated line).
 * Returns Map<key, BufferGeometry>.
 */
export function buildRailGeometry(rail) {
  const b = new GeoBuilder();
  const { ax, az, tx, tz, half, cx, cz } = rail;
  const isGround = rail.kind === 'ground';
  const deck = isGround ? 0 : rail.deckY;
  const y0 = isGround ? rail.cy : rail.deckY;

  if (isGround) {
    b.box('ballast', cx, y0 + 0.03, cz, half, 0.05, 2.9, ax, az, C.ballast);
    for (const o of [-0.72, 0.72]) {
      b.box('metal', cx + tx * o, y0 + 0.14, cz + tz * o, half, 0.08, 0.06, ax, az, C.steel);
    }
    for (let u = -half; u <= half; u += 2.5) {
      b.box('concrete', cx + ax * u, y0 + 0.07, cz + az * u, 0.12, 0.05, 1.5, ax, az, C.tie);
    }
  } else {
    // elevated deck with two rails on top (monorail: a single white beam instead)
    if (rail.kind === 'air-mono') b.box('metal', cx, deck - 0.5, cz, half, 0.6, 0.6, ax, az, [0.9, 0.92, 0.94]);
    else b.box('concrete', cx, deck - 0.6, cz, half, 0.45, 2.4, ax, az, [0.82, 0.82, 0.8]);
    for (const o of [-0.72, 0.72]) {
      b.box('metal', cx + tx * o, deck + 0.1, cz + tz * o, half, 0.08, 0.06, ax, az, C.steel);
    }
    for (let u = -half; u <= half; u += 2.5) {
      b.box('concrete', cx + ax * u, deck - 0.1, cz + az * u, 0.12, 0.05, 1.5, ax, az, C.tie);
    }
    // pylons outside the road corridor
    for (let u = -half + 10; u <= half - 10; u += 30) {
      if (Math.abs(u) < 26) continue;
      const top = deck - 0.9;
      b.box('concrete', cx + ax * u, top / 2, cz + az * u, 1.0, top / 2, 1.0, tx, tz, C.pylon);
    }
  }
  return b.build();
}
