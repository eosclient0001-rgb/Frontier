// WGSL shader sources: fabric pattern library, cloth solver (compute), renderers.

// =============================================================== FABRIC LIBRARY
export const FABRIC_WGSL = /* wgsl */ `
struct Fabric {
  colA : vec4f,
  colB : vec4f,
  colC : vec4f,
  // scale, stripeWidth, dotRadius, motifRadius
  p0   : vec4f,
  // amountStripe, amountPlaid, amountDot, amountMotif
  p1   : vec4f,
  // weaveAmount, weaveScale, noiseAmount, noiseScale
  p2   : vec4f,
  // stripeAngle, motifCount, motifStyle, rotation
  p3   : vec4f,
  // type, roughness, sheen, opacity
  p4   : vec4f,
};

fn hash21(p : vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn vnoise(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p0 : vec2f, oct : i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var p = p0;
  for (var i = 0; i < oct; i = i + 1) {
    s = s + a * vnoise(p);
    p = p * 2.03 + vec2f(11.3, 7.7);
    a = a * 0.5;
  }
  return s;
}

fn rot2(p : vec2f, a : f32) -> vec2f {
  let c = cos(a); let s = sin(a);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

// --- stripes ---------------------------------------------------------------
fn stripesFn(p : vec2f, w : f32) -> f32 {
  let s = sin(p.x * 6.28318);
  return smoothstep(-w, w, s) * 0.5 + 0.5 * smoothstep(-w, w, -s) * 0.0 + 0.5;
}

// --- plaid / check ---------------------------------------------------------
fn plaidFn(p : vec2f, w : f32) -> f32 {
  let a = step(w, fract(p.x));
  let b = step(w, fract(p.y));
  let c = step(0.5 + w * 0.5, fract(p.x + p.y * 0.5));
  return a * b * 0.7 + c * 0.3;
}

// --- polka dots ------------------------------------------------------------
fn dotsFn(p : vec2f, r : f32) -> f32 {
  let q = fract(p) - 0.5;
  let d = length(q);
  return 1.0 - smoothstep(r - 0.03, r + 0.03, d);
}

// --- houndstooth / puppytooth ---------------------------------------------
fn houndFn(p : vec2f) -> f32 {
  let q = p * 2.0;
  let i = floor(q);
  let f = fract(q) - 0.5;
  let sgn = mod(i.x + i.y, 2.0) * 2.0 - 1.0;
  let d = f.x * sgn + f.y;
  let shear = 1.0 - smoothstep(0.18, 0.30, abs(d));
  let chk = mod(i.x + i.y, 2.0);
  return clamp(shear * (2.0 * chk - 1.0) * 0.5 + 0.5, 0.0, 1.0);
}

// --- damask ornament (mirrored polar rosette) ------------------------------
fn damaskFn(p : vec2f, n : f32) -> f32 {
  var q = fract(p) - 0.5;
  q = abs(q);
  let a = atan2(q.y, q.x);
  let r = length(q);
  let petals = pow(abs(cos(a * n)), 0.55);
  let ring1 = smoothstep(0.30, 0.24, r);
  let ring2 = smoothstep(0.20, 0.14, abs(r - 0.26)) ;
  let ring3 = smoothstep(0.10, 0.07, abs(r - 0.38));
  let body = petals * ring1;
  return clamp(max(max(body, ring2 * 0.85), ring3 * 0.55), 0.0, 1.0);
}

// --- floral scatter --------------------------------------------------------
fn floralFn(p : vec2f, n : f32) -> f32 {
  var m = 0.0;
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let off = vec2f(hash21(vec2f(fi, 1.7)), hash21(vec2f(fi, 5.3)));
    var q = fract(p + off) - 0.5;
    let r = length(q);
    let a = atan2(q.y, q.x);
    let petals = pow(abs(cos(a * n)), 0.5);
    let flower = smoothstep(0.16, 0.02, r) * petals;
    m = max(m, flower);
  }
  return clamp(m, 0.0, 1.0);
}

// --- lace ------------------------------------------------------------------
fn laceFn(p : vec2f, n : f32) -> f32 {
  let net = min(min(fract(p.x), 1.0 - fract(p.x)), min(fract(p.y), 1.0 - fract(p.y)));
  let netMask = 1.0 - smoothstep(0.04, 0.13, net);
  let fl = floralFn(p * 1.0, n);
  return clamp(max(netMask * 0.55, fl), 0.0, 1.0);
}

// --- woven twill micro-structure ------------------------------------------
fn weaveFn(p : vec2f) -> vec2f {
  let q = p * 2.0;
  let cell = floor(q);
  let f = fract(q);
  let up = step(mod(cell.x + 2.0 * cell.y, 4.0), 1.5);
  let yh = sin(f.x * 3.14159);
  let yv = sin(f.y * 3.14159);
  let h = mix(yv, yh, up);
  let over = mix(-yv, -yh, up);
  return vec2f(h, over);
}

// --- master pattern evaluation --------------------------------------------
struct FabricSample {
  albedo : vec3f,
  height : f32,
  rough : f32,
  alpha : f32,
};

fn evalFabric(uvIn : vec2f, F : Fabric) -> FabricSample {
  let uv = rot2(uvIn, F.p3.w);
  let sc = max(F.p0.x, 0.05);
  let p = uv * sc;

  var col = F.colA.rgb;
  var h = 0.5;
  var rough = F.p4.y;
  var alpha = F.p4.w;

  let sa = F.p3.x;
  let sp = rot2(p, sa);
  let st = stripesFn(sp * vec2f(1.0, 0.06), F.p0.y);
  let pl = plaidFn(p * 0.5, F.p0.y * 1.2);
  let dt = dotsFn(p * 0.5, F.p0.z);
  var mt = damaskFn(p * 0.5, F.p3.y);
  if (F.p3.z >= 0.5 && F.p3.z < 1.5) { mt = floralFn(p * 0.5, F.p3.y); }
  else if (F.p3.z >= 1.5) { mt = laceFn(p * 0.5, F.p3.y); }

  let kind = u32(F.p4.x + 0.5);
  var accent = F.colB.rgb;

  // base pattern by type
  var base = 0.0;
  if (kind == 1u) { base = st; }
  else if (kind == 2u) { base = pl; }
  else if (kind == 3u) { base = dt; }
  else if (kind == 4u) { base = mt; }
  else if (kind == 5u) { base = houndFn(p * 0.5); }
  else if (kind == 6u) { base = floralFn(p * 0.5, F.p3.y); }
  else if (kind == 7u) { base = laceFn(p * 0.5, F.p3.y); }
  else if (kind == 8u) {
    let g = fbm(p * 0.35, 4);
    col = mix(F.colA.rgb, F.colB.rgb, smoothstep(0.25, 0.75, g));
    col = mix(col, F.colC.rgb, smoothstep(0.45, 0.95, fbm(p * 0.22 + 3.0, 3)));
  }

  if (kind >= 1u && kind <= 7u) {
    col = mix(col, accent, base);
    h = mix(h, 0.35 + 0.3 * base, 0.7);
  }

  // overlays (stacked like a node graph)
  let os = F.p1.x; let op = F.p1.y; let od = F.p1.z; let om = F.p1.w;
  if (os > 0.001) { col = mix(col, F.colB.rgb, st * os); h = mix(h, 0.3 + 0.4 * st, os * 0.6); }
  if (op > 0.001) { col = mix(col, F.colC.rgb, pl * op * 0.8); h = mix(h, 0.35 + 0.3 * pl, op * 0.5); }
  if (od > 0.001) { col = mix(col, F.colC.rgb, dt * od); h = mix(h, 0.7 - 0.3 * dt, od * 0.4); }
  if (om > 0.001) { col = mix(col, F.colB.rgb, mt * om); h = mix(h, 0.35 + 0.35 * mt, om * 0.5); }

  // weave micro structure
  let wa = F.p2.x;
  if (wa > 0.001) {
    let w = weaveFn(uv * max(F.p2.y, 1.0) * 900.0);
    col = col * (0.86 + 0.14 * w.x);
    h = h + (w.x - 0.5) * 0.10 * wa;
    rough = rough + (0.5 - w.x) * 0.06;
  }

  // cloth mottling / dye variation
  let na = F.p2.z;
  if (na > 0.001) {
    let n = fbm(uv * max(F.p2.w, 0.1) * 22.0, 4) - 0.5;
    let n2 = fbm(uv * max(F.p2.w, 0.1) * 140.0, 2) - 0.5;
    col = col * (1.0 + n * 0.35 * na + n2 * 0.16 * na);
    rough = clamp(rough + n2 * 0.10 * na, 0.05, 1.0);
  }

  var out : FabricSample;
  out.albedo = col;
  out.height = h;
  out.rough = clamp(rough, 0.03, 1.0);
  out.alpha = alpha;
  return out;
}
`;

