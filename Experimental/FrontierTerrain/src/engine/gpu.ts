// WebGPU device bootstrap and small helpers shared by the engine.
export interface GPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  info: string;
}

export async function initGPU(): Promise<GPUContext> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    throw new Error('WebGPU is not available in this browser. Use a recent Chrome, Edge or Safari 18+.');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter was returned by the browser.');
  const al = adapter.limits;
  const required: Record<string, number> = {};
  for (const k of ['maxStorageBufferBindingSize', 'maxBufferSize', 'maxStorageBuffersPerShaderStage',
    'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup']) {
    const v = (al as unknown as Record<string, number>)[k];
    if (typeof v === 'number') required[k] = v;
  }
  const device = await adapter.requestDevice({ requiredLimits: required });
  device.lost.then((info) => console.warn('WebGPU device lost:', info.message));
  const ai = (adapter as unknown as { info?: { vendor?: string; architecture?: string; device?: string; description?: string } }).info;
  const info = ai ? [ai.vendor, ai.architecture, ai.device || ai.description].filter(Boolean).join(' · ') : 'WebGPU adapter';
  return { adapter, device, info: info || 'WebGPU adapter' };
}

export const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

export function makeBuffer(device: GPUDevice, size: number, usage: number, label = ''): GPUBuffer {
  return device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage, label });
}

export function makeModule(device: GPUDevice, code: string, label: string): GPUShaderModule {
  const mod = device.createShaderModule({ code, label });
  return mod;
}

// Reads back a buffer; resolves with a copy of its contents.
export async function readBack(device: GPUDevice, src: GPUBuffer, offset: number, size: number): Promise<ArrayBuffer> {
  const staging = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, offset, staging, 0, size);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return copy;
}
