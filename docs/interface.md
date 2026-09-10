# Studio interface

The interface follows the visual language of the [Slate component reference](https://github.com/SultanAladin/Slate/blob/arena/01a062a4-slate/References/UIComponents.html): OLED-black surfaces, inset groups, rounded panels, pill controls, white selection states, thin sliders and restrained violet focus/interaction accents. It keeps Frontier's locally bundled fonts and procedural terrain; no external UI runtime or CDN is required.

## One location for each workflow

- **Left — Scene:** select objects and toggle their visibility. Empty object groups are omitted. **New scene** opens the only plot/preset chooser, with a replacement warning and Cancel/Escape. **+ Add** opens a light-dismiss menu for Shape, Cut spline and Water spline. The menu also works with keyboard focus, Enter and Escape.
- **Center — Viewport:** the permanent preset strip, marketing caption and duplicate renderer badge are gone. A single **View** menu contains navigation style, lit/clay view, reset and fullscreen. The orientation widget, scale legend and large floating simulation bar are removed. The ground/sky backdrop is neutral dark gray; rock lighting and SDF geometry are unchanged. Reset/initial framing fits the available aspect ratio.
- **Right — Inspector:** **Object** restores the current selection's properties, **Sculpt** contains the single eight-tool palette and brush settings, and **Erosion / Water / Fracture** contain their workspace settings. The inspector section switcher exposes these sections in a compact menu instead of a cramped five-tab strip. Workspace sections hide unrelated object transforms. Changing section returns the inspector to the top. Arrow keys, Home and End move menu focus; Enter chooses a section without moving the camera.
- **Header — Actions:** a single Run/Pause button and Export. Step and simulation details belong to the Erosion inspector. Navigation hints, frame rate, volume resolution and backend information live in Help, not a permanent footer.

Both side panels remain docked at all viewport sizes and collapse only through their explicit header controls. The panel layout is present before application JavaScript loads. The saved volume, sculpting model, GPU solver and export format are unchanged.

## Property controls

Click a value pill, or focus it and press Enter, to enter an exact value. Enter or blur commits; Escape cancels. Values are clamped to the underlying control limits and snapped to its increment. Wave amplitude continues to display and accept centimeters while storing meters. The same editor events are dispatched as when dragging the slider; it is not a second state store.

Transform controls expose Move/Rotate/Scale and XYZ position first. Point-target and relative uniform-scale controls are under **More options**. Brush detail, local shape noise and edge/rotation settings retain disclosures. Irrelevant organic-profile and rounding controls are omitted for primitives that do not support them. Baked-state warnings and regeneration warnings remain.

**G / R / S** still select Move / Rotate / Scale, and now return to the selected object's inspector from a workspace tab. **RMB + WASD/QE**, Shift boost and Home camera reset are unchanged. Modal dialogs and the Add menu do not leak gizmo/run shortcuts into the scene. Space/Enter still activate a focused native dialog button normally.

## Implementation and verification

- `src/interface.css`: one versioned stylesheet entry point, with ordered foundation/workspace/components/OLED layers. Replaces all three older CSS files so no independently cached olive stylesheet can become the final theme. Even the compatibility foundation is neutral.
- `src/studio-ui.js`: creation-surface focus/dismissal, keyboard menu focus, and precise value editing.
- `src/main.js`, `src/scene-editor.js`, `src/object-tools.js`: existing editor bindings and context-aware inspector state.
- `tests/browser/studio-ui.spec.js`: unique entry points, real creation and dismissal, unit conversion, numeric commit/cancel, live shape sizing, selection restoration, menu semantics and shortcut guards.
- Existing browser tests use the actual New scene/Add menu and Sculpt tab. GPU geometry, erosion, water, fractures, exports, camera separation and fixed panel layout remain regression-covered.

`tests/browser/oled-theme.spec.js` checks the actual embedded 770 × 540 layout across reloads: one stylesheet, computed RGB(0,0,0) backgrounds, no dead footer/grid track, no removed clutter, and closed menus that are genuinely hidden and clickable when opened.
