// ─────────────────────────────────────────────────────────────────────────────
//  Surface maps — horizon-based ambient occlusion and curvature, packed next to
//  the flow and deposition channels so the shading pass reads one texture.
//
//  surf.r = ambient occlusion      surf.g = flow / wetness
//  surf.b = deposition mask        surf.a = curvature (0.5 = flat)
// ─────────────────────────────────────────────────────────────────────────────

#include "lib.wgsl"

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> LP: array<LayerParams>;
@group(0) @binding(2) var<storage, read_write> H: array<f32>;
@group(0) @binding(3) var<storage, read_write> S: array<f32>;
@group(0) @binding(4) var<storage, read_write> AUX: array<f32>;
@group(0) @binding(5) var<storage, read_write> FX: array<atomic<i32>>;
@group(0) @binding(6) var<storage, read_write> FL: array<atomic<i32>>;
@group(0) @binding(7) var<storage, read_write> TMP: array<f32>;
@group(0) @binding(8) var<storage, read_write> TMP2: array<f32>;
@group(0) @binding(9) var surf: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var<storage, read_write> IDX: array<i32>;
@group(0) @binding(11) var<storage, read_write> IDX2: array<i32>;
@group(0) @binding(12) var<storage, read_write> RED: array<f32>;

fn res_() -> i32 { return i32(U.v0.x); }

/// World-space normal from central differences on the height field.
fn terrainNormal(uv: vec2<f32>) -> vec3<f32> {
  let r = f32(res_());
  let d = 1.0 / r;
  let hl = sampleField(&H, uv - vec2<f32>(d, 0.0), r);
  let hr = sampleField(&H, uv + vec2<f32>(d, 0.0), r);
  let hd = sampleField(&H, uv - vec2<f32>(0.0, d), r);
  let hu = sampleField(&H, uv + vec2<f32>(0.0, d), r);
  let k = (U.v1.z) / (2.0 * U.v1.w / r);
  return normalize(vec3<f32>(-(hr - hl) * k, 1.0, -(hu - hd) * k));
}

fn curvatureAt(uv: vec2<f32>) -> f32 {
  let r = f32(res_());
  let d = 1.0 / r;
  let hc = sampleField(&H, uv, r);
  let hl = sampleField(&H, uv - vec2<f32>(d, 0.0), r);
  let hr = sampleField(&H, uv + vec2<f32>(d, 0.0), r);
  let hd = sampleField(&H, uv - vec2<f32>(0.0, d), r);
  let hu = sampleField(&H, uv + vec2<f32>(0.0, d), r);
  return sat(0.5 + 0.5 * clamp((hl + hr + hd + hu - 4.0 * hc) * 24.0, -1.0, 1.0));
}

/// Horizon-based ambient occlusion: march each azimuth until the silhouette
/// angle stops rising, then average the sines of the horizon angles.
fn horizonAO(uv: vec2<f32>, h0: f32, n: vec3<f32>) -> f32 {
  let lp = LP[U.v0.y];
  let dirs = i32(clamp(lp.a[0].x, 2.0, 32.0));
  let steps = i32(clamp(lp.a[0].y, 2.0, 48.0));
  let radius = max(lp.a[0].z, 0.5) / U.v1.w;     // metres -> uv
  let strength = lp.a[0].w;
  let r = f32(res_());

  // build a tangent frame
  let up = select(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(1.0, 0.0, 0.0), abs(n.z) > 0.9);
  let T = normalize(cross(up, n));
  let B = cross(n, T);

  let jitter = hash12(uv * 1024.0);
  var acc = 0.0;
  let stepLen = radius / f32(steps);

  for (var k = 0; k < dirs; k = k + 1) {
    let phi = (f32(k) + jitter) * TAU / f32(dirs);
    let dw = normalize(cos(phi) * T + sin(phi) * B);
    // project the march onto the ground plane so it always advances in uv
    let duv = vec2<f32>(dw.x, dw.z) * stepLen;
    var maxTan = 0.0;
    for (var s = 1; s <= steps; s = s + 1) {
      let t = f32(s) * stepLen * U.v1.w;           // metres travelled
      let suv = uv + duv * f32(s);
      if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) { break; }
      let h = sampleField(&H, suv, r);
      let dh = (h - h0) * U.v1.z;                  // metres
      let horiz = dh / max(t, 1e-3);
      maxTan = max(maxTan, horiz);
    }
    let ang = atan(maxTan);
    acc = acc + sin(clamp(ang, 0.0, PI * 0.5));
  }
  return sat(1.0 - strength * acc / f32(dirs));
}

@compute @workgroup_size(8, 8, 1)
fn surfaceMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = i32(U.v0.x);
  if (i32(gid.x) >= r || i32(gid.y) >= r) { return; }
  let i = i32(gid.y) * r + i32(gid.x);
  let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) / f32(r);
  let h0 = H[i];
  let n = terrainNormal(uv);
  let ao = horizonAO(uv, h0, n);
  let cv = curvatureAt(uv);
  textureStore(surf, vec2<i32>(gid.xy), vec4<f32>(ao, AUX[i * 4], AUX[i * 4 + 1], cv));
}

