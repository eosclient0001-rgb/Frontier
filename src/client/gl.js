// ============================================================================
//  gl.js — WebGL2 sphere-traced renderer for the SDF terrain volume
//
//  • Ray-marches the 3D distance-field texture (true SDF — not a mesh, not a
//    heightfield) with adaptive stepping.
//  • Soft shadows + AO come from the same distance field (a perk of SDFs).
//  • Materials are driven by the SAT map pair (flow/sediment/wear/peaks +
//    pointiness/slope/height/wetness) with triplanar micro-detail.
//  • Inspector mode cuts the volume open at a clip height and visualises the
//    raw signed distance values + voxel grid.
// ============================================================================

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos,0.0,1.0); }
`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D uVol;
uniform sampler2D uSatA, uSatB, uTrail;
uniform vec3 uWorldSize;      // metres
uniform float uClamp;         // distance clamp (m)
uniform vec3 uCamPos;
uniform vec3 uCamRight, uCamUp, uCamFwd;
uniform vec2 uRes;
uniform float uTanFov;
uniform vec3 uSunDir;
uniform int uMode;            // 0 shaded, 1 inspector
uniform float uClipY;         // inspector clip height (m)
uniform float uVox;           // voxel size (m)
uniform float uSnowline;      // world m
uniform float uWet;           // wetness darkening 0..1
uniform float uAO;            // ao strength
uniform float uExposure;
uniform float uTime;
uniform float uShowTrail;

out vec4 outColor;

float sdf(vec3 p){
  vec3 t = clamp(p / uWorldSize, vec3(0.0), vec3(1.0));
  return texture(uVol, t).r * (2.0*uClamp) - uClamp;
}

vec3 sdfGrad(vec3 p){
  vec2 e = vec2(uVox, 0.0);
  return vec3(
    sdf(p+e.xyy)-sdf(p-e.xyy),
    sdf(p+e.yxy)-sdf(p-e.yxy),
    sdf(p+e.yyx)-sdf(p-e.yyx)) / (2.0*uVox);
}

float hash(vec3 p){
  p = fract(p*0.3183099 + vec3(0.1,0.2,0.3));
  p *= 17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                 mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                 mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}

// iq soft shadow against the distance field
float softShadow(vec3 ro, vec3 rd){
  float res = 1.0;
  float t = 0.6*uVox*4.0;
  for(int i=0;i<48;i++){
    vec3 p = ro + rd*t;
    float h = sdf(p);
    res = min(res, 10.0*h/t);
    t += clamp(h, uVox*0.7, 1.5);
    if(res < 0.02 || t > 90.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

// 5-tap AO along the normal
float calcAO(vec3 p, vec3 n){
  float occ = 0.0, sca = 1.0;
  for(int i=1;i<=5;i++){
    float h = 0.02 + 0.11*float(i);
    float d = sdf(p + n*h);
    occ += (h - d)*sca;
    sca *= 0.72;
  }
  return clamp(1.0 - uAO*occ, 0.0, 1.0);
}

void material(vec3 p, vec3 n, out vec3 alb, out float rough, out float wetAmt){
  vec2 uv = p.xz / uWorldSize.xz;
  vec4 sa = texture(uSatA, uv);
  vec4 sb = texture(uSatB, uv);
  float flow = sa.r, sed = sa.g, wear = sa.b, peak = sa.a;
  float pointy = sb.r*2.0-1.0, slope = sb.g, height = sb.b, wet = sb.a;
  float hW = p.y / uWorldSize.y;

  // triplanar micro variation
  float f1 = vnoise(p*2.1);
  float f2 = vnoise(p*7.3);
  float grain = 0.82 + 0.26*f1 + 0.10*f2;

  vec3 rockLo = vec3(0.28,0.245,0.215);
  vec3 rockHi = vec3(0.47,0.44,0.42);
  vec3 rock = mix(rockLo, rockHi, clamp(wear*1.2 + f2*0.25, 0.0, 1.0)) * grain;

  vec3 grassC = vec3(0.16,0.21,0.085) * (0.85+0.3*f1);
  vec3 sedC   = vec3(0.56,0.48,0.34) * (0.9+0.2*f2);
  vec3 snowC  = vec3(0.86,0.88,0.92);

  float grassW = (1.0 - smoothstep(0.32, 0.55, slope)) * (1.0 - smoothstep(0.35,0.6,wear)) * (1.0 - smoothstep(uSnowline-6.0, uSnowline+2.0, p.y));
  float sedW  = smoothstep(0.25, 0.6, sed) * (1.0 - smoothstep(0.45,0.75,slope));
  float snowW = smoothstep(uSnowline, uSnowline+2.5, p.y) * (1.0 - smoothstep(0.5, 0.8, slope));

  alb = rock;
  alb = mix(alb, grassC, clamp(grassW,0.0,1.0));
  alb = mix(alb, sedC, clamp(sedW,0.0,1.0));
  alb = mix(alb, snowC, clamp(snowW,0.0,1.0));

  // flow channels: wetted dark streaks
  float chan = smoothstep(0.25, 0.85, flow);
  wetAmt = clamp(wet*0.7 + chan*0.8, 0.0, 1.0)*uWet;
  alb *= mix(1.0, 0.55, wetAmt);
  rough = mix(0.85, 0.25, wetAmt);
  rough = mix(rough, 0.5, snowW);   // snow: medium spec
}

vec3 sky(vec3 rd){
  float t = clamp(rd.y*0.5+0.5, 0.0, 1.0);
  vec3 horizon = vec3(0.72,0.75,0.78);
  vec3 zenith  = vec3(0.25,0.38,0.55);
  vec3 c = mix(horizon, zenith, pow(t,0.7));
  float s = max(dot(rd, uSunDir), 0.0);
  c += vec3(1.0,0.88,0.7)*pow(s, 600.0)*18.0;
  c += vec3(1.0,0.8,0.55)*pow(s, 8.0)*0.12;
  return c;
}

void main(){
  vec2 px = (2.0*gl_FragCoord.xy - uRes) / uRes.y;
  vec3 rd = normalize(uCamFwd + uTanFov*(px.x*uCamRight + px.y*uCamUp));
  vec3 ro = uCamPos;

  float tMin = 0.1;
  float tMax = 400.0;
  float t = tMin;
  bool hit = false;
  float d = 1e9;

  for(int i=0;i<180;i++){
    vec3 p = ro + rd*t;
    d = sdf(p);
    if(uMode==1) d = max(d, p.y - uClipY);   // cut-away
    if(d < 0.3*uVox){ hit = true; break; }
    t += max(d*0.85, 0.35*uVox);
    if(t > tMax) break;
  }

  if(!hit){
    outColor = vec4(sky(rd), 1.0);
    return;
  }

  vec3 p = ro + rd*t;
  vec3 n = normalize(sdfGrad(p));
  if(dot(n, rd) > 0.0) n = -n;

  vec3 alb; float rough, wetAmt;
  material(p, n, alb, rough, wetAmt);

  // lighting
  float dif = max(dot(n, uSunDir), 0.0);
  float sh = dif > 0.001 ? softShadow(p + n*2.0*uVox, uSunDir) : 1.0;
  float ao = calcAO(p + n*0.2*uVox, n);
  float skyL = clamp(0.5 + 0.5*n.y, 0.0, 1.0);
  float bnc = clamp(0.4 - 0.4*n.y, 0.0, 1.0);

  vec3 lin = vec3(0.0);
  lin += vec3(1.3,1.1,0.9) * dif * sh * 2.4;
  lin += skyL * vec3(0.30,0.42,0.60) * 0.9 * ao;
  lin += bnc * vec3(0.25,0.2,0.15) * 0.4 * ao;

  // spec (wet & snow)
  vec3 h = normalize(uSunDir - rd);
  float spe = pow(max(dot(n,h),0.0), mix(80.0, 14.0, wetAmt)) * (0.15 + 0.85*wetAmt);
  lin += vec3(1.0,0.95,0.85) * spe * sh * 2.0;

  vec3 col = alb * lin;
  col += sky(rd)*0.06*ao*(1.0-sh);  // subtle ambient wrap in shadow

  // distance fog into sky
  float fog = 1.0 - exp(-0.0035*t);
  col = mix(col, sky(rd), fog*0.7);

  // droplet trail overlay
  if(uShowTrail > 0.5){
    vec2 uv = p.xz / uWorldSize.xz;
    float tr = texture(uTrail, uv).r;
    col = mix(col, vec3(1.0,0.55,0.15), smoothstep(0.12,0.9,tr)*0.55);
  }

  // inspector: SDF visualisation overlay
  if(uMode==1){
    float dv = sdf(p);
    // distance bands (contours every voxel)
    float band = abs(fract(abs(dv)/uVox) - 0.5);
    float contour = 1.0 - smoothstep(0.0, 0.08, band);
    vec3 inside = vec3(0.30,0.22,0.35);
    vec3 outside = mix(vec3(0.05,0.15,0.30), vec3(0.9,0.85,0.4), clamp(dv/(uClamp*0.5),0.0,1.0));
    vec3 sliceCol = dv < 0.0 ? inside*(0.5 + 0.5*contour*0.6) : outside;
    // voxel grid lines near the cut plane
    vec3 g = abs(fract(p/uVox) - 0.5);
    float grid = 1.0 - smoothstep(0.0, 0.06, min(min(g.x,g.y),g.z));
    sliceCol += vec3(0.1,0.4,0.25)*grid*0.35;
    col = mix(col, sliceCol, 0.75);
  }

  col *= uExposure;
  col = col/(1.0+col);           // tonemap
  col = pow(col, vec3(1.0/2.2)); // gamma
  outColor = vec4(col, 1.0);
}
`;

