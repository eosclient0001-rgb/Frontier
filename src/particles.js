/* GPU particle erosion on the 3D SDF volume.
 *
 * Agents (rain droplets / river parcels) are simulated entirely on the GPU:
 * motion → surface contact → splatted cut/deposit requests → volumetric apply
 * → cargo bookkeeping. The carries are real: what is detached enters the
 * agent's load, and only carried material may be deposited. Mass is
 * conserved end-to-end.
 *
 * ── Why this does NOT drill bottomless pits (the failure mode of the pure
 *    particle approach) ──────────────────────────────────────────────────
 *  1. Capacity-limited detachment: agents cut only while load < capacity,
 *     and capacity grows with speed² · water — a slow pooled agent has
 *     essentially zero capacity.
 *  2. Shear threshold vs. hardness: detachment needs stress > critical, and
 *     critical rises with the voxel hardness that cutting itself increases
 *     (armoring feedback, reversed by deposition).
 *  3. Rest guard: an agent that is slow on flat/concave ground (i.e. sitting
 *     in a hole it dug) cannot cut at all — it dumps its load instead, so
 *     pits self-fill. Stuck agents are recycled.
 *  4. Per-cell regenerating incision budget: every voxel can only be cut so
 *     fast; sustained jets exhaust the local budget and must move on.
 *  5. Hard per-step caps tied to the footprint's available solid volume.
 */
import { glslHeader, fullscreenVertex, ATLAS_W, ATLAS_H } from "./volume.js";
import { program, makePingPong, bindTarget } from "./gl.js";

export const MAX_PARTICLES = 2048;
export const PT_W = 64;
export const PT_H = MAX_PARTICLES / PT_W; // 32
export const SPLAT_SLICES = 7;
const TILE_X = 128; // atlas tile width  (DIM.x)
const TILE_Y = 64; // atlas tile height (DIM.y)
const ATLAS_COLS = 16;

const dt = 1 / 60;

const physicsUniforms = `
uniform sampler2D terrain;
uniform vec4 sim;      // dt, spawnRate, step, agentMode (0 rain, 1 river, 2 both)
uniform vec4 env;      // waterLevel, detachK, capacityK, depositK
float riverCenter(float z) { return 2.8 * sin(z * .14) + 1.5 * sin(z * .31 + 2.); }
float riverWidth() { return 1.7; }
float riverMask(vec3 p) {
  return 1. - smoothstep(riverWidth(), riverWidth() + 1.8, abs(p.x - riverCenter(p.z)));
}
vec3 riverCurrent(vec3 p) {
  float dc = 2.8 * .14 * cos(p.z * .14) + 1.5 * .31 * cos(p.z * .31 + 2.);
  vec2 tangent = normalize(vec2(dc, 1.));
  float lateral = clamp(riverCenter(p.z) - p.x, -riverWidth(), riverWidth()) * .75;
  return vec3(tangent.x * 3.4 + lateral, -.25, tangent.y * 3.4);
}
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
`;

