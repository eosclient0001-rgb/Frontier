/*============================================================================================================================================
                                                        FORCEFIELDCORE.JS
============================================================================================================================================*/
// Pure ESM 19-Law ForceField physics kernel, RK2 flow particle advection engine, RK4 streamline tracer,
// 3D heatmap/envelope geometry builders, 3D Transform Gizmo math, Scene Presets, and .ForceModel/.VectorFieldSpace TOML codecs.
// Coordinate convention: Frontier Right-Handed +Z Up (+X Forward, +Y Left, +Z Up).

import { CompileFieldProgram, FORMULA_PRESETS, DEFAULT_FORMULA_CODE } from "./VectorFieldLang.js";

export { FORMULA_PRESETS, DEFAULT_FORMULA_CODE };

const DEG_TO_RAD = Math.PI / 180.0;
const TWO_PI = Math.PI * 2.0;

export const ForceDomains = Object.freeze({
  VectorField: {
    Id: "VectorField",
    Label: "VectorField",
    Subtitle: "Analytical directional, radial, orbital & electromagnetic force laws",
    Color: "#4AA8FF",
  },
  FlowField: {
    Id: "FlowField",
    Label: "FlowField",
    Subtitle: "Advected slipstreams, spline corridors & boundary-layer currents",
    Color: "#3AD69C",
  },
  TurbulenceField: {
    Id: "TurbulenceField",
    Label: "TurbulenceField",
    Subtitle: "Divergence-free 3D curl noise, atmospheric gusts & vorticity",
    Color: "#E6A23C",
  },
});

export const ReachEnvelopes = ["Sphere", "Column", "Box", "Infinite"];
export const AttenuationCurves = ["SmoothStep", "Linear", "InverseSquare", "Constant"];
export const DurationModes = ["Continuous", "Modulated", "Impulse"];
export const MotionTopologies = ["Static", "LinearAB", "SplineCurve", "CircularOrbit", "Figure8"];
export const MotionLoopModes = ["PingPong", "Loop", "Once"];
export const EvaluatedQuantities = ["Speed", "Acceleration", "Curl", "Divergence", "Pressure"];
export const FieldColormaps = ["Engineering", "Turbo", "Plasma", "Viridis", "Diverging", "Beaufort"];
export const StreamColorModes = ["FieldPalette", "CyanSingle", "CustomSingle", "Elevation"];
export const ParticleSeedModes = ["ForceVolumes", "WindTunnel", "UniformLattice", "RingSource"];

export const STREAM_COLOR_PRESETS = Object.freeze([
  { Color: "#68dcff", Label: "Classic Cyan" },
  { Color: "#84c7ff", Label: "Ice Blue" },
  { Color: "#54e6a4", Label: "Emerald" },
  { Color: "#ffc857", Label: "Amber Gold" },
  { Color: "#ff7461", Label: "Coral Glow" },
]);

export const COLORMAP_CSS_GRADIENTS = Object.freeze({
  Engineering: "linear-gradient(90deg, #102a56 0%, #1c7ed6 24%, #22b8cf 46%, #82c91e 66%, #fab005 84%, #f03e3e 100%)",
  Beaufort: "linear-gradient(90deg, #102a56 0%, #1c7ed6 24%, #22b8cf 46%, #82c91e 66%, #fab005 84%, #f03e3e 100%)",
  Turbo: "linear-gradient(90deg, #30123b 0%, #4685fa 25%, #1ae4b6 50%, #faba39 76%, #7a0403 100%)",
  Plasma: "linear-gradient(90deg, #0d0887 0%, #7e03a8 32%, #cc4778 62%, #f89540 84%, #f0f921 100%)",
  Viridis: "linear-gradient(90deg, #440154 0%, #31688e 35%, #35b779 70%, #fde725 100%)",
  Diverging: "linear-gradient(90deg, #2b6cb0 0%, #63b3ed 28%, #1e2430 50%, #fc8181 72%, #e53e3e 100%)",
  DomainTint: "linear-gradient(90deg, #1e3a5f 0%, #4aa8ff 55%, #b8e1ff 100%)",
});

export const DEFAULT_FLOW_VIZ = Object.freeze({
  Enabled: true,
  SimPlaying: true,
  ShowHeatmap: true,
  SliceEnabled: true,
  ShowEnvelopes: true,
  ShowVelocityArrows: true,
  ShowStreamlines: true,
  ShowFlowParticles: true,
  ShowMotionPaths: true,
  ShowProbeHud: true,
  Quantity: "Speed",
  Colormap: "Engineering",
  SliceAxis: "XY", // XY = horizontal plane; XZ = front; YZ = side; ALL = tri-planar
  SliceOffset: 0.0,
  FixedMax: 24.0,
  HeatmapOpacity: 0.56,
  ArrowDensity: 4,
  VolumeLayers: 1,
  VectorScale: 0.28,
  StreamColorMode: "CyanSingle",
  StreamSingleColor: "#68dcff",
  StreamThickness: 0.85,
  StreamEmissive: 1.05,
  StreamOpacity: 0.86,
  StreamResolution: 30,
  StreamLineCount: 84,
  ParticleCount: 1600,
  ParticleSpeedScale: 0.24,
  ParticleTrailLength: 10,
  ParticleSize: 1.0,
  ParticleOpacity: 0.92,
  ParticleSeedMode: "ForceVolumes",
  ProbePosition: [0.45, 0.25, 0.85],
});

// Bespoke 16x16 SVG stroke paths for all 19 canonical ForceModel generators
export const FORCE_MODEL_SVG_PATHS = Object.freeze({
  LinearWind:
    '<path d="M2 6h8.5a2 2 0 1 0-1.9-2.6M2 10h11a1.8 1.8 0 1 1-1.6 2.5M2 13h6.5a1.5 1.5 0 1 1-1.3 2.2"/>',
  Buoyancy:
    '<path d="M8 14V3M4.8 6.2L8 3l3.2 3.2"/><circle cx="8" cy="11.5" r="1.7"/>',
  RadialBurst:
    '<circle cx="8" cy="8" r="2.2"/><circle cx="8" cy="8" r="5.5" stroke-dasharray="2.2 2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>',
  Attractor:
    '<circle cx="8" cy="8" r="1.8"/><path d="M2.5 2.5L5.8 5.8M13.5 2.5l-3.3 3.3M2.5 13.5l3.3-3.3M13.5 13.5l-3.3-3.3"/>',
  Repulsor:
    '<circle cx="8" cy="8" r="1.8"/><path d="M5.5 5.5L2.2 2.2M10.5 5.5l3.3-3.3M5.5 10.5l-3.3 3.3M10.5 10.5l3.3 3.3M2.2 4.5V2.2h2.3M13.8 4.5V2.2h-2.3"/>',
  AxisAttractor:
    '<path d="M3 13L13 3"/><path d="M4.5 5.5l2.5 2.5M11.5 10.5L9 8"/>',
  Containment:
    '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3" stroke-dasharray="1.8 1.8"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/>',
  RotationalColumn:
    '<path d="M8 8a1.2 1.2 0 1 1-1.2-1.2 2.4 2.4 0 0 1 2.4 2.4A3.8 3.8 0 0 1 4 8a5.2 5.2 0 0 1 10.2-1"/>',
  Torque:
    '<path d="M12.5 6A5 5 0 1 0 13 10"/><path d="M10 6h3V3"/>',
  Drag:
    '<path d="M3 4v8M6 4v8"/><path d="M8.5 8H14M11.5 5.5L14 8l-2.5 2.5"/>',
  CurlNoise:
    '<path d="M2 5c2-2 4 2 6 0s4-2 6 0M2 11c2-2 4 2 6 0s4-2 6 0"/><circle cx="8" cy="8" r="1.4"/>',
  AtmosphericGust:
    '<path d="M2 5.5c2.2-2.2 4.4 2.2 6.6 0M2 10.5h9.5a2 2 0 1 0-1.8-2.6M11.5 12.5l2.5-2-2.5-2"/>',
  VorticityConfinement:
    '<path d="M4.5 6.5a3.5 3.5 0 1 1 5.8 2.6"/><path d="M11.5 9.5a3.5 3.5 0 1 1-5.8-2.6"/><circle cx="8" cy="8" r="1"/>',
  BrownianNoise:
    '<path d="M2.5 12.5l2.8-5.2 2.6 2.9 2.4-6.4 3.2 4.7"/><circle cx="2.5" cy="12.5" r="0.9"/><circle cx="13.5" cy="8.5" r="0.9"/>',
  LorentzField:
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 4v8M4.8 7L8 4l3.2 3M4.5 11.2c2-1.8 5-1.8 7 0"/>',
  MagneticDipole:
    '<rect x="6" y="6.2" width="4" height="3.6" rx="0.8"/><path d="M6 7.5C2.5 4.5 2.5 11.5 6 8.5M10 7.5c3.5-3 3.5 4 0 1"/>',
  FlowStream:
    '<path d="M2 5c3.5-2 8.5 2 12 0M2 11c3.5-2 8.5 2 12 0"/><path d="M11 3.2L14 5l-2.4 2.2"/>',
  SplineForce:
    '<path d="M2.5 12.5C4.5 3.5 11.5 12.5 13.5 3.5"/><circle cx="2.5" cy="12.5" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="13.5" cy="3.5" r="1.2"/>',
  BoundaryAdhesion:
    '<path d="M2 12.5h12"/><path d="M3 9.5c2.5-3.2 7.5-3.2 10 0"/><path d="M8 3.5v4.5M6 6l2 2 2-2"/>',
});

export const FORCE_MODELS = Object.freeze([
  {
    Ordinal: 0,
    Id: "LinearWind",
    Name: "Linear Wind",
    Domain: "VectorField",
    Channel: "Flow Velocity",
    Color: "#4AA8FF",
    Unit: "m/s",
    Equation: "v(p,t) = S · (1 + σ·z) · d̂(ψ) · f(r)",
    Summary: "Directional prevailing airflow with altitude wind-shear and azimuth/pitch steering.",
    Defaults: { Strength: 11.5, Radius: 2.8, CoreRadius: 0.55, SwirlRatio: 0.12, Frequency: 0.25, Reach: "Column" },
  },
  {
    Ordinal: 1,
    Id: "Buoyancy",
    Name: "Buoyancy",
    Domain: "VectorField",
    Channel: "Acceleration",
    Color: "#52C896",
    Unit: "m/s²",
    Equation: "a_z(p) = S · ((ρ_f - ρ_b)/ρ_b) · f(r) · ẑ",
    Summary: "Archimedean +Z vertical thermal lift or downdraft column with radial entrainment.",
    Defaults: { Strength: 12.0, Radius: 2.1, CoreRadius: 0.5, SwirlRatio: 0.18, Frequency: 0.22, Reach: "Column" },
  },
  {
    Ordinal: 2,
    Id: "RadialBurst",
    Name: "Radial Burst",
    Domain: "VectorField",
    Channel: "Impulse Accel",
    Color: "#FF8A5B",
    Unit: "m/s²",
    Equation: "a(p,t) = S · g_imp(t) · f(r) · r̂",
    Summary: "Spherical outward pressure wave or triggerable shockwave shell.",
    Defaults: { Strength: 19.0, Radius: 2.3, CoreRadius: 0.4, SwirlRatio: 0.0, Frequency: 0.55, Reach: "Sphere", Duration: "Impulse", WaveSpeed: 4.5 },
  },
  {
    Ordinal: 3,
    Id: "Attractor",
    Name: "Attractor",
    Domain: "VectorField",
    Channel: "Acceleration",
    Color: "#63B3FF",
    Unit: "m/s²",
    Equation: "a(p) = -S · f(r) · r / max(r, r_core)³",
    Summary: "Soft-core centripetal gravity well pulling flow inward with optional orbital swirl.",
    Defaults: { Strength: 15.0, Radius: 2.3, CoreRadius: 0.45, SwirlRatio: 0.38, Frequency: 0.2, Reach: "Sphere", Attenuation: "InverseSquare" },
  },
  {
    Ordinal: 4,
    Id: "Repulsor",
    Name: "Repulsor",
    Domain: "VectorField",
    Channel: "Acceleration",
    Color: "#F27979",
    Unit: "m/s²",
    Equation: "a(p) = +S · f(r) · r̂",
    Summary: "Continuous radial exclusion dome deflecting streamlines and flow around obstacles.",
    Defaults: { Strength: 16.5, Radius: 1.85, CoreRadius: 0.42, SwirlRatio: 0.0, Frequency: 0.2, Reach: "Sphere" },
  },
  {
    Ordinal: 5,
    Id: "AxisAttractor",
    Name: "Axis Attractor",
    Domain: "VectorField",
    Channel: "Acceleration",
    Color: "#6EC8F5",
    Unit: "m/s²",
    Equation: "a(p) = -S · f(r_⊥) · r̂_⊥ + ω · (â × r̂_⊥)",
    Summary: "Cylindrical line-sink drawing flow radially onto the local +Z spine with swirl.",
    Defaults: { Strength: 13.5, Radius: 2.1, CoreRadius: 0.4, SwirlRatio: 0.65, Frequency: 0.25, Reach: "Column" },
  },
  {
    Ordinal: 6,
    Id: "Containment",
    Name: "Containment",
    Domain: "VectorField",
    Channel: "Restoring Accel",
    Color: "#8C9EFF",
    Unit: "m/s²",
    Equation: "a(p) = -S · max(0, (r - r_inner)/(R - r_inner))² · r̂",
    Summary: "Calm interior dead-zone surrounded by a restoring inward boundary shell.",
    Defaults: { Strength: 17.5, Radius: 2.4, CoreRadius: 1.05, SwirlRatio: 0.22, Frequency: 0.2, Reach: "Sphere" },
  },
  {
    Ordinal: 7,
    Id: "RotationalColumn",
    Name: "Vortex Column",
    Domain: "VectorField",
    Channel: "Flow + Swirl",
    Color: "#E8B85B",
    Unit: "m/s",
    Equation: "v_t = S·(2ρ)/(1+ρ²) + v_r + v_z",
    Summary: "Rankine-Burgers cyclone funnel with solid-body inner core and 1/r outer decay.",
    Defaults: { Strength: 18.0, Radius: 2.25, CoreRadius: 0.55, SwirlRatio: 1.25, Frequency: 0.3, Reach: "Column" },
  },
  {
    Ordinal: 8,
    Id: "Torque",
    Name: "Torque",
    Domain: "VectorField",
    Channel: "Angular Spin",
    Color: "#C58AF9",
    Unit: "rad/s²",
    Equation: "τ(p) = S · f(r) · (â × r̂)",
    Summary: "Pure rotational spin field imparting tangential angular flow around local axis.",
    Defaults: { Strength: 14.5, Radius: 2.1, CoreRadius: 0.45, SwirlRatio: 1.35, Frequency: 0.25, Reach: "Sphere" },
  },
  {
    Ordinal: 9,
    Id: "Drag",
    Name: "Drag Baffle",
    Domain: "VectorField",
    Channel: "Linear Damping",
    Color: "#78B8C8",
    Unit: "1/s",
    Equation: "a_drag(p) = -½ · C_d · S · f(r) · v̂",
    Summary: "Viscous damping medium attenuating and straightening kinetic flow inside volume.",
    Defaults: { Strength: 10.0, Radius: 2.0, CoreRadius: 0.48, SwirlRatio: 0.0, Frequency: 0.15, Reach: "Box" },
  },
  {
    Ordinal: 10,
    Id: "CurlNoise",
    Name: "Curl Noise",
    Domain: "TurbulenceField",
    Channel: "∇×Ψ Velocity",
    Color: "#E6A23C",
    Unit: "m/s",
    Equation: "v(p,t) = S · f(r) · (∇ × Ψ_fbm(p/λ, t))   [∇·v ≡ 0]",
    Summary: "Incompressible divergence-free 3D multi-octave curl-noise eddies.",
    Defaults: { Strength: 13.5, Radius: 2.4, CoreRadius: 0.5, TurbulenceScale: 1.15, Octaves: 3, SwirlRatio: 0.75, Frequency: 0.32, Reach: "Sphere" },
  },
  {
    Ordinal: 11,
    Id: "AtmosphericGust",
    Name: "Atmospheric Gust",
    Domain: "TurbulenceField",
    Channel: "Gust Velocity",
    Color: "#F0B45A",
    Unit: "m/s",
    Equation: "v(p,t) = S · (0.6 + 0.4 sin(k·x - ωt)) · d̂ + σ_curl(p,t)",
    Summary: "Traveling sinusoidal gust fronts layered over divergence-free boundary turbulence.",
    Defaults: { Strength: 15.5, Radius: 2.5, CoreRadius: 0.52, TurbulenceScale: 1.4, Octaves: 2, SwirlRatio: 0.35, Frequency: 0.45, Reach: "Box", Duration: "Modulated" },
  },
  {
    Ordinal: 12,
    Id: "VorticityConfinement",
    Name: "Vorticity Confinement",
    Domain: "TurbulenceField",
    Channel: "Eddy Boost",
    Color: "#E8914F",
    Unit: "m/s²",
    Equation: "f_vc = ε · S · (N̂ × ω),   ω = ∇ × u",
    Summary: "Re-injects coherent fine-scale rolling vortex rings into sheared flow wakes.",
    Defaults: { Strength: 15.0, Radius: 2.1, CoreRadius: 0.45, TurbulenceScale: 1.0, Octaves: 3, SwirlRatio: 0.95, Frequency: 0.38, Reach: "Sphere" },
  },
  {
    Ordinal: 13,
    Id: "BrownianNoise",
    Name: "Brownian Noise",
    Domain: "TurbulenceField",
    Channel: "Stochastic Jitter",
    Color: "#D9A85B",
    Unit: "m/s²",
    Equation: "a(p,t) = S · f(r) · ξ_3D(p/λ + ν·t)",
    Summary: "Stochastic 3D Langevin micro-jitter for dust motes, embers, and thermal shimmer.",
    Defaults: { Strength: 11.5, Radius: 2.0, CoreRadius: 0.4, TurbulenceScale: 0.85, Octaves: 3, SwirlRatio: 0.4, Frequency: 0.55, Reach: "Sphere" },
  },
  {
    Ordinal: 14,
    Id: "LorentzField",
    Name: "Lorentz Field",
    Domain: "VectorField",
    Channel: "Cyclotron q(E+v×B)",
    Color: "#A78BFA",
    Unit: "m/s²",
    Equation: "a(p) = (q/m) · (E(p) + u_drift × B(p))",
    Summary: "Coupled electric drift and axial magnetic cyclotron helical gyration.",
    Defaults: { Strength: 16.0, Radius: 2.2, CoreRadius: 0.48, SwirlRatio: 1.1, Frequency: 0.35, Reach: "Column" },
  },
  {
    Ordinal: 15,
    Id: "MagneticDipole",
    Name: "Magnetic Dipole",
    Domain: "VectorField",
    Channel: "Dipole Flux B(p)",
    Color: "#C084FC",
    Unit: "m/s",
    Equation: "B(p) = (3(m·r̂)r̂ - m) / max(r, r_core)³",
    Summary: "Toroidal north-south dipole flux lobes curving smoothly from +Z pole to -Z pole.",
    Defaults: { Strength: 16.5, Radius: 2.35, CoreRadius: 0.52, SwirlRatio: 0.35, Frequency: 0.2, Reach: "Sphere" },
  },
  {
    Ordinal: 16,
    Id: "FlowStream",
    Name: "Flow Stream",
    Domain: "FlowField",
    Channel: "Corridor Jet",
    Color: "#3AD69C",
    Unit: "m/s",
    Equation: "v(p) = S · f(r_⊥) · t̂_corridor + κ_inflow · n̂_⊥",
    Summary: "Directed slipstream jet corridor with lateral entrainment toward the core axis.",
    Defaults: { Strength: 17.0, Radius: 2.4, CoreRadius: 0.58, SwirlRatio: 0.25, Frequency: 0.25, Reach: "Box" },
  },
  {
    Ordinal: 17,
    Id: "SplineForce",
    Name: "Spline Force",
    Domain: "FlowField",
    Channel: "Spline Guide",
    Color: "#2DD4BF",
    Unit: "m/s",
    Equation: "v(p) = S · T̂(s*) + k_tube · (C(s*) - p)",
    Summary: "Curved S-bend streamline tube guiding flow tangentially with tube centering.",
    Defaults: { Strength: 15.5, Radius: 2.35, CoreRadius: 0.52, SwirlRatio: 0.45, Frequency: 0.28, Reach: "Box" },
  },
  {
    Ordinal: 18,
    Id: "BoundaryAdhesion",
    Name: "Boundary Adhesion",
    Domain: "FlowField",
    Channel: "Coanda Layer",
    Color: "#38BDF8",
    Unit: "m/s",
    Equation: "v(p) = S · exp(-d_surf/δ) · t̂_coanda - k_adhere · n̂_surf",
    Summary: "Coanda surface-hugging boundary layer skimming along the ground/hull plane.",
    Defaults: { Strength: 13.5, Radius: 2.3, CoreRadius: 0.48, SwirlRatio: 0.2, Frequency: 0.22, Reach: "Box" },
  },
]);

