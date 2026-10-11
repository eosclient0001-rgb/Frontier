// Gravel / scree — loose stones of varied size and tone, exposed on steep ground
// and accumulating in flats and hollows.
//   lp[0] = (macroscale m, octaves, lacunarity, gain)
//   lp[1] = (stoneScale m, stoneAmount, sizeVariation, unused)
//   lp[2] = (contrast, wetDarkening, unused, unused)
//   lp[3] = (variant, bearing, stretch, unused)
fn materialShape(ctx: MatCtx) -> MatSample {
  let s = seedOf(ctx.seed, 239u);
  let macroScale = max(ctx.lp[0].x, 4.0);
  let pm = ctx.uv * (ctx.world / macroScale);

  let field = fbm(pm * 1.4, 3u, 2.02, 0.5, s + 3u);
  // Stones: cellular, with per-cell tone so no two stones match.
  let stoneFreq = ctx.world / max(ctx.lp[1].x, 0.5);
  let st = worley2(ctx.uv * stoneFreq, s + 23u);
  let stoneMask = saturate(1.0 - st.x * 1.25) * saturate(ctx.lp[1].y);
  let cellTone = st.z;

  var t = saturate(field * 0.6 + stoneMask * 0.55 + cellTone * ctx.lp[1].z * 0.3);
  t = saturate(t + ctx.slope * 0.15 - saturate(ctx.flow) * 0.2);
  t = gainCurve(t, clamp(ctx.lp[2].x, 0.3, 4.0));

  var color = rampColorSmooth(ctx.ramp, ctx.rampCount, t);
  color = mix(color, color * vec3f(0.55, 0.57, 0.6), saturate(ctx.flow * 1.4) * ctx.lp[2].y);
  color = mix(color, color * 0.6, saturate(-ctx.curvature * 2.2) * 0.45);

  let detail = saturate(0.65 + stoneMask * 0.7);
  let wear = saturate(1.0 - ctx.slope * 1.2 - ctx.flow) * 0.55;
  return MatSample(color, t, detail, wear, 1.25, 1.0);
}
