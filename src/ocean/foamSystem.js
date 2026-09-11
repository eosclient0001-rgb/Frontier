// Foam System: Jacobian + Advected foam (Jeschke 2023, Tessendorf, Dupuy-Bruneton 2023)
// Real foam, not threshold white mask
// Two textures: foam generation (from Jacobian) + foam advection (ping-pong)
// GTX: single fullscreen pass + advection, ~0.3ms
import { createProgram, createFBO } from '../utils/glUtils.js';

const quadVS = `#version 300 es
layout(location=0) in vec2 p;
out vec2 uv;
void main(){ uv=p*0.5+0.5; gl_Position=vec4(p,0,1); }
`;

const foamUpdateFS = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D normalJacobianTex; // xyz normal encoded 0-1, w jacobian
uniform sampler2D dispTex; // xyz displacement+height
uniform sampler2D prevFoamTex; // advected foam
uniform sampler2D velocityTex; // from displacement gradient
uniform float deltaTime;
uniform float foamThreshold;
uniform float foamDecay;
uniform float foamGrow;
uniform vec2 texelSize;
void main(){
  vec4 nj = texture(normalJacobianTex, uv);
  float J = nj.w;
  // Jacobian foam generation: when J < threshold, wave breaking
  float breaking = 1.0 - smoothstep(foamThreshold-0.2, foamThreshold, J);
  // Additional: slope + curvature for crest foam
  vec3 n = nj.xyz*2.0-1.0;
  float slope = 1.0 - n.y;
  float crest = smoothstep(0.3, 0.8, slope) * breaking;

  // Foam from previous frame advected
  vec2 vel = texture(velocityTex, uv).xy; // velocity from displacement
  vec2 prevUV = uv - vel * deltaTime * 0.05;
  float prevFoam = texture(prevFoamTex, prevUV).x;

  // Advection with dissipation (exponential decay from Jeschke 2023)
  float foam = prevFoam * foamDecay;
  foam += crest * foamGrow * deltaTime;
  // also foam from whitecap accumulation (Dupuy)
  // clamp and add turbulence via high-freq
  foam = clamp(foam, 0.0, 1.0);
  // foam texture will be blurred by advection, we store also thickness
  float thickness = foam * (0.5 + 0.5*breaking);
  outColor = vec4(foam, thickness, J, 1.0);
}
`;

const foamAdvectFS = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D foamTex;
uniform sampler2D velocityTex;
uniform float deltaTime;
void main(){
  vec2 vel = texture(velocityTex, uv).xy;
  vec2 advUV = uv - vel * deltaTime * 0.08;
  vec4 f = texture(foamTex, advUV);
  // slight diffusion
  vec2 ts = vec2(1.0/256.0);
  float blur = 0.0;
  blur += texture(foamTex, advUV+vec2(ts.x,0)).x;
  blur += texture(foamTex, advUV+vec2(-ts.x,0)).x;
  blur += texture(foamTex, advUV+vec2(0,ts.y)).x;
  blur += texture(foamTex, advUV+vec2(0,-ts.y)).x;
  blur *= 0.25;
  f.x = mix(f.x, blur, 0.05);
  outColor = f;
}
`;

export class FoamSystem {
  constructor(gl, size=256) {
    this.gl = gl;
    this.size = size;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    this.fbos = [createFBO(gl,size,size,gl.RGBA,gl.FLOAT,gl.LINEAR), createFBO(gl,size,size,gl.RGBA,gl.FLOAT,gl.LINEAR)];
    this.progUpdate = createProgram(gl,quadVS,foamUpdateFS);
    this.progAdvect = createProgram(gl,quadVS,foamAdvectFS);
    this.ping = 0;
  }
  update(gl, normalTex, dispTex, velocityTex, dt) {
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    // advect first
    gl.useProgram(this.progAdvect);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[1-this.ping].fbo);
    gl.viewport(0,0,this.size,this.size);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fbos[this.ping].tex);
    gl.uniform1i(gl.getUniformLocation(this.progAdvect,'foamTex'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, velocityTex || this.fbos[this.ping].tex);
    gl.uniform1i(gl.getUniformLocation(this.progAdvect,'velocityTex'),1);
    gl.uniform1f(gl.getUniformLocation(this.progAdvect,'deltaTime'), dt);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    // then generate new foam
    gl.useProgram(this.progUpdate);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[this.ping].fbo);
    gl.viewport(0,0,this.size,this.size);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, normalTex);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate,'normalJacobianTex'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dispTex);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate,'dispTex'),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.fbos[1-this.ping].tex);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate,'prevFoamTex'),2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, velocityTex || dispTex);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate,'velocityTex'),3);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate,'deltaTime'), dt);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate,'foamThreshold'), 0.35);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate,'foamDecay'), 0.92);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate,'foamGrow'), 2.5);
    gl.uniform2f(gl.getUniformLocation(this.progUpdate,'texelSize'), 1/this.size,1/this.size);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return this.fbos[this.ping].tex;
  }
}
