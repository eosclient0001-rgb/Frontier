// Central WebGPU viewport: orbit / pan / zoom camera, render loop and HUD.
import { useEffect, useRef } from 'react';
import type { Engine, CamState, ViewFlags } from '../engine/engine';
import type { Settings } from '../engine/model';
import type { RefObject } from 'react';

export interface ViewportProps {
  canvasRef: RefObject<HTMLCanvasElement>;
  engine: Engine | null;
  camRef: RefObject<CamState>;
  settingsRef: RefObject<Settings>;
  flagsRef: RefObject<ViewFlags>;
  statusText: string;
  renderKey: unknown;
  busy: boolean;
  error: string | null;
  viewLabel: string;
  modeLabel: string;
  onResetView: () => void;
}

export function Viewport(p: ViewportProps) {
  const canvasRef = p.canvasRef;
  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null);
  const activity = useRef(0);

  // Any change to the project or the engine's data marks the view as active,
  // so it renders at full rate briefly; otherwise it idles at ~2 fps (water motion).
  useEffect(() => { activity.current = performance.now(); }, [p.renderKey, p.busy, p.engine]);

  // Keep the drawing buffer in step with the element's CSS size.
  useEffect(() => {
    const cv = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(64, Math.round(cv.clientWidth * dpr));
      cv.height = Math.max(64, Math.round(cv.clientHeight * dpr));
    });
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  // Render loop (water animates, so this runs continuously once the engine is ready).
  useEffect(() => {
    if (!p.engine) return;
    const t0 = performance.now();
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      // Active: up to ~30 fps. Idle: ~2 fps. The engine also skips a frame while the previous one is still executing.
      const active = now - activity.current < 700;
      if ((active && now - last >= 33) || now - last >= 500) {
        last = now;
        p.engine!.render(p.camRef.current!, p.settingsRef.current!, p.flagsRef.current!, (performance.now() - t0) / 1000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [p.engine, p.camRef, p.settingsRef, p.flagsRef]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    activity.current = performance.now();
    drag.current = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    activity.current = performance.now();
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    const cam = p.camRef.current!;
    if (d.pan) {
      const s = cam.dist * 0.0016;
      cam.target = [
        cam.target[0] - Math.cos(cam.yaw) * dx * s + Math.sin(cam.yaw) * dy * s,
        cam.target[1],
        cam.target[2] + Math.sin(cam.yaw) * dx * s + Math.cos(cam.yaw) * dy * s,
      ];
    } else {
      cam.yaw -= dx * 0.005;
      cam.pitch = Math.min(1.5, Math.max(0.04, cam.pitch + dy * 0.004));
    }
  };
  const onPointerUp = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    const cam = p.camRef.current!;
    activity.current = performance.now();
    cam.dist = Math.min(90000, Math.max(120, cam.dist * Math.exp(e.deltaY * 0.0012)));
  };

  return (
    <div className="viewport">
      <canvas
        ref={canvasRef}
        className="gpu-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="vp-top">
        <div className="vp-title">
          <span className="status-dot" />
          {p.viewLabel}
        </div>
        <div className="vp-actions">
          <span className="hint">Orbit · drag &nbsp;|&nbsp; Pan · shift/right-drag &nbsp;|&nbsp; Zoom · wheel</span>
          <button className="small-btn" onClick={p.onResetView} type="button">Reset view</button>
        </div>
      </div>
      {p.error && (
        <div className="vp-error">
          <strong>Engine error</strong>
          <pre>{p.error}</pre>
        </div>
      )}
      {!p.engine && !p.error && <div className="vp-loading">Initialising WebGPU…</div>}
      <div className="vp-bottom">
        <span>{p.statusText}</span>
        <span>{p.modeLabel}</span>
      </div>
    </div>
  );
}
