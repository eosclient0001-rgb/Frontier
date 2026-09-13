# SDF Erosion Spec — physics, not smoothing

This is the normative spec for every erosive process in Frontier. The cardinal rule:

> **No process may move the surface by averaging neighbor heights.** There are no
> heights. Removal = CSG subtraction of a physically-sized kernel. Addition = CSG
> union of a physically-sized kernel. Transfer = conservative voxel exchange.
> That is what keeps detail instead of melting it.

Notation: `f(p)` SDF (inside < 0), `n = ∇f/|∇f|` outward normal, voxel size `h`.

---

## 0. Shared operators

**Subtract sphere** (crater/cavity), center `c`, radius `r`:

```
f'(p) = max(f(p), r - |p - c|)          // CSG: terrain MINUS ball
```

**Subtract capsule** (gully/groove/scratch), segment `a→b`, radius `r`:

```
d = dist_point_segment(p, a, b)
f'(p) = max(f(p), r - d)
```

**Union blob** (deposition), center `c`, radius `r`:

```
f'(p) = min(f(p), |p - c| - r)          // CSG: terrain UNION ball
```

**Hardness modulation**: every removal radius is scaled before the op:

```
r_eff = r * (1 - hard(p)^γ * resist) * (1 + wet(p) * soften)
```

`hard`/`wet` sampled trilinearly at the voxel. `erode` mask accumulates
`Δerode += (r_eff - d)` clamped ≥ 0 inside the kernel.

**Mass accounting**: crater volume `V = 4/3·π·r_eff³` (sphere) or
`V = π·r_eff²·|b-a| + 4/3·π·r_eff³` (capsule), times inside-fraction estimate
`φ = clamp(0.5 - f(c)/r_eff, 0, 1)`. Removed mass `m = ρ·V·φ` becomes sediment.
`stats.carvedTotal / depositedTotal / inFlight` must balance every frame.

---

## 1. Rain / fluvial (particle, 3-phase)

Each drop is a water parcel with sediment load `s`, water volume `w`, velocity `v`.

### 1a. Spawn
- Positions drawn from `rain` mask (painted + global base rate) by rejection sampling;
  spawn at volume top, `v = wind + (0,-1,0)·1.5`.
- Budget: `rate` drops/sec, pool cap (default 30k), spawn sliced per frame.

### 1b. Ballistic phase
```
v += (g + windAccel - drag·v)·dt ;  p += v·dt
d = f(p)
if d < r_drop:  → IMPACT
if p outside volume or life out: → kill (deposit nothing; counted as runoff loss)
```

### 1c. Impact carve (the money step)
```
n     = ∇f(p)/|∇f(p)|
speed = |v| ;  E = ½·m·speed²
cosA  = clamp(-v̂·n, 0, 1)                    // head-on vs grazing
r     = r_drop · (0.55 + kE·√E) · (0.35 + 0.65·cosA) · hardnessMod(p)
a     = p - v̂·r·1.2 ;  b = p + n·r·0.3       // capsule along shot line
carveCapsule(a, b, r)  →  m_removed
s += m_removed · pickupEff / ρ
w *= splashKeep (0.86) ; erode splat += m_removed
v  = reflect(v, n, restitution 0.18) · friction(0.55) + tangent jitter
if |v| < flowSpeed → FLOW phase
```

Splash rim (optional, cheap realism): `unionBlob` ring approximated by 3 small blobs
around the crater at radius `1.4r`, total volume ≤ 12% of removed.

### 1d. Flow phase (surface runoff, SDF-native)
```
n   = ∇f(p)/|∇f|
g_t = g_vec - n·(g_vec·n)                    // gravity projected on surface
v  += g_t·dt ;  v *= (1 - manning·dt) ;  p += v·dt·flowRate
// re-project to surface band:
d = f(p)
if d > 3h      → BALLISTIC (ran off a cliff — correct, not a bug)
if d < r_drop  → p -= n·(d - r_drop·0.5)     // slide on skin
slope = |g_t| / g
cap   = kCap·|v|·(slope + 0.02)·w            // stream-power capacity
if s > cap:  dep = (s - cap)·kDep·dt  →  unionBlob(p, rFromVol(dep)) ; s -= dep ; sed splat
else:        want = (cap - s)·kDet·dt →  carveCapsule(p-v̂·h·2, p, rGroove) ; s += removed
wet/flow/erode splats along path
w *= (1 - infil·dt - evap·dt)
kill when w < wMin or life out → deposit κ·s as blob, rest stays in sed channel
```

