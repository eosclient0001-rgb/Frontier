# 🧩 World GI, Direct Shadows & Deterministic Path Tracer Plan (100% Real Polygon Surfaces)

> **TL;DR**: Syncs `SultanAladin/Frontier@arena/8391e994-frontier` (`daed305`) with `Engine/` cleaned of legacy GI/SDF remnants (`Engine/GeometricRaster/WorldRendering/`, `Engine/Shaders/WorldRendering/`, `RayAcousticFieldReading`), and specifies Frontier's **zero-SDF, zero-analytical-proxy, 100% real-triangle** lighting architecture: **6 Direct Shadow Modes**, the **2 Best Denoiser-Free GTX GI Renderers** (`StokesContourGiSequence` + `SurfelCascadeGiSequence`), and **1 Unified Deterministic Wavefront Path Tracer** (`WavefrontPathTraceSequence` across GTX CWBVH8/BVH4 & RTX `VK_KHR_ray_query`).

---

## 🔍 1. Empirical Baseline Audit (`2d6f15e`, `536cfe1` & `Frontier-1 @ d5bbb81`)

*Legend — Error / Cost / Memory: ✔️ = lowest (best) · Accuracy / Real-Polygon Fidelity / Determinism: 🔴 = highest (best).*

### 1.1 Should Frontier Still Use 3D Voxel SDF or Analytical Capsule Proxies?

| Candidate Geometry / Distance Representation | Shadow RMSE (`536cfe1`) | GI RMSE (`2d6f15e`) | Skinned Character Fidelity | Dynamic Update Cost | VRAM Overhead | Quality | Rank |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| **100% Real Polygon Triangles (`WideBoundingTree` + `SurfelOccluderField` + `Depth32f` Cascades)** | **✔️ `0.2973`** *(Surfel Disks + Contact BVH)* | **✔️ `0.2238`–`0.2239`** *(Stokes / Surfel)* | 🔴 Exact silhouette, fingers, cloth & equipment | **✔️ `< 0.4 ms`** *(BVH refit + triangle surfel refresh)* | ✔️ Compact SSBOs | ⭐⭐⭐⭐⭐ | 🥇 🏆 |
| Analytical Capsule / Box Proxies (`DeformingBoneCapsule` / `ClosedBox`) | 🚩 `0.2973`–`0.2983` | 🚩 Approximate | ✔️ Lacks real armor, hair, cloth & weapon silhouettes | ✔️ `0.08 ms` | ✔️ Minimal | ⭐⭐ | 🔴 Rejected |
| Runtime 3D Voxel SDF (`VoxelSdfClipmap` / `LocalGeometrySdfAsset`) | 🔴 `0.3068`–`0.4170` *(AABB seam & thin-shell leaks)* | 🚩 `0.2259`–`0.2402` | ✔️ Punches holes in `< 6 cm` features; `~600 ms` local rebake | 🔴 Heavy rebake | 🔴 3D Float16/32 grids | ⭐ | 🔴 Rejected |

💡 **Verdict — Zero Runtime 3D Voxel SDF & Zero Analytical Proxies:**
- **Do NOT reintroduce `DistanceFieldSpace` or 3D Voxel SDF Clipmaps** in runtime shadows, GI, or reflections, and **do NOT use analytical bone capsules or box proxies**.
- Every shadow, GI, reflection, and path-tracing unit operates **100% on real authored triangle surfaces** (`PolygonNetwork`, `RigidClusterInstance`, and live skinned/deforming character triangle streams).
- Only `Engine/GeometricRaster/Baking/GpuSdfBaker.{h,cpp}` remains in the repository, strictly isolated to offline `BakingWorkspace` `.fvol` asset export.

---

### 1.2 GTX Denoiser-Free GI Candidate Selection (`2d6f15e` & `536cfe1` Benchmarks vs 128-SPP Reference)

*Legend — RMSE / Cost: ✔️ = lowest (best) · Real-Polygon Support / Temporal Stability: 🔴 = highest (best).*