// =============================================================== CLOTH SOLVER
export const CLOTH_COMMON = /* wgsl */ `
struct Con {
  ij   : vec2<u32>,
  rest : f32,
  comp : f32,
  type : f32,
  lam  : f32,
};
`;

export const CLEAR_LAMBDA = /* wgsl */ `
${CLOTH_COMMON}
@group(0) @binding(0) var<storage, read_write> cons : array<Con>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&cons)) { return; }
  cons[i].lam = 0.0;
}
`;

export const PREDICT = /* wgsl */ `
struct Sim {
  gravity   : vec4f,   // xyz = gravity, w = dt
  wind      : vec4f,   // xyz = wind dir*strength, w = time
  params    : vec4f,   // airDrag, damping, thickness, friction
  params2   : vec4f,   // substeps, pinStiff, selfFlag, floorY
};

@group(0) @binding(0) var<storage, read_write> pos  : array<vec4f>;
@group(0) @binding(1) var<storage, read_write> vel  : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> prev : array<vec4f>;
@group(0) @binding(3) var<storage, read>       vinfo : array<vec4u>;
@group(0) @binding(4) var<uniform>             sim : Sim;
@group(0) @binding(5) var<storage, read>       nrm   : array<vec4f>;

fn gridNeighbour(r : u32, c : u32) -> u32 {
  return r * vinfo[0u].w + c;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pos)) { return; }
  let info = vinfo[i];
  let w = pos[i].w;
  if (w <= 0.0) { return; }

  var x = pos[i].xyz;
  var v = vel[i].xyz;

  // ---- wind: per-face force from the local grid normal
  var n = vec3f(0.0, 0.0, 0.0);
  if (info.z > 2u) {
    let r = info.x; let c = info.y;
    let rows = info.z; let cols = info.w;
    let rm = select(r - 1u, 0u, r == 0u);
    let rp = select(r + 1u, rows - 1u, r + 1u >= rows);
    let cm = (c + cols - 1u) % cols;
    let cp = (c + 1u) % cols;
    let a = pos[gridNeighbour(r, cp)].xyz - pos[gridNeighbour(r, cm)].xyz;
    let b = pos[gridNeighbour(rp, c)].xyz - pos[gridNeighbour(rm, c)].xyz;
    n = normalize(cross(a, b) + vec3f(1e-6, 0.0, 1e-6));
  } else {
    // strap vertices keep the normal baked from the rest shape
    n = normalize(nrm[i].xyz + vec3f(1e-6, 1e-6, 0.0));
  }

  let wdir = sim.wind.xyz;
  let wmag = length(wdir);
  if (wmag > 0.0001) {
    let wn = normalize(wdir);
    let dn = dot(n, wn);
    let facing = abs(dn);
    let swirl = 0.75 + 0.55 * sin(sim.wind.w * 4.0 + f32(i) * 0.37);
    var force = wn * (dn * sim.params.x * 9.0 * facing * facing * swirl);
    let vrel = v - wdir * 0.35;
    force = force - vrel * facing * sim.params.x * 1.8;
    v = v + force * sim.gravity.w;
  }

  // ---- gravity + damping
  v = v + sim.gravity.xyz * sim.gravity.w;
  v = v * (1.0 - min(sim.params.y, 0.9));

  // integrate: keep the substep start position for the velocity update in
  // FINALIZE, then advance the vertex
  prev[i] = vec4f(x, 0.0);
  vel[i] = vec4f(v, 0.0);
  pos[i] = vec4f(x + v * sim.gravity.w, w);
}
`;

