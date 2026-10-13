# Frontier — Infinite City Circuit

A procedural, infinite racetrack in a modern daylight city (no neon), inspired by
Wipeout Omega's wide anti-grav circuit furniture — but you drive a car with
NFS-style arcade physics (free steering, throttle/brake/reverse, speed-sensitive
steering, grip vs. handbrake-drift velocity split, nitro earned by drifting).
No lanes, no lane-snap, no auto-runner.

## Run
```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # production build
```

## Controls
WASD / Arrows drive · SPACE handbrake drift · SHIFT nitro · C camera · R reset · P pause
(Touch buttons appear on coarse-pointer devices.)

## What's generated forever
- **Wide track** (26 m, ~17 m per split branch) from a seeded spine generator:
  straights, sweepers, elevation changes, shuffled so features keep recurring.
- **Y-splits** (flat forks) and **up/down splits** (one branch climbs +6 m, the
  other dives) that diverge around a median island and rejoin.
- **Bridges** (arched deck on pillars) and overhead **sign gantries**.
- **Railways everywhere**: parallel ground lines both sides (same-direction +
  oncoming trains), elevated **monorails** both sides on pillar beams, and
  **perpendicular railways** cutting through the track — an at-grade crossing
  train you can actually hit (watch for the TRAIN CROSSING warning/gates) plus
  a second monorail crossing **in the air above you**.
- Modern city: procedural glass/concrete towers, street furniture, daylight
  sun + fog — deliberately not a neon city.

## Code
- `src/main.js` — spine/section generator, chunked ribbon geometry + streaming,
  train systems, arcade car physics, chase cameras, HUD.
- `index.html` / `src/style.css` — menu, HUD, touch controls.
