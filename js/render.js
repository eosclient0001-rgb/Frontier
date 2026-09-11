// Frontier SDF — renderer: raymarched SDF scene + sea water, river ribbons from
// live particle trails, depth-tested particle/plume sprites, canvas composite.

import { PMAX } from "./glsl-lib.js?v=3";
import {
  FULLSCREEN_VERT, SCENE_FRAG, POINTS_VERT, POINTS_FRAG,
  RIBBON_VERT, RIBBON_FRAG, BLIT_FRAG,
} from "./render-shaders.js?v=3";

// --- minimal mat4 (column-major) ---
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const d = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * d, -1, 0, 0, 2 * far * near * d, 0]);
}
function lookAt(eye, tgt) {
  let zx = eye[0] - tgt[0], zy = eye[1] - tgt[1], zz = eye[2] - tgt[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = zy * 0 - zz * 1, xy = zz * 0 - zx * 0, xz = zx * 1 - zy * 0; // cross(z, up=(0,1,0))? -> use up
  // cross(forward, up): forward = -z
  xx = -zy * 0 + -zz * 1; // recompute cleanly below
  let fx = -zx, fy = -zy, fz = -zz;
  xx = fy * 0 - fz * 1; xy = fz * 0 - fx * 0; xz = fx * 1 - fy * 0;
  // cross(up, z)? standard: x = normalize(cross(up, z)), y = cross(z, x)
  xx = 1 * zz - 0 * zy; xy = 0 * zx - 0 * zz; xz = 0 * zy - 1 * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
  ]);
}
function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

