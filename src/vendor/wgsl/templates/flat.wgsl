// Flat — a level base plane. Useful as the bottom of a stack or to reset basins.
//   lp[0] = (featureScale m, octaves, lacunarity, gain)
//   lp[1] = (warpAmount, warpFrequency, amplitude, unused)
//   lp[2] = (level, unused, unused, unused)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 149u);
  let p = c.uv * max(c.freq, 0.5);
  let n = fbm(p, 3u, 2.0, 0.5, s);
  return c.lp[2].x + (n - 0.5) * c.lp[1].z;
}
