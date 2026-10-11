// Detail — re-introduces the high-frequency field that erosion replaced, so a
// 4K tile keeps its rock grain even though the simulation ran on a coarser grid.
//   lp[0] = (featureScale m, unused, unused, unused)
//   lp[1] = (amplitude, contrast, valleyBias, peakBias)
//   lp[2] = (level, unused, unused, unused)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let d = prevDetail(c.uv);
  let prev = prevHeight(c.uv);
  let shaped = gainCurve(saturate(d), clamp(c.lp[1].y, 0.2, 6.0));
  // Bias the detail toward valleys or peaks so ranges do not look uniformly noisy.
  let weight = mix(1.0 - prev, prev, saturate(c.lp[1].w));
  let valley = mix(1.0, invertFade(prev), saturate(c.lp[1].z));
  return (shaped - 0.5) * c.lp[1].x * weight * valley + c.lp[2].x;
}

fn invertFade(h: f32) -> f32 { return saturate(1.0 - pow(saturate(h), 2.0)); }