function compile(gl, vs, fs, label, linear) {
  const src = linear ? fs.replace("#version 300 es", "#version 300 es\n#define LINEAR 1") : fs;
  const p = gl.createProgram();
  for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, src]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`${label}: ${gl.getShaderInfoLog(s)}`);
    }
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${label}: ${gl.getProgramInfoLog(p)}`);
  return { handle: p, cache: new Map() };
}

export class Renderer {
  constructor(gl, sim) {
    this.gl = gl;
    this.sim = sim;
    this.linear = sim.linear;
    this.fbo = gl.createFramebuffer();
    this.emptyVao = gl.createVertexArray();
    this.sceneProg = compile(gl, FULLSCREEN_VERT, SCENE_FRAG, "scene", this.linear);
    this.pointsProg = compile(gl, POINTS_VERT, POINTS_FRAG, "points", false);
    this.ribbonProg = compile(gl, RIBBON_VERT, RIBBON_FRAG, "ribbon", false);
    this.blitProg = compile(gl, FULLSCREEN_VERT, BLIT_FRAG, "blit", false);
    // scene targets (resized dynamically)
    this.colorTex = gl.createTexture();
    this.depthTex = gl.createTexture();
    this.sceneW = 0; this.sceneH = 0;
    // ribbon geometry
    this.ribbonVao = gl.createVertexArray();
    gl.bindVertexArray(this.ribbonVao);
    this.ribbonVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 700 * 7 * 4, gl.DYNAMIC_DRAW);
    const rp = this.ribbonProg.handle;
    const stride = 7 * 4;
    const attr = (name, size, off) => {
      const l = gl.getAttribLocation(rp, name);
      if (l < 0) return;
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off * 4);
    };
    attr("aPos", 3, 0); attr("aUV", 2, 3); attr("aMisc", 2, 5);
    gl.bindVertexArray(null);
    this.ribbonVerts = 0;
  }

  loc(prog, name) {
    if (!prog.cache.has(name)) prog.cache.set(name, this.gl.getUniformLocation(prog.handle, name));
    return prog.cache.get(name);
  }

  set1(prog, name, v) { const l = this.loc(prog, name); if (l != null) this.gl.uniform1f(l, v); }
  set2(prog, name, v) { const l = this.loc(prog, name); if (l != null) this.gl.uniform2fv(l, v); }
  set3(prog, name, v) { const l = this.loc(prog, name); if (l != null) this.gl.uniform3fv(l, v); }
  set4(prog, name, v) { const l = this.loc(prog, name); if (l != null) this.gl.uniform4fv(l, v); }
  setM(prog, name, v) { const l = this.loc(prog, name); if (l != null) this.gl.uniformMatrix4fv(l, false, v); }
  setT(prog, name, tex, unit) {
    const l = this.loc(prog, name);
    if (l == null) return;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
    this.gl.uniform1i(l, unit);
  }

  ensureScene(w, h) {
    if (w === this.sceneW && h === this.sceneH) return;
    const gl = this.gl;
    this.sceneW = w; this.sceneH = h;
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  sunDir(angleDeg, elevDeg) {
    const a = (angleDeg * Math.PI) / 180, e = (elevDeg * Math.PI) / 180;
    return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
  }

  viewProj(eye, target, fovDeg, aspect) {
    const P = perspective((fovDeg * Math.PI) / 180, aspect, 0.1, 300);
    const V = lookAt(eye, target);
    return mul4(P, V);
  }

  drawScene(view, o) {
    const gl = this.gl;
    const aspect = this.sceneW / Math.max(1, this.sceneH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.depthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.sceneW, this.sceneH);
    gl.bindVertexArray(this.emptyVao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const p = this.sceneProg;
    gl.useProgram(p.handle);
    this.setT(p, "uVol", this.sim.volumeTex(), 0);
    this.setT(p, "uFlow", this.sim.flowTex, 1);
    const tanH = Math.tan(((view.fov || 50) * Math.PI) / 360);
    this.set4(p, "uEye", [view.eye[0], view.eye[1], view.eye[2], tanH]);
    this.set4(p, "uTgt", [view.target[0], view.target[1], view.target[2], aspect]);
    this.set4(p, "uSunA", [...this.sunDir(o.sunAngle, o.sunElev), o.sunPower]);
    this.set4(p, "uSunB", [o.haze, 1, o.ao, 0.000016 + o.haze * 0.000023]);
    this.set4(p, "uWatA", [o.waterLevel, o.waterOn ? 1 : 0, o.clarity, o.flowK]);
    this.set4(p, "uWatB", [o.foamReach, o.foamAmt, o.ripple, o.time]);
    this.set4(p, "uRdr", [o.steps, o.terrainOn ? 1 : 0, 220, o.strata]);
    this.set2(p, "uRes", [this.sceneW, this.sceneH]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  blit(canvasW, canvasH) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.bindVertexArray(this.emptyVao);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    const p = this.blitProg;
    gl.useProgram(p.handle);
    this.setT(p, "uScene", this.colorTex, 0);
    this.set2(p, "uRes", [canvasW, canvasH]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  drawRibbons(view, time, on) {
    if (!on || this.ribbonVerts === 0) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(this.ribbonVao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const p = this.ribbonProg;
    gl.useProgram(p.handle);
    const aspect = gl.canvas.width / Math.max(1, gl.canvas.height);
    this.setM(p, "uVP", this.viewProj(view.eye, view.target, view.fov || 50, aspect));
    this.set3(p, "uEye", view.eye);
    this.setT(p, "uDepth", this.depthTex, 0);
    this.set1(p, "uTime", time);
    this.set3(p, "uDeep", [0.03, 0.16, 0.2]);
    this.set3(p, "uShal", [0.25, 0.55, 0.55]);
    gl.drawArrays(gl.TRIANGLES, 0, this.ribbonVerts);
    gl.disable(gl.BLEND);
  }

  drawPoints(view, activeCount, sizeMul, plume) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(this.emptyVao);
    gl.enable(gl.BLEND);
    if (plume) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
    else { gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    const p = this.pointsProg;
    gl.useProgram(p.handle);
    const aspect = gl.canvas.width / Math.max(1, gl.canvas.height);
    const tanH = Math.tan(((view.fov || 50) * Math.PI) / 360);
    this.setT(p, "uPos", this.sim.posTex(), 0);
    this.setT(p, "uVel", this.sim.velTex(), 1);
    this.setT(p, "uCargo", this.sim.cargoTex(), 2);
    this.setT(p, "uMeta", this.sim.metaTex(), 3);
    this.setT(p, "uDepth", this.depthTex, 4);
    this.set4(p, "uEye", [view.eye[0], view.eye[1], view.eye[2], tanH]);
    this.set4(p, "uPR", [(gl.canvas.height * 0.5) / tanH, sizeMul, activeCount, plume ? 1 : 0]);
    this.setM(p, "uVP", this.viewProj(view.eye, view.target, view.fov || 50, aspect));
    gl.drawArrays(gl.POINTS, 0, Math.min(activeCount, PMAX));
    gl.disable(gl.BLEND);
  }

  // Build a ribbon strip following live river particles (called ~2x/sec).
  updateRibbons(river) {
    if (!river) { this.ribbonVerts = 0; return; }
    let pos, meta;
    try {
      pos = this.sim.readPositions();
      meta = this.sim.readMeta();
    } catch { this.ribbonVerts = 0; return; }
    const dl = Math.hypot(river.dirX, river.dirZ) || 1;
    const nx = river.dirX / dl, nz = river.dirZ / dl;
    const pts = [];
    for (let i = 0; i < PMAX; i++) {
      if (meta[i * 4] > 0.5 && meta[i * 4] < 1.5 && pos[i * 4 + 3] >= 0) {
        const x = pos[i * 4], y = pos[i * 4 + 1], z = pos[i * 4 + 2];
        pts.push({ x, y, z, t: (x - river.inletX) * nx + (z - river.inletZ) * nz });
      }
    }
    if (pts.length < 60) { this.ribbonVerts = 0; return; }
    pts.sort((a, b) => a.t - b.t);
    // moving-average smoothing
    const W = 15, sm = [];
    for (let i = 0; i < pts.length; i++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let j = -W; j <= W; j++) {
        const k = i + j;
        if (k < 0 || k >= pts.length) continue;
        sx += pts[k].x; sy += pts[k].y; sz += pts[k].z; n++;
      }
      sm.push({ x: sx / n, y: sy / n + 0.07, z: sz / n });
    }
    const ST = 110, stations = [];
    for (let i = 0; i < ST; i++) stations.push(sm[Math.floor((i / (ST - 1)) * (sm.length - 1))]);
    // cumulative length for foam advection
    let len = 0;
    const cum = [0];
    for (let i = 1; i < ST; i++) {
      len += Math.hypot(stations[i].x - stations[i - 1].x, stations[i].z - stations[i - 1].z);
      cum.push(len);
    }
    const hw = river.width * 0.5;
    const data = [];
    const push = (c, side, v, sp, al) => data.push(c.x, c.y, c.z, side, v, sp, al);
    for (let i = 0; i < ST - 1; i++) {
      const a = stations[i], b = stations[i + 1];
      let tx = b.x - a.x, tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let sx = -tz, sz = tx;
      const al0 = Math.pow(Math.sin((Math.PI * i) / (ST - 1)), 0.5) * 0.9;
      const al1 = Math.pow(Math.sin((Math.PI * (i + 1)) / (ST - 1)), 0.5) * 0.9;
      const A = { x: a.x - sx * hw, y: a.y, z: a.z - sz * hw };
      const B = { x: a.x + sx * hw, y: a.y, z: a.z + sz * hw };
      const C = { x: b.x - sx * hw, y: b.y, z: b.z - sz * hw };
      const D = { x: b.x + sx * hw, y: b.y, z: b.z + sz * hw };
      push(A, -1, cum[i], river.speed, al0); push(B, 1, cum[i], river.speed, al0); push(C, -1, cum[i + 1], river.speed, al1);
      push(B, 1, cum[i], river.speed, al0); push(D, 1, cum[i + 1], river.speed, al1); push(C, -1, cum[i + 1], river.speed, al1);
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(data));
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.ribbonVerts = data.length / 7;
  }
}
