// Minimal linear algebra for the cloth studio (column-major, WebGPU convention).

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- vec3 (plain arrays)
export const v3 = {
  make: (x = 0, y = 0, z = 0) => [x, y, z],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  lerp: (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
};

// ---------------------------------------------------------------- mat4
export const m4 = {
  identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },

  mul(a, b, out = new Float32Array(16)) {
    // out = a * b
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  },

  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f;
    o[10] = far * nf; o[11] = -1;
    o[14] = far * near * nf;
    return o;
  },

  ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = 1 / (n - f);
    o[12] = (r + l) / (l - r); o[13] = (t + b) / (b - t); o[14] = n / (n - f);
    o[15] = 1;
    return o;
  },

  lookAt(eye, center, up) {
    const z = v3.norm(v3.sub(eye, center));
    let x = v3.cross(up, z);
    if (v3.len(x) < 1e-6) x = v3.cross([0, 0, 1], z);
    x = v3.norm(x);
    const y = v3.cross(z, x);
    const o = new Float32Array(16);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -v3.dot(x, eye); o[13] = -v3.dot(y, eye); o[14] = -v3.dot(z, eye); o[15] = 1;
    return o;
  },

  translate(t) {
    const o = m4.identity();
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2];
    return o;
  },

  scale(s) {
    const o = m4.identity();
    o[0] = s[0]; o[5] = s[1]; o[10] = s[2];
    return o;
  },

  // Normal matrix (inverse-transpose of the upper 3x3), stored as mat4.
  normalMatrix(model) {
    const a = model;
    const a00 = a[0], a01 = a[1], a02 = a[2];
    const a10 = a[4], a11 = a[5], a12 = a[6];
    const a20 = a[8], a21 = a[9], a22 = a[10];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    const det = a00 * b01 + a01 * b11 + a02 * b21;
    const id = det ? 1 / det : 0;
    const o = new Float32Array(16);
    o[0] = b01 * id;
    o[1] = (-a22 * a01 + a02 * a21) * id;
    o[2] = (a12 * a01 - a02 * a11) * id;
    o[4] = b11 * id;
    o[5] = (a22 * a00 - a02 * a20) * id;
    o[6] = (-a12 * a00 + a02 * a10) * id;
    o[8] = b21 * id;
    o[9] = (-a21 * a00 + a01 * a20) * id;
    o[10] = (a11 * a00 - a01 * a10) * id;
    o[15] = 1;
    return o;
  },
};

// ---------------------------------------------------------------- intersection helpers
export function rayPlane(origin, dir, planeY) {
  const t = (planeY - origin[1]) / (dir[1] || 1e-6);
  return t > 0 ? [origin[0] + dir[0] * t, planeY, origin[2] + dir[2] * t] : null;
}

// Closest approach between a ray and a point; returns { t, dist } along the ray.
export function rayPointDistance(origin, dir, p) {
  const w = v3.sub(p, origin);
  const t = v3.dot(w, dir);
  const closest = v3.add(origin, v3.scale(dir, t));
  return { t, dist: v3.len(v3.sub(p, closest)) };
}
