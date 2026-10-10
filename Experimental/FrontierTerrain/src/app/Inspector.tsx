// Inspector cards for the selected generation or texture layer, plus the
// terrain analysis panel (height and slope histograms) shown when nothing is selected.
import type { ReactNode } from 'react';
import { Mountain, Layers, Sun, Waves, Droplets, Sparkles, Palette, Scan, Activity, Wind, Filter } from 'lucide-react';
import {
  KINDS, BLENDS, MASK_RANGE, MATERIALS,
} from '../engine/model';
import type { GenLayer, TexLayer, Settings, Mask, Param } from '../engine/model';
import { Card, Metric, Pills, Slider, Toggle, SectionLabel } from './ui';

const CARD_ICON: Record<string, ReactNode> = {
  Pattern: <Mountain size={16} />, Fractal: <Layers size={16} />, 'Domain warp': <Waves size={16} />,
  Output: <Sun size={16} />, 'Cell structure': <Layers size={16} />, 'Land mass': <Mountain size={16} />,
  Coastline: <Waves size={16} />, Benches: <Layers size={16} />, Levels: <Sun size={16} />, Response: <Sparkles size={16} />,
  Relaxation: <Droplets size={16} />, Talus: <Mountain size={16} />, Run: <Activity size={16} />,
  Rainfall: <Droplets size={16} />, Transport: <Wind size={16} />, 'Erosion & deposition': <Waves size={16} />,
  Channels: <Droplets size={16} />,
};

type GenMutate = (l: GenLayer) => GenLayer;
type TexMutate = (l: TexLayer) => TexLayer;

function fmtParam(p: Param, v: number): string {
  if (p.step >= 1) return String(Math.round(v));
  return v.toFixed(String(p.step).split('.')[1]?.length ?? 2);
}