const FORCE_MODEL_MAP = new Map(FORCE_MODELS.map((M) => [M.Id, M]));

export function GetForceModelMeta(ModelIdOrOrdinal) {
  if (typeof ModelIdOrOrdinal === "number") {
    return FORCE_MODELS[Math.max(0, Math.min(FORCE_MODELS.length - 1, ModelIdOrOrdinal | 0))];
  }
  if (ModelIdOrOrdinal === "Stream") return FORCE_MODEL_MAP.get("FlowStream");
  if (ModelIdOrOrdinal === "Vortex") return FORCE_MODEL_MAP.get("RotationalColumn");
  if (ModelIdOrOrdinal === "SurfaceAdhesion") return FORCE_MODEL_MAP.get("BoundaryAdhesion");
  return FORCE_MODEL_MAP.get(ModelIdOrOrdinal) || FORCE_MODELS[0];
}

export function ResolveForceValues(Raw = {}, FallbackModel = "LinearWind") {
  const Meta = GetForceModelMeta(Raw.Model || FallbackModel);
  const Def = Meta.Defaults || {};
  return {
    Model: Meta.Id,
    Enabled: Raw.Enabled !== false,
    Solo: Boolean(Raw.Solo),
    Strength: Number.isFinite(+Raw.Strength) ? +Raw.Strength : (Def.Strength ?? 12.0),
    Radius: Math.max(0.25, Number.isFinite(+Raw.Radius) ? +Raw.Radius : (Def.Radius ?? 2.2)),
    CoreRadius: Math.max(0.08, Number.isFinite(+Raw.CoreRadius) ? +Raw.CoreRadius : (Def.CoreRadius ?? 0.48)),
    SwirlRatio: Number.isFinite(+Raw.SwirlRatio) ? +Raw.SwirlRatio : (Def.SwirlRatio ?? 0.35),
    Frequency: Math.max(0.04, Number.isFinite(+Raw.Frequency) ? +Raw.Frequency : (Def.Frequency ?? 0.25)),
    TurbulenceScale: Math.max(0.2, Number.isFinite(+Raw.TurbulenceScale) ? +Raw.TurbulenceScale : (Def.TurbulenceScale ?? 1.15)),
    Octaves: Math.max(1, Math.min(5, Math.round(+Raw.Octaves || Def.Octaves || 3))),
    PitchDeg: Number.isFinite(+Raw.PitchDeg) ? +Raw.PitchDeg : 0.0,
    YawDeg: Number.isFinite(+Raw.YawDeg) ? +Raw.YawDeg : 0.0,
    Reach: ReachEnvelopes.includes(Raw.Reach) ? Raw.Reach : (Def.Reach || "Sphere"),
    Attenuation: AttenuationCurves.includes(Raw.Attenuation) ? Raw.Attenuation : (Def.Attenuation || "SmoothStep"),
    FalloffExponent: Math.max(0.35, Number.isFinite(+Raw.FalloffExponent) ? +Raw.FalloffExponent : 1.35),
    Duration: DurationModes.includes(Raw.Duration) ? Raw.Duration : (Def.Duration || "Continuous"),
    WaveSpeed: Math.max(0.5, Number.isFinite(+Raw.WaveSpeed) ? +Raw.WaveSpeed : (Def.WaveSpeed ?? 4.2)),
    LastTriggerTime: Number.isFinite(+Raw.LastTriggerTime) ? +Raw.LastTriggerTime : -1.0,
    MotionTopology: MotionTopologies.includes(Raw.MotionTopology) ? Raw.MotionTopology : "Static",
    MotionLoopMode: MotionLoopModes.includes(Raw.MotionLoopMode) ? Raw.MotionLoopMode : "PingPong",
    MotionSpeed: Math.max(0.05, Number.isFinite(+Raw.MotionSpeed) ? +Raw.MotionSpeed : 0.35),
    MotionOrbitRadius: Math.max(0.15, Number.isFinite(+Raw.MotionOrbitRadius) ? +Raw.MotionOrbitRadius : 1.05),
    MotionWaypoints: Array.isArray(Raw.MotionWaypoints) ? Raw.MotionWaypoints.map((W) => [...W]) : null,
    FormulaEnabled: Boolean(Raw.FormulaEnabled),
    FormulaCode: typeof Raw.FormulaCode === "string" ? Raw.FormulaCode : DEFAULT_FORMULA_CODE,
  };
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SCENE PRESETS (MULTI-GENERATOR RIGS)
//------------------------------------------------------------------------------------------------------------------------

export const SCENE_PRESETS = Object.freeze([
  {
    Id: "twin_vortex",
    Name: "Twin Vortex & Crosswind Wake",
    Summary: "Prevailing Linear Wind colliding with a Rankine Vortex Column and trailing Curl Noise eddies.",
    BuildNodes: () => [
      {
        Id: "force_prevailing_wind",
        Name: "Prevailing Crosswind",
        Panel: "force",
        ForceModel: "LinearWind",
        Icon: "force-model:LinearWind",
        Parent: "forces",
        Position: [-1.45, 0.0, 0.95],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "LinearWind", Strength: 11.5, Radius: 3.1, YawDeg: 10, Reach: "Box" }),
      },
      {
        Id: "force_vortex_column",
        Name: "Rankine Vortex Column",
        Panel: "force",
        ForceModel: "RotationalColumn",
        Icon: "force-model:RotationalColumn",
        Parent: "forces",
        Position: [0.35, -0.2, 0.9],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "RotationalColumn", Strength: 17.5, Radius: 2.35, CoreRadius: 0.52, SwirlRatio: 1.35, Reach: "Column" }),
      },
      {
        Id: "force_curl_wake",
        Name: "Curl Turbulence Wake",
        Panel: "force",
        ForceModel: "CurlNoise",
        Icon: "force-model:CurlNoise",
        Parent: "forces",
        Position: [1.65, 0.35, 0.95],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "CurlNoise", Strength: 11.0, Radius: 2.15, TurbulenceScale: 1.05, Octaves: 3, Reach: "Sphere" }),
      },
    ],
  },
  {
    Id: "wind_tunnel",
    Name: "Wind Tunnel & Baffle Shear",
    Summary: "Directed Flow Stream jet deflected over a spherical Repulsor obstacle with Coanda floor adhesion.",
    BuildNodes: () => [
      {
        Id: "force_corridor_jet",
        Name: "Corridor Jet Stream",
        Panel: "force",
        ForceModel: "FlowStream",
        Icon: "force-model:FlowStream",
        Parent: "forces",
        Position: [-1.2, 0.0, 0.85],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "FlowStream", Strength: 16.5, Radius: 2.8, CoreRadius: 0.6, Reach: "Box" }),
      },
      {
        Id: "force_repulsor_baffle",
        Name: "Obstacle Repulsor Dome",
        Panel: "force",
        ForceModel: "Repulsor",
        Icon: "force-model:Repulsor",
        Parent: "forces",
        Position: [0.35, 0.0, 0.72],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "Repulsor", Strength: 18.0, Radius: 1.5, CoreRadius: 0.4, Reach: "Sphere" }),
      },
      {
        Id: "force_coanda_floor",
        Name: "Floor Coanda Adhesion",
        Panel: "force",
        ForceModel: "BoundaryAdhesion",
        Icon: "force-model:BoundaryAdhesion",
        Parent: "forces",
        Position: [1.45, 0.0, 0.55],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "BoundaryAdhesion", Strength: 12.5, Radius: 2.2, Reach: "Box" }),
      },
    ],
  },
  {
    Id: "magnetic_trap",
    Name: "Cyclotron Magnetic Trap",
    Summary: "Toroidal Magnetic Dipole paired with Lorentz helical gyration and outer Containment shell.",
    BuildNodes: () => [
      {
        Id: "force_magnetic_dipole",
        Name: "North-South Dipole",
        Panel: "force",
        ForceModel: "MagneticDipole",
        Icon: "force-model:MagneticDipole",
        Parent: "forces",
        Position: [0.0, 0.0, 1.05],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "MagneticDipole", Strength: 16.5, Radius: 2.6, CoreRadius: 0.48, Reach: "Sphere" }),
      },
      {
        Id: "force_lorentz_cyclotron",
        Name: "Lorentz Cyclotron",
        Panel: "force",
        ForceModel: "LorentzField",
        Icon: "force-model:LorentzField",
        Parent: "forces",
        Position: [0.0, 0.0, 0.95],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "LorentzField", Strength: 13.0, Radius: 2.2, SwirlRatio: 1.2, Reach: "Column" }),
      },
      {
        Id: "force_containment",
        Name: "Containment Shell",
        Panel: "force",
        ForceModel: "Containment",
        Icon: "force-model:Containment",
        Parent: "forces",
        Position: [0.0, 0.0, 1.0],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "Containment", Strength: 18.0, Radius: 2.75, CoreRadius: 1.25, Reach: "Sphere" }),
      },
    ],
  },
  {
    Id: "shockwave_updraft",
    Name: "Shockwave Burst & Thermal",
    Summary: "Expanding Radial Burst impulse paired with Buoyancy updraft plume and Vorticity rings.",
    BuildNodes: () => [
      {
        Id: "force_radial_burst",
        Name: "Shockwave Impulse",
        Panel: "force",
        ForceModel: "RadialBurst",
        Icon: "force-model:RadialBurst",
        Parent: "forces",
        Position: [-0.4, -0.35, 0.78],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "RadialBurst", Strength: 20.0, Radius: 2.45, Duration: "Impulse", Frequency: 0.45, WaveSpeed: 3.2, Reach: "Sphere" }),
      },
      {
        Id: "force_thermal_plume",
        Name: "Thermal Buoyancy Plume",
        Panel: "force",
        ForceModel: "Buoyancy",
        Icon: "force-model:Buoyancy",
        Parent: "forces",
        Position: [0.65, 0.35, 0.95],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "Buoyancy", Strength: 13.5, Radius: 2.1, Reach: "Column" }),
      },
      {
        Id: "force_vorticity_rings",
        Name: "Vorticity Eddy Rings",
        Panel: "force",
        ForceModel: "VorticityConfinement",
        Icon: "force-model:VorticityConfinement",
        Parent: "forces",
        Position: [0.65, 0.35, 1.45],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({ Model: "VorticityConfinement", Strength: 12.5, Radius: 2.0, SwirlRatio: 1.0, Reach: "Sphere" }),
      },
    ],
  },
  {
    Id: "formula_lab",
    Name: "VectorFieldLang Formula Lab",
    Summary: "Live symbolic formula generator coupled with an orbiting Spline Force guide.",
    BuildNodes: () => [
      {
        Id: "force_formula_custom",
        Name: "Symbolic Formula Field",
        Panel: "force",
        ForceModel: "Attractor",
        Icon: "force-model:Attractor",
        Parent: "forces",
        Position: [-0.45, 0.0, 0.95],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({
          Model: "Attractor",
          Strength: 15.0,
          Radius: 2.6,
          SwirlRatio: 0.85,
          FormulaEnabled: true,
          FormulaCode: DEFAULT_FORMULA_CODE,
          Reach: "Sphere",
        }),
      },
      {
        Id: "force_spline_guide",
        Name: "S-Bend Spline Guide",
        Panel: "force",
        ForceModel: "SplineForce",
        Icon: "force-model:SplineForce",
        Parent: "forces",
        Position: [0.95, 0.0, 0.95],
        Rotation: [0, 0, 0],
        Force: ResolveForceValues({
          Model: "SplineForce",
          Strength: 14.0,
          Radius: 2.3,
          MotionTopology: "CircularOrbit",
          MotionOrbitRadius: 0.75,
          MotionSpeed: 0.4,
          Reach: "Box",
        }),
      },
    ],
  },
]);

