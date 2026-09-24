// ============================================================================
//  waveshape.js — THE WAVE
// ----------------------------------------------------------------------------
//  A cheap-but-realistic parametric surfing wave: a shoaling wall that unzips
//  ("peels") along its crest line, pitches a curling lip over a hollow tube,
//  then collapses into a churning foam pile. Everything is CLOSED-FORM:
//
//    • one static (u,v) grid is displaced entirely in the vertex shader
//    • the same formulas are ported to JS so the surfboard can collide with
//      the surface without reading anything back from the GPU
//    • zero textures, zero simulation, zero FFT — a handful of sin/exp/sqrt
//
//  World axes:   +X = toward the beach,  +Y = up,  +Z = "down the line"
//                (the peel point races toward +Z)
//
//  Local cross-shore coord X = Xw - crestX(z,t):  X = 0 at the crest spine,
//  the face occupies X in [0, Wf], flats X > Wf, back of the wave X < 0.
//
//  Break stage b(z,t) = (zB(t) - z) / (vPeel * TBreak):
//     b < 0        unbroken wall ahead of the peel (clean face)
//     0 .. 1       pitching: the lip throws forward into a tube
//     1 .. 2       the lip has landed; foam pile climbs the face
//     > 2          old soup, slowly settling
//
//  The crest cross-section is an 8-point control polyline ("fold") that morphs
//  between keyframes: a tiny leaning rim when unbroken (points 0..4 out, 4..7
//  back = the crest edge has real thickness) and a full spiral lip + tube
//  ceiling when hollow. This gives genuine OVERHANG geometry (the tube) from
//  a stripline mesh, with no topology changes and no cracks.
// ============================================================================

import { clamp, lerp, smoothstep, sech2 } from './math.js';

// ----------------------------------------------------------------------------
//  Wave "conditions" — one set wave's parameters. Rerolled per wave.
// ----------------------------------------------------------------------------
export function makeConditions(rnd = Math.random) {
  const r = (a, b) => a + (b - a) * rnd();
  const H = r(2.7, 3.9);                       // face height (m)
  return {
    H,
    c: r(4.0, 4.5),                            // phase speed toward shore (m/s)
    vPeel: r(8.0, 11.0),                       // peel speed along the line (m/s)
    TBreak: r(2.1, 2.6),                       // s for a section: pitch -> foam
    xC0: -50,                                  // crest axis start (m)
    xClose: 20,                                // closeout bar (crest dies here)
    xShore: 30,                                // waterline
    sandSlope: 0.035,
    zPeel0: -30,                               // where the peel starts (m)
    zLineEnd: 235,                             // wave runs dry near here (m)
    taperLen: 45,
    wanderAmp: r(0.8, 1.7),                    // meander of the crest line (m)
    curlR: H * r(0.40, 0.48),                  // lip curl radius at full pitch
    shrink: r(0.24, 0.32),                     // spiral tightening toward lip
    faceAspect: r(0.85, 1.0),                  // Wf/H of the walled face
    wind: r(-0.9, -0.35),                      // <0 offshore (spray blows back)
    sunAz: r(-0.5, 0.5),                       // radians around Y
    sunEl: r(0.30, 0.52),                      // radians above horizon
  };
}

// ----------------------------------------------------------------------------
//  Per-sample context (all cheap scalar fields of (z,t))
// ----------------------------------------------------------------------------
export function stageAt(z, t, p) {
  return (zB(t, p) - z) / (p.vPeel * p.TBreak);
}
export function zB(t, p) { return p.zPeel0 + p.vPeel * t; }
export function crestX0(t, p) { return p.xC0 + p.c * t; }
export function crestX(z, t, p) {
  // low-frequency meander of the crest line
  return crestX0(t, p) + p.wanderAmp * Math.sin(z * 0.021 + 1.3) * Math.sin(z * 0.0071 - 0.4);
}
// taper: the wave "runs dry" toward the end of the line
export function lineTaper(z, p) {
  return smoothstep(p.zLineEnd, p.zLineEnd - p.taperLen, z);
}
export function heightScale(z, t, p) {
  // jacking: the face thickens and lifts just before the section pitches
  const b = stageAt(z, t, p);
  const jack = 1 + 0.06 * smoothstep(-0.6, 0.0, b) * (1 - smoothstep(0.0, 0.8, b));
  // the wall tapers into the shoulder ahead of the peel (so "down the line"
  // is literally downhill from the pocket — this drives the peel race)
  const shoulder = 1 - 0.16 * smoothstep(2, 45, z - zB(t, p));
  return p.H * lineTaper(z, p) * jack * shoulder;
}
export function faceGeom(z, t, p) {
  // Hf: face height, Wf: face horizontal extent (aspect shrinks as it hollows)
  const b = stageAt(z, t, p);
  const pitch = smoothstep(-0.25, 0.8, b);
  const foam = smoothstep(1.0, 1.55, b);
  const soupK = lerp(1.0, 0.6, smoothstep(1.2, 3.2, b));
  const Hf = heightScale(z, t, p) * (1 - 0.30 * foam);      // soup is lower
  const aspect = lerp(p.faceAspect, 0.68, pitch) * (1 + 0.25 * foam);
  return { b, pitch, foam, soupK, Hf: Math.max(Hf, 0.05), Wf: Math.max(Hf * aspect, 0.05) };
}
export function lipFallOf(b, p) { return Math.max(0, b - 1) * 1.35; }

