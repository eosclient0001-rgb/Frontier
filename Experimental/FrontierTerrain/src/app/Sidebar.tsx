// Left sidebar (outliner style): project, presets, world, lighting, view and export.
import { Mountain, Download, Upload, Save, Image, Sparkles, RefreshCw, Shuffle } from 'lucide-react';
import { PRESETS, VIEW_MODES } from '../engine/model';
import type { Settings } from '../engine/model';
import { Pills, Slider, ToggleRow } from './ui';

export interface SidebarProps {
  name: string;
  settings: Settings;
  activePreset: string | null;
  viewMode: number;
  showWater: boolean;
  showRivers: boolean;
  autoGen: boolean;
  dirty: boolean;
  status: string;
  gpuInfo: string;
  onName: (v: string) => void;
  onSettings: (patch: Partial<Settings>, coalesce?: string) => void;
  onPreset: (id: string) => void;
  onView: (v: number) => void;
  onWater: (v: boolean) => void;
  onRivers: (v: boolean) => void;
  onAuto: (v: boolean) => void;
  onGenerate: () => void;
  onExportRaw: () => void;
  onExportPng: () => void;
  onSave: () => void;
  onLoad: (f: File) => void;
}

export function Sidebar(p: SidebarProps) {
  const s = p.settings;
  return (
    <aside className="outliner">
      <div className="brand">
        <span className="brand-symbol"><Mountain size={24} strokeWidth={1.6} /></span>
        <span>Frontier<span className="brand-dot">.</span></span>
        <span className="version">TERRAIN · WEBGPU</span>
      </div>

      <div className="scene-label">
        <span>PROJECT</span>
        <span className="status-line"><span className={`status-dot ${p.dirty ? 'warn' : ''}`} />{p.status}</span>
      </div>
      <div className="scene-title">
        <input className="project-name" value={p.name} onChange={(e) => p.onName(e.target.value)} aria-label="Project name" />
      </div>

      <div className="group">
        <div className="group-label">Presets<span className="group-count">{PRESETS.length}</span></div>
        <div className="preset-list">
          {PRESETS.map((pr) => (
            <button
              key={pr.id}
              type="button"
              className={`preset-row ${p.activePreset === pr.id ? 'selected' : ''}`}
              onClick={() => p.onPreset(pr.id)}
            >
              <Sparkles size={14} />
              <span><b>{pr.name}</b><small>{pr.blurb}</small></span>
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <div className="group-label">World<span className="group-count">{s.res}²</span></div>
        <div className="side-block">
          <div className="side-label">Resolution</div>
          <Pills
            options={[512, 1024, 2048].map((r) => ({ id: r, label: String(r) }))}
            value={s.res}
            onChange={(v) => p.onSettings({ res: v })}
          />
          <div className="side-label">Material detail</div>
          <Pills
            options={[1, 2, 4].map((r) => ({ id: r, label: `${r}×` }))}
            value={s.texScale}
            onChange={(v) => p.onSettings({ texScale: v })}
          />
          <div className="spacer-sm" />
          <Slider label="World size" value={s.worldSize} min={1024} max={16384} step={256} unit="m" onChange={(v) => p.onSettings({ worldSize: v }, 'ws')} compact />
          <Slider label="Max height" value={s.maxH} min={200} max={4000} step={10} unit="m" onChange={(v) => p.onSettings({ maxH: v }, 'mh')} compact />
          <Slider label="Sea level" value={s.sea} min={0} max={Math.max(50, s.maxH * 0.6)} step={1} unit="m" onChange={(v) => p.onSettings({ sea: v }, 'sl')} compact />
          <div className="seed-row">
            <span>Seed</span>
            <input
              type="number"
              value={s.seed}
              onChange={(e) => p.onSettings({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) }, 'seed')}
              aria-label="Seed"
            />
            <button type="button" className="icon-btn" title="Random seed" onClick={() => p.onSettings({ seed: Math.floor(Math.random() * 9999) })}>
              <Shuffle size={13} />
            </button>
          </div>
          <ToggleRow label="Auto-generate" on={p.autoGen} onChange={p.onAuto} />
          <button type="button" className={`primary-btn ${p.dirty ? 'pulse' : ''}`} onClick={p.onGenerate}>
            <RefreshCw size={13} /> {p.autoGen ? 'Regenerate' : (p.dirty ? 'Generate changes' : 'Regenerate')}
          </button>
        </div>
      </div>

      <div className="group">
        <div className="group-label">Lighting<span className="group-count">{Math.round(s.sunEl)}°</span></div>
        <div className="side-block">
          <Slider label="Sun azimuth" value={s.sunAz} min={0} max={360} step={1} unit="°" onChange={(v) => p.onSettings({ sunAz: v }, 'az')} compact />
          <Slider label="Sun elevation" value={s.sunEl} min={-5} max={89} step={0.5} unit="°" onChange={(v) => p.onSettings({ sunEl: v }, 'el')} compact />
          <Slider label="Aerosol haze" value={s.haze} min={0} max={6} step={0.05} unit="×" onChange={(v) => p.onSettings({ haze: v }, 'hz')} compact />
          <Slider label="Exposure" value={s.exposure} min={0.2} max={3} step={0.01} unit="×" onChange={(v) => p.onSettings({ exposure: v }, 'ex')} compact />
        </div>
      </div>

      <div className="group">
        <div className="group-label">View<span className="group-count">{VIEW_MODES[p.viewMode]}</span></div>
        <div className="side-block">
          <div className="view-grid">
            {VIEW_MODES.map((m, i) => (
              <button key={m} type="button" className={`pill ${i === p.viewMode ? 'active' : ''}`} onClick={() => p.onView(i)}>{m}</button>
            ))}
          </div>
          <ToggleRow label="Water" on={p.showWater} onChange={p.onWater} />
          <ToggleRow label="Rivers" on={p.showRivers} onChange={p.onRivers} />
        </div>
      </div>

      <div className="group">
        <div className="group-label">Export</div>
        <div className="side-block export-grid">
          <button type="button" className="ghost-btn" onClick={p.onExportRaw}><Download size={13} /> Heightmap R16</button>
          <button type="button" className="ghost-btn" onClick={p.onExportPng}><Image size={13} /> Preview PNG</button>
          <button type="button" className="ghost-btn" onClick={p.onSave}><Save size={13} /> Save project</button>
          <label className="ghost-btn file-btn">
            <Upload size={13} /> Open project
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onLoad(f); e.target.value = ''; }}
            />
          </label>
        </div>
      </div>

      <div className="outliner-bottom">
        <div className="world-icon"><Mountain size={16} /></div>
        <div>
          <strong>{p.gpuInfo}</strong>
          <span>{s.res}×{s.res} · {(s.worldSize / 1000).toFixed(1)} km world</span>
        </div>
      </div>
    </aside>
  );
}
