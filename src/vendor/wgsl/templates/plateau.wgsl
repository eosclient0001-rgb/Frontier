// Layered mesa plateau — flat tops, sharp talus breaks, stepped sedimentary walls.
//   lp[0] = (featureScale m, octaves, lacunarity, gain)
//   lp[1] = (warpAmount, warpFrequency, wallRoughness, wallDetailScale m)
//   lp[2] = (flatTopLevel, edgeSharpness, shelfSteps, shelfBlend)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 31u);
  let octaves = u32(clamp(c.lp[0].y, 1.0, 12.0));
  let lac = clamp(c.lp[0].z, 1.4, 3.4);
  let gain = clamp(c.lp[0].w, 0.2, 0.72);
  let wallRough = c.lp[1].z;
  let wallScale = max(c.lp[1].w, 4.0);
  let cut = clamp(c.lp[2].x, 0.05, 0.95);
  let edge = clamp(c.lp[2].y, 0.02, 1.2);
  let steps = max(c.lp[2].z, 1.0);
  let shelfBlend = saturate(c.lp[2].w);

  let p = c.uv * max(c.freq, 0.5) + warpVec(c.uv * max(c.freq, 0.5), c.lp[1].x, max(c.lp[1].y, 0.03), s);

  let massif = fbm(p * 0.7 + vec2f(2.7, 9.3), octaves, lac, gain, s);
  // Plateau profile: flat top above the cut, near-vertical break, flat skirt.
  let mesa = smootherstep(cut, min(cut + edge, 0.999), massif);
  var h = mesa;
  // Sedimentary shelves carved into the walls.
  if (steps > 1.5 && shelfBlend > 0.001) {
    let shelf = terraceCurve(mesa, steps, 6.0);
    h = mix(h, shelf, shelfBlend * saturate(1.0 - abs(mesa - 0.5) * 1.6));
  }
  // Wall roughness — proportional to the wall's slope so tops stay flat.
  let wallMask = saturate(4.0 * mesa * (1.0 - mesa));
  let wfreq = max(c.world / wallScale, 1.0) / max(c.freq, 0.5);
  let rough = ridgedFbm(p * wfreq * 1.4, 4u, 2.0, 0.5, 1.6, s + 13u);
  h = h + (rough - 0.5) * wallRough * wallMask;
  // Fine talus grain on the break itself.
  let grain = vnoise2(p * wfreq * 6.0, s + 29u);
  h = h + grain * 0.012 * wallMask;
  return h + c.lp[2].x * 0.0;
}
