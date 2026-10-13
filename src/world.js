import * as THREE from 'three';
import {
  TRACK_HALF, clamp, hash, frameAt, pointAt, surfaceYAt, splitAt, branchParams,
  crossingAt, CROSS_START, CROSS_PERIOD, nextSplit, nextCrossing, headingAt, trackYSlope,
} from './trackMath.js';
import { trackTexture, buildingTexture, cityTexture, padTexture, signTexture } from './textures.js';
import { buildCarModel } from './car.js';

const CHUNK_LEN = 24, SUB = 4, STEP = CHUNK_LEN / SUB, CHUNKS = 46;

function rng(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

// branches used for GEOMETRY — outside a split the road is drawn as two halves
// that meet at the centreline, so fork geometry is perfectly continuous.
function geomBranches(s) {
  const b = branchParams(s);
  if (b) return [b.left, b.right];
  return [{ offset: -TRACK_HALF / 2, half: TRACK_HALF / 2, yOff: 0 }, { offset: TRACK_HALF / 2, half: TRACK_HALF / 2, yOff: 0 }];
}
function surfPoint(s, u, lift = 0) {
  const p = pointAt(s, u);
  return new THREE.Vector3(p.x, p.y + lift, p.z);
}

function quad(pos, uv, idx, a, b, c, d, uva, uvb, uvc, uvd) {
  const base = pos.length / 3;
  pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
  uv.push(...uva, ...uvb, ...uvc, ...uvd);
  idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
}
function geoFrom(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// sleek modern monorail train, nose at +Z
export function buildTrain(body = 0xf2f4f6, stripe = 0x2266aa) {
  const train = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: body, metalness: 0.35, roughness: 0.35 });
  const band = new THREE.MeshStandardMaterial({ color: stripe, metalness: 0.4, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x16242f, metalness: 0.9, roughness: 0.15 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(box, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; train.add(m); return m; };
  // locomotive + two coaches, built nose-first along +Z
  add(white, 0, 1.7, 6, 3.0, 2.9, 11); add(band, 0, 2.1, 6, 3.06, 0.65, 11.02);
  add(glass, 0, 2.35, 11.4, 2.6, 1.0, 0.5);
  add(white, 0, 1.45, 11.6, 2.2, 1.7, 1.6); // nose taper block
  for (const z of [-1.5, -9.5]) { add(white, 0, 1.7, z, 3.0, 2.9, 7); add(band, 0, 2.1, z, 3.06, 0.65, 7.02); add(glass, 0, 2.5, z, 3.02, 0.7, 5.6); }
  add(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe9b0, emissiveIntensity: 2 }), 0, 1.5, 12.45, 1.6, 0.35, 0.1);
  return train;
}

