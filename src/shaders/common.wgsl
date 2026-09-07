// ===========================================================================
//  common.wgsl — uniforms, hashing, noise, grid/world transforms.
//  Included first by every root shader.
//  NOTE: declarations are kept in dependency order so the composed source
//  reads top-down and stays portable across shader compilers.
// ===========================================================================

#include "_generated_params.wgsl"

// Every pipeline binds the parameter block at group 0, binding 0.
@group(0) @binding(0) var<uniform> U: Params;

const PI:   f32 = 3.14159265359;
const TAU:  f32 = 6.28318530718;
const BIG:  f32 = 1e9;

const WORLD_SIZE: vec3f = vec3f(WORLD_W, WORLD_H, WORLD_D);
const VOLF:       vec3f = vec3f(f32(VOLX), f32(VOLY), f32(VOLZ));
const VOXEL_SIZE: vec3f = vec3f(WORLD_W / f32(VOLX), WORLD_H / f32(VOLY), WORLD_D / f32(VOLZ));
const SIM_CELL:   vec2f = vec2f(WORLD_W / f32(SIMX), WORLD_D / f32(SIMZ));

// ---------------------------------------------------------------------------
//  Hashing (Dave Hoskins style — cheap, good decorrelation)
// ---------------------------------------------------------------------------
fn hash11(x: f32) -> f32 {
  var h = fract(x * 0.1031);
  h *= h + 33.33;
  h *= h + h;
  return fract(h);
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash31(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn hash33(p: vec3f) -> vec3f {
  var p3 = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// ---------------------------------------------------------------------------
//  Gradient (Perlin) noise
// ---------------------------------------------------------------------------
fn gnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let ga = normalize(hash22(i + vec2f(0.0, 0.0)) * 2.0 - 1.0);
  let gb = normalize(hash22(i + vec2f(1.0, 0.0)) * 2.0 - 1.0);
  let gc = normalize(hash22(i + vec2f(0.0, 1.0)) * 2.0 - 1.0);
  let gd = normalize(hash22(i + vec2f(1.0, 1.0)) * 2.0 - 1.0);
  let va = dot(ga, f - vec2f(0.0, 0.0));
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 1.4142;
}

fn gnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var n = 0.0;
  for (var dz = 0; dz < 2; dz++) {
    for (var dy = 0; dy < 2; dy++) {
      for (var dx = 0; dx < 2; dx++) {
        let o = vec3f(f32(dx), f32(dy), f32(dz));
        let g = normalize(hash33(i + o) * 2.0 - 1.0);
        let w = mix(1.0 - u, u, o);
        n += dot(g, f - o) * w.x * w.y * w.z;
      }
    }
  }
  return n * 1.1547;
}

// ---------------------------------------------------------------------------
//  fBm family
// ---------------------------------------------------------------------------
fn fbm2(p: vec2f, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var nrm = 0.0;
  var q = p;
  for (var i = 0; i < oct; i++) {
    s += a * gnoise2(q);
    nrm += a;
    q = q * 2.03 + vec2f(11.7, -3.1);
    a *= 0.5;
  }
  return s / max(nrm, 1e-5);
}

fn fbm3(p: vec3f, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var nrm = 0.0;
  var q = p;
  for (var i = 0; i < oct; i++) {
    s += a * gnoise3(q);
    nrm += a;
    q = q * 2.02 + vec3f(7.3, -2.9, 4.1);
    a *= 0.5;
  }
  return s / max(nrm, 1e-5);
}

/// Ridged multifractal — sharp crests, used for fluted rock and rills.
fn ridged2(p: vec2f, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var nrm = 0.0;
  var q = p;
  for (var i = 0; i < oct; i++) {
    let n = 1.0 - abs(gnoise2(q));
    s += a * n * n;
    nrm += a;
    q = q * 2.07 + vec2f(5.2, 1.3);
    a *= 0.5;
  }
  return s / max(nrm, 1e-5);
}

fn ridged3(p: vec3f, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var nrm = 0.0;
  var q = p;
  for (var i = 0; i < oct; i++) {
    let n = 1.0 - abs(gnoise3(q));
    s += a * n * n;
    nrm += a;
    q = q * 2.05 + vec3f(3.7, 8.1, -1.7);
    a *= 0.5;
  }
  return s / max(nrm, 1e-5);
}

// ---------------------------------------------------------------------------
//  Voronoi edge distance (Inigo Quilez) — fracture / joint networks.
//  Returns approximate distance to the nearest cell boundary.
// ---------------------------------------------------------------------------
fn voronoiEdge(p: vec2f, jitter: f32) -> f32 {
  let ip = floor(p);
  let fp = p - ip;

  var minD = BIG;
  var minPt = vec2f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let o = vec2f(f32(i), f32(j));
      let pt = o + 0.5 + (hash22(ip + o) - 0.5) * jitter;
      let dv = pt - fp;
      let d = dot(dv, dv);
      if (d < minD) { minD = d; minPt = pt; }
    }
  }

  var e = BIG;
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let o = vec2f(f32(i), f32(j));
      let pt = o + 0.5 + (hash22(ip + o) - 0.5) * jitter;
      let diff = pt - minPt;
      let l = length(diff);
      if (l > 1e-4) {
        e = min(e, dot(0.5 * (minPt + pt) - fp, diff / l));
      }
    }
  }
  return e;
}