| GI Architecture | Normal GI RMSE | Lattice GI RMSE | Lit HDR RMSE | GTX Execution Cost | Real-Triangle & Character Support | Quality | Selection |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| **`StokesContourGiSequence`** *(Spherical-Polygon Stokes Contour + 2-Bounce Surface Patches)* | **✔️ `0.2238`** | **✔️ `0.2238`** | **✔️ `0.1340`** | 🚩 Moderate (`O(Clusters)`) | 🔴 Exact radiant triangle contour integral + real-triangle `SurfelOccluderField` / `0.28 m` BVH4 contact | ⭐⭐⭐⭐⭐ | 🥇 **GTX GI #1** |
| **`SurfelCascadeGiSequence`** *(2-Tier Area-Stratified Surfels + Dual-Cascade Octahedral Grid)* | **✔️ `0.2239`** | **✔️ `0.2269`** | **✔️ `0.1814`** | **✔️ `O(1)` per pixel** | 🔴 Stratified virtual surfels sampled & refreshed directly from static + skinned character triangles | ⭐⭐⭐⭐⭐ | 🥈 **GTX GI #2** |
| `ContinuousFieldClipmapGi` *(64-Cone L1 Voxel Clipmap)* | 🚩 `0.2259` | 🚩 `0.2291` | 🔴 `0.2464` | 🚩 3D trilinear cone march | ✔️ Voxel discretization & boundary height guards | ⭐⭐⭐ | 🔴 Dropped |
| Legacy `DynamicIrradianceCache` / `VoxelSdfClipmap` | 🔴 `0.2402` | 🔴 `0.5361` | 🔴 `0.1968` | 🚩 Multi-step SVGF required | ✔️ Light leaks & blotchy denoiser lag | ⭐ | 🔴 Removed |

---

### 1.3 Six Real-Triangle Direct Shadow Modes (`SolarShadowAlgorithm`)

*Legend — GPU Cost: ✔️ = lowest (best) · Contact & Penumbra Accuracy: 🔴 = highest (best).*

| Enum Value | Identifier | Real-Triangle Mechanism | GTX 1080p Est. | Contact & Penumbra Fidelity | Quality | Role |
| :---: | :--- | :--- | :---: | :--- | :--- | :--- |
| `0u` | **`ContactPcss`** | `1024²` `Depth32f` 2-cascade (`3.9 mm` fine + `15.6 mm` coarse) + Vogel PCSS + `0.24 m` BVH4 triangle contact + `PlaneAwareShadowFilter` | ✔️ `~0.65 ms` | 🔴 Sub-millimeter triangle contact + smooth distance penumbra | ⭐⭐⭐⭐⭐ | 🥇 Default GTX |
| `1u` | **`PcssPlaneAware`** | Orthographic `Depth32f` Vogel blocker search + variable-penumbra PCSS + 3-step `PlaneAwareShadowFilter` | ✔️ `~0.50 ms` | 🔴 Fast multi-light penumbra without ray traversal | ⭐⭐⭐⭐ | 🥈 Fast Multi-Light |
| `2u` | **`ShadowRayMarch`** | Reverse-quadratic `Depth32f` cascade raymarch (`14` steps × `2–4` rays, SMRT) over rasterized real triangles | 🚩 `~1.30 ms` | 🚩 Crisp near silhouettes | ⭐⭐⭐⭐ | 🥉 Depth Raymarch |
| `3u` | **`PcfBilinear`** | `3×3` tent-weighted bilinear PCF over real-triangle `Depth32f` cascades | ✔️ `~0.28 ms` | ✔️ Sharp uniform filter | ⭐⭐⭐ | Low-Spec / Mobile |
| `4u` | **`WideTreeRayQuery`** | Deterministic Vogel solar-disc multi-ray traversal over `WideBoundingTree` (GTX BVH4 / RTX `VK_KHR_ray_query`) | 🚩 `~3.2 ms` GTX / `< 0.9 ms` RTX | 🔴 Exact triangle ground-truth penumbra | ⭐⭐⭐⭐⭐ | 🏆 RTX / Reference |
| `5u` | **`SurfelPolygonShadow`** *(New)* | Area-stratified `SurfelOccluderField` blocker disks built directly from static, rigid, and skinned character triangles + `0.28 m` BVH4 triangle contact ray | ✔️ `~0.85 ms` | 🔴 Smooth denoiser-free cone-disk penumbra (`0.2973` RMSE) | ⭐⭐⭐⭐⭐ | 🏅 Shared GI/Shadow Occluder |

