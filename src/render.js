/* Ray-marched renderer: the SDF volume IS the render primitive. No mesh is
 * ever extracted or smoothed, so erosion detail survives to the pixel.
 * Includes soft shadows, cone AO, procedural strata/sediment materials,
 * animated water, the sculpt brush gizmo, and a pick pass.
 */
import { glslHeader, fullscreenVertex, ATLAS_W, ATLAS_H } from "./volume.js";
import { program, makeTarget } from "./gl.js";
import { MAX_PARTICLES, PT_W } from "./particles.js";

const renderFragment =
  glslHeader +
  `
uniform sampler2D terrain, soil;
uniform vec4 uEye;      // xyz, fov
uniform vec4 uLook;     // xyz look-at point, spare
uniform vec4 uViewport; // w, h, aspect, time
uniform vec4 uLight;    // sun angle deg, sun height, exposure, grain
uniform vec4 uWater;    // level, show, spare, spare
uniform vec4 uBrush;    // xyz, radius (>0 when shown)
out vec4 outColor;

vec3 sunDir() {
  float a = radians(uLight.x);
  return normalize(vec3(cos(a), uLight.y, sin(a)));
}

vec2 boxRange(vec3 ro, vec3 rd) {
  vec3 safe = sign(rd) * max(abs(rd), vec3(1e-8));
  vec3 a = (LO - ro) / safe, b = (HI - ro) / safe;
  vec3 n = min(a, b), f = max(a, b);
  return vec2(max(max(n.x, n.y), n.z), min(min(f.x, f.y), f.z));
}

float trace(vec3 ro, vec3 rd) {
  vec2 range = boxRange(ro, rd);
  float t = max(0., range.x);
  if (t > range.y) return -1.;
  for (int i = 0; i < 250; i++) {
    float d = sdf(terrain, ro + rd * t);
    if (d < .05) return t;
    t += clamp(d * .75, .03, 1.7);
    if (t > range.y) break;
  }
  return -1.;
}

float shadow(vec3 p, vec3 l) {
  float t = .18, s = 1.;
  for (int i = 0; i < 30; i++) {
    float h = sdf(terrain, p + l * t);
    s = min(s, 9. * h / t);
    t += clamp(h, .15, 1.5);
    if (h < .04 || t > 30.) break;
  }
  return clamp(s, 0., 1.);
}

float ambient(vec3 p, vec3 n) {
  float a = 0., w = 1.;
  for (int i = 1; i <= 4; i++) {
    float h = float(i) * .5;
    a += (h - sdf(terrain, p + n * h)) * w;
    w *= .55;
  }
  return clamp(1. - a * .34, .22, 1.);
}

vec3 microNormal(vec3 p, vec3 n) {
  float e = .16;
  vec3 q = p * 4.5;
  vec3 g = vec3(
    vnoise(q + vec3(e, 0, 0)) - vnoise(q - vec3(e, 0, 0)),
    vnoise(q + vec3(0, e, 0)) - vnoise(q - vec3(0, e, 0)),
    vnoise(q + vec3(0, 0, e)) - vnoise(q - vec3(0, 0, e)));
  return normalize(n - (g - n * dot(n, g)) * uLight.w * .5);
}

vec3 rockColor(vec3 p, vec3 n) {
  vec4 g = atlasSample(terrain, p);
  vec4 soilV = atlasSample(soil, p);
  float bedding = p.y + .9 * vnoise(p * .35);
  float bands = .5 + .5 * sin(bedding * 2.9 + .5 * sin(bedding * 1.1));
  float thin = pow(.5 + .5 * sin(bedding * 13. + vnoise(p * 2.3) * 2.5), 10.);
  vec3 c = mix(vec3(.34, .16, .09), vec3(.66, .36, .18), .3 + bands * .4);
  c *= 1. - thin * .22;
  c += (vnoise(p * 7.) - .5) * .07 * (.3 + uLight.w);
  // deposited sediment reads as sand
  float sed = clamp(soilV.a * 2.2, 0., 1.);
  c = mix(c, vec3(.72, .60, .40) * (.8 + .4 * vnoise(p * 3.7)), sed * .8);
  // scree on steep faces
  float scree = 1. - smoothstep(.35, .78, n.y);
  c = mix(c, vec3(.43, .37, .31) * (.75 + .5 * vnoise(p * 3.1)), scree * .5);
  // moisture darkening (wet trails after rain)
  c *= 1. - .4 * smoothstep(.05, .8, g.b);
  return c;
}

vec3 sky(vec3 rd, vec3 sun) {
  float up = clamp(rd.y, 0., 1.);
  vec3 c = mix(vec3(.78, .74, .66), vec3(.28, .42, .58), pow(up, .55));
  float glow = pow(max(dot(rd, sun), 0.), 220.);
  c += vec3(1., .82, .55) * glow * 1.4;
  c += vec3(1., .9, .7) * pow(max(dot(rd, sun), 0.), 8.) * .12;
  return c;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag / uViewport.xy) * 2. - 1.;
  vec3 ro = uEye.xyz;
  vec3 fw = normalize(uLook.xyz - ro);
  vec3 rt = normalize(cross(fw, vec3(0, 1, 0)));
  vec3 up = cross(rt, fw);
  float fov = uEye.w;
  vec3 rd = normalize(fw + rt * uv.x * fov * uViewport.z + up * uv.y * fov);
  vec3 sun = sunDir();

  float tTerr = trace(ro, rd);
  vec3 color = sky(rd, sun);
  float tWater = 1e6;
  if (uWater.y > .5 && rd.y < -1e-4) tWater = (uWater.x - ro.y) / rd.y;

  bool waterFirst = tWater > 0. && (tTerr < 0. || tWater < tTerr);

  if (tTerr > 0.) {
    vec3 p = ro + rd * tTerr;
    vec3 nGeo = surfaceNormal(terrain, p);
    vec3 n = microNormal(p, nGeo);
    float sh = shadow(p + nGeo * .18, sun);
    float ao = ambient(p, nGeo);
    vec3 base = rockColor(p, nGeo);
    float diff = max(dot(n, sun), 0.);
    vec3 lit = base * (diff * sh * vec3(1.15, 1.02, .86) + vec3(.30, .34, .40) * ao);
    // sparkle/specular on wet surfaces
    float wet = atlasSample(terrain, p).b;
    vec3 h = normalize(sun - rd);
    lit += vec3(1., .95, .8) * pow(max(dot(n, h), 0.), 42.) * wet * .55 * sh;
    // underwater tint
    float depth = uWater.x - p.y;
    if (uWater.y > .5 && depth > 0.) {
      lit = mix(lit, vec3(.10, .20, .22), clamp(depth * .55, 0., .9));
    }
    // brush gizmo ring
    if (uBrush.w > 0.) {
      float ring = abs(length(p - uBrush.xyz) - uBrush.w);
      float line = 1. - smoothstep(.03, .10, ring);
      lit = mix(lit, vec3(1., .78, .3), line * .8);
      float inside = 1. - smoothstep(uBrush.w * .8, uBrush.w, length(p - uBrush.xyz));
      lit += vec3(1., .7, .25) * inside * .05;
    }
    // distance haze
    float haze = smoothstep(30., 110., tTerr);
    color = mix(lit, sky(rd, sun), haze * .5);
  }

  if (waterFirst) {
    vec3 wp = ro + rd * tWater;
    // gentle animated ripple normal
    float e = .3;
    float t = uViewport.w;
    float h0 = vnoise(vec3(wp.x * .6, 0, wp.z * .6) + vec3(0, t * .7, 0));
    float hx = vnoise(vec3((wp.x + e) * .6, 0, wp.z * .6) + vec3(0, t * .7, 0));
    float hz = vnoise(vec3(wp.x * .6, 0, (wp.z + e) * .6) + vec3(0, t * .7, 0));
    vec3 wn = normalize(vec3(h0 - hx, .9, h0 - hz));
    vec3 refl = sky(reflect(rd, wn), sun);
    float fres = pow(1. - max(dot(-rd, wn), 0.), 3.);
    float bedDepth = tTerr > 0. ? (tTerr - tWater) * max(-rd.y, .08) : 4.;
    vec3 shallow = vec3(.30, .45, .42), deepC = vec3(.04, .10, .13);
    vec3 body = mix(shallow, deepC, clamp(bedDepth * .55, 0., 1.));
    if (tTerr > 0.) {
      vec3 bedCol = color; // terrain already shaded above
      color = mix(bedCol, body, clamp(.35 + bedDepth * .4, 0., .92));
    } else {
      color = body;
    }
    color = mix(color, refl, clamp(fres * .85 + .08, 0., .95));
    vec3 h2 = normalize(sun - rd);
    color += vec3(1., .93, .75) * pow(max(dot(wn, h2), 0.), 180.) * 1.2;
  }

  // exposure + tone map
  color *= uLight.z;
  color = 1. - exp(-color * 1.35);
  color = pow(color, vec3(1. / 2.1));
  float vig = 1. - .18 * dot(uv * .7, uv * .7);
  color *= vig;
  outColor = vec4(color, 1.);
}`;

