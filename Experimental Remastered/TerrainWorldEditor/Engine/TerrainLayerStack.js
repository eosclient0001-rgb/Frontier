/*==========================================================================================================================================
                                                        TERRAINLAYERSTACK.JS
==========================================================================================================================================*/
// Composable Non-Destructive Terrain Layer Stack, Procedural Landform Generators, Configurable Boundary Falloffs,
// Thin-Base-Surface Triangle Mesher, Multi-Terrain Batch Editing, and Three Demonstration Terrain Masks for Frontier Terrain Studio.
//
// Reuses & adapts geological landform math from c7egoist/Frontier (INIT_TERRAIN_FRAG & STACK_OP_FRAG) for Stage 1:
// - 2D Terrain Workspace + 3D Landscape Workspace ONLY (no erosion simulation, Rock Studio, or Cliff Studio)
// - Generators: Fractal Noise (fBm), Hybrid Multifractal, Ridge Noise, Voronoi / Cellular, Billow Hills,
//   Aeolian Dune Fields, Tectonic Fault Escarpment, Volcanic Cone & Caldera, Dipping Terrace Strata, Spline Landforms, & Relief Brush
// - Boundary Falloffs: Soft Influence / Noise Falloff (edge -> centre with optional fractal noise feather),
//   Hard Influence / No Falloff (100% right to coastline edge), Continental, Plateau, Coastal Rim, Bounds Feather, & Custom Curve
// - Space-Efficient Thin Base Surface -> coarse-decimated underside + contour-snapped coastal skirt triangle conversion

import { ComputeRegionMaskSdf2D, MakeTerrainUid } from './WorldMask2D.js';

export const Clamp = (V, Lo, Hi) => (V < Lo ? Lo : V > Hi ? Hi : V);
export const Mix = (A, B, T) => A + (B - A) * T;
export const Smoothstep = (E0, E1, X) =>
{
    const Span = Math.max(1e-5, E1 - E0);
    const T = Clamp((X - E0) / Span, 0.0, 1.0);
    return T * T * (3.0 - 2.0 * T);
};

/*==========================================================================================================================================
                                            DETERMINISTIC SPATIAL NOISE & GEOLOGICAL GENERATORS
==========================================================================================================================================*/
function Hash2(Ix, Iz, Seed)
{
    let H = Math.imul(Ix | 0, 374761393) ^ Math.imul(Iz | 0, 668265263) ^ Math.imul(Seed | 0, 1442695041);
    H = Math.imul(H ^ (H >>> 13), 1274126177);
    return ((H ^ (H >>> 16)) >>> 0) / 4294967295.0;
}

export function GradNoise2D(X, Z, Seed = 4029)
{
    const X0 = Math.floor(X), Z0 = Math.floor(Z);
    const Fx = X - X0, Fz = Z - Z0;
    const Ux = Fx * Fx * Fx * (Fx * (Fx * 6.0 - 15.0) + 10.0);
    const Uz = Fz * Fz * Fz * (Fz * (Fz * 6.0 - 15.0) + 10.0);

    const DotGrad = (Gx, Gz, Dx, Dz) =>
    {
        const Angle = Hash2(Gx, Gz, Seed) * 6.28318530718;
        return Math.cos(Angle) * Dx + Math.sin(Angle) * Dz;
    };

    const N00 = DotGrad(X0, Z0, Fx, Fz);
    const N10 = DotGrad(X0 + 1, Z0, Fx - 1.0, Fz);
    const N01 = DotGrad(X0, Z0 + 1, Fx, Fz - 1.0);
    const N11 = DotGrad(X0 + 1, Z0 + 1, Fx - 1.0, Fz - 1.0);

    return Mix(Mix(N00, N10, Ux), Mix(N01, N11, Ux), Uz) * 0.7071 + 0.5;
}

/**
 * Classic Multi-Octave Fractal Noise (fBm).
 */
export function Fbm2D(X, Z, Octaves = 5, Gain = 0.5, Lacunarity = 2.02, Seed = 4029)
{
    let Sum = 0.0, Amp = 0.5, Freq = 1.0, Norm = 0.0;
    for (let I = 0; I < Octaves; ++I)
    {
        Sum += Amp * GradNoise2D(X * Freq, Z * Freq, Seed + I * 131);
        Norm += Amp;
        Amp *= Gain;
        Freq *= Lacunarity;
    }
    return Clamp(Sum / Math.max(1e-6, Norm), 0.0, 1.0);
}

/**
 * Musgrave-inspired Hybrid Multifractal: smooth coastal/alluvial valleys rising into craggy interior massifs.
 */
export function HybridMultifractal2D(X, Z, Octaves = 6, Gain = 0.52, Offset = 0.25, Seed = 4029)
{
    let Signal = GradNoise2D(X, Z, Seed) + Offset;
    let Result = Signal;
    let Weight = Clamp(Signal * 0.85, 0.0, 1.0);
    let Freq = 2.03;
    let Amp = Gain;
    let Norm = 1.0 + Offset;

    for (let I = 1; I < Octaves; ++I)
    {
        Weight = Clamp(Weight, 0.0, 1.0);
        Signal = (GradNoise2D(X * Freq, Z * Freq, Seed + I * 173) + Offset) * Amp;
        Result += Weight * Signal;
        Weight *= Signal / Math.max(0.12, Amp) * 0.72;
        Norm += Amp * (1.0 + Offset) * 0.65;
        Freq *= 2.03;
        Amp *= Gain;
    }
    return Clamp((Result - Offset * 0.8) / Math.max(1e-4, Norm * 0.78), 0.0, 1.15);
}

/**
 * Ridged Multifractal Noise: sharp tectonic arête ridges & anisotropic mountain chains.
 */
export function RidgedMultifractal2D(X, Z, Octaves = 6, Gain = 0.55, Sharpness = 0.68, Seed = 4029)
{
    let Sum = 0.0, Weight = 1.0, Freq = 1.0, Amp = 0.5, Norm = 0.0;
    const Exp = Mix(1.1, 2.5, Clamp(Sharpness, 0.0, 1.0));
    for (let I = 0; I < Octaves; ++I)
    {
        const N = GradNoise2D(X * Freq, Z * Freq, Seed + I * 211) * 2.0 - 1.0;
        let Ridge = 1.0 - Math.abs(N);
        Ridge = Math.pow(Math.max(0.0, Ridge), Exp);
        Ridge *= Weight;
        Weight = Clamp(Ridge * 1.65, 0.0, 1.0);
        Sum += Ridge * Amp;
        Norm += Amp;
        Freq *= 2.07;
        Amp *= Gain;
    }
    return Clamp(Sum / Math.max(1e-5, Norm * 0.78), 0.0, 1.15);
}

/**
 * Voronoi / Cellular Landform: 0=Mesa/Tableland Blocks, 1=Fracture Ridges (F2-F1), 2=Caldera/Crater Bowls, 3=Cellular Domes (1-F1).
 */
export function VoronoiCellular2D(X, Z, Variant = 0, Jitter = 0.82, Sharpness = 0.65, Seed = 4029)
{
    const Cx = Math.floor(X), Cz = Math.floor(Z);
    const Fx = X - Cx, Fz = Z - Cz;
    let D1 = 1e9, D2 = 1e9, CellVal = 0.5;

    for (let Dz = -1; Dz <= 1; ++Dz)
    {
        for (let Dx = -1; Dx <= 1; ++Dx)
        {
            const Nx = Cx + Dx, Nz = Cz + Dz;
            const Rx = (Hash2(Nx, Nz, Seed) - 0.5) * Jitter + 0.5;
            const Rz = (Hash2(Nx, Nz, Seed + 59) - 0.5) * Jitter + 0.5;
            const Dist = Math.hypot(Dx + Rx - Fx, Dz + Rz - Fz);
            if (Dist < D1)
            {
                D2 = D1;
                D1 = Dist;
                CellVal = Hash2(Nx, Nz, Seed + 199);
            }
            else if (Dist < D2)
            {
                D2 = Dist;
            }
        }
    }

    const Edge = Clamp(D2 - D1, 0.0, 1.0);
    if (Variant === 0)
    {
        const Rim = Smoothstep(0.02, Mix(0.28, 0.05, Sharpness), Edge);
        return (0.35 + 0.65 * CellVal) * Rim;
    }
    if (Variant === 1)
    {
        return Math.pow(Clamp(1.0 - Edge * 1.45, 0.0, 1.0), Mix(1.0, 2.6, Sharpness));
    }
    if (Variant === 2)
    {
        const R = D1 * 1.65;
        const Bowl = -(1.0 - Smoothstep(0.0, 0.72, R)) * (1.0 - R * R * 0.75) * 0.65;
        const Rim = Math.exp(-Math.pow((R - 0.74) * 5.0, 2.0)) * 0.55;
        return Clamp(0.38 + Bowl + Rim, 0.0, 1.0);
    }
    return Math.pow(Clamp(1.0 - D1 * 1.15, 0.0, 1.0), Mix(0.7, 1.8, Sharpness));
}

/**
 * Billow / Anticlinal Folded Hills.
 */
export function BillowFolded2D(X, Z, Octaves = 5, AzimuthRad = 0.4, Seed = 4029)
{
    const Rx = X * Math.cos(AzimuthRad) + Z * Math.sin(AzimuthRad);
    const Rz = -X * Math.sin(AzimuthRad) + Z * Math.cos(AzimuthRad);
    let Sum = 0.0, Amp = 0.5, Freq = 1.0, Norm = 0.0;
    for (let I = 0; I < Octaves; ++I)
    {
        const N = Math.abs(GradNoise2D(Rx * Freq, Rz * Freq, Seed + I * 89) * 2.0 - 1.0);
        Sum += N * Amp;
        Norm += Amp;
        Freq *= 2.02;
        Amp *= 0.5;
    }
    return Sum / Math.max(1e-5, Norm);
}

/**
 * Aeolian Dune Field (adapted from c7egoist/Frontier asymmetric stoss/lee dune generator).
 */
export function AeolianDuneField2D(X, Z, AzimuthRad = 0.9, Asymmetry = 0.74, Sinuosity = 0.42, Seed = 4029)
{
    const Dx = Math.cos(AzimuthRad), Dz = Math.sin(AzimuthRad);
    const Px = -Dz, Pz = Dx;
    const Across = X * Px + Z * Pz;
    const Bend = Math.sin(Across * 2.6 + (Seed % 97) * 0.1) * Sinuosity * 0.35;
    const Raw = (X * Dx + Z * Dz) * 1.65 + Bend;
    const Phase = ((Raw % 1.0) + 1.0) % 1.0;
    const Asym = Clamp(Asymmetry, 0.52, 0.92);
    const Stoss = Smoothstep(0.0, Asym, Phase);
    const Lee = 1.0 - Smoothstep(Asym, Math.min(0.99, Asym + 0.22), Phase);
    return Stoss * Lee;
}

/**
 * Tectonic Fault Escarpment & Tilted Cuesta Dip-Slope (adapted from c7egoist/Frontier).
 */
