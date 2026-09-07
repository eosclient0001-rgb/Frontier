// Project-Ocean O0 — device, mesh, camera, loop, telemetry. No dependencies.
'use strict';

const $ = (id) => document.getElementById(id);
window.__ocean = { ready: false, error: null, fps: 0, ms: 0, tris: 0 };

function fail(msg) {
  window.__ocean.error = String(msg);
  const e = $('err');
  e.style.display = 'block';
  e.textContent = 'Ocean O0 error: ' + msg;
  console.error('[ocean]', msg);
}
window.addEventListener('error', (ev) => fail(ev.message || ev.error));

// ---------- tiny mat4 (column-major) ----------
function mPerspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = far / (near - far); out[11] = -1; // WebGPU depth 0..1
  out[14] = (far * near) / (near - far);
  return out;
}
function mLookAt(out, eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz); zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz); xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}
function mMultiply(out, a, b) { // out = a * b
  const t = (out === a || out === b) ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    t[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                   a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  if (t !== out) out.set(t);
  return out;
}
function mInvert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5],
        a12 = m[6], a13 = m[7], a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11],
        a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

// ---------- waves from wind (Gerstner placeholder; O1 replaces with FFT) ----------
function buildWaves(wind, windAngle) {
  const Hs = Math.min(0.21 * wind * wind / 9.81, 6.0); // Pierson–Moskowitz cap
  const L = [90, 46, 23, 12, 6.5, 4.0];
  const w = [0.42, 0.24, 0.15, 0.09, 0.06, 0.04];
  const spread = [0, 0.18, -0.22, 0.34, -0.40, 0.55];
  const arr = new Float32Array(8 * 4);
  for (let i = 0; i < 6; i++) {
    const a = windAngle + spread[i];
    arr[i * 4] = Math.cos(a); arr[i * 4 + 1] = Math.sin(a);
    arr[i * 4 + 2] = L[i]; arr[i * 4 + 3] = Hs * 0.5 * w[i];
  }
  return { data: arr, count: 6, steep: Math.min(0.45 + wind * 0.02, 0.85), Hs };
}

// ---------- grid mesh ----------
function buildGrid(n, size) {
  const v = new Float32Array((n + 1) * (n + 1) * 3);
  let p = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    v[p++] = (i / n - 0.5) * size; v[p++] = 0; v[p++] = (j / n - 0.5) * size;
  }
  const idx = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i <= n; i++) {
    if (i === n) continue;
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b;
    idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  return { v, idx, tris: n * n * 2 };
}

