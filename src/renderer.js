// Screen-space fluid renderer (the technique used by NVIDIA FleX / Unreal-style real-time liquids):
//  1. scene pass      -> HDR-ish color + depth (tank, obstacles, rigid bodies, sky)
//  2. depth splat     -> particles as ray-cast spheres into linear eye depth (R32F)
//  3. thickness splat -> additive per-pixel fluid thickness + foam (RG16F)
//  4. bilateral depth smoothing (separable, depth-aware, screen-space radius)
//  5. composite       -> normals from smoothed depth, Fresnel, GGX specular, env reflection,
//                        refraction w/ Beer-Lambert absorption, multiple scattering for opaque fluids,
//                        foam, mud grain, ACES tonemapping.
import { mat4 } from './math.js';

const COMMON = /* glsl */`#version 300 es
precision highp float;
precision highp int;
uniform vec3 uSunDir;
// fluid light-space maps (shadows / caustics)
uniform sampler2D uLDepth, uLThick;
uniform mat4 uLightVP, uLightView;
uniform vec3 uAbsA, uAbsB; uniform float uScA, uScB, uTime;
// thickness of fluid between the sun and world point p; .yzw unused
float fluidFront(vec3 p, out float mx, out vec2 luv){
  vec4 lc = uLightVP*vec4(p,1.0); luv = lc.xy*0.5+0.5;
  if(any(lessThan(luv,vec2(0.0))) || any(greaterThan(luv,vec2(1.0)))){ mx = 0.0; return 0.0; }
  float fNear = texture(uLDepth, luv).r; vec3 lt = texture(uLThick, luv).rgb;
  float pd = -(uLightView*vec4(p,1.0)).z;
  mx = clamp(lt.z/max(lt.x,1e-4), 0.0, 1.0);
  return clamp(pd - fNear - 0.01, 0.0, lt.x);
}
// colored light transmitted through the fluid (Beer-Lambert + scattering extinction)
vec3 fluidTransmit(float front, float mx){
  vec3 ext = mix(uAbsA, uAbsB, mx) + vec3(mix(uScA, uScB, mx))*0.35;
  return exp(-ext*front*0.9);
}
// animated caustic pattern (iterated warp), strongest under thin layers of clear liquid
float caustic(vec2 p, float t){
  vec2 i = p; float c = 1.0; const float inten = 0.005;
  for(int n=0;n<4;n++){
    float tt = t*(1.0 - 3.5/float(n+1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0/length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 3.0);
}
vec3 sky(vec3 d){
  d = normalize(d);
  float y = d.y;
  vec3 ground = vec3(0.22,0.2,0.18);
  vec3 horizon = vec3(0.85,0.88,0.92);
  vec3 zenith = vec3(0.22,0.42,0.78);
  vec3 c = y < 0.0 ? mix(horizon*0.6, ground, smoothstep(0.0,-0.25,y)) : mix(horizon, zenith, pow(smoothstep(0.0,1.0,y),0.6));
  // soft studio light panels (give liquids nice readable highlights)
  float a = atan(d.z, d.x);
  float panel = smoothstep(0.12,0.08,abs(y-0.45)) * smoothstep(0.35,0.25,abs(fract(a/1.5708+0.5)-0.5));
  c += vec3(1.6,1.55,1.5)*panel;
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0,0.9,0.75)*(pow(s,900.0)*60.0 + pow(s,12.0)*0.35);
  return c;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
`;

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
out vec2 vUv;
void main(){ vec2 p = P[gl_VertexID]; vUv = p*0.5+0.5; gl_Position = vec4(p,0,1); }`;

const SKY_FS = COMMON + `
in vec2 vUv; uniform mat4 uInvViewProj; out vec4 o;
void main(){
  vec4 a = uInvViewProj*vec4(vUv*2.0-1.0, 1.0, 1.0); vec4 b = uInvViewProj*vec4(vUv*2.0-1.0,-1.0,1.0);
  vec3 d = normalize(a.xyz/a.w - b.xyz/b.w);
  o = vec4(pow(aces(sky(d)*0.9), vec3(1.0/2.2)), 1.0);
}`;

const MESH_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm;
uniform mat4 uModel, uViewProj;
out vec3 vW; out vec3 vN; out vec3 vL;
void main(){ vec4 w = uModel*vec4(aPos,1.0); vW = w.xyz; vL = aPos; vN = mat3(transpose(inverse(uModel)))*aNrm; gl_Position = uViewProj*w; }`;

