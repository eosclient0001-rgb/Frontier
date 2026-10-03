// GPU FLIP/PIC fluid solver in WebGL2 (fragment-shader "compute").
//
// Per substep, entirely on the GPU:
//   P2G      particles splat velocity/mass/concentration onto a staggered MAC grid (instanced points + additive blending)
//   normalize divide by weights, classify cells (solid / fluid / air), store density + concentration
//   extrap   extend velocities one cell into air (saved as "old" grid for FLIP)
//   forces   gravity + solid boundary conditions (moving piston/spheres) + wall friction (no-slip for sticky fluids)
//   visc     implicit viscosity diffusion (Jacobi), per-cell viscosity from the A/B mixture
//   div      divergence + density-correction term (prevents volume loss / clumping)
//   pressure Jacobi pressure solve
//   project  subtract pressure gradient
//   G2P      FLIP/PIC blend per particle, RK2 advection, collisions, adhesion, yield stress, foam, A/B mixing
// Grid fields live in 2D "atlas" textures (z-slices tiled). Rigid spheres are integrated on the CPU and coupled
// through a tiny GPU reduction (submerged particle count + mean flow velocity per sphere), read back once per frame.
import { MATERIALS } from './materials.js';

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
void main(){ gl_Position = vec4(P[gl_VertexID],0,1); }`;

const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform ivec3 uDim; uniform int uTiles; uniform float uDx;
uniform vec3 uSize; uniform vec2 uPiston; uniform vec3 uRamp;
uniform vec4 uBoxC[4]; uniform vec4 uBoxH[4]; uniform int uNBox;
uniform vec4 uSph[16]; uniform vec4 uSphV[16]; uniform int uNSph;
ivec2 c2t(ivec3 c){ return ivec2(c.x + (c.z % uTiles)*uDim.x, c.y + (c.z / uTiles)*uDim.y); }
ivec3 t2c(ivec2 t){ int tx = t.x/uDim.x, ty = t.y/uDim.y; return ivec3(t.x - tx*uDim.x, t.y - ty*uDim.y, ty*uTiles + tx); }
vec4 F(sampler2D s, ivec3 c){ return texelFetch(s, c2t(clamp(c, ivec3(0), uDim-1)), 0); }
vec4 tri(sampler2D s, vec3 q){
  q = clamp(q, vec3(0.0), vec3(uDim) - 1.001);
  vec3 b = floor(q); vec3 f = q - b; ivec3 i = ivec3(b);
  vec4 c000=F(s,i), c100=F(s,i+ivec3(1,0,0)), c010=F(s,i+ivec3(0,1,0)), c110=F(s,i+ivec3(1,1,0));
  vec4 c001=F(s,i+ivec3(0,0,1)), c101=F(s,i+ivec3(1,0,1)), c011=F(s,i+ivec3(0,1,1)), c111=F(s,i+ivec3(1,1,1));
  return mix(mix(mix(c000,c100,f.x), mix(c010,c110,f.x), f.y), mix(mix(c001,c101,f.x), mix(c011,c111,f.x), f.y), f.z);
}
vec3 sampleVel(sampler2D s, vec3 g){
  return vec3(tri(s, g - vec3(0.0,0.5,0.5)).x, tri(s, g - vec3(0.5,0.0,0.5)).y, tri(s, g - vec3(0.5,0.5,0.0)).z);
}
float solid(vec3 p, out vec3 n, out vec3 sv){
  float best = 1e9, d; n = vec3(0,1,0); sv = vec3(0);
  d = p.x - uPiston.x;   if(d<best){ best=d; n=vec3(1,0,0); sv=vec3(uPiston.y,0,0); }
  d = uSize.x - p.x;     if(d<best){ best=d; n=vec3(-1,0,0); sv=vec3(0); }
  d = p.y;               if(d<best){ best=d; n=vec3(0,1,0);  sv=vec3(0); }
  d = p.z;               if(d<best){ best=d; n=vec3(0,0,1);  sv=vec3(0); }
  d = uSize.z - p.z;     if(d<best){ best=d; n=vec3(0,0,-1); sv=vec3(0); }
  if(uRamp.z > 0.5){
    vec2 rn = normalize(vec2(-uRamp.y, 1.0)); d = (p.x - uRamp.x)*rn.x + p.y*rn.y;
    if(p.x > uRamp.x - 0.2 && d < best){ best=d; n=vec3(rn,0.0); sv=vec3(0); }
  }
  for(int i=0;i<4;i++){ if(i>=uNBox) break;
    vec3 q = p - uBoxC[i].xyz; vec3 a = abs(q) - uBoxH[i].xyz; vec3 o = max(a, 0.0); float ol = length(o);
    d = ol + min(max(a.x, max(a.y, a.z)), 0.0);
    if(d < best){ best = d; sv = vec3(0);
      vec3 sq = vec3(q.x>=0.0?1.0:-1.0, q.y>=0.0?1.0:-1.0, q.z>=0.0?1.0:-1.0);
      if(ol > 1e-6) n = o/ol*sq; else if(a.x>=a.y && a.x>=a.z) n = vec3(sq.x,0,0); else if(a.y>=a.z) n = vec3(0,sq.y,0); else n = vec3(0,0,sq.z); }
  }
  for(int i=0;i<16;i++){ if(i>=uNSph) break;
    vec3 q = p - uSph[i].xyz; float l = length(q); d = l - uSph[i].w;
    if(d < best){ best = d; n = q/max(l,1e-6); sv = uSphV[i].xyz; }
  }
  return best;
}
// cell info: x = conc*dens, y = solid, z = fluid, w = dens. Cells outside the grid are solid.
uniform sampler2D uAux;
vec4 cellAux(ivec3 c){
  if(any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, uDim - 1))) return vec4(0,1,0,0);
  return texelFetch(uAux, c2t(c), 0);
}
`;