export function CreateForceNodeFromModel(ModelId, Index = 1, Position = [0, 0, 0.9]) {
  const Meta = GetForceModelMeta(ModelId);
  const Suffix = Index > 1 ? ` ${Index}` : "";
  return {
    Id: `force_${Meta.Id.toLowerCase()}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`,
    Name: `${Meta.Name}${Suffix}`,
    Panel: "force",
    ForceModel: Meta.Id,
    Icon: `force-model:${Meta.Id}`,
    Parent: "forces",
    Position: [...Position],
    Rotation: [0, 0, 0],
    Hidden: false,
    Locked: false,
    Force: ResolveForceValues({ Model: Meta.Id }),
  };
}

//------------------------------------------------------------------------------------------------------------------------
//                                           MOTION PATHS & ANALYTICAL FIELD MATH
//------------------------------------------------------------------------------------------------------------------------

export function EnsureMotionWaypoints(BaseCenter = [0, 0, 0.9], Force = {}, TargetTopology = "SplineCurve") {
  const Cx = Number(BaseCenter?.[0]) || 0;
  const Cy = Number(BaseCenter?.[1]) || 0;
  const Cz = Number(BaseCenter?.[2]) || 0.9;
  const Span = Math.max(0.5, Math.min(2.2, (Number(Force?.Radius) || 1.8) * 0.55));
  if (Array.isArray(Force?.MotionWaypoints) && Force.MotionWaypoints.length >= 2) {
    if (TargetTopology === "LinearAB") return [Force.MotionWaypoints[0], Force.MotionWaypoints[Force.MotionWaypoints.length - 1]];
    if (Force.MotionWaypoints.length >= 3) return Force.MotionWaypoints.map((W) => [...W]);
  }
  if (TargetTopology === "LinearAB") {
    return [
      [Number((Cx - Span).toFixed(2)), Number(Cy.toFixed(2)), Number(Cz.toFixed(2))],
      [Number((Cx + Span).toFixed(2)), Number(Cy.toFixed(2)), Number(Cz.toFixed(2))],
    ];
  }
  return [
    [Number((Cx - Span).toFixed(2)), Number((Cy - Span * 0.35).toFixed(2)), Number(Cz.toFixed(2))],
    [Number(Cx.toFixed(2)), Number((Cy + Span * 0.55).toFixed(2)), Number((Cz + 0.25).toFixed(2))],
    [Number((Cx + Span).toFixed(2)), Number((Cy - Span * 0.25).toFixed(2)), Number(Cz.toFixed(2))],
  ];
}

function EvalCatmullRomVec3(Pts, U01) {
  const N = Pts.length;
  if (N === 0) return [0, 0, 0.9];
  if (N === 1) return [...Pts[0]];
  if (N === 2) {
    return [
      Pts[0][0] + (Pts[1][0] - Pts[0][0]) * U01,
      Pts[0][1] + (Pts[1][1] - Pts[0][1]) * U01,
      Pts[0][2] + (Pts[1][2] - Pts[0][2]) * U01,
    ];
  }
  const Scaled = Math.max(0, Math.min(1, U01)) * (N - 1);
  const Seg = Math.min(N - 2, Math.floor(Scaled));
  const T = Scaled - Seg;
  const T2 = T * T;
  const T3 = T2 * T;
  const P0 = Pts[Math.max(0, Seg - 1)];
  const P1 = Pts[Seg];
  const P2 = Pts[Seg + 1];
  const P3 = Pts[Math.min(N - 1, Seg + 2)];
  return [0, 1, 2].map(
    (K) =>
      0.5 *
      (2 * P1[K] +
        (-P0[K] + P2[K]) * T +
        (2 * P0[K] - 5 * P1[K] + 4 * P2[K] - P3[K]) * T2 +
        (-P0[K] + 3 * P1[K] - 3 * P2[K] + P3[K]) * T3),
  );
}

export function EvaluateMotionPositionAtU(BaseCenter, Force, U01) {
  const Topo = Force.MotionTopology || "Static";
  const Base = BaseCenter || [0, 0, 0.9];
  if (Topo === "Static") return [...Base];
  if (Topo === "CircularOrbit") {
    const Ang = U01 * TWO_PI;
    const Rad = Force.MotionOrbitRadius || 1.05;
    return [Base[0] + Math.cos(Ang) * Rad, Base[1] + Math.sin(Ang) * Rad, Base[2]];
  }
  if (Topo === "Figure8") {
    const Ang = U01 * TWO_PI;
    const Rad = Force.MotionOrbitRadius || 1.05;
    return [Base[0] + Math.sin(Ang) * Rad, Base[1] + Math.sin(Ang * 2.0) * Rad * 0.55, Base[2]];
  }
  const Wps = EnsureMotionWaypoints(Base, Force, Topo);
  if (Topo === "LinearAB") {
    const A = Wps[0], B = Wps[Wps.length - 1];
    return [A[0] + (B[0] - A[0]) * U01, A[1] + (B[1] - A[1]) * U01, A[2] + (B[2] - A[2]) * U01];
  }
  return EvalCatmullRomVec3(Wps, U01);
}

export function ComputeMotionPathMetrics(BaseCenter, Force) {
  const Topo = Force.MotionTopology || "Static";
  if (Topo === "Static") return { LengthM: 0, WaypointCount: 0, CycleSec: 0 };
  const Samples = 32;
  let Len = 0;
  let Prev = EvaluateMotionPositionAtU(BaseCenter, Force, 0);
  for (let I = 1; I <= Samples; ++I) {
    const Cur = EvaluateMotionPositionAtU(BaseCenter, Force, I / Samples);
    Len += Math.hypot(Cur[0] - Prev[0], Cur[1] - Prev[1], Cur[2] - Prev[2]);
    Prev = Cur;
  }
  const Speed = Math.max(0.05, Force.MotionSpeed || 0.35);
  const CycleSec = Math.max(0.5, Len / Speed);
  const Wps = Topo === "LinearAB" || Topo === "SplineCurve" ? EnsureMotionWaypoints(BaseCenter, Force, Topo) : [];
  return { LengthM: Len, WaypointCount: Wps.length, CycleSec };
}

function Hash3(Ix, Iy, Iz) {
  const H = Math.sin(Ix * 127.1 + Iy * 311.7 + Iz * 74.7) * 43758.5453123;
  return H - Math.floor(H);
}

function SmoothNoise3(X, Y, Z) {
  const Ix = Math.floor(X), Iy = Math.floor(Y), Iz = Math.floor(Z);
  const Fx = X - Ix, Fy = Y - Iy, Fz = Z - Iz;
  const Ux = Fx * Fx * (3 - 2 * Fx), Uy = Fy * Fy * (3 - 2 * Fy), Uz = Fz * Fz * (3 - 2 * Fz);
  let Sum = 0;
  for (let Dz = 0; Dz < 2; ++Dz) {
    const Wz = Dz ? Uz : 1 - Uz;
    for (let Dy = 0; Dy < 2; ++Dy) {
      const Wy = Dy ? Uy : 1 - Uy;
      for (let Dx = 0; Dx < 2; ++Dx) {
        const Wx = Dx ? Ux : 1 - Ux;
        Sum += Wx * Wy * Wz * Hash3(Ix + Dx, Iy + Dy, Iz + Dz);
      }
    }
  }
  return Sum * 2.0 - 1.0;
}

function PotentialFbmVec3(X, Y, Z, Octaves = 3) {
  let Ax = 0, Ay = 0, Az = 0;
  let Amp = 0.55, Freq = 1.0;
  for (let O = 0; O < Octaves; ++O) {
    const Px = X * Freq, Py = Y * Freq, Pz = Z * Freq;
    Ax += Amp * SmoothNoise3(Px + 17.3, Py + 3.1, Pz + 9.7);
    Ay += Amp * SmoothNoise3(Px + 41.9, Py + 29.4, Pz + 5.2);
    Az += Amp * SmoothNoise3(Px + 83.1, Py + 11.8, Pz + 67.3);
    Freq *= 2.03;
    Amp *= 0.5;
  }
  return [Ax, Ay, Az];
}

export function SampleCurlNoise3D(Px, Py, Pz, ScaleMeters = 1.15, Octaves = 3, TimeSec = 0) {
  const InvS = 1.0 / Math.max(0.2, ScaleMeters);
  const Sx = Px * InvS + TimeSec * 0.22;
  const Sy = Py * InvS - TimeSec * 0.14;
  const Sz = Pz * InvS + TimeSec * 0.08;
  const Eps = 0.08;
  const Pxp = PotentialFbmVec3(Sx + Eps, Sy, Sz, Octaves), Pxm = PotentialFbmVec3(Sx - Eps, Sy, Sz, Octaves);
  const Pyp = PotentialFbmVec3(Sx, Sy + Eps, Sz, Octaves), Pym = PotentialFbmVec3(Sx, Sy - Eps, Sz, Octaves);
  const Pzp = PotentialFbmVec3(Sx, Sy, Sz + Eps, Octaves), Pzm = PotentialFbmVec3(Sx, Sy, Sz - Eps, Octaves);
  const Inv2E = 0.5 / Eps;
  const DAzDy = (Pyp[2] - Pym[2]) * Inv2E, DAyDz = (Pzp[1] - Pzm[1]) * Inv2E;
  const DAxDz = (Pzp[0] - Pzm[0]) * Inv2E, DAzDx = (Pxp[2] - Pxm[2]) * Inv2E;
  const DAyDx = (Pxp[1] - Pxm[1]) * Inv2E, DAxDy = (Pyp[0] - Pym[0]) * Inv2E;
  return [DAzDy - DAyDz, DAxDz - DAzDx, DAyDx - DAxDy];
}

export function EvaluateReachNormalizedDistance(Dx, Dy, Dz, Radius, Reach) {
  const R = Math.max(0.2, Radius);
  if (Reach === "Infinite") return Math.min(0.95, Math.hypot(Dx, Dy, Dz) / Math.max(8.0, R * 3.0));
  if (Reach === "Box") return Math.max(Math.abs(Dx), Math.abs(Dy), Math.abs(Dz)) / R;
  if (Reach === "Column") {
    const RadialU = Math.hypot(Dx, Dy) / R;
    const VertU = Math.abs(Dz) / (R * 0.95);
    return Math.max(RadialU, VertU);
  }
  return Math.hypot(Dx, Dy, Dz) / R;
}

export function EvaluateRadialEnvelope(NormU, Curve = "SmoothStep", Exponent = 1.35) {
  if (NormU >= 1.0) return 0.0;
  const U = Math.max(0.0, Math.min(1.0, NormU));
  if (Curve === "Constant") return 1.0;
  if (Curve === "Linear") return Math.pow(1.0 - U, Math.max(0.25, Exponent * 0.75));
  if (Curve === "InverseSquare") {
    const Taper = U > 0.8 ? 1.0 - ((U - 0.8) / 0.2) * ((U - 0.8) / 0.2) * (3.0 - 2.0 * ((U - 0.8) / 0.2)) : 1.0;
    return (1.0 / (1.0 + 7.5 * U * U)) * Taper;
  }
  const S = 1.0 - U * U;
  return S * S;
}

export function EvaluateMotionCenter(BaseCenter, Force, TimeSec = 0) {
  const Topo = Force.MotionTopology || "Static";
  const Base = BaseCenter || [0, 0, 0.9];
  if (Topo === "Static") return [...Base];
  const { CycleSec } = ComputeMotionPathMetrics(Base, Force);
  const Phase = TimeSec / Math.max(0.5, CycleSec);
  let U = 0;
  if (Force.MotionLoopMode === "Once") {
    U = Math.min(1.0, Math.max(0.0, Phase));
  } else if (Force.MotionLoopMode === "Loop") {
    U = ((Phase % 1.0) + 1.0) % 1.0;
  } else {
    const Raw = ((Phase % 2.0) + 2.0) % 2.0;
    U = Raw <= 1.0 ? Raw : 2.0 - Raw;
  }
  return EvaluateMotionPositionAtU(Base, Force, U);
}

const FORMULA_CACHE = new Map();
export function GetCompiledForceFormula(Code) {
  const Src = typeof Code === "string" && Code.trim().length > 0 ? Code : DEFAULT_FORMULA_CODE;
  if (FORMULA_CACHE.has(Src)) return FORMULA_CACHE.get(Src);
  const Compiled = CompileFieldProgram(Src);
  if (FORMULA_CACHE.size > 48) FORMULA_CACHE.clear();
  FORMULA_CACHE.set(Src, Compiled);
  return Compiled;
}

