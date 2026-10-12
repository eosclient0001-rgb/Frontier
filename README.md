# Frontier Road Editor

A procedural and hand-authored road editor for a 4 km square NFS-style map. Roads are authored as control points
with lift; the topology graph, junctions, bridges, crossings and props are derived from them. No boolean operations.

## Run

    npm install
    npm run dev        # editor on port 5173
    npm test           # topology, junction and generator tests
    npm run build      # typecheck + production build

## Editor

- **Select (V)**: click a control point or a road; drag points on the ground; Delete removes a point or road.
- **Draw (B)**: click to add points, Enter or double-click to finish, Backspace removes the last point.
- **Prop (P)**: place bollards, speed bumps, lamps, zebra crossings, rail crossings and stop lines. R rotates.
- **Camera**: hold right mouse to look, W A S D move, Q/E down and up, Shift boosts, wheel changes speed.
- **Undo/redo**: Ctrl Z / Ctrl Shift Z. Ctrl D duplicates the selected road.
- **Generate**: seeded city, ring road, elevated motorway, river crossings, railway, subway, countryside and footpaths.
- **Save/Load**: JSON (`frontier-road-network`). **Export GLB** writes the built world.

## Topology rules

- Roads that meet at equal height merge into one node (+, T, Y, or more ways). Endpoints snap to nearby road ends
  (4 m) or road bodies (6 m, T junction).
- Crossings where the surface height differs by 4 m or more are grade separated and keep separate nodes.
- A crossing between a railway and a road at ground height becomes a level crossing with barriers.
- Parallel roads that overlap are rejected by the generator and reported by `validateNetwork`.

## Bridges

Girder, viaduct, arch, truss, cable-stayed and suspension. With Auto, spans are chosen by length and whether the
deck crosses water. Long dry elevated stretches use piered structures; cable-stayed and suspension decks are used
for river spans only.

## Layout

- `src/core/` model, profiles, sampling, topology, junction, validate, generator, terrain (pure, testable)
- `src/mesh/` surface, junction, bridge, prop and terrain geometry, merged per material
- `src/app/` Three.js viewport, fly camera, editor panes (palette follows the reference repo's design tokens)
- `tests/` Vitest suites
