// Sky: analytic gradient + sun + procedural clouds. The same `skyColor(dir)`
// GLSL function is reused by the water shader for reflections (no cubemap, no
// render-to-texture — "realistic but cheap").

import { compileProgram, drawMesh, createMesh } from './gl.js';

export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;   // toward the sun, normalized
uniform float uTime;

float skyHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), u.x),
             mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), u.x), u.y);
}
float skyFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * skyNoise(p); p = p * 2.13 + 17.3; a *= 0.5; }
  return v;
}

//  Late-afternoon tropical sky: warm horizon, deep zenith, sun glow.
vec3 skyColor(vec3 dir) {
  float y = clamp(dir.y, -0.12, 1.0);
  float hz = pow(1.0 - max(y, 0.0), 5.0);
  vec3 zen = vec3(0.10, 0.26, 0.52);
  vec3 hor = vec3(0.86, 0.80, 0.68);
  vec3 col = mix(zen, hor, hz);

  // sun disc + glow
  float sd = max(dot(normalize(dir), uSunDir), 0.0);
  col += vec3(1.0, 0.88, 0.66) * pow(sd, 900.0) * 6.0;      // disc
  col += vec3(1.0, 0.80, 0.55) * pow(sd, 45.0) * 0.55;      // inner glow
  col += vec3(1.0, 0.72, 0.45) * pow(sd, 6.0) * 0.16;       // wide haze

  // clouds on a plane above, drifting slowly
  if (dir.y > 0.02) {
    vec2 cuv = dir.xz / (dir.y + 0.18);
    cuv = cuv * 0.55 + vec2(uTime * 0.004, uTime * 0.0016);
    float cl = skyFbm(cuv * 1.35);
    cl = smoothstep(0.52, 0.78, cl) * smoothstep(0.0, 0.18, dir.y);
    float shade = skyFbm(cuv * 1.35 + 2.0);
    vec3 cloudCol = mix(vec3(1.05, 0.98, 0.92), vec3(0.72, 0.70, 0.75), shade * 0.6);
    cloudCol += vec3(1.0, 0.7, 0.4) * pow(sd, 3.0) * 0.35;
    col = mix(col, cloudCol, cl * 0.85);
  }

  // below the horizon: haze (used for fog blend of distant water)
  col = mix(col, vec3(0.62, 0.68, 0.72), smoothstep(0.05, -0.12, dir.y));
  return col;
}
`;

export const SKY_VS = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vNdc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
out vec4 fragColor;
uniform mat4 uInvVP;    // inverse(view*proj) to recover ray dirs
${SKY_GLSL}
void main() {
  vec4 near = uInvVP * vec4(vNdc, -1.0, 1.0);
  vec4 far  = uInvVP * vec4(vNdc,  1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - near.xyz / near.w);
  fragColor = vec4(skyColor(dir), 1.0);
}`;

export class Sky {
  constructor(gl) {
    this.gl = gl;
    this.prog = compileProgram(gl, SKY_VS, SKY_FS, 'sky');
  }
  draw(cam) {
    const gl = this.gl;
    gl.useProgram(this.prog.prog);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.uniformMatrix4fv(this.prog.uniforms.uInvVP, false, cam.invVP);
    gl.uniform3fv(this.prog.uniforms.uSunDir, cam.sunDir);
    gl.uniform1f(this.prog.uniforms.uTime, cam.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }
}
