# Lunar albedo map — provenance

| Field | Value |
|---|---|
| Runtime file | `MoonAlbedo1024.ppm` (binary P6, 1024×512), generated from the source below |
| Source file | `MoonAlbedoSource1024.jpg` (1024×512 equirectangular) |
| Source origin | `examples/textures/planets/moon_1024.jpg` in the three.js repository (fetched 2026-10-27 via the GitHub API from `mrdoob/three.js`, branch `dev`) |
| Underlying data | Lunar albedo mosaic derived from NASA JPL / USGS lunar imagery, as distributed with the three.js examples |
| Orientation | U = (selenographic east longitude + 180°) / 360°, V = (90° − latitude) / 180°. Pinned at runtime by named-feature samples: Tycho (bright) vs Plato (dark floor) and Mare Crisium, checked in `Exhibits/NightSky` |
| Regenerate | `python Automation/PrepareMoonAlbedo.py` (requires Pillow) |
| Calibration | The photograph is exposure-scaled (disc mean 0.534), not an absolute albedo. `EvaluateLunarDiscRadiance` applies a 0.225 calibration so the full disc sits at the measured visual geometric albedo 0.12 (NASA Moon Fact Sheet) |
| Licence note | three.js is MIT-licensed; the underlying JPL/USGS imagery is US-government work. Re-verify before commercial release, as with all retained third-party data |

⚠️ The HTML demonstration tree in this repository contains no lunar texture and no lunar
disc rendering (its Moon is a fixed-direction light only). This map is therefore not a port
from the demonstration; it is the measured replacement the previous procedural maria needed,
sourced and pinned as above.
