// Accumulates quads / boxes / arbitrary geometry into merged BufferGeometries, one per
// material key. Keeps draw-call counts low: a whole road section is ~5 meshes.
import * as THREE from 'three';

export class GeoBuilder {
  constructor() {
    this.buckets = new Map();
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) {
      b = { p: [], n: [], uv: [], c: [], idx: [], base: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Quad with explicit corners p0..p3 (any winding; material is double-sided).
   * uv is projected onto tangents tu/tv (metres) and divided by uvScale for tiling textures.
   */
  quad(key, p0, p1, p2, p3, n, col, uvScale = 0, tu = null, tv = null) {
    const b = this._bucket(key);
    const pts = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      b.p.push(p[0], p[1], p[2]);
      b.n.push(n[0], n[1], n[2]);
      b.c.push(col[0], col[1], col[2]);
      if (uvScale && tu && tv) {
        b.uv.push(
          (p[0] * tu[0] + p[1] * tu[1] + p[2] * tu[2]) / uvScale,
          (p[0] * tv[0] + p[1] * tv[1] + p[2] * tv[2]) / uvScale,
        );
      } else {
        b.uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
      }
    }
    const o = b.base;
    b.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    b.base += 4;
  }

  /** Axis-aligned box rotated about Y. fx/fz = forward unit vector; box length along fwd, width across. */
  box(key, cx, cy, cz, hx, hy, hz, fx, fz, col, uvScale = 0) {
    const rx = -fz;
    const rz = fx;
    const up = [0, 1, 0];
    const c = [cx, cy, cz];
    const at = (i, j, k) => [
      c[0] + fx * hx * i + rx * hz * j,
      c[1] + hy * k,
      c[2] + fz * hx * i + rz * hz * j,
    ];
    const F = [fx, 0, fz];
    const R = [rx, 0, rz];
    const Rn = [-rx, 0, -rz];
    const Fn = [-fx, 0, -fz];
    const U = up;
    const D = [0, -1, 0];
    // +forward / -forward faces
    this.quad(key, at(1, -1, -1), at(1, 1, -1), at(1, 1, 1), at(1, -1, 1), F, col, uvScale, R, U);
    this.quad(key, at(-1, 1, -1), at(-1, -1, -1), at(-1, -1, 1), at(-1, 1, 1), Fn, col, uvScale, R, U);
    // +right / -right faces
    this.quad(key, at(-1, 1, -1), at(1, 1, -1), at(1, 1, 1), at(-1, 1, 1), R, col, uvScale, F, U);
    this.quad(key, at(1, -1, -1), at(-1, -1, -1), at(-1, -1, 1), at(1, -1, 1), Rn, col, uvScale, F, U);
    // top / bottom
    this.quad(key, at(-1, -1, 1), at(1, -1, 1), at(1, 1, 1), at(-1, 1, 1), U, col, uvScale, F, R);
    this.quad(key, at(-1, -1, -1), at(-1, 1, -1), at(1, 1, -1), at(1, -1, -1), D, col, uvScale, F, R);
  }

  /** Add an arbitrary (non-indexed or indexed) three.js geometry transformed by matrix. */
  geometry(key, geom, matrix, col) {
    const b = this._bucket(key);
    const g = geom.index ? geom.toNonIndexed() : geom;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const m = matrix;
    const v = new THREE.Vector3();
    const nv = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      b.p.push(v.x, v.y, v.z);
      if (nor) {
        nv.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        b.n.push(nv.x, nv.y, nv.z);
      } else b.n.push(0, 1, 0);
      b.c.push(col[0], col[1], col[2]);
      b.uv.push(0, 0);
      b.idx.push(b.base + i);
    }
    b.base += pos.count;
  }

  isEmpty() {
    for (const b of this.buckets.values()) if (b.p.length) return false;
    return true;
  }

  /** Returns Map<key, BufferGeometry> for every non-empty bucket. */
  build() {
    const out = new Map();
    for (const [key, b] of this.buckets) {
      if (!b.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.setIndex(b.idx.length > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      out.set(key, g);
    }
    return out;
  }
}
