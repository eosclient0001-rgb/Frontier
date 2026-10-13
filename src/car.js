import * as THREE from 'three';
import { clamp, lerp, groundAt } from './trackMath.js';

// ─── Stylised modern GT car built from primitives (front = +Z) ──────────────
export function buildCarModel(color = 0xd8401c, traffic = false) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.32 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181c, metalness: 0.4, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a36, metalness: 0.9, roughness: 0.12 });
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true; car.add(m); return m;
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  add(box, paint, 0, 0.52, 0, 2.05, 0.52, 4.5);              // main body
  add(box, paint, 0, 0.34, 0.25, 2.14, 0.3, 3.4);            // wide haunches (Wipeout-wide stance)
  add(box, glass, 0, 0.94, -0.25, 1.7, 0.5, 2.0);            // canopy
  add(box, paint, 0, 0.86, 1.55, 1.9, 0.16, 0.7);            // nose
  add(box, dark, 0, 0.3, 2.18, 1.8, 0.22, 0.25);             // front intake
  add(box, dark, 0, 0.42, -2.2, 1.95, 0.34, 0.3);            // diffuser
  add(box, paint, 0, 1.06, -2.05, 2.0, 0.09, 0.42);          // spoiler blade
  add(box, dark, -0.72, 0.84, -2.0, 0.12, 0.38, 0.3);
  add(box, dark, 0.72, 0.84, -2.0, 0.12, 0.38, 0.3);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfe6ff, emissiveIntensity: traffic ? 0.4 : 1.2 });
  add(box, lightMat, -0.62, 0.62, 2.28, 0.5, 0.1, 0.06);
  add(box, lightMat, 0.62, 0.62, 2.28, 0.5, 0.1, 0.06);
  const tail = add(box, new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2211, emissiveIntensity: 0.7 }), 0, 0.66, -2.27, 1.8, 0.11, 0.06);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.36, 10); hubGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xb9c0c6, metalness: 0.8, roughness: 0.3 });
  const wheels = [], steers = [];
  for (const [x, z, steer] of [[-1.02, 1.45, 1], [1.02, 1.45, 1], [-1.02, -1.45, 0], [1.02, -1.45, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.42, z); car.add(pivot);
    const w = new THREE.Mesh(wheelGeo, tyre); w.castShadow = true; pivot.add(w);
    pivot.add(new THREE.Mesh(hubGeo, hub));
    wheels.push(w); if (steer) steers.push(pivot);
  }
  // nitro flame (hidden unless boosting)
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.6, 10),
    new THREE.MeshBasicMaterial({ color: 0x66baff, transparent: true, opacity: 0.85 }));
  flame.rotation.x = Math.PI / 2; flame.position.set(0, 0.45, -3.1); flame.visible = false; car.add(flame);
  car.userData = { wheels, steers, tail, flame };
  return car;
}

// ─── NFS-style arcade physics ────────────────────────────────────────────────
// NOT a lane runner: the car has a heading, forward/lateral velocity split,
// speed-sensitive steering, grip, handbrake drift, nitro, airborne phases and
// barrier interaction — the classic arcade-GT feel.
export class ArcadeCar {
  constructor(model) {
    this.model = model;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.steerVis = 0;
    this.wheelSpin = 0;
    this.grounded = true;
    this.airTime = 0;
    this.nitro = 65;
    this.boosting = false;
    this.padBoost = 0;
    this.driftScore = 0;
    this.drifting = false;
    this.slip = 0;
    this.barrierHit = 0;   // >0 briefly after a scrape (HUD flash / shake)
    this.offRoadTime = 0;
    this.maxS = 0;
    this.lastBranchSide = 0; // -1 left / +1 right while inside a fork
  }

