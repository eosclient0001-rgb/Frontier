# Standalone Water Surface Lab

This is an independent water-only application. It does not import or call the Frontier Pyro/Hydro app or any of its engines.

The simulation is a new hybrid liquid path: 1,536 persistent GPU volume markers are advected against a finite-volume-style Eulerian water-depth/momentum grid. Marker positions are splatted into an off-screen coverage field, which seeds the evolving grid and contributes to the surface reconstruction. The visible result is an indexed continuous water surface mesh, not a cloud of marker balls.

The dam front, pooling, gravity, viscosity, surface tension, splash impulses, foam, optional sphere obstacle, and water shading all live in this standalone water app. Rendering includes reconstructed normals, reflection/Fresnel, refraction, absorption, specular response, and a dark pool floor.

Run the repository dev server and open `/water-app/` in the preview. The standalone Vite preview can also be started from this directory.

Controls:

- `DAM BREAK` resets a raised water column and releases its front.
- `CALM POOL` resets a contained pool.
- `SPLASH` or clicking the canvas applies a real grid momentum/height impulse.
- `SPHERE` enables a moving solid collider.
- Drag to orbit and wheel to zoom.
