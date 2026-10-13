# Frontier — infinite procedural city racer

Vite + Three.js (0.160). An endless multi-lane city road is generated ahead of the car and pruned behind it.

## Run

```
npm install
npm run dev        # http://localhost:5173 (bound to 0.0.0.0)
npm run build      # production bundle in dist/
npm test           # node --test on tests/*.test.js
```

## Layout

- `src/world/` road graph: `route.js` (infinite generation, Y-splits, up/down ramps, viaducts, monorail runs, rail crossings), `section.js` (sampled centrelines), `generator.js` (block plans), `constants.js`.
- `src/sim/` logic: `vehicle.js` (arcade bicycle model with tyre saturation, load transfer, handbrake drift, traction control, nitro), `surface.js` (which road the car is on), `traffic.js` (cars both ways, monorail and parallel trains), `trains.js` (perpendicular trains behind level-crossing barriers, elevated rail/monorail crossings).
- `src/game.js` run rules: timer and checkpoints, barriers and train strikes, near misses, drift score, respawn.
- `src/render/` three.js: `sectionBuilder.js` / `geom.js` (merged road, rail and city geometry per section), `world.js` (streams sections, gates and trains in and out), `vehicles.js` (car, instanced traffic, trains), `env.js` (renderer, sun, sky, bloom), `fx.js` (speed streaks, sparks, tyre smoke), `materials.js`.
- `src/ui/` input (keyboard and gamepad), HUD and minimap, procedural WebAudio.

## Controls

W/↑ throttle · S/↓ brake · A/D steer · Space handbrake (hold to drift) · Shift/E nitro · C camera · P/Esc pause · R new track · Enter start.
