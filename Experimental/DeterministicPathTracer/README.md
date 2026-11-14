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
| `camera=Hero`          | `Hero`, `Profile`, `Front`, `Spheres`, `Rear`                 |
| `paint=Racing`         | `Authored`, `Racing`, `Midnight`, `Pearl`, `Graphite`         |
| `scale=0.5`            | Render scale relative to the viewport (default 0.75)          |
| `target=4096`          | Samples per pixel before the loop idles (default 1024)        |
| `width=…&height=…`     | Fixed accumulation size (validation)                          |
| `validation=1`         | No render loop; exposes `window.DeterministicTracing`         |
| `present=readback`     | 2D-canvas display via GPU readback, if a WebGPU canvas fails  |

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
  index, never by the pixel. Every 2^m prefix of every pair is a (0,m,2)-net.
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
| `Source/RadianceIntegration.wgsl`     | Quadrature sequence, bounds-tree casting, materials, transport     |
| `Source/DisplayExposure.wgsl`         | Exposure, ACES fitted tone curve, sRGB                             |
| `Source/TracingDivision.js`           | WebGPU device, buffers, dispatch, readback, FNV-1a digest          |
| `Source/BoundingVolumeConstruction.js`| Binned SAH tree (16 bins), 32-byte GPU entries                     |
| `Source/VehicleAssembly.js`           | FCT1 decode, creased body normals, 4 mirrored wheel instances      |
| `Source/StudioSceneAssembly.js`       | Material table, spheres, aimed softboxes, presets                  |
| `Source/WorkspaceInterface.js`        | Inspector, orbit input, accumulation loop, verification, PNG       |
| `Assets/ControlVehicle*.facet`        | Blob-identical copies of the SlateReference archives               |

Validation, measurements and captures: [`Exhibits/DeterministicPathTracer/`](../../Exhibits/DeterministicPathTracer/README.md).

## Limits

- Deterministic ≠ instant: early samples show coherent structure (stepped penumbrae, banded glossy
  reflections, blotchy caustics) instead of grain; it fades by 64–256 spp. Caustics are reached only by
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
- Lamp lenses are not light-sampled; their exitance defaults to 20 % of the authored 48.7.

## Integration path (later)

Slang port of `RadianceIntegration.wgsl` into the Vulkan renderer: the quadrature functions, the explicit
transport stack and the material categories carry over unchanged; the bounds tree can be replaced by
`VK_KHR_ray_query` on RTX while keeping the same compute path on GTX.
