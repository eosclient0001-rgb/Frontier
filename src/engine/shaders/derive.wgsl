// =================================================================================================
//  derive.wgsl — turn the height field into everything the renderer needs
// -------------------------------------------------------------------------------------------------
//  Publishes the solved field into GPU textures:
//    heightTex  r32float     normalised height (the vertex shader displaces from this)
//    normalTex  rgba16float  world normal + sin(slope)
//    surfTex    rgba16float  ambient occlusion, signed curvature, wetness, cavity
//
//  Ambient occlusion is computed as horizon occlusion on the height field rather than in screen
//  space: terrain self-shadowing is dominated by large landforms, which a screen-space pass misses
//  entirely whenever a ridge leaves the frame. Cavity is the small-scale complement — the difference
//  between the surface and a blurred copy of itself — and is what gives gravel and scree their
//  contact darkening.
// =================================================================================================

struct DeriveParams {
  p0: vec4u,   // res, aoDirs, aoSteps, flags
  p1: vec4f,   // cellMeters, heightMeters, aoStrength, aoRadiusMeters
};

@group(0) @binding(0) var<uniform> P: DeriveParams;
@group(0) @binding(1) var<storage, read> FLD: array<f32>;
@group(0) @binding(2) var<storage, read> WET: array<f32>;
@group(0) @binding(3) var heightTex: texture_storage_2d<r32float, write>;
@group(0) @binding(4) var normalTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var surfTex: texture_storage_2d<rgba16float, write>;

fn res() -> i32 { return i32(P.p0.x); }

fn hRaw(x: i32, y: i32) -> f32 {
  let r = res();
  return FLD[u32(clamp(y, 0, r - 1) * r + clamp(x, 0, r - 1))];
}

fn hWorld(x: i32, y: i32) -> f32 { return hRaw(x, y) * P.p1.y; }

fn horizonAO(x: i32, y: i32, hw: f32) -> f32 {
  let dirs = max(P.p0.y, 1u);
  let steps = max(P.p0.z, 1u);
  let r = res();
  let cell = max(P.p1.x, 1e-3);
  // The march doubles its stride every few steps so a long radius stays cheap.
  let maxDist = max(P.p1.w, cell);
  var occ = 0.0;
  // Deterministic per-pixel rotation removes the banding a fixed direction set produces.
  let jitter = f32(((u32(x) * 1973u + u32(y) * 9277u) ^ 0x9e3779b9u) % 1024u) / 1024.0;
  for (var d = 0u; d < dirs; d = d + 1u) {
    let ang = 6.2831853 * (f32(d) + jitter) / f32(dirs);
    let dir = vec2f(cos(ang), sin(ang));
    var maxTan = 0.0;
    var dist = cell;
    let stride = maxDist / (f32(steps) * cell);
    for (var s = 0u; s < steps; s = s + 1u) {
      let off = dir * (dist / cell);
      let sx = x + i32(round(off.x));
      let sy = y + i32(round(off.y));
      if (sx < 0 || sy < 0 || sx >= r || sy >= r) { break; }
      let dh = hWorld(sx, sy) - hw;
      let t = dh / max(dist, 1e-3);
      maxTan = max(maxTan, t);
      dist += cell * stride;
    }
    // sin(elevation of the horizon), clamped to the upper hemisphere
    let sinH = maxTan / sqrt(1.0 + maxTan * maxTan);
    occ += clamp(sinH, 0.0, 1.0);
  }
  let ao = 1.0 - (occ / f32(dirs)) * clamp(P.p1.z, 0.0, 1.0);
  return clamp(ao, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let i = u32(y * r + x);
  let cell = max(P.p1.x, 1e-3);

  // --- normal -------------------------------------------------------------------------------------
  let dhx = (hWorld(x + 1, y) - hWorld(x - 1, y)) / (2.0 * cell);
  let dhz = (hWorld(x, y + 1) - hWorld(x, y - 1)) / (2.0 * cell);
  let n = normalize(vec3f(-dhx, 1.0, -dhz));
  let slope = clamp(length(vec2f(dhx, dhz)) / sqrt(1.0 + dhx * dhx + dhz * dhz), 0.0, 1.0);

  // --- curvature ----------------------------------------------------------------------------------
  let lap = (hWorld(x - 1, y) + hWorld(x + 1, y) + hWorld(x, y - 1) + hWorld(x, y + 1) - 4.0 * hWorld(x, y));
  // -lap * 1/m normalised against a 250 m reference radius; + convex, - concave
  let curv = clamp(-lap / (cell * cell) * 250.0, -1.0, 1.0);

  // --- cavity (small scale) -----------------------------------------------------------------------
  var near = 0.0;
  var far = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var o = -1; o <= 1; o = o + 1) {
      near += hWorld(x + o, y + j);
    }
  }
  near = near / 9.0;
  for (var j = -3; j <= 3; j = j + 3) {
    for (var o = -3; o <= 3; o = o + 3) {
      far += hWorld(x + o, y + j);
    }
  }
  far = far / 9.0;
  let cavity = clamp(((hWorld(x, y) - near) * 0.6 + (hWorld(x, y) - far) * 0.25) / cell, -1.0, 1.0);

  // --- occlusion ----------------------------------------------------------------------------------
  let ao = horizonAO(x, y, hWorld(x, y));
  let wet = WET[i];

  textureStore(heightTex, vec2i(x, y), vec4f(hRaw(x, y), 0.0, 0.0, 1.0));
  textureStore(normalTex, vec2i(x, y), vec4f(n, slope));
  textureStore(surfTex, vec2i(x, y), vec4f(ao, curv, wet, cavity));
}
