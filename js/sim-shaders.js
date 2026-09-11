// Frontier SDF — GPU simulation shaders (WebGL2).
// Particle kinds: 0 rain/hydraulic, 1 river, 2 wind, 3 thermal/talus.
// Anti-griefing rules baked in: capacity-limited detach, per-step voxel clamp,
// resting timers with forced settle, sleep when clean+still, spawn rate limits.

import { SIM_HEAD, FULLSCREEN_VERT, NOISE_GLSL, SDFLIB_GLSL } from "./glsl-lib.js?v=4";

export { FULLSCREEN_VERT };

export function makeBaseFrag(nodeCode) {
  return `#version 300 es
precision highp float;
const vec3 VMIN = vec3(-24.0, -6.0, -22.0);
const vec3 CELLB = vec3(0.375, 0.325, 0.34375);
${NOISE_GLSL}
${SDFLIB_GLSL}
${nodeCode}
layout(location = 0) out vec4 oVol;
void main() {
  vec2 px = gl_FragCoord.xy - 0.5;
  float tx = floor(px.x / 128.0); float ty = floor(px.y / 80.0);
  vec3 v = vec3(px.x - tx * 128.0, px.y - ty * 80.0, ty * 8.0 + tx);
  vec3 p = VMIN + (v + 0.5) * CELLB;
  float d = baseField(p);
  float wall = -min(min(23.0 - abs(p.x), 21.0 - abs(p.z)), min(p.y + 5.0, 19.0 - p.y));
  d = max(d, wall);
  oVol = vec4(clamp(d, -3.0, 3.0), 0.0, 0.0, 0.0);
}
`;
}

