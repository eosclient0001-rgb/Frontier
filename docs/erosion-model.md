# GPU multi-agent weathering on the Frontier SDF

**Rain-model correction:** rain-origin parcels now use actual m³ supply and a separate substrate/shear closure; earlier representative-area hydraulic equations below remain relevant to the other emitters, not current rain. See [current research and proofs](rain-realism-diagnosis.md).


## Research basis and scope

The primary reference is **Marc Hartley, Nicolas Mellado, Christophe Fiorio and Noura Faraj, “Flexible terrain erosion,” The Visual Computer (2024)**, DOI `10.1007/s00371-024-03444-w`. It separates alteration, transport and deposition, uses independent particles, and explicitly supports SDF/voxel terrain. Sections 3.2–3.3 discuss shear stress, settling and motion; sections 4.3–4.4 discuss implicit and voxel alteration. [2](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf)

Frontier is a **research-informed adaptation**, not a reproduction of that paper's experiments or a calibrated geological model. The normalized voxel brush adapts the discrete alteration approach; the hybrid distance/occupancy representation and feedback ledger are Frontier implementation choices. River guidance, wind, fragmentation and chemical coefficients below are deliberately simplified extensions, not claimed as equations or validation from the reference.

## Controls and agents

Select **Erosion → Rain / Runoff / River / Wind / Rockfall / Chemical**, then Run. There is one selected emitter, but existing loaded agents can coexist with newly selected types.

| Agent    | Birth and motion                                                                                          | Alteration                                                              | Default incoming diameter |
| -------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------- |
| Rain     | Staggered airborne drops; gravity, first landing and inelastic runoff                                         | Thresholded shear detachment                                            | 3 mm                      |
| Runoff   | Concentrated, domain-scaled source around the terrain centre                                                                   | Thresholded shear detachment                                            | 5 mm                      |
| River    | Every generation enters the inlet of a visible XYZ water route                                            | Current-driven bed/bank shear                                           | 10 mm                     |
| Wind     | Upwind boundary, configurable height/spread/direction; aerodynamic relaxation and size-dependent settling | Speed/contact-impact abrasion                                           | 0.12 mm                   |
| Rockfall | Above terrain contact; downward impact, gravity and captured restitution                                  | Incoming mass/normal-impact-energy proxy                                | 70 mm                     |
| Chemical | Wet contact parcels from above; follows runoff/current                                                    | Reaction- and saturation-limited dissolution, **not a shear threshold** | 2 mm                      |

Incoming diameter, voxel brush radius and restitution are saved **at birth**. Each emitter remembers its size/radius/bounce UI settings. Changing emitter does not relabel loaded particles or teleport their cargo. Existing agents retain their original type until exit/expiration; selecting another emitter only affects subsequent births. Retirement and respawn occur on separate simulation ticks. Lowering the pool size suspends both kinematics and composition of extra slots, retaining their load.

Emitter intensity controls births for every mode. Zero intensity stops births, not existing trajectories. Field, strength, hardness, capacity and deposition controls apply on the next step. Regenerating terrain resets all particles, material layers and the audit baseline.

### A guided river, not a pressure solve

The current is now driven exclusively by visible water splines. **Water → Draw river route** places an editable route shared by erosion and rendered water. No route means no river births or hidden preset water. The fixed canyon route helper has been removed.

All generations enter route point 1, not random positions along an invisible channel. A soft lateral correction follows the route tangent; its speed, width and interpolated elevation are shared with rendering. Births are placed in the local water/bed band, projected using the current SDF normal and rejected if they remain buried or leave the route. Source depth is a birth-band parameter, not an imposed channel cut.

Wet cargo can enter this current. Coarse-rich parcels respond less strongly and have greater effective downward force; finer material follows the stream more readily. Attrition changes composition without creating material. Current influence is local to the route, not everything below one global water plane. River transport enables guidance; Water visibility only enables rendering. This is an artist-guided velocity field, not CFD or pressure-projected routing. See [shared route elevations and limits](satmaps-and-routes.md).

