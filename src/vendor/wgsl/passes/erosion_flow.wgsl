// Hydraulic erosion, stage 1: pipe-model outflow flux.
//
//   group 1 binding 0: height (normalised)  1: water depth (m)
//   group 2 binding 0: outFlux (rgba32float: right, down, left, up in m³/s)
//
// Flux is recomputed from scratch every step, so only one flux field is needed
// and the scheme cannot drift. The outflow is hard-limited to the water actually
// present, which is what keeps the whole simulation unconditionally stable.
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct FlowParams {
  dims: vec2u,
  dt: f32,
  cellMeters: f32,
  heightScale: f32,
  flowRate: f32,
  pipePower: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> P: FlowParams;

@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(1) @binding(1) var inWater: texture_2d<f32>;

@group(2) @binding(0) var outFlux: texture_storage_2d<rgba32float, write>;

fn head(m: texture_2d<f32>, w: texture_2d<f32>, c: vec2i, dims: vec2u, hs: f32) -> f32 {
  return hFetch(m, c, dims) * hs + max(hFetch(w, c, dims), 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let c = vec2i(gid.xy);
  let center = head(inHeight, inWater, c, P.dims, P.heightScale);
  let d = max(hFetch(inWater, c, P.dims), 0.0);

  var out = vec4f(
    max(center - head(inHeight, inWater, c + vec2i(1, 0), P.dims, P.heightScale), 0.0),
    max(center - head(inHeight, inWater, c + vec2i(0, 1), P.dims, P.heightScale), 0.0),
    max(center - head(inHeight, inWater, c + vec2i(-1, 0), P.dims, P.heightScale), 0.0),
    max(center - head(inHeight, inWater, c + vec2i(0, -1), P.dims, P.heightScale), 0.0));

  let total = out.x + out.y + out.z + out.w;
  if (total > 1e-9 && d > 1e-9) {
    // Manning-ish resistance: deeper, steeper water moves faster, but never
    // faster than the pipe can physically carry this step.
    let area = P.cellMeters * P.cellMeters;
    let rate = P.flowRate * pow(saturate(d * 40.0), P.pipePower);
    var flux = out * rate * P.cellMeters;             // m³/s
    let available = d * area / max(P.dt, 1e-4);        // m³/s the cell can give up
    let scale = min(1.0, available / max(flux.x + flux.y + flux.z + flux.w, 1e-9));
    flux = flux * scale;
    textureStore(outFlux, c, flux);
  } else {
    textureStore(outFlux, c, vec4f(0.0, 0.0, 0.0, 0.0));
  }
}
