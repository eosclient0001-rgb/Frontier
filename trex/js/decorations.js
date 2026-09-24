/**
 * decorations.js — visible cybernetic study hardware for the articulated rig.
 *
 * These are deliberately separate from the fossil proxy meshes: the antennae
 * are attached to the skull, the hydraulic cylinders read the live mandible
 * transform, and the three electrical cables are simulated as small Verlet
 * ropes between a throat bus and an abdominal/stomach bus.
 */

import {
  Group, Mesh, Object3D, CylinderGeometry, SphereGeometry, TorusGeometry,
  MeshStandardMaterial, Vector3,
} from 'three';
import { tubeGeometry } from './geo.js';

const UP = new Vector3(0, 1, 0);
const _a = new Vector3(), _b = new Vector3(), _d = new Vector3();

function material(color, opts = {}) {
  return new MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.35,
    metalness: opts.metalness ?? 0.2,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

function setBetween(mesh, from, to, radius = null) {
  _d.subVectors(to, from);
  const len = Math.max(1e-5, _d.length());
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, _d.normalize());
  if (radius !== null) mesh.scale.set(radius, len / (mesh.userData.baseLength || 1), radius);
  else mesh.scale.set(1, len / (mesh.userData.baseLength || 1), 1);
  return mesh;
}

function makeCylinder(radius, length, mat, radialSegments = 10) {
  const g = new CylinderGeometry(radius, radius, length, radialSegments, 1, false);
  const m = new Mesh(g, mat);
  m.castShadow = true;
  m.userData.baseLength = length;
  m.userData.decoration = true;
  return m;
}

function worldOf(parent, local, out = new Vector3()) {
  parent.updateMatrixWorld(true);
  return out.copy(local).applyMatrix4(parent.matrixWorld);
}

function addLocalRod(parent, a, b, radius, mat) {
  const rod = makeCylinder(radius, a.distanceTo(b), mat, 9);
  rod.position.copy(a).add(b).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  parent.add(rod);
  return rod;
}

function addLocalRing(parent, at, direction, radius, tube, mat) {
  const ring = new Mesh(new TorusGeometry(radius, tube, 7, 18), mat);
  ring.position.copy(at);
  ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), direction.clone().normalize());
  ring.castShadow = true;
  ring.userData.decoration = true;
  parent.add(ring);
  return ring;
}

function buildAntennas(skel) {
  const group = new Group();
  group.name = 'skull-wifi-receivers';
  group.userData.decoration = true;
  const rodMat = material(0x26313a, { metalness: 0.82, roughness: 0.24 });
  const collarMat = material(0x8c9aa1, { metalness: 0.76, roughness: 0.26 });
  const tipMat = material(0x6fe9ff, { metalness: 0.2, roughness: 0.18, emissive: 0x0a92b0, emissiveIntensity: 1.8 });

  // Skull frame: -Z is anterior. These bases sit just anterior to each orbit,
  // outside the cheek wall, and the receivers rake up and forward.
  for (const side of [-1, 1]) {
    const base = new Vector3(side * 0.285, 0.19, -0.69);
    const bend = new Vector3(side * 0.31, 0.36, -0.75);
    const tip = new Vector3(side * 0.33, 0.56, -0.84);
    const antenna = new Group();
    antenna.name = `wifi-antenna.${side > 0 ? 'R' : 'L'}`;
    antenna.userData.decoration = true;
    addLocalRod(antenna, base, bend, 0.018, rodMat);
    addLocalRod(antenna, bend, tip, 0.013, rodMat);
    addLocalRing(antenna, base.clone().add(new Vector3(0, 0.015, 0)), bend.clone().sub(base), 0.048, 0.009, collarMat);
    // Two little signal bands read as a receiver rather than a random horn.
    const signalDir = tip.clone().sub(bend).normalize();
    addLocalRing(antenna, bend.clone().lerp(tip, 0.34), signalDir, 0.038, 0.006, tipMat);
    addLocalRing(antenna, bend.clone().lerp(tip, 0.68), signalDir, 0.030, 0.005, tipMat);
    const tipMesh = new Mesh(new SphereGeometry(0.027, 10, 6), tipMat);
    tipMesh.position.copy(tip);
    tipMesh.castShadow = true;
    tipMesh.userData.decoration = true;
    antenna.add(tipMesh);
    group.add(antenna);
  }
  // Attach as a skull child so the receiver hardware turns with the head,
  // while the returned group remains discoverable by the scene owner.
  skel.head.add(group);
  return group;
}

