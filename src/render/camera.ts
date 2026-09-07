/** Minimal column-major 4x4 math (matches WGSL mat4x4f memory layout). */
export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4, out = new Float32Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function mat4Invert(m: Mat4, out = new Float32Array(16)): Mat4 {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4Identity();
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export function lookAt(eye: number[], center: number[], up: number[]): Mat4 {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

/** Orbit camera with pan and zoom. */
export class OrbitCamera {
  target: [number, number, number];
  distance: number;
  yaw: number;   // radians
  pitch: number; // radians
  fov = (52 * Math.PI) / 180;
  near = 0.5;
  far = 6000;

  constructor(target: [number, number, number], distance: number, yaw = 0.7, pitch = -0.26) {
    this.target = target;
    this.distance = distance;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  get position(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] - this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  get forward(): [number, number, number] {
    const p = this.position;
    const d: [number, number, number] = [
      this.target[0] - p[0], this.target[1] - p[1], this.target[2] - p[2],
    ];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.006));
  }

  pan(dx: number, dy: number) {
    const f = this.forward;
    // Right vector = normalize(cross(f, worldUp))
    let rx = f[2], rz = -f[0];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    // Camera up = cross(right, forward)
    const ux = -rz * f[1];
    const uy = rz * f[0] - rx * f[2];
    const uz = rx * f[1];

    const s = this.distance * 0.0016;
    this.target[0] += (-rx * dx + ux * dy) * s;
    this.target[1] += (uy * dy) * s;
    this.target[2] += (-rz * dx + uz * dy) * s;
  }

  zoom(delta: number) {
    this.distance = Math.max(6, Math.min(4000, this.distance * Math.exp(delta * 0.0014)));
  }

  viewProj(aspect: number): Mat4 {
    const view = lookAt(this.position, this.target, [0, 1, 0]);
    const proj = perspective(this.fov, aspect, this.near, this.far);
    return mat4Multiply(proj, view);
  }

  /** Fill the camera uniform buffer layout used by render.wgsl. */
  writeUniform(out: Float32Array, aspect: number, width: number, height: number, time: number, frame: number) {
    const vp = this.viewProj(aspect);
    const inv = mat4Invert(vp);
    out.set(inv, 0);
    const p = this.position;
    out[16] = p[0]; out[17] = p[1]; out[18] = p[2]; out[19] = 1;
    const f = this.forward;
    out[20] = f[0]; out[21] = f[1]; out[22] = f[2]; out[23] = 0;
    out[24] = width; out[25] = height; out[26] = time; out[27] = frame;
  }

  /** Unproject a pixel into a world-space ray direction. */
  rayFromPixel(px: number, py: number, width: number, height: number): [number, number, number] {
    const vp = this.viewProj(width / height);
    const inv = mat4Invert(vp);
    const ndcX = (px / width) * 2 - 1;
    const ndcY = 1 - (py / height) * 2;
    const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * 1 + inv[12];
    const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * 1 + inv[13];
    const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * 1 + inv[14];
    const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * 1 + inv[15];
    const p = this.position;
    let dx = x / w - p[0], dy = y / w - p[1], dz = z / w - p[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return [dx / l, dy / l, dz / l];
  }
}
