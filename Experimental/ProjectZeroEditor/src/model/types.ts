/**
 * Road network data model. Everything here is plain JSON so a network can be
 * saved, diffed, versioned and generated deterministically.
 *
 * Coordinate system: metres, Y-up. Roads live on the XZ plane (y = 0 is the
 * ground). Heights for raised bands come from the lane layout, not from data.
 */

export interface V2 {
  x: number;
  z: number;
}

/** Lane kinds that can appear on a cross-section. */
export type LaneType =
  | 'driving'
  | 'bus'
  | 'bike'
  | 'parking'
  | 'shoulder'
  | 'sidewalk'
  | 'pathway'
  | 'railway';

export type CentreKind = 'none' | 'doubleYellow' | 'dashedWhite' | 'median';

export interface Lane {
  type: LaneType;
  /** Width in metres, > 0. */
  width: number;
}

/**
 * Cross-section of a road segment. Lists run from the centreline outward:
 * `left[0]` is the lane adjacent to the centre on the left of travel direction.
 */
export interface LaneProfile {
  centre: { kind: CentreKind; width: number };
  left: Lane[];
  right: Lane[];
}

export type RoadClass =
  | 'highway'
  | 'arterial'
  | 'boulevard'
  | 'local'
  | 'path'
  | 'rail'
  | 'subway';

export interface RoadNode {
  id: string;
  x: number;
  z: number;
}

export interface RoadSegment {
  id: string;
  from: string;
  to: string;
  /** Bezier handle positions (absolute). Straight segments have handles at 1/3 and 2/3. */
  c1: V2;
  c2: V2;
  cls: RoadClass;
  profile: LaneProfile;
  name?: string;
}

export type PropKind =
  | 'bollard'
  | 'speedBump'
  | 'railCrossing'
  | 'crosswalk'
  | 'stopLine'
  | 'subwayEntrance';

export interface Prop {
  id: string;
  segmentId: string;
  /** Position along the segment as a fraction of arc length, 0..1. */
  u: number;
  kind: PropKind;
  /** Signed lateral offset from centreline in metres (+ left). */
  lateral: number;
}

export interface RoadNetwork {
  version: 1;
  nodes: Record<string, RoadNode>;
  segments: Record<string, RoadSegment>;
  props: Record<string, Prop>;
}
