// Authoring data: the things the user draws and saves. The clean topology graph is derived from these (see topology.ts).

import { isProfileId, ProfileId, RoadOptions } from "./profiles";

export type BridgeType = "auto" | "girder" | "viaduct" | "arch" | "truss" | "cable-stayed" | "suspension";

export const BRIDGE_TYPES: BridgeType[] = ["auto", "girder", "viaduct", "arch", "truss", "cable-stayed", "suspension"];

export interface ControlPoint {
  x: number; // [m] - World X
  z: number; // [m] - World Z
  lift: number; // [m] - Height above ground (negative = below ground, used for tunnels and subway)
}

export interface Road {
  id: string;
  name: string;
  profile: ProfileId;
  points: ControlPoint[]; // Two or more control points, Catmull-Rom interpolated
  options: RoadOptions; // Per-road overrides of the profile defaults
  bridge: BridgeType; // Structure used where the deck is lifted above ground
  seed: number; // Drives every per-road variation (widths, tints, wear, prop spacing)
}

export type PropKind = "bollard" | "speedBump" | "lamp" | "crosswalk" | "railCrossing" | "stopLine";

export interface Prop {
  id: string;
  kind: PropKind;
  x: number; // [m] - World X
  z: number; // [m] - World Z
  yaw: number; // [rad] - Rotation about Y
}

export interface Project {
  format: "frontier-road-network";
  version: 1;
  name: string;
  seed: number;
  roads: Road[];
  props: Prop[];
}

let idCounter = 0;

export function newId(prefix: string): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyProject(name = "Untitled network"): Project {
  return { format: "frontier-road-network", version: 1, name, seed: 1, roads: [], props: [] };
}

// Validates and normalises untrusted JSON. Throws a readable error when the document is not a road network.
export function parseProject(text: string): Project {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object") throw new Error("Not a JSON object");
  const doc = raw as Partial<Project>;
  if (doc.format !== "frontier-road-network") throw new Error("Missing format marker 'frontier-road-network'");
  if (!Array.isArray(doc.roads)) throw new Error("Missing roads array");
  const roads: Road[] = doc.roads.map((r, i) => {
    if (!isProfileId(r.profile)) throw new Error(`Road ${i} has unknown profile '${String(r.profile)}'`);
    if (!Array.isArray(r.points) || r.points.length < 2) throw new Error(`Road ${i} needs two or more points`);
    return {
      id: String(r.id ?? newId("r")),
      name: String(r.name ?? `Road ${i + 1}`),
      profile: r.profile,
      points: r.points.map((p) => ({ x: Number(p.x), z: Number(p.z), lift: Number(p.lift ?? 0) })),
      options: { ...(r.options ?? {}) },
      bridge: (BRIDGE_TYPES as string[]).includes(r.bridge as string) ? (r.bridge as BridgeType) : "auto",
      seed: Number(r.seed ?? i + 1) >>> 0
    };
  });
  const props: Prop[] = (doc.props ?? []).map((p) => ({
    id: String(p.id ?? newId("p")),
    kind: p.kind,
    x: Number(p.x),
    z: Number(p.z),
    yaw: Number(p.yaw ?? 0)
  }));
  return {
    format: "frontier-road-network",
    version: 1,
    name: String(doc.name ?? "Imported network"),
    seed: Number(doc.seed ?? 1),
    roads,
    props
  };
}
