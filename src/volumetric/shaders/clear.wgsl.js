import { WGSL_COMMON } from './common.wgsl.js';

/**
 * Zeroes every field. Used on reset and when the grid is recreated.
 *
 * Split into two entry points on purpose: WebGPU's default
 * `maxStorageTexturesPerShaderStage` is 4, so a shader may only write four
 * storage textures at once.
 */
export const WGSL_CLEAR_STATE = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var outVelA: texture_storage_3d<rgba16float, write>;
@group(1) @binding(1) var outVelB: texture_storage_3d<rgba16float, write>;
@group(1) @binding(2) var outScalA: texture_storage_3d<rgba16float, write>;
@group(1) @binding(3) var outScalB: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }
  let c = vec3<i32>(gid);
  let zero = vec4<f32>(0.0);
  textureStore(outVelA, c, zero);
  textureStore(outVelB, c, zero);
  textureStore(outScalA, c, zero);
  textureStore(outScalB, c, zero);
}
`;

export const WGSL_CLEAR_SOLVER = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var outCurl: texture_storage_3d<rgba16float, write>;
@group(1) @binding(1) var outPresA: texture_storage_3d<rg32float, write>;
@group(1) @binding(2) var outPresB: texture_storage_3d<rg32float, write>;
@group(1) @binding(3) var outDiv: texture_storage_3d<rg32float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }
  let c = vec3<i32>(gid);
  let zero = vec4<f32>(0.0);
  textureStore(outCurl, c, zero);
  textureStore(outPresA, c, zero);
  textureStore(outPresB, c, zero);
  textureStore(outDiv, c, zero);
}
`;