export const MOTION_FRAG = SIM_HEAD + `
uniform sampler2D uPos, uVel, uCargo, uMeta, uAux, uVol;
uniform float uDT, uTick, uTime, uActive;
uniform vec4 uEmit;    // spawn rates 0..1 per kind
uniform vec4 uPhysA;   // gravity, waterLevel, spawnBoost, evapScale
uniform vec4 uWindA;   // dirX, dirZ, speed, height
uniform vec4 uWindB;   // spread, gust, settleMul, abrasion(unused here)
uniform vec4 uRiverA;  // inletX, inletZ, width, speed
uniform vec4 uRiverB;  // downX, downZ, bias, unused
uniform vec4 uTherm;   // slopeThresh, rate(unused), restitution, unused
uniform vec4 uFoot;    // footprints: hyd, riverMul, wind, therm
uniform vec4 uSize;    // grain sizes mm: hyd, river, wind, therm
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
layout(location = 2) out vec4 oMeta;
layout(location = 3) out vec4 oImpact;

vec3 spawnSurface(vec3 top) {
  vec3 p = top;
  for (int j = 0; j < 60; j++) {
    float d = volSDF(uVol, p);
    if (d < 0.1 || p.y < -5.0) break;
    p.y -= clamp(d * 0.7, 0.05, 1.2);
  }
  return p;
}

void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  int id = uv.y * 64 + uv.x;
  vec4 P = texelFetch(uPos, uv, 0);
  vec4 V = texelFetch(uVel, uv, 0);
  vec4 M = texelFetch(uMeta, uv, 0);
  vec4 A = texelFetch(uAux, uv, 0);
  vec4 C = texelFetch(uCargo, uv, 0);
  oPos = P; oVel = V; oMeta = M; oImpact = vec4(0.0);
  if (float(id) >= uActive) { oPos.w = -1.0; oVel = vec4(0.0); return; }
  float kind = M.x;
  float load = C.x + C.y + C.z;
  bool dead = P.w < 0.0;
  // Settling sleep: rested and (dry or clean) -> slot is recycled by emitters.
  // River agents (water pinned at 1) sleep once pooled and emptied.
  if (!dead && A.x > 0.8 && (V.w < 0.08 || load < 0.0001)) {
    oPos.w = -1.0; oVel = vec4(0.0); return;
  }
  if (dead) {
    float wsum = uEmit.x + uEmit.y + uEmit.z + uEmit.w;
    if (wsum < 0.001) return;
    float pick = hash12(vec2(float(id) * 1.37 + uTick * 0.731, uTick * 0.113 + 7.0)) * wsum;
    float nk = 0.0; float rate = uEmit.x;
    if (pick < uEmit.x) { nk = 0.0; rate = uEmit.x; }
    else if (pick < uEmit.x + uEmit.y) { nk = 1.0; rate = uEmit.y; }
    else if (pick < uEmit.x + uEmit.y + uEmit.z) { nk = 2.0; rate = uEmit.z; }
    else { nk = 3.0; rate = uEmit.w; }
    float r2 = hash12(vec2(float(id) * 3.11 + 1.7, uTick * 1.37 + 3.0));
    if (r2 > clamp(rate * uDT * 10.0 * uPhysA.z, 0.0, 1.0)) return;
    float seed = float(id) * 7.13 + uTick * 1.77;
    if (nk < 0.5) {
      vec2 xz = vec2(hash12(vec2(seed, 1.0)), hash12(vec2(seed, 2.0))) * vec2(40.0, 36.0) - vec2(20.0, 18.0);
      vec3 p = spawnSurface(vec3(xz.x, 19.0, xz.y));
      vec3 n = volNormal(uVol, p);
      oPos = vec4(p + n * 0.12, 0.0);
      oVel = vec4(0.0, -3.0, 0.0, 1.0);
      oMeta = vec4(0.0, uFoot.x, uSize.x, 0.05);
      return;
    } else if (nk < 1.5) {
      float jx = (hash12(vec2(seed, 3.0)) - 0.5) * uRiverA.z * 1.6;
      float jz = (hash12(vec2(seed, 4.0)) - 0.5) * uRiverA.z * 1.6;
      vec3 p = spawnSurface(vec3(uRiverA.x + jx, 19.0, uRiverA.y + jz));
      vec3 n = volNormal(uVol, p);
      vec3 down = normalize(vec3(uRiverB.x, -0.12, uRiverB.y) + vec3(-n.x, 0.0, -n.z) * 1.3);
      oPos = vec4(p + n * 0.15, 0.0);
      oVel = vec4(down * uRiverA.w, 1.0);
      oMeta = vec4(1.0, uFoot.y, uSize.y, 0.05);
      return;
    } else if (nk < 2.5) {
      vec2 dir = uWindA.xy;
      float dl = max(length(dir), 1e-3);
      dir /= dl;
      vec2 side = vec2(-dir.y, dir.x);
      float span = (hash12(vec2(seed, 5.0)) - 0.5) * 40.0;
      vec2 hp = -dir * 22.0 + side * span;
      hp = clamp(hp, vec2(-22.0, -20.0), vec2(22.0, 20.0));
      float y = clamp(uWindA.w + (hash12(vec2(seed, 6.0)) - 0.5) * uWindB.x, -1.0, 19.0);
      oPos = vec4(hp.x, y, hp.y, 0.0);
      oVel = vec4(dir.x * uWindA.z, 0.0, dir.y * uWindA.z, 0.0);
      oMeta = vec4(2.0, uFoot.z, uSize.z, 0.35);
      return;
    } else {
      vec2 xz = vec2(hash12(vec2(seed, 7.0)), hash12(vec2(seed, 8.0))) * vec2(40.0, 36.0) - vec2(20.0, 18.0);
      vec3 p = spawnSurface(vec3(xz.x, 19.0, xz.y));
      vec3 n = volNormal(uVol, p);
      if (1.0 - n.y < uTherm.x) return; // only on steep slopes
      oPos = vec4(p + n * 0.2, 0.0);
      oVel = vec4(vec3(-n.x, 0.0, -n.z) * 1.5, 0.2);
      oMeta = vec4(3.0, uFoot.w, uSize.w, uTherm.z);
      return;
    }
  }
  // ---- integration ----
  vec3 p = P.xyz; vec3 v = V.xyz; float water = V.w; float age = P.w;
  float collR = clamp(M.y * 0.35, 0.05, 0.2);
  float impact = 0.0; float contact = 0.0;
  float h = uDT / 3.0;
  if (kind < 1.5) {
    for (int i = 0; i < 3; i++) {
      v.y -= uPhysA.x * h;
      float inWater = step(p.y, uPhysA.y);
      v *= exp(-h * mix(0.12, 3.0, inWater));
      if (kind > 0.5) {
        vec3 n = volNormal(uVol, p);
        vec3 dh = vec3(-n.x, 0.0, -n.z);
        float dl = length(dh);
        vec3 want = dl > 1e-3
          ? normalize(dh / dl * 1.3 + vec3(uRiverB.x, 0.0, uRiverB.y) * uRiverB.z)
          : normalize(vec3(uRiverB.x, -0.1, uRiverB.y));
        want.y -= 0.12;
        v = mix(v, normalize(want) * uRiverA.w, 1.0 - exp(-h * 2.5));
      }
      float vmax = kind > 0.5 ? 9.0 : 12.0;
      v *= min(1.0, vmax / max(length(v), 1e-3));
      vec3 q = p + v * h;
      float d = volSDF(uVol, q);
      if (d < collR) {
        vec3 n = volNormal(uVol, q);
        q += n * (collR - d);
        float vn = dot(v, n);
        if (vn < 0.0) { impact = max(impact, -vn); v -= (1.0 + M.w) * vn * n; }
        v *= exp(-h * (kind > 0.5 ? 1.2 : 2.2));
        contact = 1.0;
      }
      p = q;
    }
    if (kind < 0.5) water *= exp(-uDT * (0.4 + contact * 2.5) * uPhysA.w);
    else water = 1.0;
  } else if (kind < 2.5) {
    vec3 wdir = vec3(uWindA.x, 0.0, uWindA.y);
    float dl = max(length(wdir), 1e-3);
    wdir /= dl;
    float sizeF = clamp(M.z / 0.15, 0.2, 3.0);
    for (int i = 0; i < 3; i++) {
      vec3 air = wdir * uWindA.z;
      float gust = sin(p.x * 0.35 + uTime * 1.7) * sin(p.z * 0.3 - uTime * 1.3);
      air *= 1.0 + uWindB.y * gust * 0.5;
      air.y = (uWindA.w - p.y) * 0.35 + sin(p.x * 0.5 + uTime * 2.0) * 0.6 - uWindB.z * (0.3 + sizeF);
      v = mix(v, air, 1.0 - exp(-h * 2.0));
      v *= min(1.0, 14.0 / max(length(v), 1e-3));
      vec3 q = p + v * h;
      float d = volSDF(uVol, q);
      if (d < collR) {
        vec3 n = volNormal(uVol, q);
        q += n * (collR - d);
        float vn = dot(v, n);
        if (vn < 0.0) { impact = max(impact, -vn); v -= (1.0 + M.w) * vn * n; }
        contact = 1.0;
      }
      p = q;
    }
    water = 0.0;
  } else {
    for (int i = 0; i < 3; i++) {
      v.y -= uPhysA.x * h;
      v *= exp(-h * 0.4);
      vec3 q = p + v * h;
      float d = volSDF(uVol, q);
      if (d < collR) {
        vec3 n = volNormal(uVol, q);
        q += n * (collR - d);
        float vn = dot(v, n);
        if (vn < 0.0) { impact = max(impact, -vn); v -= (1.0 + M.w) * vn * n; }
        v += vec3(-n.x, 0.0, -n.z) * uPhysA.x * h * 0.8;
        v *= exp(-h * 6.0);
        contact = 1.0;
      }
      p = q;
    }
    if (contact > 0.5 && length(v) < 0.5) v *= exp(-uDT * 6.0);
    water *= exp(-uDT * 0.5);
  }
  // Resting particles freeze in place instead of jitter-cutting.
  // (Anything that cannot move cannot erode -- enforced again in event.)
  if (contact > 0.5 && length(v) < 0.45 && kind < 1.5) v *= exp(-uDT * 14.0);
  age += uDT;
  float life = kind < 0.5 ? 30.0 : (kind < 1.5 ? 60.0 : (kind < 2.5 ? 40.0 : 25.0));
  if (age > life || p.x < VMIN.x - 1.0 || p.x > VMAX.x + 1.0 || p.y < VMIN.y - 1.0 ||
      p.y > VMAX.y + 1.0 || p.z < VMIN.z - 1.0 || p.z > VMAX.z + 1.0) {
    oPos = vec4(p, -1.0); oVel = vec4(0.0); oImpact = vec4(0.0);
    return;
  }
  oPos = vec4(p, age); oVel = vec4(v, water);
  oImpact = vec4(impact, contact, step(p.y, uPhysA.y), 0.0);
}
`;