export function FaultEscarpment2D(RelX, RelZ, AzimuthRad = 0.5, Sharpness = 0.78, Offset = 0.0, Warp = 0.34, Seed = 4029)
{
    const PerpX = -Math.sin(AzimuthRad), PerpZ = Math.cos(AzimuthRad);
    const W = Warp > 0.005 ? (Fbm2D(RelX * 2.2, RelZ * 2.2, 3, 0.5, 2.02, Seed + 409) - 0.5) * 0.45 * Warp : 0.0;
    const Coord = RelX * PerpX + RelZ * PerpZ - Offset + W;
    const Trans = Mix(0.45, 0.035, Clamp(Sharpness, 0.05, 0.98));
    const Scarp = Smoothstep(-Trans, Trans, Coord);
    const DipSlope = Clamp(1.0 - Math.max(0.0, Coord) * 0.36, 0.25, 1.0);
    return Scarp * DipSlope;
}

/**
 * Volcanic Stratocone & Summit Caldera Rim (adapted from c7egoist/Frontier).
 */
export function VolcanicCaldera2D(RelX, RelZ, RadiusFrac = 0.76, CraterDepth = 0.56, RimSharpness = 0.65, Warp = 0.28, Seed = 4029)
{
    let Qx = RelX, Qz = RelZ;
    if (Warp > 0.005)
    {
        Qx += (Fbm2D(RelX * 2.1, RelZ * 2.1, 3, 0.5, 2.02, Seed + 521) - 0.5) * 0.28 * Warp;
        Qz += (Fbm2D(RelX * 2.1 + 9.4, RelZ * 2.1 + 9.4, 3, 0.5, 2.02, Seed + 613) - 0.5) * 0.28 * Warp;
    }
    const R = Math.hypot(Qx, Qz) / Math.max(0.18, RadiusFrac);
    const Cone = Math.exp(-R * R * 1.85) * 1.12;
    const CraterW = Mix(18.0, 7.5, Clamp(RimSharpness, 0.0, 1.0));
    const Crater = Math.exp(-R * R * CraterW) * Clamp(CraterDepth, 0.0, 1.2);
    const Gullies = RidgedMultifractal2D(Qx * 2.8, Qz * 2.8, 4, 0.52, 0.65, Seed + 77) * 0.16 * Smoothstep(0.08, 0.65, R);
    return Math.max(0.0, Cone - Crater + Gullies);
}

/*==========================================================================================================================================
                                      PER-LAYER CONFIGURABLE BOUNDARY FALLOFF & INFLUENCE SYSTEM
==========================================================================================================================================*/
export const BOUNDARY_FALLOFF_MODES = [
    ['Soft Influence / Noise Falloff (Edge → Centre)', 'soft'],
    ['Hard Influence / No Falloff (Full Strength to Edge)', 'none'],
    ['Continental Power (Wide Coastal Plain → Interior Peak)', 'continental'],
    ['Plateau Escarpment (Steep Perimeter Rise)', 'plateau'],
    ['Coastal Rim Ring (Strong Perimeter → Calm Basin)', 'rim'],
    ['Terrain Bounds Box Feather (Domain Edge Ramp)', 'bounds'],
    ['Custom Curve Profile (Interactive Knots)', 'custom']
];

export const COMBINE_MODES = [
    ['Add (Uplift +)', 'add'],
    ['Subtract (Carve −)', 'sub'],
    ['Max (Highest Union)', 'max'],
    ['Min (Clip Ceiling)', 'min'],
    ['Blend (Replace / Lerp)', 'lerp'],
    ['Multiply (Modulate Relief)', 'multiply']
];

export const FALLOFF_CURVE_DEFAULT_POINTS = [
    [0.0, 0.0],
    [0.35, 0.28],
    [0.72, 0.84],
    [1.0, 1.0]
];

export function IsHardBoundaryFalloff(FalloffSpec)
{
    if (!FalloffSpec) return true;
    return FalloffSpec.mode === 'none' || FalloffSpec.mode === 'hard';
}

/**
 * Evaluates a layer's Boundary Falloff weight in [0..1] at a world point given:
 * - `InlandDistM`: exact metric distance inland from the 2D mask coastline (`max(0, -sdf2D)`)
 * - `BoxEdgeDistM`: exact metric distance inward from the Terrain Bounds Layer edges
 * - `FalloffSpec`: `{ mode, distance, edgeFloor, noiseAmount, noiseScale, points }`
 * - Optional `(Wx, Wz, Seed)` for organic noise-modulated coastal falloff!
 */
export function EvaluateBoundaryFalloff(InlandDistM, BoxEdgeDistM, FalloffSpec, Wx = 0.0, Wz = 0.0, Seed = 4029)
{
    if (IsHardBoundaryFalloff(FalloffSpec))
    {
        return 1.0; // Hard influence / no falloff: 100% full influence right up to the terrain boundary!
    }

    const Mode = FalloffSpec.mode || 'soft';
    const DistSpan = Math.max(4.0, Number(FalloffSpec.distance) || 260.0);
    const EdgeFloor = Clamp(Number(FalloffSpec.edgeFloor) || 0.0, 0.0, 1.0);
    const Metric = Mode === 'bounds' ? Math.max(0.0, BoxEdgeDistM) : Math.max(0.0, InlandDistM);
    let T = Clamp(Metric / DistSpan, 0.0, 1.0);

    // Optional organic fractal noise modulation along the soft boundary transition ("soft influence / noise falloff")
    const NoiseAmt = Clamp(Number(FalloffSpec.noiseAmount) || 0.0, 0.0, 1.0);
    if (NoiseAmt > 0.005 && T > 0.001 && T < 0.999)
    {
        const Ns = Math.max(0.2, Number(FalloffSpec.noiseScale) || 1.0) * 0.0045;
        const N = Fbm2D(Wx * Ns, Wz * Ns, 3, 0.5, 2.02, (Seed | 0) + 911) - 0.5;
        const Envelope = 4.0 * T * (1.0 - T); // Zero perturbation at exact shoreline (T=0) and deep centre (T=1)
        T = Clamp(T + N * NoiseAmt * 0.65 * Envelope, 0.0, 1.0);
    }

    let Shape = 1.0;
    switch (Mode)
    {
        case 'soft':
        case 'bounds':
            Shape = T * T * (3.0 - 2.0 * T);
            break;
        case 'continental':
            Shape = Math.pow(T, 2.25);
            break;
        case 'plateau':
            Shape = 1.0 - Math.pow(1.0 - T, 3.6);
            break;
        case 'rim':
        {
            const Rise = Smoothstep(0.0, 0.28, T);
            const Decay = 1.0 - 0.72 * Smoothstep(0.32, 1.0, T);
            Shape = Rise * Decay;
            return Clamp(Mix(EdgeFloor, 1.0, Shape), 0.0, 1.0);
        }
        case 'custom':
        {
            const Pts = FalloffSpec.points || FALLOFF_CURVE_DEFAULT_POINTS;
            Shape = T;
            for (let I = 0; I < Pts.length - 1; ++I)
            {
                const P0 = Pts[I], P1 = Pts[I + 1];
                if (T <= P1[0] || I === Pts.length - 2)
                {
                    const Local = Clamp((T - P0[0]) / Math.max(1e-4, P1[0] - P0[0]), 0.0, 1.0);
                    const H = Local * Local * (3.0 - 2.0 * Local);
                    Shape = Mix(P0[1], P1[1], H);
                    break;
                }
            }
            return Clamp(Shape, 0.0, 1.0);
        }
        default:
            Shape = T;
            break;
    }

    return Clamp(EdgeFloor + (1.0 - EdgeFloor) * Shape, 0.0, 1.0);
}

/*==========================================================================================================================================
                                        COMPOSABLE LAYER STACK SPECIFICATION & FACTORY
==========================================================================================================================================*/
export const LAYER_TYPE_META = {
    fractal:      { label: 'Fractal Noise (fBm)',     badge: 'FBM',        glyph: 'Mountain', accent: '#d8b46a', category: 'generator' },
    multifractal: { label: 'Hybrid Multifractal',     badge: 'MULTIFRACT', glyph: 'Mountain', accent: '#e8c27a', category: 'generator' },
    ridged:       { label: 'Ridge Noise (Arête)',     badge: 'RIDGE',      glyph: 'Activity', accent: '#f0935b', category: 'generator' },
    voronoi:      { label: 'Voronoi / Cellular',      badge: 'VORONOI',    glyph: 'Boxes',    accent: '#5ac8fa', category: 'generator' },
    billow:       { label: 'Billow & Folded Hills',   badge: 'BILLOW',     glyph: 'Layers',   accent: '#a3d977', category: 'generator' },
    dunes:        { label: 'Aeolian Dune Field',      badge: 'DUNES',      glyph: 'Water',    accent: '#eab676', category: 'generator' },
    escarpment:   { label: 'Fault Escarpment',        badge: 'FAULT',      glyph: 'Scan',     accent: '#f4a261', category: 'generator' },
    caldera:      { label: 'Volcanic Caldera',        badge: 'CALDERA',    glyph: 'Sparkles', accent: '#fb7185', category: 'generator' },
    terrace:      { label: 'Dipping Terrace Strata',  badge: 'STRATA',     glyph: 'Layers',   accent: '#d6a2e8', category: 'modifier'  },
    spline:       { label: 'Spline Landform',         badge: 'SPLINE',     glyph: 'Spline',   accent: '#3ec46d', category: 'modifier'  },
    sculpt:       { label: 'Relief Sculpt Layer',     badge: 'BRUSH',      glyph: 'Brush',    accent: '#7ec8ff', category: 'modifier'  }
};

