// Animated trains on the railway and street-tram networks.
//
//   mainline  - coaches and a locomotive on the rail heads, one consist per track
//   monorail  - cars hang from the beam: their datum is the beam underside, so they sit beneath the deck
//   tram      - street cars run on the grooved tram lane, wheels in the flangeways
//
// Routes come from road/routes.js (a walk over the graph), so trains follow switches and junctions
// automatically. Shuttle routes reverse at their ends after a short dwell; loops run round.
import * as THREE from 'three';
import { vehicleLibrary } from './propsLib.js';
import { buildRoutes, sampleRoute } from '../road/routes.js';
import { getProfile, layout } from '../road/profiles.js';

const TRACK_OFFSET = 2.1;      // half of the 4.2 m mainline track spacing
const RAIL_TOP = 0.42;         // rail head above the track bed datum
const MONO_DATUM = -1.6;       // monorail car datum (beam underside) relative to the deck
const TRAM_DATUM = 0.02;       // tram wheels just above the carriageway
const CAR_GAP = 0.6;
const SPEED_SCALE = 0.6;       // km/h → visual m/s, slightly slower than the stated line speed
const DWELL = 4;               // seconds at each end of a shuttle route
const MAX_CONSISTS = 80;
const REBUILD_DELAY = 0.25;

const FAMILY = {
  mainline: { datum: RAIL_TOP, lead: 'mainLoco', coach: 'mainCar', coaches: 4 },
  monorail: { datum: MONO_DATUM, lead: 'monoCar', coach: 'monoCar', coaches: 2 },
  tram: { datum: TRAM_DATUM, lead: 'tramCar', coach: 'tramCar', coaches: 1 },
};

export class TrainSystem {
  constructor(scene, PM) {
    this.PM = PM;
    this.lib = vehicleLibrary();
    this.group = new THREE.Group();
    this.group.name = 'trains';
    scene.add(this.group);
    this.matCache = new Map();
    this.consists = [];
    this.routes = [];
    this.net = null;
    this.dirty = false;
    this.timer = 0;
    this.pose = {};
    this.pa = {}; this.pb = {};
  }

  setNetwork(net) { this.net = net; this.dirty = true; this.timer = 0; }
  // called after edits: rebuild the routes shortly (edits arrive in bursts while dragging)
  schedule() { this.dirty = true; }
  setVisible(v) { this.group.visible = v; }

  // ---------------------------------------------------------------- routes and consists
  rebuild() {
    this.dirty = false;
    this.clear();
    const net = this.net; if (!net) return;
    const tramLanes = e => layout(getProfile(e)).lanes.filter(l => l.type === 'tram');
    const families = [
      ['mainline', buildRoutes(net, { accept: e => getProfile(e).railKind === 'mainline' })],
      ['monorail', buildRoutes(net, { accept: e => getProfile(e).railKind === 'monorail' })],
      ['tram', buildRoutes(net, {
        accept: e => tramLanes(e).length > 0,
        lateral: (e, fwd) => {
          const lanes = tramLanes(e), want = fwd ? 1 : -1;
          const l = lanes.find(x => x.dir === want) || lanes.find(x => !x.dir) || lanes[0];
          return (l.o0 + l.o1) / 2;
        },
      })],
    ];
    for (const [fam, routes] of families) {
      for (const route of routes) {
        if (this.consists.length >= MAX_CONSISTS) break;
        this.routes.push(route);
        this.spawn(fam, route);
      }
    }
  }

  // One consist per track: a double-track mainline runs a train on each track, while single-track
  // lines (monorail, branch, tram) carry one train, so shuttles never meet on the same rail.
  spawn(fam, route) {
    const F = FAMILY[fam];
    const minLen = fam === 'tram' ? 150 : 200;
    if (route.length < minLen && !route.loop) return;
    const tracks = fam === 'mainline' ? (getProfile(this.net.edges.get(route.edges[0])).tracks || 1) : 1;
    const count = tracks >= 2 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const lat = tracks >= 2 ? (i ? -TRACK_OFFSET : TRACK_OFFSET) : 0;
      const names = [F.lead, ...Array(F.coaches).fill(F.coach)];
      const cars = names.map(k => this.makeCar(k));
      const c = {
        fam, route, lat, cars, lens: cars.map(x => x.userData.len),
        s: (i ? 0.7 : 0.3) * route.length, dir: i ? -1 : 1,
        speed: route.speed / 3.6 * SPEED_SCALE, dwell: 0.5 + i * 1.5,
      };
      this.consists.push(c);
      for (const car of cars) this.group.add(car);
    }
  }

  makeCar(key) {
    const def = this.lib[key];
    const g = new THREE.Group();
    g.userData.len = def.len;
    for (const { mat, geo } of def.parts) {
      const m = new THREE.Mesh(geo, this.material(mat));
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    g.visible = false;
    return g;
  }
  material(mat) {
    if (!this.matCache.has(mat)) this.matCache.set(mat, this.PM[mat] || this.PM.vcol);
    return this.matCache.get(mat);
  }
  clear() {
    for (const c of this.consists) for (const car of c.cars) this.group.remove(car);
    this.consists = []; this.routes = [];
  }

  // ---------------------------------------------------------------- animation
  update(dt) {
    if (this.dirty) { this.timer += dt; if (this.timer > REBUILD_DELAY) { this.timer = 0; this.rebuild(); } }
    if (!this.group.visible) return;
    for (const c of this.consists) this.step(c, dt);
  }

  step(c, dt) {
    const L = c.route.length;
    if (c.dwell > 0) c.dwell -= dt;
    else {
      c.s += c.dir * c.speed * dt;
      if (c.route.loop) c.s = ((c.s % L) + L) % L;
      else if (c.s >= L) { c.s = L; c.dir = -1; c.dwell = DWELL; }
      else if (c.s <= 0) { c.s = 0; c.dir = 1; c.dwell = DWELL; }
    }
    const fam = FAMILY[c.fam];
    let back = 0;
    for (let k = 0; k < c.cars.length; k++) {
      const car = c.cars[k], len = c.lens[k];
      const sc = c.s - c.dir * (back + len / 2);
      back += len + CAR_GAP;
      const inside = c.route.loop || (sc >= 0 && sc <= L);
      car.visible = inside;
      if (!inside) continue;
      this.placeCar(car, c, sc, fam.datum);
    }
  }

  placeCar(car, c, s, datum) {
    const r = c.route, p = sampleRoute(r, s, this.pose);
    const ahead = sampleRoute(r, s + 0.8, this.pa), behind = sampleRoute(r, s - 0.8, this.pb);
    const hx = p.tx * c.dir, hz = p.tz * c.dir;
    const yaw = Math.atan2(-hz, hx);
    const slope = (ahead.y - behind.y) / 1.6 * c.dir;
    const pitch = Math.atan(slope);
    // lateral: route normal (-tz, tx) times base lane offset plus the consist's track offset
    const off = p.b + c.lat;
    car.position.set(p.x - p.tz * off, p.y + datum, p.z + p.tx * off);
    car.rotation.set(0, yaw, pitch, 'YZX');
  }
}
