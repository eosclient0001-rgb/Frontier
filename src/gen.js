/* Terrain generation (analytic multifractal heightfield → SDF) and the
 * banded Eikonal repair passes that keep the volume a valid distance field
 * after every sculpt/erosion edit.
 */
import { glslHeader, fullscreenVertex, ATLAS_W, ATLAS_H } from "./volume.js";
import { program, drawFullscreen, bindTarget } from "./gl.js";

const noiseLib = `
float fbm2(vec2 p, float s, int oct, float gain) {
  float a = .5, sum = 0., norm = 0.;
  vec3 q = vec3(p, s * .0173);
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    sum += a * vnoise(q);
    norm += a;
    a *= gain;
    q = q * 2.03 + vec3(11.31, 7.77, 3.7);
  }
  return sum / norm;
}
float ridged2(vec2 p, float s, int oct) {
  float a = .5, sum = 0., norm = 0.;
  vec3 q = vec3(p, s * .0211 + 4.4);
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    float v = 1. - abs(2. * vnoise(q) - 1.);
    sum += a * v * v;
    norm += a;
    a *= .52;
    q = q * 2.11 + vec3(5.1, 9.3, 2.2);
  }
  return sum / norm;
}
`;

/* Base surface height h(x,z) per preset. Presets:
 * 0 canyon mesas · 1 badlands · 2 alpine ridges · 3 volcanic cone · 4 coastal dunes
 */
const heightLib = `
uniform vec4 gen; // seed, relief, roughness, mode

float heightAt(vec2 xz) {
  float s = gen.x;
  float relief = gen.y, rough = gen.z, mode = gen.w;
  vec2 p = xz * .082;
  // domain warp — organic, non-radial forms
  float w1 = vnoise(vec3(p * 1.9, s * .013));
  float w2 = vnoise(vec3(p * 1.9 + 5.2, s * .013));
  vec2 q = p + (vec2(w1, w2) - .5) * (.35 + .8 * rough);
  float rad = length(xz) / 30.;
  float base = 0., detail = 0.;

  if (mode < .5) {
    // Canyon mesas: flat-topped plateaus cut by winding canyons.
    float plateau = smoothstep(.38, .72, fbm2(q * .75 + s * .001, s, 5, .55));
    base = 1.6 + 8.8 * plateau;
    float canyon = ridged2(q * 1.35, s, 4);
    base -= 7.8 * pow(smoothstep(.05, .62, canyon), 1.7);
    float side = smoothstep(.2, .8, fbm2(q * 2.2 + 3.1, s, 4, .5));
    base += 1.4 * side * plateau;
    detail = fbm2(q * 4.2, s, 4, .5) - .5;
  } else if (mode < 1.5) {
    // Badlands: soft hills shredded by dense gullies.
    base = 1.4 + 6.4 * pow(fbm2(q * 1.1, s, 6, .52), 1.15);
    float gully = ridged2(q * 2.8, s, 5);
    base -= 2.6 * pow(gully, 2.1) * smoothstep(0., 2.2, base);
    detail = fbm2(q * 5., s, 5, .5) - .5;
  } else if (mode < 2.5) {
    // Alpine: sharp ridged peaks on a broad skirt.
    float ridge = ridged2(q * 1.05, s, 6);
    float mass = 1. - smoothstep(.15, 1.15, rad);
    base = 15.5 * pow(ridge, 1.3) * (.35 + .85 * mass) + 2.2 * fbm2(q * 1.4, s, 4, .5);
    detail = fbm2(q * 3.4, s, 5, .5) - .5;
  } else if (mode < 3.5) {
    // Volcanic cone with radial ravines.
    float cone = max(0., 1.42 - rad * 1.42);
    base = 13.5 * pow(cone, 1.55) + 2.4 * fbm2(q * 1.7, s, 5, .5);
    float ang = atan(xz.y, xz.x);
    float ravine = ridged2(vec2(ang * 2.6, rad * 2.6), s, 4);
    base -= 2.4 * pow(ravine, 3.) * smoothstep(.05, .5, cone);
    base += .8 * smoothstep(.9, 1.35, rad) * fbm2(q * 2.5, s, 4, .5); // rim foothills
    detail = fbm2(q * 4.5, s, 5, .5) - .5;
  } else {
    // Coastal dunes: migrating barchan-like ridges over a shelf.
    float drift = vnoise(vec3(q * .9, s * .01));
    float dune = .5 + .5 * sin((xz.x * .48 + xz.y * .21) * 1.15 + 3.2 * drift);
    float field2 = .5 + .5 * sin((xz.x * .17 - xz.y * .53) * .9 + 2.1 * drift);
    base = .8 + 3.4 * pow(dune, 1.4) * (.45 + .55 * field2);
    base += 1.6 * fbm2(q * 1.3, s, 4, .5);
    base *= smoothstep(-26., -12., xz.y) * .85 + .15; // flatten one side toward water
    detail = fbm2(q * 6., s, 4, .5) - .5;
  }
  return relief * (base + rough * 2.1 * detail);
}
`;

