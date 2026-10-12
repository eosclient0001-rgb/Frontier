# Road Editor — UI design and working prototype

> **Status.** Design + interactive prototype. Every number in this document was measured from the
> prototype in this repository (`Experimental/RoadEditor`) by its headless gate, not estimated.
> The prototype is a **web canvas tool** that drives the *same* data model the native editor would use,
> so the panel set, the schema and the rules below are the specification — the renderer is a stand-in
> for the engine's own.
>
> Where the native editor already maps controls (`Docs/ImGuiControlMapping.md`), this design follows
> the same control vocabulary: press-to-fly cameras, a selection-driven inspector, a catalogue panel
> and a measurement rail.

---

## 1. What this is for

Frontier needs roads that look and behave like the real thing at three scales that usually fight each
other:

| Scale | What has to hold | Where it lives here |
|---|---|---|
| **City** | a network that can be driven end to end: hierarchy, junctions, ring roads, interchanges | `src/core/generate.js`, `network.js` — raster→vector road graph, 14 classes, 27 junction families |
| **Street** | lane-level cross-sections: kerbs, bus and cycle lanes, parking, verges, medians, tram | `src/core/profiles.js` — 23 presets built from a strip vocabulary, per-road overrides |
| **Detail** | markings, bollards, humps, rail crossings, subways, guardrail, street lighting | `src/core/details.js`, `geometry.js` — a separate decoration layer that never edits topology |

The user-facing requirement was **clean topology above all**. That is interpreted here as a testable
property, not a look: *every road terminus is attached to a node, every crossing is either a junction
or a structure, every lane has a movement, and every strip has a surface.* Those four sentences are
the validator's rules, and the gate either passes or prints what broke (§9, §10).

Buildings are explicitly **out of scope**; the editor draws none, and nothing in the model needs them.
Subway is in scope as a **network of entrances, stairs and tunnels** attached to the street section —
the tunnel bore is a structure span, the mouths are detail props (§7.5). Buildings are optional, but
an underground needs a reason to exist, so the entrances are placed where footfall is: junction
corners, bus stops, and pedestrian crossings.

---

## 2. Where it sits in the project

```
Experimental/RoadEditor/
  index.html, vite.config.js, package.json
  scripts/check.mjs          the headless gate — 85 checks, exit code is the verdict
  src/
    main.jsx  App.jsx        the editor shell: state, hotkeys, panel wiring
    panels.jsx  ui.jsx       the panel set and its widgets
    style.css                the dense tool theme
    viewport3d.js            software perspective renderer + fly camera + picking + minimap
    core/
      standards.js           the engineering catalogue (classes, strips, kerbs, surfaces,
                             markings, details, junction families, structures, rules)
      profiles.js            cross-section presets + arithmetic
      rank.js                one class-rank table, used by separation, banking and the validator
      network.js             the model: sampling, junction plans, movements, and every cleanup op
      generate.js            seeded generator: terrain, charters, layouts, stitching, elevation, rail
      details.js             the decoration layer
      geometry.js            model → render primitives (polys, lines, props, rings)
      topology.js            the validator
```

The prototype carries **no build-time magic**: pure ES modules, no generated code, and the whole
pipeline (generate → furnish → validate → build geometry) runs in node in ~1 s, headless, which is
what makes the gate honest.

**Native integration.** The intended path is to port `core/` (it is engine-agnostic JavaScript that
mirrors C++ semantics closely: struct-of-arrays-free, plain objects, explicit units) into the
existing roadway module, and to rebuild the panels in the project's own ImGui panel system with the
same layout (§6). The canvas viewport is replaced by an engine viewport; the panel list, the tool
modes, the hotkey map and the rules stay as designed here.

---

## 3. The model

`frontier.roadway/0.1` — one project object, six kinds of record.

