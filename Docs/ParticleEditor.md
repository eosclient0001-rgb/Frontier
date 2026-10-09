# Particle Editor

`Experimental/ParticleEditor/index.html` is a standalone particle editor written in HTML, JavaScript and WebGPU. Its UI follows the layout of `Experimental/ProjectZeroEditor/index.html`: top bar, outliner on the left, viewport in the centre, and inspector on the right, with a status bar along the bottom.

Open it through any static HTTP server. Opening the file directly with `file://` will not load the scripts in every browser. A browser with WebGPU enabled is required.

```
cd Experimental/ParticleEditor && python3 -m http.server 8080
# then open http://localhost:8080/
```

Query parameters:

- `?scene=none` starts with no particle systems.
- `?scene=id,id,...` starts with the listed presets only (IDs come from `js/presets.js`).

## What is in the editor

| System | Kind | Notes |
| --- | --- | --- |
| Sparks | Ballistic, GPU-simulated | Streak-rendered. Emitted by the **Strike** button and by lightning. Affected by the wind field. |
| Lightning and thunder | Procedural bolts | **Strike** creates a bolt with a flash, a thunder cue (**Sound**) and a spark burst at the impact point. |
| Lightning web | Lightning, procedural | Branching arcs between scene objects. Every visible particle system's origin is a node, linked to its nearest neighbours and redrawn on an interval. Arcs are drawn only; they do not strike or light particles. Turn on in the **Lightning web** card. |
| Leaves | Wind-driven, GPU-simulated | Leaf or paper sprites (selectable). They take their velocity from the wind field at their position.
| Tornado debris | Wind-driven, GPU-simulated | Paper debris lifted from a ring around a vortex. Adding it enables the **Tornado** wind component at its origin. |
| Sandstorm | Particles (kind 0), GPU-simulated, wind-driven | A low, dense wall of up to about 6,000 wind-blasted grains fired from the upwind edge. Grains are streaks that stretch with speed, they hop off the ground (bounce with gravity), and they are ochre. Adding it sets **Prevailing wind** to 10 m/s at bearing 70°. This is a particle approximation: grains do not collide or pile up, and there is no volumetric haze. |
| Rain streaks | Precipitation, GPU-simulated | Streaked drops that fall through the wind field and rebound a little off the floor. |
| Hail | Precipitation, GPU-simulated | Ice pellets that drop fast and bounce high off the floor before settling. |
| Snow | Precipitation, GPU-simulated | Flakes that drift through the wind field and land with a soft rebound. |
| Black hole | VFX (kind 5), GPU-simulated, plus screen-space lensing | A glowing accretion disc that is pulled in by an attractor, swirls inward and is swallowed at the swallow radius. The background is bent around the horizon by a full-screen lens pass, and a photon ring sits outside it. Lensing is a screen-space approximation, not a ray-traced metric. Tune it in the **Black hole** card. |
| Heat shimmer | VFX (kind 0), GPU-simulated, plus screen-space distortion | A faint rising plume that bends the scene behind it with a noise offset. Place it over a fire or an exhaust. The bending is an approximation: it shifts the sampled image, it does not refract real geometry. Tune it in the **Heat shimmer** card. |
| Magnetic field lines | Light fibres (analytic) | Light trails drawn along the field lines of a magnetic dipole (path shape **Dipole field line**, axis in the plane of the lines). Sparks ride the lines. They are analytic, so they do not move with the field. Pair with **Magnetic particles**. |
| Magnetic particles | Particles (kind 0), GPU-simulated | Particles steered by a dipole force field: they are pushed along the local field direction and damped across it, so they circulate along the field lines. This is a steering approximation, not an integrated Lorentz force. Tune it in the **Magnetic dipole** card. |
| Bubbles | Particles (kind 0), GPU-simulated | Transparent spheres (shape **Bubble**) with a fresnel rim and a small highlight. They rise on buoyancy, sway (flutter) and grow slightly. |
| Foam | Particles (kind 0), GPU-simulated | Many small bubbles that bunch up and bob near the floor, pushed by the wind. |
| Glitch dissolve | Transition (kind 5), GPU-simulated | The derez path with a **Glitch (blocky)** release wave. Release times come from hashed cells on a 7×5×7 grid plus a rising sweep, so the break-up is blocky rather than smooth. After release, each cube jumps in 12 steps a second. |

