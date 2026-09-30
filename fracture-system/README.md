# Real-time material fracture for AAA games

**Glass · Wood · Concrete · Plastic · Rock** — no cell fracture, no Voronoi.

A working TypeScript/WebGL/WebGPU system you can click on right now, plus the
engineering notes for moving it into a real engine.

```bash
npm install
npm run dev          # http://localhost:5173
```

Click the object to strike it. Pick a material on the left; set how hard you
hit it; watch the cracks nucleate, run, branch, arrest and coalesce, then watch
the fragments fall apart.

---

## 1. Why not Voronoi / cell fracture

You already know this, which is why you asked. To be precise about *why* it
fails, because the reason dictates the whole architecture:

Cell fracture subdivides space by bisector planes of a point set. Every
fragment comes out **convex**, every internal face is a **plane**, and the
pattern is **statistically identical everywhere in the object** and
**identical between materials**.

Real fracture has none of those properties:

| Real behaviour | Voronoi | Why it matters |
|---|---|---|
| A crack *nucleates* at a flaw and **propagates** at a finite speed | Fragments appear instantaneously | You never see the crack run, which is 90 % of the read |
| Cracks **branch** when they outrun their own energy dissipation | Never | Glass/rock spall patterns are defined by branching |
| Cracks **arrest** when the driving stress drops | Never | Partial damage is impossible; everything either shatters or doesn't |
| Fragments follow a **power-law** size distribution (a few big, many small) | Roughly uniform | The giveaway "procedural" look |
| **Anisotropy**: wood splits along the grain, never shatters | Impossible | Wood is instantly recognisable as wrong |
| Fracture surfaces **differ per material** (Wallner lines / torn fibres / exposed aggregate / drawn fibrils / conchoidal shells) | All faces are flat planes | Materials stop reading as materials |

So the whole design goal here is: **the fragment you get must be a consequence
of a crack that actually propagated there.**

---

## 2. The architecture, and the one non-obvious decision

```
   ┌──────────────────────────────┐
   │  PERIDYNAMICS (stress solve) │  dynamic elasticity on a bond lattice
   │   ρü = Σ f(ξ,η)              │  wave propagation, reflection, spall,
   └──────────────┬───────────────┘  contact — all at coarse resolution
                  │ σ(x) stress tensor (6 components per node)
                  ▼
   ┌──────────────────────────────┐
   │  CRACK FRONTS (topology)     │  explicit sharp fronts: position, tip,
   │   advance iff σ_n > K_IC/    │  velocity, plane normal, mode mixity.
   │            √(πa/2)           │  Branch, arrest, coalesce.
   └──────────────┬───────────────┘
                  │ crack ribbons (+ bond degradation fed back)
                  ▼
   ┌──────────────────────────────┐
   │  CARVER (geometry)           │  voxelise, rasterise ribbons, label
   │   islands of unbroken bonds  │  connected components, marching tets
   └──────────────┬───────────────┘
                  ▼
          fragment meshes + mass + inertia → rigid bodies
```

### The non-obvious decision

**Do not try to get crack geometry out of the peridynamic bonds directly.**

This is the trap. It is what everyone tries first, and it does not work, for a
reason worth understanding:

A lattice with interaction horizon δ = 2·dx cannot represent a sharp crack.
Breaking a bond makes a micro-void, and a void δ wide has a tip radius of δ/2.
Its stress-concentration factor is nothing like a real crack tip's. What you
observe is one of exactly two failure modes:

* **nothing localises** — you get 30 % of bonds broken, uniformly scattered,
  and the body is still connected (I measured this: 30 % bond damage, one
  fragment, because a 32-neighbour lattice needs a *plane* of bonds to go at
  once and never forms one); or
* **everything pulverises** — you crank the severity to force it and the whole
  object turns to dust.

Measured, from `test/tune.ts` in this repo:

```
glass  horizon 2.0  damageRate 400   eps/sc 5  -> 26.4% bonds broken, 1 fragment
glass  horizon 2.0  damageRate 400   eps/sc 9  -> 21.0% bonds broken, 1 fragment
glass  horizon 1.5  damageRate 400   eps/sc 5  -> 26.6% bonds broken, 1 fragment
```

