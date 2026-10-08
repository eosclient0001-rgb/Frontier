# Strand Editor: reference notes, 2026-10-08

Notes behind the second pass on the Strand Editor. They record what the reference techniques do, what the
editor takes from them, and what it deliberately leaves out. The tool README is
[StrandEditor.md](StrandEditor.md).

## The request

- Make the frames stop looking like a blue haze: **black background**, not dark blue.
- Make the splines **thinner**.
- Use **objects like flowers** as sources of fibres, as in the blue flower reference.
- **Pulse**, the way automotive ambient lighting does.
- Make strands **follow a path or an object**, which the request framed by the After Effects plug-in Trapcode.

The eight reference images came in the chat. They are not stored in the repository, and comparisons with them are
by eye. Briefly: a green fibre swoosh with the title "TO BE"; a blue flower built from fibres; two blue particle
waves; a dark sheet of particles; a blue radial ring of strands; a green leaf with glowing lines; a teal dotted wave;
and blue organic strands with a title.

## What Trapcode does, and what the editor takes

**Particular: a trail is a wake of glow spheres.** An Aux system emits a dense stream of small glow spheres behind a
lead particle. Their size drops over life, so the stream reads as a thin tail. The advice is to zero the velocities,
keep the life to a few seconds, use glow spheres, and emit a high count, so that wherever the emitter goes it leaves
a wake [1]. The editor takes the idea that a trail is a sequence of small fibres behind a head, tapered at the tail
(*Trail length*, *Taper*), rather than a single line.

**Particular: emitters follow a motion path.** A Layer emitter can be set to a solid carrying a mask path, and the
emitter's path position controls where along it particles are born [2][3]. The editor takes the idea of one shared
path that many layers ride. Its *Path shape* and *Path radius* are scene settings, and *Ride the scene path* moves a
flower head along the path with the same phase used by its trail.

**Tao: geometry along a path, with taper and offset loops.** Tao generates 3D geometry along a stroke or path, with
tapered, animated growth and an offset system for looping [4][5]. The editor takes the taper, the animated growth
(the head moves along the path while the trail follows) and the seam: every path is closed, so a trail can cross
the loop seam without a jump. The check *the path is closed* pins that.

**What the editor leaves out.** Particular's particle physics, turbulence, depth of field and motion blur, and Tao's
extrusions, image-based lighting and wireframe pass are not reproduced. Strands are GPU-generated fibre bundles, and
the only particles are sparks at the fibre heads and the dust layer.

## Automotive pulsing

Ambient lighting in cars already runs on a small vocabulary of pulses. One aftermarket interior strip offers breathing,
flashing and gradient modes [8]. The OEM systems pulse a light for states: a red and green
animation for locking and unlocking, a white pulse when the car goes into park, reverse, neutral or drive, and a
welcome and goodbye animation [6]. Addressable LEDs allow flowing animations that move across the dashboard like a
wave [7].

The editor maps this onto three shapes:

- **Breathe** is one eased inhale and exhale per pulse, the whole layer together. It corresponds to the breathing
  mode.
- **Heartbeat** is two short beats and then rest. This shape is a design choice; the sources describe breathing and
  state animations, not this exact pattern.
- **Ripple** is a sine that runs outward along each fibre. It corresponds to the flowing wave.

Pulses are periodic in the loop, so the frame at the loop length equals frame 0. The CPU mirror in
`Source/PulseSpecification.js` pins the range, the periodicity and the two beats of the heartbeat.

## Design decisions

- **Black is exact.** The background is `#000000`, and grain multiplies the frame rather than adding to it. With
  every layer hidden, every preset reads 0 of 255, which the proof measures.
- **Thin is one pixel at the default view.** Widths are 3 to 6 mm, and a sharp core carries the line while a halo
  carries the glow. *Superseded in the third pass; see below.*
- **Flowers are procedural.** A flower is a root cluster with petal fibres to a lobed rim, a cup depth, a petal
  count and an opening pulse. No mesh is imported.
- **Paths are sampled at equal arc length.** A parametric curve speeds up and slows down, and light would bunch where
  it slows. The table is resampled by chord length, so the speed is even. The check bounds the spacing ratio at 1.1. A table spaced by parameter would reach about 5 on the rose, where the curve speed varies from 1 to 5.
- **The proof measures what it claims.** Path following is checked on pixels: the bright pixels of a trail, rendered
  alone with glow off, are counted against the path as the camera projects it.

## Third pass: thin fibres, sparse trails and the automotive trim

**The fault.** Checked by eye against the references, the second-pass frames had two faults. Fibres were drawn as beads,
and trails were tubes. Width was set in metres (3.5 to 6 mm). At the default camera that is under one pixel, so each quad
rasterised as a short run of dots, and the halo and bloom turned the dots into bands. Trails had up to 1,100 fibres
bunched within a few percent of one arc, so their glow stacked into a solid neon tube.

