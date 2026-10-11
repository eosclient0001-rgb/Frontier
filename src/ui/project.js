// Project files are plain JSON holding the editor state verbatim. No binary, no version dance
// beyond a single integer — if the shape ever changes incompatibly the loader says so instead of
// silently producing a half-loaded document.

import { TERRAIN_OPS, makeLayer } from '../engine/terrain-schema.js';
import { materialByKey, makeTexLayer } from '../engine/texture-schema.js';

export const PROJECT_VERSION = 1;

export function saveProject(state) {
  return JSON.stringify({ format: 'frontier-terrain', version: PROJECT_VERSION, ...state }, null, 2);
}

function sanitizeLayer(raw) {
  const op = TERRAIN_OPS[raw.kind];
  if (!op) return null;
  const base = makeLayer(raw.kind);
  return {
    ...base,
    ...raw,
    id: raw.id ?? base.id,
    params: { ...op.defaults, ...(raw.params ?? {}) },
  };
}

function sanitizeTexLayer(raw) {
  if (raw?.kind === undefined) return null;
  const base = makeTexLayer(raw.kind);
  return { ...base, ...raw, id: raw.id ?? base.id };
}

export function deserialize(text, current) {
  const doc = JSON.parse(text);
  if (!doc || typeof doc !== 'object') throw new Error('not a project file');
  if (doc.format && doc.format !== 'frontier-terrain') throw new Error(`unknown format "${doc.format}"`);
  if (doc.version > PROJECT_VERSION) throw new Error(`file version ${doc.version} is newer than this build`);

  const terrain = { ...current.terrain, ...(doc.terrain ?? {}) };
  const stack = Array.isArray(doc.stack) ? doc.stack.map(sanitizeLayer).filter(Boolean) : current.stack;
  const textures = Array.isArray(doc.textures) ? doc.textures.map(sanitizeTexLayer).filter(Boolean) : current.textures;

  if (!stack.length) throw new Error('project contains no terrain layers');

  return {
    terrain,
    stack,
    textures: textures.length ? textures : current.textures,
    tex: { ...current.tex, ...(doc.tex ?? {}) },
    water: { ...current.water, ...(doc.water ?? {}) },
    atmo: { ...current.atmo, ...(doc.atmo ?? {}) },
    render: { ...current.render, ...(doc.render ?? {}) },
  };
}

export function presetToState(preset, current, maxRes = 4096) {
  return {
    terrain: {
      ...current.terrain,
      extent: preset.terrain.extent,
      heightMeters: preset.terrain.heightMeters,
      waterLevel: preset.terrain.waterLevel ?? 0.05,
      res: Math.min(preset.terrain.res ?? 1024, maxRes),
      meshRes: Math.min(current.terrain.meshRes, preset.terrain.res ?? 1024, maxRes),
    },
    stack: preset.stack,
    textures: preset.textures,
    tex: current.tex,
    water: { ...current.water, ...(preset.water ?? {}) },
    atmo: { ...current.atmo, ...(preset.atmo ?? {}) },
    render: current.render,
  };
}

export function materialLabel(key) {
  return materialByKey(key).label;
}