export function EvaluateForceSourceAt(ForceConfig, BaseCenter, RotationDeg, Px, Py, Pz, TimeSec = 0) {
  const F = ResolveForceValues(ForceConfig);
  if (!F.Enabled) return [0, 0, 0];

  const Center = EvaluateMotionCenter(BaseCenter || [0, 0, 0.9], F, TimeSec);
  const Dx = Px - Center[0];
  const Dy = Py - Center[1];
  const Dz = Pz - Center[2];

  const NormU = EvaluateReachNormalizedDistance(Dx, Dy, Dz, F.Radius, F.Reach);
  if (NormU >= 1.0 && F.Reach !== "Infinite") return [0, 0, 0];

  let Gate = 1.0;
  let ImpulseShellMask = 1.0;
  if (F.Duration === "Modulated") {
    Gate = 0.58 + 0.42 * Math.sin(TimeSec * TWO_PI * F.Frequency);
  } else if (F.Duration === "Impulse") {
    if (F.LastTriggerTime >= 0 && TimeSec >= F.LastTriggerTime) {
      const Elapsed = TimeSec - F.LastTriggerTime;
      const WaveR = Elapsed * F.WaveSpeed;
      const ShellSigma = Math.max(0.28, F.Radius * 0.24);
      const R3 = Math.hypot(Dx, Dy, Dz);
      if (WaveR <= F.Radius * 1.15) {
        Gate = Math.exp(-Elapsed * 1.15);
        ImpulseShellMask = Math.exp(-0.5 * Math.pow((R3 - WaveR) / ShellSigma, 2));
      } else {
        Gate = 0.0;
      }
    } else {
      const Cycle = ((TimeSec * F.Frequency) % 1.0 + 1.0) % 1.0;
      Gate = Math.exp(-Cycle * 4.0) * Math.sin(Math.min(1.0, Cycle * 5.0) * Math.PI * 0.5);
    }
  }

  const Env = EvaluateRadialEnvelope(NormU, F.Attenuation, F.FalloffExponent) * Gate * ImpulseShellMask;
  if (Math.abs(Env) <= 1e-6) return [0, 0, 0];

  if (F.FormulaEnabled && F.FormulaCode) {
    const Prog = GetCompiledForceFormula(F.FormulaCode);
    if (Prog && Prog.Ok && typeof Prog.JsFn === "function") {
      try {
        const FormulaCtx = {
          R: F.Radius,
          Gate,
          Attenuate: (Dist, Rad) =>
            EvaluateRadialEnvelope(Dist / Math.max(0.1, Rad || F.Radius), F.Attenuation, F.FalloffExponent),
          CurlNoise: (X, Y, Z, Sc) => {
            const C = SampleCurlNoise3D(X, Z, Y, Math.max(0.3, (Sc || 48) * 0.03), F.Octaves, TimeSec);
            return [C[0], C[2], C[1]];
          },
          Noise3: (X, Y, Z) => PotentialFbmVec3(X, Z, Y, F.Octaves),
        };
        // VectorFieldLang expects +Y-up internally; convert Frontier (+X, +Y, +Z) <-> (+X, +Z, +Y)
        const Res = Prog.JsFn(
          Px,
          Pz,
          Py,
          Center[0],
          Center[2],
          Center[1],
          F.Radius,
          F.Strength,
          F.SwirlRatio * F.Strength,
          TimeSec,
          FormulaCtx,
        );
        if (Array.isArray(Res) && Number.isFinite(Res[0]) && Number.isFinite(Res[1]) && Number.isFinite(Res[2])) {
          return [Res[0] * Gate, Res[2] * Gate, Res[1] * Gate];
        }
      } catch {}
    }
  }

  const RotYaw = ((RotationDeg?.[2] || 0) + F.YawDeg) * DEG_TO_RAD;
  const RotPitch = ((RotationDeg?.[1] || 0) + F.PitchDeg) * DEG_TO_RAD;
  const DirX = Math.cos(RotPitch) * Math.cos(RotYaw);
  const DirY = Math.cos(RotPitch) * Math.sin(RotYaw);
  const DirZ = Math.sin(RotPitch);

  const R3 = Math.hypot(Dx, Dy, Dz);
  const SafeR3 = Math.max(F.CoreRadius, R3, 0.08);
  const Rx = R3 > 1e-5 ? Dx / R3 : 1.0;
  const Ry = R3 > 1e-5 ? Dy / R3 : 0.0;
  const Rz = R3 > 1e-5 ? Dz / R3 : 0.0;

  const Rxy = Math.hypot(Dx, Dy);
  const Tx = Rxy > 1e-5 ? -Dy / Rxy : 0.0;
  const Ty = Rxy > 1e-5 ? Dx / Rxy : 1.0;

  const S = F.Strength * Env;

  switch (F.Model) {
    case "LinearWind": {
      const Shear = 1.0 + 0.14 * Math.max(-1.0, Dz / Math.max(0.5, F.Radius));
      return [DirX * S * Shear, DirY * S * Shear, (DirZ + 0.05 * F.SwirlRatio) * S];
    }
    case "Buoyancy":
      return [-Dx * 0.14 * S, -Dy * 0.14 * S, S];
    case "RadialBurst":
    case "Repulsor":
      return [Rx * S, Ry * S, Rz * S];
    case "Attractor": {
      const CoreGain = Math.min(1.8, (F.Radius * 0.55) / SafeR3);
      return [
        (-Rx * CoreGain + Tx * F.SwirlRatio * 0.45) * S,
        (-Ry * CoreGain + Ty * F.SwirlRatio * 0.45) * S,
        -Rz * CoreGain * S,
      ];
    }
    case "AxisAttractor": {
      const RadIn = Rxy > 1e-5 ? -1.0 / Rxy : 0.0;
      return [
        (Dx * RadIn * 0.75 + Tx * F.SwirlRatio) * S,
        (Dy * RadIn * 0.75 + Ty * F.SwirlRatio) * S,
        0.18 * S,
      ];
    }
    case "Containment": {
      if (R3 <= F.CoreRadius) return [Tx * S * 0.12 * F.SwirlRatio, Ty * S * 0.12 * F.SwirlRatio, 0];
      const Wall = Math.min(1.5, (R3 - F.CoreRadius) / Math.max(0.15, F.Radius - F.CoreRadius));
      return [-Rx * S * Wall, -Ry * S * Wall, -Rz * S * Wall];
    }
    case "RotationalColumn": {
      const Rankine =
        Rxy < F.CoreRadius
          ? Rxy / Math.max(0.08, F.CoreRadius)
          : Math.max(0.08, F.CoreRadius) / Math.max(F.CoreRadius, Rxy);
      const Inflow = -0.22 * (Rxy > 1e-5 ? 1.0 : 0.0);
      return [
        (Tx * Rankine * F.SwirlRatio + (Rxy > 1e-5 ? (Dx / Rxy) * Inflow : 0)) * S,
        (Ty * Rankine * F.SwirlRatio + (Rxy > 1e-5 ? (Dy / Rxy) * Inflow : 0)) * S,
        0.28 * Rankine * S,
      ];
    }
    case "Torque":
      return [Tx * S * F.SwirlRatio, Ty * S * F.SwirlRatio, 0.0];
    case "Drag":
      return [-DirX * S * 0.55, -DirY * S * 0.55, -Rz * S * 0.35];
    case "CurlNoise": {
      const C = SampleCurlNoise3D(Dx, Dy, Dz, F.TurbulenceScale, F.Octaves, TimeSec);
      return [C[0] * S * 1.4, C[1] * S * 1.4, C[2] * S * 1.4];
    }
    case "AtmosphericGust": {
      const Wave = 0.65 + 0.35 * Math.sin((Dx * DirX + Dy * DirY) * 2.2 - TimeSec * TWO_PI * F.Frequency);
      const C = SampleCurlNoise3D(Dx, Dy, Dz, F.TurbulenceScale, F.Octaves, TimeSec);
      return [
        (DirX * Wave + C[0] * 0.42) * S,
        (DirY * Wave + C[1] * 0.42) * S,
        (DirZ * Wave + C[2] * 0.35) * S,
      ];
    }
    case "VorticityConfinement": {
      const C = SampleCurlNoise3D(Dx, Dy, Dz, F.TurbulenceScale, F.Octaves, TimeSec);
      return [(Tx * 0.65 + C[0]) * S, (Ty * 0.65 + C[1]) * S, C[2] * S];
    }
    case "BrownianNoise": {
      const J = PotentialFbmVec3(Dx / F.TurbulenceScale + TimeSec * 1.7, Dy / F.TurbulenceScale, Dz / F.TurbulenceScale - TimeSec * 1.3, F.Octaves);
      return [J[0] * S, J[1] * S, J[2] * S];
    }
    case "LorentzField":
      return [
        (DirX * 0.35 + Tx * F.SwirlRatio) * S,
        (DirY * 0.35 + Ty * F.SwirlRatio) * S,
        0.42 * S,
      ];
    case "MagneticDipole": {
      const MdotR = Rz;
      const Bx = 3.0 * MdotR * Rx;
      const By = 3.0 * MdotR * Ry;
      const Bz = 3.0 * MdotR * Rz - 1.0;
      const BNorm = Math.hypot(Bx, By, Bz) || 1.0;
      return [(Bx / BNorm) * S, (By / BNorm) * S, (Bz / BNorm) * S];
    }
    case "FlowStream": {
      const Proj = Dx * DirX + Dy * DirY + Dz * DirZ;
      const LatX = Dx - Proj * DirX;
      const LatY = Dy - Proj * DirY;
      const LatZ = Dz - Proj * DirZ;
      return [
        (DirX - LatX * 0.32) * S,
        (DirY - LatY * 0.32) * S,
        (DirZ - LatZ * 0.32) * S,
      ];
    }
    case "SplineForce": {
      const CurveY = 0.55 * Math.sin((Dx / Math.max(0.5, F.Radius)) * Math.PI);
      const Slope = 0.55 * (Math.PI / Math.max(0.5, F.Radius)) * Math.cos((Dx / Math.max(0.5, F.Radius)) * Math.PI);
      const NormS = Math.hypot(1.0, Slope);
      return [
        (1.0 / NormS) * S,
        (Slope / NormS - (Dy - CurveY) * 0.45) * S,
        -Dz * 0.35 * S,
      ];
    }
    case "BoundaryAdhesion": {
      const HeightAboveFloor = Math.max(0.0, Pz);
      const Skin = Math.exp(-HeightAboveFloor / Math.max(0.25, F.CoreRadius * 1.4));
      return [DirX * S * (0.45 + 0.75 * Skin), DirY * S * (0.45 + 0.75 * Skin), -0.45 * S * Skin];
    }
    default:
      return [DirX * S, DirY * S, DirZ * S];
  }
}

export function GetEffectiveForceNodes(ForceNodes) {
  if (!Array.isArray(ForceNodes)) return [];
  const AnySolo = ForceNodes.some((N) => N && !N.Hidden && N.Force?.Solo && N.Force?.Enabled !== false);
  return ForceNodes.filter((N) => {
    if (!N || N.Hidden) return false;
    if (AnySolo) return Boolean(N.Force?.Solo);
    return true;
  });
}

export function EvaluateSceneForceFieldAt(ForceNodes, Px, Py, Pz, TimeSec = 0) {
  let Vx = 0, Vy = 0, Vz = 0;
  const Active = GetEffectiveForceNodes(ForceNodes);
  for (const Node of Active) {
    const V = EvaluateForceSourceAt(Node.Force, Node.Position, Node.Rotation, Px, Py, Pz, TimeSec);
    Vx += V[0];
    Vy += V[1];
    Vz += V[2];
  }
  return [Vx, Vy, Vz];
}

export function ClassifyBeaufortScale(SpeedMs) {
  const S = Math.abs(SpeedMs);
  if (S < 0.5) return { Number: 0, Label: "Calm", Land: "smoke rises vertically; mirror-still air" };
  if (S < 1.6) return { Number: 1, Label: "Light Air", Land: "wind motion visible in smoke drift" };
  if (S < 3.4) return { Number: 2, Label: "Light Breeze", Land: "leaves rustle gently; wind felt on face" };
  if (S < 5.5) return { Number: 3, Label: "Gentle Breeze", Land: "leaves and small twigs in constant motion" };
  if (S < 8.0) return { Number: 4, Label: "Moderate Breeze", Land: "raises dust and loose paper; small branches move" };
  if (S < 10.8) return { Number: 5, Label: "Fresh Breeze", Land: "small trees in leaf begin to sway" };
  if (S < 13.9) return { Number: 6, Label: "Strong Breeze", Land: "large branches in motion; whistling in wires" };
  if (S < 17.2) return { Number: 7, Label: "Near Gale", Land: "whole trees in motion; effort walking upwind" };
  if (S < 20.8) return { Number: 8, Label: "Gale", Land: "twigs broken off trees; strong structural load" };
  if (S < 24.5) return { Number: 9, Label: "Strong Gale", Land: "high-velocity gusts; vortex shedding active" };
  if (S < 28.5) return { Number: 10, Label: "Storm", Land: "trees uprooted; severe aerodynamic pressure" };
  if (S < 32.7) return { Number: 11, Label: "Violent Storm", Land: "widespread turbulent shear; extreme dynamic q" };
  return { Number: 12, Label: "Hurricane", Land: "extreme cyclonic core; supersonic-class gust load" };
}

function CompassFromBearingDeg(Deg) {
  const Dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const Norm = ((Deg % 360) + 360) % 360;
  return Dirs[Math.round(Norm / 45) % 8];
}

export function EvaluateSceneCompositeTelemetry(ForceNodes, Px, Py, Pz, TimeSec = 0, StepH = 0.08) {
  let FlowX = 0, FlowY = 0, FlowZ = 0;
  let AccX = 0, AccY = 0, AccZ = 0;
  let ActiveCount = 0;

  const Active = GetEffectiveForceNodes(ForceNodes);
  for (const Node of Active) {
    const F = ResolveForceValues(Node.Force);
    if (!F.Enabled) continue;
    ActiveCount++;
    const Meta = GetForceModelMeta(F.Model);
    const V = EvaluateForceSourceAt(F, Node.Position, Node.Rotation, Px, Py, Pz, TimeSec);
    if (Meta.Channel.includes("Accel") || Meta.Unit.includes("s²") || F.Model === "RadialBurst" || F.Model === "Attractor" || F.Model === "Repulsor") {
      AccX += V[0];
      AccY += V[1];
      AccZ += V[2];
    } else {
      FlowX += V[0];
      FlowY += V[1];
      FlowZ += V[2];
    }
  }

  const [Vx, Vy, Vz] = EvaluateSceneForceFieldAt(ForceNodes, Px, Py, Pz, TimeSec);
  const Speed = Math.hypot(Vx, Vy, Vz);
  const FlowSpeed = Math.hypot(FlowX, FlowY, FlowZ);
  const AccelMag = Math.hypot(AccX, AccY, AccZ);

  const Vxp = EvaluateSceneForceFieldAt(ForceNodes, Px + StepH, Py, Pz, TimeSec);
  const Vxm = EvaluateSceneForceFieldAt(ForceNodes, Px - StepH, Py, Pz, TimeSec);
  const Vyp = EvaluateSceneForceFieldAt(ForceNodes, Px, Py + StepH, Pz, TimeSec);
  const Vym = EvaluateSceneForceFieldAt(ForceNodes, Px, Py - StepH, Pz, TimeSec);
  const Vzp = EvaluateSceneForceFieldAt(ForceNodes, Px, Py, Pz + StepH, TimeSec);
  const Vzm = EvaluateSceneForceFieldAt(ForceNodes, Px, Py, Pz - StepH, TimeSec);

  const Inv2H = 0.5 / StepH;
  const DVxDx = (Vxp[0] - Vxm[0]) * Inv2H;
  const DVyDx = (Vxp[1] - Vxm[1]) * Inv2H;
  const DVzDx = (Vxp[2] - Vxm[2]) * Inv2H;
  const DVxDy = (Vyp[0] - Vym[0]) * Inv2H;
  const DVyDy = (Vyp[1] - Vym[1]) * Inv2H;
  const DVzDy = (Vyp[2] - Vym[2]) * Inv2H;
  const DVxDz = (Vzp[0] - Vzm[0]) * Inv2H;
  const DVyDz = (Vzp[1] - Vzm[1]) * Inv2H;
  const DVzDz = (Vzp[2] - Vzm[2]) * Inv2H;

  const CurlVec = [DVzDy - DVyDz, DVxDz - DVzDx, DVyDx - DVxDy];
  const CurlMag = Math.hypot(CurlVec[0], CurlVec[1], CurlVec[2]);
  const Divergence = DVxDx + DVyDy + DVzDz;
  const DynamicPressurePa = 0.5 * 1.225 * Speed * Speed;
  const BearingDeg = ((Math.atan2(Vy, Vx) / DEG_TO_RAD) % 360 + 360) % 360;

  return {
    ActiveCount,
    Velocity: [Vx, Vy, Vz],
    FlowVelocity: [FlowX, FlowY, FlowZ],
    Acceleration: [AccX, AccY, AccZ],
    Speed,
    FlowSpeed,
    AccelMag,
    CurlVec,
    CurlMag,
    Divergence,
    DynamicPressurePa,
    BearingDeg,
    Compass: CompassFromBearingDeg(BearingDeg),
    Beaufort: ClassifyBeaufortScale(Speed),
  };
}

//------------------------------------------------------------------------------------------------------------------------
//                                              COLORMAP SAMPLER
//------------------------------------------------------------------------------------------------------------------------

function LerpStops(Stops, T) {
  const U = Math.max(0, Math.min(1, T));
  for (let I = 0; I < Stops.length - 1; ++I) {
    const A = Stops[I], B = Stops[I + 1];
    if (U <= B[0] || I === Stops.length - 2) {
      const F = Math.max(0, Math.min(1, (U - A[0]) / Math.max(1e-5, B[0] - A[0])));
      return [
        A[1] + (B[1] - A[1]) * F,
        A[2] + (B[2] - A[2]) * F,
        A[3] + (B[3] - A[3]) * F,
      ];
    }
  }
  return [1, 1, 1];
}

const ENG_STOPS = [
  [0.0, 0.06, 0.16, 0.34],
  [0.22, 0.11, 0.49, 0.84],
  [0.45, 0.13, 0.72, 0.81],
  [0.66, 0.51, 0.79, 0.12],
  [0.84, 0.98, 0.69, 0.02],
  [1.0, 0.94, 0.24, 0.24],
];

const TURBO_STOPS = [
  [0.0, 0.19, 0.07, 0.23],
  [0.25, 0.27, 0.52, 0.98],
  [0.5, 0.1, 0.89, 0.71],
  [0.75, 0.98, 0.73, 0.22],
  [1.0, 0.48, 0.02, 0.01],
];

const PLASMA_STOPS = [
  [0.0, 0.05, 0.03, 0.53],
  [0.32, 0.49, 0.01, 0.66],
  [0.62, 0.8, 0.28, 0.47],
  [0.84, 0.97, 0.58, 0.25],
  [1.0, 0.94, 0.98, 0.13],
];

const VIRIDIS_STOPS = [
  [0.0, 0.27, 0.0, 0.33],
  [0.35, 0.19, 0.41, 0.56],
  [0.7, 0.21, 0.72, 0.47],
  [1.0, 0.99, 0.91, 0.15],
];

const DIVERGING_STOPS = [
  [0.0, 0.17, 0.42, 0.69],
  [0.28, 0.39, 0.7, 0.93],
  [0.5, 0.12, 0.14, 0.19],
  [0.72, 0.99, 0.51, 0.51],
  [1.0, 0.9, 0.24, 0.24],
];

