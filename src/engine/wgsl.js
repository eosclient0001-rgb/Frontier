// Resolves the small #include system used by the shader sources. Vite hands us each .wgsl file as
// a raw string; this module stitches them so a shader can be authored against named dependencies
// instead of one enormous file.

import noise from './shaders/noise.wgsl?raw';
import atmosphere from './shaders/atmosphere.wgsl?raw';
import materials from './shaders/materials.wgsl?raw';
import scene from './shaders/scene.wgsl?raw';
import terrainOps from './shaders/terrain-ops.wgsl?raw';
import erosion from './shaders/erosion.wgsl?raw';
import derive from './shaders/derive.wgsl?raw';
import skyTransmittance from './shaders/sky-transmittance.wgsl?raw';
import skySh from './shaders/sky-sh.wgsl?raw';
import terrainRender from './shaders/terrain-render.wgsl?raw';
import water from './shaders/water.wgsl?raw';
import post from './shaders/post.wgsl?raw';

const SOURCES = {
  'noise.wgsl': noise,
  'atmosphere.wgsl': atmosphere,
  'materials.wgsl': materials,
  'scene.wgsl': scene,
  'terrain-ops.wgsl': terrainOps,
  'erosion.wgsl': erosion,
  'derive.wgsl': derive,
  'sky-transmittance.wgsl': skyTransmittance,
  'sky-sh.wgsl': skySh,
  'terrain-render.wgsl': terrainRender,
  'water.wgsl': water,
  'post.wgsl': post,
};

const cache = new Map();
const INCLUDE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

export function wgsl(name) {
  if (cache.has(name)) return cache.get(name);
  const src = SOURCES[name];
  if (src === undefined) throw new Error(`unknown shader ${name}`);
  const resolved = src.replace(INCLUDE, (_, dep) => {
    if (!SOURCES[dep]) throw new Error(`${name}: cannot resolve #include "${dep}"`);
    return wgsl(dep);
  });
  cache.set(name, resolved);
  return resolved;
}

export const SHADER_NAMES = Object.keys(SOURCES);
