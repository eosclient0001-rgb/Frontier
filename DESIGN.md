# SET LINE — game design

**One-liner:** *Surf a real, breaking wave — a hollow peeling wall that pitches a
lip, tubes you, and buries you if you blow the trim.*

---

## 1. Pillars

1. **The wave is the game.** Everything else is cheap; the wave is allowed to be
   clever. A surfer should recognise the moment the lip pitches.
2. **Real surf physics, arcade controls.** The face is a moving half-pipe: you
   trade height for speed, race the peel down the line, and survive in the
   pocket. Two keys ride it, one key tucks into the barrel.
3. **Rides, not laps.** Every wave is a set wave with a beginning (the paddle
   and catch), a middle (the pocket race), and an end (kick out, closeout, or
   get eaten). Score the ride, then wait for the next set.

## 2. The loop

```
title/atact ──SPACE──▶ PADDLE (set is coming) ──catch window──▶ RIDE
     ▲                                                          │
     └────────────── SCORECARD ◀── kick out / closeout / wipeout ┘
```

* **Paddle & catch** — hold SPACE to paddle. The crest lifts you; pop up
  before it passes under you. Waiting for a steeper face = a *late drop*
  (score bonus, less margin for error).
* **Ride** — the peel unzips toward +Z at 8–11 m/s. Stay **ahead of the foam**
  (the pocket) while riding high on the face. Run too far ahead and you're on
  a fat shoulder; fall behind and the soup climbs over the tail.
* **Score the ride** — distance, speed, linked maneuvers (combo ×1–×5),
  barrel time (hold SHIFT under the lip), airs, late drop, covered closeout.
* **Endings** — `K` kicks out clean (bank 100%), the bar ends the wave in a
  **closeout** (bank 100% + bonus), a wipeout banks 50%.

## 3. Controls

| input | action |
|-------|--------|
| `A` / `D` (←/→) | carve / steer on the face |
| `W` / SPACE | pump (speed) · paddle · catch |
| `S` (↓) | stall / air-brake (let the pocket catch up) |
| SHIFT | tuck — required to survive inside the barrel |
| `K` | kick out |
| `C` | cycle cameras (chase / wide / barrel cam) |
| `F` | free-fly camera — hold RMB to look, WASD fly, Q/E down/up, SHIFT fast, wheel speed |
| `R` | new wave |
| SPACE on cards | next set |

## 4. Why it feels like surfing

* The board lives on a **moving heightfield**. Gravity along the slope is the
  engine; the translating crest lifts and shoves you (`dY/dt` shove term in
  `physics.js`) — the wave literally pushes.
* **Down the line is downhill**: the wall tapers into the shoulder ahead of
  the peel, so holding the pocket is a descent, not a drag race.
* **Carve, don't slide**: velocity is locked to the board heading (rail grip),
  with a scrub for hard turns — bottom-turn to gain height, top-turn to cash
  it in for speed.
* **Wipeouts are surf wipeouts**: over the falls (too high while the lip
  throws), the lip landing on an untucked rider, or the foam ball climbing
  over you.

## 5. Scoring

| event | points |
|-------|--------|
| per meter down the line | ×2.2 ×combo |
| snap / cutback / re-entry | 120–150 ×combo ×speed |
| clean air | 260 ×combo |
| barrel | 55/s ×combo (combo +1 at 1.2 s) |
| late drop | 300 |
| pump | 2 (style drip) |
| clean kickout | +150 |
| covered closeout | +400 |
| wipeout | bank 50% of the ride |

Combo decays after ~3 s without an action. Barrel time and distance are shown
on the ride card.

## 6. The wave — "realistic but cheap"

Full write-up in the source (`src/waveshape.js`). Summary of the trick:

* **Closed-form everything.** No FFT ocean, no simulation, no textures. The
  sheet is one static `(segment, t, z)` grid; the vertex shader evaluates an
  analytic profile per vertex.
* **Break stage `b(z,t)`** = how long ago the peel point passed this section.
  `b<0` clean wall, `0..1` pitching lip, `1..2` lip landed / foam climbing,
  `>2` settling soup. The peel point races along the crest line — the wave
  *unzips*.
* **The crest cross-section is an 8-point morph** (Catmull-Rom, centripetal):
  a leaning rounded rim on the wall → a thrown lip + tube ceiling when hollow
  → a lumpy foam pile when it's soup. Real **overhang geometry** (the barrel)
  from a plain strip mesh, zero topology changes.
* **Same math on the CPU** for the surfboard collision — no readbacks.
* Lighting sells it: fresnel sky reflection (analytic sky reused for
  reflections — no cubemap), sun glitter, fake subsurface glow through the
  thin lip, domain-warped fbm foam, offshore spray particles.

Budget: one water draw (~75k tris), sky, sand, surfer, points. Runs on
integrated GPUs.

## 7. Conditions & variation

Each set wave rolls: face height (2.7–3.9 m), phase speed, peel speed (8–11
m/s — fast & hollow vs. racy), curl radius, crest-line meander, wind
(offshore = feathering spray), sun angle. The HUD shows the "forecast".

## 8. Roadmap (not in v1)

* Aerials are in (SPACE off the lip) but tuned lightly — add grab scoring &
  rotations.
* Board shaper (rocker/rail width changing trim), twin-fin vs. step-up.
* Left-handers (mirrored peel) + point-break setups with inside sections.
* Replay cam of the best barrel of the session.
* Gamepad + touch.
