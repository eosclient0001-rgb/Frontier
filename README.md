# FRONTIER GP — Infinite Procedural Racer

An endless, procedurally-built wide-track arcade racer in a **modern daylight city**
(no neon). The track drives like **WipEout** (wide, banked, smooth, forked race
lines, overhead gantries), the car handles like **Need for Speed arcade physics**
(free steering anywhere — *not* a lane runner), and a living railway network runs
beside, above and straight through the circuit.

## Run it

```bash
# any static server works, e.g.
python3 -m http.server 8000
# then open http://localhost:8000
```

(Three.js is loaded from CDN, so an internet connection is needed on first load.)

## Controls

| Input | Action |
|---|---|
| `W A S D` / Arrow keys | Accelerate, steer, brake/reverse |
| `SPACE` | Handbrake — cut grip and drift |
| `SHIFT` | Boost |
| `R` | Reset car to track |
| `C` | Camera (chase / far chase / hood) |
| `M` | Engine sound on/off |
| Touch buttons | Mobile steering / pedals |

## What's in the world

- **Infinite procedural track** — seeded spine generation streamed in 60 m chunks
  that build ahead and recycle behind you. It never ends.
- **19 m-wide track** with banked curves, climbs, descents and crests, red/white
  kerbs, orange edge strips and futuristic barriers.
- **Y-splits** — the track forks left/right into two 12.5 m lines, then merges.
- **Up/down splits** — stay low, or take the elevated **bridge line** (13 m wide,
  on pillars) running above the low line.
- **Bridges** — elevated main-line sections on concrete pillars over the city.
- **Parallel ground railway** (left) with **oncoming** trains.
- **Parallel elevated monorail in the air** (right) with **same-direction** trains
  you can race alongside.
- **Perpendicular ground level-crossings** — trains drive straight *through* the
  track. Flashing signals, closing barrier arms… and a real collision if you
  ignore them.
- **Perpendicular aerial rail bridges** — trains pass overhead across the track.
- **Overhead rail/sign gantries** warning of splits, crossings and sectors.
- **Modern city** — daylight glass/concrete towers, sidewalks, trees, service
  roads and clouds. Deliberately no neon.

## Car physics (NFS-style arcade, not Subway-Surfers lanes)

`src/car.js` implements a free-driving arcade model:

- speed-sensitive steering with a bicycle-inspired yaw rate,
- lateral-grip model: grip continuously bleeds sideways velocity; the
  handbrake cuts grip so the car genuinely **drifts** (with slide provocation),
- throttle taper, aero drag, slope gravity, brake → reverse, boost,
- barrier scrapes, jumps off crests and bridge edges, rough off-track
  city-street driving — you can leave the track and rejoin anywhere.

## Code layout

| File | Role |
|---|---|
| `index.html` | HUD, menus, touch controls |
| `src/main.js` | Renderer, camera, game loop, HUD, train-collision checks, engine synth |
| `src/track.js` | Infinite generator (spine, splits, bridges), chunk meshing, parallel rails, perpendicular crossings, gantries, city blocks, surface sampling |
| `src/car.js` | Car model + arcade physics |
| `src/trains.js` | Train models + parallel ground/monorail traffic system |

Generation stats (seeded): roughly one split every ~700 m, a perpendicular
rail crossing every ~600–900 m, track elevation varying 0–35 m — all while
chunk count and memory stay flat forever.
