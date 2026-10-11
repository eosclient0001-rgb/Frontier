// Domain Warp — flows the existing field along a warped vector field rather than
// adding anything. Because it emits a signed delta, `amount` acts as a strength.
//   lp[0] = (warpDistance m, octaves, lacunarity, gain)
//   lp[1] = (warpAmount, warpFrequency, directionalBias, unused)
//   lp[2] = (unused, sharpness, directionAmount, unused)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let prev = prevHeight(c.uv);
  let s = seedOf(c.seed, 131u);
  let distance = max(c.lp[0].x, 0.5);
  let stretch = clamp(c.lp[3].z, 0.02, 1.0);
  let q = aniso(c.uv, c.lp[3].y, stretch) * max(c.freq, 0.5);
  let w = warpVec(q, c.lp[1].x, max(c.lp[1].y, 0.03), s);
  // Directional bias: shear the field along the bearing, which is what makes
  // glacial and aeolian terranes read as flowing rather than swirled.
  let dir = vec2f(cos(c.lp[3].y), sin(c.lp[3].y)) * c.lp[2].z;
  let flow = (fbm(q * 0.6, 3u, 2.0, 0.5, s + 7u) - 0.5) * 2.0;
  let offset = (w + dir * flow) * (distance / max(c.world, 1e-3));
  let warped = prevHeight(clamp(c.uv + offset, vec2f(0.0), vec2f(1.0)));
  return warped - prev;
}