export function SampleFieldColormap(RampMode = "Engineering", Share01 = 0.0, DomainRgb = [0.29, 0.66, 1.0]) {
  const U = Math.max(0, Math.min(1, Share01));
  if (RampMode === "Turbo") return LerpStops(TURBO_STOPS, U);
  if (RampMode === "Plasma") return LerpStops(PLASMA_STOPS, U);
  if (RampMode === "Viridis") return LerpStops(VIRIDIS_STOPS, U);
  if (RampMode === "Diverging") return LerpStops(DIVERGING_STOPS, U);
  if (RampMode === "DomainTint") {
    return [
      0.1 + DomainRgb[0] * (0.35 + 0.65 * U),
      0.12 + DomainRgb[1] * (0.35 + 0.65 * U),
      0.16 + DomainRgb[2] * (0.35 + 0.65 * U),
    ];
  }
  return LerpStops(ENG_STOPS, U);
}

function HexToRgb01(Hex) {
  if (typeof Hex !== "string" || !/^#[0-9a-f]{6}$/i.test(Hex)) return [0.3, 0.66, 1.0];
  return [
    parseInt(Hex.slice(1, 3), 16) / 255,
    parseInt(Hex.slice(3, 5), 16) / 255,
    parseInt(Hex.slice(5, 7), 16) / 255,
  ];
}

//------------------------------------------------------------------------------------------------------------------------
//                                      FLOW TRACER PARTICLE SYSTEM (RK2 ADVECTION + RIBBONS)
//------------------------------------------------------------------------------------------------------------------------

export function ComputeSceneBounds(ForceNodes) {
  const Active = GetEffectiveForceNodes(ForceNodes).filter((N) => N.Force?.Enabled !== false);
  if (Active.length === 0) {
    return { MinX: -3.2, MaxX: 3.2, MinY: -3.2, MaxY: 3.2, MinZ: -0.2, MaxZ: 2.8, CenterX: 0, CenterY: 0, CenterZ: 1.0, BaseSliceZ: 0.85 };
  }
  let MinX = Infinity, MinY = Infinity, MinZ = Infinity;
  let MaxX = -Infinity, MaxY = -Infinity, MaxZ = -Infinity;
  let WeightedZ = 0, Count = 0;
  for (const N of Active) {
    const F = ResolveForceValues(N.Force);
    const C = N.Position || [0, 0, 0.9];
    const R = Math.min(F.Radius * 1.12, 6.5);
    MinX = Math.min(MinX, C[0] - R);
    MaxX = Math.max(MaxX, C[0] + R);
    MinY = Math.min(MinY, C[1] - R);
    MaxY = Math.max(MaxY, C[1] + R);
    MinZ = Math.min(MinZ, Math.max(0.02, C[2] - R * 0.85));
    MaxZ = Math.max(MaxZ, C[2] + R * 0.95);
    WeightedZ += Math.max(0.1, C[2]);
    Count++;
  }
  return {
    MinX, MaxX, MinY, MaxY, MinZ, MaxZ,
    CenterX: 0.5 * (MinX + MaxX),
    CenterY: 0.5 * (MinY + MaxY),
    CenterZ: 0.5 * (MinZ + MaxZ),
    BaseSliceZ: Count > 0 ? WeightedZ / Count : 0.85,
  };
}

function DeterministicRand(Seed) {
  let S = (Seed | 0) || 1;
  return () => {
    S = (S * 1664525 + 1013904223) >>> 0;
    return S / 4294967296;
  };
}

export function CreateFlowParticleSystem(Capacity = 1600, TrailLen = 10) {
  const N = Math.max(100, Math.min(4096, Capacity | 0));
  const T = Math.max(3, Math.min(18, TrailLen | 0));
  return {
    Capacity: N,
    TrailLen: T,
    Pos: new Float32Array(N * 3),
    Speed: new Float32Array(N),
    Age: new Float32Array(N),
    MaxAge: new Float32Array(N),
    Trail: new Float32Array(N * T * 3),
    TrailCount: new Uint8Array(N),
    Rng: DeterministicRand(1337),
    Initialized: false,
  };
}

function SpawnSingleParticle(Sys, Idx, ForceNodes, Bounds, Settings, TimeSec, SelectedId) {
  const Active = GetEffectiveForceNodes(ForceNodes).filter((N) => N.Force?.Enabled !== false);
  const Rng = Sys.Rng;
  const SeedMode = Settings.ParticleSeedMode || "ForceVolumes";
  let Px = 0, Py = 0, Pz = 0.8;

  if (Active.length === 0) {
    Px = (Rng() - 0.5) * 4.0;
    Py = (Rng() - 0.5) * 4.0;
    Pz = 0.2 + Rng() * 1.8;
  } else if (SeedMode === "WindTunnel") {
    Px = Bounds.MinX + 0.08 + Rng() * 0.45;
    Py = Bounds.MinY + Rng() * (Bounds.MaxY - Bounds.MinY);
    Pz = Math.max(0.08, Bounds.MinZ + Rng() * (Bounds.MaxZ - Bounds.MinZ) * 0.85);
  } else if (SeedMode === "UniformLattice") {
    Px = Bounds.MinX + Rng() * (Bounds.MaxX - Bounds.MinX);
    Py = Bounds.MinY + Rng() * (Bounds.MaxY - Bounds.MinY);
    Pz = Math.max(0.06, Bounds.MinZ + Rng() * (Bounds.MaxZ - Bounds.MinZ));
  } else if (SeedMode === "RingSource") {
    const SelNode = Active.find((N) => N.Id === SelectedId) || Active[Idx % Active.length];
    const F = ResolveForceValues(SelNode.Force);
    const C = EvaluateMotionCenter(SelNode.Position || [0, 0, 0.9], F, TimeSec);
    const Ang = Rng() * TWO_PI;
    const Rad = Math.max(0.25, F.Radius * (0.28 + 0.45 * Rng()));
    Px = C[0] + Math.cos(Ang) * Rad;
    Py = C[1] + Math.sin(Ang) * Rad;
    Pz = Math.max(0.06, C[2] + (Rng() - 0.5) * F.Radius * 0.65);
  } else {
    const Node = Active[Idx % Active.length];
    const F = ResolveForceValues(Node.Force);
    const C = EvaluateMotionCenter(Node.Position || [0, 0, 0.9], F, TimeSec);
    const U = Rng();
    const V = Rng();
    const Theta = U * TWO_PI;
    const CosPhi = 2 * V - 1;
    const SinPhi = Math.sqrt(Math.max(0, 1 - CosPhi * CosPhi));
    const R = Math.min(F.Radius * 0.92, 5.5) * Math.cbrt(Rng());
    Px = C[0] + R * SinPhi * Math.cos(Theta);
    Py = C[1] + R * SinPhi * Math.sin(Theta);
    Pz = Math.max(0.05, C[2] + R * CosPhi * 0.85);
  }

  Sys.Pos[Idx * 3] = Px;
  Sys.Pos[Idx * 3 + 1] = Py;
  Sys.Pos[Idx * 3 + 2] = Pz;
  Sys.Speed[Idx] = 0;
  Sys.Age[Idx] = 0;
  Sys.MaxAge[Idx] = 1.4 + Rng() * 2.2;
  Sys.TrailCount[Idx] = 1;
  const TBase = Idx * Sys.TrailLen * 3;
  Sys.Trail[TBase] = Px;
  Sys.Trail[TBase + 1] = Py;
  Sys.Trail[TBase + 2] = Pz;
}

export function ResetFlowParticles(Sys, ForceNodes, Settings = DEFAULT_FLOW_VIZ, TimeSec = 0, SelectedId = null) {
  const Bounds = ComputeSceneBounds(ForceNodes);
  for (let I = 0; I < Sys.Capacity; ++I) {
    SpawnSingleParticle(Sys, I, ForceNodes, Bounds, Settings, TimeSec, SelectedId);
    Sys.Age[I] = Sys.Rng() * Sys.MaxAge[I] * 0.85;
  }
  Sys.Initialized = true;
}

export function StepFlowParticles(Sys, ForceNodes, Dt, Settings = DEFAULT_FLOW_VIZ, TimeSec = 0, SelectedId = null) {
  const ActiveCount = Math.max(100, Math.min(Sys.Capacity, Math.round(Number(Settings.ParticleCount) || 1600)));
  const Bounds = ComputeSceneBounds(ForceNodes);
  if (!Sys.Initialized) {
    ResetFlowParticles(Sys, ForceNodes, Settings, TimeSec, SelectedId);
  }
  const AdvectGain = Math.max(0.04, Math.min(0.85, Number(Settings.ParticleSpeedScale) || 0.24));
  const SafeDt = Math.max(0.002, Math.min(0.05, Dt));
  const TrailLen = Math.max(3, Math.min(Sys.TrailLen, Math.round(Number(Settings.ParticleTrailLength) || 10)));

  for (let I = 0; I < ActiveCount; ++I) {
    Sys.Age[I] += SafeDt;
    const I3 = I * 3;
    let Px = Sys.Pos[I3], Py = Sys.Pos[I3 + 1], Pz = Sys.Pos[I3 + 2];

    // RK2 Midpoint Advection
    const V1 = EvaluateSceneForceFieldAt(ForceNodes, Px, Py, Pz, TimeSec);
    const S1 = Math.hypot(V1[0], V1[1], V1[2]);
    if (S1 < 0.05 && Sys.Age[I] > 0.35) {
      SpawnSingleParticle(Sys, I, ForceNodes, Bounds, Settings, TimeSec, SelectedId);
      continue;
    }

    const HalfH = SafeDt * AdvectGain * 0.5;
    const Mx = Px + V1[0] * HalfH;
    const My = Py + V1[1] * HalfH;
    const Mz = Math.max(0.02, Pz + V1[2] * HalfH);
    const V2 = EvaluateSceneForceFieldAt(ForceNodes, Mx, My, Mz, TimeSec);
    const S2 = Math.hypot(V2[0], V2[1], V2[2]);

    // Soft speed clamp to keep extreme singularities crisp and readable
    const ClampedGain = S2 > 36 ? (36 / S2) : 1.0;
    const Step = SafeDt * AdvectGain * ClampedGain;
    Px += V2[0] * Step;
    Py += V2[1] * Step;
    Pz = Math.max(0.02, Pz + V2[2] * Step);

    const OutOfBounds =
      Px < Bounds.MinX - 0.8 || Px > Bounds.MaxX + 0.8 ||
      Py < Bounds.MinY - 0.8 || Py > Bounds.MaxY + 0.8 ||
      Pz < 0.0 || Pz > Bounds.MaxZ + 1.2 ||
      Sys.Age[I] >= Sys.MaxAge[I];

    if (OutOfBounds) {
      SpawnSingleParticle(Sys, I, ForceNodes, Bounds, Settings, TimeSec, SelectedId);
      continue;
    }

    Sys.Pos[I3] = Px;
    Sys.Pos[I3 + 1] = Py;
    Sys.Pos[I3 + 2] = Pz;
    Sys.Speed[I] = S2;

    // Shift trail ring buffer (0 is newest head)
    const TBase = I * Sys.TrailLen * 3;
    const CurLen = Math.min(TrailLen, Sys.TrailCount[I] + 1);
    for (let K = CurLen - 1; K > 0; --K) {
      const Dst = TBase + K * 3;
      const Src = TBase + (K - 1) * 3;
      Sys.Trail[Dst] = Sys.Trail[Src];
      Sys.Trail[Dst + 1] = Sys.Trail[Src + 1];
      Sys.Trail[Dst + 2] = Sys.Trail[Src + 2];
    }
    Sys.Trail[TBase] = Px;
    Sys.Trail[TBase + 1] = Py;
    Sys.Trail[TBase + 2] = Pz;
    Sys.TrailCount[I] = CurLen;
  }
}

export function BuildFlowParticleBuffers(Sys, Settings = DEFAULT_FLOW_VIZ, CameraOrigin = [4.5, -5.2, 3.2]) {
  const ActiveCount = Math.max(100, Math.min(Sys.Capacity, Math.round(Number(Settings.ParticleCount) || 1600)));
  const TrailLen = Math.max(3, Math.min(Sys.TrailLen, Math.round(Number(Settings.ParticleTrailLength) || 10)));
  const FixedMax = Math.max(2.0, Number(Settings.FixedMax) || 24.0);
  const Colormap = Settings.Colormap || "Engineering";
  const Opacity = Math.max(0.1, Math.min(1.0, Number(Settings.ParticleOpacity) || 0.92));
  const SizeScale = Math.max(0.35, Math.min(2.5, Number(Settings.ParticleSize) || 1.0));

  const TrailVerts = [];
  const HeadPoints = [];

  for (let I = 0; I < ActiveCount; ++I) {
    const Cnt = Math.min(TrailLen, Sys.TrailCount[I]);
    if (Cnt < 1) continue;
    const LifeU = Math.max(0, Math.min(1, Sys.Age[I] / Math.max(0.2, Sys.MaxAge[I])));
    const Fade = Math.sin(Math.PI * LifeU);
    if (Fade < 0.04) continue;

    const Share = Math.min(1, Sys.Speed[I] / FixedMax);
    const Rgb = SampleFieldColormap(Colormap, Share);
    const HeadRgb = [
      Math.min(1, Rgb[0] * 0.72 + 0.32),
      Math.min(1, Rgb[1] * 0.72 + 0.34),
      Math.min(1, Rgb[2] * 0.72 + 0.38),
    ];

    const I3 = I * 3;
    HeadPoints.push(
      Sys.Pos[I3], Sys.Pos[I3 + 1], Sys.Pos[I3 + 2],
      HeadRgb[0], HeadRgb[1], HeadRgb[2], Math.min(1.0, 0.92 * Fade * Opacity),
      (2.4 + 2.8 * Share) * SizeScale,
    );

    if (Cnt >= 2) {
      const TBase = I * Sys.TrailLen * 3;
      const BaseHalfW = 0.0085 * SizeScale;
      for (let K = 0; K < Cnt - 1; ++K) {
        const A = TBase + K * 3;
        const B = TBase + (K + 1) * 3;
        const P0 = [Sys.Trail[A], Sys.Trail[A + 1], Sys.Trail[A + 2]];
        const P1 = [Sys.Trail[B], Sys.Trail[B + 1], Sys.Trail[B + 2]];
        const SegLen = Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]);
        if (SegLen > 0.65 || SegLen < 1e-5) continue; // skip teleport wraps

        const W0 = 1.0 - K / Cnt;
        const W1 = 1.0 - (K + 1) / Cnt;
        const Col0 = [HeadRgb[0], HeadRgb[1], HeadRgb[2], 0.78 * W0 * W0 * Fade * Opacity];
        const Col1 = [Rgb[0] * 0.7, Rgb[1] * 0.7, Rgb[2] * 0.7, 0.55 * W1 * W1 * Fade * Opacity];

        const Dx = P1[0] - P0[0], Dy = P1[1] - P0[1], Dz = P1[2] - P0[2];
        const Cx = CameraOrigin[0] - P0[0], Cy = CameraOrigin[1] - P0[1], Cz = CameraOrigin[2] - P0[2];
        let Sx = Dy * Cz - Dz * Cy;
        let Sy = Dz * Cx - Dx * Cz;
        let Sz = Dx * Cy - Dy * Cx;
        const SL = Math.hypot(Sx, Sy, Sz);
        if (SL < 1e-6) continue;
        Sx /= SL; Sy /= SL; Sz /= SL;

        const R0 = BaseHalfW * (0.25 + 0.85 * W0);
        const R1 = BaseHalfW * (0.25 + 0.85 * W1);
        const V00 = [P0[0] - Sx * R0, P0[1] - Sy * R0, P0[2] - Sz * R0];
        const V01 = [P0[0] + Sx * R0, P0[1] + Sy * R0, P0[2] + Sz * R0];
        const V10 = [P1[0] - Sx * R1, P1[1] - Sy * R1, P1[2] - Sz * R1];
        const V11 = [P1[0] + Sx * R1, P1[1] + Sy * R1, P1[2] + Sz * R1];

        // 7 floats per vertex: x, y, z, r, g, b, a
        TrailVerts.push(
          V00[0], V00[1], V00[2], Col0[0], Col0[1], Col0[2], Col0[3],
          V01[0], V01[1], V01[2], Col0[0], Col0[1], Col0[2], Col0[3],
          V11[0], V11[1], V11[2], Col1[0], Col1[1], Col1[2], Col1[3],
          V00[0], V00[1], V00[2], Col0[0], Col0[1], Col0[2], Col0[3],
          V11[0], V11[1], V11[2], Col1[0], Col1[1], Col1[2], Col1[3],
          V10[0], V10[1], V10[2], Col1[0], Col1[1], Col1[2], Col1[3],
        );
      }
    }
  }

  return {
    TrailBuffer: new Float32Array(TrailVerts),
    TrailVertexCount: TrailVerts.length / 7,
    HeadBuffer: new Float32Array(HeadPoints),
    HeadCount: HeadPoints.length / 8,
  };
}

