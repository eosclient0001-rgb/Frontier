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

- **D6 — object-space BLAS + instance transforms in the kernel — DELIVERED (CPU half measured, GPU half audited).**
  `Engine/GeometricRaster/InstanceAcceleration.{h,cpp}` builds one object-space BLAS per prototype into ONE shared pair
  of CWBVH blobs, emits the device records (`TlasInstanceRecord` 112 B, `BlasPlacement` 16 B) and a CPU reference trace;
  `Engine/Shaders/TraversalRecords.slang` mirrors those records; `TraversalCWBVH.slang` gained
  `TraceBlasClosest/TraceBlasOccluded(…, NodeBase, LeafBase)` (the old `TraverseClosest/TraverseOccluded` are those with
  zero bases, ie the pre-D6 instructions) plus `TraverseInstancesClosest/TraverseInstancesOccluded`, which transform the
  ray into each candidate instance's object space and back out with the inverse-transpose for normals;
  `TraversalIndex::TraceClosestObjectSpace` is the walker those use (it does NOT normalise the direction, where
  `TraceClosest` does — t is then the caller's own parameterisation, which is what makes the transform free of any
  rescale). Evidence, all CPU-measured (`Exhibits/Workbench/Traversal/CheckTwoLevelBvh.sh`, 61/61 gates):
  - identity instance vs today's world-space tree: blobs **byte-identical** (FNV-1a), and **20 000/20 000 rays
    bit-identical** (10 162 hits, 9 838 misses) — an identity instance IS the old path;
  - 8 chunked identity instances (a different tree SHAPE): 20 000/20 000 rays agree, hits bit-identical;
  - a rigidly moved instance (rotate 30° · scale 1.25 · translate) vs D5's transformed-triangle rewrite: the derived
    world AABB equals the transformed soup's bounds **exactly**; of 10 088 hits, 10 087 hit the same triangle (2 257 of
    them bit-identical t) and 1 is a grazing ray resolving to the neighbouring triangle of a shared tessellation edge —
    0 unrelated surfaces, 0 hit/miss disagreements;
  - the kernel's payload, walked by an INDEPENDENT walker written from the uploaded layout: 10 086 hits + 9 914 misses
    bit-identical to the builder's own tree.
