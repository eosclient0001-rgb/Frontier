// ---------------------------------------------------------------------------
// Particle hydraulic erosion (Lague-style droplets) with sediment capacity,
// deposition, evaporation, inertia and a brush. Water traversal is accumulated
// into a fixed-point flow buffer used for rivers, wetness and drainage masks.
//
// Units: the height buffer is normalised to [0,1] (1 = maxH metres). Inside the
// droplet solver heights are expressed in cell units (height / cell * maxH), so
// slopes are dimensionless and the Lague constants keep their meaning.
//
// Slots: P(1) lifetime, P(2) inertia, P(3) capacity, P(4) erosion,
// P(5) deposition, P(6) evaporation, P(7) gravity, P(9) pass seed,
// P(10) droplet count, P(11) brush entries. P(0) and P(8) are host-only.
// ---------------------------------------------------------------------------
@group(0) @binding(0) var<uniform> U: Uni;
@group(0) @binding(1) var<storage, read_write> H: array<f32>;
@group(0) @binding(2) var<storage, read_write> flowA: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> brush: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> fmaxA: array<atomic<u32>>;

fn P(i: u32) -> f32 {
  let v = U.p[i >> 2u];
  return v[i & 3u];
}

const MAX_STEP: f32 = 0.25; // cell units per droplet step
const DROP_ROW: u32 = 4194240u; // 65535 workgroups * 64 invocations

fn rnd(s: u32) -> f32 {
  return f32(ihash(s)) * (1.0 / 4294967296.0);
}

// Height (normalised) and gradient (normalised per cell) from the four cell
// corners around p. p is already in bounds.
fn cornerSample(p: vec2<f32>) -> vec3<f32> {
  let n = U.n;
  let ix = u32(floor(p.x));
  let iy = u32(floor(p.y));
  let fx = p.x - floor(p.x);
  let fy = p.y - floor(p.y);
  let i00 = iy * n + ix;
  let h00 = H[i00];
  let h10 = H[i00 + 1u];
  let h01 = H[i00 + n];
  let h11 = H[i00 + n + 1u];
  let gx = (h10 - h00) * (1.0 - fy) + (h11 - h01) * fy;
  let gy = (h01 - h00) * (1.0 - fx) + (h11 - h10) * fx;
  let hh = h00 * (1.0 - fx) * (1.0 - fy) + h10 * fx * (1.0 - fy) + h01 * (1.0 - fx) * fy + h11 * fx * fy;
  return vec3<f32>(hh, gx, gy);
}

// Adds a normalised amount bilinearly at p.
fn depositAt(p: vec2<f32>, amt: f32) {
  let n = U.n;
  let ix = u32(floor(p.x));
  let iy = u32(floor(p.y));
  let fx = p.x - floor(p.x);
  let fy = p.y - floor(p.y);
  let i00 = iy * n + ix;
  H[i00] = H[i00] + amt * (1.0 - fx) * (1.0 - fy);
  H[i00 + 1u] = H[i00 + 1u] + amt * fx * (1.0 - fy);
  H[i00 + n] = H[i00 + n] + amt * (1.0 - fx) * fy;
  H[i00 + n + 1u] = H[i00 + n + 1u] + amt * fx * fy;
}

@compute @workgroup_size(64)
fn hydro_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x + gid.y * DROP_ROW;
  let cnt = u32(P(10u));
  if (id >= cnt) { return; }
  let n = U.n;
  let nf = f32(n);
  let hs = U.maxH / U.cell;           // normalised height -> cell units
  let base = ihash(id * 747796405u + u32(P(9u)) * 2891336453u + 12345u);
  let inertia = P(2u);
  let capK = P(3u);
  let minSlope = 0.01;
  let er = P(4u);
  let dep = P(5u);
  let evap = P(6u);
  let grav = P(7u);
  let life = u32(P(1u));
  let nb = u32(P(11u));

  var pos = vec2<f32>(rnd(base) * (nf - 3.0) + 1.0, rnd(base + 1u) * (nf - 3.0) + 1.0);
  var dir = vec2<f32>(0.0, 0.0);
  var speed = 1.0;
  var water = 1.0;
  var sed = 0.0;

  for (var s: u32 = 0u; s < life; s = s + 1u) {
    let cs = cornerSample(pos);
    let hOld = cs.x * hs;
    let grad = vec2<f32>(cs.y, cs.z) * hs;
    dir = dir * inertia - grad * (1.0 - inertia);
    var dl = length(dir);
    if (dl < 1e-6) {
      let a = rnd(base + s * 7u + 3u) * 6.2831853;
      dir = vec2<f32>(cos(a), sin(a));
      dl = 1.0;
    }
    dir = dir / dl;
    pos = pos + dir;
    if (pos.x < 1.0 || pos.y < 1.0 || pos.x > nf - 2.0 || pos.y > nf - 2.0) { break; }

    let hNew = cornerSample(pos).x * hs;
    let dh = hNew - hOld;             // cell units per step
    let cap = max(-dh * speed * water * capK, minSlope);
    if (sed > cap || dh > 0.0) {
      var amt = 0.0;
      if (dh > 0.0) {
        amt = min(dh, sed);
      } else {
        amt = (sed - cap) * dep;
      }
      // Bound per-step deposition: an unbounded dump of accumulated sediment on
      // one flat spot creates cell-scale spikes.
      amt = min(amt, MAX_STEP);
      sed = sed - amt;
      depositAt(pos, amt / hs);
    } else {
      // Bounded per-step erosion (cell units): the droplet cannot strip its whole drop in one step.
      let amt = min(min((cap - sed) * er, -dh), MAX_STEP);
      let cx = i32(floor(pos.x));
      let cy = i32(floor(pos.y));
      for (var b: u32 = 0u; b < nb; b = b + 1u) {
        let e = brush[b];
        let bx = cx + i32(e.x);
        let by = cy + i32(e.y);
        if (bx < 0 || by < 0 || bx >= i32(n) || by >= i32(n)) { continue; }
        let j = u32(by) * n + u32(bx);
        let remZ = min(amt * e.z, H[j] * hs);
        H[j] = H[j] - remZ / hs;
        sed = sed + remZ;
      }
    }
    // dh < 0 downhill: the droplet accelerates (energy conservation).
    speed = sqrt(max(speed * speed - dh * grav, 0.0));
    water = water * (1.0 - evap);
    let fi = u32(floor(pos.y)) * n + u32(floor(pos.x));
    _ = atomicAdd(&flowA[fi], u32(water * 16.0));
  }
}

// Reduce the flow buffer to its maximum (single element).
@compute @workgroup_size(8, 8)
fn flowmax_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = U.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let raw = atomicLoad(&flowA[gid.y * n + gid.x]);
  _ = atomicMax(&fmaxA[0], raw);
}