// ---------- P2G splat (instanced points: 27 lattice offsets per particle)
const SPLAT_VS = COMMON + `
uniform sampler2D uPos, uVel; uniform int uPW; uniform vec2 uAtlas;
flat out vec4 vVal; flat out vec4 vW;
float tent(vec3 d){ d = max(1.0 - abs(d), 0.0); return d.x*d.y*d.z; }
void main(){
  gl_PointSize = 1.0;
  ivec2 pc = ivec2(gl_VertexID % uPW, gl_VertexID / uPW);
  vec4 P = texelFetch(uPos, pc, 0), V = texelFetch(uVel, pc, 0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if(P.y < -50.0) return;
  vec3 g = P.xyz / uDx;
  ivec3 o = ivec3(gl_InstanceID % 3, (gl_InstanceID / 3) % 3, gl_InstanceID / 9) - 1;
  ivec3 c = ivec3(floor(g)) + o;
  if(any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, uDim))) return;
  vec3 cf = vec3(c);
  float wx = tent(g - (cf + vec3(0.0,0.5,0.5)));
  float wy = tent(g - (cf + vec3(0.5,0.0,0.5)));
  float wz = tent(g - (cf + vec3(0.5,0.5,0.0)));
  float wc = tent(g - (cf + 0.5));
  if(wx + wy + wz + wc <= 0.0) return;
  vVal = vec4(V.x*wx, V.y*wy, V.z*wz, P.w*wc);
  vW = vec4(wx, wy, wz, wc);
  gl_Position = vec4((vec2(c2t(c)) + 0.5)/uAtlas*2.0 - 1.0, 0.0, 1.0);
}`;
const SPLAT_FS = `#version 300 es
precision highp float;
flat in vec4 vVal; flat in vec4 vW;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ o0 = vVal; o1 = vW; }`;

const NORMALIZE_FS = COMMON + `
uniform sampler2D uAccV, uAccW;
layout(location=0) out vec4 oVel; layout(location=1) out vec4 oAux;
void main(){
  ivec2 t = ivec2(gl_FragCoord.xy); ivec3 c = t2c(t);
  vec4 a = texelFetch(uAccV, t, 0), w = texelFetch(uAccW, t, 0);
  vec3 v = vec3(w.x>1e-4 ? a.x/w.x : 0.0, w.y>1e-4 ? a.y/w.y : 0.0, w.z>1e-4 ? a.z/w.z : 0.0);
  vec3 n, sv; float sd = solid((vec3(c)+0.5)*uDx, n, sv);
  bool inGrid = all(lessThan(c, uDim - 1));
  float isSolid = (sd < 0.0 || !inGrid) ? 1.0 : 0.0;
  float fluid = (w.w > 0.12 && isSolid < 0.5) ? 1.0 : 0.0;
  // weight flags in .w of vel: bitmask-ish: store sum of known components for extrapolation
  float known = (w.x>1e-4?1.0:0.0) + (w.y>1e-4?2.0:0.0) + (w.z>1e-4?4.0:0.0);
  oVel = vec4(v, known);
  oAux = vec4(a.w, isSolid, fluid, w.w);
}`;

// extrapolate unknown face velocities from known neighbors (1 layer)
const EXTRAP_FS = COMMON + `
uniform sampler2D uVelIn;
out vec4 o;
bool has(float k, int bit){ return (int(k) / bit) % 2 == 1; }
void main(){
  ivec3 c = t2c(ivec2(gl_FragCoord.xy));
  vec4 v = F(uVelIn, c);
  vec3 r = v.xyz;
  ivec3 D[6] = ivec3[6](ivec3(1,0,0),ivec3(-1,0,0),ivec3(0,1,0),ivec3(0,-1,0),ivec3(0,0,1),ivec3(0,0,-1));
  for(int comp=0; comp<3; comp++){
    int bit = comp==0 ? 1 : comp==1 ? 2 : 4;
    if(has(v.w, bit)) continue;
    float s = 0.0, k = 0.0;
    for(int i=0;i<6;i++){ vec4 q = F(uVelIn, c + D[i]); if(has(q.w, bit)){ s += q[comp]; k += 1.0; } }
    if(k > 0.0) r[comp] = s/k;
  }
  o = vec4(r, v.w);
}`;

const BOUNDARY = `
uniform float uFricA, uFricB;
vec3 boundary(ivec3 c, vec3 v, bool fric){
  ivec3 X = ivec3(1,0,0), Y = ivec3(0,1,0), Z = ivec3(0,0,1);
  vec3 n, sv;
  vec4 aC = cellAux(c);
  // x face
  { vec4 aL = cellAux(c - X); vec3 fp = (vec3(c) + vec3(0.0,0.5,0.5))*uDx; float d = solid(fp, n, sv);
    if(aL.y > 0.5 || aC.y > 0.5) v.x = sv.x;
    else if(fric && d < uDx*1.2 && abs(n.x) < 0.7){ float cc = (aC.x + aL.x)/max(aC.w + aL.w, 1e-4); v.x = mix(v.x, sv.x, mix(uFricA, uFricB, cc)); } }
  { vec4 aL = cellAux(c - Y); vec3 fp = (vec3(c) + vec3(0.5,0.0,0.5))*uDx; float d = solid(fp, n, sv);
    if(aL.y > 0.5 || aC.y > 0.5) v.y = sv.y;
    else if(fric && d < uDx*1.2 && abs(n.y) < 0.7){ float cc = (aC.x + aL.x)/max(aC.w + aL.w, 1e-4); v.y = mix(v.y, sv.y, mix(uFricA, uFricB, cc)); } }
  { vec4 aL = cellAux(c - Z); vec3 fp = (vec3(c) + vec3(0.5,0.5,0.0))*uDx; float d = solid(fp, n, sv);
    if(aL.y > 0.5 || aC.y > 0.5) v.z = sv.z;
    else if(fric && d < uDx*1.2 && abs(n.z) < 0.7){ float cc = (aC.x + aL.x)/max(aC.w + aL.w, 1e-4); v.z = mix(v.z, sv.z, mix(uFricA, uFricB, cc)); } }
  return v;
}`;

