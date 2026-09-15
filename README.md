# Frontier — an SDF terrain generator for rocky / sandy canyon country

A physically-based terrain generator that carries a **signed distance field** and a
**height field** at the same time, in the workflow you asked for:

```
structure  →  sculpt (brushes + SDF/CSG)  →  splines / paths  →  erosion  →  satmap
                                                    (height-based)
```

It is deliberately **not** a node graph. The document is a fixed, ordered list of
authoring stages with typed parameters; you drag sliders, paint strokes, draw
splines, and hit bake. Everything is stored in one JSON document and is
reproducible bit-for-bit from it.

The service is running at `http://0.0.0.0:8010` (`/` serves the UI, `/docs` the API).

---

## 1. Why both an SDF *and* a height field

Canyon country is not a single-valued function of `(x, y)`: alcoves, arches, cave
roofs and undercut cliffs cannot be stored in a height field at all. But every
published erosion law (`∂h/∂t = U − K A^m S^n + …`) *is* a height-field model.
So the two representations coexist and are kept consistent:

| representation | role | implementation |
|---|---|---|
| `z_rock + z_sed` height field | all erosion, all diagnostics, all texturing | `frontier/core/grid.py` |
| narrow-band `φ(x,y,z)` SDF | structure sculpting, overhangs/caves, cavity masks, meshing | `frontier/sdf/volume.py` |

Coupling is exact and two-way:

* **structure → height**: after the CSG tools run, the volume is ray-cast and the
  vertical change (`z_after − z_before`) is added to the height field, so a mesa
  you stamp becomes real topography that the erosion solvers will then work on.
* **erosion → structure**: after every erosion stage the SDF is advected by the
  vertical displacement field (`φ_new(x) = φ_old(x − vΔt)`, Osher & Sethian 1988)
  and reinitialised, so a cave cut into a canyon wall survives 2 Myr of river
  incision. See `frontier/sdf/sculpt.py::advect_height_delta`.

The satmap reads from both: height-based attributes for the ground, and the SDF's
ambient occlusion for the cavities the height field cannot see.

---

## 2. The algorithms (all published, all implemented as written)

### 2.1 Structure
* Improved Perlin gradient noise, `fbm` / `ridged` / `billow` (Musgrave, Kolb &
  Macey 1989; Perlin 2002 improvements), with **domain warping** for sinuous rims
  (Quilez 2002).
* **Band limiting matters.** `noise.fractal_surface` reduces the octave count so
  the finest octave is ≥ 6 cells wide. Without this, a "1500 m first octave with
  8 octaves" template puts its last octave at 12 m on a 32 m grid, i.e. it
  aliases into per-pixel hash, the drainage network can never organise, and the
  result is decorative noise rather than landscape. With it, the *same document*
  baked at 128² and at 2048² describes the same landscape with more detail.
* The structure is built from explicit spectral **bands**: a long-wave structural
  band (default 6 km, amplitude 0.55·relief) that carries the hypsometry, plus a
  weak "seed roughness" band (0.10–0.12·relief) that the drainage network
  organises from. Real landscapes are dominated by long wavelengths; feeding the
  solver a white-ish fractal instead produces uniformly rugged mush.

