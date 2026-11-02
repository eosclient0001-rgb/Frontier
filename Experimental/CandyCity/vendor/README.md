# Vendored three.js

Only what Candy City needs, copied unmodified from the npm package **three@0.170.0**.

```text
three.module.js                       three.js r170, MIT (Copyright © 2010-2024 three.js authors)
addons/controls/OrbitControls.js
addons/environments/RoomEnvironment.js (unused by the scene; retained with the addon set)
addons/geometries/RoundedBoxGeometry.js
addons/postprocessing/{EffectComposer,RenderPass,ShaderPass,UnrealBloomPass,OutputPass,MaskPass,Pass}.js
addons/shaders/{CopyShader,LuminosityHighPassShader,OutputShader}.js
addons/utils/BufferGeometryUtils.js
```

The only edit applied to the copied files is the bare-specifier rewrite
`from 'three'` → `from '../../three.module.js'`, so the modules load from a plain static server with
no import map or bundler. Nothing else was changed.

Licence: MIT, as distributed with the package (see the three.js repository's `LICENSE`). This is a
dependency tree, not Frontier source; do not extend or patch it here.
