import React from 'react';
import { Icon } from './icons.jsx';
import { TERRAIN_OPS } from '../engine/terrain-schema.js';

export const OBJECTS = [
  { id: 'terrain', label: 'Terrain', icon: 'Mountain' },
  { id: 'textures', label: 'Texturing', icon: 'Palette' },
  { id: 'sun', label: 'Sun & Sky', icon: 'Sun' },
  { id: 'water', label: 'Water', icon: 'Waves' },
  { id: 'render', label: 'Render', icon: 'Camera' },
];

export const TOOLS = [
  { id: 'presets', label: 'Presets', icon: 'Sparkles' },
  { id: 'export', label: 'Export', icon: 'FileDown' },
];

export default function Rail({ object, onObject, stack, textures, building, gpu, onUndo, onRedo, canUndo, canRedo }) {
  const active = [...OBJECTS, ...TOOLS].find((o) => o.id === object);
  const enabledOps = stack.filter((l) => l.enabled && TERRAIN_OPS[l.kind]).length;

  return (
    <div className="rail">
      <div className="brand">
        <span className="brand-symbol"><Icon name="Mountain" size={22} strokeWidth={1.4} /></span>
        Frontier<span className="brand-dot">.</span>terrain
        <span className="brand-version">v1</span>
      </div>

      <div className="project-label">
        <span>PROJECT</span>
        <span className={`status-dot${building ? ' busy' : ''}`} />
      </div>
      <div className="project-title">
        untitled<small>{building ? 'building' : 'ready'}</small>
      </div>

      <div className="rail-heading">
        <h2>Objects<span>{enabledOps}</span></h2>
      </div>

      <div className="group">
        {OBJECTS.map((o) => (
          <div key={o.id} className={`node-row${object === o.id ? ' selected' : ''}`}>
            <button className="node-button" onClick={() => onObject(o.id)}>
              <Icon name={o.icon} size={16} />
              <span>{o.label}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="group-label"><Icon name="Settings2" size={13} /> Tools</div>
      <div className="group">
        {TOOLS.map((o) => (
          <div key={o.id} className={`node-row${object === o.id ? ' selected' : ''}`}>
            <button className="node-button" onClick={() => onObject(o.id)}>
              <Icon name={o.icon} size={16} />
              <span>{o.label}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="rail-foot">
        <div className="group-label" style={{ paddingBottom: 6 }}>
          <Icon name="RotateCcw" size={13} /> History
        </div>
        <div className="btn-row" style={{ padding: '0 4px' }}>
          <button className="btn ghost" disabled={!canUndo} onClick={onUndo}
            style={canUndo ? undefined : { opacity: 0.35, pointerEvents: 'none' }}>
            <Icon name="RotateCcw" size={13} /> Undo
          </button>
          <button className="btn ghost" disabled={!canRedo} onClick={onRedo}
            style={canRedo ? undefined : { opacity: 0.35, pointerEvents: 'none' }}>
            <Icon name="RefreshCw" size={13} /> Redo
          </button>
        </div>
        <div className="gpu-line">
          <b>{gpu?.vendor ?? 'WebGPU'}</b>{gpu?.architecture ? ` · ${gpu.architecture}` : ''}
          <br />
          {(textures.length)} texture layers · {stack.length} terrain layers
          <br />
          <span className="kbd">⌘Z</span> undo · <span className="kbd">F</span> frame · <span className="kbd">WASD</span> fly
        </div>
      </div>
    </div>
  );
}