export const SOLVE_CONS = /* wgsl */ `
${CLOTH_COMMON}
struct Sim {
  gravity   : vec4f,
  wind      : vec4f,
  params    : vec4f,
  params2   : vec4f,
};

@group(0) @binding(0) var<storage, read_write> pos  : array<vec4f>;
@group(0) @binding(1) var<storage, read_write> cons : array<Con>;
@group(0) @binding(2) var<uniform>             sim : Sim;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let ci = gid.x;
  if (ci >= arrayLength(&cons)) { return; }
  let con = cons[ci];
  let i = con.ij.x;
  let j = con.ij.y;
  let wi = pos[i].w;
  let wj = pos[j].w;
  let wsum = wi + wj;
  if (wsum <= 0.0) { return; }

  let alpha = con.comp;
  let dt2 = sim.gravity.w * sim.gravity.w;
  let alphaT = alpha / max(dt2, 1e-9);

  var p1 = pos[i].xyz;
  var p2 = pos[j].xyz;
  var d = p1 - p2;
  let len = length(d);
  if (len < 1e-9) { return; }
  let n = d / len;
  let C = len - con.rest;
  if (abs(C) < 1e-9) { return; }

  let lam = con.lam;
  let dl = (-C - alphaT * lam) / (wsum + alphaT);
  let corr = n * dl;

  if (wi > 0.0) { pos[i] = vec4f(p1 + corr * wi, wi); }
  if (wj > 0.0) { pos[j] = vec4f(p2 - corr * wj, wj); }
  cons[ci].lam = lam + dl;
}
`;

