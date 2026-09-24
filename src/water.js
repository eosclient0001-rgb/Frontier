// ============================================================================
//  water.js — the wave sheet renderer.
//  One static (seg, t, v) grid; the whole breaking wave is displaced in the
//  vertex shader from waveshape.js closed-form math (identical to the JS the
//  physics uses). Fragment: fresnel sky, depth color, sun glitter, lip SSS,
//  procedural foam. No textures, no post-FBO — cheap on purpose.
// ============================================================================

import { compileProgram, createMesh, drawMesh } from './gl.js';
import { WAVE_GLSL } from './waveshape.js';
import { SKY_GLSL } from './sky.js';

// grid layout — row counts per segment (u density where it matters)
const ROWS = [
  ['FLATF', 22], ['FACE', 30], ['ROLLO', 14], ['ROLLI', 12], ['BACK', 18], ['FLATB', 20],
];
export const SEG_ID = { FLATF: 0, FACE: 1, ROLLO: 2, ROLLI: 3, BACK: 4, FLATB: 5 };
const COLS = 320;

const CHUNK_COMMON = /* glsl */`
${WAVE_GLSL}
uniform mat4 uVP;
uniform float uZRef;
// z-column clustering toward the pocket (zRef), asymmetric span
float mapZ(float v) {
  float p = clamp(v, 0.0, 1.0) * 2.0 - 1.0;
  float A = (p < 0.0) ? 145.0 : 80.0;
  return uZRef + A * sinh(2.2 * p) / sinh(2.2);
}
`;

export const WATER_VS = `#version 300 es
precision highp float;
uniform float uTime;
layout(location = 0) in float aSeg;
layout(location = 1) in float aT;
layout(location = 2) in float aV;
${CHUNK_COMMON}

// small chop: keeps big flat areas from looking like glass tiles
vec3 chopDisplace(vec3 P, float z, int seg) {
  float flatness = (seg == SEG_FLATF || seg == SEG_FLATB) ? 1.0 :
                   (seg == SEG_FACE) ? 0.12 : 0.05;
  float a = 0.05 * flatness;
  float w1 = sin(P.x * 1.7 + uTime * 1.1) * sin(z * 1.3 - uTime * 0.8);
  float w2 = sin(P.x * 3.3 - uTime * 1.7 + z * 2.2) * 0.6;
  P.y += a * (w1 + w2);
  return P;
}

out vec3 vWorld;
out vec3 vNormal;
out vec4 vData;   // b, foam, pitch, Hf
out vec4 vData2;  // X, Wf, seg, tSeg

void main() {
  int seg = int(aSeg + 0.5);
  float z = mapZ(aV);
  vec3 P  = wSheetPoint(seg, aT, z, uTime);
  vec3 Pt = wSheetPoint(seg, aT + 0.004, z, uTime);
  vec3 Pz = wSheetPoint(seg, aT, z + 0.35, uTime);
  P  = chopDisplace(P, z, seg);
  Pt = chopDisplace(Pt, z, seg);
  Pz = chopDisplace(Pz, z + 0.35, seg);
  vec3 n = normalize(cross(Pz - P, Pt - P));

  vec2 loc = wProfileLocal(seg, aT, z, uTime);
  float b, pitch, foam, soupK, Hf, Wf;
  wFaceGeom(z, uTime, b, pitch, foam, soupK, Hf, Wf);

  vWorld = P;
  vNormal = n;
  vData = vec4(b, foam, pitch, Hf);
  vData2 = vec4(loc.x, Wf, float(seg), aT);
  gl_Position = uVP * vec4(P, 1.0);
}
`;

export const WATER_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vData;
in vec4 vData2;
out vec4 fragColor;

uniform vec3 uCamPos;

${CHUNK_COMMON}
${SKY_GLSL}

