// World-axis rotations stored as XYZ Euler angles with R = Rz * Ry * Rx.
const rad = Math.PI / 180,
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rotateVector(v, axis, angle) {
  const out = [...v],
    i = (axis + 1) % 3,
    j = (axis + 2) % 3,
    c = Math.cos(angle),
    s = Math.sin(angle);
  out[i] = c * v[i] - s * v[j];
  out[j] = s * v[i] + c * v[j];
  return out;
}
export function rotationMatrix(degrees = [0, 0, 0]) {
  const cols = [0, 1, 2].map((k) => {
    let v = [0, 0, 0];
    v[k] = 1;
    for (let a = 0; a < 3; a++) v = rotateVector(v, a, degrees[a] * rad);
    return v;
  });
  return [0, 1, 2].map((r) => cols.map((c) => c[r]));
}
export function rotateEuler(degrees, axis, angle) {
  const m = rotationMatrix(degrees),
    columns = [0, 1, 2].map((k) =>
      rotateVector(
        m.map((row) => row[k]),
        axis,
        angle,
      ),
    ),
    r = [0, 1, 2].map((k) => columns.map((c) => c[k])),
    y = Math.asin(clamp(-r[2][0], -1, 1));
  const x = Math.abs(Math.cos(y)) > 1e-6 ? Math.atan2(r[2][1], r[2][2]) : 0,
    z =
      Math.abs(Math.cos(y)) > 1e-6
        ? Math.atan2(r[1][0], r[0][0])
        : Math.atan2(-r[0][1], r[1][1]);
  return [x, y, z].map((v) => v / rad);
}
export function rayPlaneAngle(ray, pivot, axis) {
  const den = ray.direction[axis];
  if (Math.abs(den) < 0.025) return null;
  const t = (pivot[axis] - ray.origin[axis]) / den;
  if (t < 0) return null;
  const i = (axis + 1) % 3,
    j = (axis + 2) % 3,
    u = ray.origin[i] + t * ray.direction[i] - pivot[i],
    v = ray.origin[j] + t * ray.direction[j] - pivot[j];
  return Math.hypot(u, v) < 0.05 ? null : Math.atan2(v, u);
}
export function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
