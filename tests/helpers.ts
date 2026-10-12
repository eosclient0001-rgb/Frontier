import type { Road } from "../src/core/model";
import type { ProfileId } from "../src/core/profiles";

export function makeRoad(id: string, pts: [number, number, number?][], profile: ProfileId = "avenue", seed = 7): Road {
  return {
    id,
    name: id,
    profile,
    points: pts.map(([x, z, lift = 0]) => ({ x, z, lift })),
    options: {},
    bridge: "auto",
    seed
  };
}