Why this doesn't smooth: detachment only ever *subtracts capsules along the flow
line* (gullies get deeper/narrower, never averaged), deposition only *unions blobs*
(fans/deltas grow outward). There is no neighbor averaging anywhere.

---

## 2. Wind (saltation + abrasion + deflation)

- Particles spawn on the upwind boundary plane, advected toward `windVel` with
  turbulence (curl-ish jitter from `perlin3`).
- Saltation hop: gravity pulls to surface, bounce with restitution 0.35 + downstream
  kick. Inside-surface guard identical to rain.
- **Abrasion** (only on windward faces): on contact,
  ```
  face = clamp(-n·ŵ, 0, 1)                   // 1 = facing the wind
  r = rSalt·(0.3 + 1.4·face)·(|v|/vRef)²·hardnessMod
  carveSphere(p, r) ; s += removed·pickupEff
  ```
  → windward cliffs undercut; yardangs emerge; soft bands etch faster (strata!).
- **Deflation**: where `face > 0.6` and speed high, also drain `sed` channel
  directly into the particle (`s += drain·dt`) — loose fines blow away first.
- **Deposition**: where `n·ŵ > 0.25` (lee) or speed < settle speed,
  `unionBlob` + `sed` splat → dunes/lee drifts. Slight downhill creep added so
  deposits avalanch to angle of repose via the thermal pass.
- Kill at downwind boundary / life out; remaining load deposited.

## 3. Thermal / talus (3D, mass-conservative)

For every voxel with `|f| < band` (default 4h), per iteration:

```
n = ∇f/|∇f|
steep = cosTalus - n.y                        // > 0 means steeper than repose
if steep > 0:
    t  = normalize(g_vec - n·(g_vec·n) + ε·jitter)   // downhill tangent (3D!)
    q  = p + t·h
    amt = kTherm · steep · h · (0.35 + 0.65·(1 - hard(p)))
    f(p) += amt ;  f(q) -= amt               // donor loses, recipient gains
    sed(q) += amt·ρ ; erode(p) += amt
```

- Runs N iterations (default 8–40) as a Jacobi-ish sweep with double buffering on
  alternate passes (v0.1: in-place with small `kTherm`, stable in practice).
- Because `t` is the true 3D downhill tangent, cliffs shed **outward** into talus
  cones and overhangs collapse correctly — a heightfield kernel cannot do this.
- Volume is conserved by construction (every `+=` has a matching `-=`).

## 4. Chemical (dissolution + precipitation)

Per near-surface voxel, per step:

```
sol  = solubility(p)                        // from strata band id + paint
pore = billow3(p·freqHigh)                  // micro-porosity → pitting, not blur
rate = kChem · wet(p) · (0.25 + 0.75·sol) · (0.4 + 0.6·pore) · dt
f(p) += rate · h                            // dissolve: surface retreats
erode(p) += rate
// precipitation (tufa/travertine) where water slows & evaporates:
if flow(p) < fLow and wet(p) > wMid:
    pr = kPrec · wet(p) · (fLow - flow(p)) · dt
    f(p) -= pr · h ; sed(p) += pr
```

- Karst preset: high `sol` in one strata band + high `kChem` + cave seeds ⇒
  sinkholes, etched pinnacles. The high-frequency `pore` term guarantees roughness
  *increases* under chemical attack — the opposite of smoothing.

## 5. Water bookkeeping (v0.1)

- Water is carried by particles (`w`) + stored as `wet`/`flow` fields; there is no
  separate water mesh simulation yet (v0.2: shallow-water drape per chunk).
- Rendered water = analytic plane at `waterLevel` + `wet`-darkened shoreline band
  in the shader. `flow` accumulation seeds where the v0.2 water table will init.

## 6. Numerics & budgets

- SDF queries are trilinear; gradients central-difference (6 taps). Hot loops avoid
  allocation; particle pools are preallocated `Float32Array`s with swap-remove.
- Per-frame simulator budget default 6 ms total (configurable); particle substeps
  capped (ballistic 3, flow 2) with velocity clamp `vMax = 40 m/s`.
- Eikonal maintenance: after bulk carving, 2 relaxation sweeps of
  `f = (f + mean6(f) ± h)/…`? **No** — that's smoothing-adjacent. Instead: only
  re-distancing inside the edited bbox via fast marching limited to `8h` band,
  preserving the carved detail (v0.1: skip re-distancing; gradients stay usable
  because kernels are smooth — revisit if artifacts appear).