26 % of bonds broken and the object is still one piece. That is not a tuning
problem, it is the lattice telling you it cannot represent a crack.

So: **the stress solver computes stress; explicit sharp fronts own the
topology.** The fronts are driven by the *measured* stress field, so waves,
reflections, spall and anisotropy all still come from physics — you just do not
ask a coarse lattice to draw the crack for you.

### And the other half of that decision

The fronts must **feed back** into the stress solver, or they stall. A front
that only *reads* stress never creates a stress concentration at its own tip,
so it runs into unstressed material and stops after a few millimetres
(measured: 14 mm on a 600 mm pane, every front, every time).

`Lattice.breakBondsNear()` closes the loop: as a front advances it severs the
bonds it has passed through. Now the lattice has a real discontinuity, the field
concentrates at the tip, the concentration travels with the tip, and the crack
is driven by its own energy release rate. That one function is the difference
between "cracks run 14 mm and stop" and "cracks accelerate to 200 m/s, branch
at the branching limit, reach the free surface and coalesce".

---

## 3. Material differentiation — the actual numbers

Every material constant is physical. The failure strain is not a magic number,
it comes from fracture energy via the Silling & Askari relation
`s_c = sqrt(5·G_f / (9·K·δ))`, and `G_f = K_IC²/E` comes straight from the
handbook:

| Material | E (GPa) | ν | K_IC (MPa√m) | **G_f (J/m²)** | density | crack speed |
|---|---|---|---|---|---|---|
| Glass | 70 | 0.22 | 0.75 | **8** | 2500 | 3200 m/s |
| Wood (along grain) | 12 | 0.35 | 3.5 | **1021** | 600 | 1400 m/s |
| Concrete | 30 | 0.20 | 1.2 | **48** | 2400 | 2800 m/s |
| Plastic (PC/ABS) | 2.5 | 0.38 | 5.0 | **10000** | 1200 | 900 m/s |
| Rock (granite) | 60 | 0.25 | 2.0 | **67** | 2700 | 3000 m/s |

A 1250× spread in fracture energy is *why* these materials look different, and
it falls out of the model rather than being authored. On top of that, per
material:

**GLASS** — perfectly brittle (`yieldStrain = ∞`), 12× stronger in compression.
Heterogeneity 0.20, so cracks run nearly straight. The signature is **radial
cracks** (a Hertzian contact puts *hoop* tension at the contact circle, so each
crack's plane contains the radius) followed by **concentric ring cracks** from
the reflected bending wave via secondary nucleation.

**WOOD** — the anisotropy is the whole point. Bond stiffness along the grain is
~20× the cross-grain stiffness (see `anisotropyWeight`), and the crack front's
*effective toughness* is multiplied by 0.06 for opening across the grain. A
crack that enters at an angle gets its plane normal pulled toward the grain axis
until it is running with the grain. That is why wood **splits**: the crack
rotates until it is going the cheap way and then travels the whole length.
Measured, from `test/solver.test.ts`, damage spread with the impact along +x:

```
grain [1,0,0] -> spread dx=0.050  dy=0.024  dz=0.027   (2.0:1 along grain)
grain [0,1,0] -> spread dx=0.017  dy=0.012  dz=0.029
grain [0,0,1] -> spread dx=0.017  dy=0.021  dz=0.034
```

**CONCRETE** — heterogeneity 0.80. Bond strength varies by ±70 % via a spatial
hash, so cracks deflect constantly and never run straight. Tension / compression
asymmetry 10:1. Result: chunky, irregular, tortuous fragments.

**PLASTIC** — ductile: yields at 35 % of its failure strain and keeps only 15 %
stiffness after full plastic flow (`yieldRatio` / `plasticResidual`). So it
bends, necks and whitens *before* it tears, and its fracture faces show drawn
fibrils. It barely branches because it cannot get stiff enough to reach the
branching limit — physically correct and instantly readable.

**ROCK** — bedding-plane anisotropy (toughness ratio 0.35) plus 0.65
heterogeneity → conchoidal shells with sharp steps.

---

## 4. What each stage actually does

### 4.1 Peridynamics — `src/peridynamics/`

Bond-based peridynamics (`Silling & Askari 2005`) on a jittered regular lattice.

* **Micro-modulus is calibrated numerically, not analytically.** The code
  imposes a unit uniaxial strain and *measures* the stress the lattice
  produces, then scales every bond to hit the target E. Analytic calibration
  (`k = E·dx`, or `c = 18K/πδ⁴`) is fine on an infinite perfect lattice and
  drifts badly once you have jitter, anisotropy, free surfaces and a truncated
  horizon. Measured accuracy, `test/calib.test.ts`:

  ```
  glass     target E=1.167GPa  measured 1.132GPa (97.1%)
  wood      target E=0.200GPa  measured 0.197GPa (98.7%)
  concrete  target E=0.500GPa  measured 0.486GPa (97.2%)
  plastic   target E=0.042GPa  measured 0.040GPa (97.1%)
  rock      target E=1.000GPa  measured 0.980GPa (98.0%)
  ```

  (An earlier version of this had a missing `1/r` in the calibration sum, and
  because `F ⊗ ξ` cancels almost exactly between the `+x` and `−x` neighbours,
  it reported *zero stiffness*. Silent, and it costs you a day if you do not
  know to look for it.)

* **Stress tensor** in the peridynamic form `σ_i = (1/2V) Σ f_ij ⊗ ξ_ij`,
  decomposed to principal stresses with a Jacobi eigenvalue solve.

* **Time rescaling.** `SOFTENING = 60` divides E and G_f by the same factor.
  That leaves the failure strain `s_c` and the process-zone size
  `r_p = (K_IC/σ_y)²` **unchanged** — every dimensionless group that decides
  the *shape* of the fracture — while slowing the speed of sound by `√60`. It
  is pure slow motion, and it is what makes a 200 microsecond glass break
  watchable without any playback hack.

  **`K_IC` must be divided by the same factor.** Miss this and the driving
  stress (∝ E/φ) falls below the propagation stress `K_IC/√(πa/2)` and
  *nothing ever fractures*, at any severity. This was the single hardest bug in
  the whole project to find.

* **Striker contact model.** An instantaneous impulse does not break anything:
  it delivers momentum to a handful of nodes and rings out in ~100 µs having
  raised the bulk stress to 25 kPa, which is 5× too low to propagate even a
  1 cm crack. A real striker stays in contact for a good fraction of the
  plate's own bending period and **stores elastic energy**, and stored energy is
  what a running crack consumes. So the impact is a prescribed-velocity contact
  patch held for `0.05 × eventDuration`.

* Typical cost: **~40 ns per bond per substep**. A 6 500-node / 78 000-bond
  glass pane is ~2.5 ms/substep; the whole fracture event is 150–200 substeps.

### 4.2 Crack fronts — `src/fracture/CrackNetwork.ts`

The propagation criterion is the Griffith/toughness one, evaluated without
needing a singular tip field:

```
σ_p(a) = K_IC / sqrt(π·a/2)            a = half crack length
advance iff  σ_n(tip) > σ_p(a)
v = 0.55·c_R · (1 − (σ_p/σ_n)²)        terminally limited by the Rayleigh speed
```

Everything that makes it read as real falls out of that single inequality:

* **Size effect.** A long crack needs almost no stress; a short one needs a
  lot. You get a few dominant cracks that run the object and dozens of small
  ones that stall — a power-law fragment distribution, for free.
* **Arrest.** Cracks stop when the driving stress decays. Partial damage
  becomes possible with no authored fracture levels.
* **Branching.** Above ~0.38 `c_R` a crack cannot shed energy fast enough and
  splits, at 15–45°, with the branch angle drawn from the material's measured
  range. (Peak speeds observed here: 199 m/s on glass with `c_R` = 402 m/s —
  0.50 `c_R`, right at the physical branching limit.)
* **Direction.** The crack plane normal follows the max principal tensile
  stress; the in-plane heading is steered by the mode-II shear via the maximum
  hoop-stress criterion `θ = 2·atan((K_I − √(K_I² + 8K_II²)) / 4K_II)`, with
  small authority because cracks are very directional objects.
* **Coalescence.** When a front comes within 1.6 cells of another crack it
  *snaps onto the junction point* and stops. It must actually join: a front that
  halts 1.2 cells short leaves an unbroken ligament, and one ligament keeps the
  entire body connected — you get a beautiful crack network and one fragment.

**Two subtleties that cost real time:**

*The crack tip is traction-free.* Sampling the stress *at* the tip returns
≈ zero, because the material there has already separated. The driving field
lives *ahead* of the tip — this is exactly why cohesive-zone models put their
traction on the element in front of the crack. Sample at `tip + 0.7·dx·dir`.

*Use a peak-hold, not a mean.* A crack tip responds to the highest opening
stress its region has seen (damage accumulates, and the crack outruns the
unloading wave). A one-pole low-pass averages the loading and unloading halves
of the wave against each other and reports "no driving stress" — the crack
refuses to move while the field is visibly stressing it. A leaky peak-hold
(rise instantly, decay over ~5 coupling steps) is both more physical and
robust.

**Coupling.** The two solvers interleave in time: `dt_solver ≈ dx/c_p` for the
elastic solve, `dt_crack ≈ dx/(0.55·c_R)` for the fronts — a few elastic steps,
one crack step. Running them in sequence does not work: solve the whole event
first and by the time the wave has settled the stress that would have driven the
crack is gone.

### 4.3 Carver — `src/fracture/Carver.ts`

1. **Voxelise** the object SDF on an adaptive grid (padded 6 % past the
   nominal bounds — an object that pokes outside the sampling domain produces
   *zero* triangles and no other symptom).
2. **Rasterise** each crack ribbon as an oriented slab, updated only inside its
   own AABB. The ribbon's lateral extent is found by ray-marching the SDF along
   the in-plane perpendicular, so a crack only cuts where it has actually
   propagated.
3. **Label connected components** of `{object < 0 ∧ crack > 0}`. That set is
   the physical definition of a fragment: everything still connected after the
   cracks have passed through.
4. **Extract** each component's surface with **marching tetrahedra** — no
   lookup tables, watertight by construction.

Details that matter:

* **Fracture-surface relief is a meandering mid-surface**, not noise added to
  each face independently: `d = |perp − noise(p)·amp| − aperture/2`. This is
  both the physically correct picture (the two crack faces were the same
  material once, so they are conformal mirrors) and the only version that
  cannot pinch the crack shut wherever the noise goes the wrong way. Adding
  independent noise to each face *will* weld your cracks back together.
* **Do not alternate the tetrahedral diagonal by `(i+j+k)` parity.** That
  folklore is wrong for the 6-tet split and is a classic source of hairline
  cracks: the 0–7 decomposition cuts every face along the *same* local diagonal,
  any decomposition built on the opposite body diagonal cuts at least one face
  the other way, so alternating guarantees T-junctions. One decomposition
  everywhere is provably watertight.
* **Orient triangles from an inside/outside corner pair**, not from a
  finite-difference gradient. Gradient orientation is subtly wrong in nearly
  flat cells, and a handful of flipped triangles corrupted signed-volume
  computation by 3.3 % before this was fixed.
* **A crack must stay open across the grid**, at ~1.8 voxels minimum, or the
  two faces share voxels and the mesh stays welded even though the physics
  separated it.
* Vertex attributes produced per fragment: `faceKind` (outer skin vs fracture
  face), `crackRadial` (distance from the crack origin — drives Wallner lines),
  `crackId`, plus centroid, volume, mass and a diagonal inertia tensor.

Verified in `test/spanning.test.ts`: three crack lines spanning a plate
edge-to-edge give exactly 6 wedges at 86 % volume (the missing 14 % is the
carved aperture), with correct per-wedge mass and inertia.

### 4.4 Shading — `src/render/MaterialShaders.ts`

A 3 mm voxel puts a hard floor on geometric detail. Everything below that scale
is shading, and that is fine, because that is where the material signatures live:

* **Glass** — the fracture surface is optically *smooth*; what you read is the
  **mirror → mist → hackle** progression as the crack accelerates, plus
  **Wallner lines**: arcs swept out by the crack front interacting with the
  stress wave, keyed off `crackRadial`. Plus refraction + strong Fresnel.
* **Wood** — torn fibre bundles, relief stretched along the grain via a TBN
  frame built from the grain axis, earlywood/latewood banding, fibres pulled
  proud of the surface.
* **Concrete** — cement paste (rough, dark) with exposed aggregate (smooth,
  pale, rounded). That contrast *is* the look.
* **Plastic** — stress whitening (micro-voiding scatters light) plus drawn
  fibrils and glossy shear lips at the free surface.
* **Rock** — conchoidal shells: smooth curved facets with sharp steps between
  them, much duller weathered outer surface.

---

## 5. Performance

Measured on this machine (`test/presets.test.ts`), detail 3:

| Object | Lattice | Bonds | ms/substep | Event | Carve |
|---|---|---|---|---|---|
| Glass pane 50×40×2.4 cm | 6 552 nodes | 78 k | 2.5 | ~150 substeps | 6.0 mm cell, 330 ms |
| Wood beam 80×12×5 cm | 720 | 7.7 k | 0.04 | ~40 | 9.5 mm, 130 ms |
| Concrete block 34³ cm | 8 000 | 115 k | 3.0 | ~150 | 5.7 mm, 400 ms |
| Plastic bar 45 cm | 224 | 2.2 k | 0.04 | ~40 | 7.5 mm, 100 ms |
| Rock 34×30×30 cm | 3 608 | 50 k | 0.5 | ~60 | 5.7 mm, 770 ms |

The demo runs the solve time-sliced at ~9 ms/frame, so the fracture event plays
out over a second or so at interactive frame rates while the cracks are visibly
running. The carve is one blocking pass at the end of the event.

**Bond cost is ~40 ns/bond/substep on the CPU.** That is the number to scale
against: 115 k bonds is ~3 ms/substep single-threaded, so realistic per-frame
budgets land around 100–200 k bonds on one thread. Beyond that, see below.

---

## 6. What is and is not in this demo — read this before judging the fragment count

**Working and verified:**

* dynamic elasticity with per-material calibrated moduli (< 3 % error)
* crack nucleation, propagation at 0.1–0.5 `c_R`, arrest, branching at the
  physical branching limit, and coalescence with junction snapping
* wood grain anisotropy, concrete heterogeneity, plastic ductility, rock bedding
* secondary nucleation from the stress field (ring cracks in glass, spall in
  concrete, chips in rock)
* watertight fragment meshes with correct volume, mass and inertia
* per-material fracture-face shading

**Honest limitation:** on the default presets, a single strike often produces
*one large fragment plus small chips* rather than a full shatter. The cracks
nucleate, run to the free surfaces and coalesce — the physics is right — but a
radial crack family from a *point* impact on a *large* plate mostly does not
span boundary-to-boundary, and only a spanning network separates material. This
is genuine physics (a small strike on a big pane really does leave a mostly
intact pane) and it is also a tuning surface:

```
toughnessScale  ↓  0.30 → 0.15     further, more numerous cracks
severity        ↑  12   → 30-40    more strain, more nucleation
object size     ↓  smaller objects let a fixed crack length span
detail          ↑  finer lattice resolves the tip better
```

Set severity to 30–40 with `toughnessScale` at 0.15 and the same presets do
shatter. The slider is there; the defaults are conservative on purpose.

**Not implemented (and where to take it):**

* **GPU compute.** The solver's data layout was designed for it: flat typed
  arrays, one thread per bond, per-node force reduction. The three passes
  needed are (a) bond strain + failure, (b) force gather, (c) integrate —
  **no atomics required** if you give each node its own CSR neighbour list, so
  it ports to plain WebGPU compute with no extensions. WebGPU does not have
  float `atomicAdd`, which is the reason to use gather-per-node rather than
  scatter-per-bond.
* **Workers.** The carve is a pure function of (SDF, segments, resolution).
  Move it to a worker and the 300–800 ms blocking pass disappears.
* **Damage as a 3D texture on the intact mesh.** The data is already there
  (`Lattice.damage`); upload it as a `Data3DTexture` and the *unbroken* object
  shows the crack network growing inside it. The scaffolding exists in
  `FractureSystem.buildDamageTexture()`.
* **Pre-fracture hierarchies.** For a shipping title: author a 2–3 level
  pre-fractured LOD chain, use this system to generate level *N+1* on demand
  from the level-*N* piece, and let the crack network decide which level-N
  pieces to promote. That gives you authored-quality detail near the player and
  unbounded recursion away from it.
* **State-based peridynamics.** Bond-based PD has a *fixed* Poisson ratio
  (0.25 in 3D); measured here at ν ≈ 0.23 for glass, which is close enough for
  fracture but wrong if you also want correct lateral contraction. State-based
  PD fixes it at roughly 2× the cost.
* **Fragment-fragment collision.** Deliberately omitted: at this fragment count
  games rely on the pieces separating fast enough that no one sees the
  interpenetration, and spend the budget on getting the *initial velocities*
  right, which is where the realism actually reads from.
* **Chipping at fragment corners** (an authored Houdini "chipping" pass in most
  pipelines) — currently only the crack aperture and roughness give that.

---

## 7. Files

```
src/materials.ts                  per-material mechanical constants
src/sdf/SDF.ts                    SDF primitives, CSG, CPU evaluator, WGSL codegen
src/peridynamics/Lattice.ts       lattice + bonds + numerical micro-modulus calibration
src/peridynamics/Solver.ts        velocity-Verlet, bond failure, plasticity, striker contact
src/peridynamics/Stress.ts        peridynamic stress tensor, principal stresses, peak sampling
src/fracture/CrackNetwork.ts      explicit crack fronts: Griffith criterion, branching, coalescing
src/fracture/Carver.ts            voxelise → rasterise ribbons → islands → marching tets
src/core/FractureSim.ts           the coupled simulation
src/core/FractureSystem.ts        public API: strike / update / pick / stats
src/render/MaterialShaders.ts     per-material fracture-face GLSL
src/render/FragmentSystem.ts      fragment rigid bodies

test/
  calib.test.ts      verifies measured E against target E per material
  solver.test.ts     bond-level behaviour, anisotropy, resolution/softening sweeps
  tune.ts            localisation study (the "26 % damage, 1 fragment" result)
  carve.test.ts      carver correctness: cuts, slits, resolution scaling
  spanning.test.ts   3 spanning cracks -> exactly 6 wedges
  pipeline.test.ts   end-to-end, all materials
  presets.test.ts    the exact demo presets, with timings
```

Run any of them with:

```bash
node --experimental-transform-types test/presets.test.ts
```

---

## 8. The short version

1. **Do not** try to make Voronoi look real. It cannot: convex, planar,
   isotropic, instantaneous.
2. **Do not** try to grow fracture geometry out of peridynamic bonds. A
   δ-wide void is not a crack, and you will get 30 % diffuse damage with the
   body still in one piece.
3. **Do** split the problem: a coarse lattice for the *stress field* (which it
   approximates very well), explicit sharp fronts for the *topology* (which
   they represent exactly), and the fronts must feed back into the lattice or
   they stall.
4. **Do** derive the failure strain from fracture energy, `G_f = K_IC²/E`, and
   keep the real 1250× spread between glass and plastic. That is where the
   material differentiation comes from, and no amount of shader work replaces
   it.
5. **Do** put the crack-face character in the shader. The carver gives you a
   3 mm voxel; Wallner lines, torn fibres, exposed aggregate, drawn fibrils and
   conchoidal shells are what tell the eye which material it is looking at.
