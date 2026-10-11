/**
 * Frontier Terrain Forge — viewport.
 *
 * Owns the canvas, the navigation, the sculpt/paint brushes and the heads-up
 * controls that sit over the render. Everything that changes what the viewport
 * shows goes through the editor, so the panels stay in sync.
 *
 * Picking runs against a downsampled copy of the height field on the CPU: a
 * 512² readback after each generation is enough to place a brush cursor on the
 * surface, and it keeps the brush independent of the render mesh resolution.
 */
import { el, clear, icon } from './dom.js';
import { invert } from '../core/mat4.js';

const SCULPT_TOOLS = [
  { id: 'raise', label: 'Raise', icon: 'lift', mode: 0 },
  { id: 'lower', label: 'Lower', icon: 'lower', mode: 1 },
  { id: 'smooth', label: 'Smooth', icon: 'smooth', mode: 2 },
  { id: 'flatten', label: 'Flatten', icon: 'flatten', mode: 3 },
  { id: 'dress', label: 'Noise dressing', icon: 'spray', mode: 4 },
  { id: 'carve', label: 'Carve', icon: 'chevronDown', mode: 5 },
  { id: 'terrace', label: 'Terrace', icon: 'strata', mode: 6 },
];

const PAINT_TOOLS = [
  { id: 'paintAdd', label: 'Paint mask', icon: 'brush', mode: 0, target: 'paint' },
  { id: 'paintSub', label: 'Erase mask', icon: 'minus', mode: 1, target: 'paint' },
  { id: 'sketchAdd', label: 'Sketch height', icon: 'lift', mode: 0, target: 'sketch' },
  { id: 'sketchSub', label: 'Erase sketch', icon: 'lower', mode: 1, target: 'sketch' },
];

