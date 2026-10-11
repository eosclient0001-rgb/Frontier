// =================================================================================================
//  erosion.wgsl — hydraulic erosion, virtual pipe model (Mei, Decaudin & Dorsey 2007)
// -------------------------------------------------------------------------------------------------
//  Chosen over particle/droplet tracing because every stage is a pure data-parallel cell update:
//  no atomics, no per-droplet serial walk, and it produces connected drainage networks instead of
//  disconnected scratches. The whole solver runs on the GPU and the host simply pumps iterations.
//
//  Stages, once per iteration (r = read parity, w = 1 - r):
//    1 flux       water depth + height  ->  outflow through the four virtual pipes
//    2 water      flux                  ->  new depth + velocity field
//    3 erode      velocity + slope      ->  pick up / drop sediment, plus optional talus slump
//    4 transport  velocity              ->  semi-Lagrangian advection of suspended sediment
//    5 evaporate  water                 ->  loss to air
//
//  All quantities are in METRES. The height field is converted into metres on entry and back to
//  the normalised 0..1 domain on exit, so the physics is independent of the terrain's height scale.
//
//  Bindings (explicit layout, shared by every entry point):
//    0 uniform | 1 H (terrain, m) | 2 W[r] | 3 W[w] | 4 S[r] | 5 S[w] | 6 flux | 7 vel | 8 wet | 9 field (norm)
// =================================================================================================

struct ErodeParams {
  p0: vec4u,   // res, flags, iteration, seed
  p1: vec4f,   // dt, cellMeters, heightMeters, pipeArea
  p2: vec4f,   // rainPerStep, evaporate, capacity, dissolve
  p3: vec4f,   // deposit, minSlope, maxStepMeters, thermalRate
  p4: vec4f,   // talusTan, gravity, ---
};

@group(0) @binding(0) var<uniform> P: ErodeParams;
@group(0) @binding(1) var<storage, read_write> H: array<f32>;
@group(0) @binding(2) var<storage, read_write> Wr: array<f32>;
@group(0) @binding(3) var<storage, read_write> Ww: array<f32>;
@group(0) @binding(4) var<storage, read_write> Sr: array<f32>;
@group(0) @binding(5) var<storage, read_write> Sw: array<f32>;
@group(0) @binding(6) var<storage, read_write> FX: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> VL: array<vec2f>;
@group(0) @binding(8) var<storage, read_write> WET: array<f32>;
@group(0) @binding(9) var<storage, read_write> FLD: array<f32>;

fn res() -> i32 { return i32(P.p0.x); }

fn idAt(x: i32, y: i32) -> u32 {
  let r = res();
  return u32(clamp(y, 0, r - 1) * r + clamp(x, 0, r - 1));
}

// Outside the grid a cell has the border's height and no water, so the domain drains instead of
// damming against a wall.
fn cellH(x: i32, y: i32, me: f32) -> f32 {
  let r = res();
  if (x < 0 || y < 0 || x >= r || y >= r) { return me; }
  return H[u32(y * r + x)];
}

fn cellW(x: i32, y: i32) -> f32 {
  let r = res();
  if (x < 0 || y < 0 || x >= r || y >= r) { return 0.0; }
  return Wr[u32(y * r + x)];
}

