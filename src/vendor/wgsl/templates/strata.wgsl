// Strata — sedimentary bedding planes. Transforms the current field: each band
// becomes a ledge with a hard lip and a soft back-slope, tilted and warped.
//   lp[0] = (bandThickness m, sharpness, tiltAmount, unused)
//   lp[1] = (warpAmount, warpFrequency, ledgeDepth, unused)
//   lp[2] = (level, unused, terraceAmount, terraceSteps)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let prev = prevHeight(c.uv);
  // Measure in metres so bedding stays a physical quantity.
  let thickness = max(c.lp[0].x, 1.0);
  let bands = P.heightScale / thickness;
  let tiltDir = vec2f(cos(c.lp[3].y), sin(c.lp[3].y));
  let tilt = dot(c.uv - vec2f(0.5), tiltDir) * c.lp[0].z * 2.0;
  let w = warpVec(c.uv * max(c.freq, 0.5), c.lp[1].x, max(c.lp[1].y, 0.03), seedOf(c.seed, 109u));
  let bandPos = prev * bands + tilt + (w.x + w.y) * 0.05;
  let f = fract(bandPos);
  let sharp = clamp(c.lp[0].y, 0.5, 12.0);
  // Ledge: hard lip at the top of the band, then a ramp back to the bedding plane.
  let lip = pow(saturate(f), sharp);
  var h = (floor(bandPos) + lip) / bands;
  h = h - c.lp[1].z * (1.0 - pow(saturate(f), 0.35)) / bands;
  return h - prev;
}
