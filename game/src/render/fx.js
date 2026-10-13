// Lightweight effects: speed streaks around the camera, sparks on scrapes, tyre smoke on drifts.
import * as THREE from 'three';

export class SpeedStreaks {
  constructor(camera, count = 140) {
    this.camera = camera;
    this.count = count;
    this.p = [];
    for (let i = 0; i < count; i++) this.p.push(this._spawn(Math.random() * 60));
    const pos = new Float32Array(count * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xf2f6fa, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    camera.add(this.lines);
  }

  _spawn(z) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.5 + Math.random() * 9;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, z: -Math.abs(z) - 2, len: 2 + Math.random() * 4 };
  }

  update(dt, speed, boost) {
    const k = Math.max(0, (speed - 30) / 50);
    this.mat.opacity = Math.min(0.5, k * 0.5) + boost * 0.15;
    const arr = this.geo.attributes.position.array;
    const move = speed * dt;
    for (let i = 0; i < this.count; i++) {
      const p = this.p[i];
      p.z += move;
      if (p.z > -1.5) Object.assign(p, this._spawn(40 + Math.random() * 60));
      const L = p.len * (0.5 + k * 3);
      arr[i * 6] = p.x;
      arr[i * 6 + 1] = p.y;
      arr[i * 6 + 2] = p.z;
      arr[i * 6 + 3] = p.x;
      arr[i * 6 + 4] = p.y;
      arr[i * 6 + 5] = p.z - L;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, max = 240) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.kind = new Uint8Array(max); // 0 spark, 1 smoke
    this.next = 0;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.life[i] = 0;
  }

  emit(x, y, z, vx, vy, vz, kind, life, c) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = c[0];
    this.col[i * 3 + 1] = c[1];
    this.col[i * 3 + 2] = c[2];
    this.life[i] = life;
    this.kind[i] = kind;
    this.size[i] = kind ? 1.2 : 0.22;
  }

  spark(x, y, z, strength = 1) {
    const n = Math.min(12, 3 + Math.round(strength * 4));
    for (let k = 0; k < n; k++) {
      this.emit(
        x,
        y,
        z,
        (Math.random() - 0.5) * 9,
        Math.random() * 6,
        (Math.random() - 0.5) * 9,
        0,
        0.35 + Math.random() * 0.3,
        [1.6, 1.2, 0.5],
      );
    }
  }

  smoke(x, y, z) {
    this.emit(x, y, z, (Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2, 1, 1.1, [0.78, 0.8, 0.82]);
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 3] = 0;
        this.col[i * 3 + 1] = 0;
        this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      const g = this.kind[i] ? 0 : -18;
      this.vel[i * 3 + 1] += g * dt;
      this.vel[i * 3] *= this.kind[i] ? 0.96 : 0.99;
      this.vel[i * 3 + 2] *= this.kind[i] ? 0.96 : 0.99;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.kind[i]) {
        const f = Math.max(0, this.life[i]) * 0.5;
        this.col[i * 3] = 0.78 * f + 0.001;
        this.col[i * 3 + 1] = 0.8 * f + 0.001;
        this.col[i * 3 + 2] = 0.82 * f + 0.001;
      } else {
        const f = Math.max(0, this.life[i] / 0.6);
        this.col[i * 3] = 1.6 * f;
        this.col[i * 3 + 1] = 1.2 * f;
        this.col[i * 3 + 2] = 0.5 * f;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