class Chunk {
  constructor(scene, mats) {
    this.index = 0; this.mats = mats;
    this.group = new THREE.Group(); scene.add(this.group);
    this.track = new THREE.Mesh(new THREE.BufferGeometry(), mats.track); this.track.receiveShadow = true;
    this.skirt = new THREE.Mesh(new THREE.BufferGeometry(), mats.dark);
    this.barrier = new THREE.Mesh(new THREE.BufferGeometry(), mats.barrier);
    this.accent = new THREE.Mesh(new THREE.BufferGeometry(), mats.accent);
    this.beams = new THREE.Mesh(new THREE.BufferGeometry(), mats.beam);
    this.buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.building, 16);
    this.buildings.frustumCulled = false;
    this.buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.6, 7), mats.tree, 10);
    this.trees.frustumCulled = false;
    this.pillars = [];
    for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.concrete); p.castShadow = true; this.pillars.push(p); this.group.add(p); }
    this.group.add(this.track, this.skirt, this.barrier, this.accent, this.beams, this.buildings, this.trees);
  }

  build(index) {
    this.index = index;
    const s0 = index * CHUNK_LEN;
    const stations = [];
    for (let i = 0; i <= SUB; i++) stations.push(s0 + i * STEP);

    // ── track surface (one or two fork branches)
    {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i < SUB; i++) {
        const sa = stations[i], sb = stations[i + 1];
        const ba = geomBranches(sa), bb = geomBranches(sb);
        for (let b = 0; b < 2; b++) {
          const aL = surfPoint(sa, ba[b].offset - ba[b].half), aR = surfPoint(sa, ba[b].offset + ba[b].half);
          const bL = surfPoint(sb, bb[b].offset - bb[b].half), bR = surfPoint(sb, bb[b].offset + bb[b].half);
          quad(pos, uv, idx, aL, aR, bL, bR,
            [(ba[b].offset - ba[b].half) / 26 + 0.5, sa / 12], [(ba[b].offset + ba[b].half) / 26 + 0.5, sa / 12],
            [(bb[b].offset - bb[b].half) / 26 + 0.5, sb / 12], [(bb[b].offset + bb[b].half) / 26 + 0.5, sb / 12]);
        }
      }
      this.track.geometry.dispose(); this.track.geometry = geoFrom(pos, uv, idx);
    }
    // ── edge walls, skirts, accents — edges follow the fork when it opens
    {
      const skirt = [], skI = [], wall = [], waI = [], acc = [], acI = [];
      const edgesAt = (s) => {
        const info = splitAt(s), brs = geomBranches(s);
        const e = [brs[0].offset - brs[0].half, brs[1].offset + brs[1].half];
        if (info && info.profile > 0.04) e.push(brs[0].offset + brs[0].half, brs[1].offset - brs[1].half);
        return e;
      };
      for (let i = 0; i < SUB; i++) {
        const sa = stations[i], sb = stations[i + 1];
        const ea = edgesAt(sa), eb = edgesAt(sb);
        const n = Math.min(ea.length, eb.length);
        for (let e = 0; e < n; e++) {
          const aT = surfPoint(sa, ea[e]), bT = surfPoint(sb, eb[e]);
          const aB = aT.clone(); aB.y -= 1.5; const bB = bT.clone(); bB.y -= 1.5;
          let base = skirt.length / 3;
          skirt.push(aT.x, aT.y, aT.z, bT.x, bT.y, bT.z, aB.x, aB.y, aB.z, bB.x, bB.y, bB.z);
          skI.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
          const aW = aT.clone(); aW.y += 0.88; const bW = bT.clone(); bW.y += 0.88;
          const a0 = aT.clone(); a0.y -= 0.05; const b0 = bT.clone(); b0.y -= 0.05;
          base = wall.length / 3;
          wall.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, aW.x, aW.y, aW.z, bW.x, bW.y, bW.z);
          waI.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
          const aA = aT.clone(); aA.y += 0.64; const bA = bT.clone(); bA.y += 0.64;
          base = acc.length / 3;
          acc.push(aA.x, aA.y, aA.z, bA.x, bA.y, bA.z, aW.x, aW.y, aW.z, bW.x, bW.y, bW.z);
          acI.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }
      this.skirt.geometry.dispose(); this.skirt.geometry = geoFrom(skirt, null, skI);
      this.barrier.geometry.dispose(); this.barrier.geometry = geoFrom(wall, null, waI);
      this.accent.geometry.dispose(); this.accent.geometry = geoFrom(acc, null, acI);
    }
    // ── parallel monorails: GROUND rail (left) + AIR rail (right)
    {
      const pos = [], idx = [];
      const beam = (u, yFn, wdt) => {
        for (let i = 0; i < SUB; i++) {
          const pts = [stations[i], stations[i + 1]].map((s) => {
            const p = pointAt(s, u); const f = frameAt(s);
            return { c: new THREE.Vector3(p.x, yFn(f, s), p.z), rx: f.rx, rz: f.rz };
          });
          const v = pts.map(({ c, rx, rz }) => [
            new THREE.Vector3(c.x - rx * wdt / 2, c.y, c.z - rz * wdt / 2), new THREE.Vector3(c.x + rx * wdt / 2, c.y, c.z + rz * wdt / 2),
            new THREE.Vector3(c.x - rx * wdt / 2, c.y - 0.75, c.z - rz * wdt / 2), new THREE.Vector3(c.x + rx * wdt / 2, c.y - 0.75, c.z + rz * wdt / 2)]);
          const base = pos.length / 3;
          for (const q of [...v[0], ...v[1]]) pos.push(q.x, q.y, q.z);
          idx.push(base, base + 4, base + 1, base + 1, base + 4, base + 5,       // top
            base, base + 2, base + 4, base + 2, base + 6, base + 4,               // left side
            base + 1, base + 5, base + 3, base + 3, base + 5, base + 7);          // right side
        }
      };
      beam(-20, () => 1.05, 2.3);                    // ground monorail, same-direction traffic
      beam(20, (f) => f.y + 7.4, 2.5);               // elevated air monorail, oncoming traffic
      this.beams.geometry.dispose(); this.beams.geometry = geoFrom(pos, null, idx);
    }
    // ── support pillars
    {
      const sMid = s0 + CHUNK_LEN / 2, f = frameAt(sMid);
      const setPillar = (i, u, topY) => {
        const p = pointAt(sMid, u), m = this.pillars[i];
        const h = Math.max(topY, 1);
        m.visible = true; m.position.set(p.x, h / 2, p.z); m.scale.set(2.4, h, 2.4);
      };
      setPillar(0, 0, f.y - 1.2);                                        // main deck pylon
      const airP = pointAt(sMid, 20); this.pillars[1].visible = true;
      const ah = f.y + 6.6; this.pillars[1].position.set(airP.x, ah / 2, airP.z); this.pillars[1].scale.set(1.4, ah, 1.4);
      const br = branchParams(sMid);
      if (br && br.info.type === 'VERT' && br.p > 0.25) setPillar(2, br.right.offset, f.y + br.right.yOff - 1.2); // bridge deck of the UP branch
      else this.pillars[2].visible = false;
    }
    // ── modern city buildings (never neon — glass, concrete, brick tints)
    {
      const rand = rng(index * 7919 + 13), dummy = new THREE.Object3D(), col = new THREE.Color();
      const tints = [0xffffff, 0xcfd8de, 0xb9c8d4, 0xe4ded2, 0xaebfd0, 0xd8cfc4];
      let n = 0;
      for (let i = 0; i < 16; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const bs = s0 + rand() * CHUNK_LEN;
        const u = side * (40 + rand() * 88);
        const kC = Math.round((bs - CROSS_START) / CROSS_PERIOD);
        if (Math.abs(bs - (CROSS_START + kC * CROSS_PERIOD)) < 12) continue; // keep perpendicular rail corridors clear
        const w = 11 + rand() * 13, d = 11 + rand() * 13, hgt = 14 + rand() * rand() * 58;
        const p = pointAt(bs, u);
        dummy.position.set(p.x, hgt / 2, p.z);
        dummy.rotation.set(0, headingAt(bs), 0);
        dummy.scale.set(w, hgt, d); dummy.updateMatrix();
        this.buildings.setMatrixAt(n, dummy.matrix);
        this.buildings.setColorAt(n, col.setHex(tints[Math.floor(rand() * tints.length)]));
        n++;
      }
      this.buildings.count = n; this.buildings.instanceMatrix.needsUpdate = true;
      if (this.buildings.instanceColor) this.buildings.instanceColor.needsUpdate = true;
    }
    // ── street trees
    {
      const rand = rng(index * 3313 + 7), dummy = new THREE.Object3D();
      for (let i = 0; i < 10; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const ts = s0 + rand() * CHUNK_LEN, u = side * (29 + rand() * 7);
        const p = pointAt(ts, u), sc = 0.8 + rand() * 0.7;
        dummy.position.set(p.x, 2.1 * sc, p.z); dummy.scale.setScalar(sc); dummy.rotation.set(0, rand() * 3, 0);
        dummy.updateMatrix(); this.trees.setMatrixAt(i, dummy.matrix);
      }
      this.trees.instanceMatrix.needsUpdate = true;
    }
  }
}

