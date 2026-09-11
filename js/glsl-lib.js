// Frontier SDF — volume constants + shared GLSL (volume atlas, noise, SDF prims).
// The terrain is a bounded 3D signed-distance volume (negative = solid rock),
// stored as a 2D atlas so WebGL2 fragment passes can read AND write it.
// This is what gives real caves, overhangs and cliffs — no heightmap anywhere.

export const SIZE = [128, 80, 128];
export const MIN = [-24, -6, -22];
export const MAX = [24, 20, 22];
export const CELL = SIZE.map((n, i) => (MAX[i] - MIN[i]) / n); // [0.375, 0.325, 0.34375]
export const VOXEL = CELL[0] * CELL[1] * CELL[2];
export const FACE = Math.pow(VOXEL, 2 / 3);
export const BAND = 3.0; // SDF clamp band (world units)
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 16;
export const ATLAS_W = SIZE[0] * ATLAS_COLS; // 1024
export const ATLAS_H = SIZE[1] * ATLAS_ROWS; // 1280
export const PMAX = 4096; // particle slots (64x64)
export const PSIZE = 64;

// Volume texel layout: R = signed distance, G = deposited sediment (mass/voxel),
// B = wetness 0..1, A = coarse/gravel fraction of deposit.

export const SIM_HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
const ivec3 DIM = ivec3(128, 80, 128);
const vec3 VMIN = vec3(-24.0, -6.0, -22.0);
const vec3 VMAX = vec3(24.0, 20.0, 22.0);
const vec3 CELLV = vec3(0.375, 0.325, 0.34375);
const vec2 ATLAS = vec2(1024.0, 1280.0);
const float VOXELV = 0.0418945;
const float FACEV = 0.1208;
const float BANDV = 3.0;
const float PIV = 3.14159265;
vec2 atlasPix(ivec3 v) {
  v = clamp(v, ivec3(0), DIM - ivec3(1));
  return vec2(float(v.z - 8 * (v.z / 8)) * 128.0 + float(v.x), float(v.z / 8) * 80.0 + float(v.y));
}
vec4 voxelFetch(sampler2D t, ivec3 v) { return texelFetch(t, ivec2(atlasPix(v)), 0); }
vec3 worldAt(ivec3 v) { return VMIN + (vec3(v) + 0.5) * CELLV; }
vec4 volSample(sampler2D t, vec3 p) {
  vec3 g = (p - VMIN) / CELLV - 0.5;
  ivec3 i0 = clamp(ivec3(floor(g)), ivec3(0), DIM - 2);
  vec3 f = clamp(g - vec3(i0), vec3(0.0), vec3(1.0));
#ifdef LINEAR
  vec2 px0 = vec2(float(i0.z - 8 * (i0.z / 8)) * 128.0, float(i0.z / 8) * 80.0) + vec2(i0.xy) + vec2(0.5) + f.xy;
  int z1 = min(i0.z + 1, 127);
  vec2 px1 = vec2(float(z1 - 8 * (z1 / 8)) * 128.0, float(z1 / 8) * 80.0) + vec2(i0.xy) + vec2(0.5) + f.xy;
  return mix(texture(t, px0 / ATLAS), texture(t, px1 / ATLAS), f.z);
#else
  vec4 c000 = voxelFetch(t, i0); vec4 c100 = voxelFetch(t, i0 + ivec3(1, 0, 0));
  vec4 c010 = voxelFetch(t, i0 + ivec3(0, 1, 0)); vec4 c110 = voxelFetch(t, i0 + ivec3(1, 1, 0));
  vec4 c001 = voxelFetch(t, i0 + ivec3(0, 0, 1)); vec4 c101 = voxelFetch(t, i0 + ivec3(1, 0, 1));
  vec4 c011 = voxelFetch(t, i0 + ivec3(0, 1, 1)); vec4 c111 = voxelFetch(t, i0 + ivec3(1, 1, 1));
  return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
             mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
#endif
}
float volSDF(sampler2D t, vec3 p) { return volSample(t, p).x; }
vec3 volNormal(sampler2D t, vec3 p) {
  float e = 0.14;
  vec3 g = vec3(volSDF(t, p + vec3(e, 0.0, 0.0)) - volSDF(t, p - vec3(e, 0.0, 0.0)),
                volSDF(t, p + vec3(0.0, e, 0.0)) - volSDF(t, p - vec3(0.0, e, 0.0)),
                volSDF(t, p + vec3(0.0, 0.0, e)) - volSDF(t, p - vec3(0.0, 0.0, e)));
  float l = length(g);
  return l > 1e-4 ? g / l : vec3(0.0, 1.0, 0.0);
}
float kern(vec3 c, vec3 p, float r) {
  vec3 d = (c - p) / max(r, 1e-4);
  float q = dot(d, d);
  if (q >= 1.0) return 0.0;
  q = sqrt(q);
  return (1.0 - q) * (1.0 - q);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const FULLSCREEN_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Seedable value noise + fractal variants for the node compiler.
export const NOISE_GLSL = `
float vhash(vec3 p, float s) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.23, 0.37) * (s + 1.0));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 p, float s) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = vhash(i, s); float n100 = vhash(i + vec3(1, 0, 0), s);
  float n010 = vhash(i + vec3(0, 1, 0), s); float n110 = vhash(i + vec3(1, 1, 0), s);
  float n001 = vhash(i + vec3(0, 0, 1), s); float n101 = vhash(i + vec3(1, 0, 1), s);
  float n011 = vhash(i + vec3(0, 1, 1), s); float n111 = vhash(i + vec3(1, 1, 1), s);
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbmN(vec3 p, float s, int oct) {
  float a = 0.5; float sum = 0.0; float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    sum += a * vnoise(p, s + float(i) * 13.7); norm += a; a *= 0.5;
    p = p * 2.03 + vec3(11.3, 7.1, 5.7);
  }
  return sum / max(norm, 1e-4);
}
float ridgedN(vec3 p, float s, int oct) {
  float a = 0.5; float sum = 0.0; float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    sum += a * (1.0 - abs(vnoise(p, s + float(i) * 13.7) * 2.0 - 1.0)); norm += a; a *= 0.5;
    p = p * 2.11 + vec3(3.1, 9.7, 5.3);
  }
  return sum / max(norm, 1e-4);
}
float billowN(vec3 p, float s, int oct) {
  float a = 0.5; float sum = 0.0; float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    sum += a * abs(vnoise(p, s + float(i) * 13.7) * 2.0 - 1.0); norm += a; a *= 0.5;
    p = p * 2.07 + vec3(7.7, 3.9, 9.1);
  }
  return sum / max(norm, 1e-4);
}
`;

export const SDFLIB_GLSL = `
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdTorusY(vec3 p, float R, float r) { return length(vec2(length(p.xz) - R, p.y)) - r; }
float sdTorusZ(vec3 p, float R, float r) { return length(vec2(length(p.xy) - R, p.z)) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a; vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdCylinder(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h * 0.5);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float opBlend(float a, float b, float k) {
  if (k <= 0.001) return min(a, b);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float opBlendSub(float a, float b, float k) {
  if (k <= 0.001) return max(a, -b);
  float h = clamp(0.5 - 0.5 * (b + a) / k, 0.0, 1.0);
  return mix(a, -b, h) + k * h * (1.0 - h);
}
float opBlendInt(float a, float b, float k) {
  if (k <= 0.001) return max(a, b);
  float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}
`;