const pickFragment =
  glslHeader +
  `
uniform sampler2D terrain;
uniform vec4 uEye;
uniform vec4 uLook;
uniform vec4 uViewport;
out vec4 outHit;
void main() {
  vec2 uv = (gl_FragCoord.xy / uViewport.xy) * 2. - 1.;
  vec3 ro = uEye.xyz;
  vec3 fw = normalize(uLook.xyz - ro);
  vec3 rt = normalize(cross(fw, vec3(0, 1, 0)));
  vec3 up = cross(rt, fw);
  float fov = uEye.w;
  vec3 rd = normalize(fw + rt * uv.x * fov * uViewport.z + up * uv.y * fov);
  vec3 safe = sign(rd) * max(abs(rd), vec3(1e-8));
  vec3 a = (LO - ro) / safe, b = (HI - ro) / safe;
  vec3 n = min(a, b), f = max(a, b);
  float t = max(0., max(max(n.x, n.y), n.z));
  float end = min(min(f.x, f.y), f.z);
  outHit = vec4(0.);
  for (int i = 0; i < 250; i++) {
    if (t > end) return;
    vec3 p = ro + rd * t;
    float d = sdf(terrain, p);
    if (d < .06) { outHit = vec4(p, 1.); return; }
    t += clamp(d * .75, .03, 1.5);
  }
}`;