export function GenInspector(props: {
  layer: GenLayer; thumb?: string; settings: Settings;
  onChange: (fn: GenMutate, coalesce?: string) => void;
}) {
  const { layer: L, onChange } = props;
  const spec = KINDS[L.kind];
  const setP = (key: string, v: number, commit = false) =>
    onChange((l) => ({ ...l, params: { ...l.params, [key]: v } }), commit ? undefined : `gp:${L.id}:${key}`);
  const setMask = (patch: Partial<Mask>) =>
    onChange((l) => ({ ...l, mask: { ...l.mask, ...patch } }));
  const range = MASK_RANGE[L.mask.kind];
  const pmap = Object.fromEntries(spec.params.map((p) => [p.key, p]));

  return (
    <>
      <div className="hero-row">
        <div>
          <div className="eyebrow">{spec.group.toUpperCase()} · {spec.name.toUpperCase()}</div>
          <input
            className="name-input"
            value={L.name}
            onChange={(e) => onChange((l) => ({ ...l, name: e.target.value }), `gn:${L.id}`)}
            aria-label="Layer name"
          />
          <p className="muted lede">{spec.blurb}</p>
        </div>
        <div className="hero-toggle">
          <span>Enabled</span>
          <Toggle on={L.enabled} onChange={(v) => onChange((l) => ({ ...l, enabled: v }))} label="Enabled" />
        </div>
      </div>

      <div className="cards">
        <Card title="Blend" icon={<Filter size={16} />} wide>
          <Pills
            options={BLENDS.map((b) => ({ id: b.id, label: b.label }))}
            value={L.blend}
            onChange={(v) => onChange((l) => ({ ...l, blend: v }))}
            wrap
          />
          <div className="spacer" />
          <Slider
            label="Opacity"
            value={L.opacity * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => onChange((l) => ({ ...l, opacity: v / 100 }), `go:${L.id}`)}
          />
        </Card>

        {spec.cards.map((c) => {
          const first = pmap[c.keys[0]];
          const firstVal = L.params[c.keys[0]];
          const showMetric = first && !first.options;
          return (
            <Card key={c.title} title={c.title} icon={CARD_ICON[c.title] ?? <Scan size={16} />} className={c.keys.length > 2 ? 'wide-card' : ''}>
              {showMetric && (
                <Metric
                  value={fmtParam(first, firstVal)}
                  unit={first.unit}
                  caption={first.help}
                />
              )}
              {c.keys.map((k) => {
                const p = pmap[k];
                if (!p) return null;
                if (p.options) {
                  return (
                    <div key={k} className="control-block">
                      <div className="control-line"><span>{p.label}</span><span>{p.options[Math.round(L.params[k])]}</span></div>
                      <Pills
                        options={p.options.map((o, i) => ({ id: i, label: o }))}
                        value={Math.round(L.params[k])}
                        onChange={(v) => setP(k, v, true)}
                        wrap
                      />
                    </div>
                  );
                }
                return (
                  <div key={k} className="control-block">
                    <Slider
                      label={p.label}
                      value={L.params[k]}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      unit={p.unit}
                      hint={p.help}
                      onChange={(v) => setP(k, v)}
                      onCommit={() => setP(k, L.params[k], true)}
                    />
                  </div>
                );
              })}
            </Card>
          );
        })}

        <Card title="Mask" icon={<Palette size={16} />} right={<span className="small-pill">{L.mask.kind === 'none' ? 'Off' : L.mask.kind}</span>} wide>
          <Pills
            options={[
              { id: 'none' as const, label: 'None' },
              { id: 'height' as const, label: 'Altitude' },
              { id: 'slope' as const, label: 'Slope' },
              { id: 'noise' as const, label: 'Noise' },
            ]}
            value={L.mask.kind}
            onChange={(k) => {
              const r = MASK_RANGE[k];
              setMask({ kind: k, lo: r.def[0], hi: r.def[1], feather: r.def[2] });
            }}
          />
          {L.mask.kind !== 'none' && (
            <>
              <div className="spacer" />
              <div className="range-pair">
                <Slider label="Lower bound" value={L.mask.lo} min={range.min} max={range.max} step={range.unit === 'm' ? 10 : range.unit === '°' ? 0.5 : 0.01} unit={range.unit} onChange={(v) => setMask({ lo: v })} />
                <Slider label="Upper bound" value={L.mask.hi} min={range.min} max={range.max} step={range.unit === 'm' ? 10 : range.unit === '°' ? 0.5 : 0.01} unit={range.unit} onChange={(v) => setMask({ hi: v })} />
              </div>
              <Slider label="Feather" value={L.mask.feather} min={0} max={range.unit === 'm' ? 400 : range.unit === '°' ? 30 : 0.5} step={range.unit === 'm' ? 5 : range.unit === '°' ? 0.5 : 0.01} unit={range.unit} onChange={(v) => setMask({ feather: v })} />
              {L.mask.kind === 'noise' && (
                <Slider label="Pattern scale" value={L.mask.scale} min={0.5} max={12} step={0.1} unit="×" onChange={(v) => setMask({ scale: v })} />
              )}
              <div className="toggle-row">
                <span>Invert mask</span>
                <Toggle on={L.mask.invert} onChange={(v) => setMask({ invert: v })} label="Invert mask" />
              </div>
            </>
          )}
          <p className="muted">Mask gates where this layer applies. The blend combines the layer with the stack beneath it.</p>
        </Card>

        <Card title="Stack after this layer" icon={<Scan size={16} />} wide>
          <div className="preview-frame">
            {props.thumb ? <img src={props.thumb} alt="Heightmap after this layer" /> : <span className="thumb-empty" />}
          </div>
        </Card>
      </div>
    </>
  );
}

