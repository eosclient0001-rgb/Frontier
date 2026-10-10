// ─────────────────────────────────────────────────────────────────────────────
//  Pack the height field into the filterable two-channel encoding the render
//  passes sample:  r = f16(h)   g = h - f16(h)   ba = slope gradient.
//
//  Because bilinear filtering is linear, filter(r) + filter(g) reconstructs the
//  height at roughly float precision even though the texture is 16-bit.
// ─────────────────────────────────────────────────────────────────────────────
#include "lib.wgsl"

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> H: array<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

fn toF16(x: f32) -> f32 {
  if (abs(x) < 6.1035e-5) { return x; }
  let e = floor(log2(abs(x)));
  let m = exp2(e - 10.0);
  return round(x / m) * m;
}

@compute @workgroup_size(8, 8, 1)
fn packHeight(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = i32(U.v0.x);
  if (i32(gid.x) >= r || i32(gid.y) >= r) { return; }
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  let i = gy * r + gx;
  let uv = (vec2<f32>(f32(gx), f32(gy)) + 0.5) / f32(r);
  let h = H[i];
  let a = toF16(h);
  let d = 1.0 / f32(r);
  let hl = sampleFieldR(&H, uv - vec2<f32>(d, 0.0), f32(r));
  let hr = sampleFieldR(&H, uv + vec2<f32>(d, 0.0), f32(r));
  let hd = sampleFieldR(&H, uv - vec2<f32>(0.0, d), f32(r));
  let hu = sampleFieldR(&H, uv + vec2<f32>(0.0, d), f32(r));
  let k = U.v1.z / (2.0 * U.v1.w / f32(r));
  let gxa = clamp((hr - hl) * k, -8.0, 8.0);
  let gza = clamp((hu - hd) * k, -8.0, 8.0);
  textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(a, h - a, gxa, gza));
}