// Sediment advection samples the read buffer between texels, so the fetch is inlined instead of
// going through a pointer parameter (portable across WGSL implementations).
fn sampleSediment(fx: f32, fy: f32) -> f32 {
  let r = f32(res());
  let x = clamp(fx, 0.0, r - 1.001);
  let y = clamp(fy, 0.0, r - 1.001);
  let x0 = i32(floor(x));
  let y0 = i32(floor(y));
  let tx = x - floor(x);
  let ty = y - floor(y);
  let a = Sr[idAt(x0, y0)];
  let b = Sr[idAt(x0 + 1, y0)];
  let c = Sr[idAt(x0, y0 + 1)];
  let d = Sr[idAt(x0 + 1, y0 + 1)];
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

// --- stage 1: outflow through the virtual pipes ---------------------------------------------------

@compute @workgroup_size(8, 8)
fn flux(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let i = u32(y * r + x);

  let dt = P.p1.x;
  let l = max(P.p1.y, 1e-3);
  let h = H[i];
  let w = Wr[i];
  let total = h + w;

  // Δf = dt · A · g · Δh / l
  let k = dt * P.p1.w * P.p4.y / l;
  let prev = FX[i];

  let dhL = total - (cellH(x - 1, y, h) + cellW(x - 1, y));
  let dhR = total - (cellH(x + 1, y, h) + cellW(x + 1, y));
  let dhT = total - (cellH(x, y - 1, h) + cellW(x, y - 1));
  let dhB = total - (cellH(x, y + 1, h) + cellW(x, y + 1));

  let fL = max(0.0, prev.x + k * dhL);
  let fR = max(0.0, prev.y + k * dhR);
  let fT = max(0.0, prev.z + k * dhT);
  let fB = max(0.0, prev.w + k * dhB);

  let sum = fL + fR + fT + fB;
  // Never drain more water than the cell holds.
  let vol = w * l * l;
  let scale = select(1.0, min(1.0, vol / max(sum * dt, 1e-9)), sum * dt > vol && sum > 0.0);

  FX[i] = vec4f(fL, fR, fT, fB) * scale;
}

// --- stage 2: water height + velocity --------------------------------------------------------------

@compute @workgroup_size(8, 8)
fn water(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let i = u32(y * r + x);

  let dt = P.p1.x;
  let l = max(P.p1.y, 1e-3);
  let cellArea = l * l;
  let f = FX[i];

  let inL = FX[idAt(x - 1, y)].y;
  let inR = FX[idAt(x + 1, y)].x;
  let inT = FX[idAt(x, y - 1)].w;
  let inB = FX[idAt(x, y + 1)].z;
  let inflow = inL + inR + inT + inB;
  let outflow = f.x + f.y + f.z + f.w;

  var w0 = Wr[i];
  // Rain falls everywhere, including on cells that are already wet.
  w0 = w0 + P.p2.x;
  var w1 = w0 + dt * (inflow - outflow) / cellArea;
  w1 = max(w1, 0.0);
  Ww[i] = w1;

  let wAvg = max(0.5 * (w0 + w1), 1e-4);
  var vx = 0.5 * ((inL - f.x) + (f.y - inR));
  var vz = 0.5 * ((inT - f.z) + (f.w - inB));
  vx = vx / (l * wAvg);
  vz = vz / (l * wAvg);
  let sp = length(vec2f(vx, vz));
  let capped = min(sp, 40.0) / max(sp, 1e-6);
  VL[i] = vec2f(vx, vz) * capped;
}

// --- stage 3: erosion, deposition, slumping --------------------------------------------------------

@compute @workgroup_size(8, 8)
fn erode(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let i = u32(y * r + x);

  let l = max(P.p1.y, 1e-3);
  var h = H[i];
  let w = Ww[i];
  var s = Sr[i];
  let u = VL[i];

  let hL = cellH(x - 1, y, h);
  let hR = cellH(x + 1, y, h);
  let hT = cellH(x, y - 1, h);
  let hB = cellH(x, y + 1, h);

  let dhx = (hR - hL) / (2.0 * l);
  let dhz = (hB - hT) / (2.0 * l);
  let grad = length(vec2f(dhx, dhz));
  let sinTilt = grad / sqrt(1.0 + grad * grad);

  // Sediment capacity falls off as the film of water gets thin, which is what keeps rills from
  // carving bone-dry hillsides.
  let wet = clamp(w * 40.0, 0.0, 1.0);
  let capacity = P.p2.z * sinTilt * length(u) * wet;

  let maxStep = P.p3.z;
  if (capacity > s) {
    let amount = min(P.p2.w * (capacity - s), maxStep);
    // Cannot pick up more than the cell is allowed to lose this step.
    h = h - amount;
    s = s + amount;
  } else {
    let amount = min(P.p3.x * (s - capacity), maxStep);
    h = h + amount;
    s = s - max(amount, 0.0);
  }

  // Optional talus slumping. Executed in place: a relaxation this gentle is insensitive to the
  // read/write interleaving between neighbouring invocations, and it is what stops the solver from
  // growing the needle-like spikes a pure pipe model leaves on steep faces.
  let thermal = P.p3.w;
  if (thermal > 0.0) {
    let talus = P.p4.x * l;
    var delta = 0.0;
    for (var j = -1; j <= 1; j = j + 1) {
      for (var o = -1; o <= 1; o = o + 1) {
        if (o == 0 && j == 0) { continue; }
        let dist = length(vec2f(f32(o), f32(j))) * l;
        let nh = cellH(x + o, y + j, h);
        let maxDiff = talus * dist / l;
        let diff = h - nh;
        if (diff > maxDiff) {
          delta -= (diff - maxDiff) * thermal * 0.08;
        } else if (diff < -maxDiff) {
          delta += (-diff - maxDiff) * thermal * 0.08;
        }
      }
    }
    h = h + delta;
  }

  H[i] = h;
  Sr[i] = s;
}

// --- stage 4: advect the suspended sediment --------------------------------------------------------

@compute @workgroup_size(8, 8)
fn transport(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let x = f32(gid.x);
  let y = f32(gid.y);
  let i = u32(i32(y) * r + i32(x));

  let dt = P.p1.x;
  let l = max(P.p1.y, 1e-3);
  let u = VL[i];
  // Back-trace in texel space.
  let sx = x - u.x * dt / l;
  let sy = y - u.y * dt / l;
  Sw[i] = sampleSediment(sx, sy);
}

// --- stage 5: evaporation -------------------------------------------------------------------------

@compute @workgroup_size(8, 8)
fn evaporate(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let i = u32(gid.y * r + gid.x);
  Ww[i] = Ww[i] * (1.0 - clamp(P.p2.y, 0.0, 0.5));
}

// --- lifecycle -------------------------------------------------------------------------------------

@compute @workgroup_size(8, 8)
fn initSim(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let i = u32(gid.y * r + gid.x);
  H[i] = FLD[i] * P.p1.z;
  Wr[i] = 0.0;
  Ww[i] = 0.0;
  Sr[i] = 0.0;
  Sw[i] = 0.0;
  FX[i] = vec4f(0.0);
  VL[i] = vec2f(0.0);
}

@compute @workgroup_size(8, 8)
fn finalizeSim(@builtin(global_invocation_id) gid: vec3u) {
  let r = res();
  if (gid.x >= u32(r) || gid.y >= u32(r)) { return; }
  let i = u32(gid.y * r + gid.x);
  FLD[i] = H[i] / max(P.p1.z, 1e-3);
  // Wetness is kept as a 0..1 cue for rivers, shoreline darkening and the flow debug view.
  WET[i] = clamp(Wr[i] * 60.0, 0.0, 1.0);
}
