# Lunar image provenance

The previous branch referred to this directory but did not retain it: `EngineContent/*` ignored it.
The source image is now retained; `Automation/PrepareMoonAlbedo.py` regenerates the ignored P6 runtime image.
`Exhibits/NightSky/RunNightSky.sh` runs that conversion before validation.

| Property              | Source                                                                                      |
|-----------------------|---------------------------------------------------------------------------------------------|
| Distribution          | `mrdoob/three.js`, tag `r170`, `examples/textures/planets/moon_1024.jpg`                         |
| Git blob              | `6963a34dab0af17acfe90e3299263e52d27c6df4`                                                  |
| Source SHA-256         | `fcb0f1f5548e6e18d40063dd55c6aacd3daedf2407b181dab85b61e22bf9fe57`                          |
| Dimensions            | 1024 × 512, equirectangular                                                                  |
| Converted P6 SHA-256   | `34aa6424913f4fa5c7f54dc43943acf46ac2d873e308858f9ff7b65fb42cce79`                          |
| Distribution licence  | Three.js MIT licence retained as `ThreeJsLicense.txt`                                        |

Repository API retrieval (does not require raw.githubusercontent.com):

```bash
gh api repos/mrdoob/three.js/git/blobs/6963a34dab0af17acfe90e3299263e52d27c6df4 --jq .content \
  | base64 -d > EngineContent/CelestialMaps/MoonAlbedoSource1024.jpg
python3 Automation/PrepareMoonAlbedo.py
```

Coordinates: U = (selenographic east longitude + 180°) / 360°, V = (90° − latitude) / 180°.
Tycho, Plato and Mare Crisium orientation samples pass the existing native checks; all eight NightSky PNGs
reproduce the linked branch's retained bytes with this image on the tested configuration.

The earlier notes call this JPL/USGS-derived. That original scientific attribution is **not independently
established by the three.js file**, nor is the image an absolutely calibrated reflectance measurement.
Treat it as a photographic lunar surface map. The distribution licence alone does not establish the original
image's rights; verify original provenance before commercial distribution. No texture was found in either local
SlateReference demonstration tree or the retained VehicleHMI HTML. This is not a demonstrated texture port.
