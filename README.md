# Frontier — *Tyrannosaurus rex* skeleton, walk / run / idle

A T. rex skeleton built in HTML/WebGL from real measurements. It is built bone by bone at the scale of **FMNH PR 2081 "Sue"** and animated in code, with smooth transitions between idle, walk and run.

**Run it:** `npm run serve`, then open http://localhost:8080. Plain static files with three.js bundled in `trex/vendor/`, so there's no build step and it works offline.

## Anatomy (matched to the published specimen)
| | Model | Sue (published) |
|---|---|---|
| Total length | 12.3 m | 12.3–12.4 m |
| Top of ilium | 3.68 m | 3.66–3.96 m |
| Skull | 1.46 m, 94.5 cm wide | 1.46 m / 94.5 cm |
| Femur / tibia / MT III | 132.1 / 124.5 / 67.1 cm | same |
| Vertebrae | 10 C + 13 D + 5 S + 47 Ca | same (Sue's mount) |
| Longest rib | 147.8 cm | 147.8 cm |

- Skull: the fenestrae are real holes (naris, maxillary, antorbital, keyhole orbit, lateral temporal, supratemporal). It has lacrimal and postorbital bosses, and 4 + 12 + 14 teeth per side. The mandible has the external mandibular fenestra.
- Body: ribs sized by arc length, 19 pairs of gastralia, and a furcula. The pelvis has the pubic boot. The forelimbs have two fingers. The feet are arctometatarsalian, with toe formula 2‑3‑4‑5 and a hallux (dewclaw).
- Hover over any bone to see its name and size.

## How it moves
- **One gait continuum, not blended clips.** Stride length, cadence, duty factor, body bob, crouch, lean and sway are all set by speed. As a result, feet never slide during a transition.
- The walk is an inverted pendulum: the hips are highest at mid‑stance. The run is spring‑mass: the hips are lowest at mid‑stance and there is an aerial phase. The switch happens around 5 m/s (Froude ≈ 1), and top speed is 7.2 m/s, following Sellers et al. 2017 and Hutchinson 2004.
- Planted feet stay fixed in world space. A 3‑bone leg IK controls heel rise and toe‑off. When the animal stops, it takes a final step to square its feet.
- Idle: breathing, weight shifts, looking around, sniffing, jaw movement and a roar (**R**).

## Controls
| Key | Action |
|---|---|
| W / S | speed up / slow down |
| A / D | steer while moving (turns on the spot when stopped) |
| Q / E | turn 90° left / right in place (feet step round, no sliding) |
| F | bite |
| Z / C | tail swipe to the left / right |
| R | roar (the lower jaw drops) |
| T | start / stop hunting the ball |
| 1 / 2 / 3 | idle / walk / run |
| Space · H | pause · hide the UI |

**Hunt the ball.** Press *Start hunt* and drag the red ball anywhere (flick it to throw).
The T. rex tracks the ball with its head, runs, walks or pivots towards it, and attacks
when it gets close:
* **Bite:** the ball is in front, 4.4–7 m from the hips. The body tips forward over the hips,
  the neck lunges, the jaws snap shut, and on a catch it shakes its head and flings the ball.
* **Tail swipe:** the ball is beside or behind the hips, inside the measured sweep of the tail
  (4.6–5.5 m out). The hips pivot and the tail whips low through the ball.
* If the ball is under its chin, the T. rex turns away, opens up some distance and comes back round.

Hits are checked against the real geometry: the tooth row at the moment the jaws snap, and
each tail vertebra during the sweep. In **Flees** mode the ball runs away and dodges
until it tires.

Bones use plain matte finishes (ivory, brown, ochre, grey). The procedural fossil texture is
an optional toggle.

## Tests
`npm test` builds the rig headlessly and checks bone counts and size, and runs idle → walk → run → stop. It checks for no foot sliding, no stretched bones, no ground penetration and no NaNs.
`node tests/render.mjs side|front|top|threeq|skull <t> <speed> out.png [flesh]` renders PNG images without a browser.
