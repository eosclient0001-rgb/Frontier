/*====================================================================================================================================
                                                    RADIANCEINTEGRATION.WGSL
====================================================================================================================================*/
// 🧩 Deterministic quadrature path tracer: bounds-tree ray casting, lobe and Fresnel splitting, light quadrature with MIS

// 📝 Determinism contract
//    ① No random number generator exists in this file. Every integral (pixel footprint, lens, light area, BSDF lobe)
//       is evaluated with one fixed, shared low-discrepancy point set: base-2 Sobol' (0,2)-sequence pairs, each pair
//       decorrelated by a FIXED nested-uniform digit permutation keyed only by the pair index. Every pixel uses the
//       same points; sample k is identical on every run.
//    ② No Russian roulette and no stochastic lobe or Fresnel selection. At each surface vertex every lobe is traced
//       (coat, specular, diffuse; reflection AND refraction for glass), each carrying its exact weight.
//    ③ Paths end only at fixed depth limits or below a fixed throughput cutoff — deterministic, documented bias.
//    ④ Each sample is added to the accumulation in index order, so the sum is bit-identical regardless of how many
//       samples a dispatch carries.

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const π                       : f32 = 3.14159265358979;
const InvalidMedium           : u32 = 0xFFFFFFFFu;
const TransportStackCapacity  : u32 = 16u;
const BoundsStackCapacity     : u32 = 40u;
const DeltaRoughnessAlpha     : f32 = 0.0025;     // [-]  - α below this traces the exact mirror / refraction direction
const RayOffsetScale          : f32 = 2.0e-4;     // [m]  - Self-intersection offset along the geometric normal
const UnboundedDistance       : f32 = 1.0e30;     // [m]

const SurfaceLayered          : u32 = 0u;
const SurfaceConductor        : u32 = 1u;
const SurfaceSolidDielectric  : u32 = 2u;
const SurfaceThinDielectric   : u32 = 3u;

const HitAbsent               : u32 = 0u;
const HitTriangle             : u32 = 1u;
const HitSphere               : u32 = 2u;
const HitFloor                : u32 = 3u;
const HitLight                : u32 = 4u;

const PairSubpixel            : u32 = 0u;
const PairLens                : u32 = 1u;
const PairsPerDepth           : u32 = 4u;          // light point, diffuse lobe, specular lobe, coat lobe
const PairLight               : u32 = 0u;
const PairDiffuse             : u32 = 1u;
const PairSpecular            : u32 = 2u;
const PairCoat                : u32 = 3u;


//------------------------------------------------------------------------------------------------------------------------
//                                                    STRUCTS
//------------------------------------------------------------------------------------------------------------------------

struct TracingUniforms
{
    CameraOrigin      : vec4f,   // xyz [m] origin, w [m] lens radius
    CameraForward     : vec4f,   // xyz unit forward, w [m] focus distance
    CameraRight       : vec4f,   // xyz right × tan(fov/2) × aspect
    CameraUp          : vec4f,   // xyz up × tan(fov/2)
    EnvironmentTint   : vec4f,   // rgb tint, w intensity
    Extent            : vec4u,   // width, height, first sample index, samples in this dispatch
    DepthLimits       : vec4u,   // non-delta bounce limit, total depth limit, light count, sphere count
    SceneLayout       : vec4u,   // floor material slot, environment category, entry count, vehicle enabled (0/1)
    Tuning            : vec4f,   // throughput cutoff, floor radius [m], softboxes visible to camera (0/1), unused
}

struct BoundsEntry
{
    MinimumBound      : vec3f,
    LeftOrFirst       : u32,     // inner: first of two adjacent entries; leaf: first triangle
    MaximumBound      : vec3f,
    PrimitiveCount    : u32,     // 0 = inner entry
}

struct SurfaceMaterial
{
    AlbedoRoughness   : vec4f,   // rgb albedo / tint, w perceptual roughness
    EtaCategory       : vec4f,   // rgb conductor η, w category
    KappaCoat         : vec4f,   // rgb conductor κ, w coat weight
    ExitanceCoat      : vec4f,   // rgb exitance radiance, w coat roughness
    AbsorptionIor     : vec4f,   // rgb σa [1/m], w index of refraction
    SpecularLevel     : vec4f,   // x dielectric F0
}

struct AreaLight
{
    Centre            : vec4f,   // xyz [m], w area [m²]
    EdgeU             : vec4f,
    EdgeV             : vec4f,
    Radiance          : vec4f,
}

struct SurfaceHit
{
    Distance          : f32,
    Category          : u32,
    PrimitiveIndex    : u32,
    Barycentric       : vec2f,
}

struct SurfaceSample
{
    Position          : vec3f,
    GeometricNormal   : vec3f,   // faces the incoming ray
    ShadingNormal     : vec3f,   // faces the incoming ray
    MaterialSlot      : u32,
    FrontFacing       : bool,
}

struct TransportRay
{
    Origin            : vec3f,
    Depth             : u32,
    Direction         : vec3f,
    NonDeltaDepth     : u32,
    Throughput        : vec3f,
    LobePdf           : f32,     // solid-angle pdf of the generating lobe; 0 = camera or delta interaction
    Medium            : u32,     // material slot of the enclosing solid dielectric, or InvalidMedium
    TravelSinceLobe   : f32,     // [m] distance carried through straight thin-sheet transmissions since the lobe vertex
}

