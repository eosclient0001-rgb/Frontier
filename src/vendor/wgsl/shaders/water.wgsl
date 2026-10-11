// Flat water surface. Drawn after the terrain with depth testing but no depth
// write, alpha-blended over the already-shaded bed, which is what lets the
// shoreline read as a soft wet transition instead of a hard intersection.
//   group 0 binding 0 : ViewUniforms   1 : linear sampler
//   group 1 : 0 height  1 albedo  2 flow
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"
//#include "../lib/sky.wgsl"

@group(0) @binding(0) var<uniform> V: ViewUniforms;
@group(0) @binding(1) var samp: sampler;
@group(1) @binding(0) var texHeight: texture_2d<f32>;
@group(1) @binding(1) var texAlbedo: texture_2d<f32>;
@group(1) @binding(2) var texFlow: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let n = max(V.grid.x, 2.0);
  let side = u32(n) + 1u;
  let x = vi % side;
  let y = vi / side;
  let uv = vec2f(f32(x), f32(y)) / n;
  let world = vec3f((uv.x - 0.5) * V.params.x, V.flags2.z, (uv.y - 0.5) * V.params.x);
  var out: VSOut;
  out.pos = V.viewProj * vec4f(world, 1.0);
  out.world = world;
  out.uv = uv;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let dims = vec2u(u32(V.params.w), u32(V.params.w));
  let terrain = hSample(texHeight, dims, in.uv) * V.params.y;
  let depth = V.flags2.z - terrain;
  if (depth <= 0.0) { discard; }

  let flow = hSample(texFlow, dims, in.uv);
  let bed = textureSampleLevel(texAlbedo, samp, in.uv, 0).rgb;

  // Surface normal from two crossing wave trains, damped in shallow water.
  let t = V.params.z;
  let shallow = saturate(depth * 6.0);
  let amp = 0.035 * mix(0.4, 1.0, shallow) + flow * 0.05;
  let waveX = sin(in.world.x * 0.55 + t * 1.9 + in.world.z * 0.12) * 0.5 + 0.5;
  let waveZ = cos(in.world.z * 0.61 - t * 1.5 + in.world.x * 0.09) * 0.5 + 0.5;
  let n = normalize(vec3f((waveX - 0.5) * amp * 2.0, 1.0, (waveZ - 0.5) * amp * 2.0));

  let viewDir = normalize(V.cameraPos.xyz - in.world);
  let fres = 0.02 + 0.98 * pow(1.0 - saturate(dot(n, viewDir)), 5.0);

  // Beer-Lambert absorption over the water column, per channel: red dies first,
  // which is what tints every real lake blue-green with depth.
  let absorb = exp(-depth * vec3f(2.4, 0.7, 0.42));
  let waterTint = vec3f(0.055, 0.16, 0.2);
  let refracted = bed * absorb + waterTint * (1.0 - absorb) * (1.0 - fres * 0.7);

  let refl = skyColor(V.sunDir.xyz, reflect(-viewDir, n), 0.45) * 0.85;
  var color = mix(refracted, refl, saturate(fres));

  // Specular glint from the sun.
  let h = normalize(normalize(V.sunDir.xyz) + viewDir);
  color = color + pow(saturate(dot(n, h)), 900.0) * V.sunDir.w * vec3f(1.0, 0.97, 0.9) * 2.0;

  // Shore foam: where flow energy is high and the water is thin.
  let foam = saturate(flow * 2.2) * (1.0 - shallow) * 0.7 + (1.0 - shallow) * 0.15;
  color = mix(color, vec3f(0.93, 0.96, 0.99), saturate(foam));

  // Deeper water is more opaque; shallow edges blend into the wet bed.
  let alpha = saturate(0.25 + depth * 8.0);
  return vec4f(color, alpha);
}