export const EVENT_FRAG = SIM_HEAD + `
uniform sampler2D uPos, uVel, uCargo, uMeta, uAux, uImpact, uVol;
uniform float uDT, uWater;
uniform vec4 uHyd;   // capK, detK, depK, unused
uniform vec4 uRiv;   // capK, detK, depK, footMul
uniform vec4 uWnd;   // capK, detK, depK, unused
uniform vec4 uThm;   // rate, slopeThresh, depK, unused
uniform vec4 uWindA; // dirX, dirZ, speed, height
layout(location = 0) out vec4 oContact;
layout(location = 1) out vec4 oExchange;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, uv, 0);
  oContact = vec4(0.0); oExchange = vec4(0.0);
  if (P.w < 0.0) return;
  vec4 V = texelFetch(uVel, uv, 0);
  vec4 M = texelFetch(uMeta, uv, 0);
  vec4 A = texelFetch(uAux, uv, 0);
  vec4 C = texelFetch(uCargo, uv, 0);
  vec4 H = texelFetch(uImpact, uv, 0);
  float kind = M.x;
  float d = volSDF(uVol, P.xyz);
  if (d > 0.4 || d < -1.0) return;
  vec3 n = volNormal(uVol, P.xyz);
  vec3 c = P.xyz - n * d;
  float radius = M.y * ((kind > 0.5 && kind < 1.5) ? uRiv.w : 1.0);
  radius = clamp(radius, 0.2, 2.0);
  ivec3 cc = ivec3(floor((c - VMIN) / CELLV));
  vec2 sums = vec2(0.0);
  for (int z = -2; z <= 2; z++) for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    ivec3 q = cc + ivec3(x, y, z);
    if (q.x < 0 || q.y < 0 || q.z < 0 || q.x >= DIM.x || q.y >= DIM.y || q.z >= DIM.z) continue;
    float k = kern(worldAt(q), c, radius);
    if (k <= 0.0) continue;
    if (voxelFetch(uVol, q).x < 0.0) sums.x += k; else sums.y += k;
  }
  float speed = length(V.xyz); float slope = 1.0 - n.y; float water = V.w;
  float load = C.x + C.y + C.z;
  float cap = 0.0; float det = 0.0;
  // A particle that is not moving relative to the surface cannot erode.
  // moveGate kills drilling-while-bouncing; restGate kills drilling-while-resting.
  float moveGate = kind < 1.5 ? smoothstep(0.3, 1.0, speed) : 1.0;
  float restGate = 1.0 - smoothstep(0.15, 0.3, A.x);
  float hemi = 2.0944 * radius * radius * radius;
  if (kind < 0.5) {
    cap = (0.03 + uHyd.x * 0.25) * water * (0.2 + speed * 0.5) * (0.3 + slope * 2.0);
    float stress = speed * (0.3 + slope * 2.5);
    det = uHyd.y * max(0.0, stress - 0.6) * hemi * uDT * 0.35;
  } else if (kind < 1.5) {
    cap = (0.05 + uRiv.x * 0.5) * water * (0.3 + speed * 0.6);
    det = uRiv.y * max(0.0, speed * speed * 0.025 + slope * speed * 0.5 - 0.5) * hemi * uDT * 0.35;
  } else if (kind < 2.5) {
    vec2 wd = uWindA.xy / max(length(uWindA.xy), 1e-3);
    float facing = max(0.0, dot(n, -vec3(wd.x, 0.0, wd.y)));
    float sizeF = clamp(M.z / 0.15, 0.2, 3.0);
    float abra = max(H.x * 0.8, speed * 0.2) * facing;
    det = uWnd.y * max(0.0, abra - 0.4) * sizeF * hemi * 0.25 * uDT;
    cap = (0.02 + uWnd.x * 0.2) * speed * speed * 0.05;
  } else {
    if (slope > uThm.y) det = uThm.x * (slope - uThm.y) * 3.0 * hemi * uDT;
    cap = 0.05 + speed * 0.1;
  }
  det *= moveGate * restGate;
  det = min(det, max(0.0, cap - load));
  det = min(det, sums.x * VOXELV * 0.02);
  float depK = kind < 0.5 ? uHyd.z : (kind < 1.5 ? uRiv.z : (kind < 2.5 ? uWnd.z : uThm.z));
  float surplus = max(0.0, load - cap);
  float settle = kind < 0.5 ? 5.0 : (kind < 1.5 ? 3.0 : (kind < 2.5 ? 2.0 : 6.0));
  float dep = depK * (surplus * (1.0 - exp(-uDT * 8.0)) + load * settle * uDT * 0.5);
  dep += C.z * uDT * 1.5 / (1.0 + speed);
  if (P.y < uWater) dep += load * uDT * 4.0;
  if (kind < 0.5 && water < 0.05) dep += load * min(1.0, uDT * 6.0); // dry-out dump
  if (A.w > 0.5) dep += load;
  if (kind > 1.5 && kind < 2.5) {
    vec2 wd = uWindA.xy / max(length(uWindA.xy), 1e-3);
    float lee = max(0.0, dot(n, vec3(wd.x, 0.0, wd.y)));
    dep *= 1.0 + lee * 2.0;
  }
  dep = min(dep, sums.y * VOXELV * 0.03 + 1e-9);
  float wet = (kind > 1.5 && kind < 2.5) ? 0.0 : clamp(water, 0.0, 1.0);
  oContact = vec4(c, radius);
  oExchange = vec4(det, dep, 0.0, wet);
}
`;

