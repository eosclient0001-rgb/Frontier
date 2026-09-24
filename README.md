# Frontier

## T. rex skeleton (`trex/`)
Articulated *Tyrannosaurus rex* skeleton (proportions from FMNH PR 2081 "Sue" skeletal diagrams) with procedural IK Idle / Walk / Run gaits, smooth transitions, and a Roar action. Three.js is vendored in `trex/lib`.

Run: `cd trex && python3 -m http.server 8080`, then open http://localhost:8080 (you need a local server for ES modules).

### Accuracy
Proportions follow published measurements of FMNH PR 2081 ("Sue"): femur 132.1 cm,
tibiotarsus 124.5 cm, metatarsal III 67.1 cm, skull 146 cm (premaxilla→quadrate) and
94.5 cm wide, hip height 3.73 m, total length 12.35 m. 392 separate bones are modelled.

`trex/tools/compare.html` scores the model against a reference skeletal drawing:
the mean difference along the top line of the silhouette is currently 15 cm.