/* ── 1 · motion: integrate, collide with the SDF, respawn ─────────────── */
const motionFragment =
  glslHeader +
  physicsUniforms +
  `
uniform sampler2D positions, velocities, cargos, metadata;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVel;
layout(location = 2) out vec4 outCargo;
layout(location = 3) out vec4 outMeta;

vec3 dropToSurface(vec3 p) {
  for (int i = 0; i < 90; i++) {
    float d = sdf(terrain, p);
    if (d < .075 || p.y < -2.5) break;
    p.y -= clamp(d * .6, .05, 1.3);
  }
  vec3 n = surfaceNormal(terrain, p);
  return p + n * .1;
}

void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  int id = uv.y * ${PT_W} + uv.x;
  vec4 oldP = texelFetch(positions, uv, 0);
  vec4 oldV = texelFetch(velocities, uv, 0);
  vec4 cargo = texelFetch(cargos, uv, 0);
  vec4 meta = texelFetch(metadata, uv, 0);

  outPos = oldP; outVel = oldV; outCargo = cargo; outMeta = meta;

  float age = oldP.w;
  bool dead = age < 0.;
  float life = meta.x > .5 ? 42. : 24.;
  bool oob = any(lessThan(oldP.xyz, LO + vec3(.2))) || any(greaterThan(oldP.xyz, HI - vec3(.2)));
  bool dried = meta.x < .5 && oldV.w < .02;
  bool stuckOut = cargo.w > 3.;
  if (!dead && (age > life || oob || dried || stuckOut)) dead = true;

  if (dead) {
    // respawn roll — the spawn rate slider throttles births
    float roll = hash1(float(id) * 7.13 + sim.z * 1.317);
    if (roll >= sim.y) { outPos = vec4(oldP.xyz, -1.); outVel = vec4(0., 0., 0., 0.); outCargo = vec4(0.); return; }

    float kindRoll = hash1(float(id) * 3.71 + sim.z * 2.113);
    float kind = 0.;
    if (sim.w > 1.5) kind = kindRoll < .45 ? 1. : 0.;
    else if (sim.w > .5) kind = 1.;

    vec3 p; vec3 v;
    float seed = float(id) * 12.9898 + sim.z * .61;
    if (kind > .5) {
      float z = -23.5 + hash1(seed + 3.3) * 5.;
      float x = riverCenter(z) + (hash1(seed + 8.1) - .5) * 2.6;
      p = dropToSurface(vec3(x, 19., z));
      v = riverCurrent(p) * .8;
      outMeta = vec4(1., .62, 6., .15);
      outVel = vec4(v, 1.);
    } else {
      vec2 xz = vec2(hash1(seed), hash1(seed + 31.1)) * 44. - 22.;
      p = dropToSurface(vec3(xz.x, 19., xz.y));
      v = vec3(0., -1.2, 0.);
      outMeta = vec4(0., .34, 3., .3);
      outVel = vec4(v, .55 + .45 * hash1(seed + 12.7));
    }
    outPos = vec4(p, 0.);
    outCargo = vec4(0.);
    return;
  }

  vec3 p = oldP.xyz, v = oldV.xyz;
  float water = oldV.w;
  float stuck = cargo.w;
  float kind = meta.x;
  float crad = max(.08, meta.y * .4);

  for (int i = 0; i < 3; i++) {
    float h = sim.x / 3.;
    float flow = riverMask(p);
    bool wet = flow > .05 || p.y < env.x;

    float gravity = wet ? 2.2 : 9.81;
    v.y -= gravity * h;
    v *= exp(-h * (wet ? 1.9 : .12));
    if (flow > .01) v = mix(v, riverCurrent(p), 1. - exp(-h * 4.5 * flow));

    float spd = length(v);
    if (spd > 10.) v *= 10. / spd;

    vec3 q = p + v * h;
    float d = sdf(terrain, q);
    if (d < crad) {
      vec3 n = surfaceNormal(terrain, q);
      q += n * (crad - d);
      float inward = min(dot(v, n), 0.);
      v -= (1. + meta.w) * inward * n;   // bounce with restitution
      v *= .82;                            // impact friction
    }
    p = q;
  }

  // rest detection (drives the pit guard in the exchange pass)
  float speedNow = length(v);
  bool resting = speedNow < .09 && p.y < env.x + 1.2;
  stuck = resting ? stuck + sim.x : max(0., stuck - sim.x * 2.);

  water *= exp(-sim.x * (kind > .5 ? .006 : .03));
  outPos = vec4(p, age + sim.x);
  outVel = vec4(v, water);
  outCargo = vec4(cargo.x, cargo.y, cargo.z, stuck);
}`;

