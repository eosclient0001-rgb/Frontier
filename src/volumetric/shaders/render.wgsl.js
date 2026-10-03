/**
 * Volumetric raymarcher (single fullscreen pass, no geometry).
 *
 * A fullscreen triangle reconstructs the world ray through the volume AABB,
 * then marches density/temperature/fuel/embers accumulating:
 *   - blackbody flame emission (temperature driven)
 *   - single scattering, Henyey-Greenstein phase + a few light-shadow taps
 *   - Beer-Lambert transmittance
 * and composites over a procedural sky + ground plane that picks up the
 * plume's light.
 *
 * Debug modes sample a single slice of the field instead (density, heat, fuel,
 * velocity, SDF), which is the quickest way to see what the solver is doing.
 */
export const WGSL_RENDER = /* wgsl */ `

struct RenderParams {
  invViewProj:    mat4x4<f32>,
  camPos:         vec4<f32>,  // xyz, w = exposure bias
  volMin:         vec4<f32>,  // xyz, w = unused
  volSize:        vec4<f32>,  // xyz, w = march steps
  lightDir:       vec4<f32>,  // xyz = dir toward sun, w = sun intensity
  lightColor:     vec4<f32>,  // rgb, w = ambient intensity
  skyZenith:      vec4<f32>,  // rgb, w = unused
  skyHorizon:     vec4<f32>,  // rgb, w = sun angular size
  opt:            vec4<f32>,  // x extinction, y emission, z flame scale, w smoke albedo
  opt2:           vec4<f32>,  // x jitter, y shadow density, z time, w debug mode
  opt3:           vec4<f32>,  // x debug axis, y debug slice, z exposure, w ground fog
  fireLight:      vec4<f32>,  // xyz = plume light position, w = intensity
  fireLightColor: vec4<f32>,  // rgb, w = shadow taps
  misc:           vec4<f32>,  // x = scattering anisotropy, y = ground albedo, z/w unused
  obstacle:       vec4<f32>,  // xyz = collider centre, w unused
  obstacleShape:  vec4<f32>,  // xyz = collider half extents, w = mode (0 = off)
};

@group(0) @binding(0) var<uniform> rp: RenderParams;
@group(1) @binding(0) var volScal: texture_3d<f32>;
@group(1) @binding(1) var volVel: texture_3d<f32>;
@group(1) @binding(2) var volSdf: texture_3d<f32>;
@group(1) @binding(3) var samp: sampler;

const PI: f32 = 3.14159265359;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> VSOut {
  // single oversized triangle: (0,0) (2,0) (0,2) in uv space
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: VSOut;
  out.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = p;
  return out;
}

// ---------------------------------------------------------------- helpers --
fn worldToUv(w: vec3<f32>) -> vec3<f32> {
  return (w - rp.volMin.xyz) / rp.volSize.xyz;
}

fn sampleScal(uv: vec3<f32>) -> vec4<f32> {
  return textureSampleLevel(volScal, samp, uv, 0.0);
}

fn sampleDensity(uv: vec3<f32>) -> f32 {
  return sampleScal(uv).x;
}

fn intersectBox(ro: vec3<f32>, rd: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> vec2<f32> {
  // guard against exactly-axis-aligned rays producing 0 * inf = NaN
  let rdS = select(rd, vec3<f32>(1.0e-7), abs(rd) < vec3<f32>(1.0e-7));
  let inv = 1.0 / rdS;
  let t0 = (bmin - ro) * inv;
  let t1 = (bmax - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2<f32>(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// Blackbody-ish ramp: embers -> red -> orange -> yellow-white
fn flameColor(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 4.0);
  let c0 = vec3<f32>(0.030, 0.008, 0.002);
  let c1 = vec3<f32>(0.760, 0.110, 0.015);
  let c2 = vec3<f32>(1.900, 0.640, 0.080);
  let c3 = vec3<f32>(3.400, 2.300, 0.900);
  var c = mix(c0, c1, smoothstep(0.10, 0.65, x));
  c = mix(c, c2, smoothstep(0.65, 1.45, x));
  c = mix(c, c3, smoothstep(1.45, 3.20, x));
  return c;
}

fn henyeyGreenstein(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * pow(max(denom, 1.0e-4), 1.5));
}

fn lightTransmittance(p: vec3<f32>, dir: vec3<f32>, stepLen: f32, taps: i32) -> f32 {
  if (taps <= 0) { return 1.0; }
  var tau = 0.0;
  for (var i = 0; i < taps; i = i + 1) {
    tau += sampleDensity(worldToUv(p + dir * (stepLen * (f32(i) + 0.5))));
  }
  return exp(-tau * rp.opt2.y * stepLen);
}

fn skyColor(rd: vec3<f32>) -> vec3<f32> {
  let h = clamp(rd.y, -1.0, 1.0);
  var col = mix(rp.skyHorizon.rgb, rp.skyZenith.rgb, smoothstep(-0.02, 0.55, h));
  let sun = max(dot(rd, rp.lightDir.xyz), 0.0);
  col += rp.lightColor.rgb * (pow(sun, rp.skyHorizon.w) * rp.lightDir.w * 1.5 + pow(sun, 6.0) * 0.3);
  return col;
}

fn groundColor(p: vec3<f32>) -> vec3<f32> {
  // faint grid for scale + warm bounce from the fire
  let g = abs(fract(p.xz * 0.5) - 0.5) / max(fwidth(p.xz * 0.5), vec2<f32>(1.0e-4));
  let line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  var col = mix(rp.misc.y * vec3<f32>(0.10, 0.11, 0.13), vec3<f32>(0.28, 0.29, 0.33), line * 0.4);
  let d = p - rp.fireLight.xyz;
  let dist = length(d);
  let atten = rp.fireLight.w / (1.0 + dist * dist * 1.5);
  col += rp.fireLightColor.rgb * atten * clamp(d.y / max(dist, 1.0e-3), 0.0, 1.0) * 0.5;
  col += rp.lightColor.rgb * rp.lightDir.w * 0.12;
  return col;
}

fn background(ro: vec3<f32>, rd: vec3<f32>, tStart: f32) -> vec3<f32> {
  if (rd.y < -1.0e-4) {
    let tg = (rp.volMin.y - ro.y) / rd.y;
    if (tg > tStart) {
      let p = ro + rd * tg;
      let fog = clamp(1.0 - exp(-max(tg - tStart, 0.0) * rp.opt3.w), 0.0, 1.0);
      return mix(groundColor(p), skyColor(rd) * 0.7, fog);
    }
  }
  return skyColor(rd);
}

// Solid collider shading: the same box the solver collides against, so the
// smoke visibly wraps around something instead of bending around nothing.
fn obstacleShade(p: vec3<f32>) -> vec3<f32> {
  let q = (p - rp.obstacle.xyz) / max(rp.obstacleShape.xyz, vec3<f32>(1.0e-4));
  let aq = abs(q);
  var n = vec3<f32>(0.0, 1.0, 0.0);
  if (aq.x >= aq.y && aq.x >= aq.z) { n = vec3<f32>(sign(q.x), 0.0, 0.0); }
  else if (aq.y >= aq.z) { n = vec3<f32>(0.0, sign(q.y), 0.0); }
  else { n = vec3<f32>(0.0, 0.0, sign(q.z)); }

  let ndl = max(dot(n, rp.lightDir.xyz), 0.0);
  let d = p - rp.fireLight.xyz;
  let dist = length(d);
  let bounce = rp.fireLightColor.rgb * (rp.fireLight.w / (1.0 + dist * dist * 1.5)) * max(dot(n, normalize(d)), 0.0);
  var col = vec3<f32>(0.10, 0.105, 0.12) * (0.55 + rp.lightColor.w * 0.45);
  col += rp.lightColor.rgb * rp.lightDir.w * ndl * 0.28;
  col += bounce * 0.8;
  return col;
}

fn ramp(x: f32) -> vec3<f32> {
  // compact turbo-like ramp
  let t = clamp(x, 0.0, 1.0);
  let r = 0.1357 + t * (4.5974 + t * (-42.3277 + t * (130.588 + t * (-150.566 + t * 58.137))));
  let g = 0.0914 + t * (2.1856 + t * (4.8054 + t * (-14.019 + t * (12.052 + t * -3.512))));
  let b = 0.1066 + t * (12.592 + t * (-60.109 + t * (109.075 + t * (-88.506 + t * 26.812))));
  return clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
}

// ------------------------------------------------------------ debug slice --
fn debugSlice(ro: vec3<f32>, rd: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> vec4<f32> {
  let dims = bmax - bmin;
  let axis = i32(rp.opt3.x);
  let t01 = clamp(rp.opt3.y, 0.0, 1.0);

  var o = ro.x; var dir = rd.x; var lo = bmin.x; var scale = dims.x;
  if (axis == 1) { o = ro.y; dir = rd.y; lo = bmin.y; scale = dims.y; }
  if (axis == 2) { o = ro.z; dir = rd.z; lo = bmin.z; scale = dims.z; }

  let bg = vec3<f32>(0.055, 0.06, 0.07);
  if (abs(dir) < 1.0e-6) { return vec4<f32>(bg, 1.0); }
  let tPlane = (lo + t01 * scale - o) / dir;
  if (tPlane <= 0.0) { return vec4<f32>(bg, 1.0); }

  let p = ro + rd * tPlane;
  if (any(p < bmin) || any(p > bmax)) { return vec4<f32>(bg, 1.0); }

  let uv = clamp(worldToUv(p), vec3<f32>(0.0), vec3<f32>(1.0));
  let s = sampleScal(uv);
  let mode = i32(rp.opt2.w);
  var value = s.x;
  if (mode == 2) { value = s.y * 0.25; }
  if (mode == 3) { value = s.z; }
  if (mode == 4) { value = length(textureSampleLevel(volVel, samp, uv, 0.0).xyz) * 0.25; }
  if (mode == 5) { value = 0.5 + textureSampleLevel(volSdf, samp, uv, 0.0).x * 4.0; }
  return vec4<f32>(ramp(value), 1.0);
}

// ------------------------------------------------------------------ main --
@fragment
fn fsMain(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0);
  let pNear = rp.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let pFar = rp.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let ro = rp.camPos.xyz;
  let rd = normalize(pFar.xyz / pFar.w - pNear.xyz / pNear.w);

  let bmin = rp.volMin.xyz;
  let bmax = rp.volMin.xyz + rp.volSize.xyz;
  let hit = intersectBox(ro, rd, bmin, bmax);

  if (rp.opt2.w > 0.5) {
    return debugSlice(ro, rd, bmin, bmax);
  }

  // solid collider: terminate the march at its front face
  var tObstacle = 1.0e30;
  var hitObstacle = false;
  if (rp.obstacleShape.w > 0.5) {
    let ob = intersectBox(
      ro,
      rd,
      rp.obstacle.xyz - rp.obstacleShape.xyz,
      rp.obstacle.xyz + rp.obstacleShape.xyz
    );
    if (ob.y > max(ob.x, 0.0)) {
      tObstacle = max(ob.x, 0.0);
      hitObstacle = true;
    }
  }

  var color = vec3<f32>(0.0);
  var transmittance = 1.0;

  if (hit.y > hit.x && hit.x < tObstacle) {
    let tStart = max(hit.x, 0.0);
    let tEnd = min(hit.y, tObstacle);
    if (tEnd > tStart) {
      let steps = max(i32(rp.volSize.w), 1);
      let dt = (tEnd - tStart) / f32(steps);
      let shadowTaps = i32(rp.fireLightColor.w);
      let lightStep = rp.volSize.x * 0.05;

      var t = tStart + rp.opt2.x * dt;
      for (var i = 0; i < steps; i = i + 1) {
        let p = ro + rd * t;
        let uv = worldToUv(p);
        let s = sampleScal(uv);

        let density = max(s.x, 0.0);
        let heat = max(s.y, 0.0);
        let ember = s.w;

        let ext = density * rp.opt.x + smoothstep(0.45, 1.8, heat) * 0.30;
        if (ext > 1.0e-4) {
          // flame emission
          let flame = flameColor(heat * rp.opt.z) * smoothstep(0.10, 1.20, heat);
          var emitted = flame * rp.opt.y + vec3<f32>(1.0, 0.42, 0.12) * ember * 0.04;

          // scattered light
          let vis = lightTransmittance(p, rp.lightDir.xyz, lightStep, shadowTaps);
          let phase = henyeyGreenstein(dot(rd, rp.lightDir.xyz), rp.misc.x);
          let albedo = rp.opt.w * vec3<f32>(1.0, 0.97, 0.94);
          var scatter = rp.lightColor.rgb * rp.lightDir.w * vis * phase * albedo;
          scatter += rp.fireLightColor.rgb * rp.fireLight.w * 0.05 * exp(-length(p - rp.fireLight.xyz) * 0.5);

          color += transmittance * (emitted + scatter * density * rp.opt.x) * dt;
          transmittance *= exp(-ext * dt);
        }

        t += dt;
        if (transmittance < 0.006) { break; }
      }
    }
  }

  // background composite (sky / ground / collider)
  var bg = background(ro, rd, max(min(hit.y, tObstacle), 0.0));
  if (hitObstacle) {
    bg = obstacleShade(ro + rd * tObstacle);
  }
  let outColor = color + transmittance * bg;

  // exposure -> ACES-ish -> sRGB
  let x = outColor * pow(2.0, rp.opt3.z + rp.camPos.w);
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  let mapped = clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(pow(mapped, vec3<f32>(0.4545)), 1.0);
}
`;
