/**
 * Shared WGSL: uniform layouts + math helpers used by every pass.
 *
 * Layout policy: every uniform struct is built from vec4s only, so the
 * std140-ish WGSL uniform rules reduce to "16 bytes per member". The JS packer
 * mirrors those offsets exactly (see UniformBuilder in ../gpu/UniformBuilder.js).
 */
export const WGSL_COMMON = /* wgsl */ `

const MAX_EMITTERS: u32 = 16u;
const PI: f32 = 3.14159265359;

// ---------------------------------------------------------------------------
// Simulation uniforms
// ---------------------------------------------------------------------------
struct SimParams {
  grid:     vec4<u32>,  // xyz = cells per axis, w = unused
  dt:       vec4<f32>,  // x = frame dt, y = substep dt, z = time (s), w = frame
  volMin:   vec4<f32>,  // xyz = volume min corner in world space, w = unused
  volSize:  vec4<f32>,  // xyz = volume world size, w = cell size (world)
  force:    vec4<f32>,  // x = heat buoyancy, y = smoke weight, z = ambient cooling, w = turbulence
  wind:     vec4<f32>,  // xyz = wind velocity (world/s), w = vorticity confinement
  drag:     vec4<f32>,  // x = velocity damping, y = smoke dissipation, z = fuel burn rate, w = ignition temp
  fire:     vec4<f32>,  // x = heat of combustion, y = soot yield, z = thermal expansion, w = ember gain
  misc:     vec4<f32>,  // x = ambient temp, y = max speed, z = ambient density, w = unused
  obstacle: vec4<f32>,  // xyz = center, w = radius (signed distance offset)
  obstacleShape: vec4<f32>, // xyz = half extents, w = mode (0 = off)
  blast:    vec4<f32>,  // xyz = blast center, w = shock strength
  quality:  vec4<u32>,  // x = pressure iters (unused on GPU), y = substeps, z = march steps, w = flags
  swirls:   vec4<f32>,  // x = swirl amount, y = swirl scale, z = swirl speed, w = extra dissipation
};

// ---------------------------------------------------------------------------
// Emitters (uploaded once per frame)
// ---------------------------------------------------------------------------
struct Emitter {
  posRadius:   vec4<f32>,  // xyz = position, w = radius
  velDensity:  vec4<f32>,  // xyz = velocity, w = density rate
  sizeTemp:    vec4<f32>,  // xyz = ellipsoid size, w = temperature rate
  fuelColor:   vec4<f32>,  // xyz = fuel rate, w = smoke/soot rate
  colorKind:   vec4<f32>,  // xyz = rgb tint, w = kind (0 smoke, 1 fire, 2 explosion, 3 debris)
  shape:       vec4<f32>,  // x = softness, y = flicker, z = swirl, w = life (0..1)
};

struct EmitterBuffer {
  count: vec4<u32>,
  items: array<Emitter, MAX_EMITTERS>,
};

// ---------------------------------------------------------------------------
// Grid <-> world helpers
// ---------------------------------------------------------------------------
fn gridSize() -> vec3<f32> { return vec3<f32>(sim.grid.xyz); }

fn gridToWorld(g: vec3<f32>) -> vec3<f32> {
  return sim.volMin.xyz + g * (sim.volSize.xyz / gridSize());
}

fn worldToGrid(w: vec3<f32>) -> vec3<f32> {
  return (w - sim.volMin.xyz) * gridSize() / sim.volSize.xyz;
}

// Continuous cell coordinates: integer == cell corner, i+0.5 == cell centre.
// Sampling a cell centre therefore means gridToUv(vec3(gid) + 0.5).
fn gridToUv(g: vec3<f32>) -> vec3<f32> {
  return g / gridSize();
}

fn inGrid(g: vec3<f32>) -> bool {
  let gs = gridSize();
  return all(g >= vec3<f32>(0.0)) && all(g < gs);
}

fn worldToUv(w: vec3<f32>) -> vec3<f32> {
  return (w - sim.volMin.xyz) / sim.volSize.xyz;
}

fn uvToWorld(uv: vec3<f32>) -> vec3<f32> {
  return sim.volMin.xyz + uv * sim.volSize.xyz;
}

// ---------------------------------------------------------------------------
// Obstacle / boundary
// ---------------------------------------------------------------------------
fn obstacleSDF(p: vec3<f32>) -> f32 {
  var d: f32 = 1.0e9;
  if (sim.obstacleShape.w > 0.5) {
    let q = abs(p - sim.obstacle.xyz) - sim.obstacleShape.xyz;
    let boxSd = length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
    d = min(d, boxSd - sim.obstacle.w);
  }
  // ground plane at volume floor
  d = min(d, sim.volMin.y - p.y);
  return d;
}

fn isSolid(p: vec3<f32>) -> bool {
  return obstacleSDF(p) < 0.0;
}

// Free-slip walls + no-through-flow at the ground.
fn applyVelocityBoundary(v: vec3<f32>, cell: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
  let gs = gridSize();
  var out = v;
  if (cell.x < 1.0 || cell.x > gs.x - 2.0) { out.x = 0.0; }
  if (cell.y < 1.0) { out.y = max(out.y, 0.0); }
  if (cell.y > gs.y - 2.0) { out.y = min(out.y, 0.0); }
  if (cell.z < 1.0 || cell.z > gs.z - 2.0) { out.z = 0.0; }
  if (isSolid(world)) { out = vec3<f32>(0.0); }
  return out;
}

fn applyScalarBoundary(s: vec4<f32>, world: vec3<f32>) -> vec4<f32> {
  if (isSolid(world)) { return vec4<f32>(0.0); }
  return s;
}

// ---------------------------------------------------------------------------
// Noise (cheap value noise + fbm + divergence-free curl noise)
// ---------------------------------------------------------------------------
fn hash13(p: vec3<f32>) -> f32 {
  var q = fract(p * 0.3183099 + vec3<f32>(0.11, 0.17, 0.13));
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z * 40.0);
}

fn valueNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i);
  let n100 = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3<f32>(1.0, 1.0, 1.0));
  let x00 = mix(n000, n100, u.x);
  let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x);
  let x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn fbm(p: vec3<f32>, octaves: i32) -> f32 {
  var acc = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  var q = p;
  for (var i = 0; i < octaves; i = i + 1) {
    acc += amp * valueNoise(q);
    norm += amp;
    amp *= 0.5;
    q *= 2.03;
  }
  return acc / max(norm, 1.0e-5);
}

fn potentialField(p: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    fbm(p, 2),
    fbm(p + vec3<f32>(31.4, 17.2, 5.9), 2),
    fbm(p + vec3<f32>(7.1, 41.3, 23.7), 2)
  );
}

// Divergence-free turbulence. Cost is gated by the caller (only active cells).
fn curlNoise(p: vec3<f32>) -> vec3<f32> {
  let e = 0.45;
  let dx = potentialField(p + vec3<f32>(e, 0.0, 0.0)) - potentialField(p - vec3<f32>(e, 0.0, 0.0));
  let dy = potentialField(p + vec3<f32>(0.0, e, 0.0)) - potentialField(p - vec3<f32>(0.0, e, 0.0));
  let dz = potentialField(p + vec3<f32>(0.0, 0.0, e)) - potentialField(p - vec3<f32>(0.0, 0.0, e));
  let curl = vec3<f32>(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
  return curl * (1.0 / (2.0 * e));
}

// ---------------------------------------------------------------------------
// Emission / combustion helpers
// ---------------------------------------------------------------------------
fn emitterFalloff(delta: vec3<f32>, size: vec3<f32>, softness: f32) -> f32 {
  let q = length(delta / max(size, vec3<f32>(1.0e-4)));
  let outer = 1.0;
  let inner = clamp(softness, 0.0, 0.999);
  return 1.0 - smoothstep(inner, outer, q);
}

fn emitterVelocityAt(e: Emitter, world: vec3<f32>, time: f32) -> vec3<f32> {
  var v = e.velDensity.xyz;
  let kind = e.colorKind.w;
  let swirl = e.shape.z;
  if (swirl > 0.0) {
    let p = (world - e.posRadius.xyz) / max(e.posRadius.w, 1.0e-3);
    v += curlNoise(p * 1.6 + vec3<f32>(0.0, time * 0.7, 0.0)) * swirl * e.posRadius.w;
  }
  // explosion / fireball: radial push out of the emitter core
  if (kind > 1.5) {
    let d = world - e.posRadius.xyz;
    let r = max(length(d), 1.0e-3);
    v += (d / r) * e.velDensity.w * 0.35;
  }
  return v;
}

// Blackbody-ish flame colour ramp, hot core -> yellow -> orange -> red
fn flameColor(heat: f32) -> vec3<f32> {
  let t = clamp(heat, 0.0, 4.0);
  let c0 = vec3<f32>(0.05, 0.02, 0.01);   // embers
  let c1 = vec3<f32>(0.9, 0.16, 0.03);    // red
  let c2 = vec3<f32>(1.6, 0.62, 0.10);    // orange
  let c3 = vec3<f32>(2.6, 1.75, 0.55);    // yellow-white
  var c = mix(c0, c1, smoothstep(0.15, 0.7, t));
  c = mix(c, c2, smoothstep(0.7, 1.5, t));
  c = mix(c, c3, smoothstep(1.5, 3.4, t));
  return c;
}
`;
