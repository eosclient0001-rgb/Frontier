// ─────────────────────────────────────────────────────────────────────────────
//  Builds the terrain index buffer on the GPU: a regular grid plus a skirt that
//  drops down to form the plinth block the terrain sits on.
//
//  vertices [0, (R+1)^2)                    grid
//  vertices [(R+1)^2, (R+1)^2 + 8(R+1))      skirt: 4 sides x (top + bottom)
// ─────────────────────────────────────────────────────────────────────────────

#include "lib.wgsl"

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read_write> IDXBUF: array<u32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let R = U.v0.x;
  let S = R + 1u;
  let grid = R * R;
  let skirt = R * 4u;
  let total = grid + skirt;
  if (gid.x >= total) { return; }

  if (gid.x < grid) {
    let gx = gid.x % R;
    let gy = gid.x / R;
    let a = gy * S + gx;
    let b = a + 1u;
    let c = a + S;
    let d = c + 1u;
    let o = gid.x * 6u;
    IDXBUF[o + 0u] = a;
    IDXBUF[o + 1u] = c;
    IDXBUF[o + 2u] = b;
    IDXBUF[o + 3u] = b;
    IDXBUF[o + 4u] = c;
    IDXBUF[o + 5u] = d;
  } else {
    let q = gid.x - grid;
    let side = q / R;
    let j = q % R;
    let base = S * S + side * 2u * S;
    let t0 = base + j;
    let t1 = base + j + 1u;
    let b0 = base + S + j;
    let b1 = base + S + j + 1u;
    let o = gid.x * 6u;
    IDXBUF[o + 0u] = t0;
    IDXBUF[o + 1u] = b0;
    IDXBUF[o + 2u] = b1;
    IDXBUF[o + 3u] = t0;
    IDXBUF[o + 4u] = b1;
    IDXBUF[o + 5u] = t1;
  }
}
