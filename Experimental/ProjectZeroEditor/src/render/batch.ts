/**
 * Triangle batch with per-vertex colour, used to merge all road geometry of a
 * world chunk into one draw call. Flat shaded: every triangle gets its own
 * normal, which suits road markings and kerbs.
 */
export type Vec3 = [number, number, number];

export class MeshBatch {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  isEmpty(): boolean {
    return this.positions.length === 0;
  }

  /** Adds one triangle. Normal is derived from winding; materials are double sided. */
  tri(a: Vec3, b: Vec3, c: Vec3, colour: number): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return; // degenerate sliver, skip
    nx /= l;
    ny /= l;
    nz /= l;
    const r = ((colour >> 16) & 255) / 255;
    const g = ((colour >> 8) & 255) / 255;
    const bl = (colour & 255) / 255;
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(r, g, bl);
    }
  }

  /** Quad a-b-c-d (counter-clockwise or not; double sided). */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: number): void {
    this.tri(a, b, c, colour);
    this.tri(a, c, d, colour);
  }

  /**
   * Axis-aligned-in-local-frame box. `f` is the forward unit vector on the XZ
   * plane, `r` is right, `up` is +Y. Sizes are full extents along r, up and f.
   */
  orientedBox(
    centre: Vec3,
    f: [number, number],
    size: { r: number; up: number; f: number },
    colour: number,
  ): void {
    const [cx, cy, cz] = centre;
    const rx = f[1];
    const rz = -f[0];
    const hr = size.r / 2;
    const hu = size.up / 2;
    const hf = size.f / 2;
    const corner = (sr: number, su: number, sf: number): Vec3 => [
      cx + rx * hr * sr + f[0] * hf * sf,
      cy + hu * su,
      cz + rz * hr * sr + f[1] * hf * sf,
    ];
    // Corners indexed by (sr, su, sf) in {-1,1}^3.
    const p = {
      nnn: corner(-1, -1, -1),
      pnn: corner(1, -1, -1),
      npn: corner(-1, 1, -1),
      ppn: corner(1, 1, -1),
      nnp: corner(-1, -1, 1),
      pnp: corner(1, -1, 1),
      npp: corner(-1, 1, 1),
      ppp: corner(1, 1, 1),
    };
    this.quad(p.npn, p.ppn, p.ppp, p.npp, colour); // top
    this.quad(p.nnn, p.nnp, p.pnp, p.pnn, colour); // bottom
    this.quad(p.nnp, p.npp, p.ppp, p.pnp, colour); // front (+f)
    this.quad(p.nnn, p.pnn, p.ppn, p.npn, colour); // back (-f)
    this.quad(p.pnn, p.pnp, p.ppp, p.ppn, colour); // right (+r)
    this.quad(p.nnn, p.npn, p.npp, p.nnp, colour); // left (-r)
  }

  /** Vertical prism with `sides` faces, base at `y0`. */
  cylinder(centre: Vec3, radius: number, height: number, sides: number, colour: number): void {
    const [cx, cy, cz] = centre;
    const ring = (k: number, y: number): Vec3 => {
      const a = (k / sides) * Math.PI * 2;
      return [cx + Math.cos(a) * radius, cy + y, cz + Math.sin(a) * radius];
    };
    for (let k = 0; k < sides; k++) {
      const a0 = ring(k, 0);
      const a1 = ring(k + 1, 0);
      const b0 = ring(k, height);
      const b1 = ring(k + 1, height);
      this.quad(a0, a1, b1, b0, colour);
      this.tri([cx, cy + height, cz], b0, b1, colour);
    }
  }

  /** Appends another batch (used when merging per-entity batches). */
  append(other: MeshBatch): void {
    for (const v of other.positions) this.positions.push(v);
    for (const v of other.normals) this.normals.push(v);
    for (const v of other.colors) this.colors.push(v);
  }
}
