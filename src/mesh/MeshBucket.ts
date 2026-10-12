// Accumulates triangles for one material. Every builder writes into buckets; the world is assembled once
// per edit into a handful of BufferGeometries (one draw call per material).

import * as THREE from "three";

export type V3 = [number, number, number];
export type RGB = [number, number, number];

const UP: V3 = [0, 1, 0];

export class MeshBucket {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  get isEmpty(): boolean {
    return this.idx.length === 0;
  }

  vertex(p: V3, n: V3, c: RGB): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  // Quad given in ring order. `normal` is the intended facing; the winding is flipped when needed to match it.
  quad(p0: V3, p1: V3, p2: V3, p3: V3, normal: V3 = UP, c0: RGB, c1: RGB = c0, c2: RGB = c0, c3: RGB = c0): void {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    const facing = gx * normal[0] + gy * normal[1] + gz * normal[2];
    const n = normalise(normal);
    if (facing >= 0) {
      const a = this.vertex(p0, n, c0);
      const b = this.vertex(p1, n, c1);
      const c = this.vertex(p2, n, c2);
      const d = this.vertex(p3, n, c3);
      this.tri(a, b, c);
      this.tri(a, c, d);
    } else {
      const a = this.vertex(p0, n, c0);
      const d = this.vertex(p3, n, c3);
      const c = this.vertex(p2, n, c2);
      const b = this.vertex(p1, n, c1);
      this.tri(a, d, c);
      this.tri(a, c, b);
    }
  }

  // Triangle fan-free polygon (ring must be simple). Triangulated by the caller (earcut).
  triangles(ring: { x: number; z: number; y: number; c: RGB }[], triIdx: number[], normal: V3 = UP): void {
    const base = this.pos.length / 3;
    const n = normalise(normal);
    for (const v of ring) this.vertex([v.x, v.y, v.z], n, v.c);
    for (let i = 0; i < triIdx.length; i += 3) this.tri(base + triIdx[i], base + triIdx[i + 1], base + triIdx[i + 2]);
  }

  // Oriented box given by eight corners (bottom 0..3, top 4..7, each ring counter-clockwise seen from above).
  // Face normals are taken from the box centre, so every face faces outward regardless of corner order.
  box(corners: V3[], color: RGB): void {
    const [b0, b1, b2, b3, t0, t1, t2, t3] = corners;
    const centre: V3 = [0, 0, 0];
    for (const c of corners) {
      centre[0] += c[0] / 8;
      centre[1] += c[1] / 8;
      centre[2] += c[2] / 8;
    }
    const outward = (a: V3, b: V3, c: V3, d: V3): V3 => {
      const m: V3 = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
      return normalise([m[0] - centre[0], m[1] - centre[1], m[2] - centre[2]]);
    };
    this.quad(t0, t1, t2, t3, outward(t0, t1, t2, t3), color);
    this.quad(b3, b2, b1, b0, outward(b0, b1, b2, b3), color);
    this.quad(b0, b1, t1, t0, outward(b0, b1, t1, t0), color);
    this.quad(b1, b2, t2, t1, outward(b1, b2, t2, t1), color);
    this.quad(b2, b3, t3, t2, outward(b2, b3, t3, t2), color);
    this.quad(b3, b0, t0, t3, outward(b3, b0, t0, t3), color);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export class BucketSet {
  private map = new Map<string, MeshBucket>();

  get(key: string): MeshBucket {
    let b = this.map.get(key);
    if (!b) {
      b = new MeshBucket();
      this.map.set(key, b);
    }
    return b;
  }

  entries(): [string, MeshBucket][] {
    return [...this.map.entries()].filter(([, b]) => !b.isEmpty);
  }
}

export function normalise(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}

export function faceNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return normalise([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
}

export function add3(a: V3, b: V3, k = 1): V3 {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

export function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
