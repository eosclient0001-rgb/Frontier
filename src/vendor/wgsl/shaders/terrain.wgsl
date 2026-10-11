// Terrain surface pass (vertex + fragment in one module, as a render pipeline
// requires). The mesh is a flat UV grid synthesised from the vertex index — no
// vertex buffer traffic — and the height comes from a manual bilinear fetch of
// the full-resolution height field, so the silhouette follows the exact data the
// simulation produced.
//
//   group 0 binding 0 : ViewUniforms   1 : linear sampler
//            binding 2 : LightParams   3 : shadow sampler
//   group 1 : 0 albedo(sRGB view)  1 orm  2 normal  3 ao  4 height  5 flow
//             6 shadow map (depth)
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"
//#include "../lib/sky.wgsl"

@group(0) @binding(0) var<uniform> V: ViewUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> L: LightParams;
@group(0) @binding(3) var sampShadow: sampler;

@group(1) @binding(0) var texAlbedo: texture_2d<f32>;
@group(1) @binding(1) var texOrm: texture_2d<f32>;
@group(1) @binding(2) var texNormal: texture_2d<f32>;
@group(1) @binding(3) var texAo: texture_2d<f32>;
@group(1) @binding(4) var texHeight: texture_2d<f32>;
@group(1) @binding(5) var texFlow: texture_2d<f32>;
@group(1) @binding(6) var texShadow: texture_depth_2d;

const SUN_ANGULAR_RADIUS: f32 = 0.012;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) height: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  // The render mesh is a UV grid whose resolution is independent of the height
  // field: V.grid.x vertices per side, sampled against V.params.w texels.
  let n = max(V.grid.x, 2.0);
  let side = u32(n) + 1u;
  let x = vi % side;
  let y = vi / side;
  let uv = vec2f(f32(x), f32(y)) / n;
  let h = hSample(texHeight, vec2u(u32(n), u32(n)), uv);
  let world = vec3f((uv.x - 0.5) * V.params.x, h * V.params.y, (uv.y - 0.5) * V.params.x);

  var out: VSOut;
  out.pos = V.viewProj * vec4f(world, 1.0);
  out.uv = uv;
  out.world = world;
  out.height = h;
  return out;
}

/// 3x3 PCF against the sun map, with normal-offset bias against acne on the
/// near-vertical faces that the normal-offset term alone cannot fix.
fn sampleShadow(world: vec3f, n: vec3f, slope: f32) -> f32 {
  let lightClip = L.lightViewProj * vec4f(world + n * L.shadow.y, 1.0);
  let ndc = lightClip.xyz / max(lightClip.w, 1e-6);
  let uv = ndc.xy * vec2f(0.5, -0.5) + vec2f(0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  let depth = ndc.z;
  // Slope-scaled depth bias: grazing light needs more room than overhead light.
  let bias = L.shadow.x * (1.0 + slope * 2.5);
  // The map is fetched with textureLoad, not a filtering sampler: depth and
  // float32 formats are not filterable on every device, and this PCF kernel is
  // exact texel arithmetic anyway.
  let mapSize = max(1.0 / max(L.lightDir.w, 1e-6), 1.0);
  let limit = vec2f(mapSize) - vec2f(1.0);
  let base = uv * mapSize;
  var lit = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let texel = clamp(base + vec2f(f32(x), f32(y)) * L.shadow.z, vec2f(0.0), limit);
      let stored = textureLoad(texShadow, vec2i(texel), 0);
      lit = lit + select(0.0, 1.0, depth - bias <= stored);
    }
  }
  return mix(1.0, lit / 9.0, saturate(L.shadow.w));
}

/// Contour interval in normalised height units.
fn contourLine(h: f32, interval: f32, width: f32) -> f32 {
  let band = abs(fract(h / interval + 0.5) - 0.5) * interval;
  return 1.0 - saturate(band / max(width, 1e-5));
}

