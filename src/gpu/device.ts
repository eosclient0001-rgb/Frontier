export interface GPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  /** True when r32float can be sampled with a filtering sampler. */
  f32Filterable: boolean;
  info: string;
}

export async function initGPU(canvas: HTMLCanvasElement): Promise<GPUContext> {
  if (!('gpu' in navigator)) {
    throw new Error('navigator.gpu is undefined — this browser has no WebGPU support.');
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('requestAdapter() returned null — no compatible GPU adapter was found.');
  }

  const wanted: GPUFeatureName[] = [];
  if (adapter.features.has('float32-filterable')) wanted.push('float32-filterable' as GPUFeatureName);
  if (adapter.features.has('timestamp-query')) wanted.push('timestamp-query' as GPUFeatureName);
  // NOTE on the volume format: we use rgba16float with WRITE-ONLY storage
  // access, which is part of core WebGPU. (Only READ-WRITE access to
  // rgba16float requires the optional texture-formats-tier2 feature, and the
  // ping-pong design deliberately avoids needing it.)

  // Ask for headroom on the 3D texture dimension and storage-buffer size.
  const lim = adapter.limits;
  const device = await adapter.requestDevice({
    requiredFeatures: wanted,
    requiredLimits: {
      maxTextureDimension3D: Math.min(1024, lim.maxTextureDimension3D),
      maxStorageBufferBindingSize: Math.min(1 << 29, lim.maxStorageBufferBindingSize),
      maxBufferSize: Math.min(1 << 29, lim.maxBufferSize),
      maxComputeWorkgroupStorageSize: lim.maxComputeWorkgroupStorageSize,
    },
  });

  device.lost.then((info) => {
    // Surfaced by the app; a lost device cannot be recovered in place.
    console.error('WebGPU device lost:', info.reason, info.message);
    const gate = document.getElementById('gate');
    const msg = document.getElementById('gate-msg');
    if (gate && msg) {
      msg.textContent = `The GPU device was lost (${info.reason}): ${info.message}`;
      gate.hidden = false;
    }
  });

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('canvas.getContext("webgpu") returned null.');

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const ainfo = (adapter as unknown as { info?: GPUAdapterInfo }).info;
  const info = ainfo
    ? [ainfo.vendor, ainfo.architecture, ainfo.device, ainfo.description].filter(Boolean).join(' ')
    : 'unknown adapter';

  return {
    adapter,
    device,
    context,
    format,
    canvas,
    f32Filterable: device.features.has('float32-filterable' as GPUFeatureName),
    info,
  };
}

/** Wrap an operation so WebGPU validation errors surface with useful context. */
export async function captureErrors<T>(device: GPUDevice, label: string, fn: () => T): Promise<T> {
  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');
  const result = fn();
  const oom = await device.popErrorScope();
  const val = await device.popErrorScope();
  if (val) throw new Error(`[${label}] validation: ${val.message}`);
  if (oom) throw new Error(`[${label}] out of memory: ${oom.message}`);
  return result;
}