export const SPLAT_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uContact, uExchange, uCargo;
flat out vec4 vContact;
flat out vec4 vExchange;
flat out vec3 vFrac;
void main() {
  int id = gl_InstanceID / 3;
  int off = gl_InstanceID - 3 * id - 1;
  ivec2 puv = ivec2(id - 64 * (id / 64), id / 64);
  vContact = texelFetch(uContact, puv, 0);
  vExchange = texelFetch(uExchange, puv, 0);
  vec4 c = texelFetch(uCargo, puv, 0);
  float tot = c.x + c.y + c.z;
  vFrac = tot > 1e-9 ? c.xyz / tot : vec3(0.6, 0.3, 0.1);
  int z = int(floor((vContact.z + 22.0) / 0.34375)) + off;
  if (vContact.w <= 0.0 || z < 0 || z >= 128 || (vExchange.x <= 0.0 && vExchange.y <= 0.0 && vExchange.w <= 0.0)) {
    gl_Position = vec4(-3.0, -3.0, 0.0, 1.0);
    return;
  }
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  float r = vContact.w;
  vec2 q = (vContact.xy - vec2(-24.0, -6.0)) / vec2(0.375, 0.325) + corner * (r / vec2(0.375, 0.325) + 1.0);
  q = clamp(q, vec2(0.0), vec2(128.0, 80.0));
  vec2 tile = vec2(float(z - 8 * (z / 8)) * 128.0, float(z / 8) * 80.0);
  vec2 pixel = tile + q;
  gl_Position = vec4(pixel / vec2(1024.0, 1280.0) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SPLAT_FRAG = SIM_HEAD + `
flat in vec4 vContact;
flat in vec4 vExchange;
flat in vec3 vFrac;
uniform float uReqScale;
layout(location = 0) out vec4 oReq;
void main() {
  vec2 px = gl_FragCoord.xy - 0.5;
  float tx = floor(px.x / 128.0); float ty = floor(px.y / 80.0);
  vec3 v = vec3(px.x - tx * 128.0, px.y - ty * 80.0, ty * 8.0 + tx);
  vec3 pw = VMIN + (v + 0.5) * CELLV;
  float k = kern(pw, vContact.xyz, vContact.w);
  if (k <= 0.0) discard;
  float dep = vExchange.y * k;
  oReq = vec4(vExchange.x * k, dep, vExchange.w * k, dep * vFrac.z) * uReqScale;
}
`;

export const APPLY_FRAG = SIM_HEAD + `
uniform sampler2D uVol, uReq;
uniform float uDT, uWetDecay, uReqScale;
layout(location = 0) out vec4 oVol;
layout(location = 1) out vec4 oAcc;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 V = texelFetch(uVol, uv, 0);
  vec4 R = texelFetch(uReq, uv, 0) / uReqScale;
  float solid = clamp(0.5 - V.x / 1.2, 0.0, 1.0);
  float avail = solid * VOXELV;
  float det = min(R.x, avail * 0.2);
  float dep = min(R.y, (1.0 - solid) * VOXELV * 0.2 + 1e-9);
  float dShift = clamp((det - dep) / FACEV, -0.008, 0.008);
  vec2 px = vec2(uv);
  float tx = floor(px.x / 128.0); float ty = floor(px.y / 80.0);
  vec3 vv = vec3(px.x - tx * 128.0, px.y - ty * 80.0, ty * 8.0 + tx);
  vec3 pw = VMIN + (vv + 0.5) * CELLV;
  float wall = -min(min(23.0 - abs(pw.x), 21.0 - abs(pw.z)), min(pw.y + 5.0, 19.0 - pw.y));
  float sdf = clamp(V.x + dShift, -BANDV, BANDV);
  sdf = max(sdf, wall);
  float G = clamp(V.y + (dep - det * clamp(V.y, 0.0, 1.0)) / VOXELV, 0.0, 4.0);
  float B = clamp(max(V.z * uWetDecay, R.z * 4.0), 0.0, 1.0);
  float cm = V.w;
  if (R.y > 1e-9) {
    float f = clamp(R.y / VOXELV, 0.0, 1.0);
    cm = mix(V.w, clamp(R.w / max(R.y, 1e-9), 0.0, 1.0), f);
  }
  oVol = vec4(sdf, G, B, cm);
  oAcc = vec4(det / max(R.x, 1e-9), dep / max(R.y, 1e-9), 0.0, 0.0);
}
`;

export const CARGO_FRAG = SIM_HEAD + `
uniform sampler2D uPos, uVel, uCargo, uMeta, uAux, uContact, uExchange, uImpact, uAcc;
uniform float uDT;
layout(location = 0) out vec4 oCargo;
layout(location = 1) out vec4 oAux;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, uv, 0);
  if (P.w < 0.0) { oCargo = vec4(0.0); oAux = vec4(0.0); return; }
  vec4 V = texelFetch(uVel, uv, 0);
  vec4 M = texelFetch(uMeta, uv, 0);
  vec4 A = texelFetch(uAux, uv, 0);
  vec4 C = texelFetch(uCargo, uv, 0);
  vec4 CT = texelFetch(uContact, uv, 0);
  vec4 EX = texelFetch(uExchange, uv, 0);
  vec4 H = texelFetch(uImpact, uv, 0);
  float kind = M.x;
  vec2 acc = vec2(1.0);
  if (CT.w > 0.0) {
    ivec3 cv = clamp(ivec3(floor((CT.xyz - VMIN) / CELLV)), ivec3(0), DIM - ivec3(1));
    acc = voxelFetch(uAcc, cv).xy;
  }
  float det = EX.x * acc.x; float dep = EX.y * acc.y;
  vec3 prod = kind < 0.5 ? vec3(0.55, 0.35, 0.10)
    : (kind < 1.5 ? vec3(0.5, 0.3, 0.2) : (kind < 2.5 ? vec3(0.85, 0.15, 0.0) : vec3(0.3, 0.1, 0.6)));
  vec3 load = C.xyz + prod * det;float tot = load.x + load.y + load.z;
  float dd = min(dep, tot);
  if (tot > 1e-9 && dd > 0.0) {
    vec3 frac = load / max(tot, 1e-9);
    vec3 w = vec3(0.8, 1.0, 1.6);
    frac *= w; frac /= max(frac.x + frac.y + frac.z, 1e-9);
    load = max(load - frac * dd, vec3(0.0));
  }
  float rest = A.x;
  if (H.y > 0.5 && length(V.xyz) < 0.5) rest += uDT; else rest = 0.0;
  if (M.x < 0.5 && V.w < 0.04) rest += uDT * 2.0; // dry droplets give up fast
  float flags = A.w;
  float tot2 = load.x + load.y + load.z;
  if (rest > 0.4 && tot2 > 1e-6) flags = 1.0;
  if (tot2 < 1e-6) flags = 0.0;
  oCargo = vec4(load, C.w);
  oAux = vec4(rest, A.y, A.z, flags);
}
`;

export const COUNT_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPos, uCargo, uAux, uMeta;
uniform float uActive;
layout(location = 0) out vec4 oCount;
void main() {
  float alive = 0.0; float resting = 0.0; float carried = 0.0; float river = 0.0;
  for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) {
    ivec2 q = ivec2(x, y);
    vec4 P = texelFetch(uPos, q, 0);
    if (P.w < 0.0) continue;
    if (float(y * 64 + x) >= uActive) continue;
    alive += 1.0;
    vec4 A = texelFetch(uAux, q, 0);
    if (A.x > 0.4) resting += 1.0;
    vec4 C = texelFetch(uCargo, q, 0);
    carried += C.x + C.y + C.z;
    vec4 M = texelFetch(uMeta, q, 0);
    if (M.x > 0.5 && M.x < 1.5) river += 1.0;
  }
  oCount = vec4(alive, resting, carried, river);
}
`;

export const REDUCE1_FRAG = SIM_HEAD + `
uniform sampler2D uVol;
layout(location = 0) out vec4 oSum;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  vec4 s = vec4(0.0);
  for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) {
    ivec2 q = b * 32 + ivec2(x, y);
    vec4 V = texelFetch(uVol, q, 0);
    float solid = clamp(0.5 - V.x / 1.2, 0.0, 1.0);
    s.x += solid * VOXELV;
    s.y += V.y * VOXELV;
    s.z += V.z;
    s.w += V.w * V.y * VOXELV;
  }
  oSum = s;
}
`;

export const REDUCE2_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSum;
layout(location = 0) out vec4 oTotal;
void main() {
  vec4 s = vec4(0.0);
  for (int y = 0; y < 40; y++) for (int x = 0; x < 32; x++) s += texelFetch(uSum, ivec2(x, y), 0);
  oTotal = s;
}
`;

