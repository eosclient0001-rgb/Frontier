// Cracked rock flats — contraction polygons, fissure depth, raised polygon centres.
//   lp[0] = (featureScale m, octaves, lacunarity, gain)
//   lp[1] = (crackWidth, crackDepth, plateJitter, plateTilt)
//   lp[2] = (level, unused, terraceAmount, terraceSteps)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 127u);
  let octaves = u32(clamp(c.lp[0].y, 1.0, 10.0));
  let lac = clamp(c.lp[0].z, 1.4, 3.4);
  let gain = clamp(c.lp[0].w, 0.2, 0.72);
  let p = c.uv * max(c.freq, 0.5);
  let base = fbm(p * 0.55, octaves, lac, gain, s);
  let cells = crackNetwork(p, 3u, 2.05, 0.55, clamp(c.lp[1].x, 0.01, 0.6), s + 17u);
  var h = base * 0.55 + c.lp[2].x;
  h = h - cells * c.lp[1].y;
  // Slight doming inside each plate keeps the pattern from reading as a grid.
  let plate = worley2(p, s + 29u);
  h = h + (1.0 - saturate(plate.x)) * c.lp[1].z * 0.06;
  return h;
}
