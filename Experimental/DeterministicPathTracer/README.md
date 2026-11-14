# Deterministic Path Tracer (WebGPU prototype)

Physically based path tracer for product, film and game look-development that uses **no random numbers**.
Scene: the VehicleHMI **Controlled Integrator** (25,068 triangles) in a three-softbox studio with seven
material spheres. Runs on WebGPU compute only, so it needs no RT cores: GTX 900-series and newer, and RTX.

## Run

```bash
python3 Serve.py            # then open http://localhost:8087/ in Chrome or Edge 113+
```

WebGPU needs a secure context: `localhost` qualifies, a plain-http LAN address does not.

| URL parameter          | Effect                                                        |
|------------------------|---------------------------------------------------------------|
| `camera=Hero`          | `Hero`, `Profile`, `Front`, `Spheres`, `Rear`, `Fleet`        |
| `paint=Racing`         | `Authored`, `Racing`, `Midnight`, `Pearl`, `Graphite`         |
| `scale=0.5`            | Render scale relative to the viewport (default 0.75)          |
| `target=4096`          | Samples per pixel before the loop idles (default 1024)        |
| `width=…&height=…`     | Fixed accumulation size (validation)                          |
| `validation=1`         | No render loop; exposes `window.DeterministicTracing`         |
| `present=readback`     | 2D-canvas display via GPU readback, if a WebGPU canvas fails  |
| `pattern=pixel`        | Per-pixel decorrelated point sets (fine dither, no banding)   |
| `pattern=bluenoise`    | Per-pixel digital shift from a blue-noise mask (even dither)  |
| `visibility=raster`    | Camera hits from a triangle-ID raster instead of the tree     |
| `reproject=1`          | Keep the image through camera moves (reprojected history)     |
| `vehicles=50`          | 1, 2, 4, 8, 16, 32 or 50 ControlVehicles in a parking grid    |
| `denoise=1`            | Edge-aware à-trous denoiser on the display (sums untouched)   |
| `span=8`               | Exact samples until reprojected history is gone (default 8)   |
| `clamp=1.5`            | Clamp history to mean ± γσ of current 3×3 (default 0 = off)   |
| `sigma=4`              | Denoiser luminance tolerance at 1 spp (÷ n after that)        |

The top-right counter shows traced frames per second, smoothed ms per frame and samples per frame
("Samples per dispatch" selector). It reads "idle" once the target is reached. The loop is paced by
`requestAnimationFrame`, so FPS cannot exceed the display refresh rate.

## Real-time options (inspector → Real-time)

All are deterministic: no RNG, same camera path → same pixels. Defaults keep the original output bit-identical.

| Option              | What it does                                                                                   |
|---------------------|------------------------------------------------------------------------------------------------|
| Pattern             | Shared: one point set for all pixels. Per-pixel: each pair's digit permutation is XOR-keyed by a fixed hash of the pixel coordinate. Blue-noise: each pair's digits are XOR-shifted by two 64² void-and-cluster masks read at a fixed per-pair tile offset. Subpixel pair stays shared; every pixel still gets a full (0,m,2)-net. |
| Visibility          | Rasterized: a depth-tested `r32uint` pass, shifted to the sample's subpixel point, names the camera triangle; the ray is re-intersected exactly, misses fall back to the full trace. Pinhole only. |
| Camera motion       | Reproject history: one compute pass traces the new and previous centre rays, keeps the previous displayed colour where the surface matches (category, position, material, normal). Mirror-like surfaces (sharpest lobe ≤ 0.05) follow the reflected object's virtual image (hit distance + mirror-ray length) and must reflect the same object. |
| History             | Sample-equivalents of history kept (8–64): half on mirrors, 0 on glossy 0.05–0.4 lobes, full at ≥ 0.4. Weight × (1 − n/span)², span 8: gone after 8 exact samples, so it never drags and the converged image is history-free. |
| Denoiser            | `DisplayReconstruction.wgsl`: 5 à-trous steps (1–16 px) stopped at normal, plane-distance, material and variance-scaled luminance edges (σ/n). Mirrors use only the 2 finest steps. Strength 1 to 4 spp, fades to 0 at 64 spp. Pairs best with the blue-noise pattern (decorrelated error filters out; shared-pattern error is the same in neighbouring pixels). |
| Vehicles in scene   | Bakes 1–50 copies into the bounds tree (5 rows × 10 bays, 9.7 m × 3.6 m pitch, ≥ 1.1 m clearance, cycling paints). Rebuilds the tree on change. |

