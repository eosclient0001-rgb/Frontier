import React from 'react';
import { Card, Slider, Toggle, Select, ColorField, NumberField, Seg, SchemaField } from './controls.jsx';
import { Icon } from './icons.jsx';
import { NoiseThumb, MaskBand, SunDial, SlopeDiagram, AltitudeDiagram, MaterialChip } from './graphics.jsx';
import {
  TERRAIN_OPS, OP_LIST, OP_GROUPS, MASK_MODES, BLEND_MODES, makeLayer,
} from '../engine/terrain-schema.js';
import { MATERIALS, MATERIAL_GROUPS, TEX_MASK_MODES, materialByKey, makeTexLayer } from '../engine/texture-schema.js';
import { PRESETS } from '../engine/presets.js';

const fmtMeters = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v)));

/* ============================================================================================== */
/*  terrain layer                                                                                 */
/* ============================================================================================== */

export function TerrainLayerInspector({ layer, onChange, onKind, onDelete, onDuplicate, index, total }) {
  const op = TERRAIN_OPS[layer.kind];
  const set = (patch) => onChange({ ...layer, ...patch });
  const setParam = (key, v) => onChange({ ...layer, params: { ...layer.params, [key]: v } });
  const P = layer.params;
  const hasNoise = P.frequency !== undefined;

  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon" style={{ '--accent': op.accent }}>
          <Icon name={op.icon} size={20} />
        </div>
        <div className="insp-title">
          <div className="insp-eyebrow">{op.group} · layer {total - index} of {total}</div>
          <input value={layer.name} onChange={(e) => set({ name: e.target.value })} spellCheck={false} />
          <div className="insp-sub">{op.blurb}</div>
        </div>
      </div>

      <Card title={op.label} icon="Settings2" accent={op.accent}>
        {hasNoise && (
          <NoiseThumb
            params={{
              type: P.type, seed: P.seed, octaves: P.octaves, frequency: P.frequency,
              lacunarity: P.lacunarity, gain: P.gain, warp: P.warp, warpFreq: P.warpFreq,
              sharpness: P.sharpness, amplitude: P.amplitude, offset: P.offset,
              invert: P.invert,
            }}
          />
        )}
        {op.fields.map((field) => (
          <SchemaField
            key={field.key}
            field={field}
            value={P[field.key] ?? field.def}
            onChange={(v) => setParam(field.key, v)}
          />
        ))}
      </Card>

      <Card title="Mask" icon="ScanLine">
        <Select
          label="Limit to"
          value={layer.maskMode}
          options={MASK_MODES}
          onChange={(v) => set({ maskMode: v })}
          hint={op.locksMask ? 'This operator generates its own mask from its controls.' :
            layer.maskMode === 0 ? 'Applies to the whole surface.' : 'Only where the band is white.'}
        />
        {layer.maskMode !== 0 && !op.locksMask && (
          <>
            <div className="graphic-frame" style={{ marginTop: 12 }}>
              {layer.maskMode === 2
                ? <SlopeDiagram min={layer.maskMin} max={layer.maskMax} />
                : layer.maskMode === 1
                  ? <AltitudeDiagram min={layer.maskMin} max={layer.maskMax} />
                  : <MaskBand
                    min={layer.maskMin} max={layer.maskMax} feather={layer.maskFeather}
                    invert={layer.maskInvert} label={MASK_MODES.find((m) => m.id === layer.maskMode)?.label}
                  />}
            </div>
            <Slider label="Range low" value={layer.maskMin} min={0} max={1} step={0.005}
              onChange={(v) => set({ maskMin: Math.min(v, layer.maskMax - 0.005) })} />
            <Slider label="Range high" value={layer.maskMax} min={0} max={1} step={0.005}
              onChange={(v) => set({ maskMax: Math.max(v, layer.maskMin + 0.005) })} />
            <Slider label="Feather" value={layer.maskFeather} min={0.001} max={0.5} step={0.005}
              onChange={(v) => set({ maskFeather: v })}
              hint="Width of the soft transition at each edge of the band." />
            {layer.maskMode === 4 && (
              <>
                <Slider label="Noise scale" value={layer.maskNoiseScale} min={0.5} max={24} step={0.1}
                  onChange={(v) => set({ maskNoiseScale: v })} />
                <Slider label="Noise contrast" value={layer.maskContrast} min={0.2} max={4} step={0.05}
                  onChange={(v) => set({ maskContrast: v })} />
                <NumberField label="Noise seed" value={layer.maskNoiseSeed} min={0} max={9999}
                  onChange={(v) => set({ maskNoiseSeed: Math.round(v) })} />
              </>
            )}
            <div style={{ marginTop: 10 }}>
              <Toggle label="Invert mask" value={layer.maskInvert} onChange={(v) => set({ maskInvert: v })} />
            </div>
          </>
        )}
      </Card>

      <Card title="Blend" icon="Blend">
        <Select label="Mode" value={layer.blend} options={BLEND_MODES} onChange={(v) => set({ blend: v })}
          hint="How this layer combines with everything below it." />
        <Slider label="Opacity" value={layer.opacity} min={0} max={1} step={0.01}
          onChange={(v) => set({ opacity: v })} />
        <div className="card-divider" />
        <div className="btn-row">
          <button className="btn ghost" onClick={onDuplicate}><Icon name="Copy" size={13} /> Duplicate</button>
          <button className="btn ghost" onClick={onDelete}><Icon name="Trash2" size={13} /> Delete</button>
        </div>
      </Card>

      <Card title="Change operator" icon="Shuffle" note="Swapping keeps the layer position, name and mask, and resets the parameters to the new operator's defaults.">
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {OP_GROUPS.map((group) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9.5, color: '#636363', padding: '0 2px 5px' }}>{group}</div>
              <div className="pill-row">
                {OP_LIST.filter((o) => o.group === group).map((o) => (
                  <button key={o.key} className={`pill${o.key === layer.kind ? ' on' : ''}`}
                    onClick={() => onKind(o.key)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============================================================================================== */
/*  texture layer                                                                                  */
/* ============================================================================================== */

export function TextureLayerInspector({ layer, onChange, onKind, onDelete, onDuplicate, index, total }) {
  const mat = materialByKey(layer.kind);
  const set = (patch) => onChange({ ...layer, ...patch });

  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon">
          <MaterialChip a={layer.albedoA} b={layer.albedoB} rough={layer.roughness} size={26} />
        </div>
        <div className="insp-title">
          <div className="insp-eyebrow">{mat.group} · layer {total - index} of {total}</div>
          <input value={layer.name} onChange={(e) => set({ name: e.target.value })} spellCheck={false} />
          <div className="insp-sub">
            {total - index === 1 ? 'Base layer — covers everything not claimed above.' : `Painted over layer ${total - index - 1} below.`}
          </div>
        </div>
      </div>

      <Card title="Material" icon="Palette">
        <Select
          label="Preset"
          value={layer.kind}
          options={MATERIALS.map((m) => ({ id: m.key, label: `${m.group} — ${m.label}` }))}
          onChange={onKind}
          hint="Picking a preset resets the colours and scales to that material's measured values."
        />
        <div className="card-divider" />
        <ColorField label="Colour A · lit" value={layer.albedoA} onChange={(v) => set({ albedoA: v })} />
        <ColorField label="Colour B · shadow" value={layer.albedoB} onChange={(v) => set({ albedoB: v })} />
        <Slider label="Roughness" value={layer.roughness} min={0.03} max={1} step={0.01}
          onChange={(v) => set({ roughness: v })}
          hint="Wet mud and ice sit near 0.1; dry talus sits near 0.9." />
        <Slider label="Metalness" value={layer.metalness} min={0} max={1} step={0.01}
          onChange={(v) => set({ metalness: v })} />
      </Card>

      <Card title="Surface" icon="Layers">
        <Slider label="Detail scale" value={layer.detailScale} min={0.02} max={3} step={0.005}
          onChange={(v) => set({ detailScale: v })}
          hint="Cycles per metre of the finest grain. 0.05 is grass-scale, 1.5 is gravel." />
        <Slider label="Macro scale" value={layer.macroScale} min={1} max={60} step={0.5}
          onChange={(v) => set({ macroScale: v })}
          hint="Size in metres of the large tonal patches that break up flat colour." />
        <Slider label="Normal strength" value={layer.normalStrength} min={0} max={3} step={0.01}
          onChange={(v) => set({ normalStrength: v })} />
        <Slider label="Colour variation" value={layer.colorVariation} min={0} max={1} step={0.01}
          onChange={(v) => set({ colorVariation: v })} />
        <Slider label="Roughness variation" value={layer.roughVariation} min={0} max={1} step={0.01}
          onChange={(v) => set({ roughVariation: v })} />
        <Slider label="Macro variation" value={layer.macroVariation} min={0} max={1} step={0.01}
          onChange={(v) => set({ macroVariation: v })} />
      </Card>

      <Card title="Mask" icon="ScanLine">
        <Select
          label="Appear where"
          value={layer.maskMode}
          options={TEX_MASK_MODES}
          onChange={(v) => set({ maskMode: v })}
          hint={layer.maskMode === 0 ? 'Covers the whole terrain.' : 'Fades in only inside the band.'}
        />
        {layer.maskMode !== 0 && layer.maskMode !== 7 && (
          <>
            <div className="graphic-frame" style={{ marginTop: 12 }}>
              {layer.maskMode === 2
                ? <SlopeDiagram min={layer.maskMin} max={layer.maskMax} />
                : layer.maskMode === 1
                  ? <AltitudeDiagram min={layer.maskMin} max={layer.maskMax} />
                  : <MaskBand
                    min={layer.maskMin} max={layer.maskMax} feather={layer.maskFeather}
                    invert={layer.invert} label={TEX_MASK_MODES.find((m) => m.id === layer.maskMode)?.label}
                  />}
            </div>
            <Slider label="Range low" value={layer.maskMin} min={0} max={1} step={0.005}
              onChange={(v) => set({ maskMin: Math.min(v, layer.maskMax - 0.005) })} />
            <Slider label="Range high" value={layer.maskMax} min={0} max={1} step={0.005}
              onChange={(v) => set({ maskMax: Math.max(v, layer.maskMin + 0.005) })} />
            <Slider label="Feather" value={layer.maskFeather} min={0.001} max={0.5} step={0.005}
              onChange={(v) => set({ maskFeather: v })} />
            {layer.maskMode === 4 && (
              <>
                <Slider label="Noise scale" value={layer.noiseScale} min={2} max={120} step={1} decimals={0}
                  onChange={(v) => set({ noiseScale: v })} />
                <Slider label="Noise contrast" value={layer.noiseContrast} min={0.2} max={4} step={0.05}
                  onChange={(v) => set({ noiseContrast: v })} />
              </>
            )}
            {layer.maskMode === 6 && (
              <>
                <Slider label="Aspect" value={layer.aspectDir} min={0} max={360} step={1} unit="°" decimals={0}
                  onChange={(v) => set({ aspectDir: v })}
                  hint="0° faces north. Slopes facing this direction get the material." />
                <Slider label="Spread" value={layer.aspectSpread} min={0.2} max={6} step={0.05}
                  onChange={(v) => set({ aspectSpread: v })} />
                <Slider label="Aspect feather" value={layer.aspectFeather} min={0.01} max={0.5} step={0.01}
                  onChange={(v) => set({ aspectFeather: v })} />
              </>
            )}
            <Slider label="Slope influence" value={layer.slopeInfluence} min={0} max={1} step={0.01}
              onChange={(v) => set({ slopeInfluence: v })}
              hint="Blends the mask with the slope of the ground, so a band can follow the steep faces in it." />
            <div style={{ marginTop: 10 }}>
              <Toggle label="Invert mask" value={layer.invert} onChange={(v) => set({ invert: v })} />
            </div>
          </>
        )}
        {layer.maskMode === 7 && (
          <p className="card-note" style={{ marginBottom: 0 }}>
            Fills in below the water line — use it for the wet shore band and the lake bed.
          </p>
        )}
      </Card>

      <Card title="Blend" icon="Blend">
        <Slider label="Opacity" value={layer.opacity} min={0} max={1} step={0.01}
          onChange={(v) => set({ opacity: v })} />
        <Slider label="Height contrast" value={layer.heightContrast} min={0.1} max={2} step={0.01}
          onChange={(v) => set({ heightContrast: v })}
          hint="Sharpens the transition between this material and the one below it." />
        <Slider label="Height offset" value={layer.heightOffset} min={-0.5} max={0.5} step={0.005}
          onChange={(v) => set({ heightOffset: v })} />
        <div className="card-divider" />
        <div className="btn-row">
          <button className="btn ghost" onClick={onDuplicate}><Icon name="Copy" size={13} /> Duplicate</button>
          <button className="btn ghost" onClick={onDelete}><Icon name="Trash2" size={13} /> Delete</button>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================================================== */
/*  object panels                                                                                  */
/* ============================================================================================== */

export function TerrainPanel({ terrain, onChange, stats, maxRes = 2048 }) {
  const set = (patch) => onChange({ ...terrain, ...patch });
  const RES_OPTIONS = [
    { id: 512, label: '512' }, { id: 1024, label: '1K' },
    { id: 2048, label: '2K' }, { id: 4096, label: '4K' },
  ].filter((o) => o.id <= maxRes);
  const MESH_OPTIONS = [
    { id: 512, label: 'mesh 512' }, { id: 1024, label: '1K' }, { id: 2048, label: '2K' },
  ].filter((o) => o.id <= Math.min(maxRes, 2048));
  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon"><Icon name="Mountain" size={20} /></div>
        <div className="insp-title">
          <div className="insp-eyebrow">Object</div>
          <h2>Terrain</h2>
          <div className="insp-sub">The heightfield everything else is derived from.</div>
        </div>
      </div>

      <Card title="Size" icon="Ruler">
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <div>
            <div className="metric">{fmtMeters(terrain.extent)}<small>m</small></div>
            <div className="field-hint" style={{ marginTop: 4 }}>tile across</div>
          </div>
          <div>
            <div className="metric">{fmtMeters(terrain.heightMeters)}<small>m</small></div>
            <div className="field-hint" style={{ marginTop: 4 }}>vertical range</div>
          </div>
        </div>
        <Slider label="Tile extent" value={terrain.extent} min={200} max={20000} step={50} unit="m"
          decimals={0} onChange={(v) => set({ extent: v })}
          hint="Ground covered edge to edge. Everything is authored in metres, so this is a real size." />
        <Slider label="Height range" value={terrain.heightMeters} min={50} max={9000} step={10} unit="m"
          decimals={0} onChange={(v) => set({ heightMeters: v })}
          hint="Height assigned to a normalised value of 1.0." />
      </Card>

      <Card title="Resolution" icon="Grid3x3"
        note="Simulation and mesh resolution are separate: you can author at 2048 and still preview at 1024.">
        <Seg
          value={Math.min(terrain.res, maxRes)}
          options={RES_OPTIONS}
          onChange={(v) => set({ res: v, meshRes: Math.min(terrain.meshRes, v) })}
        />
        <div style={{ height: 12 }} />
        <Seg
          value={Math.min(terrain.meshRes, Math.min(terrain.res, 2048))}
          options={MESH_OPTIONS}
          onChange={(v) => set({ meshRes: Math.min(v, terrain.res) })}
        />
        <div style={{ height: 14 }} />
        <div className="stat-line"><span>heightfield cells</span><b>{(terrain.res * terrain.res).toLocaleString()}</b></div>
        <div className="stat-line">
          <span>triangles drawn</span>
          <b>{((Math.min(terrain.meshRes, terrain.res) - 1) ** 2 * 2).toLocaleString()}</b>
        </div>
        <div className="stat-line"><span>ground sample</span><b>{(terrain.extent / terrain.res).toFixed(2)} m</b></div>
      </Card>

      <Card title="Sea level" icon="Waves">
        <Slider label="Water level" value={terrain.waterLevel} min={0} max={0.95} step={0.005}
          onChange={(v) => set({ waterLevel: v })}
          hint="Height, as a fraction of the vertical range, where still water sits." />
      </Card>
    </div>
  );
}

export function TexturePanel({ tex, onChange }) {
  const set = (patch) => onChange({ ...tex, ...patch });
  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon"><Icon name="Palette" size={20} /></div>
        <div className="insp-title">
          <div className="insp-eyebrow">Object</div>
          <h2>Texturing</h2>
          <div className="insp-sub">How the derived surface maps feed the material stack.</div>
        </div>
      </div>

      <Card title="Derived maps" icon="Layers"
        note="Every texture layer reads these. Ambient occlusion, curvature and flow are computed from the heightfield, not painted.">
        <Slider label="Ambient occlusion" value={tex.aoStrength} min={0} max={2} step={0.01}
          onChange={(v) => set({ aoStrength: v })} />
        <Slider label="Cavity" value={tex.cavityStrength} min={0} max={2} step={0.01}
          onChange={(v) => set({ cavityStrength: v })}
          hint="Short-range concavity. Darkens creases and the contact shadow under stones." />
        <Slider label="Wetness" value={tex.wetnessStrength} min={0} max={2} step={0.01}
          onChange={(v) => set({ wetnessStrength: v })}
          hint="Follows the water accumulation from the erosion pass." />
      </Card>

      <Card title="Shading" icon="Aperture">
        <Slider label="Normal strength" value={tex.normalStrength} min={0} max={3} step={0.01}
          onChange={(v) => set({ normalStrength: v })} />
      </Card>
    </div>
  );
}

export function SunPanel({ atmo, onChange }) {
  const set = (patch) => onChange({ ...atmo, ...patch });
  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon"><Icon name="Sun" size={20} /></div>
        <div className="insp-title">
          <div className="insp-eyebrow">Object</div>
          <h2>Sun</h2>
          <div className="insp-sub">Drives shadows, the sky and every surface response at once.</div>
        </div>
      </div>

      <Card title="Position" icon="Sun">
        <div className="graphic-frame"><SunDial elevation={atmo.sunElevation} azimuth={atmo.sunAzimuth} /></div>
        <Slider label="Elevation" value={atmo.sunElevation} min={-6} max={90} step={0.1} unit="°"
          decimals={1} onChange={(v) => set({ sunElevation: v })}
          hint="Below about 8° the light goes amber and shadows stretch across the whole tile." />
        <Slider label="Azimuth" value={atmo.sunAzimuth} min={0} max={360} step={0.5} unit="°"
          decimals={0} onChange={(v) => set({ sunAzimuth: v })} />
        <Slider label="Intensity" value={atmo.sunIntensity} min={0} max={40} step={0.1}
          onChange={(v) => set({ sunIntensity: v })} />
      </Card>

      <Card title="Scattering" icon="Cloud" note="Physically based single-scattering coefficients. Changing these changes the sky and the aerial perspective together.">
        <Slider label="Rayleigh" value={atmo.rayleighScale} min={0.1} max={4} step={0.01}
          onChange={(v) => set({ rayleighScale: v })}
          hint="Air molecules. Sets how blue the sky is and how fast distant ground desaturates." />
        <Slider label="Mie" value={atmo.mieScale} min={0.1} max={8} step={0.01}
          onChange={(v) => set({ mieScale: v })}
          hint="Aerosol and haze. Raises the horizon glow." />
        <Slider label="Ozone" value={atmo.ozoneScale} min={0} max={3} step={0.01}
          onChange={(v) => set({ ozoneScale: v })}
          hint="Absorbs the red end at grazing angles — this is what makes sunset orange rather than red." />
        <Slider label="Mie phase" value={atmo.miePhaseG} min={0} max={0.95} step={0.01}
          onChange={(v) => set({ miePhaseG: v })}
          hint="Forward scattering. Higher values give a tighter, brighter halo around the sun." />
      </Card>

      <Card title="Ground bounce" icon="Mountain">
        <ColorField label="Ground albedo" value={atmo.groundAlbedo} onChange={(v) => set({ groundAlbedo: v })}
          hint="Colour of the light that bounces off the terrain back into the sky." />
        <Slider label="Reference altitude" value={atmo.referenceAltitude} min={0} max={6000} step={50} unit="m"
          decimals={0} onChange={(v) => set({ referenceAltitude: v })}
          hint="Altitude the aerial perspective is measured from." />
      </Card>
    </div>
  );
}

export function WaterPanel({ water, waterLevel, onChangeWater, onChangeLevel }) {
  const set = (patch) => onChangeWater({ ...water, ...patch });
  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon"><Icon name="Waves" size={20} /></div>
        <div className="insp-title">
          <div className="insp-eyebrow">Object</div>
          <h2>Water</h2>
          <div className="insp-sub">A deferred pass over the terrain: refraction through the water volume, Fresnel reflection and depth-driven absorption.</div>
        </div>
      </div>

      <Card title="Surface" icon="Waves">
        <Toggle label="Enabled" value={water.enabled} onChange={(v) => set({ enabled: v })} />
        <Slider label="Level" value={waterLevel} min={0} max={0.95} step={0.005}
          onChange={onChangeLevel} />
        <Slider label="Wave amplitude" value={water.waveAmplitude} min={0} max={0.4} step={0.002}
          onChange={(v) => set({ waveAmplitude: v })} />
        <Slider label="Wave scale" value={water.waveScale} min={0.2} max={12} step={0.05}
          onChange={(v) => set({ waveScale: v })} />
        <Slider label="Choppiness" value={water.choppiness} min={0} max={1} step={0.01}
          onChange={(v) => set({ choppiness: v })} />
        <Slider label="Roughness" value={water.roughness} min={0} max={1} step={0.01}
          onChange={(v) => set({ roughness: v })} />
      </Card>

      <Card title="Volume" icon="Droplets"
        note="Beer–Lambert absorption over the distance the ray travels underwater — this is what turns a shallow shore turquoise and a deep basin black.">
        <ColorField label="Absorption" value={water.absorption} onChange={(v) => set({ absorption: v })} />
        <ColorField label="Scatter" value={water.scatter} onChange={(v) => set({ scatter: v })} />
        <Slider label="Absorption strength" value={water.absorptionStrength} min={0} max={3} step={0.01}
          onChange={(v) => set({ absorptionStrength: v })} />
        <Slider label="Shore width" value={water.shoreWidth} min={0.05} max={6} step={0.05}
          onChange={(v) => set({ shoreWidth: v })} />
      </Card>

      <Card title="Reflection" icon="Aperture">
        <Slider label="Reflectivity" value={water.reflectivity} min={0} max={1} step={0.01}
          onChange={(v) => set({ reflectivity: v })} />
        <Slider label="Sun glitter" value={water.sunGlitter} min={0} max={2} step={0.01}
          onChange={(v) => set({ sunGlitter: v })} />
        <Slider label="Foam" value={water.foam} min={0} max={1} step={0.01}
          onChange={(v) => set({ foam: v })} />
      </Card>
    </div>
  );
}

const VIEW_MODES = [
  { id: 0, label: 'Shaded' },
  { id: 1, label: 'Height' },
  { id: 2, label: 'Slope' },
  { id: 3, label: 'Normal' },
  { id: 4, label: 'AO' },
  { id: 5, label: 'Curvature' },
  { id: 6, label: 'Flow' },
  { id: 7, label: 'Roughness' },
  { id: 8, label: 'Albedo' },
];

export function RenderPanel({ render, onChange, stats }) {
  const set = (patch) => onChange({ ...render, ...patch });
  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon"><Icon name="Camera" size={20} /></div>
        <div className="insp-title">
          <div className="insp-eyebrow">Object</div>
          <h2>Render</h2>
          <div className="insp-sub">Preview quality and the tone curve. None of this changes the terrain data.</div>
        </div>
      </div>

      <Card title="Viewport" icon="Eye">
        <Select label="View mode" value={render.debugView} options={VIEW_MODES} onChange={(v) => set({ debugView: v })}
          hint="Shaded is the finished image; the rest are the derived surface maps." />
        <Toggle label="Wireframe" value={render.wireframe} onChange={(v) => set({ wireframe: v })} />
        <div className="card-divider" />
        <Slider label="Render scale" value={render.renderScale} min={0.5} max={2} step={0.05}
          onChange={(v) => set({ renderScale: v })}
          hint="Internal resolution multiplier. Push it to 2 for screenshots." />
        <Slider label="Shadow strength" value={render.shadowStrength} min={0} max={1} step={0.01}
          onChange={(v) => set({ shadowStrength: v })} />
        <Slider label="Sky quality" value={render.atmoQuality} min={4} max={32} step={1} decimals={0}
          onChange={(v) => set({ atmoQuality: v })}
          hint="Integration steps per pixel in the sky. Higher resolves thin cloud and the sun's aureole." />
      </Card>

      <Card title="Tone" icon="Aperture">
        <Slider label="Exposure" value={render.exposure} min={0.05} max={4} step={0.01}
          onChange={(v) => set({ exposure: v })} />
        <Slider label="Contrast" value={render.contrast} min={0.5} max={2} step={0.01}
          onChange={(v) => set({ contrast: v })} />
        <Slider label="Saturation" value={render.saturation} min={0} max={2} step={0.01}
          onChange={(v) => set({ saturation: v })} />
        <Slider label="Bloom" value={render.bloom} min={0} max={2} step={0.01}
          onChange={(v) => set({ bloom: v })} />
        <Slider label="Bloom threshold" value={render.bloomThreshold} min={0} max={4} step={0.01}
          onChange={(v) => set({ bloomThreshold: v })} />
        <Slider label="Vignette" value={render.vignette} min={0} max={1} step={0.01}
          onChange={(v) => set({ vignette: v })} />
        <Slider label="Grain" value={render.grain} min={0} max={0.5} step={0.005}
          onChange={(v) => set({ grain: v })} />
      </Card>

      {stats && (
        <Card title="Cost" icon="Cpu">
          <div className="stat-line"><span>erosion passes</span><b>{stats.passes}</b></div>
          <div className="stat-line"><span>terrain layers</span><b>{stats.terrainLayers}</b></div>
          <div className="stat-line"><span>texture layers</span><b>{stats.textureLayers}</b></div>
          <div className="stat-line"><span>vertices</span><b>{stats.vertices.toLocaleString()}</b></div>
        </Card>
      )}
    </div>
  );
}

export function PresetsPanel({ onApply, activeId }) {
  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon"><Icon name="Sparkles" size={20} /></div>
        <div className="insp-title">
          <div className="insp-eyebrow">Library</div>
          <h2>Presets</h2>
          <div className="insp-sub">Complete stacks — terrain, texturing, water and sky. Load one and start editing.</div>
        </div>
      </div>

      {PRESETS.map((p) => (
        <button key={p.id} className={`preset-card${p.id === activeId ? ' on' : ''}`} onClick={() => onApply(p)}>
          <div className="preset-name"><Icon name="Mountain" size={14} /> {p.name}</div>
          <div className="preset-blurb">{p.blurb}</div>
          <div className="preset-swatch">
            {p.textures.slice().reverse().slice(0, 6).map((t, i) => (
              <i key={i} style={{ background: `linear-gradient(135deg, ${t.albedoA}, ${t.albedoB})` }} />
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

export function ExportPanel({ app, terrain, onMessage, onLoadProject }) {
  const [busy, setBusy] = React.useState(null);
  const ready = !!app?.solver;

  const run = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      onMessage(`Exported ${label}.`);
    } catch (e) {
      onMessage(`${label} failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const heightmap = () => run('heightmap', async () => {
    const heights = await app.solver.readHeights();
    const { heightsToPNG, downloadBytes } = await import('../engine/export.js');
    const bytes = await heightsToPNG(heights, app.solver.res);
    downloadBytes(`terrain-height-${app.solver.res}.png`, bytes, 'image/png');
  });

  const normals = () => run('normal map', async () => {
    const heights = await app.solver.readHeights();
    const { normalsToPNG, downloadBytes } = await import('../engine/export.js');
    const bytes = await normalsToPNG(heights, app.solver.res, terrain.extent, terrain.heightMeters);
    downloadBytes(`terrain-normal-${app.solver.res}.png`, bytes, 'image/png');
  });

  const mesh = () => run('mesh', async () => {
    const heights = await app.solver.readHeights();
    const { heightsToOBJ, downloadText } = await import('../engine/export.js');
    const text = heightsToOBJ(heights, app.solver.res, terrain.extent, terrain.heightMeters);
    downloadText(`terrain-${app.solver.res}.obj`, text, 'model/obj');
  });

  const shot = () => run('screenshot', async () => {
    const { rgbaToPNG, downloadBytes } = await import('../engine/export.js');
    const cap = await app.renderer.capture();
    const bytes = await rgbaToPNG(cap.data, cap.width, cap.height, cap.padded);
    downloadBytes('frontier-render.png', bytes, 'image/png');
  });

  return (
    <div className="inspector-inner">
      <div className="insp-head">
        <div className="insp-icon"><Icon name="FileDown" size={20} /></div>
        <div className="insp-title">
          <div className="insp-eyebrow">Output</div>
          <h2>Export</h2>
          <div className="insp-sub">Everything is written at the simulation resolution, not the preview resolution.</div>
        </div>
      </div>

      <Card title="Maps" icon="Image">
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="btn primary" disabled={!!busy || !ready} onClick={heightmap}>
            <Icon name="Download" size={14} /> Heightmap · 16-bit PNG
          </button>
          <button className="btn" disabled={!!busy || !ready} onClick={normals}>
            <Icon name="Download" size={14} /> Normal map · PNG
          </button>
          <button className="btn" disabled={!!busy || !ready} onClick={mesh}>
            <Icon name="Download" size={14} /> Mesh · OBJ
          </button>
          <button className="btn" disabled={!!busy || !ready} onClick={shot}>
            <Icon name="Camera" size={14} /> Viewport · PNG
          </button>
        </div>
        {busy && <div className="field-hint" style={{ marginTop: 10 }}>Working — {busy}…</div>}
      </Card>

      <Card title="Project" icon="HardDrive">
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="btn" disabled={!!busy || !ready} onClick={() => run('project', async () => {
            const { downloadText } = await import('../engine/export.js');
            const { saveProject } = await import('./project.js');
            downloadText('frontier-terrain.json', saveProject(app.state), 'application/json');
          })}>
            <Icon name="Upload" size={14} /> Save project · JSON
          </button>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            <Icon name="Download" size={14} /> Load project · JSON
            <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                onMessage(onLoadProject(await file.text()));
              } catch (err) {
                onMessage(`Load failed: ${err.message}`);
              }
              e.target.value = '';
            }} />
          </label>
        </div>
      </Card>

      <div className="hint-line">
        {ready ? (
          <>
            The OBJ is a regular grid at the export resolution — {app.solver.res} × {app.solver.res} verts,
            {' '}{((app.solver.res - 1) ** 2 * 2).toLocaleString()} triangles. Heightmaps are 16-bit
            greyscale, black at the base of the range and white at {terrain.heightMeters} m.
          </>
        ) : 'Waiting for the GPU…'}
      </div>
    </div>
  );
}

export { makeLayer, makeTexLayer };
