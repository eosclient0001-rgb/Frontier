# Sky, Sun, lunar texture and mixed lens flare

Portable production models rendered by the native CPU exhibit; **not a Vulkan/Windows acceptance capture**.
This continuation corrects the earlier source audit: the full VehicleHMI reference contains lunar textures,
soft Sun edges and several independently mixed flare components. The local SlateReference copies do not.

## Reproduce

```sh
python3 -m venv _ClaudeScratch/venv
_ClaudeScratch/venv/bin/pip install Pillow
PYTHON="$PWD/_ClaudeScratch/venv/bin/python" bash Exhibits/NightSky/RunNightSky.sh
```

GCC 12.2, C++17, `-O2 -Wall -Wextra -Werror`, Linux CPU. Source basis: `ae0bb7d` plus this continuation's changes.
The runner converts the retained demo JPEG into the ignored runtime PPM. The previous checkout omitted its lunar
source; the initial reproduction failed 3 checks. That failure is retained in `Results/InheritedSkyFailure.txt`.

## Source audit and changes — 2026-10-27

| Area | Inspected source / production behaviour |
|---|---|
| Full reference | `Experimental/VehicleHmiReference`, pinned `6afb6f00b5f25c45f7cda92c7da65b64845768f3` |
| Atmosphere | Demo coefficients retained; single scattering now uses its normalized Cornette–Shanks aerosol phase |
| Sun | Existing quadratic limb darkening, apparent radius 0.2666°, erfc edge retained; not replaced by a hard circle |
| Warm streak | Ported full-demo exponential profile with correct full-height → half-height coordinate conversion |
| Mixed optics | Independent warm streak gain/rotation/spread, added alongside blue anamorphic, burst, ghosts and halo |
| Moon | Actual demo `luna_2k.jpg`, 2048 × 1024; byte-identical source retained with provenance |
| Moon colour | Fixed sRGB bytes being treated as linear radiance; decode before interpolation, matching the demo texture |

Warm streak defaults to zero for existing callers. The mixed-flare capture explicitly enables it at 0.35.
Its irradiance scaling is linear, unlike the demo's artistic brightness clamp. The other flare terms retain the
existing parameterized implementation; this is not a wholesale pixel-identical port of every demo optical formula.

## Evidence

| Capture | Interpretation |
|---|---|
| `Images/SunDiskLensFlare.png` | Scattering sky with simultaneous warm angled streak and blue anamorphic streak |
| `Images/SunDiscClose.png` | Telephoto Sun at sky exposure |
| `Images/SunDiscFiltered.png` | Same radiance at solar-filter exposure, revealing limb darkening |
| `Images/MoonClose.png` | Restored demo texture, Benoni moonrise orientation, atmospheric tint |
| `Images/MoonPhases.png` | New / first quarter / full / last quarter geometry and earthshine |
| `Images/DuskSequence.png` | One exposure, Sun elevation sweep +14° through −18°, not a time series |
| `Images/NightSkyMoonField.png` | Moon at its angular size and Hipparcos stars |
| `Images/NightSkyCatalogueMilkyWay.png` | Catalogue field, unchanged |

`Results.txt` is the current executed result. Checks include:

- Phase solid-angle integral = 1; zero-asymmetry Cornette–Shanks = Rayleigh.
- sRGB 128 → linear 0.2158605; black/white interpolation → linear 0.5.
- Warm streak vs the independent demo formula; additive mixing, rotation and partial/zero visibility.
- Existing Mie extinction, solar geometry, near-ideal disc flux, limb ratio and six diffraction spikes.
- Existing lunar phase area, Lommel–Seeliger full-disc flatness, libration and named-feature orientation.
- Environment regression: 73 checks; retained in `../VehiclePhysics/Results/EnvironmentRegression.txt`.

## What these checks do not prove

- No comparison to calibrated sky photographs, measured lens PSFs, measured tyre data or absolute lunar photometry.
- The erfc Sun edge is a **locally planar approximation**, not a flux-preserving 2D Gaussian convolution.
  The existing flux test uses a nearly unblurred edge; it does not validate unresolved/subpixel discs.
- Flare is a parameterized camera effect, not optical ray tracing through a measured lens prescription.
- Multiple scattering remains the bounded factored approximation, not the full demo's multiple-scattering LUT.
- Moon remains low-precision Meeus geometry with approximate phase darkening and earthshine; no topocentric
  parallax, eclipse, relief, Hapke fit or Moon illumination of scene geometry. Source-map licensing requires review.
- No changes to clouds. No claim of GPU, physical hardware, Windows/editor or real-time acceptance.