// ----------------------------------------------------------------------------
//  FACE — explicit single-valible profile y(X): a slabby, slightly concave wall
//  (real shoaling faces run ~55-70° and only go vertical as the lip launches).
//  X in [0 (spine), Wf (face bottom)]; slope 0 at the flats join.
// ----------------------------------------------------------------------------
export function faceY(X, Hf, Wf) {
  const u = clamp((Wf - X) / Wf, 0, 1);            // 1 at spine, 0 at bottom
  return Hf * Math.pow(u, 1.8);
}
// foam pile skirt must always sit on top of the face
export function pileSkirtClamp(X, y, Hf, Wf, foam) {
  if (foam > 0 && X > 0) return Math.max(y, faceY(X, Hf, Wf) * (1 - foam * 0.22) + 0.03 * Hf);
  return y;
}
export function faceSlopeX(X, Hf, Wf) {            // dy/dX (negative: down toward beach)
  const u = clamp((Wf - X) / Wf, 0, 1);
  return -(Hf * 1.8 * Math.pow(u, 0.8)) / Math.max(Wf, 0.05);
}

// ----------------------------------------------------------------------------
//  FOLD KEYFRAMES — crest cross-section control points in units of Hf
//  (both X and y).  CPs 0..4 = outer path (face top -> rim/lip tip),
//  CPs 4..7 = inner return (tube ceiling -> spine).
// ----------------------------------------------------------------------------
//  unbroken wall: leaning crest rim (real crest edges are rounded & thin)
const KEY_WALL = [
  [0.00, 1.000],
  [0.02, 1.06],
  [0.07, 1.095],
  [0.11, 1.06],
  [0.125, 1.015],  // rim tip (free edge)
  [0.09, 1.00],
  [0.04, 1.02],
  [-0.01, 1.03],   // spine S
];
//  full hollow pitch: the bucket lip throws forward, tube ceiling returns
const KEY_HOLLOW = [
  [0.00, 1.000],   // face top (launching at ~69 deg)
  [0.05, 1.10],    // bucket bending up
  [0.13, 1.17],    // lip crown over the top
  [0.22, 1.02],    // lip front, descending
  [0.28, 0.72],    // LIP TIP (free edge; falls once b > 1)
  [0.19, 0.72],    // ceiling under the lip
  [0.08, 0.86],    // ceiling rising to spine
  [-0.02, 0.98],   // spine S
];
//  collapsed foam pile (foamAmt = 1): thick aerated mound draped over the top,
//  front foot washing down the face, thin fold (ceiling melts into the rim)
const KEY_PILE = [
  [0.00, 0.58],
  [0.08, 0.66],
  [0.17, 0.63],
  [0.25, 0.52],
  [0.30, 0.42],    // pile front foot (sits on the face)
  [0.27, 0.36],
  [0.16, 0.44],
  [0.00, 0.53],
];

function lerpKey(a, b, t, out) {
  for (let i = 0; i < 8; i++) {
    out[i * 2] = lerp(a[i][0], b[i][0], t);
    out[i * 2 + 1] = lerp(a[i][1], b[i][1], t);
  }
}