**Thin fibres, in pixels.** The core is a Gaussian whose full width at half brightness is `Thickness` pixels at 1080 p,
scaled by frame height, with a floor of 0.8 px. The quad is widened in pixels to the halo envelope, so the width holds
at any distance. *Taper* now fades a fibre toward its ends. The width is measured, not assumed: a single straight fibre
reads 1.07 px at 1280 × 720 at 6 m and at 24 m, and 1.60 px at 1920 × 1080, which is what the model predicts for
Thickness 1.6. The probe runs in the browser proof.

**Sparse trails.** Trails have 120 to 340 fibres spread around the whole path (*Phase spread* 2π), each covering 10 % of
the loop, in place of 500 fibres bunched within 4 %. Where fibres overlap, the bloom merges them, so a sparse spread
keeps each one visible.

**Automotive trim.** A *Stadium* path (a squircle, flat along X) and a 1920 × 720 preset with three layers. *Idle trim* is
a trail that covers the loop at low brightness, so the light guide stays lit between pulses. *Welcome comet* is a short
bright sweep that runs round the loop once per loop. Two *flower heads* ride the loop with their own opening pulse, and
ripple pulses run along each fibre from tail to head. The sources describe the vocabulary: OEM systems pulse for states,
including welcome and goodbye animations [6]; aftermarket strips offer breathing and gradient modes [8]; addressable LEDs
run flowing waves [7]. The idle line and the comet are design choices built from that vocabulary.

**Trapcode, restated for the new fibres.** Particular's trail is a stream of small glow spheres whose size falls over
life [1]. Here the fibre core plays the sphere, the halo plays the glow, and *Taper* is the size-over-life fade.
Particular's path emitter [2][3] is the shared scene path, and a flower head rides it as its emitter. Tao's taper and
animated growth [4][5] correspond to the fade and the moving head. The nearest equivalent to Tao's offset looping is
*Phase spread*, which offsets each fibre's head along the loop. That is an interpretation, not a feature of Tao.

**Naming.** `Width` and `Sharpness` are replaced by `Thickness`. Identifiers that the repo rules ban were renamed in the
editor: `Frame` became `Snapshot` (the per-render parameters) and `Tick` (the player loop); `MaxChannel` became
`BrightestChannel`; `DimmedMax` became `DimmedPeak`; `MaxLength` became `CharacterLimit`; and the schema's `Min` and
`Max` keys became `Lowest` and `Highest`. The DOM's own `min`, `max` and `maxLength` properties are unchanged.

**Checks.** `npm test` runs 88 Node checks. `npm run proof` runs 102 checks, all passing on SwiftShader. Trails sit on
their path: 96.7 % of 66,082 bright pixels on *Flower path*, 93.4 % of 53,636 on *Path weave*, and 100.0 % of 56,247 on
*Automotive trim* lie within 10 px of the path.

**Not settled.** The reference images are not on disk, so every comparison is by eye, not a pixel match. No GPU has run
these frames, and the proof is SwiftShader only.

## Sources

1. Creative COW, "Particular trail", Peder Norrby's advice on Aux glow spheres and size over life. https://creativecow.net/forums/thread/particular-trail/
2. Discovermagz blog, "Create Dynamic Particle Trails in After Effects with Particular", the Layer emitter and path position. https://www.discovermagz.blog/dynamic-particle-trails-particular-after-effects
3. Toolfarm, "Trapcode Particular Particle Path Tutorial", motion paths driving particles. https://www.toolfarm.com/tutorial/trapcode-particular-particle-path/
4. B&H Photo, Red Giant Trapcode Tao 1.0 feature list: geometry along a path, taper and animated growth, offset looping. https://www.bhphotovideo.com/c/product/1226204-REG/red_giant_tcd_tao_d_trapcode_tao_1_0.html
5. Lesterbanks, "Getting Started With Trapcode TAO", geometry along a stroke or path. https://lesterbanks.com/2015/11/getting-started-with-trapcode-tao/
6. CarExpert, "Ambient lighting: Beyond just looks", lock and unlock animations, park and drive pulses, welcome and goodbye animations. https://www.carexpert.com.au/car-news/ambient-lighting-beyond-just-looks
7. CarTipsDaily, "Cars With Ambient Lighting", addressable LEDs and wave-like flowing animations. https://cartipsdaily.com/cars-with-ambient-lighting
8. Aoonu product listing, ambient light strip with breathing, flashing and gradient modes. https://aoonuauto.com/products/ambient-lighting-car-interior-light-strips-new-advanced-fiber-optic-light
