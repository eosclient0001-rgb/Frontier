// Sun depth pass — same grid as the surface, rendered from the light.
//   group 0 binding 0: LightParams   1: height
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

@group(0) @binding(0) var<uniform> L: LightParams;
@group(1) @binding(0) var texHeight: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let n = max(L.grid.x, 2.0);
  let side = u32(n) + 1u;
  let x = vi % side;
  let y = vi / side;
  let uv = vec2f(f32(x), f32(y)) / n;
  let field = vec2u(u32(max(L.grid.y, 2.0)), u32(max(L.grid.y, 2.0)));
  let h = hSample(texHeight, field, uv) * L.lightExtent.z;
  let world = vec3f((uv.x - 0.5) * L.lightExtent.y, h, (uv.y - 0.5) * L.lightExtent.y);
  return L.lightViewProj * vec4f(world, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f { return vec4f(1.0); }