const FORCES_FS = COMMON + BOUNDARY + `
uniform sampler2D uVelIn; uniform float uG, uDt;
out vec4 o;
void main(){
  ivec3 c = t2c(ivec2(gl_FragCoord.xy));
  vec4 v = F(uVelIn, c);
  v.y += uG*uDt;
  o = vec4(boundary(c, v.xyz, true), v.w);
}`;

const VISC_FS = COMMON + BOUNDARY + `
uniform sampler2D uVelIn, uVel0; uniform float uNuA, uNuB, uDt;
out vec4 o;
void main(){
  ivec3 c = t2c(ivec2(gl_FragCoord.xy));
  vec4 v0 = F(uVel0, c);
  vec4 a = cellAux(c);
  float cc = a.x/max(a.w, 1e-4);
  float alpha = mix(uNuA, uNuB, cc)*uDt/(uDx*uDx);
  if(a.w < 0.05 || alpha < 1e-4){ o = v0; return; }
  vec3 s = F(uVelIn, c+ivec3(1,0,0)).xyz + F(uVelIn, c-ivec3(1,0,0)).xyz + F(uVelIn, c+ivec3(0,1,0)).xyz
         + F(uVelIn, c-ivec3(0,1,0)).xyz + F(uVelIn, c+ivec3(0,0,1)).xyz + F(uVelIn, c-ivec3(0,0,1)).xyz;
  vec3 v = (v0.xyz + alpha*s)/(1.0 + 6.0*alpha);
  o = vec4(boundary(c, v, false), v0.w);
}`;

const DIV_FS = COMMON + `
uniform sampler2D uVelIn; uniform float uRho0, uDensK;
out vec4 o;
void main(){
  ivec3 c = t2c(ivec2(gl_FragCoord.xy));
  vec4 a = cellAux(c);
  if(a.z < 0.5){ o = vec4(0); return; }
  vec3 v = F(uVelIn, c).xyz;
  float div = F(uVelIn, c+ivec3(1,0,0)).x - v.x + F(uVelIn, c+ivec3(0,1,0)).y - v.y + F(uVelIn, c+ivec3(0,0,1)).z - v.z;
  div -= uDensK*clamp(a.w/uRho0 - 1.0, 0.0, 3.0);
  o = vec4(div, 0, 0, 0);
}`;

const PRESSURE_FS = COMMON + `
uniform sampler2D uP, uDiv;
out vec4 o;
void main(){
  ivec3 c = t2c(ivec2(gl_FragCoord.xy));
  vec4 a = cellAux(c);
  if(a.z < 0.5){ o = vec4(0); return; }
  ivec3 D[6] = ivec3[6](ivec3(1,0,0),ivec3(-1,0,0),ivec3(0,1,0),ivec3(0,-1,0),ivec3(0,0,1),ivec3(0,0,-1));
  float s = 0.0, k = 0.0;
  for(int i=0;i<6;i++){
    vec4 an = cellAux(c + D[i]);
    if(an.y > 0.5) continue;
    k += 1.0;
    if(an.z > 0.5) s += F(uP, c + D[i]).x;
  }
  o = vec4((s - F(uDiv, c).x)/max(k, 1.0), 0, 0, 0);
}`;

const PROJECT_FS = COMMON + BOUNDARY + `
uniform sampler2D uVelIn, uP;
out vec4 o;
void main(){
  ivec3 c = t2c(ivec2(gl_FragCoord.xy));
  vec4 v = F(uVelIn, c);
  float pc = cellAux(c).z > 0.5 ? F(uP, c).x : 0.0;
  ivec3 X = ivec3(1,0,0), Y = ivec3(0,1,0), Z = ivec3(0,0,1);
  vec4 aC = cellAux(c);
  vec4 aX = cellAux(c - X), aY = cellAux(c - Y), aZ = cellAux(c - Z);
  if(aC.z > 0.5 || aX.z > 0.5) v.x -= pc - (aX.z > 0.5 ? F(uP, c - X).x : 0.0);
  if(aC.z > 0.5 || aY.z > 0.5) v.y -= pc - (aY.z > 0.5 ? F(uP, c - Y).x : 0.0);
  if(aC.z > 0.5 || aZ.z > 0.5) v.z -= pc - (aZ.z > 0.5 ? F(uP, c - Z).x : 0.0);
  o = vec4(boundary(c, v.xyz, false), v.w);
}`;

