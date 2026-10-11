/**
 * Frontier Terrain Forge — minimal DOM shim for the headless tools.
 *
 * Enough of the DOM to build the real panels and boot the real app in Node:
 * element trees, classList/dataset/style, events, canvas stubs, a controllable
 * requestAnimationFrame and a ResizeObserver that never fires. It is not a
 * browser — it exists so `tools/uitest.mjs` and `tools/boot.mjs` can exercise
 * the UI code paths that a static check cannot reach.
 */

import { readFileSync } from 'node:fs';

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...names) { for (const n of names) if (n) this.set.add(n); this.sync(); }
  remove(...names) { for (const n of names) this.set.delete(n); this.sync(); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : force;
    if (on) this.set.add(name); else this.set.delete(name);
    this.sync();
    return on;
  }
  contains(name) { return this.set.has(name); }
  sync() { this.node._class = [...this.set].join(' '); }
}

export class TextNode {
  constructor(data) { this.data = String(data); this.textContent = this.data; this.children = []; this.parent = null; }
  find() { return []; }
  text() { return this.data; }
}

export class ShimElement {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this._class = '';
    this.classList = new ClassList(this);
    const styleTarget = {};
    this.style = new Proxy(styleTarget, {
      get: (t, k) => (k === 'setProperty' ? (name, value) => { t[name] = value; } : t[k]),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.draggable = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientWidth = 320;
    this.clientHeight = 200;
    this.width = 320;
    this.height = 200;
    this.id = '';
  }

  get className() { return this._class; }
  set className(value) { this.classList.set = new Set(String(value || '').split(/\s+/).filter(Boolean)); this.classList.sync(); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get childNodes() { return this.children; }
  get textValue() { return this.text(); }

  append(...nodes) { for (const node of nodes.flat(4)) if (node != null && node !== false) this.appendChild(node); }
  appendChild(node) {
    const child = typeof node === 'string' || typeof node === 'number' ? new TextNode(node) : node;
    child.parent = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parent = null; return child; }
  remove() { this.parent?.removeChild(this); }

  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = value; if (name === 'id') this.id = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  /** Dispatch a synthetic event; listeners are called with a plain payload. */
  fire(type, event = {}) {
    const payload = {
      type, target: this, currentTarget: this,
      stopPropagation() {}, preventDefault() {}, ...event,
    };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(payload);
    return payload;
  }
  click() { this.fire('click'); }
  focus() {} select() {} blur() { this.fire('blur'); }
  setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 }; }

  /** Canvas stubs: the app only ever asks for webgpu or 2d. */
  getContext(kind) {
    if (kind === 'webgpu') {
      return {
        configure() {},
        unconfigure() {},
        getCurrentTexture: () => ({ label: 'canvas-texture', createView: () => ({ label: 'canvas-view' }), destroy() {} }),
      };
    }
    return {
      canvas: this,
      imageSmoothingEnabled: true,
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      putImageData() {}, clearRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {},
    };
  }
  toBlob(callback) { callback(new Blob([new Uint8Array(64)], { type: 'image/png' })); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains(node) { return this.children.includes(node); }
  matchMedia() { return { matches: false, addEventListener() {} }; }

  /** Concatenated text of the subtree — used by assertions. */
  text() { return this.children.map((c) => (c instanceof TextNode ? c.data : c.text())).join(' '); }
  find(predicate, out = []) {
    for (const child of this.children) {
      if (child instanceof TextNode) continue;
      if (predicate(child)) out.push(child);
      child.find(predicate, out);
    }
    return out;
  }
}

/**
 * Install the shim on globalThis. Returns a handle with the element registry,
 * the animation-frame queue and helpers for driving frames.
 */
export function installDomShim({ width = 1600, height = 900, html = null } = {}) {
  const registry = new Map();

  /* When an index.html is given, the shim only knows the ids that really exist,
     so a reference to a removed element fails exactly like it would in a
     browser instead of silently inventing a node. */
  if (html) {
    const markup = readFileSync(html, 'utf8');
    for (const match of markup.matchAll(/\bid="([^"]+)"/g)) registry.set(match[1], new ShimElement('div'));
  }

  const elementFor = (id) => {
    if (!registry.has(id)) {
      if (html) return null;
      const node = new ShimElement('div');
      node.id = id;
      registry.set(id, node);
    }
    return registry.get(id);
  };
  // Element ids the app looks up that need canvas behaviour.
  if (registry.has('viewport-canvas')) registry.set('viewport-canvas', new ShimElement('canvas'));
  else if (!html) registry.set('viewport-canvas', new ShimElement('canvas'));

  const frames = [];
  const dom = {
    baseURI: 'https://frontier.local/index.html',
    body: new ShimElement('body'),
    createElement: (tag) => new ShimElement(tag),
    createElementNS: (_ns, tag) => new ShimElement(tag),
    createTextNode: (text) => new TextNode(text),
    getElementById: (id) => elementFor(id),
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  globalThis.Node = ShimElement;
  globalThis.Element = ShimElement;
  globalThis.HTMLElement = ShimElement;
  globalThis.document = dom;
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 2,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: (id) => { frames[id - 1] = null; },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.URL.createObjectURL = () => 'blob:mock';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.GPUTextureUsage = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10 };
  globalThis.GPUBufferUsage = { MAP_READ: 0x01, MAP_WRITE: 0x02, COPY_SRC: 0x04, COPY_DST: 0x08, INDEX: 0x10, VERTEX: 0x20, UNIFORM: 0x40, STORAGE: 0x80, INDIRECT: 0x100, QUERY_RESOLVE: 0x200 };
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  globalThis.GPUMapMode = { READ: 1, WRITE: 2 };

  /* File-backed fetch so the shader library and template scanner work. */
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  globalThis.fetch = async (input) => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const url = new URL(typeof input === 'string' ? input : input.url, dom.baseURI);
    const path = url.pathname.startsWith('/src/') ? join(root, url.pathname.slice(1)) : join(root, url.pathname.replace(/^\//, ''));
    try {
      const text = readFileSync(path, 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
    } catch (error) {
      return { ok: false, status: 404, text: async () => { throw error; } };
    }
  };

  return {
    registry,
    element: elementFor,
    dom,
    /** Run the queued animation frames once (the app's render loop). */
    stepFrames(times = 1) {
      for (let i = 0; i < times; i++) {
        const pending = frames.splice(0, frames.length).filter(Boolean);
        for (const fn of pending) fn(performance.now());
      }
    },
    frameCount() { return frames.length; },
  };
}