export const SOLVE_PINS = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> pos : array<vec4f>;
@group(0) @binding(1) var<storage, read>       pins : array<u32>;
@group(0) @binding(2) var<storage, read>       pinPos : array<vec4f>;
@group(0) @binding(3) var<uniform>             params : vec4f; // x = blend

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let k = gid.x;
  if (k >= arrayLength(&pins)) { return; }
  let vi = pins[k];
  let target = pinPos[k].xyz;
  let cur = pos[vi].xyz;
  let b = clamp(params.x, 0.0, 1.0);
  pos[vi] = vec4f(mix(cur, target, b), pos[vi].w);
}
`;

export const COLLIDE = /* wgsl */ `
struct Ring {
  y : f32, rx : f32, rz : f32, cx : f32,
  cz : f32, e : f32, front : f32, back : f32,
};
struct Cap {
  a : vec3f, ra : f32,
  b : vec3f, rb : f32,
};
struct Col {
  modelInv : mat4x4f,
  model    : mat4x4f,
  params   : vec4f,   // thickness, friction, restitution, dt
  extra    : vec4f,   // floorY, time, 0, 0
  counts   : vec4u,   // ringCount, capsuleCount, collisionsEnabled, 0
};

@group(0) @binding(0) var<storage, read_write> pos  : array<vec4f>;
@group(0) @binding(1) var<storage, read_write> prev : array<vec4f>;
@group(0) @binding(2) var<storage, read>       rings : array<Ring>;
@group(0) @binding(3) var<storage, read>       caps  : array<Cap>;
@group(0) @binding(4) var<uniform>             col : Col;

// Lame superellipse radius along a direction (mirrors body.js superRadius):
//   |x/rx|^e + |z/rz|^e = 1  ->  r(theta)
fn superRadius(rx : f32, rz : f32, e : f32, theta : f32) -> f32 {
  let c = abs(cos(theta)) / max(rx, 1e-5);
  let s = abs(sin(theta)) / max(rz, 1e-5);
  return pow(pow(c, e) + pow(s, e), -1.0 / e);
}

