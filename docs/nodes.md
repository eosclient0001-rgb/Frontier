# Frontier SDF — Node Reference (v1)

Every socket carries a 3D signed-distance field. The chain ending at
**Terrain Output** compiles to one GLSL `baseField()` evaluated per voxel on
the GPU. Editing any chained node rebuilds the base volume and restarts erosion.

## Sources (no inputs)

- **Land Plot** — bevelled box landmass, movable/rotatable. Usual root.
- **Sphere / Box / Cylinder / Capsule / Torus** — primitives with roughness.
  Torus axis Y = flat ring, Z = standing ring (arch cutter).
- **Ridge** — tapered mountain ridge with roughness.

## Modify (1 input)

- **Noise Detail** — fBm / ridged / billow displacement.
- **Terrace** — Y quantization for strata benches.
- **Domain Warp** — fBm space warp before sampling the child.
- **Cave Worms** — carves tunnel networks (`max(d, tunnel)`), Y-masked.

## Combine

- **Union / Subtract / Intersect** — CSG with optional smooth blend.
- **Transform** — translate + Y-rotation + uniform scale (distance rescaled).

## Erosion (pass field through, drive the live sim)

Must be **enabled and chained into the output** to take effect, else flagged
"bypassed". Same-kind duplicates merge (max intensity).

- **Rain Erosion** — intensity, capacity, detach, deposit, evaporation,
  drop size, footprint.
- **River** — inlet X/Z (surface auto-found), flow dir bias, width, speed, scour.
- **Wind** — direction°, speed, emission height/spread, grain size, abrasion.
- **Thermal / Talus** — repose angle°, rate, restitution.

## Tips

- Subtract a standing torus from a mesa for an instant sea arch.
- Cave Worms after noise, before erosion: tunnels stay crisp, rain weathers rims.
- River inlet sits anywhere — the emitter sphere-traces down to the surface,
  so mountain-top sources flow downhill for real.
- Disable (◌) any node to bypass it without rewiring.
