/**
 * ============================================================================
 *  FragmentSystem — turns carved fragments into moving rigid bodies
 * ============================================================================
 *
 *  Once a fragment is a closed mesh with a volume, a centroid and an inertia
 *  tensor, it is a rigid body. This module runs the cheap-but-convincing
 *  simulation games actually ship:
 *
 *    - impulse-based integration with gravity and a ground plane,
 *    - restitution and friction from the material,
 *    - angular velocity from the impact impulse applied at the fragment's
 *      centroid offset, so pieces spin the way they were hit,
 *    - sleeping, so a settled pile costs nothing.
 *
 *  It deliberately does NOT do fragment-fragment collision resolution. Real
 *  games do not either, at this count: they rely on the pieces flying apart
 *  fast enough that interpenetration is never observed, and they spend the
 *  budget on the *initial velocities* being right — which is where the
 *  realism actually comes from, because the eye reads the fragment *trajectory*
 *  distribution, not the contact resolution.
 * ============================================================================
 */

import {
  BufferAttribute, BufferGeometry, Group, Mesh, Object3D, ShaderMaterial, Vector3,
} from 'three';
import type { FragmentMesh } from '../fracture/Carver.ts';

export interface FragmentBody {
  mesh: Mesh;
  /** Centre of mass in world space. */
  position: Vector3;
  velocity: Vector3;
  /** Orientation as a quaternion (x,y,z,w). */
  orientation: number[];
  angularVelocity: Vector3;
  mass: number;
  inverseMass: number;
  inertia: [number, number, number];
  radius: number;
  sleeping: boolean;
  /** Restitution / friction, from the material. */
  restitution: number;
  friction: number;
  /** Distance from the impact point at spawn — used for the impulse falloff. */
  spawnDistance: number;
}

const GRAVITY = -9.81;

export class FragmentSystem {
  readonly group = new Group();
  readonly bodies: FragmentBody[] = [];
  private readonly groundY: number;
  private readonly material: ShaderMaterial;
  private simTime = 0;
  /** Speed below which a body is allowed to sleep. */
  private readonly sleepThreshold = 0.06;

  constructor(groundY: number, material: ShaderMaterial) {
    this.groundY = groundY;
    this.material = material;
  }

  /**
   * Spawn bodies from carved fragments.
   *
   * `impactPoint` and `impactEnergy` set the initial velocity field. Fragments
   * near the impact get thrown hard; distant ones barely move until something
   * hits them. The 1/r falloff plus a small random component per fragment is
   * what makes a break read as a break instead of as an explosion.
   */
  spawn(
    fragments: FragmentMesh[],
    impactPoint: [number, number, number],
    impactDirection: [number, number, number],
    impactEnergy: number,
    restitution: number,
    friction: number,
    vRandom: number,
  ): void {
    this.clear();
    const dLen = Math.hypot(impactDirection[0], impactDirection[1], impactDirection[2]) || 1;
    const dx = impactDirection[0] / dLen, dy = impactDirection[1] / dLen, dz = impactDirection[2] / dLen;

    // convert "impact energy" into a characteristic velocity for the field
    const totalMass = fragments.reduce((a, f) => a + f.mass, 0) || 1;
    const vChar = Math.min(14, Math.sqrt(Math.max(0, impactEnergy) / (0.5 * totalMass)) );

    for (const f of fragments) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(f.positions, 3));
      geo.setAttribute('normal', new BufferAttribute(f.normals, 3));
      geo.setAttribute('aFaceKind', new BufferAttribute(f.faceKind, 1));
      geo.setAttribute('aCrackRadial', new BufferAttribute(f.crackRadial, 1));
      geo.setAttribute('aCrackId', new BufferAttribute(f.crackId, 1));
      // per-fragment random so the shader can vary across a pile
      const seed = new Float32Array(f.positions.length / 3);
      const r = Math.abs(Math.sin(f.centroid[0] * 12.9898 + f.centroid[1] * 78.233 + f.centroid[2] * 37.719));
      seed.fill(r);
      geo.setAttribute('aNormalSeed', new BufferAttribute(seed, 1));
      geo.computeBoundingSphere();

      const mesh = new Mesh(geo, this.material);
      mesh.frustumCulled = true;
      const pos = new Vector3(f.centroid[0], f.centroid[1], f.centroid[2]);
      mesh.position.copy(pos);
      this.group.add(mesh);

      // impact falloff
      const dpx = pos.x - impactPoint[0];
      const dpy = pos.y - impactPoint[1];
      const dpz = pos.z - impactPoint[2];
      const dist = Math.max(0.02, Math.hypot(dpx, dpy, dpz));
      const falloff = Math.min(1, 0.12 / dist);
      const v = vChar * falloff;

      // spin about the axis perpendicular to (r, impulse) — the torque a
      // real impact applies
      const rx = dpx / dist, ry = dpy / dist, rz = dpz / dist;
      let ax = ry * dz - rz * dy;
      let ay = rz * dx - rx * dz;
      let az = rx * dy - ry * dx;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;
      const spin = (v / Math.max(0.02, f.radius)) * 0.35;