async function main() {
  const qs = new URLSearchParams(location.search);
  const P = {
    wind: Math.min(22, Math.max(2, parseFloat(qs.get('wind') || '10'))),
    auto: (qs.get('auto') || '1') === '1',
    grid: Math.min(384, Math.max(32, parseInt(qs.get('grid') || '224', 10))),
    size: 320,
  };
  if (!navigator.gpu) { fail('WebGPU not available in this browser.'); return; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { fail('No WebGPU adapter found.'); return; }
  const device = await adapter.requestDevice();
  device.lost.then((info) => { if (window.__ocean.ready) fail('Device lost: ' + info.message); });

  const canvas = $('view');
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  function resize() {
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    ctx.configure({ device, format, alphaMode: 'opaque' });
    depthTex?.destroy();
    depthTex = device.createTexture({
      size: [canvas.width, canvas.height], format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  const [waterSrc, skySrc] = await Promise.all([
    fetch('./Shaders/WaterSurface.wgsl').then((r) => { if (!r.ok) throw new Error('WaterSurface.wgsl ' + r.status); return r.text(); }),
    fetch('./Shaders/SkyBackdrop.wgsl').then((r) => { if (!r.ok) throw new Error('SkyBackdrop.wgsl ' + r.status); return r.text(); }),
  ]);

  // camera state
  const cam = { yaw: 0.55, pitch: 0.24, dist: 64, target: [0, 0.5, 0] };
  const sunDir = (() => { const s = [-0.38, 0.52, -0.76]; const l = Math.hypot(...s); return s.map((x) => x / l); })();

  // mesh
  const mesh = buildGrid(P.grid, P.size);
  window.__ocean.tris = mesh.tris;
  const vBuf = device.createBuffer({ size: mesh.v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vBuf, 0, mesh.v);
  const iBuf = device.createBuffer({ size: mesh.idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(iBuf, 0, mesh.idx);

  // uniforms: water 76 floats (304 B), sky 36 floats (144 B)
  const wU = new Float32Array(76);
  const sU = new Float32Array(36);
  const wBuf = device.createBuffer({ size: wU.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sBuf = device.createBuffer({ size: sU.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // static water uniforms
  wU.set(sunDir, 20); wU[23] = P.wind;
  wU.set([1.15, 1.02, 0.88], 24); // sunColor (linear)
  wU.set([0.012, 0.086, 0.130], 28); wU[31] = 1.0; // deepColor + scatter
  wU.set([0.16, 0.34, 0.68], 32); wU[35] = 1.0; // sky + haze
  wU.set([0.62, 0.72, 0.80], 36); // horizon
  const windAngle = 0.9;
  wU[40] = Math.cos(windAngle); wU[41] = Math.sin(windAngle);
  wU[42] = 0.55; wU[43] = 1.6; // detailAmp, detailFreq
  function applyWind() {
    const W = buildWaves(P.wind, windAngle);
    wU[23] = P.wind; wU[27] = W.steep; wU[39] = W.count;
    wU.set(W.data, 44);
  }
  applyWind();

  // static sky uniforms
  sU.set(sunDir, 20); sU[23] = 1.0;
  sU.set([0.16, 0.34, 0.68], 24); sU[27] = 0.6;
  sU.set([0.62, 0.72, 0.80], 28);
  sU.set([1.15, 1.02, 0.88], 32);

  function layout() {
    return device.createBindGroupLayout({ entries: [{
      binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' },
    }] });
  }
  const waterPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout()] }),
    vertex: { module: device.createShaderModule({ code: waterSrc }), entryPoint: 'vsMain',
      buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
    fragment: { module: device.createShaderModule({ code: waterSrc }), entryPoint: 'fsMain',
      targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const skyPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout()] }),
    vertex: { module: device.createShaderModule({ code: skySrc }), entryPoint: 'vsSky', buffers: [] },
    fragment: { module: device.createShaderModule({ code: skySrc }), entryPoint: 'fsSky',
      targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  });
  const wGroup = device.createBindGroup({
    layout: waterPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: wBuf } }],
  });
  const sGroup = device.createBindGroup({
    layout: skyPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: sBuf } }],
  });

  let depthTex = null;
  resize();
  addEventListener('resize', resize);

  // controls
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    cam.yaw -= (e.clientX - lx) * 0.005;
    cam.pitch = Math.min(1.2, Math.max(0.03, cam.pitch + (e.clientY - ly) * 0.005));
    lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.min(400, Math.max(8, cam.dist * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  const windEl = $('wind'), windVal = $('windVal'), autoEl = $('auto'), pauseEl = $('pause');
  windEl.value = String(P.wind); windVal.textContent = String(P.wind);
  autoEl.checked = P.auto;
  windEl.addEventListener('input', () => {
    P.wind = parseFloat(windEl.value); windVal.textContent = windEl.value; applyWind();
  });

  // loop
  const view = new Float32Array(16), proj = new Float32Array(16);
  const vp = new Float32Array(16), inv = new Float32Array(16);
  const eye = [0, 0, 0];
  let simT = 0, last = performance.now(), emaMs = 16, frames = 0, fpsT = last;
  const statsEl = $('stats');

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!pauseEl.checked) simT += dt;
    if (autoEl.checked && !dragging && !pauseEl.checked) cam.yaw += dt * 0.03;

    eye[0] = cam.target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw);
    eye[1] = cam.target[1] + cam.dist * Math.sin(cam.pitch);
    eye[2] = cam.target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw);
    mLookAt(view, eye, cam.target, [0, 1, 0]);
    mPerspective(proj, 55 * Math.PI / 180, canvas.width / canvas.height, 0.5, 4000);
    mMultiply(vp, proj, view);
    mInvert(inv, vp);

    wU.set(vp, 0); wU.set(eye, 16); wU[19] = simT;
    sU.set(inv, 0); sU.set(eye, 16);
    device.queue.writeBuffer(wBuf, 0, wU);
    device.queue.writeBuffer(sBuf, 0, sU);

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.4, g: 0.55, b: 0.7, a: 1 } }],
      depthStencilAttachment: { view: depthTex.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    pass.setPipeline(skyPipe); pass.setBindGroup(0, sGroup); pass.draw(3);
    pass.setPipeline(waterPipe); pass.setBindGroup(0, wGroup);
    pass.setVertexBuffer(0, vBuf); pass.setIndexBuffer(iBuf, 'uint32');
    pass.drawIndexed(mesh.idx.length);
    pass.end();
    device.queue.submit([enc.finish()]);

    emaMs = emaMs * 0.95 + dt * 1000 * 0.05;
    frames++;
    if (now - fpsT > 500) {
      const fps = frames * 1000 / (now - fpsT);
      frames = 0; fpsT = now;
      window.__ocean.fps = Math.round(fps); window.__ocean.ms = +emaMs.toFixed(2);
      statsEl.textContent = `${window.__ocean.fps} fps · ${window.__ocean.ms} ms · ` +
        `${(mesh.tris / 1000).toFixed(0)}k tris · wind ${P.wind} m/s`;
    }
  }

  window.__ocean.ready = true;
  requestAnimationFrame(frame);
}

main().catch((e) => fail(e && e.stack ? e.stack : e));

// Pure-math exports for headless unit tests (ignored by the browser page).
export { mPerspective, mLookAt, mMultiply, mInvert, buildWaves, buildGrid, hexToLinear, sunDirFromAngles };