// Project a body-local point onto (just outside of) the torso surface.
fn projectLoft(pIn : vec3f, thickness : f32) -> vec3f {
  var p = pIn;
  let n = col.counts.x;
  if (n < 2u) { return p; }

  let y0 = rings[0].y;
  let y1 = rings[n - 1u].y;
  // below the crotch there is no torso: the legs (capsules) handle contacts
  if (p.y < y0 || p.y > y1) { return p; }
  let y = p.y;

  // rings are uniformly spaced in y (body.js resampleRings), so the bracketing
  // pair is a division rather than a scan
  let step = max(rings[1].y - rings[0].y, 1e-6);
  var i = u32(clamp((y - rings[0].y) / step, 0.0, f32(n - 2u)));
  let A = rings[i];
  let B = rings[i + 1u];
  let t = clamp((y - A.y) / max(B.y - A.y, 1e-6), 0.0, 1.0);
  let rx = mix(A.rx, B.rx, t);
  let rz = mix(A.rz, B.rz, t);
  let cx = mix(A.cx, B.cx, t);
  let cz = mix(A.cz, B.cz, t);
  let e  = mix(A.e,  B.e,  t);
  let ft = mix(A.front, B.front, t);
  let bk = mix(A.back,  B.back,  t);

  let lx = (p.x - cx);
  let lz = (p.z - cz);
  let len = length(vec2f(lx, lz));
  if (len < 1e-6) {
    p.x = cx + superRadius(rx, rz, e, 0.0) + thickness;
    return p;
  }

  let theta = atan2(lz, lx);
  let dirZ = sin(theta);
  var bulge = 1.0;
  if (dirZ > 0.0) { bulge = 1.0 + ft * dirZ * dirZ; }
  else { bulge = 1.0 + bk * dirZ * dirZ; }
  let target = superRadius(rx, rz, e, theta) * bulge + thickness;

  if (len >= target) { return p; }
  let sc = target / len;
  p.x = cx + lx * sc;
  p.z = cz + lz * sc;
  p.y = pIn.y;
  return p;
}