export function CreateTerrainLayer(Type = 'multifractal', Overrides = {})
{
    const Meta = LAYER_TYPE_META[Type] || LAYER_TYPE_META.multifractal;
    const RawFallMode = Overrides.falloff?.mode === 'hard' ? 'none' : (Overrides.falloff?.mode ?? 'soft');
    const Base = {
        id: Overrides.id || MakeTerrainUid('lyr'),
        type: Type in LAYER_TYPE_META ? Type : 'multifractal',
        name: Overrides.name || Meta.label,
        enabled: Overrides.enabled !== false,
        locked: !!Overrides.locked,
        opacity: Overrides.opacity ?? 1.0,
        combine: Overrides.combine || 'add',
        seed: Overrides.seed ?? 4029,
        falloff: {
            mode: RawFallMode,
            distance: Overrides.falloff?.distance ?? 280.0,
            edgeFloor: Overrides.falloff?.edgeFloor ?? 0.0,
            noiseAmount: Overrides.falloff?.noiseAmount ?? 0.18,
            noiseScale: Overrides.falloff?.noiseScale ?? 1.0,
            points: (Overrides.falloff?.points || FALLOFF_CURVE_DEFAULT_POINTS).map(P => P.slice())
        },
        heightMask: {
            enabled: !!Overrides.heightMask?.enabled,
            minElev: Overrides.heightMask?.minElev ?? 0.0,
            maxElev: Overrides.heightMask?.maxElev ?? 340.0,
            minSlope: Overrides.heightMask?.minSlope ?? 0.0,
            maxSlope: Overrides.heightMask?.maxSlope ?? 90.0
        }
    };

    switch (Base.type)
    {
        case 'fractal':
            return {
                ...Base,
                amplitude: Overrides.amplitude ?? 140.0,
                scale: Overrides.scale ?? 2.4,
                octaves: Overrides.octaves ?? 6,
                lacunarity: Overrides.lacunarity ?? 2.02,
                gain: Overrides.gain ?? 0.50,
                warp: Overrides.warp ?? 0.28
            };
        case 'multifractal':
            return {
                ...Base,
                amplitude: Overrides.amplitude ?? 185.0,
                scale: Overrides.scale ?? 2.2,
                octaves: Overrides.octaves ?? 6,
                gain: Overrides.gain ?? 0.52,
                warp: Overrides.warp ?? 0.32,
                valleyOffset: Overrides.valleyOffset ?? 0.24
            };
        case 'ridged':
            return {
                ...Base,
                amplitude: Overrides.amplitude ?? 135.0,
                scale: Overrides.scale ?? 2.6,
                octaves: Overrides.octaves ?? 6,
                sharpness: Overrides.sharpness ?? 0.72,
                azimuth: Overrides.azimuth ?? 32.0,
                anisotropy: Overrides.anisotropy ?? 1.28,
                warp: Overrides.warp ?? 0.38
            };
        case 'voronoi':
            return {
                ...Base,
                variant: Overrides.variant ?? 0,
                amplitude: Overrides.amplitude ?? 140.0,
                scale: Overrides.scale ?? 3.1,
                jitter: Overrides.jitter ?? 0.82,
                sharpness: Overrides.sharpness ?? 0.74,
                warp: Overrides.warp ?? 0.22
            };
        case 'billow':
            return {
                ...Base,
                amplitude: Overrides.amplitude ?? 68.0,
                scale: Overrides.scale ?? 3.4,
                octaves: Overrides.octaves ?? 5,
                azimuth: Overrides.azimuth ?? 45.0,
                warp: Overrides.warp ?? 0.20
            };
        case 'dunes':
            return {
                ...Base,
                amplitude: Overrides.amplitude ?? 44.0,
                scale: Overrides.scale ?? 4.2,
                azimuth: Overrides.azimuth ?? 55.0,
                asymmetry: Overrides.asymmetry ?? 0.74,
                sinuosity: Overrides.sinuosity ?? 0.42,
                warp: Overrides.warp ?? 0.18
            };
        case 'escarpment':
            return {
                ...Base,
                amplitude: Overrides.amplitude ?? 130.0,
                azimuth: Overrides.azimuth ?? 28.0,
                sharpness: Overrides.sharpness ?? 0.78,
                offset: Overrides.offset ?? 0.0,
                warp: Overrides.warp ?? 0.34
            };
        case 'caldera':
            return {
                ...Base,
                amplitude: Overrides.amplitude ?? 190.0,
                radiusFrac: Overrides.radiusFrac ?? 0.76,
                craterDepth: Overrides.craterDepth ?? 0.56,
                rimSharpness: Overrides.rimSharpness ?? 0.65,
                warp: Overrides.warp ?? 0.28
            };
        case 'terrace':
            return {
                ...Base,
                bedCount: Overrides.bedCount ?? 9,
                strength: Overrides.strength ?? 0.76,
                dipDeg: Overrides.dipDeg ?? 4.0,
                strikeDeg: Overrides.strikeDeg ?? 25.0,
                warp: Overrides.warp ?? 0.22
            };
        case 'spline':
            return {
                ...Base,
                splineMode: Overrides.splineMode === 'arch3d' ? 'ridge' : (Overrides.splineMode ?? 'grade'),
                width: Overrides.width ?? 105.0,
                amount: Overrides.amount ?? 32.0,
                bankSmooth: Overrides.bankSmooth ?? 0.62,
                meander: Overrides.meander ?? 0.14,
                points: (Overrides.points || []).map(P => P.slice())
            };
        default:
            return {
                ...Base,
                deltaRes: Overrides.deltaRes || 0,
                deltas: Overrides.deltas || null,
                strokeCount: Overrides.strokeCount || 0
            };
    }
}

export function MoveTerrainLayer(Region, LayerId, DeltaIndex)
{
    if (!Region || !Array.isArray(Region.stack)) return false;
    const Idx = Region.stack.findIndex(L => L.id === LayerId);
    if (Idx < 0) return false;
    const Target = Clamp(Idx + DeltaIndex, 0, Region.stack.length - 1);
    if (Target === Idx) return false;
    const [Moved] = Region.stack.splice(Idx, 1);
    Region.stack.splice(Target, 0, Moved);
    Region.dirty = true;
    Region.meshDirty = true;
    return true;
}

export function DuplicateTerrainLayer(Region, LayerId)
{
    if (!Region || !Array.isArray(Region.stack)) return null;
    const Idx = Region.stack.findIndex(L => L.id === LayerId);
    if (Idx < 0) return null;
    const Src = Region.stack[Idx];
    const Copy = JSON.parse(JSON.stringify({ ...Src, deltas: undefined }));
    Copy.id = MakeTerrainUid('lyr');
    Copy.name = `${Src.name} Copy`;
    Copy.locked = false;
    if (Src.deltas instanceof Float32Array)
    {
        Copy.deltas = new Float32Array(Src.deltas);
    }
    Region.stack.splice(Idx + 1, 0, Copy);
    Region.dirty = true;
    Region.meshDirty = true;
    return Copy;
}

/*==========================================================================================================================================
                                        CATMULL-ROM 3D SPLINE DISTANCE & ELEVATION EVALUATOR
==========================================================================================================================================*/
function CatmullRomScalar(V0, V1, V2, V3, T)
{
    const T2 = T * T, T3 = T2 * T;
    return 0.5 * ((2 * V1) + (-V0 + V2) * T + (2 * V0 - 5 * V1 + 4 * V2 - V3) * T2 + (-V0 + 3 * V1 - 3 * V2 + V3) * T3);
}

export function SampleCatmullRomPolyline(ControlPoints, SubdivsPerSeg = 7)
{
    if (!ControlPoints || ControlPoints.length < 2) return ControlPoints || [];
    const N = ControlPoints.length;
    const Out = [];
    for (let I = 0; I < N - 1; ++I)
    {
        const P0 = ControlPoints[Math.max(0, I - 1)];
        const P1 = ControlPoints[I];
        const P2 = ControlPoints[I + 1];
        const P3 = ControlPoints[Math.min(N - 1, I + 2)];
        const HasY = Number.isFinite(P1[2]) && Number.isFinite(P2[2]);
        const Y0 = Number.isFinite(P0[2]) ? P0[2] : (P1[2] ?? 0);
        const Y1 = P1[2] ?? 0;
        const Y2 = P2[2] ?? 0;
        const Y3 = Number.isFinite(P3[2]) ? P3[2] : Y2;

        const Steps = (I === N - 2) ? SubdivsPerSeg : SubdivsPerSeg - 1;
        for (let S = 0; S <= Steps; ++S)
        {
            const T = S / SubdivsPerSeg;
            const X = CatmullRomScalar(P0[0], P1[0], P2[0], P3[0], T);
            const Z = CatmullRomScalar(P0[1], P1[1], P2[1], P3[1], T);
            if (HasY)
            {
                const Y = CatmullRomScalar(Y0, Y1, Y2, Y3, T);
                Out.push([X, Z, Y]);
            }
            else
            {
                Out.push([X, Z]);
            }
        }
    }
    return Out;
}

function PointToPolylineDist(Wx, Wz, Poly)
{
    let BestSq = 1e18;
    let BestAlong = 0.0;
    let BestY = undefined;
    const Segs = Poly.length - 1;
    if (Segs < 1) return { dist: 1e9, along: 0, elevY: undefined };

    for (let I = 0; I < Segs; ++I)
    {
        const Ax = Poly[I][0], Az = Poly[I][1];
        const Bx = Poly[I + 1][0], Bz = Poly[I + 1][1];
        const Ex = Bx - Ax, Ez = Bz - Az;
        const LenSq = Math.max(1e-5, Ex * Ex + Ez * Ez);
        const T = Clamp(((Wx - Ax) * Ex + (Wz - Az) * Ez) / LenSq, 0.0, 1.0);
        const Dx = Wx - (Ax + Ex * T), Dz = Wz - (Az + Ez * T);
        const DSq = Dx * Dx + Dz * Dz;
        if (DSq < BestSq)
        {
            BestSq = DSq;
            BestAlong = (I + T) / Segs;
            if (Poly[I][2] !== undefined && Poly[I + 1][2] !== undefined)
            {
                BestY = Mix(Poly[I][2], Poly[I + 1][2], T);
            }
        }
    }
    return { dist: Math.sqrt(BestSq), along: BestAlong, elevY: BestY };
}

/*==========================================================================================================================================
                                    TERRAIN REGION LAYER-STACK & THIN-BASE-SURFACE EVALUATOR
==========================================================================================================================================*/
/**
 * Evaluates a Terrain Region's 2D Mask SDF + Thin Base Surface + Composable Layer Stack + Falloff Map.
 * Automatically accelerates pure procedural generator prefixes on `GpuPipeline` (WebGL2 RGBA32F FBOs) when provided,
 * and falls back seamlessly to the exact matching deterministic CPU evaluator.
 */
