// ─────────────────────────────────────────────────────────────────────────────
//  A recording mock WebGPU device.
//
//  The sandbox this was authored in has no GPU, so the engine code is exercised
//  against a fake device that validates what a real implementation would:
//  pipeline entry points exist, bind groups match their layouts, dynamic offsets
//  are aligned, render targets are never bound to themselves, and no NaN ever
//  reaches a uniform buffer.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readRepo = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

export function installGlobals() {
  globalThis.location = { href: 'http://localhost/' };
  globalThis.fetch = async (url) => {
    const p = String(url).replace('http://localhost/', '');
    try { return { ok: true, status: 200, text: async () => readRepo(p) }; }
    catch { return { ok: false, status: 404, text: async () => '' }; }
  };
  globalThis.GPUBufferUsage = { UNIFORM: 64, STORAGE: 128, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, MAP_READ: 1 };
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16, COPY_SRC: 1, COPY_DST: 2 };
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  globalThis.GPUMapMode = { READ: 1 };
}

export class Recorder {
  constructor() { this.problems = []; this.dispatches = 0; this.frames = 0; }
  note(m) { if (!this.problems.includes(m)) this.problems.push(m); }
}

export function makeDevice(rec) {
  let uid = 0;
  let passDepth = 0;
  const problems = rec.problems;
  const note = (m) => rec.note(m);

  const mkBuffer = (d) => {
    const store = new ArrayBuffer(Math.max(16, d.size));
    return {
      __t: 'buffer', size: d.size, label: d.label, store,
      destroy() {},
      mapAsync: async () => {},
      getMappedRange: () => store,
      unmap: () => {},
    };
  };
  const mkTexture = (d) => {
    const t = {
      __t: 'texture', id: ++uid, size: d.size, format: d.format, label: d.label,
      width: d.size[0], height: d.size[1], usage: d.usage, destroy() {},
      createView: () => ({ __t: 'view', tex: t }),
    };
    return t;
  };

  const checkFinite = (label, data, floats) => {
    for (let i = 0; i < floats; i++) {
      if (!Number.isFinite(data[i])) { note(`non-finite value at ${i} in ${label}`); return; }
    }
  };

  const device = {
    limits: { maxTextureDimension2D: 8192, maxBufferSize: 1 << 28, maxStorageBufferBindingSize: 1 << 30 },
    features: new Set(),

    createShaderModule: (d) => {
      const fns = new Set();
      for (const m of d.code.matchAll(/^\s*fn\s+([A-Za-z_]\w*)\s*\(/gm)) fns.add(m[1]);
      return { __t: 'module', label: d.label, fns };
    },
    createComputePipeline: (d) => {
      if (!d.compute.module.fns.has(d.compute.entryPoint)) {
        note(`missing compute entry "${d.compute.entryPoint}" in ${d.compute.module.label}`);
      }
      return { __t: 'computePipeline', name: d.compute.entryPoint, label: d.label, layout: d.layout };
    },
    createRenderPipeline: (d) => {
      for (const [k, s] of [['vertex', d.vertex], ['fragment', d.fragment]]) {
        if (!s) { note(`${d.label}: no ${k} stage`); continue; }
        if (!s.module.fns.has(s.entryPoint)) {
          note(`missing ${k} entry "${s.entryPoint}" in ${s.module.label}`);
        }
      }
      for (const t of d.fragment?.targets || []) if (!t.format) note(`${d.label}: target without format`);
      return { __t: 'renderPipeline', label: d.label, layout: d.layout, ds: d.depthStencil };
    },
    createBuffer: mkBuffer,
    createTexture: mkTexture,
    createSampler: () => ({ __t: 'sampler' }),
    createBindGroupLayout: (d) => ({ __t: 'bgl', entries: d.entries, label: d.label }),
    createPipelineLayout: (d) => ({ __t: 'pl', bgls: d.bindGroupLayouts }),
    createBindGroup: (d) => {
      const layoutEntries = d.layout?.entries || [];
      const seen = new Set();
      for (const e of d.entries) {
        if (seen.has(e.binding)) note(`bg ${d.label}: duplicate binding ${e.binding}`);
        seen.add(e.binding);
        const L = layoutEntries.find((x) => x.binding === e.binding);
        if (!L) { note(`bg ${d.label}: binding ${e.binding} is not in the layout`); continue; }
        if (L.buffer?.hasDynamicOffset && e.resource.size === undefined) {
          note(`bg ${d.label}: binding ${e.binding} has a dynamic offset but no size`);
        }
      }
      for (const L of layoutEntries) {
        if (!seen.has(L.binding)) note(`bg ${d.label}: layout binding ${L.binding} has no resource`);
      }
      return { __t: 'bg', label: d.label, entries: d.entries };
    },
    createCommandEncoder: () => {
      let rp = null;
      return {
        beginComputePass: () => {
          if (passDepth) note('nested pass');
          passDepth++;
          return {
            setPipeline: (p) => { if (!p) note('setPipeline(undefined)'); },
            setBindGroup: (i, bg, offs) => {
              if (!bg) return note('setBindGroup(undefined)');
              for (const o of offs || []) if (o % 256) note(`dynamic offset ${o} is not 256-aligned`);
            },
            dispatchWorkgroups: (x, y, z) => {
              rec.dispatches++;
              for (const v of [x, y, z]) if (!(v >= 1 && v <= 65535)) note(`dispatch size ${v}`);
            },
            end: () => { passDepth--; },
          };
        },
        beginRenderPass: (d) => {
          if (passDepth) note('nested pass');
          passDepth++;
          const targets = (d.colorAttachments || []).map((a) => a.view?.tex);
          if (targets.some((t) => !t)) note('render pass with an attachment that is not a texture view');
          const depth = d.depthStencilAttachment?.view?.tex;
          for (const t of targets) {
            if (t && !(t.usage & GPUTextureUsage.RENDER_ATTACHMENT)) note(`${t.label} is not RENDER_ATTACHMENT`);
          }
          if (depth && !(depth.usage & GPUTextureUsage.RENDER_ATTACHMENT)) note(`${depth.label} depth not RENDER_ATTACHMENT`);
          rp = { self: new Set(targets.filter(Boolean)) };
          return {
            setPipeline: (p) => {
              if (!p) note('setPipeline(undefined)');
              if (p?.ds?.depthCompare !== 'always' && p?.ds && !depth) note(`${p.label} needs a depth attachment`);
            },
            setBindGroup: (i, bg, offs) => {
              if (!bg) return note('setBindGroup(undefined)');
              for (const o of offs || []) if (o % 256) note(`dynamic offset ${o} is not 256-aligned`);
              for (const e of bg.entries) {
                if (e.resource?.tex && rp.self.has(e.resource.tex)) {
                  note(`${e.resource.tex.label} is bound while being rendered into`);
                }
              }
            },
            setIndexBuffer: () => {}, setVertexBuffer: () => {},
            draw: (n) => { if (!(n > 0)) note(`draw(${n})`); },
            drawIndexed: (n) => { if (!(n > 0)) note(`drawIndexed(${n})`); },
            end: () => { passDepth--; rp = null; },
          };
        },
        copyTextureToBuffer: (a, b, size) => {
          if (b.bytesPerRow % 256) note(`bytesPerRow ${b.bytesPerRow} is not 256-aligned`);
          if (!size) note('copyTextureToBuffer with no size');
          if (!(a.texture.usage & GPUTextureUsage.COPY_SRC)) note('copy source lacks COPY_SRC');
        },
        finish: () => ({ __t: 'cmdbuf' }),
      };
    },
    queue: {
      writeBuffer: (buf, off, data, dOff, size) => {
        if (!buf) return note('writeBuffer(undefined)');
        const n = (size ?? data.byteLength) / 4;
        checkFinite(buf.label, data, Math.min(n, data.length));
      },
      submit: (l) => { if (!l?.length) note('submit([])'); },
      onSubmittedWorkDone: async () => {},
    },
    addEventListener: () => {},
    destroy: () => {},
  };
  void problems;
  return device;
}