---

### 1.4 Unified Deterministic Path Tracer (`WavefrontPathTraceSequence` — GTX + RTX)

*Legend — Register Spill / Divergence: ✔️ = lowest (best) · Determinism / Throughput: 🔴 = highest (best).*

| Integrator Architecture | Register Pressure | GTX Traversal | RTX Traversal | Cross-Batch Digest Parity | Throughput vs Monolithic | Rank |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: |
| **6-Step Lock-Free Wavefront (`WavefrontPathTraceSequence`)** | **✔️ Low (`<= 64` VGPRs, zero stack spill)** | **Stich SBVH + YKL DP CWBVH8 / BVH4** (`98.6%` slot fill, `-27%` tri tests) | **Inline `VK_KHR_ray_query` BLAS/TLAS** (`ALLOW_UPDATE` character refit `< 0.3 ms`) | 🔴 Bit-exact (`uint64` / `96-bit` fixed-point `2^28` atomic sum) | **🔴 `3.2×`–`4.8×` GTX · `6×`–`14×` RTX** | 🥇 🏆 |
| Monolithic Per-Pixel Megakernel | 🔴 `~140` VGPRs (`1.28 KB/thread` Turing L1 spill) | Greedy BVH4 (`76.3%` fill) | Single-thread divergent loops | 🔴 Bit-exact | `1.0×` baseline | 🥈 |

---

## 🧩 2. Proposed Folder & Module Structure (Zero Banned Words · Zero `And`)

Every path and identifier below passes the 7-gate test in `Documentation/AgenticInstructions/SKILL-Naming.md` and `Documentation/BannedWordsVocabulary.md` (zero `And`, zero `Mesh`, zero `Probe`, zero `Emitter`/`Emission`, zero `Evaluator`, zero `Pass`, zero `Pipeline`, zero `Node`, zero `Frame`, zero `Data`/`Info`, zero `Pool`/`Store`/`Reservoir`):