const grainsVertex =
  glslHeader +
  `
uniform sampler2D terrain;
uniform sampler2D positions, cargos;
uniform vec4 uEye, uLook, uViewport;
out vec4 grainColor;
void main() {
  int id = gl_VertexID;
  ivec2 uv = ivec2(id % ${PT_W}, id / ${PT_W});
  vec4 p = texelFetch(positions, uv, 0);
  vec4 cargo = texelFetch(cargos, uv, 0);
  grainColor = vec4(0.);
  gl_Position = vec4(-3., -3., 0., 1.);
  gl_PointSize = 1.;
  if (p.w < 0. || id >= ${MAX_PARTICLES}) return;

  vec3 ro = uEye.xyz;
  vec3 fw = normalize(uLook.xyz - ro);
  vec3 rt = normalize(cross(fw, vec3(0, 1, 0)));
  vec3 up = cross(rt, fw);
  vec3 rel = p.xyz - ro;
  float z = dot(rel, fw);
  if (z < .2) return;

  // cheap occlusion march
  vec3 ray = rel / length(rel);
  float t = 0.;
  float limit = length(rel) - .2;
  bool blocked = false;
  for (int i = 0; i < 14; i++) {
    if (t > limit) break;
    float d = sdf(terrain, ro + ray * t);
    if (d < .06) { blocked = true; break; }
    t += clamp(d * .8, .08, limit / 12.);
  }
  if (blocked) return;

  float fov = uEye.w;
  gl_Position = vec4(dot(rel, rt) / (z * fov * uViewport.z), dot(rel, up) / (z * fov), 0., 1.);
  gl_PointSize = clamp(150. / z, 1.5, 6.);
  float load = clamp(cargo.x * 9., 0., 1.);
  vec3 wet = vec3(.55, .75, .95);
  vec3 sandy = vec3(.85, .66, .38);
  grainColor = vec4(mix(wet, sandy, load), .85);
}`;

