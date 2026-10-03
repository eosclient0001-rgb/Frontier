import { WGSL_COMMON } from './common.wgsl.js';

/** Signed distance field of the obstacle set, baked once per obstacle change. */
export const WGSL_SDF = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var outSdf: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }
  let world = gridToWorld(vec3<f32>(gid) + vec3<f32>(0.5));
  let cell = max(sim.volSize.w, 1.0e-5);
  let d = obstacleSDF(world);
  // store as a normalized 0..1 ramp: 0.5 == surface
  let packed = clamp(d / (2.0 * cell) * 0.25 + 0.5, 0.0, 1.0);
  textureStore(outSdf, vec3<i32>(gid), vec4<f32>(packed, 0.0, 0.0, 0.0));
}
`;