// ─── Perpendicular railway crossings (pool) ──────────────────────────────────
class Crossing {
  constructor(scene, mats) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.k = -1; this.state = {};
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a9299, metalness: 0.85, roughness: 0.35 });
    // BRIDGE variant — rail bridge flies over the circuit
    this.bridgeG = new THREE.Group(); this.group.add(this.bridgeG);
    const beamM = new THREE.Mesh(new THREE.BoxGeometry(250, 1.6, 5), mats.beam); beamM.position.y = 11; beamM.castShadow = true; this.bridgeG.add(beamM);
    const truss = new THREE.Mesh(new THREE.BoxGeometry(250, 1.0, 0.4), mats.accent); truss.position.set(0, 12.2, 2.4); this.bridgeG.add(truss);
    const truss2 = truss.clone(); truss2.position.z = -2.4; this.bridgeG.add(truss2);
    this.bridgePillars = [];
    for (const x of [-85, -34, 34, 85]) { const p = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), mats.concrete); p.position.x = x; this.bridgeG.add(p); this.bridgePillars.push(p); }
    // LEVEL variant — embankment, rails across the deck, gates ("rail gates") + lights
    this.levelG = new THREE.Group(); this.group.add(this.levelG);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(250, 1, 11.5), mats.concrete); slab.position.y = -0.56; this.levelG.add(slab);
    this.levelPillars = [];
    for (const x of [-85, -34, 34, 85]) { const p = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1, 8), mats.concrete); p.position.x = x; this.levelG.add(p); this.levelPillars.push(p); }
    for (const z of [-0.95, 0.95]) { const r = new THREE.Mesh(new THREE.BoxGeometry(250, 0.16, 0.3), steel); r.position.set(0, 0.14, z); this.levelG.add(r); }
    this.gates = [];
    this.lights = [];
    for (const [gx, gz, dirSign] of [[15.5, -6.4, -1], [-15.5, 6.4, 1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3, 0.5), mats.barrier); post.position.set(gx, 1.5, gz); this.levelG.add(post);
      const pivot = new THREE.Group(); pivot.position.set(gx, 1.35, gz); this.levelG.add(pivot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(11, 0.32, 0.32),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdd2222, emissiveIntensity: 0.25 }));
      arm.position.x = dirSign * 5.5; pivot.add(arm);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), lampMat); lamp.position.set(gx, 3.5, gz); this.levelG.add(lamp);
      this.gates.push({ pivot, dirSign }); this.lights.push(lampMat);
    }
    this.train = buildTrain(0xeef0f2, 0xcc3322); this.train.rotation.y = Math.PI / 2; this.group.add(this.train);
  }
  assign(k) {
    this.k = k;
    const c = crossingAt(k);
    this.s = c.s; this.type = c.type; this.dir = c.dir;
    const p = pointAt(c.s, 0);
    this.group.position.set(p.x, surfaceYAt(c.s, 0), p.z);
    this.group.rotation.y = headingAt(c.s);
    this.bridgeG.visible = c.type === 'BRIDGE';
    this.levelG.visible = c.type === 'LEVEL';
    this.train.position.y = c.type === 'BRIDGE' ? 11.9 : 0.05;
    this.train.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    const oy = surfaceYAt(c.s, 0);
    for (const p2 of this.bridgePillars) { const h = oy + 10.2; p2.scale.y = h; p2.position.y = -oy + h / 2; }
    for (const p2 of this.levelPillars) { const h = Math.max(oy - 0.8, 0.5); p2.scale.y = h; p2.position.y = -oy + h / 2; }
  }
  update(time) {
    const period = this.type === 'BRIDGE' ? 13 : 17;
    const phase = (time + this.k * 4.7) % period;
    const active = phase < 7.5;
    const prog = clamp(phase / 7.5, 0, 1);
    const trainX = this.dir * (-135 + 270 * prog);
    this.train.visible = active;
    this.train.position.x = trainX;
    const closed = this.type === 'LEVEL' && (phase < 8.2 || phase > period - 1.8);
    for (const g of this.gates) g.pivot.rotation.z = closed ? 0 : g.dirSign * 1.15; // arms lift when open
    const blink = closed && Math.sin(time * 9) > 0 ? 3.2 : 0;
    for (const l of this.lights) l.emissiveIntensity = blink;
    this.state = { k: this.k, s: this.s, type: this.type, active, closed, trainX, phase, period };
  }
}