struct LobeEvaluation
{
    Diffuse           : vec3f,   // f × cosθi
    DiffusePdf        : f32,
    Specular          : vec3f,
    SpecularPdf       : f32,
    Coat              : vec3f,
    CoatPdf           : f32,
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    RESOURCES
//------------------------------------------------------------------------------------------------------------------------

@group(0) @binding(0) var<uniform>             Tracing           : TracingUniforms;
@group(0) @binding(1) var<storage, read>       BoundsEntries     : array<BoundsEntry>;
@group(0) @binding(2) var<storage, read>       TrianglePositions : array<vec4f>;
@group(0) @binding(3) var<storage, read>       TriangleNormals   : array<vec4f>;
@group(0) @binding(4) var<storage, read>       Materials         : array<SurfaceMaterial>;
@group(0) @binding(5) var<storage, read>       AreaLights        : array<AreaLight>;
@group(0) @binding(6) var<storage, read>       Spheres           : array<vec4f>;
@group(0) @binding(7) var<storage, read_write> Accumulation      : array<vec4f>;

var<private> TransportStack     : array<TransportRay, TransportStackCapacity>;
var<private> TransportStackSize : u32;


//------------------------------------------------------------------------------------------------------------------------
//                                                    QUADRATURE SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Fixed integer avalanche (lowbias32). Used ONLY to derive constant per-pair permutation keys from the pair index;
//    it never sees the pixel coordinate, so the point set is identical for every pixel and every run.
fn AvalancheKey(Input: u32) -> u32
{
    var Mixed = Input;
    Mixed ^= Mixed >> 16u;
    Mixed *= 0x7feb352du;
    Mixed ^= Mixed >> 15u;
    Mixed *= 0x846ca68bu;
    Mixed ^= Mixed >> 16u;
    return Mixed;
}

// 📝 Laine–Karras digit permutation: a bijection on 32-bit integers in which each bit depends only on less-significant
//    bits. Applied in bit-reversed order it is a nested uniform (Owen) digit permutation, which preserves the
//    (0,m,2)-net property of every power-of-two prefix of the Sobol' pair.
fn LaineKarrasPermutation(Input: u32, Key: u32) -> u32
{
    var Permuted = Input + Key;
    Permuted ^= Permuted * 0x6c50b47cu;
    Permuted ^= Permuted * 0xb82f1e52u;
    Permuted ^= Permuted * 0xc7afe638u;
    Permuted ^= Permuted * 0x8d22f6e6u;
    return Permuted;
}

fn NestedDigitPermutation(Input: u32, Key: u32) -> u32
{
    return reverseBits(LaineKarrasPermutation(reverseBits(Input), Key));
}

// 📝 Second Sobol' dimension (primitive polynomial x + 1): direction numbers v₁ = 2³¹, vⱼ = vⱼ₋₁ ⊕ (vⱼ₋₁ >> 1).
fn SobolSecondDimension(Index: u32) -> u32
{
    var Result    = 0u;
    var Direction = 0x80000000u;
    var Bits      = Index;
    loop
    {
        if (Bits == 0u) { break; }
        if ((Bits & 1u) != 0u) { Result ^= Direction; }
        Bits      = Bits >> 1u;
        Direction = Direction ^ (Direction >> 1u);
    }
    return Result;
}

// 📝 Point SampleIndex of quadrature pair PairIndex in [0,1)². The index permutation decorrelates pairs from each other;
//    the two coordinate permutations keep each pair a (0,2)-sequence.
fn QuadraturePair(SampleIndex: u32, PairIndex: u32) -> vec2f
{
    let PairKey        = AvalancheKey(PairIndex * 0x9e3779b9u + 0x85ebca6bu);
    let ShuffledIndex  = NestedDigitPermutation(SampleIndex, PairKey);
    let FirstDigits    = NestedDigitPermutation(reverseBits(ShuffledIndex), AvalancheKey(PairKey ^ 0xa511e9b3u));
    let SecondDigits   = NestedDigitPermutation(SobolSecondDimension(ShuffledIndex), AvalancheKey(PairKey ^ 0x63d83595u));
    return vec2f(f32(FirstDigits >> 8u), f32(SecondDigits >> 8u)) * (1.0 / 16777216.0);
}

fn DepthPair(SampleIndex: u32, Depth: u32, Slot: u32) -> vec2f
{
    return QuadraturePair(SampleIndex, 2u + min(Depth, 15u) * PairsPerDepth + Slot);
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    GEOMETRY QUERIES
//------------------------------------------------------------------------------------------------------------------------

fn SafeReciprocal(Direction: vec3f) -> vec3f
{
    let Magnitude = max(abs(Direction), vec3f(1.0e-12));
    return select(vec3f(1.0), vec3f(-1.0), Direction < vec3f(0.0)) / Magnitude;
}

fn IntersectBounds(Origin: vec3f, Reciprocal: vec3f, Entry: BoundsEntry, MaximumDistance: f32) -> f32
{
    let Lower   = (Entry.MinimumBound - Origin) * Reciprocal;
    let Upper   = (Entry.MaximumBound - Origin) * Reciprocal;
    let Near    = min(Lower, Upper);
    let Far     = max(Lower, Upper);
    let Entered = max(max(Near.x, Near.y), max(Near.z, 0.0));
    let Exited  = min(min(Far.x, Far.y), min(Far.z, MaximumDistance));
    return select(UnboundedDistance, Entered, Entered <= Exited);
}

// 📝 Möller–Trumbore against precomputed edges. Returns (t, u, v) with t < 0 on miss.
fn IntersectTriangle(Origin: vec3f, Direction: vec3f, TriangleIndex: u32) -> vec3f
{
    let Corner = TrianglePositions[TriangleIndex * 3u].xyz;
    let EdgeA  = TrianglePositions[TriangleIndex * 3u + 1u].xyz;
    let EdgeB  = TrianglePositions[TriangleIndex * 3u + 2u].xyz;
    let PVector     = cross(Direction, EdgeB);
    let Determinant = dot(EdgeA, PVector);
    if (abs(Determinant) < 1.0e-12) { return vec3f(-1.0); }
    let InverseDeterminant = 1.0 / Determinant;
    let TVector = Origin - Corner;
    let U = dot(TVector, PVector) * InverseDeterminant;
    if (U < 0.0 || U > 1.0) { return vec3f(-1.0); }
    let QVector = cross(TVector, EdgeA);
    let V = dot(Direction, QVector) * InverseDeterminant;
    if (V < 0.0 || U + V > 1.0) { return vec3f(-1.0); }
    return vec3f(dot(EdgeB, QVector) * InverseDeterminant, U, V);
}

fn IntersectSphere(Origin: vec3f, Direction: vec3f, Sphere: vec4f) -> f32
{
    let Offset       = Origin - Sphere.xyz;
    let HalfB        = dot(Offset, Direction);
    let C            = dot(Offset, Offset) - Sphere.w * Sphere.w;
    let Discriminant = HalfB * HalfB - C;
    if (Discriminant < 0.0) { return -1.0; }
    let Root = sqrt(Discriminant);
    let Near = -HalfB - Root;
    if (Near > RayOffsetScale) { return Near; }
    let Far = -HalfB + Root;
    return select(-1.0, Far, Far > RayOffsetScale);
}

fn LightNormal(Light: AreaLight) -> vec3f
{
    return normalize(cross(Light.EdgeU.xyz, Light.EdgeV.xyz));
}

fn IntersectLight(Origin: vec3f, Direction: vec3f, Light: AreaLight) -> f32
{
    let Normal   = LightNormal(Light);
    let Approach = dot(Direction, Normal);
    if (abs(Approach) < 1.0e-8) { return -1.0; }
    let Distance = dot(Light.Centre.xyz - Origin, Normal) / Approach;
    if (Distance <= RayOffsetScale) { return -1.0; }
    let Local = Origin + Direction * Distance - Light.Centre.xyz;
    let U = dot(Local, Light.EdgeU.xyz) / dot(Light.EdgeU.xyz, Light.EdgeU.xyz);
    let V = dot(Local, Light.EdgeV.xyz) / dot(Light.EdgeV.xyz, Light.EdgeV.xyz);
    return select(-1.0, Distance, abs(U) <= 0.5 && abs(V) <= 0.5);
}

fn TraceClosestHit(Origin: vec3f, Direction: vec3f, LightsVisible: bool) -> SurfaceHit
{
    var Hit = SurfaceHit(UnboundedDistance, HitAbsent, 0u, vec2f(0.0));

    if (abs(Direction.y) > 1.0e-8)
    {
        let FloorDistance = -Origin.y / Direction.y;
        let FloorPoint    = Origin + Direction * FloorDistance;
        if (FloorDistance > RayOffsetScale && length(FloorPoint.xz) < Tracing.Tuning.y)
        {
            Hit = SurfaceHit(FloorDistance, HitFloor, 0u, vec2f(0.0));
        }
    }

    for (var SphereIndex = 0u; SphereIndex < Tracing.DepthLimits.w; SphereIndex++)
    {
        let Distance = IntersectSphere(Origin, Direction, Spheres[SphereIndex * 2u]);
        if (Distance > 0.0 && Distance < Hit.Distance) { Hit = SurfaceHit(Distance, HitSphere, SphereIndex, vec2f(0.0)); }
    }

    for (var LightIndex = 0u; LightIndex < select(0u, Tracing.DepthLimits.z, LightsVisible); LightIndex++)
    {
        let Distance = IntersectLight(Origin, Direction, AreaLights[LightIndex]);
        if (Distance > 0.0 && Distance < Hit.Distance) { Hit = SurfaceHit(Distance, HitLight, LightIndex, vec2f(0.0)); }
    }

    if (Tracing.SceneLayout.w == 0u) { return Hit; }
    let Reciprocal = SafeReciprocal(Direction);
    var BoundsStack : array<u32, BoundsStackCapacity>;
    var StackSize   = 0u;
    var EntryIndex  = 0u;
    if (IntersectBounds(Origin, Reciprocal, BoundsEntries[0], Hit.Distance) >= UnboundedDistance) { return Hit; }
    loop
    {
        let Entry = BoundsEntries[EntryIndex];
        if (Entry.PrimitiveCount > 0u)
        {
            for (var Offset = 0u; Offset < Entry.PrimitiveCount; Offset++)
            {
                let Candidate = IntersectTriangle(Origin, Direction, Entry.LeftOrFirst + Offset);
                if (Candidate.x > RayOffsetScale && Candidate.x < Hit.Distance)
                {
                    Hit = SurfaceHit(Candidate.x, HitTriangle, Entry.LeftOrFirst + Offset, Candidate.yz);
                }
            }
            if (StackSize == 0u) { break; }
            StackSize -= 1u;
            EntryIndex = BoundsStack[StackSize];
            continue;
        }
        let LowerIndex    = Entry.LeftOrFirst;
        let LowerDistance = IntersectBounds(Origin, Reciprocal, BoundsEntries[LowerIndex], Hit.Distance);
        let UpperDistance = IntersectBounds(Origin, Reciprocal, BoundsEntries[LowerIndex + 1u], Hit.Distance);
        let NearerIndex   = select(LowerIndex + 1u, LowerIndex, LowerDistance <= UpperDistance);
        let FartherIndex  = select(LowerIndex, LowerIndex + 1u, LowerDistance <= UpperDistance);
        let NearerDistance  = min(LowerDistance, UpperDistance);
        let FartherDistance = max(LowerDistance, UpperDistance);
        if (NearerDistance >= UnboundedDistance)
        {
            if (StackSize == 0u) { break; }
            StackSize -= 1u;
            EntryIndex = BoundsStack[StackSize];
            continue;
        }
        EntryIndex = NearerIndex;
        if (FartherDistance < UnboundedDistance && StackSize < BoundsStackCapacity)
        {
            BoundsStack[StackSize] = FartherIndex;
            StackSize += 1u;
        }
    }
    return Hit;
}

// 📝 Two-interface thin-sheet transmittance: T = (1−R)² / (1−R²), tinted. Shared by shadow rays and sheet transmission.
fn ThinSheetTransmittance(CosineIncidence: f32, Material: SurfaceMaterial) -> vec3f
{
    let Reflectance = FresnelDielectric(abs(CosineIncidence), Material.AbsorptionIor.w);
    let Transmitted = (1.0 - Reflectance) * (1.0 - Reflectance) / max(1.0 - Reflectance * Reflectance, 1.0e-6);
    return Material.AlbedoRoughness.rgb * Transmitted;
}

// 📝 Visibility of a light point. Thin sheets (glazing) attenuate and the walk continues; anything else occludes.
//    The product is order-independent, so the result is deterministic regardless of traversal order.
fn TraceShadowTransmittance(Origin: vec3f, Direction: vec3f, Distance: f32) -> vec3f
{
    for (var SphereIndex = 0u; SphereIndex < Tracing.DepthLimits.w; SphereIndex++)
    {
        let SphereDistance = IntersectSphere(Origin, Direction, Spheres[SphereIndex * 2u]);
        if (SphereDistance > 0.0 && SphereDistance < Distance) { return vec3f(0.0); }
    }

    var Transmittance = vec3f(1.0);
    if (Tracing.SceneLayout.w == 0u) { return Transmittance; }
    let Reciprocal  = SafeReciprocal(Direction);
    var BoundsStack : array<u32, BoundsStackCapacity>;
    var StackSize   = 0u;
    var EntryIndex  = 0u;
    if (IntersectBounds(Origin, Reciprocal, BoundsEntries[0], Distance) >= UnboundedDistance) { return Transmittance; }
    loop
    {
        let Entry = BoundsEntries[EntryIndex];
        if (Entry.PrimitiveCount > 0u)
        {
            for (var Offset = 0u; Offset < Entry.PrimitiveCount; Offset++)
            {
                let TriangleIndex = Entry.LeftOrFirst + Offset;
                let Candidate = IntersectTriangle(Origin, Direction, TriangleIndex);
                if (Candidate.x > RayOffsetScale && Candidate.x < Distance)
                {
                    let Material = Materials[bitcast<u32>(TrianglePositions[TriangleIndex * 3u].w)];
                    if (u32(Material.EtaCategory.w) != SurfaceThinDielectric) { return vec3f(0.0); }
                    let EdgeNormal = normalize(cross(TrianglePositions[TriangleIndex * 3u + 1u].xyz, TrianglePositions[TriangleIndex * 3u + 2u].xyz));
                    Transmittance *= ThinSheetTransmittance(dot(EdgeNormal, Direction), Material);
                }
            }
        }
        else
        {
            let LowerIndex = Entry.LeftOrFirst;
            if (IntersectBounds(Origin, Reciprocal, BoundsEntries[LowerIndex], Distance) < UnboundedDistance && StackSize < BoundsStackCapacity)
            {
                BoundsStack[StackSize] = LowerIndex;
                StackSize += 1u;
            }
            if (IntersectBounds(Origin, Reciprocal, BoundsEntries[LowerIndex + 1u], Distance) < UnboundedDistance && StackSize < BoundsStackCapacity)
            {
                BoundsStack[StackSize] = LowerIndex + 1u;
                StackSize += 1u;
            }
        }
        if (StackSize == 0u) { break; }
        StackSize -= 1u;
        EntryIndex = BoundsStack[StackSize];
    }
    return Transmittance;
}

fn ResolveSurface(Origin: vec3f, Direction: vec3f, Hit: SurfaceHit) -> SurfaceSample
{
    let Position = Origin + Direction * Hit.Distance;
    var GeometricNormal = vec3f(0.0, 1.0, 0.0);
    var ShadingNormal   = GeometricNormal;
    var MaterialSlot    = Tracing.SceneLayout.x;

    if (Hit.Category == HitTriangle)
    {
        let CornerOffset = Hit.PrimitiveIndex * 3u;
        GeometricNormal = normalize(cross(TrianglePositions[CornerOffset + 1u].xyz, TrianglePositions[CornerOffset + 2u].xyz));
        let FirstCornerWeight = 1.0 - Hit.Barycentric.x - Hit.Barycentric.y;
        ShadingNormal = normalize(TriangleNormals[CornerOffset].xyz * FirstCornerWeight + TriangleNormals[CornerOffset + 1u].xyz * Hit.Barycentric.x
                                + TriangleNormals[CornerOffset + 2u].xyz * Hit.Barycentric.y);
        MaterialSlot = bitcast<u32>(TrianglePositions[CornerOffset].w);
    }
    else if (Hit.Category == HitSphere)
    {
        let Sphere = Spheres[Hit.PrimitiveIndex * 2u];
        GeometricNormal = (Position - Sphere.xyz) / Sphere.w;
        ShadingNormal   = GeometricNormal;
        MaterialSlot    = u32(Spheres[Hit.PrimitiveIndex * 2u + 1u].x);
    }

    let FrontFacing = dot(GeometricNormal, Direction) < 0.0;
    if (!FrontFacing) { GeometricNormal = -GeometricNormal; }
    if (dot(ShadingNormal, GeometricNormal) < 0.0) { ShadingNormal = -ShadingNormal; }
    if (dot(ShadingNormal, -Direction) <= 1.0e-4) { ShadingNormal = GeometricNormal; }
    return SurfaceSample(Position, GeometricNormal, ShadingNormal, MaterialSlot, FrontFacing);
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    ENVIRONMENT
//------------------------------------------------------------------------------------------------------------------------

fn EvaluateEnvironment(Direction: vec3f) -> vec3f
{
    let Elevation = Direction.y;
    var Radiance  = vec3f(0.0);
    let Category  = Tracing.SceneLayout.y;
    if (Category == 0u)
    {
        // 📝 Dark studio: charcoal walls, a soft overhead bounce and a faint warm band at the horizon.
        let Overhead = pow(max(Elevation, 0.0), 1.5);
        Radiance = mix(vec3f(0.020, 0.021, 0.024), vec3f(0.090, 0.095, 0.105), Overhead)
                 + vec3f(0.030, 0.024, 0.018) * exp(-abs(Elevation) * 9.0);
    }
    else if (Category == 1u)
    {
        // 📝 Overcast sky: CIE overcast luminance gradient (1 + 2 sin θ)/3 over a grey ground.
        let Gradient = (1.0 + 2.0 * max(Elevation, 0.0)) / 3.0;
        Radiance = select(vec3f(0.18, 0.17, 0.16) * 0.5, vec3f(0.80, 0.86, 0.95) * Gradient, Elevation > 0.0);
    }
    else
    {
        // 📝 Warm dusk: orange horizon glow under a deep blue zenith.
        let Zenith  = pow(max(Elevation, 0.0), 0.6);
        let SkylineGlow = exp(-max(Elevation, 0.0) * 6.0) * (0.6 + 0.4 * max(dot(normalize(Direction.xz + vec2f(1.0e-6)), vec2f(-0.6, -0.8)), 0.0));
        Radiance = select(vec3f(0.05, 0.035, 0.03), vec3f(0.06, 0.10, 0.25) * Zenith + vec3f(1.1, 0.42, 0.14) * SkylineGlow, Elevation > 0.0);
    }
    return Radiance * Tracing.EnvironmentTint.rgb * Tracing.EnvironmentTint.w;
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    MICROFACET OPTICS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Schlick with grazing reflectance F90 = saturate(50·F0): F0 = 0 (index-matched) reflects nothing at any angle,
//    while every F0 ≥ 0.02 keeps the classic F90 = 1 curve.
fn FresnelSchlick(F0: f32, Cosine: f32) -> f32
{
    let F90        = clamp(50.0 * F0, 0.0, 1.0);
    let Complement = 1.0 - clamp(Cosine, 0.0, 1.0);
    let Squared    = Complement * Complement;
    return F0 + (F90 - F0) * Squared * Squared * Complement;
}

// 📝 Exact unpolarized Fresnel reflectance of a dielectric interface, η = n_transmitted / n_incident. Returns 1 at TIR.
fn FresnelDielectric(CosineIncidence: f32, η: f32) -> f32
{
    let SineTransmitted2 = (1.0 - CosineIncidence * CosineIncidence) / (η * η);
    if (SineTransmitted2 >= 1.0) { return 1.0; }
    let CosineTransmitted = sqrt(1.0 - SineTransmitted2);
    let Perpendicular = (CosineIncidence - η * CosineTransmitted) / (CosineIncidence + η * CosineTransmitted);
    let Parallel      = (η * CosineIncidence - CosineTransmitted) / (η * CosineIncidence + CosineTransmitted);
    return 0.5 * (Perpendicular * Perpendicular + Parallel * Parallel);
}

// 📝 Exact unpolarized Fresnel reflectance of an air–conductor interface with complex index η + iκ, per channel.
fn FresnelConductor(CosineIncidence: f32, η: vec3f, κ: vec3f) -> vec3f
{
    let Cosine2      = CosineIncidence * CosineIncidence;
    let Sine2        = 1.0 - Cosine2;
    let η2           = η * η;
    let κ2           = κ * κ;
    let Shifted      = η2 - κ2 - vec3f(Sine2);
    let SumSquare    = sqrt(Shifted * Shifted + 4.0 * η2 * κ2);
    let RealRoot     = sqrt(max(0.5 * (SumSquare + Shifted), vec3f(0.0)));
    let TermS1       = SumSquare + vec3f(Cosine2);
    let TermS2       = 2.0 * RealRoot * CosineIncidence;
    let ReflectanceS = (TermS1 - TermS2) / (TermS1 + TermS2);
    let TermP1       = Cosine2 * SumSquare + vec3f(Sine2 * Sine2);
    let TermP2       = TermS2 * Sine2;
    let ReflectanceP = ReflectanceS * (TermP1 - TermP2) / (TermP1 + TermP2);
    return clamp(0.5 * (ReflectanceP + ReflectanceS), vec3f(0.0), vec3f(1.0));
}

fn DistributionGgx(CosineHalf: f32, α: f32) -> f32
{
    let α2    = α * α;
    let Denom = CosineHalf * CosineHalf * (α2 - 1.0) + 1.0;
    return α2 / (π * Denom * Denom);
}

fn SmithLambda(Cosine: f32, α: f32) -> f32
{
    let Cosine2  = max(Cosine * Cosine, 1.0e-8);
    let Tangent2 = (1.0 - Cosine2) / Cosine2;
    return 0.5 * (-1.0 + sqrt(1.0 + α * α * Tangent2));
}

// 📝 Orthonormal tangent basis around Normal (Duff et al. 2017, branchless).
fn TangentBasis(Normal: vec3f) -> mat3x3f
{
    let Sign       = select(-1.0, 1.0, Normal.z >= 0.0);
    let Inverse    = -1.0 / (Sign + Normal.z);
    let Shear      = Normal.x * Normal.y * Inverse;
    let Tangent    = vec3f(1.0 + Sign * Normal.x * Normal.x * Inverse, Sign * Shear, -Sign * Normal.x);
    let Bitangent  = vec3f(Shear, Sign + Normal.y * Normal.y * Inverse, -Normal.y);
    return mat3x3f(Tangent, Bitangent, Normal);
}

// 📝 Visible-normal sampling of GGX (Heitz 2018). ViewLocal is in the tangent basis (z = normal).
fn SampleVisibleNormal(ViewLocal: vec3f, α: f32, Point: vec2f) -> vec3f
{
    let Stretched = normalize(vec3f(α * ViewLocal.x, α * ViewLocal.y, ViewLocal.z));
    let LengthSq  = Stretched.x * Stretched.x + Stretched.y * Stretched.y;
    let T1 = select(vec3f(1.0, 0.0, 0.0), vec3f(-Stretched.y, Stretched.x, 0.0) / sqrt(LengthSq), LengthSq > 1.0e-10);
    let T2 = cross(Stretched, T1);
    let Radius = sqrt(Point.x);
    let φ      = 2.0 * π * Point.y;
    let P1 = Radius * cos(φ);
    var P2 = Radius * sin(φ);
    let Blend = 0.5 * (1.0 + Stretched.z);
    P2 = (1.0 - Blend) * sqrt(max(1.0 - P1 * P1, 0.0)) + Blend * P2;
    let Hemisphere = P1 * T1 + P2 * T2 + sqrt(max(0.0, 1.0 - P1 * P1 - P2 * P2)) * Stretched;
    return normalize(vec3f(α * Hemisphere.x, α * Hemisphere.y, max(1.0e-6, Hemisphere.z)));
}

// 📝 Concentric (Shirley–Chiu) disk mapping: area-preserving, continuous, so the lattice structure survives the warp.
fn ConcentricDisk(Point: vec2f) -> vec2f
{
    let Offset = 2.0 * Point - vec2f(1.0);
    if (Offset.x == 0.0 && Offset.y == 0.0) { return vec2f(0.0); }
    var Radius : f32;
    var θ      : f32;
    if (abs(Offset.x) > abs(Offset.y)) { Radius = Offset.x; θ = (π / 4.0) * (Offset.y / Offset.x); }
    else                               { Radius = Offset.y; θ = (π / 2.0) - (π / 4.0) * (Offset.x / Offset.y); }
    return Radius * vec2f(cos(θ), sin(θ));
}

fn CosineHemisphere(Point: vec2f) -> vec3f
{
    let Disk = ConcentricDisk(Point);
    return vec3f(Disk, sqrt(max(0.0, 1.0 - dot(Disk, Disk))));
}

// 📝 GGX reflection lobe value (f × cosθi) and VNDF pdf for one light direction.
fn EvaluateGgxLobe(Normal: vec3f, ωo: vec3f, ωi: vec3f, α: f32) -> vec2f
{
    let CosineOut = dot(Normal, ωo);
    let CosineIn  = dot(Normal, ωi);
    if (CosineOut <= 0.0 || CosineIn <= 0.0) { return vec2f(0.0); }
    let HalfVector         = normalize(ωo + ωi);
    let D         = DistributionGgx(max(dot(Normal, HalfVector), 0.0), α);
    let LambdaOut = SmithLambda(CosineOut, α);
    let LambdaIn  = SmithLambda(CosineIn, α);
    let G2        = 1.0 / (1.0 + LambdaOut + LambdaIn);
    let G1        = 1.0 / (1.0 + LambdaOut);
    // 📝 Returns (D·G2 / (4 cosθo), pdf). Fresnel is applied by the caller per channel.
    return vec2f(D * G2 / (4.0 * CosineOut), D * G1 / (4.0 * CosineOut));
}

fn MaterialAlpha(PerceptualRoughness: f32) -> f32
{
    return PerceptualRoughness * PerceptualRoughness;
}

// 📝 Evaluates every non-delta lobe of a layered or conductor surface toward ωi. Delta lobes return zero (they are
//    integrated exactly by their single mirror ray, never by light quadrature).
fn EvaluateLobes(Material: SurfaceMaterial, Normal: vec3f, GeometricNormal: vec3f, ωo: vec3f, ωi: vec3f) -> LobeEvaluation
{
    var Lobes = LobeEvaluation(vec3f(0.0), 0.0, vec3f(0.0), 0.0, vec3f(0.0), 0.0);
    let CosineIn  = dot(Normal, ωi);
    let CosineOut = dot(Normal, ωo);
    if (CosineIn <= 0.0 || CosineOut <= 0.0 || dot(GeometricNormal, ωi) <= 0.0) { return Lobes; }
    let HalfVector        = normalize(ωo + ωi);
    let Category = u32(Material.EtaCategory.w);
    let α        = max(MaterialAlpha(Material.AlbedoRoughness.w), 1.0e-4);

    if (Category == SurfaceConductor)
    {
        if (α >= DeltaRoughnessAlpha)
        {
            let Ggx = EvaluateGgxLobe(Normal, ωo, ωi, α);
            Lobes.Specular    = FresnelConductor(dot(ωo, HalfVector), Material.EtaCategory.rgb, Material.KappaCoat.rgb) * Ggx.x;
            Lobes.SpecularPdf = Ggx.y;
        }
        return Lobes;
    }

    let CoatWeight = Material.KappaCoat.w;
    let CoatAlpha  = max(MaterialAlpha(Material.ExitanceCoat.w), 1.0e-4);
    let F0         = Material.SpecularLevel.x;
    let CoatAttenuation = (1.0 - CoatWeight * FresnelSchlick(0.04, CosineOut)) * (1.0 - CoatWeight * FresnelSchlick(0.04, CosineIn));

    if (CoatWeight > 0.0 && CoatAlpha >= DeltaRoughnessAlpha)
    {
        let Ggx = EvaluateGgxLobe(Normal, ωo, ωi, CoatAlpha);
        Lobes.Coat    = vec3f(CoatWeight * FresnelSchlick(0.04, dot(ωo, HalfVector)) * Ggx.x);
        Lobes.CoatPdf = Ggx.y;
    }
    if (α >= DeltaRoughnessAlpha)
    {
        let Ggx = EvaluateGgxLobe(Normal, ωo, ωi, α);
        Lobes.Specular    = vec3f(CoatAttenuation * FresnelSchlick(F0, dot(ωo, HalfVector)) * Ggx.x);
        Lobes.SpecularPdf = Ggx.y;
    }
    let DiffuseTransfer = (1.0 - FresnelSchlick(F0, CosineOut)) * (1.0 - FresnelSchlick(F0, CosineIn)) * CoatAttenuation;
    Lobes.Diffuse    = Material.AlbedoRoughness.rgb * (DiffuseTransfer * CosineIn / π);
    Lobes.DiffusePdf = CosineIn / π;
    return Lobes;
}

// 📝 Power heuristic (β = 2) between two deterministic quadrature rules over the same integrand.
fn PowerHeuristic(Primary: f32, Secondary: f32) -> f32
{
    let P2 = Primary * Primary;
    let S2 = Secondary * Secondary;
    return select(1.0, P2 / (P2 + S2), P2 + S2 > 0.0);
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    TRANSPORT
//------------------------------------------------------------------------------------------------------------------------

fn PushTransportRay(Ray: TransportRay)
{
    let Peak = max(max(Ray.Throughput.x, Ray.Throughput.y), Ray.Throughput.z);
    if (Peak < Tracing.Tuning.x || Ray.Depth >= Tracing.DepthLimits.y) { return; }
    if (TransportStackSize >= TransportStackCapacity) { return; }
    TransportStack[TransportStackSize] = Ray;
    TransportStackSize += 1u;
}

fn OffsetOrigin(Position: vec3f, Normal: vec3f, Direction: vec3f) -> vec3f
{
    let Scale = RayOffsetScale * (1.0 + max(max(abs(Position.x), abs(Position.y)), abs(Position.z)) * 0.1);
    return Position + Normal * select(-Scale, Scale, dot(Normal, Direction) > 0.0);
}

// 📝 Light quadrature at a non-delta vertex: one shared Sobol' point per light per sample, combined with the BSDF-lobe
//    rule through the power heuristic per lobe.
fn IntegrateLightQuadrature(Surface: SurfaceSample, Material: SurfaceMaterial, ωo: vec3f, SampleIndex: u32, Depth: u32, LobesContinue: bool) -> vec3f
{
    var Radiance = vec3f(0.0);
    let Point = DepthPair(SampleIndex, Depth, PairLight);
    for (var LightIndex = 0u; LightIndex < Tracing.DepthLimits.z; LightIndex++)
    {
        let Light       = AreaLights[LightIndex];
        let LightPoint  = Light.Centre.xyz + (Point.x - 0.5) * Light.EdgeU.xyz + (Point.y - 0.5) * Light.EdgeV.xyz;
        let Separation  = LightPoint - Surface.Position;
        let Distance2   = dot(Separation, Separation);
        let Distance    = sqrt(Distance2);
        let ωi          = Separation / Distance;
        let CosineLight = -dot(ωi, LightNormal(Light));
        if (CosineLight <= 0.0) { continue; }
        let LightPdf = Distance2 / (CosineLight * Light.Centre.w);

        // 📝 At a terminal vertex no lobe ray continues, so the light rule carries the full weight.
        let Lobes = EvaluateLobes(Material, Surface.ShadingNormal, Surface.GeometricNormal, ωo, ωi);
        let ContinuedPdf = select(vec3f(0.0), vec3f(Lobes.DiffusePdf, Lobes.SpecularPdf, Lobes.CoatPdf), LobesContinue);
        let Weighted = Lobes.Diffuse  * PowerHeuristic(LightPdf, ContinuedPdf.x)
                     + Lobes.Specular * PowerHeuristic(LightPdf, ContinuedPdf.y)
                     + Lobes.Coat     * PowerHeuristic(LightPdf, ContinuedPdf.z);
        if (max(max(Weighted.x, Weighted.y), Weighted.z) <= 0.0) { continue; }

        let Origin = OffsetOrigin(Surface.Position, Surface.GeometricNormal, ωi);
        let Visibility = TraceShadowTransmittance(Origin, ωi, Distance * (1.0 - 1.0e-4));
        Radiance += Visibility * Light.Radiance.rgb * Weighted / LightPdf;
    }
    return Radiance;
}

const LobeConductor : u32 = 0u;
const LobeSpecular  : u32 = 1u;
const LobeCoat      : u32 = 2u;

// 📝 Reflection weight of one lobe toward ωi through microfacet normal HalfVector — the SAME expressions EvaluateLobes uses, so
//    the BSDF-lobe rule and the light rule integrate one identical integrand and the MIS combination stays exact.
fn ReflectionLobeFresnel(Material: SurfaceMaterial, Lobe: u32, CosineOut: f32, CosineIn: f32, CosineHalfOut: f32) -> vec3f
{
    if (Lobe == LobeConductor) { return FresnelConductor(CosineHalfOut, Material.EtaCategory.rgb, Material.KappaCoat.rgb); }
    let CoatWeight = Material.KappaCoat.w;
    if (Lobe == LobeCoat) { return vec3f(CoatWeight * FresnelSchlick(0.04, CosineHalfOut)); }
    let CoatAttenuation = (1.0 - CoatWeight * FresnelSchlick(0.04, CosineOut)) * (1.0 - CoatWeight * FresnelSchlick(0.04, CosineIn));
    return vec3f(CoatAttenuation * FresnelSchlick(Material.SpecularLevel.x, CosineHalfOut));
}

// 📝 Pushes one reflection-lobe continuation. Delta lobes trace the exact mirror direction with pdf 0; glossy lobes
//    warp their quadrature pair through the GGX visible-normal distribution.
fn PushReflectionLobe(Surface: SurfaceSample, Ray: TransportRay, Material: SurfaceMaterial, ωo: vec3f, α: f32, Point: vec2f, Lobe: u32)
{
    let Normal         = Surface.ShadingNormal;
    let CosineOut = max(dot(Normal, ωo), 1.0e-6);
    if (α < DeltaRoughnessAlpha)
    {
        let ωi = reflect(-ωo, Normal);
        if (dot(ωi, Surface.GeometricNormal) <= 0.0) { return; }
        let Weight = ReflectionLobeFresnel(Material, Lobe, CosineOut, CosineOut, CosineOut);
        PushTransportRay(TransportRay(OffsetOrigin(Surface.Position, Surface.GeometricNormal, ωi), Ray.Depth + 1u, ωi,
                                      Ray.NonDeltaDepth, Ray.Throughput * Weight, 0.0, Ray.Medium, 0.0));
        return;
    }
    if (Ray.NonDeltaDepth >= Tracing.DepthLimits.x) { return; }
    let Basis     = TangentBasis(Normal);
    let HalfVector         = Basis * SampleVisibleNormal(transpose(Basis) * ωo, α, Point);
    let ωi        = reflect(-ωo, HalfVector);
    let CosineIn  = dot(Normal, ωi);
    if (CosineIn <= 0.0 || dot(ωi, Surface.GeometricNormal) <= 0.0) { return; }
    let LambdaOut = SmithLambda(CosineOut, α);
    let LambdaIn  = SmithLambda(CosineIn, α);
    let Masking   = (1.0 + LambdaOut) / (1.0 + LambdaOut + LambdaIn);    // G2 / G1
    let Pdf       = DistributionGgx(max(dot(Normal, HalfVector), 0.0), α) / ((1.0 + LambdaOut) * 4.0 * CosineOut);
    let Weight    = ReflectionLobeFresnel(Material, Lobe, CosineOut, CosineIn, max(dot(ωo, HalfVector), 0.0)) * Masking;
    PushTransportRay(TransportRay(OffsetOrigin(Surface.Position, Surface.GeometricNormal, ωi), Ray.Depth + 1u, ωi,
                                  Ray.NonDeltaDepth + 1u, Ray.Throughput * Weight, Pdf, Ray.Medium, 0.0));
}

fn ScatterSurface(Surface: SurfaceSample, Ray: TransportRay, SampleIndex: u32) -> vec3f
{
    let Material = Materials[Surface.MaterialSlot];
    let Category = u32(Material.EtaCategory.w);
    let ωo       = -Ray.Direction;
    let Normal        = Surface.ShadingNormal;
    let CosineOut = max(dot(Normal, ωo), 1.0e-6);
    var Radiance = vec3f(0.0);

    if (Surface.FrontFacing) { Radiance += Ray.Throughput * Material.ExitanceCoat.rgb; }

    if (Category == SurfaceSolidDielectric)
    {
        // 📝 Fresnel splitting: reflection AND refraction both continue with their exact weights (no coin flip).
        let Ior       = Material.AbsorptionIor.w;
        let η         = select(1.0 / Ior, Ior, Surface.FrontFacing);
        let Cosine    = clamp(dot(Surface.GeometricNormal, ωo), 0.0, 1.0);
        let Reflected = FresnelDielectric(Cosine, η);
        let ωr        = reflect(-ωo, Surface.GeometricNormal);
        PushTransportRay(TransportRay(OffsetOrigin(Surface.Position, Surface.GeometricNormal, ωr), Ray.Depth + 1u, ωr,
                                      Ray.NonDeltaDepth, Ray.Throughput * Reflected, 0.0, Ray.Medium, 0.0));
        if (Reflected < 1.0)
        {
            let ωt = refract(-ωo, Surface.GeometricNormal, 1.0 / η);
            let InnerMedium = select(InvalidMedium, Surface.MaterialSlot, Surface.FrontFacing);
            PushTransportRay(TransportRay(OffsetOrigin(Surface.Position, Surface.GeometricNormal, ωt), Ray.Depth + 1u, ωt,
                                          Ray.NonDeltaDepth, Ray.Throughput * (1.0 - Reflected), 0.0, InnerMedium, 0.0));
        }
        return Radiance;
    }

    if (Category == SurfaceThinDielectric)
    {
        // 📝 Thin sheet: straight transmission keeps the lobe pdf and accumulates travel, so the light-quadrature MIS
        //    weight on the far side stays consistent with the shadow ray that already passed through this sheet.
        let Cosine      = clamp(dot(Surface.GeometricNormal, ωo), 0.0, 1.0);
        let Reflectance = FresnelDielectric(Cosine, Material.AbsorptionIor.w);
        let Sheet       = Reflectance + (1.0 - Reflectance) * (1.0 - Reflectance) * Reflectance / max(1.0 - Reflectance * Reflectance, 1.0e-6);
        let ωr          = reflect(-ωo, Surface.GeometricNormal);
        PushTransportRay(TransportRay(OffsetOrigin(Surface.Position, Surface.GeometricNormal, ωr), Ray.Depth + 1u, ωr,
                                      Ray.NonDeltaDepth, Ray.Throughput * Sheet, 0.0, Ray.Medium, 0.0));
        PushTransportRay(TransportRay(OffsetOrigin(Surface.Position, Surface.GeometricNormal, Ray.Direction), Ray.Depth + 1u, Ray.Direction,
                                      Ray.NonDeltaDepth, Ray.Throughput * ThinSheetTransmittance(Cosine, Material), Ray.LobePdf,
                                      Ray.Medium, Ray.TravelSinceLobe));
        return Radiance;
    }

    // 📝 Layered / conductor: light quadrature first, then every lobe continues with its exact weight.
    let LobesContinue = Ray.NonDeltaDepth < Tracing.DepthLimits.x && Ray.Depth + 1u < Tracing.DepthLimits.y;
    Radiance += Ray.Throughput * IntegrateLightQuadrature(Surface, Material, ωo, SampleIndex, Ray.Depth, LobesContinue);

    let α = max(MaterialAlpha(Material.AlbedoRoughness.w), 1.0e-4);
    if (Category == SurfaceConductor)
    {
        PushReflectionLobe(Surface, Ray, Material, ωo, α, DepthPair(SampleIndex, Ray.Depth, PairSpecular), LobeConductor);
        return Radiance;
    }

    let CoatWeight = Material.KappaCoat.w;
    let F0         = Material.SpecularLevel.x;
    if (CoatWeight > 0.0)
    {
        let CoatAlpha = max(MaterialAlpha(Material.ExitanceCoat.w), 1.0e-4);
        PushReflectionLobe(Surface, Ray, Material, ωo, CoatAlpha, DepthPair(SampleIndex, Ray.Depth, PairCoat), LobeCoat);
    }
    PushReflectionLobe(Surface, Ray, Material, ωo, α, DepthPair(SampleIndex, Ray.Depth, PairSpecular), LobeSpecular);

    if (Ray.NonDeltaDepth < Tracing.DepthLimits.x)
    {
        let Basis    = TangentBasis(Normal);
        let ωi       = Basis * CosineHemisphere(DepthPair(SampleIndex, Ray.Depth, PairDiffuse));
        let CosineIn = dot(Normal, ωi);
        if (CosineIn > 0.0 && dot(ωi, Surface.GeometricNormal) > 0.0)
        {
            let CoatOut  = 1.0 - CoatWeight * FresnelSchlick(0.04, CosineOut);
            let CoatIn   = 1.0 - CoatWeight * FresnelSchlick(0.04, CosineIn);
            let Transfer = (1.0 - FresnelSchlick(F0, CosineOut)) * (1.0 - FresnelSchlick(F0, CosineIn)) * CoatOut * CoatIn;
            PushTransportRay(TransportRay(OffsetOrigin(Surface.Position, Surface.GeometricNormal, ωi), Ray.Depth + 1u, ωi,
                                          Ray.NonDeltaDepth + 1u, Ray.Throughput * Material.AlbedoRoughness.rgb * Transfer,
                                          CosineIn / π, Ray.Medium, 0.0));
        }
    }
    return Radiance;
}

fn IntegrateSample(PixelCoordinate: vec2u, SampleIndex: u32) -> vec3f
{
    let Extent   = vec2f(f32(Tracing.Extent.x), f32(Tracing.Extent.y));
    let Subpixel = QuadraturePair(SampleIndex, PairSubpixel);
    let Ndc      = ((vec2f(PixelCoordinate) + Subpixel) / Extent) * 2.0 - vec2f(1.0);
    var Origin   = Tracing.CameraOrigin.xyz;
    var Direction = normalize(Tracing.CameraForward.xyz + Ndc.x * Tracing.CameraRight.xyz - Ndc.y * Tracing.CameraUp.xyz);

    if (Tracing.CameraOrigin.w > 0.0)
    {
        // 📝 Thin lens: the lens point comes from its own quadrature pair; the focus plane is perpendicular to forward.
        let Lens       = ConcentricDisk(QuadraturePair(SampleIndex, PairLens)) * Tracing.CameraOrigin.w;
        let FocusPoint = Origin + Direction * (Tracing.CameraForward.w / dot(Direction, Tracing.CameraForward.xyz));
        Origin    = Origin + normalize(Tracing.CameraRight.xyz) * Lens.x + normalize(Tracing.CameraUp.xyz) * Lens.y;
        Direction = normalize(FocusPoint - Origin);
    }

    TransportStack[0]  = TransportRay(Origin, 0u, Direction, 0u, vec3f(1.0), 0.0, InvalidMedium, 0.0);
    TransportStackSize = 1u;
    var Radiance = vec3f(0.0);

    loop
    {
        if (TransportStackSize == 0u) { break; }
        TransportStackSize -= 1u;
        var Ray = TransportStack[TransportStackSize];
        // 📝 Softboxes may be hidden from camera rays (studio practice); reflections and refractions always see them.
        let Hit = TraceClosestHit(Ray.Origin, Ray.Direction, Ray.Depth > 0u || Tracing.Tuning.z > 0.5);

        if (Ray.Medium != InvalidMedium)
        {
            let Absorption = Materials[Ray.Medium].AbsorptionIor.rgb;
            Ray.Throughput = Ray.Throughput * exp(-Absorption * min(Hit.Distance, 100.0));
        }

        if (Hit.Category == HitAbsent)
        {
            Radiance += Ray.Throughput * EvaluateEnvironment(Ray.Direction);
            continue;
        }

        if (Hit.Category == HitLight)
        {
            let Light       = AreaLights[Hit.PrimitiveIndex];
            let CosineLight = -dot(Ray.Direction, LightNormal(Light));
            if (CosineLight > 0.0)
            {
                let Travel   = Ray.TravelSinceLobe + Hit.Distance;
                let LightPdf = Travel * Travel / (CosineLight * Light.Centre.w);
                let Weight   = select(1.0, PowerHeuristic(Ray.LobePdf, LightPdf), Ray.LobePdf > 0.0);
                Radiance += Ray.Throughput * Light.Radiance.rgb * Weight;
            }
            continue;
        }

        let Surface = ResolveSurface(Ray.Origin, Ray.Direction, Hit);
        // 📝 Straight thin-sheet transmissions carry the travelled distance for the light pdf of the original lobe.
        if (u32(Materials[Surface.MaterialSlot].EtaCategory.w) == SurfaceThinDielectric)
        {
            Ray.TravelSinceLobe = Ray.TravelSinceLobe + Hit.Distance;
        }
        Radiance += ScatterSurface(Surface, Ray, SampleIndex);
    }
    return Radiance;
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    ENTRY POINTS
//------------------------------------------------------------------------------------------------------------------------

@compute @workgroup_size(8, 8, 1)
fn IntegrateRadiance(@builtin(global_invocation_id) InvocationId: vec3u)
{
    if (InvocationId.x >= Tracing.Extent.x || InvocationId.y >= Tracing.Extent.y) { return; }
    let PixelIndex = InvocationId.y * Tracing.Extent.x + InvocationId.x;
    var Sum = Accumulation[PixelIndex];
    for (var Offset = 0u; Offset < Tracing.Extent.w; Offset++)
    {
        let Radiance = IntegrateSample(InvocationId.xy, Tracing.Extent.z + Offset);
        // 📝 Guard against non-finite samples so one degenerate triangle can never poison the accumulation.
        let Finite = all(Radiance == Radiance) && all(abs(Radiance) < vec3f(1.0e20));
        Sum = Sum + vec4f(select(vec3f(0.0), Radiance, Finite), 1.0);
    }
    Accumulation[PixelIndex] = Sum;
}

// 📝 Validation entry: writes QuadraturePair(k, p) for k < Extent.x, p < Extent.y so host code can compare bit-for-bit.
@compute @workgroup_size(64, 1, 1)
fn ExtractQuadrature(@builtin(global_invocation_id) InvocationId: vec3u)
{
    let Total = Tracing.Extent.x * Tracing.Extent.y;
    if (InvocationId.x >= Total) { return; }
    let SampleIndex = InvocationId.x % Tracing.Extent.x;
    let PairIndex   = InvocationId.x / Tracing.Extent.x;
    let Point = QuadraturePair(SampleIndex, PairIndex);
    Accumulation[InvocationId.x] = vec4f(Point, bitcast<f32>(SampleIndex), bitcast<f32>(PairIndex));
}
