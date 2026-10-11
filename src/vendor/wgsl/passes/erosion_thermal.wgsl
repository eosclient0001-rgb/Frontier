// Thermal (talus) erosion — angle-of-repose relaxation over 8 neighbours.
//   group 1 binding 0: height    group 2 binding 0: outHeight
// Material above the talus angle slides, which is what produces scree aprons,
// softened ridge lines and the graded benches between cliff bands.
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct ThermalParams {
  dims: vec2u,
  dt: f32,
  cellMeters: f32,
  heightScale: f32,
  talus: f32,
  rate: f32,
  iterations: u32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: ThermalParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(2) @binding(0) var outHeight: texture_storage_2d<r32float, write>;

const TALUS_OFFSETS: array<vec2i, 8> = array<vec2i, 8>(
  vec2i(1, 0), vec2i(1, 1), vec2i(0, 1), vec2i(-1, 1),
  vec2i(-1, 0), vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1));

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let c = vec2i(gid.xy);
  let h = hFetch(inHeight, c, P.dims) * P.heightScale;

  var delta = 0.0;
  for (var i = 0u; i < 8u; i = i + 1u) {
    let off = TALUS_OFFSETS[i];
    let dist = P.cellMeters * select(1.0, 1.41421356, off.x != 0 && off.y != 0);
    let hn = hFetch(inHeight, c + off, P.dims) * P.heightScale;
    let drop = h - hn;
    let limit = P.talus * dist;
    if (drop > limit) {
      // Move just enough to reach the repose angle this step; the 0.5 keeps the
      // scheme from overshooting into oscillation.
      delta = delta - (drop - limit) * P.rate * 0.5;
    }
  }
  let out = clamp(h + delta, -1e5, 1e5) / P.heightScale;
  textureStore(outHeight, c, vec4f(clamp(out, -0.25, 1.9), 0.0, 0.0, 1.0));
}
