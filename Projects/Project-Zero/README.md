# Project Zero — Celestial Port (Lens Flare + Clouds)

Project Zero renders one frame in which the whole celestial port is live at once: atmosphere, sun, sky,
twilight, stars, moons, the cloud layer, the volumetric cloud deck, the local cloud volume, both fogs, wind,
precipitation, the rainbow, **the lens flare**, and the tonemap chain.

## Where the lens flare and the clouds come from

Nothing in `Source/` is an original effect. Every kernel is the published reference celestial console —
<https://sultanaladin.github.io/Frontier-/celestial/> — transcribed expression for expression:

| Reference (GLSL, `#fs`) | Here (C++)                                    |
| ----------------------- | --------------------------------------------- |
| `lensFlare(uv, s, vis)` | `CelestialIntegrator::LensFlare`              |
| flare composite in `main()` | `CelestialIntegrator::AddLensFlare`       |
| `cloudLayer(dir,…)`     | `CelestialIntegrator::CloudSlab`              |
| `cloudMarch(ro,rd,…)`   | `CelestialIntegrator::CloudMarch`             |
| `marchLocal(…)`         | `CelestialIntegrator::MarchLocalVolumes`      |
| `atmosphere(ro,rd,…)`   | `CelestialIntegrator::IntegrateAtmosphere`    |
| `rainbow(dir,…)`        | `CelestialIntegrator::Rainbow`                |
| tonemap chain           | `CelestialIntegrator::ResolveDisplay`         |

The files under `Source/` are vendored **byte-for-byte** from `sultanaladin/Frontier-` at
`arena/01a09644-frontier`. Treat them as upstream: do not hand-tune the flare or the clouds here. If the
reference changes, re-vendor; if you change a kernel locally, the fidelity gate below fails, which is the point.

## The flare, specifically

`LensFlare` is the reference's four-part artefact, with the panel's four varieties selected by `FlareVariety`:

* **ghosts** — up to 8 discs marched along the sun→centre axis at `k = -1.35 + i·0.42`, chroma-tinted by `hue()`
* **halo** — a chromatic ring of radius `pp_halo` centred at `s·0.25`
* **streak** — the anamorphic bar, `exp(-|Δy|·95)·exp(-|Δx|·2.2)`
* **burst** — the starburst spikes, `|sin(4a+0.3)|²⁴` and `|sin(7a)|⁴⁰`

| Variety    | ghost | halo | streak | burst |
| ---------- | ----- | ---- | ------ | ----- |
| Cinematic  | 1.0   | 1.0  | 1.0    | 0.35  |
| Anamorphic | 0     | 0    | 2.2    | 0     |
| Starburst  | 1.0   | 0.5  | 0.35   | 1.0   |
| Halo       | 0     | 1.0  | 0.35   | 0     |

`AddLensFlare` gates on the sun being **in front of the camera, above the horizon and inside the frame** — so a
sun behind the observer correctly produces no flare. That gate is why the shipped frame deliberately swings the
sun's azimuth onto the window axis: from inside the room at the default bearing the disc sits behind the green
wall, and the honest result would be no flare at all.

## Build and run

```sh
cd Projects/Project-Zero
make -j$(nproc)
cd bin && ./Project-Zero          # or: make run
```

Frames land in `Diagnostics/` — one per flare variety plus a flare-off control.

## Verifying it

```sh
cd Projects/Project-Zero
python3 Diagnostics/CheckLensFlare.py
```

The gate turns "the flare looks right" into pass/fail:

1. **Fidelity** — `CheckLensFlare.py` contains its own independent transcription of the reference `lensFlare()`
   GLSL and evaluates it against kernel samples dumped by the renderer. Current agreement: **worst |Δ| = 1e-7**
   over 468 samples. Any drift from the reference fails.
2. **Presence** — each variety must differ from the flare-off control. Identical frames mean the flare is not
   being composited, which is precisely the bug this work fixed.
3. **Distinctness** — the four varieties must differ from one another, proving the variety weights arrive.
4. **Not flat** — a frame with a handful of unique colours is a broken render, not a sky.

Latest run:

```
[PASS] kernel fidelity vs reference GLSL — 468 samples, worst |Δ| = 1.000e-07
[PASS] Cinematic    483726 px differ from control | peak Δ 109 | 52291 colours
[PASS] Anamorphic   481864 px differ from control | peak Δ 151 | 39696 colours
[PASS] Starburst    485712 px differ from control | peak Δ 115 | 52413 colours
[PASS] Halo         481601 px differ from control | peak Δ  83 | 45841 colours
```

## Layout

```
Projects/Project-Zero/
  Source/            vendored reference celestial port + this project's entry point
  Diagnostics/       rendered frames, the kernel dump, and CheckLensFlare.py
  Makefile           builds only the celestial slice (no Vulkan/physics/audio)
```

`GameExecution.cpp`, the `Makefile`, `Diagnostics/CheckLensFlare.py` and `Tools/PpmToPng.py` are this
repository's own; everything else under `Source/` is upstream.