```js
project = {
  options:  { seed, size, layout, charter, driveSide, markingStyle },
  profiles: [ Profile ],          // the cross-section catalogue, editable per project
  roads:    [ Road ],
  nodes:    [ Node ],             // every terminus and every junction
  rail:     [ RailLine ],         // level crossings are modelled, bridges are spans
  districts: [ District ],        // land-use raster, for later building placement
  terrain:  { height(x,z), isWater(x,z), waterLevel, hill },
}

Road   = { id, name, class, profileId, speed, oneway, surface, laneCount,
           points: [[x, y, z]…],            // y is authored elevation, 14 m sampling after grading
           spans:  [{ kind, i0, i1, clearance }],   // bridge · tunnel · culvert, index ranges
           startNode, endNode, proposalIndex, alignment, gradeExcess,
           details: { crossings, humps, bollards, busStops, signs, lights, gullies, manholes,
                      passing, rail, subway, guardrail, wear, chicanes, islands } }

Node   = { id, x, y, z, type, control, radius, arms: [{ roadId, end, angle }], moves: [ Move ] }

Profile = { id, name, class, tag, centre: Strip|null, right: [Strip], left: [Strip] }
Strip   = { id, type, width, kerb?, angle?, surface? }
Move    = { from, to, fromLane, toLane, kind, permitted, conflict }
```

Three invariants make the rest of the design possible:

1. **A road owns its geometry; a node owns the junction.** Roads are cut at junctions, so a node's
   `arms` are exactly the road ends that meet there. Nothing overlaps in plan unless it is a
   structure (§9, rule 3).
2. **Structure spans are index ranges on the road's own point list.** Bridges, tunnels and culverts
   survive every split, merge and re-grade because every operation that slices a point list remaps
   its spans (`sliceSpans`, `densifyRoads`).
3. **Strips and their markings share one set of frames.** Paint is generated from the same sample as
   the surface it sits on, so a marking can never drift off its lane, and a kerb is a *face plus a
   top* rather than a coplanar stripe.

---

## 4. The catalogue (the part that makes it "every road in the world")

All of it is data in `core/standards.js`; the editor renders pickers and inspectors from these
records, so adding a surface or a marking costs one object.

| Table | Count | Examples |
|---|---|---|
| Road classes | 14 | motorway, expressway, arterial, collector, local, lane (single-track with passing places), service, ramp, busway, tramway, cycleway, footway, pedestrian, parking aisle |
| Strip types | 22 | traffic, bus, cycle, cycle-track, parking, loading, shoulder, emergency, median, buffer, kerb, footway, verge, tree-lawn, planting, tactile, tram, drainage, guardrail, noise-barrier, railway, stairs |
| Kerbs | 6 | upstand 125 mm, low 60, flush, mountable, splayed, channel |
| Surfaces | 14 | SMA, dense, porous, concrete (JPCP/CRCP), setts, brick, resin, gravel, dirt, timber deck, steel deck |
| Markings | 37 | double white, double yellow, lane dash, Botts' dots, ghost island, chevron, box junction, advanced stop box, zebra, continental, toucan, shark teeth, bus cage, cycle squares, rail X, bay ticks, arrows (7 kinds), cats-eyes |
| Detail types | 19 | bollards (6 variants), speed humps, cushions, raised junctions, rumble strips, chicanes, signs, signals, lighting, gullies, manholes, shelters, benches, bins, trees, guardrail, decals, beacons, turning heads |
| Junction families | 27 | crossroads, T, staggered, multi-arm, mini and full roundabout, gyratory, hamburger, dumbbell, trumpet, cloverleaf, diamond, DDI, SPUI, stack, turbine, parclo A/B, quadrant, seagull, RCUT, Michigan left, RIRO, priority, all-way stop, signals, pedestrian crossing forms, raised junction |
| Structure families | 4 | bridge (10 kinds), tunnel (5), culvert, causeway — with parapets, piers and bearings as sub-tables |

Compliance bounds (`RULES`) are attached to the same records: lane 2.4–4.0 m, cycle 1.5–2.5, bus
3.0–3.6, footway 1.5–8.0, parking bay 1.8–2.6, kerb upstand ≤ 0.2, bridge clearance ≥ 4.5 m (5.1 m
on trunk routes), plus per-class junction spacing and gradient limits. The cross-section editor
checks widths against these live (§7.4).

---

## 5. The city generator

Generation is a pipeline of small, inspectable steps, each of which the panels can show:

```
terrain ─▶ districts ─▶ layout proposals (5 layouts × 6 charters)
        ─▶ smooth fast corridors ─▶ stitch: cut every at-grade crossing, splice cuts into the
           proposal's own polyline ─▶ fold duplicates ─▶ clip water (culverts for ≤ 40 m runs)
        ─▶ join dead ends ─▶ re-derive arms from termini ─▶ interchange pass (ramps, merge nodes)
        ─▶ grade separation for rank gaps ≥ 2 ─▶ densify to 14 m ─▶ terrain-following elevation
        ─▶ structure spans ─▶ junction-height snap ─▶ grade the approaches
        ─▶ crossing sweep at the final heights ─▶ fit design speed to the alignment ─▶ rail
```

Two decisions are worth calling out because they are what makes the output look like a city rather
than a graph:

* **Crossings are cut on the proposal's own polyline, not between its endpoints.** Every road keeps
  the shape it was drawn with; only the junction points are inserted.
* **Design speed is fitted to the alignment that got built** (`fitDesignSpeed`). A ring road with a
  R 250 m curve is reported as a 75 km/h road whatever its class says, and the validator then judges
  it against 75 km/h — while a separate rule tells the designer it is below the class norm. The
  editor never lies about a road it just made.

Measured on the reference city (seed 20261012, 3 000 m, ring + spine / NFS-arterial charter):

| | |
|---|---|
| roads · nodes · junctions · terminals | **155 · 148 · 65 · 81** |
| carriageway | **53.6 km** |
| class mix | motorway 24 · expressway 6 · arterial 28 · collector 26 · local 57 · ramp 14 |
| structure spans · detail items · rail crossings | 77 · 3 727 · 13 |
| geometry | 3 753 polys · 8 124 lines · 14 869 props · **170 703 triangles · 3 186 per km** |
| pipeline time | generate ~230 ms · furnish ~30 ms · geometry ~120 ms · validate ~60 ms |
| grade-separated crossings (interchanges) | 6 |

---

## 6. Editor surface

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTIER Road Editor │ seed 20261012 · 3000 m · nfs-loop · nfs-arterial │ tools │ REGENERATE │
├───────────────┬───────────────────────────────────────────────┬───────────────────────────────┤
│ NETWORK       │                                               │ INSPECTOR                     │
│ GENERATE      │            V I E W P O R T                    │ CROSS-SECTION                 │
│ LAYERS        │      (fly camera, WASD + Q/E, RMB look)       │ CATALOGUE                     │
│               │                                               │ GATES                         │
│ tree: class → │   HUD: mode · fps · polys drawn               │                               │
│   road        │                                               │ road: class, profile, speed,  │
│ search        │                                               │   spans, detail counts, ends  │
│ length, spans │                                   ┌─────────┐ │ junction: control, radii,     │
│               │   hotkeys: W A S D Q E · M Z X G │ minimap │ │   arms, movements, plan view  │
├───────────────┴───────────────────────────────────┴─────────┴───────────────────────────────┤
│ 155 roads · 65 junctions │ 53.6 km │ 170 703 tris · 3 186/km │ 6 interchanges │ 82 gates │ … │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

Three columns, because road editing is a *context* problem: pick something (left), look at it
(centre), change it (right). Nothing is modal beyond the tool chip in the top bar, and every panel
that shows a number shows where the number came from.

### 6.1 Viewport HUD
Mode chip, frames per second, polygons actually drawn (after culling), and a `generating…` chip while
the pipeline runs. Bottom-left: the hotkey legend, always visible, because a fly camera is only fast
if you do not have to remember it. Bottom-right: the minimap.

### 6.2 The minimap
The whole map with class-coloured roads, water, the camera position and heading. It is the answer to
"where am I on a 3 km NFS-scale map", which a fly camera cannot otherwise give. Clicking a road in
the tree flies the camera to it; the minimap redraws every twelfth frame.

---

## 7. Panels

### 7.1 Network (left)
Tree of every road, grouped **by class** or **by corridor**, with a search field, per-road length in
kilometres, a `⌒` glyph for roads carrying a structure, and a live count of roads and junctions in the
panel header. Click selects and opens the inspector; double-click flies to the road. Sorted by length
inside a group, because the longest road in a class is almost always the one being worked on.

