# Frontier — *Tyrannosaurus rex* skeleton, walk / run / idle

A T. rex skeleton built in HTML/WebGL from real measurements. It is built bone by bone at the scale of **FMNH PR 2081 "Sue"** and animated in code, with smooth transitions between idle, walk and run.

**Run it:** `npm run serve`, then open http://localhost:8080. Serve it over HTTP — do not double-click `trex/index.html` as `file://`, because the browser will block the ES-module import map. Plain static files with three.js bundled in `trex/vendor/`, so there's no build step and it works offline once served.

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
- Behaviour studies: **L** look around, **Y** sniff air, **U** sniff the ground, and **O** roar in place. These are planted-feet one-shots; the buttons expose the same actions.

## Controls
| Key | Action |
|---|---|
| W / S | speed up / slow down |
| A / D | steer while moving (turns on the spot when stopped) |
| Q / E | turn 90° left / right in place (feet step round, no sliding) |
| F | bite |
| Z / C | tail swipe to the left / right |
| R | roar (the lower jaw drops) |
| L | look around |
| Y / U | sniff air / sniff ground |
| O | roar in place (planted feet) |
| T | start / stop hunting the ball |
| 1 / 2 / 3 | idle / walk / run |
| Space · H | pause · hide the UI |

**Hunt the ball.** Press *Start hunt* and drag the red ball anywhere (flick it to throw).
The T. rex tracks the ball with its head, runs, walks or pivots towards it, and attacks
when it gets close:
* **Bite:** the ball is in front, 4.4–7 m from the hips. The animal braces rather than folding at the waist: the tooth row is aimed down, the lower jaw opens and closes vertically, then the closed skull makes a short puncture-and-pull before recovery. On a catch it gives only a restrained shake and flings the ball.
* **Tail swipe:** the ball is beside or behind the hips, inside the measured sweep of the tail
  (about 4–6 m out). The feet plant, the hips load the opposite side, the chest counter-turns, and a travelling caudal wave delivers a low distal strike before recovering.
* If the ball is under its chin, the T. rex turns away, opens up some distance and comes back round.

Hits are checked against the real geometry: the tooth row at the moment the jaws snap, and
each tail vertebra during the sweep. In **Flees** mode the ball runs away and dodges
until it tires.

Bones use plain matte finishes (ivory, brown, ochre, grey). The procedural fossil texture is
an optional toggle.

## Retargeting / replacing the proxy bones
The approximate display geometry is now driven through a stable transform-only registry in `trex/js/retarget.js`. The registry contains **346 unique named joints**, including every cervical, dorsal, sacral and caudal vertebra, paired ribs and gastralia, chevrons, pelvis and pectoral elements, skull/mandible sides, both forelimbs, all metatarsals and the complete pedal phalange chains. Missing proxy geometry does not mean a missing rig joint: every entry is an `Object3D` with a stored bind position, quaternion and scale.

The same procedural animator continues to drive the existing arrays (`trunk`, `neck`, `tail`, `arms`, `legs`). Replacement meshes inherit those animated parents. In browser code, attach a replacement authored in the joint's local frame like this:

```js
const bone = gltf.scene.getObjectByName('fibula.L');
__trex.skel.attachBoneMesh('limb.hind.fibula.L', bone);
// or: __trex.skel.replaceBone('vertebra.caudal.12', anotherBone)
```

Useful API: `skel.boneNames`, `skel.getJoint(name)`, `skel.retarget.validate(names)`, `skel.clearBoneMesh(name)`, and `skel.resetBoneMeshes()`. The canonical IDs are deliberately side- and element-specific, so a later GLTF set can be mapped without changing animation code.

## Tests
`npm test` builds the rig headlessly and checks bone counts and size, verifies all 346 retarget joints and replacement slots, and runs idle → walk → run → stop. It checks no foot sliding, no stretched bones, no ground penetration or NaNs, plus the jaw-down roar, look, air/ground sniff, planted roar, turn, bite, tail and hunt actions.
`node tests/render.mjs side|front|top|threeq|skull <t> <speed> out.png [flesh]` renders PNG images without a browser.