export function EvaluateTerrainRegion(World, Region, PreviewLayerIdForFalloff = null, GpuPipeline = null)
{
    const B = Region.bounds;
    const BaseRes = Clamp(Region.resolution | 0, 48, 320);
    const Aspect = B.width / Math.max(1.0, B.depth);
    const Nx = Aspect >= 1.0 ? BaseRes : Math.max(32, Math.round(BaseRes * Aspect));
    const Nz = Aspect >= 1.0 ? Math.max(32, Math.round(BaseRes / Aspect)) : BaseRes;
    const Count = Nx * Nz;
    const StepX = B.width / Math.max(1, Nx - 1);
    const StepZ = B.depth / Math.max(1, Nz - 1);

    // 1. Exact O(N) 2D Euclidean Signed Distance Field from the 2D Terrain Mask
    const { coverage: MaskCov, sdf2D: Sdf2D, hasLand: HasLand } = ComputeRegionMaskSdf2D(World, Region, Nx, Nz);

    let Heights = new Float32Array(Count);
    let FalloffPreview = new Float32Array(Count);
    const WaterChannel = new Float32Array(Count);

    const SeaLevel = World.seaLevel ?? 0.0;
    const SlabBottom = SeaLevel - Math.max(1.5, Number(Region.slabThickness) || 5.0);
    const BaseTop = SeaLevel + (Number(Region.baseElevation) ?? 2.5);
    const ShoreBevel = Math.max(0.0, Number(Region.shorelineBevel) ?? 16.0);
    const ReliefScale = Number.isFinite(Number(Region.reliefScale)) ? Number(Region.reliefScale) : 1.0;

    if (!HasLand)
    {
        Heights.fill(SlabBottom);
        Region.runtime = {
            nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ,
            slabBottom: SlabBottom, baseTop: BaseTop,
            coverage: MaskCov, sdf2D: Sdf2D, heights: Heights,
            falloffMap: FalloffPreview, waterChannel: WaterChannel,
            hasLand: false, hasHardCoastLayer: false,
            maxHeight: SlabBottom, landCells: 0, culledCells: Count, landAreaKm2: 0
        };
        Region.dirty = false;
        return Region.runtime;
    }

    let LandCells = 0;
    for (let I = 0; I < Count; ++I)
    {
        if (Sdf2D[I] <= 0.0) LandCells++;
    }

    // Track whether any active shape layer uses Hard Influence / No Falloff right to the coastline
    let HasHardCoastLayer = ShoreBevel <= 1.0;
    for (const Lyr of Region.stack)
    {
        if (Lyr && Lyr.enabled !== false && Lyr.type !== 'spline' && Lyr.type !== 'sculpt' && IsHardBoundaryFalloff(Lyr.falloff))
        {
            HasHardCoastLayer = true;
            break;
        }
    }

    // Determine longest leading prefix of GPU-acceleratable procedural generator layers
    let StartLayerIdx = 0;
    if (GpuPipeline && GpuPipeline.supported)
    {
        let GpuPrefixLen = 0;
        while (GpuPrefixLen < Region.stack.length)
        {
            const L = Region.stack[GpuPrefixLen];
            if (L && L.enabled !== false && (L.type === 'spline' || L.type === 'sculpt')) break;
            GpuPrefixLen++;
        }
        if (GpuPrefixLen > 0)
        {
            const GpuRes = GpuPipeline.evaluatePrefixOnGpu(
                World, Region, Sdf2D, Nx, Nz, StepX, StepZ,
                SlabBottom, BaseTop, ShoreBevel,
                Region.stack.slice(0, GpuPrefixLen),
                PreviewLayerIdForFalloff
            );
            if (GpuRes)
            {
                Heights = GpuRes.heights;
                FalloffPreview = GpuRes.falloffMap;
                StartLayerIdx = GpuPrefixLen;
            }
        }
    }

    // 2. Initialize Thin Base Surface on CPU if GPU prefix was not used
    if (StartLayerIdx === 0)
    {
        const MaxStep = Math.max(StepX, StepZ);
        for (let I = 0; I < Count; ++I)
        {
            const D2 = Sdf2D[I];
            if (D2 <= 0.0)
            {
                if (ShoreBevel > 0.5)
                {
                    const ShoreT = Clamp(-D2 / ShoreBevel, 0.0, 1.0);
                    const SmoothShore = ShoreT * ShoreT * (3.0 - 2.0 * ShoreT);
                    Heights[I] = Mix(SeaLevel - 0.25, BaseTop, SmoothShore);
                }
                else
                {
                    Heights[I] = BaseTop;
                }
            }
            else if (D2 <= MaxStep * 1.55)
            {
                const SkirtT = Clamp(D2 / (MaxStep * 1.55), 0.0, 1.0);
                Heights[I] = Mix(SeaLevel - 0.25, SlabBottom, SkirtT);
            }
            else
            {
                Heights[I] = SlabBottom;
            }
        }
    }

    // 3. Evaluate remaining layers in the Composable Layer Stack bottom-to-top
    const RefSpan = Math.max(400.0, Math.min(B.width, B.depth));
    const CenterX = B.x + B.width * 0.5;
    const CenterZ = B.z + B.depth * 0.5;
    const MaxStep = Math.max(StepX, StepZ);

    for (let LIdx = StartLayerIdx; LIdx < Region.stack.length; ++LIdx)
    {
        const Layer = Region.stack[LIdx];
        const RecordFalloff = (Layer?.id === PreviewLayerIdForFalloff) || (!PreviewLayerIdForFalloff && LIdx === Region.stack.length - 1);
        if (!Layer || Layer.enabled === false)
        {
            if (Layer && RecordFalloff)
            {
                PopulateLayerFalloffPreview(B, Nx, Nz, StepX, StepZ, Sdf2D, Layer, FalloffPreview);
            }
            continue;
        }

        const Opacity = Clamp(Number(Layer.opacity) ?? 1.0, 0.0, 1.0);
        if (Opacity <= 1e-4 && !RecordFalloff) continue;

        const Type = Layer.type;
        const Seed = (Layer.seed | 0) || 4029;
        const Combine = Layer.combine || 'add';

        let Poly = null;
        let PolyBounds = null;
        if (Type === 'spline')
        {
            if (!Layer.points || Layer.points.length < 2) continue;
            for (const Pt of Layer.points)
            {
                if (!Number.isFinite(Pt[2]))
                {
                    const Gx = Clamp(Math.round((Pt[0] - B.x) / StepX), 0, Nx - 1);
                    const Gz = Clamp(Math.round((Pt[1] - B.z) / StepZ), 0, Nz - 1);
                    Pt[2] = Math.round(Heights[Gz * Nx + Gx] * 10) / 10;
                }
            }
            Poly = SampleCatmullRomPolyline(Layer.points, 8);
            const MaxReach = (Number(Layer.width) || 90.0) * 2.5 + 45.0;
            let PMinX = 1e9, PMinZ = 1e9, PMaxX = -1e9, PMaxZ = -1e9;
            for (const Pt of Poly)
            {
                if (Pt[0] < PMinX) PMinX = Pt[0];
                if (Pt[0] > PMaxX) PMaxX = Pt[0];
                if (Pt[1] < PMinZ) PMinZ = Pt[1];
                if (Pt[1] > PMaxZ) PMaxZ = Pt[1];
            }
            PolyBounds = [PMinX - MaxReach, PMinZ - MaxReach, PMaxX + MaxReach, PMaxZ + MaxReach];
        }

        if (Type === 'sculpt')
        {
            EnsureSculptBufferMatches(Layer, Nx, Nz);
        }

        const AzRad = ((Number(Layer.azimuth) || 0.0) * Math.PI) / 180.0;
        const CosAz = Math.cos(AzRad), SinAz = Math.sin(AzRad);
        const Aniso = Math.max(0.5, Number(Layer.anisotropy) || 1.28);
        const DipRad = ((Number(Layer.dipDeg) || 0.0) * Math.PI) / 180.0;
        const StrikeRad = ((Number(Layer.strikeDeg) || 0.0) * Math.PI) / 180.0;
        const TanDip = Math.tan(DipRad);
        const DipDirX = -Math.sin(StrikeRad), DipDirZ = Math.cos(StrikeRad);

        for (let Z = 0; Z < Nz; ++Z)
        {
            const Wz = B.z + Z * StepZ;
            const BoxDz = Math.min(Wz - B.z, B.z + B.depth - Wz);
            const Row = Z * Nx;

            for (let X = 0; X < Nx; ++X)
            {
                const Idx = Row + X;
                const D2 = Sdf2D[Idx];
                if (D2 > MaxStep * 1.1) continue;

                const Wx = B.x + X * StepX;
                const BoxEdgeDist = Math.min(BoxDz, Wx - B.x, B.x + B.width - Wx);
                const InlandDist = Math.max(0.0, -D2);

                const FallW = EvaluateBoundaryFalloff(InlandDist, BoxEdgeDist, Layer.falloff, Wx, Wz, Seed);
                if (RecordFalloff) FalloffPreview[Idx] = FallW;

                let MaskW = FallW * Opacity;
                if (MaskW <= 1e-4) continue;

                const CurH = Heights[Idx];
                if (Layer.heightMask?.enabled)
                {
                    const Hm = Layer.heightMask;
                    const EWeight = Smoothstep(Hm.minElev - 15.0, Hm.minElev + 5.0, CurH) *
                                    (1.0 - Smoothstep(Hm.maxElev - 5.0, Hm.maxElev + 15.0, CurH));
                    MaskW *= EWeight;
                    if (Hm.minSlope > 0.5)
                    {
                        const Xm = Math.max(0, X - 1), Xp = Math.min(Nx - 1, X + 1);
                        const Zm = Math.max(0, Z - 1), Zp = Math.min(Nz - 1, Z + 1);
                        const Dhx = (Heights[Row + Xp] - Heights[Row + Xm]) / ((Xp - Xm || 1) * StepX);
                        const Dhz = (Heights[Zp * Nx + X] - Heights[Zm * Nx + X]) / ((Zp - Zm || 1) * StepZ);
                        const SlopeDeg = Math.atan(Math.hypot(Dhx, Dhz)) * 57.2957795;
                        MaskW *= Smoothstep(Hm.minSlope - 4.0, Hm.minSlope + 2.0, SlopeDeg);
                    }
                    if (MaskW <= 1e-4) continue;
                }

                if (Type === 'sculpt')
                {
                    Heights[Idx] = Math.max(SlabBottom + 0.5, CurH + Layer.deltas[Idx] * MaskW);
                    continue;
                }

                if (Type === 'terrace')
                {
                    const Beds = Math.max(2.0, Number(Layer.bedCount) || 8.0);
                    const ReliefRef = Math.max(40.0, Number(Region.maxRelief) || 240.0);
                    const WarpAmt = Number(Layer.warp) || 0.0;
                    const Wp = WarpAmt > 0.005 ? (Fbm2D(Wx * 0.006, Wz * 0.006, 3, 0.5, 2.02, Seed + 307) - 0.5) * 28.0 * WarpAmt : 0.0;
                    const StratM = CurH + (Wx * DipDirX + Wz * DipDirZ) * TanDip + Wp;
                    const Ph = (StratM / ReliefRef) * Beds;
                    const Fl = Math.floor(Ph);
                    const Fr = Ph - Fl;
                    const Str = Clamp(Number(Layer.strength) || 0.75, 0.0, 0.98);
                    const SteppedFr = Mix(Fr, Smoothstep(0.16, 0.84, Fr), Str);
                    const TargetH = ((Fl + SteppedFr) / Beds) * ReliefRef - (Wx * DipDirX + Wz * DipDirZ) * TanDip - Wp;
                    Heights[Idx] = Math.max(SlabBottom + 0.5, Mix(CurH, TargetH, MaskW * Str));
                    continue;
                }

                if (Type === 'spline')
                {
                    if (Wx < PolyBounds[0] || Wx > PolyBounds[2] || Wz < PolyBounds[1] || Wz > PolyBounds[3]) continue;
                    let Qx = Wx, Qz = Wz;
                    const Meander = Number(Layer.meander) || 0.0;
                    if (Meander > 0.01)
                    {
                        const Mw = (Number(Layer.width) || 80.0) * 0.45 * Meander;
                        Qx += (GradNoise2D(Wx * 0.004, Wz * 0.004, Seed) - 0.5) * Mw * 2.0;
                        Qz += (GradNoise2D(Wx * 0.004 + 13.7, Wz * 0.004 + 9.2, Seed + 41) - 0.5) * Mw * 2.0;
                    }
                    const { dist: SDist, along: AlongT, elevY: KnotElevY } = PointToPolylineDist(Qx, Qz, Poly);
                    const HalfW = Math.max(6.0, (Number(Layer.width) || 90.0) * 0.5);
                    if (SDist >= HalfW * 2.1) continue;

                    const Bank = Clamp(Number(Layer.bankSmooth) ?? 0.55, 0.05, 1.0);
                    const NormD = SDist / (HalfW * (1.0 + Bank));
                    if (NormD >= 1.0) continue;

                    const Profile = Math.pow(1.0 - Smoothstep(0.0, 1.0, NormD), Mix(2.2, 0.75, Bank));
                    const Amt = Number(Layer.amount) ?? 32.0;
                    const Mode = Layer.splineMode || 'grade';
                    const Has3DElev = Number.isFinite(KnotElevY);

                    if (Mode === 'grade' || Mode === 'road')
                    {
                        const TargetY = Has3DElev ? KnotElevY : Mix(BaseTop + Amt * 0.8, BaseTop + 8.0, AlongT);
                        const FlatCore = 1.0 - Smoothstep(0.32, 1.0, NormD);
                        const BlendW = Clamp(Mix(Profile, FlatCore, 0.55) * MaskW, 0.0, 1.0);
                        Heights[Idx] = Math.max(SlabBottom + 0.6, Mix(CurH, TargetY, BlendW));
                    }
                    else if (Mode === 'ridge')
                    {
                        const RidgeTarget = Has3DElev ? (KnotElevY + Amt) : (CurH + Amt);
                        Heights[Idx] = Math.max(SlabBottom + 0.6, Mix(CurH, Math.max(CurH, RidgeTarget), Profile * MaskW));
                    }
                    else if (Mode === 'canyon')
                    {
                        const GorgeProfile = 1.0 - Smoothstep(0.18, 0.95, SDist / HalfW);
                        const FloorY = Has3DElev ? (KnotElevY - Amt) : (CurH - Amt);
                        Heights[Idx] = Math.max(SlabBottom + 0.6, Mix(CurH, FloorY, GorgeProfile * MaskW));
                    }
                    else if (Mode === 'river')
                    {
                        const BedBase = Has3DElev ? (KnotElevY - Amt * 0.35) : Mix(CurH * 0.55, SeaLevel + 0.6, AlongT);
                        const Carve = Math.min(CurH, BedBase) - 2.2 * Profile;
                        Heights[Idx] = Math.max(SlabBottom + 0.6, Mix(CurH, Carve, Profile * MaskW));
                        if (SDist < HalfW * 0.42) WaterChannel[Idx] = Math.max(WaterChannel[Idx], (1.0 - SDist / (HalfW * 0.42)) * MaskW);
                    }
                    else if (Mode === 'lake')
                    {
                        const BasinElev = Has3DElev ? KnotElevY : Math.max(SlabBottom + 1.0, SeaLevel + Amt * 0.25);
                        Heights[Idx] = Math.max(SlabBottom + 0.6, Mix(CurH, BasinElev - 6.0 * Profile, Profile * MaskW));
                        if (Profile > 0.35) WaterChannel[Idx] = Math.max(WaterChannel[Idx], Profile * MaskW);
                    }
                    continue;
                }

                // Procedural Landform Generators
                const Scale = Math.max(0.2, Number(Layer.scale) || 2.2);
                let NxCoord = (Wx / RefSpan) * Scale;
                let NzCoord = (Wz / RefSpan) * Scale;

                const WarpAmt = Number(Layer.warp) || 0.0;
                if (WarpAmt > 0.005 && Type !== 'escarpment' && Type !== 'caldera')
                {
                    const WpX = Fbm2D(NxCoord * 1.35 + 7.1, NzCoord * 1.35 + 3.4, 3, 0.5, 2.02, Seed + 701) - 0.5;
                    const WpZ = Fbm2D(NxCoord * 1.35 + 19.8, NzCoord * 1.35 + 11.2, 3, 0.5, 2.02, Seed + 809) - 0.5;
                    NxCoord += WpX * WarpAmt * 0.85;
                    NzCoord += WpZ * WarpAmt * 0.85;
                }

                let Signal = 0.0;
                if (Type === 'fractal')
                {
                    Signal = Fbm2D(
                        NxCoord, NzCoord,
                        Clamp(Layer.octaves | 0, 2, 8),
                        Clamp(Number(Layer.gain) || 0.50, 0.2, 0.85),
                        Math.max(1.4, Number(Layer.lacunarity) || 2.02),
                        Seed
                    );
                }
                else if (Type === 'multifractal')
                {
                    Signal = HybridMultifractal2D(
                        NxCoord, NzCoord,
                        Clamp(Layer.octaves | 0, 2, 8),
                        Clamp(Number(Layer.gain) || 0.52, 0.2, 0.85),
                        Number(Layer.valleyOffset) ?? 0.24,
                        Seed
                    );
                }
                else if (Type === 'ridged')
                {
                    const Rx = NxCoord * CosAz + NzCoord * SinAz;
                    const Rz = (-NxCoord * SinAz + NzCoord * CosAz) * Aniso;
                    Signal = RidgedMultifractal2D(
                        Rx, Rz,
                        Clamp(Layer.octaves | 0, 2, 8),
                        0.55,
                        Clamp(Number(Layer.sharpness) ?? 0.72, 0.0, 1.0),
                        Seed
                    );
                }
                else if (Type === 'voronoi')
                {
                    Signal = VoronoiCellular2D(
                        NxCoord, NzCoord,
                        Layer.variant | 0,
                        Clamp(Number(Layer.jitter) ?? 0.82, 0.0, 1.0),
                        Clamp(Number(Layer.sharpness) ?? 0.74, 0.0, 1.0),
                        Seed
                    );
                }
                else if (Type === 'billow')
                {
                    Signal = BillowFolded2D(
                        NxCoord, NzCoord,
                        Clamp(Layer.octaves | 0, 2, 7),
                        AzRad,
                        Seed
                    );
                }
                else if (Type === 'dunes')
                {
                    Signal = AeolianDuneField2D(
                        NxCoord, NzCoord,
                        AzRad,
                        Number(Layer.asymmetry) ?? 0.74,
                        Number(Layer.sinuosity) ?? 0.42,
                        Seed
                    );
                }
                else if (Type === 'escarpment')
                {
                    const RelX = (Wx - CenterX) / (0.5 * RefSpan);
                    const RelZ = (Wz - CenterZ) / (0.5 * RefSpan);
                    Signal = FaultEscarpment2D(
                        RelX, RelZ,
                        AzRad,
                        Number(Layer.sharpness) ?? 0.78,
                        Number(Layer.offset) ?? 0.0,
                        WarpAmt,
                        Seed
                    );
                }
                else if (Type === 'caldera')
                {
                    const RelX = (Wx - CenterX) / (0.5 * RefSpan);
                    const RelZ = (Wz - CenterZ) / (0.5 * RefSpan);
                    Signal = VolcanicCaldera2D(
                        RelX, RelZ,
                        Number(Layer.radiusFrac) ?? 0.76,
                        Number(Layer.craterDepth) ?? 0.56,
                        Number(Layer.rimSharpness) ?? 0.65,
                        WarpAmt,
                        Seed
                    );
                }

                const Delta = Signal * (Number(Layer.amplitude) || 120.0) * ReliefScale;
                let TargetH = CurH + Delta;
                if (Combine === 'sub') TargetH = Math.max(SlabBottom + 0.5, CurH - Math.abs(Delta));
                else if (Combine === 'max') TargetH = Math.max(CurH, BaseTop + Delta);
                else if (Combine === 'min') TargetH = Math.min(CurH, BaseTop + Delta);
                else if (Combine === 'lerp') TargetH = BaseTop + Delta;
                else if (Combine === 'multiply') TargetH = BaseTop + (CurH - BaseTop) * Clamp(Signal * 1.35, 0.0, 2.0);

                const ShoreProtect = IsHardBoundaryFalloff(Layer.falloff)
                    ? (D2 <= 0.0 ? 1.0 : 0.0)
                    : (ShoreBevel > 0.5 ? Smoothstep(0.0, Math.min(ShoreBevel, 22.0), InlandDist) : 1.0);

                Heights[Idx] = Math.max(SlabBottom + 0.5, Mix(CurH, TargetH, MaskW * ShoreProtect));
            }
        }
    }

    let MaxHeight = SlabBottom;
    for (let I = 0; I < Count; ++I)
    {
        if (Sdf2D[I] <= 0.0 && Heights[I] > MaxHeight) MaxHeight = Heights[I];
    }
    const CellAreaM2 = StepX * StepZ;
    const LandAreaKm2 = (LandCells * CellAreaM2) / 1e6;

    Region.runtime = {
        nx: Nx, nz: Nz, stepX: StepX, stepZ: StepZ,
        slabBottom: SlabBottom, baseTop: BaseTop,
        coverage: MaskCov, sdf2D: Sdf2D, heights: Heights,
        falloffMap: FalloffPreview, waterChannel: WaterChannel,
        hasLand: true,
        hasHardCoastLayer: HasHardCoastLayer,
        maxHeight: MaxHeight,
        landCells: LandCells,
        culledCells: Count - LandCells,
        landAreaKm2: LandAreaKm2
    };
    Region.dirty = false;
    return Region.runtime;
}

