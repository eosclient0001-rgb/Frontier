/**
 * Minimal DOM shim so the model can be built and measured headlessly in Node.
 * Only what three.js + the procedural texture generators actually touch.
 */

function makeCanvas() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const ctx = {
    canvas: null,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    getImageData: (x, y, w, h) => ({
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
      width: w,
      height: h,
    }),
    putImageData: noop,
    drawImage: noop,
  };
  const canvas = {
    width: 1,
    height: 1,
    style: {},
    nodeType: 1,
    getContext: () => ctx,
    addEventListener: noop,
    removeEventListener: noop,
    toDataURL: () => '',
    setAttribute: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
    clientWidth: 1,
    clientHeight: 1,
  };
  ctx.canvas = canvas;
  return canvas;
}

export function installDomShim() {
  if (globalThis.document?.__shimmed) return;
  const listeners = {};
  const doc = {
    __shimmed: true,
    createElement: (tag) => {
      if (tag === 'canvas') return makeCanvas();
      const el = {
        nodeType: 1,
        style: {},
        children: [],
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        dataset: {},
        addEventListener() {},
        removeEventListener() {},
        appendChild(c) {
          this.children.push(c);
          return c;
        },
        setAttribute() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
      };
      return el;
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    body: { classList: { add() {}, remove() {}, toggle() {} } },
  };
  globalThis.document = doc;
  globalThis.window = globalThis.window ?? {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
    document: doc,
    requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 16),
  };
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  }
  globalThis.self = globalThis.self ?? globalThis;
  globalThis.requestAnimationFrame =
    globalThis.requestAnimationFrame ?? ((cb) => setTimeout(() => cb(performance.now()), 16));
  return listeners;
}
