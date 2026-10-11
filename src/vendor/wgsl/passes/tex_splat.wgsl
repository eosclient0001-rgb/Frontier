// Packs per-layer coverage into the two RGBA splat maps that ship with the tile.
// Coverage is the source-over contribution of each layer, so the exported splat
// maps reproduce the baked albedo exactly when a game engine blends them in the
// same order.
//
//   group 1 : weight 0..7     group 2 : 0 splat0 (w0..w3)  1 splat1 (w4..w7)
//#include "../lib/mathx.wgsl"

struct SplatParams {
  dims: vec2u,
  layers: u32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: SplatParams;
@group(1) @binding(0) var w0: texture_2d<f32>;
@group(1) @binding(1) var w1: texture_2d<f32>;
@group(1) @binding(2) var w2: texture_2d<f32>;
@group(1) @binding(3) var w3: texture_2d<f32>;
@group(1) @binding(4) var w4: texture_2d<f32>;
@group(1) @binding(5) var w5: texture_2d<f32>;
@group(1) @binding(6) var w6: texture_2d<f32>;
@group(1) @binding(7) var w7: texture_2d<f32>;
@group(2) @binding(0) var outSplat0: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var outSplat1: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let c = vec2i(gid.xy);
  var cover = 1.0;
  var out0 = vec4f(0.0);
  var out1 = vec4f(0.0);
  let w = array<f32, 8>(
    textureLoad(w0, c, 0).x, textureLoad(w1, c, 0).x,
    textureLoad(w2, c, 0).x, textureLoad(w3, c, 0).x,
    textureLoad(w4, c, 0).x, textureLoad(w5, c, 0).x,
    textureLoad(w6, c, 0).x, textureLoad(w7, c, 0).x);
  for (var i = 0u; i < 8u; i = i + 1u) {
    let inRange = i < P.layers;
    let a = select(0.0, w[i], inRange) * cover;
    cover = cover * (1.0 - select(0.0, w[i], inRange));
    if (i < 4u) {
      let slot = i;
      if (slot == 0u) { out0.x = a; } else if (slot == 1u) { out0.y = a; }
      else if (slot == 2u) { out0.z = a; } else { out0.w = a; }
    } else {
      let slot = i - 4u;
      if (slot == 0u) { out1.x = a; } else if (slot == 1u) { out1.y = a; }
      else if (slot == 2u) { out1.z = a; } else { out1.w = a; }
    }
  }
  textureStore(outSplat0, c, out0);
  textureStore(outSplat1, c, out1);
}
