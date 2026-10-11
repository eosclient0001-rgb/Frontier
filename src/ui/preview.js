/**
 * Frontier Terrain Forge — map readback, previews and export.
 *
 * Every preview is the real thing: the texture is copied out of the GPU, run
 * through the same tone/range mapping the editor uses elsewhere, and drawn into
 * a canvas. Nothing here approximates a map, so what the panel shows is exactly
 * what gets exported.
 */

const TONES = {
  height: (v) => [v * 1.05, v, v * 0.94],
  slope: (v) => [Math.min(1, v * 1.5), v * v * 0.9, v * 0.35],
  ao: (v) => [v, v, v],
  flow: (v) => [0.15 + v * 0.5, 0.35 + v * 0.55, 0.55 + v * 0.45],
  deposit: (v) => [0.7 + v * 0.3, 0.55 + v * 0.3, 0.35 + v * 0.25],
  detail: (v) => [v, v, v],
  scalar: (v) => [v, v, v],
  rgba: null,
};

/** Read a texture back to the CPU. r32float and rgba8unorm are both handled. */
export async function readField(gpu, field) {
  // Both supported formats are 4 bytes per texel (rgba8unorm / r32float).
  const bytesPerTexel = 4;
  const bytesPerRow = Math.ceil((field.width * bytesPerTexel) / 256) * 256;
  const size = bytesPerRow * field.height;
  const buffer = gpu.device.createBuffer({
    label: `ui-readback:${field.label}`,
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = gpu.device.createCommandEncoder({ label: 'ui-readback' });
  encoder.copyTextureToBuffer(
    { texture: field.texture, origin: { x: 0, y: 0 } },
    { buffer, bytesPerRow, rowsPerImage: field.height },
    { width: field.width, height: field.height, depthOrArrayLayers: 1 },
  );
  gpu.device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = buffer.getMappedRange().slice(0);
  buffer.unmap();
  buffer.destroy();

  const packed = new Uint8Array(mapped);
  const rowBytes = field.width * bytesPerTexel;
  const tight = new Uint8Array(rowBytes * field.height);
  for (let y = 0; y < field.height; y++) {
    tight.set(packed.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
  }
  return {
    width: field.width,
    height: field.height,
    format: field.format,
    srgb: !!field.srgb,
    rgba: field.format === 'rgba8unorm' ? tight : null,
    scalar: field.format === 'rgba8unorm' ? null : new Float32Array(tight.buffer, tight.byteOffset, field.width * field.height),
  };
}

/** Downsample a scalar field on the GPU, then read the small copy. */
export async function readScalarPreview(gpu, graph, field, size = 256) {
  if (!graph?.passes?.downsample || !field) return null;
  const target = gpu.field({ width: size, height: size, format: 'r32float', label: 'ui-preview' });
  try {
    const encoder = gpu.device.createCommandEncoder({ label: 'ui-preview' });
    graph.runDownsample(encoder, field, target);
    gpu.device.queue.submit([encoder.finish()]);
    return await readField(gpu, target);
  } finally {
    gpu.release(target);
    gpu.clearCaches();
  }
}

/** Draw a readback into a canvas, mapping scalars through a tone curve. */
export function drawPreview(canvas, image, { tone = 'scalar', min = null, max = null, gamma = 1 } = {}) {
  if (!image) return false;
  const ctx = canvas.getContext('2d');
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const sctx = source.getContext('2d');
  const out = sctx.createImageData(image.width, image.height);
  const data = out.data;

  if (image.rgba) {
    data.set(image.rgba);
  } else {
    const fn = TONES[tone] || TONES.scalar;
    let lo = min;
    let hi = max;
    if (lo === null || hi === null) {
      lo = Infinity; hi = -Infinity;
      for (let i = 0; i < image.scalar.length; i++) {
        const v = image.scalar[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!Number.isFinite(lo) || hi - lo < 1e-6) { lo = 0; hi = Math.max(hi, 1); }
    }
    const span = Math.max(hi - lo, 1e-6);
    for (let i = 0; i < image.scalar.length; i++) {
      const t = Math.pow(Math.min(1, Math.max(0, (image.scalar[i] - lo) / span)), gamma);
      const rgb = fn(t);
      data[i * 4] = Math.round(rgb[0] * 255);
      data[i * 4 + 1] = Math.round(rgb[1] * 255);
      data[i * 4 + 2] = Math.round(rgb[2] * 255);
      data[i * 4 + 3] = 255;
    }
  }
  sctx.putImageData(out, 0, 0);
  canvas.width = canvas.clientWidth ? Math.round(canvas.clientWidth) : image.width;
  canvas.height = canvas.clientHeight ? Math.round(canvas.clientHeight) : image.height;
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return true;
}

/** Export a GPU texture as a PNG at full resolution. */
export async function exportTexture(gpu, field, filename) {
  const image = await readField(gpu, field);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(image.width, image.height);
  if (image.rgba) {
    out.data.set(image.rgba);
  } else {
    // Scalar maps get a 16-bit-ish grey ramp; PNG here is 8-bit by design.
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < image.scalar.length; i++) { lo = Math.min(lo, image.scalar[i]); hi = Math.max(hi, image.scalar[i]); }
    const span = Math.max(hi - lo, 1e-6);
    for (let i = 0; i < image.scalar.length; i++) {
      const v = Math.round(((image.scalar[i] - lo) / span) * 255);
      out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return { blob, filename };
}

/** Height-profile sparkline used by the world panel. */
export function drawProfile(canvas, image, { samples = 220 } = {}) {
  if (!image) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth || 320;
  const h = canvas.height = canvas.clientHeight || 88;
  ctx.clearRect(0, 0, w, h);
  const row = Math.floor(image.height / 2);
  let lo = Infinity; let hi = -Infinity;
  const values = [];
  for (let i = 0; i < samples; i++) {
    const x = Math.min(image.width - 1, Math.round((i / (samples - 1)) * image.width));
    const v = image.scalar ? image.scalar[row * image.width + x] : 0;
    values.push(v);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const span = Math.max(hi - lo, 1e-6);
  ctx.beginPath();
  ctx.strokeStyle = '#d6a078';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < values.length; i++) {
    const x = (i / (values.length - 1)) * w;
    const y = h - 6 - ((values[i] - lo) / span) * (h - 14);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = '#2c2c2c';
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();
}
