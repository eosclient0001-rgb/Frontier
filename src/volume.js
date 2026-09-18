/* The terrain is a true 3D signed-distance volume stored as a 2D texture
 * atlas of Z slices (16 tiles per row). Channels:
 *   r — signed distance (negative inside rock), clamped to the narrow band
 *   g — hardness/armoring (freshly cut rock hardens; sediment softens)
 *   b — moisture (wet trails darken and aid detachment)
 *   a — solid fraction, the authoritative storage:  a = 0.5 − d/(2·BAND)
 *
 * All simulation passes edit `a` (mass) and derive `d` from it; a banded
 * Eikonal solver then re-normalizes distances. That split is what keeps
 * sculpting and erosion mass-conserving while the field stays a valid SDF.
 */

export const DIM = [128, 64, 128];
export const ATLAS_COLS = 16;
export const TILE = [DIM[0], DIM[1]];
export const ATLAS_W = TILE[0] * ATLAS_COLS; // 2048
export const ATLAS_H = TILE[1] * Math.ceil(DIM[2] / ATLAS_COLS); // 512
export const LO = [-24, -4, -24];
export const HI = [24, 20, 24];
export const CELL = [(HI[0] - LO[0]) / DIM[0], (HI[1] - LO[1]) / DIM[1], (HI[2] - LO[2]) / DIM[2]];
export const BAND = 0.45; // narrow-band half width, slightly above one voxel
export const VOXEL_VOLUME = CELL[0] * CELL[1] * CELL[2];

/* Shared GLSL preamble: atlas addressing + trilinear sampling + SDF helpers. */
export const atlasGLSL = `
const ivec3 DIM = ivec3(${DIM[0]}, ${DIM[1]}, ${DIM[2]});
const vec3 LO = vec3(${LO.join(",")}.), HI = vec3(${HI.join(",")}.);
const vec3 CELL = (HI - LO) / vec3(DIM);
const ivec2 ATLAS = ivec2(${ATLAS_W}, ${ATLAS_H});
const float BAND = ${BAND};
const float VOX = ${(CELL[0] * CELL[1] * CELL[2]).toFixed(9)};

ivec2 address(ivec3 q) {
  q = clamp(q, ivec3(0), DIM - 1);
  return ivec2((q.z % ${ATLAS_COLS}) * ${TILE[0]} + q.x, (q.z / ${ATLAS_COLS}) * ${TILE[1]} + q.y);
}
ivec3 voxelAt(ivec2 uv) {
  ivec2 tile = uv / ivec2(${TILE[0]}, ${TILE[1]});
  return ivec3(uv.x % ${TILE[0]}, uv.y % ${TILE[1]}, tile.y * ${ATLAS_COLS} + tile.x);
}
vec3 worldAt(ivec3 q) { return LO + (vec3(q) + .5) * CELL; }

vec4 voxel(sampler2D tex, ivec3 q) { return texelFetch(tex, address(q), 0); }

vec4 atlasSample(sampler2D tex, vec3 p) {
  vec3 q = clamp((p - LO) / CELL - .5, vec3(0), vec3(DIM) - 1.001);
  ivec3 i = ivec3(floor(q));
  vec3 f = q - vec3(i);
  vec4 c000 = voxel(tex, i);
  vec4 c100 = voxel(tex, i + ivec3(1, 0, 0));
  vec4 c010 = voxel(tex, i + ivec3(0, 1, 0));
  vec4 c110 = voxel(tex, i + ivec3(1, 1, 0));
  vec4 c001 = voxel(tex, i + ivec3(0, 0, 1));
  vec4 c101 = voxel(tex, i + ivec3(1, 0, 1));
  vec4 c011 = voxel(tex, i + ivec3(0, 1, 1));
  vec4 c111 = voxel(tex, i + ivec3(1, 1, 1));
  return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
             mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}

/* Distance including the volume's bounding box, so rays can march in air. */
float sdf(sampler2D tex, vec3 p) {
  float outside = length(max(max(LO - p, p - HI), vec3(0)));
  return atlasSample(tex, p).r + outside;
}

vec3 fieldGrad(sampler2D tex, vec3 p, float e) {
  return vec3(
    atlasSample(tex, p + vec3(e, 0, 0)).r - atlasSample(tex, p - vec3(e, 0, 0)).r,
    atlasSample(tex, p + vec3(0, e, 0)).r - atlasSample(tex, p - vec3(0, e, 0)).r,
    atlasSample(tex, p + vec3(0, 0, e)).r - atlasSample(tex, p - vec3(0, 0, e)).r);
}

vec3 surfaceNormal(sampler2D tex, vec3 p) {
  vec3 g = fieldGrad(tex, p, .15);
  float len = length(g);
  return len > 1e-7 ? g / len : vec3(0, 1, 0);
}

float solidOf(float d) { return clamp(.5 - d / (2. * BAND), 0., 1.); }
float distOf(float a) { return BAND * (1. - 2. * a); }

/* Compact smooth kernel for particle splats. */
float kernel(vec3 p, vec3 c, float r) {
  float a = max(0., 1. - length(p - c) / r);
  return a * a;
}

/* Hash/value noise used by generation and detail passes. */
float hash3(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
        mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
        mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;

export const fullscreenVertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

export const glslHeader = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
`;
