// Tiny vector / matrix helpers (column-major mat4, WebGL convention).
// No dependencies, no allocation-heavy hot paths.

export const V3 = {
  make: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
  set: (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add: (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub: (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale: (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  addScaled: (o, a, b, s) => { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (o, a, b) => {
    const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx; return o;
  },
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (o, a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o;
  },
  lerp: (o, a, b, t) => {
    o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o;
  },
};

export const M4 = {
  ident: (o) => {
    o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o;
  },
  make: () => { const o = new Float32Array(16); M4.ident(o); return o; },
  mul: (o, a, b) => { // o = a * b
    const t = M4._tmp || (M4._tmp = new Float32Array(16));
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        t[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    o.set(t); return o;
  },
  perspective: (o, fovyRad, aspect, near, far) => {
    const f = 1 / Math.tan(fovyRad / 2);
    o.fill(0);
    o[0] = f / aspect; o[5] = f;
    o[10] = (far + near) / (near - far); o[11] = -1;
    o[14] = (2 * far * near) / (near - far);
    return o;
  },
  lookAt: (o, eye, center, up) => {
    const z = V3.norm(new Float32Array(3), V3.sub(new Float32Array(3), eye, center));
    const x = V3.norm(new Float32Array(3), V3.cross(new Float32Array(3), up, z));
    const y = V3.cross(new Float32Array(3), z, x);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -V3.dot(x, eye); o[13] = -V3.dot(y, eye); o[14] = -V3.dot(z, eye); o[15] = 1;
    return o;
  },
  translate: (o, x, y, z) => { M4.ident(o); o[12] = x; o[13] = y; o[14] = z; return o; },
  rotY: (o, a) => {
    M4.ident(o); const c = Math.cos(a), s = Math.sin(a);
    o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o;
  },
  rotZ: (o, a) => {
    M4.ident(o); const c = Math.cos(a), s = Math.sin(a);
    o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o;
  },
  rotX: (o, a) => {
    M4.ident(o); const c = Math.cos(a), s = Math.sin(a);
    o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o;
  },
  compose: (o, pos, yaw, pitch, roll, scale = 1) => {
    // T * Ry * Rx * Rz * S  — yaw (around Y), pitch (around X), roll (around Z)
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cx = Math.cos(pitch), sx = Math.sin(pitch);
    const cz = Math.cos(roll), sz = Math.sin(roll);
    // R = Ry*Rx*Rz
    const r00 = cy * cz + sy * sx * sz, r01 = cx * sz, r02 = -sy * cz + cy * sx * sz;
    const r10 = -cy * sz + sy * sx * cz, r11 = cx * cz, r12 = sy * sz + cy * sx * cz;
    const r20 = sy * cx, r21 = -sx, r22 = cy * cx;
    o[0] = r00 * scale; o[1] = r01 * scale; o[2] = r02 * scale; o[3] = 0;
    o[4] = r10 * scale; o[5] = r11 * scale; o[6] = r12 * scale; o[7] = 0;
    o[8] = r20 * scale; o[9] = r21 * scale; o[10] = r22 * scale; o[11] = 0;
    o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2]; o[15] = 1;
    return o;
  },
  transformPoint: (o, m, p) => {
    const x = p[0], y = p[1], z = p[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return o;
  },
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sech2 = (x) => { const c = Math.cosh(clamp(x, -20, 20)); return 1 / (c * c); };
// framerate-independent exponential smoothing
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
