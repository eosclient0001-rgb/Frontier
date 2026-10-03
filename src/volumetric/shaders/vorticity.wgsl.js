import { WGSL_COMMON } from './common.wgsl.js';

/**
 * Vorticity confinement, part 2/2.
 *   N  = grad|omega| / |grad|omega||
 *   f  = eps * h * (N x omega)
 *   v += f * dt
 * Re-injects the rotational energy that RK2 semi-Lagrangian advection loses.
 */
export const WGSL_VORTICITY = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var inVel: texture_3d<f32>;
@group(1) @binding(1) var inCurl: texture_3d<f32>;
@group(1) @binding(2) var samp: sampler;
@group(1) @binding(3) var outVel: texture_storage_3d<rgba16float, write>;

fn curlMag(cell: vec3<f32>) -> f32 {
  let w = textureSampleLevel(inCurl, samp, gridToUv(cell), 0.0).xyz;
  return length(w);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }

  let uv = gridToUv(vec3<f32>(gid) + vec3<f32>(0.5));
  let c = vec3<f32>(gid) + vec3<f32>(0.5);
  let world = gridToWorld(c);
  let h = max(sim.volSize.w, 1.0e-5);

  var vel = textureSampleLevel(inVel, samp, uv, 0.0).xyz;
  let omega = textureSampleLevel(inCurl, samp, uv, 0.0).xyz;

  let eps = sim.wind.w;
  if (eps > 0.0 && !isSolid(world)) {
    // gradient of |omega| -> points from low to high vorticity
    let g = vec3<f32>(
      curlMag(c + vec3<f32>(1.0, 0.0, 0.0)) - curlMag(c - vec3<f32>(1.0, 0.0, 0.0)),
      curlMag(c + vec3<f32>(0.0, 1.0, 0.0)) - curlMag(c - vec3<f32>(0.0, 1.0, 0.0)),
      curlMag(c + vec3<f32>(0.0, 0.0, 1.0)) - curlMag(c - vec3<f32>(0.0, 0.0, 1.0))
    ) / (2.0 * h);
    let len = length(g);
    if (len > 1.0e-6) {
      let n = g / len;
      let force = cross(n, omega) * (eps * h);
      vel += force * sim.dt.y;
    }
  }

  let speed = length(vel);
  if (speed > sim.misc.y) { vel *= sim.misc.y / speed; }
  vel = applyVelocityBoundary(vel, c, world);

  textureStore(outVel, vec3<i32>(gid), vec4<f32>(vel, 0.0));
}
`;
