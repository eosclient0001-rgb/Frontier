// Aeolian dune field: asymmetric crests, warped crest lines, wind ripples.
//   lp[0] = (duneSpacing m, duneHeightScale, crestSharpen, symmetry)
//   lp[1] = (warpAmount, warpFrequency, rippleAmount, rippleScale)
//   lp[2] = (level, crestNoise, saltation, unused)
//   lp[3] = (variant, bearing rad, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 57u);
  let spacing = max(c.lp[0].x, 1.0);
  let asymmetry = clamp(c.lp[0].w, 0.15, 0.95);
  let crestSharp = clamp(c.lp[0].z, 0.4, 6.0);
  let rippleAmt = c.lp[1].z;
  let rippleScale = max(c.lp[1].w, 0.5);
  let bearing = c.lp[3].y;
  let stretch = clamp(c.lp[3].z, 0.02, 1.0);

  // Anisotropic space: crest lines run along `bearing`, stretched by `stretch`.
  let q = aniso(c.uv, bearing, stretch) * c.world;
  let phase = q.x / spacing;
  let w = warpVec(c.uv * max(c.freq, 0.5), c.lp[1].x, max(c.lp[1].y, 0.03), s);
  let wave = sin((phase + w.x * 0.35 + w.y * 0.2) * TAU);
  var dune = saturate(wave * 0.5 + 0.5);
  // Windward ramp is long and gentle, lee face is short and steep.
  dune = pow(dune, mix(1.0, 3.2, asymmetry));
  dune = pow(dune, crestSharp * 0.5 + 0.5);
  // Dune mass varies along the field, so the field reads as a real erg.
  let mass = fbm(c.uv * max(c.freq, 0.5) * 0.35 + vec2f(6.7, 1.9), 3u, 2.0, 0.5, s + 15u);
  var h = dune * mix(0.35, 1.0, mass) * c.lp[0].y;
  // Saltation ripples on the flanks only.
  let ripple = vnoise2(rot2(c.uv * c.world / rippleScale, bearing) * vec2f(1.0, 0.18), s + 3u);
  h = h + ripple * rippleAmt * saturate(4.0 * dune * (1.0 - dune)) * 0.06;
  let crestNoise = fbm(c.uv * max(c.freq, 0.5) * 2.2, 3u, 2.0, 0.5, s + 33u);
  h = h + (crestNoise - 0.5) * c.lp[2].y * 0.2;
  return h + c.lp[2].x;
}