Precipitation uses the regular particle kind, not the debris kind. Debris pins to the floor, while the other kinds bounce with the preset's `bounce` coefficient, so rain, hail and snow set a bounce value.
| Embers | Additive VFX | Glowing embers lifted on buoyancy and bent by the wind. |
| Cherry petals | Wind-driven, GPU-simulated | Petals that tumble and follow the wind closely. | |
| Sand grains | Ground, GPU-simulated | Sand kicked up from the floor in short hops (saltation) and carried by the wind. |
| Ash flakes | VFX, GPU-simulated | Grey ash lifted by a fire's heat, drifting and settling onto the ground. |
| Small debris | Ground, GPU-simulated | Twigs, bark and wood chips thrown up and clattering off the ground. Small pieces only; stone-sized rubble is out of scope. |
| Countermeasure flares | Aircraft, GPU-simulated | IR decoy flares dispensed by a jet to break missile lock: white-hot bursts every ~0.9 s from the aircraft origin, falling and burning out behind it. |
| Pollen & dust motes | Ambient, GPU-simulated | Slow glowing motes drifting on the wind. Light shafts are not modelled. |
| Fireflies | Swarm (kind 6), GPU-simulated | Glowing points that wander and pulse (pulse frequency and depth are preset parameters). |
| Insect swarm | Swarm (kind 6), GPU-simulated | Gnat-like flock: separation, alignment and cohesion, plus wander. Brute-force neighbour search, so keep capacity at a few hundred. |
| Water mist | VFX, GPU-simulated | Fine droplets blown off a waterfall or spray: short life, high drag. |
| Splash rings | VFX, GPU-simulated | Expanding ripple rings on the floor. Placed at random ground points, not at each rain or hail impact (no impact events yet). |
| Glass shards | Streak, GPU-simulated | Sharp bright fragments from a broken window. They bounce and glint. |
| Volcanic ash & lapilli | Sphere, GPU-simulated | Hot, heavy ejecta thrown high by a vent: faster and bigger than ash flakes. |
| Dandelion seeds | Wind-driven, GPU-simulated | Very light seeds that float and flutter in the wind. |
| Feathers | Wind-driven, GPU-simulated | Light feathers that drift, spin and sway. |
| Confetti & streamers | Wind-driven, GPU-simulated | Paper pieces that tumble with strong wind coupling. |
| Steam vent | VFX, GPU-simulated | Hot steam rising from a vent and expanding as it cools. |
| Fireworks | VFX, GPU-simulated | Timed bursts (every ~2.6 s, randomised) fired from random points in the sky. Trails are streak-shaped burst particles, not separate rising shells. |
| Light streaks | Light fibre (kind 7), analytic | Bezier fibres with a bright head sliding along each one and a fading tail, plus head sparks. Ported from the Strand Editor. Not simulated, so wind does not move them. |
| Ember ribbons | Light fibre (kind 7), analytic | Rippling sheets of light across a sheet width. The pulse runs outward from the root. |
| Weave trails | Light fibre (kind 7), analytic | Trails that comet along a weaving path, each leaving a tail that pulses outward along the path. |
| Trim trail (stadium) | Light fibre (kind 7), analytic | Trails running round a flat stadium loop, like a light guide following dashboard trim. |
| Derez cube | Transition (kind 5), GPU-simulated | A grid of cubes covers the object's surface (1,536 cells: 16×16 per face). Cubes hold in place, then release in a wave from one corner: each either bursts outward or falls under gravity. A cube that hits the floor bursts once into eight 2×2×2 children. Children are procedural (analytic motion, fading over a set life), not simulated particles, and they do not collide with anything. |
| Cube to coins | Transition (kind 5), GPU-simulated | The same surface grid (384 cells) with gold coins instead of cubes. Coins are released once, burst or fall, and bounce on the floor (restitution 0.35). They never split. Coin resting behaviour is approximate. |
| Melt away | Transition (kind 5), GPU-simulated | The object melts: surface cubes release in patches across the surface (Release wave: Melt), and the pieces drift off on the wind (high wind coupling). Pieces that land stay on the floor and slide with the wind. |
| Dissolve to nothing | Transition (kind 5), GPU-simulated | The object dissolves: surface pieces release in patches (melt wave), drift on the wind, shrink to zero and fade out. |
| Dissolve into butterflies | Transition (kind 5), GPU-simulated | The object melts in patches; each released piece becomes a flapping butterfly that rises (buoyancy), drifts on the wind, wanders (flutter) and fades. The butterfly is a two-pair silhouette with wings that open and close, not a detailed model. Cubes hide once released, so the switch is an instant pop. |
| Reverse derez | Transition (kind 5), analytic flight | Cubes fly in from a shell around the object (Start distance), snap onto their surface cell in a wave from one corner, and hold. Flight is scripted (eased from the shell to the slot), not simulated. |
| Voxel explosion | Transition (kind 5), GPU-simulated | A solid sphere of cubes holds briefly, then every cube bursts radially and tumbles on its own axis. Cubes are sampled randomly inside the sphere, so they can overlap; there is no lattice. No floor breaking. |
| Coin stack | Transition (kind 5), analytic drops | Coins drop one by one into a column on the floor, land, settle with a small damped bounce and stay stacked. Scripted drops, not physics: coins do not collide with each other. |
| Coin fountain | Particles (kind 0), GPU-simulated | Gold coins fired upward from a point, arcing over and bouncing onto the floor. They scatter into a loose heap; particles do not collide, so there is no true pile. |

