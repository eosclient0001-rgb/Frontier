# Fracture Editor

Standalone, single-page fracture authoring preview for the built-in geometry specimens. The checked-in `index.html` is already bundled and can be opened from the Frontier tool hub at `/Experimental/Editors/FractureEditor/` after starting `python3 Experimental/Editors/Serve.py` from the repository root.

The preview is not yet connected to project scene objects. Fracture settings and geometry are authored against the included specimen, and export is a separate hand-off rather than a live scene edit.

`index.html` is the runnable artifact. `FracturePanel.html`, `FracturePanel.css`, `FracturePanel.js`, the geometry modules, and `Build.mjs` are its source/build inputs; rebuilds require the pinned npm dependencies in this folder and the editor build assets described by `Build.mjs`.
