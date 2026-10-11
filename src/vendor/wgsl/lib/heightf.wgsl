// Frontier Terrain Forge — height-field access helpers.
//
// The height field lives in r32float textures so the graph keeps full float
// precision end to end. Inputs are bound as *sampled* textures and read with
// textureLoad + manual bilinear filtering: exact, dependency free, identical on
// every backend, and it leaves the per-stage storage-texture slots (4) for
// outputs only.

fn hFetch(h: texture_2d<f32>, coord: vec2i, dims: vec2u) -> f32 {
  let c = clamp(coord, vec2i(0), vec2i(i32(dims.x) - 1, i32(dims.y) - 1));
  return textureLoad(h, c, 0).x;
}

fn hFetchWrap(h: texture_2d<f32>, coord: vec2i, dims: vec2u) -> f32 {
  let n = vec2i(i32(dims.x), i32(dims.y));
  var c = coord;
  c = c - (c / n) * n;
  return textureLoad(h, c, 0).x;
}

/// Bilinear fetch in normalised UV space, clamped at the border.
fn hSample(h: texture_2d<f32>, dims: vec2u, uv: vec2f) -> f32 {
  let size = vec2f(f32(dims.x), f32(dims.y));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * size - vec2f(0.5);
  let i = floor(p);
  let f = p - i;
  let i0 = vec2i(i);
  let a = hFetch(h, i0, dims);
  let b = hFetch(h, i0 + vec2i(1, 0), dims);
  let c = hFetch(h, i0 + vec2i(0, 1), dims);
  let d = hFetch(h, i0 + vec2i(1, 1), dims);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/// Bilinear fetch in pixel space (texel centres at 0.5 offsets).
fn hSamplePix(h: texture_2d<f32>, dims: vec2u, pix: vec2f) -> f32 {
  let size = vec2f(f32(dims.x), f32(dims.y));
  return hSample(h, dims, (pix + vec2f(0.5)) / size);
}

/// Central-difference gradient, in metres of height per metre of ground.
fn hGradient(h: texture_2d<f32>, dims: vec2u, pix: vec2f, cellMeters: f32, heightScale: f32) -> vec2f {
  let dx = hSamplePix(h, dims, pix + vec2f(1.0, 0.0)) - hSamplePix(h, dims, pix - vec2f(1.0, 0.0));
  let dy = hSamplePix(h, dims, pix + vec2f(0.0, 1.0)) - hSamplePix(h, dims, pix - vec2f(0.0, 1.0));
  return vec2f(dx, dy) * heightScale / (2.0 * cellMeters);
}

/// Slope angle in radians (gradient magnitude is already metres per metre).
fn hSlopeAngle(h: texture_2d<f32>, dims: vec2u, pix: vec2f, cellMeters: f32, heightScale: f32) -> f32 {
  return atan(length(hGradient(h, dims, pix, cellMeters, heightScale)));
}

fn hNormal(h: texture_2d<f32>, dims: vec2u, pix: vec2f, cellMeters: f32, heightScale: f32, exaggeration: f32) -> vec3f {
  let g = hGradient(h, dims, pix, cellMeters, heightScale) * exaggeration;
  return normalize(vec3f(-g.x, -g.y, 1.0));
}

/// Mean curvature: positive in bowls (concave), negative on ridges (convex).
fn hCurvature(h: texture_2d<f32>, dims: vec2u, pix: vec2f, cellMeters: f32) -> f32 {
  let l = hSamplePix(h, dims, pix + vec2f(-1.0, 0.0));
  let r = hSamplePix(h, dims, pix + vec2f(1.0, 0.0));
  let u = hSamplePix(h, dims, pix + vec2f(0.0, -1.0));
  let d = hSamplePix(h, dims, pix + vec2f(0.0, 1.0));
  let c = hSamplePix(h, dims, pix);
  return ((l + r + u + d) * 0.25 - c) * max(cellMeters, 1e-4) * 1000.0;
}

/// Bilinear fetch of the first two channels. Fields that pack two related
/// signals (the erosion solver stores wetness and deposited mass together) are
/// read through this instead of two separate texture loads.
fn hSample2(h: texture_2d<f32>, dims: vec2u, uv: vec2f) -> vec2f {
  let size = vec2f(f32(dims.x), f32(dims.y));
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * size - vec2f(0.5);
  let i = floor(p);
  let f = p - i;
  let hi = vec2i(i32(dims.x) - 1, i32(dims.y) - 1);
  let i0 = clamp(vec2i(i), vec2i(0), hi);
  let a = textureLoad(h, i0, 0).xy;
  let b = textureLoad(h, clamp(i0 + vec2i(1, 0), vec2i(0), hi), 0).xy;
  let c = textureLoad(h, clamp(i0 + vec2i(0, 1), vec2i(0), hi), 0).xy;
  let d = textureLoad(h, clamp(i0 + vec2i(1, 1), vec2i(0), hi), 0).xy;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/// Wide blur with a cross + diagonal footprint (used by the Smooth modifier).
fn hBlur(h: texture_2d<f32>, dims: vec2u, pix: vec2f, radius: f32) -> f32 {
  let r = max(radius, 0.5);
  var sum = hSamplePix(h, dims, pix) * 0.25;
  sum = sum + hSamplePix(h, dims, pix + vec2f(r, 0.0)) * 0.125;
  sum = sum + hSamplePix(h, dims, pix + vec2f(-r, 0.0)) * 0.125;
  sum = sum + hSamplePix(h, dims, pix + vec2f(0.0, r)) * 0.125;
  sum = sum + hSamplePix(h, dims, pix + vec2f(0.0, -r)) * 0.125;
  sum = sum + hSamplePix(h, dims, pix + vec2f(r, r)) * 0.0625;
  sum = sum + hSamplePix(h, dims, pix + vec2f(-r, r)) * 0.0625;
  sum = sum + hSamplePix(h, dims, pix + vec2f(r, -r)) * 0.0625;
  sum = sum + hSamplePix(h, dims, pix + vec2f(-r, -r)) * 0.0625;
  return sum;
}
