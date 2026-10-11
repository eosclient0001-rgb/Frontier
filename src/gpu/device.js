/**
 * Frontier Terrain Forge — WebGPU device acquisition.
 *
 * Reports exactly what it found so the editor can present a useful diagnostic
 * instead of a blank canvas: adapter info, the limits that matter for a terrain
 * pipeline (texture size, storage textures per stage, workgroup size), and
 * whether float32 filtering is available.
 */

export class GpuUnavailableError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'GpuUnavailableError';
    this.detail = detail;
  }
}

export async function initDevice({ onLog } = {}) {
  if (!('gpu' in navigator)) {
    throw new GpuUnavailableError(
      'WebGPU is not available in this browser.',
      'Chrome/Edge 113+, Safari 18+ or Firefox 141+ are required. On Linux, Chrome may need --enable-unsafe-webgpu.',
    );
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new GpuUnavailableError('No WebGPU adapter was found.', 'The GPU may be blocklisted or busy.');
  }

  const wantedLimits = {};
  const adapterLimits = adapter.limits;
  const supported = {};
  // Ask for everything the adapter reports; the terrain pipeline benefits from
  // large textures and more storage textures per stage, but never requires them.
  for (const key of [
    'maxTextureDimension2D',
    'maxStorageTexturesPerShaderStage',
    'maxSampledTexturesPerShaderStage',
    'maxComputeWorkgroupStorageSize',
    'maxComputeInvocationsPerWorkgroup',
    'maxBufferSize',
    'maxComputeWorkgroupsPerDimension',
  ]) {
    if (key in adapterLimits) {
      wantedLimits[key] = adapterLimits[key];
      supported[key] = adapterLimits[key];
    }
  }

  const device = await adapter.requestDevice({ requiredLimits: wantedLimits });
  device.addEventListener?.('uncapturederror', (event) => {
    onLog?.({ level: 'error', message: `GPU error: ${event.error?.message ?? event.error}` });
  });

  // Prefer a float texture format that can be filtered if the adapter allows it;
  // the field pipeline uses textureLoad everywhere, so this is purely a nicety.
  const hasFloat32Filterable = adapter.features.has('float32-filterable');

  const info = adapter.info || {};
  const summary = {
    vendor: info.vendor || 'unknown vendor',
    architecture: info.architecture || '',
    device: info.device || 'unknown device',
    description: info.description || '',
    maxTexture: supported.maxTextureDimension2D ?? 8192,
    maxStorageTextures: supported.maxStorageTexturesPerShaderStage ?? 4,
    maxSampledTextures: supported.maxSampledTexturesPerShaderStage ?? 16,
    maxBufferSize: supported.maxBufferSize ?? 256 * 1024 * 1024,
    maxWorkgroups: supported.maxComputeWorkgroupsPerDimension ?? 65535,
    hasFloat32Filterable,
    limits: supported,
  };

  return { device, adapter, info: summary };
}

/** Device pixel ratio clamped to something a terrain renderer can afford. */
export function pixelRatio(limit = 2) {
  return Math.min(window.devicePixelRatio || 1, limit);
}
