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

## Fourth pass: automotive start transition

**The request.** An automotive LED display with a start transition, "or something". The reading taken is a light strip,
the kind that runs along a dashboard or door trim. A dot-matrix LED panel is a different renderer. It is an open
question for the user, not built.

**What the sources show.** Start-up animation is a product feature. One kit describes a custom power-on sequence that
runs each time the car starts [9]. A welcome animation can end in a colour gradient that sweeps through the interior
[10]. As the engine starts, the glow lights up along the doors and across the dashboard, and fibre-optic guides follow
the trim lines [11].

**What was built.**
- A *Guide* shape. Each fibre lies along the whole scene path, offset by the bundle spread, so the path is the shape.
  Guides are static; the motion comes from a pulse.
- A *Sweep* pulse shape. One front runs from the start of the fibre to its end over the first 45 % of the cycle, with
  the lit part left on behind it and a brighter ridge on the front. The lit part holds to 75 %, then fades, so the next
  sweep starts from black and the loop closes. Under a sweep, flower heads open in index order.
- A *Start transition* preset: 1920 × 720, a stadium loop of 6 s. A dim resting glow runs round the loop, a start sweep
  lights it once per loop, and glints sit above.
- A *Light guide* Add button. It is a starter with a sweep.

**Seams, found by eye and fixed.** Three defects showed in the browser frames.
1. The colour gradient did not wrap, so the right end changed hue abruptly. It is now periodic through the seam.
2. The front's ridge still overlapped the end at the plateau, so the positions either side of the seam differed in
   brightness. The ridge now dissolves before the end.
3. The lit part began with a hard edge at the seam. It now fades in over 4 % of the path while the front runs, and it
   is full once the front has completed the loop.
The second and third are pinned in Node: a completed sweep matches at its seam, and the fade-in is complete within 4 %.
The first is checked by eye only.

**Tuning.** The first plateau was almost white and about 70 px thick, which read as a neon ring. Intensity, halo and
bloom were lowered, and the trim's blue-to-cyan palette was used. A bundle of 56 strands at 0.1 spread keeps the
individual fibres visible as striations. The first build, with 120 strands at 0.08 and more intensity, read as a solid tube.

**Checks.** `npm test` runs 102 Node checks, up from 88. The sweep curve has its own checks: range, periodicity, dark at
0 and at 99 %, a lit share that never falls on the rise, a plateau from 45 % to 75 %, a fade after the hold, a ridge that
is brightest at the front, a seam that matches once complete, and a fade-in at the start. The browser proof measures
the sweep on the rendered frame, with the other layers hidden and the glow off. It checks that the frame starts dark, rises
at 10, 20 and 30 %, reaches its plateau by 45 %, fades after its hold, and is dark again by 99 %. The guide's bright
pixels are checked against the path, as the trails are. The browser proof passes 118 checks with no failures
(`VisualProof/StrandEditor/Proof.txt`).

**Naming.** The remaining banned identifiers in the Strand Editor were renamed in the same pass: `Header` to
`VersionLine`, `Blend` to `Ratio`, `Core` to `Line`, `CorePixels` to `SigmaPixels` (it is a Gaussian sigma), `VCore` to
`VSigma`, `Mapped` to `Toned`, `Table` to `Curve`, `Type` to `Encoding` or `Slot`, `MimeType` to `Codec`, `DataUrl` to
`PngUrl`, `LastFrameTime` to `PreviousTime`, `CheckFramebuffer` to `ValidateTarget`, `TextCacheLimit` to `TextTextureLimit`,
`Composite` to `Output`, and the `Shell` class to `Workspace`. Three kinds of name stay: browser and WebGL API names,
built-ins such as `Map`, `Object` and `Array`, and the legacy keys in `SceneStructureChecks.mjs` (`Core`, `Sharpness`,
`Width`), which are old file data that the schema must drop.

**Not settled.** A sweep runs one way, from the start of each fibre to its end. A centre-out or bilateral sweep would be
a different pulse, and it is not built. Every comparison is by eye, and no GPU has run these frames.

## Fifth pass: layout fix and hosted copy (2026-10-08)