//------------------------------------------------------------------------------------------------------------------------
//                                      3D OVERLAY MESH BUILDERS (12-FLOAT VERTEX STRIDE)
//------------------------------------------------------------------------------------------------------------------------
// Vertex stride: 12 floats = [x, y, z, nx, ny, nz, r, g, b, a, emissive, contourKey]

function PushLitTri(Out, P0, P1, P2, N0, N1, N2, C0, C1, C2, Emissive = 0.0, Contour = -1.0) {
  Out.push(
    P0[0], P0[1], P0[2], N0[0], N0[1], N0[2], C0[0], C0[1], C0[2], C0[3], Emissive, Contour,
    P1[0], P1[1], P1[2], N1[0], N1[1], N1[2], C1[0], C1[1], C1[2], C1[3], Emissive, Contour,
    P2[0], P2[1], P2[2], N2[0], N2[1], N2[2], C2[0], C2[1], C2[2], C2[3], Emissive, Contour,
  );
}

function PushSolidSphere(Out, Center, Radius, Rgba, Stacks = 8, Slices = 14, Emissive = 0.25) {
  for (let I = 0; I < Stacks; ++I) {
    const Phi0 = (I / Stacks) * Math.PI;
    const Phi1 = ((I + 1) / Stacks) * Math.PI;
    for (let J = 0; J < Slices; ++J) {
      const Th0 = (J / Slices) * TWO_PI;
      const Th1 = ((J + 1) / Slices) * TWO_PI;
      const Pt = (P, T) => {
        const Nx = Math.sin(P) * Math.cos(T);
        const Ny = Math.sin(P) * Math.sin(T);
        const Nz = Math.cos(P);
        return [
          [Center[0] + Nx * Radius, Center[1] + Ny * Radius, Center[2] + Nz * Radius],
          [Nx, Ny, Nz],
        ];
      };
      const [A, NA] = Pt(Phi0, Th0);
      const [B, NB] = Pt(Phi1, Th0);
      const [C, NC] = Pt(Phi1, Th1);
      const [D, ND] = Pt(Phi0, Th1);
      PushLitTri(Out, A, B, C, NA, NB, NC, Rgba, Rgba, Rgba, Emissive);
      PushLitTri(Out, A, C, D, NA, NC, ND, Rgba, Rgba, Rgba, Emissive);
    }
  }
}

function PushFresnelSphereShell(Out, Center, Radius, TintRgb, Selected, CameraOrigin, Stacks = 14, Slices = 24) {
  const BaseAlpha = Selected ? 0.14 : 0.075;
  const RimBoost = Selected ? 0.56 : 0.34;
  for (let I = 0; I < Stacks; ++I) {
    const Phi0 = (I / Stacks) * Math.PI;
    const Phi1 = ((I + 1) / Stacks) * Math.PI;
    for (let J = 0; J < Slices; ++J) {
      const Th0 = (J / Slices) * TWO_PI;
      const Th1 = ((J + 1) / Slices) * TWO_PI;
      const Pt = (P, T) => {
        const Nx = Math.sin(P) * Math.cos(T);
        const Ny = Math.sin(P) * Math.sin(T);
        const Nz = Math.cos(P);
        const Px = Center[0] + Nx * Radius;
        const Py = Center[1] + Ny * Radius;
        const Pz = Center[2] + Nz * Radius;
        const Vx = CameraOrigin[0] - Px, Vy = CameraOrigin[1] - Py, Vz = CameraOrigin[2] - Pz;
        const VL = Math.hypot(Vx, Vy, Vz) || 1;
        const Ndv = Math.abs((Nx * Vx + Ny * Vy + Nz * Vz) / VL);
        const Fres = Math.pow(1.0 - Ndv, 2.25);
        const Alpha = BaseAlpha + RimBoost * Fres;
        return [
          [Px, Py, Pz],
          [Nx, Ny, Nz],
          [TintRgb[0], TintRgb[1], TintRgb[2], Alpha],
        ];
      };
      const [A, NA, CA] = Pt(Phi0, Th0);
      const [B, NB, CB] = Pt(Phi1, Th0);
      const [C, NC, CC] = Pt(Phi1, Th1);
      const [D, ND, CD] = Pt(Phi0, Th1);
      PushLitTri(Out, A, B, C, NA, NB, NC, CA, CB, CC, 0.25);
      PushLitTri(Out, A, C, D, NA, NC, ND, CA, CC, CD, 0.25);
    }
  }
}

function PushFresnelColumnShell(Out, Center, Radius, HalfHeight, TintRgb, Selected, CameraOrigin, Slices = 24) {
  const BaseAlpha = Selected ? 0.13 : 0.065;
  const RimBoost = Selected ? 0.52 : 0.30;
  for (let J = 0; J < Slices; ++J) {
    const Th0 = (J / Slices) * TWO_PI;
    const Th1 = ((J + 1) / Slices) * TWO_PI;
    const Sample = (Th, ZOff) => {
      const Nx = Math.cos(Th), Ny = Math.sin(Th);
      const Px = Center[0] + Nx * Radius, Py = Center[1] + Ny * Radius, Pz = Center[2] + ZOff;
      const Vx = CameraOrigin[0] - Px, Vy = CameraOrigin[1] - Py, Vz = CameraOrigin[2] - Pz;
      const VL = Math.hypot(Vx, Vy, Vz) || 1;
      const Ndv = Math.abs((Nx * Vx + Ny * Vy) / VL);
      const Fres = Math.pow(1.0 - Ndv, 2.1);
      return [[Px, Py, Pz], [Nx, Ny, 0], [TintRgb[0], TintRgb[1], TintRgb[2], BaseAlpha + RimBoost * Fres]];
    };
    const [A, NA, CA] = Sample(Th0, -HalfHeight);
    const [B, NB, CB] = Sample(Th0, +HalfHeight);
    const [C, NC, CC] = Sample(Th1, +HalfHeight);
    const [D, ND, CD] = Sample(Th1, -HalfHeight);
    PushLitTri(Out, A, B, C, NA, NB, NC, CA, CB, CC, 0.2);
    PushLitTri(Out, A, C, D, NA, NC, ND, CA, CC, CD, 0.2);
  }
}