function buildActuators(skel, root) {
  const barrelMat = material(0x34434c, { metalness: 0.88, roughness: 0.22 });
  const pistonMat = material(0xb9c5c8, { metalness: 0.94, roughness: 0.16 });
  const sealMat = material(0xd68b2d, { metalness: 0.7, roughness: 0.24, emissive: 0x3c1600, emissiveIntensity: 0.25 });
  const actuators = [];
  for (const side of [-1, 1]) {
    const barrel = makeCylinder(0.040, 0.50, barrelMat, 12);
    const piston = makeCylinder(0.018, 0.50, pistonMat, 10);
    const baseSeal = new Mesh(new TorusGeometry(0.050, 0.010, 8, 16), sealMat);
    const rodSeal = new Mesh(new TorusGeometry(0.028, 0.007, 8, 16), sealMat);
    for (const m of [baseSeal, rodSeal]) { m.castShadow = true; m.userData.decoration = true; }
    root.add(barrel, piston, baseSeal, rodSeal);
    actuators.push({ side, barrel, piston, baseSeal, rodSeal });
  }

  return {
    actuators,
    update() {
      // Head-side clevis and jaw-side clevis are in their respective live
      // frames; the piston visibly changes length as the mandible rotates.
      for (const a of actuators) {
        const s = a.side;
        const base = worldOf(skel.head, new Vector3(s * 0.34, -0.20, -0.08), _a).clone();
        const jaw = worldOf(skel.jaw, new Vector3(s * 0.31, -0.03, -0.61), _b).clone();
        const pistonPoint = base.clone().lerp(jaw, 0.56);
        setBetween(a.barrel, base, pistonPoint);
        setBetween(a.piston, pistonPoint, jaw);
        a.baseSeal.position.copy(base);
        a.baseSeal.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), pistonPoint.clone().sub(base).normalize());
        a.rodSeal.position.copy(pistonPoint);
        a.rodSeal.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), jaw.clone().sub(pistonPoint).normalize());
      }
    },
  };
}