### 7.2 Generator (left)
Seed with a randomise button, map size 1 200–6 000 m, layout and charter pickers, and a **Generate**
button. Below it, the measured report: carriageway in km, roads, junctions, terminals, triangles, and
triangles per kilometre, the class mix as a bar list, build timing split by stage, and the number of
interchanges and ramps. The report is the generator's receipt — you change a seed and see what it
cost.

### 7.3 Layers (left)
Toggles for terrain + water, kerbs and kerb faces, markings, furniture and detail props, structures
and rail, and a reference grid (`Z M X G` for the first four). Then the camera block: pose readout,
fly speed, field of view, view distance, and the key legend. Finally the **detail generation** block
— furniture, lighting, humps, crossings, bays, rail, subway, wear — which is what the "roads only"
brief becomes in practice: the network is always there, the decoration is a decision.

### 7.4 Road inspector (right)
For the selected road: identity chips (class, structure spans, one-way), and metrics for length,
corridor width and lane count. Then the editable properties — **class** (which re-points the profile
and the standards), **profile** (any of the 23 presets, or a per-road fork), **design speed** — and
the read-only facts a designer needs: gradient limit, point count and average sample spacing, the two
end nodes as clickable links, kerb upstand, surface.

Actions: **Fly to**, **Reverse** (mirrors the span index ranges so a bridge stays a bridge),
**One-way**, **Split**, **Delete** (which re-sanitises the graph). A cross-section strip bar with
click-to-select and a strip list with type, width and kerb pickers, plus the detail-layer contents
counted by family.

### 7.5 Cross-section editor (right)
The heart of the street-scale design:

* a strip bar drawn from the profile's real offsets, with the centre line marked and each strip's
  width labelled;
* totals: **corridor width**, **kerb to kerb**, **moving lanes**, kerb upstand;
* a strip table, outside-in, both sides, with type, width (0.05 m stepper), kerb type for kerb
  strips, and remove buttons (right/left are labelled `R`/`L`);
* live compliance: any strip outside its standard range produces a warning box (e.g. *Cycle lane
  1.20 m outside 1.5–2.5 m*), otherwise a green *breadths inside the standard ranges*;
* **preset library** with search and a class filter — applying a preset to a road is one click, and
  the first edit to a road forks a private copy of the profile (`edit-<roadId>`) so the library is
  never silently mutated.

### 7.6 Junction inspector (right)
Type (from the 27 families), control (`uncontrolled · yield · all-way stop · signals · roundabout ·
priority · tram signals`), corner radius, position, and a **plan view**: arms as rays with their real
half-widths, class-coloured, with the corner-radius circle and each arm's first name word. Below it
the arm list (class, lanes, angle) and the **lane movement matrix** — every `in lane → out lane`
connection with its kind. Actions: Fly to, Add crossings on all arms (zebra or toucan chosen by the
control type), Dissolve.

### 7.7 Catalogue (right)
The standards tables themselves, as a browsable list: markings (pattern, width, gap, duty, colour
swatch), strips (default width, range, documentation), detail types (family, size, variants), junction
families (arms, control, cost, documentation) and structures (kinds and notes). This is the panel
that answers "what can this editor build" without leaving the editor.

### 7.8 Gates (right)
The validator's report, rule by rule: a percentage score, counts of fails/warns/infos, and every
offender with its position and a click-to-fly chip. This is the panel that makes "clean topology"
operational: generation is allowed to produce findings, but they are visible, located, and one click
from the camera. **Re-run** re-validates the current model in place.

### 7.9 Status bar
Roads and junctions, kilometres, triangles and triangles per kilometre, interchanges, build time, rail
lines, polygons drawn this frame, and the camera pose with the current fly speed.

---

## 8. Camera and tools

The camera is the project's own fly camera, mapped the way the engine already maps it
(`Docs/ImGuiControlMapping.md`): **W A S D** travel, **Q / E** altitude, **Shift** sprint, **Ctrl**
creep, **arrow keys** or **right-mouse drag** to look, **wheel** to change fly speed, **Space** for a
slow cinematic orbit (used for screenshot runs). `T` drops to a top-down view, `F` flies to the
selection.

