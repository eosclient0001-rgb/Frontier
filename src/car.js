import * as THREE from 'three';
import { clamp, lerp } from './track.js?v=3';

/* ============================================================
   CAR.JS — Need-for-Speed-style ARCADE physics (not lane-based)
   Free steering anywhere, bicycle-inspired yaw, lateral-grip
   model: grip bleeds sideways velocity; handbrake cuts grip
   so the car genuinely drifts. Throttle / brake / reverse,
   boost, slope force, jumps off crests & bridge edges,
   barrier scrapes, off-track city-ground driving.
   ============================================================ */

const unitBox = new THREE.BoxGeometry(1, 1, 1);
function bx(mat, sx, sy, sz, x, y, z, parent, rx = 0) {
  const m = new THREE.Mesh(unitBox, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.x = rx;
  m.castShadow = true; parent.add(m); return m;
}

export class Car {
  constructor(scene) {
    this.pos = new THREE.Vector3(0, 0, 6);
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.vy = 0;
    this.grounded = true;
    this.steer = 0;              // smoothed steering -1..1
    this.hint = 0;               // last known track frame
    this.sample = null;
    this.drifting = false;
    this.offTrack = false;
    this.barrierHit = 0;         // impact strength this frame
    this.wheelSpin = 0;
    this.pitchVis = 0; this.rollVis = 0;
    this.brakeLight = null;
    this.wheelsF = []; this.wheelsAll = [];
    this.mesh = this.buildModel();
    scene.add(this.mesh);
  }

  buildModel() {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0x2456c8, roughness: .28, metalness: .55 });
    const paint2 = new THREE.MeshStandardMaterial({ color: 0x16283f, roughness: .4, metalness: .5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x101c2a, roughness: .1, metalness: .8 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xf06423, roughness: .4, metalness: .3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: .85 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc7cfd8, roughness: .25, metalness: .9 });
    bx(paint, 2.15, .52, 4.7, 0, .58, 0, g);                    // lower body
    const nose = bx(paint, 1.95, .34, 1.3, 0, .48, 2.35, g, -.16); // nose wedge
    nose.castShadow = true;
    bx(paint2, 1.7, .3, 2.0, 0, .78, -.45, g);                  // cabin base
    bx(glass, 1.45, .42, 1.55, 0, 1.02, -.4, g);                // canopy
    bx(orange, 2.16, .1, 4.0, 0, .4, 0, g);                     // side skirts stripe
    bx(dark, 2.0, .22, .5, 0, .95, -2.25, g);                   // spoiler supports+wing base
    bx(paint2, 2.3, .09, .55, 0, 1.18, -2.35, g);               // rear wing
    bx(orange, 2.3, .12, .18, 0, 1.18, -2.6, g);
    bx(glass, 1.7, .3, .18, 0, .72, 2.78, g);                   // windshield hint / front glass
    bx(dark, 1.8, .28, .3, 0, .5, -2.42, g);                    // rear diffuser
    // headlights / brake lights
    const hl = new THREE.MeshStandardMaterial({ color: 0x444422, emissive: 0xffeeb8, emissiveIntensity: 2 });
    bx(hl, .42, .12, .08, -.62, .68, 2.92, g); bx(hl, .42, .12, .08, .62, .68, 2.92, g);
    this.brakeLight = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: .7 });
    bx(this.brakeLight, 1.7, .13, .08, 0, .78, -2.5, g);
    // wheels
    const tyre = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: .95 });
    const hub = new THREE.MeshStandardMaterial({ color: 0xb9c1ca, roughness: .3, metalness: .85 });
    const wg = new THREE.CylinderGeometry(.4, .4, .32, 14);
    [[-1.02, 1.5], [1.02, 1.5], [-1.02, -1.5], [1.02, -1.5]].forEach(([x, z], i) => {
      const steerG = new THREE.Group(); steerG.position.set(x, .4, z); g.add(steerG);
      const spinG = new THREE.Group(); steerG.add(spinG);
      const w = new THREE.Mesh(wg, tyre); w.rotation.z = Math.PI / 2; w.castShadow = true; spinG.add(w);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(.21, .21, .34, 6), hub);
      h.rotation.z = Math.PI / 2; spinG.add(h);
      this.wheelsAll.push(spinG);
      if (i < 2) this.wheelsF.push(steerG);
    });
    g.rotation.order = 'YXZ';
    return g;
  }

  resetToTrack(track) {
    const f = track.frame(Math.max(2, this.hint));
    if (!f) return;
    const pose = track.branchPose(f, 'A');
    this.pos.copy(pose.pos); this.pos.y = pose.pos.y + .05;
    this.heading = f.yaw;
    this.vel.set(0, 0, 0); this.vy = 0; this.grounded = true; this.steer = 0;
  }

  /**
   * input: { throttle:0..1, brake:0..1, steer:-1(left)..1(right), handbrake:bool, boost:bool }
   */
  update(dt, input, track) {
    dt = Math.min(dt, .05);
    this.barrierHit = 0;
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    let fSpeed = this.vel.dot(fwd);
    let latSpeed = this.vel.dot(right);

    // --- steering (speed-sensitive, NFS arcade) ---
    const speedFac = clamp(Math.abs(fSpeed) / 72, 0, 1);
    const maxSteer = lerp(.58, .13, speedFac);
    this.steer = clamp(this.steer + (input.steer - this.steer) * Math.min(1, dt * 7), -1, 1);
    const steerAngle = this.steer * maxSteer;
    let yawRate = (fSpeed / 2.9) * Math.tan(steerAngle);
    const yawCap = lerp(1.55, .62, speedFac) * (input.handbrake ? 1.4 : 1);
    yawRate = clamp(yawRate, -yawCap, yawCap);
    // NOTE: forward = (sin h, 0, cos h) and the chase camera looks along it,
    // so screen-right is -X at h=0. A right turn (steer > 0) must DECREASE
    // heading — increasing it swings the nose toward screen-left.
    if (Math.abs(fSpeed) > .4) this.heading -= yawRate * dt;

    // recompute basis after yaw
    fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    fSpeed = this.vel.dot(fwd); latSpeed = this.vel.dot(right);

    // --- longitudinal forces ---
    const maxSpeed = input.boost ? 88 : 74;
    if (input.throttle > 0) {
      const ratio = clamp(fSpeed / maxSpeed, 0, 1);
      const taper = fSpeed >= 0 ? Math.max(0, 1 - ratio * ratio) : 1;
      fSpeed += input.throttle * (input.boost ? 36 : 31) * taper * dt;
    }
    if (input.brake > 0) {
      if (fSpeed > .6) fSpeed -= 44 * input.brake * dt;
      else fSpeed = Math.max(-15, fSpeed - 15 * input.brake * dt);
    }
    fSpeed -= fSpeed * Math.abs(fSpeed) * .0007 * dt;  // aero drag
    fSpeed -= fSpeed * .03 * dt;                       // rolling resistance
    if (input.handbrake) fSpeed -= fSpeed * .5 * dt;

    // slope gravity from the track under us
    if (this.grounded && this.sample) {
      const rel = this.heading - this.sample.frame.yaw;
      fSpeed += -Math.sin(this.sample.frame.pitch) * Math.cos(rel) * 13 * dt;
    }

    // --- lateral grip / drift ---
    this.drifting = input.handbrake && Math.abs(fSpeed) > 7;
    const grip = this.offTrack ? 5.5 : (input.handbrake ? 2.4 : 9.5);
    latSpeed *= Math.exp(-grip * dt);
    if (this.drifting && Math.abs(latSpeed) < Math.abs(fSpeed) * .42)
      latSpeed += this.steer * Math.abs(fSpeed) * .16 * dt; // provoke a controlled slide (velocity lags toward the outside of the turn)

    this.vel.copy(fwd).multiplyScalar(fSpeed).addScaledVector(right, latSpeed);
    this.pos.addScaledVector(this.vel, dt);

    // --- vertical / surface following ---
    const s = track.sample(this.pos, this.hint);
    this.sample = s;
    let cityGround = 0;
    if (s) {
      this.hint = s.frame.i;
      const allowedLat = s.pose.halfW + .95;
      if (Math.abs(s.lat) > allowedLat && this.pos.y <= s.surfaceY + 1.0) {
        // barrier scrape: push back inside, scrub speed
        const push = (Math.abs(s.lat) - allowedLat) * Math.sign(s.lat);
        this.pos.addScaledVector(s.frame.right, -push);
        const outVel = this.vel.dot(s.frame.right) * Math.sign(s.lat);
        if (outVel > 0) {
          this.vel.addScaledVector(s.frame.right, -outVel * Math.sign(s.lat) * 1.15);
          this.barrierHit = outVel;
          const sp = this.vel.length();
          if (sp > 0) this.vel.multiplyScalar(Math.max(0, sp - outVel * .55) / sp);
        }
      }
      const effLat = Math.abs(s.lat) > allowedLat && this.pos.y <= s.surfaceY + 1.0
        ? Math.sign(s.lat) * allowedLat : s.lat; // barrier push-back counts as on the road
      const overRoad = Math.abs(effLat) <= allowedLat;
      if (this.grounded) {
        if (overRoad) {
          if (s.surfaceY < this.pos.y - 1.4) { this.grounded = false; this.vy = 0; } // off a crest / bridge edge
          else this.pos.y += (s.surfaceY - this.pos.y) * Math.min(1, dt * 22);
          this.offTrack = false;
        } else if (this.pos.y > cityGround + .08) {
          this.grounded = false; this.vy = Math.min(this.vy, 0); // drove off an elevated edge
        } else {
          this.pos.y = cityGround; this.offTrack = true;
        }
      }
      if (!this.grounded) {
        this.vy -= 24 * dt;
        this.pos.y += this.vy * dt;
        const landY = overRoad ? s.surfaceY : cityGround;
        if (this.pos.y <= landY) {
          this.pos.y = landY; this.vy = 0; this.grounded = true;
          this.offTrack = !overRoad;
          if (Math.abs(this.vel.y) > 0) this.vel.y = 0;
        }
      }
    } else {
      if (!this.grounded) { this.vy -= 24 * dt; this.pos.y += this.vy * dt; }
      if (this.pos.y <= cityGround) { this.pos.y = cityGround; this.grounded = true; this.offTrack = true; }
    }
    if (this.offTrack && this.grounded) { // rough city streets: extra drag
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 16) this.vel.multiplyScalar(Math.max(0, sp - 14 * dt) / sp);
    }

    // --- visuals ---
    this.mesh.position.copy(this.pos);
    const relH = s ? this.heading - s.frame.yaw : 0;
    const targetPitch = this.grounded && s && !this.offTrack ? -s.frame.pitch * Math.cos(relH) : clamp(-this.vy * .012, -.25, .3);
    const targetRoll = (this.grounded && s && !this.offTrack ? s.frame.bank * Math.cos(relH) : 0)
      + clamp(-latSpeed * .014, -.16, .16) + this.steer * clamp(Math.abs(fSpeed) / 60, 0, 1) * .06;
    this.pitchVis += (targetPitch - this.pitchVis) * Math.min(1, dt * 8);
    this.rollVis += (targetRoll - this.rollVis) * Math.min(1, dt * 8);
    this.mesh.rotation.set(this.pitchVis, this.heading, this.rollVis);
    this.wheelSpin += fSpeed * dt / .4;
    this.wheelsAll.forEach(w => { w.rotation.x = this.wheelSpin; });
    this.wheelsF.forEach(w => { w.rotation.y = -this.steer * .42; }); // match screen direction of travel
    if (this.brakeLight) this.brakeLight.emissiveIntensity = input.brake > 0 ? 3.4 : (input.handbrake ? 2.4 : .7);

    return {
      speed: fSpeed, speedKmh: Math.abs(fSpeed) * 3.6,
      drifting: this.drifting || Math.abs(latSpeed) > 5,
      offTrack: this.offTrack, grounded: this.grounded,
      barrierHit: this.barrierHit, sample: s, latSpeed,
    };
  }
}
