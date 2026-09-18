# GPU multi-agent weathering on the Frontier SDF

## Research basis and scope

The primary reference is **Marc Hartley, Nicolas Mellado, Christophe Fiorio and Noura Faraj, “Flexible terrain erosion,” The Visual Computer (2024)**, DOI `10.1007/s00371-024-03444-w`. It separates alteration, transport and deposition, uses independent particles, and explicitly supports SDF/voxel terrain. Sections 3.2–3.3 discuss shear stress, settling and motion; sections 4.3–4.4 discuss implicit and voxel alteration. [2](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf)

Frontier is a **research-informed adaptation**, not a reproduction of that paper's experiments or a calibrated geological model. The normalized voxel brush adapts the discrete alteration approach; the hybrid distance/occupancy representation and feedback ledger are Frontier implementation choices. River guidance, wind, fragmentation and chemical coefficients below are deliberately simplified extensions, not claimed as equations or validation from the reference.

## Controls and agents

Select **Erosion → Rain / Runoff / River / Wind / Rockfall / Chemical**, then Run. There is one selected emitter, but existing loaded agents can coexist with newly selected types.

| Agent    | Birth and motion                                                                                          | Alteration                                                              | Default incoming diameter |
| -------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------- |
| Rain     | Distributed first surface contacts from above; gravity and runoff                                         | Thresholded shear detachment                                            | 3 mm                      |
| Runoff   | Concentrated source around X/Z = −10/−7                                                                   | Thresholded shear detachment                                            | 5 mm                      |
| River    | First batch distributed along the low channel; replenishment upstream                                     | Current-driven bed/bank shear                                           | 10 mm                     |
| Wind     | Upwind boundary, configurable height/spread/direction; aerodynamic relaxation and size-dependent settling | Speed/contact-impact abrasion                                           | 0.12 mm                   |
| Rockfall | Above terrain contact; downward impact, gravity and captured restitution                                  | Incoming mass/normal-impact-energy proxy                                | 70 mm                     |
| Chemical | Wet contact parcels from above; follows runoff/current                                                    | Reaction- and saturation-limited dissolution, **not a shear threshold** | 2 mm                      |

Incoming diameter, voxel brush radius and restitution are saved **at birth**. Each emitter remembers its size/radius/bounce UI settings. Changing emitter does not relabel loaded particles or teleport their cargo. Clean agents (less than `0.0001 m³` carried) can respawn under the new emitter; any tiny residual is explicitly retired in the ledger. Loaded agents retain their original type until exit/expiration. Lowering the pool size suspends both kinematics and composition of extra slots, retaining their load.

Emitter intensity controls births for every mode. Zero intensity stops births, not existing trajectories. Field, strength, hardness, capacity and deposition controls apply on the next step. Regenerating terrain resets all particles, material layers and the audit baseline.

### A guided river, not a pressure solve

The current uses the initial canyon's centerline:

```text
center(z) = meander × (2.5 sin(0.15 z) + sin(0.36 z + 1)) + X-offset
```

The tangent follows increasing Z. A soft lateral correction keeps carriers near the channel; width, current speed and X-offset are adjustable. Its vertical influence fades above the configured water level. New river agents start in the water/bed band, controlled by source depth, and project out of solid using the **current SDF normal**. They do not fall from the sky. Collision projection removes inward velocity and allows sliding along the bed and banks. Source depth locates births; it is not an imposed final channel depth.

**Wet cargo from any agent enters this current.** Coarse-rich parcels respond less strongly and have greater effective downward force; finer material follows the stream more readily. Coarse → sand/fines attrition changes the load composition without creating or destroying its total. The River transport switch disables this guided field, independently of emitter selection. The Water tab's surface toggle only hides the water rendering; water level remains the physical transport level.

This is an **analytic, artist-guided velocity field with SDF collisions**, not CFD, incompressibility, a flow network discovered from terrain, or a free-surface solve. It matches the default canyon; adjust width/offset for other formations or sculpted paths. It cannot discover a completely different river route automatically.

### Wind, rocks and chemistry

Wind births are on an upwind boundary, not on top of the terrain. The air field relaxes horizontal velocity toward the selected wind, with gusts and a vertical return toward the altitude band. Incoming diameter changes aerodynamic settling and abrasive response. This is a controllable height band, not resolved boundary-layer turbulence. Dry wind and rock contacts do **not** paint hydraulic wetness into the terrain.

Rock impact uses `mass = 2650 × π/6 × diameter³` and `energy = 0.5 × mass × normalImpactSpeed²`, with an artistic response exponent/strength. SDF collision radii have a voxel-scale minimum; these are not resolved rigid-body boulders. Emitted rocks are impact agents: their external projectile mass is not added to the terrain budget. **Detached terrain** becomes coarse chips, sand and fines; statistical attrition converts the chips into smaller fractions. No individual rock mesh is fractured.

