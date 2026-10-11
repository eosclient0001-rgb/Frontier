// Hydraulic erosion, stage 2: transport, erosion/deposition and advection.
//
//   group 1 binding 0: height  1: water  2: sediment  3: flux  4: flowAccum
//   group 2 binding 0: outHeight  1: outWater  2: outSediment
//            3: outFlow (rgba32f: .x accumulated wetness, .y deposited mass)
//
// Sediment is carried as a concentration and advected donor-cell upwind with the
// water fluxes, so mass is conserved and deposits always land downstream of the
// cut — the behaviour that makes real river networks look the way they do.
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct TransportParams {
  dims: vec2u,
  dt: f32,
  cellMeters: f32,
  heightScale: f32,
  rain: f32,
  evaporation: f32,
  capacity: f32,
  dissolve: f32,
  depositRate: f32,
  maxRate: f32,
  minSlope: f32,
  flowGain: f32,
  iteration: u32,
  thermalBias: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> P: TransportParams;

@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(1) @binding(1) var inWater: texture_2d<f32>;
@group(1) @binding(2) var inSediment: texture_2d<f32>;
@group(1) @binding(3) var inFlux: texture_2d<f32>;
@group(1) @binding(4) var inFlow: texture_2d<f32>;

@group(2) @binding(0) var outHeight: texture_storage_2d<r32float, write>;
@group(2) @binding(1) var outWater: texture_storage_2d<r32float, write>;
@group(2) @binding(2) var outSediment: texture_storage_2d<r32float, write>;
@group(2) @binding(3) var outFlow: texture_storage_2d<rgba32float, write>;

fn fluxAt(c: vec2i, dims: vec2u) -> vec4f {
  return textureLoad(inFlux, clamp(c, vec2i(0), vec2i(i32(dims.x) - 1, i32(dims.y) - 1)), 0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let c = vec2i(gid.xy);
  let area = P.cellMeters * P.cellMeters;

  let hN = hFetch(inHeight, c, P.dims);
  let h = hN * P.heightScale;                     // metres
  let d = max(hFetch(inWater, c, P.dims), 0.0);
  let conc = max(hFetch(inSediment, c, P.dims), 0.0);
  let flow = hFetch(inFlow, c, P.dims);

  let f = fluxAt(c, P.dims);
  // Neighbour fluxes: their inward component is what arrives here.
  let fR = fluxAt(c + vec2i(1, 0), P.dims);
  let fD = fluxAt(c + vec2i(0, 1), P.dims);
  let fL = fluxAt(c + vec2i(-1, 0), P.dims);
  let fU = fluxAt(c + vec2i(0, -1), P.dims);

  let outflow = f.x + f.y + f.z + f.w;                               // m³/s
  let inflow = fR.z + fD.w + fL.x + fU.y;                            // m³/s

  // Donor-cell advection of suspended sediment.
  let sedIn = fR.z * max(hFetch(inSediment, c + vec2i(1, 0), P.dims), 0.0)
            + fD.w * max(hFetch(inSediment, c + vec2i(0, 1), P.dims), 0.0)
            + fL.x * max(hFetch(inSediment, c + vec2i(-1, 0), P.dims), 0.0)
            + fU.y * max(hFetch(inSediment, c + vec2i(0, -1), P.dims), 0.0);

  var volume = d * area;
  volume = volume + (inflow - outflow) * P.dt + P.rain * area;
  volume = max(volume, 0.0) * (1.0 - saturate(P.evaporation * P.dt));

  // Flow speed from the flux divergence, then the classic capacity relation:
  // the faster and steeper the water, the more rock it can hold.
  let vel = vec2f(f.x - f.z, f.y - f.w) / area;     // m/s
  let speed = length(vel);
  let grad = hGradient(inHeight, P.dims, vec2f(c), P.cellMeters, P.heightScale);
  let slope = max(length(grad), P.minSlope);
  let capConc = P.capacity * speed * slope;

  var sedimentVolume = conc * d * area;
  var dh = 0.0;
  let dam = P.maxRate * P.dt;
  if (capConc > conc) {
    let pick = min((capConc - conc) * P.dissolve * P.dt * max(volume, 0.0) / max(P.dt, 1e-4), dam * area);
    sedimentVolume = sedimentVolume + pick;
    dh = -pick / area;
  } else {
    let drop = min((conc - capConc) * P.depositRate * P.dt * max(volume, 0.0) / max(P.dt, 1e-4), dam * area);
    sedimentVolume = max(sedimentVolume - drop, 0.0);
    dh = drop / area;
  }
  sedimentVolume = sedimentVolume - (outflow * conc) * P.dt + sedIn * P.dt;
  sedimentVolume = max(sedimentVolume, 0.0);

  let newVolume = max(volume, 1e-12);
  let newConc = clamp(sedimentVolume / newVolume, 0.0, 1.0);
  let newDepth = newVolume / area;

  // Wetness accumulator: water depth x speed, the physically meaningful "flow"
  // map that masks and material layers key off. The green channel accumulates
  // deposited mass, which is what the deposit mask and the material stack use to
  // find floodplains, fans and sandbars.
  let wet = flow + newDepth * speed * P.dt * P.flowGain;
  let prevDep = textureLoad(inFlow, c, 0).y;
  let dep = prevDep + max(dh, 0.0) / max(P.heightScale, 1e-3);

  let hNew = clamp(hN + dh / P.heightScale, -0.25, 1.9);
  textureStore(outHeight, c, vec4f(hNew, 0.0, 0.0, 1.0));
  textureStore(outWater, c, vec4f(newDepth, 0.0, 0.0, 1.0));
  textureStore(outSediment, c, vec4f(newConc, 0.0, 0.0, 1.0));
  textureStore(outFlow, c, vec4f(wet, dep, 0.0, 1.0));
}