// ─── Overhead sign gantries (pool) ───────────────────────────────────────────
class Gantry {
  constructor(scene, mats, signMats) {
    this.group = new THREE.Group(); scene.add(this.group);
    const postG = new THREE.BoxGeometry(0.7, 7.4, 0.7);
    for (const x of [-14.4, 14.4]) { const p = new THREE.Mesh(postG, mats.concrete); p.position.set(x, 3.7, 0); p.castShadow = true; this.group.add(p); }
    const truss = new THREE.Mesh(new THREE.BoxGeometry(30, 1.0, 1.0), mats.dark); truss.position.y = 7.2; this.group.add(truss);
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 5.2), signMats[0]);
    this.sign.position.set(0, 4.6, -0.65); this.sign.rotation.y = Math.PI; this.group.add(this.sign);
    this.signMats = signMats; this.g = -1;
  }
  assign(g) {
    this.g = g; this.s = 90 + g * 270;
    const p = pointAt(this.s, 0);
    this.group.position.set(p.x, surfaceYAt(this.s, 0), p.z);
    this.group.rotation.y = headingAt(this.s);
    const ns = nextSplit(this.s), nc = nextCrossing(this.s);
    if (ns.dist > 0 && ns.dist < 300) this.sign.material = this.signMats[ns.type === 'VERT' ? 2 : 1];
    else if (nc.dist > 0 && nc.dist < 260 && nc.type === 'LEVEL') this.sign.material = this.signMats[3];
    else this.sign.material = this.signMats[0];
  }
}