const generateFragment =
  glslHeader +
  noiseLib +
  heightLib +
  `
uniform sampler2D dummy;
layout(location = 0) out vec4 outTerrain;

void main() {
  ivec3 q = voxelAt(ivec2(gl_FragCoord.xy));
  vec3 p = worldAt(q);
  float h = heightAt(p.xz);
  // slope-compensated signed distance for a heightfield
  float e = .65;
  float hx = heightAt(p.xz + vec2(e, 0)) - heightAt(p.xz - vec2(e, 0));
  float hz = heightAt(p.xz + vec2(0, e)) - heightAt(p.xz - vec2(0, e));
  vec2 grad = vec2(hx, hz) / (2. * e);
  float d = (p.y - h) * inversesqrt(1. + dot(grad, grad));
  d = clamp(d, -BAND, BAND);

  // hardness: sedimentary strata + preset-dependent base
  float strata = .5 + .5 * sin(p.y * 2.6 + 1.7 * vnoise(vec3(p * .35 + gen.x * .01)));
  float hard = clamp(.32 + .38 * strata + .12 * (gen.w < 2.5 ? 1. : 0.), .05, .95);

  outTerrain = vec4(d, hard, 0., solidOf(d));
}`;

/* Repair pass 1 — occupancy: rebuild distance from the authoritative solid
 * fraction inside the narrow band. */
const occupancyFragment =
  glslHeader +
  `
uniform sampler2D terrain;
out vec4 outTerrain;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  ivec3 q = voxelAt(uv);
  vec4 v = texelFetch(terrain, uv, 0);
  if (v.a > .00001 && v.a < .99999) v.r = distOf(v.a);
  outTerrain = v;
}`;

/* Repair pass 2 — one Eikonal sweep: propagate exact distances outward from
 * the interface using the isotropic quadratic solution. Run a few times. */
const eikonalFragment =
  glslHeader +
  `
uniform sampler2D terrain;
out vec4 outTerrain;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  ivec3 q = voxelAt(uv);
  vec4 v = texelFetch(terrain, uv, 0);
  if (v.a > .00001 && v.a < .99999) { outTerrain = v; return; } // interface voxel: keep
  float signv = v.a >= .5 ? -1. : 1.;
  float ax = min(abs(voxel(terrain, q - ivec3(1,0,0)).r), abs(voxel(terrain, q + ivec3(1,0,0)).r));
  float ay = min(abs(voxel(terrain, q - ivec3(0,1,0)).r), abs(voxel(terrain, q + ivec3(0,1,0)).r));
  float az = min(abs(voxel(terrain, q - ivec3(0,0,1)).r), abs(voxel(terrain, q + ivec3(0,0,1)).r));
  if (ax > ay) { float t = ax; ax = ay; ay = t; }
  if (ay > az) { float t = ay; ay = az; az = t; }
  if (ax > ay) { float t = ax; ax = ay; ay = t; }
  float h = min(min(CELL.x, CELL.y), CELL.z);
  float t = ax + h;
  if (t > ay) t = .5 * (ax + ay + sqrt(max(0., 2. * h * h - (ax - ay) * (ax - ay))));
  if (t > az) {
    float s = ax + ay + az;
    t = (s + sqrt(max(0., s * s - 3. * (ax * ax + ay * ay + az * az - h * h)))) / 3.;
  }
  t = min(t, BAND * 6.);
  outTerrain = vec4(signv * t, v.g, v.b, v.a);
}`;

export class VolumeRepair {
  constructor(gl) {
    this.gl = gl;
    this.occupancy = program(gl, fullscreenVertex, occupancyFragment, "occupancy");
    this.eikonal = program(gl, fullscreenVertex, eikonalFragment, "eikonal");
  }
  /** @param {{fbo, textures}} target volume ping-pong side to repair in place */
  repair(volumePP, sweeps = 2) {
    const gl = this.gl;
    // occupancy fix (reads src, writes dst, swap)
    bindTarget(gl, volumePP.dst());
    gl.useProgram(this.occupancy.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, volumePP.src().textures[0]);
    gl.uniform1i(this.occupancy.u("terrain"), 0);
    drawFullscreen(gl, this.occupancy, ATLAS_W, ATLAS_H);
    volumePP.swap();
    for (let i = 0; i < sweeps; i++) {
      bindTarget(gl, volumePP.dst());
      gl.useProgram(this.eikonal.handle);
      gl.bindTexture(gl.TEXTURE_2D, volumePP.src().textures[0]);
      gl.uniform1i(this.eikonal.u("terrain"), 0);
      drawFullscreen(gl, this.eikonal, ATLAS_W, ATLAS_H);
      volumePP.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

export class TerrainGenerator {
  constructor(gl, volumePP, soilPP, repair) {
    this.gl = gl;
    this.volumePP = volumePP;
    this.soilPP = soilPP;
    this.repair = repair;
    this.generate = program(gl, fullscreenVertex, generateFragment, "generate");
    this.dummy = (() => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
      return t;
    })();
  }
  run({ seed = 1284, relief = 1, rough = 0.55, mode = 0 } = {}) {
    const gl = this.gl;
    const volDst = this.volumePP.dst();
    bindTarget(gl, volDst);
    gl.useProgram(this.generate.handle);
    gl.uniform4f(this.generate.u("gen"), seed, relief, rough, mode);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dummy);
    gl.uniform1i(this.generate.u("dummy"), 0);
    drawFullscreen(gl, this.generate, ATLAS_W, ATLAS_H);
    // generate wrote volume into volumePP.dst and needs soil reset: second MRT
    // was attached on the same target; both are the dst side of their pairs.
    this.volumePP.swap();
    // soil pair: run the same pass? Soil output was the second attachment of the
    // volume target — so copy it into the soil pair's dst via a blit-free trick:
    // simplest is to re-run with a small clear pass. Instead we generated soil
    // into volumePP.dst().textures[1] only if attached; keep soil in its own pair:
    this.resetSoil();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.repair.repair(this.volumePP, 4);
  }
  resetSoil() {
    const gl = this.gl;
    for (const side of [this.soilPP.a, this.soilPP.b]) {
      bindTarget(gl, side);
      gl.clearColor(1, 0, 0, 0); // full budget, no sediment
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
