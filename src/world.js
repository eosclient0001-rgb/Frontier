import { terrainDomain } from "./domain.js";
export const worldDefaults = {
  worldEnabled: true,
  terrainWidth: 1000,
  terrainLength: 1000,
  terrainHeight: 240,
  terrainAmplitude: 45,
  terrainScale: 160,
  terrainForm: 1,
  terrainOctaves: 4,
  terrainTerraceHeight: 8,
};
export function worldBounds(params) {
  const { min, max } = terrainDomain({ ...params, worldEnabled: true });
  return { min, max };
}
