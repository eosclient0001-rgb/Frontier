// ---------------------------------------------------------------------------
// Terrain rendering: geomipmapped chunks with skirts (vertex-displaced from the
// height buffer), per-pixel normals, procedural triplanar materials driven by
// the texture-layer splat weights, baked soft shadows and AO, sky-based ambient
// light, aerial perspective, shallow/deep water and rivers, plus diagnostic
// view modes.
// ---------------------------------------------------------------------------
struct TL {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
  e: vec4<f32>,
  f: vec4<f32>,
  g: vec4<f32>,
  h: vec4<f32>,
};
struct TexU {
  hdr: vec4<f32>,
  ext: vec4<f32>,
  L: array<TL, 8>,
};

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> H: array<f32>;
@group(0) @binding(2) var<storage, read> A: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> SH: array<f32>;
@group(0) @binding(7) var<storage, read> PR: array<vec4<f32>>;
// Baked world-space material albedo (rgb) and detail normal/roughness (xy, z).
@group(0) @binding(8) var albT: texture_2d<f32>;
@group(0) @binding(9) var nrmT: texture_2d<f32>;
@group(0) @binding(10) var smp: sampler;

const ORG: vec3<f32> = vec3<f32>(0.0, 6360050.0, 0.0);

// ---------- chunk geometry ------------------------------------------------
struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) wp: vec3<f32>,
};

@vertex
fn vs_terrain(@builtin(vertex_index) vid: u32, @location(0) inst: vec2<u32>) -> VOut {
  let n = u32(V.grid.x);
  var i: u32 = 0u;
  var j: u32 = 0u;
  var drop = 0.0;
  if (vid < 1089u) {
    i = vid % 33u;
    j = vid / 33u;
  } else {
    let k = vid - 1089u;
    let side = k / 33u;
    let t = k % 33u;
    drop = 1.0;
    if (side == 0u) {
      i = t; j = 0u;
    } else if (side == 1u) {
      i = t; j = 32u;
    } else if (side == 2u) {
      i = 0u; j = t;
    } else {
      i = 32u; j = t;
    }
  }
  let gx = min(inst.x + i, n - 1u);
  let gy = min(inst.y + j, n - 1u);
  let h = H[gy * n + gx] * V.grid.z;
  let hw = V.world.x;
  var wp = vec3<f32>(f32(gx) * V.grid.y - hw, h, f32(gy) * V.grid.y - hw);
  wp.y = wp.y - drop * V.misc.y;
  var o: VOut;
  o.pos = V.vp * vec4<f32>(wp, 1.0);
  o.wp = wp;
  return o;
}

// ---------- field sampling ------------------------------------------------
fn ldH(x: i32, y: i32) -> f32 {
  let n = i32(V.grid.x);
  return H[u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1))];
}