Tool chips in the top bar set the *intent* of a click — **Fly**, **Select**, **Cross-section**,
**Junction**, **Detail** — and the right panel follows: clicking a road opens the inspector, clicking a
junction opens the junction panel, and clicking a road while the cross-section tool is active opens
the section editor directly. Panel hotkeys: `B` network, `N` generate, `R` inspector, `C`
cross-section, `V` gates.

Picking is done against the projected centre lines with a 14-pixel threshold, road-first and
node-second, so a click near a junction still selects the junction's node while a click on a link
selects the link.

---

## 9. Topology rules (what "clean" means, and how it is checked)

18 rule families, each with a severity, a note a designer can act on, and offenders carrying a world
position:

| Rule | Severity | Test |
|---|---|---|
| orphan-end | fail | every road terminus is attached to a node |
| dead-end-audit | warn | a terminal more than 150 m from the next junction needs a turning head |
| crossing-without-junction | fail | two surfaces that overlap in plan at the same height are a junction or a structure |
| lane-continuity | fail | every inbound lane has at least one movement |
| turn-conflict | warn | no lane carries both a left turn and a through movement |
| grade | fail | gradient over a 20 m window against the class limit |
| min-radius | fail | R = V²/22.86 (6 % superelevation, 0.12 friction) from the road's **fitted** design speed, measured over a 72 m baseline, outside junction reaches |
| strip-width | warn | strip breadths inside their standards ranges |
| junction-spacing | warn | below 0.4× the class's desirable spacing |
| arm-angle | warn | an arm pair closer than 35° is a difficult turn to sign and to drive |
| bridge-clearance | fail | deck clearance ≥ 4.5 m over a road, ≥ 5.1 m over rail |
| deck-grade | warn | structure approach grades |
| rail-protection | fail | crossing protection appropriate to the road rank |
| rail-skew | warn | level crossings within 30° of parallel are re-checked |
| crossing-conflict | warn | crossing placements that overlap junction paint |
| crossing-spacing | warn | crossings closer than the sign spacing |
| alignment-class | warn | the built alignment is slower than the class norm |
| budget | info | triangles per kilometre against the rendering budget |

The gate runs the same validator plus profile arithmetic, per-layout generation soundness, geometry
and detail presence, the viewport's projection algebra, determinism (same seed → same network), edit
round-trips (split / reverse / delete then re-sanitise keeps the graph closed), and the reference-city
report above.

**Current verdict: 85/85 checks pass.** The reference city reports 8 fails and 175 warns, which is the
intended relationship between a generator and a validator: the generator's output is a *first pass a
designer would triage*, not a claim of perfection. The remaining fails are 6 at-grade surface
overlaps in dense districts and 2 links whose endpoints are further apart vertically than their class
limit allows over their length (reported at their true constant grade rather than disguised as a
step). The largest warn group — 48 long terminals — is the turning-head/turning-circle feature listed
in §11.

---

## 10. Rendering (how the prototype draws a 3 km NFS-scale map without a GPU)

`src/viewport3d.js` is a software perspective renderer on a 2D canvas:

* **One framing pass** builds an orthonormal camera basis from yaw/pitch; world points are transformed
  into camera space, clipped against the near plane, and projected with `focal = (h/2)/tan(fov/2)`.
* **Culling**: an axis-aligned bounding box per primitive (computed once in `geometry.js`) is tested
  against view distance and then against the frustum sides; props additionally cull at 55 % of view
  distance and are rejected if their centre projects off-screen.
* **Painter's algorithm, four passes**, each sorted back to front: ground and water → surfaces →
  markings and rails → vertical objects. Junctions, kerbs and decks are all polys, so a bridge
  occludes the road under it correctly, and markings are drawn after the surface they sit on.
* **Distance fog toward the sky** gives the air-of-a-large-place look and hides the view-distance
  cut; per-primitive shading is a single multiply, and props get a contact ellipse so they do not
  float.
