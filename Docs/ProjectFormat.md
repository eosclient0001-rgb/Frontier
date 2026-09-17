# The Space family — one container format, many kinds of file

*Status: plan. Nothing here is implemented yet.*

The ask, in the owner's words: stop loading `Projects/Project-Zero/Content/Scenes/*.gltf` at startup; give a project
one binary container of its own — like a font file, self-contained, with duplicate objects stored once as references;
usable either embedded or as a reference into engine content; opened from a command line the way Unreal opens a
project. And then the sharper half: the container should not be a single format but a **family** — a geometry file, a
UV file, a texture-paint file, a script, a terrain/environment file, each with its own extension, each of which can be
a file on its own *or* a part of a bigger file, and the project file contains them all or points at them.

The names chosen for that family are §2. The byte format is §3. What goes in which file is §4, how parts are embedded
and referenced is §5, how it opens is §6.

---

## 1. What exists today, and what is actually wrong with it

A level is a `.gltf` file under `Projects/Project-Zero/Content/Scenes/`. Some are committed (`CornellBox.gltf`,
`GlassProof.gltf`), the rest are **exported once on first run** from C++ that builds them analytically
(`RayTracingSolver`, `ShowroomStructure`, `MaterialStructure`, `ShaderBallStructure`) and then re-imported through
`SceneCodec` (`Engine/ContentInterchange/SceneCodec.cpp`) so every level takes the same path
(`GameExecution.cpp:76–98`).

That is a good *interchange* discipline and a poor *project* format:

| | today | consequence |
|---|---|---|
| container | glTF text + JSON | a full parse before the first pixel; ~4× the bytes of the records it means |
| scene graph | nodes/meshes/primitives | the resident records (`InstanceRecord`, `VertexRecord`) are rebuilt every run |
| duplicates | one node per copy | twelve copies of a sphere are twelve vertex buffers in the file |
| materials | glTF PBR + `extras.slate_*` | 58 floats × N re-derived through a codec on every load |
| UVs, paint, terrain | no carrier at all | they exist as code, not as data |
| session state | none | there is no editor context, no crash recovery, no save |
| fonts/audio/engine content | paths resolved ad hoc | `FontCodec::ScanEngineAndGameContent` is the only place the content-root convention is real |
| identity | file path | nothing in the file says "this is Project-Zero, revision 7, built by this exporter" |

The interchange codecs stay exactly as they are — they are how foreign art arrives. What is missing is a container
for **our** files, in our own records.

## 2. The family (the chosen names)

One structural rule makes the family work: **every file in it is the same byte format** (§3) and the extension says
what the file *is*. A `.geometry` is a container whose required table is `MESH`; a `.pigment` requires `PIGM`; a
`.projectspace` requires `META` + `SCEN`. The directory inside says what else it happens to carry. That is what makes
"individual file *or* embedded part" free: the same bytes are a file on disk, or a blob inside a bigger file.

