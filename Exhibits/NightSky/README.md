# Night sky, Moon and sun-disc lens flare exhibit

Native CPU renderer (no GPU, headless). Reproduce: `PYTHON=<venv python with Pillow> bash Exhibits/NightSky/RunNightSky.sh`
(GCC, `-std=c++17 -Wall -Wextra -Werror`). Last run: 19/19 checks pass (`Results.txt`). Existing Sun, lens-flare ghost
table and star code are not modified; the new code calls CelestialModel, AtmosphereModel and LensFlareModel.

## Images

| Image | What it shows |
|---|---|
| `Images/SunDiskLensFlare.png` | 16:30 SAST sun: soft-limb disc with bloom, horizontal anamorphic streak, six-spike starburst, halo ring, six LensFlareModel ghosts |
| `Images/MoonClose.png` | Moon disc at 20:30 SAST (illuminated 0.995), procedural albedo, lit-side shading |
| `Images/NightSkyMoonField.png` | Night field centred on the Moon, Hipparcos stars |
| `Images/NightSkyCatalogueMilkyWay.png` | Night field aimed at the brightest Milky Way band point above 25 deg |
| `Images/MoonPhases.png` | New, first quarter, full, last quarter, each with the lit side from the Sun's ephemeris |
| `Images/DuskSequence.png` | Sun at +14, +2, -2, -6, -12, -18 deg at azimuth 270 (elevation sweep, not a time series) |

## Checks (19 PASS)

- Sun elevation vs `CelestialModel::SunPosition`: `1.7e-13` deg. Equatorial/local round trip `1.7e-16` rad.
- Hipparcos catalogue loaded: 41,359 stars.
- Transmittance LUT bakes; zenith is blue (B/R 3.93); sky toward the sun is brighter than away (2.99x); sky at -2 deg toward the sun is warm (R/B 382).
- Moon raster lit fraction vs geometry: `9.5e-5`. Mean-age comparison is INFO only: 0.066 at quarter, from the lunar equation of centre.
- Moon close-up disc area vs pi r^2: `0.99998`. Night fields draw 3,000+ catalogue stars.
- Sun flare elements (new): disc fades monotonically (core/mid/far), anamorphic streak present (0.47), halo ring present (0.32).
- Sun flare: zero visibility removes all ghosts; ghost centres collinear with sun and frame centre to `1.4e-17`.
- **Rendering-level ghost check:** each ghost rendered alone, residual centroid vs expected position: `0.0005 px` worst case (6 of 6 ghosts).

## Limits, stated plainly

- **Clouds: not done.** Nothing in this pass changes cloud appearance. The blocky-cloud issue remains open.
- **Moon surface is procedural.** Maria are fractal noise, not a measured lunar map. Surface is not astronomically accurate and has no craters.
- **Lunar position** is a Meeus low-precision series (main terms), not a JPL ephemeris. No topocentric parallax, no moonlight in the scene.
- **Star field** is the Hipparcos-derived catalogue (XHIP, Anderson & Francis 2012, VizieR V/137D), packaged in `d3-celestial` 0.7.35 (BSD-3-Clause), mag <= 8. CDS/VizieR terms should be checked before any commercial release. The Milky Way is an analytic band plus catalogue star density, not a measured galactic model.
- **Daytime flare:** the streak, starburst, halo and fade are my own parameterised design, not taken from any demo: the HTML flare demo you mentioned was not found in this repo or the upstream material branch. The ghosts are a LensFlareModel layout, not an optical-system simulation. The three element checks confirm the elements exist in the image, not that they match a reference.
- **Dusk:** the sun-elevation sweep uses the same atmosphere model; the ground strip at the bottom is a flat dark colour, not a terrain. Dusk colours are a single-scattering result, not verified against photographs.
- **Not verified:** physical GPU, Windows, real-time rendering, the GPU sky path in the renderer.