```text
Engine/
├── SpatialAcceleration/
│   ├── WideBoundingTree.{h,cpp}                      // Existing 4-wide BVH4 + dynamic skinned polygon refit support
│   ├── SpatialSplitBoundingVolume.{h,cpp}            // NEW: Stich (2009) SBVH + reference unsplitting + YKL (2017) DP BVH4/CWBVH8
│   └── SurfelOccluderField.{h,cpp}                   // NEW: Real-triangle stratified blocker disks + incremental character triangle refresh
│
├── GeometricRaster/
│   ├── DirectLighting/
│   │   ├── SolarShadowSequence.{h,cpp}               // EXTEND: Add Mode 5 (SurfelPolygonShadow) alongside Modes 0..4 (100% real triangles)
│   │   └── LinearCosineLightIntegration.{h,cpp}      // Existing analytic polygonal LTC + 2.2 m real-triangle ambient occlusion
│   │
│   └── WorldRendering/                               // RENAMED from GlobalIllumination/ (clean world rendering domain)
│       ├── DeterministicQuadrature.h                 // NEW: Bit-exact Owen-Sobol (0,2) 5-op bit-parallel quadrature & Dupuy-Benyoub GGX VNDF
│       ├── StokesContourGiSequence.{h,cpp}           // NEW (GTX GI #1): Real radiant triangle Stokes contour + 2-bounce DiffuseSurfacePatch cloud
│       ├── SurfelCascadeGiSequence.{h,cpp}           // NEW (GTX GI #2): 2-tier real-triangle surfels + Dual-Cascade OctahedralIrradianceCascade
│       ├── WavefrontPathTraceSequence.{h,cpp}        // NEW (GTX + RTX PT): 6-step lock-free deterministic wavefront path tracer
│       ├── SpecularReflectionSequence.{h,cpp}        // Existing coherent BVH4 / Sky specular & Abbe-dispersed glass refraction
│       ├── ShowcaseGalleryScene.{h,cpp}              // Existing showcase world scene + articulated character polygon network support
│       ├── TieredWorldRenderSequence.{h,cpp}         // EXTEND: 5 WorldRenderEngine modes (MatCap, OpenPbrDirect, StokesContourGi, SurfelCascadeGi, WavefrontPathTrace)
│       └── VulkanWorldRenderSequence.{h,cpp}         // EXTEND: Vulkan 1.3 compute dispatches for all 5 engines & 6 shadow algorithms
│
├── Shaders/
│   ├── DirectLighting/
│   │   ├── WideTreeRayQuery.slang                    // Existing shared BVH4 & VK_KHR_ray_query triangle intersection
│   │   ├── SolarFrustumShadow.slang                  // EXTEND: Add SurfelPolygonShadow cone-disk + 0.28 m BVH4 triangle contact
│   │   └── PlaneAwareShadowFilter.slang              // Existing 3-step continuous-sigma edge-preserving filter
│   │
│   └── WorldRendering/                               // RENAMED from GlobalIllumination/
│       ├── DeterministicQuadrature.slang             // NEW: Shared GPU Owen-Sobol (0,2) + Spherical-Cap GGX VNDF + Duff basis
│       ├── StokesContourGiCompute.slang              // NEW (GTX GI #1): GPU Stokes contour radiant triangles + 2-bounce patch gather
│       ├── SurfelCascadeGiCompute.slang              // NEW (GTX GI #2): GPU real-triangle surfel radiosity + 8x8/16x16 octahedral cascade
│       ├── WavefrontPathTraceCompute.slang           // NEW (GTX + RTX PT): 6-step lock-free wavefront (CWBVH8/BVH4 + VK_KHR_ray_query)
│       ├── EdgeAwareDisplayReconstruct.slang         // NEW: Optional deterministic 5-step edge-stopping reconstruction for 1-SPP interactive orbit
│       └── SpecularGlassRaytrace.slang               // Existing coherent VNDF specular & Abbe glass compute unit
│
Exhibits/
└── WorldGiShadowPathTraceValidation.cpp              // NEW: CTest + deterministic .png visual validation in Exhibits/Images/WorldGiShadowPathTrace/
```

---

## 📝 3. Subsystem Technical Specifications (100% Real Polygon Triangles)

```
  PolygonNetwork (Static World + RigidClusterInstance + Skinned Character Triangles)
         │
         ├──► SpatialSplitBoundingVolume (SBVH + YKL DP BVH4/CWBVH8 | RTX BLAS/TLAS + Fast Character Refit)
         │         ├──► Direct Shadows Modes 0..4 (Depth32f Cascades + 0.24 m BVH4 Contact / WideTreeRayQuery)
         │         └──► WavefrontPathTraceSequence (6-Step Lock-Free Sobol (0,2) + GGX VNDF, GTX & RTX)
         │
         └──► SurfelOccluderField + RadiantTriangleSource + DiffuseSurfacePatch Extraction (Real Triangles Only)
                   ├──► Direct Shadow Mode 5: SurfelPolygonShadow (Cone-vs-Disk + 0.28 m BVH4 Contact)
                   ├──► GTX GI #1: StokesContourGiSequence (Exact Stokes Contour 1st Bounce + Patch 2nd Bounce)
                   └──► GTX GI #2: SurfelCascadeGiSequence (2-Tier Surfels -> Dual OctahedralIrradianceCascade O(1))
```