fn bilH(g: vec2<f32>) -> f32 {
  let n = i32(V.grid.x);
  let c = clamp(g, vec2<f32>(0.0), vec2<f32>(f32(n - 1) - 0.001));
  let i0 = vec2<i32>(floor(c));
  let f = c - vec2<f32>(i0);
  let a = ldH(i0.x, i0.y);
  let b = ldH(i0.x + 1, i0.y);
  let cc = ldH(i0.x, i0.y + 1);
  let d = ldH(i0.x + 1, i0.y + 1);
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

fn bilA(g: vec2<f32>) -> vec4<f32> {
  let n = i32(V.grid.x);
  let c = clamp(g, vec2<f32>(0.0), vec2<f32>(f32(n - 1) - 0.001));
  let i0 = vec2<i32>(floor(c));
  let f = c - vec2<f32>(i0);
  let x0 = clamp(i0.x, 0, n - 1);
  let x1 = clamp(i0.x + 1, 0, n - 1);
  let y0 = clamp(i0.y, 0, n - 1);
  let y1 = clamp(i0.y + 1, 0, n - 1);
  let a = A[u32(y0 * n + x0)];
  let b = A[u32(y0 * n + x1)];
  let cc = A[u32(y1 * n + x0)];
  let d = A[u32(y1 * n + x1)];
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

fn bilS(g: vec2<f32>) -> f32 {
  let n = i32(V.grid.x);
  let c = clamp(g, vec2<f32>(0.0), vec2<f32>(f32(n - 1) - 0.001));
  let i0 = vec2<i32>(floor(c));
  let f = c - vec2<f32>(i0);
  let x0 = clamp(i0.x, 0, n - 1);
  let x1 = clamp(i0.x + 1, 0, n - 1);
  let y0 = clamp(i0.y, 0, n - 1);
  let y1 = clamp(i0.y + 1, 0, n - 1);
  let a = SH[u32(y0 * n + x0)];
  let b = SH[u32(y0 * n + x1)];
  let cc = SH[u32(y1 * n + x0)];
  let d = SH[u32(y1 * n + x1)];
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}

// ---------- water ---------------------------------------------------------
fn waveH(p: vec2<f32>, t: f32) -> f32 {
  return snoise(p * 0.045 + vec2<f32>(t * 0.25, t * 0.18)) * 0.6
       + snoise(p * 0.18 + vec2<f32>(-t * 0.4, t * 0.5)) * 0.25
       + snoise(p * 0.9 + vec2<f32>(t * 0.7, -t * 0.6)) * 0.08;
}

fn waveN(p: vec2<f32>, t: f32) -> vec3<f32> {
  let e = 0.4;
  let h0 = waveH(p, t);
  let dx = (waveH(p + vec2<f32>(e, 0.0), t) - h0) / e;
  let dz = (waveH(p + vec2<f32>(0.0, e), t) - h0) / e;
  return normalize(vec3<f32>(-dx * 1.5, 1.0, -dz * 1.5));
}

fn waterShade(view: vec3<f32>, nW: vec3<f32>, depth: f32, floorCol: vec3<f32>, floorN: vec3<f32>,
              sunD: vec3<f32>, sunC: vec3<f32>, amb: vec3<f32>, refl: vec3<f32>, foam: f32, shd: f32) -> vec3<f32> {
  let cosT = max(dot(nW, view), 0.0);
  let F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  let absorb = vec3<f32>(0.45, 0.13, 0.07);
  let trans = exp(-absorb * depth);
  let ndl = max(dot(floorN, sunD), 0.0);
  let under = floorCol * (sunC * ndl * shd / PI + amb) * trans;
  let scat = vec3<f32>(0.006, 0.03, 0.045) * (sunC * 0.25 + amb) * (1.0 - exp(-depth * 0.25));
  let hv = normalize(sunD + view);
  let spec = pow(max(dot(nW, hv), 0.0), 600.0) * 3.0;
  var c = mix(under + scat, refl + sunC * spec * 0.5, F);
  c = mix(c, vec3<f32>(0.85, 0.88, 0.9) * (sunC * 0.05 + amb), clamp(foam, 0.0, 1.0));
  return c;
}

// ---------- terrain fragment ----------------------------------------------
@fragment
fn fs_terrain(inp: VOut) -> @location(0) vec4<f32> {
  let cell = V.grid.y;
  let maxH = V.grid.z;
  let sea = V.grid.w;
  let hw = V.world.x;
  let g = (inp.wp.xz + vec2<f32>(hw)) / cell;
  let hm = bilH(g) * maxH;
  let gxp = bilH(g + vec2<f32>(1.0, 0.0));
  let gxm = bilH(g - vec2<f32>(1.0, 0.0));
  let gzp = bilH(g + vec2<f32>(0.0, 1.0));
  let gzm = bilH(g - vec2<f32>(0.0, 1.0));
  let dhx = (gxp - gxm) * 0.5 * maxH / cell;
  let dhz = (gzp - gzm) * 0.5 * maxH / cell;
  let Ng = normalize(vec3<f32>(-dhx, 1.0, -dhz));
  let at = bilA(g);
  let slope = at.x;
  let flow = at.z;
  let ao = at.w;
  let sh = bilS(g);
  let view = normalize(V.cam.xyz - inp.wp);
  let sunD = normalize(V.sun.xyz);
  let sunC = PR[2].rgb;
  let amb = PR[0].rgb;
  let horizon = PR[1].rgb;
  let t = V.cam.w;
  let mode = u32(V.misc.x + 0.5);
  let uvT = (inp.wp.xz + vec2<f32>(hw)) / (2.0 * hw);
  let baked = textureSample(albT, smp, uvT);
  let dn = textureSample(nrmT, smp, uvT);
  let alb = baked.rgb;
  let rough = dn.z;
  var Nd = Ng;
  if (mode == 0u) {
    Nd = normalize(vec3<f32>(Ng.x - dn.x, Ng.y, Ng.z - dn.y));
  }

  let ndl = max(dot(Nd, sunD), 0.0);
  let a2 = max(rough * rough * rough * rough, 1e-4);
  let nh = max(dot(Nd, normalize(sunD + view)), 0.0);
  let dd = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  var col = alb * sunC * (ndl * sh / PI)
          + sunC * dd * 0.04 * ndl * sh / (4.0 * max(dot(Nd, view), 0.05))
          + alb * amb * ao * (0.5 + 0.5 * Nd.y);

  if (mode == 1u) {
    col = vec3<f32>(0.5) * (sunC * (ndl * sh / PI) + amb * ao * (0.5 + 0.5 * Nd.y));
  } else if (mode == 2u) {
    let s = degrees(slope) / 60.0;
    let ramp = mix(vec3<f32>(0.12, 0.28, 0.5), vec3<f32>(0.95, 0.78, 0.30), smoothstep(0.0, 0.5, s));
    col = mix(ramp, vec3<f32>(0.85, 0.18, 0.12), smoothstep(0.5, 1.0, s)) * (0.25 + 0.75 * ndl * sh);
  } else if (mode == 3u) {
    col = mix(vec3<f32>(0.05, 0.06, 0.08), vec3<f32>(0.25, 0.75, 1.0), flow);
  } else if (mode == 4u) {
    col = vec3<f32>(ao);
  } else if (mode == 5u) {
    col = vec3<f32>(sh) * (0.2 + 0.8 * ndl);
  } else if (mode == 6u) {
    let band = fract(hm / (maxH / 24.0));
    let line = 1.0 - smoothstep(0.0, 0.06, min(band, 1.0 - band));
    col = mix(mix(vec3<f32>(0.1, 0.25, 0.1), vec3<f32>(0.6, 0.5, 0.3), hm / maxH), vec3<f32>(0.02), line * 0.8) * (0.3 + 0.7 * ndl * sh + 0.2);
  }

  let showWater = V.misc.z > 0.5;
  if (showWater && hm < sea && mode != 1u) {
    let depth = sea - hm;
    let nW = waveN(inp.wp.xz, t);
    let rv = reflect(-view, nW);
    let refl = skyRad(rv, sunD, V.world.y, ORG);
    let foamN = snoise(inp.wp.xz * 0.6 + vec2<f32>(t * 0.3, 0.0)) * 0.5 + 0.5;
    let foam = (1.0 - smoothstep(0.0, 1.1, depth)) * smoothstep(0.45, 0.75, foamN);
    col = waterShade(view, nW, depth, alb, Nd, sunD, sunC, amb, refl, foam, sh);
  }

  let showRivers = V.misc.w > 0.5;
  if (showRivers && hm >= sea && mode == 0u) {
    let river = smoothstep(0.6, 0.7, flow) * (1.0 - smoothstep(0.18, 0.4, slope));
    if (river > 0.001) {
      let nW = normalize(Ng + vec3<f32>(0.0, 0.0, 0.0));
      let refl = horizon * 0.6;
      let rc = waterShade(view, nW, 1.5, alb * 0.5, Nd, sunD, sunC, amb, refl, 0.0, sh);
      col = mix(col, rc, river);
    }
  }

  let dist = length(inp.wp - V.cam.xyz);
  let fogT = exp(-dist * V.world.y * 0.00012);
  col = col * fogT + horizon * (1.0 - fogT);
  let outc = aces(col * V.world.z);
  return vec4<f32>(pow(outc, vec3<f32>(1.0 / 2.2)), 1.0);
}

// ---------- sea plane -------------------------------------------------------
struct SeaOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) wp: vec3<f32>,
};

