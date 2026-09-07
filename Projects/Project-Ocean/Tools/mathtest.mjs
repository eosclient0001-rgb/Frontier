// O0 headless math test — run: node Tools/mathtest.mjs (from Project-Ocean/).
// Imports OceanApp with stubbed DOM; exercises pure functions (no GPU needed).
globalThis.window = { __ocean: {}, addEventListener: () => {} };
globalThis.addEventListener = () => {};
globalThis.location = { search: '?wind=10&auto=1&grid=224' };
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true }); // no gpu -> fail() path
globalThis.document = { getElementById: () => ({ style: {}, set textContent(v) {} }) };
globalThis.innerWidth = 960; globalThis.innerHeight = 540;

const M = await import(new URL('../Source/OceanApp.js', import.meta.url).href);
await new Promise((r) => setTimeout(r, 50));
let pass = 0;
const eq = (a, b, tol, name) => {
  const d = Math.abs(a - b);
  if (d <= tol) { pass++; }
  else { console.log(`FAIL ${name}: ${a} != ${b} (d=${d})`); process.exitCode = 1; }
};

// 1. perspective maps view-center near->0, far->1 (WebGPU depth 0..1)
{
  const P = new Float32Array(16);
  M.mPerspective(P, 55 * Math.PI / 180, 16 / 9, 0.5, 4000);
  const proj = (x, y, z) => {
    const w = P[3] * x + P[7] * y + P[11] * z + P[15];
    return (P[2] * x + P[6] * y + P[10] * z + P[14]) / w;
  };
  eq(proj(0, 0, -0.5), 0, 1e-6, 'near->0');
  eq(proj(0, 0, -4000), 1, 1e-3, 'far->1');
  const mid = proj(0, 0, -64);
  if (!(mid > 0 && mid < 1)) { console.log('FAIL mid depth', mid); process.exitCode = 1; } else pass++;
}
// 2. lookAt + invert roundtrip
{
  const V = new Float32Array(16), I = new Float32Array(16), R = new Float32Array(16);
  M.mLookAt(V, [27.6, 16.6, 50.6], [0, 0.5, 0], [0, 1, 0]);
  M.mInvert(I, V); M.mMultiply(R, V, I);
  for (let i = 0; i < 16; i++) eq(R[i], i % 5 === 0 ? 1 : 0, 1e-5, 'V*inv(V)[' + i + ']');
}
// 3. waves from wind
{
  const W = M.buildWaves(10, 0.9);
  eq(W.count, 6, 0, 'wave count');
  let amp = 0;
  for (let i = 0; i < 6; i++) {
    const dx = W.data[i * 4], dz = W.data[i * 4 + 1];
    eq(Math.hypot(dx, dz), 1, 1e-6, 'dir unit ' + i);
    if (!(W.data[i * 4 + 2] > 0)) { console.log('FAIL wavelength', i); process.exitCode = 1; } else pass++;
    amp += W.data[i * 4 + 3];
  }
  eq(amp, W.Hs / 2, 1e-6, 'amp sum = Hs/2');
  if (!(W.steep > 0 && W.steep <= 1)) { console.log('FAIL steep', W.steep); process.exitCode = 1; } else pass++;
}
// 4. grid mesh
{
  const g = M.buildGrid(4, 10);
  eq(g.v.length, 75, 0, 'grid verts');
  eq(g.idx.length, 96, 0, 'grid idx');
  eq(g.tris, 32, 0, 'grid tris');
  for (let i = 0; i < g.idx.length; i++) if (g.idx[i] > 24) { console.log('FAIL idx range'); process.exitCode = 1; }
  pass++;
  let mx = 0;
  for (let i = 0; i < g.v.length; i += 3) mx = Math.max(mx, Math.abs(g.v[i]), Math.abs(g.v[i + 2]));
  eq(mx, 5, 1e-6, 'grid extent');
}
console.log(pass + ' assertions checked, exit=' + (process.exitCode || 0));