function PopulateLayerFalloffPreview(B, Nx, Nz, StepX, StepZ, Sdf2D, Layer, OutPreview)
{
    const Seed = (Layer.seed | 0) || 4029;
    for (let Z = 0; Z < Nz; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const BoxDz = Math.min(Wz - B.z, B.z + B.depth - Wz);
        for (let X = 0; X < Nx; ++X)
        {
            const Idx = Z * Nx + X;
            if (Sdf2D[Idx] > Math.max(StepX, StepZ)) continue;
            const Wx = B.x + X * StepX;
            const BoxEdge = Math.min(BoxDz, Wx - B.x, B.x + B.width - Wx);
            OutPreview[Idx] = EvaluateBoundaryFalloff(Math.max(0.0, -Sdf2D[Idx]), BoxEdge, Layer.falloff, Wx, Wz, Seed);
        }
    }
}

function EnsureSculptBufferMatches(Layer, Nx, Nz)
{
    const TargetLen = Nx * Nz;
    if (Layer.deltas instanceof Float32Array && Layer.deltas.length === TargetLen && Layer.nx === Nx && Layer.nz === Nz)
    {
        return;
    }
    const Next = new Float32Array(TargetLen);
    if (Layer.deltas instanceof Float32Array && Layer.nx > 1 && Layer.nz > 1)
    {
        const OldNx = Layer.nx, OldNz = Layer.nz, Old = Layer.deltas;
        for (let Z = 0; Z < Nz; ++Z)
        {
            const V = (Z / (Nz - 1)) * (OldNz - 1);
            const Z0 = Math.floor(V), Z1 = Math.min(OldNz - 1, Z0 + 1), Tz = V - Z0;
            for (let X = 0; X < Nx; ++X)
            {
                const U = (X / (Nx - 1)) * (OldNx - 1);
                const X0 = Math.floor(U), X1 = Math.min(OldNx - 1, X0 + 1), Tx = U - X0;
                const C00 = Old[Z0 * OldNx + X0], C10 = Old[Z0 * OldNx + X1];
                const C01 = Old[Z1 * OldNx + X0], C11 = Old[Z1 * OldNx + X1];
                Next[Z * Nx + X] = Mix(Mix(C00, C10, Tx), Mix(C01, C11, Tx), Tz);
            }
        }
    }
    Layer.deltas = Next;
    Layer.nx = Nx;
    Layer.nz = Nz;
}

