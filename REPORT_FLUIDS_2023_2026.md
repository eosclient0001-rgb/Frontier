# Fluids for Realtime Games on GTX → RTX: Ocean, Water, Smoke & Fire
## Research report, 2023–2026 — for the Frontier engine

**Date:** 2026-09-07
**Scope:** realtime techniques a custom game engine can ship on a GTX-class baseline (GTX 1060/1070/1080)
while scaling up on RTX (3060 → 4070+). Covers ocean, interactive water, smoke and fire.
**Repo status note (read first):** this `Frontier` checkout contains only the initial commit —
there is no ocean/fluid code in it, so there is **no server I can run for a preview here**.
Your ocean work (waves + foam + spray tiers, WebGPU harness) lives in the other session/repo
(`arena/01a071a3-slate`, commits up to `d6cdccc`). Nothing was lost *in this repo* — it simply
never held that code. If you want a preview inside Frontier, the next step is to port the
Project-Ocean directory over (or point me at it) — see §5.4.

---

## TL;DR

1. **You are right: Unreal uses far fewer particles than a brute-force FLIP/MPM sim, and that is
   exactly why it is more performant.** UE's ocean uses **zero particles** for the water itself;
   particles exist only as accents (spray sprites, splash bursts). Realism comes from the
   **shading stack**, not the simulation. [2](https://www.strayspark.studio/blog/ocean-water-simulation-ue5-guide)
2. **Unreal's ocean looks better because of ~10 layered shading cues**, not better waves:
   FFT/Gerstner displacement + detail normals + depth-based absorption/scattering + shoreline
   SDF foam + Jacobian crest foam + planar/screen-space reflections + sun glitter + underwater
   fog/caustics + spray. Your WebGPU ocean has the sim; the gap is almost entirely this stack.
3. **Character/stone interaction with water is real in UE and cheap** — but it is not particle
   collision. It is: heightfield/SDF sampling for buoyancy, a tiny **ripple solver** that follows
   the character, foam/decal masks stamped by velocity, and Niagara GPU sprites for splashes.
   Stones are "interacted with" via top-down heightfield capture (Fluid Flux) or distance-field
   foam. [1](https://www.fab.com/listings/196c70cd-1283-4249-bf6b-c3019d1cbe11?lang=en)
4. **Camera-dependent foam ("only works near camera") is a deliberate, universal optimization.**
   Every shipped ocean fades cascades/detail with distance (War Thunder: 4 FFT cascades, far ones
   dropped at range; UE: distance-based tessellation + LOD). Distant foam is baked into the
   normal/scattering terms instead. [2](https://developer.download.nvidia.com/assets/gameworks/downloads/regular/events/cgdc15/CGDC2015_ocean_simulation_en.pdf)
5. **Smoke/fire in shipped games is almost never simulated live at full quality.** The
   industry pipeline (2023–2026) is: author in EmberGen (realtime GPU sim, min spec **GTX 1060**),
   export **flipbooks/VDB**, play back cheap sprites or raymarch small volumes in-engine.
   Fully live sims (Niagara Fluids, CS2-style voxel smoke) exist but are budgeted as hero effects
   at 64³–128³ grids and quarter-res raymarching. [4](https://www.cgchannel.com/2024/01/jangafx-releases-embergen-1-1/)
6. **2023–2026 research direction (SIGGRAPH): real-time liquid with *millions* of GPU particles is
   now possible, and neural-hybrid solvers (Hybrid Neural-MPM, 2025) cut MPM latency ~30%** —
   but games still prefer grids + shading tricks because particles scale badly with gameplay
   interaction. Use particles for *look*, grids/SDF for *interaction*. [2](https://www.siggraph.org/wp-content/uploads/2023/07/ACM-SIGGRAPH-2023-Courses.html) [1](https://arxiv.org/html/2505.18926v1)

---

## 1. Your questions, answered directly

### 1.1 "Unreal's ocean and foam still look better" — why?

Unreal's built-in Water plugin ocean is, simulation-wise, *simpler* than what you already built:
an infinite plane with **two layers of Gerstner waves** (parametric sine-like waves, not a real
fluid solve), tessellated by a quadtree that refines near the camera.
[1](https://unrealai.studio/tutorials/water-system) [5](https://yelzkizi.org/water-simulation-in-unreal-engine/)
It looks good because of everything *around* the displacement:

| Layer | What UE / premium plugins do | Your ocean (Slate session) |
|---|---|---|
| Base displacement | Gerstner (stock) or FFT spectrum (Oceanology NextGen, custom Niagara FFT) | Real spectrum sim — already ahead of stock UE |
| Crest foam | Jacobian-of-displacement (Tessendorf) + foam textures, advected | Jacobian/bore masks — equivalent idea |
| Shore foam | **Depth-fade + SDF coastline + animated wave-profile** (Fluid Flux), layered foam textures at 2–3 scales | Swash film + wet band — right idea, needs SDF + multi-scale breakup |
| Water color | SingleLayerWater model: absorption color, scattering color, depth opacity | Partial — needs the full absorption/scattering LUT |
| Reflection | Planar + screen-space reflections, sun glitter (specular from detail normals) | Needs work — this is the single biggest "looks real" cue |
| Detail | Tiling normal maps + noise distortion in shallows | Wind ripples existed (were a bug in sand; keep them on water) |
| Underwater | Volumetric fog, caustics, god rays responding to surface | Not present |
| Spray | Niagara GPU sprites spawned where foam/crest masks fire | Tier-3 tufts — architecturally the same thing |
| Audio/buoyancy | Pontoons sampling water height, wave-state-driven audio | Buoyancy not yet wired |

Takeaway: **close the gap with shading, not with more physics.** An FFT ocean with a weak
material always loses to Gerstner waves with a great material. Budget your effort ~30% sim,
~70% shading/interaction — that matches how UE plugin vendors split it
(Oceanology Legacy targets **GTX 1080 / RTX 3060** with Gerstner-class sim + heavy shading;
only the NextGen tier asks for RTX 3080+ for full FFT).
[5](https://www.fab.com/listings/1cd1f62e-0fa3-48bf-bc60-f0e06010fce3) [3](https://www.fab.com/listings/87c9af41-62b7-4e70-98e3-fc72eff016ab)

### 1.2 "My fluid sim needs tons of particles for realism — is Unreal also like that?"

No — the opposite. Three facts:

- **UE ocean: 0 particles.** The surface is a displaced mesh + materials. No SPH, no FLIP.
- **Niagara Fluids (fire/smoke/pool water/splashes)** simulates **voxel grids, not particles**:
  Grid 3D Gas for smoke/fire, Grid 2D for surface flow, SPH only for small-volume liquid —
  and SPH is documented as the most expensive option, used sparingly.
  "Grid 2D is the cheapest, SPH the most expensive."
  [3](https://altheragames.com/en/blog/ue5-niagara-vfx-guide) [2](https://forums.unrealengine.com/t/tutorial-welcome-to-niagara-fluids/587140)
- Where UE *does* use particles (Niagara GPU sprites), counts are modest and LOD'd:
  indie guidance is **< 30 active emitters**, per-quality particle budgets, and profiling any
  system over **~0.5 ms** GPU. A single 100k GPU-particle emitter can cost more than five small
  ones combined. [3](https://altheragames.com/en/blog/ue5-niagara-vfx-guide) [4](https://www.strayspark.studio/blog/niagara-vfx-advanced-simulation-stages)

The modern pattern (SIGGRAPH 2023 course: "real-time 3D liquid with **millions of particles**
on GPU, integrated into UE5") is: simulate on GPU, but render via **screen-space fluid
rendering** (depth blur + normals from depth + absorption) so 1–2 M particles read as a
continuous liquid. Even then, this is for *hero puddles/splashes*, never the whole ocean.
[2](https://www.siggraph.org/wp-content/uploads/2023/07/ACM-SIGGRAPH-2023-Courses.html)

**Your instinct is correct and you should trust it:** if your ocean-adjacent fluid sim needs
huge particle counts to look acceptable, the fix is not more particles — it is a grid/SDF +
shading approach with particles only as surface spray. That is literally what every shipped
solution does.

### 1.3 "Could a character interact with the ocean, or stones — splashes?"

Yes, and there are three shipped mechanisms, all cheap:

1. **Buoyancy by sampling, not by collision.** UE's BuoyancyComponent puts "pontoon" sample
   points on a boat/crate/character and queries water height at those points (analytic Gerstner
   sum or FFT texture readback), then applies spring forces. No fluid particles involved.
   [1](https://unrealai.studio/tutorials/water-system)
2. **Ripple solver that follows the player.** Fluid Flux ships a "simple, cheap ripple solver
   moving with character, optimized to an absolute minimum" plus velocity-based force modifiers:
   the character stamps velocity/height into a small local grid; foam and caustics advect with it.
   Stones/obstacles work the same way globally: the shallow-water sim captures the ground +
   obstacles as a **top-down heightfield**, and water flows around pillars automatically
   (bridges can be ignored by flag). [1](https://www.fab.com/listings/196c70cd-1283-4249-bf6b-c3019d1cbe11?lang=en)
3. **Splashes = GPU sprites + decals triggered by events.** A trajectory crossing the water
   plane (or a pontoon impact velocity) spawns a Niagara burst + a foam decal + a ripple stamp.
   EmberGen-made flipbooks are the usual splash/smoke content.

So: character swimming with wakes and bow waves, stones with foam collars and diverted flow,
splashes on entry — all doable on GTX. None of it needs particle-fluid coupling.

### 1.4 "Foam/waves only work near camera — is that an optimization?"

Yes — keep it. It is *the* standard optimization, applied at three levels:

- **Cascade fade:** War Thunder's ocean splits the spectrum into 4 FFT cascades (5 m → 1 km
  tiles) and **fades out / skips small cascades at distance** — less noise, less GPU work.
  [2](https://developer.download.nvidia.com/assets/gameworks/downloads/regular/events/cgdc15/CGDC2015_ocean_simulation_en.pdf)
- **Mesh LOD:** UE's water mesh is a quadtree; Godot/Encino FFT ports lock a tessellated mesh
  to the camera and extend to the horizon with a cheap plane. Stockham FFT + butterfly texture
  + row/column transpose in compute is the reference GPU pattern.
  [5](https://yelzkizi.org/water-simulation-in-unreal-engine/) [2](https://github.com/2Retr0/GodotOceanWaves)
- **Update-rate staggering:** GodotOceanWaves updates only **one cascade per frame** when frame
  time allows, because wave motion is perceptually smooth without per-frame updates — this kills
  FFT stutter on weaker GPUs. [2](https://github.com/2Retr0/GodotOceanWaves)

Rule of thumb: full foam + spray + ripples inside ~60–100 m, displacement-only to ~500 m,
normal/scattering shading to the horizon. Your tier-2/tier-3 distance thinning is exactly this.

---

## 2. Ocean: state of the art 2023–2026 (what to copy)

### 2.1 The undisputed base: Tessendorf FFT + Phillips/JONSWAP spectrum

Every high-end realtime ocean (Ubisoft, War Thunder, Oceanology NextGen, Godot ports, WebTide/WebGPU)
is Jerry Tessendorf's "Simulating Ocean Water": Phillips spectrum × Gaussian randoms → propagate by
dispersion relation → inverse FFT → displacement + normal maps; **foam from the Jacobian** of the
flat→displaced transform (J < 0/1 = crest curling = foam). [2](https://developer.download.nvidia.com/assets/gameworks/downloads/regular/events/cgdc15/CGDC2015_ocean_simulation_en.pdf) [1](https://github.com/BarthPaleologue/WebTide)

Practical spec for GTX baseline:

- **FFT 256², 3 cascades** (e.g. tiles 8 m / 32 m / 180 m) on GTX; **512², 4 cascades** on RTX.
  Stockham formulation (no bit-reversal), butterfly texture precomputed once per resolution.
  [4](https://github.com/achalpandeyy/OceanFFT) [2](https://github.com/2Retr0/GodotOceanWaves)
- **Fallback:** 4–8 Gerstner waves evaluated in the vertex shader (zero compute, runs anywhere).
  This is UE stock behavior and Oceanology Legacy's GTX path.
- **Foam:** Jacobian → accumulate linearly, decay exponentially (Tessendorf's own recipe:
  "foam grow rate / foam decay rate"); advect with surface velocity; shade through 2 octaves of
  noise ("lace") with pixel-footprint band-limiting so the horizon doesn't shimmer.
  [1](https://github.com/2Retr0/GodotOceanWaves)
- **Stagger cascade updates** (one cascade/frame) on GTX. [2](https://github.com/2Retr0/GodotOceanWaves)

### 2.2 Shoreline: SDF + wave profiles + shallow water (the "beach" problem)

Nobody simulates breaking waves with Navier-Stokes in games — Fluid Flux states it plainly:
"Wave breaks are not simulated. It's based on a predefined wave profile animation,"
driven by a **signed distance field of the water–ground intersection**, plus a real
**shallow-water (heightfield) sim** for flow/foam/wetness and a ripple solver for interaction.
[1](https://www.fab.com/listings/196c70cd-1283-4249-bf6b-c3019d1cbe11?lang=en) [4](https://imaginaryblend.com/2021/09/26/fluid-flux/)

Recipe for your beach:

1. Top-down heightfield capture of terrain (+ stones flagged as obstacles).
2. Shallow-water sim (Müller-style heightfield flow) on a 256²–512² patch around the camera focus.
3. SDF-to-shoreline → animated surf profile + foam injection where depth < threshold and
   onshore velocity > threshold (your 25 cm / 0.3 m/s rule is the right shape).
4. Wet band + waterline + caustics advected by the flow field; swim/buoyancy queries read the
   same height texture (async readback).

### 2.3 Interaction & spray budgets (GTX numbers)

- Ripple/interaction patch: **128²**, follows player, < 0.3 ms.
- Spray: **16–32k GPU sprites on GTX, 64–128k on RTX**, spawned only where crest/bore masks
  fire within ~60–80 m, 1/d² thinning beyond — your tier-3 design already matches this.
- Splashes: pooled Niagara-style bursts (a few hundred sprites each) + flipbook textures.

---

## 3. General water/fluid sim 2023–2026 (where particles *do* belong)

- **Niagara Fluids remains the reference game framework**: grid sims (Gas 3D / 2D) + SPH liquid,
  all GPU, template-driven. Indie guidance: prototype with plain emitters first; Fluids only when
  you genuinely need fluidity; Grid 2D ≪ Gas 3D ≪ SPH in cost.
  [3](https://altheragames.com/en/blog/ue5-niagara-vfx-guide)
- **Niagara as a compute framework**: Simulation Stages let you run grid solvers with *no*
  particles at all, then spawn a small number of sprites only where the field exceeds a
  threshold to visualize. "A 256×256 grid does not need 65,536 particles to visualize."
  This is the pattern your engine should steal for all local effects.
  [4](https://www.strayspark.studio/blog/niagara-vfx-advanced-simulation-stages)
- **Research (2025): Hybrid Neural-MPM** runs learned physics at coarse resolution with automatic
  fallback to classical MPM, cutting latency ~30% (e.g. 0.114 s → 0.08 s/frame on 2D multi-material).
  Promising, but still **~80 ms/frame** — not shippable for games yet; watch, don't adopt.
  [1](https://arxiv.org/html/2505.18926v1)
- **Verdict for Frontier:** ship **grids + screen-space fluid rendering** for local water
  (puddles, pours, splashes); reserve true particles (APIC/FLIP/MPM) for an RTX-tier "hero splash"
  mode and for offline/baked content. Never particles for the ocean surface.

---

## 4. Smoke & fire 2023–2026 (the pipeline that actually ships)

### 4.1 Author realtime, ship flipbooks — the EmberGen pipeline

JangaFX EmberGen is the industry standard for game smoke/fire: a **GPU volumetric gas solver
with combustion (fuel/oxygen), wind/turbulence, and mesh colliders**, running realtime down to
**GTX 1060 min spec**. But games do not run it live — artists sim in EmberGen, then export
**flipbook sprite sheets (+ motion vectors, normals, emissive/temperature passes)** or VDB,
and the engine plays back cheap camera-facing sprites. EmberGen 1.1 (Jan 2024) focused on
collider quality (smoke through pipes) and bone-parented emitters (creature breathing fire).
[1](https://www.cgchannel.com/2020/05/jangafx-ships-embergen-in-beta) [4](https://www.cgchannel.com/2024/01/jangafx-releases-embergen-1-1/) [5](https://live.jangafx.com/software/embergen/)

Why flipbooks won: a 128-frame 2k flipbook explosion costs ~a few dozen sprite overdraw samples;
the equivalent live 128³ sim + raymarch costs milliseconds *every frame* and fights gameplay for
GPU. For Frontier: **build the flipbook playback + lighting path first** (works on any GTX),
add live sims second.

### 4.2 Live smoke in-engine (hero effects): small grids, quarter-res raymarch

When smoke *must* react to gameplay (CS2 grenades, flamethrowers), the shipped pattern is:

- **Sim:** 64³–128³ gas grid (velocity + temperature + density), semi-Lagrangian advection,
  a few Jacobi pressure iterations, Perlin-Worley detail noise; flood-fill/BFS constrained spread
  for gameplay-readable shapes; dynamic colliders for players/objects.
- **Render:** compute raymarch at **quarter resolution** with Beer's-law extinction + analytic
  in-scattering, early termination on scene depth, temporal upsample; bit-packed voxels for memory.
  An SMU thesis implementing exactly this CS2-style system reports stable realtime performance
  with these optimizations on RTX 3080-class, scaling down by grid size and step count.
  [1](https://scholar.smu.edu/cgi/viewcontent.cgi?article=1002&context=guildhall_programming_etds)
- **Fire** adds: blackbody temperature ramp + emissive scattering, fuel burn field, point-light
  injection into the scene (1–2 dynamic lights), optional distortion pass. Same grid, same marcher.

### 4.3 Concrete GTX → RTX smoke/fire budgets

| Tier | Grid | March steps | Resolution | Content | Target cost |
|---|---|---|---|---|---|
| GTX 1060/1070 (min) | flipbooks only + 64³ | 8–16 (or none) | ½–¼ res | 2–3 concurrent hero smokes | < 1.5 ms |
| GTX 1080 (baseline) | 96³ gas, 1–2 live + flipbooks | 16–24 | ¼ res, bilateral upsample | + flamethrower, small fires | < 2.5 ms |
| RTX 3060+ | 128³, 2–4 live | 24–48 w/ temporal | ¼ res + TAA accumulation | + large explosions, thick smoke | < 3.5 ms |
| RTX 4070+ (ultra) | 128³–192³ sparse/NanoVDB-style | 48–64 | ½ res | + full-scene fog volumes | < 5 ms |

Key scalers (all runtime-switchable): grid res, step count, march resolution, live-effect count,
noise octaves. Never particle count — live smoke should barely use particles at all (embers/sparks
only, a few hundred GPU sprites).

---

## 5. Recommendations for the Frontier engine

### 5.1 Architecture: three lanes, one shading stack

```
OCEAN (always on)          LOCAL WATER (near camera)        SMOKE/FIRE (events)
FFT 256²×3 (GTX)           Shallow-water 256² patch         Flipbook sprites (base)
  → 512²×4 (RTX)             + ripple follower 128²           + gas grid 64³→128³ (hero)
Gerstner fallback            + SPH/fluid-render hero splash   + raymarch ¼ res
Jacobian foam + lace           (RTX mode)                     + embers (100s of sprites)
SDF shoreline + surf profile Buoyancy = height sampling      Lights: 1–2 per fire
Spray sprites 32k→128k     Foam decals + splash bursts      EmberGen-authored content
```

### 5.2 What to build in what order

1. **Ocean look pass (closes the UE gap):** absorption/scattering water material, planar+SSR
   reflections, sun glitter, multi-scale shore foam from SDF, underwater fog + caustics.
   No new sim — pure shading. Biggest visual ROI.
2. **Interaction lane:** top-down heightfield capture, ripple follower, buoyancy sampling,
   splash event system (burst + decal + stamp). Stones/character/boats "just work."
3. **Smoke/fire playback:** flipbook renderer with lighting/temperature passes + EmberGen(or
   equivalent)-authored library. Then **one** live 64³ gas sim + quarter-res marcher for hero smoke.
4. **RTX scale-up:** 4th cascade + 512² FFT, 128³ gas grids, hero SPH splash mode, denser spray.
5. **Watch-list (don't build yet):** neural-hybrid MPM, full-scene NanoVDB fog, live FFT→buoyancy
   readback at high rate.

### 5.3 Performance envelope (1080p60 targets)

- Ocean total (sim + tessellation + shading + foam + spray): **GTX ≤ 4 ms, RTX ≤ 3 ms**
  (sim ≤ 1 ms via staggered cascades; shading dominates — as in UE).
- Local water + interaction: **≤ 1.5 ms** on GTX.
- Smoke/fire (typical combat scene): **≤ 2.5 ms** on GTX 1080 (table above).
- All lanes runtime-scalable by preset; detect GPU class at startup, allow per-lane override.

### 5.4 Immediate next step for this repo

`Frontier` is empty — the ocean code (Project-Ocean, WebGPU harness, shaders, reports) lives in
the Slate session. To proceed here, either:

- **(a)** tell me where the Slate checkout/working tree is (or push its branch to a readable
  remote) and I will port `Projects/Project-Ocean` + docs into `Frontier/` preserving history;
  then I can start a preview server from real code; or
- **(b)** start fresh in Frontier with a minimal engine scaffold + the FFT-ocean look pass from
  §2 as the first milestone.

Once code exists here, `start_process` preview + per-lane GPU timings (your `-Proof`/`perkernel=1`
CSVs) become the standing verification loop — same as the Slate session ran.

---

## Appendix: sources

- UE5 Water plugin: ocean/lake/river bodies, Gerstner waves, buoyancy.
  [1](https://unrealai.studio/tutorials/water-system) [5](https://yelzkizi.org/water-simulation-in-unreal-engine/)
- UE ocean tiers: stock Gerstner → Niagara → FFT; LOD/cascade strategy.
  [2](https://www.strayspark.studio/blog/ocean-water-simulation-ue5-guide)
- Practical UE5 ocean look (tessellation, depth fade, foam fixes).
  [4](https://toxigon.com/tutorial-creating-a-realistic-ocean-in-ue5)
- Niagara Fluids: grids-vs-particles, Grid 2D/3D, SPH cost ordering; perf guidance (<30 emitters, 0.5 ms flag).
  [2](https://forums.unrealengine.com/t/tutorial-welcome-to-niagara-fluids/587140) [3](https://altheragames.com/en/blog/ue5-niagara-vfx-guide)
- Niagara Simulation Stages: grid compute without particles; spawn-to-visualize pattern; Grid2D perf notes.
  [4](https://www.strayspark.studio/blog/niagara-vfx-advanced-simulation-stages)
- Fluid Flux (Fab): shallow-water heightfield sim, ripple follower, SDF coastline + wave profiles, limits.
  [1](https://www.fab.com/listings/196c70cd-1283-4249-bf6b-c3019d1cbe11?lang=en) [4](https://imaginaryblend.com/2021/09/26/fluid-flux/)
- Oceanology Legacy (GTX 1080/RTX 3060 target) vs NextGen (RTX 3080+, FFT + surf waves).
  [5](https://www.fab.com/listings/1cd1f62e-0fa3-48bf-bc60-f0e06010fce3) [3](https://www.fab.com/listings/87c9af41-62b7-4e70-98e3-fc72eff016ab)
- War Thunder/NVIDIA: 4-cascade FFT ocean, cascade fade at distance, Jacobian foam.
  [2](https://developer.download.nvidia.com/assets/gameworks/downloads/regular/events/cgdc15/CGDC2015_ocean_simulation_en.pdf)
- Tessendorf FFT references: WebTide (WebGPU + Jacobian foam), GodotOceanWaves (Stockham FFT, cascades, stagger), EncinoWaves (compute FFT 512 + camera-locked mesh).
  [1](https://github.com/BarthPaleologue/WebTide) [2](https://github.com/2Retr0/GodotOceanWaves) [3](https://github.com/speps/GX-EncinoWaves)
- SIGGRAPH 2023 course: realtime GPU liquid with millions of particles + UE5 integration.
  [2](https://www.siggraph.org/wp-content/uploads/2023/07/ACM-SIGGRAPH-2023-Courses.html)
- Hybrid Neural-MPM (2025): learned coarse physics + MPM fallback, ~30% latency cut.
  [1](https://arxiv.org/html/2505.18926v1)
- EmberGen: realtime GPU gas sim, GTX 1060 min spec, flipbook/VDB export pipeline; v1.1 colliders + bone emitters.
  [1](https://www.cgchannel.com/2020/05/jangafx-ships-embergen-in-beta) [4](https://www.cgchannel.com/2024/01/jangafx-releases-embergen-1-1/)
- CS2-style voxel smoke thesis: flood-fill spread, Perlin-Worley, quarter-res Beer's-law raymarch, bit-packing.
  [1](https://scholar.smu.edu/cgi/viewcontent.cgi?article=1002&context=guildhall_programming_etds)
