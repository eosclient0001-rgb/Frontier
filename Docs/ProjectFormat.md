# The project package — a plan, written before the code

*Status: plan. Nothing here is implemented yet. The ask: stop loading `Projects/Project-Zero/Content/Scenes/*.gltf`
at startup and give a project one binary container of its own — like a font file, self-contained, with duplicate
objects stored once as references, and usable either embedded or as a reference into engine content, opened from a
command line the way Unreal opens a project.*

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
| container | glTF text + JSON | ~4× the bytes of the records it means; a full JSON parse before the first pixel |
| scene graph | nodes/meshes/primitives | one node per primitive; the resident records it becomes (`InstanceRecord`, `VertexRecord`) are rebuilt every run |
| duplicates | one node per copy | twelve copies of a sphere are twelve vertex buffers in the file |
| materials | glTF PBR + `extras.slate_*` | the shipped descriptors are 58 floats × N (M10's library is 49 of them) re-derived through a codec on every load |
| fonts/audio/engine content | paths resolved ad hoc | `FontCodec::ScanEngineAndGameContent` is the only place the engine-content *root* convention is real |
| identity | file path | nothing in the file says "this is Project-Zero, revision 7, built by this exporter" |

The interchange codecs stay exactly as they are — they are how foreign art arrives. What is missing is a container
for **our** projects, in our own records.

## 2. The shape: a TTF-like table directory over the records we already keep

A font is a header, a directory of tagged tables, and payloads — and every reader, including ones that have never
heard of a tag, can walk it. Copy that, byte for byte where it helps:

    PackageHeader                       // 16 B, little-endian
    ────────────────────────────────
    char     Signature[4];              // "FPRJ"     — 0x4650524A
    uint16_t Major, Minor;              // format revision; a reader refuses a major it does not know
    uint16_t TableCount;
    uint32_t TableOffset;               // where the directory starts (header is 16 B, so usually 0x10)
    uint32_t TotalLength;               // self-report — a mismatch means a truncated download

    TableRecord                         // 16 B — the sfnt record, verbatim
    ────────────────────────────────
    char     Tag[4];                    // "MESH", "MATL", "SCEN", …
    uint32_t Checksum;                  // FNV-1a 32 over the payload
    uint32_t Offset, Length;            // 4-byte aligned (4 is all std430 needs)

Rules that fall out of the layout, and that the gate will check:

- **Unknown tags are skipped, not refused.** A newer exporter may add `ENVR` or `NAVI`; an older reader still loads
  the level. That is the whole point of a directory.
- **A checksum mismatch is fatal for that chunk and named in the message** — a package is either intact or it is not.
- **The payloads are the resident records, not a description of them.** `VertexRecord` 64 B, `InstanceRecord` 160 B,
  `MaterialRecord` 64 B + `MaterialSlabRecord` 288 B, `TriangleIndex` 64 B, `CameraRecord`,
  `PlacementRecord`, `PunctualLuminaireRecord` (all sized and static-asserted in
  `SceneStructure.h` / `MaterialIndex.h` / `SwapchainExchange.h`). Loading is a bounds check and a `memcpy` into the
  buffers `SceneStructure` already owns — no JSON, no per-run rebuild, and a bit-identical resident scene by
  construction.

### 2.1 Chunks

| tag | holds | built from |
|---|---|---|
| `META` | project name, exporter + revision, layout revision, build config, source level list | new |
| `MESH` | unique vertex/index buffers (`VertexRecord` + index arrays) | `GeometryStructure` |
| `MATL` | unique materials: `MaterialRecord` + 288 B slab graph | `MaterialDescriptor` / `MaterialIndex` |
| `INST` | `InstanceRecord` rows — world transform + mesh slot + material slot | `SceneStructure::Instances` |
| `SCEN` | level table: names, instance ranges, node hierarchy (`PlacementRecord`), default camera | `SceneStructure` |
| `CAMA` | `CameraRecord` rows (ShaderBall, Showroom, Showcase, Outdoor presets already exist) | `SceneStructure::Cameras` |
| `LITE` | `PunctualLuminaireRecord` rows + the emissive/luminaire alias table | `SceneStructure::Luminaires` |
| `ENVR` | sky/moon/weather preset the level starts in (today it is code, not data) | new, P2 |
| `REFS` | the reference table (§3) — engine content, project content, package-internal blobs | new |
| `TEXR` | texture index rows: either a URI/`REFS` slot or a blob index | `TextureIndex` |
| `BLOB` | raw embedded payloads (images, a font face, audio), addressed by 64-bit content hash | new |

### 2.2 One package per project, not per level

`Projects/Project-Zero/Project-Zero.fproj` holds **all** of Project-Zero's levels as `SCEN` rows over a shared
`MESH`/`MATL` pool — which is also where the dedup becomes visible: Showroom and Showcase draw the same chrome
sphere, so there is one `MESH` entry and one instance row per copy. Per-level files would duplicate exactly the
content the user asked to deduplicate; the directory makes the multi-level case free (one file, one load, a level is
a slice).

## 3. Duplicates and references — the "like fonts, or a reference into engine content" part

Three separate questions, three separate answers:

**(a) Duplicate objects inside a package.** A `MESH`/`MATL` entry is content-addressed: hash the payload (FNV-1a 64)
and reuse the entry when the bytes match. Instances and placements carry the reference; refcounts are *computed* on
load from the `INST`/`SCEN` rows, never stored — a package cannot lie about how many copies it has. Two materials
that differ in one float stay two entries, which is exactly the M10 rule that every grid cell owns its own
`MaterialDescriptor`: dedup keys on bytes, not on resemblance.

**(b) A reference to engine content.** `REFS` rows are `{ Tag, Kind, Path | BlobIndex }` where `Kind` is one of:

    EngineContent   "EngineContent/FontArchives/Inter/Inter-Regular.otf"   — resolved through the existing scan roots
    ProjectContent  "Projects/<Other>/Content/…"                           — another project's asset
    PackageBlob     blob index into BLOB                                   — the bytes travel with the file

Resolution order at load: **`PackageBlob` → `ProjectContent` → `EngineContent` → error naming the exact path it
looked for.** A project that must ship standalone embeds; a project that trusts the engine install references. The
same chunk shape covers fonts, audio, celestial textures, star catalogues and material libraries, because they are
all just tag + path today.

**(c) The recommended default (the "I don't know the best way" question).** *Reference by default, embed on
request, and record the decision per entry — never guess.* Geometry, materials and level data are project-specific,
so they are always embedded. Fonts, audio archives, star catalogues and engine-shipped textures are engine content,
so they are references unless the packager is told `-Embed=Fonts` (or a project marks the entry
`Required = Embedded`). The `META` chunk records which policy produced the file so a support question is answerable
from the artefact alone.

## 4. Opening it: the command line

The requested shape — `UnrealEditor -Project=Name -Build=Game -Config=Development +Location=(…)` — maps onto the two
hosts the engine already has (`EditorHost` and `GameExecution`), so the flags are a *parser layer*, not a new app:

    SlateEditor -Project=Project-Zero -Level=Showroom -Build=Editor -Config=Development
                +Location=(0,-6.0,2.6) +Rotation=(0,220,0)

    SlateGame   -Project=Project-Zero -Level=Showroom -Config=Development -game -silent

| flag | meaning here | lands on |
|---|---|---|
| `-Project=<Name>\|<path.fproj>` | the package to open | `Projects/<Name>/<Name>.fproj` |
| `-Level=<Name>` | select a `SCEN` level row | replaces the `--scene showroom` string aliases |
| `-Build=Editor\|Game` | which host runs | `EditorHost` vs `GameExecution` |
| `-Config=Debug\|Development\|Shipping` | switches + assert level | the existing `FRONTIER_DEBUG` build knobs |
| `+Location=(x,y,z)`, `+Rotation=(pitch,yaw,roll)` | transform override applied **after** the level loads | the level's default camera, so "play from here" is reproducible |
| `-Export[=All\|<Level>]` | (re)write the package from the code-built levels | replaces the export-on-first-run blocks in `GameExecution.cpp` |

`+`-prefixed trailing arguments stay last and take no `-` name, matching the convention the user wrote out. The
existing `--scene <file.gltf>` and `--scale` stay as a compatibility alias for one phase so the CPU proofs in
`Exhibits/` keep running unchanged.

## 5. Where the code goes (no new top-level folders)

- `Engine/ContentInterchange/ProjectCodec.{h,cpp}` — header + directory reader/writer, chunk (de)serialisation into
  `SceneStructure`/`TextureIndex`. Sits beside `SceneCodec`, and `ContentCodec::Classify` gains
  `ContentFormatCategory::FrontierPackage` for `.fproj` so every existing caller accepts a package with no
  signature change.
- `Engine/ContentInterchange/ProjectResolver.{h,cpp}` — the `REFS` resolution chain and the content-root scan (the
  same roots `FontCodec::ScanEngineAndGameContent` already walks).
- `Projects/Project-Zero/Source/CommandLine.{h,cpp}` — the `-Project/-Level/-Build/-Config/+Location` parser, shared
  by both hosts.
- `Tools/Scripts/ExportProject.sh` — the packager invoked by `-Export`, so the bytes are reproducible from a shell.
- `Exhibits/Workbench/ProjectFormat/` + `Exhibits/Gallery/ProjectFormat/` — the proof pair (§6).

## 6. What the CPU side can prove, and how

Every claim here is checkable on this machine, with no GPU:

1. **Round trip is lossless** — load a package, re-encode, `cmp` the two files: byte-identical, including the
   directory order and checksums.
2. **The scene is the same scene** — the M10 material level loaded from the package renders bit-identical to the
   glTF path: `compare -metric AE` against the committed `Exhibits/Gallery/Materials/MaterialLibrary_Wide.png`
   (the existing CPU viewport is the harness).
3. **Dedup is real** — a level with N duplicate spheres reports 1 `MESH` entry and N `INST` rows, and the file size
   is flat in N above the first copy.
4. **References resolve, and fail loudly** — with `EngineContent/FontArchives/Inter` present the level loads; with
   the folder renamed the error names the path; with `-Embed=Fonts` the same level loads with the folder still
   renamed.
5. **The directory is forward-compatible** — a synthetic unknown chunk (`ZZZZ`) does not stop a load, and a flipped
   bit in one payload is a named failure, not a corrupt render.
6. **The CLI is the same session** — `-Project=Project-Zero -Level=Materials +Location=(0,-5.0,2.6)` renders the
   same image as today's `--scene materials` invocation (AE = 0).

That is one gate — `Exhibits/Workbench/ProjectFormat/CheckProjectPackage.sh`, same shape as
`CheckMaterialDenoise.sh` — printing PASS/FAIL per claim and exiting on the first red.

## 7. Phasing

| phase | deliverable | gate |
|---|---|---|
| P1 | header + directory + `META`/`MESH`; reader, writer, checksum; the gate itself | round trip + truncation + unknown tag |
| P2 | resident chunks (`MATL`, `INST`, `SCEN`, `CAMA`, `LITE`, `ENVR`) and a level that loads from a package | bit-identical to the glTF path on the M10 level |
| P3 | content hashes, `REFS`, `BLOB`, embed/reference policy | dedup, engine-content resolution, embed fallback |
| P4 | the `-Project/-Level/-Build/-Config/+Location` parser in both hosts; `-Export` packager | CPU parity: package run == `--scene` run |
| P5 | migrate Project-Zero: commit `Project-Zero.fproj`; code-built levels become exporters only; glTF stays as interchange | the whole existing exhibit set still green |

## 8. Naming the format — candidates, for picking one

The word has to do three jobs at once: name a **container** (one file, table directory, font-like), name a **project**
(a body of levels that belongs to one maker), and read as **technical without being a codename**. The user's own
example set the tone (`.codex`), so the shortlist below leans that way — books, archives, and structures that are
exactly "a bound collection of named parts". Each row: the extension, what the word literally means, and what a search
for it collides with (checked against tooling, not trademarks).

| # | name | ext. | why it fits | collision to know about |
|---|---|---|---|---|
| 1 | **Codex** | `.codex` | a bound book of leaves; "a codex is a stack of tables" is literally what a font- and table-directory container is | the OpenAI Codex CLI/product owns the word in current discourse — searches get noisy |
| 2 | **Folio** | `.folio` | a bound sheet, and a book format; "one folio" = one file | light (some print/design apps) |
| 3 | **Quire** | `.quire` | bookbinding: a *quire* is a gathering of sheets folded together — the exact analogue of a table directory | none meaningful |
| 4 | **Atlas** | `.atlas` | a bound collection of plates/maps — one volume, many levels; "atlas" is already technical in graphics (texture atlas) | MongoDB Atlas, atlaspack (game) |
| 5 | **Almanac** | `.almanac` | a bound reference of data tables — the most literal "tables in a book" | none meaningful |
| 6 | **Gazetteer** | `.gaz` | a geographical index bound with its entries — a level index plus its contents | none |
| 7 | **Concordance** | `.concord` | an index of every reference in a work — the `REFS` chunk by another name | none |
| 8 | **Corpus** | `.corpus` | a body of work treated as one thing; technical in linguistics/ML | none |
| 9 | **Lexicon** | `.lex` | a font's content is glyphs, a lexicon's is entries — same "directory of named parts" | `.lex` is used by some parser generators/lexers |
| 10 | **Compendium** | `.compendium` | a concise collection of everything on a subject — one project, complete | long extension |
| 11 | **Dossier** | `.dossier` | a file of documents about one subject — a project folder as a single artefact | none |
| 12 | **Ledger** | `.ledger` | a bound book of records with cross-references; refcounts are literally a ledger | Ledger CLI (plain-text accounting) |
| 13 | **Register** | `.register` | a register is a set of records kept together — and the word is already engine-technical (a register block) | generic word; no format collision |
| 14 | **Vellum** | `.vellum` | the writing surface a codex is made of; material name next to Slate, literature-adjacent and technical-sounding | Vellum book-formatting app (macOS) |
| 15 | **Tessera** | `.tessera` | one tile of a mosaic; four bytes of tag = one tile in a directory | none |
| 16 | **Abacus** | `.abacus` | a computing ancestor that is an array of rods holding values — a grid of records | Abacus analytics products |
| 17 | **Strata** | `.strata` | the container is layers: header, directory, payloads; also "layers of a project" | some infra products |
| 18 | **Cairn** | `.cairn` | a stack of stones raised as a marker — a directory of chunks, and a waypoint for a project | Cairn (hiking app) |
| 19 | **Geode** | `.geode` | a plain shell holding crystals — a self-contained container with payloads inside | none |
| 20 | **Coffer** | `.coffer` | a strongbox; embed-or-reference is exactly "what you put in the coffer travels with it" | none |
| 21 | **Monolith** | `.mono` | one self-contained file, no sidecars — the anti-glTF argument in a word | Monolith (2001 game); `.mono` = Mono/.NET assemblies |
| 22 | **Cartridge** | `.cartridge` | a game cartridge is a self-contained shipped project — the most *gaming* of the list | `.cart` used by some emulators |
| 23 | **Crucible** | `.crucible` | where the pieces are brought together and poured into one vessel | Netflix Crucible tool |
| 24 | **Chapbook** | `.chapbook` | a small bound book — same family as codex/folio, less claimed | none |
| 25 | **Portfolio** | `.portfolio` | literally "a portable folio" — a project's collection, made portable | finance/design sense dominates searches |
| 26 | **Fascicle** | `.fascicle` | one instalment of a book published in parts — a level within a package | obscure, hard to spell |

**If the choice were mine** (in order): **`.folio`** — a bound sheet is what the file is, it reads technical in a
directory listing, and it collides with almost nothing; **`.quire`** — the same idea and the sharpest metaphor
(a gathering of sheets = the table directory), no collisions at all; **`.codex`** — your example, and the most
memorable of the three, accepting that OpenAI's Codex is the first search hit. Whichever wins, the reader in
`ProjectCodec` keys off the four-byte signature, not the extension, so the name is a one-line change plus a rename.

## 9. Open questions — the ones worth answering before P2

1. **Extension.** Pick from §8 (`.fproj` is the placeholder currently in this document — a descriptive working name,
   not a recommendation). `.slate` is *not* on the list: the material domain's `slate_*` glTF extras already own that
   word, so reusing it would make two different meanings one search term.
2. **Layout revision.** The records are GPU-facing and have moved every milestone (R4a widened `MaterialRecord`).
   Store the revision in `META` and refuse a mismatch, or write up-conversion steps? Plan assumes refuse, with the
   message naming both revisions.
3. **Compression.** v1 stores payloads raw so a package can be memory-mapped. If size becomes a problem, a
   per-chunk flag (`ZSTD`) copies WOFF's per-table compression — the directory already carries the lengths it
   needs, so no format change.
4. **`ENVR` scope.** Is a level's sky/moon/weather state part of the level (recommended) or a session overlay the
   CLI sets? The `-Level` flag makes more sense if a level remembers how it looked.
5. **Textures.** Keep `TextureIndex` URIs for referenced textures and embed only project-specific images, or always
   embed? Plan assumes the former, with the embed policy shared with fonts/audio.
