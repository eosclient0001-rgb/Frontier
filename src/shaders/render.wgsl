// ─────────────────────────────────────────────────────────────────────────────
//  Terrain pass — grid + plinth skirt, shaded with the procedural material
//  stack, ray-marched sun shadows and a physically-based sky.
// ─────────────────────────────────────────────────────────────────────────────

#include "shading.wgsl"

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) wpos: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) skirt: f32,
}

@vertex
fn vsTerrain(@builtin(vertex_index) vi: u32) -> VSOut {
  let R = i32(F.rres.x);
  let S = R + 1;
  let G = S * S;
  let size = F.terr.z;
  let hs = F.terr.y;

  var out: VSOut;
  var wpos: vec3<f32>;
  var uv: vec2<f32>;
  var skirt = 0.0;

  if (i32(vi) < G) {
    let gx = i32(vi) % S;
    let gy = i32(vi) / S;
    uv = vec2<f32>(f32(gx), f32(gy)) / f32(R);
    let h = hUv(uv) * hs;
    wpos = vec3<f32>((uv.x - 0.5) * size, h, (uv.y - 0.5) * size);
  } else {
    let k = i32(vi) - G;
    let side = k / (2 * S);
    let j = k % (2 * S);
    let bottom = j >= S;
    let t = j % S;
    let u = f32(t) / f32(R);
    if (side == 0) { uv = vec2<f32>(u, 0.0); }
    else if (side == 1) { uv = vec2<f32>(1.0, u); }
    else if (side == 2) { uv = vec2<f32>(1.0 - u, 1.0); }
    else { uv = vec2<f32>(0.0, 1.0 - u); }
    let h = hUv(uv) * hs;
    let y = select(h, -F.rres.y, bottom);
    wpos = vec3<f32>((uv.x - 0.5) * size, y, (uv.y - 0.5) * size);
    skirt = f32(side) + 1.0 + select(0.0, 0.5, bottom);
  }

  out.wpos = wpos;
  out.uv = uv;
  out.skirt = skirt;
  out.clip = F.viewProj * vec4<f32>(wpos, 1.0);
  return out;
}

/// Plinth: stratified rock, darkened with depth so the block reads as solid.
fn shadePlinth(p: vec3<f32>, n: vec3<f32>, dither: f32) -> vec3<f32> {
  let strata = fbm2(vec2<f32>(p.y * 0.06, p.x * 0.012 + p.z * 0.02), 4.0, 2.0, 0.5).x;
  let bands = sin(p.y * 0.09 + strata * 2.4) * 0.5 + 0.5;
  let grain = vnoise2(p.xz * 0.9 + p.y * 0.3);
  var alb = mix(vec3<f32>(0.115, 0.105, 0.098), vec3<f32>(0.20, 0.185, 0.168), bands * 0.8 + 0.2 * strata);
  alb *= 0.85 + 0.2 * grain;
  let depth01 = sat((-p.y) / max(F.rres.y, 1.0));
  alb *= mix(1.0, 0.35, depth01 * 0.85);

  let V = normalize(F.camPos.xyz - p);
  let L = F.sunDir.xyz;
  let NoL = max(dot(n, L), 0.0);
  let sh = sunShadow(p, n, dither);
  let a = 0.81;
  let H = normalize(L + V);
  let spec = F_Schlick(vec3<f32>(0.04), max(dot(V, H), 0.0)) *
             D_GGX(max(dot(n, H), 0.0), a * a) *
             V_SmithGGX(max(dot(n, V), 1e-4), max(NoL, 1e-4), a * a);
  var col = alb * INV_PI * sunRadiance(p.y) * NoL * sh + spec * sunRadiance(p.y) * NoL * sh;
  col += alb * INV_PI * skyIrradiance(n) * mix(0.55, 1.0, 1.0 - depth01);
  return aerial(col, p, max(F.camPos.y, 0.0));
}

@fragment
fn fsTerrain(in: VSOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let p = in.wpos;
  var n = nUv(in.uv);
  if (!front) { n = -n; }
  let dither = hash12(in.clip.xy);

  if (in.skirt > 0.5) {
    let side = i32(floor(in.skirt)) - 1;
    var sn = vec3<f32>(0.0, 0.0, -1.0);
    if (side == 1) { sn = vec3<f32>(1.0, 0.0, 0.0); }
    else if (side == 2) { sn = vec3<f32>(0.0, 0.0, 1.0); }
    else if (side == 3) { sn = vec3<f32>(-1.0, 0.0, 0.0); }
    if (!front) { sn = -sn; }
    return vec4<f32>(shadePlinth(p, sn, dither), 1.0);
  }

  let pw = max(length(fwidth(p)), 1e-4) * F.misc.x;
  let s = evalStack(p, n, in.uv, pw, F.terr1.x);
  let sf = surfAt(in.uv);
  let ao = mix(1.0, sf.r, F.terr1.w) * s.occ;
  var col = shadePoint(p, s.normal, s, dither, ao);

  // underwater surfaces lose contrast with depth
  if (F.terr1.y > 0.5) {
    let d = sat((F.terr1.x * F.terr.y - p.y) / 6.0);
    col = mix(col, col * vec3<f32>(0.35, 0.55, 0.62), d * 0.7);
  }

  col = aerial(col, p, max(F.camPos.y, 0.0));
  col = debugView(F.terr2.x, p, in.uv, col, s);
  return vec4<f32>(col, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sky background: full-screen triangle, analytic atmosphere
// ─────────────────────────────────────────────────────────────────────────────
struct SkyOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) ray: vec3<f32>,
}

@vertex
fn vsSky(@builtin(vertex_index) vi: u32) -> SkyOut {
  // full-screen triangle in clip space
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let p = pos[vi];
  var o: SkyOut;
  o.clip = vec4<f32>(p, 1.0, 1.0);
  // reconstruct the world ray from the inverse view-projection
  let a = F.invViewProj * vec4<f32>(p, 1.0, 1.0);
  let b = F.invViewProj * vec4<f32>(p, 0.0001, 1.0);
  o.ray = normalize(a.xyz / a.w - b.xyz / b.w);
  return o;
}

@fragment
fn fsSky(in: SkyOut) -> @location(0) vec4<f32> {
  let dir = normalize(in.ray);
  var col = skyRadiance(dir);
  // solar disc
  let a = atmo();
  col += atmoSunDisk(a, max(F.camPos.y, 0.0), dir, F.sunDir.xyz, 0.00465);
  return vec4<f32>(col, 1.0);
}