Measured results and the comparison image: [`Exhibits/DeterministicPathTracer/`](../../Exhibits/DeterministicPathTracer/README.md#real-time-options).

## What "deterministic" means here

| Classic Monte Carlo path tracer             | This tracer                                                              |
|---------------------------------------------|--------------------------------------------------------------------------|
| Per-pixel random numbers → grain            | One fixed Sobol' (0,2) point set shared by every pixel → no grain        |
| Coin flip: reflect **or** refract           | Fresnel splitting: reflect **and** refract, each with its exact weight   |
| Coin flip: pick coat / specular / diffuse   | Lobe splitting: every lobe is traced every sample                        |
| Russian roulette kills paths at random      | Fixed bounce / chain limits and a fixed throughput cutoff                |
| Random light point                          | Light quadrature point per sample, MIS with the BSDF rule (power β = 2)  |
| Error ∝ N^-1/2, looks like noise            | Error ≈ N^-0.7…-1 measured, structured, shrinks every power of two       |
| Different image every run                   | Bit-identical accumulation for the same sample count (verified)          |

- Pairs are decorrelated by a **fixed** nested-uniform (Laine–Karras) digit permutation keyed only by the pair
  index, never by the pixel (default Shared pattern). Every 2^m prefix of every pair is a (0,m,2)-net.
- Samples are added to the float accumulation strictly in index order, so the result does not depend on
  dispatch batching, frame timing or GPU speed. The inspector's **Verify bit-exact repeat** checks this live.

## Materials

| Category          | Model                                                                         | Shown on                     |
|-------------------|-------------------------------------------------------------------------------|------------------------------|
| Layered           | Lambert under GGX dielectric specular, optional GGX clear coat                | Body paint, ceramic, chalk   |
| Conductor         | GGX (height-correlated Smith, VNDF quadrature), exact complex-IOR Fresnel     | Gold, copper, chrome, rims   |
| Solid dielectric  | Exact Fresnel split, Snell refraction, Beer–Lambert absorption                | Clear and emerald glass      |
| Thin dielectric   | Two-interface sheet Fresnel, straight tinted transmission (shadow rays too)   | Vehicle glazing              |
| Emissive          | Exitance on any layered surface                                               | Head- and tail-lamps         |

Measured metal indices: Au, Cu, Al, Cr, Ag (RGB at ~650/550/450 nm). Vehicle albedos follow
`SlateReference/.../VehicleProvingGrounds/Source/MaterialSpecification.js`; body family 9 (cabin canopy) gets
a clear-coated slot, rim family 9 a satin aluminium slot.

## Files

| Path                                  | Responsibility                                                     |
|---------------------------------------|--------------------------------------------------------------------|
| `Source/QuadratureSequence.wgsl`      | Sobol' (0,2) pairs, nested digit permutation, pixel keying         |
| `Source/RadianceIntegration.wgsl`     | Bounds-tree casting, materials, transport, history reprojection    |
| `Source/VisibilityRasterization.wgsl` | Triangle-ID raster for camera hits                                 |
| `Source/DisplayReconstruction.wgsl`   | History blend + edge-aware à-trous denoiser (display only)         |
| `Source/DisplayExposure.wgsl`         | Exposure, ACES fitted tone curve, sRGB                             |
| `Source/TracingDivision.js`           | WebGPU device, buffers, dispatch, readback, FNV-1a digest          |
| `Source/BoundingVolumeConstruction.js`| Binned SAH tree (16 bins), 32-byte GPU entries                     |
| `Source/VehicleAssembly.js`           | FCT1 decode, creased body normals, 4 mirrored wheel instances      |
| `Source/StudioSceneAssembly.js`       | Material table, spheres, aimed softboxes, presets                  |
| `Source/WorkspaceInterface.js`        | Inspector, orbit input, accumulation loop, verification, PNG       |
| `Assets/BlueNoiseRanks.bin`           | Two 64² void-and-cluster rank masks (16 KiB), committed            |
| `Tools/BlueNoiseConstruction.mjs`     | Rebuilds the masks: fixed integer seed, lowest-index tie-break     |
| `Assets/ControlVehicle*.facet`        | Blob-identical copies of the SlateReference archives               |

Validation, measurements and captures: [`Exhibits/DeterministicPathTracer/`](../../Exhibits/DeterministicPathTracer/README.md).

## Limits

- Deterministic ≠ instant: every pixel uses the **same** quadrature point for a given sample index, so N samples
  look like N hard shadows and N copies of each softbox in glossy reflections (stepped penumbrae, banded
  reflections, blotchy caustics) instead of grain. Large softboxes need several hundred spp to merge. Caustics are reached only by
  BSDF rays and converge slowest.
- Softboxes are hidden from camera rays only. The bright rectangle on the floor at the lower right of Hero
  is the rim softbox's mirror image in the coated epoxy (isolation: gone on matte Concrete, still there
  with the spheres removed). It is physically correct; set Rim to 0 or use Concrete to remove it.
- Fixed limits are a deterministic bias: default 2 indirect bounces, 10-interaction specular chains, cutoff 0.002.
- Rough glass, textures, subsurface scattering, volumes and a sun/HDRI light are not implemented.
- Bit-exactness is per device and driver. WGSL leaves transcendental precision implementation-defined, so a
  GTX and an RTX need not produce identical bits; each repeats itself exactly.
- Tested only on SwiftShader (CPU WebGPU) in headless Chromium. No physical GTX/RTX run or timing is claimed.
- Default display is a WebGPU canvas swap chain. It is **untested**: headless SwiftShader cannot allocate one
  (device lost on first present), so the interface capture uses `present=readback`.
- Rasterized visibility is not bit-identical to traced visibility: subpixel vertex snapping and coplanar ties
  resolve ≈ 0.2 % of pixels differently (relative RMS 1e-4). It also depends on the GPU's rasterizer.
- Reprojection carries colour by surface position, so moving reflections lag on glossy-but-not-mirror surfaces.
- Lamp lenses are not light-sampled; their exitance defaults to 20 % of the authored 48.7.

## Integration path (later)

Slang port of `RadianceIntegration.wgsl` into the Vulkan renderer: the quadrature functions, the explicit
transport stack and the material categories carry over unchanged; the bounds tree can be replaced by
`VK_KHR_ray_query` on RTX while keeping the same compute path on GTX.
