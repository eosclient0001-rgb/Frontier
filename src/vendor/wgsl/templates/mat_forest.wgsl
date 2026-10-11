// Forest floor — deep humus, needle litter, moss patches and damp hollows.
//   lp[0] = (macroscale m, octaves, lacunarity, gain)
//   lp[1] = (litterScale m, litterAmount, mossScale m, mossAmount)
//   lp[2] = (dampDarkening, contrast, unused, unused)
//   lp[3] = (variant, bearing, stretch, unused)
fn materialShape(ctx: MatCtx) -> MatSample {
  let s = seedOf(ctx.seed, 191u);
  let macroScale = max(ctx.lp[0].x, 8.0);
  let octaves = u32(clamp(ctx.lp[0].y, 1.0, 10.0));
  let pm = ctx.uv * (ctx.world / macroScale);

  let humus = fbm(pm * 1.5 + warpVec(pm, 0.45, 0.35, s), octaves, 2.0, clamp(ctx.lp[0].w, 0.2, 0.72), s + 3u);
  let litter = worley2(aniso(ctx.uv, ctx.lp[3].y + 0.6, 0.35) * (ctx.world / max(ctx.lp[1].x, 2.0)) * 0.9, s + 23u);
  let moss = fbm(ctx.uv * (ctx.world / max(ctx.lp[1].z, 8.0)) * 1.1 + vec2f(9.7, 1.1), 4u, 2.0, 0.55, s + 41u);
  let mossMask = saturate((moss - 0.45) * 3.5) * saturate(ctx.lp[1].w) * (1.0 - ctx.slope * 0.7);

  var t = saturate(humus * 0.5 + (1.0 - saturate(litter.x)) * saturate(ctx.lp[1].y) * 0.35 + mossMask * 0.5);
  t = saturate(t - saturate(ctx.flow * 1.2) * ctx.lp[2].x * 0.25);
  t = gainCurve(t, clamp(ctx.lp[2].y, 0.3, 4.0));

  var color = rampColorSmooth(ctx.ramp, ctx.rampCount, t);
  color = mix(color, color * vec3f(0.5, 0.55, 0.5), saturate(-ctx.curvature * 2.0) * 0.5);
  color = mix(color, color * 0.7, saturate(ctx.flow) * ctx.lp[2].x * 0.5);

  let detail = saturate(0.6 + saturate(litter.x) * 0.8);
  let wear = saturate(1.0 - ctx.slope * 1.5 - ctx.flow) * 0.4;
  return MatSample(color, t, detail, wear, 1.2, 1.0);
}
