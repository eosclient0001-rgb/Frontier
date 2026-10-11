// =================================================================================================
//  post.wgsl — bloom chain and filmic display transform
// -------------------------------------------------------------------------------------------------
//  One shared bind group layout serves all four entry points:
//    0 source texture · 1 bloom texture · 2 sampler · 3 uniform
//
//  Bloom exists because the scene is rendered in real physical units: sun glitter on water and
//  specular sparkle on snow are two or three orders of magnitude brighter than the terrain, and
//  without a glare chain they clip to flat white instead of reading as light.
//
//  The display transform is the ACES filmic fit. The output is encoded to sRGB explicitly because
//  the swap chain is a plain unorm format.
// =================================================================================================

struct Post {
  p0: vec4f,   // exposure, contrast, saturation, vignette
  p1: vec4f,   // grain, bloomIntensity, bloomThreshold, time
  p2: vec4f,   // temperature, tint, gamma, ---
  p3: vec4f,   // srcTexel.xy, bloomTexel.xy
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var bloomTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> P: Post;

struct FsIn {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsPost(@builtin(vertex_index) vi: u32) -> FsIn {
  var tri = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FsIn;
  out.uv = vec2f(tri[vi].x * 0.5 + 0.5, 0.5 - tri[vi].y * 0.5);
  out.pos = vec4f(tri[vi], 0.0, 1.0);
  return out;
}

// --- bloom prefilter: threshold with a soft knee, then a 13-tap downsample -------------------------

fn softThreshold(c: vec3f, threshold: f32) -> vec3f {
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let knee = max(threshold * 0.6, 1e-4);
  let soft = clamp(lum - threshold + knee, 0.0, 2.0 * knee);
  let w = max(soft * soft / (4.0 * knee), lum - threshold) / max(lum, 1e-5);
  return c * clamp(w, 0.0, 1.0);
}

@fragment
fn prefilter(in: FsIn) -> @location(0) vec4f {
  let t = P.p3.zw;
  var sum = vec3f(0.0);
  // Four bilinear taps offset along the diagonals average sixteen source pixels, which costs a
  // quarter of a full 4x4 box and looks the same after the blur that follows.
  sum += softThreshold(textureSampleLevel(srcTex, samp, in.uv + vec2f(-1.0, -1.0) * t, 0.0).rgb, P.p1.z);
  sum += softThreshold(textureSampleLevel(srcTex, samp, in.uv + vec2f(1.0, -1.0) * t, 0.0).rgb, P.p1.z);
  sum += softThreshold(textureSampleLevel(srcTex, samp, in.uv + vec2f(-1.0, 1.0) * t, 0.0).rgb, P.p1.z);
  sum += softThreshold(textureSampleLevel(srcTex, samp, in.uv + vec2f(1.0, 1.0) * t, 0.0).rgb, P.p1.z);
  sum += softThreshold(textureSampleLevel(srcTex, samp, in.uv, 0.0).rgb, P.p1.z) * 4.0;
  return vec4f(sum / 8.0, 1.0);
}

// --- separable gaussian ---------------------------------------------------------------------------

@fragment
fn blurH(in: FsIn) -> @location(0) vec4f {
  let t = P.p3.zw;
  var w = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var sum = textureSampleLevel(srcTex, samp, in.uv, 0.0).rgb * w[0];
  for (var i = 1; i < 5; i = i + 1) {
    let o = vec2f(f32(i) * 1.35, 0.0) * t;
    sum += textureSampleLevel(srcTex, samp, in.uv + o, 0.0).rgb * w[i];
    sum += textureSampleLevel(srcTex, samp, in.uv - o, 0.0).rgb * w[i];
  }
  return vec4f(sum, 1.0);
}

@fragment
fn blurV(in: FsIn) -> @location(0) vec4f {
  let t = P.p3.zw;
  var w = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var sum = textureSampleLevel(srcTex, samp, in.uv, 0.0).rgb * w[0];
  for (var i = 1; i < 5; i = i + 1) {
    let o = vec2f(0.0, f32(i) * 1.35) * t;
    sum += textureSampleLevel(srcTex, samp, in.uv + o, 0.0).rgb * w[i];
    sum += textureSampleLevel(srcTex, samp, in.uv - o, 0.0).rgb * w[i];
  }
  return vec4f(sum, 1.0);
}

// --- display transform ----------------------------------------------------------------------------

fn acesFitted(colorIn: vec3f) -> vec3f {
  let inputMat = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.13383, 0.83777)
  );
  let outputMat = mat3x3f(
    vec3f(1.60475, -0.10208, -0.00327),
    vec3f(-0.53108, 1.10813, -0.07276),
    vec3f(-0.07367, -0.00605, 1.07602)
  );
  let c = inputMat * colorIn;
  let a = c * (c + vec3f(0.0245786)) - vec3f(0.000090537);
  let b = c * (0.983729 * c + vec3f(0.4329510)) + vec3f(0.238081);
  return clamp(outputMat * (a / b), vec3f(0.0), vec3f(1.0));
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(1e-5)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

@fragment
fn composite(in: FsIn) -> @location(0) vec4f {
  var color = textureSampleLevel(srcTex, samp, in.uv, 0.0).rgb;

  // Bloom is added before the tone curve, in linear light, which is the only place it is physical.
  let bloom = textureSampleLevel(bloomTex, samp, in.uv, 0.0).rgb;
  color += bloom * P.p1.y;

  color *= P.p0.x;

  // White balance around 6500 K.
  let temp = P.p2.x;
  let tint = P.p2.y;
  let warm = vec3f(1.0 + temp * 0.12, 1.0 + temp * 0.02, 1.0 - temp * 0.14);
  let magenta = vec3f(1.0 + tint * 0.08, 1.0 - tint * 0.06, 1.0 + tint * 0.08);
  color *= warm * magenta;

  color = acesFitted(max(color, vec3f(0.0)));

  let lum = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(lum), color, P.p0.z);
  color = (color - 0.5) * P.p0.y + 0.5;

  // Vignette, measured from the frame centre.
  let d = in.uv - vec2f(0.5);
  let vig = 1.0 - P.p0.w * dot(d, d) * 1.9;
  color *= clamp(vig, 0.0, 1.0);

  color = clamp(color, vec3f(0.0), vec3f(1.0));
  var outC = linearToSrgb(color);

  // Grain and dither. The dither matters: without it, the smooth gradients in a sky band badly at
  // eight bits per channel.
  let n = fract(sin(dot(in.pos.xy + vec2f(P.p1.w * 37.13, P.p1.w * 17.71), vec2f(12.9898, 78.233))) * 43758.5453);
  outC += (n - 0.5) * (P.p1.x * 0.035 + 0.0035);

  return vec4f(clamp(outC, vec3f(0.0), vec3f(1.0)), 1.0);
}
