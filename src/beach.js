// Sand: shore + dunes as one displaced grid with a tiny noise shader.
import { compileProgram, createMesh, drawMesh } from './gl.js';
import { SKY_GLSL } from './sky.js';

export const BEACH_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aXZ;   // (x, z) grid on the sand
uniform mat4 uVP;
uniform float uXShore, uSandSlope;
out vec3 vWorld;
out float vWet;
float shash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float snoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(shash(i), shash(i + vec2(1, 0)), u.x),
             mix(shash(i + vec2(0, 1)), shash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float x = aXZ.x, z = aXZ.y;
  float dune = 0.0;
  float inland = max(0.0, x - uXShore);
  dune += 1.6 * smoothstep(6.0, 22.0, inland);
  dune += 0.5 * snoise(vec2(x * 0.12, z * 0.08)) * smoothstep(3.0, 12.0, inland);
  dune += 0.05 * snoise(vec2(x * 0.9, z * 0.7));
  float y = (x - uXShore) * uSandSlope * 2.4 + dune - 0.25;
  vWorld = vec3(x, y, z);
  vWet = smoothstep(1.6, 0.1, abs(y));
  gl_Position = uVP * vec4(vWorld, 1.0);
}`;

export const BEACH_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in float vWet;
out vec4 fragColor;
uniform vec3 uCamPos;
uniform float uXShore;
${SKY_GLSL}
float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bhash(i), bhash(i + vec2(1, 0)), u.x),
             mix(bhash(i + vec2(0, 1)), bhash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float g = bnoise(vWorld.xz * 14.0) * 0.5 + bnoise(vWorld.xz * 55.0) * 0.5;
  vec3 dry = vec3(0.83, 0.72, 0.52) * (0.85 + 0.3 * g);
  vec3 wet = vec3(0.55, 0.46, 0.33) * (0.8 + 0.25 * g);
  vec3 veg = vec3(0.23, 0.34, 0.18) * (0.8 + 0.3 * g);
  float inland = max(0.0, vWorld.x - uXShore - 14.0);
  vec3 col = mix(mix(dry, wet, vWet), veg, smoothstep(0.0, 5.0, inland));
  // cheap light
  vec3 N = normalize(vec3(0.12 * (g - 0.5), 1.0, 0.12 * (g - 0.5)));
  float lam = 0.55 + 0.45 * max(dot(N, uSunDir), 0.0);
  col *= lam;
  float dist = length(uCamPos - vWorld);
  vec3 fogc = skyColor(normalize(vec3(vWorld.x - uCamPos.x, 0.0, vWorld.z - uCamPos.z)));
  col = mix(col, fogc, smoothstep(70.0, 320.0, dist));
  fragColor = vec4(col, 1.0);
}`;

export class Beach {
  constructor(gl, p) {
    this.gl = gl;
    this.prog = compileProgram(gl, BEACH_VS, BEACH_FS, 'beach');
    const NX = 40, NZ = 80;
    const verts = new Float32Array(NX * NZ * 2);
    const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
    let vi = 0, ii = 0;
    for (let i = 0; i < NX; i++) {
      const x = p.xShore - 12 + (i / (NX - 1)) * 55;   // a little under water + far inland
      for (let j = 0; j < NZ; j++) {
        const z = -160 + (j / (NZ - 1)) * 420;
        verts[vi++] = x; verts[vi++] = z;
      }
    }
    for (let i = 0; i < NX - 1; i++) {
      for (let j = 0; j < NZ - 1; j++) {
        const a = i * NZ + j, b = a + 1, c = a + NZ, d = c + 1;
        idx[ii++] = a; idx[ii++] = b; idx[ii++] = c;
        idx[ii++] = b; idx[ii++] = d; idx[ii++] = c;
      }
    }
    this.mesh = createMesh(gl, {
      vertices: verts, indices: idx,
      attributes: [{ name: 'aXZ', size: 2, offset: 0, loc: 0 }],
    });
  }
  draw(cam, p) {
    const gl = this.gl;
    gl.useProgram(this.prog.prog);
    gl.uniformMatrix4fv(this.prog.uniforms.uVP, false, cam.vp);
    gl.uniform3fv(this.prog.uniforms.uCamPos, cam.pos);
    gl.uniform3fv(this.prog.uniforms.uSunDir, cam.sunDir);
    gl.uniform1f(this.prog.uniforms.uTime, cam.time);
    gl.uniform1f(this.prog.uniforms.uXShore, p.xShore);
    gl.uniform1f(this.prog.uniforms.uSandSlope, p.sandSlope);
    drawMesh(gl, this.mesh);
  }
}