Chemical demand is proportional to reaction rate, remaining solution capacity, water amount and affected volume, divided by a hardness term. A zero reaction rate produces no chemical detachment. Accepted removal becomes dissolved load, including any loose material dissolved at that contact. Dissolved load moves with the carrier but is excluded from ordinary sediment deposition. There is no pH, mineral-specific kinetics, reactive diffusion, precipitation or mineral selectivity. Incoming chemical droplet diameter is a birth/visual parcel attribute, not a chemical grain or an independent reaction-rate coefficient.

## What runs on the GPU

**WebGL2 only. No `navigator.gpu` access.** Fragment shaders, floating-point multiple render targets (MRT) and instanced scatter draws perform simulation. Initial procedural generation runs in a worker. The legacy CPU `simulateVolume` is not called by the active erosion path.

A simulation step contains no CPU particle/volume readback or volume upload. JavaScript submits passes and fences. Readback is limited to startup rendering checks, explicit brush picks, export and on-demand audits.

### Persistent state

- Bounded `112 × 72 × 112` XYZ volume packed into `1792 × 504` atlas textures. Tiles are **Z slices, not elevations**. Caves and undercuts remain volumetric.
- Ping-pong terrain RGBA32F: **distance / wetness / cumulative deposited voxel volume / solid fraction**.
- Per-agent ping-pong position/age, velocity/water, and birth metadata: **type / footprint / incoming diameter / restitution**.
- Per-agent ledger: **carried / cumulative detached / cumulative deposited / retired**.
- Per-agent composition: **sand / fines / coarse / dissolved**, in the same occupancy-volume units as cargo.
- A separate ping-pong material atlas stores deposited composition. This is a subset of terrain occupancy, **not additional solid**. Previously deposited grains can be removed again with their stored composition.
- Contact/exchange and impact/birth-flag targets, request and species-request accumulation atlases, and a per-voxel acceptance atlas.
- Up to 2,048 agents, default 1,024. All stored cargo, including suspended slots, is included in audits.

`EXT_color_buffer_float` is required; without it erosion is explicitly disabled, never silently transferred to the CPU. Viewing and manual sculpt fallback remain available. Float32 scatter blending is used with `EXT_float_blend`; otherwise accumulation uses float16, with lower numerical precision. Persistent state is float32. The extensions use at most four simultaneous draw buffers. Material layers add roughly **41 MiB** of GPU atlas storage on the float32 path.

### One step: 0.04 seconds of agent kinematics

1. **Motion, four outputs:** integrate four substeps of the appropriate forces, SDF collisions and restitution. Emit position, velocity, birth metadata, and impact/current/birth flags. Speed is capped at 12 m/s to keep contact sampling bounded.
2. **Contact, two outputs:** project near-surface agents to the zero surface. Propose the type-specific detachment and particulate deposition demands; normalize compact brush weights over a local 9³ neighborhood.
3. **Scatter, two outputs:** instanced quads draw nine affected Z slices for each agent, additively accumulating erosion/deposition and the requested deposit composition. Dry agents do not add water wetness.
4. **Acceptance, three outputs:** clamp against available solid and empty occupancy; update terrain, acceptance ratios and the actual deposited-material atlas. Erosion removes existing loose material proportionally to its share of local solid; deposition adds only the accepted species request.
5. **Cargo feedback, two outputs:** gather the exact old-volume kernel and acceptance ratios. Add only accepted erosion, subtract only accepted deposition. Re-eroded loose material retains its composition; newly detached bedrock gets the agent-specific product mixture. Perform mass-preserving statistical attrition, then write cargo and composition.
6. **Distance repair:** partial occupancy anchors the interface, and local Eikonal-style propagation restores useful distance magnitudes in full/empty cells. It does not change occupancy or material composition.

An explicit birth flag avoids treating a suspended age-zero particle as a repeated respawn. Manual CSG sculpting updates occupancy and removes the proportional loose inventory when carving; added solid is fresh bedrock. Manual edits invalidate only the world erosion-only baseline, not the particle ledger.

## Detachment, settling and discrete accounting

For water agents, the mechanical basis remains:

```text
stress       = sqrt(speed / max(0.12, footprint/2))
critical     = 0.15 + 1.55 hardness + 0.55 strata × bedding(y)
affected     = 2 π footprint³ / 3
water demand = strength × max(stress − critical, 0) × affected × 0.22 × dt × sizeFactor
capacity     = (0.02 + 0.3 capacityControl) × water × (0.15 + 0.35 speed)
```

Loose deposits reduce mechanical resistance. Water diameter modulates the demand. Wind uses its own size/abrasion term; rocks use impact energy; chemistry uses reaction/saturation without mechanical shear. All demands are capped by capacity and local supply. The paper informs the shear exponent and contact/transport decomposition, **not these accelerated coefficients**. [2](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf)

Fine-sediment settling uses a Stokes-law water estimate, grain density `2650 kg/m³`, water density `1000 kg/m³`, viscosity `0.001 Pa s`, UI sediment diameter `0.03–0.25 mm`, and a fifth-power hindered-settling approximation. This is inspired by the reference's settling approach but is not an exact transcription of its concentration formula. [2](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf)