/* ── 2 · contact: compute per-agent detach/deposit requests ───────────── */
const contactFragment =
  glslHeader +
  physicsUniforms +
  `
uniform sampler2D positions, velocities, cargos, metadata;
layout(location = 0) out vec4 outContact;   // xyz, radius
layout(location = 1) out vec4 outExchange;  // cut, deposit, sumSolid, sumVoid
layout(location = 2) out vec4 outMark;      // wetness splat amount

void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  outContact = vec4(0.); outExchange = vec4(0.); outMark = vec4(0.);
  vec4 pos = texelFetch(positions, uv, 0);
  if (pos.w < 0.) return;
  vec3 p = pos.xyz;
  float d = sdf(terrain, p);
  if (d > .3 || d < -.7) return;

  vec4 vel = texelFetch(velocities, uv, 0);
  vec4 cargo = texelFetch(cargos, uv, 0);
  vec4 meta = texelFetch(metadata, uv, 0);
  vec3 n = surfaceNormal(terrain, p);
  vec3 c = p - n * d;                    // surface contact point
  float radius = meta.y;

  // exchangeable solid/void sums over the compact footprint kernel
  vec2 sums = vec2(0.);
  ivec3 center = ivec3(floor((c - LO) / CELL));
  for (int z = -3; z <= 3; z++)
  for (int y = -3; y <= 3; y++)
  for (int x = -3; x <= 3; x++) {
    ivec3 q = center + ivec3(x, y, z);
    if (any(lessThan(q, ivec3(0))) || any(greaterThanEqual(q, DIM))) continue;
    vec4 vx = voxel(terrain, q);
    float band = 1. - smoothstep(BAND, 2. * BAND, abs(vx.r));
    float k = kernel(worldAt(q), c, radius) * band;
    sums += k * vec2(vx.a, 1. - vx.a);
  }
  if (sums.x + sums.y < 1e-7) return;

  float speed = length(vel.xyz);
  float water = vel.w;
  float load = cargo.x;
  float stuck = cargo.w;
  float kind = meta.x;
  float grain = meta.z;

  vec4 ground = atlasSample(terrain, c);
  float hard = ground.g;
  float moist = ground.b;

  // ── capacity: grows with water and shear (speed²) ──
  float shear = speed * speed * (.35 + water);
  float capacity = env.z * .10 * water * (.10 + shear * .22);

  // ── rest guard: slow agents on flat ground neither dig nor stir ──
  float rest = (1. - smoothstep(.10, .30, speed)) * smoothstep(.70, .92, n.y);
  if (stuck > 1.5) rest = max(rest, .85);

  // ── detachment: shear threshold + armoring + capacity headroom ──
  float critical = (.55 + hard * 2.6) * (1. - .45 * moist);
  float stress = shear * (kind > .5 ? 1.4 : 1.);
  float unsat = clamp(1. - load / max(capacity, 1e-5), 0., 1.);
  float hemi = 2.094 * radius * radius * radius;
  float detach = env.y * 1.1 * max(0., stress - critical) * unsat * (1. - rest) * hemi * sim.x;
  detach = min(detach, sums.x * VOX * .12);      // only what exists in the footprint
  detach = min(detach, .16 * VOX);               // absolute per-step cap per agent

  // ── deposition: surplus drops; resting agents dump and self-fill ──
  float surplus = max(0., load - capacity);
  float settling = pow(grain / 6., 1.4) * (.25 + rest * 2.);
  float depos = env.w * (surplus * (1. - exp(-sim.x * 7.)) + load * settling * sim.x);
  if (rest > .4) depos = max(depos, load * sim.x * 3.);
  depos = min(min(depos, load), sums.y * VOX * .12);

  outContact = vec4(c, radius);
  outExchange = vec4(detach, depos, sums.x, sums.y);
  outMark = vec4(water * sim.x * .5 * (1. - rest * .5), 0., 0., 0.);
}`;

/* ── 3 · splat: scatter requests into the atlas (instanced quads) ─────── */
const splatVertex =
  glslHeader +
  `
uniform sampler2D contacts, exchanges, marks;
flat out vec4 fContact;
flat out vec4 fExchange;
flat out float fWet;
flat out int fSlice;
void main() {
  int id = gl_InstanceID / ${SPLAT_SLICES};
  int offset = gl_InstanceID % ${SPLAT_SLICES} - ${Math.floor(SPLAT_SLICES / 2)};
  ivec2 uv = ivec2(id % ${PT_W}, id / ${PT_W});
  fContact = texelFetch(contacts, uv, 0);
  fExchange = texelFetch(exchanges, uv, 0);
  fWet = texelFetch(marks, uv, 0).x;
  fSlice = -1000;
  if (fContact.w <= 0. || fExchange.x + fExchange.y <= 1e-9) { gl_Position = vec4(-2., -2., 0., 1.); return; }

  int z0 = int(floor((fContact.z - LO.z) / CELL.z));
  int z = z0 + offset;
  fSlice = z;
  if (z < 0 || z >= DIM.z) { gl_Position = vec4(-2., -2., 0., 1.); return; }

  float cx = (gl_VertexID % 2 == 1) ? 1. : -1.;
  float cy = (gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5) ? 1. : -1.;
  vec2 q = (fContact.xy - LO.xy) / CELL.xy + vec2(cx, cy) * (fContact.w / CELL.xy + 1.);
  q = clamp(q, vec2(0.), vec2(${TILE_X}. , ${TILE_Y}.));
  vec2 pixel = q + vec2(float((z % ${ATLAS_COLS}) * ${TILE_X}), float((z / ${ATLAS_COLS}) * ${TILE_Y}));
  gl_Position = vec4(pixel / vec2(ATLAS) * 2. - 1., 0., 1.);
}`;