fn projectCapsules(pIn : vec3f, thickness : f32) -> vec3f {
  var p = pIn;
  let n = col.counts.y;
  for (var i = 0u; i < n; i = i + 1u) {
    let c = caps[i];
    let ab = c.b - c.a;
    let abLen2 = max(dot(ab, ab), 1e-9);
    let t = clamp(dot(p - c.a, ab) / abLen2, 0.0, 1.0);
    let closest = c.a + ab * t;
    let r = mix(c.ra, c.rb, t) + thickness;
    let d = p - closest;
    let dl = length(d);
    if (dl < r) {
      if (dl < 1e-5) {
        p = closest + vec3f(0.0, 0.0, 1.0) * r;
      } else {
        p = closest + d / dl * r;
      }
    }
  }
  return p;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pos)) { return; }
  let w = pos[i].w;
  if (w <= 0.0) { return; }

  let thickness = col.params.x;
  let friction  = col.params.y;
  let restit    = col.params.z;
  let dt        = max(col.params.w, 1e-6);
  let floorY    = col.extra.x;

  let world = pos[i].xyz;
  var hitN = vec3f(0.0, 0.0, 0.0);
  var hit = false;

  if (col.counts.z == 1u) {
    let local = (col.modelInv * vec4f(world, 1.0)).xyz;
    var after = projectLoft(local, thickness);
    after = projectCapsules(after, thickness);
    if (distance(after, local) > 1e-7) {
      let nLocal = normalize(after - local + vec3f(1e-8, 0.0, 0.0));
      hitN = normalize((col.model * vec4f(nLocal, 0.0)).xyz);
      hit = true;
      pos[i] = vec4f((col.model * vec4f(after, 1.0)).xyz, pos[i].w);
    }
  }

  // floor plane (world space)
  let wp = pos[i].xyz;
  if (wp.y < floorY + thickness) {
    pos[i] = vec4f(wp.x, floorY + thickness, wp.z, pos[i].w);
    hitN = vec3f(0.0, 1.0, 0.0);
    hit = true;
  }

  if (hit) {
    let v = vel[i].xyz;
    let vn = dot(v, hitN);
    var vNorm = hitN * vn;
    var vTan = v - vNorm;
    if (vn < 0.0) { vNorm = vNorm * (-restit); }
    vTan = vTan * (1.0 - clamp(friction, 0.0, 1.0));
    // friction must survive the finalize pass, so move prev instead of vel
    prev[i] = vec4f(pos[i].xyz - (vNorm + vTan) * dt, 0.0);
  }
}
`;

export const FINALIZE = /* wgsl */ `
struct Sim { gravity : vec4f, wind : vec4f, params : vec4f, params2 : vec4f };
@group(0) @binding(0) var<storage, read_write> pos  : array<vec4f>;
@group(0) @binding(1) var<storage, read_write> vel  : array<vec4f>;
@group(0) @binding(2) var<storage, read>       prev : array<vec4f>;
@group(0) @binding(3) var<uniform>             sim : Sim;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pos)) { return; }
  let w = pos[i].w;
  if (w <= 0.0) { return; }
  let dt = max(sim.gravity.w, 1e-6);
  vel[i] = vec4f((pos[i].xyz - prev[i].xyz) / dt, pos[i].w);
}
`;

export const RESET_VERTEX = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> pos  : array<vec4f>;
@group(0) @binding(1) var<storage, read_write> vel  : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> prev : array<vec4f>;
@group(0) @binding(3) var<storage, read>       rest : array<vec4f>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pos)) { return; }
  pos[i]  = rest[i];
  vel[i]  = vec4f(0.0);
  prev[i] = rest[i];
}
`;

// =============================================================== RENDER
export const SCENE_WGSL = /* wgsl */ `
struct Camera {
  viewProj    : mat4x4f,
  model       : mat4x4f,
  invViewProj : mat4x4f,
  eye         : vec4f,
  lightDir : vec4f,
  lightCol : vec4f,
  ambient  : vec4f,
};
@group(0) @binding(0) var<uniform> cam : Camera;
`;