| ext. | name | holds | writer | committed? |
|---|---|---|---|---|
| `.projectspace` | **Project Space** | the root: `META`, the level table (`SCEN`), project config, and a reference to every asset the project owns | editor / packager | yes — the thing you open |
| `.solution` | **Solution** | a bundle of projects: engine revision pin, content roots, toolchain, the list of `.projectspace` files | repo / CI | yes |
| `.geometry` | **Geometry** | vertices, indices, normals, tangents, bounds, LOD/cluster ranges | modelling / import | yes |
| `.uvspace` | **UV Space** | UV islands, seams, packing, texel density, the mapping a paint layer is authored against | UV editor | yes |
| `.material` | **Material** | a BASE material: one `MaterialRecord` + its 288 B slab graph (the M10 descriptors), plus refs to `.pigment` maps once painting lands. Per-object variation is not stored here — see `REFN` in §4 | material editor | yes |
| `.pigment` | **Pigment** | a texture-paint document: layers, strokes, channels, resolution, brush refs; bakes to an image blob for the GPU | paint editor | yes |
| `.instance` | **Instance** | one placed object: transform + reference to a `.geometry` + a reference to a `.material` + an optional **refinement** (the per-object material, §4) | editor | yes |
| `.environment` | **Environment** | world staging: sun hour, fog scenario, atmosphere/moon/star settings, terrain heightfield and its material refs, the baked sky probe | terrain / sky editor | yes |
| `.script` | **Script** | code automation, one source or a small module | user | yes |
| `.workflow` | **Workflow** | an automation graph: import → bake → validate → package, its steps referencing `.script`s | user / engine | yes |
| `.archive` | **Archive** | a shipping pack: content-addressed blobs with the directory at the end (streamable) | packager | build artifact |
| `.runtime` | **Runtime** | the *resolved* launch configuration: level, tier, feature flags, backend, resolved content roots | the host, at launch | generated |
| `.state` | **State** | **one** kind for the whole state family, told apart by a `domain` field inside `STAT`: `session` (where was I), `work` (unsaved buffers, crash recovery), `save` (a resumable world), `capture` (a read-only snapshot for comparison). **Deferred — see §11** | editor / game / harness | varies by domain |

Four notes on the naming, because three pairs were close enough to collide:

- **`.environment` is the world, not the config** (settled). The list offered `.environment` for dev/runtime
  configuration *and* `.enviromnt` for the terrain editor — one word, two jobs. In an engine "environment" is the
  world (sky, atmosphere, moons, terrain), and runtime configuration already has `.runtime`; so `.environment` is the
  terrain/sky file, which is also where the baked sky probe from the deferred environment-lighting plan lives. The
  config sense is `.runtime`, and nothing else.
- **The state family is one kind, `.state`.** It was four (`.context`, `.workstate`, `.state`, `.snapshot`) because
  four lifetimes were distinguishable — *where was I*, *unsaved work*, *resume the world*, *a read-only capture* —
  but a lifetime is a field, not a file type: the `STAT` table carries `{domain, revision, payload}` and the four
  domains ride that one extension. Fewer extensions, no lost meaning, and a single reader. **Skipped for now** —
  recorded in §11 so it is not re-litigated by accident when it lands.
- **`.runtime` stays its own kind** because it is not state: it is the *resolved* launch configuration the host
  writes at startup, and it is the one thing an editor, a game build and a crash report all want to read.
- **`.material` is the one addition** to the list — the family needs a material kind, and the M10 work *is* material
  descriptors. `.slate` is deliberately avoided: the material domain's `slate_*` glTF extras already own that word.
  The refinement that came back from the owner — *"material still needs to be refined per object"* — is §4.2.

Case: extensions are all-lowercase (`.uvspace`, not `.UVspace`). Git and Linux treat `.Geometry` and `.geometry` as
different files while macOS and Windows do not; a format family cannot afford that ambiguity.

## 3. The bytes (one format, TTF-like)

A font is a header, a directory of tagged tables, and payloads — and every reader, including ones that have never
heard of a tag, can walk it. Copy that, byte for byte where it helps:

    SpaceHeader                         // 16 B, little-endian
    ────────────────────────────────
    char     Signature[4];              // "FSPC"   — Frontier Space Container (the family's one signature)
    uint16_t Major, Minor;              // layout revision; a reader refuses a major it does not know
    uint16_t TableCount;
    uint32_t TableOffset;               // where the directory starts (header is 16 B, so usually 0x10)
    uint32_t TotalLength;               // self-report — a mismatch means a truncated download

    TableRecord                         // 16 B — the sfnt record, verbatim
    ────────────────────────────────
    char     Tag[4];                    // "MESH", "MATL", "PIGM", …  (the file KIND is a tag too, see below)
    uint32_t Checksum;                  // FNV-1a 32 over the payload
    uint32_t Offset, Length;            // 4-byte aligned (4 is all std430 needs)

Rules that fall out of the layout, and that the gate checks:

- **One signature for the whole family** (`FSPC`), with the file's *kind* as a mandatory `KIND` table holding a
  four-byte kind tag + a schema revision. A reader walks any file in the family with the same code, then asks "is
  there a table I know for this kind?" — which is exactly how `.geometry` and `.projectspace` share a reader.
- **Unknown tables are skipped, not refused.** A newer exporter may add `NAVI`; an older reader still loads the file.
- **A checksum mismatch is fatal for that table and named in the message.**
- **The payloads are the resident records, not a description of them.** `VertexRecord` 64 B, `InstanceRecord` 160 B,
  `MaterialRecord` 64 B + `MaterialSlabRecord` 288 B, `TriangleIndex` 64 B, `CameraRecord`, `PlacementRecord`,
  `PunctualLuminaireRecord` (all sized and static-asserted in `SceneStructure.h` / `MaterialIndex.h` /
  `SwapchainExchange.h`). Loading is a bounds check and a `memcpy` into the buffers `SceneStructure` already owns —
  no JSON, no per-run rebuild, a bit-identical resident scene by construction.

### 3.1 Tables

| tag | holds | lives in |
|---|---|---|
| `KIND` | four-byte kind tag + schema revision (what this file *is*) | every file |
| `META` | name, exporter + revision, build config, source list, pack/embed policy | every file |
| `MESH` | unique vertex/index buffers (`VertexRecord` + indices) | `.geometry` |
| `CLST` | cluster/LOD ranges (`ClusterRecord`) | `.geometry` |
| `UVSP` | UV islands: per-island vertex ranges, seams, texel density | `.uvspace` |
| `MATL` | `MaterialRecord` + 288 B slab graph | `.material` |
| `PIGM` | paint layers, strokes, channels, resolution | `.pigment` |
| `INST` | `InstanceRecord` rows (transform + mesh/material slot) | `.instance`, `.projectspace` |
| `SCEN` | level table: names, instance ranges, node hierarchy (`PlacementRecord`), default camera | `.projectspace` |
| `CAMA` | `CameraRecord` rows | `.projectspace` |
| `LITE` | `PunctualLuminaireRecord` rows + the luminaire alias table | `.projectspace` |
| `ENVR` | world staging + terrain + the baked sky probe reference | `.environment` |
| `REFN` | per-object material refinement: base material reference + sparse slot overrides + resolution rules (§4.2) | `.instance`, `.material` |
| `FLOW` | workflow steps (kind, operands, refs) | `.workflow` |
| `STAT` | the state family's one payload: `{domain, revision, payload}` with domain = session · work · save · capture | `.state` |
| `ARCH` | archive directory: hash → offset/length, chunked for streaming | `.archive` |
| `REFS` | the reference table (§5) | every container kind |
| `TEXR` | texture index rows: URI/ref slot or blob index | `.geometry`, `.material`, `.pigment` |
| `BLOB` | raw embedded payloads, addressed by 64-bit content hash | any file that embeds |

### 3.2 One file per project, not per level

`Project-Zero.projectspace` holds every Project-Zero level as a `SCEN` row over one shared asset pool — which is also
where the dedup becomes visible: Showroom and Showcase draw the same chrome sphere, so there is one `.geometry` and
one `.material`, and one `INST` row per copy. Per-level files would duplicate exactly the content the owner asked to
deduplicate; the directory makes the multi-level case free.

## 4. The object model — "like an object"