const splatFragment =
  glslHeader +
  `
uniform sampler2D terrain;
flat in vec4 fContact;
flat in vec4 fExchange;
flat in float fWet;
flat in int fSlice;
layout(location = 0) out vec4 outRequest;
void main() {
  ivec3 q = voxelAt(ivec2(gl_FragCoord.xy));
  if (q.z != fSlice) discard;
  float k = kernel(worldAt(q), fContact.xyz, fContact.w);
  if (k <= 0.) discard;
  vec4 vx = voxel(terrain, q);
  float band = 1. - smoothstep(BAND, 2. * BAND, abs(vx.r));
  k *= band;
  float cutShare = fExchange.x * k * vx.a / max(fExchange.z, 1e-9);
  float depShare = fExchange.y * k * (1. - vx.a) / max(fExchange.w, 1e-9);
  float wetShare = fWet * k / 49.;
  outRequest = vec4(cutShare, depShare, wetShare, 0.);
}`;

/* ── 4 · apply: budget-limited edits to the volume ────────────────────── */
const applyFragment =
  glslHeader +
  `
uniform sampler2D terrain, soil, requests;
uniform vec4 rates; // dt, budgetRegen, spare, spare
layout(location = 0) out vec4 outTerrain;
layout(location = 1) out vec4 outAccept;
layout(location = 2) out vec4 outSoil;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 v = texelFetch(terrain, uv, 0);
  vec4 soil = texelFetch(soil, uv, 0);
  vec3 req = texelFetch(requests, uv, 0).xyz;

  float budget = soil.r;
  float maxCut = budget * VOX * .45;
  float erosion = min(min(req.x, v.a * VOX * .6), maxCut);
  float deposition = min(req.y, (1. - v.a) * VOX + erosion);

  float solid = clamp(v.a + (deposition - erosion) / VOX, 0., 1.);
  float d = v.r;
  if (erosion + deposition > 1e-9 || (solid > 0. && solid < 1.)) d = distOf(solid);

  float g = v.g;
  if (erosion > deposition) g = clamp(g + .10 * erosion / VOX, .05, .95);      // armoring
  else if (deposition > erosion) g = clamp(g - .08 * deposition / VOX, .05, .95);

  float moist = clamp(v.b * exp(-rates.x * .4) + req.z * .8, 0., 1.);

  outTerrain = vec4(d, g, moist, solid);

  float er = req.x > 0. ? erosion / req.x : 0.;
  float dr = req.y > 0. ? deposition / req.y : 0.;
  outAccept = vec4(er, dr, erosion, deposition);

  float newBudget = clamp(budget - erosion / (VOX * 5.) + rates.y * rates.x, 0., 1.);
  float sediment = clamp(soil.a + deposition * 2., 0., 1.) * .9992;
  outSoil = vec4(newBudget, soil.g, soil.b, sediment);
}`;

