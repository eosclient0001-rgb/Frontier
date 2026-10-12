// Orientation-safe triangle helpers. Each triangle is flipped, if needed, so its normal agrees
// with a supplied "want" direction; pieces built with these are visible from their intended side
// regardless of the order their vertices are supplied in.
export function tri(out, mat, a, b, c, want) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
  const B = flip ? c : b, C = flip ? b : c;
  const pc = out.piece(mat), base = pc.p.length / 3;
  out.vert(pc, a[0], a[1], a[2], a[0], a[2]);
  out.vert(pc, B[0], B[1], B[2], B[0], B[2]);
  out.vert(pc, C[0], C[1], C[2], C[0], C[2]);
  pc.i.push(base, base + 1, base + 2);
}
export function quad(out, mat, p0, p1, p2, p3, want) {
  tri(out, mat, p0, p1, p2, want);
  tri(out, mat, p0, p2, p3, want);
}
