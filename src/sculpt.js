/* SDF sculpting: density brushes (raise/lower/smooth/flatten/terrace) and CSG
 * primitive stamps (union/subtract a blob). Every stroke edits distances
 * directly, recomputes the solid fraction, then the Eikonal repair keeps the
 * field a valid signed-distance volume — overhangs and caves included.
 *
 * Tools:
 *   1 raise        2 lower/carve     3 smooth
 *   4 flatten      5 terrace         6 add blob (CSG union)
 *   7 cut blob (CSG subtract)
 */
import { glslHeader, fullscreenVertex, ATLAS_W, ATLAS_H } from "./volume.js";
import { program, drawFullscreen, bindTarget } from "./gl.js";

const sculptFragment =
  glslHeader +
  `
uniform sampler2D terrain;
uniform vec4 brush;      // xyz center, w radius
uniform vec4 params;     // strength (per-frame), falloff, flattenHeight, terraceStep
uniform int tool;
layout(location = 0) out vec4 outTerrain;

void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  ivec3 q = voxelAt(uv);
  vec4 v = texelFetch(terrain, uv, 0);
  vec3 p = worldAt(q);

  float dist = distance(p, brush.xyz);
  float r = brush.w;
  if (dist > r) { outTerrain = v; return; }

  // falloff-shaped brush weight, 1 at center → 0 at rim
  float fo = clamp(params.y, 0., .98);
  float inner = r * fo;
  float k = 1. - smoothstep(inner, r, dist);
  float s = params.x;
  float d = v.r;

  if (tool == 1) {
    d -= s * k;                                   // raise ground
  } else if (tool == 2) {
    d += s * k;                                   // carve
  } else if (tool == 3) {                         // smooth toward local average
    float avg = (voxel(terrain, q + ivec3(1,0,0)).r + voxel(terrain, q - ivec3(1,0,0)).r +
                 voxel(terrain, q + ivec3(0,1,0)).r + voxel(terrain, q - ivec3(0,1,0)).r +
                 voxel(terrain, q + ivec3(0,0,1)).r + voxel(terrain, q - ivec3(0,0,1)).r) / 6.;
    d = mix(d, avg, clamp(s * 4., 0., .85) * k);
  } else if (tool == 4) {                         // flatten toward a plane
    float plane = p.y - params.z;
    d = mix(d, clamp(plane, -BAND, BAND), clamp(s * 3., 0., .9) * k);
  } else if (tool == 5) {                         // terrace
    float stepH = max(params.w, .4);
    float terr = floor(p.y / stepH + .5) * stepH;
    float plane = p.y - terr;
    d = mix(d, clamp(plane, -BAND, BAND), clamp(s * 3., 0., .9) * k);
  } else if (tool == 6 || tool == 7) {            // CSG blob stamp
    float blobR = r * .62;
    float wob = 1. + .22 * (vnoise(p * 2.1 + brush.xyz) - .5);
    float sphere = length(p - brush.xyz) - blobR * wob;
    if (tool == 6) d = mix(d, min(d, sphere), clamp(s * 4., 0., 1.) * k);
    else           d = mix(d, max(d, -sphere), clamp(s * 4., 0., 1.) * k);
  }

  d = clamp(d, -BAND, BAND);
  float newSolid = solidOf(d);

  // hardness response: freshly exposed rock hardens (armoring), freshly
  // deposited material is soft — this feeds back into particle erosion.
  float g = v.g;
  if (newSolid < v.a - .0004) g = clamp(g + .05 * s, .05, .95);      // cut → harden
  else if (newSolid > v.a + .0004) g = clamp(mix(g, .3, .35 * k), .05, .95); // fill → soften

  outTerrain = vec4(d, g, v.b, newSolid);
}`;

export class Sculptor {
  constructor(gl, volumePP, repair) {
    this.gl = gl;
    this.volumePP = volumePP;
    this.repair = repair;
    this.prog = program(gl, fullscreenVertex, sculptFragment, "sculpt");
  }

  /** Apply one stroke dab at world position. Returns true if volume changed. */
  dab(pos, tool, radius, strength, falloff, flattenY, dt) {
    if (tool <= 0 || tool > 7) return false;
    const gl = this.gl;
    const perFrame = strength * Math.min(dt, 0.05) * (tool >= 6 ? 6 : 14);
    bindTarget(gl, this.volumePP.dst());
    gl.useProgram(this.prog.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.volumePP.src().textures[0]);
    gl.uniform1i(this.prog.u("terrain"), 0);
    gl.uniform4f(this.prog.u("brush"), pos[0], pos[1], pos[2], radius);
    gl.uniform4f(this.prog.u("params"), perFrame, falloff, flattenY, Math.max(0.5, radius * 0.35));
    gl.uniform1i(this.prog.u("tool"), tool);
    drawFullscreen(gl, this.prog, ATLAS_W, ATLAS_H);
    this.volumePP.swap();
    this.repair.repair(this.volumePP, 1);
    return true;
  }
}