/*==========================================================================================================================================
                              REAL-TIME TERRAIN SCULPT BRUSH & MULTI-TERRAIN BATCH OPERATIONS
==========================================================================================================================================*/
export function ApplyTerrainSculptDab(World, Region, HitPos, Mode = 'raise', Settings = {})
{
    if (!Region || Region.locked) return false;
    if (!Region.runtime) EvaluateTerrainRegion(World, Region);
    const Rt = Region.runtime;
    if (!Rt || !Rt.hasLand) return false;

    const Radius = Clamp(Number(Settings.radius) || 85.0, 8.0, 1200.0);
    const Strength = Clamp(Number(Settings.strength) ?? 0.65, 0.04, 1.0);
    const Invert = !!Settings.invert;

    let SculptLayer = Region.stack.find(L => L.id === Settings.targetLayerId && L.type === 'sculpt');
    if (!SculptLayer)
    {
        for (let I = Region.stack.length - 1; I >= 0; --I)
        {
            if (Region.stack[I].type === 'sculpt' && Region.stack[I].enabled !== false && !Region.stack[I].locked)
            {
                SculptLayer = Region.stack[I];
                break;
            }
        }
    }
    if (!SculptLayer)
    {
        SculptLayer = CreateTerrainLayer('sculpt', {
            name: 'Relief Brush Edits',
            falloff: { mode: 'none', distance: 100 }
        });
        Region.stack.push(SculptLayer);
    }
    EnsureSculptBufferMatches(SculptLayer, Rt.nx, Rt.nz);

    const B = Region.bounds;
    const Nx = Rt.nx, Nz = Rt.nz;
    const StepX = Rt.stepX, StepZ = Rt.stepZ;
    const X0 = Clamp(Math.floor((HitPos[0] - Radius - B.x) / StepX), 0, Nx - 1);
    const X1 = Clamp(Math.ceil((HitPos[0] + Radius - B.x) / StepX), 0, Nx - 1);
    const Z0 = Clamp(Math.floor((HitPos[2] - Radius - B.z) / StepZ), 0, Nz - 1);
    const Z1 = Clamp(Math.ceil((HitPos[2] + Radius - B.z) / StepZ), 0, Nz - 1);
    if (X1 < X0 || Z1 < Z0) return false;

    const EffectiveMode = (Mode === 'raise' && Invert) ? 'lower' : (Mode === 'lower' && Invert) ? 'raise' : Mode;
    const TargetFlattenH = Settings.flattenHeight ?? HitPos[1];
    const Deltas = SculptLayer.deltas;
    const Heights = Rt.heights;

    let CopyH = null;
    const SubW = X1 - X0 + 1, SubD = Z1 - Z0 + 1;
    if (EffectiveMode === 'smooth' || EffectiveMode === 'pinch')
    {
        CopyH = new Float32Array(SubW * SubD);
        for (let Z = Z0; Z <= Z1; ++Z)
        {
            for (let X = X0; X <= X1; ++X)
            {
                CopyH[(Z - Z0) * SubW + (X - X0)] = Heights[Z * Nx + X];
            }
        }
    }

    let Touched = false;
    for (let Z = Z0; Z <= Z1; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        for (let X = X0; X <= X1; ++X)
        {
            const Idx = Z * Nx + X;
            if (Rt.sdf2D[Idx] > StepX * 0.5) continue;

            const Wx = B.x + X * StepX;
            const Dist = Math.hypot(Wx - HitPos[0], Wz - HitPos[2]);
            if (Dist >= Radius) continue;

            const U = 1.0 - (Dist / Radius) * (Dist / Radius);
            const W = U * U * Strength;
            Touched = true;

            if (EffectiveMode === 'raise')
            {
                Deltas[Idx] += W * Radius * 0.22;
            }
            else if (EffectiveMode === 'lower')
            {
                Deltas[Idx] -= W * Radius * 0.22;
            }
            else if (EffectiveMode === 'flatten')
            {
                const Diff = TargetFlattenH - Heights[Idx];
                Deltas[Idx] += Diff * W * 0.55;
            }
            else if (EffectiveMode === 'smooth')
            {
                const Lx = X - X0, Lz = Z - Z0;
                const At = (Ax, Az) => CopyH[Clamp(Az, 0, SubD - 1) * SubW + Clamp(Ax, 0, SubW - 1)];
                const Avg = (At(Lx - 1, Lz) + At(Lx + 1, Lz) + At(Lx, Lz - 1) + At(Lx, Lz + 1)) * 0.25;
                Deltas[Idx] += (Avg - CopyH[Lz * SubW + Lx]) * W * 0.72;
            }
            else if (EffectiveMode === 'pinch')
            {
                const Crest = Math.pow(1.0 - Dist / Radius, 2.4) * Radius * 0.16 * Strength;
                Deltas[Idx] += Invert ? -Crest : Crest;
            }
        }
    }

    if (Touched)
    {
        SculptLayer.strokeCount = (SculptLayer.strokeCount || 0) + 1;
        Region.dirty = true;
    }
    return Touched;
}

/**
 * Applies a 3D brush dab across ALL overlapping terrains in `TargetRegions` simultaneously (Section 4.3).
 */
export function ApplyMultiTerrainSculptDab(World, TargetRegions, HitPos, Mode = 'raise', Settings = {})
{
    const Radius = Clamp(Number(Settings.radius) || 85.0, 8.0, 1200.0);
    const Modified = [];
    for (const Reg of TargetRegions)
    {
        if (!Reg || !Reg.enabled || Reg.locked) continue;
        const B = Reg.bounds;
        if (HitPos[0] + Radius < B.x || HitPos[0] - Radius > B.x + B.width ||
            HitPos[2] + Radius < B.z || HitPos[2] - Radius > B.z + B.depth)
        {
            continue;
        }
        if (ApplyTerrainSculptDab(World, Reg, HitPos, Mode, Settings))
        {
            Modified.push(Reg);
        }
    }
    return Modified;
}

/**
 * Synchronizes shared procedural parameters of `SourceLayer` onto matching-type layers across `TargetRegions` (Section 4.3).
 */
export function SyncLayerAcrossSelectedRegions(TargetRegions, SourceRegionId, SourceLayer)
{
    if (!SourceLayer || SourceLayer.type === 'spline' || SourceLayer.type === 'sculpt') return [];
    const Synced = [];
    const SkipKeys = new Set(['id', 'name', 'deltas', 'points', 'nx', 'nz', 'strokeCount']);
    for (const Reg of TargetRegions)
    {
        if (!Reg || Reg.id === SourceRegionId || Reg.locked) continue;
        // Match active layer of same type from top of stack
        let Match = null;
        for (let I = Reg.stack.length - 1; I >= 0; --I)
        {
            if (Reg.stack[I].type === SourceLayer.type && !Reg.stack[I].locked)
            {
                Match = Reg.stack[I];
                break;
            }
        }
        if (!Match) continue;
        for (const [K, V] of Object.entries(SourceLayer))
        {
            if (SkipKeys.has(K)) continue;
            Match[K] = JSON.parse(JSON.stringify(V));
        }
        Reg.dirty = true;
        Reg.meshDirty = true;
        Synced.push(Reg);
    }
    return Synced;
}

/*==========================================================================================================================================
               SPACE-EFFICIENT THIN-BASE-SURFACE -> COARSE-DECIMATED WATERTIGHT TRIANGLE MESHER
==========================================================================================================================================*/
/**
 * Converts an evaluated Terrain Region's Thin Base Surface + Procedural Landforms into an indexed triangle mesh:
 * - Emits ZERO vertices and ZERO triangles for ocean cells outside the 2D mask (`sdf2D > skirtMaxD`)
 * - Snaps outer coastal skirt vertices tightly toward the `sdf2D = 0` shoreline contour when hard cliff falloffs are active
 * - Coarsely decimates interior flat base-surface underside blocks (`4x4` cells -> 1 quad) so the thin base surface wastes
 *   almost no underside geometry while staying closed & clean when inspecting below sea level!
 */