export const CLOTH_RENDER = /* wgsl */ `
${FABRIC_WGSL}
${SCENE_WGSL}

@group(0) @binding(1) var<uniform> fab   : Fabric;
@group(0) @binding(2) var<storage, read> pos   : array<vec4f>;
@group(0) @binding(3) var<storage, read> vinfo : array<vec4u>;
@group(0) @binding(4) var<storage, read> uvs   : array<vec4f>;
@group(0) @binding(5) var<storage, read> nrm   : array<vec4f>;

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  let p = pos[vi].xyz;
  let info = vinfo[vi];

  var n = vec3f(0.0, 0.0, 1.0);
  if (info.z > 2u) {
    // regular shell vertex: normal from the four grid neighbours
    let r = info.x; let c = info.y;
    let rows = info.z; let cols = info.w;
    let rm = select(r - 1u, 0u, r == 0u);
    let rp = select(r + 1u, rows - 1u, r + 1u >= rows);
    let cm = (c + cols - 1u) % cols;
    let cp = (c + 1u) % cols;
    let a = pos[r * cols + cp].xyz - pos[r * cols + cm].xyz;
    let b = pos[rp * cols + c].xyz - pos[rm * cols + c].xyz;
    n = normalize(cross(a, b) + vec3f(1e-7, 0.0, 1e-7));
  } else if (info.w > 1u) {
    // strap: short, stiff and heavily pinned — use the rest-pose normal
    n = normalize(nrm[vi].xyz + vec3f(1e-7, 0.0, 1e-7));
  }

  var o : VSOut;
  o.clip = cam.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.normal = n;
  o.uv = uvs[vi].xy;
  return o;
}

@fragment
fn fs(i : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
  let V = normalize(cam.eye.xyz - i.world);
  var N = normalize(i.normal);
  if (!front) { N = -N; }

  let S = evalFabric(i.uv, fab);

  // weave-derived micro normal
  let w = weaveFn(i.uv * max(fab.p2.y, 1.0) * 900.0);
  var T = normalize(cross(N, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-5, 0.0, 0.0));
  let B = cross(N, T);
  let bump = fab.p2.x * 0.35;
  N = normalize(N + T * (w.x - 0.5) * bump + B * (w.y - 0.5) * bump * 0.4);

  let L = normalize(cam.lightDir.xyz);
  let H = normalize(L + V);
  let ndl = max(dot(N, L), 0.0);
  let ndv = max(dot(N, V), 0.0);
  let ndh = max(dot(N, H), 0.0);

  let rough = clamp(S.rough, 0.04, 1.0);
  let a = rough * rough;
  let a2 = a * a;
  let denom = ndh * ndh * (a2 - 1.0) + 1.0;
  var D = a2 / (3.14159 * denom * denom);
  let k = a * 0.5;
  let G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
  let F0 = 0.04 + 0.06 * fab.p4.z;
  let F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  let spec = D * G * F * 0.55;

  var col = S.albedo * (cam.lightCol.rgb * ndl * 1.15 + cam.ambient.rgb);
  col = col + cam.lightCol.rgb * spec * ndl;

  // sheen / satin rim (woven fabrics catch light at grazing angles)
  let sheen = pow(1.0 - ndv, 4.0) * fab.p4.z * 0.8;
  col = col + cam.lightCol.rgb * sheen;

  // cloth self-shadow fake: darker in the folds (curvature from the normal)
  let fold = clamp(0.55 + 0.45 * ndl, 0.0, 1.0);
  col = col * mix(1.0, fold, 0.55);

  // simple tone map
  col = col / (col + vec3f(0.85));
  col = pow(col, vec3f(0.4545));
  return vec4f(col, 1.0);
}
`;

export const BODY_RENDER = /* wgsl */ `
${SCENE_WGSL}

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
  @location(1) normal : vec3f,
};

@vertex
fn vs(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f) -> VSOut {
  let world = (cam.model * vec4f(p, 1.0)).xyz;
  var o : VSOut;
  o.clip = cam.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.normal = (cam.model * vec4f(n, 0.0)).xyz;
  return o;
}

@fragment
fn fs(i : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
  var N = normalize(i.normal);
  if (!front) { N = -N; }
  let V = normalize(cam.eye.xyz - i.world);
  let L = normalize(cam.lightDir.xyz);
  let ndl = max(dot(N, L), 0.0);
  let ndv = max(dot(N, V), 0.0);

  let base = vec3f(0.62, 0.60, 0.585);
  let H = normalize(L + V);
  let spec = pow(max(dot(N, H), 0.0), 42.0) * 0.16;

  // studio backdrop gradient + rim
  var col = base * (cam.lightCol.rgb * ndl * 0.95 + cam.ambient.rgb * 1.1);
  col = col + cam.lightCol.rgb * spec;
  let rim = pow(1.0 - ndv, 3.0) * 0.35;
  col = col + vec3f(rim * 0.9, rim * 0.95, rim);
  col = col / (col + vec3f(0.85));
  col = pow(col, vec3f(0.4545));
  return vec4f(col, 1.0);
}
`;

