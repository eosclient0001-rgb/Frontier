// Sky pass — full-screen triangle, no geometry, no depth write.
//   group 0 binding 0: ViewUniforms
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/sky.wgsl"

@group(0) @binding(0) var<uniform> V: ViewUniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  var out: VSOut;
  out.pos = vec4f(pos[vid], 0.999999, 1.0);
  out.uv = pos[vid] * vec2f(0.5, -0.5) + vec2f(0.5);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // Reconstruct the view ray from the inverse view-projection so the sky is
  // pixel-exact with the terrain camera.
  let ndc = vec4f(in.uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 1.0, 1.0);
  let world = V.invViewProj * ndc;
  let dir = normalize(world.xyz / max(world.w, 1e-5) - V.cameraPos.xyz);
  var color = skyColor(V.sunDir.xyz, dir, 0.0);
  let mode = V.flags.w;
  if (mode > 0.5) {
    // Analysis modes get a flat backdrop so terrain data reads cleanly.
    if (mode < 1.5) { color = vec3f(0.07, 0.08, 0.1); }
  }
  return vec4f(color, 1.0);
}
