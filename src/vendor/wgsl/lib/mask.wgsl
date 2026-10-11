// Frontier Terrain Forge — mask evaluation.
//
// A mask scales a layer's influence. Masks read the *upstream* fields produced
// by the erosion simulation, which is what makes them behave like Gaea's:
// slope/flow/deposit/curvature are physically derived from the landscape rather
// than being decorative noise. (naga forbids textures inside structs, so the
// fields are passed as plain parameters.)

//#include "../lib/mathx.wgsl"
//#include "../lib/noise.wgsl"
//#include "../lib/params.wgsl"

fn maskFetch(field: texture_2d<f32>, res: f32, uv: vec2f) -> f32 {
  let c = clamp(vec2i(uv * res), vec2i(0), vec2i(i32(res) - 1));
  return textureLoad(field, c, 0).x;
}

fn maskFetch4(field: texture_2d<f32>, res: f32, uv: vec2f) -> vec4f {
  let c = clamp(vec2i(uv * res), vec2i(0), vec2i(i32(res) - 1));
  return textureLoad(field, c, 0);
}

fn bandMask(v: f32, lo: f32, hi: f32, soft: f32) -> f32 {
  let s = max(soft, 1e-4);
  let h = max(hi, lo + 1e-4);
  return smoothstep(lo - s, lo + s, v) * (1.0 - smoothstep(h - s, h + s, v));
}

fn maskKindValue(
  def: MaskDef,
  uv: vec2f,
  res: f32,
  texHeight: texture_2d<f32>,
  texSlope: texture_2d<f32>,
  texCurvature: texture_2d<f32>,
  texFlow: texture_2d<f32>,
  texDeposit: texture_2d<f32>,
  texPaint: texture_2d<f32>,
  texSketch: texture_2d<f32>,
) -> f32 {
  switch (def.kind) {
    case 1u: {  // slope band (0..1 normalised slope)
      return bandMask(maskFetch(texSlope, res, uv), def.lo, def.hi, def.soft);
    }
    case 2u: {  // elevation band (normalised height)
      return bandMask(maskFetch(texHeight, res, uv), def.lo, def.hi, def.soft);
    }
    case 3u: {  // fractal breakup
      let p = uv * max(def.freq, 0.5) + vec2f(def.seed * 91.7, def.seed * 47.3);
      let n = fbm(p, u32(clamp(4.0 + def.extra, 1.0, 8.0)), 2.03, 0.5, seedOf(def.seed, 3u));
      return saturate(mix(0.5, n, saturate(def.amp * 2.0)));
    }
    case 4u: {  // flow / wetness
      return saturate(pow(maskFetch(texFlow, res, uv), max(def.amp, 0.05)));
    }
    case 5u: {  // deposition
      return saturate(pow(maskFetch(texDeposit, res, uv), max(def.amp, 0.05)));
    }
    case 6u: {  // curvature: 1 = concave bowls, 0 = convex ridges
      let c = maskFetch(texCurvature, res, uv);
      let v = saturate(c * max(def.amp, 0.05) * 0.5 + 0.5);
      return v;
    }
    case 7u: {  // hand-painted per-layer mask
      return saturate(maskFetch(texPaint, res, uv) * max(def.amp, 0.01));
    }
    case 8u: {  // radial band
      let d = length(uv - vec2f(def.cx, def.cy));
      return bandMask(d, def.lo, def.hi, max(def.soft, 0.002));
    }
    case 9u: {  // ridge / fissure lines
      let p = uv * max(def.freq, 0.5);
      let n = crackNetwork(p, 3u, 2.0, 0.5, max(def.soft, 0.02), seedOf(def.seed, 5u));
      return saturate(1.0 - n * max(def.amp, 0.05) * 2.0);
    }
    case 10u: { // painted height sketch
      return saturate(maskFetch(texSketch, res, uv) * max(def.amp, 0.01));
    }
    default: { return 1.0; }
  }
}

fn applyMaskBlend(acc: f32, v: f32, blend: u32) -> f32 {
  switch (blend) {
    case 1u: { return saturate(acc + v); }
    case 2u: { return max(acc, v); }
    case 3u: { return min(acc, v); }
    case 4u: { return v; }
    default: { return acc * v; }
  }
}

/// Combine the layer's mask stack into a single 0..1 factor. Four masks is the
/// sweet spot between expressive power and the uniform budget; anything more
/// belongs in a dedicated mask layer.
fn evalMaskSet(
  defs: array<MaskDef, 4>,
  count: u32,
  uv: vec2f,
  res: f32,
  texHeight: texture_2d<f32>,
  texSlope: texture_2d<f32>,
  texCurvature: texture_2d<f32>,
  texFlow: texture_2d<f32>,
  texDeposit: texture_2d<f32>,
  texPaint: texture_2d<f32>,
  texSketch: texture_2d<f32>,
) -> f32 {
  var acc = 0.0;
  var first = true;
  for (var i = 0u; i < count; i = i + 1u) {
    let def = defs[i];
    if (def.enabled == 0u) { continue; }
    var v = maskKindValue(def, uv, res, texHeight, texSlope, texCurvature, texFlow, texDeposit, texPaint, texSketch);
    if (def.invert == 1u) { v = 1.0 - v; }
    v = saturate(mix(0.0, v, saturate(def.weight)));
    acc = select(applyMaskBlend(acc, v, def.blend), v, first);
    first = false;
  }
  if (first) { return 1.0; }
  return saturate(acc);
}
