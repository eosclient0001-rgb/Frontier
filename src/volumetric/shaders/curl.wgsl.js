import { WGSL_COMMON } from './common.wgsl.js';

/**
 * Vorticity confinement, part 1/2: curl of the velocity field.
 * Pass 2/2 (vorticity.wgsl.js) pushes energy back into the small eddies that
 * semi-Lagrangian advection smears out — this is what gives smoke its wispy,
 * turbulent look instead of a smooth blob.
 */
export const WGSL_CURL = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var inVel: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var outCurl: texture_storage_3d<rgba16float, write>;

fn velAt(cell: vec3<f32>) -> vec3<f32> {
  return textureSampleLevel(inVel, samp, gridToUv(cell), 0.0).xyz;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }

  let c = vec3<f32>(gid) + vec3<f32>(0.5);
  let h = max(sim.volSize.w, 1.0e-5);

  let xp = velAt(c + vec3<f32>(1.0, 0.0, 0.0));
  let xm = velAt(c - vec3<f32>(1.0, 0.0, 0.0));
  let yp = velAt(c + vec3<f32>(0.0, 1.0, 0.0));
  let ym = velAt(c - vec3<f32>(0.0, 1.0, 0.0));
  let zp = velAt(c + vec3<f32>(0.0, 0.0, 1.0));
  let zm = velAt(c - vec3<f32>(0.0, 0.0, 1.0));

  let dVz_dy = (yp.z - ym.z) / (2.0 * h);
  let dVy_dz = (zp.y - zm.y) / (2.0 * h);
  let dVx_dz = (zp.x - zm.x) / (2.0 * h);
  let dVz_dx = (xp.z - xm.z) / (2.0 * h);
  let dVy_dx = (xp.y - xm.y) / (2.0 * h);
  let dVx_dy = (yp.x - ym.x) / (2.0 * h);

  // omega = curl(v) = (dVz/dy - dVy/dz, dVx/dz - dVz/dx, dVy/dx - dVx/dy)
  let curl = vec3<f32>(dVz_dy - dVy_dz, dVx_dz - dVz_dx, dVy_dx - dVx_dy);
  textureStore(outCurl, vec3<i32>(gid), vec4<f32>(curl, 0.0));
}
`;
