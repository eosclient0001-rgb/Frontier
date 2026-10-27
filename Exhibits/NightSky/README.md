# Sky, Sun, lunar texture and mixed lens flare

Portable production models rendered by the native CPU exhibit; **not a Vulkan/Windows acceptance capture**.
This continuation corrects the earlier source audit: the full VehicleHMI reference contains lunar textures,
soft Sun edges and several independently mixed flare components. The local SlateReference copies do not.

## Reproduce

```sh
python3 -m venv _ClaudeScratch/venv
_ClaudeScratch/venv/bin/pip install Pillow
PYTHON="$PWD/_ClaudeScratch/venv/bin/python" bash Exhibits/NightSky/RunNightSky.sh
# Requires CMake and g++; CAPTURE=1 also requires Pillow.
CMAKE=cmake PYTHON="$PWD/_ClaudeScratch/venv/bin/python" CAPTURE=1 bash Exhibits/NightSky/RunSolarValidation.sh
CMAKE=cmake SANITIZE=1 bash Exhibits/NightSky/RunSolarValidation.sh
```

If CMake is installed in the virtual environment, set `CMAKE="$PWD/_ClaudeScratch/venv/bin/cmake"` instead.

GCC 12.2, C++17, `-O2 -Wall -Wextra -Werror`, Linux CPU. Source basis: `ae0bb7d` plus this continuation's changes.
The runner converts the retained demo JPEG into the ignored runtime PPM. The previous checkout omitted its lunar
source; the initial reproduction failed 3 checks. That failure is retained in `Results/InheritedSkyFailure.txt`.

## Source audit and changes — 2026-10-27

| Area | Inspected source / production behaviour |
|---|---|
| Full reference | `Experimental/VehicleHmiReference`, pinned `6afb6f00b5f25c45f7cda92c7da65b64845768f3` |
| Atmosphere | Demo coefficients retained; single scattering now uses its normalized Cornette–Shanks aerosol phase |
| Sun | CPU reference renderer uses finite-pixel filtering of a limb-darkened disc; apparent radius 0.2666° |
| Warm streak | Ported full-demo exponential profile with correct full-height → half-height coordinate conversion |
| Mixed optics | Independent warm streak gain/rotation/spread, added alongside blue anamorphic, burst, ghosts and halo |
| Moon | Actual demo `luna_2k.jpg`, 2048 × 1024; byte-identical source retained with provenance |
| Moon colour | Fixed sRGB bytes being treated as linear radiance; decode before interpolation, matching the demo texture |

The generic flare model retains a zero warm-streak default for existing callers. In `ReferenceRenderSettings`, flares
are opt-in; when enabled, warm streak (gain 0.35, angle −0.18 rad) and blue anamorphic streak are both active. Flare
is added after geometry, clouds and fog, before display encoding. Source irradiance is attenuated at the Sun direction;
a 13-point screen-space visibility estimate checks geometry, with one extra cloud ray when clouds are enabled.
Its irradiance scaling is linear, unlike the demo's artistic brightness clamp. The other flare terms retain the
existing parameterized implementation; this is not a wholesale pixel-identical port of every demo optical formula.

## Evidence

| Capture | Interpretation |
|---|---|
| `Images/SunDiskLensFlare.png` | NightSky exhibit: scattering sky with simultaneous warm and blue streaks |
| `Images/SolarReferenceMixed.png` | Actual CPU reference-renderer capture with both streaks and other flare terms |
| `Images/SunDiscClose.png` | Telephoto Sun at sky exposure |
| `Images/SunDiscFiltered.png` | Same radiance at solar-filter exposure, revealing limb darkening |
| `Images/MoonClose.png` | Restored demo texture, Benoni moonrise orientation, atmospheric tint |
| `Images/MoonPhases.png` | New / first quarter / full / last quarter geometry and earthshine |
| `Images/DuskSequence.png` | One exposure, Sun elevation sweep +14° through −18°, not a time series |
| `Images/NightSkyMoonField.png` | Moon at its angular size and Hipparcos stars |
| `Images/NightSkyCatalogueMilkyWay.png` | Catalogue field, unchanged |

`Results.txt` records the NightSky exhibit. `Results/Solar-{release,sanitized}.txt` records the additional
finite-pixel and actual-reference-renderer tests, run on Linux x86-64 with GCC 12.2 at base `0eb6d76` plus this
change. The solar filter and the two changed reference source files also compile with `-Wall -Wextra -Werror`.
The release reference build passes five CTests, including the existing lighting and complete-renderer regressions.

| Solar check | Observed result | Scope |
|---|---:|---|
| Disc flux, radius ≤ 3 pixels | max relative error `1.36e-10` | Three subpixel offsets, Gaussian footprint |
| Disc flux, transition/resolved up to 32 pixels | max relative error `7.04e-5` | Four-by-four resolved pixel integral |
| Independent Cartesian integral | max error `0.00311 × peak` | 600×600 source quadrature, three small-disc radii |
| Blended path continuity | `4.84e-7 × peak` | Radius change of `1e-9 rad` near four pixels |
| Full reference-renderer solar flux | max relative error `4.39e-4` | Seven cameras, square/wide and subpixel/telephoto |
| Simultaneous flares | both signals nonzero; additive residual `1.05e-16` | Warm and anamorphic terms in the actual reference renderer |
| Fully hidden source | max image difference `0` | Opaque foreground and fully planet-occluded Sun |

Existing checks include:

- Phase solid-angle integral = 1; zero-asymmetry Cornette–Shanks = Rayleigh.
- sRGB 128 → linear 0.2158605; black/white interpolation → linear 0.5.
- Warm streak vs the independent demo formula; additive mixing, rotation and partial/zero visibility.
- Existing Mie extinction, solar geometry, near-ideal disc flux, limb ratio and six diffraction spikes.
- Existing lunar phase area, Lommel–Seeliger full-disc flatness, libration and named-feature orientation.
- Environment regression: 73 checks; retained in `../VehiclePhysics/Results/EnvironmentRegression.txt`.

## What these checks do not prove

- No comparison to calibrated sky photographs, measured lens PSFs, measured tyre data or absolute lunar photometry.
- The small-disc path integrates a Gaussian pixel footprint analytically and uses 32×48 polar source samples;
  it is compared with a finer Cartesian integral of the **same model**, not a measured lens. Between radii of three
  and six pixels it blends into a radially normalized erfc approximation, not an exact resolved-disc convolution.
  Pixel shear is ignored and a footprint-dependent minimum blur is imposed. Planet occultation suppresses a fully
  hidden Sun, but partial clipping and atmospheric refraction at the geometric limb are not modelled.
- Flare is a parameterized camera effect, not optical ray tracing through a measured lens prescription. Screen-space
  visibility is coarse and can miss subpixel occluders; clouds use a single sampled Sun ray, not a full optical solve.
- Multiple scattering remains the bounded factored approximation, not the full demo's multiple-scattering LUT.
- Moon remains low-precision Meeus geometry with approximate phase darkening and earthshine; no topocentric
  parallax, eclipse, relief, Hapke fit or Moon illumination of scene geometry. It is used by the separate NightSky
  exhibit, not the reference-renderer sky path. Source-map licensing requires review.
- No changes to clouds. No claim of GPU, physical hardware, Windows/editor or real-time acceptance.
