// Visual models: the player car, instanced traffic, and trains (streets, rails, monorail).
// Convention: all models face +Z; the caller sets rotation.y = PI/2 - yaw.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export function makeCarMaterials(envMap) {
  return {
    paint: new THREE.MeshStandardMaterial({ color: 0xe9ebee, metalness: 0.55, roughness: 0.26, envMap, envMapIntensity: 1.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x141c24, metalness: 0.4, roughness: 0.08, envMap, envMapIntensity: 1.2 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.92, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.28, envMap }),
    accent: new THREE.MeshStandardMaterial({ color: 0x2f7f86, metalness: 0.5, roughness: 0.35, envMap }),
    headlight: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.9, 1.8) }),
    tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.12, 0.08) }),
    trafficPaint: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.3, envMap, envMapIntensity: 1.0 }),
  };
}

/** The car you drive: origin at the road surface, centred, facing +Z. */
export function createPlayerCar(cm) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.62, 4.5, 4, 0.22), cm.paint);
  body.position.set(0, 0.55, 0);
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.56, 2.25, 4, 0.2), cm.glass);
  cabin.position.set(0, 1.07, -0.2);
  cabin.castShadow = true;
  g.add(cabin);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.05, 3.2), cm.accent);
  stripe.position.set(0, 0.32, 0);
  g.add(stripe);
  // spoiler
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.34), cm.paint);
  spoiler.position.set(0, 1.0, -2.05);
  g.add(spoiler);
  for (const sx of [-0.6, 0.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), cm.paint);
    post.position.set(sx, 0.85, -2.0);
    g.add(post);
  }
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 22);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.32, 16);
  rimGeo.rotateZ(Math.PI / 2);
  for (const sx of [-0.92, 0.92]) {
    for (const z of [-1.42, 1.42]) {
      const w = new THREE.Mesh(wheelGeo, cm.tyre);
      w.position.set(sx, 0.36, z);
      w.castShadow = true;
      g.add(w);
      const r = new THREE.Mesh(rimGeo, cm.rim);
      r.position.set(sx, 0.36, z);
      g.add(r);
    }
  }
  for (const sx of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), cm.headlight);
    hl.position.set(sx, 0.62, 2.27);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.05), cm.tail);
    tl.position.set(sx, 0.62, -2.27);
    g.add(tl);
  }
  return g;
}

/** Instanced traffic: one draw call for every car body and one for every cabin. */
export class TrafficView {
  constructor(scene, cm, max = 80) {
    const body = new RoundedBoxGeometry(1.9, 0.9, 4.5, 3, 0.3);
    body.translate(0, 0.55, 0);
    const cab = new RoundedBoxGeometry(1.6, 0.6, 2.2, 3, 0.25);
    cab.translate(0, 1.2, -0.2);
    this.body = new THREE.InstancedMesh(body, cm.trafficPaint, max);
    this.cab = new THREE.InstancedMesh(cab, cm.glass, max);
    this.body.castShadow = true;
    this.cab.castShadow = true;
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cab.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.count = 0;
    this.cab.count = 0;
    scene.add(this.body, this.cab);
    this.dummy = new THREE.Object3D();
    this.max = max;
    this.color = new THREE.Color();
  }

  update(cars) {
    const n = Math.min(cars.length, this.max);
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const d = this.dummy;
      d.position.set(c.x, c.y - 0.5, c.z);
      d.rotation.set(0, Math.PI / 2 - c.yaw, 0);
      d.updateMatrix();
      this.body.setMatrixAt(i, d.matrix);
      this.cab.setMatrixAt(i, d.matrix);
      this.body.setColorAt(i, this.color.setRGB(c.color[0], c.color[1], c.color[2]));
    }
    this.body.count = n;
    this.cab.count = n;
    this.body.instanceMatrix.needsUpdate = true;
    this.cab.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}

/** Build a train as a row of rounded cars along +Z, centred on the origin. */
export function createTrain(kind, len, width, height, palette, mats) {
  const g = new THREE.Group();
  const carLen = kind === 'mono' ? 12 : 24;
  const n = Math.max(1, Math.round(len / carLen));
  const cl = len / n;
  const bodyMat = new THREE.MeshStandardMaterial({ color: palette.body, metalness: 0.35, roughness: 0.32, envMap: mats.envMap, envMapIntensity: 0.9 });
  const bandMat = new THREE.MeshStandardMaterial({ color: palette.band, metalness: 0.4, roughness: 0.4, envMap: mats.envMap });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.4, roughness: 0.1, envMap: mats.envMap });
  const geo = new RoundedBoxGeometry(width, height, cl - 0.8, 3, 0.35);
  const bandGeo = new THREE.BoxGeometry(width + 0.02, 0.32, cl - 0.9);
  const winGeo = new THREE.BoxGeometry(width + 0.02, height * 0.3, cl - 1.6);
  for (let i = 0; i < n; i++) {
    const z = -len / 2 + cl * (i + 0.5);
    const car = new THREE.Mesh(geo, bodyMat);
    car.position.set(0, 0, z);
    car.castShadow = true;
    g.add(car);
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, -height * 0.2, z);
    g.add(band);
    const win = new THREE.Mesh(winGeo, windowMat);
    win.position.set(0, height * 0.16, z);
    g.add(win);
  }
  // front/back light bars
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.6, 1.4) });
  for (const sz of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.2, 0.08), lightMat);
    l.position.set(0, 0.1, sz * (len / 2 + 0.02));
    g.add(l);
  }
  return g;
}

export const TRAIN_PALETTES = {
  heavy: { body: 0xd8dde2, band: 0x3b7d80 },
  mono: { body: 0xf2f4f6, band: 0x7ea6b8 },
  par: { body: 0xe4e7ea, band: 0x4b6f7e },
};