const grainsFragment = `#version 300 es
precision highp float;
in vec4 grainColor;
out vec4 color;
void main() {
  if (grainColor.a <= 0.) discard;
  float r = length(gl_PointCoord - .5) * 2.;
  if (r > 1.) discard;
  color = vec4(grainColor.rgb, grainColor.a * (1. - r * r * .6));
}`;

export class Renderer {
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.renderProg = program(gl, fullscreenVertex, renderFragment, "render");
    this.pickProg = program(gl, fullscreenVertex, pickFragment, "pick");
    this.grainsProg = program(gl, grainsVertex, grainsFragment, "grains");
    this.pickTarget = null;
    this.pickScale = 0.5;
  }

  ensurePickTarget(w, h) {
    const pw = Math.max(1, Math.floor(w * this.pickScale));
    const ph = Math.max(1, Math.floor(h * this.pickScale));
    if (!this.pickTarget || this.pickTarget.w !== pw || this.pickTarget.h !== ph) {
      this.pickTarget = makeTarget(this.gl, pw, ph, 1, { internal: this.gl.RGBA32F });
    }
  }

  /** Shared uniform upload for the camera-bearing passes. */
  setCamera(prog, cam, w, h, extraSlotBase = 0) {
    const gl = this.gl;
    const eye = cam.eyePos();
    gl.uniform4f(prog.u("uEye"), eye[0], eye[1], eye[2], cam.fov);
    gl.uniform4f(prog.u("uLook"), cam.target[0], cam.target[1], cam.target[2], 0);
    gl.uniform4f(prog.u("uViewport"), w, h, w / h, performance.now() / 1000);
  }

  render(state, particles) {
    const gl = this.gl;
    const canvas = this.canvas;
    const w = canvas.width, h = canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const p = this.renderProg;
    gl.useProgram(p.handle);
    this.setCamera(p, state.camera, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.volumeTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.soilTex);
    gl.uniform1i(p.u("terrain"), 0);
    gl.uniform1i(p.u("soil"), 1);
    gl.uniform4f(p.u("uLight"), state.sunAngle, state.sunHeight, state.exposure, state.grain);
    gl.uniform4f(p.u("uWater"), state.waterLevel, state.waterOn ? 1 : 0, 0, 0);
    if (state.brush) gl.uniform4f(p.u("uBrush"), state.brush[0], state.brush[1], state.brush[2], state.brush[3]);
    else gl.uniform4f(p.u("uBrush"), 0, 0, 0, -1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (state.showGrains && particles) {
      const g = this.grainsProg;
      gl.useProgram(g.handle);
      this.setCamera(g, state.camera, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, state.volumeTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, particles.positions.src().textures[0]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, particles.cargos.src().textures[0]);
      gl.uniform1i(g.u("terrain"), 0);
      gl.uniform1i(g.u("positions"), 1);
      gl.uniform1i(g.u("cargos"), 2);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, MAX_PARTICLES);
      gl.disable(gl.BLEND);
    }
  }

  /** Pick the terrain surface at canvas pixel (x, y). Returns [x,y,z] or null. */
  pick(x, y, cam, volumeTex) {
    const gl = this.gl;
    const canvas = this.canvas;
    const w = canvas.width, h = canvas.height;
    this.ensurePickTarget(w, h);
    const t = this.pickTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    const p = this.pickProg;
    gl.useProgram(p.handle);
    this.setCamera(p, cam, t.w, t.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, volumeTex);
    gl.uniform1i(p.u("terrain"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = Math.min(t.w - 1, Math.max(0, Math.floor(x * this.pickScale)));
    const py = Math.min(t.h - 1, Math.max(0, Math.floor((h - y) * this.pickScale)));
    const buf = new Float32Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (buf[3] < 0.5) return null;
    return [buf[0], buf[1], buf[2]];
  }
}
