// Final material pass: applies ambient occlusion and cavity, dust/wear on flats,
// wetness darkening near water and along flow lines, then writes the shipped
// ORM map (occlusion / roughness / metallic — glTF convention).
//
//   group 1 : 0 albedo  1 material  2 ao  3 flow  4 height
//   group 2 : 0 out albedo  1 out orm
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"

struct FinishParams {
  dims: vec2u,
  waterLevel: f32,
  wetness: f32,
  dust: f32,
  aoStrength: f32,
  cavityStrength: f32,
  saturateWet: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: FinishParams;
@group(1) @binding(0) var inAlbedo: texture_2d<f32>;
@group(1) @binding(1) var inMaterial: texture_2d<f32>;
@group(1) @binding(2) var inAo: texture_2d<f32>;
@group(1) @binding(3) var inFlow: texture_2d<f32>;
@group(1) @binding(4) var inHeight: texture_2d<f32>;
@group(2) @binding(0) var outAlbedo: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var outOrm: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let c = vec2i(gid.xy);
  var color = srgbToLinear(textureLoad(inAlbedo, c, 0).rgb);
  var mat = textureLoad(inMaterial, c, 0);
  let aoMap = textureLoad(inAo, c, 0).x;
  let flow = textureLoad(inFlow, c, 0).x;
  let h = textureLoad(inHeight, c, 0).x;

  // Ambient occlusion darkens crevices in the albedo a little too (dirt and
  // shadow accumulate there in reality), while the ORM map keeps the true AO.
  let ao = mix(1.0, aoMap, saturate(P.aoStrength));
  color = color * mix(1.0, ao, 0.65);

  // Wear: bright, desaturated dust on flat, high, dry ground.
  let wear = saturate(mat.a * P.dust * mix(1.0, 0.25, saturate(flow * 2.0)));
  let dust = vec3f(luminance(color) * 0.6 + 0.4);
  color = mix(color, mix(color, dust, 0.35), wear);

  // Wetness: darker, more saturated and glossier close to the water line and
  // along active flow lines. This is the single biggest realism cue at a
  // shoreline and it costs one lerp.
  let nearWater = saturate(1.0 - abs(h - P.waterLevel) * 12.0);
  let wet = saturate(max(flow * P.wetness, nearWater * P.saturateWet));
  color = mix(color, color * vec3f(0.55, 0.62, 0.7), wet * 0.85);
  let rough = mix(mat.x, mat.x * 0.35, wet);

  let orm = vec4f(ao, saturate(rough), saturate(mat.y), 1.0);
  textureStore(outAlbedo, c, vec4f(linearToSrgb(color), 1.0));
  textureStore(outOrm, c, orm);
}