      const body: FragmentBody = {
        mesh,
        position: pos,
        velocity: new Vector3(
          dx * v + (Math.random() - 0.5) * vRandom,
          dy * v + (Math.random() - 0.5) * vRandom + v * 0.15,
          dz * v + (Math.random() - 0.5) * vRandom,
        ),
        orientation: [0, 0, 0, 1],
        angularVelocity: new Vector3(ax * spin, ay * spin, az * spin),
        mass: f.mass,
        inverseMass: 1 / Math.max(1e-6, f.mass),
        inertia: f.inertia,
        radius: f.radius,
        sleeping: false,
        restitution,
        friction,
        spawnDistance: dist,
      };
      this.bodies.push(body);
    }
  }

  clear(): void {
    for (const b of this.bodies) {
      b.mesh.geometry.dispose();
      this.group.remove(b.mesh);
    }
    this.bodies.length = 0;
    this.simTime = 0;
  }

  get activeCount(): number {
    let n = 0;
    for (const b of this.bodies) if (!b.sleeping) n++;
    return n;
  }

  step(dt: number): void {
    this.simTime += dt;
    const h = Math.min(dt, 1 / 60);
    for (const b of this.bodies) {
      if (b.sleeping) continue;

      b.velocity.y += GRAVITY * h;

      b.position.x += b.velocity.x * h;
      b.position.y += b.velocity.y * h;
      b.position.z += b.velocity.z * h;

      // integrate orientation from the angular velocity (first order, plenty
      // for tumbling debris)
      const w = b.angularVelocity;
      const wl = w.length();
      if (wl > 1e-6) {
        const half = wl * h * 0.5;
        const s = Math.sin(half) / wl;
        const qx = w.x * s, qy = w.y * s, qz = w.z * s, qw = Math.cos(half);
        const [ox, oy, oz, ow] = b.orientation;
        b.orientation = [
          qw * ox + qx * ow + qy * oz - qz * oy,
          qw * oy - qx * oz + qy * ow + qz * ox,
          qw * oz + qx * oy - qy * ox + qz * ow,
          qw * ow - qx * ox - qy * oy - qz * oz,
        ];
        const ql = Math.hypot(...b.orientation) || 1;
        for (let i = 0; i < 4; i++) b.orientation[i] /= ql;
      }

      // ---- ground contact ------------------------------------------------
      // Treat each body as a sphere of its bounding radius: cheap, stable, and
      // at fragment scale indistinguishable from proper contact resolution.
      const floor = this.groundY + b.radius * 0.75;
      if (b.position.y < floor) {
        b.position.y = floor;
        if (b.velocity.y < 0) {
          const bounce = -b.velocity.y * b.restitution;
          b.velocity.y = bounce;
          // friction on the tangential component
          const damp = Math.max(0, 1 - b.friction * 1.6);
          b.velocity.x *= damp;
          b.velocity.z *= damp;
          // convert some linear motion into spin so pieces roll instead of slide
          b.angularVelocity.x += (Math.random() - 0.5) * Math.abs(b.velocity.z) * 2;
          b.angularVelocity.z += (Math.random() - 0.5) * Math.abs(b.velocity.x) * 2;
        }
        b.angularVelocity.multiplyScalar(1 - Math.min(0.9, b.friction * 1.2));
        if (b.velocity.lengthSq() < this.sleepThreshold * this.sleepThreshold && b.angularVelocity.lengthSq() < 0.5) {
          b.sleeping = true;
          b.velocity.set(0, 0, 0);
          b.angularVelocity.set(0, 0, 0);
          // lay flat: snap the smallest axis to vertical so a settled pile
          // looks like a pile
          b.orientation = [0, 0, 0, 1];
        }
      }

      // air drag
      b.velocity.multiplyScalar(1 - 0.02 * h * 60 * 0.02);
      b.angularVelocity.multiplyScalar(1 - 0.4 * h);

      b.mesh.position.copy(b.position);
      b.mesh.quaternion.set(b.orientation[0], b.orientation[1], b.orientation[2], b.orientation[3]);
    }
  }

  /** Apply a shockwave to all bodies (used by the "smash again" action). */
  applyShock(center: [number, number, number], strength: number): void {
    for (const b of this.bodies) {
      const dx = b.position.x - center[0];
      const dy = b.position.y - center[1];
      const dz = b.position.z - center[2];
      const d = Math.max(0.03, Math.hypot(dx, dy, dz));
      const f = (strength / d) * 0.02;
      b.sleeping = false;
      b.velocity.x += (dx / d) * f;
      b.velocity.y += (dy / d) * f + f * 0.4;
      b.velocity.z += (dz / d) * f;
      b.angularVelocity.x += (Math.random() - 0.5) * f * 8;
      b.angularVelocity.z += (Math.random() - 0.5) * f * 8;
    }
  }
}