export class World {
  constructor(scene) {
    const mats = {
      track: new THREE.MeshStandardMaterial({ map: trackTexture, roughness: 0.92, metalness: 0.05 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x272c31, roughness: 0.8, side: THREE.DoubleSide }),
      barrier: new THREE.MeshStandardMaterial({ color: 0xeef1f3, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide }),
      accent: new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff6a00, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
      beam: new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.5, metalness: 0.3 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0xb7bcc0, roughness: 0.9 }),
      building: new THREE.MeshStandardMaterial({ map: buildingTexture, roughness: 0.6, metalness: 0.25 }),
      tree: new THREE.MeshStandardMaterial({ color: 0x3e7d38, roughness: 0.9 }),
    };
    this.mats = mats;

    // city street plane — snaps to its own 60 m grid so the texture never swims
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1500),
      new THREE.MeshStandardMaterial({ map: cityTexture, roughness: 0.95 }));
    cityTexture.repeat.set(1100 / 60, 1500 / 60);
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; scene.add(this.ground);

    this.chunks = [];
    for (let i = 0; i < CHUNKS; i++) { const c = new Chunk(scene, mats); c.build(i - 5); this.chunks.push(c); }

    // parallel monorail trains: ground line runs WITH you, air line comes AT you
    this.parallelTrains = [];
    for (let i = 0; i < 10; i++) {
      const air = i >= 5;
      const mesh = buildTrain(0xf2f4f6, air ? 0x2266aa : 0x2e8b57);
      scene.add(mesh);
      this.parallelTrains.push({
        mesh, air, u: air ? 20 : -20,
        s: (i % 5) * 230 + (air ? 120 : 0),
        dir: air ? -1 : 1, speed: air ? 30 : 23,
      });
    }

    this.crossings = [];
    for (let i = 0; i < 4; i++) { const c = new Crossing(scene, mats); this.crossings.push(c); }

    const signMats = [
      new THREE.MeshStandardMaterial({ map: signTexture('APEX CITY', 'INFINITE GP', '↑') }),
      new THREE.MeshStandardMaterial({ map: signTexture('SPLIT', 'Y · LEFT / RIGHT', '↖ ↗') }),
      new THREE.MeshStandardMaterial({ map: signTexture('SPLIT', 'UP / DOWN', '↗ ↘') }),
      new THREE.MeshStandardMaterial({ map: signTexture('CAUTION', 'RAIL CROSSING', '⚠') }),
    ];
    this.gantries = [];
    for (let i = 0; i < 5; i++) this.gantries.push(new Gantry(scene, mats, signMats));

    // boost pads
    this.pads = [];
    const padMat = new THREE.MeshStandardMaterial({ map: padTexture, emissive: 0xff7a1a, emissiveMap: padTexture, emissiveIntensity: 0.9, roughness: 0.6 });
    const padGeo = new THREE.PlaneGeometry(4.2, 8); padGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(padGeo, padMat); scene.add(mesh);
      this.pads.push({ mesh, p: -1, s: 0, u: 0 });
    }

    // light same-direction road traffic on the circuit itself
    this.traffic = [];
    const carColors = [0x3a6ea5, 0xc0c6cc, 0x707880, 0x8a2f2a, 0x2f5d3a, 0xd8d3c8, 0x33404d, 0xb7791f];
    for (let i = 0; i < 8; i++) {
      const mesh = buildCarModel(carColors[i], true); scene.add(mesh);
      this.traffic.push({ mesh, s: 120 + i * 95, u: [-7, 0, 7][i % 3], targetU: [-7, 0, 7][i % 3], speed: 17 + hash(i * 9.1) * 9 });
    }

    // soft daylight clouds
    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 10; i++) {
      const cl = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(9 + hash(i * 7 + j) * 10, 10, 8), cloudMat);
        b.position.set(j * 11 - 16, hash(j + i) * 3, hash(i - j) * 8); b.scale.y = 0.42; cl.add(b);
      }
      cl.position.set((hash(i * 3) - 0.5) * 900, 95 + hash(i) * 55, i * 220);
      scene.add(cl); this.clouds.push(cl);
    }
  }

  update(dt, time, playerPos) {
    const ps = playerPos.z;
    // chunks
    const baseIdx = Math.floor((ps - 120) / CHUNK_LEN);
    const needed = new Set(); for (let i = 0; i < CHUNKS; i++) needed.add(baseIdx + i);
    for (const c of this.chunks) if (!needed.has(c.index)) {
      for (const n of needed) if (!this.chunks.some((o) => o.index === n)) { c.build(n); break; }
    }
    // ground plane follows, snapped to the 60 m city grid
    this.ground.position.set(Math.round(playerPos.x / 60) * 60, -0.05, Math.round(playerPos.z / 60) * 60 + 300);

    // parallel trains
    for (const t of this.parallelTrains) {
      t.s += t.dir * t.speed * dt;
      if (t.s < ps - 300) t.s += 1180;
      if (t.s > ps + 880) t.s -= 1180;
      const p = pointAt(t.s, t.u), f = frameAt(t.s);
      t.mesh.position.set(p.x, t.air ? f.y + 7.5 : 1.1, p.z);
      t.mesh.rotation.y = f.h + (t.dir < 0 ? Math.PI : 0);
    }
    // perpendicular crossings: keep 4 assigned around the player
    {
      const k0 = Math.max(0, Math.floor((ps - CROSS_START) / CROSS_PERIOD));
      const want = [k0, k0 + 1, k0 + 2, k0 + 3];
      for (const c of this.crossings) if (!want.includes(c.k)) {
        const free = want.find((k) => !this.crossings.some((o) => o.k === k));
        if (free !== undefined) c.assign(free);
      }
      for (const c of this.crossings) if (c.k >= 0) c.update(time);
    }
    // gantries
    {
      const g0 = Math.max(0, Math.floor((ps - 90) / 270));
      const want = [g0, g0 + 1, g0 + 2, g0 + 3, g0 + 4];
      for (const gn of this.gantries) if (!want.includes(gn.g)) {
        const free = want.find((k) => !this.gantries.some((o) => o.g === k));
        if (free !== undefined) gn.assign(free);
      }
    }
    // boost pads
    {
      const p0 = Math.max(0, Math.floor((ps - 140) / 150));
      for (let i = 0; i < this.pads.length; i++) {
        const pad = this.pads[i], want = p0 + i;
        if (pad.p !== want) {
          pad.p = want; pad.s = 140 + want * 150;
          pad.u = [-7, 0, 7][Math.floor(hash(want * 5.3) * 3)];
          if (splitAt(pad.s) && pad.u === 0) pad.u = 7;
          const p = surfPoint(pad.s, pad.u, 0.07);
          pad.mesh.position.copy(p);
          pad.mesh.rotation.order = 'YXZ';
          pad.mesh.rotation.y = headingAt(pad.s);
          pad.mesh.rotation.x = -Math.atan(trackYSlope(pad.s));
        }
      }
    }
    // traffic cars
    for (const t of this.traffic) {
      t.s += t.speed * dt;
      if (t.s < ps - 60) { t.s = ps + 620 + hash(t.s) * 220; t.u = t.targetU = [-7, 0, 7][Math.floor(Math.random() * 3)]; }
      if (t.s > ps + 900) t.s = ps - 40;
      if (splitAt(t.s) && t.targetU === 0) t.targetU = 7;
      t.u += clamp(t.targetU - t.u, -dt * 2.2, dt * 2.2);
      const p = surfPoint(t.s, t.u, 0.02);
      t.mesh.position.copy(p);
      t.mesh.rotation.set(0, headingAt(t.s), 0);
    }
    // clouds drift slowly and wrap around the player
    for (const cl of this.clouds) {
      cl.position.x += dt * 1.2;
      if (cl.position.z < ps - 350) cl.position.z += 1400;
      if (cl.position.z > ps + 1100) cl.position.z -= 1400;
      if (cl.position.x - playerPos.x > 700) cl.position.x -= 1400;
    }
  }
}