Swarm particles (kind 6) read their neighbours from a snapshot taken after emission, so the flocking step is race-free. Fireworks use the same burst path as the Burst button, driven by a timer.
| Atoms (LJ gas) | Molecular, GPU-simulated | Lennard-Jones pairs on a spatial-hash grid, Langevin thermostat, reflecting box walls. |
| Chemicals A+B→C | Molecular, GPU-simulated | Same as atoms, with stochastic A + B → C reactions on contact and C → A or B dissociation. |

Particles are stored in one GPU buffer per system, with 80 bytes per particle. Simulation and rendering both stay on the GPU. The CPU only receives the small statistics described under *Readback costs* below.

## Light fibre colour

Light fibres use one of three colour modes, set in the **Colour** card:

- **Solid**: every fibre uses the first stop.
- **Ramp along fibre**: stops blend by position (0 to 1) along each fibre's length.
- **Palette per strand**: each strand takes one stop, picked by a per-strand hash (so the mix is pseudo-random, not weighted).

Up to 8 stops; each has a colour and (in ramp mode) a position. The accent colour is separate.

## Transition systems

Transition systems (kind 5 with a transition block) reform the object each cycle: `burstEvery` sets the cycle and `burstCount` equals the capacity, so every cycle replaces all particles. The hold time is `base + spread × t`, with `t` the normalised position from the min corner of the box. Derez cubes that hit the floor are removed from the particle count and replaced by children, so the alive count falls faster than the particle lifetimes suggest.

## Force fields and black holes

Force fields are invisible regions that act on every GPU particle, including debris and transitions. Add them from **Environment → Force fields**, which opens the **Force fields** inspector (up to 8 fields):

- **Attractor**: pulls particles toward its centre, with an optional **swirl** (sideways push, which gives spiral infall) and a **swallow radius** inside which particles are removed.
- **Repulsor**: pushes particles away from its centre.
- **Reverse gravity**: lifts particles upward (strength in m/s²). It is timed: **Start**, **Duration** and **Period** set a repeating window, and period 0 means once. Radius 0 means the field applies everywhere.

Radius sets the falloff: strength is `(1 − r/R)²` inside radius R, so the pull is strongest at the centre and reaches zero at the edge.

Black hole systems add their own attractor at their origin. Their lensing is a second, screen-space step: each frame the canvas is copied and a full-screen pass bends the background around the projected horizon, with a black disc inside the horizon and a photon ring outside it. The bend is a weak-field mapping (`r − E²/r`), not a ray trace, and it fades with distance from the black hole. Particles are not lensed; they are drawn normally.

Limitations: force fields act on particles, not on rigid meshes. Particles do not collide with each other. The accretion disc comes from the swirl term, not from a Keplerian emitter.

## Heat shimmer, magnetic fields and bubbles

- **Heat shimmer** (`heatShimmer`: radius, strength, frequency, rise speed) adds a second screen-space pass. Inside its radius the sampled UV is offset by a noise field that rises over time and fades toward the edge. There is no black core. It works on any system, and it runs in the same copy-and-lens pass as the black hole.
- **Magnetic dipole** force (type 3): the axis is world Z through the system origin. The drive term pushes along the local field direction, and the guide term damps velocity across it. Both fade with the radius. The 1/r³ magnitude is not used, only the direction. Particles near the centre are softened so the direction does not flip violently.
- **Bubble** is particle shape 6: a billboard with a fresnel rim, a highlight and a near-clear centre. Buoyancy and flutter come from the existing parameters.

Limitations: the heat shimmer distorts the frame, not the particles behind it. The magnetic particles steer toward the local field direction, so they follow the lines qualitatively but are not an exact trajectory.