const G2P_FS = COMMON + `
uniform sampler2D uPos, uVel, uGrid, uGridOld;
uniform int uPW, uN; uniform float uDt, uRho0, uMix;
uniform float uFlipA, uFlipB, uAdhA, uAdhB, uFrA, uFrB, uYieldA, uYieldB, uFoamA, uFoamB;
layout(location=0) out vec4 oP; layout(location=1) out vec4 oV;
void main(){
  ivec2 pc = ivec2(gl_FragCoord.xy); int id = pc.y*uPW + pc.x;
  vec4 P = texelFetch(uPos, pc, 0), V = texelFetch(uVel, pc, 0);
  if(id >= uN || P.y < -50.0){ oP = vec4(0.0, -100.0, 0.0, 0.0); oV = vec4(0); return; }
  float cc = P.w;
  vec3 g = P.xyz/uDx;
  vec3 vn = sampleVel(uGrid, g), vo = sampleVel(uGridOld, g);
  vec3 v = mix(vn, V.xyz + (vn - vo), mix(uFlipA, uFlipB, cc));
  // RK2 advection through the divergence-free grid field
  vec3 mid = P.xyz + 0.5*uDt*vn;
  vec3 np = P.xyz + uDt*sampleVel(uGrid, mid/uDx);
  vec4 cellI = tri(uAux, g - 0.5);
  float dens = cellI.w;
  // isolated spray particles fly ballistically
  if(dens < 0.25*uRho0) np = P.xyz + uDt*v;
  float vl = length(v), vmax = 2.5*uDx/uDt; if(vl > vmax) v *= vmax/vl;
  // collisions, adhesion and surface friction
  float r = uDx*0.25; vec3 n, sv;
  float d = solid(np, n, sv);
  if(d < r){ np += n*(r - d); float vnn = dot(v - sv, n); if(vnn < 0.0) v -= n*vnn; d = r; }
  float adhR = uDx*0.9;
  if(d < adhR){
    float adh = mix(uAdhA, uAdhB, cc), fr = mix(uFrA, uFrB, cc);
    vec3 rel = v - sv; float vnn = dot(rel, n); vec3 tng = rel - vnn*n;
    float fall = 1.0 - max(0.0, d - r)/(adhR - r);
    vnn -= adh*fall*uDt*4.0;
    if(d <= r*1.05) vnn = max(vnn, 0.0);
    v = sv + tng*(1.0 - fr*fall*0.5) + vnn*n;
  }
  np.y = min(np.y, uSize.y - r);
  // yield stress (mud): slow, dense material locks up
  float yv = mix(uYieldA, uYieldB, cc);
  if(yv > 0.0 && dens > 0.7*uRho0 && length(v) < yv) v *= 0.6;
  // foam from fast, under-dense fluid
  float fk = mix(uFoamA, uFoamB, cc);
  float deficit = clamp(1.0 - dens/uRho0*1.1, 0.0, 1.0);
  float foam = fk > 0.0 ? min(1.0, V.w*0.97 + fk*max(0.0, length(v) - 1.4)*(0.35*deficit + 0.01)*uDt*20.0) : V.w*0.9;
  // A/B mixing toward local grid concentration
  if(uMix > 0.0 && cellI.w > 1e-3) cc = mix(cc, clamp(cellI.x/cellI.w, 0.0, 1.0), clamp(uMix*uDt*4.0, 0.0, 1.0));
  oP = vec4(np, cc); oV = vec4(v, foam);
}`;

const WET_FS = COMMON + `
uniform sampler2D uWet; uniform float uDryA, uDryB, uDt, uRho0;
out vec4 o;
void main(){
  ivec3 c = t2c(ivec2(gl_FragCoord.xy));
  vec4 w = F(uWet, c);
  w.xy = max(w.xy - vec2(uDryA, uDryB)*uDt, 0.0);
  vec3 n, sv; float sd = solid((vec3(c)+0.5)*uDx, n, sv);
  vec4 a = cellAux(c);
  if(sd > -uDx && sd < uDx*1.5 && a.w > 0.25*uRho0){
    float cc = clamp(a.x/max(a.w,1e-4), 0.0, 1.0);
    w.x = max(w.x, 1.0 - cc); w.y = max(w.y, cc);
  }
  o = w;
}`;