function OrthoBasis(Dir) {
  const L = Math.hypot(Dir[0], Dir[1], Dir[2]) || 1;
  const Dx = Dir[0] / L, Dy = Dir[1] / L, Dz = Dir[2] / L;
  const Up = Math.abs(Dz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let Ux = Up[1] * Dz - Up[2] * Dy;
  let Uy = Up[2] * Dx - Up[0] * Dz;
  let Uz = Up[0] * Dy - Up[1] * Dx;
  const UL = Math.hypot(Ux, Uy, Uz) || 1;
  Ux /= UL; Uy /= UL; Uz /= UL;
  const Vx = Dy * Uz - Dz * Uy;
  const Vy = Dz * Ux - Dx * Uz;
  const Vz = Dx * Uy - Dy * Ux;
  return [[Dx, Dy, Dz], [Ux, Uy, Uz], [Vx, Vy, Vz]];
}

function PushTubeSegment(Out, P0, P1, Radius, Rgba, Sides = 5, Emissive = 0.2) {
  const Dx = P1[0] - P0[0], Dy = P1[1] - P0[1], Dz = P1[2] - P0[2];
  if (Math.hypot(Dx, Dy, Dz) < 1e-6) return;
  const [, U, V] = OrthoBasis([Dx, Dy, Dz]);
  for (let S = 0; S < Sides; ++S) {
    const A0 = (S / Sides) * TWO_PI, A1 = ((S + 1) / Sides) * TWO_PI;
    const C0 = Math.cos(A0), S0 = Math.sin(A0), C1 = Math.cos(A1), S1 = Math.sin(A1);
    const N0 = [U[0] * C0 + V[0] * S0, U[1] * C0 + V[1] * S0, U[2] * C0 + V[2] * S0];
    const N1 = [U[0] * C1 + V[0] * S1, U[1] * C1 + V[1] * S1, U[2] * C1 + V[2] * S1];
    const Q0 = [P0[0] + N0[0] * Radius, P0[1] + N0[1] * Radius, P0[2] + N0[2] * Radius];
    const Q1 = [P0[0] + N1[0] * Radius, P0[1] + N1[1] * Radius, P0[2] + N1[2] * Radius];
    const Q2 = [P1[0] + N1[0] * Radius, P1[1] + N1[1] * Radius, P1[2] + N1[2] * Radius];
    const Q3 = [P1[0] + N0[0] * Radius, P1[1] + N0[1] * Radius, P1[2] + N0[2] * Radius];
    PushLitTri(Out, Q0, Q1, Q2, N0, N1, N1, Rgba, Rgba, Rgba, Emissive);
    PushLitTri(Out, Q0, Q2, Q3, N0, N1, N0, Rgba, Rgba, Rgba, Emissive);
  }
}

function PushArrow3D(Out, Origin, Dir, Length, ShaftR, Rgba) {
  const [D, U, V] = OrthoBasis(Dir);
  const ShaftLen = Length * 0.68;
  const Tip = [Origin[0] + D[0] * Length, Origin[1] + D[1] * Length, Origin[2] + D[2] * Length];
  const Neck = [Origin[0] + D[0] * ShaftLen, Origin[1] + D[1] * ShaftLen, Origin[2] + D[2] * ShaftLen];
  PushTubeSegment(Out, Origin, Neck, ShaftR, Rgba, 5, 0.25);

  const ConeR = ShaftR * 2.55;
  const Sides = 6;
  for (let S = 0; S < Sides; ++S) {
    const A0 = (S / Sides) * TWO_PI, A1 = ((S + 1) / Sides) * TWO_PI;
    const C0 = Math.cos(A0), S0 = Math.sin(A0), C1 = Math.cos(A1), S1 = Math.sin(A1);
    const N0 = [U[0] * C0 + V[0] * S0, U[1] * C0 + V[1] * S0, U[2] * C0 + V[2] * S0];
    const N1 = [U[0] * C1 + V[0] * S1, U[1] * C1 + V[1] * S1, U[2] * C1 + V[2] * S1];
    const B0 = [Neck[0] + N0[0] * ConeR, Neck[1] + N0[1] * ConeR, Neck[2] + N0[2] * ConeR];
    const B1 = [Neck[0] + N1[0] * ConeR, Neck[1] + N1[1] * ConeR, Neck[2] + N1[2] * ConeR];
    PushLitTri(Out, B0, B1, Tip, N0, N1, D, Rgba, Rgba, Rgba, 0.35);
  }
}

function PushCircleRing(Out, Center, AxisU, AxisV, Radius, TubeR, Rgba, Segs = 32, Dashed = false) {
  for (let S = 0; S < Segs; ++S) {
    if (Dashed && S % 2 === 1) continue;
    const A0 = (S / Segs) * TWO_PI, A1 = ((S + 1) / Segs) * TWO_PI;
    const P0 = [
      Center[0] + (Math.cos(A0) * AxisU[0] + Math.sin(A0) * AxisV[0]) * Radius,
      Center[1] + (Math.cos(A0) * AxisU[1] + Math.sin(A0) * AxisV[1]) * Radius,
      Center[2] + (Math.cos(A0) * AxisU[2] + Math.sin(A0) * AxisV[2]) * Radius,
    ];
    const P1 = [
      Center[0] + (Math.cos(A1) * AxisU[0] + Math.sin(A1) * AxisV[0]) * Radius,
      Center[1] + (Math.cos(A1) * AxisU[1] + Math.sin(A1) * AxisV[1]) * Radius,
      Center[2] + (Math.cos(A1) * AxisU[2] + Math.sin(A1) * AxisV[2]) * Radius,
    ];
    PushTubeSegment(Out, P0, P1, TubeR, Rgba, 4, 0.25);
  }
}

function PushRibbonQuad(Out, P0, P1, HalfW0, HalfW1, Col0, Col1, CameraOrigin) {
  const Dx = P1[0] - P0[0], Dy = P1[1] - P0[1], Dz = P1[2] - P0[2];
  if (Math.hypot(Dx, Dy, Dz) < 1e-6) return;
  const Cx = CameraOrigin[0] - P0[0], Cy = CameraOrigin[1] - P0[1], Cz = CameraOrigin[2] - P0[2];
  let Sx = Dy * Cz - Dz * Cy;
  let Sy = Dz * Cx - Dx * Cz;
  let Sz = Dx * Cy - Dy * Cx;
  const SL = Math.hypot(Sx, Sy, Sz);
  if (SL < 1e-6) return;
  Sx /= SL; Sy /= SL; Sz /= SL;
  const N = [0, 0, 1];
  const A = [P0[0] - Sx * HalfW0, P0[1] - Sy * HalfW0, P0[2] - Sz * HalfW0];
  const B = [P0[0] + Sx * HalfW0, P0[1] + Sy * HalfW0, P0[2] + Sz * HalfW0];
  const C = [P1[0] + Sx * HalfW1, P1[1] + Sy * HalfW1, P1[2] + Sz * HalfW1];
  const D = [P1[0] - Sx * HalfW1, P1[1] - Sy * HalfW1, P1[2] - Sz * HalfW1];
  PushLitTri(Out, A, B, C, N, N, N, Col0, Col0, Col1, 0.85);
  PushLitTri(Out, A, C, D, N, N, N, Col0, Col1, Col1, 0.85);
}

function EvaluateQuantityScalar(ForceNodes, Px, Py, Pz, Quantity, TimeSec, FixedMax) {
  if (Quantity === "Curl" || Quantity === "Divergence") {
    const Tel = EvaluateSceneCompositeTelemetry(ForceNodes, Px, Py, Pz, TimeSec, 0.12);
    if (Quantity === "Curl") return { Val: Tel.CurlMag, Share01: Math.min(1, Tel.CurlMag / Math.max(1, FixedMax)) };
    const Signed = Tel.Divergence / Math.max(1, FixedMax * 0.5);
    return { Val: Tel.Divergence, Share01: Math.max(0, Math.min(1, 0.5 + 0.5 * Signed)) };
  }
  const V = EvaluateSceneForceFieldAt(ForceNodes, Px, Py, Pz, TimeSec);
  const Spd = Math.hypot(V[0], V[1], V[2]);
  if (Quantity === "Pressure") {
    const Q = 0.5 * 1.225 * Spd * Spd;
    return { Val: Q, Share01: Math.min(1, Q / Math.max(10, FixedMax * FixedMax * 0.35)) };
  }
  return { Val: Spd, Share01: Math.min(1, Spd / Math.max(2, FixedMax)) };
}

function BuildHeatmapSliceMesh(Out, ForceNodes, Bounds, Axis, Offset, Settings, TimeSec) {
  const Res = 26;
  const FixedMax = Math.max(2.0, Number(Settings.FixedMax) || 24.0);
  const Colormap = Settings.Colormap || "Engineering";
  const Opacity = Math.max(0.08, Math.min(0.95, Number(Settings.HeatmapOpacity) || 0.56));
  const Quantity = Settings.Quantity || "Speed";

  const Grid = [];
  for (let J = 0; J <= Res; ++J) {
    const V = J / Res;
    const Row = [];
    for (let I = 0; I <= Res; ++I) {
      const U = I / Res;
      let P;
      let Normal;
      if (Axis === "XZ") {
        P = [Bounds.MinX + U * (Bounds.MaxX - Bounds.MinX), Bounds.CenterY + Offset, Bounds.MinZ + V * (Bounds.MaxZ - Bounds.MinZ)];
        Normal = [0, 1, 0];
      } else if (Axis === "YZ") {
        P = [Bounds.CenterX + Offset, Bounds.MinY + U * (Bounds.MaxY - Bounds.MinY), Bounds.MinZ + V * (Bounds.MaxZ - Bounds.MinZ)];
        Normal = [1, 0, 0];
      } else {
        P = [Bounds.MinX + U * (Bounds.MaxX - Bounds.MinX), Bounds.MinY + V * (Bounds.MaxY - Bounds.MinY), Math.max(0.02, Bounds.BaseSliceZ + Offset)];
        Normal = [0, 0, 1];
      }
      const { Share01 } = EvaluateQuantityScalar(ForceNodes, P[0], P[1], P[2], Quantity, TimeSec, FixedMax);
      const Rgb = SampleFieldColormap(Colormap, Share01);
      const EdgeFade = Math.sin(Math.PI * Math.pow(Math.sin(Math.PI * U) * Math.sin(Math.PI * V), 0.25));
      const Alpha = Opacity * (0.12 + 0.88 * Math.pow(Share01, 0.55)) * EdgeFade;
      Row.push({ P, Normal, Col: [Rgb[0], Rgb[1], Rgb[2], Alpha], Contour: Share01 });
    }
    Grid.push(Row);
  }

  for (let J = 0; J < Res; ++J) {
    for (let I = 0; I < Res; ++I) {
      const A = Grid[J][I], B = Grid[J][I + 1], C = Grid[J + 1][I + 1], D = Grid[J + 1][I];
      PushLitTri(Out, A.P, B.P, C.P, A.Normal, B.Normal, C.Normal, A.Col, B.Col, C.Col, 0.15, (A.Contour + B.Contour + C.Contour) / 3);
      PushLitTri(Out, A.P, C.P, D.P, A.Normal, C.Normal, D.Normal, A.Col, C.Col, D.Col, 0.15, (A.Contour + C.Contour + D.Contour) / 3);
    }
  }
}

function TraceBidirectionalStreamline(ForceNodes, Seed, Bounds, StepsPerDir, StepLen, TimeSec) {
  const Integrate = (DirSign) => {
    const Pts = [];
    let P = [...Seed];
    for (let S = 0; S < StepsPerDir; ++S) {
      const V1 = EvaluateSceneForceFieldAt(ForceNodes, P[0], P[1], P[2], TimeSec);
      const S1 = Math.hypot(V1[0], V1[1], V1[2]);
      if (S1 < 0.18) break;
      const D1 = [V1[0] / S1, V1[1] / S1, V1[2] / S1];

      const H = StepLen * DirSign;
      const P2 = [P[0] + D1[0] * H * 0.5, P[1] + D1[1] * H * 0.5, P[2] + D1[2] * H * 0.5];
      const V2 = EvaluateSceneForceFieldAt(ForceNodes, P2[0], P2[1], P2[2], TimeSec);
      const S2 = Math.hypot(V2[0], V2[1], V2[2]) || S1;
      const D2 = [V2[0] / S2, V2[1] / S2, V2[2] / S2];

      const P3 = [P[0] + D2[0] * H * 0.5, P[1] + D2[1] * H * 0.5, P[2] + D2[2] * H * 0.5];
      const V3 = EvaluateSceneForceFieldAt(ForceNodes, P3[0], P3[1], P3[2], TimeSec);
      const S3 = Math.hypot(V3[0], V3[1], V3[2]) || S2;
      const D3 = [V3[0] / S3, V3[1] / S3, V3[2] / S3];

      const P4 = [P[0] + D3[0] * H, P[1] + D3[1] * H, P[2] + D3[2] * H];
      const V4 = EvaluateSceneForceFieldAt(ForceNodes, P4[0], P4[1], P4[2], TimeSec);
      const S4 = Math.hypot(V4[0], V4[1], V4[2]) || S3;
      const D4 = [V4[0] / S4, V4[1] / S4, V4[2] / S4];

      const AvgD = [(D1[0] + 2 * D2[0] + 2 * D3[0] + D4[0]) / 6, (D1[1] + 2 * D2[1] + 2 * D3[1] + D4[1]) / 6, (D1[2] + 2 * D2[2] + 2 * D3[2] + D4[2]) / 6];
      const Next = [P[0] + AvgD[0] * H, P[1] + AvgD[1] * H, Math.max(0.02, P[2] + AvgD[2] * H)];
      if (Next[0] < Bounds.MinX - 0.6 || Next[0] > Bounds.MaxX + 0.6 || Next[1] < Bounds.MinY - 0.6 || Next[1] > Bounds.MaxY + 0.6 || Next[2] > Bounds.MaxZ + 0.8) break;
      Pts.push([Next[0], Next[1], Next[2], S1]);
      P = Next;
    }
    return Pts;
  };

  const Back = Integrate(-1).reverse();
  const V0 = EvaluateSceneForceFieldAt(ForceNodes, Seed[0], Seed[1], Seed[2], TimeSec);
  const S0 = Math.hypot(V0[0], V0[1], V0[2]);
  const Fwd = Integrate(+1);
  return [...Back, [Seed[0], Seed[1], Seed[2], S0], ...Fwd];
}

function ResolveStreamlineRgb(Settings, Share01, ZPos, Bounds) {
  const Mode = Settings.StreamColorMode || "CyanSingle";
  if (Mode === "CyanSingle") return [0.41, 0.86, 1.0];
  if (Mode === "CustomSingle") return HexToRgb01(Settings.StreamSingleColor || "#68dcff");
  if (Mode === "Elevation") {
    const ZShare = Math.max(0, Math.min(1, (ZPos - Bounds.MinZ) / Math.max(0.25, Bounds.MaxZ - Bounds.MinZ)));
    return SampleFieldColormap("Plasma", ZShare);
  }
  return SampleFieldColormap(Settings.Colormap || "Engineering", Share01);
}

export function BuildForceOverlayGeometry(
  ForceNodes,
  OverlaySettings = DEFAULT_FLOW_VIZ,
  SelectedId = null,
  TimeSec = 0,
  CameraOrigin = [4.5, -5.2, 3.2],
) {
  const Settings = { ...DEFAULT_FLOW_VIZ, ...(OverlaySettings || {}) };
  const OpaqueVerts = [];
  const TranslucentVerts = [];
  const PickBeacons = [];
  const Labels = [];

  if (!Settings.Enabled || !Array.isArray(ForceNodes) || ForceNodes.length === 0) {
    return {
      OpaqueBuffer: new Float32Array(0),
      OpaqueVertexCount: 0,
      TranslucentBuffer: new Float32Array(0),
      TranslucentVertexCount: 0,
      PickBeacons,
      Labels,
    };
  }

  const EffectiveNodes = GetEffectiveForceNodes(ForceNodes);
  const ActiveNodes = [];

  for (const Node of ForceNodes) {
    if (!Node || Node.Hidden) continue;
    const F = ResolveForceValues(Node.Force);
    const Meta = GetForceModelMeta(F.Model);
    const BaseCenter = Node.Position || [0, 0, 0.9];
    const Center = EvaluateMotionCenter(BaseCenter, F, TimeSec);
    const IsSelected = Node.Id === SelectedId;
    const IsEffective = EffectiveNodes.includes(Node);
    const DomainRgb = HexToRgb01(Meta.Color);

    const BeaconR = Math.max(0.065, Math.min(0.13, F.Radius * 0.052));
    PickBeacons.push({ Id: Node.Id, Center, Radius: BeaconR * 2.5 });
    Labels.push({
      Id: Node.Id,
      Name: Node.Name,
      ModelName: Meta.Name,
      Strength: F.Strength,
      Unit: Meta.Unit,
      Center,
      Color: Meta.Color,
      Selected: IsSelected,
      Active: F.Enabled && IsEffective,
    });

    const BeaconRgba = IsSelected
      ? [1.0, 0.76, 0.28, 1.0]
      : F.Enabled && IsEffective
        ? [Math.min(1, DomainRgb[0] * 1.15 + 0.08), Math.min(1, DomainRgb[1] * 1.15 + 0.08), Math.min(1, DomainRgb[2] * 1.15 + 0.08), 1.0]
        : [0.38, 0.4, 0.44, 0.85];
    PushSolidSphere(OpaqueVerts, Center, BeaconR, BeaconRgba, 7, 12, 0.35);

    // Direction indicator spear for directional generators
    if (F.Enabled && IsEffective) {
      const RotYaw = ((Node.Rotation?.[2] || 0) + F.YawDeg) * DEG_TO_RAD;
      const RotPitch = ((Node.Rotation?.[1] || 0) + F.PitchDeg) * DEG_TO_RAD;
      const Dir = [
        Math.cos(RotPitch) * Math.cos(RotYaw),
        Math.cos(RotPitch) * Math.sin(RotYaw),
        Math.sin(RotPitch),
      ];
      if (["LinearWind", "FlowStream", "AtmosphericGust", "Drag", "BoundaryAdhesion"].includes(F.Model)) {
        PushArrow3D(OpaqueVerts, Center, Dir, Math.min(0.7, F.Radius * 0.36), 0.015, BeaconRgba);
      } else if (["Buoyancy", "LorentzField", "MagneticDipole"].includes(F.Model)) {
        PushArrow3D(OpaqueVerts, Center, [0, 0, 1], Math.min(0.65, F.Radius * 0.34), 0.015, BeaconRgba);
      } else if (["RotationalColumn", "Torque", "VorticityConfinement"].includes(F.Model)) {
        PushCircleRing(OpaqueVerts, Center, [1, 0, 0], [0, 1, 0], Math.max(0.24, F.CoreRadius * 0.72), 0.011, BeaconRgba, 24, false);
      }
      ActiveNodes.push({ Node, F, Meta, BaseCenter, Center, IsSelected, DomainRgb });
    }
  }

  if (ActiveNodes.length === 0) {
    return {
      OpaqueBuffer: new Float32Array(OpaqueVerts),
      OpaqueVertexCount: OpaqueVerts.length / 12,
      TranslucentBuffer: new Float32Array(TranslucentVerts),
      TranslucentVertexCount: TranslucentVerts.length / 12,
      PickBeacons,
      Labels,
    };
  }

  const Bounds = ComputeSceneBounds(ForceNodes);
  const FixedMax = Math.max(2.0, Number(Settings.FixedMax) || 24.0);

  // 1. Cross-Section Heatmap Slice(s)
  if (Settings.ShowHeatmap !== false && Settings.SliceEnabled !== false) {
    const AxisMode = Settings.SliceAxis || "XY";
    const Offset = Number(Settings.SliceOffset) || 0.0;
    if (AxisMode === "ALL") {
      BuildHeatmapSliceMesh(TranslucentVerts, ForceNodes, Bounds, "XY", Offset, Settings, TimeSec);
      BuildHeatmapSliceMesh(TranslucentVerts, ForceNodes, Bounds, "XZ", Offset, Settings, TimeSec);
      BuildHeatmapSliceMesh(TranslucentVerts, ForceNodes, Bounds, "YZ", Offset, Settings, TimeSec);
    } else {
      BuildHeatmapSliceMesh(TranslucentVerts, ForceNodes, Bounds, AxisMode, Offset, Settings, TimeSec);
    }
  }

  // 2. Motion Path Trajectories & Waypoints
  if (Settings.ShowMotionPaths) {
    for (const Item of ActiveNodes) {
      const { F, BaseCenter, IsSelected } = Item;
      if (F.MotionTopology === "Static") continue;
      const PathColor = IsSelected ? [1.0, 0.72, 0.25, 0.95] : [0.95, 0.62, 0.28, 0.62];
      const Segs = 36;
      for (let S = 0; S < Segs; ++S) {
        const P0 = EvaluateMotionPositionAtU(BaseCenter, F, S / Segs);
        const P1 = EvaluateMotionPositionAtU(BaseCenter, F, (S + 1) / Segs);
        PushTubeSegment(OpaqueVerts, P0, P1, IsSelected ? 0.014 : 0.010, PathColor, 4, 0.2);
      }
      if (Array.isArray(F.MotionWaypoints) && F.MotionWaypoints.length >= 2) {
        for (const Wp of F.MotionWaypoints) {
          PushSolidSphere(OpaqueVerts, Wp, IsSelected ? 0.045 : 0.034, [1.0, 0.54, 0.16, 1.0], 6, 10, 0.3);
        }
      }
    }
  }

  // 3. 3D Vector Arrow Lattice
  if (Settings.ShowVelocityArrows) {
    const GridN = Math.max(3, Math.min(9, (Number(Settings.ArrowDensity) || 4) + 2));
    const Layers = Math.max(1, Math.min(3, Number(Settings.VolumeLayers) || 1));
    const SpanX = Bounds.MaxX - Bounds.MinX;
    const SpanY = Bounds.MaxY - Bounds.MinY;
    const CellStep = Math.max(SpanX, SpanY) / GridN;
    const Colormap = Settings.Colormap || "Engineering";

    for (let L = 0; L < Layers; ++L) {
      const ZSample =
        Layers === 1
          ? Math.max(0.08, Bounds.BaseSliceZ + (Number(Settings.SliceOffset) || 0) + 0.05)
          : Math.max(0.1, Bounds.MinZ + ((L + 0.5) / Layers) * (Bounds.MaxZ - Bounds.MinZ));
      for (let Iy = 0; Iy < GridN; ++Iy) {
        for (let Ix = 0; Ix < GridN; ++Ix) {
          const Sx = Bounds.MinX + ((Ix + 0.5) / GridN) * SpanX;
          const Sy = Bounds.MinY + ((Iy + 0.5) / GridN) * SpanY;
          const Vec = EvaluateSceneForceFieldAt(ForceNodes, Sx, Sy, ZSample, TimeSec);
          const Spd = Math.hypot(Vec[0], Vec[1], Vec[2]);
          if (Spd < 0.25) continue;
          const Share = Math.min(1, Spd / FixedMax);
          const Dir = [Vec[0] / Spd, Vec[1] / Spd, Vec[2] / Spd];
          const ArrowLen = Math.min(CellStep * 0.82, Math.max(0.14, (0.38 + 0.92 * Share) * (Settings.VectorScale || 0.28) * 1.45));
          const Rgb = SampleFieldColormap(Colormap, Share);
          PushArrow3D(OpaqueVerts, [Sx, Sy, ZSample], Dir, ArrowLen, 0.009 + 0.0045 * Share, [Rgb[0], Rgb[1], Rgb[2], 1.0]);
        }
      }
    }
  }

  // 4. Bidirectional RK4 Streamline Ribbons
  if (Settings.ShowStreamlines !== false) {
    const TotalSeeds = Math.max(20, Math.min(220, Number(Settings.StreamLineCount) || 84));
    const StepsPerDir = Math.max(10, Math.min(50, Math.round((Number(Settings.StreamResolution) || 30) * 0.65)));
    const AvgRadius = ActiveNodes.reduce((Acc, It) => Acc + It.F.Radius, 0) / ActiveNodes.length;
    const StepLen = Math.max(0.05, Math.min(0.16, AvgRadius * 0.068));
    const GoldenAngle = Math.PI * (3 - Math.sqrt(5));
    const Curves = [];

    const SeedsPerNode = Math.max(8, Math.ceil(TotalSeeds / ActiveNodes.length));
    for (let NIdx = 0; NIdx < ActiveNodes.length; ++NIdx) {
      const { Center, F } = ActiveNodes[NIdx];
      const RSeedMax = Math.min(F.Radius * 0.88, 4.5);
      for (let S = 0; S < SeedsPerNode && Curves.length < TotalSeeds; ++S) {
        const Frac = (S + 0.5) / SeedsPerNode;
        const ZNorm = 1 - 2 * Frac;
        const RadXY = Math.sqrt(Math.max(0, 1 - ZNorm * ZNorm));
        const Theta = S * GoldenAngle + NIdx * 1.17;
        const ShellFrac = 0.22 + 0.7 * ((S * 0.6180339887) % 1);
        const Seed = [
          Center[0] + Math.cos(Theta) * RadXY * RSeedMax * ShellFrac,
          Center[1] + Math.sin(Theta) * RadXY * RSeedMax * ShellFrac,
          Math.max(0.08, Center[2] + ZNorm * RSeedMax * ShellFrac * 0.75),
        ];
        const Curve = TraceBidirectionalStreamline(ForceNodes, Seed, Bounds, StepsPerDir, StepLen, TimeSec);
        if (Curve.length >= 4) Curves.push({ Curve, SeedIdx: Curves.length });
      }
    }

    const BaseHalfW = 0.0082 * Math.max(0.25, Number(Settings.StreamThickness) || 0.85);
    const Emissive = Math.max(0.25, Number(Settings.StreamEmissive) || 1.05);
    const Opacity = Math.max(0.15, Math.min(1.0, Number(Settings.StreamOpacity) || 0.86));

    for (const { Curve, SeedIdx } of Curves) {
      const Len = Curve.length;
      const StrandSeed = (SeedIdx * 0.3719) % 1;
      const SpeedRate = 0.24 + 0.14 * ((SeedIdx * 0.713) % 1);
      const HeadPos = ((((StrandSeed + TimeSec * SpeedRate) % 1) + 1) % 1) * 1.25;

      for (let I = 0; I < Len - 1; ++I) {
        const P0 = Curve[I], P1 = Curve[I + 1];
        const U0 = I / (Len - 1), U1 = (I + 1) / (Len - 1);
        const Taper0 = Math.pow(Math.sin(Math.PI * U0), 0.38);
        const Taper1 = Math.pow(Math.sin(Math.PI * U1), 0.38);
        const Share0 = Math.min(1, P0[3] / FixedMax);
        const Share1 = Math.min(1, P1[3] / FixedMax);

        const BaseRgb0 = ResolveStreamlineRgb(Settings, Share0, P0[2], Bounds);
        const BaseRgb1 = ResolveStreamlineRgb(Settings, Share1, P1[2], Bounds);

        const EvalLit = (U, BaseRgb) => {
          const Dist = HeadPos - U;
          const Streak = Dist >= 0 && Dist <= 0.26 ? Math.pow(1 - Dist / 0.26, 1.5) * Math.min(1, Dist / 0.04) : 0;
          const Gain = (0.64 + 0.78 * Streak) * Emissive;
          return [
            Math.min(1, BaseRgb[0] * Gain + Streak * 0.24),
            Math.min(1, BaseRgb[1] * Gain + Streak * 0.26),
            Math.min(1, BaseRgb[2] * Gain + Streak * 0.28),
            Math.min(0.95, (0.48 + 0.46 * Streak) * Opacity),
          ];
        };

        const Col0 = EvalLit(U0, BaseRgb0);
        const Col1 = EvalLit(U1, BaseRgb1);
        Col0[3] *= Taper0;
        Col1[3] *= Taper1;
        PushRibbonQuad(
          TranslucentVerts,
          P0,
          P1,
          BaseHalfW * (0.45 + 0.75 * Taper0),
          BaseHalfW * (0.45 + 0.75 * Taper1),
          Col0,
          Col1,
          CameraOrigin,
        );
      }
    }
  }

  // 5. Fresnel Volumetric Reach Envelopes & Impulse Wavefront Shells
  if (Settings.ShowEnvelopes) {
    for (const Item of ActiveNodes) {
      const { F, Center, IsSelected, DomainRgb } = Item;
      if (F.Reach === "Infinite") continue;
      const R = F.Radius;
      const ShellTint = IsSelected
        ? [0.98, 0.78, 0.36]
        : [0.35 * DomainRgb[0] + 0.25, 0.35 * DomainRgb[1] + 0.58, 0.35 * DomainRgb[2] + 0.65];
      const RingRgba = [ShellTint[0], ShellTint[1], ShellTint[2], IsSelected ? 0.62 : 0.28];
      const WireR = IsSelected ? 0.008 : 0.005;

      if (F.Reach === "Column") {
        const HalfH = R * 0.95;
        PushFresnelColumnShell(TranslucentVerts, Center, R, HalfH, ShellTint, IsSelected, CameraOrigin, 24);
        PushCircleRing(TranslucentVerts, [Center[0], Center[1], Math.max(0.02, Center[2] - HalfH)], [1, 0, 0], [0, 1, 0], R, WireR, RingRgba, 32);
        PushCircleRing(TranslucentVerts, [Center[0], Center[1], Center[2] + HalfH], [1, 0, 0], [0, 1, 0], R, WireR, RingRgba, 32);
      } else if (F.Reach === "Box") {
        const Corners = [
          [-R, -R, -R], [R, -R, -R], [R, R, -R], [-R, R, -R],
          [-R, -R, R], [R, -R, R], [R, R, R], [-R, R, R],
        ].map((O) => [Center[0] + O[0], Center[1] + O[1], Math.max(0.02, Center[2] + O[2])]);
        const Edges = [
          [0, 1], [1, 2], [2, 3], [3, 0],
          [4, 5], [5, 6], [6, 7], [7, 4],
          [0, 4], [1, 5], [2, 6], [3, 7],
        ];
        for (const [I0, I1] of Edges) {
          PushTubeSegment(TranslucentVerts, Corners[I0], Corners[I1], WireR * 1.2, RingRgba, 4, 0.1);
        }
      } else {
        PushFresnelSphereShell(TranslucentVerts, Center, R, ShellTint, IsSelected, CameraOrigin, 14, 24);
        PushCircleRing(TranslucentVerts, Center, [1, 0, 0], [0, 1, 0], R, WireR, RingRgba, 36);
        if (IsSelected && F.CoreRadius > 0.12 && F.CoreRadius < R * 0.95) {
          PushCircleRing(TranslucentVerts, Center, [1, 0, 0], [0, 1, 0], F.CoreRadius, WireR * 0.85, [1.0, 0.85, 0.45, 0.42], 24, true);
        }
      }

      // Active Impulse Wavefront Ring
      if (F.Duration === "Impulse") {
        const WaveR =
          F.LastTriggerTime >= 0 && TimeSec >= F.LastTriggerTime
            ? (TimeSec - F.LastTriggerTime) * F.WaveSpeed
            : (((TimeSec * F.Frequency) % 1.0 + 1.0) % 1.0) * R;
        if (WaveR > 0.08 && WaveR <= R * 1.1) {
          const WaveAlpha = Math.max(0.08, 0.72 * (1.0 - WaveR / (R * 1.12)));
          PushCircleRing(TranslucentVerts, Center, [1, 0, 0], [0, 1, 0], WaveR, 0.012, [1.0, 0.62, 0.34, WaveAlpha], 36, false);
          PushCircleRing(TranslucentVerts, Center, [1, 0, 0], [0, 0, 1], WaveR, 0.008, [1.0, 0.62, 0.34, WaveAlpha * 0.65], 32, false);
        }
      }
    }
  }

  // 6. 3D Flow Probe Marker
  if (Settings.ShowProbeHud !== false && Array.isArray(Settings.ProbePosition)) {
    const P = Settings.ProbePosition;
    PushSolidSphere(OpaqueVerts, P, 0.042, [0.35, 0.96, 0.82, 1.0], 6, 10, 0.4);
    PushCircleRing(TranslucentVerts, P, [1, 0, 0], [0, 1, 0], 0.11, 0.005, [0.35, 0.96, 0.82, 0.72], 24);
  }

  return {
    OpaqueBuffer: new Float32Array(OpaqueVerts),
    OpaqueVertexCount: OpaqueVerts.length / 12,
    TranslucentBuffer: new Float32Array(TranslucentVerts),
    TranslucentVertexCount: TranslucentVerts.length / 12,
    PickBeacons,
    Labels,
  };
}

export function PickForceBeacon(RayOrigin, RayDir, ForceOverlay) {
  const Beacons = ForceOverlay?.PickBeacons || [];
  let BestId = null;
  let BestT = Infinity;
  for (const B of Beacons) {
    const OcX = RayOrigin[0] - B.Center[0];
    const OcY = RayOrigin[1] - B.Center[1];
    const OcZ = RayOrigin[2] - B.Center[2];
    const Proj = OcX * RayDir[0] + OcY * RayDir[1] + OcZ * RayDir[2];
    const C = OcX * OcX + OcY * OcY + OcZ * OcZ - B.Radius * B.Radius;
    const Disc = Proj * Proj - C;
    if (Disc >= 0) {
      const T = -Proj - Math.sqrt(Disc);
      if (T > 0.05 && T < BestT) {
        BestT = T;
        BestId = B.Id;
      }
    }
  }
  return BestId;
}

//------------------------------------------------------------------------------------------------------------------------
//                                           3D TRANSFORM GIZMO MATH
//------------------------------------------------------------------------------------------------------------------------

export const GizmoHandle = {
  None: 0,
  TranslateX: 1,
  TranslateY: 2,
  TranslateZ: 3,
  PlaneYZ: 4,
  PlaneXZ: 5,
  PlaneXY: 6,
  ScaleRadius: 7,
};

export function ComputeGizmoWorldRadius(WorldPos, CamPos, VerticalFovRad = 0.75, OrthoHalfHeight = 0) {
  if (OrthoHalfHeight > 0) return Math.max(0.28, OrthoHalfHeight * 0.28);
  const Dist = Math.hypot(WorldPos[0] - CamPos[0], WorldPos[1] - CamPos[1], WorldPos[2] - CamPos[2]);
  return Math.max(0.26, Dist * Math.tan(VerticalFovRad * 0.5) * 0.28);
}

export function ProjectWorldToScreen(P, ViewProj, Width, Height) {
  const X = ViewProj[0] * P[0] + ViewProj[4] * P[1] + ViewProj[8] * P[2] + ViewProj[12];
  const Y = ViewProj[1] * P[0] + ViewProj[5] * P[1] + ViewProj[9] * P[2] + ViewProj[13];
  const W = ViewProj[3] * P[0] + ViewProj[7] * P[1] + ViewProj[11] * P[2] + ViewProj[15];
  if (W <= 1e-4) return null;
  const NdcX = X / W;
  const NdcY = Y / W;
  return {
    X: (NdcX * 0.5 + 0.5) * Width,
    Y: (0.5 - NdcY * 0.5) * Height,
    Depth: W,
  };
}

function DistPointToSeg2D(Px, Py, Ax, Ay, Bx, By) {
  const Vx = Bx - Ax, Vy = By - Ay;
  const L2 = Vx * Vx + Vy * Vy;
  if (L2 < 1e-5) return Math.hypot(Px - Ax, Py - Ay);
  const T = Math.max(0, Math.min(1, ((Px - Ax) * Vx + (Py - Ay) * Vy) / L2));
  return Math.hypot(Px - (Ax + T * Vx), Py - (Ay + T * Vy));
}

export function PickTransformGizmo2D(MouseX, MouseY, TargetPos, Radius, ViewProj, Width, Height) {
  const C = ProjectWorldToScreen(TargetPos, ViewProj, Width, Height);
  if (!C) return GizmoHandle.None;
  const Axes = [
    { Handle: GizmoHandle.TranslateX, Tip: [TargetPos[0] + Radius, TargetPos[1], TargetPos[2]] },
    { Handle: GizmoHandle.TranslateY, Tip: [TargetPos[0], TargetPos[1] + Radius, TargetPos[2]] },
    { Handle: GizmoHandle.TranslateZ, Tip: [TargetPos[0], TargetPos[1], TargetPos[2] + Radius] },
  ];
  let BestHandle = GizmoHandle.None;
  let BestDist = 13;
  for (const A of Axes) {
    const TipS = ProjectWorldToScreen(A.Tip, ViewProj, Width, Height);
    if (!TipS) continue;
    const D = DistPointToSeg2D(MouseX, MouseY, C.X, C.Y, TipS.X, TipS.Y);
    if (D < BestDist) {
      BestDist = D;
      BestHandle = A.Handle;
    }
  }
  if (BestHandle !== GizmoHandle.None) return BestHandle;

  // Center ring / XY plane handle
  const CenterDist = Math.hypot(MouseX - C.X, MouseY - C.Y);
  if (CenterDist <= 14) return GizmoHandle.PlaneXY;
  return GizmoHandle.None;
}

//------------------------------------------------------------------------------------------------------------------------
//                                        TOML SERIALIZATION & PARSING CODECS
//------------------------------------------------------------------------------------------------------------------------

export function SerializeForceModelToml(SubjectName, ForceValues, Transform = {}) {
  const F = ResolveForceValues(ForceValues);
  const Meta = GetForceModelMeta(F.Model);
  const Pos = Array.isArray(Transform.Position) ? Transform.Position : [0, 0, 0.9];
  const Rot = Array.isArray(Transform.Rotation) ? Transform.Rotation : [0, 0, 0];
  return [
    "# Frontier .ForceModel Specification",
    'Format = "Frontier.ForceModel.v2"',
    `Name = ${JSON.stringify(SubjectName || Meta.Name)}`,
    `ForceModel = ${JSON.stringify(F.Model)}`,
    `Domain = ${JSON.stringify(Meta.Domain)}`,
    `Enabled = ${F.Enabled}`,
    `Strength = ${F.Strength.toFixed(3)}`,
    `Radius = ${F.Radius.toFixed(3)}`,
    `CoreRadius = ${F.CoreRadius.toFixed(3)}`,
    `SwirlRatio = ${F.SwirlRatio.toFixed(3)}`,
    `Frequency = ${F.Frequency.toFixed(3)}`,
    `TurbulenceScale = ${F.TurbulenceScale.toFixed(3)}`,
    `Octaves = ${F.Octaves}`,
    `PitchDeg = ${F.PitchDeg.toFixed(2)}`,
    `YawDeg = ${F.YawDeg.toFixed(2)}`,
    `Reach = ${JSON.stringify(F.Reach)}`,
    `Attenuation = ${JSON.stringify(F.Attenuation)}`,
    `FalloffExponent = ${F.FalloffExponent.toFixed(3)}`,
    `Duration = ${JSON.stringify(F.Duration)}`,
    `WaveSpeed = ${F.WaveSpeed.toFixed(2)}`,
    `MotionTopology = ${JSON.stringify(F.MotionTopology)}`,
    `MotionLoopMode = ${JSON.stringify(F.MotionLoopMode)}`,
    `MotionSpeed = ${F.MotionSpeed.toFixed(3)}`,
    `MotionOrbitRadius = ${F.MotionOrbitRadius.toFixed(3)}`,
    `Position = [${Pos.map((V) => Number(V || 0).toFixed(3)).join(", ")}]`,
    `Rotation = [${Rot.map((V) => Number(V || 0).toFixed(2)).join(", ")}]`,
    `FormulaEnabled = ${F.FormulaEnabled}`,
    `FormulaCode = ${JSON.stringify(F.FormulaCode)}`,
  ].join("\n");
}

export function SerializeSimulationSpaceToml(ForceNodes = [], DocumentTitle = "ForceFieldStudio") {
  const Lines = [
    "# Frontier .VectorFieldSpace Composite Scene Manifest",
    'Format = "Frontier.VectorFieldSpace.v2"',
    `Title = ${JSON.stringify(DocumentTitle)}`,
    `SourceCount = ${ForceNodes.length}`,
    "",
  ];
  ForceNodes.forEach((Node, Idx) => {
    Lines.push(`[[ForceSource]] # ${Idx + 1}`);
    Lines.push(SerializeForceModelToml(Node.Name, Node.Force, { Position: Node.Position, Rotation: Node.Rotation }));
    Lines.push("");
  });
  return Lines.join("\n");
}

export function ParseForceModelToml(TomlText, FallbackName = "Imported Force") {
  if (typeof TomlText !== "string") return null;
  const Raw = {};
  const Lines = TomlText.split(/\r?\n/);
  let Name = FallbackName;
  let Position = [0, 0, 0.9];
  let Rotation = [0, 0, 0];

  for (const Line of Lines) {
    const Clean = Line.replace(/#.*$/, "").trim();
    if (!Clean || Clean.startsWith("[")) continue;
    const Eq = Clean.indexOf("=");
    if (Eq <= 0) continue;
    const Key = Clean.slice(0, Eq).trim();
    const Val = Clean.slice(Eq + 1).trim();
    if (Key === "Name") {
      try { Name = JSON.parse(Val); } catch { Name = Val.replace(/^["']|["']$/g, ""); }
    } else if (Key === "Position") {
      try { Position = JSON.parse(Val); } catch {}
    } else if (Key === "Rotation") {
      try { Rotation = JSON.parse(Val); } catch {}
    } else if (Key === "ForceModel") {
      try { Raw.Model = JSON.parse(Val); } catch {}
    } else {
      try { Raw[Key] = JSON.parse(Val); } catch { Raw[Key] = Val; }
    }
  }
  return { Name, Position, Rotation, Force: ResolveForceValues(Raw) };
}