export function ExtractRegionTriangleMesh(World, Region, Options = {})
{
    const Rt = Region.dirty || !Region.runtime
        ? EvaluateTerrainRegion(World, Region, Options.previewFalloffLayerId, Options.gpuPipeline)
        : Region.runtime;

    if (!Rt || !Rt.hasLand)
    {
        return {
            positions: new Float32Array(0),
            normals: new Float32Array(0),
            colors: new Float32Array(0),
            aux: new Float32Array(0),
            indices: new Uint32Array(0),
            vertexCount: 0,
            triangleCount: 0,
            topTriangleCount: 0,
            baseTriangleCount: 0,
            culledOceanRatio: 1.0
        };
    }

    const B = Region.bounds;
    const Nx = Rt.nx, Nz = Rt.nz;
    const StepX = Rt.stepX, StepZ = Rt.stepZ;
    const SlabBottom = Rt.slabBottom;
    const SeaLevel = World.seaLevel ?? 0.0;
    const MaxStep = Math.max(StepX, StepZ);
    const SkirtMaxD = MaxStep * 1.55;
    const SnapCliffSkirt = !!Rt.hasHardCoastLayer;
    const IncludeUnderside = Options.includeUnderside !== false;

    const TopVertIdx = new Int32Array(Nx * Nz);
    TopVertIdx.fill(-1);

    const PosList = [];
    const NormList = [];
    const ColList = [];
    const AuxList = [];
    const IdxList = [];

    for (let Z = 0; Z < Nz; ++Z)
    {
        const RawWz = B.z + Z * StepZ;
        const Zm = Math.max(0, Z - 1), Zp = Math.min(Nz - 1, Z + 1);
        for (let X = 0; X < Nx; ++X)
        {
            const Cell = Z * Nx + X;
            const D2 = Rt.sdf2D[Cell];
            if (D2 > SkirtMaxD) continue;

            let Wx = B.x + X * StepX;
            let Wz = RawWz;
            const H = Rt.heights[Cell];

            const Xm = Math.max(0, X - 1), Xp = Math.min(Nx - 1, X + 1);
            // Tightly pull outer coastal skirt vertices toward the exact coastline contour for sheer cliff edges
            if (SnapCliffSkirt && D2 > 0.0)
            {
                const SdfDx = (Rt.sdf2D[Z * Nx + Xp] - Rt.sdf2D[Z * Nx + Xm]) / ((Xp - Xm || 1) * StepX);
                const SdfDz = (Rt.sdf2D[Zp * Nx + X] - Rt.sdf2D[Zm * Nx + X]) / ((Zp - Zm || 1) * StepZ);
                const GradLen = Math.hypot(SdfDx, SdfDz);
                if (GradLen > 1e-4)
                {
                    const Pull = Math.min(D2 * 0.88, MaxStep * 1.35);
                    Wx -= (SdfDx / GradLen) * Pull;
                    Wz -= (SdfDz / GradLen) * Pull;
                }
            }

            const DhDx = (Rt.heights[Z * Nx + Xp] - Rt.heights[Z * Nx + Xm]) / ((Xp - Xm || 1) * StepX);
            const DhDz = (Rt.heights[Zp * Nx + X] - Rt.heights[Zm * Nx + X]) / ((Zp - Zm || 1) * StepZ);
            const InvLen = 1.0 / Math.hypot(DhDx, 1.0, DhDz);
            const NxVal = -DhDx * InvLen, NyVal = InvLen, NzVal = -DhDz * InvLen;
            const SlopeDeg = Math.acos(Clamp(NyVal, -1.0, 1.0)) * 57.2957795;

            const Litho = ComputeFlatLithologyColor(H, SeaLevel, SlopeDeg, Rt.waterChannel[Cell], D2, SlabBottom);

            const VId = PosList.length / 3;
            TopVertIdx[Cell] = VId;
            PosList.push(Wx, H, Wz);
            NormList.push(NxVal, NyVal, NzVal);
            ColList.push(Litho[0], Litho[1], Litho[2]);
            AuxList.push(Rt.falloffMap[Cell], Clamp(SlopeDeg / 90.0, 0.0, 1.0));
        }
    }

    const CellW = Nx - 1, CellD = Nz - 1;
    const CellActive = new Uint8Array(CellW * CellD);
    for (let Z = 0; Z < CellD; ++Z)
    {
        for (let X = 0; X < CellW; ++X)
        {
            const I00 = TopVertIdx[Z * Nx + X];
            const I10 = TopVertIdx[Z * Nx + (X + 1)];
            const I01 = TopVertIdx[(Z + 1) * Nx + X];
            const I11 = TopVertIdx[(Z + 1) * Nx + (X + 1)];
            if (I00 < 0 || I10 < 0 || I01 < 0 || I11 < 0) continue;

            CellActive[Z * CellW + X] = 1;
            IdxList.push(I00, I01, I11, I00, I11, I10);
        }
    }

    const TopTriCount = IdxList.length / 3;

    // Coarse-decimated flat underside wafer + perimeter sidewall skirt (lightweight closed thin base surface)
    if (IncludeUnderside && PosList.length > 0)
    {
        const BotVertIdx = new Int32Array(Nx * Nz);
        BotVertIdx.fill(-1);
        const GetBotVert = GridCell =>
        {
            if (BotVertIdx[GridCell] >= 0) return BotVertIdx[GridCell];
            const TopV = TopVertIdx[GridCell];
            const Wx = PosList[TopV * 3], Wz = PosList[TopV * 3 + 2];
            const BId = PosList.length / 3;
            BotVertIdx[GridCell] = BId;
            PosList.push(Wx, SlabBottom, Wz);
            NormList.push(0, -1, 0);
            ColList.push(0.055, 0.058, 0.064);
            AuxList.push(0.0, 0.0);
            return BId;
        };

        const EmitSkirtQuad = (CellA, CellB, OutNx, OutNz) =>
        {
            const Ta = TopVertIdx[CellA], Tb = TopVertIdx[CellB];
            if (Ta < 0 || Tb < 0) return;
            const BaseV = PosList.length / 3;
            const Ax = PosList[Ta * 3], Ay = PosList[Ta * 3 + 1], Az = PosList[Ta * 3 + 2];
            const Bx = PosList[Tb * 3], By = PosList[Tb * 3 + 1], Bz = PosList[Tb * 3 + 2];
            PosList.push(
                Ax, Ay, Az,
                Bx, By, Bz,
                Bx, SlabBottom, Bz,
                Ax, SlabBottom, Az
            );
            for (let K = 0; K < 4; ++K)
            {
                NormList.push(OutNx, 0, OutNz);
                ColList.push(0.105, 0.098, 0.088);
                AuxList.push(0.0, 1.0);
            }
            IdxList.push(BaseV, BaseV + 3, BaseV + 2, BaseV, BaseV + 2, BaseV + 1);
        };

        // Mark coarse 4x4 interior underside blocks where every cell + 1-cell ring is active (safe from T-junctions on perimeter)
        const BLOCK = 4;
        const Covered = new Uint8Array(CellW * CellD);
        for (let Bz = 1; Bz + BLOCK < CellD - 1; Bz += BLOCK)
        {
            for (let Bx = 1; Bx + BLOCK < CellW - 1; Bx += BLOCK)
            {
                let AllActive = true;
                for (let Dz = -1; Dz <= BLOCK && AllActive; ++Dz)
                {
                    for (let Dx = -1; Dx <= BLOCK; ++Dx)
                    {
                        if (!CellActive[(Bz + Dz) * CellW + (Bx + Dx)]) { AllActive = false; break; }
                    }
                }
                if (!AllActive) continue;

                for (let Dz = 0; Dz < BLOCK; ++Dz)
                {
                    for (let Dx = 0; Dx < BLOCK; ++Dx)
                    {
                        Covered[(Bz + Dz) * CellW + (Bx + Dx)] = 1;
                    }
                }
                const B00 = GetBotVert(Bz * Nx + Bx);
                const B10 = GetBotVert(Bz * Nx + (Bx + BLOCK));
                const B01 = GetBotVert((Bz + BLOCK) * Nx + Bx);
                const B11 = GetBotVert((Bz + BLOCK) * Nx + (Bx + BLOCK));
                IdxList.push(B00, B11, B01, B00, B10, B11);
            }
        }

        for (let Z = 0; Z < CellD; ++Z)
        {
            for (let X = 0; X < CellW; ++X)
            {
                const CIdx = Z * CellW + X;
                if (!CellActive[CIdx]) continue;
                const C00 = Z * Nx + X;
                const C10 = Z * Nx + (X + 1);
                const C01 = (Z + 1) * Nx + X;
                const C11 = (Z + 1) * Nx + (X + 1);

                if (!Covered[CIdx])
                {
                    const B00 = GetBotVert(C00), B10 = GetBotVert(C10);
                    const B01 = GetBotVert(C01), B11 = GetBotVert(C11);
                    IdxList.push(B00, B11, B01, B00, B10, B11);
                }

                if (Z === 0 || !CellActive[(Z - 1) * CellW + X]) EmitSkirtQuad(C10, C00, 0, -1);
                if (Z === CellD - 1 || !CellActive[(Z + 1) * CellW + X]) EmitSkirtQuad(C01, C11, 0, 1);
                if (X === 0 || !CellActive[Z * CellW + (X - 1)]) EmitSkirtQuad(C00, C01, -1, 0);
                if (X === CellW - 1 || !CellActive[Z * CellW + (X + 1)]) EmitSkirtQuad(C11, C10, 1, 0);
            }
        }
    }

    const TotalTris = IdxList.length / 3;
    return {
        positions: new Float32Array(PosList),
        normals: new Float32Array(NormList),
        colors: new Float32Array(ColList),
        aux: new Float32Array(AuxList),
        indices: new Uint32Array(IdxList),
        vertexCount: PosList.length / 3,
        triangleCount: TotalTris,
        topTriangleCount: TopTriCount,
        baseTriangleCount: TotalTris - TopTriCount,
        culledOceanRatio: Rt.culledCells / Math.max(1, Nx * Nz)
    };
}

/**
 * Calibrated linear-space dark-studio geological elevation & slope palette (Stage 1 preview shading, non-texturing studio).
 */
function ComputeFlatLithologyColor(HeightM, SeaLevelM, SlopeDeg, RiverWeight, Sdf2D, SlabBottom)
{
    const RelH = HeightM - SeaLevelM;
    if (HeightM <= SlabBottom + 0.4) return [0.065, 0.070, 0.078];

    if (RiverWeight > 0.12)
    {
        const T = Clamp(RiverWeight, 0.0, 1.0);
        return [Mix(0.11, 0.045, T), Mix(0.14, 0.145, T), Mix(0.12, 0.175, T)];
    }

    if (RelH < 4.5 && SlopeDeg < 24.0)
    {
        const BeachT = Smoothstep(-3.0, 4.5, RelH);
        return [Mix(0.09, 0.24, BeachT), Mix(0.13, 0.21, BeachT), Mix(0.13, 0.15, BeachT)];
    }

    let R, G, B;
    if (RelH < 58.0)
    {
        const T = Smoothstep(4.5, 58.0, RelH);
        R = Mix(0.085, 0.125, T);
        G = Mix(0.145, 0.158, T);
        B = Mix(0.078, 0.088, T);
    }
    else if (RelH < 145.0)
    {
        const T = Smoothstep(58.0, 145.0, RelH);
        R = Mix(0.125, 0.195, T);
        G = Mix(0.158, 0.168, T);
        B = Mix(0.088, 0.122, T);
    }
    else if (RelH < 215.0)
    {
        const T = Smoothstep(145.0, 215.0, RelH);
        R = Mix(0.195, 0.245, T);
        G = Mix(0.168, 0.228, T);
        B = Mix(0.122, 0.212, T);
    }
    else
    {
        const T = Smoothstep(215.0, 275.0, RelH);
        R = Mix(0.245, 0.44, T);
        G = Mix(0.228, 0.45, T);
        B = Mix(0.212, 0.47, T);
    }

    const CliffT = Smoothstep(26.0, 45.0, SlopeDeg);
    const RockR = Sdf2D > -18.0 ? 0.135 : 0.168;
    const RockG = Sdf2D > -18.0 ? 0.125 : 0.148;
    const RockB = Sdf2D > -18.0 ? 0.118 : 0.132;
    R = Mix(R, RockR, CliffT);
    G = Mix(G, RockG, CliffT);
    B = Mix(B, RockB, CliffT);

    return [R, G, B];
}

/*==========================================================================================================================================
                                         TRIANGLE MESH EXPORTERS (.OBJ & BINARY .STL)
==========================================================================================================================================*/
export function ExportWorldTerrainsObj(World, TargetRegions)
{
    const Lines = [
        `# Frontier · Terrain Studio Thin-Base-Surface Triangle Export (.obj)`,
        `# Regions: ${TargetRegions.length} | Sea Level: ${(World.seaLevel ?? 0).toFixed(2)} m`
    ];
    let VertOffset = 1;
    let TotalTris = 0;

    for (const Region of TargetRegions)
    {
        if (!Region.enabled) continue;
        const Mesh = ExtractRegionTriangleMesh(World, Region, { includeUnderside: true });
        if (Mesh.triangleCount === 0) continue;

        Lines.push(`o ${Region.name.replace(/\s+/g, '_')}`);
        const P = Mesh.positions, N = Mesh.normals, C = Mesh.colors, Idx = Mesh.indices;
        for (let I = 0; I < Mesh.vertexCount; ++I)
        {
            const K = I * 3;
            Lines.push(`v ${P[K].toFixed(3)} ${P[K + 1].toFixed(3)} ${P[K + 2].toFixed(3)} ${C[K].toFixed(3)} ${C[K + 1].toFixed(3)} ${C[K + 2].toFixed(3)}`);
        }
        for (let I = 0; I < Mesh.vertexCount; ++I)
        {
            const K = I * 3;
            Lines.push(`vn ${N[K].toFixed(4)} ${N[K + 1].toFixed(4)} ${N[K + 2].toFixed(4)}`);
        }
        for (let T = 0; T < Idx.length; T += 3)
        {
            const A = Idx[T] + VertOffset, B = Idx[T + 1] + VertOffset, D = Idx[T + 2] + VertOffset;
            Lines.push(`f ${A}//${A} ${B}//${B} ${D}//${D}`);
        }
        VertOffset += Mesh.vertexCount;
        TotalTris += Mesh.triangleCount;
    }
    return { text: Lines.join('\n') + '\n', triangleCount: TotalTris };
}

export function ExportWorldTerrainsBinaryStl(World, TargetRegions)
{
    const Meshes = [];
    let TotalTris = 0;
    for (const Region of TargetRegions)
    {
        if (!Region.enabled) continue;
        const M = ExtractRegionTriangleMesh(World, Region, { includeUnderside: true });
        if (M.triangleCount > 0) { Meshes.push(M); TotalTris += M.triangleCount; }
    }

    const Buffer = new ArrayBuffer(84 + TotalTris * 50);
    const View = new DataView(Buffer);
    const Header = 'Frontier Terrain Studio Thin-Base Triangle Mesh STL';
    for (let I = 0; I < 80; ++I) View.setUint8(I, I < Header.length ? Header.charCodeAt(I) : 0x20);
    View.setUint32(80, TotalTris, true);

    let Off = 84;
    for (const M of Meshes)
    {
        const P = M.positions, Idx = M.indices;
        for (let T = 0; T < Idx.length; T += 3)
        {
            const I0 = Idx[T] * 3, I1 = Idx[T + 1] * 3, I2 = Idx[T + 2] * 3;
            const Ex1 = P[I1] - P[I0], Ey1 = P[I1 + 1] - P[I0 + 1], Ez1 = P[I1 + 2] - P[I0 + 2];
            const Ex2 = P[I2] - P[I0], Ey2 = P[I2 + 1] - P[I0 + 1], Ez2 = P[I2 + 2] - P[I0 + 2];
            const Nx = Ey1 * Ez2 - Ez1 * Ey2, Ny = Ez1 * Ex2 - Ex1 * Ez2, Nz = Ex1 * Ey2 - Ey1 * Ex2;
            const L = Math.hypot(Nx, Ny, Nz) || 1.0;

            View.setFloat32(Off, Nx / L, true);
            View.setFloat32(Off + 4, Ny / L, true);
            View.setFloat32(Off + 8, Nz / L, true);
            View.setFloat32(Off + 12, P[I0], true);
            View.setFloat32(Off + 16, P[I0 + 1], true);
            View.setFloat32(Off + 20, P[I0 + 2], true);
            View.setFloat32(Off + 24, P[I1], true);
            View.setFloat32(Off + 28, P[I1 + 1], true);
            View.setFloat32(Off + 32, P[I1 + 2], true);
            View.setFloat32(Off + 36, P[I2], true);
            View.setFloat32(Off + 40, P[I2 + 1], true);
            View.setFloat32(Off + 44, P[I2 + 2], true);
            View.setUint16(Off + 48, 0, true);
            Off += 50;
        }
    }
    return { bytes: new Uint8Array(Buffer), triangleCount: TotalTris };
}

