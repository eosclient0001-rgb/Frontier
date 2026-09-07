// Project-Ocean O0 — Gerstner placeholder displacement + deep-water shading.
// O1 replaces the vertex wave sum with FFT cascade sampling; the fragment stack stays.
struct Uniforms {
  viewProj : mat4x4<f32>,
  camPos : vec3<f32>,
  time : f32,
  sunDir : vec3<f32>,
  windSpeed : f32,
  sunColor : vec3<f32>,
  steepness : f32,
  deepColor : vec3<f32>,
  scatterAmt : f32,
  skyColor : vec3<f32>,
  hazeAmt : f32,
  horizonColor : vec3<f32>,
  waveCount : f32,
  wind : vec4<f32>, // dir.x, dir.z, detailAmp, detailFreq
  waves : array<vec4<f32>, 8>, // dir.x, dir.z, wavelength, amplitude
  look : vec4<f32>, // glitter, foamAmt, foamThresh, exposure
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSIn { @location(0) pos : vec3<f32> };
struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) crest : f32,
};

@vertex
fn vsMain(v : VSIn) -> VSOut {
  var disp = vec3<f32>(0.0);
  var n = vec3<f32>(0.0, 1.0, 0.0);
  var crest = 0.0;
  let g = 9.81;
  for (var i = 0u; i < 8u; i++) {
    if (f32(i) >= u.waveCount) { break; }
    let w = u.waves[i];
    let d = vec2<f32>(w.x, w.y);
    let L = max(w.z, 0.001);
    let a = w.w;
    let k = 6.2831853 / L;
    let c = sqrt(g / k);
    let f = k * (dot(d, v.pos.xz) - c * u.time);
    let s = sin(f);
    let co = cos(f);
    let q = u.steepness / max(k * a * u.waveCount, 0.0001);
    disp.x = disp.x + q * a * d.x * co;
    disp.z = disp.z + q * a * d.y * co;
    disp.y = disp.y + a * s;
    n.x = n.x - d.x * k * a * co;
    n.z = n.z - d.y * k * a * co;
    n.y = n.y - q * k * a * s;
    crest = crest + s * a;
  }
  let world = vec3<f32>(v.pos.x + disp.x, disp.y, v.pos.z + disp.z);
  var o : VSOut;
  o.clip = u.viewProj * vec4<f32>(world, 1.0);
  o.world = world;
  o.normal = normalize(n);
  o.crest = crest;
  return o;
}

fn hash21(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

@fragment
fn fsMain(f : VSOut) -> @location(0) vec4<f32> {
  let toCam = u.camPos - f.world;
  let dist = length(toCam);
  let V = toCam / max(dist, 0.0001);

  // Detail normal: two scrolling value-noise octaves, distance-faded (~120 m band limit).
  let wdir = u.wind.xy;
  let fade = exp(-dist / 120.0);
  let p1 = f.world.xz * u.wind.w + wdir * u.time * 1.1;
  let p2 = f.world.xz * u.wind.w * 2.7 - vec2<f32>(wdir.y, wdir.x) * u.time * 1.7;
  let g1 = vec2<f32>(vnoise(p1) - 0.5, vnoise(p1 + 13.7) - 0.5);
  let g2 = vec2<f32>(vnoise(p2) - 0.5, vnoise(p2 + 7.3) - 0.5);
  let grad = (g1 + g2 * 0.5) * u.wind.z * fade;
  let n = normalize(f.normal + vec3<f32>(grad.x, 0.0, grad.y));

  let NdotV = max(dot(n, V), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

  // Reflected-sky approx from mirror-direction elevation.
  let R = reflect(-V, n);
  let reflCol = mix(u.horizonColor, u.skyColor, pow(clamp(R.y, 0.0, 1.0), 0.6));

  // Body: deep color + wrapped sun scatter through the surface.
  let NdotL = dot(n, u.sunDir);
  let scatter = pow(clamp(0.5 + 0.5 * NdotL, 0.0, 1.0), 2.0);
  var body = u.deepColor * (0.35 + 0.65 * scatter * u.scatterAmt);

  // Crest lightening — O0 placeholder for Jacobian foam (O1 replaces with foam texture).
  let crestN = clamp(f.crest * 0.5 + 0.5, 0.0, 1.0);
  let lace = vnoise(f.world.xz * 0.9 + wdir * u.time * 0.6);
  let foamM = smoothstep(u.look.z, u.look.z + 0.2, crestN * (0.75 + 0.5 * lace)) * exp(-dist / 90.0) * u.look.y;
  body = mix(body, vec3<f32>(0.9, 0.93, 0.95), foamM * 0.85);

  var col = mix(body, reflCol, fres);

  // Sun: tight glitter + broad sheen.
  let H = normalize(u.sunDir + V);
  let ndh = max(dot(n, H), 0.0);
  let spec = pow(ndh, 720.0) * 3.0 + pow(ndh, 60.0) * 0.25;
  let glit = 0.6 + 0.8 * vnoise(f.world.xz * 3.0 + vec2<f32>(u.time * 2.0, -u.time));
  col = col + u.sunColor * spec * mix(1.0, glit, 0.65) * u.look.x;

  // Aerial haze to horizon.
  let haze = 1.0 - exp(-dist / 900.0 * u.hazeAmt);
  col = mix(col, u.horizonColor, clamp(haze, 0.0, 1.0));

  col = col * u.look.w; // exposure
  col = pow(max(col, vec3<f32>(0.0)), vec3<f32>(0.4545));
  return vec4<f32>(col, 1.0);
}
