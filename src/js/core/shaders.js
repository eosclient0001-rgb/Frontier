// Shader loading with a tiny #include resolver.

const cache = new Map();

async function fetchText(url) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load shader ${url} (${res.status})`);
  const text = await res.text();
  cache.set(url, text);
  return text;
}

async function resolve(text, base) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    const m = /^\s*#include\s+"([^"]+)"\s*$/.exec(line);
    if (m) {
      const url = new URL(m[1], base).href;
      out.push(await resolve(await fetchText(url), url));
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/** Load a shader module and resolve its includes. */
export async function loadShader(url) {
  const raw = await fetchText(new URL(url, location.href).href);
  return resolve(raw, new URL(url, location.href).href);
}

/** Create every pipeline from one module in a single call. */
export function makePipelines(device, code, label, specs) {
  const module = device.createShaderModule({ code, label });
  const out = {};
  for (const [name, spec] of Object.entries(specs)) {
    const isCompute = !spec.vertex;
    if (isCompute) {
      out[name] = device.createComputePipeline({
        layout: spec.layout,
        compute: { module, entryPoint: spec.entry || name },
        label: `${label}:${name}`,
      });
    } else {
      out[name] = device.createRenderPipeline({
        layout: spec.layout,
        vertex: { module, entryPoint: spec.vertex, buffers: spec.buffers || [] },
        fragment: { module, entryPoint: spec.fragment, targets: spec.targets },
        primitive: spec.primitive || { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: spec.depthStencil,
        multisample: spec.multisample,
        label: `${label}:${name}`,
      });
    }
  }
  return out;
}
