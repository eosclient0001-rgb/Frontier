// ─────────────────────────────────────────────────────────────────────────────
//  Water surface.
//
//  A single quad at the water plane. For every pixel we
//    · build wave normals from animated gradient noise
//    · reflect: march the heightfield for real mountain reflections, else sky
//    · refract: march down to the bed, shade it and absorb along the path
//    · add Fresnel, GGX sun glint, depth-tinted foam on the shoreline
// ─────────────────────────────────────────────────────────────────────────────

#include "shading.wgsl"

struct WOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) wpos: vec3<f32>,
}

@vertex
fn vsWater(@builtin(vertex_index) vi: u32) -> WOut {
  var corner = array<vec2<f32>, 4>(
    vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5),
    vec2<f32>(-0.5, 0.5), vec2<f32>(0.5, 0.5));
  let c = corner[vi];
  let y = F.terr1.x * F.terr.y;
  let p = vec3<f32>(c.x * F.terr.z, y, c.y * F.terr.z);
  var o: WOut;
  o.wpos = p;
  o.clip = F.viewProj * vec4<f32>(p, 1.0);
  return o;
}

/// Two layers of animated capillary waves plus a slow swell.
fn waveNormal(p: vec3<f32>, pw: f32, t: f32) -> vec3<f32> {
  let sc = max(F.water2.w, 0.02);
  let amp = F.water.w;
  let fade = detailFade(pw, 1.0 / sc);

  let s1 = sc;
  let a = fbm2(p.xz * s1 + vec2<f32>(t * 0.35, t * -0.21), 3.0, 2.1, 0.55);
  let s2 = sc * 3.7;
  let b = fbm2(p.xz * s2 + vec2<f32>(t * -0.9, t * 0.62), 2.0, 2.1, 0.5);
  let s3 = sc * 0.23;
  let c = fbm2(p.xz * s3 + vec2<f32>(t * 0.11, t * 0.07), 2.0, 2.0, 0.5);

  var g = vec2<f32>(0.0);
  g += vec2<f32>(a.y, a.z) * s1 * amp;
  g += vec2<f32>(b.y, b.z) * s2 * amp * 0.35;
  g += vec2<f32>(c.y, c.z) * s3 * amp * 1.6;
  g *= fade;
  return normalize(vec3<f32>(-g.x, 1.0, -g.y));
}

@fragment
fn fsWater(in: WOut) -> @location(0) vec4<f32> {
  let p = in.wpos;
  let uv = worldToUv(p);
  let bedY = hUv(uv) * F.terr.y;
  let depth = max(p.y - bedY, 0.0);
  if (depth <= 0.001) { discard; }

  let V = normalize(F.camPos.xyz - p);
  let t = F.camPos.w;
  let pw = max(length(fwidth(p)), 1e-4) * F.misc.x;
  let N = waveNormal(p, pw, t);
  let dither = hash12(in.clip.xy);

  // ── reflection
  let R = reflect(-V, N);
  var refl: vec3<f32>;
  let hit = marchTerrain(p + R * 0.05, R, F.terr.z * 1.4, 96);
  if (hit.y > 0.5) {
    let hp = p + R * hit.x;
    refl = shadeTerrain(hp, dither, pw * 2.0);
  } else {
    refl = skyRadiance(R);
    let a = atmo();
    refl += atmoSunDisk(a, max(p.y, 0.0), R, F.sunDir.xyz, 0.00465);
  }

  // ── refraction + absorption
  let T = refract(-V, N, 1.0 / 1.333);
  var bed = vec3<f32>(0.0);
  var path = depth * 1.4;
  if (length(T) > 0.001) {
    let hitB = marchTerrain(p + T * 0.05, T, max(depth * 3.0, 4.0), 48);
    if (hitB.y > 0.5) {
      let bp = p + T * hitB.x;
      path = hitB.x;
      bed = shadeTerrain(bp, dither, pw * 1.5);
    } else {
      bed = skyRadiance(T) * 0.4;
    }
  } else {
    bed = shadeTerrain(vec3<f32>(p.x, bedY, p.z), dither, pw * 1.5);
  }
  let absorb = exp(-F.water2.xyz * path);
  let refr = bed * absorb + F.water.xyz * (1.0 - absorb) * 0.9;

  // ── Fresnel + specular
  let NoV = max(dot(N, V), 1e-4);
  let f0 = vec3<f32>(0.02);
  let Fr = F_Schlick(f0, NoV);
  let L = F.sunDir.xyz;
  let NoL = max(dot(N, L), 0.0);
  let H = normalize(L + V);
  let rough = 0.035 + F.water2.w * 0.0 + 0.02;
  let spec = F_Schlick(f0, max(dot(V, H), 0.0)) *
             D_GGX(max(dot(N, H), 0.0), rough * rough) *
             V_SmithGGX(NoV, max(NoL, 1e-4), rough * rough);

  var col = mix(refr, refl, Fr) + spec * sunRadiance(p.y) * NoL;

  // ── shoreline foam
  let shore = 1.0 - sat(depth / 0.55);
  let foamN = fbm2(p.xz * 1.6 + vec2<f32>(t * 0.4, -t * 0.3), 3.0, 2.0, 0.5).x;
  let foam = sat(shore * shore * (0.55 + 0.8 * foamN) * 1.4);
  col = mix(col, vec3<f32>(0.92, 0.95, 0.97) * (0.35 + 0.65 * skyIrradiance(vec3<f32>(0.0, 1.0, 0.0)).b), foam * 0.85);

  // ── a touch of sub-surface scatter in shallow water
  let shallow = sat(1.0 - depth / 2.2);
  col += F.water.xyz * shallow * 0.12 * skyIrradiance(vec3<f32>(0.0, 1.0, 0.0)) * 0.4;

  col = aerial(col, p, max(F.camPos.y, 0.0));
  return vec4<f32>(col, 1.0);
}
