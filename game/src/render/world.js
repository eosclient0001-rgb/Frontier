// Keeps three.js objects in sync with the logic each frame. Sections are built lazily
// (a few per frame) and disposed when pruned behind the car.
import * as THREE from 'three';
import { buildRoadGeometry, buildRailGeometry } from './sectionBuilder.js';
import { TrafficView, createTrain, TRAIN_PALETTES } from './vehicles.js';
import { ROAD, TRAIN_H } from '../world/constants.js';
import { makeRng } from '../core/rng.js';
import { CROSS_TRAIN_LEN } from '../sim/trains.js';

const MAT_KEYS = ['road', 'concrete', 'glass', 'metal', 'emissive', 'foliage', 'ballast', 'tie'];

function materialFor(mats, key) {
  switch (key) {
    case 'road':
    case 'ballast':
      return mats.road;
    case 'concrete':
    case 'tie':
      return mats.concrete;
    case 'glass':
      return mats.glass;
    case 'metal':
      return mats.metal;
    case 'emissive':
      return mats.emissive;
    case 'foliage':
      return mats.foliage;
    default:
      return mats.concrete;
  }
}

function meshesFrom(geoMap, mats, castShadow = true) {
  const group = new THREE.Group();
  for (const [key, geo] of geoMap) {
    if (!MAT_KEYS.includes(key)) continue;
    const mesh = new THREE.Mesh(geo, materialFor(mats, key));
    mesh.castShadow = castShadow && key !== 'emissive';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}

export class WorldView {
  constructor(scene, mats, cm) {
    this.scene = scene;
    this.mats = mats;
    this.cm = cm;
    this.sections = new Map(); // id -> group
    this.pending = [];
    this.rails = new Map(); // id -> { group, gates: [{pivot, arm}] }
    this.trafficView = new TrafficView(scene, cm, 84);
    this.trainGroups = new Map(); // key -> group
    this.gateMeshes = [];
    this.stats = { sections: 0, rails: 0 };
  }

  _buildSection(sec, route) {
    const rng = makeRng(sec.id * 7919 + 17);
    const geoMap = buildRoadGeometry(sec, route, rng);
    const group = meshesFrom(geoMap, this.mats);
    this.scene.add(group);
    this.sections.set(sec.id, group);
  }

  _buildRail(rail) {
    const geoMap = buildRailGeometry(rail);
    const group = meshesFrom(geoMap, this.mats);
    const gates = [];
    if (rail.kind === 'ground') {
      for (const g of rail.gates) {
        const sec = rail.section;
        const p = sec.point(g.s, ROAD.OUTER + 0.6, 0);
        const X = new THREE.Vector3(p.rx, 0, p.rz);
        const Y = new THREE.Vector3(0, 1, 0);
        const Z = new THREE.Vector3().crossVectors(X, Y);
        const basis = new THREE.Matrix4().makeBasis(X, Y, Z);
        const pivot = new THREE.Group();
        pivot.position.set(p.x, p.y + 1.15, p.z);
        pivot.setRotationFromMatrix(basis);
        const arm = new THREE.Group();
        const L = ROAD.OUTER + 0.4;
        const armBar = new THREE.Mesh(new THREE.BoxGeometry(0.16, L, 0.16), this.cm.trafficPaint);
        armBar.position.set(0, L / 2, 0);
        arm.add(armBar);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, L * 0.12, 0.18), this.cm.tail);
        stripe.position.set(0, L * 0.06, 0);
        arm.add(stripe);
        pivot.add(arm);
        // post
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.15, 0.22), this.mats.metal);
        post.position.set(0, -0.575, 0);
        pivot.add(post);
        // lamp head (flashes only in spirit: static red emissive)
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), this.mats.emissive);
        lamp.position.set(0.2, 0.6, 0);
        pivot.add(lamp);
        group.add(pivot);
        gates.push({ gate: g, arm, pivot, sec });
      }
    }
    this.scene.add(group);
    this.rails.set(rail.id, { group, gates });
  }

  /** Drop every built object (used when a new run starts with a fresh route). */
  clear() {
    for (const group of this.sections.values()) {
      this.scene.remove(group);
      disposeGroup(group);
    }
    for (const entry of this.rails.values()) {
      this.scene.remove(entry.group);
      disposeGroup(entry.group);
    }
    for (const g of this.trainGroups.values()) {
      this.scene.remove(g);
      disposeGroup(g);
    }
    this.sections.clear();
    this.rails.clear();
    this.trainGroups.clear();
    this.pending = [];
  }

  /** Called every frame after the logic has been advanced. */
  sync(route, playerDist, crossTrains, agents) {
    // sections: queue new, remove pruned, build a few per frame
    for (const sec of route.sections) {
      if (!this.sections.has(sec.id) && !this.pending.includes(sec)) this.pending.push(sec);
    }
    this.pending = this.pending.filter((s) => !s.removed);
    this.pending.sort((a, b) => Math.abs(a.dist0 - playerDist) - Math.abs(b.dist0 - playerDist));
    let budget = this.sections.size < 4 ? 8 : 2;
    while (budget-- > 0 && this.pending.length) {
      const sec = this.pending.shift();
      this._buildSection(sec, route);
    }
    for (const [id, group] of this.sections) {
      if (!route.byId.has(id)) {
        this.scene.remove(group);
        disposeGroup(group);
        this.sections.delete(id);
      }
    }

    // rails
    for (const rail of route.rails) {
      if (!this.rails.has(rail.id) && !rail.section.removed) this._buildRail(rail);
    }
    for (const [id, entry] of this.rails) {
      if (!route.rails.some((r) => r.id === id)) {
        this.scene.remove(entry.group);
        disposeGroup(entry.group);
        this.rails.delete(id);
      }
    }
    for (const entry of this.rails.values()) {
      for (const gg of entry.gates) {
        // arms swing from vertical (open) to horizontal across the road (closed)
        gg.arm.rotation.z = gg.gate.angle * (Math.PI / 2);
      }
    }
    this.stats.sections = this.sections.size;
    this.stats.rails = this.rails.size;

    // crossing trains
    const alive = new Set();
    for (const t of crossTrains.trains) {
      const key = 'c' + t.id;
      alive.add(key);
      let g = this.trainGroups.get(key);
      if (!g) {
        const pal = t.kind === 'mono' ? TRAIN_PALETTES.mono : TRAIN_PALETTES.heavy;
        g = createTrain(t.kind === 'mono' ? 'mono' : 'heavy', CROSS_TRAIN_LEN, t.kind === 'mono' ? 2.8 : 3.0, t.kind === 'mono' ? 3.0 : 3.6, pal, this.mats);
        this.scene.add(g);
        this.trainGroups.set(key, g);
      }
      const pose = crossTrains.pose(t);
      const lift = t.kind === 'mono' ? 1.6 : t.rail.kind === 'ground' ? TRAIN_H / 2 : 1.8;
      g.position.set(pose.x, pose.y + lift, pose.z);
      g.rotation.set(0, Math.atan2(pose.ax, pose.az), 0);
    }

    // agent trains (monorail + parallel rail)
    for (const a of agents) {
      if (a.kind === 'car') continue;
      const key = 'a' + a.id;
      alive.add(key);
      let g = this.trainGroups.get(key);
      if (!g) {
        const pal = a.kind === 'mono' ? TRAIN_PALETTES.mono : TRAIN_PALETTES.par;
        g = createTrain(a.kind, a.len, a.wid, a.kind === 'mono' ? 2.6 : 3.7, pal, this.mats);
        this.scene.add(g);
        this.trainGroups.set(key, g);
      }
      g.position.set(a.x, a.y, a.z);
      g.rotation.set(0, Math.atan2(a.tx, a.tz), 0);
    }
    for (const [key, g] of this.trainGroups) {
      if (!alive.has(key)) {
        this.scene.remove(g);
        disposeGroup(g);
        this.trainGroups.delete(key);
      }
    }

    // traffic
    this.trafficView.update(agents.filter((a) => a.kind === 'car'));
  }
}