### 3.1 `SurfelOccluderField` & Direct Shadow Mode 5 (`SurfelPolygonShadow`)
- **Static & Rigid Triangle Stratification**: Clusters world & rigid-instance triangles (`PolygonNetwork` / `RigidClusterInstance`) into area-weighted `OccluderSurfelDisk` entries (`Position`, `UnitNormal`, `RadiusMeters`, `InstanceOrdinal`), excluding outer room shells via spatial span guards rather than hardcoded coordinates.
- **Dynamic / Skinned Character Triangle Refresh (`< 0.2 ms`)**: Tracks character triangle index ranges (`DynamicPolygonSpan`); each tick recomputes `OccluderSurfelDisk` centroids, area-weighted normals, and equivalent radii directly from deformed character vertex positions — **zero analytical capsules, zero voxel rebake**.
- **Shadow Visibility**: Traces a `0.28 m` exact triangle `WideBoundingTree` contact ray first for razor-sharp sole/finger/tyre contact, then accumulates smooth quadratic soft-min cone ratios `SignedDiskClearance / max(0.02, T * TanSunRadius)` along the solar ray.

### 3.2 GTX GI #1 — `StokesContourGiSequence` (`StokesContourGiCompute.slang`)
- **1st Bounce (Exact Real-Triangle Radiant Contour)**: Extracts all radiant triangles (`PorosityLight.BlackbodyLuminanceNits > 0`) from world, vehicle headlamp/taillamp, and character gear polygon networks into flux-clustered `RadiantTriangleSource` arrays. Integrates exact clamped-cosine spherical-polygon edge contours ($\sum \Theta_{ij} (\mathbf{v}_i \times \mathbf{v}_j \cdot \mathbf{n})$) with zero Monte Carlo noise.
- **Soft Visibility Gate**: Attenuates each radiant cluster via `SurfelOccluderField` soft disk clearance + `0.28 m` `WideBoundingTree` triangle contact occlusion (zero 3D SDF).
- **2nd Bounce (`DiffuseSurfacePatch` Cloud)**: Stratified real-triangle surface patches (`256–512` patches across walls, floor, vehicle body, and character surfaces) receive 1st-bounce solar + radiant Stokes irradiance and transfer smooth 2nd-bounce color bleed per pixel with analytic solid-angle clamping.

### 3.3 GTX GI #2 — `SurfelCascadeGiSequence` (`SurfelCascadeGiCompute.slang`)
- **Two-Tier Real-Triangle Virtual Surfels**: Builds area-stratified `RadiantSurfelEntry` and `DiffuseSurfelEntry` arrays directly from real scene & character triangles, executing 2-bounce surfel-to-surfel radiosity exchange on GPU compute.
- **Dual-Cascade `OctahedralIrradianceCascade`**: Populates fine (`0.45 m` spacing) and coarse (`1.35 m` spacing) 3D octahedral cascades (`8×8` `1/pi` irradiance texels + `16×16` Chebyshev radial depth moments + backface ratio guard `> 0.25`) analytically from the surfel field + `WideBoundingTree` visibility, providing **`O(1)` blotch-free trilinear + Chebyshev lookup** on GTX hardware with zero SVGF denoiser.

### 3.4 Unified GTX + RTX `WavefrontPathTraceSequence` (`WavefrontPathTraceCompute.slang`)
- **Strict Determinism**: Zero PRNG, zero Russian roulette. Uses `DeterministicQuadrature` (`ReverseBits32`, `LaineKarrasPermutation`, 5-op bit-parallel `SobolSecondDimension`, `Sobol02Sample`, `SampleSphericalCapGgxVndfLocal`) + deterministic 10-lobe `OpenPbrSurfaceScattering` lobe splitting + power-heuristic MIS over sun, IES practical profiles (`R16F`/`R32F` hardware texture array), and `RadiantTriangleSource` light tree.
- **Dual Hardware Traversal**:
  - **GTX Compute Path**: `SpatialSplitBoundingVolume` (Stich SBVH with thin-glass unsplit protection + Ylitie–Karras–Laine optimal bottom-up DP 4-wide/8-wide collapse, `2-vec4u` `32 B` rigid instance entries, subgroup ray coherence sorting). Dynamic character polygon networks use a dedicated refittable BLAS entry updated in `< 0.4 ms`.
  - **RTX Hardware Path**: Inline `VK_KHR_ray_query` TLAS over static/rigid BLASes + `VK_BUILD_ACCELERATION_STRUCTURE_PREFER_FAST_TRACE_BIT_KHR | ALLOW_UPDATE` BLAS refit for deforming character polygon networks; thin-dielectric shadow hits sorted deterministically by `HitDistanceMeters`.
