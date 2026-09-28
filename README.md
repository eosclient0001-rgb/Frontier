# ARACHNO-3D: Ultra-Realistic Scorpion 3D Model & Biomechanical Simulation

An anatomically accurate, ultra-hyper-realistic 3D model of an Emperor / Asian Forest Scorpion (*Pandinus imperator* / *Heterometrus spinifer*) engineered with true biological morphology, high-fidelity PBR materials, a 66-node articulated skeletal rig, and scientifically grounded biomechanical animations.

---

## 🦂 Biological & Morphological Accuracy

The model strictly adheres to arachnid morphology without shortcuts or approximations:

1. **Prosoma (Carapace / Cephalothorax)**:
   - Sclerotized trapezoidal dorsal shield with parabolic convexity and anterior clypeal notch (anterior median emarginations).
   - **Median Ocular Tubercle**: Raised hillock with a pair of glistening convex black median ocelli lenses.
   - **Lateral Ocelli**: 3 pairs (6 total) of lateral eyes positioned on the anterolateral shoulders.
   - **Chelicerae (Mouthparts)**: Articulated 3-segmented anterior pincer jaws with sharp denticles for tearing prey.
   - **Ventral Sternum**: Pentagonal sternal plate nestled between the walking leg coxae.

2. **Pedipalps (Massive Raptorial Chelae / Pincers)**:
   - Complete 6-segment anatomy: **Coxa** (basal anchor), **Trochanter** (horizontal/vertical swivel), **Femur / Humerus** (prismatic profile with longitudinal granulated carinae keels), **Patella / Brachium** (elbow joint angled forward/inward), and the **Chela**.
   - **Chela Manus (Palm)**: Broad, bulbous, heavily granulate palm with reticulated pustules and distinct dorsal carinae.
   - **Fixed Finger**: Hooked blade with inner cutting row of sharp primary and secondary denticles.
   - **Movable Finger (Dactyl)**: Articulated curved claw hinged to the manus with interlocking tooth serrations.

3. **Mesosoma (Pre-Abdomen: 7 Articulated Tergites)**:
   - Somites II to VIII form 7 distinct dorsal plates (Tergites 1–7) overlapping sequentially from anterior to posterior with articulated intersegmental arthrodial membranes.
   - Distinct axial longitudinal carina running down the dorsal midline.
   - Ventral sternites on segments 3–7 with paired oblique slits (**stigmata / spiracles**) for book lung respiration.
   - Ventral **Pectines**: Paired comb-like sensory appendages on segment II with 18+ individual pectinal teeth.

4. **Metasoma ("Tail": 5 Caudal Rings + Telson)**:
   - 5 cylindrical caudal body rings (Cauda I–V) with 8 longitudinal granulated carinae (dorsolateral, lateral, ventrolateral, and ventral submedian keels).
   - Segment V features heavy ventral serrations and a dorsal longitudinal trough.
   - **Telson (Venom Vesicle)**: Swollen, pear-shaped ampulla housing paired venom glands.
   - **Aculeus (Stinger)**: Smoothly curved hypodermic needle barb tapering to an ultra-fine point, fortified with dark metalloprotein hardening at the tip and venom pore duct openings.

5. **Walking Legs (4 Pairs / 8 Legs Total)**:
   - 7 segments per leg: **Coxa**, **Trochanter**, **Femur**, **Patella**, **Tibia**, **Basitarsus**, **Telotarsus** with paired lateral curved **ungues** (dactylar claws) and a median dactyl.
   - Accurate length gradient: Leg 1 (shortest, agile probe) to Leg 4 (longest, rear propulsion).
   - Natural arachnid sprawling posture with high knee arches.

---

## 🎬 Biomechanical Animations & Kinematics

All 6 animations are built from real-world scientific video analyses and kinematic research:

| Animation | Duration | Tracks | Kinematic Description |
| :--- | :--- | :--- | :--- |
| **Walk Cycle** | 1.4s (Loop) | 44 | **Alternating Tetrapod Gait** with metachronal wave phasing (Bowerman 1975, Spagna 2011). Two anti-phase tetrapods: Tetrapod A (R1, L2, R3, L4) and Tetrapod B (L1, R2, L3, R4) with a ~10% rear-to-front wave delay. Features rhythmic prosoma heave and dynamic anti-phase tail counterbalance swaying. |
| **Attack (Full Predatory Strike)** | 2.4s (Action) | 26 | **4-Phase Sequence** based on 500 fps high-speed footage (Coelho 2017):<br>1. *Wind-Up*: Body rears up, chelae splay wide open, metasoma coils tightly back.<br>2. *Clamp*: Chelae rapidly snap forward and lock onto target with movable fingers.<br>3. *Overhead Stinger Plunge*: Metasoma uncoils in an explosive whip arc (>100 cm/s velocity) plunging the aculeus between the pincers.<br>4. *Venom & Retract*: Venom injection pulse, swift extraction, and prey draw-in. |
| **Stinger Strike** | 1.2s (Rapid) | 6 | High-velocity overhead defensive tail whip strike and instant recoil. |
| **Pincer Attack** | 1.4s (Action) | 6 | Double chela snatch, rapid clamping snap, and grappling twist. |
| **Threat Display** | 2.0s (Loop) | 14 | Warning intimidation stance: reared prosoma, gaping elevated chelae, tautly poised metasoma with trembling stinger. |
| **Idle Respiration** | 3.2s (Loop) | 15 | Organic respiration: rhythmic expansion of mesosoma tergites (book lung cycle), tail breathing drift, and pedipalp trichobothria micro-adjustments. |

---

## 🎨 PBR Materials & Shaders

- **Obsidian Epicuticle Chitin**: Deep black-slate base (`#101315`), roughness 0.22, metalness 0.16, clearcoat 0.85 with procedural micro-granulations and carinae bump mapping.
- **Amber Articular Membranes**: Warmer translucent tone (`#422d1d`), satin finish for flexible joint seams.
- **Hardened Aculeus Barb**: Gradient from mahogany-amber base (`#281910`) to jet-black hardened tip (`#030303`).
- **Glossy Median & Lateral Ocelli**: Mirror-like black corneal lenses (`#030303`), roughness 0.04, metalness 0.85.
- **Bioluminescent UV Mode (365nm)**: Simulates the natural fluorescence of scorpion exocuticle caused by beta-carbolines and 7-hydroxy-4-methylcoumarin under ultraviolet blacklight.

---

## 💾 3D Asset Files

- `scorpion.glb`: Binary glTF 2.0 containing the complete geometry, materials, 66-node joint hierarchy, and all 6 embedded animation tracks. Ready for direct import into Blender, Unity, Unreal Engine, Godot, or any WebGL engine.
- `scorpion.obj`: Standard Wavefront 3D mesh format with quad/tri geometry and vertex normals.

---

## 🚀 Interactive 3D Web Simulator

The included real-time interactive viewer runs on port 3000:
- **OrbitControls**: 360° orbit, zoom, pan, and auto-rotation.
- **Animation Suite**: Real-time switching between all 6 animations, playback scrubber, and speed controls (0.1x ultra-slow motion to 2.0x).
- **Camera Angles**: Hero 3/4, Dorsal (Top), Macro Claws, Lateral Profile, and Stinger Aculeus Close-up.
- **Lighting Presets**: Studio PBR, Desert Sunset, Bioluminescent UV Blacklight, and Wireframe inspection.
- **3D Anatomical Markers**: Clickable screen-space tracking pins displaying scientific descriptions for every organ.
- **One-Click Export**: Instant download buttons for `.glb`, `.obj`, and 4K screenshot renders.

### Scientific References:
- Bowerman, R. F. (1975, 1981). *The control of walking in the scorpion: I. Leg coordination during forward walking*. Journal of Comparative Physiology.
- Coelho, P. et al. (2017). *A ‘striking’ relationship: scorpion defensive behaviour and its relation to morphology and performance*. Functional Ecology / British Ecological Society.
- Spagna, J. C. & Peattie, A. M. (2012). *Terrestrial locomotion in arachnids*. Journal of Insect Physiology.