The layout broke in the naming pass. The root class was renamed from `Shell` to `Workspace` in `index.html`, but the grid rule in `Styles/StrandEditor.css` still targeted `.Shell`, so the sidebar, viewport and inspector stacked full width. The inspector group selector had the same problem: `details.Group summary` no longer matched `InspectorGroup`. Before the fix, at 1366×768 (headless Chromium, SwiftShader), the viewport was 118 px tall and the inspector sat below the transport bar.

Commit `2ec2863` fixes it. It renames the grid rules to `.Workspace` (base and 1100 px), sets the top bar to 52 px, keeps the centre column from growing past its track, keeps the transport labels on one line, lets the stats truncate, widens the number column to 74 px so "1280" is not clipped, and adds an on-page message when the editor script does not start.

Measured after the fix (`CaptureLayout.mjs`, headless Chromium, 0 page errors; 10 presets, 5 layer rows, 7 inspector children):

| Viewport | Top bar | Sidebar | Centre | Inspector |
|---|---|---|---|---|
| 1366 × 768 | 1366 × 52 | 260 × 716 | 796 × 660 | 310 × 716 at x 1056 |
| 1024 × 768 | 1024 × 95 (wraps to two rows) | 220 × 673 | 524 × 617 | 280 × 673 at x 744 |
| 1920 × 1080 | 1920 × 52 | 260 × 1028 | 1350 × 972 | 310 × 1028 at x 1610 |

Message check: a copy of `index.html` with a missing module script showed "The editor script did not start (a file failed to load)…", and the console recorded `ERR_FILE_NOT_FOUND`. This headless Chromium loads module scripts from `file://`, so the test used a missing file, not the `file://` block that normal browsers apply.

Hosted copy: the raw.githack link pinned to `b89a395` showed the stacked layout and empty controls in the user's browser. The same commit runs in headless Chromium, so the difference is on the hosted side. The cause is not confirmed; the sandbox cannot reach raw.githack. raw.githack shows a notice before HTML pages and describes itself as serving HTML as-is. A raw.githack 404 page also appeared in the user's browser; the link that produced it is not identified. The `play.html?preset=9` link was removed from the README: its query string is the likeliest cause (not confirmed), and the Preset menu reaches the same scene.

## Sources

1. Creative COW, "Particular trail", Peder Norrby's advice on Aux glow spheres and size over life. https://creativecow.net/forums/thread/particular-trail/
2. Discovermagz blog, "Create Dynamic Particle Trails in After Effects with Particular", the Layer emitter and path position. https://www.discovermagz.blog/dynamic-particle-trails-particular-after-effects
3. Toolfarm, "Trapcode Particular Particle Path Tutorial", motion paths driving particles. https://www.toolfarm.com/tutorial/trapcode-particular-particle-path/
4. B&H Photo, Red Giant Trapcode Tao 1.0 feature list: geometry along a path, taper and animated growth, offset looping. https://www.bhphotovideo.com/c/product/1226204-REG/red_giant_tcd_tao_d_trapcode_tao_1_0.html
5. Lesterbanks, "Getting Started With Trapcode TAO", geometry along a stroke or path. https://lesterbanks.com/2015/11/getting-started-with-trapcode-tao/
6. CarExpert, "Ambient lighting: Beyond just looks", lock and unlock animations, park and drive pulses, welcome and goodbye animations. https://www.carexpert.com.au/car-news/ambient-lighting-beyond-just-looks
7. CarTipsDaily, "Cars With Ambient Lighting", addressable LEDs and wave-like flowing animations. https://cartipsdaily.com/cars-with-ambient-lighting
8. Aoonu product listing, ambient light strip with breathing, flashing and gradient modes. https://aoonuauto.com/products/ambient-lighting-car-interior-light-strips-new-advanced-fiber-optic-light
9. BeastLighting, ambient lighting kits: a custom power-on animation that runs each time the car starts, and customisable startup animations. https://beastlighting.com/
10. Maxhaust, "Retrofit Ambient Light": a welcome animation, after which a colour gradient sweeps through the interior. https://www.maxhaust.com/en/ambient-light/
11. A80caidi, "Best Car Ambient Lighting: Everything You Need to Know": the glow lights up along the doors and across the dashboard as the engine starts, and fibre-optic kits run light guides along door panels and trim lines. https://www.a80caidi.com/blogs/blog/best-car-ambient-lighting-everything-you-need-to-know
