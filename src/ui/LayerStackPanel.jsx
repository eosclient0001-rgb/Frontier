import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import { MaterialChip } from './graphics.jsx';
import { TERRAIN_OPS, OP_GROUPS, OP_LIST, MASK_MODES, BLEND_MODES } from '../engine/terrain-schema.js';
import { materialByKey, TEX_MASK_MODES, MATERIALS, MATERIAL_GROUPS } from '../engine/texture-schema.js';

function TerrainRow({ layer, selected, onSelect, onToggle, onDragStart, onDragOver, onDrop, dropPos }) {
  const op = TERRAIN_OPS[layer.kind];
  const mask = MASK_MODES.find((m) => m.id === layer.maskMode);
  const accent = op?.accent ?? '#a0a0a0';
  return (
    <div
      className={`layer-row${selected ? ' selected' : ''}${layer.enabled ? '' : ' disabled'}${
        dropPos ? ` drop-${dropPos}` : ''
      }`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(layer.id); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(layer.id, e); }}
      onDrop={(e) => { e.preventDefault(); onDrop(layer.id); }}
      onDragEnd={() => onDragOver(null)}
      onClick={() => onSelect(layer.id)}
    >
      <span className="grip"><Icon name="GripVertical" size={13} /></span>
      <button
        className={`layer-eye${layer.enabled ? '' : ' off'}`}
        onClick={(e) => { e.stopPropagation(); onToggle(layer.id); }}
        aria-label={layer.enabled ? 'Hide layer' : 'Show layer'}
      >
        <Icon name={layer.enabled ? 'Eye' : 'EyeOff'} size={14} />
      </button>
      <div className="layer-swatch" style={{
        background: `linear-gradient(140deg, ${accent}cc, ${accent}44)`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12)',
      }} />
      <div className="layer-body">
        <div className="layer-name">{layer.name}</div>
        <div className="layer-kind">{op?.label ?? layer.kind}</div>
      </div>
      {layer.maskMode !== 0 && <span className="layer-chip">{mask?.label}</span>}
    </div>
  );
}

function TextureRow({ layer, selected, onSelect, onToggle, onDragStart, onDragOver, onDrop, dropPos }) {
  const mask = TEX_MASK_MODES.find((m) => m.id === layer.maskMode);
  return (
    <div
      className={`layer-row${selected ? ' selected' : ''}${layer.enabled ? '' : ' disabled'}${
        dropPos ? ` drop-${dropPos}` : ''
      }`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(layer.id); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(layer.id, e); }}
      onDrop={(e) => { e.preventDefault(); onDrop(layer.id); }}
      onDragEnd={() => onDragOver(null)}
      onClick={() => onSelect(layer.id)}
    >
      <span className="grip"><Icon name="GripVertical" size={13} /></span>
      <button
        className={`layer-eye${layer.enabled ? '' : ' off'}`}
        onClick={(e) => { e.stopPropagation(); onToggle(layer.id); }}
        aria-label={layer.enabled ? 'Hide layer' : 'Show layer'}
      >
        <Icon name={layer.enabled ? 'Eye' : 'EyeOff'} size={14} />
      </button>
      <MaterialChip a={layer.albedoA} b={layer.albedoB} rough={layer.roughness} />
      <div className="layer-body">
        <div className="layer-name">{layer.name}</div>
        <div className="layer-kind">{materialByKey(layer.kind).label}</div>
      </div>
      {layer.maskMode !== 0 && <span className="layer-chip">{mask?.label}</span>}
    </div>
  );
}