- **D7 — TLAS — DELIVERED (CPU measured).** *(Plan wording: build at load over instance AABBs; rebuild per frame when
  any instance row changed; fat-AABB incremental update later if the rebuild ever shows in a profile. )* `InstanceAcceleration::UpdateTopLevel` recomputes the instance AABBs from
  the stored object AABBs and rebuilds the top level (a TLAS is never refitted — tinybvh hard-errors on it), then emits
  the kernel's payload (8 floats a node, integer fields bit-cast) and the instance list. Measured on this 2-core host,
  **every** instance moving every frame: 256 instances **0.07 ms** (top level alone 0.05), 1 024 **0.32 ms** (0.23),
  4 096 **1.42 ms** (1.09) — and the BLAS blobs are hashed before and after the frame loop to prove the updates never
  touch them. ⚠️ The D7 gate in the plan ("4 096 moving instances under 1 ms") is met at 1 024 instances on this host
  and missed at 4 096 (1.42 ms), where the top-level rebuild is 77 % of the cost; the number to watch on the user's
  machine is the TLAS build, not the row update.
  Host side: `SwapchainExchange::UploadInstanceTraversal`/`RefreshInstanceTraversal` (bindings 27-30, capacity-checked,
  no reallocation, no descriptor rewrite), the dispatcher's set grew 28 → 32 with the bindless table moved 27 → 31 so it
  stays the highest binding, and the push block's last reserve slot is now `TlasInstanceCount` — the selector that makes
  the kernel walk the two-level pair (0 = the pre-D6 single-blob path, byte-identical). `GameExecution` builds and
  uploads the pair beside the world-space structure and, in the drop scene, moves **rows** per frame instead of
  rewriting the flat soup (D5 stands down while the two-level path is live, because that rewrite would corrupt the rest
  pose the BLASes were built from).
  ⚠️ **Not verified here:** the shader and the dispatcher cannot be compiled in this sandbox (no shader compiler, no
  Vulkan device). What IS verified is the wiring: the check script's §⑦ pins 43 exact strings across the shader, the
  dispatcher, the integrator and the project (bindings, the table's last-place rule, the push slot, the object-space
  call sites, the inverse-transpose arm, the payload's float order) and computes the record offsets the shader's std430
  layout would produce. Running the kernel is the user's GPU build.
### What building it actually turned up (three defects, all now gated)

1. **The kernel applied the stored inverse TRANSPOSED.** `dot(Inv0.xyz, P) + Inv0.w` reads the record's *rows* out of
   the *columns* of a column-major inverse: correct for an identity (Iᵀ = I), correct for a pure translation (the
   translation of a column-major matrix is symmetric), wrong the moment an instance rotates. It cannot be caught by any
   layout or binding check. The fix lives in exactly one place now — `InstanceWorldToObject` /
   `InstanceWorldToObjectDirection` in `TraversalRecords.slang` — and gate ③c transcribes both forms into C++ and
   compares them against the CPU mirror, so a GPU is not needed to catch it (the transposed form is 5.99 m off on the
   M10 level's own geometry, 0.00 m for the corrected one).
2. **The row's transform must be RELATIVE, not absolute.** `SceneStructure::Finalise` bakes each instance's `World` into
   the flat soup, so a BLAS built over that soup already sits in the baked frame; carrying `World_now` as the row
   transform applies the bake twice. The row is `World_now · World_rest⁻¹` (`RelativeMatrix`), which is also the reason
   the drop scene looked fine — its rest transform is identity. Gate ③b builds a prototype over a *baked* soup and moves
   it with a non-identity relative transform, against a world tree over the moved soup.
3. **Descriptor pool vs layout, for the second time.** The pool's storage-buffer count was hand-kept and had gone stale:
   14 for a layout asking 18 (the GI reservoir pair 25/26 and D6/D7's four were never added). One driver let that
   through with a validation error; the next would not. Both the set layout and the pool are now derived from one
   `ComputeBindingType` table with `static_assert`s on the counts, and the four new descriptor writes are guarded on
   their buffers existing (a `VK_NULL_HANDLE` write is invalid, not merely useless).

Two further notes worth keeping:

- **The ray-to-object transform needs no re-normalisation.** `M·(O' + t·D') = O + t·D`, so `t` survives; the CPU walker
  (`TraceClosestObjectSpace`) takes the caller's direction verbatim, and the kernel divides twice (`rD' = 1/D'`). This is
  what makes an identity instance bit-identical rather than merely close.
- **The BLAS is quantised in object space.** Under a non-uniform bake-to-world scale the object-space tree is a
  *different, axis-sensitive* quantisation of the same geometry, so two trees can disagree by an ulp at a grazing hit
  (measured: one ray in 20 000, |det| ≈ 0.03 on that triangle). Both orders are legitimate; a disagreement is only a
  defect if the ray meets the triangle well inside it. The proof adjudicates every disagreement with a
  double-precision Möller–Trumbore oracle rather than assuming.

### Shader compilation is now a gate

`Tools/Build/CheckShaders.sh` lowers every entry of CMakeLists' `SHADER_TABLE` and fails on the first error. It exists
because two defects sat in `Engine/Shaders/` for a whole milestone: `flat` used as an identifier in
`ReSTIRViewport.slang` (a GLSL keyword — the `glslc` fallback path cannot compile that file, though the Slang path can),
and a `vec3 histUv = res.SelectedUv;` followed by a `vec4(histUv, w, depth)` (five components from two). Installing the
Vulkan SDK makes it a one-line pre-commit check; on a host with `slangc`/`glslc`/`glslangValidator` it runs as-is.

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
| Keep one world-space tree? | **No** — two-level from here on (D6/D7 delivered; the single-blob path stays as the fallback and as the bit-identity reference) | the whole-scene re-emit is the ceiling that blocks every dynamic feature |
| Must the object-space ray be re-normalised after `M⁻¹`? | **No** — transform O and D, take t as-is | `M·(O' + t·D') = O + t·(M·D')`, so t survives the transform; re-normalising would both rescale t and perturb grazing rays by an ulp |
| Animation without a rig? | per-frame deformed vertices + refit; VAT as the authoring route | the renderer never needs bone data; refit needs fixed topology, which skinning/VAT give |