## Wind field

The wind field is a 3D grid of velocities, 24 × 12 × 24 voxels over a 12 × 8 × 12 m domain. It is carried over from the reference editor and is evaluated each step by every wind-driven system.

Sources (all linear superposition, as in the reference):

- **Prevailing wind**: directional, with strength, bearing, radius and centre position.
- **Passing gust**: travelling gust bands.
- **Turbulence**: scaled noise, controlled by the *Turbulence* slider.
- **Swirl**: a divergence-free curl-noise field, controlled by the *Swirl* slider (m/s). Because it is a curl, it turns the grid over on itself without creating sources or sinks, so arrows visibly swirl while the net flow stays intact.
- **Tornado** (a wind component, type 2): a vortex with a tangential velocity, inflow, and an updraft. Systems such as Tornado debris read it through the grid like any other wind.

The field is visualised as a 3D grid rather than a single plane. Each arrow is one voxel:

- **Direction** is the local wind direction.
- **Colour** encodes speed: blue is calm, cyan moderate, yellow fast, red at or above the full-scale value.
- **Length** follows speed, up to one voxel.

The *Arrow full scale* slider sets the speed that maps to full colour and length. *Show grid arrows*, *Show floor* and *Show domain box* toggle the overlay layers. The arrows are a debugging view of the forces that drive particles and are not part of the final visual.

## Readback costs

The editor keeps simulation state on the GPU. CPU readback is limited to the data the UI actually needs, and every readback is asynchronous: the frame is recorded and submitted without waiting for the map to complete. A result therefore arrives one or more frames after it was requested.

| Readback | Size | Frequency | Used for |
| --- | --- | --- | --- |
| Molecular statistics (alive count, species counts A/B/C, kinetic energy sum) | 32 bytes per molecular system | At most one in flight per system, so about once per frame | Status bar, live counts, temperature readout |
| Wind probe (one voxel, rgba16float) | 8 bytes | On request, while the viewport probe is enabled | Probe readout in the viewport |
| Full particle buffer | 80 bytes × capacity (for example 1,024 atoms = 80 KiB; 65,536 = 5 MiB) | Only when **Benchmark full readback** is pressed | Measurement only; the editor never uses this data |

Why the statistics are cheap:

- A reduction pass on the GPU sums the counts and energy into a fixed 32-byte buffer. The CPU never reads per-particle data during normal use.
- Energy is accumulated as integers (`v² × 1000`) so that atomic adds are exact. The integer sum is safe up to about 65,000 atoms at the maximum speed cap before it overflows a `u32`.

Measured here (headless Chrome with SwiftShader, a CPU software WebGPU implementation, so these numbers are not representative of real hardware):

- The status-bar readback time reached about 790 ms. This value is the time from `mapAsync` to its resolution, which includes queued GPU work. Software emulation makes that queue very slow, so it does not predict real-GPU latency.
- The temperature readout is `<v²>/3` and settled at 0.59–0.60 for a thermostat set to T = 0.6, which is the expected value.

What to expect on real hardware: a 32-byte map adds about one frame of latency. Use **Benchmark full readback** on the target GPU to measure the full-buffer cost before relying on it. Measured cost is not published in this document.

Rule of thumb: keep per-frame readback to the 32-byte statistics. Anything bigger should be requested on demand, asynchronously, and at a low rate.

## Simulation notes

- **Molecular step size.** The molecular step uses a fixed `simDt` (default 0.004). Each frame runs `steps = clamp(round(dt / simDt), 1, 8)` sub-steps, and the sub-step is `min(dt / steps, 1.25 × simDt)`. This keeps the Lennard-Jones integration stable when the frame rate drops and `dt` grows.
- **Thermostat noise must differ per sub-step.** The random seed mixes the particle index, the frame seed and the particle's current position. Using only the frame seed made every sub-step reuse the same noise and pushed the atoms about 2.4× too hot.
- **Wind texture usage.** The wind grid is a 3D texture. It uses `GPUTextureUsage` flags, with separate sampled and storage views.

## Files

- `index.html`: markup and element IDs, loading the stylesheet and the five scripts in order.
- `ParticleEditor.css`: dark theme, DM Sans fonts from `fonts/`.
- `js/presets.js`: system presets.
- `js/shaders.js`: WGSL for simulation, reduction and rendering.
- `js/engine.js`: WebGPU device, buffers, pipelines, readbacks.
- `js/lightning.js`: bolt generation and thunder cues.
- `js/app.js`: editor state, UI, frame loop.