// rigid-body probe: per sphere, count particles in a shell and sum their velocity
const PROBE_VS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uPos, uVel; uniform int uPW; uniform vec4 uSph[16]; uniform float uShell;
flat out vec4 vVal;
void main(){
  gl_PointSize = 1.0; gl_Position = vec4(2.0,2.0,2.0,1.0);
  ivec2 pc = ivec2(gl_VertexID % uPW, gl_VertexID / uPW);
  vec4 P = texelFetch(uPos, pc, 0); if(P.y < -50.0) return;
  vec4 S = uSph[gl_InstanceID];
  if(length(P.xyz - S.xyz) > S.w + uShell) return;
  vVal = vec4(texelFetch(uVel, pc, 0).xyz, 1.0);
  gl_Position = vec4((float(gl_InstanceID) + 0.5)/16.0*2.0 - 1.0, 0.0, 0.0, 1.0);
}`;
const PROBE_FS = `#version 300 es
precision highp float; flat in vec4 vVal; out vec4 o; void main(){ o = vVal; }`;

function compile(gl, vs, fs) {
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class GpuSim {
  constructor(gl, PW = 512) {
    this.gl = gl;
    this.floatBlend = !!gl.getExtension('EXT_float_blend');
    this.PW = PW; this.max = PW * PW;
    const P = (fs, vs = QUAD_VS) => compile(gl, vs, fs);
    this.prog = {
      splat: P(SPLAT_FS, SPLAT_VS), normalize: P(NORMALIZE_FS), extrap: P(EXTRAP_FS), forces: P(FORCES_FS),
      visc: P(VISC_FS), div: P(DIV_FS), pressure: P(PRESSURE_FS), project: P(PROJECT_FS), g2p: P(G2P_FS),
      wet: P(WET_FS), probe: P(PROBE_FS, PROBE_VS),
    };
    this.vao = gl.createVertexArray();
    // particle state ping-pong: pos (xyz, concentration of B), vel (xyz, foam)
    this.pPos = [this.tex(PW, PW, gl.RGBA32F, gl.NEAREST), this.tex(PW, PW, gl.RGBA32F, gl.NEAREST)];
    this.pVel = [this.tex(PW, PW, gl.RGBA32F, gl.NEAREST), this.tex(PW, PW, gl.RGBA32F, gl.NEAREST)];
    this.pFbo = [this.fbo([this.pPos[0], this.pVel[0]]), this.fbo([this.pPos[1], this.pVel[1]])];
    this.cur = 0;
    const pf = this.floatBlend ? gl.RGBA32F : gl.RGBA16F;
    this.probeTex = this.tex(16, 1, pf, gl.NEAREST); this.probeFbo = this.fbo([this.probeTex]);
    this.probeBuf = new Float32Array(64);
    this.mixRate = 0.15; this.gravity = -9.8; this.pressureIters = 40;
    this.spheres = []; this.boxes = []; this.emitters = []; this.emitter = null; this.ramp = null; this.piston = null;
    this.n = 0; this.time = 0;
    this.setMaterial('water'); this.setMaterial2('milk');
    this.configure(0.05, [2, 1.5, 1]);
  }
  setMaterial(k) { this.matKey = k; this.mat = { ...MATERIALS[k], render: MATERIALS[k].render }; }
  setMaterial2(k) { this.mat2Key = k; this.mat2 = { ...MATERIALS[k], render: MATERIALS[k].render }; }

  tex(w, h, ifmt, filter) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  fbo(texs) {
    const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU sim FBO incomplete: ' + st);
    return f;
  }

  // dx = grid cell size; particles are seeded 2x2x2 per cell
  configure(dx, size) {
    const gl = this.gl;
    this.dx = dx; this.s = dx * 0.5; this.size = size;
    this.gx = Math.ceil(size[0] / dx); this.gy = Math.ceil(size[1] / dx); this.gz = Math.ceil(size[2] / dx);
    const V = this.dim = [this.gx + 1, this.gy + 1, this.gz + 1];
    this.tiles = Math.ceil(Math.sqrt(V[2] * V[1] / V[0]));
    this.tiles = Math.max(1, Math.min(V[2], this.tiles));
    this.AW = V[0] * this.tiles; this.AH = V[1] * Math.ceil(V[2] / this.tiles);
    if (this.gridTex) for (const t of this.gridTex) gl.deleteTexture(t);
    const A = () => this.tex(this.AW, this.AH, gl.RGBA32F, gl.NEAREST);
    const bf = this.floatBlend ? gl.RGBA32F : gl.RGBA16F;
    this.accV = this.tex(this.AW, this.AH, bf, gl.NEAREST); this.accW = this.tex(this.AW, this.AH, bf, gl.NEAREST);
    this.velA = A(); this.velB = A(); this.velC = A(); this.velOld = A(); this.aux = A();
    this.div = A(); this.pA = A(); this.pB = A();
    this.wet = [this.tex(this.AW, this.AH, gl.RGBA16F, gl.LINEAR), this.tex(this.AW, this.AH, gl.RGBA16F, gl.LINEAR)];
    this.gridTex = [this.accV, this.accW, this.velA, this.velB, this.velC, this.velOld, this.aux, this.div, this.pA, this.pB, ...this.wet];
    this.F = {
      acc: this.fbo([this.accV, this.accW]), norm: this.fbo([this.velA, this.aux]),
      velA: this.fbo([this.velA]), velB: this.fbo([this.velB]), velC: this.fbo([this.velC]), velOld: this.fbo([this.velOld]),
      div: this.fbo([this.div]), pA: this.fbo([this.pA]), pB: this.fbo([this.pB]), wet: this.wet.map(t => this.fbo([t])),
    };
    for (const f of [this.F.wet[0], this.F.wet[1], this.F.pA, this.F.pB]) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    this.wetCur = 0;
    this.rho0 = 8.0; // particles per cell for 2x2x2 seeding (tent-weight sum)
  }

  clear() {
    this.n = 0; this.time = 0; this.spheres = []; this.boxes = []; this.emitters = []; this.emitter = null; this.ramp = null; this.piston = null;
    this.seedPos = new Float32Array(this.max * 4); this.seedVel = new Float32Array(this.max * 4);
    for (let i = 0; i < this.max; i++) this.seedPos[i * 4 + 1] = -100;
    this.seeding = true;
  }
  // CPU-side signed distance (for seeding + rigid bodies)
  solidDist(x, y, z, skipSphere = -1) {
    const [W, , D] = this.size; let b = 1e9;
    b = Math.min(b, x - (this.piston ? this.piston.x : 0), W - x, y, z, D - z);
    if (this.ramp) { const r = this.ramp, inv = 1 / Math.hypot(r.slope, 1); if (x > r.x0 - 0.2) b = Math.min(b, (x - r.x0) * -r.slope * inv + y * inv); }
    for (const B of this.boxes) {
      const qx = Math.abs(x - B.c[0]) - B.h[0], qy = Math.abs(y - B.c[1]) - B.h[1], qz = Math.abs(z - B.c[2]) - B.h[2];
      b = Math.min(b, Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0));
    }
    this.spheres.forEach((S, i) => { if (i !== skipSphere) b = Math.min(b, Math.hypot(x - S.c[0], y - S.c[1], z - S.c[2]) - S.r); });
    return b;
  }
  addParticle(x, y, z, vx = 0, vy = 0, vz = 0, conc = 0) {
    if (this.n >= this.max) return false;
    const i = this.n++;
    if (this.seeding) {
      this.seedPos.set([x, y, z, conc], i * 4); this.seedVel.set([vx, vy, vz, 0], i * 4);
    } else {
      (this.pending ||= []).push(i, x, y, z, conc, vx, vy, vz);
    }
    return true;
  }
  addBlock(min, max, vel = [0, 0, 0], conc = 0) {
    const s = this.s;
    for (let x = min[0] + s * 0.5; x < max[0]; x += s)
      for (let y = min[1] + s * 0.5; y < max[1]; y += s)
        for (let z = min[2] + s * 0.5; z < max[2]; z += s) {
          const j = s * 0.6;
          const px = x + (Math.random() - .5) * j, py = y + (Math.random() - .5) * j, pz = z + (Math.random() - .5) * j;
          if (this.solidDist(px, py, pz) < s * 0.5) continue;
          if (!this.addParticle(px, py, pz, vel[0], vel[1], vel[2], conc)) return;
        }
  }
  addSphere(c, r, density, vel = [0, 0, 0], fixed = false) {
    const m = density * 4 / 3 * Math.PI * r * r * r;
    const sp = { c: [...c], v: [...vel], r, m, fixed, density, color: density > 2000 ? [0.6, 0.62, 0.66] : density > 900 ? [0.8, 0.25, 0.2] : [0.85, 0.65, 0.35], rot: [1, 0, 0, 0], w: [0, 0, 0] };
    this.spheres.push(sp);
    const dyn = this.spheres.filter(s => !s.fixed);
    if (dyn.length > 14) this.spheres.splice(this.spheres.indexOf(dyn[0]), 1);
    return sp;
  }
  // upload seeded particles after scenario setup
  commit() {
    const gl = this.gl, PW = this.PW;
    for (const k of [0, 1]) {
      gl.bindTexture(gl.TEXTURE_2D, this.pPos[k]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PW, gl.RGBA, gl.FLOAT, this.seedPos);
      gl.bindTexture(gl.TEXTURE_2D, this.pVel[k]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PW, gl.RGBA, gl.FLOAT, this.seedVel);
    }
    this.seedPos = this.seedVel = null; this.seeding = false; this.cur = 0;
  }
  flushPending() {
    const p = this.pending; if (!p || !p.length) return;
    const gl = this.gl, PW = this.PW, one = new Float32Array(4);
    // group contiguous indices on the same row
    let k = 0;
    while (k < p.length) {
      const start = p[k]; let cnt = 0;
      while (k + cnt * 8 < p.length && p[k + cnt * 8] === start + cnt && ((start + cnt) % PW) >= (start % PW)) cnt++;
      const pos = new Float32Array(cnt * 4), vel = new Float32Array(cnt * 4);
      for (let j = 0; j < cnt; j++) { const b = k + j * 8; pos.set([p[b + 1], p[b + 2], p[b + 3], p[b + 4]], j * 4); vel.set([p[b + 5], p[b + 6], p[b + 7], 0], j * 4); }
      gl.bindTexture(gl.TEXTURE_2D, this.pPos[this.cur]); gl.texSubImage2D(gl.TEXTURE_2D, 0, start % PW, (start / PW) | 0, cnt, 1, gl.RGBA, gl.FLOAT, pos);
      gl.bindTexture(gl.TEXTURE_2D, this.pVel[this.cur]); gl.texSubImage2D(gl.TEXTURE_2D, 0, start % PW, (start / PW) | 0, cnt, 1, gl.RGBA, gl.FLOAT, vel);
      k += cnt * 8;
    }
    this.pending.length = 0;
  }

  emitOne(e, dt) {
    if (this.time > e.until) return;
    e.acc += e.speed * dt;
    const s = this.s;
    while (e.acc >= s) {
      e.acc -= s;
      for (let i = -e.radius; i <= e.radius + 1e-6; i += s) for (let j = -e.radius; j <= e.radius + 1e-6; j += s) {
        if (i * i + j * j > e.radius * e.radius) continue;
        const jx = (Math.random() - .5) * s * 0.3, jz = (Math.random() - .5) * s * 0.3;
        this.addParticle(e.pos[0] + i + jx, e.pos[1] - e.acc, e.pos[2] + j + jz, e.dir[0] * e.speed, e.dir[1] * e.speed, e.dir[2] * e.speed, e.conc || 0);
      }
    }
  }

  // ---------- GPU passes ----------
  common(pr) {
    const gl = this.gl, u = pr.u;
    gl.uniform3i(u.uDim, ...this.dim); gl.uniform1i(u.uTiles, this.tiles); gl.uniform1f(u.uDx, this.dx);
    gl.uniform3fv(u.uSize, this.size);
    gl.uniform2f(u.uPiston, this.piston ? this.piston.x : -1, this.piston ? this.piston.vx : 0);
    gl.uniform3f(u.uRamp, this.ramp ? this.ramp.x0 : 0, this.ramp ? this.ramp.slope : 0, this.ramp ? 1 : 0);
    const bc = new Float32Array(16), bh = new Float32Array(16);
    this.boxes.slice(0, 4).forEach((B, i) => { bc.set(B.c, i * 4); bh.set(B.h, i * 4); });
    gl.uniform4fv(u.uBoxC, bc); gl.uniform4fv(u.uBoxH, bh); gl.uniform1i(u.uNBox, Math.min(4, this.boxes.length));
    gl.uniform4fv(u.uSph, this.sphU); gl.uniform4fv(u.uSphV, this.sphV); gl.uniform1i(u.uNSph, Math.min(16, this.spheres.length));
  }
  bindTex(pr, name, tex, unit) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(pr.u[name], unit);
  }
  gridPass(pr, fbo, texs, extra) {
    const gl = this.gl;
    gl.useProgram(pr.p); this.common(pr);
    let unit = 0;
    for (const [name, t] of Object.entries(texs)) if (t) this.bindTex(pr, name, t, unit++);
    if (!('uAux' in texs)) this.bindTex(pr, 'uAux', this.aux, unit++);
    if (extra) extra(pr.u);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, this.AW, this.AH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  step(dt) {
    const gl = this.gl;
    if (this.seeding) this.commit();
    this.time += dt;
    if (this.piston) {
      const P = this.piston, w = 2 * Math.PI / P.period, nx = 0.02 + P.amp * 0.5 * (1 - Math.cos(w * this.time));
      P.vx = (nx - P.x) / dt; P.x = nx;
    }
    if (this.emitter) this.emitOne(this.emitter, dt);
    for (const e of this.emitters) this.emitOne(e, dt);
    this.flushPending();
    this.stepRigid(dt);
    this.sphU = new Float32Array(64); this.sphV = new Float32Array(64);
    this.spheres.slice(0, 16).forEach((S, i) => { this.sphU.set([...S.c, S.r], i * 4); this.sphV.set([...S.v, 0], i * 4); });

    const m = this.mat, m2 = this.mat2;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    // P2G
    const pr = this.prog;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.F.acc); gl.viewport(0, 0, this.AW, this.AH);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(pr.splat.p); this.common(pr.splat);
    this.bindTex(pr.splat, 'uPos', this.pPos[this.cur], 0); this.bindTex(pr.splat, 'uVel', this.pVel[this.cur], 1);
    gl.uniform1i(pr.splat.u.uPW, this.PW); gl.uniform2f(pr.splat.u.uAtlas, this.AW, this.AH);
    gl.drawArraysInstanced(gl.POINTS, 0, this.n, 27);
    gl.disable(gl.BLEND);
    // grid
    this.gridPass(pr.normalize, this.F.norm, { uAccV: this.accV, uAccW: this.accW, uAux: null });
    // note: normalize wrote aux; following passes read it
    this.gridPass(pr.extrap, this.F.velOld, { uVelIn: this.velA });
    const fric = (u) => { gl.uniform1f(u.uFricA, m.friction); gl.uniform1f(u.uFricB, m2.friction); };
    this.gridPass(pr.forces, this.F.velA, { uVelIn: this.velOld }, u => { gl.uniform1f(u.uG, this.gravity); gl.uniform1f(u.uDt, dt); fric(u); });
    let cur = this.velA, curF = 'velA';
    const nu = (vis) => 0.6 * Math.pow(vis, 2.5);
    if (m.visc > 0.05 || m2.visc > 0.05) {
      const its = Math.max(m.viscIters, m2.viscIters) * 2 + 4;
      let src = this.velA, dsts = [['velB', this.velB], ['velC', this.velC]];
      for (let i = 0; i < its; i++) {
        const [fn, ft] = dsts[i & 1];
        this.gridPass(pr.visc, this.F[fn], { uVelIn: src, uVel0: this.velA }, u => { gl.uniform1f(u.uNuA, nu(m.visc)); gl.uniform1f(u.uNuB, nu(m2.visc)); gl.uniform1f(u.uDt, dt); fric(u); });
        src = ft; cur = ft; curF = fn;
      }
    }
    this.gridPass(pr.div, this.F.div, { uVelIn: cur }, u => { gl.uniform1f(u.uRho0, this.rho0); gl.uniform1f(u.uDensK, 0.1 * this.dx / dt); });
    let pSrc = this.pA, pDst = 'pB';
    for (let i = 0; i < this.pressureIters; i++) {
      this.gridPass(pr.pressure, this.F[pDst], { uP: pSrc, uDiv: this.div });
      pSrc = pDst === 'pB' ? this.pB : this.pA; pDst = pDst === 'pB' ? 'pA' : 'pB';
    }
    const outF = curF === 'velB' ? 'velC' : 'velB', outT = outF === 'velB' ? this.velB : this.velC;
    this.gridPass(pr.project, this.F[outF], { uVelIn: cur, uP: pSrc }, fric);
    // G2P + advection
    const nxt = 1 - this.cur;
    gl.useProgram(pr.g2p.p); this.common(pr.g2p);
    this.bindTex(pr.g2p, 'uPos', this.pPos[this.cur], 0); this.bindTex(pr.g2p, 'uVel', this.pVel[this.cur], 1);
    this.bindTex(pr.g2p, 'uGrid', outT, 2); this.bindTex(pr.g2p, 'uGridOld', this.velOld, 3); this.bindTex(pr.g2p, 'uAux', this.aux, 4);
    const u = pr.g2p.u;
    gl.uniform1i(u.uPW, this.PW); gl.uniform1i(u.uN, this.n); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uRho0, this.rho0); gl.uniform1f(u.uMix, this.mixRate);
    for (const [k, f] of [['Flip', 'flip'], ['Adh', 'adhesion'], ['Fr', 'friction'], ['Yield', 'yieldV'], ['Foam', 'foam']]) { gl.uniform1f(u['u' + k + 'A'], m[f]); gl.uniform1f(u['u' + k + 'B'], m2[f]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pFbo[nxt]); gl.viewport(0, 0, this.PW, Math.ceil(this.n / this.PW));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = nxt;
    // wetness
    const wn = 1 - this.wetCur;
    this.gridPass(pr.wet, this.F.wet[wn], { uWet: this.wet[this.wetCur] }, u => { gl.uniform1f(u.uDryA, m.dry); gl.uniform1f(u.uDryB, m2.dry); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uRho0, this.rho0); });
    this.wetCur = wn;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // fluid -> rigid coupling, once per frame (GPU reduction + small readback)
  coupleRigid(dt) {
    const dyn = this.spheres.slice(0, 16);
    if (!dyn.some(s => !s.fixed) || !this.n) return;
    const gl = this.gl, pr = this.prog.probe, shell = this.dx;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFbo); gl.viewport(0, 0, 16, 1);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(pr.p);
    this.bindTex(pr, 'uPos', this.pPos[this.cur], 0); this.bindTex(pr, 'uVel', this.pVel[this.cur], 1);
    gl.uniform1i(pr.u.uPW, this.PW); gl.uniform4fv(pr.u.uSph, this.sphU); gl.uniform1f(pr.u.uShell, shell);
    gl.drawArraysInstanced(gl.POINTS, 0, this.n, dyn.length);
    gl.disable(gl.BLEND);
    gl.readPixels(0, 0, 16, 1, gl.RGBA, gl.FLOAT, this.probeBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const ac = 0.5; // mixture estimate
    const den = this.mat.density, vis = this.mat.visc;
    dyn.forEach((S, i) => {
      if (S.fixed) return;
      const cnt = this.probeBuf[i * 4 + 3]; if (cnt < 1) return;
      const R = S.r, Ro = R + shell;
      const expected = (4 / 3) * Math.PI * (Ro ** 3 - R ** 3) / (this.s ** 3);
      const frac = Math.min(1, cnt / expected * 1.1);
      const Vs = (4 / 3) * Math.PI * R ** 3;
      S.v[1] += den * Vs * frac * -this.gravity / S.m * dt;
      const fv = [0, 1, 2].map(k => this.probeBuf[i * 4 + k] / cnt);
      const k = (3 + 60 * vis * vis) * frac * Math.min(1, 1500 / S.density + 0.2);
      const a = 1 - Math.exp(-k * dt);
      for (let j = 0; j < 3; j++) S.v[j] += (fv[j] - S.v[j]) * a;
    });
    void ac;
  }

  stepRigid(dt) {
    const [W, , D] = this.size;
    const S = this.spheres;
    for (const s of S) {
      if (s.fixed) { s.v = [0, 0, 0]; continue; }
      s.v[1] += this.gravity * dt;
      for (let k = 0; k < 3; k++) s.c[k] += s.v[k] * dt;
      const lox = this.piston ? this.piston.x : 0;
      const bounce = (axis, sign, lim) => {
        const pen = sign > 0 ? lim + s.r - s.c[axis] : s.c[axis] + s.r - lim;
        if (pen > 0) { s.c[axis] += sign * pen; const vn = s.v[axis] * sign; if (vn < 0) s.v[axis] -= 1.3 * vn * sign; for (let k = 0; k < 3; k++) if (k !== axis) s.v[k] *= 0.98; }
      };
      bounce(0, 1, lox); bounce(0, -1, W); bounce(1, 1, 0); bounce(2, 1, 0); bounce(2, -1, D);
      if (this.piston && s.c[0] - s.r < lox + 0.001) s.v[0] = Math.max(s.v[0], this.piston.vx);
      if (this.ramp) {
        const r = this.ramp, inv = 1 / Math.hypot(r.slope, 1), nx = -r.slope * inv, ny = inv;
        const d = (s.c[0] - r.x0) * nx + s.c[1] * ny - s.r;
        if (s.c[0] > r.x0 - 0.2 && d < 0) { s.c[0] -= nx * d; s.c[1] -= ny * d; const vn = s.v[0] * nx + s.v[1] * ny; if (vn < 0) { s.v[0] -= 1.3 * vn * nx; s.v[1] -= 1.3 * vn * ny; } }
      }
      for (const B of this.boxes) {
        const px = s.c[0] - B.c[0], py = s.c[1] - B.c[1], pz = s.c[2] - B.c[2];
        const cx = Math.max(-B.h[0], Math.min(B.h[0], px)), cy = Math.max(-B.h[1], Math.min(B.h[1], py)), cz = Math.max(-B.h[2], Math.min(B.h[2], pz));
        const dx = px - cx, dy = py - cy, dz = pz - cz, l = Math.hypot(dx, dy, dz);
        if (l < s.r && l > 1e-6) {
          const pen = s.r - l, nx = dx / l, ny = dy / l, nz = dz / l;
          s.c[0] += nx * pen; s.c[1] += ny * pen; s.c[2] += nz * pen;
          const vn = s.v[0] * nx + s.v[1] * ny + s.v[2] * nz; if (vn < 0) { s.v[0] -= 1.3 * vn * nx; s.v[1] -= 1.3 * vn * ny; s.v[2] -= 1.3 * vn * nz; }
        }
      }
      // visual spin
      s.w = [s.v[2] / s.r * 0.5, 0, -s.v[0] / s.r * 0.5];
      const wl = Math.hypot(...s.w);
      if (wl > 1e-5) {
        const ang = wl * dt, sn = Math.sin(ang / 2), q = [Math.cos(ang / 2), s.w[0] / wl * sn, 0, s.w[2] / wl * sn], r = s.rot;
        s.rot = [q[0] * r[0] - q[1] * r[1] - q[2] * r[2] - q[3] * r[3], q[0] * r[1] + q[1] * r[0] + q[2] * r[3] - q[3] * r[2], q[0] * r[2] - q[1] * r[3] + q[2] * r[0] + q[3] * r[1], q[0] * r[3] + q[1] * r[2] - q[2] * r[1] + q[3] * r[0]];
        const ql = Math.hypot(...s.rot); s.rot = s.rot.map(e => e / ql);
      }
    }
    for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
      const A = S[a], B = S[b];
      const dx = B.c[0] - A.c[0], dy = B.c[1] - A.c[1], dz = B.c[2] - A.c[2], l = Math.hypot(dx, dy, dz), pen = A.r + B.r - l;
      if (pen > 0 && l > 1e-6) {
        const nx = dx / l, ny = dy / l, nz = dz / l, ia = A.fixed ? 0 : 1 / A.m, ib = B.fixed ? 0 : 1 / B.m, it = ia + ib; if (!it) continue;
        for (let k = 0; k < 3; k++) { const nk = [nx, ny, nz][k]; A.c[k] -= nk * pen * ia / it; B.c[k] += nk * pen * ib / it; }
        const vr = (B.v[0] - A.v[0]) * nx + (B.v[1] - A.v[1]) * ny + (B.v[2] - A.v[2]) * nz;
        if (vr < 0) { const j = -1.4 * vr / it; for (let k = 0; k < 3; k++) { const nk = [nx, ny, nz][k]; A.v[k] -= j * ia * nk; B.v[k] += j * ib * nk; } }
      }
    }
  }

  get posTex() { return this.pPos[this.cur]; }
  get velTex() { return this.pVel[this.cur]; }
  get wetTex() { return this.wet[this.wetCur]; }
  get activeEmitters() { return [...(this.emitter ? [this.emitter] : []), ...this.emitters].filter(e => this.time < e.until); }
}