// 2D material editor preview: a flat swatch evaluated per pixel.
export const PATTERN_QUAD = /* wgsl */ `
${FABRIC_WGSL}
struct Preview {
  rect   : vec4f,   // x, y, w, h in pixels
  res    : vec4f,   // canvas w, h, 0, 0
  flags  : vec4f,   // zoom, 0,0,0
};
@group(0) @binding(0) var<uniform> fab : Fabric;
@group(0) @binding(1) var<uniform> pv : Preview;

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) px : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0)
  );
  let c = corners[vi];
  let px = pv.rect.xy + c * pv.rect.zw;
  let ndc = vec2f(px.x / pv.res.x * 2.0 - 1.0, 1.0 - px.y / pv.res.y * 2.0);
  var o : VSOut;
  o.clip = vec4f(ndc, 0.0, 1.0);
  o.px = px;
  return o;
}

@fragment
fn fs(i : VSOut) -> @location(0) vec4f {
  let uv = (i.px - pv.rect.xy) / pv.rect.zw;
  // mirror-tile like a real swatch
  let zoom = max(pv.flags.x, 0.05);
  let muv = abs(fract(uv * zoom) * 2.0 - 1.0) * 0.5;
  let S = evalFabric(muv, fab);

  let w = weaveFn(muv * max(fab.p2.y, 1.0) * 900.0);
  let N = normalize(vec3f((w.x - 0.5) * fab.p2.x * 0.8, (w.y - 0.5) * fab.p2.x * 0.5, 1.0));
  let L = normalize(vec3f(-0.35, 0.62, 0.70));
  let V = vec3f(0.0, 0.0, 1.0);
  let H = normalize(L + V);
  let ndl = max(dot(N, L), 0.0);
  let rough = clamp(S.rough, 0.05, 1.0);
  let a2 = pow(rough, 4.0);
  let denom = max(dot(N, H), 0.0) * max(dot(N, H), 0.0) * (a2 - 1.0) + 1.0;
  let spec = (a2 / (3.14159 * denom * denom)) * max(dot(N, H), 0.0) * 0.35;

  var col = S.albedo * (0.35 + 0.95 * ndl) + vec3f(spec);
  col = col / (col + vec3f(0.9));
  col = pow(col, vec3f(0.4545));
  return vec4f(col, 1.0);
}
`;

// Studio floor: a ray-cast plane so the dress has something to fall onto.
// Drawn as a full-screen triangle with the real hit depth written out.
export const GROUND_PLANE = /* wgsl */ `
${SCENE_WGSL}

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) ndc : vec2f,
};

struct FSOut {
  @location(0) col : vec4f,
  @builtin(frag_depth) depth : f32,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let p = pts[vi];
  var o : VSOut;
  o.clip = vec4f(p, 1.0, 1.0);
  o.ndc = p;
  return o;
}

@fragment
fn fs(i : VSOut) -> FSOut {
  let inv = cam.invViewProj;
  let h0 = inv * vec4f(i.ndc, 0.0, 1.0);
  let h1 = inv * vec4f(i.ndc, 1.0, 1.0);
  let p0 = h0.xyz / max(h0.w, 1e-6);
  let p1 = h1.xyz / max(h1.w, 1e-6);
  let dir = p1 - p0;

  if (abs(dir.y) > 1e-6) {
    let t = -p0.y / dir.y;
    if (t > 0.0) {
      let hit = p0 + dir * t;
      let dist = distance(hit, cam.eye.xyz);

      // contact shadow pooled under the figure
      let r = length(hit.xz);
      let shadow = 1.0 - 0.58 * exp(-r * r * 2.4);

      // metric grid, fading with distance
      let g = abs(fract(hit.xz * 2.0) - 0.5);
      let grid = 1.0 - smoothstep(0.45, 0.5, max(g.x, g.y));
      let fade = exp(-dist * 0.22);

      var col = vec3f(0.085, 0.089, 0.103) * shadow;
      col = col + vec3f(0.11, 0.12, 0.145) * grid * fade * shadow;
      col = mix(col, vec3f(0.10, 0.105, 0.12), 1.0 - exp(-dist * 0.10));

      let clip = cam.viewProj * vec4f(hit, 1.0);
      var o : FSOut;
      o.col = vec4f(col, 1.0);
      o.depth = clamp(clip.z / max(clip.w, 1e-6), 0.0, 1.0);
      return o;
    }
  }
  discard;
  var o : FSOut;
  o.col = vec4f(0.0, 0.0, 0.0, 1.0);
  o.depth = 1.0;
  return o;
}
`;