  place(s, u = 0) {
    const g = groundAt(0, s); // centreline x resolved below properly:
    const cx = g.frame.cx;
    this.pos.set(cx + g.frame.rx * u, g.groundY + 0.05, s + g.frame.rz * u);
    this.heading = g.frame.h;
    this.vel.set(0, 0, 0);
    this.grounded = true; this.airTime = 0;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get speedKmh() { return Math.round(this.speed * 3.6); }

  update(dt, input) {
    dt = Math.min(dt, 0.05);
    const before = groundAt(this.pos.x, this.pos.z);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = fz, rz = -fx; // car right
    let vf = this.vel.x * fx + this.vel.z * fz;   // forward speed
    let vr = this.vel.x * rx + this.vel.z * rz;   // lateral (slide) speed
    const speedAbs = Math.abs(vf);

    // ── steering: builds up, fades at very high speed, sharper when drifting
    const steerAuthority = clamp(speedAbs / 9, 0, 1) * (1 - clamp(speedAbs / 130, 0, 0.42));
    const yawRate = input.steer * steerAuthority * (input.handbrake ? 1.65 : 1.0) * clamp(speedAbs * 0.052, 0, 1.45) * (vf < 0 ? -1 : 1);
    if (this.grounded) this.heading += yawRate * dt * (speedAbs > 0.4 ? 1 : 0);
    else this.heading += yawRate * dt * 0.35; // limited air control
    this.steerVis = lerp(this.steerVis, input.steer, 1 - Math.exp(-10 * dt));

    // recompute axes after turning
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    const nrx = nfz, nrz = -nfx;
    vf = this.vel.x * nfx + this.vel.z * nfz;
    vr = this.vel.x * nrx + this.vel.z * nrz;

    const onTrack = before.onTrack && this.grounded;
    const surfaceGrip = before.surface === 'track' ? 1 : 0.55;

    // ── engine / brake / reverse / drag
    const nitroActive = input.boost && this.nitro > 1 && vf > 2;
    this.boosting = nitroActive || this.padBoost > 0;
    if (nitroActive) this.nitro = Math.max(0, this.nitro - 30 * dt);
    else this.nitro = Math.min(100, this.nitro + (this.drifting ? 9 : 2.2) * dt);
    if (this.padBoost > 0) this.padBoost -= dt;

    const MAXF = this.boosting ? 96 : 79; // m/s ≈ 285 / 345 km/h
    if (this.grounded) {
      if (input.throttle > 0) {
        const power = 26 * (1 - clamp(vf / (MAXF * 1.12), 0, 1)) * (this.boosting ? 1.55 : 1);
        vf += power * input.throttle * dt * surfaceGrip;
      } else if (input.throttle < 0) {
        if (vf > 1.2) vf -= 42 * dt;                    // brake
        else vf = Math.max(vf - 13 * dt, -13);          // reverse
      }
      if (input.handbrake) vf -= vf * 0.55 * dt;        // handbrake scrubs speed
      // slope gravity — crests and ramps genuinely matter
      const ahead = groundAt(this.pos.x + nfx * 4, this.pos.z + nfz * 4);
      const behind = groundAt(this.pos.x - nfx * 4, this.pos.z - nfz * 4);
      if (ahead.onTrack && behind.onTrack) vf += -9.8 * ((ahead.y - behind.y) / 8) * dt * 1.6;
    }
    vf -= 0.0016 * vf * Math.abs(vf) * dt;              // aero drag (top speed ≈235 km/h, ≈290 on nitro)
    if (before.surface !== 'track' && this.grounded) vf -= vf * 0.55 * dt; // city streets / rough = slow

    // ── grip vs drift: kill lateral velocity, unless handbrake breaks traction
    const grip = input.handbrake ? 1.35 : (before.surface === 'track' ? 8.5 : 4.5);
    if (this.grounded) vr *= Math.exp(-grip * dt);
    this.slip = vr;
    this.drifting = this.grounded && Math.abs(vr) > 3.4 && speedAbs > 14;
    if (this.drifting) this.driftScore += Math.abs(vr) * speedAbs * dt * 0.55;

    // rebuild horizontal velocity
    this.vel.x = nfx * vf + nrx * vr;
    this.vel.z = nfz * vf + nrz * vr;

    // ── vertical: follow the deck, launch off crests, land again
    const ground = groundAt(this.pos.x, this.pos.z);
    const floorY = ground.onTrack ? ground.y : 0;
    if (this.grounded) {
      const dy = floorY - this.pos.y;
      if (dy < -0.55) { this.grounded = false; this.vel.y = Math.min(this.vel.y, 0); } // deck falls away → airborne
      else { this.pos.y = floorY; this.vel.y = 0; }
    }
    if (!this.grounded) {
      this.vel.y -= 24 * dt;
      this.airTime += dt;
    }

    this.pos.addScaledVector(this.vel, dt);
    if (this.vel.y === 0 && this.grounded) this.pos.y = floorY;

    const after = groundAt(this.pos.x, this.pos.z);
    const floor2 = after.onTrack ? after.y : 0;
    if (!this.grounded && this.pos.y <= floor2) {
      this.pos.y = floor2; this.vel.y = 0; this.grounded = true;
      if (this.airTime > 0.4) this.barrierHit = Math.max(this.barrierHit, 0.35); // heavy landing thump
      this.airTime = 0;
    }

    // ── barriers: Wipeout walls keep you on the deck, at a price in speed
    this.barrierHit = Math.max(0, this.barrierHit - dt);
    const bounceOffWall = (targetU, wallY) => {
      const fr = after.frame;
      this.pos.x = fr.cx + fr.rx * targetU;
      this.pos.z = after.s + fr.rz * targetU;
      this.pos.y = wallY;
      let nvf = this.vel.x * nfx + this.vel.z * nfz;
      let nvr = this.vel.x * nrx + this.vel.z * nrz;
      nvr = -nvr * 0.28; nvf *= 0.94;
      this.vel.x = nfx * nvf + nrx * nvr;
      this.vel.z = nfz * nvf + nrz * nvr;
      this.barrierHit = 0.55;
    };
    if (this.grounded && after.split && after.onTrack) this.lastBranchSide = after.u < 0 ? -1 : 1;
    if (this.grounded && after.onTrack) {
      const limit = after.branchHalf - 1.15;
      if (Math.abs(after.localU) > limit) {
        bounceOffWall((after.branch ? after.branch.offset : 0) + Math.sign(after.localU) * limit, after.y);
      }
    } else if (this.grounded && after.split && after.profile > 0.08 && this.lastBranchSide !== 0) {
      // divider wall between fork branches — you must commit to a branch
      // while the fork is open; you can only swap where it merges back together
      const br = this.lastBranchSide < 0 ? after.left : after.right;
      const innerLimit = br.offset + (this.lastBranchSide < 0 ? 1 : -1) * (br.half - 1.15);
      const crossed = this.lastBranchSide < 0 ? after.u > innerLimit : after.u < innerLimit;
      const nearDeck = Math.abs(this.pos.y - (after.frame.y + br.yOff + after.u * after.frame.bank)) < 3.2;
      if (crossed && nearDeck) bounceOffWall(innerLimit, after.frame.y + br.yOff + innerLimit * after.frame.bank);
    }
    if (!after.split) this.lastBranchSide = 0;

    this.offRoadTime = (after.surface !== 'track' && this.grounded) ? this.offRoadTime + dt : 0;
    if (after.s > this.maxS) this.maxS = after.s;

    // ── visuals
    this.model.position.copy(this.pos);
    this.model.rotation.set(0, 0, 0);
    this.model.rotation.y = this.heading;
    // lean into the deck: pitch from slope, roll from banking + drift
    const f2 = after.frame;
    this.model.rotation.x = -Math.atan2(groundAt(this.pos.x + nfx * 3, this.pos.z + nfz * 3).y - after.y, 3) * (after.onTrack ? 1 : 0);
    this.model.rotation.z = clamp(f2.bank * 1.4, -0.2, 0.2) - this.steerVis * clamp(speedAbs / 90, 0, 0.1) - clamp(vr * 0.006, -0.09, 0.09);
    if (!this.grounded) this.model.rotation.x = clamp(-this.vel.y * 0.012, -0.3, 0.35);
    this.wheelSpin += vf * dt / 0.42;
    for (const w of this.model.userData.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.model.userData.steers) p.rotation.y = this.steerVis * 0.42;
    this.model.userData.tail.material.emissiveIntensity = input.throttle < 0 || input.handbrake ? 2.6 : 0.7;
    this.model.userData.flame.visible = this.boosting && this.grounded;
    const fl = 0.7 + Math.random() * 0.6;
    this.model.userData.flame.scale.set(1, fl, 1);
    return after;
  }
}
