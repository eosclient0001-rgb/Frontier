# Dynamic geometry — BVH for moving and animated objects

Written 2026-09-17. Answers, with measurement and research: how moving/rotating objects and animated (triangle-level,
rig-less) characters should get an acceleration structure, whether the per-frame work belongs on the CPU or the GPU,
and what that costs in the layout this renderer actually traverses.

The question is not "CPU or GPU" in the abstract. It is **which work happens per frame, over how much geometry**, and
that number decides the answer. Three frequencies, three answers:

| work | frequency | scope | where it belongs |
|---|---|---|---|
| build the world tree | once at load | whole scene | **CPU** (today's `TraversalIndex::Build`; deterministic, already proven) |
| move a rigid object | every frame | transforms only — 0 triangles | **either** (CPU is 0.16–3.1 ms for the whole TLAS; see §3) |
| deform a mesh (skinning/VAT/cloth) | every frame | that mesh's triangles | **GPU refit**, once the layout allows refit-in-place |
| change topology (destruction, LOD swap) | occasionally | that mesh | CPU rebuild on a worker thread, or GPU build (H-PLOC) |

## 1. What exists in this repository today

- `Engine/GeometricRaster/TraversalIndex.{h,cpp}` — tinybvh (submodule `ExternalPackages/tinybvh`) binned-SAH build →
  MBVH8 collapse → **CWBVH compress**, emitted as two SSBO blobs (80 B nodes, 48 B per triangle) that
  `Engine/Shaders/TraversalCWBVH.slang` walks in compute. One tree, world space, over the whole scene.
- `BuildBottomLevel` (D1) — same code under a name that records the intent ("these triangles are one instance's
  geometry"); `RefitBottomLevel` (D5) — refit the binary tree, then re-collapse and **re-compress the whole scene**
  blob. Measured in the header: 0.22 ms refit, 0.74 ms collapse, **6.31 ms compress** for a 16.8 k-triangle showroom
  on a pre-AVX host. That compress is O(all nodes) and re-emits static geometry too — the documented ceiling.
- `Projects/Project-Zero/Source/PhysicsInstanceSequence.h` (D4/D5) — Jolt poses → `InstanceRecord::World` (raster side)
  *and* → rewritten world-space flat triangles → refit (ray side). Two paths that must agree, one refit for the whole
  scene.
- `InstanceRecord` already carries `World[16]` **and** `PreviousWorld[16]`, and the R2 motion vectors are computed from
  the pair — so ReSTIR's reprojection is already correct for moving objects. Only the traced geometry lags.

## 2. The two-level structure, and why the local tree is the right answer

The industry model (DXR/Vulkan-RT, and tinybvh's own `BLASInstance` + `BVH::Build(BLASInstance*, …, BVHBase** BLASes)`)
is exactly what was proposed earlier in the conversation:

- **BLAS** — one tree per *unique mesh*, in **object space**, built once. A BLAS can be shared by any number of
  instances.
- **Instance row** — `transform` (object→world) and its inverse, plus the world-space AABB of the transformed root.
- **TLAS** — a tree over instances' world AABBs only (`N` leaves, not `N × triangles`).
- **Traversal** — walk the TLAS; at an instance leaf, transform the ray into object space and walk that instance's
  BLAS. Hits come back in object space and are transformed to world (normals via the inverse-transpose).

tinybvh ships this end to end: `BLASInstance::Update(blas)` recomputes the world AABB from the eight transformed
corners; its GPU example does the same on device (`kernels/raytracer.cl`, `tmpRay.O = transform_point(ray.O, inst.invTransform)`).
So "save the BVH locally and move it relative to the world" is not a heuristic — it is the standard structure, and
**a rigidly moving object costs zero tree work per frame**: the BLAS is not touched at all, only its instance row.

Two consequences that matter here:

1. It removes the D5 ceiling entirely. Today a dropped ball makes the whole scene re-quantize; with instance rows, the
   same drop touches 64 bytes plus a TLAS leaf.
2. It makes instancing free. The M10 level's 49-material sphere grid is 49 instances of **one** sphere BLAS today,
   with 49 transform rows.

## 3. Measured budgets (this CPU: 2 cores / AVX2, tinybvh from the pinned submodule)

Built for this note (`/tmp/bvhbench.cpp`; triangle counts are the ones the plan argues over — a character, a hero prop,
a level chunk; a shell of small triangles, `-O2 -mavx2`):

| phase | 16 k tris | 64 k tris | 256 k tris |
|---|---|---|---|
| binary binned-SAH build (once, load) | 13.2 ms | 32.9 ms | 148 ms |
| BuildHQ / SBVH (once, load) | 88 ms | 241 ms | 1 083 ms |
| **Refit** the binary tree (deform) | **0.17 ms** | **1.18 ms** | **6.1 ms** |
| MBVH8 collapse | 0.56 ms | 2.6 ms | 17.3 ms |
| **MBVH8 wide refit** (no collapse) | **0.31 ms** | **2.4 ms** | 8.6 ms |
| **CWBVH compress** (what the shipped path re-emits) | **5.2 ms** | **18.0 ms** | **61.4 ms** |
| CWBVH blob size | 1.13 MB (69 B/tri) | 4.35 MB (66 B/tri) | 15.7 MB (60 B/tri) |

TLAS over one 64 k-triangle BLAS, `N` instances, **all of them moving every frame** (tinybvh TLAS: build, never refit —
its `Refit()` is a hard error on a TLAS):

| instances | instance rows updated (inverse 4×4 + 8 corners each) | TLAS rebuild | frame total |
|---|---|---|---|
| 256 | 0.012 ms | 0.158 ms | **0.17 ms** |
| 1 024 | 0.047 ms | 0.699 ms | **0.72 ms** |
| 4 096 | 0.207 ms | 2.87 ms | **3.07 ms** |

Read together, these say:

- **Rigid motion needs no BVH build at all.** 4 096 simultaneously moving objects cost ~3 ms of *CPU* TLAS work per
  frame on this machine — and that is the worst case (rebuild every frame, single-threaded pool); a fat-AABB
  incremental TLAS or the same rebuild on a worker thread while the frame renders makes it invisible. On a GPU a TLAS
  rebuild is a single AABB-LBVH pass; drivers do it in well under a millisecond.
- **Deformation is where the CPU stops scaling, and the reason is the packed layout, not the algebra.** Refitting is
  0.17 ms for a 16 k character; re-quantizing that character into the shipped CWBVH blob is 5.2 ms — 30× the refit.
  Four animated characters would already be 21 ms of CPU work per frame in the current format.
- **The fix is a layout decision, not a processor decision**: keep dynamic BLASes in a **wide, unquantized** layout
  (Aila–Laine `BVH4_GPU` 64 B nodes: float node box + quantized child boxes, or `BVH8_CPU`-style float bounds), where a
  bottom-up refit kernel updates node boxes in place — no re-collapse and no vertex re-quantization. Then the per-frame
  update of a 16 k character is one compute dispatch over its nodes, and the CPU only writes instance rows.
- Static geometry keeps the **compressed CWBVH**, which is the best traversal format available here and costs nothing
  per frame. Two formats, chosen by whether the mesh is ever going to move: compressed for the world, wide-refittable
  for actors. (Intel's DXR guidance says the same from the other side: keep BLASes updatable *only* where needed,
  because updatable structures cost memory and trace performance.)

## 4. Animated characters without a rig

The brief is explicit — "just the triangles, not rig". That is the *easier* case to schedule, because the renderer
never needs bone matrices: it receives a triangle soup that changed shape. Options, in order of what should be built:

1. **Per-frame vertex update + BLAS refit (the default).** Whatever produces the deformed vertices (baked vertex
   animation, morph targets, a skinning pass elsewhere, cloth), the renderer refits that mesh's BLAS. Topology must be
   fixed — same triangle count and connectivity — which is exactly what vertex animation and skinning give. Cost:
   §3's refit row, on the GPU as a node-update kernel, or 0.17 ms/char on the CPU for a handful of actors.
2. **Refit with a periodic rebuild.** Refit quality decays as the deformation grows (tree AABBs slacken), so the
   standard rule is *refit while the vertex displacement is small relative to primitive size, rebuild when it is not*.
   Practical form: track the maximum vertex displacement per mesh per frame; rebuild that BLAS when it exceeds a
   fraction (say 10 %) of the mesh's average primitive size, or every `N` frames regardless. A rebuild is 13 ms
   (CPU, 16 k) — affordable on a worker thread, not in the frame's critical path.
3. **Vertex-animation textures (VAT).** If animation is baked from the DCC as a texture of per-frame vertex positions,
   the same refit path serves it *and* the CPU mirror can reproduce it deterministically — the same property that made
   the ReSTIR proofs possible. This is the recommended authoring route for the `.geometry`/`.instance` formats when
   animation is added.
4. **Prebuilt BLAS per pose cluster (memory-heavy).** Reuse a cached BLAS for poses within a tolerance of the current
   one; trades memory for update time. Only worth it for hero assets on constrained hardware.
5. **Tetrahedral cage (research).** A 2026 ACM paper ("Ray Tracing Massive Amounts of Animated Geometry") animates a
   coarse tetrahedral cage and rebuilds the TLAS over the *tetrahedra* — two to three orders of magnitude fewer
   primitives than the triangles — decoupling per-frame cost from triangle density. Worth watching; it needs a custom
   intersection test, so it is not a first step.

What is *not* needed for any of these: a skeleton, skinning weights, or a rig in the renderer. The renderer consumes
deformed vertices and refits; the animation system owns everything before that boundary.

## 5. Where the GPU work actually goes, and what it requires of this codebase

- **A GPU builder must write our blob.** The traverser reads SSBO blobs in a fixed layout. A GPU builder that emits
  some other layout is useless unless `TraversalCWBVH.slang` grows a second traversal path — which is the real cost of
  H-PLOC/PLOC++/LBVH here, not the builder itself. Vertex data must also already be on the device (it is not: the CPU
  uploads flat triangles). So a GPU *build* is a bigger change than a GPU *refit*.
- **A GPU refit is small, and layout-local.** Bottom-up node-box updates over the wide layout: one dispatch, no
  topology change, no vertex re-quantization. This is the piece to write first, because it is what deformation needs.
- **GPU builders are for topology changes** (destruction, LOD swaps, meshes authored on the fly): H-PLOC (AMD, GPUOpen,
  Benthin et al. 2024) constructs a whole BVH in a single kernel launch, 1.1–3.6× faster than PLOC++/ATRBVH, with
  LBVH-quality-competitive results (a million instances, 4-wide, in 2.21 ms). PLOC (Meister & Bittner 2018) / PLOC++
  are the well-understood fallbacks, and a student CUDA port measured 0.44–0.83 G triangles/s. Which one we take
  depends on whether the emitted layout can be the same wide layout the refit kernel already writes — that question
  should be answered *before* writing kernels, not after.
- ⚠️ **The measured D5 numbers stay the reason to do this at all**: 6.31 ms to re-emit a 16.8 k showroom, and it grows
  with the whole scene, for one moving ball.

## 6. Milestones

- **D6 — object-space BLAS + instance transforms in the kernel.** Bind per-instance `transform`/`invTransform` and a
  BLAS list; transform the ray into object space at the instance leaf and the hit back to world (normal via the
  inverse-transpose). `TraversalCWBVH.slang` walks a BLAS exactly as it does today; the change is the entry/exit
  trampoline. Acceptance: the identity case is bit-identical to today's world-space blobs on the M10 level
  (the D1 identity gate establishes the same for the builder).
- **D7 — TLAS.** Build at load over instance AABBs; rebuild per frame when any instance row changed (measured budget in
  §3). Fat-AABB incremental update later if the rebuild ever shows in a profile.
- **D8 — dynamic update path.** Rigid: nothing (D6/D7 already cover it). Deforming: refit kernel over the wide layout,
  plus the displacement-driven rebuild policy. Acceptance: a moving/deforming scene renders correct shadows and
  reflections with the frame budget printed, and the CPU mirror reproduces the same images.
- **D9 — GPU build for topology changes.** H-PLOC or a simpler LBVH into the same wide layout, behind the frame-graph
  stage, on a worker/double-buffered BLAS so a build never stalls a frame.
- **D10 — ReSTIR integration.** Motion vectors already follow `PreviousWorld`; for dynamic objects the reservoir
  validation should use instance/primitive identity plus the previous transform, so a moving object's history is
  rejected on genuine disocclusion and kept when it merely moved.

## 7. Decision record

| question | answer | why |
|---|---|---|
| CPU or GPU for the world build? | **CPU**, once, at load | deterministic, proven, and 148 ms for 256 k triangles is a load-time cost; no PCIe round trip |
| CPU or GPU for a rigid object move? | **Either**; CPU TLAS rebuild is ~0.2–3 ms and can hide on a worker | the work is instance AABBs, not triangles |
| CPU or GPU for deformation? | **GPU refit**, CPU for a few actors | CPU refit of a 16 k character is 0.17 ms, but the shipped packed re-emit is 5.2 ms and 30× the refit |
| Which format for dynamic BLASes? | **wide, unquantized (refittable)**, compressed CWBVH for static | packed/quantized formats cannot be partially updated; the re-quantize is the cost |
| Keep one world-space tree? | **No** — two-level from here on | the whole-scene re-emit is the ceiling that blocks every dynamic feature |
| Animation without a rig? | per-frame deformed vertices + refit; VAT as the authoring route | the renderer never needs bone data; refit needs fixed topology, which skinning/VAT give |
