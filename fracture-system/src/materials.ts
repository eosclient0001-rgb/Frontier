/**
 * Material-specific fracture parameters for AAA-grade destruction
 * Based on real-world fracture mechanics research
 */

export enum MaterialType {
  GLASS = 'glass',
  WOOD = 'wood',
  CONCRETE = 'concrete',
  PLASTIC = 'plastic',
  ROCK = 'rock',
}

export interface FractureParameters {
  // Primary fracture pattern
  patternType: 'radial' | 'grain' | 'irregular' | 'ductile' | 'fault';
  crackCount: { min: number; max: number };
  crackWidth: { min: number; max: number };
  crackDepth: { min: number; max: number };
  branchingProbability: number;
  branchingAngle: { min: number; max: number }; // radians

  // Secondary detail
  chipping: boolean;
  chipCount: { min: number; max: number };
  chipSize: { min: number; max: number };

  // Physical properties
  youngsModulus: number; // GPa
  poissonRatio: number;
  fractureToughness: number; // MPa·m^0.5
  density: number; // kg/m³

  // Visual
  interiorRoughness: number;
  wallnerLines: boolean; // Glass-specific
  hackleMarks: boolean;  // Glass/rock-specific
  grainVisibility: number; // Wood-specific
}

// Glass: Radial + concentric cracks from impact point
// Wallner lines (curved fracture surface markings), hackle marks
export const GLASS_PARAMS: FractureParameters = {
  patternType: 'radial',
  crackCount: { min: 3, max: 8 },
  crackWidth: { min: 0.0001, max: 0.001 },
  crackDepth: { min: 0.8, max: 1.0 }, // Through-thickness
  branchingProbability: 0.15,
  branchingAngle: { min: Math.PI / 6, max: Math.PI / 3 },
  chipping: true,
  chipCount: { min: 5, max: 20 },
  chipSize: { min: 0.01, max: 0.05 },
  youngsModulus: 70,
  poissonRatio: 0.22,
  fractureToughness: 0.75,
  density: 2500,
  interiorRoughness: 0.1,
  wallnerLines: true,
  hackleMarks: true,
  grainVisibility: 0,
};

// Wood: Grain-aligned splits, fiber pull-out
export const WOOD_PARAMS: FractureParameters = {
  patternType: 'grain',
  crackCount: { min: 1, max: 4 },
  crackWidth: { min: 0.001, max: 0.01 },
  crackDepth: { min: 0.3, max: 0.9 },
  branchingProbability: 0.3,
  branchingAngle: { min: Math.PI / 12, max: Math.PI / 6 },
  chipping: true,
  chipCount: { min: 3, max: 12 },
  chipSize: { min: 0.02, max: 0.08 },
  youngsModulus: 12, // Along grain
  poissonRatio: 0.35,
  fractureToughness: 3.5,
  density: 600,
  interiorRoughness: 0.6,
  wallnerLines: false,
  hackleMarks: false,
  grainVisibility: 1.0,
};

// Concrete: Irregular chunks, aggregate pull-out
export const CONCRETE_PARAMS: FractureParameters = {
  patternType: 'irregular',
  crackCount: { min: 4, max: 12 },
  crackWidth: { min: 0.005, max: 0.03 },
  crackDepth: { min: 0.4, max: 0.8 },
  branchingProbability: 0.4,
  branchingAngle: { min: Math.PI / 8, max: Math.PI / 4 },
  chipping: true,
  chipCount: { min: 10, max: 40 },
  chipSize: { min: 0.01, max: 0.1 },
  youngsModulus: 30,
  poissonRatio: 0.2,
  fractureToughness: 1.2,
  density: 2400,
  interiorRoughness: 0.8,
  wallnerLines: false,
  hackleMarks: false,
  grainVisibility: 0,
};

// Plastic: Ductile tearing, necking, crazing
export const PLASTIC_PARAMS: FractureParameters = {
  patternType: 'ductile',
  crackCount: { min: 1, max: 3 },
  crackWidth: { min: 0.01, max: 0.05 },
  crackDepth: { min: 0.2, max: 0.6 },
  branchingProbability: 0.2,
  branchingAngle: { min: Math.PI / 4, max: Math.PI / 2 },
  chipping: false,
  chipCount: { min: 0, max: 5 },
  chipSize: { min: 0.01, max: 0.03 },
  youngsModulus: 2.5,
  poissonRatio: 0.38,
  fractureToughness: 5.0,
  density: 1200,
  interiorRoughness: 0.3,
  wallnerLines: false,
  hackleMarks: false,
  grainVisibility: 0,
};

// Rock: Fault-line fractures, cleavage planes
export const ROCK_PARAMS: FractureParameters = {
  patternType: 'fault',
  crackCount: { min: 3, max: 8 },
  crackWidth: { min: 0.002, max: 0.02 },
  crackDepth: { min: 0.5, max: 1.0 },
  branchingProbability: 0.25,
  branchingAngle: { min: Math.PI / 10, max: Math.PI / 5 },
  chipping: true,
  chipCount: { min: 8, max: 25 },
  chipSize: { min: 0.02, max: 0.12 },
  youngsModulus: 60,
  poissonRatio: 0.25,
  fractureToughness: 2.0,
  density: 2700,
  interiorRoughness: 0.7,
  wallnerLines: false,
  hackleMarks: true,
  grainVisibility: 0,
};

export const MATERIAL_PARAMS: Record<MaterialType, FractureParameters> = {
  [MaterialType.GLASS]: GLASS_PARAMS,
  [MaterialType.WOOD]: WOOD_PARAMS,
  [MaterialType.CONCRETE]: CONCRETE_PARAMS,
  [MaterialType.PLASTIC]: PLASTIC_PARAMS,
  [MaterialType.ROCK]: ROCK_PARAMS,
};

export function getMaterialParams(type: MaterialType): FractureParameters {
  return MATERIAL_PARAMS[type];
}

export interface ImpactData {
  position: [number, number, number];
  direction: [number, number, number];
  energy: number; // Joules
  contactArea: number; // m²
}