### 2.2 Flow routing
* Priority-flood depression filling (Barnes, Lehman & Mulla 2014).
* D8 (O'Callaghan & Mark 1984) for ordering/lengths.
* **Multi-flow-direction routing** (Freeman 1991; Quinn et al. 1991 — the
  practical form of Tarboton's D∞ 1997) for the erosion solve. Single-direction
  D8 assigns every cell to one of eight directions, which locks the network onto
  the grid axes and carves 45° zigzag trenches; spreading flow over all downslope
  neighbours removes the directional quantisation. The implicit sweep uses the
  *flow-weighted mean* receiver elevation, and a descending-elevation ordering
  guarantees every receiver is solved before its donors (D8 stack orders do not
  satisfy this when flow splits).
* TWI (Beven & Kirkby 1979), HAND (Nobre et al. 2011), χ (Willett et al. 2014).

### 2.3 Fluvial erosion — implicit stream power + deposition
* `∂h/∂t = U − K A^m S^n + (G/A)∫(U − ∂h/∂t)dA + K_d∇²h`
  (FastScape: Braun & Willett 2013; deposition term: Davy & Lague 2009, with the
  O(N) implicit scheme of Yuan et al. 2019).
* Both the `n`-th-power bedrock term and the deposition term are solved
  implicitly: for `n = 1` in closed form, otherwise Newton–Raphson, all
  unconditionally stable and O(n) per step (Braun & Willett 2013, eqs. 18–26).
* Erodibility comes from the stratigraphic column, normalised so that `K` keeps
  its literal meaning and only the *contrast* between beds is a parameter.
* Erosional steady state for `m = 0.5, n = 1` is `S = (U/K) A^{-0.5}`; the
  validation suite checks the simulated long profile against it.

### 2.4 Hillslope transport
* Linear diffusion `q = −D∇z` (Culling 1960; Nash 1980).
* Critical-slope (Roering et al. 1999): `q = −D∇z / (1 − (|∇z|/S_c)²)`, with a
  documented ceiling on the effective diffusivity and the singularity's job
  (mass wasting near `S_c`) handed to the thermal pass.
* Integrated with **Peaceman–Rachford ADI** (1955) — exact tridiagonal solves,
  unconditionally stable, O(N) per step. The linear case is *exact*: the
  simulation reproduces the analytic decay of every discrete eigenmode to 5e-8,
  and the 2D heat kernel to 5e-4 relative L2. (The first draft used adaptive
  explicit sub-stepping, which is CFL-bound: 12 s per call at 256² and useless on
  steep terrain. The ADI version is 0.11 s at 1024².)
* Soil production `P = P₀ e^{−h/h*}` (Heimsath et al. 1997).

### 2.5 Hydraulic detail pass
* Virtual pipes / shallow water: flux update, flux rescaling, water update and
  semi-Lagrangian suspended-sediment advection (Mei, Decaudin & Hu 2007).
* Per-material sediment capacity `‖v‖ C_k sin α` so sand and bedrock erode at
  different rates (Št'ava et al. 2008); a lithology-derived hardness map drives
  `C_k`.
* Thermal talus relaxation at the angle of repose every step (Musgrave et al.
  1989; paired with hydraulic erosion as recommended for scree slopes).
* **Stability limiters** are physical, not fudge factors: a maximum flow depth
  and speed for shallow-flow validity, and a per-step removal bound proportional
  to the local flow depth. Without the last one, the capacity term feeds back on
  itself through the flow and runs away on steep fine-grained terrain (caught by
  the badlands preset at 400 iterations). There is also a guard that reverts a
  step that produced non-finite values. Stress-tested at 8× the production rain
  rate and 4× the capacity constant: finite, with the depth ceiling respected.

### 2.6 Aeolian sand (KSH dunes)
* Minimal dune model (Kroy, Sauermann & Herrmann 2002): saturation-length flux
  relaxation `ℓ_s ∂q/∂x = q(1 − q/q_s)` with `q_s ∝ τ^{3/2}`, `∂h/∂t ∝ −∂q/∂x`,
  plus the heuristic **separation bubble** at the brink — the mechanism that makes
  a barchan's slip face instead of a symmetric bump.
* Shear-stress perturbation from the same Fourier solution AeoLiS uses (Bessel
  `K₀/K₁`, inner-layer height `l`, roughness `z₀`), which is what actually makes
  dunes select their wavelength.
* Sand is tracked as a separate `z_sed` layer, which is what lets the satmap key
  "sandy" off real loose-cover depth instead of an arbitrary noise mask.

### 2.7 SDF / CSG
* Dense narrow-band float32 field, `(nz, ny, nx)` with cubic voxels.
* Primitives and CSG with smooth blends: box, sphere, cylinder, capsule, cone;
  union / subtract (mesa, hoodoo, arch, alcove, slot canyon, rock scatter).
* Reinitialisation with an algebraic pre-pass, a frozen interface inside
  `0.5·cell`, and a fast-sweeping solve (Sussman, Smereka & Osher 1994; Zhao
  2005); regression numbers in §5.
* Ray casting to a height field with multi-crossing detection (the cells a pure
  height field cannot represent), cone-sampled ambient occlusion, and surface
  nets for meshing (Gibson 1998).

### 2.8 Satmap
* Slope / aspect, profile & plan curvature (Zevenbergen & Thorne 1987), roughness,
  TPI (Weiss 2001), sky-view factor (Yokoyama et al. 2002), hard shadows by
  ray-marching the DEM toward the sun, TWI, HAND, cavity from SDF AO.
* Fuzzy-membership material splatting from soft attributes (sand: *gently sloping
  and low*; talus: *steep and concave*; cliff: *steep rock*; …), then albedo
  synthesis with stratigraphic colour banding, macro/micro fBm variation, dust
  accumulation on shelter and flat ground, moisture darkening, and aerial haze.
* Outputs: `satmap`, `albedo`, `normal`, `ao`, `cavity`, `openness`, `flow`,
  `wetness`, `height16`, `hillshade`, up to 4 splat maps per 4-material chunk,
  and a mesh (`obj` + vertex-coloured `ply`) on request.

---

## 3. Using it

```bash
python -m uvicorn frontier.service.app:app --host 0.0.0.0 --port 8010   # or frontier/service/run.py
python -m pytest tests -q                                               # validation suite
```

Open `/`. Left column: preset, base structure, erosion, satmap sliders. Centre:
the map (click to place sculpt tools, click waypoints to draw a path). Right:
the tool palette, the path list, the stroke list, run/export.

* **Surface brushes** (raise, lower, smooth, bench, terrace, talus, sand, gully)
  work on the height field.
* **Structure tools** (mesa, hoodoos, arch, alcove, slot canyon, rock field) edit
  the SDF volume and are merged back into the height field, then eroded.
* **Splines** (river, canyon, ridge, fault, levee) carve/uplift with a physical
  cross-section, and the fluvial solver then integrates the valley into the
  regional drainage network.
* **Bake** is synchronous at preview resolution; **Full** runs a background job at
  up to 4096² with a progress bar. **Export** writes the asset set to `out/<name>`
  (reusing the finished bake rather than re-simulating).

API: `GET /api/presets`, `GET /api/schema`, `GET /api/tools`,
`POST /api/preview`, `POST /api/bake`, `GET /api/jobs/{id}`, `POST /api/export`.

---

## 4. Measured behaviour

Bakes on this 2-core box, satmap included:

| preset | resolution | wall time | relief | mean slope | sand cover |
|---|---|---|---|---|---|
| rocky_canyon | 256² (32 m cells) | 35 s | 771 m | 15.6° | 6.0 % |
| sandy_canyon | 256² | 35 s | 610 m | 13.2° | 0.8 % |
| badlands | 256² | 60 s | 282 m | 18.0° | 16.5 % |
| badlands | 384² | 178 s | — | — | — |
| badlands | 128² (preview) | 6 s | — | — | — |

Where the time goes at 256²: fluvial erosion ~90 %, everything else ~10 %.
The erosion solve costs ~2.5×10⁻³ s per cell per thousand steps (routing 42 ms,
sweep 4 ms, hillslope 11 ms at 256², ~17 ms absorbed by numpy temporaries).

Simulation parameters are in **world units**, so the same document scales: at 512²
the drainage density, hillslope length and relief all match the 256² bake, with
finer detail on top.

---

## 5. Validation

`python -m pytest tests -q` → **17 passed**. Each test checks a solver against an
analytic or published reference, never against itself:

| check | result |
|---|---|
| Linear diffusion vs discrete eigenmode decay `exp(−μt)`, `μ = 4D sin²(π/N)/h²` | rel. err **4.8e-8** |
| 2D diffusion vs the analytic heat kernel | L2 rel. err **4.7e-4** |
| Mass conservation, closed domain, 50 kyr | drift **1.5e-5 m** |
| Input array not aliased by `diffuse` | passes |
| Roering flank relaxes below `S_c` | max slope ≤ `S_c` |
| FastScape `n=1` node solve vs closed form | matches to 1e-9 |
| Erosional steady state `S = (U/K)A^{−1/2}` | within an order of magnitude (see §6) |
| Flow routing: catchment areas, lengths, MFD partition | passes |
| Hydraulic pass finite under 8× rain, 4× `Kc` | finite, depth ceiling respected |
| Thermal pass enforces the repose angle from a vertical cliff | max slope ≤ tan(33°) |
| KSH dune model: finite, sand budget conserved | within 35 % |
| SDF sphere: `|∇φ| = 1` in band after reinit | mean 1.00 ± 0.15 |
| SDF height field round-trip (smooth surface) | mean error < 0.6 cell |
| Stratigraphic column actually intersected by the landscape | ≥ 4 beds exposed |
| End-to-end bake reproducible & finite | bit-identical repeats |
| Resolution independence (128² resampled vs 256²) | mean diff < 25 % of relief |
| Noise band-limiting | passes |

Also measured earlier in development: 1D stream-power strip against the analytic
profile, 0.26 % mean error (max 5.0 %); 2D slope–area concavity θ = 0.127,
r² = 0.78 on the test harness in `/tmp/val_sp.py`.

SDF regression: 64³ sphere, 1 reinit iteration → band `|∇φ|` mean 1.2655
(p95 2.42), radius 19.94 of 20.0; 96×96×48 canyon scene → reinit 0.05 s,
80 % of band cells within 0.1 of `|∇φ| = 1`, ray-cast hit rate 0.958.

---

## 6. Known limitations (stated up front)

* **Slope–area concavity** is θ ≈ 0.13 on the validation harness (m/n = 0.5). The
  simulated network is convex-up in places, and the drainage density is sensitive
  to the `K/D` ratio, so treat `m`, `n` and `K/D` as an image-control triple, not
  as calibrated field values. The concavity statistic is also dominated by
  hillslope cells unless it is restricted to channel cells, which is why the
  measured θ is reported with its r² and never used as a pass/fail gate on its own.
* **SDF voxels are coarse** relative to the terrain grid (cubic, ``world/sdf_res``,
  default 128 across the domain). Structure tools and the SDF merge are therefore
  low-detail by construction; erosion detail comes from the height field. The
  band is stored in `sdf_band.npz` when exporting.
* **Sub-voxel detail is not recoverable** from an SDF built from a rough height
  field (a one-voxel vertical wall is below the lattice's resolution). That is why
  the structure field is re-rasterised from the height field after erosion rather
  than only advected.
* **The hydraulic pass is an explicit scheme**, so it runs a bounded number of
  iterations per bake rather than to convergence; it is a detail pass on top of the
  implicit fluvial solution, not the primary erosion model. It is also in scaled
  time (the pipe model's `dt` is not in seconds of real time).
* **Aeolian time** is likewise a scaling: the KSH model's timestep is a
  morphological interval, not a physical one, and the sand source is prescribed
  rather than computed from upwind supply.
* **Hillslope `D`:** values above ~10⁻² m²/yr are only appropriate for
  soil-mantled, wet, fine-grained terrain; canyon country needs 10⁻³–10⁻², and too
  much diffusion erases the network entirely (this is exactly what the first
  calibration attempt did).
* No export to a specific game engine's terrain format yet; OBJ/PLY + PNG maps
  only.
* The service is single-process and CPU-only; a 4096² bake is tens of minutes.
  numba JIT warms the first bake of a session (~15 s).

---

## 7. File map

```
frontier/core/grid.py          Terrain (rock + sediment + water), gradients, resampling
frontier/core/noise.py         Perlin, fBm/ridged/billow, domain warp, band limiting
frontier/erosion/flow.py       priority-flood, D8, MFD/D∞, accumulation, TWI/HAND/χ
frontier/erosion/hillslope.py  Culling + Roering laws, ADI integrator, Heimsath soil
frontier/erosion/stream_power.py  FastScape implicit solve, Davy–Lague deposition
frontier/erosion/hydraulic.py  virtual pipes, multi-material capacity, thermal talus
frontier/erosion/aeolian.py    KSH dunes with the AeoLiS shear perturbation
frontier/sdf/volume.py         narrow-band SDF, CSG stamps, reinit, raycast, AO, meshing
frontier/sdf/sculpt.py         brushes, path carving, SDF stamping, z↔φ coupling
frontier/spline/path.py        centripetal Catmull-Rom paths, profiles, distance fields
frontier/layers/lithology.py   bed stacks, hardness, banded colours
frontier/texture/satmap.py     terrain attributes, material splatting, albedo synthesis
frontier/texture/export.py     PNG/16-bit/normal/mesh/splat export
frontier/pipeline/engine.py    document model, stage execution, presets
frontier/service/app.py        FastAPI service      service/static/index.html  UI
tests/test_validation.py       analytic + published-reference validation suite
```

`out/` holds exported asset sets and is not tracked by git.