/* ── 5 · cargo: integrate accepted amounts back into each agent ───────── */
const cargoFragment =
  glslHeader +
  physicsUniforms +
  `
uniform sampler2D positions, cargos, contacts, exchanges, acceptance;
layout(location = 0) out vec4 outCargo;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 cargo = texelFetch(cargos, uv, 0);
  vec4 pos = texelFetch(positions, uv, 0);
  outCargo = cargo;
  if (pos.w < 0.) return;
  vec4 contact = texelFetch(contacts, uv, 0);
  vec4 exch = texelFetch(exchanges, uv, 0);
  if (contact.w <= 0. || exch.x + exch.y <= 0.) return;

  float acceptedCut = 0., acceptedDep = 0.;
  ivec3 center = ivec3(floor((contact.xyz - LO) / CELL));
  for (int z = -3; z <= 3; z++)
  for (int y = -3; y <= 3; y++)
  for (int x = -3; x <= 3; x++) {
    ivec3 q = center + ivec3(x, y, z);
    if (any(lessThan(q, ivec3(0))) || any(greaterThanEqual(q, DIM))) continue;
    float k = kernel(worldAt(q), contact.xyz, contact.w);
    if (k <= 0.) continue;
    vec4 vx = voxel(terrain, q);
    float band = 1. - smoothstep(BAND, 2. * BAND, abs(vx.r));
    k *= band;
    vec4 acc = voxel(acceptance, q);
    acceptedCut += exch.x * k * vx.a / max(exch.z, 1e-9) * acc.x;
    acceptedDep += exch.y * k * (1. - vx.a) / max(exch.w, 1e-9) * acc.y;
  }

  float load = max(0., cargo.x + acceptedCut - acceptedDep);
  // clamp so a single saturated agent can't hoard more than it could carry
  load = min(load, .35);
  outCargo = vec4(load, cargo.y + acceptedCut, cargo.z + acceptedDep, cargo.w);
}`;

export class ParticleErosion {
  constructor(gl, volumePP, soilPP, repair) {
    this.gl = gl;
    this.volumePP = volumePP;
    this.soilPP = soilPP;
    this.repair = repair;
    this.running = false;
    this.step = 0;
    this.burstUntil = 0;

    // particle state ping-pongs
    const opts = { internal: gl.RGBA32F };
    this.positions = makePingPong(gl, PT_W, PT_H, 1, opts);
    this.velocities = makePingPong(gl, PT_W, PT_H, 1, opts);
    this.cargos = makePingPong(gl, PT_W, PT_H, 1, opts);
    this.metadata = makePingPong(gl, PT_W, PT_H, 1, opts);
    this.contacts = makePingPong(gl, PT_W, PT_H, 1, opts); // single side used
    this.exchanges = makePingPong(gl, PT_W, PT_H, 1, opts);
    this.marks = makePingPong(gl, PT_W, PT_H, 1, opts);

    this.requests = makePingPong(gl, ATLAS_W, ATLAS_H, 1, { internal: gl.RGBA16F });
    this.acceptance = makePingPong(gl, ATLAS_W, ATLAS_H, 1, { internal: gl.RGBA16F });

    this.progMotion = program(gl, fullscreenVertex, motionFragment, "motion");
    this.progContact = program(gl, fullscreenVertex, contactFragment, "contact");
    this.progSplat = program(gl, splatVertex, splatFragment, "splat");
    this.progApply = program(gl, fullscreenVertex, applyFragment, "apply");
    this.progCargo = program(gl, fullscreenVertex, cargoFragment, "cargo");

    this.reset();
  }