@vertex
fn vs_sea(@builtin(vertex_index) vid: u32) -> SeaOut {
  var c = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0));
  let ext = V.world.x * 6.0;
  let p = c[vid] * ext;
  var o: SeaOut;
  o.wp = vec3<f32>(p.x, V.grid.w, p.y);
  o.pos = V.vp * vec4<f32>(o.wp, 1.0);
  return o;
}

@fragment
fn fs_sea(inp: SeaOut) -> @location(0) vec4<f32> {
  if (V.misc.z < 0.5) { discard; }
  let hw = V.world.x;
  let cell = V.grid.y;
  let maxH = V.grid.z;
  let sea = V.grid.w;
  if (abs(inp.wp.x) < hw && abs(inp.wp.z) < hw) {
    let g = (inp.wp.xz + vec2<f32>(hw)) / cell;
    if (bilH(g) * maxH < sea) { discard; }
  }
  let view = normalize(V.cam.xyz - inp.wp);
  let sunD = normalize(V.sun.xyz);
  let t = V.cam.w;
  let nW = waveN(inp.wp.xz, t);
  let refl = skyRad(reflect(-view, nW), sunD, V.world.y, ORG);
  var col = waterShade(view, nW, 80.0, vec3<f32>(0.0), vec3<f32>(0.0, 1.0, 0.0), sunD, PR[2].rgb, PR[0].rgb, refl, 0.0, 1.0);
  let dist = length(inp.wp - V.cam.xyz);
  let fogT = exp(-dist * V.world.y * 0.00012);
  col = col * fogT + PR[1].rgb * (1.0 - fogT);
  let outc = aces(col * V.world.z);
  return vec4<f32>(pow(outc, vec3<f32>(1.0 / 2.2)), 1.0);
}