float vnoise(vec2 p) {
  return skyNoise(p);
}
float vfbm(vec2 p) {
  return skyFbm(p);
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = uSunDir;
  float b = vData.x, foam = vData.y, pitch = vData.z, Hf = vData.w;
  float X = vData2.x, Wf = vData2.y, seg = vData2.z, tSeg = vData2.w;

  // ---- micro normal detail (wind chop / glassy face) ----
  float detScale = (seg < 0.5 || seg > 4.5) ? 1.0 : (seg == 1.0 ? 0.25 : 0.15);
  vec2 duv = vWorld.xz * 2.4 + vec2(uTime * 0.35, -uTime * 0.2);
  float nx = vnoise(duv) - vnoise(duv + vec2(0.35, 0.0));
  float nz = vnoise(duv + vec2(0.0, 0.35)) - vnoise(duv);
  N = normalize(N + vec3(nx, 0.0, nz) * (0.35 * detScale + 0.12 * abs(uWind)));

  // ---- water body color from analytic depth ----
  float depth = max(0.0, uXShore - vWorld.x) * uSandSlope;
  vec3 shallowCol = vec3(0.11, 0.62, 0.60);
  vec3 deepCol    = vec3(0.02, 0.16, 0.30);
  vec3 body = mix(shallowCol, deepCol, smoothstep(0.25, 5.0, depth));

  // ---- fresnel sky reflection ----
  float ndv = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 refl = skyColor(reflect(-V, N));
  vec3 col = mix(body, refl, F);

  // ---- sun glitter (blinn on the perturbed normal) ----
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0) * 2.2;
  float glit = pow(max(dot(N, H), 0.0), 28.0) * 0.12;
  col += vec3(1.0, 0.93, 0.75) * (spec + glit);

  // ---- fake subsurface: sunlight blasting through the thin lip / face top ----
  float thinMask = (seg > 1.5 && seg < 3.5) ? 1.0 :
                   (seg == 1.0) ? clamp(vData2.w * 1.3, 0.15, 0.95) * 0.85 : 0.0;
  float backlit = pow(max(dot(V, -normalize(L + N * 0.35)), 0.0), 3.0);
  float faceUp = smoothstep(0.45, 0.95, (Hf > 0.01) ? (1.0 - clamp(X / max(Wf, 0.01), 0.0, 1.0)) : 0.0);
  vec3 sss = vec3(0.30, 0.95, 0.55) * backlit * (thinMask * 0.9 + faceUp * 0.35) * (0.35 + 0.65 * smoothstep(0.0, 0.6, pitch));
  col += sss * (0.5 + 0.5 * ndv);

  // ---- foam ----
  float soup = smoothstep(0.8, 1.3, b);
  float climb = smoothstep(0.9, 2.1, b);
  float hFace = 1.0 - clamp(X / max(Wf, 0.01), 0.0, 1.0);   // 0 bottom .. 1 top

  //  domain-warped fbm — churn on the soup, fine bubbles on the face
  vec2 fuv = vWorld.xz * vec2(0.9, 0.55);
  fuv += vec2(uTime * 0.25, uTime * 0.5);                    // foam drifts with the peel
  float churn = vfbm(fuv * 2.2 + vfbm(fuv) * 1.3);
  float bubbles = vnoise(vWorld.xz * 9.0 - uTime * vec2(0.7, 1.3));

  float fm = 0.0;
  //  whitewash climbing the face after the lip lands
  float climbEdge = smoothstep(hFace, hFace + 0.28, climb * 1.05);
  if (seg == 1.0) fm = max(fm, climbEdge * soup);
  //  whole soup field (crest zone, back, and the wash on the flats)
  if (b > 0.95) {
    float soupZone = (seg == 2.0 || seg == 3.0) ? 1.0 :
                     (seg == 4.0) ? 0.85 : (seg == 0.0 ? 0.35 * soup : 0.0);
    if (seg == 1.0) soupZone = max(soupZone, climbEdge);
    fm = max(fm, soupZone * soup);
  }
  //  aerated lip itself (always foamy white when pitching or thrown)
  if (seg == 2.0 || seg == 3.0) {
    float lipFoam = 0.35 + 0.65 * max(pitch, foam);
    if (seg == 2.0) lipFoam *= 0.45 + 0.55 * smoothstep(0.25, 0.9, tSeg);  // denser toward the tip
    fm = max(fm, lipFoam * (0.55 + 0.45 * churn));
  }
  //  feathering off an offshore-blown unbroken crest
  if (seg == 2.0 && pitch < 0.3) {
    fm = max(fm, 0.30 * max(0.0, -uWind) * smoothstep(0.5, 1.0, tSeg));
  }
  //  shorebreak band at the waterline + wash up the sand
  if (seg == 0.0) {
    float xShoreLoc = uXShore - wCrestX(vWorld.z, uTime);
    float dshore = abs(X - xShoreLoc);
    fm = max(fm, smoothstep(3.5, 0.4, dshore) * (0.55 + 0.45 * churn));
  }
  //  drawdown foam streaks on the open face (thin wind streaks, subtle)
  if (seg == 1.0) {
    float streak = smoothstep(0.6, 0.95, vnoise(vec2(vWorld.z * 0.25, vWorld.x * 3.0 + uTime * 0.6)));
    fm = max(fm, streak * 0.12 * (1.0 - soup));
  }

  // texture & shade the foam
  fm = clamp(fm * (0.55 + 0.65 * churn) + bubbles * 0.18 * soup, 0.0, 1.0);
  fm *= smoothstep(0.0, 0.15, fm); // keep soft edges out of the alpha trick below
  if (fm > 0.001) {
    float shade = 0.75 + 0.35 * bubbles + 0.2 * max(dot(N, L), 0.0);
    vec3 foamCol = vec3(0.93, 0.96, 0.98) * shade;
    foamCol += vec3(1.0, 0.85, 0.6) * pow(max(dot(N, H), 0.0), 60.0) * 0.5;
    col = mix(col, foamCol, fm);
  }

  // ---- distance fog to the horizon haze ----
  float dist = length(uCamPos - vWorld);
  vec3 fogc = skyColor(normalize(vec3(vWorld.x - uCamPos.x, 0.0, vWorld.z - uCamPos.z)));
  col = mix(col, fogc, smoothstep(70.0, 320.0, dist));

  fragColor = vec4(col, 1.0);
}
`;

export class Water {
  constructor(gl) {
    this.gl = gl;
    this.prog = compileProgram(gl, WATER_VS, WATER_FS, 'water');

    // ---- build the static (seg,t,v) grid ----
    const segCount = ROWS.reduce((s, r) => s + r[1], 0);
    const verts = new Float32Array(segCount * COLS * 3);
    const idx = new Uint32Array((segCount - ROWS.length) * (COLS - 1) * 6);
    let vi = 0, ii = 0;
    const rowStart = [];
    let row = 0;
    for (const [name, nRows] of ROWS) {
      rowStart.push({ seg: SEG_ID[name], row0: row, nRows });
      for (let r = 0; r < nRows; r++) {
        const t = nRows === 1 ? 0 : r / (nRows - 1);
        for (let j = 0; j < COLS; j++) {
          const v = j / (COLS - 1);
          verts[vi++] = SEG_ID[name];
          verts[vi++] = t;
          verts[vi++] = v;
        }
      }
      row += nRows;
    }
    // indices: stitch within each segment only (edges butt-join; the profile
    // function is continuous across segments so no cracks)
    row = 0;
    for (const [name, nRows] of ROWS) {
      for (let r = 0; r < nRows - 1; r++) {
        for (let j = 0; j < COLS - 1; j++) {
          const a = (row + r) * COLS + j;
          const b = a + 1;
          const c = a + COLS;
          const d = c + 1;
          idx[ii++] = a; idx[ii++] = b; idx[ii++] = c;
          idx[ii++] = b; idx[ii++] = d; idx[ii++] = c;
        }
      }
      row += nRows;
    }
    this.mesh = createMesh(gl, {
      vertices: verts,
      indices: idx.subarray(0, ii),
      attributes: [
        { name: 'aSeg', size: 1, offset: 0, loc: 0 },
        { name: 'aT', size: 1, offset: 1, loc: 1 },
        { name: 'aV', size: 1, offset: 2, loc: 2 },
      ],
    });
  }

  draw(cam, params) {
    const gl = this.gl;
    gl.useProgram(this.prog.prog);
    gl.uniformMatrix4fv(this.prog.uniforms.uVP, false, cam.vp);
    gl.uniform3fv(this.prog.uniforms.uCamPos, cam.pos);
    gl.uniform1f(this.prog.uniforms.uTime, params.time);
    gl.uniform1f(this.prog.uniforms.uZRef, params.zRef);
    gl.uniform1f(this.prog.uniforms.uXShore, params.p.xShore);
    gl.uniform1f(this.prog.uniforms.uSandSlope, params.p.sandSlope);
    gl.uniform1f(this.prog.uniforms.uH, params.p.H);
    gl.uniform1f(this.prog.uniforms.uC, params.p.c);
    gl.uniform1f(this.prog.uniforms.uVPeel, params.p.vPeel);
    gl.uniform1f(this.prog.uniforms.uTBreak, params.p.TBreak);
    gl.uniform1f(this.prog.uniforms.uXC0, params.p.xC0);
    gl.uniform1f(this.prog.uniforms.uXClose, params.p.xClose);
    gl.uniform1f(this.prog.uniforms.uZPeel0, params.p.zPeel0);
    gl.uniform1f(this.prog.uniforms.uZLineEnd, params.p.zLineEnd);
    gl.uniform1f(this.prog.uniforms.uTaperLen, params.p.taperLen);
    gl.uniform1f(this.prog.uniforms.uWander, params.p.wanderAmp);
    gl.uniform1f(this.prog.uniforms.uCurlR, params.p.curlR);
    gl.uniform1f(this.prog.uniforms.uShrink, params.p.shrink);
    gl.uniform1f(this.prog.uniforms.uFaceAspect, params.p.faceAspect);
    gl.uniform1f(this.prog.uniforms.uWind, params.p.wind);
    gl.uniform1f(this.prog.uniforms.uSunAz, params.p.sunAz);
    gl.uniform1f(this.prog.uniforms.uSunEl, params.p.sunEl);
    gl.uniform3fv(this.prog.uniforms.uSunDir, cam.sunDir);
    gl.disable(gl.CULL_FACE);
    drawMesh(gl, this.mesh);
  }
}