const MESH_FS = COMMON + `
in vec3 vW; in vec3 vN; in vec3 vL;
uniform int uMode; uniform vec3 uColor; uniform vec3 uCam;
uniform vec4 uSph[16]; uniform int uNSph;
uniform sampler2D uWet; uniform ivec3 uWDim; uniform int uWTiles; uniform float uWDx; uniform vec3 uWetSize; uniform int uWetOn;
vec2 wetSlice(vec2 g, int z){
  vec2 off = vec2(float(z % uWTiles)*float(uWDim.x), float(z / uWTiles)*float(uWDim.y));
  return texture(uWet, (off + g + 0.5)/vec2(textureSize(uWet,0))).rg;
}
vec2 wetAt(vec3 p){
  vec3 g = clamp(p/uWDx - 0.5, vec3(0.0), vec3(uWDim) - 2.0);
  float z0 = floor(g.z);
  return mix(wetSlice(g.xy, int(z0)), wetSlice(g.xy, int(z0)+1), g.z - z0);
}
uniform vec3 uStainA, uStainB; uniform float uOpqA, uOpqB;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
  if(uMode==4){ o = vec4(uColor,1.0); return; }
  vec3 base = uColor; float specK = 0.25; float shin = 40.0;
  if(uMode==1){ // ceramic tiles
    vec3 an = abs(N); vec2 uv = an.y>0.5 ? vW.xz : (an.x>0.5 ? vW.zy : vW.xy);
    uv /= 0.2; vec2 f = fract(uv); vec2 id = floor(uv);
    float grout = step(0.04, f.x)*step(0.04,f.y)*step(f.x,0.96)*step(f.y,0.96);
    base = mix(vec3(0.35,0.36,0.37), uColor*(0.92+0.08*hash(id)), grout);
    specK = 0.5*grout; shin = 90.0;
  } else if(uMode==2){ // beach-ball / marked rigid body so rotation is visible
    float a = atan(vL.z, vL.x); float seg = mod(floor(a/1.0472+3.0), 2.0);
    base = mix(uColor, vec3(0.95), seg*step(abs(vL.y),0.85));
    if(abs(vL.y)>0.85) base = vec3(0.95);
    specK = 0.6; shin = 80.0;
  } else if(uMode==3){ // ground
    vec2 c = floor(vW.xz/0.5); float ch = mod(c.x+c.y,2.0);
    base = mix(vec3(0.26,0.27,0.29), vec3(0.32,0.33,0.35), ch);
  } else if(uMode==5){ // metal obstacle
    specK = 0.9; shin = 60.0;
  }
  // ---- wet surfaces / stains left behind by the fluid
  float wetAmt = 0.0;
  if(uWetOn==1){
    vec3 q = vW + N*0.04;
    if(all(greaterThanEqual(q, vec3(0.0))) && all(lessThanEqual(q, uWetSize))){
      vec2 w = wetAt(q);
      wetAmt = clamp(max(w.r, w.g)*1.4, 0.0, 1.0);
      float bmix = w.g/max(w.r+w.g, 1e-3);
      vec3 stain = mix(uStainA, uStainB, bmix); float opq = mix(uOpqA, uOpqB, bmix);
      float hn = hash(floor(vW.xz*60.0)+floor(vW.y*60.0));
      vec3 darkened = base*mix(0.55, 0.85, hn*0.3);               // clear liquids just darken
      vec3 coated = mix(base, stain, 0.85);                        // opaque liquids leave a film
      base = mix(base, mix(darkened, coated, opq), wetAmt);
      specK = mix(specK, 1.2, wetAmt); shin = mix(shin, 160.0, wetAmt);
    }
  }
  vec3 L = uSunDir;
  float sh = 1.0, ao = 1.0;
  // ---- fluid shadow + caustics
  float fmx; vec2 luv; float front = fluidFront(vW, fmx, luv);
  vec3 ftr = fluidTransmit(front, fmx);
  float clear = 1.0 - clamp(mix(uScA, uScB, fmx)/4.0, 0.0, 1.0);
  float cw = clear*smoothstep(0.0, 0.04, front)*(1.0 - 0.6*smoothstep(0.2, 1.2, front));
  vec3 lightTint = ftr*(1.0 + caustic(vW.xz*7.0 + vW.y*3.0, uTime*0.9)*cw*1.6);
  for(int i=0;i<16;i++){ if(i>=uNSph) break;
    vec3 c = uSph[i].xyz; float r = uSph[i].w; vec3 pc = c - vW;
    float t = dot(pc, L);
    if(t>0.0){ float d = length(pc - L*t); sh *= mix(1.0, smoothstep(r*0.5, r*1.25, d), 0.85); }
    float l = length(pc); ao *= 1.0 - clamp(r*r/(l*l)*max(dot(N, pc/l),0.0), 0.0, 1.0)*0.8;
  }
  float diff = max(dot(N,L),0.0)*sh;
  vec3 sunC = vec3(1.25,1.18,1.05)*lightTint;
  vec3 amb = mix(vec3(0.25,0.23,0.2), vec3(0.55,0.62,0.72), N.y*0.5+0.5)*0.55*ao;
  vec3 V = normalize(uCam - vW); vec3 H = normalize(L+V);
  float spec = pow(max(dot(N,H),0.0), shin)*specK*sh;
  vec3 col = base*(diff*sunC + amb) + spec*lightTint;
  if(uMode==5){ col += sky(reflect(-V,N))*0.25*base; }
  o = vec4(pow(aces(col), vec3(1.0/2.2)), 1.0);
}`;

