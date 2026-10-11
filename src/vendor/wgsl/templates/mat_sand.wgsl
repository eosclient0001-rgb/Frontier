// Sand — warm, fine grained, wind rippled, bright on crests and darker where
// damp near the water line.
//   lp[0] = (macroscale m, octaves, lacunarity, gain)
//   lp[1] = (rippleScale m, rippleAmount, speckleScale m, speckleAmount)
//   lp[2] = (dampDarkening, contrast, unused, unused)
//   lp[3] = (variant, rippleBearing rad, rippleStretch, unused)
fn materialShape(ctx: MatCtx) -> MatSample {
  let s = seedOf(ctx.seed, 211u);
  let macroScale = max(ctx.lp[0].x, 8.0);
  let pm = ctx.uv * (ctx.world / macroScale);

  let body = fbm(pm * 1.6 + warpVec(pm, 0.5, 0.5, s), 3u, 2.02, 0.5, s + 7u);
  // Wind ripples: anisotropic high frequency, strongest on gentle ground.
  let ripplePos = aniso(ctx.uv, ctx.lp[3].y, clamp(ctx.lp[3].z, 0.05, 1.0)) * (ctx.world / max(ctx.lp[1].x, 0.5));
  let ripple = sin(ripplePos.x * TAU + fbm(pm * 2.0, 3u, 2.0, 0.5, s + 13u) * 3.4) * 0.5 + 0.5;
  let rippleSoft = pow(ripple, 1.6);

  var t = saturate(body * 0.75 + rippleSoft * ctx.lp[1].y * 0.25 + ctx.curvature * 0.3);
  t = saturate(t + (1.0 - ctx.slope) * 0.1 - saturate(ctx.flow) * ctx.lp[2].x * 0.4);
  t = gainCurve(t, clamp(ctx.lp[2].y, 0.3, 4.0));

  var color = rampColorSmooth(ctx.ramp, ctx.rampCount, t);
  // Speckle: individual bright grains.
  let speckle = hash12(ctx.uv * ctx.world * 0.35 + vec2f(f32(seedOf(ctx.seed, 3u))));
  color = color * (1.0 + (speckle - 0.5) * saturate(ctx.lp[1].w) * 0.25);
  color = mix(color, color * vec3f(0.62, 0.6, 0.55), saturate(ctx.flow * 1.3 + ctx.deposit * 0.6) * ctx.lp[2].x);

  let detail = saturate(0.3 + rippleSoft * 0.5);
  let wear = 0.15;
  return MatSample(color, t, detail, wear, mix(1.4, 1.0, t), 1.0);
}
