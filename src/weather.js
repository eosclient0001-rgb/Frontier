// Footprint is the voxel-scale influence radius, not the physical projectile
// diameter. Profiles are cached by the UI; each GPU agent keeps its birth type,
// diameter, footprint and restitution when a different emitter is selected.
export const WEATHER_PROFILES = [
  {
    id: 0,
    name: "Rain",
    description:
      "Water parcels arrive over exposed terrain, become runoff and join the stream.",
    footprint: 0.85,
    agentDiameter: 3,
    restitution: 0.08,
    min: 0.5,
    max: 8,
    step: 0.5,
  },
  {
    id: 1,
    name: "Runoff",
    description:
      "A concentrated source on the upper rock. The river can entrain its sediment below.",
    footprint: 0.75,
    agentDiameter: 5,
    restitution: 0.06,
    min: 1,
    max: 15,
    step: 0.5,
  },
  {
    id: 2,
    name: "River",
    description:
      "Low-level agents enter the canyon current and scour the bed and banks—not from the sky.",
    footprint: 0.95,
    agentDiameter: 10,
    restitution: 0.03,
    min: 2,
    max: 30,
    step: 1,
  },
  {
    id: 3,
    name: "Wind",
    description:
      "Sand-bearing agents enter from upwind at the selected height, abrade rock and settle.",
    footprint: 0.6,
    agentDiameter: 0.12,
    restitution: 0.35,
    min: 0.02,
    max: 1,
    step: 0.02,
  },
  {
    id: 4,
    name: "Rockfall",
    description:
      "Larger projectiles fall, bounce and chip rock. Coarse debris breaks down and can enter the river.",
    footprint: 1.1,
    agentDiameter: 70,
    restitution: 0.48,
    min: 10,
    max: 250,
    step: 5,
  },
  {
    id: 5,
    name: "Chemical",
    description:
      "Wet contact dissolves material according to reaction rate and saturation, without a shear threshold.",
    footprint: 0.7,
    agentDiameter: 2,
    restitution: 0.02,
    min: 0.5,
    max: 8,
    step: 0.5,
  },
];
export function profileFor(mode) {
  return WEATHER_PROFILES.find((p) => p.id === mode) || WEATHER_PROFILES[0];
}
export function profileSettings(profile) {
  return {
    footprint: profile.footprint,
    agentDiameter: profile.agentDiameter,
    restitution: profile.restitution,
  };
}
