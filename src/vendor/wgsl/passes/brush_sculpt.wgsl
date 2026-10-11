// Sculpt brush — raise / lower / smooth / flatten / noise / carve.
//   group 1: 0 height  1 sculpt (read)   group 2 binding 0: outSculpt
// The brush accumulates into a persistent sculpt buffer rather than baking into
// the height field, so layers can be re-tuned afterwards without losing strokes.
//#include "../lib/mathx.wgsl"
//#include "../lib/noise.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct BrushParams {
  dims: vec2u,
  center: vec2f,
  radius: f32,
  strength: f32,
  falloff: f32,
  mode: u32,
  seed: f32,
  spacing: f32,
  noiseScale: f32,
  inverted: u32,
  origin: vec2i,   // top-left texel of this dispatch (brushes only touch their
                   // own bounding box, so a stroke stays cheap at 4K)
};

@group(0) @binding(0) var<uniform> P: BrushParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(1) @binding(1) var inSculpt: texture_2d<f32>;
@group(2) @binding(0) var outSculpt: texture_storage_2d<rgba32float, write>;

fn brushWeight(uv: vec2f) -> f32 {
  let d = length((uv - P.center) * vec2f(P.dims));
  let r = max(P.radius * f32(P.dims.x), 1.0);
  if (d > r) { return 0.0; }
  let t = 1.0 - d / r;
  return pow(saturate(t), max(P.falloff, 0.05));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec2i(gid.xy) + P.origin;
  if (c.x < 0 || c.y < 0 || c.x >= i32(P.dims.x) || c.y >= i32(P.dims.y)) { return; }
  let uv = (vec2f(c) + vec2f(0.5)) / vec2f(P.dims);
  var s = textureLoad(inSculpt, c, 0);

  let w = brushWeight(uv);
  if (w > 0.0) {
    let amount = w * P.strength * select(1.0, -1.0, P.inverted == 1u);
    let h = hSample(inHeight, P.dims, uv);
    switch (P.mode) {
      case 0u: { s.x = s.x + amount; }                     // raise
      case 1u: { s.x = s.x - amount; }                     // lower
      case 2u: {                                           // smooth
        let blurred = hBlur(inHeight, P.dims, vec2f(c), 6.0);
        s.y = saturate(s.y + w * abs(P.strength) * 6.0);
        s.z = mix(s.z, blurred, saturate(w * abs(P.strength) * 12.0));
      }
      case 3u: {                                           // flatten
        let center = hSample(inHeight, P.dims, P.center);
        s.y = saturate(s.y + w * abs(P.strength) * 6.0);
        s.z = mix(s.z, center, saturate(w * abs(P.strength) * 12.0));
      }
      case 4u: {                                           // noise dress
        let n = fbm(uv * max(P.noiseScale, 1.0) * 64.0, 4u, 2.0, 0.5, seedOf(P.seed, 7u));
        s.x = s.x + (n - 0.5) * amount * 2.0;
      }
      case 5u: {                                           // carve along gradient
        let g = hGradient(inHeight, P.dims, vec2f(c), 1.0, 1.0);
        s.x = s.x - amount * saturate(length(g) * 3.0);
      }
      case 6u: {                                           // terrace stamp
        let steps = max(P.noiseScale, 1.0);
        s.x = s.x + (terraceCurve(saturate(h + amount), steps, 6.0) - h) * w;
      }
      default: { s.x = s.x + amount; }
    }
  }
  textureStore(outSculpt, c, s);
}