/*==========================================================================================================================================
                       THREE EXAMPLE TERRAIN MASKS + SEPARATE BOUNDS LAYERS (SECTION 3.6 DEMONSTRATION)
==========================================================================================================================================*/
/**
 * Populates Terrain Studio with 3 contrasting Example Terrain Masks & Independent Terrain Bounds Layers:
 * 1. "Terrain 01 · Alpine Peninsula" (NW) — Soft Influence / Noise Falloff (gentle coastal foothills -> towering interior massif)
 * 2. "Terrain 02 · Basalt Headland"  (NE) — Hard Influence / No Falloff (Voronoi mesa + fault uplift right up to sheer coastal edges)
 * 3. "Terrain 03 · Caldera Archipelago" (S) — Mixed Falloff Profiles (Caldera Rim Ring + Soft Dune Foothills + Hard Tidal Breach)
 */
export function SeedThreeDemoTerrains(World)
{
    World.maskLayers = [];
    World.regions = [];
    World.seaLevel = 0.0;
    World.oceanVisible = true;
    World.boundsLayerVisible = true;

    // --- EXAMPLE TERRAIN MASK 01: North-West Fjord Peninsula (Soft Influence / Noise Falloff) ---
    const Mask1 = World.addMaskLayer({
        id: 'mask-highland',
        name: 'Mask 01 · Alpine Peninsula',
        color: '#58b982'
    });
    World.paintPolygonMeters(Mask1, [
        [-1560, -990],
        [-780, -1160],
        [-200, -900],
        [-80, -420],
        [-380, -160],
        [-220, 190],
        [-690, 350],
        [-1340, 200],
        [-1660, -350]
    ], false, 0.34, 4029);
    World.paintCapsuleMeters(Mask1, [-110, -255], [-500, -295], 138, 'erase', 1.0, 0.26, 4091);

    const Bounds1 = World.computeLayerPaintedBounds(Mask1, 95.0);
    const Region1 = World.addTerrainRegion({
        id: 'terrain-highland',
        name: 'Terrain 01 · Alpine Peninsula',
        maskLayerId: Mask1.id,
        color: '#e8c27a',
        bounds: Bounds1,
        boundsLayer: {
            id: 'bounds-highland',
            name: 'Terrain 01 · Bounds',
            visible: true,
            autoSyncMask: true,
            paddingMeters: 95.0
        },
        resolution: 164,
        baseElevation: 2.5,
        slabThickness: 4.5,
        shorelineBevel: 24.0,
        maxRelief: 290.0,
        stack: [
            CreateTerrainLayer('fractal', {
                name: 'Coastal Foothill Fractal (fBm)',
                amplitude: 72.0,
                scale: 2.5,
                octaves: 6,
                gain: 0.50,
                warp: 0.30,
                seed: 3917,
                falloff: { mode: 'soft', distance: 260.0, edgeFloor: 0.02, noiseAmount: 0.32, noiseScale: 1.2 }
            }),
            CreateTerrainLayer('multifractal', {
                name: 'Continental Multifractal Massif',
                amplitude: 185.0,
                scale: 2.1,
                octaves: 6,
                gain: 0.54,
                warp: 0.35,
                seed: 4029,
                falloff: { mode: 'soft', distance: 420.0, edgeFloor: 0.0, noiseAmount: 0.24, noiseScale: 1.0 }
            }),
            CreateTerrainLayer('ridged', {
                name: 'Interior Ridge Spine',
                amplitude: 142.0,
                scale: 2.45,
                octaves: 6,
                sharpness: 0.76,
                azimuth: 34.0,
                warp: 0.36,
                seed: 5113,
                falloff: { mode: 'continental', distance: 480.0, edgeFloor: 0.0, noiseAmount: 0.15 }
            }),
            CreateTerrainLayer('spline', {
                name: 'Fjord Valley Corridor',
                splineMode: 'river',
                width: 115.0,
                amount: 42.0,
                bankSmooth: 0.65,
                meander: 0.26,
                seed: 6007,
                falloff: { mode: 'none', distance: 120.0, edgeFloor: 1.0 },
                points: [
                    [-1180, -640],
                    [-920, -470],
                    [-680, -350],
                    [-430, -280]
                ]
            })
        ]
    });

    // --- EXAMPLE TERRAIN MASK 02: North-East Basalt Mesa Headland (Hard Influence / No Falloff) ---
    const Mask2 = World.addMaskLayer({
        id: 'mask-cliffs',
        name: 'Mask 02 · Basalt Headland',
        color: '#5ac8fa'
    });
    World.paintPolygonMeters(Mask2, [
        [340, -960],
        [1080, -1020],
        [1360, -560],
        [1240, 40],
        [680, 120],
        [290, -260],
        [420, -620]
    ], false, 0.22, 7331);
    World.paintCapsuleMeters(Mask2, [175, -450], [205, -420], 58, 'paint', 1.0, 0.25, 7399);
    World.paintCapsuleMeters(Mask2, [215, -120], [235, -95], 45, 'paint', 1.0, 0.20, 7411);

    const Bounds2 = World.computeLayerPaintedBounds(Mask2, 135.0);
    const Region2 = World.addTerrainRegion({
        id: 'terrain-cliffs',
        name: 'Terrain 02 · Basalt Headland',
        maskLayerId: Mask2.id,
        color: '#5ac8fa',
        bounds: Bounds2,
        boundsLayer: {
            id: 'bounds-cliffs',
            name: 'Terrain 02 · Bounds',
            visible: true,
            autoSyncMask: false, // Independently padded bounds domain!
            paddingMeters: 135.0
        },
        resolution: 160,
        baseElevation: 6.0,
        slabThickness: 4.5,
        shorelineBevel: 0.0, // Zero coastal bevel -> crisp boundary transition!
        maxRelief: 250.0,
        stack: [
            CreateTerrainLayer('voronoi', {
                name: 'Voronoi Basalt Tableland (Hard Edge)',
                variant: 0,
                amplitude: 146.0,
                scale: 2.9,
                jitter: 0.78,
                sharpness: 0.84,
                warp: 0.20,
                seed: 8191,
                falloff: { mode: 'none', distance: 160.0, edgeFloor: 1.0 }
            }),
            CreateTerrainLayer('escarpment', {
                name: 'Northern Fault Uplift (Hard Edge)',
                amplitude: 54.0,
                azimuth: 22.0,
                sharpness: 0.80,
                offset: -0.08,
                warp: 0.28,
                seed: 8209,
                falloff: { mode: 'none', distance: 140.0, edgeFloor: 1.0 }
            }),
            CreateTerrainLayer('fractal', {
                name: 'Interior Plateau Crown (Soft Falloff)',
                amplitude: 52.0,
                scale: 3.2,
                octaves: 5,
                gain: 0.50,
                warp: 0.24,
                seed: 8223,
                falloff: { mode: 'soft', distance: 150.0, edgeFloor: 0.0, noiseAmount: 0.25 }
            }),
            CreateTerrainLayer('terrace', {
                name: 'Stepped Sedimentary Strata',
                bedCount: 8,
                strength: 0.82,
                dipDeg: 3.5,
                strikeDeg: 18.0,
                warp: 0.18,
                seed: 8297,
                falloff: { mode: 'none', distance: 100.0, edgeFloor: 1.0 }
            })
        ]
    });

    // --- EXAMPLE TERRAIN MASK 03: South Caldera Archipelago (Mixed Rim + Soft Noise + Hard Channel Falloffs) ---
    const Mask3 = World.addMaskLayer({
        id: 'mask-atoll',
        name: 'Mask 03 · Caldera Archipelago',
        color: '#a3d977'
    });
    World.paintCapsuleMeters(Mask3, [-380, 740], [340, 780], 490, 'paint', 1.0, 0.32, 9103);
    World.paintCapsuleMeters(Mask3, [-20, 730], [260, 560], 225, 'erase', 1.0, 0.24, 9209);
    // Satellite volcanic islet to the south-east
    World.paintStampMeters(Mask3, [560, 960], 165, 'island', false, 0.30, 9311);

    const Bounds3 = World.computeLayerPaintedBounds(Mask3, 95.0);
    const Region3 = World.addTerrainRegion({
        id: 'terrain-atoll',
        name: 'Terrain 03 · Caldera Archipelago',
        maskLayerId: Mask3.id,
        color: '#3ec46d',
        bounds: Bounds3,
        boundsLayer: {
            id: 'bounds-atoll',
            name: 'Terrain 03 · Bounds',
            visible: true,
            autoSyncMask: true,
            paddingMeters: 95.0
        },
        resolution: 156,
        baseElevation: 2.0,
        slabThickness: 4.5,
        shorelineBevel: 22.0,
        maxRelief: 230.0,
        stack: [
            CreateTerrainLayer('caldera', {
                name: 'Volcanic Caldera Rim Ring',
                amplitude: 168.0,
                radiusFrac: 0.78,
                craterDepth: 0.52,
                rimSharpness: 0.68,
                warp: 0.28,
                seed: 9413,
                falloff: { mode: 'rim', distance: 310.0, edgeFloor: 0.04, noiseAmount: 0.22 }
            }),
            CreateTerrainLayer('dunes', {
                name: 'Windward Coastal Dunes',
                amplitude: 34.0,
                scale: 4.4,
                azimuth: 58.0,
                asymmetry: 0.76,
                sinuosity: 0.45,
                warp: 0.16,
                seed: 9521,
                falloff: { mode: 'soft', distance: 175.0, edgeFloor: 0.0, noiseAmount: 0.35 }
            }),
            CreateTerrainLayer('voronoi', {
                name: 'Radial Fracture Dikes (F2−F1)',
                variant: 1,
                amplitude: 56.0,
                scale: 3.4,
                jitter: 0.84,
                sharpness: 0.72,
                warp: 0.22,
                seed: 9587,
                falloff: { mode: 'continental', distance: 260.0, edgeFloor: 0.0 }
            }),
            CreateTerrainLayer('spline', {
                name: 'Lagoon Tidal Breach',
                splineMode: 'canyon',
                width: 88.0,
                amount: 62.0,
                bankSmooth: 0.44,
                meander: 0.18,
                seed: 9619,
                falloff: { mode: 'none', distance: 100.0, edgeFloor: 1.0 },
                points: [
                    [-480, 920],
                    [-290, 820],
                    [-110, 745]
                ]
            })
        ]
    });

    EvaluateTerrainRegion(World, Region1);
    EvaluateTerrainRegion(World, Region2);
    EvaluateTerrainRegion(World, Region3);

    return { masks: [Mask1, Mask2, Mask3], regions: [Region1, Region2, Region3] };
}