### Wind, rocks and chemistry

Wind births are on an upwind boundary, not on top of the terrain. The air field relaxes horizontal velocity toward the selected wind, with gusts and a vertical return toward the altitude band. Incoming diameter changes aerodynamic settling and abrasive response. This is a controllable height band, not resolved boundary-layer turbulence. Dry wind and rock contacts do **not** paint hydraulic wetness into the terrain.

Rock impact uses `mass = 2650 × π/6 × diameter³` and `energy = 0.5 × mass × normalImpactSpeed²`, with an artistic response exponent/strength. SDF collision radii have a voxel-scale minimum; these are not resolved rigid-body boulders. Emitted rocks are impact agents: their external projectile mass is not added to the terrain budget. **Detached terrain** becomes coarse chips, sand and fines; statistical attrition converts the chips into smaller fractions. No individual rock mesh is fractured.

Chemical demand is proportional to reaction rate, remaining solution capacity, water amount and affected volume, divided by a hardness term. A zero reaction rate produces no chemical detachment. Accepted removal becomes dissolved load, including any loose material dissolved at that contact. Dissolved load moves with the carrier but is excluded from ordinary sediment deposition. There is no pH, mineral-specific kinetics, reactive diffusion, precipitation or mineral selectivity. Incoming chemical droplet diameter is a birth/visual parcel attribute, not a chemical grain or an independent reaction-rate coefficient.

## What runs on the GPU

**WebGL2 only. No `navigator.gpu` access.** Fragment shaders, floating-point multiple render targets (MRT) and instanced scatter draws perform simulation. Initial procedural generation runs in a worker. The legacy CPU `simulateVolume` is not called by the active erosion path.

A simulation step contains no CPU particle/volume readback or volume upload. JavaScript submits passes and fences. Readback is limited to startup rendering checks, explicit brush picks, export and on-demand audits.

### Persistent state

- Bounded `128 × 80 × 128` XYZ volume packed into `2048 × 640` atlas textures. Tiles are **Z slices, not elevations**. Caves and undercuts remain volumetric.
- Ping-pong terrain RGBA32F: **distance / wetness / cumulative deposited voxel volume / solid fraction**.
- Per-agent ping-pong position/age, velocity/water, and birth metadata: **type / footprint / incoming diameter / restitution**.
- Per-agent ping-pong lifecycle RGBA32F: **remaining active ticks / stalled ticks / phase / settling ticks**. Two 64 × 256 textures add 512 KiB; limits are captured on birth.
- Per-agent ledger: **carried / cumulative detached / cumulative deposited / retired**.
- Per-agent composition: **sand / fines / coarse / dissolved**, in the same occupancy-volume units as cargo.
- A separate ping-pong material atlas stores deposited composition. This is a subset of terrain occupancy, **not additional solid**. Previously deposited grains can be removed again with their stored composition.
- Contact/exchange and impact/birth-flag targets, request and species-request accumulation atlases, and a per-voxel acceptance atlas.
- Up to 16,384 agents; the studio selects 4,096 by default. All stored cargo, including suspended slots, is included in audits.

`EXT_color_buffer_float` is required; without it erosion is explicitly disabled, never silently transferred to the CPU. Viewing and manual sculpt fallback remain available. Float32 scatter blending is used with `EXT_float_blend`; otherwise accumulation uses float16, with lower numerical precision. Persistent state is float32. The extensions use at most four simultaneous draw buffers. Each full RGBA32F atlas is **20 MiB** at the current grid dimensions. Multiple resident material/history/scratch atlases contribute to GPU memory use. There are no inactive patches or separate overview.

### One step: 0.04 seconds of agent kinematics

