// Smooth — relaxes the current field. Acts as a signed delta so `amount` blends
// between the untouched field and the fully relaxed one.
//   lp[0] = (radius m, strength, quality, unused)
//   lp[1] = (unused x4)
//   lp[2] = (unused, unused, unused, unused)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let prev = prevHeight(c.uv);
  let radiusPix = max(c.lp[0].x, 0.5) / max(P.cellMeters, 1e-3);
  let blurred = hBlur(inHeight, P.dims, c.uv * vec2f(P.dims) - vec2f(0.5), radiusPix);
  return (blurred - prev) * max(c.lp[0].y, 0.0);
}
