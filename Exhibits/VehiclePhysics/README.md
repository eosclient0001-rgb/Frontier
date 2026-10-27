# 🧩 VehiclePhysics — Phase 7: three tyre models, vehicle dynamics, Jolt collisions

Proves the production physics in `Frontier/Engine/Physics/` against the HTML demonstration's own code and numbers, then
drives the car on it. Run everything (Jolt 5.2.0 is fetched/built once into `_ClaudeScratch/`, node runs the demo's
JS oracles):

```
PYTHON=<pillow python> bash Exhibits/VehiclePhysics/RunVehiclePhysics.sh
```

## ⭐ What was ported, and what was not in the demo to port

| Model | Demo source | Verdict | Production file |
|---|---|---|---|
| Tyre force (Pacejka MF6.1) | `TyreSlipSolver.js` ✔️ real | ported 1:1 | `TyreSlipSolver.{h,cpp}` |
| Carcass spring K = 25 kN/m + 0.9·p + vehicle | `VehicleSolver.js` ✔️ real | ported 1:1 | `VehicleSolver.{h,cpp}`, `VehicleSpecification.h` |
| Tyre heat / gas law / grip / wear | `TyreThermalSolver.js` ✔️ real | core ported 1:1 (smoke emission excluded, stated) | `TyreThermalSolver.{h,cpp}` |
| "3D FEM" deformation | `VehicleVisual.wgsl ResolveWheelVertex` ✔️ GPU PB-FEM *deformation* | ported 1:1 (vertex math + encoder) | `TyreDeformation.h` |
| XPBD soft-body lattice | 🔴 **not in the demo** ("there is no XPBD carcass here") and not in this repo | **implemented new**, calibrated to the same tyre | `TyreCarcassLattice.{h,cpp}` |
| Collisions | `JoltWorld.js` (Jolt WASM loose bodies + chassis proxy) | same architecture on Jolt C++ 5.2.0 | exhibit `Code/JoltScene.cpp` |

