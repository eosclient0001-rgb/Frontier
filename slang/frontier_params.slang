// ===========================================================================
//  frontier_params.slang — parameter block + grid constants.
//
//  Slang port of src/params.ts + src/config.ts for the Vulkan/Slate build.
//
//  The WGSL version generates this struct from the TypeScript schema so the
//  two can never drift. For the C++ build the same discipline applies: keep
//  this struct and the C++ `FrontierParams` POD in the same order, and
//  static_assert the size. See docs/SLATE_INTEGRATION.md.
// ===========================================================================

module frontier_params;

// --- grid configuration -----------------------------------------------------
// Specialisation constants so one SPIR-V module serves every resolution.
[SpecializationConstant] public const int VOLX = 208;
[SpecializationConstant] public const int VOLY = 120;
[SpecializationConstant] public const int VOLZ = 208;
[SpecializationConstant] public const int SIMX = 208;
[SpecializationConstant] public const int SIMZ = 208;

public static const float WORLD_W = 512.0;
public static const float WORLD_H = 288.0;
public static const float WORLD_D = 512.0;

public static const float3 WORLD_SIZE = float3(WORLD_W, WORLD_H, WORLD_D);
public static const float3 VOXEL_SIZE =
    float3(WORLD_W / float(VOLX), WORLD_H / float(VOLY), WORLD_D / float(VOLZ));
public static const float2 SIM_CELL =
    float2(WORLD_W / float(SIMX), WORLD_D / float(SIMZ));

public static const float PI  = 3.14159265359;
public static const float TAU = 6.28318530718;

// ---------------------------------------------------------------------------
//  Parameter block
//
//  All scalars, 4 bytes each, in the same order as src/params.ts. Bind as a
//  uniform buffer (or push it through a descriptor set; it is only 352 bytes,
//  so a UBO is simplest and fastest).
// ---------------------------------------------------------------------------
public struct Params
{
    // --- Geology ---
    public float seed;
    public float bedThickness;
    public float strataDip;
    public float strataAzim;
    public float foldAmp;
    public float foldFreq;
    public float strataWarp;
    public float strataWarpFreq;
    public float hardContrast;
    public float capFrac;
    public float jointDensity;
    public float jointDepth;
    public float jointJitter;
    public float basementY;
    public float basementHard;

    // --- Landform ---
    public float baseHeight;
    public float upliftAmp;
    public float upliftFreq;
    public float initRough;
    public float incisionDepth;
    public float incisionWidth;
    public float meander;
    public float meanderFreq;

    // --- Hydraulics ---
    public float dt;
    public float rain;
    public float riverInflow;
    public float evaporation;
    public float pipeArea;
    public float gravity;
    public float kCapacity;
    public float kErode;
    public float kDeposit;
    public float minSlope;
    public float sedDiffuse;
    public float maxErode;

    // --- 3D erosion ---
    public float undercut;
    public float undercutReach;
    public float weathering;
    public float exposureBias;
    public float saltWeather;
    public float collapseThresh;
    public float collapseRate;
    public float reposeAngle;
    public float talusRate;
    public float regolithProd;
    public float aeolian;

    // --- Water & wind ---
    public uint  showWater;
    public float waterMinDepth;
    public float waterMurk;
    public float waterIOR;
    public float waterRough;
    public float windSpeed;
    public float windDir;
    public float rippleScale;
    public float rippleAmp;
    public float gustiness;
    public float foamAmount;

    // --- Lighting ---
    public float sunAzim;
    public float sunElev;
    public float sunIntensity;
    public float skyIntensity;
    public float turbidity;
    public float bounceStrength;
    public float aoStrength;
    public float shadowSoft;
    public float fogDensity;
    public float dustAmount;
    public float exposure;
    public float satBoost;

    // --- Material ---
    public float detailAmp;
    public float detailFreq;
    public float stratColor;
    public float ironStain;
    public float desertVarnish;
    public float dustCover;
    public float sedimentTint;
    public float rockRough;
    public float vegetation;

    // --- Quality ---
    public uint  maxSteps;
    public float marchRelax;
    public uint  shadowSteps;
    public uint  aoSteps;
    public float detailDist;

    // --- Internal ---
    public float simTime;
    public uint  stepIndex;
    public uint  simRunning;
    public uint  debugView;

    public float _pad0;
}

// ---------------------------------------------------------------------------
//  Hydraulic cell — 64 bytes, matches SimCell in sim_common.wgsl exactly.
// ---------------------------------------------------------------------------
public struct SimCell
{
    public float  h;        // terrain surface height (m)
    public float  water;    // water depth (m)
    public float  sed;      // suspended sediment
    public float  reg;      // loose regolith thickness (m)

    public float4 flux;     // outflow to -X, +X, -Z, +Z

    public float2 vel;      // depth-averaged velocity
    public float  hard;     // rock hardness at the surface
    public float  sedNext;  // advection double-buffer

    public float  h0;       // height as extracted from the SDF this step
    public float  wet;      // long-run wetness
    public float  flowAcc;  // smoothed discharge
    public float  talus;    // debris flux this step
}

// ---------------------------------------------------------------------------
//  Shared helpers
// ---------------------------------------------------------------------------
public float smin(float a, float b, float k)
{
    float h = saturate(0.5 + 0.5 * (b - a) / max(k, 1e-5));
    return lerp(b, a, h) - k * h * (1.0 - h);
}

public float smax(float a, float b, float k)
{
    float h = saturate(0.5 - 0.5 * (b - a) / max(k, 1e-5));
    return lerp(b, a, h) + k * h * (1.0 - h);
}

public float luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

/// Azimuth/elevation (degrees) to a direction. Azimuth 0 = +Z toward +X.
public float3 dirFromAngles(float azimDeg, float elevDeg)
{
    float a = radians(azimDeg);
    float e = radians(elevDeg);
    float ce = cos(e);
    return float3(sin(a) * ce, sin(e), cos(a) * ce);
}

public float3 voxelCenterToWorld(int3 c) { return (float3(c) + 0.5) * VOXEL_SIZE; }
public float3 worldToVoxelF(float3 p)    { return p / VOXEL_SIZE - 0.5; }
public float3 worldToUVW(float3 p)       { return p / WORLD_SIZE; }

public float2 simCellToWorldXZ(int2 c)   { return (float2(c) + 0.5) * SIM_CELL; }
public float2 worldXZToSimF(float2 xz)   { return xz / SIM_CELL - 0.5; }

public uint simIndex(int2 c)
{
    int2 cc = clamp(c, int2(0, 0), int2(SIMX - 1, SIMZ - 1));
    return uint(cc.y * SIMX + cc.x);
}

public bool inSim(int2 c)
{
    return c.x >= 0 && c.y >= 0 && c.x < SIMX && c.y < SIMZ;
}

public float boxSDF(float3 p, float3 c, float3 h)
{
    float3 q = abs(p - c) - h;
    return length(max(q, float3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

public float domainSDF(float3 p)
{
    float3 c = WORLD_SIZE * 0.5;
    return boxSDF(p, c, c);
}

/// Ray/AABB. Returns (tNear, tFar); tFar < tNear means a miss.
public float2 intersectBox(float3 ro, float3 rd, float3 bmin, float3 bmax)
{
    float3 inv = 1.0 / rd;
    float3 t0 = (bmin - ro) * inv;
    float3 t1 = (bmax - ro) * inv;
    float3 ts = min(t0, t1);
    float3 tb = max(t0, t1);
    return float2(max(max(ts.x, ts.y), ts.z), min(min(tb.x, tb.y), tb.z));
}
