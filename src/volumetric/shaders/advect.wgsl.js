import { WGSL_COMMON } from './common.wgsl.js';

/**
 * Pass 1 of every substep: semi-Lagrangian advection (RK2) of velocity *and*
 * the scalar set (density / temperature / fuel / embers) using the same
 * backtrace, so the whole field moves together and we only pay for one trace.
 *
 * Hardware trilinear filtering does the interpolation: the source fields are
 * bound as sampled 3D textures, the destinations as write-only storage
 * textures (the two roles are always different textures = ping-pong).
 */
export const WGSL_ADVECT = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var inVel: texture_3d<f32>;
@group(1) @binding(1) var inScal: texture_3d<f32>;
@group(1) @binding(2) var samp: sampler;
@group(1) @binding(3) var outVel: texture_storage_3d<rgba16float, write>;
@group(1) @binding(4) var outScal: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }

  let dts = sim.dt.y;
  let world = gridToWorld(vec3<f32>(gid) + vec3<f32>(0.5));
  let uv0 = gridToUv(vec3<f32>(gid) + vec3<f32>(0.5));

  // --- RK2 backtrace through the velocity field ---------------------------
  let v0 = textureSampleLevel(inVel, samp, uv0, 0.0).xyz;
  let vMid = textureSampleLevel(inVel, samp, worldToUv(world - v0 * (dts * 0.5)), 0.0).xyz;
  let uvSrc = worldToUv(world - vMid * dts);

  var vel: vec3<f32>;
  var scal: vec4<f32>;
  if (isSolid(world)) {
    // cells inside the obstacle stay empty
    vel = vec3<f32>(0.0);
    scal = vec4<f32>(0.0);
  } else {
    vel = textureSampleLevel(inVel, samp, uvSrc, 0.0).xyz;
    scal = textureSampleLevel(inScal, samp, uvSrc, 0.0);

    // Velocity clamp + damping keeps the explicit integration stable.
    let speed = length(vel);
    if (speed > sim.misc.y) { vel *= sim.misc.y / speed; }
    vel *= max(0.0, 1.0 - sim.drag.x * dts);
    vel = applyVelocityBoundary(vel, vec3<f32>(gid), world);

    // Scalars never go negative (the combustion model relies on it).
    scal = max(scal, vec4<f32>(0.0));
  }

  textureStore(outVel, vec3<i32>(gid), vec4<f32>(vel, 0.0));
  textureStore(outScal, vec3<i32>(gid), scal);
}
`;