A project is a tree of spaces, and the leaf edges are references:

    Project-Zero.projectspace                    ← what `-Project=` opens
    ├─ KIND  projectspace · META  name, revisions, policies
    ├─ SCEN  levels: Showroom · Showcase · Materials · CornellBox
    ├─ ENVR  → Assets/Studio.environment          (sibling file, referenced)
    ├─ INST  rows … each row = transform + Reference{kind, mode, hash}
    │     ├─ → Assets/Sphere.geometry             (one geometry, shared by every copy)
    │     │     └─ → Assets/Sphere.uvspace        (its UV space)
    │     ├─ → Assets/Chrome.material             (the BASE material: one 58-float descriptor + slabs, shared)
    │     ├─   REFN  refinement of that base for THIS object (§4.2): sparse overrides, resolved at load
    │     ├─ → Assets/Checkers.pigment            (EMBEDDED, blob #3)
    │     └─ → EngineContent/…/panel.geometry     (engine content, referenced)
    └─ BLOB[] embedded payloads, keyed by content hash

Two consequences worth stating plainly:

- **An instance is a reference, not a copy.** Twelve identical spheres are twelve `.instance` rows (transform) over
  one `.geometry` and one `.material`; a sphere that differs carries a `REFN` over the same base rather than a
  duplicated descriptor. Dedup keys on bytes, not on resemblance.
- **Pieces know their neighbours by kind, not by name.** A `.geometry` does not name its UV file; the pair is bound
  by a reference row from whichever file owns the pairing (the instance, or the project). Rename or move a file and
  nothing is stale except the reference path — which is why every reference also carries a content hash.

### 4.1 The instance row

    InstanceRow                         // 96 B + references
    ────────────────────────────────
    char     Name[32];                  // the outliner's label ("Swatch_17", "DropSphere_04")
    float    Transform[16];             // object → world, column-major (the InstanceRecord's World)
    uint64_t GeometryHash;              // dedup key: the .geometry payload this row instantiates
    uint64_t MaterialHash;              // dedup key: the base .material
    uint32_t RefinementIndex;           // index into REFN, or 0xFFFFFFFF = the base as-is
    uint32_t LevelIndex;                // which SCEN level owns this row
    uint32_t Flags;                     // per-row bits (hidden, locked, cast-shadow, …)

### 4.2 Material refinement — the per-object material

*"Material still needs to be refined per object"*: the base may be shared, but the object's material must be its own.
The M10 rule (every grid cell owns its own `MaterialDescriptor`) and the dedup rule (one chrome material for twelve
spheres) are not in conflict — they are the same rule seen from two sides, and the split is **base vs refinement**:

- **`.material` is the base.** A full `MaterialRecord` + its 288 B slab graph, authored once in the material editor.
  Byte-identical bases are one entry; that is where dedup lives.
- **`REFN` is the refinement**, owned by the *instance* (or by a `.material` that refines another base). It carries
  the object's own values as a **sparse override list over slots**, not a second full descriptor:

      RefinementHeader                 // 16 B
      ────────────────────────────────
      uint64_t BaseMaterialHash;       // which base this refines
      uint16_t OverrideCount;
      uint16_t Flags;                  // bit0 = inherit unmatched slots (always set in v1)
      uint16_t SchemaRevision;
      uint16_t Reserved;

      RefinementOverride               // 8 B per override
      ────────────────────────────────
      uint16_t Slab;                   // 0xFFFF = the header's scalar channels (roughness, metallic, tint…)
      uint16_t Channel;                // the slot inside that slab (MaterialSlabRecord's own field order)
      uint32_t PackedValue;            // float, or an index for enum-valued channels

  Resolution at load: copy the base's 58 floats + slabs, apply the overrides in `(Slab, Channel)` order, then run
  the same `DeriveReflectance` precedence the codec uses (Unlit → EmissiveOnly → Transmissive → Subsurface → Cloth →
  ClearCoated → Anisotropic → Standard) — so a refinement that, say, sets transmission on a coated base resolves
  through exactly the path a `.material` authored with those values would.

- **Why per-object rows rather than per-object files.** A refinement is 8–100 bytes; making each one a `.material`
  file would turn a 49-swatch grid into 49 small files with 49 references, which is the duplication the family
  exists to remove. The refinement rides the instance; the instance file is still the *object*, so "the object's
  material" travels wherever the object does.
- **The uniqueness guarantee is testable**: resolve N instances against one base and the census must show N distinct
  `MaterialDescriptor`s with the base counted once — the M10 census (Standard 17 · Aniso 2 · ClearCoated 7 ·
  Cloth 2 · Subsurface 7 · Transmissive 8 · EmissiveOnly 1 · Unlit 1) unchanged, and the file flat in N. §8 claim 7.
- **Chain depth is two** (a base and the object's refinement) and no deeper: the "refine from a refined base" case
  is served by a `.material` that itself carries `REFN`, so an author who wants a family of variants writes one base
  plus one refined variant that others reference. Load resolves a chain by hashing the base first and refusing a
  base whose hash is not already resolved, which makes a cycle impossible by construction rather than by a check.

## 5. Embedded, referenced, or engine content

One record shape answers all three:

    ReferenceRecord                     // 32 B
    ────────────────────────────────
    char     Kind[4];                   // what kind of space this is
    uint8_t  Mode;                      // 0 Embedded · 1 Sibling · 2 ProjectContent · 3 EngineContent · 4 ExternalSpace
    uint8_t  Flags;                     // bit0 = required (fail the load if unresolved) · bit1 = prefer embedded
    uint16_t Reserved;
    uint64_t ContentHash;               // FNV-1a 64 of the payload — dedup, integrity, and "same object twice" for free
    uint32_t PathOffset;                // into the string table (Mode ≥ 1)
    uint32_t BlobIndex;                 // into the directory (Mode = Embedded)

Resolution order at load: **Embedded → Sibling → ProjectContent → EngineContent → ExternalSpace → error naming the
exact path it looked for.** With `Flags.required` clear, a missing reference is a warning the editor surfaces; set,
it fails the load by name. The recommended default, and the one recorded in `META` so the artefact answers the
question by itself:

- **assets are embedded** when small (< 64 KB) or when the packager was told to;
- **assets are referenced** (sibling files) otherwise — that is the "individual file" half of the ask;
- **engine content is referenced** (fonts, audio archives, star catalogues, celestial textures) unless the packager
  was told `-Embed=Fonts` or the entry is marked required-embedded;
- **state is never embedded in an asset** — a hard line, so deleting a `.state` (any domain, including a crash
  `work` file) can never touch content.

Two lossless tools fall out of this, and both are provable:

- `-Pack`: inline every referenced sibling into the container, leaving hashes in place.
- `-Explode`: write every embedded blob out as its own file and leave a sibling reference behind.
- Round trip: `Pack(Explode(X)) == X` byte-for-byte, because every payload is content-addressed and the directory
  order is deterministic. (This is claim 1 of §8's gate, extended to the whole family.)

## 6. Opening it: the command line

The requested shape — `UnrealEditor -Project=Name -Build=Game -Config=Development +Location=(…)` — maps onto the two
hosts the engine already has (`EditorHost`, `GameExecution`), so the flags are a *parser layer*, not a new app:

    SlateEditor -Project=Project-Zero -Level=Showroom -Build=Editor -Config=Development
                +Location=(0,-6.0,2.6) +Rotation=(0,220,0)

    SlateGame   -Project=Project-Zero -Level=Showroom -Config=Development -game -silent

| flag | meaning here | lands on |
|---|---|---|
| `-Project=<Name>\|<path.projectspace>` | the project to open | `Projects/<Name>/<Name>.projectspace` |
| `-Level=<Name>` | select a `SCEN` level row | replaces the `--scene showroom` string aliases |
| `-Build=Editor\|Game` | which host runs | `EditorHost` vs `GameExecution` |
| `-Config=Debug\|Development\|Shipping` | switches + assert level | the existing `FRONTIER_DEBUG` build knobs |
| `+Location=(x,y,z)`, `+Rotation=(pitch,yaw,roll)` | transform override applied **after** the level loads | the level's default camera, so "play from here" is reproducible |
| `-Pack` / `-Explode` | family tools (§5) | the container writer |
| `-Bake=Sky` | produce the `.environment` sky probe | the deferred environment-lighting plan (§11.2) |
| `-Export[=All\|<Level>]` | (re)write the project from the code-built levels | replaces export-on-first-run in `GameExecution.cpp` |

`+`-prefixed trailing arguments stay last and take no `-` name, as written. The existing `--scene <file.gltf>` and
`--scale` stay as compatibility aliases for one phase so the CPU proofs in `Exhibits/` keep running unchanged.

## 7. Where the code goes (no new top-level folders)

- `Engine/ContentInterchange/SpaceCodec.{h,cpp}` — header + directory reader/writer, kind registry, table
  (de)serialisation into `SceneStructure`/`TextureIndex`. Sits beside `SceneCodec`; `ContentCodec::Classify` gains
  `ContentFormatCategory::FrontierSpace` so every existing caller accepts a member of the family unchanged.
- `Engine/ContentInterchange/SpaceResolver.{h,cpp}` — `ReferenceRecord` resolution and the content-root scan (the
  same roots `FontCodec::ScanEngineAndGameContent` already walks).
- `Projects/Project-Zero/Source/CommandLine.{h,cpp}` — the `-Project/-Level/-Build/-Config/+Location` parser, shared
  by both hosts.
- `Tools/Scripts/PackProject.sh` / `ExplodeProject.sh` — the two lossless tools.
- `Exhibits/Workbench/ProjectFormat/` + `Exhibits/Gallery/ProjectFormat/` — the proof pair (§8).

## 8. What the CPU side can prove

Every claim is checkable on this machine, with no GPU:

1. **Round trip is lossless** — load, re-encode, `cmp`: byte-identical, directory order and checksums included.
   Extends to `Pack(Explode(X)) == X` for the whole family.
2. **The scene is the same scene** — the M10 material level loaded from a `.projectspace` renders bit-identical to
   the glTF path: `compare -metric AE` against `Exhibits/Gallery/Materials/MaterialLibrary_Wide.png`.
3. **Dedup is real** — N duplicate spheres report 1 `MESH`/`MATL` entry and N `INST` rows, and the file size is flat
   in N above the first copy.
4. **References resolve, and fail loudly** — with `EngineContent/FontArchives/Inter` present the level loads; with
   the folder renamed the error names the path; with `-Embed=Fonts` the same level loads with the folder still
   renamed.
5. **The directory is forward-compatible** — a synthetic unknown table does not stop a load; a flipped bit in a
   payload is a named failure, not a corrupt render.
6. **The CLI is the same session** — `-Project=Project-Zero -Level=Materials +Location=(0,-5.0,2.6)` renders the same
   image as today's `--scene materials` invocation (AE = 0).
7. **Refinement is exact and pays for itself** — the M10 grid carried as 1 base `.material` + 49 `REFN` rows
   resolves 49 distinct descriptors, byte-identical to the 49 standalone descriptors the level builds today (the
   census unchanged), with the file flat in N; and a refinement resolved from the file matches a `.material` authored
   with those same values byte for byte.
8. **Refinements are isolated** — editing one instance's `REFN` changes no other instance's resolved descriptor (the
   reference census before/after differs in exactly one row), and a refinement whose base hash is missing fails by
   name rather than silently loading the base.

One gate, `Exhibits/Workbench/ProjectFormat/CheckSpaceFamily.sh`, same shape as `CheckMaterialDenoise.sh`: PASS/FAIL
per claim, exits on the first red.

## 9. Phasing

| phase | deliverable | gate |
|---|---|---|
| P1 | header + directory + `KIND`/`META`; reader, writer, checksum; the gate itself | round trip, truncation, unknown table |
| P2 | asset kinds: `.geometry`, `.material`, `.instance` + `REFN` — enough for every existing level | bit-identical to the glTF path on the M10 level; claims 7–8 |
| P3 | `REFS` + `BLOB` + the five modes, `-Pack` / `-Explode` | dedup, engine-content resolution, embed fallback, pack/explode round trip |
| P4 | `-Project/-Level/-Build/-Config/+Location` in both hosts; `-Export`; migrate Project-Zero; glTF stays as interchange | CPU parity: package run == `--scene` run |
| P5 | `.runtime` only; the `.state` family (four domains in one kind) is **deferred** (§11) | `.runtime` records are written and read back; no state ever embeds into an asset |
| P6 | `.environment` (terrain + sky probe, per the deferred lighting plan), `.pigment` + `.uvspace` with the paint/UV editors, `.workflow`/`.script`, `.archive` | each gets its own exhibit pair when it lands |

## 10. Open questions — the ones worth answering before P2

1. **Layout revision.** The records are GPU-facing and have moved every milestone (R4a widened `MaterialRecord`).
   Store the revision in `KIND`/`META` and refuse a mismatch, or write up-conversion steps? Plan assumes refuse, with
   the message naming both revisions.
2. **Compression.** v1 stores payloads raw so a container can be memory-mapped. If size becomes a problem, a
   per-table flag (`ZSTD`) copies WOFF's per-table compression — the directory already carries the lengths it needs,
   so no format change.
3. **One `.projectspace` per project, or one per level?** Plan assumes one per project (§3.2); a very large project
   might want to split levels into sibling `.projectspace` files joined by a `.solution`.
4. **Refinement depth.** v1 allows base → refinement, and sharing a refinement through a `.material` that carries
   `REFN` (one level). Two levels is the plan; three is where "why is this object green?" gets expensive — should the
   limit be a hard two, or one with a warning?
5. **Refinement keys: slot names or the slab's field order?** Plan assumes `(Slab, Channel)` indices, so a renamed
   channel cannot silently retarget an override; the cost is that reordering a slab's fields is a schema revision.
   The alternative (hash-of-name keys) is friendlier to authors and slower to resolve.
6. **Terrain in `.environment` or its own kind?** Plan assumes `.environment` holds the heightfield reference plus
   the sky staging, with the heightfield itself a `MESH`-shaped blob — a separate `.terrain` kind is easy later.
7. **Textures / paint bake.** Keep `TEXR` URIs for referenced textures and embed only project-specific images, or
   always embed? Plan assumes the former, with the embed policy shared with fonts and audio; `.pigment` bakes to an
   image blob at pack time, so the GPU never reads a stroke list.
8. **Does a refinement belong to the *instance* or to the *object*?** Plan puts `REFN` on the instance row (§4.2), so
   the same `.geometry` can be used twice with two different materials. A `.geometry` that is only ever one object
   could instead carry its refinement, which reads better in a folder listing ("Sphere.geometry + Sphere.material")
   at the cost of binding an object to one material. Open; the instance is the default.

## 11. Deferred, in writing (so it is not re-litigated by accident)

1. **The `.state` family** — one kind, four domains (`session` · `work` · `save` · `capture`), skipped by the
   owner's call. The container already carries it (`STAT`); what is deferred is the payload format for each domain,
   the autosave cadence, and which domains are ever embedded. Nothing else in the plan depends on it, which is why
   P5 ships `.runtime` alone.
2. **Environment lighting — bake the sky, and let the sky be a light.** The measured answer to *"does the ray tracer
   / ReSTIR sample the sun, sky, moon?"* lives in `Exhibits/Workbench/Materials/MaterialProofsReport.md` §13.12
   rather than here, together with the two-stage plan (bake a mipmapped probe per staging into the project's
   `.environment`; then add a sky candidate to the reservoir so sky direct lighting reuses). One number from it is
   worth repeating because it is what makes the deferral safe: an escaped ray currently costs **6.5–7.0 µs** on this
   CPU against ~12 µs for a whole path sample, so the cost is real but bounded — this is a performance and variance
   improvement, never a correctness gap.
3. **Editors.** `.uvspace`, `.pigment`, `.environment` terrain authoring and `.workflow`/`.script` authoring are
   format-defined here and editor-defined later; each gets its own exhibit pair when its editor lands (P6).