1. **Motion, four outputs:** integrate four substeps of the appropriate forces, SDF collisions and restitution. Emit position, velocity, birth metadata, and impact/current/birth flags. Speed is capped at 12 m/s to keep contact sampling bounded.
2. **Lifecycle, one output:** decrement the birth-time active budget and count stationary contact. Stalled, dry or expired agents transition to a bounded deposit-only phase.
3. **Contact, two outputs:** project near-surface agents to the zero surface. Propose the type-specific detachment and particulate deposition demands; normalize compact brush weights over a local 9³ neighborhood.
4. **Scatter, two outputs:** instanced quads draw nine affected Z slices for each agent, additively accumulating erosion/deposition and the requested deposit composition. Dry agents do not add water wetness.
5. **Acceptance, three outputs:** clamp against available solid and empty occupancy; update terrain, acceptance ratios and the actual deposited-material atlas. Erosion removes existing loose material proportionally to its share of local solid; deposition adds only the accepted species request.
6. **Cargo feedback, two outputs:** gather the exact old-volume kernel and acceptance ratios. Add only accepted erosion, subtract only accepted deposition. Re-eroded loose material retains its composition; newly detached bedrock gets the agent-specific product mixture. Perform mass-preserving statistical attrition, then write cargo and composition.
7. **Distance repair:** partial occupancy anchors the interface, and local Eikonal-style propagation restores useful distance magnitudes in full/empty cells. It does not change occupancy or material composition.

An explicit birth flag avoids treating a suspended age-zero particle as a repeated respawn. Manual CSG sculpting updates occupancy and removes the proportional loose inventory when carving; added solid is fresh bedrock. Manual edits invalidate only the world erosion-only baseline, not the particle ledger.

## Detachment, settling and discrete accounting

Rain, runoff and river now use an **SI-unit, capacity-limited relaxation closure**, implemented in `src/hydraulic-transport.js` and evaluated on the GPU. The former cubic-brush demand greatly magnified cutting and has been removed from hydraulic exchange. Brush radius distributes a request; it no longer supplies a `radius³` hydraulic-rate multiplier.

For frozen local flow/material coefficients:

```text
u = min(tangential velocity, actual tangential travel / dt)
A = nominal catchment area / pool size × preview scale    [m² per sample]
h = representative film depth                           [m]
Vw = A h waterFraction                                  [m³]
τ = 0.5 ρw Cd u²                                        [Pa]
τc = (0.25 + 12 hardness²)(1 + 0.5 bedding)(1 − 0.95 loose)
     + 0.045 (ρs − ρw) g grainDiameter                   [Pa]
excess = max(τ − τc, 0)
C = 0.15 capacityControl Vw excess / (τ + τc)             [m³ solid]
E0 = strength k excess A waterFraction                   [m³/s]
a = E0 / C (zero when C is zero)                         [1/s]
b = depositionControl settlingVelocity / h              [1/s]
dL/dt = a(C − L) − b L
L* = aC / (a + b)
ΔL = (L* − L) (1 − exp(−(a + b) dt))
```

Positive ΔL requests detachment; negative ΔL requests deposition. This has an **exact exponential solution for frozen coefficients**, approaches equilibrium without overshooting, and does not let microscopic settling veto all erosion. It is not a timestep-invariance claim for changing trajectories, changing terrain, collision correction, composition limits or acceptance caps. Zero shear cannot detach; active non-chemical liquid agents below 0.12 m/s actual surface travel cannot detach except for the one-time energy-limited rain landing; settling agents never detach.

Defaults in **Erosion → Hydraulic material & rate**:

| Control                       |         Default | Meaning                                                                                                                                                      |
| ----------------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Representative water film     |           20 mm | Assumed rain/runoff film, not a solved water depth. River uses at least this depth and otherwise the local interpolated route elevation minus bed elevation. |
| Skin-friction coefficient     |           0.010 | Dimensionless drag coefficient in the stated stress convention.                                                                                              |
| Erodibility                   | 0.020 mm/(Pa·s) | Assumed weathered-surface coefficient, also multiplied by the existing strength control.                                                                     |
| Exchange preview scale        |             10× | Multiplies representative area and corresponding water/material volume, **not** particle clocks or simulated geological time. 1× removes this acceleration.  |
| Surface-change safety ceiling |         5 mm/s | Aggregate occupancy-equivalent distance-change ceiling, applied after overlapping requests are summed, to all agent types.                                   |

