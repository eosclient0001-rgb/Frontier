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
| `.material` | **Material** | one `MaterialRecord` + its 288 B slab graph (the M10 descriptors), plus refs to `.pigment` maps once painting lands | material editor | yes |
| `.pigment` | **Pigment** | a texture-paint document: layers, strokes, channels, resolution, brush refs; bakes to an image blob for the GPU | paint editor | yes |
| `.instance` | **Instance** | one placed object: transform + reference to a `.geometry` + a `.material` (+ per-instance overrides) | editor | yes |
| `.environment` | **Environment** | world staging: sun hour, fog scenario, atmosphere/moon/star settings, terrain heightfield and its material refs, the baked sky probe | terrain / sky editor | yes |
| `.script` | **Script** | code automation, one source or a small module | user | yes |
| `.workflow` | **Workflow** | an automation graph: import → bake → validate → package, its steps referencing `.script`s | user / engine | yes |
| `.archive` | **Archive** | a shipping pack: content-addressed blobs with the directory at the end (streamable) | packager | build artifact |
| `.runtime` | **Runtime** | the *resolved* launch configuration: level, tier, feature flags, backend, resolved content roots | the host, at launch | generated |
| `.context` | **Context** | editor context: open documents, selection, per-viewport cameras, inspector state, undo position | editor | session |
| `.workstate` | **Work State** | crash-safe unsaved work: dirty buffers, autosaves | editor, continuously | deleted on clean exit |
| `.state` | **State** | a resumable world state: entities, component values, simulation time (a save) | the game | user-saved |
| `.snapshot` | **Snapshot** | a point-in-time capture of buffers/tables/counters for comparison — proofs, bug reports | editor / harness | immutable |

Three notes on the naming, because three pairs are close enough to collide and the fix is worth writing down:

- **`.environment` is the world, not the config.** The list offered "`.environment` — dev.environment" for
  runtime/editor configuration *and* "`.enviromnt`" for the terrain editor. Both are the same word, so one job has to
  move: the world's staging (sky, atmosphere, moons, terrain) is what an engine calls an environment, and the runtime
  configuration already has **`.runtime`** and **`.context`** waiting. That leaves `.environment` free for the
  terrain/sky file, which is also where the baked sky probe from the deferred environment-lighting plan lives. Flip
  it if you disagree — but do not keep both names for two meanings.
- **State, snapshot, workstate** are three different lifetimes, not three words for one thing: `.state` is *resume
  and keep playing*, `.snapshot` is *look and compare* (read-only), `.workstate` is *recover a crash*. `.context` is
  *where was I in the editor* — genuinely a fourth thing, and the one that can be deleted without losing an edit.
- **`.material` is the one addition** to the list — the family needs a material kind, and the M10 work is material
  descriptors. `.slate` is deliberately avoided: the material domain's `slate_*` glTF extras already own that word.

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
| `FLOW` | workflow steps (kind, operands, refs) | `.workflow` |
| `STAT` | a state blob: `{domain, revision, payload}` for `.runtime`/`.context`/`.workstate`/`.state` | state kinds |
| `SNAP` | a capture: named buffers + tables + counters | `.snapshot` |
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
    │     ├─ → Assets/Sphere.geometry             (one geometry)
    │     │     └─ → Assets/Sphere.uvspace        (its UV space)
    │     ├─ → Assets/Chrome.material             (one 58-float descriptor + slabs)
    │     ├─ → Assets/Checkers.pigment            (EMBEDDED, blob #3)
    │     └─ → EngineContent/…/panel.geometry     (engine content, referenced)
    └─ BLOB[] embedded payloads, keyed by content hash

Two consequences worth stating plainly:

- **An instance is a reference, not a copy.** Twelve identical spheres are twelve `.instance` rows (transform) over
  one `.geometry` and one `.material` — and the M10 rule that every grid cell owns its *own* `MaterialDescriptor`
  still holds, because a cell whose material differs in one float simply references a different `.material`. Dedup
  keys on bytes, not on resemblance.
- **Pieces know their neighbours by kind, not by name.** A `.geometry` does not name its UV file; the pair is bound
  by a reference row from whichever file owns the pairing (the instance, or the project). Rename or move a file and
  nothing is stale except the reference path — which is why every reference also carries a content hash.

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
- **state kinds are never embedded in asset kinds** — a hard line, so deleting a `.workstate` can never touch content.

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
| `-Bake=Sky` | produce the `.environment` sky probe | the deferred environment-lighting plan |
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

One gate, `Exhibits/Workbench/ProjectFormat/CheckSpaceFamily.sh`, same shape as `CheckMaterialDenoise.sh`: PASS/FAIL
per claim, exits on the first red.

## 9. Phasing

| phase | deliverable | gate |
|---|---|---|
| P1 | header + directory + `KIND`/`META`; reader, writer, checksum; the gate itself | round trip, truncation, unknown table |
| P2 | asset kinds: `.geometry`, `.material`, `.instance` — enough for every existing level | bit-identical to the glTF path on the M10 level |
| P3 | `REFS` + `BLOB` + the five modes, `-Pack` / `-Explode` | dedup, engine-content resolution, embed fallback, pack/explode round trip |
| P4 | `-Project/-Level/-Build/-Config/+Location` in both hosts; `-Export`; migrate Project-Zero; glTF stays as interchange | CPU parity: package run == `--scene` run |
| P5 | state kinds: `.runtime`, `.context`, `.workstate`, `.state`, `.snapshot` | state never embeds into asset kinds; a deleted `.workstate` changes no pixels |
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
4. **Terrain in `.environment` or its own kind?** Plan assumes `.environment` holds the heightfield reference plus
   the sky staging, with the heightfield itself a `MESH`-shaped blob — a separate `.terrain` kind is easy later.
5. **Textures / paint bake.** Keep `TEXR` URIs for referenced textures and embed only project-specific images, or
   always embed? Plan assumes the former, with the embed policy shared with fonts and audio; `.pigment` bakes to an
   image blob at pack time, so the GPU never reads a stroke list.