export function TexInspector(props: {
  layer: TexLayer; thumb?: string; settings: Settings;
  onChange: (fn: TexMutate, coalesce?: string) => void;
}) {
  const { layer: L, onChange } = props;
  const P = L.p;
  const set = (key: string, v: number, coalesce = true) =>
    onChange((l) => ({ ...l, p: { ...l.p, [key]: v } }), coalesce ? `tp:${L.id}:${key}` : undefined);
  const flag = (key: string, on: boolean) => set(key, on ? 1 : 0, false);
  const maxH = props.settings.maxH;
  const mat = MATERIALS[L.mat];

  return (
    <>
      <div className="hero-row">
        <div>
          <div className="eyebrow">TEXTURE · {mat.name.toUpperCase()}</div>
          <input className="name-input" value={L.name} onChange={(e) => onChange((l) => ({ ...l, name: e.target.value }), `tn:${L.id}`)} aria-label="Layer name" />
          <p className="muted lede">{mat.blurb}. Layers evaluate top to bottom; the first enabled layer is the base and fills everything it covers.</p>
        </div>
        <div className="hero-toggle">
          <span>Enabled</span>
          <Toggle on={L.enabled} onChange={(v) => onChange((l) => ({ ...l, enabled: v }))} label="Enabled" />
        </div>
      </div>

      <div className="cards">
        <Card title="Material" icon={<Palette size={16} />} wide>
          <div className="mat-grid">
            {MATERIALS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`mat-chip ${L.mat === m.id ? 'active' : ''}`}
                onClick={() => onChange((l) => ({ ...l, mat: m.id, name: l.name === MATERIALS[l.mat].name ? m.name : l.name }))}
              >
                <i style={{ background: m.color }} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
          <div className="spacer" />
          <div className="tint-row">
            <span>Tint</span>
            <input
              type="color"
              value={L.tint}
              onChange={(e) => onChange((l) => ({ ...l, tint: e.target.value }), `tt:${L.id}`)}
              aria-label="Tint colour"
            />
            <code>{L.tint}</code>
          </div>
        </Card>

        <Card title="Surface" icon={<Layers size={16} />} wide>
          <div className="two-col">
            <Slider label="Opacity" value={P.opacity * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set('opacity', v / 100)} />
            <Slider label="Sharpness" value={P.sharp} min={0} max={1} step={0.01} onChange={(v) => set('sharp', v)} hint="Edge hardness of the transition" />
            <Slider label="Height blend" value={P.heightBlend} min={0} max={1} step={0.01} onChange={(v) => set('heightBlend', v)} hint="Rock and sand fill cracks first" />
            <Slider label="Material scale" value={P.scale} min={1} max={60} step={0.5} unit="m" onChange={(v) => set('scale', v)} />
            <Slider label="Micro detail" value={P.detail} min={0} max={1} step={0.01} onChange={(v) => set('detail', v)} />
            <Slider label="Roughness" value={P.roughness} min={0} max={1} step={0.01} onChange={(v) => set('roughness', v)} />
          </div>
        </Card>

        <Card title="Altitude" icon={<Mountain size={16} />} right={<Toggle on={!!P.altOn} onChange={(v) => flag('altOn', v)} label="Altitude mask" />} wide>
          <div className={P.altOn ? '' : 'dimmed'}>
            <div className="two-col">
              <Slider label="From" value={P.altMin} min={0} max={maxH} step={5} unit="m" onChange={(v) => set('altMin', v)} />
              <Slider label="To" value={P.altMax} min={0} max={maxH} step={5} unit="m" onChange={(v) => set('altMax', v)} />
            </div>
            <Slider label="Feather" value={P.altFeather} min={0} max={400} step={5} unit="m" onChange={(v) => set('altFeather', v)} />
          </div>
        </Card>

        <Card title="Slope" icon={<Layers size={16} />} right={<Toggle on={!!P.slopeOn} onChange={(v) => flag('slopeOn', v)} label="Slope mask" />}>
          <div className={P.slopeOn ? '' : 'dimmed'}>
            <Metric value={`${Math.round(P.slopeMin)}–${Math.round(P.slopeMax)}`} unit="°" caption="Slope band where the material is placed" />
            <Slider label="Minimum" value={P.slopeMin} min={0} max={90} step={0.5} unit="°" onChange={(v) => set('slopeMin', v)} />
            <Slider label="Maximum" value={P.slopeMax} min={0} max={90} step={0.5} unit="°" onChange={(v) => set('slopeMax', v)} />
            <Slider label="Feather" value={P.slopeFeather} min={0} max={30} step={0.5} unit="°" onChange={(v) => set('slopeFeather', v)} />
          </div>
        </Card>

        <Card title="Curvature" icon={<Waves size={16} />} right={<Toggle on={!!P.curvOn} onChange={(v) => flag('curvOn', v)} label="Curvature mask" />}>
          <div className={P.curvOn ? '' : 'dimmed'}>
            <div className="control-block">
              <div className="control-line"><span>Selects</span><span>{['Convex ridges', 'Concave hollows', 'Both'][Math.round(P.curvMode)]}</span></div>
              <Pills options={[{ id: 0, label: 'Ridges' }, { id: 1, label: 'Hollows' }, { id: 2, label: 'Both' }]} value={Math.round(P.curvMode)} onChange={(v) => set('curvMode', v, false)} />
            </div>
            <Slider label="Threshold" value={P.curvThr} min={0} max={1} step={0.01} onChange={(v) => set('curvThr', v)} />
            <Slider label="Feather" value={P.curvFeather} min={0.01} max={0.6} step={0.01} onChange={(v) => set('curvFeather', v)} />
          </div>
        </Card>

        <Card title="Flow & cavity" icon={<Droplets size={16} />} wide>
          <div className="two-col">
            <div className={P.flowOn ? '' : 'dimmed'}>
              <div className="toggle-row"><span>Water flow</span><Toggle on={!!P.flowOn} onChange={(v) => flag('flowOn', v)} label="Flow mask" /></div>
              <Slider label="Minimum flow" value={P.flowMin} min={0} max={1} step={0.01} onChange={(v) => set('flowMin', v)} hint="Needs a hydraulic erosion layer" />
            </div>
            <div className={P.cavOn ? '' : 'dimmed'}>
              <div className="toggle-row"><span>Cavity (AO)</span><Toggle on={!!P.cavOn} onChange={(v) => flag('cavOn', v)} label="Cavity mask" /></div>
              <Slider label="Minimum occlusion" value={P.cavMin} min={0} max={1} step={0.01} onChange={(v) => set('cavMin', v)} />
            </div>
          </div>
        </Card>

        <Card title="Breakup" icon={<Sparkles size={16} />} wide>
          <div className="two-col">
            <Slider label="Noise amount" value={P.noiseAmt} min={0} max={1} step={0.01} onChange={(v) => set('noiseAmt', v)} hint="Breaks up straight mask edges" />
            <Slider label="Noise scale" value={P.noiseScale} min={20} max={800} step={5} unit="m" onChange={(v) => set('noiseScale', v)} />
          </div>
        </Card>

        <Card title="Mask preview" icon={<Scan size={16} />} wide>
          <div className="preview-frame">
            {props.thumb ? <img src={props.thumb} alt="Material weight" /> : <span className="thumb-empty" />}
          </div>
          <p className="muted">White is full coverage of this layer after all masks, before the stack beneath it.</p>
        </Card>
      </div>
    </>
  );
}

