// Spray & foam particles: lip spray (offshore wind feathers it back), splash
// bursts when the lip lands, and rail spray off carves. One GL_POINTS buffer.

import { compileProgram } from './gl.js';
import { clamp } from './math.js';
import { crestX, stageAt, zB, faceGeom, lipFallOf, foldCP, foldEval, heightAt } from './waveshape.js';

const MAX = 900;

export const SPRAY_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aSizeFade;   // size px-ish, alpha
uniform mat4 uVP;
uniform vec3 uCamPos;
out float vFade;
void main() {
  vFade = aSizeFade.y;
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  float d = length(uCamPos - aPos);
  gl_PointSize = clamp(aSizeFade.x * 140.0 / max(d, 1.0), 1.0, 42.0) * c.w / max(c.w, 0.001);
  gl_PointSize = clamp(aSizeFade.x * 220.0 / max(d, 0.5), 1.0, 46.0);
}`;

export const SPRAY_FS = `#version 300 es
precision highp float;
in float vFade;
out vec4 fragColor;
uniform vec3 uSunDir;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float a = (1.0 - r) * vFade;
  a *= 0.75 + 0.25 * (1.0 - r * r);
  vec3 col = vec3(0.95, 0.98, 1.0) * (0.8 + 0.3 * (1.0 - r));
  fragColor = vec4(col, a * 0.85);
}`;

export class Spray {
  constructor(gl) {
    this.gl = gl;
    this.prog = compileProgram(gl, SPRAY_VS, SPRAY_FS, 'spray');
    this.buf = gl.createBuffer();
    this.data = new Float32Array(MAX * 5);
    this.parts = [];   // {x,y,z, vx,vy,vz, life, age, size}
    this.nextLipSpawn = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, size) {
    if (this.parts.length >= MAX) this.parts.shift();
    this.parts.push({ x, y, z, vx, vy, vz, life, age: 0, size });
  }

  update(dt, t, p, rider) {
    // integrate
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.age += dt;
      if (q.age >= q.life) { this.parts.splice(i, 1); continue; }
      q.vy -= 9.81 * dt * 0.55;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }

    // ---- lip spray along the pitching section ----
    const zb = zB(t, p);
    const wind = p.wind;   // negative = offshore (blows back over the wave)
    this.nextLipSpawn -= dt;
    if (this.nextLipSpawn <= 0) {
      this.nextLipSpawn = 0.016;
      // sample a few z positions near the critical section
      for (let k = 0; k < 3; k++) {
        const z = zb - 3 + Math.random() * 16;
        const b = stageAt(z, t, p);
        if (b < 0.05 || b > 1.15) continue;
        const g = faceGeom(z, t, p);
        const cp = foldCP(new Float64Array(16), g.pitch, lipFallOf(b, p), g.foam, g.Hf, p.curlR, p.shrink, g.soupK);
        const tip = foldEval(cp, 0.55 + Math.random() * 0.25, [0, 0]);
        const cx = crestX(z, t, p);
        const px = cx + tip[0], py = tip[1], pz = z;
        const airborne = Math.min(1, b * 2) * (1 - g.foam * 0.5);
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          this.spawn(
            px + (Math.random() - 0.5) * 0.3, py + Math.random() * 0.2, pz + (Math.random() - 0.5) * 0.5,
            0.8 * airborne + wind * 3.2 * airborne + (Math.random() - 0.5),
            1.2 + Math.random() * 2.2 * airborne,
            (Math.random() - 0.5) * 1.2,
            0.5 + Math.random() * 0.7, 0.35 + Math.random() * 0.5
          );
        }
        // lip landing splash
        if (b > 0.92 && b < 1.3 && Math.random() < 0.35) {
          const landX = cx + g.Wf * 0.45;
          for (let i = 0; i < 4; i++) {
            this.spawn(
              landX + (Math.random() - 0.5) * 0.8,
              heightAt(landX, z, t, p) + 0.1,
              z + (Math.random() - 0.5) * 1.2,
              (Math.random() - 0.3) * 2.5, 2 + Math.random() * 3.5, (Math.random() - 0.5) * 2,
              0.6 + Math.random() * 0.5, 0.5 + Math.random() * 0.7
            );
          }
        }
      }
    }

    // ---- rail spray off the rider's carve ----
    if (rider && rider.mode === 'ride' && Math.abs(rider.roll) > 0.18 && rider.speed > 5) {
      const backX = rider.x - Math.cos(rider.yaw) * 0.9;
      const backZ = rider.z - Math.sin(rider.yaw) * 0.9;
      const side = Math.sign(-rider.roll);
      this.spawn(
        backX + (Math.random() - 0.5) * 0.3, rider.y + 0.05, backZ + (Math.random() - 0.5) * 0.3,
        -Math.sin(rider.yaw) * side * 2.4 + (Math.random() - 0.5),
        1.4 + Math.random() * 1.6,
        Math.cos(rider.yaw) * side * 2.4 + (Math.random() - 0.5),
        0.35 + Math.random() * 0.3, 0.4 + Math.random() * 0.35
      );
    }
  }

  draw(cam) {
    const gl = this.gl;
    if (!this.parts.length) return;
    let n = 0;
    for (const q of this.parts) {
      const f = 1 - q.age / q.life;
      this.data[n++] = q.x; this.data[n++] = q.y; this.data[n++] = q.z;
      this.data[n++] = q.size * (0.6 + 0.4 * f); this.data[n++] = f * f;
    }
    gl.useProgram(this.prog.prog);
    gl.uniformMatrix4fv(this.prog.uniforms.uVP, false, cam.vp);
    gl.uniform3fv(this.prog.uniforms.uCamPos, cam.pos);
    gl.uniform3fv(this.prog.uniforms.uSunDir, cam.sunDir);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, n), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, n / 5);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
