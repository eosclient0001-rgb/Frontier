import { WGSL_COMMON } from './common.wgsl.js';

/**
 * Pass 2 of every substep — everything that adds or removes energy/mass:
 *   emitter injection -> combustion -> buoyancy -> wind -> thermal expansion
 *   -> divergence-free turbulence -> cooling / dissipation.
 *
 * Order inside the pass matters: fuel must burn before the heat it produced is
 * turned into buoyancy, otherwise explosions feel mushy for one frame.
 */
export const WGSL_SOURCES = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var<uniform> emitters: EmitterBuffer;
@group(1) @binding(1) var inVel: texture_3d<f32>;
@group(1) @binding(2) var inScal: texture_3d<f32>;
@group(1) @binding(3) var samp: sampler;
@group(1) @binding(4) var outVel: texture_storage_3d<rgba16float, write>;
@group(1) @binding(5) var outScal: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }

  let world = gridToWorld(vec3<f32>(gid) + vec3<f32>(0.5));
  let uv = gridToUv(vec3<f32>(gid) + vec3<f32>(0.5));
  let dts = sim.dt.y;
  let time = sim.dt.z;
  let solid = isSolid(world);

  var vel = textureSampleLevel(inVel, samp, uv, 0.0).xyz;
  var scal = textureSampleLevel(inScal, samp, uv, 0.0);

  // ------------------------------------------------------------- emitters --
  let count = min(emitters.count.x, MAX_EMITTERS);
  for (var i = 0u; i < count; i = i + 1u) {
    let e = emitters.items[i];
    let flicker = e.shape.y;
    let bound = (length(e.sizeTemp.xyz) + 0.35) * e.posRadius.w;
    let dist = distance(world, e.posRadius.xyz);
    if (dist > bound) { continue; }

    var delta = world - e.posRadius.xyz;
    if (flicker > 0.0) {
      let wob = vec3<f32>(
        fbm(vec3<f32>(world.y * 1.7 + time * 1.3, 3.1, 7.7), 2),
        fbm(vec3<f32>(9.2, world.z * 1.9 - time * 1.1, 4.3), 2),
        fbm(vec3<f32>(2.7, 5.5, world.x * 1.6 + time * 1.7), 2)
      ) - vec3<f32>(0.5);
      delta += wob * flicker * e.posRadius.w;
    }

    let f = emitterFalloff(delta, e.sizeTemp.xyz * e.posRadius.w, e.shape.x);
    if (f <= 0.0) { continue; }

    // mass / heat / fuel / embers
    scal.x += e.velDensity.w * f * dts;
    scal.y += e.sizeTemp.w * f * dts;
    scal.z += e.fuelColor.x * f * dts;
    scal.w += e.fuelColor.w * f * dts;

    // momentum: the gas inside the emitter core converges on the emitter
    // velocity, which keeps the source coherent no matter the frame rate.
    let src = emitterVelocityAt(e, world, time);
    vel = mix(vel, src, clamp(f * dts * 12.0, 0.0, 1.0));
  }

  // ----------------------------------------------------------- combustion --
  var dens = max(scal.x, 0.0);
  var temp = max(scal.y, 0.0);
  var fuel = max(scal.z, 0.0);
  var ember = max(scal.w, 0.0);

  if (fuel > 0.0 && temp > sim.drag.w) {
    let ignition = smoothstep(sim.drag.w, sim.drag.w + 0.5, temp);
    let burn = min(fuel, fuel * ignition * sim.drag.z * dts);
    fuel -= burn;
    temp += burn * sim.fire.x;
    dens += burn * sim.fire.y;
    ember += burn * sim.fire.w;
  }

  // -------------------------------------------------------------- forces --
  let heat = max(temp - sim.misc.x, 0.0);
  vel.y += (heat * sim.force.x + dens * sim.force.y) * dts;

  // ambient wind drag (horizontal only, so plumes keep their vertical energy)
  let windK = clamp(sim.misc.w * dts, 0.0, 1.0);
  vel.x += (sim.wind.x - vel.x) * windK;
  vel.z += (sim.wind.z - vel.z) * windK;

  // thermal expansion: hot gas pushes outward from the blast origin
  if (sim.blast.w > 0.0 && heat > 0.0) {
    let d = world - sim.blast.xyz;
    let r = max(length(d), 1.0e-3);
    vel += (d / r) * heat * sim.fire.z * exp(-r * 0.3) * dts;
  }

  // divergence-free turbulence, gated to active cells (huge win: most of the
  // grid is empty and skips the noise evaluation entirely)
  let activity = dens + heat + fuel;
  if (activity > 0.002 && sim.force.w > 0.0) {
    let swirl = curlNoise(world * sim.swirls.y + vec3<f32>(0.0, time * sim.swirls.z, 0.0));
    vel += swirl * (sim.force.w * dts * (0.5 + min(activity, 2.0) * 0.5));
  }

  // ------------------------------------------------- cooling / dissipation --
  temp -= (temp - sim.misc.x) * clamp(sim.force.z * dts, 0.0, 1.0);
  dens *= max(0.0, 1.0 - sim.drag.y * dts);
  ember *= max(0.0, 1.0 - sim.swirls.w * dts);

  var v = vel;
  let speed = length(v);
  if (speed > sim.misc.y) { v *= sim.misc.y / speed; }

  var s = vec4<f32>(max(dens, 0.0), max(temp, 0.0), max(fuel, 0.0), max(ember, 0.0));
  if (solid) {
    v = vec3<f32>(0.0);
    s = vec4<f32>(0.0);
  } else {
    v = applyVelocityBoundary(v, vec3<f32>(gid), world);
  }

  textureStore(outVel, vec3<i32>(gid), vec4<f32>(v, 0.0));
  textureStore(outScal, vec3<i32>(gid), s);
}
`;
