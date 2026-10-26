# Night sky and sun-disc flare exhibit

Native CPU renderer (no GPU) for four sky views, built from the existing `CelestialModel` and `LensFlareModel` cores.
The Sun, lens-flare ghost table and existing star code were not modified.

Reproduce: `bash Exhibits/NightSky/RunNightSky.sh` (GCC, `-std=c++17 -Wall -Wextra -Werror`, Benoni, ZA, 2026-10-26).

| Image | Content |
|---|---|
| `Images/NightSkyMilkyWay.png` | Milky Way band, 30,000-star procedural field, airglow; aimed at the brightest band point above 25 deg |
| `Images/NightSkyMoon.png` | Same sky centred on the Moon: disc with phase terminator |
| `Images/SunDiskLensFlare.png` | 16:30 local sun disc, glow, and the six `LensFlareModel` ghosts |
| `Images/MoonPhases.png` | Four phases of the cycle containing the date, each with the lit side from the Sun's ephemeris |

## Checks (`Results.txt`)

- Sun elevation matches `CelestialModel::SunPosition` to `1.7e-13` deg (identical series).
- Equatorial/local round trip `1.7e-16` rad.
- Moon raster lit fraction matches the geometric lit fraction to `2.9e-4` (rendering check).
- Zero visibility removes every ghost; unoccluded ghosts change pixels by `1.05`.
- Night-view disc area check runs only when the Moon is in frame; here it is not (INFO).

## Limits (stated, not claimed as fixed)

- **Star field is procedural**, from `GenerateStarCatalogue`. It is not a licensed astronomical catalogue, so star
  positions are not real and the Milky Way has no real star density. The Milky Way is an analytic band.
- **Lunar position** uses a Meeus low-precision series (main terms). Its phase differs from `CelestialModel`'s
  mean-age formula by up to 0.066 at quarter (INFO; that formula ignores the lunar equation of centre).
- **Orientation** of the bright limb in `MoonPhases.png` uses a moon-centred frame, not the zenith, and has no external
  reference image, so orientation is not validated against an astronomical chart.
- **Sky colour** is a simple gradient, not the atmosphere model. The sun-disc view still reads pale; the whitish horizon
  is not solved.
- **Not in this exhibit**: clouds (the blocky cloud appearance is not verified as fixed), physical GPU, Windows,
  real-time rendering, moonlight in the scene, and the Moon's topocentric parallax.
