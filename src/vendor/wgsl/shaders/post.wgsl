// Tonemapping and grade. The scene is rendered into a linear rgba16float target,
// so exposure, the ACES curve, the grade, vignette and grain all happen here in
// one pass before the sRGB encode onto the canvas.
//   group 0 binding 0: ViewUniforms   1: linear sampler   2: scene colour
//#include "../lib/mathx.wgsl"
//#include "../lib/hash.wgsl"
//#include "../lib/params.wgsl"

@group(0) @binding(0) var<uniform> V: ViewUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var texScene: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  var out: VSOut;
  out.pos = vec4f(pos[vid], 0.0, 1.0);
  out.uv = pos[vid] * vec2f(0.5, -0.5) + vec2f(0.5);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  var color = textureSampleLevel(texScene, samp, in.uv, 0).rgb;

  color = color * V.cameraPos.w;                       // exposure
  color = acesFilm(color * 0.85);                      // filmic shoulder
  color = colorGrade(color, V.grade.x, V.grade.y, vec3f(0.0, 0.0, 0.004), vec3f(1.02, 1.0, 0.98));

  // Vignette and a whisper of grain — the two cues that say "photographed".
  let d = length(in.uv - vec2f(0.5));
  let vignette = smoothstep(0.95, 0.25, d * (1.0 + V.grade.z));
  color = color * mix(1.0, vignette, clamp(V.grade.z, 0.0, 1.0));
  let grain = hash12(in.uv * V.params.z * 60.13 + vec2f(V.params.z)) - 0.5;
  color = color + grain * V.grade.w * 0.02;

  return vec4f(linearToSrgb(saturate3(color)), 1.0);
}
