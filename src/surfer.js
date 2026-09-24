// The surfer: a lofted shortboard + a simple articulated rider, posed
// procedurally from ride state (lean, crouch, tuck, arms).

import { compileProgram, createMesh, drawMesh } from './gl.js';
import { M4, V3, lerp, clamp } from './math.js';

export const SURFER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vN;
out vec3 vWorld;
out vec3 vColor;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vN = mat3(uModel) * aNormal;
  vColor = aColor;
  gl_Position = uVP * w;
}`;

export const SURFER_FS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vWorld;
in vec3 vColor;
out vec4 fragColor;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform float uSpec;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float lam = 0.35 + 0.75 * max(dot(N, uSunDir), 0.0);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 40.0) * uSpec;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.25;
  vec3 col = vColor * lam + vec3(1.0, 0.95, 0.85) * spec + vec3(0.5, 0.8, 0.9) * rim;
  fragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
//  geometry builders (accumulated into pos/normal/color arrays)
// ---------------------------------------------------------------------------
function pushTri(A, out, flip = false) {
  const [a, b, c] = flip ? [A[0], A[2], A[1]] : A;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  for (const p of [a, b, c]) {
    out.pos.push(p[0], p[1], p[2]);
    out.nrm.push(nx, ny, nz);
    out.col.push(...out.color);
  }
}

function buildBox(out, sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const v = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  const quads = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  for (const [a, b, c, d] of quads) {
    pushTri([v[a], v[b], v[c]], out);
    pushTri([v[a], v[c], v[d]], out);
  }
}

function buildCapsule(out, r, h, axis = 'y') {
  // 6-sided capsule; good enough for limbs at game scale
  const n = 6, half = h / 2;
  const ring = (t) => {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const u = Math.cos(a) * r, w = Math.sin(a) * r;
      const s = t - 0.5;
      const bulge = Math.sqrt(Math.max(0, 1 - Math.min(1, (s * 2) ** 2) )) * r * 0.35;
      if (axis === 'y') arr.push([u * (1 + bulge / r * 0.3), s * h, w * (1 + bulge / r * 0.3)]);
      else if (axis === 'x') arr.push([s * h, u * (1 + bulge / r * 0.3), w * (1 + bulge / r * 0.3)]);
      else arr.push([u * (1 + bulge / r * 0.3), w * (1 + bulge / r * 0.3), s * h]);
    }
    return arr;
  };
  const r0 = ring(0.06), r1 = ring(0.5), r2 = ring(0.94);
  for (const [p, q] of [[r0, r1], [r1, r2]]) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pushTri([p[i], p[j], q[j]], out);
      pushTri([p[i], q[j], q[i]], out);
    }
  }
  // caps
  const tip0 = axis === 'y' ? [0, -half - r * 0.55, 0] : axis === 'x' ? [-half - r * 0.55, 0, 0] : [0, 0, -half - r * 0.55];
  const tip1 = axis === 'y' ? [0, half + r * 0.55, 0] : axis === 'x' ? [half + r * 0.55, 0, 0] : [0, 0, half + r * 0.55];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushTri([tip0, r0[j], r0[i]], out);
    pushTri([tip1, r2[i], r2[j]], out);
  }
}

function buildBoard(out) {
  // lofted shortboard: squash-ellipse outline + rocker, 3 fins
  const NS = 13, NA = 12, L = 2.05, Wd = 0.52, TH = 0.075;
  const outline = (s) => {
    // s in [0,1] tail->nose
    const e = 1 - Math.abs(s - 0.56) / 0.56;
    return Math.max(0.02, Wd * Math.pow(Math.sin(Math.PI * clamp(e * 1.15, 0, 1)), 0.65));
  };
  const rocker = (s) => 0.085 * Math.pow(Math.abs(s - 0.42) * 2, 2.6) * L * 0.5;
  const thick = (s) => TH * (0.35 + 0.65 * Math.sin(Math.PI * clamp(s * 1.05, 0, 1)) ** 0.8);
  const rings = [];
  for (let i = 0; i < NS; i++) {
    const s = i / (NS - 1);
    const y = rocker(s);
    const x = (s - 0.5) * L;
    const hw = outline(s), ht = thick(s);
    const ring = [];
    for (let a = 0; a < NA; a++) {
      const th = (a / NA) * Math.PI * 2;
      ring.push([x, y + Math.sin(th) * ht, Math.cos(th) * hw * (Math.abs(Math.cos(th)) > 0.7 ? 0.72 : 1)]);
    }
    rings.push(ring);
  }
  for (let i = 0; i < NS - 1; i++) {
    for (let a = 0; a < NA; a++) {
      const b = (a + 1) % NA;
      pushTri([rings[i][a], rings[i][b], rings[i + 1][b]], out);
      pushTri([rings[i][a], rings[i + 1][b], rings[i + 1][a]], out);
    }
  }
  out.color = [0.1, 0.1, 0.12];
  // fins (3)
  for (const [fx, fz] of [[-0.78, 0], [-0.72, 0.16], [-0.72, -0.16]]) {
    const f = [[fx - 0.1, 0, fz], [fx + 0.08, 0, fz], [fx + 0.02, -0.16, fz]];
    pushTri(f, out);
    pushTri(f, out, true);
  }
}

// board mesh: one static mesh (pos=board local space)
// rider mesh: a set of named parts (boxes/capsules) with own meshes + poses
function makeMesh(gl, data) {
  const n = data.pos.length / 3;
  const verts = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    verts[i * 9 + 0] = data.pos[i * 3]; verts[i * 9 + 1] = data.pos[i * 3 + 1]; verts[i * 9 + 2] = data.pos[i * 3 + 2];
    verts[i * 9 + 3] = data.nrm[i * 3]; verts[i * 9 + 4] = data.nrm[i * 3 + 1]; verts[i * 9 + 5] = data.nrm[i * 3 + 2];
    verts[i * 9 + 6] = data.col[i * 3]; verts[i * 9 + 7] = data.col[i * 3 + 1]; verts[i * 9 + 8] = data.col[i * 3 + 2];
  }
  return createMesh(gl, {
    vertices: verts,
    attributes: [
      { name: 'aPos', size: 3, offset: 0, loc: 0 },
      { name: 'aNormal', size: 3, offset: 3, loc: 1 },
      { name: 'aColor', size: 3, offset: 6, loc: 2 },
    ],
  });
}

export class Surfer {
  constructor(gl) {
    this.gl = gl;
    this.prog = compileProgram(gl, SURFER_VS, SURFER_FS, 'surfer');
    // board: white deck + teal stripe
    const board = { pos: [], nrm: [], col: [], color: [0.95, 0.95, 0.96] };
    buildBoard(board);
    // stripe: rebuild middle rings with color... simpler: tint by painting a few
    // tris after: draw a separate thin stripe box on the deck
    const stripe = { pos: [], nrm: [], col: [], color: [0.1, 0.55, 0.6] };
    buildBox(stripe, 1.2, 0.01, 0.2);
    this.boardMesh = makeMesh(gl, board);
    this.stripeMesh = makeMesh(gl, stripe);

    // rider parts (dark wetsuit + skin)
    const suit = [0.07, 0.08, 0.1], skin = [0.75, 0.55, 0.42];
    const torso = { pos: [], nrm: [], col: [], color: suit }; buildBox(torso, 0.34, 0.5, 0.2);
    const head = { pos: [], nrm: [], col: [], color: skin }; buildCapsule(head, 0.1, 0.1);
    const armU = { pos: [], nrm: [], col: [], color: suit }; buildCapsule(armU, 0.05, 0.3, 'y');
    const armL = { pos: [], nrm: [], col: [], color: skin }; buildCapsule(armL, 0.045, 0.28, 'y');
    const legU = { pos: [], nrm: [], col: [], color: suit }; buildCapsule(legU, 0.07, 0.38, 'y');
    const legL = { pos: [], nrm: [], col: [], color: suit }; buildCapsule(legL, 0.055, 0.38, 'y');
    this.parts = {
      torso: makeMesh(gl, torso), head: makeMesh(gl, head),
      armU: makeMesh(gl, armU), armL: makeMesh(gl, armL),
      legU: makeMesh(gl, legU), legL: makeMesh(gl, legL),
    };
    this._m = M4.make();
    this._m2 = M4.make();
  }

  //  pose: { lean, crouch, tuck, armL, armR, look, airborne, tumble }
  draw(cam, world, pose) {
    const gl = this.gl;
    gl.useProgram(this.prog.prog);
    gl.uniformMatrix4fv(this.prog.uniforms.uVP, false, cam.vp);
    gl.uniform3fv(this.prog.uniforms.uCamPos, cam.pos);
    gl.uniform3fv(this.prog.uniforms.uSunDir, cam.sunDir);
    gl.uniform1f(this.prog.uniforms.uSpec, 0.6);

    const m = this._m, m2 = this._m2;
    // ---- board ----
    // world: {pos:[x,y,z], yaw (heading in XZ), pitch (board tilt up-face), roll (bank)}
    M4.compose(m, world.pos, world.yaw, world.pitch, world.roll, 1);
    gl.uniformMatrix4fv(this.prog.uniforms.uModel, false, m);
    drawMesh(gl, this.boardMesh);
    M4.translate(m2, 0, 0.085, 0);
    M4.mul(m, m, m2);
    gl.uniformMatrix4fv(this.prog.uniforms.uModel, false, m);
    drawMesh(gl, this.stripeMesh);

    // ---- rider ----
    const P = this.parts;
    const crouch = pose.crouch, tuck = pose.tuck;
    const hipY = 0.1 + crouch * 0.05;
    const torsoH = 0.5 - crouch * 0.12 - tuck * 0.1;
    const lean = pose.lean;

    const bm = M4.compose(M4.make(), world.pos, world.yaw, world.pitch, world.roll, 1);
    const place2 = (mesh, x, y, z, yaw = 0, pitch = 0, roll = 0, s = 1) => {
      M4.compose(m2, [x, y, z], yaw, pitch, roll, s);
      M4.mul(m, bm, m2);
      gl.uniformMatrix4fv(this.prog.uniforms.uModel, false, m);
      drawMesh(gl, mesh);
    };

    // Stance: regular footer — feet along the board (front foot toward the
    // nose at +x), torso upright, arms out across (z) for balance.
    const tz = tuck ? 0.1 : 0;
    place2(P.legU, 0.22, hipY + 0.1, 0.02, 0, 0.25 + lean * 0.3, 0.1);   // front upper leg
    place2(P.legL, 0.30, hipY - 0.14, 0.03, 0, 0.5 + lean * 0.3, 0.06);  // front lower
    place2(P.legU, -0.24, hipY + 0.1, -0.02, 0, -0.3 + lean * 0.3, -0.08);
    place2(P.legL, -0.30, hipY - 0.14, -0.03, 0, -0.55 + lean * 0.3, -0.05);
    place2(P.torso, 0, hipY + 0.34 + torsoH * 0.2, 0, 0, 0.15 + tz + lean * 0.3, lean * 0.45);
    place2(P.head, 0.04, hipY + 0.72 + torsoH * 0.2 - tz * 0.2, 0.02, 0, 0.1 + lean * 0.2, lean * 0.25);
    // arms out for balance (or tucked in)
    const armY = hipY + 0.5, armOut = tuck ? 0.12 : 0.3;
    place2(P.armU, 0.02, armY, 0.2 + pose.armL * 0.1, 1.2, 0.35 + pose.armL * 0.5, armOut + lean * 0.3);
    place2(P.armL, 0.05, armY - 0.08, 0.36 + pose.armL * 0.15, 1.35, 0.5 + pose.armL * 0.8, armOut * 1.2);
    place2(P.armU, -0.02, armY, -0.2 - pose.armR * 0.1, -1.2, -0.35 - pose.armR * 0.5, -armOut + lean * 0.3);
    place2(P.armL, -0.05, armY - 0.08, -0.36 - pose.armR * 0.15, -1.35, -0.5 - pose.armR * 0.8, -armOut * 1.2);
  }
}