function makeWire(def, root) {
  const n = 11;
  const points = [];
  const previous = [];
  let geometry = null;
  const mat = new MeshStandardMaterial({
    color: def.color,
    emissive: def.color,
    emissiveIntensity: def.emissive,
    roughness: 0.30,
    metalness: 0.12,
  });
  const mesh = new Mesh(new SphereGeometry(def.radius, 6, 4), mat);
  mesh.userData.decoration = true;
  root.add(mesh);

  const top = new Object3D();
  top.name = `throat-wire-terminal.${def.name}`;
  top.position.copy(def.topPos);
  def.top.add(top);
  const bottom = new Object3D();
  bottom.name = `stomach-wire-terminal.${def.name}`;
  bottom.position.copy(def.bottomPos);
  def.bottom.add(bottom);

  const wire = {
    name: def.name, color: def.color, points, previous, mesh, top, bottom,
    restLength: 0, time: def.phase, radius: def.radius,
    reset() {
      const a = top.getWorldPosition(new Vector3());
      const b = bottom.getWorldPosition(new Vector3());
      points.length = 0; previous.length = 0;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const p = a.clone().lerp(b, u);
        p.x += def.sag * Math.sin(Math.PI * u) + def.lateral * Math.sin(Math.PI * u * 0.8);
        p.y -= def.drop * Math.sin(Math.PI * u);
        points.push(p);
        previous.push(p.clone());
      }
      this.restLength = 0;
      for (let i = 1; i < points.length; i++) this.restLength += points[i].distanceTo(points[i - 1]);
      this.restLength /= n - 1;
    },
    update(dt, elapsed, anim) {
      const a = top.getWorldPosition(new Vector3());
      const b = bottom.getWorldPosition(new Vector3());
      if (!points.length) this.reset();
      const step = Math.min(0.04, Math.max(0.001, dt));
      // Verlet integration: cables have inertia, gravity, and a very small
      // body-motion/wind term so they lag the turning skeleton naturally.
      for (let i = 1; i < n - 1; i++) {
        const p = points[i], old = previous[i];
        const vx = (p.x - old.x) * 0.91, vy = (p.y - old.y) * 0.91, vz = (p.z - old.z) * 0.91;
        previous[i].copy(p);
        p.x += vx + Math.sin(elapsed * 1.7 + i * 0.8 + this.time) * 0.018 * step * (1 + anim.turnBlend);
        p.y += vy - 2.7 * step * step;
        p.z += vz + Math.cos(elapsed * 1.25 + i * 0.54 + this.time) * 0.012 * step;
        if (p.y < 0.12) { p.y = 0.12; previous[i].y = p.y + vy * 0.2; }
      }
      // Several short constraint passes are stable even while the throat and
      // stomach anchors move abruptly during a turn or bite.
      for (let pass = 0; pass < 7; pass++) {
        points[0].copy(a); points[n - 1].copy(b);
        for (let i = 0; i < n - 1; i++) {
          const p = points[i], q = points[i + 1];
          const d = q.clone().sub(p);
          const len = Math.max(1e-5, d.length());
          const correction = (len - this.restLength) / len;
          if (i === 0) q.addScaledVector(d, -correction);
          else if (i + 1 === n - 1) p.addScaledVector(d, correction);
          else { p.addScaledVector(d, correction * 0.5); q.addScaledVector(d, -correction * 0.5); }
        }
      }
      points[0].copy(a); points[n - 1].copy(b);
      if (geometry) geometry.dispose();
      geometry = tubeGeometry(points, points.map((_, i) => {
        const r = this.radius * (i === 0 || i === n - 1 ? 1.25 : 1);
        return [r, r];
      }), { radialSegments: 6, up0: new Vector3(0, 1, 0) });
      mesh.geometry = geometry;
      mesh.name = `electrical-wire.${this.name}`;
    },
  };
  wire.reset();
  return wire;
}

function buildWires(skel, root) {
  // The near-side run is offset for readability; all three terminate at the
  // same throat/stomach systems but have independent slack and inertia.
  const throat = skel.neck[Math.min(4, skel.neck.length - 1)];
  const stomach = skel.trunk[Math.min(5, skel.trunk.length - 1)];
  const defs = [
    { name: 'main-yellow', color: 0xffd21f, emissive: 0.50, radius: 0.018, phase: 0.0, sag: -0.18, drop: 0.17, lateral: -0.08, top: throat, topPos: new Vector3(-0.34, 0.00, -0.04), bottom: stomach, bottomPos: new Vector3(-0.58, -0.14, -0.43) },
    { name: 'orange', color: 0xff7628, emissive: 0.35, radius: 0.014, phase: 1.7, sag: -0.28, drop: 0.23, lateral: -0.18, top: throat, topPos: new Vector3(-0.30, 0.04, -0.02), bottom: stomach, bottomPos: new Vector3(-0.52, -0.19, -0.48) },
    { name: 'red', color: 0xe83b35, emissive: 0.40, radius: 0.013, phase: 3.2, sag: -0.23, drop: 0.14, lateral: 0.12, top: throat, topPos: new Vector3(-0.27, -0.04, -0.06), bottom: stomach, bottomPos: new Vector3(-0.47, -0.10, -0.52) },
  ];
  return defs.map((def) => makeWire(def, root));
}

export function buildDecorations(skel) {
  skel.rig.updateMatrixWorld(true);
  const group = new Group();
  group.name = 'cybernetic-decorations';
  group.userData.decoration = true;
  const antennae = buildAntennas(skel);
  const actuators = buildActuators(skel, group);
  const wires = buildWires(skel, group);
  let elapsed = 0;
  return {
    group,
    antennae,
    actuators: actuators.actuators,
    wires,
    update(dt, anim) {
      elapsed += Math.max(0, dt);
      actuators.update();
      for (const wire of wires) wire.update(dt, elapsed, anim);
    },
  };
}
