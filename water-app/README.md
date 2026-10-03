# Standalone Water Surface Lab

This is an independent water-only application. It does not import the Frontier Pyro/Hydro app or any of its engines.

Run the repository dev server and open `/water-app/` in the preview. The app uses its own WebGL2 marker update, depth/thickness blur, surface-normal reconstruction, and clear-water composite.

Controls:

- `DAM BREAK` resets a persistent raised marker body and releases its front.
- `CALM POOL` resets a shallow pool.
- `SPLASH` or clicking the canvas applies a real marker velocity impulse.
- `SPHERE` enables a moving solid collider.
- Drag to orbit and wheel to zoom.