//  Fill cp[16] with the 8 fold control points for this sample (units: *Hf).
//  pitch: 0..1 wall->hollow, lipFall: metres the tip has dropped, foam: 0..1,
//  soupK: soup height decay (1 while solid, ~0.6 as the pile settles).
export function foldCP(cp, pitch, lipFall, foam, Hf, curlR, shrink, soupK = 1) {
  if (foam <= 0) {
    lerpKey(KEY_WALL, KEY_HOLLOW, pitch, cp);
  } else if (foam >= 1) {
    for (let i = 0; i < 8; i++) { cp[i * 2] = KEY_PILE[i][0]; cp[i * 2 + 1] = KEY_PILE[i][1] * soupK; }
  } else {
    const tmp = foldCP._tmp || (foldCP._tmp = new Float64Array(16));
    lerpKey(KEY_WALL, KEY_HOLLOW, pitch, tmp);
    const s = smoothstep(0, 1, foam);
    for (let i = 0; i < 8; i++) {
      cp[i * 2] = lerp(tmp[i * 2], KEY_PILE[i][0], s);
      cp[i * 2 + 1] = lerp(tmp[i * 2 + 1], KEY_PILE[i][1] * soupK, s);
    }
  }
  // scale out of Hf-units
  for (let i = 0; i < 8; i++) { cp[i * 2] *= Hf; cp[i * 2 + 1] *= Hf; }

  // the curl is fatter/thinner with the actual curl radius of this wave
  const curlScale = (curlR / (0.44 * 3.2));   // relative to design radius
  const cs = lerp(1, clamp(curlScale, 0.8, 1.35), pitch * (1 - foam));
  for (let i = 1; i <= 4; i++) {
    cp[i * 2] = lerp(cp[0], cp[i * 2], cs);
    // tighten the spiral slightly toward the tip
    const tight = 1 - shrink * 0.5 * (i - 1) / 3 * pitch;
    cp[i * 2 + 1] = cp[1] + (cp[i * 2 + 1] - cp[1]) * cs * tight;
  }

  //  gravity takes the lip once it has thrown (b > 1): the whole outer lip
  //  arcs down-forward together (not just the tip)
  if (lipFall > 0) {
    const f = Math.min(lipFall, 0.85) * (1 - foam);   // no fall drag once it's soup
    const W = [0, 0.4, 0.65, 0.85, 1.0, 0.55];
    for (let i = 1; i <= 5; i++) {
      cp[i * 2 + 1] -= W[i] * f;
      cp[i * 2] += W[i] * f * 0.22;
    }
  }
  return cp;
}

//  Centripetal Catmull-Rom knots (alpha = 0.5) — no overshoot loops on tight
//  turns like the lip tip.  tOut[8]; returns the s-fraction of CP4 (the tip).
export function foldKnots(cp, tOut) {
  tOut[0] = 0;
  for (let i = 0; i < 7; i++) {
    const dx = cp[(i + 1) * 2] - cp[i * 2], dy = cp[(i + 1) * 2 + 1] - cp[i * 2 + 1];
    tOut[i + 1] = tOut[i] + Math.pow(Math.hypot(dx, dy) + 1e-6, 0.5);
  }
  return tOut[4] / tOut[7];
}

//  Evaluate the fold spline at s in [0,1] (0 = face top, 1 = spine; tip at foldKnots' return).
export function foldEval(cp, s, out) {
  const t = foldEval._t || (foldEval._t = new Float64Array(8));
  foldKnots(cp, t);
  const tt = t[7] * clamp(s, 0, 1);
  let i1 = 0;
  while (i1 < 6 && t[i1 + 1] < tt) i1++;
  const u = (tt - t[i1]) / Math.max(t[i1 + 1] - t[i1], 1e-9);
  const g = (i) => {
    const k = Math.max(0, Math.min(7, i));
    return [cp[k * 2], cp[k * 2 + 1]];
  };
  // centripetal tangents (Nonuniform Catmull-Rom, Barry-Goldman style)
  const p0 = g(i1 - 1), p1 = g(i1), p2 = g(i1 + 1), p3 = g(i1 + 2);
  const dt01 = Math.max(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 1e-6);
  const dt12 = Math.max(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 1e-6);
  const dt23 = Math.max(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 1e-6);
  const m1x = (p1[0] - p0[0]) / dt01 - (p2[0] - p0[0]) / (dt01 + dt12) + (p2[0] - p1[0]) / dt12;
  const m1y = (p1[1] - p0[1]) / dt01 - (p2[1] - p0[1]) / (dt01 + dt12) + (p2[1] - p1[1]) / dt12;
  const m2x = (p2[0] - p1[0]) / dt12 - (p3[0] - p1[0]) / (dt12 + dt23) + (p3[0] - p2[0]) / dt23;
  const m2y = (p2[1] - p1[1]) / dt12 - (p3[1] - p1[1]) / (dt12 + dt23) + (p3[1] - p2[1]) / dt23;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  out[0] = h00 * p1[0] + h10 * dt12 * m1x + h01 * p2[0] + h11 * dt12 * m2x;
  out[1] = h00 * p1[1] + h10 * dt12 * m1y + h01 * p2[1] + h11 * dt12 * m2y;
  return out;
}

