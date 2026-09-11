// Frontier SDF — GPU simulation driver (volumes, particles, passes, ledger).
// Owns the WebGL2 context state for simulation; the renderer shares the context.

import { ATLAS_W, ATLAS_H, PMAX, PSIZE } from "./glsl-lib.js";
import {
  FULLSCREEN_VERT, makeBaseFrag, MOTION_FRAG, EVENT_FRAG, SPLAT_VERT, SPLAT_FRAG,
  APPLY_FRAG, CARGO_FRAG, COUNT_FRAG, REDUCE1_FRAG, REDUCE2_FRAG, FLOW_FRAG,
} from "./sim-shaders.js";

const REQ_SCALE = 32;

function injectLinear(src) {
  return src.replace("#version 300 es", "#version 300 es\n#define LINEAR 1");
}

export class Sim {
  constructor(gl) {
    this.gl = gl;
    this.linear = !!gl.getExtension("OES_texture_float_linear");
    this.floatBlend = !!gl.getExtension("EXT_float_blend");
    if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) {
      throw new Error("GPU simulation needs float render targets (EXT_color_buffer_float).");
    }
    this.fbo = gl.createFramebuffer();
    this.vao = gl.createVertexArray();
    this.programs = new Map();
    this.tick = 0;
    this.simTime = 0;
    this.activeCount = 2048;
    this.waterLevel = 0.7;
    this.erosion = [];
    this.initialSolid = 0;
    this.lastAudit = null;
    this.readbackOK = true;
    this.baseCode = "";
    this.alloc();
    this.compileStatic();
    this.resetParticles();
  }

  alloc() {
    const gl = this.gl;
    const filt = this.linear ? gl.LINEAR : gl.NEAREST;
    const tex = (w, h, fmt = gl.RGBA32F, filter = gl.NEAREST) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.vol = [tex(ATLAS_W, ATLAS_H, gl.RGBA32F, filt), tex(ATLAS_W, ATLAS_H, gl.RGBA32F, filt)];
    this.volIdx = 0;
    const ptex = () => [tex(PSIZE, PSIZE), tex(PSIZE, PSIZE)];
    this.pos = ptex(); this.vel = ptex(); this.cargo = ptex();
    this.meta = ptex(); this.aux = ptex();
    this.pIdx = 0; this.cIdx = 0;
    this.impact = tex(PSIZE, PSIZE);
    this.contact = tex(PSIZE, PSIZE);
    this.exchange = tex(PSIZE, PSIZE);
    this.requests = tex(ATLAS_W, ATLAS_H, this.floatBlend ? gl.RGBA32F : gl.RGBA16F);
    this.accept = tex(ATLAS_W, ATLAS_H, gl.RGBA16F);
    this.countTex = tex(1, 1);
    this.sumTex = tex(32, 40);
    this.totalTex = tex(1, 1);
    this.flowTex = tex(256, 256, gl.RGBA32F, filt);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  program(name, vs, fs) {
    if (this.programs.has(name)) return this.programs.get(name);
    const gl = this.gl;
    const src = this.linear ? injectLinear(fs) : fs;
    const p = gl.createProgram();
    for (const [type, code] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, src]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s); gl.deleteProgram(p);
        throw new Error(`${name}: ${log}`);
      }
      gl.attachShader(p, s);
      gl.deleteShader(s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLinkLog?.(p) || gl.getProgramInfoLog(p)}`);
    const prog = { handle: p, cache: new Map() };
    this.programs.set(name, prog);
    return prog;
  }

  loc(prog, name) {
    if (!prog.cache.has(name)) prog.cache.set(name, this.gl.getUniformLocation(prog.handle, name));
    return prog.cache.get(name);
  }

  target(textures, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    for (let i = 0; i < 4; i++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, textures[i] || null, 0);
    }
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Simulation framebuffer incomplete.");
    }
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  bind(prog, textures = {}, values = {}) {
    const gl = this.gl;
    gl.useProgram(prog.handle);
    let unit = 0;
    for (const [name, t] of Object.entries(textures)) {
      const l = this.loc(prog, name);
      if (l === null || l === undefined) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(l, unit++);
    }
    for (const [name, v] of Object.entries(values)) {
      const l = this.loc(prog, name);
      if (l === null || l === undefined) continue;
      if (typeof v === "number") gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2fv(l, v);
      else if (v.length === 3) gl.uniform3fv(l, v);
      else gl.uniform4fv(l, v);
    }
  }

  pass(name, vs, fs, targets, w, h, textures, values = {}) {
    this.target(targets, w, h);
    this.bind(this.program(name, vs, fs), textures, values);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  compileStatic() {
    const V = FULLSCREEN_VERT;
    this.program("motion", V, MOTION_FRAG);
    this.program("event", V, EVENT_FRAG);
    this.program("splat", SPLAT_VERT, SPLAT_FRAG);
    this.program("apply", V, APPLY_FRAG);
    this.program("cargo", V, CARGO_FRAG);
    this.program("count", V, COUNT_FRAG);
    this.program("reduce1", V, REDUCE1_FRAG);
    this.program("reduce2", V, REDUCE2_FRAG);
    this.program("flow", V, FLOW_FRAG);
  }

  uploadTex(t, w, h, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
  }

  resetParticles() {
    const n = PSIZE * PSIZE * 4;
    const pos = new Float32Array(n);
    for (let i = 3; i < n; i += 4) pos[i] = -1;
    const zero = new Float32Array(n);
    for (const t of this.pos) this.uploadTex(t, PSIZE, PSIZE, pos);
    for (const arr of [this.vel, this.cargo, this.meta, this.aux]) {
      for (const t of arr) this.uploadTex(t, PSIZE, PSIZE, zero);
    }
    this.uploadTex(this.contact, PSIZE, PSIZE, zero);
    this.uploadTex(this.exchange, PSIZE, PSIZE, zero);
    this.uploadTex(this.impact, PSIZE, PSIZE, zero);
    this.pIdx = 0; this.cIdx = 0;
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  regenBase(nodeCode) {
    this.baseCode = nodeCode;
    if (this.programs.has("base")) {
      this.gl.deleteProgram(this.programs.get("base").handle);
      this.programs.delete("base");
    }
    const fs = makeBaseFrag(nodeCode);
    // Base gen never needs LINEAR (it writes, never samples the atlas).
    this.pass("base", FULLSCREEN_VERT, this.linear ? fs : fs, [this.vol[0]], ATLAS_W, ATLAS_H, {}, {});
    this.volIdx = 0;
    this.tick = 0;
    this.resetParticles();
    this.bakeFlow();
    // Baseline solid mass for the ledger.
    try {
      const a = this.audit(true);
      this.initialSolid = a ? a.solid : 0;
    } catch { this.initialSolid = 0; }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  setErosion(erosion, waterLevel) {
    this.erosion = erosion;
    this.waterLevel = waterLevel;
  }

  erosionUniforms() {
    const d = {
      hyd: { intensity: 0, capacity: 0.6, detach: 0.8, deposit: 0.8, evap: 1.0, dropSize: 2.5, footprint: 0.8 },
      river: { intensity: 0, inletX: 0, inletZ: -14, dirX: 0, dirZ: 1, width: 3, speed: 3.5, detach: 1.0 },
      wind: { intensity: 0, dirDeg: 90, speed: 6, height: 8, spread: 3, grain: 0.15, abrasion: 1.0 },
      therm: { intensity: 0, repose: 34, rate: 1.0, rest: 0.12 },
    };
    for (const e of this.erosion) {
      const t = e.kind === 0 ? d.hyd : e.kind === 1 ? d.river : e.kind === 2 ? d.wind : d.therm;
      Object.assign(t, e.params);
      t.intensity = Math.max(t.intensity, e.params.intensity ?? 0);
    }
    const wr = (d.wind.dirDeg * Math.PI) / 180;
    return {
      d,
      uEmit: [d.hyd.intensity, d.river.intensity, d.wind.intensity, d.therm.intensity],
      uPhysA: [9.81, this.waterLevel, 1.0, d.hyd.evap],
      uWindA: [Math.cos(wr), Math.sin(wr), d.wind.speed, d.wind.height],
      uWindB: [d.wind.spread, 0.6, 1.0, d.wind.abrasion],
      uRiverA: [d.river.inletX, d.river.inletZ, d.river.width, d.river.speed],
      uRiverB: [d.river.dirX, d.river.dirZ, 0.8, 0],
      uTherm: [1 - Math.cos((d.therm.repose * Math.PI) / 180), d.therm.rate, d.therm.rest, 0],
      uFoot: [d.hyd.footprint, d.river.width / 3, 0.5, 0.7],
      uSize: [d.hyd.dropSize, 3.0, d.wind.grain, 8.0],
      uHyd: [d.hyd.capacity, d.hyd.detach, d.hyd.deposit, 0],
      uRiv: [0.6, d.river.detach, 0.9, d.river.width / 3],
      uWnd: [0.5, d.wind.abrasion, 0.9, 0],
      uThm: [d.therm.rate, 1 - Math.cos((d.therm.repose * Math.PI) / 180), 1.0, 0],
    };
  }

  bakeFlow() {
    const u = this.erosionUniforms();
    const riverOn = u.uEmit[1] > 0.001 ? 1 : 0;
    this.pass("flow", FULLSCREEN_VERT, FLOW_FRAG, [this.flowTex], 256, 256,
      { uVol: this.volumeTex() },
      { uWater: this.waterLevel, uRiverOn: riverOn, uRiverA: u.uRiverA, uRiverB: u.uRiverB, uWindA: u.uWindA });
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  step(dt) {
    const gl = this.gl;
    const u = this.erosionUniforms();
    const pi = this.pIdx, ni = 1 - this.pIdx;
    const ci = this.cIdx, di = 1 - this.cIdx;
    const vi = this.volIdx, wi = 1 - this.volIdx;
    // 1 motion
    this.pass("motion", FULLSCREEN_VERT, MOTION_FRAG,
      [this.pos[ni], this.vel[ni], this.meta[ni], this.impact], PSIZE, PSIZE,
      { uPos: this.pos[pi], uVel: this.vel[pi], uCargo: this.cargo[ci], uMeta: this.meta[pi], uAux: this.aux[ci], uVol: this.vol[vi] },
      { uDT: dt, uTick: this.tick, uTime: this.simTime, uActive: this.activeCount, uEmit: u.uEmit, uPhysA: u.uPhysA, uWindA: u.uWindA, uWindB: u.uWindB, uRiverA: u.uRiverA, uRiverB: u.uRiverB, uTherm: u.uTherm, uFoot: u.uFoot, uSize: u.uSize });
    // 2 event
    this.pass("event", FULLSCREEN_VERT, EVENT_FRAG,
      [this.contact, this.exchange], PSIZE, PSIZE,
      { uPos: this.pos[ni], uVel: this.vel[ni], uCargo: this.cargo[ci], uMeta: this.meta[ni], uAux: this.aux[ci], uImpact: this.impact, uVol: this.vol[vi] },
      { uDT: dt, uWater: this.waterLevel, uHyd: u.uHyd, uRiv: u.uRiv, uWnd: u.uWnd, uThm: u.uThm, uWindA: u.uWindA });
    // 3 scatter requests (additive)
    this.target([this.requests], ATLAS_W, ATLAS_H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.bind(this.program("splat", SPLAT_VERT, SPLAT_FRAG),
      { uContact: this.contact, uExchange: this.exchange, uCargo: this.cargo[ci] }, { uReqScale: REQ_SCALE });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, PMAX * 3);
    gl.disable(gl.BLEND);
    // 4 apply to volume
    const wetDecay = Math.pow(0.5, dt / 25);
    this.pass("apply", FULLSCREEN_VERT, APPLY_FRAG,
      [this.vol[wi], this.accept], ATLAS_W, ATLAS_H,
      { uVol: this.vol[vi], uReq: this.requests },
      { uDT: dt, uWetDecay: wetDecay, uReqScale: REQ_SCALE });
    // 5 cargo
    this.pass("cargo", FULLSCREEN_VERT, CARGO_FRAG,
      [this.cargo[di], this.aux[di]], PSIZE, PSIZE,
      { uPos: this.pos[ni], uVel: this.vel[ni], uCargo: this.cargo[ci], uMeta: this.meta[ni], uAux: this.aux[ci], uContact: this.contact, uExchange: this.exchange, uImpact: this.impact, uAcc: this.accept },
      { uDT: dt });
    this.pIdx = ni; this.cIdx = di; this.volIdx = wi;
    this.tick++;
    this.simTime += dt;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  volumeTex() { return this.vol[this.volIdx]; }
  posTex() { return this.pos[this.pIdx]; }
  velTex() { return this.vel[this.pIdx]; }
  metaTex() { return this.meta[this.pIdx]; }
  cargoTex() { return this.cargo[this.cIdx]; }

  audit(quiet = false) {
    if (!this.readbackOK && !quiet) return this.lastAudit;
    const gl = this.gl;
    try {
      this.pass("count", FULLSCREEN_VERT, COUNT_FRAG, [this.countTex], 1, 1,
        { uPos: this.posTex(), uCargo: this.cargoTex(), uAux: this.aux[this.cIdx], uMeta: this.metaTex() },
        { uActive: this.activeCount });
      this.pass("reduce1", FULLSCREEN_VERT, REDUCE1_FRAG, [this.sumTex], 32, 40, { uVol: this.volumeTex() });
      this.pass("reduce2", FULLSCREEN_VERT, REDUCE2_FRAG, [this.totalTex], 1, 1, { uSum: this.sumTex });
      const c = new Float32Array(4), t = new Float32Array(4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.countTex, 0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, c);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.totalTex, 0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, t);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const a = { active: c[0], resting: c[1], carried: c[2], river: c[3], solid: t[0], deposited: t[1], wet: t[2], coarse: t[3], tick: this.tick };
      this.lastAudit = a;
      return a;
    } catch (e) {
      this.readbackOK = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!quiet) throw e;
      return null;
    }
  }

  readPositions() {
    const gl = this.gl;
    const out = new Float32Array(PSIZE * PSIZE * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.posTex(), 0);
    gl.readPixels(0, 0, PSIZE, PSIZE, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  readMeta() {
    const gl = this.gl;
    const out = new Float32Array(PSIZE * PSIZE * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.metaTex(), 0);
    gl.readPixels(0, 0, PSIZE, PSIZE, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
}