function AddMenu({ onPick, onClose }) {
  return (
    <div style={{ padding: '2px 8px 10px' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#7c7c7c', margin: '4px 4px 8px' }}>
        Add operator
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {OP_GROUPS.map((group) => {
          const items = OP_LIST.filter((o) => o.group === group);
          if (!items.length) return null;
          return (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9.5, color: '#636363', padding: '0 6px 5px' }}>{group}</div>
              {items.map((op) => (
                <button
                  key={op.key}
                  className="pill"
                  style={{ width: '100%', textAlign: 'left', borderRadius: 7, display: 'flex', gap: 8, marginBottom: 2 }}
                  onClick={() => { onPick(op.key); onClose(); }}
                >
                  <Icon name={op.icon} size={13} style={{ color: op.accent }} />
                  {op.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddMaterialMenu({ onPick, onClose }) {
  return (
    <div style={{ padding: '2px 8px 10px' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#7c7c7c', margin: '4px 4px 8px' }}>
        Add material
      </div>
      {MATERIAL_GROUPS.map((group) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9.5, color: '#636363', padding: '0 6px 5px' }}>{group}</div>
          {MATERIALS.filter((m) => m.group === group).map((m) => (
            <button
              key={m.key}
              className="pill"
              style={{ width: '100%', textAlign: 'left', borderRadius: 7, display: 'flex', gap: 8, marginBottom: 2 }}
              onClick={() => { onPick(m.key); onClose(); }}
            >
              <MaterialChip a={m.a} b={m.bb} rough={m.rough} size={16} />
              {m.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function LayerStackPanel({
  tab, onTab, terrainLayers, textureLayers,
  selectedTerrain, selectedTexture,
  onSelectTerrain, onSelectTexture,
  onToggleTerrain, onToggleTexture,
  onAddTerrain, onAddTexture,
  onReorderTerrain, onReorderTexture,
  onDuplicate, onDelete,
}) {
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);

  const isTerrain = tab === 'terrain';
  const layers = isTerrain ? terrainLayers : textureLayers;
  const selectedId = isTerrain ? selectedTerrain : selectedTexture;

  const handleOver = (id, e) => {
    if (!id || !drag || id === drag) { setOver(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setOver({ id, pos: after ? 'after' : 'before' });
  };

  const handleDrop = (id) => {
    if (!drag || !id || drag === id) { setDrag(null); setOver(null); return; }
    const from = layers.findIndex((l) => l.id === drag);
    let to = layers.findIndex((l) => l.id === id);
    if (over?.pos === 'after') to += 1;
    const next = layers.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, moved);
    (isTerrain ? onReorderTerrain : onReorderTexture)(next);
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="stack" style={{ flex: '0 0 auto' }}>
      <div className="side-tabs">
        <button className={`side-tab${isTerrain ? ' active' : ''}`} onClick={() => { onTab('terrain'); setAdding(false); }}>
          <Icon name="Mountain" size={14} /> Terrain Stack
          <span className="tally">{terrainLayers.length}</span>
        </button>
        <button className={`side-tab${!isTerrain ? ' active' : ''}`} onClick={() => { onTab('texture'); setAdding(false); }}>
          <Icon name="Palette" size={14} /> Texture Stack
          <span className="tally">{textureLayers.length}</span>
        </button>
      </div>

      <div className="stack-head">
        <h3>{isTerrain ? 'Build order' : 'Paint order'}</h3>
        <span className="spacer" />
        <div className="stack-tools">
          <button onClick={() => setAdding(!adding)} title="Add layer" aria-label="Add layer">
            <Icon name={adding ? 'ChevronDown' : 'Plus'} size={15} />
          </button>
          <button onClick={onDuplicate} disabled={!selectedId} title="Duplicate" aria-label="Duplicate layer"
            style={selectedId ? undefined : { opacity: 0.35, pointerEvents: 'none' }}>
            <Icon name="Copy" size={14} />
          </button>
          <button onClick={onDelete} disabled={!selectedId} title="Delete" aria-label="Delete layer"
            style={selectedId ? undefined : { opacity: 0.35, pointerEvents: 'none' }}>
            <Icon name="Trash2" size={14} />
          </button>
        </div>
      </div>

      {adding && (
        isTerrain
          ? <AddMenu onPick={onAddTerrain} onClose={() => setAdding(false)} />
          : <AddMaterialMenu onPick={onAddTexture} onClose={() => setAdding(false)} />
      )}

      <div
        className="stack-list"
        onClick={(e) => { if (e.target === e.currentTarget) (isTerrain ? onSelectTerrain : onSelectTexture)(null); }}
      >
        {layers.length === 0 && (
          <div className="stack-empty">
            No layers yet.<br />
            {isTerrain
              ? 'Add a Fractal Terrain operator to raise the first mountains.'
              : 'Add a material — the bottom-most layer covers everything.'}
          </div>
        )}
        {isTerrain
          ? layers.map((l) => (
            <TerrainRow
              key={l.id}
              layer={l}
              selected={l.id === selectedId}
              onSelect={onSelectTerrain}
              onToggle={onToggleTerrain}
              onDragStart={setDrag}
              onDragOver={handleOver}
              onDrop={handleDrop}
              dropPos={over?.id === l.id ? over.pos : null}
            />
          ))
          : layers.map((l) => (
            <TextureRow
              key={l.id}
              layer={l}
              selected={l.id === selectedId}
              onSelect={onSelectTexture}
              onToggle={onToggleTexture}
              onDragStart={setDrag}
              onDragOver={handleOver}
              onDrop={handleDrop}
              dropPos={over?.id === l.id ? over.pos : null}
            />
          ))}
      </div>
    </div>
  );
}