export class FrontierViewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.floatLinear = !!gl.getExtension('OES_texture_float_linear');

    this.prog = this.build(VERT, FRAG);
    gl.useProgram(this.prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.uni = {};
    for (const u of ['uVol','uSatA','uSatB','uTrail','uWorldSize','uClamp','uCamPos','uCamRight','uCamUp','uCamFwd','uRes','uTanFov','uSunDir','uMode','uClipY','uVox','uSnowline','uWet','uAO','uExposure','uTime','uShowTrail'])
      this.uni[u] = gl.getUniformLocation(this.prog, u);

    this.texVol = this.makeTex3D();
    this.texA = this.makeTex2D();
    this.texB = this.makeTex2D();
    this.texTrail = this.makeTex2D();
    this.hasVolume = false;

    // view state
    this.yaw = 0.85; this.pitch = 0.42; this.dist = 170;
    this.target = [50, 18, 50];
    this.fov = 38 * Math.PI / 180;
    this.sunAz = 2.35; this.sunEl = 0.62;
    this.mode = 0; this.clipY = 20;
    this.snowline = 33; this.wet = 0.8; this.ao = 1.0; this.exposure = 1.0;
    this.showTrail = 0; this.renderScale = 0.75;
    this.worldSize = [100, 64, 100];
    this.captureCb = null;

    this.bindInput();
  }

  makeTex3D() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, this.floatLinear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, this.floatLinear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return t;
  }
  makeTex2D() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setVolume({ data, dims, size, clamp }) {
    const gl = this.gl;
    this.worldSize = size;
    gl.bindTexture(gl.TEXTURE_3D, this.texVol);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32F, dims[0], dims[1], dims[2], 0, gl.RED, gl.FLOAT, new Float32Array(data));
    this.dims = dims; this.clampD = clamp;
    this.hasVolume = true;
    this.vox = size[0] / dims[0];
    this.target = [size[0]/2, size[1]*0.32, size[2]/2];
  }

  setSat(satABuf, satBBuf, nx, nz) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nx, nz, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(satABuf));
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nx, nz, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(satBBuf));
    this.satN = [nx, nz];
  }

  setTrail(u8buf, nx, nz) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texTrail);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, nx, nz, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(u8buf));
  }

  build(vsSrc, fsSrc) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  frame() {
    const gl = this.gl;
    if (!this.hasVolume) { gl.clearColor(0.06,0.07,0.09,1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const c = this.canvas;
    const W = Math.max(2, (c.clientWidth * this.renderScale) | 0);
    const H = Math.max(2, (c.clientHeight * this.renderScale) | 0);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }

    // camera basis
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const ro = [
      this.target[0] + this.dist * cp * sy,
      this.target[1] + this.dist * sp,
      this.target[2] + this.dist * cp * cy
    ];
    const fwd = norm(sub(this.target, ro));
    const right = norm(cross(fwd, [0,1,0]));
    const up = cross(right, fwd);
    const sa = this.sunAz, se = this.sunEl;
    const sun = [Math.cos(se)*Math.sin(sa), Math.sin(se), Math.cos(se)*Math.cos(sa)];

    gl.useProgram(this.prog);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.texVol);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texTrail);
    const u = this.uni;
    gl.uniform1i(u.uVol, 0); gl.uniform1i(u.uSatA, 1); gl.uniform1i(u.uSatB, 2); gl.uniform1i(u.uTrail, 3);
    gl.uniform3f(u.uWorldSize, ...this.worldSize);
    gl.uniform1f(u.uClamp, this.clampD || 5);
    gl.uniform3f(u.uCamPos, ...ro);
    gl.uniform3f(u.uCamRight, ...right);
    gl.uniform3f(u.uCamUp, ...up);
    gl.uniform3f(u.uCamFwd, ...fwd);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uTanFov, Math.tan(this.fov / 2));
    gl.uniform3f(u.uSunDir, ...sun);
    gl.uniform1i(u.uMode, this.mode);
    gl.uniform1f(u.uClipY, this.clipY);
    gl.uniform1f(u.uVox, this.vox || 0.5);
    gl.uniform1f(u.uSnowline, this.snowline);
    gl.uniform1f(u.uWet, this.wet);
    gl.uniform1f(u.uAO, this.ao);
    gl.uniform1f(u.uExposure, this.exposure);
    gl.uniform1f(u.uTime, performance.now() / 1000);
    gl.uniform1f(u.uShowTrail, this.showTrail);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.captureCb) {           // buffer is intact right after the draw
      const cb = this.captureCb; this.captureCb = null;
      c.toBlob(b => cb(b), 'image/png');
    }
  }

  requestCapture(cb) { this.captureCb = cb; }

  bindInput() {
    const c = this.canvas;
    let drag = false, lx = 0, ly = 0, btn = 0;
    c.addEventListener('pointerdown', e => { drag = true; btn = e.button; lx = e.clientX; ly = e.clientY; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointerup', e => { drag = false; });
    c.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (btn === 0 && !e.shiftKey) {
        this.yaw -= dx * 0.006;
        this.pitch = Math.min(1.45, Math.max(0.03, this.pitch + dy * 0.005));
      } else {
        // pan target in view plane
        const s = this.dist * 0.0016;
        const cp = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        this.target[0] -= (cp * dx) * s;
        this.target[2] += (sy * dx) * s;
        this.target[1] = Math.min(this.worldSize[1], Math.max(0, this.target[1] + dy * s));
      }
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = Math.min(420, Math.max(18, this.dist * Math.exp(e.deltaY * 0.0011)));
    }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  start() {
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function norm(a) { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
