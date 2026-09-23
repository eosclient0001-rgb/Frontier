# Frozen viewport reference

`viewport-monolithic.glsl` is the assembled **GPU XYZ** terrain viewport before
`split-viewport-v1` (the `split-motion-v1` viewport reported failing on native
AMD/ANGLE D3D11). It includes the original Satmaps, water and fracture helpers.
It has no `LINEAR_VOLUME` define; the browser equivalence test inserts that define
when the tested solver uses linear float atlas sampling, just as production did.

This is test input only, never imported by the application. Keep it frozen:
regenerating it from the current shader would invalidate the A/B regression.
The comparison exercises finite scenes, not all inputs or native driver behavior.