// ----------------------------------------------------------------------------
//  BACK of the wave: sech^2 falloff seaward from the spine, matched to the
//  fold's spine point S. Soup (foam) shortens & fattens it.
// ----------------------------------------------------------------------------
export function backY(X, spineX, spineY, Hf) {
  // rounded crest dome — never flat on top (a board must not balance there)
  const d = Math.abs(spineX - X) / Math.max(Hf, 0.1);
  return spineY * sech2(0.78 * d);
}

// ----------------------------------------------------------------------------
//  FOAM PILE — single-valued mound envelope used by PHYSICS (and shading masks).
//  X local; matches KEY_PILE's outer path roughly.
// ----------------------------------------------------------------------------
export function pileY(X, Hf, soupH) {
  // soupH ~ 0.45..0.6 * Hf (already includes decay)
  const xn = X / Math.max(Hf, 0.1);
  // mound from X=-0.15Hf to 0.45Hf
  const u = (xn + 0.15) / 0.60;
  if (u <= 0 || u >= 1) return 0;
  const mound = Math.sin(Math.PI * Math.pow(u, 0.8));
  return soupH * mound * (1 - 0.35 * xn);
}

// ----------------------------------------------------------------------------
//  FLATS — ambient swell + the draw-down dip at the foot of the face + shore.
//  X local (> Wf), Xw world.
// ----------------------------------------------------------------------------
export function swellY(Xw, z, t) {
  // 3 cheap sine "Gerstner-lite" components (mostly vertical)
  return (
    0.10 * Math.sin(Xw * 0.11 + t * 0.9 + z * 0.03) +
    0.06 * Math.sin(Xw * 0.075 - t * 0.55 + z * 0.055 + 2.1) +
    0.035 * Math.sin((Xw + z) * 0.19 + t * 1.3)
  );
}
export function dipY(X, Wf, Hf) {
  // water sucked toward the wave: slight depression in front of the face
  const u = X - Wf;
  if (u <= 0.3) return 0;
  const win = smoothstep(0.3, 2.2, u) * (1 - smoothstep(3.5, 10.0, u));
  return -0.10 * Hf * win;
}

// ----------------------------------------------------------------------------
//  PHYSICS heightfield: y at world (Xw, z) at time t.  Single-valued (the tube
//  floor is the face; the fold/ceiling lives above and is collision-free).
//  Returns also handy surface info via the optional `out` object.
// ----------------------------------------------------------------------------
export function heightAt(Xw, z, t, p, out) {
  const cx = crestX(z, t, p);
  const X = Xw - cx;
  const { b, pitch, foam, Hf, Wf } = faceGeom(z, t, p);
  const soupH = Hf * lerp(0.52, 0.30, smoothstep(1.1, 3.0, b)) * smoothstep(0.9, 1.2, b);

  let y;
  if (X >= Wf) {
    y = swellY(Xw, z, t) + dipY(X, Wf, Hf);
  } else if (X >= 0) {
    y = faceY(X, Hf, Wf) * (1 - foam * 0.22) + swellY(Xw, z, t) * 0.15;
    if (soupH > 0) y = Math.max(y, pileY(X, Hf, soupH) + swellY(Xw, z, t) * 0.1);
  } else {
    // crest cap / back
    const cp = foldCP(new Float64Array(16), pitch, lipFallOf(b, p), foam, Hf, p.curlR, p.shrink,
      lerp(1.0, 0.6, smoothstep(1.2, 3.2, b)));
    const sX = cp[14], sY = cp[15];                  // spine
    y = backY(X, sX, sY, Hf) + swellY(Xw, z, t) * 0.3;
    if (soupH > 0) y = Math.max(y, pileY(X, Hf, soupH));
  }
  if (out) {
    out.b = b; out.Hf = Hf; out.Wf = Wf; out.foam = foam; out.pitch = pitch; out.X = X;
  }
  return y;
}

