# Experimental planetary clouds

Actual three-dimensional condensate and ray integration, adapted selectively from the supplied cloud patch.
This directory is **experimental**, not linked into the editor or a production replacement for `CloudField`.

## Contents

| Source                         | Mechanism                                                         |
|--------------------------------|-------------------------------------------------------------------|
| `CloudNoiseVolume.h`           | Deterministic Perlin–Worley shape, erosion, rank tile and 3D mips |
| `CloudNoise.slang`             | Continuous packed-volume interpolation and footprint selection    |
| `CloudDensity.slang`           | Radial condensation, twelve formation selections and tangent flow |
| `CloudTransport.slang`         | Curved intervals, Beer extinction, solar depth and scattering     |
| `CloudAerialPerspective.slang` | Atmospheric scattering and cloud optical-centroid approximation   |
| `CloudCompute.slang`           | Shared native/Vulkan radiance entry and numerical queries         |
| `CloudNative.cpp`              | Bounded threaded execution of Slang-generated C++                 |

No satellite/cloud photograph, AI-generated image, image blur, upscaler or previous colour image supplies density.
The same density function serves view and light rays. The orbital view does not substitute a painted coverage mask.
Only noise octaves below the current footprint lose contrast; this is not an exact integral of subpixel density.

## Formations

Cumulus, stratocumulus, stratus, altocumulus, altostratus, nimbostratus, cirrus, cirrostratus,
cirrocumulus, towering cumulus, cumulonimbus and a tropical cyclone.
These are procedural morphological selections, **not** meteorologically predicted weather.
The cyclone includes a vertically widening eye, eyewall, spiral rainbands and high ice outflow in the volume.
Cirrocumulus/cyclone shape coordinates use unbounded displacement to break the small periodic texture repeat.
Cumulonimbus/cyclone fine erosion preserves the sign of its carrier, avoiding detached boundary flecks.
Cyclone top relief is weighted toward larger billows; outer ice coverage follows coherent spiral bands.
[Matched before/after renders](../../Exhibits/PlanetaryClouds/Images/Morphology.jpg) retain the visual comparison.

## Wind and light

- Wind follows altitude-preserving spherical rotation characteristics, with vertical shear and veer.
- Bounded angular polynomials and radial reprojection repair a measured software-Vulkan radial wind error.
- Cyclonic differential rotation deforms rainbands; upper circulation reverses sign.
  Explicit divergent storm inflow/outflow is not solved.
- Cloud erosion follows the same advected coordinates. There is no accumulated cloud-colour history.
- Direct light uses normalized dual-lobe HG, Beer attenuation and cloud self-shadowing.
  Solar quadrature evaluates weather at every sample, not interpolated endpoint weather.
- Higher-order light uses three fitted attenuated angular orders and approximate sky/bounce terms.
  It is not a solved three-dimensional multiple-scattering field or a calibrated full energy-conservation result.
- The atmosphere uses an approximate solar column and an optical centroid for cloud/air ordering.

## Local build

Requires a C++20 compiler, CMake, Slang, Python, NumPy and Pillow. Nothing invokes GitHub Actions.

```sh
cmake -S Experimental/PlanetaryClouds -B _ClaudeScratch/build/CloudCmake \
  -DCMAKE_BUILD_TYPE=Release -DFRONTIER_CLOUD_SLANG=/path/to/slangc
cmake --build _ClaudeScratch/build/CloudCmake --parallel 2
ctest --test-dir _ClaudeScratch/build/CloudCmake --output-on-failure
python Exhibits/PlanetaryClouds/Code/RenderClouds.py cumulus cyclone \
  --library /path/to/CloudNative.so --noise /path/to/CloudNoise.volume \
  --width 960 --height 540 --steps 384 --light-steps 32 --samples 2
```

On Windows, use the CMake-built `CloudNative.dll` instead. Windows/MSVC and physical-GPU execution must be verified
separately; Linux and SwiftShader observations are not substitutes. Generated libraries, noise and Float32 outputs
remain in ignored scratch/build directories, not Git.

## Evidence and acceptance

[Retained captures, measurements and limitations](../../Exhibits/PlanetaryClouds/README.md).
Compilation or a passing numerical test does **not** establish the requested photographic appearance.