// ---------------------------------------------------------------------------
//  Small utilities
// ---------------------------------------------------------------------------
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = saturate(0.5 + 0.5 * (b - a) / max(k, 1e-5));
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn smax(a: f32, b: f32, k: f32) -> f32 {
  let h = saturate(0.5 - 0.5 * (b - a) / max(k, 1e-5));
  return mix(b, a, h) + k * h * (1.0 - h);
}

fn remap(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
  return c + (d - c) * saturate((x - a) / max(b - a, 1e-6));
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

/// Direction vector from azimuth/elevation in degrees.
/// Azimuth 0 = +Z, increasing toward +X (compass-like).
fn dirFromAngles(azimDeg: f32, elevDeg: f32) -> vec3f {
  let a = radians(azimDeg);
  let e = radians(elevDeg);
  let ce = cos(e);
  return vec3f(sin(a) * ce, sin(e), cos(a) * ce);
}

// ---------------------------------------------------------------------------
//  Grid <-> world
// ---------------------------------------------------------------------------
fn voxelCenterToWorld(c: vec3i) -> vec3f {
  return (vec3f(c) + 0.5) * VOXEL_SIZE;
}

fn worldToVoxelF(p: vec3f) -> vec3f {
  return p / VOXEL_SIZE - 0.5;
}

/// Normalised [0,1] texture coordinate for a world position.
fn worldToUVW(p: vec3f) -> vec3f {
  return p / WORLD_SIZE;
}

fn simCellToWorldXZ(c: vec2i) -> vec2f {
  return (vec2f(c) + 0.5) * SIM_CELL;
}

fn worldXZToSimF(xz: vec2f) -> vec2f {
  return xz / SIM_CELL - 0.5;
}

fn simIndex(c: vec2i) -> u32 {
  let cc = clamp(c, vec2i(0), vec2i(SIMX - 1, SIMZ - 1));
  return u32(cc.y * SIMX + cc.x);
}

fn inSim(c: vec2i) -> bool {
  return c.x >= 0 && c.y >= 0 && c.x < SIMX && c.y < SIMZ;
}

// ---------------------------------------------------------------------------
//  Domain box — the finite "diorama" the world is cut from.
// ---------------------------------------------------------------------------
fn boxSDF(p: vec3f, c: vec3f, h: vec3f) -> f32 {
  let q = abs(p - c) - h;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

/// Slab covering the whole domain footprint, from y=0 up to `top`.
fn domainSDF(p: vec3f) -> f32 {
  let c = vec3f(WORLD_W * 0.5, WORLD_H * 0.5, WORLD_D * 0.5);
  let h = vec3f(WORLD_W * 0.5, WORLD_H * 0.5, WORLD_D * 0.5);
  return boxSDF(p, c, h);
}

/// Ray/AABB slab test. Returns (tNear, tFar); tFar < tNear means a miss.
fn intersectBox(ro: vec3f, rd: vec3f, bmin: vec3f, bmax: vec3f) -> vec2f {
  let inv = 1.0 / rd;
  let t0 = (bmin - ro) * inv;
  let t1 = (bmax - ro) * inv;
  let tsm = min(t0, t1);
  let tbg = max(t0, t1);
  let tn = max(max(tsm.x, tsm.y), tsm.z);
  let tf = min(min(tbg.x, tbg.y), tbg.z);
  return vec2f(tn, tf);
}