const PT_VS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uPosT, uVelT; uniform int uPW;
uniform mat4 uView, uProj; uniform float uRadius, uScreenH;
out vec3 vVP; out float vFoam; out float vConc;
void main(){
  ivec2 pc = ivec2(gl_VertexID % uPW, gl_VertexID / uPW);
  vec4 P = texelFetch(uPosT, pc, 0);
  if(P.y < -50.0){ gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; vVP = vec3(0); vFoam = 0.0; vConc = 0.0; return; }
  vec3 aPos = P.xyz;
  vec4 vp = uView*vec4(aPos,1.0); vVP = vp.xyz; vFoam = texelFetch(uVelT, pc, 0).w; vConc = P.w;
  gl_Position = uProj*vp;
  gl_PointSize = max(uRadius*uProj[1][1]*uScreenH/gl_Position.w, 1.0);
}`;

const PT_DEPTH_FS = `#version 300 es
precision highp float;
in vec3 vVP; in float vFoam; uniform mat4 uProj; uniform float uRadius;
out float o;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0; c.y = -c.y; float r2 = dot(c,c); if(r2>1.0) discard;
  vec3 p = vVP + vec3(c, sqrt(1.0-r2))*uRadius;
  vec4 cp = uProj*vec4(p,1.0); gl_FragDepth = cp.z/cp.w*0.5+0.5;
  o = -p.z;
}`;

const PT_THICK_FS = `#version 300 es
precision highp float;
in vec3 vVP; in float vFoam; in float vConc; uniform float uRadius;
out vec4 o;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0; float r2 = dot(c,c); if(r2>1.0) discard;
  float t = sqrt(1.0-r2);
  float th = 2.0*uRadius*t;
  o = vec4(th, vFoam*th, vConc*th, 0.0);
}`;

const PT_DEBUG_FS = COMMON + `
in vec3 vVP; in float vFoam; in float vConc; uniform mat4 uProj, uView; uniform float uRadius; uniform vec3 uColor, uColor2;
out vec4 o;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0; c.y=-c.y; float r2 = dot(c,c); if(r2>1.0) discard;
  vec3 n = vec3(c, sqrt(1.0-r2)); vec3 p = vVP + n*uRadius;
  vec4 cp = uProj*vec4(p,1.0); gl_FragDepth = cp.z/cp.w*0.5+0.5;
  vec3 L = (uView*vec4(uSunDir,0.0)).xyz;
  vec3 col = mix(mix(uColor, uColor2, vConc), vec3(1.0), vFoam)*(max(dot(n,L),0.0)*0.9+0.3);
  o = vec4(pow(aces(col),vec3(1.0/2.2)),1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uDepth; uniform ivec2 uDir; uniform float uWorldR, uP11, uH, uFall;
out float o;
void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy); ivec2 sz = textureSize(uDepth,0);
  float d = texelFetch(uDepth, ip, 0).r;
  if(d > 1e4){ o = d; return; }
  float rpx = min(uWorldR*uP11*uH*0.5/d, 20.0);
  int R = int(ceil(rpx)); float sig = max(rpx*0.5, 0.5); float i2s = 1.0/(2.0*sig*sig);
  float sum = 0.0, ws = 0.0;
  for(int i=-20;i<=20;i++){
    if(i<-R || i>R) continue;
    ivec2 q = clamp(ip + uDir*i, ivec2(0), sz-1);
    float s = texelFetch(uDepth, q, 0).r;
    if(s > 1e4) continue;
    float dz = (s-d)/uFall;
    float w = exp(-float(i*i)*i2s - dz*dz);
    sum += s*w; ws += w;
  }
  o = sum/ws;
}`;

const COMP_FS = COMMON + `
in vec2 vUv;
uniform sampler2D uScene, uSceneDepth, uFluidDepth, uThick;
uniform mat4 uInvView; uniform float uP00, uP11, uNear, uFar; uniform vec2 uRes;
uniform vec3 uAbsorbA, uAlbedoA, uSSSA; uniform float uScatterA, uRoughA, uF0A, uRefractA, uWrapA, uGrainA, uEnvA;
uniform vec3 uAbsorbB, uAlbedoB, uSSSB; uniform float uScatterB, uRoughB, uF0B, uRefractB, uWrapB, uGrainB, uEnvB;
out vec4 o;
vec3 viewPos(vec2 uv, float d){ vec2 ndc = uv*2.0-1.0; return vec3(ndc.x*d/uP00, ndc.y*d/uP11, -d); }
float hash3(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float D_GGX(float NoH, float a){ float a2=a*a; float d=NoH*NoH*(a2-1.0)+1.0; return a2/(3.14159*d*d); }
float V_SmithJ(float NoV, float NoL, float a){ float k=a*0.5; return 0.25/((NoV*(1.0-k)+k)*(NoL*(1.0-k)+k)); }
void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec3 scene = pow(texture(uScene, vUv).rgb, vec3(2.2));
  float zb = texture(uSceneDepth, vUv).r*2.0-1.0;
  float sceneLin = 2.0*uNear*uFar/(uFar+uNear - zb*(uFar-uNear));
  float d = texelFetch(uFluidDepth, ip, 0).r;
  vec3 th = texelFetch(uThick, ip, 0).rgb;
  if(d > 1e4 || d > sceneLin + 0.002 || th.x < 1e-4){ o = vec4(pow(scene, vec3(1.0/2.2)),1.0); return; }

  // ---- normal reconstruction from smoothed depth (choose smaller derivative to avoid edge artifacts)
  vec2 px = 1.0/uRes;
  vec3 P = viewPos(vUv, d);
  float dr = texelFetch(uFluidDepth, ip+ivec2(1,0),0).r, dl = texelFetch(uFluidDepth, ip-ivec2(1,0),0).r;
  float du = texelFetch(uFluidDepth, ip+ivec2(0,1),0).r, dd = texelFetch(uFluidDepth, ip-ivec2(0,1),0).r;
  vec3 ddx = viewPos(vUv+vec2(px.x,0), dr) - P, ddx2 = P - viewPos(vUv-vec2(px.x,0), dl);
  if(dr>1e4 || (dl<1e4 && abs(ddx.z) > abs(ddx2.z))) ddx = ddx2;
  vec3 ddy = viewPos(vUv+vec2(0,px.y), du) - P, ddy2 = P - viewPos(vUv-vec2(0,px.y), dd);
  if(du>1e4 || (dd<1e4 && abs(ddy.z) > abs(ddy2.z))) ddy = ddy2;
  vec3 N = normalize(cross(ddx, ddy));
  vec3 V = normalize(-P);
  if(dot(N,V)<0.0) N = -N;

  // per-pixel material blend from thickness-weighted concentration of fluid B
  float mx = clamp(th.z/max(th.x,1e-4), 0.0, 1.0);
  vec3 uAbsorb = mix(uAbsorbA, uAbsorbB, mx), uAlbedo = mix(uAlbedoA, uAlbedoB, mx), uSSS = mix(uSSSA, uSSSB, mx);
  // scattering mixes in log-space so a little milk clouds water (like real emulsions)
  float uScatter = mix(uScatterA, uScatterB, sqrt(mx));
  if(uScatterA > uScatterB) uScatter = mix(uScatterA, uScatterB, mx*mx);
  float uRough = mix(uRoughA, uRoughB, mx), uF0 = mix(uF0A, uF0B, mx), uRefract = mix(uRefractA, uRefractB, mx);
  float uWrap = mix(uWrapA, uWrapB, mx), uGrain = mix(uGrainA, uGrainB, mx), uEnv = mix(uEnvA, uEnvB, mx);
  vec3 Pw = (uInvView*vec4(P,1.0)).xyz;
  vec3 Nw = normalize((uInvView*vec4(N,0.0)).xyz);
  vec3 Vw = normalize((uInvView*vec4(V,0.0)).xyz);
  float rough = uRough;
  vec3 albedo = uAlbedo;
  if(uGrain > 0.0){ // mud: clumpy, grainy, matte with wet glossy patches
    float n1 = noise(Pw*28.0), n2 = noise(Pw*7.0);
    albedo *= 0.75 + 0.5*n1*n2 + 0.15*n2;
    rough = mix(0.25, 0.8, smoothstep(0.35,0.65,n2));
    Nw = normalize(Nw + (vec3(noise(Pw*40.0+3.1), noise(Pw*40.0+7.7), noise(Pw*40.0+1.3))-0.5)*0.35*uGrain);
  }
  float thick = th.x;
  float foam = smoothstep(0.15, 0.7, th.y/max(thick,1e-4));

  vec3 L = uSunDir;
  float NoV = clamp(dot(Nw,Vw), 1e-3, 1.0);
  float NoL = clamp(dot(Nw,L), 0.0, 1.0);
  float smx; vec2 sluv; float sfront = fluidFront(Pw - Nw*0.005, smx, sluv);
  vec3 selfSh = mix(vec3(1.0), fluidTransmit(sfront, smx), 0.85);
  vec3 Hh = normalize(L+Vw); float NoH = clamp(dot(Nw,Hh),0.0,1.0);
  float a = max(rough*rough, 0.002);
  float F = uF0 + (1.0-uF0)*pow(1.0-NoV, 5.0);

  // ---- refraction with Beer-Lambert absorption (transparent liquids)
  vec2 off = N.xy*uRefract*min(thick, 1.0)*0.06;
  vec3 bg = pow(texture(uScene, clamp(vUv - off, 0.001, 0.999)).rgb, vec3(2.2));
  vec3 trans = exp(-uAbsorb*thick);
  vec3 refr = bg*trans;
  // in-scattered light inside thick translucent liquid (honey glow, ocean color)
  vec3 inscat = (1.0-trans)*uSSS*(0.25 + 0.75*pow(clamp(dot(Vw,-L)*0.5+0.5,0.0,1.0),3.0))*0.6;
  refr += inscat;

  // ---- multiple-scattering body (milk, chocolate, mud): wrap diffuse + translucency
  float opac = 1.0 - exp(-uScatter*thick);
  float wrapd = clamp((dot(Nw,L)+uWrap)/(1.0+uWrap), 0.0, 1.0);
  vec3 ambN = sky(Nw)*0.45;
  vec3 sss = uSSS*pow(clamp(dot(Vw,-L),0.0,1.0),4.0)*exp(-thick*4.0)*0.8;
  vec3 diffuse = albedo*(wrapd*vec3(1.3,1.22,1.08)*selfSh + ambN) + sss*selfSh;
  vec3 body = mix(refr, diffuse, opac);

  // ---- specular: GGX sun + glossy environment reflection
  vec3 spec = vec3(D_GGX(NoH,a)*V_SmithJ(NoV,NoL,a)*NoL)*F*vec3(1.2,1.1,0.95)*3.0*selfSh;
  vec3 R = reflect(-Vw, Nw);
  vec3 env = mix(sky(R), sky(Nw)*0.6, clamp(rough*1.2,0.0,1.0))*uEnv;
  vec3 col = body*(1.0-F) + env*F + spec;

  // ---- whitewater / foam
  vec3 foamCol = vec3(0.92,0.95,0.97)*(wrapd*0.9+0.45);
  col = mix(col, foamCol, foam);

  float edge = smoothstep(0.0, 0.025, thick);
  col = mix(scene, col, edge);
  o = vec4(pow(aces(col), vec3(1.0/2.2)), 1.0);
}`;

function compile(gl, vs, fs) {
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + s.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')); return sh; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNrm'); gl.bindAttribLocation(p, 1, 'aFoam'); gl.bindAttribLocation(p, 2, 'aConc');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace('[0]', ''); u[name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

function cubeMesh() {
  const P = [], N = [];
  const faces = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
  for (const [a, b, c, s] of faces) {
    const q = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const [u, v] of (s > 0 ? q : q.slice().reverse())) {
      const p = [0, 0, 0]; p[a] = s; p[b] = u; p[c] = v; P.push(...p);
      const n = [0, 0, 0]; n[a] = s; N.push(...n);
    }
  }
  return { P: new Float32Array(P), N: new Float32Array(N) };
}
function sphereMesh(seg = 32, ring = 20) {
  const P = [], N = [];
  const pt = (i, j) => { const th = j / ring * Math.PI, ph = i / seg * Math.PI * 2; return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
    const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    for (const v of [a, b, c, a, c, d]) { P.push(...v); N.push(...v); }
  }
  return { P: new Float32Array(P), N: new Float32Array(N) };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not supported');
    gl.getExtension('EXT_float_blend');
    this.gl = gl; this.canvas = canvas;
    this.progs = {
      sky: compile(gl, QUAD_VS, SKY_FS),
      mesh: compile(gl, MESH_VS, MESH_FS),
      pDepth: compile(gl, PT_VS, PT_DEPTH_FS),
      pThick: compile(gl, PT_VS, PT_THICK_FS),
      pDebug: compile(gl, PT_VS, PT_DEBUG_FS),
      blur: compile(gl, QUAD_VS, BLUR_FS),
      comp: compile(gl, QUAD_VS, COMP_FS),
    };
    const mkMesh = (m) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const b0 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b0); gl.bufferData(gl.ARRAY_BUFFER, m.P, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const b1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.bufferData(gl.ARRAY_BUFFER, m.N, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      return { vao, count: m.P.length / 3, pbuf: b0 };
    };
    this.cube = mkMesh(cubeMesh());
    this.sphere = mkMesh(sphereMesh());
    const e = []; const c = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) e.push(...c[a], ...c[b]);
    this.lines = mkMesh({ P: new Float32Array(e), N: new Float32Array(e.length) });
    // particles
    this.pvao = gl.createVertexArray(); gl.bindVertexArray(this.pvao);
    this.pbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.fbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.fbuf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray();
    this.sunDir = (() => { const v = [0.45, 0.8, 0.35]; const l = Math.hypot(...v); return v.map(x => x / l); })();
    this.w = 0; this.h = 0;
    // light-space fluid maps for shadows/caustics
    const LS = this.LS = 768;
    this.lDepth = this.tex(LS, LS, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST);
    const lrb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, lrb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, LS, LS);
    this.lDepthFbo = this.fbo(this.lDepth, null, lrb);
    this.lThick = this.tex(LS, LS, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.lThickFbo = this.fbo(this.lThick);
  }

  bindParticles(prog, sim) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, sim.posTex); gl.uniform1i(prog.u.uPosT, 8);
    gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, sim.velTex); gl.uniform1i(prog.u.uVelT, 9);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(prog.u.uPW, sim.PW);
    gl.bindVertexArray(this.emptyVao);
  }

  // shared uniforms for shaders that sample the fluid light maps
  bindFluidLight(prog, sim) {
    const gl = this.gl, u = prog.u;
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.lDepth); gl.uniform1i(u.uLDepth, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.lThick); gl.uniform1i(u.uLThick, 5);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP); gl.uniformMatrix4fv(u.uLightView, false, this.lightView);
    const a = sim.mat.render, b = sim.mat2.render;
    gl.uniform3fv(u.uAbsA, a.absorb); gl.uniform3fv(u.uAbsB, b.absorb);
    gl.uniform1f(u.uScA, a.scatter); gl.uniform1f(u.uScB, b.scatter); gl.uniform1f(u.uTime, sim.time);
  }

  tex(w, h, ifmt, fmt, type, filter) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  fbo(color, depthTex, depthRb) {
    const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    if (depthTex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    if (depthRb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incomplete ' + st);
    return f;
  }
  resize() {
    const gl = this.gl, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (w === this.w && h === this.h) return;
    this.canvas.width = w; this.canvas.height = h; this.w = w; this.h = h;
    this.sceneCol = this.tex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.sceneDepth = this.tex(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    this.sceneFbo = this.fbo(this.sceneCol, this.sceneDepth);
    this.fDepth = this.tex(w, h, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST);
    const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    this.fDepthFbo = this.fbo(this.fDepth, null, rb);
    this.blurTex = [this.tex(w, h, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST), this.tex(w, h, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST)];
    this.blurFbo = this.blurTex.map(t => this.fbo(t));
    this.thick = this.tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
    this.thickFbo = this.fbo(this.thick, this.sceneDepth);
  }

  drawMesh(m, model, color, mode, mesh = this.cube, prim) {
    const gl = this.gl, P = this.progs.mesh;
    gl.uniformMatrix4fv(P.u.uModel, false, model);
    gl.uniform3fv(P.u.uColor, color); gl.uniform1i(P.u.uMode, mode);
    gl.bindVertexArray(mesh.vao); gl.drawArrays(prim ?? gl.TRIANGLES, 0, mesh.count);
  }

  render(sim, cam, opts) {
    this.resize();
    const gl = this.gl, w = this.w, h = this.h, P = this.progs;
    const near = 0.05, far = 60;
    const proj = mat4.perspective(cam.fov, w / h, near, far);
    const view = mat4.lookAt(cam.eye, cam.target, [0, 1, 0]);
    const vp = mat4.mul(proj, view);
    this.viewProj = vp; this.invViewProj = mat4.invert(vp);
    const invView = mat4.invert(view);
    const [W, H, D] = sim.size;
    const sun = this.sunDir;

    const n = sim.n;
    const radius = sim.s * opts.radiusScale;
    const setPt = (prog) => {
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.u.uView, false, view); gl.uniformMatrix4fv(prog.u.uProj, false, proj);
      gl.uniform1f(prog.u.uRadius, radius); gl.uniform1f(prog.u.uScreenH, h);
      this.bindParticles(prog, sim);
    };

    // ---------- 0. light-space fluid depth + thickness (for colored shadows & caustics)
    const ctr = [W / 2, H / 2, D / 2], LR = Math.hypot(W, H, D) / 2 + 0.1;
    this.lightView = mat4.lookAt([ctr[0] + sun[0] * (LR + 1), ctr[1] + sun[1] * (LR + 1), ctr[2] + sun[2] * (LR + 1)], ctr, [0, 1, 0]);
    const lproj = mat4.ortho(-LR, LR, -LR, LR, 0.1, 2 * LR + 2);
    this.lightVP = mat4.mul(lproj, this.lightView);
    const LS = this.LS;
    gl.viewport(0, 0, LS, LS); gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lDepthFbo);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.clearColor(1e5, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const setLight = (prog) => {
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.u.uView, false, this.lightView); gl.uniformMatrix4fv(prog.u.uProj, false, lproj);
      gl.uniform1f(prog.u.uRadius, radius); gl.uniform1f(prog.u.uScreenH, LS);
      this.bindParticles(prog, sim);
    };
    setLight(P.pDepth); gl.drawArrays(gl.POINTS, 0, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lThickFbo);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    setLight(P.pThick); gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
    // ---------- 1. scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(P.sky.p); gl.uniformMatrix4fv(P.sky.u.uInvViewProj, false, this.invViewProj); gl.uniform3fv(P.sky.u.uSunDir, sun);
    gl.bindVertexArray(this.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(P.mesh.p);
    gl.uniformMatrix4fv(P.mesh.u.uViewProj, false, vp); gl.uniform3fv(P.mesh.u.uSunDir, sun); gl.uniform3fv(P.mesh.u.uCam, cam.eye);
    const sph = new Float32Array(64); let ns = 0;
    for (const s of sim.spheres) { if (ns >= 16) break; sph.set([s.c[0], s.c[1], s.c[2], s.r], ns * 4); ns++; }
    gl.uniform4fv(P.mesh.u.uSph, sph); gl.uniform1i(P.mesh.u.uNSph, ns);
    this.bindFluidLight(P.mesh, sim);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, sim.wetTex); gl.uniform1i(P.mesh.u.uWet, 6); gl.activeTexture(gl.TEXTURE0);
    gl.uniform3i(P.mesh.u.uWDim, ...sim.dim); gl.uniform1i(P.mesh.u.uWTiles, sim.tiles); gl.uniform1f(P.mesh.u.uWDx, sim.dx);
    gl.uniform3fv(P.mesh.u.uWetSize, sim.size);
    const ra = sim.mat.render, rb = sim.mat2.render;
    gl.uniform3fv(P.mesh.u.uStainA, ra.albedo); gl.uniform3fv(P.mesh.u.uStainB, rb.albedo);
    gl.uniform1f(P.mesh.u.uOpqA, Math.min(1, ra.scatter / 20 + (ra.refract < 0.5 ? 0.5 : 0) + (ra.absorb[2] > 3 ? 0.6 : 0)));
    gl.uniform1f(P.mesh.u.uOpqB, Math.min(1, rb.scatter / 20 + (rb.refract < 0.5 ? 0.5 : 0) + (rb.absorb[2] > 3 ? 0.6 : 0)));
    const wetOn = (v) => gl.uniform1i(P.mesh.u.uWetOn, v);
    wetOn(1);
    const id = [1, 0, 0, 0];
    gl.enable(gl.CULL_FACE);
    // ground
    gl.cullFace(gl.BACK);
    this.drawMesh(null, mat4.trs([W / 2, -0.06, D / 2], id, [12, 0.05, 12]), [0.3, 0.3, 0.3], 3);
    // tank interior (front faces culled -> always see the far walls)
    gl.cullFace(gl.FRONT);
    this.drawMesh(null, mat4.trs([W / 2, H / 2, D / 2], id, [W / 2, H / 2, D / 2]), [0.86, 0.9, 0.93], 1);
    gl.cullFace(gl.BACK);
    // tank rim
    this.drawMesh(null, mat4.trs([W / 2, -0.005, D / 2], id, [W / 2 + 0.04, 0.01, D / 2 + 0.04]), [0.5, 0.52, 0.55], 0);
    if (sim.piston) this.drawMesh(null, mat4.trs([sim.piston.x - 0.03, H / 2, D / 2], id, [0.03, H / 2, D / 2]), [0.75, 0.55, 0.2], 5);
    if (sim.ramp) {
      const r = sim.ramp, th = Math.atan(r.slope), len = (W - r.x0) / Math.cos(th), t = 0.04;
      const nx = -Math.sin(th), ny = Math.cos(th);
      const cx = r.x0 + Math.cos(th) * len / 2 - nx * t, cy = Math.sin(th) * len / 2 - ny * t;
      this.drawMesh(null, mat4.trs([cx, cy, D / 2], [Math.cos(th / 2), 0, 0, Math.sin(th / 2)], [len / 2, t, D / 2]), [0.76, 0.68, 0.5], 1);
    }
    for (const B of sim.boxes) this.drawMesh(null, mat4.trs(B.c, id, B.h), [0.55, 0.58, 0.62], 5);
    for (const e of sim.activeEmitters) {
      this.drawMesh(null, mat4.trs([e.pos[0], e.pos[1] + 0.12, e.pos[2]], id, [e.radius + 0.03, 0.1, e.radius + 0.03]), [0.4, 0.4, 0.42], 5);
    }
    wetOn(0);
    for (const s of sim.spheres) this.drawMesh(null, mat4.trs(s.c, s.rot, [s.r, s.r, s.r]), s.color, s.fixed ? 5 : 2, this.sphere);
    gl.disable(gl.CULL_FACE);
    // glass edges
    this.drawMesh(null, mat4.trs([W / 2, H / 2, D / 2], id, [W / 2, H / 2, D / 2]), [0.75, 0.85, 0.95], 4, this.lines, gl.LINES);

    const mr = sim.mat.render;

    if (opts.debug) {
      setPt(P.pDebug); gl.uniform3fv(P.pDebug.u.uColor, mr.albedo); gl.uniform3fv(P.pDebug.u.uColor2, sim.mat2.render.albedo); gl.uniform3fv(P.pDebug.u.uSunDir, sun);
      gl.uniform1f(P.pDebug.u.uRadius, sim.s * 0.5);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      return;
    }

    // ---------- 2. fluid depth
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fDepthFbo);
    gl.clearColor(1e5, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    setPt(P.pDepth); gl.drawArrays(gl.POINTS, 0, n);

    // ---------- 3. thickness (additive, occluded by scene depth)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.thickFbo);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    setPt(P.pThick); gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.DEPTH_TEST);

    // ---------- 4. bilateral smoothing
    gl.useProgram(P.blur.p); gl.bindVertexArray(this.emptyVao);
    gl.uniform1i(P.blur.u.uDepth, 0); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(P.blur.u.uWorldR, radius * opts.smooth); gl.uniform1f(P.blur.u.uP11, proj[5]); gl.uniform1f(P.blur.u.uH, h);
    gl.uniform1f(P.blur.u.uFall, radius * 1.5);
    let src = this.fDepth, k = 0;
    for (let it = 0; it < opts.blurIters; it++) for (const dir of [[1, 0], [0, 1]]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFbo[k]);
      gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform2i(P.blur.u.uDir, dir[0], dir[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = this.blurTex[k]; k ^= 1;
    }

    // ---------- 5. composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const C = P.comp; gl.useProgram(C.p);
    const bind = (unit, tex, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(C.u[name], unit); };
    bind(0, this.sceneCol, 'uScene'); bind(1, this.sceneDepth, 'uSceneDepth'); bind(2, src, 'uFluidDepth'); bind(3, this.thick, 'uThick');
    gl.uniformMatrix4fv(C.u.uInvView, false, invView);
    this.bindFluidLight(C, sim);
    gl.uniform1f(C.u.uP00, proj[0]); gl.uniform1f(C.u.uP11, proj[5]); gl.uniform1f(C.u.uNear, near); gl.uniform1f(C.u.uFar, far);
    gl.uniform2f(C.u.uRes, w, h); gl.uniform3fv(C.u.uSunDir, sun);
    for (const [sfx, r] of [['A', mr], ['B', sim.mat2.render]]) {
      gl.uniform3fv(C.u['uAbsorb' + sfx], r.absorb); gl.uniform3fv(C.u['uAlbedo' + sfx], r.albedo); gl.uniform3fv(C.u['uSSS' + sfx], r.sss);
      for (const [k, v] of [['Scatter', r.scatter], ['Rough', r.rough], ['F0', r.f0], ['Refract', r.refract], ['Wrap', r.wrap], ['Grain', r.grain], ['Env', r.env]]) gl.uniform1f(C.u['u' + k + sfx], v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
