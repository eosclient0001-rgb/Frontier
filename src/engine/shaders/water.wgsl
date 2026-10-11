// =================================================================================================

#include "scene.wgsl"
//  water.wgsl — deferred water surface
// -------------------------------------------------------------------------------------------------
//  Drawn as a full-screen pass after the terrain, because a water surface needs to refract what is
//  behind it. For every pixel the plane is intersected analytically, compared against the depth
//  buffer, and shaded where it wins.
//
//  Three things make it read as water rather than as a blue plane:
//    • the reflection is a real planar reflection — the reflected ray is traced against the height
//      field and the hit is projected back into the frame, so mountains actually appear in the lake
//    • transmission is absorbed spectrally with depth, so shallow water stays clear and deep water
//      goes green, not just darker
//    • foam appears where the water thins out, and on wave crests
// =================================================================================================

struct Water {
  p0: vec4f,   // enabled, level(normalised), roughness, waveAmplitude(m)
  p1: vec4f,   // absorption.rgb, refractionIndex
  p2: vec4f,   // scatter.rgb, foamAmount
  p3: vec4f,   // waveScale(m), waveSpeed, choppiness, shoreWidth(m)
  p4: vec4f,   // reflectivity, absorptionStrength, sparkle, sunGlitter
  p5: vec4f,   // flowDir.x, flowDir.z, reflectionDistance(m), ---
};

@group(1) @binding(0) var sceneColor: texture_2d<f32>;
@group(1) @binding(1) var sceneDepth: texture_depth_2d;
@group(1) @binding(2) var sceneSampler: sampler;
@group(1) @binding(3) var<uniform> W: Water;

struct FsIn {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vsFullscreen(@builtin(vertex_index) vi: u32) -> FsIn {
  var tri = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FsIn;
  out.ndc = tri[vi];
  out.pos = vec4f(tri[vi], 0.0, 1.0);
  return out;
}

fn linearDepth(z: f32) -> f32 {
  let n = Cam.params.x;
  let f = Cam.params.y;
  return f * n / max(f - z * (f - n), 1e-6);
}

fn cameraForward() -> vec3f {
  return -normalize(vec3f(Cam.view[0][2], Cam.view[1][2], Cam.view[2][2]));
}

fn cameraRight() -> vec3f {
  return normalize(vec3f(Cam.view[0][0], Cam.view[1][0], Cam.view[2][0]));
}

fn cameraUp() -> vec3f {
  return normalize(vec3f(Cam.view[0][1], Cam.view[1][1], Cam.view[2][1]));
}

// --- height field tracing -------------------------------------------------------------------------
// Returns (hit xyz, 1.0) or (last position, 0.0). Stride doubles every few steps so a lake can
// reflect a ridge line kilometres away without paying for kilometres of samples.

fn traceHeightfield(origin: vec3f, dir: vec3f, maxDist: f32, steps: i32) -> vec4f {
  let extent = Ter.p0.x;
  let heightMeters = Ter.p0.y;
  var t = 0.0;
  var dt = max(maxDist, 1.0) / f32(steps);
  var prev = origin;
  var hit = 0.0;
  for (var i = 0; i < steps; i = i + 1) {
    let p = origin + dir * t;
    let uv = vec2f(p.x / extent + 0.5, p.z / extent + 0.5);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return vec4f(p, 0.0); }
    let terrainY = heightAtUV(uv) * heightMeters;
    if (p.y <= terrainY) {
      // bisect between the last two samples
      var a = t - dt;
      var b = t;
      for (var k = 0; k < 6; k = k + 1) {
        let m = 0.5 * (a + b);
        let q = origin + dir * m;
        let quv = vec2f(q.x / extent + 0.5, q.z / extent + 0.5);
        if (q.y <= heightAtUV(quv) * heightMeters) { b = m; } else { a = m; }
      }
      let q = origin + dir * b;
      return vec4f(q, 1.0);
    }
    prev = p;
    t = t + dt;
    if (t > maxDist) { break; }
  }
  return vec4f(prev, hit);
}