  reset() {
    const gl = this.gl;
    const n = PT_W * PT_H * 4;
    const pos = new Float32Array(n);
    for (let i = 3; i < n; i += 4) pos[i] = -1; // dead
    for (const pp of [this.positions, this.velocities, this.cargos, this.metadata]) {
      for (const side of [pp.a, pp.b]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, side.fbo);
        gl.clearColor(0, 0, 0, pp === this.positions ? -1 : 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.step = 0;
  }

  burst() {
    this.burstUntil = this.step + 60 * 3; // 3 s of heavy rain
  }

  /** One simulation step. params: {spawnRate, agentMode, detach, capacity, deposit, waterLevel} */
  stepOnce(params) {
    const gl = this.gl;
    this.step++;
    const spawnRate = this.step < this.burstUntil ? Math.min(1, params.spawnRate * 2.2) : params.spawnRate;
    const volumeTex = this.volumePP.src().textures[0];

    const setCommon = (prog) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, volumeTex);
      gl.uniform1i(prog.u("terrain"), 0);
      gl.uniform4f(prog.u("sim"), dt, spawnRate, this.step, params.agentMode);
      gl.uniform4f(prog.u("env"), params.waterLevel, params.detach, params.capacity, params.deposit);
    };

    // 1 — motion
    {
      const p = this.progMotion;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.motionFbo());
      gl.useProgram(p.handle);
      setCommon(p);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.positions.src().textures[0]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.velocities.src().textures[0]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.cargos.src().textures[0]);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.metadata.src().textures[0]);
      gl.uniform1i(p.u("positions"), 1);
      gl.uniform1i(p.u("velocities"), 2);
      gl.uniform1i(p.u("cargos"), 3);
      gl.uniform1i(p.u("metadata"), 4);
      gl.viewport(0, 0, PT_W, PT_H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (const pp of [this.positions, this.velocities, this.cargos, this.metadata]) pp.swap();
    }

    // 2 — contact
    {
      const p = this.progContact;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.contactFbo());
      gl.useProgram(p.handle);
      setCommon(p);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.positions.src().textures[0]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.velocities.src().textures[0]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.cargos.src().textures[0]);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.metadata.src().textures[0]);
      gl.uniform1i(p.u("positions"), 1);
      gl.uniform1i(p.u("velocities"), 2);
      gl.uniform1i(p.u("cargos"), 3);
      gl.uniform1i(p.u("metadata"), 4);
      gl.viewport(0, 0, PT_W, PT_H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 3 — clear + splat requests (additive into RGBA16F)
    {
      const target = this.requests.dst();
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const p = this.progSplat;
      gl.useProgram(p.handle);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, volumeTex);
      gl.uniform1i(p.u("terrain"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.contacts.a.textures[0]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.exchanges.a.textures[0]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.marks.a.textures[0]);
      gl.uniform1i(p.u("contacts"), 1);
      gl.uniform1i(p.u("exchanges"), 2);
      gl.uniform1i(p.u("marks"), 3);
      gl.viewport(0, 0, ATLAS_W, ATLAS_H);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, MAX_PARTICLES * SPLAT_SLICES);
      gl.disable(gl.BLEND);
      this.requests.swap();
    }

    // 4 — apply to volume + soil (MRT into dedicated fbo)
    {
      const p = this.progApply;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.applyFbo());
      gl.useProgram(p.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, volumeTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.soilPP.src().textures[0]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.requests.src().textures[0]);
      gl.uniform1i(p.u("terrain"), 0);
      gl.uniform1i(p.u("soil"), 1);
      gl.uniform1i(p.u("requests"), 2);
      gl.uniform4f(p.u("rates"), dt, 0.1, 0, 0);
      gl.viewport(0, 0, ATLAS_W, ATLAS_H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.volumePP.swap();
      this.soilPP.swap();
    }

    // 5 — cargo bookkeeping
    {
      const p = this.progCargo;
      bindTarget(gl, this.cargos.dst());
      gl.useProgram(p.handle);
      setCommon(p);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.positions.src().textures[0]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.cargos.src().textures[0]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.contacts.a.textures[0]);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.exchanges.a.textures[0]);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.acceptance.a.textures[0]);
      gl.uniform1i(p.u("positions"), 1);
      gl.uniform1i(p.u("cargos"), 2);
      gl.uniform1i(p.u("contacts"), 3);
      gl.uniform1i(p.u("exchanges"), 4);
      gl.uniform1i(p.u("acceptance"), 5);
      gl.viewport(0, 0, PT_W, PT_H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cargos.swap();
    }

    // 6 — keep the SDF valid after the edits
    this.repair.repair(this.volumePP, 1);
  }
  motionFbo() {
    return this._mrt("motionFbo", this.positions.dst(), this.velocities.dst(), this.cargos.dst(), this.metadata.dst());
  }
  contactFbo() {
    return this._mrt("contactFbo", this.contacts.a, this.exchanges.a, this.marks.a);
  }
  applyFbo() {
    return this._mrt("applyFbo", this.volumePP.dst(), this.acceptance.a, this.soilPP.dst());
  }
  _mrt(key, ...targets) {
    const gl = this.gl;
    // rebuild every call: the dst sides ping-pong, cheap enough (no allocation
    // of textures, just framebuffer attachment state)
    let fbo = this._fbos && this._fbos.get(key);
    if (!fbo) {
      fbo = gl.createFramebuffer();
      if (!this._fbos) this._fbos = new Map();
      this._fbos.set(key, fbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const bufs = [];
    targets.forEach((t, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.textures[0], 0);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    });
    gl.drawBuffers(bufs);
    return fbo;
  }
}
