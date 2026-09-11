# FlorArc — AAA Procedural Cacti & Desert Plant Generator

Ultra-meticulous 3D procedural structure generator for giant tree-sized desert cacti and succulents designed for AAA game environments (GTA 6 / Red Dead Redemption 2 scale).

Zero build step: serve this folder over http and open `index.html` (three.js r160 is vendored in `vendor/`, no CDN needed).

```sh
python3 -m http.server 8123   # then open http://localhost:8123/plants/
```

## What's inside

- **10 AAA Cacti & Desert Plant Species** in 1 Category (`Cacti & Desert Trees`):
  1. **Mexican Giant Cardón** (`Pachycereus pringlei`) — Tallest cactus species on Earth (up to 20m/65ft). Massive fluted columnar trunk with multi-level candelabra branching, 14 deep accordion ribs, dense areole spine rows, felted fruits, and nocturnal trumpet blooms.
  2. **Saguaro Cactus** (`Carnegiea gigantea`) — Sonoran Desert monarch with tall pleated trunk, thick upward curving arms flaring seamlessly at junctions, woolly apical crown, white wax flowers, and ruby tunas.
  3. **Organ Pipe Cactus** (`Stenocereus thurberi`) — Multi-stemmed cluster of 12-25 slender ribbed pipes emerging directly from ground level without a main trunk.
  4. **Golden Barrel Cactus** (`Echinocactus grusonii`) — Deeply ribbed sphere to tall cylindrical barrel with glowing yellow central & radial spine rows and woolly crown.
  5. **Tree Prickly Pear / Nopal** (`Opuntia ficus-indica`) — Tree-sized prickly pear with heavy woody corked trunk, stacked 3D spatulate cladodes (pads), golden needle clusters, and crimson tuna fruits.
  6. **Chain-Fruit Cholla** (`Cylindropuntia fulgida`) — Spiny tree with dark woody trunk, jointed cylindrical segments, glowing barbed spine sheaths, and multi-year drooping fruit chains.
  7. **Joshua Tree** (`Yucca brevifolia`) — Iconic Mojave Desert tree succulent with fibrous trunk, dichotomous forking branches, dense rosettes of sharp dagger leaves, and cream panicle towers.
  8. **Century Plant Agave** (`Agave americana`) — Giant rosette of thick, guttered, blue-grey sabre leaves with dark terminal thorns and recurved side teeth, holding a 10m inflorescence mast with umbrella bloom clusters.
  9. **Blue Myrtle Candelabra** (`Myrtillocactus geometrizans`) — Glaucous blue-green 5-6 ribbed stems with star cross-sections, black central spines, and dark blue-purple garambullo berries.
  10. **Ocotillo / Flame Sword** (`Fouquieria splendens`) — Fan of 12-35 spiny, cane-like whips clad in small oval green leaves and tipped with fiery scarlet flower spikes.

- **Plant-Dependent Controls**:
  - **Size / Scale (AAA)**: 0.5x up to 8.0x+ (supports giant tree-sized scale up to 20 meters tall).
  - **Age / Growth Stage**: Seedling -> Young -> Mature -> Ancient Giant (controls trunk woodiness, branching arms, pad stacking, fruit chains, and rib fluting).
  - **Hydration / Shriveling**: Adjusts accordion rib depth (plump post-rain vs shriveled drought ribs).
  - **Branching Multiplier**: Multiplies arm & branch counts.
  - **Fruit & Flower Counts**: Number of ripe fruits and open flower blooms.
  - **Spine Density**: Adjusts central/radial spine counts and lengths.

- **Botanical Research & Metadata**:
  - Scientific Name, Family, Native Habitat, Max Height, Longevity, Ecological Role (bat/pollinator interactions, bird nesting), Indigenous & Traditional Uses (Seri fruit harvest, Tohono O'odham ceremonial wine, timber/fencing).

- **Geometry & Shading**:
  - Smooth fluted/accordion ribs, L-curve arm sweeps with flared junctions, spatulate cladode pads, felted areoles, trumpet flowers, and drooping fruit chains.
  - Vertex-colored shading with directional sun light vector + cavity Ambient Occlusion (darker rib troughs) + basal wood corking gradients.
  - Soil mound, gravel grit, and contact shadow disc so nothing floats.

- **UI & Controls**:
  - **Outliner**: Census counters for specimens, tris, visible count.
  - **Inspector**: Botanical metadata profile, live parameter sliders, color swatches, OBJ export.
  - **Catalogue (`Tab`)**: Quick-grow drawer and parameter tuning.
  - **Command Line**: `grow cardon · seed desert-01 · age 2.0 · size 5.0 ...`
  - **Shortcuts**: `Tab` (catalogue), `F` (focus), `N` (nursery), `H` (hide), `R` (reseed), `E` (export OBJ), `V` (wire/flat toggle), `1`/`5`/`7` (camera views).