* **Markings dash in world space** (per-segment, by arc length), so perspective shortens the dashes
  the way it does in a photograph, instead of looking like a dashed 2D line.
* **Adaptive detail**: markings fade out beyond 0.75 × view distance, detail props beyond 0.55 ×,
  kerb faces and structures can be switched off wholesale, and the whole terrain can be dropped for a
  clean "roads only" read of the topology.

Measured: 170 703 triangles of network, ~3 300 primitives, sorted and drawn in a handful of
milliseconds per frame at 3 000 m view distance in a canvas — which is why an NFS-scale map is
affordable here at all.

---

## 11. What the prototype implements, and what the native build still needs

**Implemented and verified**

* 14 road classes, 22 strip types, 23 cross-section presets, 6 kerbs, 14 surfaces.
* Lane-level cross-section editing with live standards compliance, per-road profile forking.
* Junctions: plans, corner radii, arms, movement matrices, roundabout rings, signals, yield, stop.
* Interchanges: 6 grade-separated crossings per reference city, built as half-diamonds with merge
  nodes, ramps and spans — measured, not decorative.
* Structures: bridges (deck, edge, parapet posts, piers, footings, abutments), tunnels (bores,
  portals, lighting strips), culverts for short water runs.
* Detail: markings (37 kinds), bays, humps, bollards, beacons, signals, lighting, gullies, manholes,
  guardrail, wear, chicanes, islands, subway entrances and stairs, rail crossings with protection.
* Validation: 18 rule families, the Gates panel, deterministic generation, an 85-check gate.

**Designed, not yet built (the native roadmap)**

1. **Turning heads and turning circles** at long terminals (the 48-warn group): the detail layer
   already knows where they go; the pass that lays the widened bell and its kerb ring is next.
2. **The remaining junction families.** The catalogue carries 27; the geometry pass implements
   crossroads, T, multi-arm, roundabout and grade separation. Staggered, gyratory, hamburger,
   dumbbell, cloverleaf, DDI and SPUI need their own plan solvers — the panel already offers them,
   and the validator already checks their signature rules.
3. **Grading, drainage and utilities** as first-class editable alignments (the model already stores
   `gradeExcess`, spans and clearance; it needs a kerb-line profile, a channel, and manhole runs).
4. **Signals as objects**: a controller with phases per movement (the movement matrix is in place).
5. **The vehicle-side contract**: lane-level connectors exported for traffic and pedestrians, plus
   the ride-mode camera.
6. **Subway as a network** rather than per-road entrances: station boxes, escalators, platforms and
   tunnel bores between stations.

---

## 12. Design decisions, and what was rejected

* **A web canvas prototype rather than an ImGui patch.** The brief asked for a UI *design*. A tool
  that can be opened, driven with a fly camera, and measured in this repository is worth more than a
  screenshot set, and the panel set, the schema and the rules port either way. The prototype is
  explicitly marked as a design instrument, not a shipped feature.
* **Roads only, decoration separate.** Buildings are out of scope, and the decoration layer is
  switchable per family, so "just roads" is a view setting rather than a build variant.
* **Lane-level cross-sections, not centre-line widths.** Every requirement in the brief that has a
  measurable answer — bus lanes, cycle tracks, parking, kerbs, paving, medians — is a strip in a
  cross-section. Modelling it any other way would have made the standards catalogue decorative.
* **Structure spans as index ranges on the road's own points**, remapped by every operation that
  slices a point list. The alternative (absolute arc-length spans) silently turns bridges into
  embankments the first time a road is split, which is exactly the bug this design was written to
  avoid.
* **The generator is allowed to be imperfect, and the validator is the point.** A designer's first
  pass over generated work *is* the job; a generator that reports zero findings is either trivial or
  lying. The gate therefore asserts structure and the report measures quality.

---

## 13. Reproducing

```bash
cd Experimental/RoadEditor
npm install
npm run check        # headless gate: 85 checks, exits non-zero on failure
npm run dev          # the editor (host 0.0.0.0, works behind a preview proxy)
npm run build
```

The gate prints the reference-city report used throughout this document, so every figure above can be
re-derived on any machine without a browser or a GPU.