- **6-Step Lock-Free Wavefront**:
  1. `GeneratePrimaryRays` (bijective `8×8` strip tiles, fused Depth-0 trace)
  2. `PrepareIndirectStep` (`vkCmdDispatchIndirect` queue counts via `128 B` push constants)
  3. `TraceClosestSurface` (resolves real-triangle barycentrics & vertex normals while L1-hot)
  4. `IntegrateSurfaceScatter` (10-lobe OpenPBR + light-tree NEE + GGX VNDF continuation)
  5. `TraceShadowTransmittance` (stackless-first-entry descent + thin-glass transmittance)
  6. `AccumulateFixedPointSample` (`uint64_t` / `96-bit` `2^28` fixed-point `atomicAdd` -> exact order-independent float32 radiance).

---

## 🏁 4. Phased Implementation Roadmap

| Phase | Deliverables | Verification Gate |
| :---: | :--- | :--- |
| **Phase 0** *(Done)* | Sync `SultanAladin/Frontier@arena/8391e994-frontier` (`daed305`), rename `GlobalIllumination/` → `WorldRendering/`, rename `SdfAcousticFieldReading` → `RayAcousticFieldReading`, author real-polygon `WorldGiShadowPathTracerPlan.md`, rebuild `MarkdownStudioViewer.html`, push to GitHub. | Clean `CMake` + `FrontierEngine` + `AudioSpaceValidation` + `TieredWorldRenderValidation` build & remote branch verification. |
| **Phase 1** | Implement `DeterministicQuadrature.{h,slang}`, `SurfelOccluderField.{h,cpp}`, and `SolarShadowAlgorithm::SurfelPolygonShadow` (Mode 5) in `SolarShadowSequence.{h,cpp}` + `SolarFrustumShadow.slang` with real static, rigid, and deforming character triangles. | Shadow Lab 6-mode parity & `< 0.30` RMSE vs 128-SPP BVH reference on real vehicle + character polygon networks. |
| **Phase 2** | Implement GTX GI #1 (`StokesContourGiSequence.{h,cpp}` + `StokesContourGiCompute.slang`) and GTX GI #2 (`SurfelCascadeGiSequence.{h,cpp}` + `SurfelCascadeGiCompute.slang`) with `alignas(16)` `static_assert` GPU struct parity. | Zero-denoiser GI RMSE `<= 0.23` vs 128-SPP NEE reference; zero light leaks; dynamic character pose A → B update `< 0.5 ms`. |
| **Phase 3** | Implement `SpatialSplitBoundingVolume.{h,cpp}` (SBVH + YKL DP BVH4/CWBVH8) and `WavefrontPathTraceSequence.{h,cpp}` + `WavefrontPathTraceCompute.slang` + `EdgeAwareDisplayReconstruct.slang` (GTX compute + RTX `VK_KHR_ray_query`). | `0 / 147,456` quadrature mismatches; `DistinctDigests == 1` across batch sizes `1, 2, 4, 8, 32`; GTX/RTX pixel parity `< 1%` delta. |
| **Phase 4** | Wire all 5 `WorldRenderEngine` modes (`MatCap`, `OpenPbrDirect`, `StokesContourGi`, `SurfelCascadeGi`, `WavefrontPathTrace`) and 6 `SolarShadowAlgorithm` modes into `TieredWorldRenderSequence`, `VulkanWorldRenderSequence`, `ViewportPanel`, and `Exhibits/WorldGiShadowPathTraceValidation.cpp`. | `Editor`, `Development`, and `Shipping` builds green + deterministic `.png` comparison sheets in `Exhibits/Images/WorldGiShadowPathTrace/`. |
