// ===========================================================================
//  pick.wgsl — GPU ray-cast against the SDF for mouse picking.
//
//  Sculpting has to place the brush ON the rock the user is pointing at. The
//  CPU cannot cheaply know where that is: the volume lives on the GPU and
//  reading it back would stall the pipeline. So a single-thread compute pass
//  marches the ray and writes the hit position to a small buffer, which is
//  copied to a mapped staging buffer and read asynchronously.
//
//  The result is one frame stale. For a brush follow ing a cursor that is
//  imperceptible, and it keeps the frame pipeline completely free of blocking
//  readbacks.
// ===========================================================================

#include "volume.wgsl"

struct PickRequest {
  origin: vec3f,
  _p0:    f32,
  dir:    vec3f,
  _p1:    f32,
}

struct PickResult {
  pos:    vec3f,
  hit:    f32,   // 1.0 on hit, 0.0 on miss
  normal: vec3f,
  dist:   f32,
}

@group(0) @binding(1) var  volTex: texture_3d<f32>;
@group(0) @binding(2) var  volSamp: sampler;
@group(0) @binding(3) var<uniform> req: PickRequest;
@group(0) @binding(4) var<storage, read_write> result: PickResult;

fn sampleD(p: vec3f) -> f32 {
  return textureSampleLevel(volTex, volSamp, p / WORLD_SIZE, 0.0).r;
}

@compute @workgroup_size(1)
fn main() {
  let ro = req.origin;
  let rd = normalize(req.dir);

  let box = intersectBox(ro, rd, vec3f(0.0), WORLD_SIZE);
  let tNear = max(box.x, 0.0);
  let tFar = box.y;

  result.hit = 0.0;
  result.pos = ro + rd * max(tNear, 0.0);
  result.normal = vec3f(0.0, 1.0, 0.0);
  result.dist = tFar;

  if (tFar <= tNear) { return; }

  var t = tNear + 0.05;
  for (var i = 0; i < 320; i++) {
    let p = ro + rd * t;
    let d = sampleD(p);
    let eps = max(VOXEL_SIZE.x * 0.15, t * 0.001);
    if (d < eps) {
      result.pos = p;
      result.hit = 1.0;
      result.dist = t;
      let e = VOXEL_SIZE.x * 0.6;
      result.normal = normalize(vec3f(
        sampleD(p + vec3f(e, 0.0, 0.0)) - sampleD(p - vec3f(e, 0.0, 0.0)),
        sampleD(p + vec3f(0.0, e, 0.0)) - sampleD(p - vec3f(0.0, e, 0.0)),
        sampleD(p + vec3f(0.0, 0.0, e)) - sampleD(p - vec3f(0.0, 0.0, e)),
      ) + vec3f(0.0, 1e-6, 0.0));
      return;
    }
    t += max(d * 0.9, eps);
    if (t > tFar) { break; }
  }
}