fn waterNormalAt(p: vec2f, dist: f32, time: f32) -> vec3f {
  let scale = max(W.p3.x, 0.05);
  let amp = W.p0.w;
  let flow = normalize(W.p5.xy + vec2f(1e-4, 0.0));
  let t = time * W.p3.y;
  let pixel = max(dist, 1.0) * exp2(Ter.p3.y);

  var g = vec2f(0.0);
  // Two counter-drifting wave trains plus a fine chop. Each fade removes the octaves that are
  // smaller than the pixel footprint, otherwise the horizon boils.
  let f1 = 1.0 / scale;
  let n1 = noised3(vec3f(p * f1 + flow * t * 0.6, t * 0.25), 2203u);
  let fade1 = clamp(1.0 - pixel * f1 * 0.5, 0.0, 1.0);
  g += n1.yz * f1 * fade1 * 1.0;

  let f2 = 2.7 * f1;
  let n2 = noised3(vec3f(p * f2 - flow * t * 1.1, t * 0.4 + 11.0), 5501u);
  let fade2 = clamp(1.0 - pixel * f2 * 0.5, 0.0, 1.0);
  g += n2.yz * f2 * fade2 * 0.45;

  let f3 = 7.3 * f1;
  let n3 = noised3(vec3f(p * f3 + vec2f(t * 0.9, -t * 0.7), t * 0.6 + 23.0), 9109u);
  let fade3 = clamp(1.0 - pixel * f3 * 0.5, 0.0, 1.0);
  let chop = clamp(W.p3.z, 0.0, 1.0);
  g += n3.yz * f3 * fade3 * 0.16 * chop;

  return normalize(vec3f(-g.x * amp, 1.0, -g.y * amp));
}

