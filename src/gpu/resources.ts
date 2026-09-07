import type { GridConfig } from '../config';
import { simDims } from '../config';
import { PARAM_BYTES } from '../params';

/** Bytes per SimCell — must match the WGSL struct in sim_common.wgsl. */
export const SIM_CELL_BYTES = 64;

export const VOLUME_FORMAT: GPUTextureFormat = 'rgba16float';

export interface Resources {
  grid: GridConfig;
  /** Ping-pong pair — compute passes read A and write B, then swap. */
  volA: GPUTexture;
  volB: GPUTexture;
  paramBuf: GPUBuffer;
  simBuf: GPUBuffer;
  cameraBuf: GPUBuffer;
  brushBuf: GPUBuffer;
  pickReqBuf: GPUBuffer;
  pickResBuf: GPUBuffer;
  pickStaging: GPUBuffer;
  linSampler: GPUSampler;
  nearSampler: GPUSampler;
  destroy(): void;
}

function makeVolume(device: GPUDevice, g: GridConfig, label: string): GPUTexture {
  return device.createTexture({
    label,
    size: { width: g.volX, height: g.volY, depthOrArrayLayers: g.volZ },
    dimension: '3d',
    format: VOLUME_FORMAT,
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  });
}

export function createResources(device: GPUDevice, grid: GridConfig): Resources {
  const { simX, simZ } = simDims(grid);

  const volA = makeVolume(device, grid, 'volume A');
  const volB = makeVolume(device, grid, 'volume B');

  const paramBuf = device.createBuffer({
    label: 'params',
    size: PARAM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const simBuf = device.createBuffer({
    label: 'sim grid',
    size: simX * simZ * SIM_CELL_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const cameraBuf = device.createBuffer({
    label: 'camera',
    size: 4 * 16 + 4 * 4 * 3, // mat4 + 3 vec4
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const brushBuf = device.createBuffer({
    label: 'brush',
    size: 48, // vec3+f32, f32*3+u32... padded to 3 rows of 16
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const pickReqBuf = device.createBuffer({
    label: 'pick request',
    size: 32, // vec3+pad, vec3+pad
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const pickResBuf = device.createBuffer({
    label: 'pick result',
    size: 32, // vec3+f32, vec3+f32
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const pickStaging = device.createBuffer({
    label: 'pick staging',
    size: 32,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const linSampler = device.createSampler({
    label: 'linear clamp',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  });

  const nearSampler = device.createSampler({
    label: 'nearest clamp',
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  });

  return {
    grid,
    volA,
    volB,
    paramBuf,
    simBuf,
    cameraBuf,
    brushBuf,
    pickReqBuf,
    pickResBuf,
    pickStaging,
    linSampler,
    nearSampler,
    destroy() {
      volA.destroy();
      volB.destroy();
      paramBuf.destroy();
      simBuf.destroy();
      cameraBuf.destroy();
      brushBuf.destroy();
      pickReqBuf.destroy();
      pickResBuf.destroy();
      pickStaging.destroy();
    },
  };
}

export function volumeMB(g: GridConfig): number {
  return (g.volX * g.volY * g.volZ * 8 * 2) / (1024 * 1024); // two buffers
}