Stated deviations of the vehicle port: the driving surface is a caller height function (flat here) instead of the demo's
sculpted course; wheels do not ride loose debris (the demo's `RigidBodyWorld` support query); the 700-point hull is not
assigned, so the demo's sphere hull stands in; scrape/spark bookkeeping (visual only) is omitted. The car is *not*
Jolt-driven — exactly as in the demo, its own 480 Hz solver drives, and Jolt owns loose bodies plus a zero-gravity
chassis proxy that exchanges only collision velocity deltas.

## ✔️ Checks (29/29, see Results.txt)

- **A1–A4** MF6.1 Fx/Fy/combined/relaxation vs `Code/TyreOracle.mjs` running the demo's unmodified JS under node:
  max relative error **1.8e-15** (bit-exact port). **A5** PB-FEM vertices vs a WGSL transliteration: 8.7e-08 m.
  **A6** thermal trajectory (25 kW slide, 8 s): error **0.0** — the conduction/gas-law/grip port is exact.
- **B** Static settle vs the demo's `VolumetricTyrePhysics.test.mjs`: deflection 14.0–14.5 mm (band 10–25), contact
  angle −π/2, 220 kPa, corner loads sum to weight within **0.00 %**.
- **C** XPBD lattice rig vs the spring curve: within **0.75–1.30×** at 220 kPa for 10–40 mm deflection, force ordered
  by pressure, enclosed volume conserved to +0.31 % under 20 mm load. ⚠️ Disclosed residual: at 0 kPa gauge the
  lattice runs ~2× stiff past 20 mm (belt geometric floor; the spring model's flat-tyre regime is softer) — visible
  in `CarcassCurves.png`, not hidden by the tolerance choice.
- **D** The whole car on the lattice carcass: settles at 13.6 mm mean deflection (spring: 14 mm) and drives
  (20.4 m, 12.5 m/s in 3 s WOT).
- **E** Scripted drive on the 1:1 spring model: launch to **36.8 m/s in 7 s** with AMT upshifts and 1.17 bar boost;
  governed slalom (4 yaw sign changes, 0.064 rad peak slip angles); full brake stop; **line-lock burnout** — rear slip
  pegged at the 1.5 clamp while the car stays under 0.12 m/s and rear tread climbs **+78 K** through the thermal
  model; release launches the car.
- **F** Jolt scene: **10/10 cones** displaced/tipped with 12.24 m/s of velocity exchanged back into the car; wall
  impact at 12.3 m/s stopped to 0.24 m/s by the proxy exchange, nose penetration 0.023 m.

## Evidence files

`Results.txt`, `PacejkaCurves.png`, `CarcassCurves.png`, `TyreDeformation.png` (FEM outlines + lattice particles),
`DriveTrace.png`, `JoltScene.png`, and the CSVs they render (`pacejka.csv`, `lattice.csv`, `lattice_particles.csv`,
`fem_outline.csv`, `drive.csv`, `jolt_trace.csv`). Code lives in `Code/` per exhibit convention and links only
production physics + Jolt — no exhibit-local physics.

## 🎞️ Visuals — the actual ControlVehicle, rendered (`Visuals/`, `RenderVehiclePhysics.sh`)

`Code/SceneRender.cpp` is a small software rasterizer (no GPU in the sandbox) that loads the real production
geometry — `ControlVehicleBody/Tyre/Rim.facet` from the VehicleProvingGrounds archive — assembles the wheels
exactly as the demo's `ProjectWheelFacets` does (Y-mirrored right wheels with swapped winding, rim scaled to the
tyre rim radius, rim family 9 → RimBase), shades with the demo's authored `CourseMaterial` linear albedos
(BodyCoat chartreuse, near-black VehiclePlastic flanks, blue-metal Hub accent), and drives the mesh from the live
production physics: body pose and wheel poses from `VehicleSolver`, tyre vertices deformed per frame by
`TyreDeformation.h` (PB-FEM) from each corner's true deflection/pressure/camber, tread tint from
`TyreThermalSolver` surface temperatures, cones/wall from the Jolt scene. Flat lambert+hemisphere+Blinn shading,
planar projected shadow, checker proving ground — deliberately a fast flat render, not the path tracer.

- `Visuals/hero.png`, `hero-rear.png` — settled car on deformed tyres (14 mm @ 220 kPa).
- `Visuals/shade-probe.png` — cheap-renderer material/roughness sphere chart (see upgrade section below).
- `Visuals/tyre-nominal.png` / `tyre-flat.png` — same corner at 220 kPa (14.0 mm) and 30 kPa (60.2 mm): the mesh
  follows the carcass spring.
- `Visuals/tyre-lattice.png` — the XPBD lattice's 84 particles (blue crown, amber sidewall) carrying the car at
  13.8 mm, rubber hidden.
- `Visuals/SlalomDrive.gif` — launch → governed 15 m/s slalom → brake, chase camera, live tyre deformation.
- `Visuals/Burnout.gif` — line-lock burnout; the rear tread mesh glows as the thermal solver heats it.
- `Visuals/ConeHits.gif` — Jolt cone row + wall, proxy velocity-delta exchange stopping the car.

Reproduce: `bash Exhibits/VehiclePhysics/RenderVehiclePhysics.sh` (builds Jolt 5.2.0 if absent, renders all
modes, assembles via `Code/AssembleVisuals.py`).

Renderer caveats, stated plainly: smooth tyre shading uses per-vertex averaged normals (demo shades per-corner);
the ground is a camera-snapped tile grid because the rasterizer drops triangles with a vertex behind the camera
(no near-plane clipping); shadows are a single planar projection of the car onto z=0; headlight/taillight
emission is scaled down from the authored HDR values so the flat renderer does not blow out.

## Cheap-renderer upgrade (2026-10-27) — better looking, still not PBR, measured faster

Same architecture (z-buffer triangles, one directional sun, one hemisphere ambient, one Blinn
lobe, planar projected shadow, no textures, no extra geometry passes). What changed is the
arithmetic inside those same terms:

| Term | Before | Now |
|---|---|---|
| Specular | `pow(N·H, 2+220(1−r)) · (0.04+0.5(1−r))`, metal tint `albedo×3` (invented energy; highlight strength collapsed as roughness changed) | normalised Blinn `(e+8)/8π · pow(N·H, e)` × Schlick Fresnel (F0 = 0.04 dielectric, F0 = albedo metal, no ×3) × sun colour. Highlight energy is roughness-stable; grazing rim appears on paint, glass and the blue Hub metal |
| Shadow | ground pixels multiplied by magic 0.42/0.46, hard one-pixel edge, darkened during the shadow raster | coverage mask + 2×2 tap (one-pixel penumbra) applied once at write-out, bounded to the mask's screen box. Multiplier is derived, not magic: `ambient/(ambient+direct)` per channel for up-facing ground (0.36/0.39/0.47) — shadows now read bluer than lit ground, as they should |
| Haze | emission added before haze, so lamps washed to sky grey | emission added after haze; lamps keep their colour |
| Display | Reinhard `c/(1+c)` × 1.5, gamma 2.2 (grey highlight rolloff, hue loss) | Narkowicz ACES (the demo's own `ProjectFilmic`) through an 8192-entry LUT over [0, 8] — one lookup per channel, cheaper than the Reinhard division + pow it replaces |
| Sky + sun in `SceneRender` | screen-space gradient unrelated to any atmosphere; no sun disc | sky anchors (zenith / 14.5° / horizon, sunward and away) sampled once per scene from the production `AtmosphereModel`, piecewise-interpolated per row; analytic limb-darkened sun disc (`LensFlareModel`, Neckel & Labs law) composited in screen space. Per-pixel cost is a few multiplies — no scattering integration per pixel |

New `shade-probe` mode (`Visuals/shade-probe.png`): five authored materials × roughness
0.08/0.30/0.60/0.90 spheres under the hero sun, for inspecting the sweep at a glance.

Performance (this sandbox, 2-core, `hero` = two 1600×900 stills including physics settle,
5 runs): **0.375 s → 0.296 s per run (−21%)**. The LUT tonemap and the bounded shadow apply
more than pay for the Fresnel/sky arithmetic. No PBR, no shadow map, no extra buffers beyond
the one-byte coverage mask.

## Real-tyre verification (2026-10-27)

The A-checks prove the C++ is a bit-exact port of the demonstration's JS (max rel err
1.8e-15). They do not prove the demonstration's numbers describe a real tyre.
`Exhibits/NightSky/Code/RealWorldValidation.cpp` §Tyre measures both against Pacejka's
published bands (racing slick μ ≈ 1.3–1.6, Cα/Fz ≈ 6–30 /rad, relaxation ≈ 0.3–0.6 m):

| Quantity (4 kN load) | Demonstration sheet | Verdict | Measured-slick sheet |
|---|---|---|---|
| Peak μ longitudinal | 1.90 | 🚩 high (F1 territory) | 1.45 ✔️ |
| Peak μ lateral | 2.36 | 🔴 outside any measured pneumatic tyre | 1.46 ✔️ |
| Cα / Fz | 20.8 /rad | ✔️ inside 6–30 | 20.8 /rad ✔️ (stiffness factors untouched) |
| Relaxation length (lat) | 0.043 m | 🔴 ~10× below measured; force response is near-instant | 0.31 m ✔️ |
| Carcass stiffness @ 220 kPa | 223 kN/m (25 kN/m + 0.9·p) | ✔️ measured band 150–350 kN/m; static deflection 14.3 mm ✔️ | — |

So: **the port is faithful; the source sheet is an authored game tyre, not a measured one.**
The XPBD lattice is likewise new work (not in the demo), already disclosed in §C above.
An opt-in measured sheet is now provided — `Frontier::ResolveMeasuredSlickParameters()`
(`VehicleSpecification.h`) + `VehicleSolver::AssignTyreParameters(...)` — retuning only the
peak factors (accounting for the MF6.1 load-term multipliers ≈×1.19/×1.28 at 4 kN) and the
relaxation lengths. The demonstration sheet remains the default, so all 29 checks above
still measure the port against its source. Switching the game car to the measured sheet is
a feel decision for the owner, not a parity fix.
