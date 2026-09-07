// ===========================================================================
//  sculpt.wgsl — interactive SDF brush.
//
//  Boolean CSG against the volume. Because the terrain is a distance field and
//  not a heightmap, ADD and SUBTRACT are fully symmetric: you can dig a cave
//  into a cliff, punch an arch clean through a fin, or stack an overhanging
//  boulder, and every one of those is a legal state. On a heightmap, half of
//  those operations have no representation at all.
//
//  Smooth-minimum blending keeps new material geologically continuous with
//  what is already there rather than leaving a visible seam.
// ===========================================================================

#include "volume.wgsl"

struct Brush {
  center:   vec3f,
  radius:   f32,
  strength: f32,   // >0 add, <0 subtract
  hardness: f32,   // 0 = very soft falloff, 1 = crisp edge
  shape:    u32,   // 0 sphere, 1 ellipsoid (flattened), 2 canyon-gouge
  mode:     u32,   // 0 blend, 1 smooth/relax, 2 flatten to plane
  axis:     vec3f, // for gouge / flatten
  extra:    f32,
}

@group(0) @binding(1) var  srcVol: texture_3d<f32>;
@group(0) @binding(2) var  dstVol: texture_storage_3d<rgba16float, write>;
@group(0) @binding(3) var<uniform> B: Brush;

fn loadV(c: vec3i) -> vec4f {
  let cc = clamp(c, vec3i(0), vec3i(VOLX - 1, VOLY - 1, VOLZ - 1));
  return textureLoad(srcVol, cc, 0);
}

/// The brush's own SDF.
fn brushSDF(p: vec3f) -> f32 {
  let q = p - B.center;
  switch B.shape {
    case 1u: {
      // Flattened ellipsoid — good for carving benches and mesa tops.
      let s = vec3f(1.0, 2.4, 1.0);
      let k = length(q * s);
      return (k - B.radius) / max(length(s), 1.0);
    }
    case 2u: {
      // Elongated gouge along `axis` — carves channels and slot canyons.
      let a = normalize(B.axis + vec3f(1e-5));
      let t = clamp(dot(q, a), -B.radius * 2.0, B.radius * 2.0);
      let radial = q - a * t;
      return length(radial) - B.radius * 0.55;
    }
    default: {
      return length(q) - B.radius;
    }
  }
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec3i(gid);
  if (c.x >= VOLX || c.y >= VOLY || c.z >= VOLZ) { return; }

  let vox = loadV(c);
  var d = vox.r;
  let p = voxelCenterToWorld(c);

  let bd = brushSDF(p);

  // Skip voxels well outside the brush — the brush is small relative to the
  // volume, so this early-out keeps sculpting interactive.
  if (bd > B.radius * 1.5) {
    textureStore(dstVol, c, vox);
    return;
  }

  // Falloff, 1 at the centre to 0 at the rim.
  let fall = 1.0 - saturate(bd / max(B.radius, 1e-4) + 1.0) * 0.0;
  let w = pow(saturate(-bd / max(B.radius, 1e-4)), mix(2.5, 0.4, saturate(B.hardness)));

  let k = B.radius * mix(0.9, 0.05, saturate(B.hardness));

  switch B.mode {
    case 1u: {
      // Relax: pull toward the neighbourhood average — smooths rough rock.
      let avg = (
          loadV(c + vec3i(1, 0, 0)).r + loadV(c - vec3i(1, 0, 0)).r
        + loadV(c + vec3i(0, 1, 0)).r + loadV(c - vec3i(0, 1, 0)).r
        + loadV(c + vec3i(0, 0, 1)).r + loadV(c - vec3i(0, 0, 1)).r) / 6.0;
      d = mix(d, avg, w * saturate(abs(B.strength)));
    }
    case 2u: {
      // Flatten toward the plane through center with normal `axis`.
      let plane = dot(p - B.center, normalize(B.axis + vec3f(1e-5)));
      d = mix(d, plane, w * saturate(abs(B.strength)));
    }
    default: {
      if (B.strength >= 0.0) {
        // ADD material: union with the brush.
        let target = smin(d, bd, k);
        d = mix(d, target, saturate(B.strength) * saturate(w * 2.0 + 0.35));
      } else {
        // SUBTRACT: difference. This is what carves caves, arches, alcoves.
        let target = smax(d, -bd, k);
        d = mix(d, target, saturate(-B.strength) * saturate(w * 2.0 + 0.35));
      }
    }
  }

  d = max(d, domainSDF(p));
  textureStore(dstVol, c, vec4f(d, vox.g, vox.b, vox.a));
}
