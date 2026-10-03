import { WGSL_COMMON } from './common.wgsl.js';

/**
 * Divergence of the (post-force) velocity field:  D = div(v)
 * solved as the RHS of the Poisson equation  laplacian(p) = D,
 * then the projection pass subtracts grad(p).
 *
 * Stored in a full-precision rg32float texture and read back with nearest
 * sampling (the Jacobi pass only ever reads exact cell centres, so nearest ==
 * linear here, but we keep fp32 precision where fp16 would visibly bias the
 * pressure field).
 */
export const WGSL_DIVERGENCE = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var inVel: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var outDiv: texture_storage_3d<rg32float, write>;

fn velAt(cell: vec3<f32>) -> vec3<f32> {
  return textureSampleLevel(inVel, samp, gridToUv(cell), 0.0).xyz;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }

  let c = vec3<f32>(gid) + vec3<f32>(0.5);
  let world = gridToWorld(vec3<f32>(gid) + vec3<f32>(0.5));
  let h = max(sim.volSize.w, 1.0e-5);

  var d = 0.0;
  if (!isSolid(world)) {
    let xp = velAt(c + vec3<f32>(1.0, 0.0, 0.0)).x;
    let xm = velAt(c - vec3<f32>(1.0, 0.0, 0.0)).x;
    let yp = velAt(c + vec3<f32>(0.0, 1.0, 0.0)).y;
    let ym = velAt(c - vec3<f32>(0.0, 1.0, 0.0)).y;
    let zp = velAt(c + vec3<f32>(0.0, 0.0, 1.0)).z;
    let zm = velAt(c - vec3<f32>(0.0, 0.0, 1.0)).z;
    d = ((xp - xm) + (yp - ym) + (zp - zm)) / (2.0 * h);
  }

  textureStore(outDiv, vec3<i32>(gid), vec4<f32>(d, 0.0, 0.0, 0.0));
}
`;

/**
 * One Jacobi iteration of  laplacian(p) = D  with a 6-point stencil:
 *   p_new = (sum(p_neighbours) - h^2 * D) / 6
 * Interior obstacle cells keep the Neumann behaviour that falls out of the
 * stencil for free (their divergence is zero, so they just average neighbours).
 */
export const WGSL_JACOBI = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var inPressure: texture_3d<f32>;
@group(1) @binding(1) var inDiv: texture_3d<f32>;
@group(1) @binding(2) var sampNF: sampler;
@group(1) @binding(3) var outPressure: texture_storage_3d<rg32float, write>;

fn pAt(cell: vec3<f32>) -> f32 {
  return textureSampleLevel(inPressure, sampNF, gridToUv(cell), 0.0).x;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }

  let c = vec3<f32>(gid) + vec3<f32>(0.5);
  let h = max(sim.volSize.w, 1.0e-5);
  let d = textureSampleLevel(inDiv, sampNF, gridToUv(c), 0.0).x;

  let sum = pAt(c + vec3<f32>(1.0, 0.0, 0.0))
          + pAt(c - vec3<f32>(1.0, 0.0, 0.0))
          + pAt(c + vec3<f32>(0.0, 1.0, 0.0))
          + pAt(c - vec3<f32>(0.0, 1.0, 0.0))
          + pAt(c + vec3<f32>(0.0, 0.0, 1.0))
          + pAt(c - vec3<f32>(0.0, 0.0, 1.0));

  let p = (sum - h * h * d) * (1.0 / 6.0);
  textureStore(outPressure, vec3<i32>(gid), vec4<f32>(p, 0.0, 0.0, 0.0));
}
`;

/**
 * Projection: v -= grad(p).  This is the step that makes the smoke roll and
 * curl instead of ballooning outward.
 */
export const WGSL_PROJECT = WGSL_COMMON + /* wgsl */ `

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(1) @binding(0) var inVel: texture_3d<f32>;
@group(1) @binding(1) var inPressure: texture_3d<f32>;
@group(1) @binding(2) var samp: sampler;
@group(1) @binding(3) var sampNF: sampler;
@group(1) @binding(4) var outVel: texture_storage_3d<rgba16float, write>;

fn pAt(cell: vec3<f32>) -> f32 {
  return textureSampleLevel(inPressure, sampNF, gridToUv(cell), 0.0).x;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= sim.grid.xyz)) { return; }

  let c = vec3<f32>(gid) + vec3<f32>(0.5);
  let world = gridToWorld(vec3<f32>(gid) + vec3<f32>(0.5));
  let h = max(sim.volSize.w, 1.0e-5);
  let uv = gridToUv(c);

  var vel = textureSampleLevel(inVel, samp, uv, 0.0).xyz;

  if (!isSolid(world)) {
    let gp = vec3<f32>(
      pAt(c + vec3<f32>(1.0, 0.0, 0.0)) - pAt(c - vec3<f32>(1.0, 0.0, 0.0)),
      pAt(c + vec3<f32>(0.0, 1.0, 0.0)) - pAt(c - vec3<f32>(0.0, 1.0, 0.0)),
      pAt(c + vec3<f32>(0.0, 0.0, 1.0)) - pAt(c - vec3<f32>(0.0, 0.0, 1.0))
    ) / (2.0 * h);
    vel -= gp;
    vel = applyVelocityBoundary(vel, vec3<f32>(gid), world);
  } else {
    vel = vec3<f32>(0.0);
  }

  textureStore(outVel, vec3<i32>(gid), vec4<f32>(vel, 0.0));
}
`;