Nominal contributing area follows the applied whole-terrain emitter footprint, with a small boundary inset. It is no longer capped by the former 22 × 22 m local emitter. Pool normalization makes the ideal uniform-contact exchange budget independent of sample count; actual coverage, active contacts, changing pool size and clipping can still change the result. This is representative-parcel quadrature, **not measured rainfall/discharge or a conserved water-flow solve**. Preview scale is a separate explicit approximation rather than hidden inside material hardness or lifespan.

The cohesion map (0.25–12.25 Pa before bedding/loose factors), Shields-like coefficient 0.045, maximum concentration factor 0.15 and erodibility are **assumed closures**, not calibrated intact-rock properties. More resistant material lowers detachment. Intact rock under normal rain would weather far more slowly than this preview; measured thresholds, material erodibility and a validated flow field are required for predictive use.

Hydraulic grain settling uses the Ferguson–Church dimensional form with `R = 1.65`, `ν = 10⁻⁶ m²/s`, `C1 = 18`, `C2 = 1`:

```text
w = R g d² / (18 ν + sqrt(0.75 R g d³))
```

This approaches Stokes settling for small grains without extending that low-Reynolds-number law unchecked to larger grains. The coefficients assume natural mineral grains, not measured local grain shape. Reference: Ferguson & Church (2004), _A Simple Universal Equation for Grain Settling Velocity_, J. Sedimentary Research 74(6), 933–937, DOI [10.1306/051204740933](https://doi.org/10.1306/051204740933). Nonwater agents retain their simplified legacy settling/abrasion/reaction models; this change does not make those calibrated physics.

The first rain contact alone can add a splash request, bounded by 1% × strength of representative impact kinetic energy divided by assumed detachment work `10⁵ (1 + 9 hardness) J/m³`, and by the concentration ceiling. Subsequent contact impulses cannot repeat this excavation term. This is an energy bound, **not resolved splash hydrodynamics**. Liquid contact stays inelastic.

Legacy nonwater deposition also responds to surplus capacity and coarse settling. During transport, relative deposit weights are sand `0.4`, fines `0.07`, coarse `1`, dissolved `0`; demand is capped so no constituent is overdrawn. “Slush” here means **wet suspended fines/muddy sediment**, not frozen water or a rheologically solved non-Newtonian mixture.

The resolution-aware brush support is **not** the incoming diameter or settling diameter. One marker represents a parcel. The full-domain cells are metre-scale; the normalized kernel covers at least 0.95 cell along each axis and at most 3.8 cells. Millimetre grains and thin layers are not geometrically resolved.

For solid fraction `a`, voxel volume `V`, and normalized accumulated demands `E` and `D`:

```text
occupancyBudget = min(surfaceCeiling × dt, 0.2 × minCell) / (2 × BAND)
budget = occupancyBudget × V
acceptedE = min(E, a V, budget)
acceptedD = min(D, (1 − a) V + acceptedE, budget)
a'        = a + (acceptedD − acceptedE) / V
```

Requests also retain a per-carrier local supply cap; constituent limits prevent overdrawing any species. The aggregate cap above is shared by overlapping carriers, not granted independently to every carrier. It bounds occupancy-equivalent distance change; distance reconstruction can still move the interpolated zero surface differently.

The same per-voxel acceptance ratios return to each requesting particle. Within floating-point precision:

```text
cumulative detached = carried + cumulative deposited + retired
carried = sand + fines + coarse + dissolved
initial solid = current solid + carried + retired     [until manual sculpting]
```

This measures **voxel occupancy volume**, not exact geometric volume of the interpolated zero surface or calibrated physical mass. Local distance repair can shift the sub-voxel zero surface without changing occupancy. Float16 accumulation can incur larger residuals and composition rounding than float32.

Retirement includes boundary exits, bounded physical settling and explicit unresolved/outflow at a moving runoff travel timeout. Rain's airborne budget is 8 s by default; first landing captures a separate 600 s runoff budget with slower evaporation. Runoff/river emitters also capture that travel budget. Stagnation defaults to 8 s, followed by at most 1 s of non-eroding settlement. A numerical timeout must not create an artificial sediment pocket. See [runoff transport](runoff-transport.md).

## Seeing and auditing it

- Clean water: blue. Airborne sand: pale amber. Rocks/chips: gray-brown. Chemical/dissolved carriers: violet.
- Loaded markers blend toward their **actual** sand/fines/coarse/dissolved composition. Green tint indicates proposed deposition, not a guarantee of accepted deposition.
- Marker diameter is exaggerated for visibility and depends on incoming size. It is not a resolved particle mesh.
- **Show sediment plumes** adds translucent, cargo-driven wet particulate sprites at the same transported positions. Hiding agent markers does not hide the plumes or stop simulation; the plume switch is independent.
- Deposited terrain coloring samples the material atlas rather than adding unrelated decorative sand.
- **Audit sediment balance** pauses, waits for in-flight work, and reads the GPU state. It reports carried constituent totals, detached/deposited/retired volume and ledger/world residuals. The diagnostic API also reports settling count and oldest active age, in addition to composition error and per-type mean altitude, downstream velocity and incoming size.

## Export and limits

`.frontier` remains volume format version 2; its model identifier is `webgl2-multi-agent-transport-v2`. It saves the current terrain, settings and camera, plus `particleLifecycleModel: "bounded-transport-settle-v1"` and `hydraulicExchangeModel: "si-capacity-relaxation-v1"`. Hydraulic settings retain their displayed units. **Particle trajectories, carried species and the separate loose-material atlas are omitted**, explicitly flagged with `particleStateIncluded: false` and `materialLayersIncluded: false`. It is not a resumable simulation checkpoint. The volume's deposited channel is cumulative history, not a complete current composition inventory.

There is no SPH/FLIP/pressure solve, grain-grain collision system, DEM, resolved fragmentation, two-way water-surface coupling, mineral-calibrated chemistry, or geological time scale. The material balance tests are implementation checks, not experimental validation. Browser tests exercise real WebGL2 river transport and low-level cutting, dry wind abrasion/altitude, size-sensitive rock impacts, chemical dissolution, deposited inventory bounds, suspended-slot preservation, and no per-step CPU transfer. Software GPU test times are not native-hardware performance measurements.

A next accuracy stage would couple the exchange passes to a validated velocity field, eliminate artificial retirement, check convergence across grid resolutions, and calibrate alteration against measured experiments.

## Artist-guided fractures

The separate [Cracks tool](fracture-tools.md) performs painted 3D Voronoi fracture through GPU CSG subtraction and click-to-remove connected pieces, not simulated fracture mechanics. Chunk selection explicitly reads back the current GPU volume for worker-side connectivity. This is an on-demand artist operation, not part of an erosion step. Baked cuts invalidate the erosion-only world baseline but preserve particle ledgers. Visual hairlines are nonphysical and are exported as `settings.cellFractureDetail` (with older plane descriptors in `settings.fractureDetails`); pending paint is not exported.

## Water rendering and whole-terrain coordinates

[Water](water.md) follows explicit XYZ route elevations and uses displaced visual waves, SDF optical rays and procedural foam. The [kilometre workspace](kilometre-workspaces.md) uses one whole-terrain SDF. Agent motion and all routes use its global XYZ coordinates, not a small patch or visual wave crests.


### Surface-runoff suspension revision

Hydraulic settling now uses a Rouse-inspired suppression factor `1 / (1 + (0.4 sqrt(tau/1000) / ws)^2)` multiplying the grain fall speed. Fast sheared flow retains fines; still water recovers full settling. This is an assumed interpolation, not a resolved turbulence model. The former equations/validation records without this factor describe the earlier closure. Current export identification is `si-suspension-relaxation-v2`.
