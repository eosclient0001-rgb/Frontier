// Shared world/road dimensions (metres, seconds). Everything else is derived from these.
export const ROAD = {
  MEDIAN_HALF: 1.6, // half width of the central reservation
  LANES: 3, // lanes per carriageway
  LANE_W: 3.8,
  SHOULDER: 2.5,
};
ROAD.CARRIAGE = ROAD.LANES * ROAD.LANE_W; // 11.4 m per direction
ROAD.OUTER = ROAD.MEDIAN_HALF + ROAD.CARRIAGE + ROAD.SHOULDER; // 15.5 m from centre to outer barrier
ROAD.WALL_LO = ROAD.MEDIAN_HALF + 0.9; // player clamp (inner, near the median)
ROAD.WALL_HI = ROAD.OUTER - 0.9; // player clamp (outer guard rail)

export const ELEV_HIGH = 10; // viaduct deck height above city ground
export const MONO_BEAM_AIR = 8.5; // monorail beam above deck (elevated style)
export const MONO_BEAM_GROUND = 1.4; // monorail beam above deck (low, ground style)
export const RAIL_PAR_LAT = 25; // parallel heavy-rail tracks sit this far from centre
export const RAIL_AIR_H = 9; // heavy-rail elevated crossing height above road
export const RAIL_HALF_LEN = 240; // perpendicular rail lines extend this far each side of the road
export const TRAIN_H = 4.2;
export const CLEARANCE = 34; // new road may not come closer than this to older road (same level)
export const KEEP_BEHIND = 420; // sections older than this (metres) are pruned
export const AHEAD = 1400; // route is generated this far in front of the car
export const GRAVITY = 9.81;
export const GATE_OFFSET = 13; // distance of level-crossing barrier from rail centre
