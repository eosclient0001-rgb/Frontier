// Frontier SDF — render shaders: raymarched SDF terrain + current-following water,
// river ribbons built from live particle trails, and small depth-tested sprites.

import { SIM_HEAD, FULLSCREEN_VERT } from "./glsl-lib.js?v=4";

export { FULLSCREEN_VERT };

export const SCENE_FRAG = SIM_HEAD + `
uniform sampler2D uVol, uFlow;
uniform vec4 uEye;   // xyz, tanHalfFov
uniform vec4 uTgt;   // xyz, aspect
uniform vec4 uSunA;  // sunDir.xyz, intensity
uniform vec4 uSunB;  // haze, shadowK, aoK, fogK
uniform vec4 uWatA;  // level, enabled, clarity, flowK
uniform vec4 uWatB;  // foamReach, foamAmt, rippleK, time
uniform vec4 uRdr;   // steps, terrainOn, maxDist, strataK
uniform vec2 uRes;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oDepth;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vns(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i); float n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0)); float n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)); float n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1)); float n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
vec2 boxRange(vec3 ro, vec3 rd) {
  vec3 a = (VMIN - ro) / rd; vec3 b = (VMAX - ro) / rd;
  vec3 n = min(a, b); vec3 f = max(a, b);
  return vec2(max(max(n.x, n.y), n.z), min(min(f.x, f.y), f.z));
}
float traceScene(vec3 ro, vec3 rd, float tMax, float steps) {
  vec2 r = boxRange(ro, rd);
  float t = max(0.0, r.x);
  float end = min(r.y, tMax);
  if (t > end) return 1e5;
  for (int i = 0; i < 256; i++) {
    if (float(i) >= steps) break;
    float d = volSDF(uVol, ro + rd * t);
    if (d < 0.06) return t;
    t += clamp(d * 0.7, 0.03, 1.5);
    if (t > end) break;
  }
  return 1e5;
}
float shadowMarch(vec3 p, vec3 l) {
  float t = 0.18; float s = 1.0;
  for (int i = 0; i < 24; i++) {
    float h = volSDF(uVol, p + l * t);
    s = min(s, 9.0 * h / t);
    t += clamp(h, 0.16, 1.6);
    if (h < 0.04 || t > 29.0) break;
  }
  return clamp(s, 0.0, 1.0);
}
float aoAt(vec3 p, vec3 n) {
  float a = 0.0; float w = 1.0;
  for (int i = 1; i <= 4; i++) {
    float hh = float(i) * 0.48;
    a += (hh - volSDF(uVol, p + n * hh)) * w; w *= 0.55;
  }
  return clamp(1.0 - a * 0.38, 0.25, 1.0);
}
vec3 terrainAlbedo(vec3 p, vec3 n, vec4 V, out float spec) {
  float grain = hash13(p * 8.0);
  float broad = vns(p * 0.43) + 0.45 * vns(p * 1.8);
  float bedding = p.y + vns(vec3(p.x * 0.12, 0.0, p.z * 0.12)) * 2.0;
  float bands = 0.5 + 0.5 * sin(bedding * 3.4 + 0.4 * sin(bedding * 1.1));
  float thin = pow(0.5 + 0.5 * sin(bedding * 17.0 + vns(p * 2.0) * 1.7), 12.0);
  vec3 c = mix(vec3(0.36, 0.135, 0.062), vec3(0.72, 0.33, 0.14), 0.37 + broad * 0.16);
  c = mix(c, c * vec3(0.74, 0.70, 0.65), bands * uRdr.w * 0.35);
  c *= 1.0 - thin * 0.20 * uRdr.w;
  c += vec3(0.055, 0.04, 0.028) * (grain - 0.5) * 1.4;
  float top = smoothstep(0.55, 0.96, n.y);
  c = mix(c, vec3(0.64, 0.37, 0.185) * (0.9 + broad * 0.12), top * 0.67);
  float streak = vns(vec3(p.x * 3.3, p.y * 0.13, p.z * 3.3));
  c *= 0.79 + 0.28 * streak;
  float dep = clamp(V.y * 0.5, 0.0, 1.0);
  vec3 sandCol = mix(vec3(0.76, 0.58, 0.34), vec3(0.45, 0.38, 0.30), clamp(V.w, 0.0, 1.0));
  float speck = step(0.93, hash13(floor(p * 9.0))) * clamp(V.w, 0.0, 1.0);
  sandCol *= 1.0 - speck * 0.35;
  c = mix(c, sandCol, dep * 0.85);
  c *= 1.0 - 0.42 * clamp(V.z, 0.0, 1.0);
  spec = 0.04 + clamp(V.z, 0.0, 1.0) * 0.5;
  float snow = smoothstep(12.5, 14.5, p.y) * smoothstep(0.6, 0.75, n.y);
  c = mix(c, vec3(0.88, 0.90, 0.94), snow * 0.9);
  return c;
}
vec3 waterShade(vec3 ro, vec3 rd, float tw, vec3 sun, vec3 skyRef) {
  vec3 pw = ro + rd * tw;
  vec2 fuv = (pw.xz - vec2(-24.0, -22.0)) / vec2(48.0, 44.0);
  vec4 F = texture(uFlow, clamp(fuv, vec2(0.001), vec2(0.999)));
  vec2 fdir = F.xy; float fspeed = F.z * uWatA.w; float sea = F.w;
  float t = uWatB.w;
  vec2 uv1 = pw.xz * 1.4 - fdir * (fspeed * t);
  vec2 uv2 = pw.xz * 3.1 + fdir * (fspeed * t * 0.6) + vec2(t * 0.05, 0.0);
  float e = 0.08;
  float h0 = vns(vec3(uv1, 1.7)) + 0.5 * vns(vec3(uv2, 4.2));
  float hx = vns(vec3(uv1 + vec2(e, 0.0), 1.7)) + 0.5 * vns(vec3(uv2 + vec2(e, 0.0), 4.2));
  float hz = vns(vec3(uv1 + vec2(0.0, e), 1.7)) + 0.5 * vns(vec3(uv2 + vec2(0.0, e), 4.2));
  vec3 wn = normalize(vec3(-(hx - h0) / e * uWatB.z, 1.0, -(hz - h0) / e * uWatB.z));
  float tb = traceScene(pw + rd * 0.05, rd, 30.0, 48.0);
  vec3 bed = vec3(0.02, 0.05, 0.06);
  float depth = 6.0;
  if (tb < 1e4) {
    vec3 bp = pw + rd * (tb + 0.05);
    vec3 bn = volNormal(uVol, bp);
    vec4 BV = volSample(uVol, bp);
    float bs;
    bed = terrainAlbedo(bp, bn, BV, bs);
    bed *= 0.35 + 0.65 * clamp(dot(bn, sun) * 0.5 + 0.5, 0.0, 1.0);
    depth = clamp(tb * 0.6, 0.0, 8.0);
  }
  float absorb = 1.0 - exp(-depth * uWatA.z);
  vec3 col = mix(bed, mix(vec3(0.05, 0.23, 0.28), vec3(0.01, 0.08, 0.14), absorb), clamp(0.35 + 0.65 * absorb, 0.0, 1.0));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, wn), 0.0), 5.0);
  col = mix(col, skyRef, fres);
  vec3 hv = normalize(-rd + sun);
  col += vec3(1.0, 0.9, 0.75) * pow(max(dot(wn, hv), 0.0), 600.0) * 2.0;
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(wn, hv), 0.0), 60.0) * 0.15;
  float shore = volSDF(uVol, vec3(pw.x, uWatA.x - 0.05, pw.z));
  float band = 1.0 - smoothstep(0.0, uWatB.x, abs(shore));
  float streak = vns(vec3(pw.x * 2.0 - fdir.x * fspeed * t * 2.0, 3.3, pw.z * 2.0 - fdir.y * fspeed * t * 2.0));
  streak = smoothstep(0.55, 0.9, streak + band * 0.35);
  float foam = clamp(band * (0.5 + 0.5 * sin(t * 2.0 + shore * 14.0)) * 0.7 + streak * band * 0.8 + streak * clamp(fspeed * 0.4, 0.0, 0.5) * sea, 0.0, 1.0) * uWatB.y;
  col = mix(col, vec3(0.92, 0.95, 0.93), foam);
  return col;
}
void main() {
  vec2 suv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec3 fwd = normalize(uTgt.xyz - uEye.xyz);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd + right * suv.x * uEye.w * uTgt.w + up * suv.y * uEye.w);
  vec3 ro = uEye.xyz;
  vec3 sun = uSunA.xyz;
  float t = 1e5;
  if (uRdr.y > 0.5) t = traceScene(ro, rd, uRdr.z, uRdr.x);
  vec3 sky = mix(vec3(0.03, 0.04, 0.06), vec3(0.10, 0.13, 0.18), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
  float sd = max(dot(rd, sun), 0.0);
  sky += vec3(1.0, 0.85, 0.6) * pow(sd, 800.0) * 3.0 + vec3(1.0, 0.8, 0.55) * pow(sd, 8.0) * 0.12;
  vec3 col = sky;
  if (t < 1e4) {
    vec3 p = ro + rd * t;
    vec3 n = volNormal(uVol, p);
    vec4 V = volSample(uVol, p);
    float spec;
    vec3 alb = terrainAlbedo(p, n, V, spec);
    float sh = shadowMarch(p + n * 0.17, sun);
    float ao = aoAt(p, n);
    float dif = max(dot(n, sun), 0.0);
    vec3 lin = alb * (vec3(0.22, 0.26, 0.30) * ao + vec3(1.05, 0.91, 0.70) * dif * sh * uSunA.w);
    lin += vec3(0.13, 0.075, 0.035) * max(-n.y, 0.0) * alb;
    vec3 hv = normalize(sun - rd);
    lin += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, hv), 0.0), 40.0) * spec * sh;
    col = lin;
  } else {
    t = 1e4;
    float ft = (-5.4 - ro.y) / rd.y;
    if (ft > 0.0 && ft < uRdr.z) {
      vec3 fp = ro + rd * ft;
      float gr = min(abs(fract(fp.x * 0.2 + 0.5) - 0.5), abs(fract(fp.z * 0.2 + 0.5) - 0.5));
      col = vec3(0.012, 0.013, 0.015) * (0.6 + 0.4 * clamp(1.0 - length(fp.xz) / 60.0, 0.0, 1.0));
      col += vec3(0.05, 0.06, 0.07) * (1.0 - smoothstep(0.0, 0.02, gr)) * 0.5;
      t = ft;
    }
  }
  if (uWatA.y > 0.5) {
    float tw = (uWatA.x - ro.y) / rd.y;
    if (tw > 0.0 && tw < t) {
      vec2 fuv = ((ro + rd * tw).xz - vec2(-24.0, -22.0)) / vec2(48.0, 44.0);
      if (fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) {
        col = waterShade(ro, rd, tw, sun, sky);
        t = tw;
      }
    }
  }
  float fog = 1.0 - exp(-t * t * uSunB.w);
  col = mix(col, vec3(0.35, 0.38, 0.40) * (0.4 + uSunB.x), clamp(fog, 0.0, 0.85));
  col = col / (col + vec3(0.75));
  col = pow(max(col, vec3(0.0)), vec3(0.4545));
  oColor = vec4(col, 1.0);
  oDepth = vec4(t, 0.0, 0.0, 1.0);
}
`;