export const FLOW_FRAG = SIM_HEAD + `
uniform sampler2D uVol;
uniform float uWater, uRiverOn;
uniform vec4 uRiverA; // inletX, inletZ, width, unused
uniform vec4 uRiverB; // downX, downZ, unused, unused
uniform vec4 uWindA;  // dirX, dirZ, speed, unused
layout(location = 0) out vec4 oFlow;
void main() {
  vec2 xz = (gl_FragCoord.xy - 0.5) / 256.0 * vec2(48.0, 44.0) + vec2(-24.0, -22.0);
  float surfY = -6.0;
  for (int yi = 79; yi >= 0; --yi) {
    vec3 pw = vec3(xz.x, -6.0 + (float(yi) + 0.5) * 0.325, xz.y);
    if (volSDF(uVol, pw) < 0.0) { surfY = pw.y; break; }
  }
  vec2 down = uRiverB.xy / max(length(uRiverB.xy), 1e-3);
  vec2 rel = xz - uRiverA.xy;
  float t = dot(rel, down);
  float tc = clamp(t, 0.0, 44.0);
  float dist = length(rel - down * tc);
  float mask = exp(-pow(dist / max(uRiverA.z, 0.5), 2.0)) * step(0.0, t) * step(t, 44.0) * uRiverOn;
  vec2 wdir = uWindA.xy / max(length(uWindA.xy), 1e-3);
  float sea = 1.0 - smoothstep(uWater, uWater + 0.6, surfY);
  vec2 perp = vec2(-down.y, down.x);
  vec2 flow = wdir * 0.35 * sea + down * mask * 2.0 + perp * sin(t * 0.45) * mask * 0.6;
  float speed = length(flow);
  oFlow = vec4(speed > 1e-4 ? flow / speed : vec2(0.0), speed, sea);
}
`;
