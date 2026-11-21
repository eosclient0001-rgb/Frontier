# Unreal viewport camera: one model, and the gizmo back

Patch: [`UnrealViewportCameraGizmoFix.patch`](UnrealViewportCameraGizmoFix.patch)

Applies to `unassignedinbox/Frontier`, branch `arena/28ada475-frontier`, commit
`70fc5262` ("Add ThoughtLog …"), on top of `c1bbbfd6` and `4cb14817`.

---

## What was wrong

The viewport had **two live camera models bound to two different mouse buttons**, so both answered the
same hand:

| Gesture | What the code did before |
| --- | --- |
| Right-drag | RMB mouse-look + WASD/QE fly (the Unreal model that was asked for) |
| **Left-drag (bare)** | A **second** model: yaw turn + ground-plane walk, plus WASD/QE fly |
| Left-click on a gizmo handle | Grab the handle — but only if the GPU pick patch happened to be fresh |

Two consequences, both reported by the artist:

1. **Both cameras fought each other.** A left-drag turned and walked the camera; a right-drag flew it.
   Whichever button the hand landed on, the view moved.
2. **The gizmo became unusable.** Any left-button camera movement set `CameraInteractiveDrag`, and the
   renderer only requested the gizmo **pick patch** when `!CameraInteractiveDrag`. Once the pick patch
   stopped arriving, the cached hover went stale/empty, so the next press on a handle found
   `GizmoHandleOrdinal::None`, fell through to the LMB camera arm, walked the camera again and
   re-anchored the gizmo away from the cursor. One wrong grab made the next grab worse.

Arrow keys and PageUp/PageDown also flew the camera with **no button held**, a third quiet owner of the
view. In Unreal they only work while RMB is held.

## What the patch changes

`Engine/Lifecycle/EditorLifecycle.cpp`

- Deletes the bare-LMB camera arm entirely. **LMB now only selects and drags the gizmo.**
- Keyboard fly is gated on **RMB held** (`FlyKeysPossible`), including arrows/PageUp/PageDown; the
  standalone arrow-key flight arm is gone, so nothing moves the view while the artist is not navigating.
- `AnyNavButtonHeld` no longer treats a plain LMB press as navigation, so a selection click cannot
  swallow the first look delta of the next RMB drag.
- `RequestPickPatch` is now gated on `!WorldTransformGizmo.QueryDragging()` instead of
  `!CameraInteractiveDrag` (both render paths), so the gizmo's pick patch stays fresh up to the instant
  a handle is grabbed, and is only suspended while a drag is already in progress.

`Exhibits/ProjectBrowserValidation.cpp`

- New regression check: a 6-frame **left-drag with W held** must leave `CameraOrigin` and `TargetPoint`
  bit-for-bit where they were (`LmbDriftSq`), and it is added to the failure condition and the message.

## Resulting controls (one model)

| Input | Action |
| --- | --- |
| LMB | Select / drag gizmo handle. Never camera. |
| RMB drag | Mouse-look (cursor confined + hidden while held) |
| RMB + W A S D / arrows | Fly |
| RMB + E / Q (or PageUp / PageDown) | Up / down |
| RMB + Shift | Sprint x3 |
| RMB + Ctrl | Crawl x0.3 |
| Wheel (with or without RMB) | Fly-speed (unchanged from `c1bbbfd6`) |
| MMB drag, LMB + RMB | Truck / pedestal pan |
| Alt + LMB | Orbit around target |
| Alt + RMB | Dolly |
| Alt + MMB | Pan |
| W / E / R / Q or U (no mouse nav) | Gizmo translate / rotate / scale / universal |
| F | Frame selection |

## Applying it

From a clone of `unassignedinbox/Frontier` on `arena/28ada475-frontier` at `70fc5262`:

```bash
git apply --check Docs/ViewportCameraGizmoFix/UnrealViewportCameraGizmoFix.patch   # dry run
git apply         Docs/ViewportCameraGizmoFix/UnrealViewportCameraGizmoFix.patch
git add -A && git commit -m "Single Unreal viewport camera model: LMB returns to the gizmo"
```

The patch was checked with `git apply --check` against a pristine `70fc5262` tree and applies cleanly.
It touches two files, +52/-63 lines, and adds no new symbols, members or build inputs.

## Verification

`Exhibits/ProjectBrowserValidation.cpp` is the round-trip test for this area; build and run
`ProjectBrowserValidation`. It already asserted RMB fly, sprint, Q/E, out-of-bounds drag capture and
wheel-speed behaviour; it now also asserts that a left-drag cannot move the camera.

This change was **not compiled here**: the workspace has no CMake, no Vulkan headers and no
`ExternalPackages/` (they are produced by `python3 Automation/PrepareDependencies.py`). Run the exhibit
on the Windows/MSVC build that ships the app before trusting it.