export const POINTS_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPos, uVel, uCargo, uMeta;
uniform vec4 uEye;
uniform vec4 uPR; // pointScale, sizeMul, activeCount, plumeMode
uniform mat4 uVP;
out vec3 vColor;
out float vAlpha;
out vec4 vClip;
out float vDepth;
void main() {
  int id = gl_VertexID;
  vColor = vec3(0.0); vAlpha = 0.0; vClip = vec4(0.0); vDepth = 0.0;
  if (float(id) >= uPR.z) { gl_Position = vec4(-3.0, -3.0, 0.0, 1.0); gl_PointSize = 0.0; return; }
  ivec2 puv = ivec2(id - 64 * (id / 64), id / 64);
  vec4 P = texelFetch(uPos, puv, 0);
  if (P.w < 0.0) { gl_Position = vec4(-3.0, -3.0, 0.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 C = texelFetch(uCargo, puv, 0);
  vec4 M = texelFetch(uMeta, puv, 0);
  vec3 p = P.xyz;
  float dist = distance(p, uEye.xyz);
  float worldSize = uPR.y * (uPR.w > 0.5 ? 0.35 : 0.085);
  gl_PointSize = clamp(worldSize * uPR.x / max(dist, 0.1), uPR.w > 0.5 ? 2.0 : 1.0, uPR.w > 0.5 ? 26.0 : 7.0);
  vec4 clip = uVP * vec4(p, 1.0);
  gl_Position = clip;
  vClip = clip;
  vDepth = dist;
  float load = C.x + C.y + C.z;
  vec3 sand = vec3(0.85, 0.62, 0.3); vec3 silt = vec3(0.45, 0.38, 0.3); vec3 grav = vec3(0.5, 0.47, 0.42);
  vec3 cargoCol = (C.x * sand + C.y * silt + C.z * grav) / max(load, 1e-4);
  vec3 kindCol = M.x < 0.5 ? vec3(0.35, 0.6, 1.0) : (M.x < 1.5 ? vec3(0.2, 0.8, 0.9) : (M.x < 2.5 ? vec3(1.0, 0.8, 0.45) : vec3(0.8, 0.6, 0.4)));
  vColor = mix(kindCol, cargoCol, clamp(load * 8.0, 0.0, 0.85));
  vAlpha = uPR.w > 0.5 ? clamp(load * 6.0, 0.0, 0.5) * 0.4 + 0.02 : 0.9;
}
`;

export const POINTS_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uDepth;
in vec3 vColor;
in float vAlpha;
in vec4 vClip;
in float vDepth;
layout(location = 0) out vec4 oCol;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float m = 1.0 - smoothstep(0.18, 0.5, length(pc));
  if (m <= 0.0) discard;
  vec2 ndc = vClip.xy / vClip.w * 0.5 + 0.5;
  float terr = texture(uDepth, ndc).x;
  if (vDepth > terr + 0.25) discard;
  oCol = vec4(vColor, m * vAlpha);
}
`;

export const RIBBON_VERT = `#version 300 es
precision highp float;
uniform mat4 uVP;
uniform vec3 uEye;
in vec3 aPos;
in vec2 aUV;
in vec2 aMisc;
out vec2 vUv;
out vec2 vMisc;
out vec4 vClip;
out float vDepth;
void main() {
  vUv = aUV; vMisc = aMisc;
  vec4 c = uVP * vec4(aPos, 1.0);
  vClip = c;
  vDepth = distance(aPos, uEye);
  gl_Position = c;
}
`;

export const RIBBON_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uDepth;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShal;
in vec2 vUv;
in vec2 vMisc;
in vec4 vClip;
in float vDepth;
layout(location = 0) out vec4 oCol;
void main() {
  vec2 ndc = vClip.xy / vClip.w * 0.5 + 0.5;
  float terr = texture(uDepth, ndc).x;
  if (vDepth > terr + 0.2) discard;
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vUv.x));
  float flow = vUv.y * 20.0 - uTime * (1.5 + vMisc.x * 0.8);
  float s = 0.5 + 0.5 * sin(flow + sin(vUv.x * 9.0 + flow * 0.35) * 1.6);
  float s2 = 0.5 + 0.5 * sin(flow * 2.7 + vUv.x * 14.0);
  vec3 col = mix(uDeep, uShal, 0.35 + 0.3 * s);
  float foam = smoothstep(0.75, 0.95, s * 0.6 + s2 * 0.4) * 0.7 + smoothstep(0.7, 1.0, abs(vUv.x)) * 0.5;
  col = mix(col, vec3(0.9, 0.94, 0.92), clamp(foam, 0.0, 1.0) * 0.8);
  oCol = vec4(col, edge * vMisc.y);
}
`;

export const BLIT_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uScene;
uniform vec2 uRes;
layout(location = 0) out vec4 oCol;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = texture(uScene, uv).rgb;
  vec2 q = uv * 2.0 - 1.0;
  col *= 1.0 - 0.13 * dot(q * 0.65, q * 0.65);
  vec3 p = fract(vec3(gl_FragCoord.xy, 1.0) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  col += (fract((p.x + p.y) * p.z) - 0.5) / 255.0;
  oCol = vec4(col, 1.0);
}
`;
