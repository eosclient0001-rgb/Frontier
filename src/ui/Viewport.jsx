import React from 'react';
import { Icon } from './icons.jsx';

const VIEW_LABELS = ['Shaded', 'Height', 'Slope', 'Normal', 'AO', 'Curvature', 'Flow', 'Rough', 'Albedo'];

export default function Viewport({
  canvasRef, stageRef, status, build, stats, fps, autoBuild,
  onToggleAuto, onRebuild, onFrame, onViewMode, viewMode,
}) {
  const pct = Math.round((build.progress ?? 0) * 100);
  return (
    <div className="stage" ref={stageRef}>
      <canvas ref={canvasRef} tabIndex={0} />

      {status.phase === 'ready' && (
        <div className="hud-top">
          <div className="hud-group">
            <button className={`hud-button${autoBuild ? ' on' : ''}`} onClick={onToggleAuto}>
              <Icon name="Zap" size={13} /> Auto build
            </button>
            <button className="hud-button" onClick={onRebuild} disabled={build.busy}>
              <Icon name={build.busy ? 'Pause' : 'Play'} size={13} /> {build.busy ? 'Building' : 'Build'}
            </button>
            <button className="hud-button" onClick={onFrame}>
              <Icon name="Search" size={13} /> Frame
            </button>
          </div>
          <div className="hud-spacer" />
          <div className="hud-group">
            {VIEW_LABELS.map((label, i) => (
              <button key={label} className={`hud-button${viewMode === i ? ' on' : ''}`} onClick={() => onViewMode(i)}>
                {label}
              </button>
            ))}
          </div>
          <div className="hud-spacer" />
          <div className="hud-stat">
            <span><b>{fps}</b> fps</span>
            <span><b>{stats.terrainLayers}</b> ops</span>
            <span><b>{stats.passes}</b> passes</span>
            <span><b>{(stats.triangles / 1000).toFixed(0)}k</b> tris</span>
          </div>
        </div>
      )}

      {(build.busy || build.flash) && (
        <div className={`build-bar show${build.busy ? '' : ' done'}`}>
          <Icon name={build.busy ? 'RefreshCw' : 'Circle'} size={13} />
          <span>{build.busy ? (build.label ?? 'Solving') : 'Up to date'}</span>
          <div className="build-track"><div className="build-fill" style={{ width: `${pct}%` }} /></div>
          <span>{pct}%</span>
        </div>
      )}

      {status.phase === 'error' && (
        <div className="viewport-fallback">
          <div>
            <Icon name="Triangle" size={28} color="#8a8a8a" />
            <h3>WebGPU could not start</h3>
            <p>{status.message}</p>
            <p style={{ marginTop: 12 }}>
              This generator runs the erosion solver and the sky integrator on the GPU through WebGPU —
              there is no reduced mode. Chrome 113+, Edge 113+ and Safari 18 all ship it; on Linux you may
              need to enable <code>vulkan</code> support.
            </p>
          </div>
        </div>
      )}

      {status.phase === 'booting' && (
        <div className="viewport-fallback">
          <div>
            <h3 style={{ marginTop: 0 }}>Starting GPU</h3>
            <p>Requesting adapter and compiling pipelines…</p>
          </div>
        </div>
      )}
    </div>
  );
}