@fragment
fn fs(in: VSOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let uv = in.uv;
  let albedo = textureSampleLevel(texAlbedo, samp, uv, 0).rgb;
  let orm = textureSampleLevel(texOrm, samp, uv, 0);
  let nTex = textureSampleLevel(texNormal, samp, uv, 0).xyz * 2.0 - vec3f(1.0);
  let aoMap = textureSampleLevel(texAo, samp, uv, 0).x;
  // Wetness lives in an r32float field, which is not guaranteed to be
  // filterable, so it is bilinearly fetched by hand.
  let flow = hSample(texFlow, vec2u(u32(max(V.params.w, 2.0)), u32(max(V.params.w, 2.0))), uv);

  // Geometric normal from the height field: exact at every mesh resolution and
  // it removes the faceting a coarse mesh would otherwise show on flanks.
  let dims = vec2u(u32(V.params.w), u32(V.params.w));
  let nGeo = hNormal(texHeight, dims, uv * V.params.w - vec2f(0.5), V.params.x / V.params.w, V.params.y, 1.0);
  // Blend in the baked micro normal — it carries everything finer than a texel
  // of the shading grid, which is where the close-up detail lives.
  var n = normalize(vec3f(nGeo.x + nTex.x * 0.9, -nGeo.y + nTex.y * 0.9, nGeo.z + nTex.z));
  if (!front) { n = -n; }

  let sunDir = normalize(V.sunDir.xyz);
  let viewDir = normalize(V.cameraPos.xyz - in.world);
  let sunColor = V.sunColor.rgb * V.sunDir.w;
  let slope = saturate(atan(length(nGeo.xy / max(nGeo.z, 1e-3))) / 1.55334303);
  let occlusion = mix(1.0, aoMap, 0.85);

  let ndl = clamp((dot(n, sunDir) + SUN_ANGULAR_RADIUS) / (1.0 + SUN_ANGULAR_RADIUS), 0.0, 1.0);
  let shadow = sampleShadow(in.world, n, slope);

  let skyLight = skyColor(sunDir, n, 0.35) * V.sunColor.w;
  // Bounce light: the ground returns a little of its own colour to itself, which
  // is what keeps shadowed slopes from reading as flat grey.
  let bounceDir = normalize(vec3f(-n.x * 0.4, 0.35, -n.z * 0.4));
  let bounce = skyColor(sunDir, bounceDir, 0.0) * albedo * 0.3 * occlusion;

  let roughness = clamp(orm.y, 0.03, 1.0);
  let metallic = orm.z;
  let f0 = mix(vec3f(0.04), albedo, metallic);
  let h = normalize(sunDir + viewDir);
  let ndh = saturate(dot(n, h));
  let ndv = saturate(dot(n, viewDir)) + 1e-4;
  let vdh = saturate(dot(viewDir, h));
  let a = roughness * roughness;
  let a2 = a * a;
  let dTerm = a2 / (PI * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
  let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  let gTerm = (ndv / (ndv * (1.0 - k) + k)) * (ndl / (ndl * (1.0 - k) + k));
  let fTerm = f0 + (vec3f(1.0) - f0) * pow(1.0 - vdh, 5.0);
  let specular = dTerm * gTerm * fTerm * sunColor * shadow;

  let diffuseColor = albedo * (1.0 - metallic);
  var color = diffuseColor * (ndl * shadow * sunColor + skyLight * occlusion) + specular + bounce;

  // Wet surfaces: darker, glossier and they pick up a sky sheen.
  let wet = saturate(flow);
  let sheen = pow(1.0 - ndv, 5.0) * wet * 0.35 * skyColor(sunDir, reflect(-viewDir, n), 0.5);
  color = mix(color, color * vec3f(0.74, 0.77, 0.82) + sheen, wet * 0.55);

  // ---- overlays and analysis modes --------------------------------------
  let mode = V.flags.w;
  if (V.flags.y > 0.5) {
    let interval = max(V.flags2.w, 1.0) / max(V.params.y, 1e-3);
    let line = contourLine(in.height, interval, interval * 0.06);
    let major = contourLine(in.height, interval * 5.0, interval * 0.22);
    color = mix(color, vec3f(0.98, 0.95, 0.86), line * 0.55 + major * 0.35);
  }
  if (V.flags.z > 0.5) {
    color = mix(color, vec3f(0.92, 0.24, 0.18), saturate(slope * 1.5 - 0.28) * 0.6);
  }
  if (mode > 0.5) {
    if (mode < 1.5) {
      let ramp = rampColorSmooth(array<vec4f, 8>(
        vec4f(0.04, 0.08, 0.16, 0.0), vec4f(0.09, 0.2, 0.27, 0.14), vec4f(0.24, 0.36, 0.24, 0.28),
        vec4f(0.46, 0.46, 0.26, 0.42), vec4f(0.68, 0.5, 0.26, 0.56), vec4f(0.62, 0.38, 0.24, 0.7),
        vec4f(0.86, 0.84, 0.82, 0.85), vec4f(1.0, 1.0, 1.0, 1.0)), 8u, in.height);
      color = ramp * (0.45 + 0.55 * aoMap);
    } else if (mode < 2.5) {
      color = mix(vec3f(0.09, 0.14, 0.2), vec3f(0.96, 0.84, 0.56), pow(slope, 0.75));
    } else if (mode < 3.5) {
      color = n * 0.5 + vec3f(0.5);
    } else if (mode < 4.5) {
      color = albedo;
    } else if (mode < 5.5) {
      color = mix(vec3f(0.03, 0.05, 0.09), vec3f(0.3, 0.75, 0.98), flow);
    } else if (mode < 6.5) {
      color = vec3f(aoMap);
    } else {
      color = vec3f(roughness);
    }
  }

  // Aerial perspective: exponential height fog tinted by the sky along the view
  // ray. This is the term that gives ridge lines their separation.
  let toCam = normalize(V.cameraPos.xyz - in.world);
  let dist = length(in.world - V.cameraPos.xyz);
  let fogAmount = 1.0 - exp(-dist * V.fog.x * 0.001);
  let heightTerm = exp(-max(in.world.y - V.fog.y, 0.0) * V.fog.z * 0.002);
  let fogColor = mix(skyColor(sunDir, -toCam, 0.2), V.sunColor.rgb * 0.45, 0.22);
  color = mix(color, fogColor, saturate(fogAmount * heightTerm) * V.fog.w);

  return vec4f(color, 1.0);
}