@fragment
fn fsWater(in: FsIn) -> @location(0) vec4f {
  let px = vec2i(in.pos.xy);
  let scene = textureLoad(sceneColor, px, 0).rgb;
  if (W.p0.x < 0.5) { return vec4f(scene, 1.0); }

  let depthRaw = textureLoad(sceneDepth, px, 0);
  let camPos = Cam.position.xyz;
  let dir = viewRay(in.ndc);
  let cosA = max(dot(cameraForward(), dir), 1e-4);
  var sceneDist = linearDepth(depthRaw) / cosA;
  if (depthRaw >= 0.9999) { sceneDist = Cam.params.y; }

  let heightMeters = Ter.p0.y;
  let waterY = W.p0.y * heightMeters;
  let extent = Ter.p0.x;

  // --- underwater ---------------------------------------------------------------------------------
  if (camPos.y < waterY) {
    let path = min(sceneDist, 400.0);
    let absorb = exp(-max(W.p1.xyz, vec3f(0.0)) * path * W.p4.y * 0.35);
    var c = scene * absorb + W.p2.xyz * (1.0 - absorb) * 0.5;
    return vec4f(c, 1.0);
  }

  if (dir.y > -1e-4) { return vec4f(scene, 1.0); }
  let tPlane = (waterY - camPos.y) / dir.y;
  if (tPlane <= 0.0 || tPlane > sceneDist) { return vec4f(scene, 1.0); }

  let p = camPos + dir * tPlane;
  let uvWorld = vec2f(p.x / extent + 0.5, p.z / extent + 0.5);
  let terrainH = heightAtUV(uvWorld) * heightMeters;
  let waterDepth = max(waterY - terrainH, 0.0);
  let dist = tPlane;
  let time = Ter.p1.z;

  let Nw = waterNormalAt(p.xz, dist, time);
  let Vv = -dir;
  let NdotV = clamp(dot(Nw, Vv), 1e-4, 1.0);
  let R = reflect(dir, Nw);

  // --- reflection ---------------------------------------------------------------------------------
  let skyRefl = skyRadiance(transLut, lutSampler, Atmo, camPos.y, R, clamp(i32(Ter.p4.z), 4, 16), true);
  var reflection = skyRefl;

  let trace = traceHeightfield(p + vec3f(0.0, 0.05, 0.0), R, max(W.p5.z, 100.0), 28);
  if (trace.w > 0.5 && R.y > 0.01) {
    let clip = Cam.viewProj * vec4f(trace.xyz, 1.0);
    if (clip.w > 0.0) {
      let sndc = clip.xy / clip.w;
      let suv = vec2f(sndc.x * 0.5 + 0.5, 0.5 - sndc.y * 0.5);
      if (suv.x > 0.001 && suv.x < 0.999 && suv.y > 0.001 && suv.y < 0.999) {
        let mirrored = textureSampleLevel(sceneColor, sceneSampler, suv, 0.0).rgb;
        // Fade the reflection out towards the edges of the frame, where the information simply
        // is not present, rather than smearing the border pixel across the water.
        let edge = smoothstepv(0.0, 0.06, min(min(suv.x, 1.0 - suv.x), min(suv.y, 1.0 - suv.y)));
        reflection = mix(skyRefl, mirrored, edge * clamp(W.p4.x, 0.0, 1.0));
      }
    }
  }

  // --- transmission -------------------------------------------------------------------------------
  let refr = refract(dir, Nw, 1.0 / max(W.p1.w, 1.01));
  let pathLength = clamp(waterDepth / max(-dir.y, 0.08), 0.0, 600.0);
  let right = cameraRight();
  let up = cameraUp();
  // Lateral displacement of the refracted ray at the bed, expressed in screen space. The
  // refracted direction is projected onto the camera basis first, otherwise the offset lives in
  // the wrong frame and slides across the surface as the camera turns.
  let lateral = vec2f(dot(refr, right), dot(refr, up)) * pathLength;
  let tanHalf = max(Cam.params.z, 1e-4);
  let ndcOff = vec2f(
    lateral.x / (dist * tanHalf * max(Cam.params.w, 1e-4)),
    lateral.y / (dist * tanHalf)
  ) * 0.5;
  let baseUv = in.ndc * vec2f(0.5, -0.5) + vec2f(0.5);
  let refrUv = clamp(baseUv + ndcOff, vec2f(0.002), vec2f(0.998));
  let behind = textureSampleLevel(sceneColor, sceneSampler, refrUv, 0.0).rgb;

  let absorb = exp(-max(W.p1.xyz, vec3f(0.0)) * pathLength * W.p4.y);
  let transmission = behind * absorb + W.p2.xyz * (1.0 - absorb);

  // --- fresnel + compose --------------------------------------------------------------------------
  let F0 = 0.02;
  let fres = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
  var color = mix(transmission, reflection, clamp(fres, 0.0, 1.0));

  // Sun glitter: an explicit GGX lobe keeps the highlight crisp where the sky's solar disc would
  // otherwise alias against the wave normals.
  let sunDir = Atmo.p4.xyz;
  let sunT = sampleTransmittance(transLut, lutSampler, Atmo, camPos.y, sunDir.y);
  let sunRadiance = Atmo.p4.w * sunT;
  let H = normalize(Vv + sunDir);
  let NdotH = max(dot(Nw, H), 0.0);
  let VdotH = max(dot(Vv, H), 0.0);
  let alpha = max(W.p0.z * W.p0.z, 0.002);
  let NdotLw = max(dot(Nw, sunDir), 0.0);
  let Fs = fresnelSchlick(vec3f(F0), VdotH);
  color += distributionGGX(NdotH, alpha) * visibilitySmith(NdotV, NdotLw, alpha) * Fs
         * sunRadiance * NdotLw * clamp(W.p4.w, 0.0, 4.0);

  // --- foam ----------------------------------------------------------------------------------------
  let shore = smoothstep(max(W.p3.w, 0.01), 0.0, waterDepth);
  let crest = smoothstep(0.55, 0.95, clamp(1.0 - Nw.y, 0.0, 1.0) * 6.0);
  let foamNoise = fbmd3(vec3f(p.xz * 0.35, time * 0.25), 3, 2.1, 0.55, 3313u).x;
  let foam = clamp((shore * 0.9 + crest * 0.5) * W.p2.w * (0.65 + 0.35 * foamNoise), 0.0, 1.0);
  color = mix(color, vec3f(0.86, 0.89, 0.92) * 0.9, foam);

  // --- aerial perspective -------------------------------------------------------------------------
  let ap = aerialPerspective(transLut, lutSampler, Atmo, camPos.y, dir, dist, clamp(i32(Ter.p4.z), 4, 16));
  color = color * ap.transmittance + ap.inscatter;

  return vec4f(max(color, vec3f(0.0)), 1.0);
}
