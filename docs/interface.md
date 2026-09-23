# Studio interface

The current UI is inspired by the user's dark transit-map reference: near-black workspace, charcoal inset cards, large rounded panel corners, restrained borders, light-weight typography and pill-shaped navigation. Muted sage is reserved for selected accents and primary actions. The previous flat OLED chrome is replaced, not loaded alongside another theme. Fonts remain locally bundled; there is no UI framework, remote asset dependency or decorative dashboard data.

## Layout and navigation

- **Left — Outliner:** named objects, selection and individual visibility controls. **New scene** is the only plot/preset chooser; **+ Add** creates a Shape, Cut spline or Water spline. **Find an object…** filters names case-insensitively without hiding geometry, deleting objects or altering selection. Empty filtered groups disappear. Escape clears the query, and the filter survives tree rebuilds. Arrow navigation skips filtered-out rows.
- **Centre — Viewport:** actual WebGL2 SDF terrain, with a scene title, projection/material label, View menu, navigation hint and small WebGL2 badge. Overlays do not intercept terrain interaction. View contains navigation style, lit/clay, reset and fullscreen; it dismisses after selection or Escape.
- **Right — Properties:** selected-object context and grouped parameter cards. The default mountain exposes staged [noise landscape](noise-landscapes.md) controls and explicit Generate / Erosion actions. Kilometre navigation and staged noise generation are separate groups. Transform controls, brush tools, fracture controls, water and erosion remain functional. Advanced controls stay in disclosures, and destructive base-change warnings remain visible.
- **Header — Workspace tabs:** one always-visible **Object / Sculpt / Erosion / Water / Fracture** tab group replaces the hidden inspector-section menu. Object restores the selected object's properties. Arrow keys, Home and End move tab focus; Enter selects. Tabs use `role=tab`, `aria-selected` and matching panel controls. Switching tools resets property scrolling and hides irrelevant object transforms.
- **Header — Actions:** one Run/Pause button, Export, Help and explicit panel toggles. Step and simulation details remain in Erosion. Detailed frame rate, resolution and renderer diagnostics remain in Help.

The grid keeps **outliner left / viewport centre / properties right** at all sizes. The header becomes two rows below 1000 px, rather than crowding or duplicating menus. Property contents scroll independently; panels collapse only when requested. Rounded gutters do not create page overflow. The layout is present before JavaScript initialization, including embedded and short previews.

## Editing and input

Value pills support precise numeric entry: click or focus and press Enter. Enter/blur commits, Escape cancels, and values respect the original control's bounds, units and step. They dispatch the existing editor events rather than maintaining a separate state store.

**G / R / S** selects Move / Rotate / Scale and restores the selected object's inspector. **RMB + WASD/QE**, Shift boost, Home camera reset, sculpting, live modifiers, GPU erosion, intact fracture selection/deletion and Undo are unchanged. Modal and text-field input must not leak shortcuts into camera flight or terrain edits.

## Implementation

- `index.html`: semantic workspace tabs, outliner search, grouped cards, contextual headings and non-intercepting viewport labels. Existing control IDs and editor bindings are retained except the deliberately removed inspector-menu trigger.
- `src/interface.css`: one versioned entry point (`?v=charcoal-20260913`) with foundation, workspace, component and chrome layers. The final chrome layer defines the reference-inspired palette, spacing and responsive presentation.
- `src/studio-ui.js`: creation menus, value editing, tab focus and name filtering. A child-list observer reapplies filtering after outliner changes without observing its own visibility attributes.
- `src/main.js`, `src/scene-editor.js`: accessible active-tab state, current scene title and filtered-row keyboard navigation. No shader, SDF, erosion or fracture algorithm changed in this redesign.

## Historical verification for the charcoal redesign

- 48 unit tests and production build pass.
- 14 targeted browser tests pass: charcoal UI (3), layout (3), studio UI (2), camera/weather input (3), intact fractures (3).
- Checks include reloads, layout from 390–1440 px, search and tree refresh, tab focus, object selection, exact numeric editing, visible terrain and unchanged volume during navigation, camera/gizmo separation, selective chunk removal, exact Undo and stale-worker recovery.
- Actual captures: `artifacts/frontier-charcoal-desktop.png` (1440 × 900) and `artifacts/frontier-charcoal-compact.png` (770 × 540).

Browser checks use SwiftShader for functional verification, not native-GPU performance measurement. The full browser suite was not rerun for this presentation-only change.
