# Editor demos

Run from the repository root:

```sh
python3 Experimental/Editors/EditorDemos/Serve.py
```

Open the root URL. The General Purpose Editor is the standalone Project Zero prototype recovered from [Frontier-](https://github.com/SultanAladin/Frontier-/tree/5102470cc319a12d436c767865d995dc0fa009ae/Experimental), revision `5102470cc319a12d436c767865d995dc0fa009ae`, renamed for this launcher. It opens the particle editor from a gas emitter, the fluid editor from a gas domain, and the fracture editor from a geometry object's enabled fracture card. The first two open in drawers; fracture opens a new tab and uses local storage. Browser storage and GPU support are required for the respective features.

The standalone General Purpose Editor includes its upstream prebuilt code. The fluid URL and visible editor labels were adjusted in that file; full rebuild source is not included. The Fluid Editor handoff is implemented in `src/EditorHandoff.js` and exchanges supported parameter values with its parent. Particle handoff uses the upstream messaging implementation. Only a subset of each specialist's settings is represented in the general editor's cards; this prototype is not a complete production scene integration. Texture Studio remains in the original workspace for later and is not part of this launcher.

Light Studio is a separate authoring prototype for symmetric IES profiles and spotlights. Its general-editor inspector link opens a separate session; it does not modify the scene light. See `Experimental/Editors/LightEditor/README.md` for supported formats and limitations.

For the Light Studio 3D view, install its dependency once with `npm ci --prefix Experimental/Editors/LightEditor` before starting the server.
