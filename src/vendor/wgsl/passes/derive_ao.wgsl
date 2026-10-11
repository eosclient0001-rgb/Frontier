// Horizon-based ambient occlusion + cavity, evaluated on a half-resolution grid
// (AO is a low-frequency signal; computing it at half res keeps 4K affordable
// and the bilinear upsample hides nothing).
//   group 1 binding 0: height    group 2 binding 0: outAo (rgba16float, .x)
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct AoParams {
  dims: vec2u,
  srcDims: vec2u,
  cellMeters: f32,
  heightScale: f32,
  radius: f32,
  strength: f32,
  cavity: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: AoParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(2) @binding(0) var outAo: texture_storage_2d<rgba16float, write>;

const AO_DIRECTIONS: u32 = 12u;
const AO_STEPS: u32 = 10u;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(P.dims);
  let h0 = hSample(inHeight, P.srcDims, uv) * P.heightScale;

  var occlusion = 0.0;
  for (var d = 0u; d < AO_DIRECTIONS; d = d + 1u) {
    let ang = (f32(d) + 0.5) / f32(AO_DIRECTIONS) * TAU;
    let dir = vec2f(cos(ang), sin(ang));
    var maxTan = 0.0;
    var step = P.cellMeters * 2.0;
    for (var s = 0u; s < AO_STEPS; s = s + 1u) {
      let dist = (f32(P.srcDims.x) * (2.0 + f32(s) * 2.6));
      let sampleUv = clamp(uv + dir * dist / vec2f(P.srcDims), vec2f(0.0), vec2f(1.0));
      let hs = hSample(inHeight, P.srcDims, sampleUv) * P.heightScale;
      // Horizon angle, scaled by the search radius so the darkest cavities are
      // the deep ones rather than the simply steep ones.
      let rise = hs - h0;
      let dx = step * (1.0 + f32(s) * 1.6);
      maxTan = max(maxTan, rise / max(dx, 1e-3));
      step = step * 1.55;
    }
    // A horizon that rises above the surface occludes in proportion to its sine.
    occlusion = occlusion + maxTan / sqrt(1.0 + maxTan * maxTan);
  }
  let horizonOcclusion = occlusion / f32(AO_DIRECTIONS);
  var ao = saturate(1.0 - horizonOcclusion * P.strength);

  // Cavity: tight crevices get an extra darkening that a horizon search at this
  // step count cannot see.
  let cavity = hCurvature(inHeight, P.srcDims, vec2f(gid.xy) * vec2f(P.srcDims) / vec2f(P.dims), P.cellMeters);
  ao = saturate(ao * mix(1.0, saturate(0.35 - cavity * 1.4), saturate(P.cavity)));

  textureStore(outAo, vec2i(gid.xy), vec4f(ao, 0.0, 0.0, 1.0));
}
