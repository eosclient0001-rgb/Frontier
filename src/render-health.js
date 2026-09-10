// Availability is not health: an adapter can exist while its presentation path
// fails. Read back an actual startup frame before declaring the renderer ready.
export async function withDeadline(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function inspectFrame(pixels) {
  let min = 255,
    max = 0,
    sum = 0,
    opaque = 0;
  const count = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    if (pixels[i + 3] > 240) opaque++;
  }
  const mean = count ? sum / count : 0;
  // The fixed startup camera must show rock and background, not a flat clear,
  // all-white output, black output, or a discarded transparent swap buffer.
  const ok =
    count > 0 &&
    opaque / count > 0.98 &&
    mean > 8 &&
    mean < 245 &&
    max - min > 12;
  return { ok, min, max, mean, pixels: count };
}

export function assertFrame(pixels) {
  const health = inspectFrame(pixels);
  if (!health.ok)
    throw new Error(
      `Terrain frame is blank or invalid (mean ${health.mean.toFixed(1)}, range ${(health.max - health.min).toFixed(1)}).`,
    );
  return health;
}

export function validateUniforms(uniforms) {
  if (uniforms.length !== 28 || !uniforms.every(Number.isFinite))
    throw new Error(
      "Invalid camera/render uniforms; refusing to submit a non-finite frame.",
    );
}