Deposition also responds to surplus capacity and coarse settling. Relative deposit weights are sand `0.4`, fines `0.07`, coarse `1`, dissolved `0`; demand is capped so no constituent is overdrawn. “Slush” here means **wet suspended fines/muddy sediment**, not frozen water or a rheologically solved non-Newtonian mixture.

The `0.45–1.15 m` brush radius is **not** the incoming diameter or settling diameter. One marker represents a parcel, and the volume has roughly 0.36–0.39 m cells. Millimetre grains and thin layers are not geometrically resolved.

For solid fraction `a`, voxel volume `V`, and normalized accumulated demands `E` and `D`:

```text
acceptedE = min(E, a V)
acceptedD = min(D, (1 − a) V + acceptedE)
a'        = a + (acceptedD − acceptedE) / V
```

The same per-voxel acceptance ratios return to each requesting particle. Within floating-point precision:

```text
cumulative detached = carried + cumulative deposited + retired
carried = sand + fines + coarse + dissolved
initial solid = current solid + carried + retired     [until manual sculpting]
```

This measures **voxel occupancy volume**, not exact geometric volume of the interpolated zero surface or calibrated physical mass. Local distance repair can shift the sub-voxel zero surface without changing occupancy. Float16 accumulation can incur larger residuals and composition rounding than float32.

Retirement includes boundary exit, near-empty water, source changes for essentially clean slots, and artificial age limits: 30 s river, 45 s rockfall, 20 s other agents. It is recorded explicitly but is **not all material physically reaching an outlet**. Eliminating these lifetime sinks requires a more elaborate transport/domain treatment.

## Seeing and auditing it

- Clean water: blue. Airborne sand: pale amber. Rocks/chips: gray-brown. Chemical/dissolved carriers: violet.
- Loaded markers blend toward their **actual** sand/fines/coarse/dissolved composition. Green tint indicates proposed deposition, not a guarantee of accepted deposition.
- Marker diameter is exaggerated for visibility and depends on incoming size. It is not a resolved particle mesh.
- **Show sediment plumes** adds translucent, cargo-driven wet particulate sprites at the same transported positions. Hiding agent markers does not hide the plumes or stop simulation; the plume switch is independent.
- Deposited terrain coloring samples the material atlas rather than adding unrelated decorative sand.
- **Audit sediment balance** pauses, waits for in-flight work, and reads the GPU state. It reports carried constituent totals, detached/deposited/retired volume and ledger/world residuals. The diagnostic API additionally reports composition error and per-type mean altitude, downstream velocity and incoming size.

## Export and limits

`.frontier` remains volume format version 2; its model identifier is `webgl2-multi-agent-transport-v2`. It saves the current terrain, settings and camera. **Particle trajectories, carried species and the separate loose-material atlas are omitted**, explicitly flagged with `particleStateIncluded: false` and `materialLayersIncluded: false`. It is not a resumable simulation checkpoint. The volume's deposited channel is cumulative history, not a complete current composition inventory.

There is no SPH/FLIP/pressure solve, grain-grain collision system, DEM, resolved fragmentation, two-way water-surface coupling, mineral-calibrated chemistry, or geological time scale. The material balance tests are implementation checks, not experimental validation. Browser tests exercise real WebGL2 river transport and low-level cutting, dry wind abrasion/altitude, size-sensitive rock impacts, chemical dissolution, deposited inventory bounds, suspended-slot preservation, and no per-step CPU transfer. Software GPU test times are not native-hardware performance measurements.

A next accuracy stage would couple the exchange passes to a validated velocity field, eliminate artificial retirement, check convergence across grid resolutions, and calibrate alteration against measured experiments.

## Artist-guided fractures

The separate [Cracks tool](fracture-tools.md) performs painted 3D Voronoi fracture through GPU CSG subtraction and click-to-remove connected pieces, not simulated fracture mechanics. Chunk selection explicitly reads back the current GPU volume for worker-side connectivity. This is an on-demand artist operation, not part of an erosion step. Baked cuts invalidate the erosion-only world baseline but preserve particle ledgers. Visual hairlines are nonphysical and are exported as `settings.cellFractureDetail` (with older plane descriptors in `settings.fractureDetails`); pending paint is not exported.

## Water rendering and canyon dimensions

The [water/canyon controls](water-and-canyon.md) add nominal wall spacing, centerline meander and vertical flare to the procedural SDF. The river guide shares the centerline parameter. Displaced visual waves, SDF optical rays and procedural foam animate separately from erosion; agent motion still uses the mean water level. Canyon formation controls regenerate terrain and reset edits rather than stretching already sculpted material.

### Custom land and flow routes

The left outliner can now create cut and water splines. Custom water paths replace the legacy canyon current with sampled route tangents, per-path width/speed and route inlet emission; the initial batch fills the routes. Hidden routes disable new river births when no other route is active. Existing agents retain their inventories and retire normally. All routes still share the mean water plane. This is an artistic velocity field, not a pressure/free-surface hydraulic solution. Erosion bakes live cut modifiers before altering the volume. See [land and spline behavior, GPU representation and limitations](land-and-splines.md).