//  Slope (dy/dXw, dy/dz) by central differences — fine for the board.
export function surfaceSlope(Xw, z, t, p, out) {
  const e = 0.12;
  const hx1 = heightAt(Xw + e, z, t, p), hx0 = heightAt(Xw - e, z, t, p);
  const hz1 = heightAt(Xw, z + e, t, p), hz0 = heightAt(Xw, z - e, t, p);
  out[0] = (hx1 - hx0) / (2 * e);
  out[1] = (hz1 - hz0) / (2 * e);
  return out;
}

// ============================================================================
//  GLSL PORT — kept structurally identical to the JS above.
//  (Used by both the water vertex + fragment shaders.)
// ============================================================================
export const WAVE_GLSL = /* glsl */`
#define NB 8

float wsClamp(float v, float a, float b) { return clamp(v, a, b); }
float wsLerp(float a, float b, float t) { return a + (b - a) * t; }
float wsSmooth(float a, float b, float x) {
  float t = wsClamp((x - a) / (b - a + 1e-9), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
float wsSech2(float x) { float c = cosh(wsClamp(x, -20.0, 20.0)); return 1.0 / (c * c); }

// ---- conditions (uniforms) ----
uniform float uH, uC, uVPeel, uTBreak, uXC0, uXClose, uXShore, uSandSlope;
uniform float uZPeel0, uZLineEnd, uTaperLen, uWander, uCurlR, uShrink, uFaceAspect;
uniform float uWind, uSunAz, uSunEl;

float wzB(float t)        { return uZPeel0 + uVPeel * t; }
float wCrestX0(float t)   { return uXC0 + uC * t; }
float wCrestX(float z, float t) {
  return wCrestX0(t) + uWander * sin(z * 0.021 + 1.3) * sin(z * 0.0071 - 0.4);
}
float wStage(float z, float t) { return (wzB(t) - z) / (uVPeel * uTBreak); }
float wTaper(float z)     { return wsSmooth(uZLineEnd, uZLineEnd - uTaperLen, z); }
float wHeightScale(float z, float t) {
  float b = wStage(z, t);
  float jack = 1.0 + 0.06 * wsSmooth(-0.6, 0.0, b) * (1.0 - wsSmooth(0.0, 0.8, b));
  float shoulder = 1.0 - 0.16 * wsSmooth(2.0, 45.0, z - wzB(t));
  return uH * wTaper(z) * jack * shoulder;
}
void wFaceGeom(float z, float t, out float b, out float pitch, out float foam, out float soupK, out float Hf, out float Wf) {
  b = wStage(z, t);
  pitch = wsSmooth(-0.25, 0.8, b);
  foam  = wsSmooth(1.0, 1.55, b);
  soupK = wsLerp(1.0, 0.6, wsSmooth(1.2, 3.2, b));
  Hf = wHeightScale(z, t) * (1.0 - 0.30 * foam);
  Hf = max(Hf, 0.05);
  float aspect = wsLerp(uFaceAspect, 0.68, pitch) * (1.0 + 0.25 * foam);
  Wf = max(Hf * aspect, 0.05);
}
float wLipFall(float b) { return max(0.0, b - 1.0) * 1.35; }

float wFaceY(float X, float Hf, float Wf) {
  float u = wsClamp((Wf - X) / Wf, 0.0, 1.0);
  return Hf * pow(u, 1.8);
}

// ---- fold keyframes (mirrors KEY_WALL / KEY_HOLLOW / KEY_PILE) ----
const vec2 KEY_WALL[NB] = vec2[NB](
  vec2(0.00, 1.000), vec2(0.02, 1.06), vec2(0.07, 1.095), vec2(0.11, 1.06),
  vec2(0.125, 1.015), vec2(0.09, 1.00), vec2(0.04, 1.02), vec2(-0.01, 1.03));
const vec2 KEY_HOLLOW[NB] = vec2[NB](
  vec2(0.00, 1.000), vec2(0.05, 1.10), vec2(0.13, 1.17), vec2(0.22, 1.02),
  vec2(0.28, 0.72), vec2(0.19, 0.72), vec2(0.08, 0.86), vec2(-0.02, 0.98));
const vec2 KEY_PILE[NB] = vec2[NB](
  vec2(0.00, 0.58), vec2(0.08, 0.66), vec2(0.17, 0.63), vec2(0.25, 0.52),
  vec2(0.30, 0.42), vec2(0.27, 0.36), vec2(0.16, 0.44), vec2(0.00, 0.53));

void wFoldCP(float pitch, float lipFall, float foam, float Hf, float soupK, out vec2 cp[NB]) {
  vec2 tmp[NB];
  if (foam <= 0.0) {
    for (int i = 0; i < NB; i++) cp[i] = mix(KEY_WALL[i], KEY_HOLLOW[i], pitch);
  } else if (foam >= 1.0) {
    for (int i = 0; i < NB; i++) cp[i] = vec2(KEY_PILE[i].x, KEY_PILE[i].y * soupK);
  } else {
    float s = wsSmooth(0.0, 1.0, foam);
    for (int i = 0; i < NB; i++) {
      tmp[i] = mix(KEY_WALL[i], KEY_HOLLOW[i], pitch);
      cp[i] = mix(tmp[i], vec2(KEY_PILE[i].x, KEY_PILE[i].y * soupK), s);
    }
  }
  for (int i = 0; i < NB; i++) cp[i] *= Hf;

  float curlScale = uCurlR / (0.44 * 3.2);
  float cs = wsLerp(1.0, wsClamp(curlScale, 0.8, 1.35), pitch * (1.0 - foam));
  for (int i = 1; i <= 4; i++) {
    cp[i].x = mix(cp[0].x, cp[i].x, cs);
    float tight = 1.0 - uShrink * 0.5 * float(i - 1) / 3.0 * pitch;
    cp[i].y = cp[0].y + (cp[i].y - cp[0].y) * cs * tight;
  }
  if (lipFall > 0.0) {
    float f = min(lipFall, 0.85) * (1.0 - foam);
    float W[6] = float[6](0.0, 0.4, 0.65, 0.85, 1.0, 0.55);
    for (int i = 1; i <= 5; i++) {
      cp[i].y -= W[i] * f;
      cp[i].x += W[i] * f * 0.22;
    }
  }
}

// centripetal knots; returns s-fraction of CP4 (the lip tip)
float wFoldKnots(vec2 cp[NB], out float t[8]) {
  t[0] = 0.0;
  for (int i = 0; i < 7; i++) {
    float d = length(cp[i + 1] - cp[i]);
    t[i + 1] = t[i] + pow(d + 1e-6, 0.5);
  }
  return t[4] / t[7];
}

vec2 wFoldEval(vec2 cp[NB], float s) {
  float t[8];
  wFoldKnots(cp, t);
  float tt = t[7] * wsClamp(s, 0.0, 1.0);
  int i1 = 0;
  for (int i = 0; i < 6; i++) if (t[i + 1] < tt) i1 = i + 1;
  i1 = min(i1, 6);
  float u = (tt - t[i1]) / max(t[i1 + 1] - t[i1], 1e-9);
  #define CG(idx) cp[clamp(idx, 0, NB-1)]
  vec2 p0 = CG(i1 - 1), p1 = CG(i1), p2 = CG(i1 + 1), p3 = CG(i1 + 2);
  float dt01 = max(length(p1 - p0), 1e-6);
  float dt12 = max(length(p2 - p1), 1e-6);
  float dt23 = max(length(p3 - p2), 1e-6);
  vec2 m1 = (p1 - p0) / dt01 - (p2 - p0) / (dt01 + dt12) + (p2 - p1) / dt12;
  vec2 m2 = (p2 - p1) / dt12 - (p3 - p1) / (dt12 + dt23) + (p3 - p2) / dt23;
  float u2 = u * u, u3 = u2 * u;
  float h00 = 2.0 * u3 - 3.0 * u2 + 1.0, h10 = u3 - 2.0 * u2 + u;
  float h01 = -2.0 * u3 + 3.0 * u2, h11 = u3 - u2;
  return h00 * p1 + h10 * dt12 * m1 + h01 * p2 + h11 * dt12 * m2;
}

float wBackY(float X, float spineX, float spineY, float Hf) {
  float d = abs(spineX - X) / max(Hf, 0.1);
  return spineY * wsSech2(0.78 * d);
}

float wPileY(float X, float Hf, float soupH) {
  float xn = X / max(Hf, 0.1);
  float u = (xn + 0.15) / 0.60;
  if (u <= 0.0 || u >= 1.0) return 0.0;
  float mound = sin(3.14159265 * pow(u, 0.8));
  return soupH * mound * (1.0 - 0.35 * xn);
}

float wSwell(float Xw, float z, float t) {
  return 0.10 * sin(Xw * 0.11 + t * 0.9 + z * 0.03)
       + 0.06 * sin(Xw * 0.075 - t * 0.55 + z * 0.055 + 2.1)
       + 0.035 * sin((Xw + z) * 0.19 + t * 1.3);
}
float wDip(float X, float Wf, float Hf) {
  float u = X - Wf;
  if (u <= 0.3) return 0.0;
  float win = wsSmooth(0.3, 2.2, u) * (1.0 - wsSmooth(3.5, 10.0, u));
  return -0.10 * Hf * win;
}

// ---- segments of the sheet strip ----
#define SEG_FLATF 0
#define SEG_FACE  1
#define SEG_ROLLO 2
#define SEG_ROLLI 3
#define SEG_BACK  4
#define SEG_FLATB 5

//  Map (seg, t, z, time) -> local (X, y).  t is the row param in [0,1] of seg.
vec2 wProfileLocal(int seg, float t, float z, float time) {
  float b, pitch, foam, soupK, Hf, Wf;
  wFaceGeom(z, time, b, pitch, foam, soupK, Hf, Wf);
  float X = 0.0, y = 0.0;
  if (seg == SEG_FLATF) {
    float xShoreLoc = uXShore - wCrestX(z, time);
    X = wsLerp(Wf, xShoreLoc, pow(wsClamp(t, 0.0, 1.0), 1.55));
    y = wDip(X, Wf, Hf);
  } else if (seg == SEG_FACE) {
    float w = 1.0 - pow(1.0 - wsClamp(t, 0.0, 1.0), 1.45);   // rows cluster at the top
    X = Wf * (1.0 - w);
    y = wFaceY(X, Hf, Wf);
  } else if (seg == SEG_ROLLO || seg == SEG_ROLLI) {
    vec2 cp[NB];
    wFoldCP(pitch, wLipFall(b), foam, Hf, soupK, cp);
    float tSplit[8];
    float sTip = wFoldKnots(cp, tSplit);          // fold param of the lip tip
    float s;
    if (seg == SEG_ROLLO) s = wsLerp(0.0, sTip, t);
    else                  s = wsLerp(sTip, 1.0, t);
    vec2 P = wFoldEval(cp, s);
    X = P.x; y = P.y;
    // the foam pile must always drape ON TOP of the face (no buried skirt)
    if (foam > 0.0 && X > 0.0) {
      y = max(y, wFaceY(X, Hf, Wf) * (1.0 - foam * 0.22) + 0.03 * Hf);
    }
  } else if (seg == SEG_BACK) {
    vec2 cp[NB];
    wFoldCP(pitch, wLipFall(b), foam, Hf, soupK, cp);
    float sX = cp[7].x, sY = cp[7].y;
    X = wsLerp(sX, -3.6 * Hf, pow(wsClamp(t, 0.0, 1.0), 1.25));
    y = wBackY(X, sX, sY, Hf);
  } else { // SEG_FLATB
    float tb = wsClamp(t, 0.0, 1.0);
    X = -3.6 * Hf - pow(tb, 1.7) * 300.0;
    vec2 cp[NB];
    wFoldCP(pitch, wLipFall(b), foam, Hf, soupK, cp);
    y = wBackY(X, cp[7].x, cp[7].y, Hf);
  }
  return vec2(X, y);
}

//  Full world-space sheet point (before chop/noise detail).
vec3 wSheetPoint(int seg, float t, float z, float time) {
  vec2 P = wProfileLocal(seg, t, z, time);
  float cx = wCrestX(z, time);
  float Xw = cx + P.x;
  float y = P.y;
  // ambient swell on flats / back, dying on the face & fold
  float swellAmt = 1.0;
  if (seg == SEG_FACE) swellAmt = 0.15;
  else if (seg == SEG_ROLLO || seg == SEG_ROLLI) swellAmt = 0.05;
  else if (seg == SEG_BACK) swellAmt = 0.30;
  y += wSwell(Xw, z, time) * swellAmt;
  // front flats also carry the foam pile skirt & face soup overlap handled via fold
  return vec3(Xw, y, z);
}
`;
