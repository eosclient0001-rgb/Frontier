# FRONTIER APEX — Infinite City GP

A procedural, endless, Wipeout-wide elevated racetrack threaded through a **modern
daylight city** (glass towers, streets, trees — no neon), driven with **NFS-style
arcade car physics**: free steering, forward/lateral grip model, handbrake drifts,
nitro, airborne crests, barrier scrapes. No lanes, no lane-snapping, no maze runner.

## Run

```bash
npm install
npm run dev      # open the printed URL, click START ENGINE
npm run build    # production build
```

## What's in the world

| Feature | Implementation |
|---|---|
| **Infinite procedural track** | The circuit is a pure function of distance `s` (`src/trackMath.js`). Geometry chunks (46 × 24 m) are recycled ahead of the car and deleted behind — it never ends and the layout is deterministic. 26 m wide, banked, with crests and bridge pylons. |
| **Y-splits** | Every ~560 m the deck forks into two real branches with a gap and divider walls. Commit to a side; you can only swap back at the merge. |
| **Up/down splits** | Alternating forks send the right branch up an 8.5 m bridge deck (with its own pylons) while the left stays low, then ramp back down to rejoin. |
| **Parallel monorails — ground + air** | Left of the track: a ground monorail whose trains travel **with** you. Right: an elevated air monorail on pylons whose trains come **at** you (oncoming). Both follow the circuit's curves forever. |
| **Perpendicular railways** | Every ~430 m a railway crosses the circuit at right angles, alternating: **gated level crossings** (embankment, rails across the deck, barrier gates, flashing red lights, a train that *will* hit you) and **rail bridges** where the train flies over your head. |
| **Gantries** | Overhead sign gantries warn you what's coming: `Y-SPLIT`, `UP/DOWN SPLIT`, `RAIL CROSSING`. |
| **Modern city** | Procedurally placed glass/concrete towers (kept clear of the rail corridors), street grid, trees, clouds, low sun with shadows. |
| **Arcade car (NFS-style)** | `src/car.js` — speed-sensitive steering, grip vs. handbrake drift, slope gravity, jumps/landings, boost pads, traffic cars, barrier bounce, drift score + nitro economy. |
| **HUD** | Speed, distance, time, drift score, nitro/slip bars, live warnings, and a track-ahead minimap (red = rail crossing, orange = split). |

## Controls

- **WASD / Arrow keys** — accelerate, brake/reverse, steer
- **SPACE** — handbrake (drift) · **SHIFT** — nitro · **C** — camera (chase / low / hood)
- **R** — reset onto the track · **M** — mute engine · **ESC** — pause
- Touch controls appear on mobile.

Orange chevron pads on the deck are boost pads — hit them for a burst and nitro refill.
