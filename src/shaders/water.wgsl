// ===========================================================================
//  water.wgsl — water surface: wind ripples, refraction, silt.
//
//  Southwest rivers are not clear blue. They run opaque tan-brown because they
//  are carrying the canyon downstream in suspension — the Colorado was named
//  for exactly that colour. So the water here is driven by the SIMULATED
//  sediment load: the harder it is eroding upstream, the muddier it runs.
//
//  Wind is deliberately subtle: two crossed wave trains advected downwind,
//  modulated by slow gusts so the surface breathes instead of buzzing.
// ===========================================================================

#include "sky.wgsl"

fn windVec() -> vec2f {
  let a = radians(U.windDir);
  return vec2f(sin(a), cos(a)) * U.windSpeed;
}

/// Gerstner-ish ripple height field, in metres.
fn rippleHeight(xz: vec2f, t: f32) -> f32 {
  let w = windVec();
  let wl = length(w);
  if (wl < 1e-4) { return 0.0; }
  let dir = w / wl;
  let perp = vec2f(-dir.y, dir.x);

  // Gusts: slow, large-scale modulation of amplitude — cat's-paws.
  let gust = 1.0 + U.gustiness * (fbm2(xz * 0.010 - w * t * 0.06, 2));

  let s = U.rippleScale;
  var h = 0.0;

  // Primary train running downwind.
  h += sin(dot(xz, dir) * 0.85 * s - t * 2.3 * (0.4 + wl)) * 0.5;
  // Secondary, slightly off-axis — stops it looking like a corrugated sheet.
  let d2 = normalize(dir * 0.86 + perp * 0.51);
  h += sin(dot(xz, d2) * 1.37 * s - t * 3.1 * (0.4 + wl)) * 0.32;
  // Fine chop.
  h += fbm2(xz * 2.6 * s - w * t * 1.4, 3) * 0.42;

  return h * 0.030 * U.rippleAmp * gust * saturate(wl * 2.4);
}

/// Analytic normal of the ripple field.
fn waterNormal(xz: vec2f, t: f32, depth: f32, flow: vec2f) -> vec3f {
  let e = 0.55;

  // Shear the sample position by the flow so ripples get dragged downstream.
  let adv = flow * 1.6;
  let q = xz - adv;

  let hL = rippleHeight(q - vec2f(e, 0.0), t);
  let hR = rippleHeight(q + vec2f(e, 0.0), t);
  let hD = rippleHeight(q - vec2f(0.0, e), t);
  let hU = rippleHeight(q + vec2f(0.0, e), t);

  // Shallow water damps ripples; fast water roughens it.
  let shallow = saturate(depth * 3.0);
  let turb = saturate(length(flow) * 1.4);
  let amp = mix(0.25, 1.0, shallow) * (1.0 + turb * 1.6);

  let n = normalize(vec3f(-(hR - hL) / (2.0 * e) * amp,
                          1.0,
                          -(hU - hD) / (2.0 * e) * amp));
  return n;
}

/// Schlick Fresnel.
fn fresnel(cosT: f32, f0: f32) -> f32 {
  let m = saturate(1.0 - cosT);
  let m2 = m * m;
  return f0 + (1.0 - f0) * m2 * m2 * m;
}

/// Shade the water surface.
///   pos      world position on the water plane
///   rd       view ray direction
///   depth    water depth in metres
///   flow     depth-averaged velocity
///   bedCol   already-shaded colour of the riverbed below
///   bedDist  distance the ray travels through water to reach the bed
///   silt     suspended sediment concentration (from the simulation)
fn shadeWater(pos: vec3f, rd: vec3f, depth: f32, flow: vec2f,
              bedCol: vec3f, bedDist: f32, silt: f32, t: f32) -> vec3f {
  let n = waterNormal(pos.xz, t, depth, flow);
  let sd = sunDir();
  let v = -rd;

  let cosV = saturate(dot(n, v));
  let F = fresnel(cosV, 0.02);

  // ---- transmitted / body colour -----------------------------------------
  // Silt-laden desert water: the more sediment, the more it becomes an opaque
  // tan diffuse surface rather than a transparent medium.
  let siltAmt = saturate(silt * 2.2 + U.waterMurk);
  let siltCol = vec3f(0.44, 0.30, 0.17);
  let clearCol = vec3f(0.028, 0.075, 0.088);

  // Beer-Lambert extinction through the water column.
  let pathLen = max(bedDist, depth * 0.9);
  let extinction = mix(vec3f(0.16, 0.09, 0.06), vec3f(2.6, 3.4, 4.4), siltAmt);
  let trans = exp(-extinction * pathLen * 0.55);

  // Light scattered back out of the water body.
  let scatterCol = mix(clearCol, siltCol, siltAmt);
  let sunOnWater = saturate(sd.y);
  let body = scatterCol * sunLight() * 0.16 * sunOnWater
           + scatterCol * skyAmbient(vec3f(0.0, 1.0, 0.0)) * 0.32;

  var refracted = bedCol * trans + body * (1.0 - trans);

  // ---- reflection ---------------------------------------------------------
  let r = reflect(rd, n);
  var refl = skyColor(r);

  // Specular sun glint.
  let h = normalize(v + sd);
  let rough = max(U.waterRough, 0.008) * (1.0 + length(flow) * 0.8);
  let a = rough * rough;
  let ndh = saturate(dot(n, h));
  let denom = ndh * ndh * (a * a - 1.0) + 1.0;
  let D = (a * a) / max(PI * denom * denom, 1e-6);
  refl += sunLight() * D * 0.6 * saturate(dot(n, sd));

  var col = mix(refracted, refl, F);

  // ---- whitewater ---------------------------------------------------------
  // Foam where the flow is fast and shallow, i.e. over rapids and riffles.
  let speed = length(flow);
  let riffle = saturate((speed - 0.25) * 1.6) * saturate(1.0 - depth * 0.9);
  let foamNoise = fbm2(pos.xz * 0.55 - flow * t * 2.2, 3) * 0.5 + 0.5;
  let foam = saturate(riffle * foamNoise * U.foamAmount * 1.5);
  let foamCol = (sunLight() * 0.22 + skyAmbient(vec3f(0.0, 1.0, 0.0)) * 0.9);
  col = mix(col, foamCol, foam);

  // Shoreline wetting: a darker damp margin, and a thin bright edge where the
  // sheet of water thins out to nothing.
  let edge = 1.0 - saturate(depth / max(U.waterMinDepth * 3.0, 1e-3));
  col = mix(col, bedCol * 0.62, edge * edge * 0.75);

  return col;
}