export function createViewport(editor, app) {
  const canvas = app.refs.canvas;
  const viewport = app.refs.viewport;
  const toolsHost = app.refs.tools;
  const brushBar = app.refs.brushBar;
  const statusDot = app.refs.statusDot;
  const statusText = app.refs.statusText;

  let pointer = null;
  let cursor = null;
  let grid = null;            // { size, data }
  let gridDirty = true;
  let lastDab = 0;
  let rafHandle = 0;
  let lastFrame = 0;
  let frameMs = 16;
  let animating = true;
  let time = 0;
  let lastAnimated = 0;

  /* ------------------------------------------------------------- cursor -- */
  cursor = el('div', {
    class: 'brush-cursor',
    style: { position: 'absolute', pointerEvents: 'none', border: '1px solid #dcdcdc', borderRadius: '50%', opacity: 0, mixBlendMode: 'difference', zIndex: 3 },
  });
  viewport.append(cursor);

  /* --------------------------------------------------------------- HUD -- */
  const toolChip = (label, iconName, on, onClick, title) => {
    const node = el('button', { class: `tool${on ? ' on' : ''}`, title, onclick: onClick },
      el('span', { class: 'dot' }),
      icon(iconName, 13),
      el('span', { text: label }),
    );
    return node;
  };

  function renderTools() {
    clear(toolsHost);
    const display = editor.project.display;
    const chips = [
      ['Shadows', 'sun', display.shadows !== false, () => editor.setDisplay('shadows', display.shadows === false)],
      ['Water', 'water', display.water !== false, () => editor.setDisplay('water', display.water === false)],
      ['Contours', 'waves', !!display.contourLines, () => editor.setDisplay('contourLines', !display.contourLines)],
      ['Slope', 'layers', !!display.slopeOverlay, () => editor.setDisplay('slopeOverlay', !display.slopeOverlay)],
      ['Wireframe', 'grid', !!display.wireframe, () => editor.setDisplay('wireframe', !display.wireframe)],
      ['Live', 'clock', animating, () => { animating = !animating; renderTools(); }],
    ];
    for (const [label, iconName, on, onClick] of chips) toolsHost.append(toolChip(label, iconName, on, () => { onClick(); renderTools(); app.requestRender(); }, label));
  }

  function renderBrushBar() {
    clear(brushBar);
    const brush = editor.project.brush;
    const activeSculpt = brush.target !== 'paint' && brush.target !== 'sketch';
    const tools = activeSculpt ? SCULPT_TOOLS : PAINT_TOOLS;
    for (const tool of tools) {
      brushBar.append(el('button', {
        class: `brush-tool${brush.tool === tool.id ? ' on' : ''}`,
        title: tool.label,
        onclick: () => {
          editor.setBrush({ tool: tool.id, mode: tool.mode, target: tool.target || 'sculpt' });
          editor.brushEnabled = true;
          renderBrushBar();
        },
      }, icon(tool.icon, 15)));
    }
    brushBar.append(el('div', { class: 'brush-sep' }));
    const radius = el('input', { type: 'range', min: 0.005, max: 0.4, step: 0.005, value: brush.radius });
    radius.addEventListener('input', () => editor.setBrush({ radius: Number(radius.value) }));
    const strength = el('input', { type: 'range', min: 0.02, max: 1, step: 0.01, value: brush.strength });
    strength.addEventListener('input', () => editor.setBrush({ strength: Number(strength.value) }));
    brushBar.append(
      el('div', { class: 'brush-field' }, el('label', { text: 'Radius' }), radius),
      el('div', { class: 'brush-field' }, el('label', { text: 'Strength' }), strength),
    );
    brushBar.append(el('div', { class: 'brush-sep' }));
    brushBar.append(el('button', {
      class: `brush-tool${editor.brushEnabled ? ' on' : ''}`,
      title: editor.brushEnabled ? 'Brush mode on — camera orbit is on the right mouse button' : 'Brush mode off',
      onclick: () => { editor.brushEnabled = !editor.brushEnabled; renderBrushBar(); },
    }, icon('pick', 15)));
  }

  editor.on('brush', renderBrushBar);

  /* ---------------------------------------------------------- picking -- */
  async function refreshGrid() {
    if (!app.graph?.fields?.height) return;
    try {
      const size = 512;
      const target = app.gpu.field({ width: size, height: size, format: 'r32float', label: 'pick-grid' });
      const encoder = app.gpu.device.createCommandEncoder({ label: 'pick-grid' });
      app.graph.runDownsample(encoder, app.graph.fields.height, target);
      app.gpu.device.queue.submit([encoder.finish()]);
      const bytesPerRow = size * 4;
      const buffer = app.gpu.device.createBuffer({ size: bytesPerRow * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const copy = app.gpu.device.createCommandEncoder({ label: 'pick-readback' });
      copy.copyTextureToBuffer({ texture: target.texture, origin: { x: 0, y: 0 } }, { buffer, bytesPerRow, rowsPerImage: size }, { width: size, height: size, depthOrArrayLayers: 1 });
      app.gpu.device.queue.submit([copy.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      grid = { size, data: new Float32Array(buffer.getMappedRange().slice(0)) };
      buffer.unmap();
      buffer.destroy();
      app.gpu.release(target);
      app.gpu.clearCaches();
      gridDirty = false;
    } catch (error) {
      editor.log('warn', `picking grid unavailable: ${error.message}`);
    }
  }

  const sampleHeight = (u, v) => {
    if (!grid) return 0;
    const size = grid.size;
    const x = Math.min(size - 1, Math.max(0, u * size - 0.5));
    const y = Math.min(size - 1, Math.max(0, v * size - 0.5));
    const x0 = Math.floor(x); const y0 = Math.floor(y);
    const x1 = Math.min(size - 1, x0 + 1); const y1 = Math.min(size - 1, y0 + 1);
    const fx = x - x0; const fy = y - y0;
    const a = grid.data[y0 * size + x0] * (1 - fx) + grid.data[y0 * size + x1] * fx;
    const b = grid.data[y1 * size + x0] * (1 - fx) + grid.data[y1 * size + x1] * fx;
    return a * (1 - fy) + b * fy;
  };

  /** Undo the view-projection for a clip-space point (w division included). */
  function unproject(inverse, ndc) {
    const x = inverse[0] * ndc[0] + inverse[4] * ndc[1] + inverse[8] * ndc[2] + inverse[12];
    const y = inverse[1] * ndc[0] + inverse[5] * ndc[1] + inverse[9] * ndc[2] + inverse[13];
    const z = inverse[2] * ndc[0] + inverse[6] * ndc[1] + inverse[10] * ndc[2] + inverse[14];
    const w = inverse[3] * ndc[0] + inverse[7] * ndc[1] + inverse[11] * ndc[2] + inverse[15] || 1;
    return [x / w, y / w, z / w];
  }

  /** March the camera ray against the height field and return the hit point. */
  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const world = editor.project.world;
    const inverse = invert(app.camera.matrices(app.renderer.aspect, world).viewProj);
    const near = unproject(inverse, [ndcX, ndcY, 0]);
    const far = unproject(inverse, [ndcX, ndcY, 1]);
    const dir = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir[0] /= len; dir[1] /= len; dir[2] /= len;

    const maxDistance = world.worldSize * 4;
    const steps = 220;
    let previous = null;
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * maxDistance;
      const point = [near[0] + dir[0] * t, near[1] + dir[1] * t, near[2] + dir[2] * t];
      const u = point[0] / world.worldSize + 0.5;
      const v = point[2] / world.worldSize + 0.5;
      if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) { previous = point; continue; }
      const surface = sampleHeight(u, v) * world.heightScale;
      if (point[1] <= surface && previous) {
        // bisect between the last two samples for a clean hit
        let lo = previous; let hi = point;
        for (let k = 0; k < 12; k++) {
          const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
          const mu = mid[0] / world.worldSize + 0.5;
          const mv = mid[2] / world.worldSize + 0.5;
          const ms = sampleHeight(mu, mv) * world.heightScale;
          if (mid[1] <= ms) hi = mid; else lo = mid;
        }
        const hit = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        return { point: hit, uv: [hit[0] / world.worldSize + 0.5, hit[2] / world.worldSize + 0.5] };
      }
      previous = point;
    }
    return null;
  }

  /* ------------------------------------------------------------- input -- */
  const pointerState = { mode: null, lastX: 0, lastY: 0, button: 0, active: false, stroke: null };

  const updateCursor = (hit, brush) => {
    if (!hit || !editor.brushEnabled) { cursor.style.opacity = '0'; return; }
    const rect = canvas.getBoundingClientRect();
    const world = editor.project.world;
    const distance = Math.hypot(hit.point[0] - app.camera.position[0], hit.point[1] - app.camera.position[1], hit.point[2] - app.camera.position[2]);
    const radius = brush.radius * world.worldSize;
    const screen = (radius / Math.max(distance, 1)) * (rect.height / (2 * Math.tan(app.camera.fov / 2)));
    const projected = project(hit.point);
    if (!projected) { cursor.style.opacity = '0'; return; }
    cursor.style.opacity = '0.9';
    cursor.style.left = `${projected[0] - screen}px`;
    cursor.style.top = `${projected[1] - screen}px`;
    cursor.style.width = `${screen * 2}px`;
    cursor.style.height = `${screen * 2}px`;
  };

  function project(point) {
    const world = editor.project.world;
    const { viewProj } = app.camera.matrices(app.renderer.aspect, world);
    const clipX = viewProj[0] * point[0] + viewProj[4] * point[1] + viewProj[8] * point[2] + viewProj[12];
    const clipY = viewProj[1] * point[0] + viewProj[5] * point[1] + viewProj[9] * point[2] + viewProj[13];
    const clipW = viewProj[3] * point[0] + viewProj[7] * point[1] + viewProj[11] * point[2] + viewProj[15];
    if (clipW <= 1e-4) return null;
    const rect = canvas.getBoundingClientRect();
    return [((clipX / clipW) * 0.5 + 0.5) * rect.width, (0.5 - (clipY / clipW) * 0.5) * rect.height];
  }

  function dab(hit) {
    const brush = editor.project.brush;
    if (!hit || !app.graph) return;
    const spread = editor.project.world.worldSize * 0.0006;
    const jitter = () => (Math.random() - 0.5) * spread;
    const params = {
      center: [hit.uv[0] + jitter(), hit.uv[1] + jitter()],
      radius: brush.radius,
      strength: brush.strength,
      falloff: brush.falloff,
      spacing: brush.spacing,
      mode: brush.mode ?? 0,
      noiseScale: 3,
      seed: Math.random(),
    };
    if (brush.target === 'paint' || brush.target === 'sketch') {
      app.graph.paintDab({ ...params, target: brush.target, value: brush.target === 'sketch' ? brush.strength : 1 });
    } else {
      app.graph.sculptDab(params);
    }
    app.markMapsDirty();
    app.requestRender();
  }

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointerState.active = true;
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    pointerState.button = event.button;
    const wantsBrush = editor.brushEnabled && event.button === 0 && !event.shiftKey;
    if (wantsBrush) {
      const hit = pick(event.clientX, event.clientY);
      pointerState.mode = 'brush';
      pointerState.stroke = { last: 0 };
      dab(hit);
    } else if (event.button === 1 || event.shiftKey || event.button === 2) {
      pointerState.mode = 'pan';
    } else {
      pointerState.mode = 'orbit';
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    const dx = event.clientX - pointerState.lastX;
    const dy = event.clientY - pointerState.lastY;
    if (!pointerState.active) {
      const hit = pick(event.clientX, event.clientY);
      updateCursor(hit, editor.project.brush);
      app.__lastHit = hit;
      return;
    }
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    if (pointerState.mode === 'orbit') {
      app.camera.orbit(dx * 0.006, -dy * 0.006);
      app.requestRender();
    } else if (pointerState.mode === 'pan') {
      app.camera.pan(dx * 0.0016, dy * 0.0016, app.renderer.aspect);
      app.requestRender();
    } else if (pointerState.mode === 'brush') {
      const hit = pick(event.clientX, event.clientY);
      updateCursor(hit, editor.project.brush);
      const now = performance.now();
      const spacing = Math.max(4, editor.project.brush.spacing * editor.project.brush.radius * 900);
      if (hit && now - pointerState.stroke.last > spacing) {
        pointerState.stroke.last = now;
        dab(hit);
      }
    }
  });

  const endPointer = (event) => {
    if (!pointerState.active) return;
    const mode = pointerState.mode;
    pointerState.active = false;
    pointerState.mode = null;
    if (mode === 'brush') {
      app.graph?.commitStroke();
      app.markMapsDirty();
      app.regenerate('texture');
    }
    void event;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { cursor.style.opacity = '0'; });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0012);
    app.camera.zoom(factor);
    app.requestRender();
    const hit = pick(event.clientX, event.clientY);
    updateCursor(hit, editor.project.brush);
  }, { passive: false });

  /* ------------------------------------------------------------ status -- */
  const setStatus = (text, state = '') => {
    statusText.textContent = text;
    statusDot.className = `status-dot${state ? ` ${state}` : ''}`;
  };

  /* --------------------------------------------------------- lifecycle -- */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const changed = app.renderer.resize(rect.width, rect.height, ratio);
    if (changed) app.requestRender();
    if (gridDirty) refreshGrid();
  }

  const observer = new ResizeObserver(() => { resize(); });
  observer.observe(viewport);
  window.addEventListener('resize', resize);

  editor.on('generated', () => { gridDirty = true; refreshGrid(); });

  function frame(now) {
    rafHandle = requestAnimationFrame(frame);
    const elapsed = now - lastFrame;
    lastFrame = now;
    frameMs = frameMs * 0.9 + elapsed * 0.1;
    // Animated frames are capped so a 144 Hz display does not render four times
    // the work of a 60 Hz one; interaction always renders immediately.
    const animateDue = animating && now - lastAnimated > 40 && frameMs < 26;
    if (app.needsRender || animateDue) {
      const start = performance.now();
      time += Math.min(elapsed, 60) / 1000;
      app.tick?.();
      app.renderer.render({ project: editor.project, camera: app.camera, time });
      app.needsRender = false;
      app.lastFrameMs = performance.now() - start;
      lastAnimated = now;
      app.onFrame?.(app.lastFrameMs);
    }
  }
  rafHandle = requestAnimationFrame(frame);

  renderTools();
  renderBrushBar();
  resize();
  setStatus('ready', 'ok');

  return {
    resize,
    setStatus,
    refreshGrid,
    renderTools,
    renderBrushBar,
    get animating() { return animating; },
    get time() { return time; },
    get frameMs() { return frameMs; },
    stop() { cancelAnimationFrame(rafHandle); observer.disconnect(); },
    pick,
  };
}