export function TerrainStats(props: {
  hist: number[]; settings: Settings; hasFlow: boolean; res: number; cellM: number; genMs: number | null;
}) {
  const h = props.hist;
  const hMax = Math.max(1, ...h.slice(0, 64));
  const sMax = Math.max(1, ...h.slice(64, 96));
  const hiBin = (() => { for (let i = 63; i >= 0; i--) if (h[i] > 0) return i; return 0; })();
  const loBin = (() => { for (let i = 0; i < 64; i++) if (h[i] > 0) return i; return 0; })();
  const sBin = (() => { for (let i = 31; i >= 0; i--) if (h[64 + i] > 0) return i; return 0; })();
  const span = ((hiBin - loBin) / 64) * props.settings.maxH;
  const km = (props.res - 1) * props.cellM / 1000;
  return (
    <>
      <div className="cards">
        <Card title="Terrain" icon={<Mountain size={16} />} wide right={<span className="small-pill">{props.res}×{props.res}</span>}>
          <div className="stat-grid">
            <div><span>Extent</span><strong>{km.toFixed(2)}<small> km</small></strong></div>
            <div><span>Cell size</span><strong>{props.cellM.toFixed(1)}<small> m</small></strong></div>
            <div><span>Relief</span><strong>{Math.round(span)}<small> m</small></strong></div>
            <div><span>Steepest</span><strong>{Math.round((sBin / 32) * 90)}<small>°</small></strong></div>
            <div><span>Flow network</span><strong>{props.hasFlow ? 'Yes' : 'None'}</strong></div>
            <div><span>Last pass</span><strong>{props.genMs === null ? '—' : `${Math.round(props.genMs)}`}<small>{props.genMs === null ? '' : ' ms'}</small></strong></div>
          </div>
        </Card>
        <Card title="Height distribution" icon={<Activity size={16} />} wide>
          <div className="hist">
            {h.slice(0, 64).map((v, i) => (
              <i key={i} style={{ height: `${(v / hMax) * 100}%` }} title={`${Math.round((i / 64) * props.settings.maxH)} m`} />
            ))}
          </div>
          <div className="range-labels"><span>0 m</span><span>{props.settings.maxH} m</span></div>
        </Card>
        <Card title="Slope distribution" icon={<Layers size={16} />} wide>
          <div className="hist slope">
            {h.slice(64, 96).map((v, i) => (
              <i key={i} style={{ height: `${(v / sMax) * 100}%` }} title={`${Math.round((i / 32) * 90)}°`} />
            ))}
          </div>
          <div className="range-labels"><span>0°</span><span>90°</span></div>
        </Card>
        <Card title="Next steps" icon={<Sun size={16} />} wide>
          <p className="muted">Add erosion and refinement layers to shape the land. Then switch to Texture to paint the surface with masks driven by altitude, slope, curvature, water flow and cavity.</p>
        </Card>
      </div>
      <SectionLabel left="TERRAIN" right="Analysis is recalculated with every change" />
    </>
  );
}

export function EmptyInspector(props: { text: string }) {
  return (
    <div className="empty-inspector">
      <Wind size={22} />
      <p>{props.text}</p>
    </div>
  );
}

