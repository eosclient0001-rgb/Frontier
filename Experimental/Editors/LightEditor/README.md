# Light Studio

Browser authoring prototype for custom axisymmetric IES and spot profiles. Install the 3D preview dependency once with `npm ci --prefix Experimental/Editors/LightEditor`. Launch the existing demo server with `python3 Experimental/Editors/EditorDemos/Serve.py`, then open Light Studio from the launcher or the IES/spot inspector in the General Purpose Editor.

- The 3D scene uses a sampled Type C profile, inverse-square direct illumination and Lambertian surface response, with an illustrative sphere occluder. It does not compute indirect lighting, shadows from the box, fixture geometry or calibrated exposure. A WebGL-capable browser is required. Drag to orbit, scroll to zoom, and use Reset view.
- IES mode edits candela samples at vertical angles from 0° (down) to 180°. The polar visualization is a distribution diagram; the separate 3D view is an approximate test scene. Flux is a numerical integral assuming rotational symmetry.
- Spotlight mode uses peak candela and inner/outer **half-angles** with a smooth interpolation. Export samples that distribution into an IES file.
- Import is deliberately limited to LM-63 Type C, `TILT=NONE`, one horizontal plane at 0°, and full 0–180° vertical coverage. Other photometry is rejected, not silently flattened. Export is absolute photometry, one lamp, one C-plane; it does not export color, geometry, or a native spotlight entity.
- The library is stored in the browser. The General Purpose Editor link opens a separate authoring session; the selected scene light is **not** connected or automatically updated. Use the exported IES file externally; native integration remains future work.

Run `node --test Experimental/Editors/LightEditor/photometry.test.mjs` for numerical and file-format checks.
