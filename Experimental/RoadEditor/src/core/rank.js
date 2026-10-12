// Class ranking, shared by the generator (grade separation), the geometry pass (bank allowance) and
// the validator (junction spacing, protection level). One table, one meaning: higher means more road.

export const CLASS_RANK = {
  motorway: 7, expressway: 6, ramp: 6, arterial: 5, busway: 5, collector: 4, tramway: 4,
  local: 3, lane: 2, service: 1, cycleway: 0, footway: 0, pedestrian: 0, 'parking-aisle': 0,
};

export const rankOf = (cls) => CLASS_RANK[cls] ?? 3;
