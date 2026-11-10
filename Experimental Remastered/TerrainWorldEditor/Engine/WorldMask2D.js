/*==========================================================================================================================================
                                                           WORLDMASK2D.JS
==========================================================================================================================================*/
// Infinite 2D Sparse-Tile Terrain Mask & Separate Toggleable Terrain Bounds Layer Engine for Frontier Terrain Studio.
// Reuses & adapts the sparse-tile world map design from c7egoist/Frontier (src/world/world-map.js):
// - Unbounded 2D world coordinates in meters (sparse 256x256 tiles, 1 tile = 1000m x 1000m = 1 km^2, 0 bytes for empty ocean,
//   automatic empty-tile pruning, and O(visible) tile range queries with zero artificial world-size limit)
// - Composable 2D Mask Layers supporting visibility, lock, opacity, boolean blend ('union' | 'subtract' | 'intersect'),
//   duplicate, reorder, clear, capsule stroke, organic polygon/lasso, and island/archipelago/circle/rect stamps
// - First-class Separate Terrain Bounds Layer per terrain (`region.boundsLayer`) + global `world.boundsLayerVisible` toggle,
//   editable independently of drawn masks OR synchronized automatically / on-demand with painted 2D masks
// - Exact linear-time O(N) 2D Euclidean Signed Distance Field (Meijster / Felzenszwalb-Huttenlocher separable EDT)

export const MASK_TILE_RES = 256;
export const TILE_WORLD_METERS = 1000.0; // 1 tile = 1 km x 1 km (~3.90625 m per mask texel)
export const METERS_PER_MASK_PIXEL = TILE_WORLD_METERS / MASK_TILE_RES;
export const MIN_BOUNDS_SPAN_METERS = 120.0;

const Clamp = (V, Lo, Hi) => (V < Lo ? Lo : V > Hi ? Hi : V);
export const TileKey = (Tx, Tz) => `${Tx},${Tz}`;

export function ParseTileKey(Key)
{
    const Sep = Key.indexOf(',');
    return [Number(Key.slice(0, Sep)), Number(Key.slice(Sep + 1))];
}

let NextUid = 1;
export function MakeTerrainUid(Prefix = 'trn')
{
    return `${Prefix}-${NextUid++}`;
}

function Hash2D(Ix, Iy, Seed = 4029)
{
    let H = Math.imul(Ix, 374761393) ^ Math.imul(Iy, 668265263) ^ Math.imul(Seed | 0, 1442695041);
    H = Math.imul(H ^ (H >>> 13), 1274126177);
    return ((H ^ (H >>> 16)) >>> 0) / 4294967295.0;
}

function ValueNoise2D(X, Y, Seed = 4029)
{
    const X0 = Math.floor(X), Y0 = Math.floor(Y);
    const Fx = X - X0, Fy = Y - Y0;
    const Ux = Fx * Fx * (3.0 - 2.0 * Fx);
    const Uy = Fy * Fy * (3.0 - 2.0 * Fy);
    const A = Hash2D(X0, Y0, Seed);
    const B = Hash2D(X0 + 1, Y0, Seed);
    const C = Hash2D(X0, Y0 + 1, Seed);
    const D = Hash2D(X0 + 1, Y0 + 1, Seed);
    return (A + (B - A) * Ux) + ((C + (D - C) * Ux) - (A + (B - A) * Ux)) * Uy;
}

export function CoastFbm2D(X, Y, Octaves = 4, Seed = 4029)
{
    let Sum = 0.0, Amp = 0.5, Freq = 1.0, Norm = 0.0;
    for (let I = 0; I < Octaves; ++I)
    {
        Sum += Amp * ValueNoise2D(X * Freq, Y * Freq, Seed + I * 97);
        Norm += Amp;
        Amp *= 0.5;
        Freq *= 2.03;
    }
    return Sum / Math.max(1e-6, Norm);
}

export function NormalizeBoundsRect(Bounds = {})
{
    const X = Number.isFinite(Number(Bounds.x)) ? Number(Bounds.x) : -600.0;
    const Z = Number.isFinite(Number(Bounds.z)) ? Number(Bounds.z) : -600.0;
    const Width = Math.max(MIN_BOUNDS_SPAN_METERS, Number(Bounds.width) || 1200.0);
    const Depth = Math.max(MIN_BOUNDS_SPAN_METERS, Number(Bounds.depth) || 1200.0);
    return {
        x: Math.round(X),
        z: Math.round(Z),
        width: Math.round(Width),
        depth: Math.round(Depth)
    };
}

/*==========================================================================================================================================
                                           COMPACT RLE SERIALIZATION FOR SPARSE TILES
==========================================================================================================================================*/
function EncodeUint8Rle(Bytes)
{
    const Runs = [];
    let I = 0;
    const N = Bytes.length;
    while (I < N)
    {
        const Val = Bytes[I];
        let Count = 1;
        while (I + Count < N && Bytes[I + Count] === Val && Count < 65535) Count++;
        Runs.push(Val, Count);
        I += Count;
    }
    return Runs;
}

function DecodeUint8Rle(Runs, Length)
{
    const Out = new Uint8Array(Length);
    let P = 0;
    for (let I = 0; I < Runs.length; I += 2)
    {
        const Val = Runs[I] & 255;
        const Count = Runs[I + 1] | 0;
        Out.fill(Val, P, Math.min(Length, P + Count));
        P += Count;
    }
    return Out;
}

/*==========================================================================================================================================
                                                 INFINITE 2D WORLD DOCUMENT MODEL
==========================================================================================================================================*/
export class WorldMask2D
{
    constructor()
    {
        this.maskLayers = [];
        this.regions = [];
        this.seaLevel = 0.0;
        this.oceanVisible = true;
        // Global visibility toggle for the separate Terrain Bounds layer across the 2D & 3D workspaces
        this.boundsLayerVisible = true;
        // Optional workflow convenience: automatically create a Terrain Region + Bounds Layer when painting on open ocean
        this.autoCreateTerrainOnNewMask = false;
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                            2D MASK LAYER MANAGEMENT (NON-DESTRUCTIVE STACK)
    --------------------------------------------------------------------------------------------------------------------------------------*/
    addMaskLayer(Spec = {})
    {
        const Palette = ['#58b982', '#5ac8fa', '#a3d977', '#e8c27a', '#d8846f', '#a78bfa'];
        const Color = Spec.color || Palette[this.maskLayers.length % Palette.length];
        const Layer = {
            id: Spec.id || MakeTerrainUid('mask'),
            name: Spec.name || `Terrain Mask ${String(this.maskLayers.length + 1).padStart(2, '0')}`,
            visible: Spec.visible !== false,
            locked: !!Spec.locked,
            opacity: Clamp(Number(Spec.opacity ?? 1.0), 0.0, 1.0),
            blendMode: ['union', 'subtract', 'intersect'].includes(Spec.blendMode) ? Spec.blendMode : 'union',
            color: Color,
            revision: 1,
            tiles: new Map() // Map<"tx,tz", { data: Uint8Array(256*256), dirty: boolean }>
        };
        this.maskLayers.push(Layer);
        return Layer;
    }

    getMaskLayer(LayerId)
    {
        return this.maskLayers.find(L => L.id === LayerId) || null;
    }

    duplicateMaskLayer(LayerId)
    {
        const Src = this.getMaskLayer(LayerId);
        if (!Src) return null;
        const Copy = this.addMaskLayer({
            name: `${Src.name} Copy`,
            visible: Src.visible,
            locked: false,
            opacity: Src.opacity,
            blendMode: Src.blendMode,
            color: Src.color
        });
        for (const [Key, Rec] of Src.tiles.entries())
        {
            Copy.tiles.set(Key, { data: new Uint8Array(Rec.data), dirty: true });
        }
        return Copy;
    }

    clearMaskLayer(LayerId)
    {
        const Layer = this.getMaskLayer(LayerId);
        if (!Layer || Layer.locked) return false;
        Layer.tiles.clear();
        Layer.revision++;
        this.markRegionsDirtyInRect(-1e9, -1e9, 1e9, 1e9, Layer.id);
        return true;
    }

    removeMaskLayer(LayerId)
    {
        if (this.maskLayers.length <= 1) return false;
        const Idx = this.maskLayers.findIndex(L => L.id === LayerId);
        if (Idx < 0) return false;
        this.maskLayers.splice(Idx, 1);
        const FallbackId = this.maskLayers[Math.max(0, Idx - 1)]?.id || null;
        for (const R of this.regions)
        {
            if (R.maskLayerId === LayerId)
            {
                R.maskLayerId = FallbackId;
                R.dirty = true;
                R.meshDirty = true;
            }
            if (Array.isArray(R.maskLayerIds))
            {
                const Pos = R.maskLayerIds.indexOf(LayerId);
                if (Pos >= 0)
                {
                    R.maskLayerIds.splice(Pos, 1);
                    R.dirty = true;
                    R.meshDirty = true;
                }
            }
        }
        return true;
    }

    reorderMaskLayer(LayerId, DeltaIndex)
    {
        const Idx = this.maskLayers.findIndex(L => L.id === LayerId);
        if (Idx < 0) return false;
        const Target = Clamp(Idx + DeltaIndex, 0, this.maskLayers.length - 1);
        if (Target === Idx) return false;
        const [Moved] = this.maskLayers.splice(Idx, 1);
        this.maskLayers.splice(Target, 0, Moved);
        this.markRegionsDirtyInRect(-1e9, -1e9, 1e9, 1e9, null);
        return true;
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                     TERRAIN REGIONS & SEPARATE TOGGLEABLE BOUNDS LAYER MANAGEMENT
    --------------------------------------------------------------------------------------------------------------------------------------*/
    getRegion(RegionId)
    {
        return this.regions.find(R => R.id === RegionId) || null;
    }

    removeRegion(RegionId)
    {
        const Idx = this.regions.findIndex(R => R.id === RegionId);
        if (Idx >= 0)
        {
            this.regions.splice(Idx, 1);
            return true;
        }
        return false;
    }

    duplicateRegion(RegionId, OffsetX = 320.0, OffsetZ = 240.0)
    {
        const Src = this.getRegion(RegionId);
        if (!Src) return null;
        let NewMaskId = Src.maskLayerId;
        if (Src.maskLayerId)
        {
            const SrcMask = this.getMaskLayer(Src.maskLayerId);
            if (SrcMask)
            {
                const DupMask = this.addMaskLayer({
                    name: `${SrcMask.name} Copy`,
                    color: SrcMask.color,
                    opacity: SrcMask.opacity,
                    blendMode: SrcMask.blendMode
                });
                this._copyTranslatedMaskTiles(SrcMask, DupMask, OffsetX, OffsetZ);
                NewMaskId = DupMask.id;
            }
        }
        const ClonedStack = JSON.parse(JSON.stringify(Src.stack.map(L => ({ ...L, deltas: undefined }))));
        for (let I = 0; I < ClonedStack.length; ++I)
        {
            ClonedStack[I].id = MakeTerrainUid('lyr');
            if (Src.stack[I]?.deltas instanceof Float32Array)
            {
                ClonedStack[I].deltas = new Float32Array(Src.stack[I].deltas);
            }
            if (ClonedStack[I].type === 'spline' && Array.isArray(ClonedStack[I].points))
            {
                ClonedStack[I].points = ClonedStack[I].points.map(Pt => [
                    Math.round(Pt[0] + OffsetX),
                    Math.round(Pt[1] + OffsetZ),
                    ...(Pt.length > 2 ? [Pt[2]] : [])
                ]);
            }
        }
        return this.addTerrainRegion({
            name: `${Src.name} Copy`,
            maskLayerId: NewMaskId,
            enabled: Src.enabled,
            color: Src.color,
            bounds: {
                x: Src.bounds.x + OffsetX,
                z: Src.bounds.z + OffsetZ,
                width: Src.bounds.width,
                depth: Src.bounds.depth
            },
            boundsLayer: {
                visible: Src.boundsLayer.visible,
                locked: false,
                autoSyncMask: Src.boundsLayer.autoSyncMask,
                paddingMeters: Src.boundsLayer.paddingMeters
            },
            resolution: Src.resolution,
            reliefScale: Src.reliefScale,
            baseElevation: Src.baseElevation,
            slabThickness: Src.slabThickness,
            shorelineBevel: Src.shorelineBevel,
            maxRelief: Src.maxRelief,
            stack: ClonedStack
        });
    }

    _copyTranslatedMaskTiles(SrcLayer, DstLayer, OffsetX, OffsetZ)
    {
        const ShiftPx = Math.round((OffsetX / TILE_WORLD_METERS) * MASK_TILE_RES);
        const ShiftPz = Math.round((OffsetZ / TILE_WORLD_METERS) * MASK_TILE_RES);
        for (const [Key, Rec] of SrcLayer.tiles.entries())
        {
            const [Tx, Tz] = ParseTileKey(Key);
            const Data = Rec.data;
            for (let Pz = 0; Pz < MASK_TILE_RES; ++Pz)
            {
                const Row = Pz * MASK_TILE_RES;
                for (let Px = 0; Px < MASK_TILE_RES; ++Px)
                {
                    const Val = Data[Row + Px];
                    if (!Val) continue;
                    const Gx = Tx * MASK_TILE_RES + Px + ShiftPx;
                    const Gz = Tz * MASK_TILE_RES + Pz + ShiftPz;
                    const Ntx = Math.floor(Gx / MASK_TILE_RES);
                    const Ntz = Math.floor(Gz / MASK_TILE_RES);
                    const NKey = TileKey(Ntx, Ntz);
                    let DstRec = DstLayer.tiles.get(NKey);
                    if (!DstRec)
                    {
                        DstRec = { data: new Uint8Array(MASK_TILE_RES * MASK_TILE_RES), dirty: true };
                        DstLayer.tiles.set(NKey, DstRec);
                    }
                    const Lx = Gx - Ntx * MASK_TILE_RES;
                    const Lz = Gz - Ntz * MASK_TILE_RES;
                    DstRec.data[Lz * MASK_TILE_RES + Lx] = Val;
                }
            }
        }
        DstLayer.revision++;
    }

    isRegionBoundsVisible(Region)
    {
        if (!this.boundsLayerVisible || !Region) return false;
        return Region.boundsLayer ? Region.boundsLayer.visible !== false : true;
    }

    setRegionBounds(RegionOrId, NextBounds, Options = {})
    {
        const Region = typeof RegionOrId === 'string' ? this.getRegion(RegionOrId) : RegionOrId;
        if (!Region) return false;
        if (Region.locked || (Region.boundsLayer?.locked && !Options.ignoreLock)) return false;

        const Norm = NormalizeBoundsRect(NextBounds);
        Region.boundsLayer.x = Norm.x;
        Region.boundsLayer.z = Norm.z;
        Region.boundsLayer.width = Norm.width;
        Region.boundsLayer.depth = Norm.depth;
        if (Options.manualEdit)
        {
            // Explicit manual bounds resize/move preserves independent bounds editing
            Region.boundsLayer.autoSyncMask = false;
        }
        Region.dirty = true;
        Region.meshDirty = true;
        return true;
    }

    syncRegionBoundsToMask(RegionOrId, PaddingOverride = null)
    {
        const Region = typeof RegionOrId === 'string' ? this.getRegion(RegionOrId) : RegionOrId;
        if (!Region || Region.locked || Region.boundsLayer?.locked) return null;
        const Pad = Number.isFinite(PaddingOverride) ? PaddingOverride : (Region.boundsLayer?.paddingMeters ?? 90.0);
        const Mask = Region.maskLayerId ? this.getMaskLayer(Region.maskLayerId) : null;
        const Fitted = Mask
            ? this.computeLayerPaintedBounds(Mask, Pad)
            : this.computeCompositePaintedBounds(Pad);
        if (!Fitted) return null;
        this.setRegionBounds(Region, Fitted, { manualEdit: false, ignoreLock: true });
        return Fitted;
    }

    translateRegionsBounds(RegionIds, DxMeters, DzMeters, Options = {})
    {
        const Dx = Math.round(DxMeters);
        const Dz = Math.round(DzMeters);
        if (Dx === 0 && Dz === 0) return [];
        const Moved = [];
        for (const Id of RegionIds)
        {
            const R = this.getRegion(Id);
            if (!R || R.locked || R.boundsLayer?.locked) continue;
            R.boundsLayer.x += Dx;
            R.boundsLayer.z += Dz;
            if (Options.manualEdit !== false) R.boundsLayer.autoSyncMask = false;
            R.dirty = true;
            R.meshDirty = true;
            Moved.push(R);
        }
        return Moved;
    }

    totalAllocatedTiles()
    {
        let Total = 0;
        for (const L of this.maskLayers) Total += L.tiles.size;
        return Total;
    }

    totalAllocatedBytes()
    {
        return this.totalAllocatedTiles() * MASK_TILE_RES * MASK_TILE_RES;
    }

    /**
     * Returns only allocated tile keys intersecting the given world-meter view box (O(visible) viewport culling).
     */
    visibleTileKeysForLayer(Layer, MinWx, MinWz, MaxWx, MaxWz)
    {
        if (!Layer || Layer.tiles.size === 0) return [];
        const MinTx = Math.floor(MinWx / TILE_WORLD_METERS);
        const MaxTx = Math.floor(MaxWx / TILE_WORLD_METERS);
        const MinTz = Math.floor(MinWz / TILE_WORLD_METERS);
        const MaxTz = Math.floor(MaxWz / TILE_WORLD_METERS);
        const SpanCount = (MaxTx - MinTx + 1) * (MaxTz - MinTz + 1);
        const Out = [];

        if (SpanCount <= Layer.tiles.size * 2)
        {
            for (let Tz = MinTz; Tz <= MaxTz; ++Tz)
            {
                for (let Tx = MinTx; Tx <= MaxTx; ++Tx)
                {
                    const Key = TileKey(Tx, Tz);
                    if (Layer.tiles.has(Key)) Out.push(Key);
                }
            }
        }
        else
        {
            for (const Key of Layer.tiles.keys())
            {
                const [Tx, Tz] = ParseTileKey(Key);
                if (Tx >= MinTx && Tx <= MaxTx && Tz >= MinTz && Tz <= MaxTz) Out.push(Key);
            }
        }
        return Out;
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                            INFINITE SPARSE-TILE BILINEAR MASK SAMPLING
    --------------------------------------------------------------------------------------------------------------------------------------*/
    /**
     * Bilinear sample of a single 2D Mask Layer at world coordinates (Wx, Wz) in meters -> [0..1].
     */
    sampleLayerMask(Layer, Wx, Wz)
    {
        if (!Layer || !Layer.visible || Layer.tiles.size === 0) return 0.0;
        const Opacity = Layer.opacity ?? 1.0;
        if (Opacity <= 1e-4) return 0.0;

        const Gx = (Wx / TILE_WORLD_METERS) * MASK_TILE_RES - 0.5;
        const Gz = (Wz / TILE_WORLD_METERS) * MASK_TILE_RES - 0.5;
        const X0 = Math.floor(Gx), Z0 = Math.floor(Gz);
        const Fx = Gx - X0, Fz = Gz - Z0;

        const At = (Px, Pz) =>
        {
            const Tx = Math.floor(Px / MASK_TILE_RES);
            const Tz = Math.floor(Pz / MASK_TILE_RES);
            const TileRec = Layer.tiles.get(TileKey(Tx, Tz));
            if (!TileRec) return 0;
            const Lx = Px - Tx * MASK_TILE_RES;
            const Lz = Pz - Tz * MASK_TILE_RES;
            return TileRec.data[Lz * MASK_TILE_RES + Lx];
        };

        const V00 = At(X0, Z0), V10 = At(X0 + 1, Z0);
        const V01 = At(X0, Z0 + 1), V11 = At(X0 + 1, Z0 + 1);
        const Top = V00 + (V10 - V00) * Fx;
        const Bot = V01 + (V11 - V01) * Fx;
        return ((Top + (Bot - Top) * Fz) / 255.0) * Opacity;
    }

    sampleCoverageMeters(Wx, Wz, MaskLayerId = null)
    {
        if (MaskLayerId && MaskLayerId !== 'all' && MaskLayerId !== '__all__')
        {
            const L = this.getMaskLayer(MaskLayerId);
            return L ? this.sampleLayerMask(L, Wx, Wz) : 0.0;
        }
        let Acc = 0.0;
        for (const L of this.maskLayers)
        {
            if (!L.visible) continue;
            const Val = this.sampleLayerMask(L, Wx, Wz);
            const Mode = L.blendMode || 'union';
            if (Mode === 'subtract') Acc = Math.max(0.0, Acc - Val);
            else if (Mode === 'intersect') Acc = Math.min(Acc, Val);
            else Acc = Math.max(Acc, Val);
        }
        return Acc;
    }

    sampleRegionMask(Region, Wx, Wz)
    {
        if (!Region) return 0.0;
        if (Region.maskLayerVisible === false) return 0.0;
        if (Array.isArray(Region.maskLayerIds) && Region.maskLayerIds.length > 0)
        {
            let Acc = 0.0;
            for (const Id of Region.maskLayerIds)
            {
                const L = this.getMaskLayer(Id);
                if (!L || !L.visible) continue;
                const Val = this.sampleLayerMask(L, Wx, Wz);
                const Mode = L.blendMode || 'union';
                if (Mode === 'subtract') Acc = Math.max(0.0, Acc - Val);
                else if (Mode === 'intersect') Acc = Math.min(Acc, Val);
                else Acc = Math.max(Acc, Val);
            }
            return Acc;
        }
        return this.sampleCoverageMeters(Wx, Wz, Region.maskLayerId);
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                     INFINITE 2D MASK DRAWING TOOLS (CAPSULE, POLYGON, STAMP)
    --------------------------------------------------------------------------------------------------------------------------------------*/
    _notifyMaskChanged(Layer, MinX, MinZ, MaxX, MaxZ)
    {
        Layer.revision++;
        // Auto-sync any Terrain Bounds Layer configured to track this 2D mask
        for (const R of this.regions)
        {
            const UsesMask = !R.maskLayerId || R.maskLayerId === '__all__' || R.maskLayerId === Layer.id
                || (Array.isArray(R.maskLayerIds) && R.maskLayerIds.includes(Layer.id));
            if (UsesMask && R.boundsLayer?.autoSyncMask && !R.locked && !R.boundsLayer.locked)
            {
                this.syncRegionBoundsToMask(R);
            }
        }
        this.markRegionsDirtyInRect(MinX, MinZ, MaxX, MaxZ, Layer.id);
    }

    onMaskEdited(Layer, StrokeBounds)
    {
        if (!Layer || !StrokeBounds || !this.autoCreateTerrainOnNewMask) return null;
        const MinX = StrokeBounds.x, MinZ = StrokeBounds.z;
        const MaxX = MinX + StrokeBounds.width, MaxZ = MinZ + StrokeBounds.depth;
        for (const R of this.regions)
        {
            const B = R.bounds;
            if (MaxX >= B.x && MinX <= B.x + B.width && MaxZ >= B.z && MinZ <= B.z + B.depth)
            {
                return null;
            }
        }
        const Pad = 110.0;
        return this.addTerrainRegion({
            maskLayerId: Layer.id,
            bounds: {
                x: Math.round(MinX - Pad),
                z: Math.round(MinZ - Pad),
                width: Math.max(260, Math.round(StrokeBounds.width + Pad * 2.0)),
                depth: Math.max(260, Math.round(StrokeBounds.depth + Pad * 2.0))
            },
            boundsLayer: {
                visible: true,
                locked: false,
                autoSyncMask: true,
                paddingMeters: Pad
            }
        });
    }

    /**
     * Paints or erases a continuous 2D capsule stroke in world meters across arbitrary sparse tile boundaries.
     */
    paintCapsuleMeters(Layer, P0, P1, RadiusMeters, Mode = 'paint', Strength = 1.0, RoughCoast = 0.0, Seed = 4029)
    {
        if (!Layer || Layer.locked) return [];
        const X0 = P0[0], Z0 = P0[1];
        const X1 = P1[0], Z1 = P1[1];
        const R = Clamp(RadiusMeters, METERS_PER_MASK_PIXEL * 1.2, 5000.0);
        const Dist = Math.hypot(X1 - X0, Z1 - Z0);
        const Steps = Math.max(1, Math.ceil(Dist / Math.max(4.0, R * 0.35)));
        const TouchedKeys = new Set();
        const SoftFeather = Math.max(METERS_PER_MASK_PIXEL * 1.5, R * 0.18);

        for (let S = 0; S <= Steps; ++S)
        {
            const T = S / Steps;
            const Cx = X0 + (X1 - X0) * T;
            const Cz = Z0 + (Z1 - Z0) * T;
            const Pad = R * (1.0 + RoughCoast * 0.42) + SoftFeather;

            const MinPx = Math.floor(((Cx - Pad) / TILE_WORLD_METERS) * MASK_TILE_RES);
            const MaxPx = Math.ceil(((Cx + Pad) / TILE_WORLD_METERS) * MASK_TILE_RES);
            const MinPz = Math.floor(((Cz - Pad) / TILE_WORLD_METERS) * MASK_TILE_RES);
            const MaxPz = Math.ceil(((Cz + Pad) / TILE_WORLD_METERS) * MASK_TILE_RES);

            for (let Pz = MinPz; Pz <= MaxPz; ++Pz)
            {
                const Wz = ((Pz + 0.5) / MASK_TILE_RES) * TILE_WORLD_METERS;
                const Tz = Math.floor(Pz / MASK_TILE_RES);
                const Lz = Pz - Tz * MASK_TILE_RES;

                for (let Px = MinPx; Px <= MaxPx; ++Px)
                {
                    const Wx = ((Px + 0.5) / MASK_TILE_RES) * TILE_WORLD_METERS;
                    let EffR = R;
                    if (RoughCoast > 0.01)
                    {
                        const N = CoastFbm2D(Wx * 0.0045, Wz * 0.0045, 4, Seed) - 0.5;
                        EffR = R * (1.0 + N * RoughCoast * 0.85);
                    }
                    const D = Math.hypot(Wx - Cx, Wz - Cz);
                    if (D >= EffR + SoftFeather) continue;

                    const Falloff = Clamp(1.0 - (D - (EffR - SoftFeather)) / (2.0 * SoftFeather), 0.0, 1.0);
                    const Smooth = Falloff * Falloff * (3.0 - 2.0 * Falloff);
                    const Delta255 = Math.round(Smooth * Clamp(Strength, 0.05, 1.0) * 255);
                    if (Delta255 <= 0) continue;

                    const Tx = Math.floor(Px / MASK_TILE_RES);
                    const Key = TileKey(Tx, Tz);
                    let TileRec = Layer.tiles.get(Key);
                    if (!TileRec)
                    {
                        if (Mode === 'erase') continue;
                        TileRec = { data: new Uint8Array(MASK_TILE_RES * MASK_TILE_RES), dirty: true };
                        Layer.tiles.set(Key, TileRec);
                    }

                    const Idx = Lz * MASK_TILE_RES + (Px - Tx * MASK_TILE_RES);
                    const Prev = TileRec.data[Idx];
                    let Next = Prev;
                    if (Mode === 'erase')
                    {
                        Next = Math.max(0, Prev - Delta255);
                    }
                    else if (Mode === 'smooth')
                    {
                        Next = Math.round(Prev + (128 - Prev) * Smooth * 0.25);
                    }
                    else
                    {
                        Next = Math.max(Prev, Math.min(255, Delta255));
                    }

                    if (Next !== Prev)
                    {
                        TileRec.data[Idx] = Next;
                        TileRec.dirty = true;
                        TouchedKeys.add(Key);
                    }
                }
            }
        }

        if (TouchedKeys.size > 0)
        {
            if (Mode === 'erase')
            {
                for (const Key of TouchedKeys)
                {
                    const TileRec = Layer.tiles.get(Key);
                    if (TileRec && !TileRec.data.some(Boolean)) Layer.tiles.delete(Key);
                }
            }
            this._notifyMaskChanged(
                Layer,
                Math.min(X0, X1) - R * 1.6,
                Math.min(Z0, Z1) - R * 1.6,
                Math.max(X0, X1) + R * 1.6,
                Math.max(Z0, Z1) + R * 1.6
            );
        }
        return Array.from(TouchedKeys);
    }

    /**
     * Stamps a procedural landform silhouette ('island' | 'archipelago' | 'atoll' | 'rect') onto a 2D Mask Layer at (Cx, Cz).
     */
    paintStampMeters(Layer, CenterXZ, RadiusMeters = 380.0, StampKind = 'island', Erase = false, Roughness = 0.34, Seed = 4029)
    {
        if (!Layer || Layer.locked) return [];
        const Cx = CenterXZ[0], Cz = CenterXZ[1];
        const R = Clamp(RadiusMeters, 30.0, 6000.0);
        const Mode = Erase ? 'erase' : 'paint';

        if (StampKind === 'archipelago')
        {
            const Keys = new Set();
            const Main = this.paintCapsuleMeters(Layer, [Cx - R * 0.28, Cz - R * 0.12], [Cx + R * 0.24, Cz + R * 0.16], R * 0.56, Mode, 1.0, Roughness, Seed);
            Main.forEach(K => Keys.add(K));
            const Count = 4;
            for (let I = 0; I < Count; ++I)
            {
                const Ang = (I / Count) * Math.PI * 2.0 + Hash2D(I, 7, Seed) * 1.2;
                const Dist = R * (0.72 + 0.34 * Hash2D(I, 19, Seed));
                const SubR = R * (0.18 + 0.14 * Hash2D(I, 31, Seed));
                const Sub = this.paintCapsuleMeters(
                    Layer,
                    [Cx + Math.cos(Ang) * Dist, Cz + Math.sin(Ang) * Dist],
                    [Cx + Math.cos(Ang + 0.18) * Dist, Cz + Math.sin(Ang + 0.18) * Dist],
                    SubR, Mode, 1.0, Roughness, Seed + I * 131
                );
                Sub.forEach(K => Keys.add(K));
            }
            return Array.from(Keys);
        }

        if (StampKind === 'atoll')
        {
            const Keys = new Set();
            this.paintCapsuleMeters(Layer, [Cx - R * 0.18, Cz], [Cx + R * 0.18, Cz], R * 0.85, Mode, 1.0, Roughness, Seed).forEach(K => Keys.add(K));
            if (!Erase)
            {
                this.paintCapsuleMeters(Layer, [Cx, Cz], [Cx + R * 0.35, Cz - R * 0.28], R * 0.42, 'erase', 1.0, Roughness * 0.8, Seed + 97).forEach(K => Keys.add(K));
            }
            return Array.from(Keys);
        }

        if (StampKind === 'rect')
        {
            const Hw = R * 0.95, Hd = R * 0.72;
            return this.paintPolygonMeters(Layer, [
                [Cx - Hw, Cz - Hd],
                [Cx + Hw, Cz - Hd],
                [Cx + Hw, Cz + Hd],
                [Cx - Hw, Cz + Hd]
            ], Erase, Roughness * 0.45, Seed);
        }

        return this.paintCapsuleMeters(Layer, [Cx - R * 0.16, Cz - R * 0.08], [Cx + R * 0.16, Cz + R * 0.08], R * 0.82, Mode, 1.0, Roughness, Seed);
    }

    /**
     * Fills or carves an arbitrary closed 2D polygon (with optional organic fBm shoreline perturbation) in world meters.
     */
    paintPolygonMeters(Layer, PointsXZ, Erase = false, CoastRoughness = 0.22, Seed = 4029)
    {
        if (!Layer || Layer.locked || !PointsXZ || PointsXZ.length < 3) return [];
        let MinX = 1e9, MinZ = 1e9, MaxX = -1e9, MaxZ = -1e9;
        for (const [X, Z] of PointsXZ)
        {
            if (X < MinX) MinX = X;
            if (X > MaxX) MaxX = X;
            if (Z < MinZ) MinZ = Z;
            if (Z > MaxZ) MaxZ = Z;
        }
        const Pad = 95.0;
        const MinPx = Math.floor(((MinX - Pad) / TILE_WORLD_METERS) * MASK_TILE_RES);
        const MaxPx = Math.ceil(((MaxX + Pad) / TILE_WORLD_METERS) * MASK_TILE_RES);
        const MinPz = Math.floor(((MinZ - Pad) / TILE_WORLD_METERS) * MASK_TILE_RES);
        const MaxPz = Math.ceil(((MaxZ + Pad) / TILE_WORLD_METERS) * MASK_TILE_RES);
        const NVerts = PointsXZ.length;
        const TouchedKeys = new Set();

        for (let Pz = MinPz; Pz <= MaxPz; ++Pz)
        {
            const Wz = ((Pz + 0.5) / MASK_TILE_RES) * TILE_WORLD_METERS;
            const Tz = Math.floor(Pz / MASK_TILE_RES);
            const Lz = Pz - Tz * MASK_TILE_RES;

            for (let Px = MinPx; Px <= MaxPx; ++Px)
            {
                const Wx = ((Px + 0.5) / MASK_TILE_RES) * TILE_WORLD_METERS;
                let Qx = Wx, Qz = Wz;
                if (CoastRoughness > 0.005)
                {
                    const WarpX = (CoastFbm2D(Wx * 0.0032, Wz * 0.0032, 4, Seed) - 0.5) * 140.0 * CoastRoughness;
                    const WarpZ = (CoastFbm2D(Wx * 0.0032 + 19.3, Wz * 0.0032 + 7.1, 4, Seed + 31) - 0.5) * 140.0 * CoastRoughness;
                    Qx += WarpX;
                    Qz += WarpZ;
                }

                let Inside = false;
                let MinEdgeSq = 1e18;
                for (let I = 0, J = NVerts - 1; I < NVerts; J = I++)
                {
                    const Ax = PointsXZ[J][0], Az = PointsXZ[J][1];
                    const Bx = PointsXZ[I][0], Bz = PointsXZ[I][1];
                    if (((Az > Qz) !== (Bz > Qz)) && (Qx < ((Bx - Ax) * (Qz - Az)) / (Bz - Az + 1e-12) + Ax))
                    {
                        Inside = !Inside;
                    }
                    const Ex = Bx - Ax, Ez = Bz - Az;
                    const LenSq = Math.max(1e-6, Ex * Ex + Ez * Ez);
                    const T = Clamp(((Qx - Ax) * Ex + (Qz - Az) * Ez) / LenSq, 0.0, 1.0);
                    const Dx = Qx - (Ax + Ex * T), Dz = Qz - (Az + Ez * T);
                    const DSq = Dx * Dx + Dz * Dz;
                    if (DSq < MinEdgeSq) MinEdgeSq = DSq;
                }

                const SignedD = (Inside ? -1.0 : 1.0) * Math.sqrt(MinEdgeSq);
                const Feather = METERS_PER_MASK_PIXEL * 2.2;
                if (SignedD >= Feather) continue;

                const Cov = Clamp(0.5 - SignedD / (2.0 * Feather), 0.0, 1.0);
                const Val255 = Math.round(Cov * 255);
                if (Val255 <= 0) continue;

                const Tx = Math.floor(Px / MASK_TILE_RES);
                const Key = TileKey(Tx, Tz);
                let TileRec = Layer.tiles.get(Key);
                if (!TileRec)
                {
                    if (Erase) continue;
                    TileRec = { data: new Uint8Array(MASK_TILE_RES * MASK_TILE_RES), dirty: true };
                    Layer.tiles.set(Key, TileRec);
                }
                const Idx = Lz * MASK_TILE_RES + (Px - Tx * MASK_TILE_RES);
                const Next = Erase ? Math.max(0, TileRec.data[Idx] - Val255) : Math.max(TileRec.data[Idx], Val255);
                if (Next !== TileRec.data[Idx])
                {
                    TileRec.data[Idx] = Next;
                    TileRec.dirty = true;
                    TouchedKeys.add(Key);
                }
            }
        }

        if (TouchedKeys.size > 0)
        {
            if (Erase)
            {
                for (const Key of TouchedKeys)
                {
                    const TileRec = Layer.tiles.get(Key);
                    if (TileRec && !TileRec.data.some(Boolean)) Layer.tiles.delete(Key);
                }
            }
            this._notifyMaskChanged(Layer, MinX - Pad, MinZ - Pad, MaxX + Pad, MaxZ + Pad);
        }
        return Array.from(TouchedKeys);
    }

    computeLayerPaintedBounds(Layer, PaddingMeters = 90.0)
    {
        if (!Layer || Layer.tiles.size === 0) return null;
        let MinX = Infinity, MinZ = Infinity, MaxX = -Infinity, MaxZ = -Infinity;
        let Found = false;

        for (const [Key, TileRec] of Layer.tiles.entries())
        {
            const [Tx, Tz] = ParseTileKey(Key);
            const Data = TileRec.data;
            for (let Pz = 0; Pz < MASK_TILE_RES; ++Pz)
            {
                const Row = Pz * MASK_TILE_RES;
                for (let Px = 0; Px < MASK_TILE_RES; ++Px)
                {
                    if (Data[Row + Px] > 24)
                    {
                        const Wx = ((Tx * MASK_TILE_RES + Px + 0.5) / MASK_TILE_RES) * TILE_WORLD_METERS;
                        const Wz = ((Tz * MASK_TILE_RES + Pz + 0.5) / MASK_TILE_RES) * TILE_WORLD_METERS;
                        if (Wx < MinX) MinX = Wx;
                        if (Wx > MaxX) MaxX = Wx;
                        if (Wz < MinZ) MinZ = Wz;
                        if (Wz > MaxZ) MaxZ = Wz;
                        Found = true;
                    }
                }
            }
        }
        if (!Found) return null;
        return NormalizeBoundsRect({
            x: Math.floor((MinX - PaddingMeters) / 10) * 10,
            z: Math.floor((MinZ - PaddingMeters) / 10) * 10,
            width: Math.ceil((MaxX - MinX + PaddingMeters * 2.0) / 10) * 10,
            depth: Math.ceil((MaxZ - MinZ + PaddingMeters * 2.0) / 10) * 10
        });
    }

    computeCompositePaintedBounds(PaddingMeters = 90.0)
    {
        let MinX = Infinity, MinZ = Infinity, MaxX = -Infinity, MaxZ = -Infinity;
        let Any = false;
        for (const L of this.maskLayers)
        {
            if (!L.visible) continue;
            const B = this.computeLayerPaintedBounds(L, 0.0);
            if (!B) continue;
            MinX = Math.min(MinX, B.x);
            MinZ = Math.min(MinZ, B.z);
            MaxX = Math.max(MaxX, B.x + B.width);
            MaxZ = Math.max(MaxZ, B.z + B.depth);
            Any = true;
        }
        if (!Any) return null;
        return NormalizeBoundsRect({
            x: Math.floor((MinX - PaddingMeters) / 10) * 10,
            z: Math.floor((MinZ - PaddingMeters) / 10) * 10,
            width: Math.ceil((MaxX - MinX + PaddingMeters * 2.0) / 10) * 10,
            depth: Math.ceil((MaxZ - MinZ + PaddingMeters * 2.0) / 10) * 10
        });
    }

    addTerrainRegion(Spec = {})
    {
        const Palette = ['#e8c27a', '#5ac8fa', '#3ec46d', '#f08a5a', '#c084fc', '#7dd3fc'];
        const Color = Spec.color || Palette[this.regions.length % Palette.length];
        const NormBounds = NormalizeBoundsRect(Spec.bounds || Spec.boundsLayer || { x: -600, z: -600, width: 1200, depth: 1200 });
        const Res = Clamp(Spec.resolution || 160, 48, 320);
        const RegionName = Spec.name || `Terrain ${String(this.regions.length + 1).padStart(2, '0')}`;

        // Separate, toggleable, independently editable Terrain Bounds Layer
        const BoundsLayer = {
            id: Spec.boundsLayer?.id || MakeTerrainUid('bounds'),
            name: Spec.boundsLayer?.name || `${RegionName} · Bounds`,
            visible: Spec.boundsLayer?.visible !== false,
            locked: !!Spec.boundsLayer?.locked,
            autoSyncMask: !!Spec.boundsLayer?.autoSyncMask,
            paddingMeters: Number(Spec.boundsLayer?.paddingMeters ?? 90.0),
            x: NormBounds.x,
            z: NormBounds.z,
            width: NormBounds.width,
            depth: NormBounds.depth
        };

        const Region = {
            id: Spec.id || MakeTerrainUid('terrain'),
            name: RegionName,
            maskLayerId: Spec.maskLayerId !== undefined ? Spec.maskLayerId : (this.maskLayers[0]?.id ?? null),
            maskLayerIds: Array.isArray(Spec.maskLayerIds) ? Spec.maskLayerIds.slice() : null,
            maskLayerVisible: Spec.maskLayerVisible !== false,
            enabled: Spec.enabled !== false,
            locked: !!Spec.locked,
            color: Color,
            boundsLayer: BoundsLayer,
            // Alias `region.bounds` directly to `region.boundsLayer` so geometry & bounds layer remain 1:1 synchronized
            bounds: BoundsLayer,
            resolution: Res,
            reliefScale: Number.isFinite(Number(Spec.reliefScale)) ? Number(Spec.reliefScale) : 1.0,
            baseElevation: Spec.baseElevation ?? 2.5,
            slabThickness: Spec.slabThickness ?? 5.0,
            shorelineBevel: Spec.shorelineBevel ?? 18.0,
            maxRelief: Spec.maxRelief ?? 280.0,
            stack: Spec.stack || [],
            dirty: true,
            meshDirty: true,
            runtime: null
        };
        this.regions.push(Region);
        return Region;
    }

    markRegionsDirtyInRect(MinX, MinZ, MaxX, MaxZ, ChangedMaskLayerId = null)
    {
        for (const R of this.regions)
        {
            if (ChangedMaskLayerId && R.maskLayerId && R.maskLayerId !== 'all' && R.maskLayerId !== '__all__' && R.maskLayerId !== ChangedMaskLayerId)
            {
                if (!Array.isArray(R.maskLayerIds) || !R.maskLayerIds.includes(ChangedMaskLayerId)) continue;
            }
            const B = R.bounds;
            const Disjoint = (MaxX < B.x || MinX > B.x + B.width || MaxZ < B.z || MinZ > B.z + B.depth);
            if (!Disjoint)
            {
                R.dirty = true;
                R.meshDirty = true;
            }
        }
    }

    /*======================================================================================================================================
                                              PROJECT SERIALIZATION (.JSON ROUND-TRIP)
    ======================================================================================================================================*/
    toJSON()
    {
        return {
            format: 'frontier.terrain.studio.v2',
            seaLevel: this.seaLevel,
            oceanVisible: this.oceanVisible,
            boundsLayerVisible: this.boundsLayerVisible,
            maskLayers: this.maskLayers.map(L =>
            {
                const TilesObj = {};
                for (const [Key, Rec] of L.tiles.entries())
                {
                    if (Rec.data.some(Boolean))
                    {
                        TilesObj[Key] = EncodeUint8Rle(Rec.data);
                    }
                }
                return {
                    id: L.id,
                    name: L.name,
                    visible: L.visible,
                    locked: L.locked,
                    opacity: L.opacity,
                    blendMode: L.blendMode || 'union',
                    color: L.color,
                    tiles: TilesObj
                };
            }),
            regions: this.regions.map(R => ({
                id: R.id,
                name: R.name,
                maskLayerId: R.maskLayerId,
                maskLayerIds: R.maskLayerIds ? R.maskLayerIds.slice() : null,
                maskLayerVisible: R.maskLayerVisible !== false,
                enabled: R.enabled,
                locked: R.locked,
                color: R.color,
                bounds: {
                    x: R.bounds.x,
                    z: R.bounds.z,
                    width: R.bounds.width,
                    depth: R.bounds.depth
                },
                boundsLayer: {
                    id: R.boundsLayer.id,
                    name: R.boundsLayer.name,
                    visible: R.boundsLayer.visible,
                    locked: R.boundsLayer.locked,
                    autoSyncMask: R.boundsLayer.autoSyncMask,
                    paddingMeters: R.boundsLayer.paddingMeters,
                    x: R.boundsLayer.x,
                    z: R.boundsLayer.z,
                    width: R.boundsLayer.width,
                    depth: R.boundsLayer.depth
                },
                resolution: R.resolution,
                reliefScale: R.reliefScale ?? 1.0,
                baseElevation: R.baseElevation,
                slabThickness: R.slabThickness,
                shorelineBevel: R.shorelineBevel,
                maxRelief: R.maxRelief,
                stack: R.stack.map(Lyr =>
                {
                    const Copy = JSON.parse(JSON.stringify({ ...Lyr, deltas: undefined }));
                    if (Lyr.deltas instanceof Float32Array)
                    {
                        Copy.deltasArr = Array.from(Lyr.deltas, V => Math.round(V * 100) / 100);
                    }
                    return Copy;
                })
            }))
        };
    }

    loadFromJSON(Doc)
    {
        if (!Doc || (Doc.format !== 'frontier.terrain.studio.v2' && Doc.format !== 'frontier.terrain.world.v1'))
        {
            throw new Error('Unrecognized Terrain Studio JSON document');
        }
        this.seaLevel = Number(Doc.seaLevel) || 0.0;
        this.oceanVisible = Doc.oceanVisible !== false;
        this.boundsLayerVisible = Doc.boundsLayerVisible !== false;
        this.maskLayers = [];
        this.regions = [];

        for (const Ml of (Doc.maskLayers || []))
        {
            const Layer = this.addMaskLayer(Ml);
            for (const [Key, Runs] of Object.entries(Ml.tiles || {}))
            {
                const Decoded = DecodeUint8Rle(Runs, MASK_TILE_RES * MASK_TILE_RES);
                if (Decoded.some(Boolean))
                {
                    Layer.tiles.set(Key, { data: Decoded, dirty: true });
                }
            }
        }

        for (const Rg of (Doc.regions || []))
        {
            const Stack = (Rg.stack || [])
                .filter(Lyr => Lyr && Lyr.splineMode !== 'arch3d') // Stage 1 excludes Rock/Arch studio systems
                .map(Lyr =>
                {
                    const Restored = { ...Lyr };
                    if (Array.isArray(Restored.deltasArr))
                    {
                        Restored.deltas = new Float32Array(Restored.deltasArr);
                        delete Restored.deltasArr;
                    }
                    return Restored;
                });
            this.addTerrainRegion({ ...Rg, stack: Stack });
        }
    }
}

/*==========================================================================================================================================
                              EXACT O(N) 2D EUCLIDEAN SIGNED DISTANCE FIELD (MEIJSTER / FH PARABOLIC EDT)
==========================================================================================================================================*/
const INF_DIST_SQ = 1e18;

function Edt1D(F, N, OutD, VBuf, ZBuf)
{
    let K = 0;
    VBuf[0] = 0;
    ZBuf[0] = -1e20;
    ZBuf[1] = +1e20;

    for (let Q = 1; Q < N; ++Q)
    {
        const Fq = F[Q] + Q * Q;
        let S = 0.0;
        while (K >= 0)
        {
            const Vk = VBuf[K];
            S = (Fq - (F[Vk] + Vk * Vk)) / (2.0 * (Q - Vk));
            if (S > ZBuf[K]) break;
            K--;
        }
        K++;
        VBuf[K] = Q;
        ZBuf[K] = S;
        ZBuf[K + 1] = +1e20;
    }

    K = 0;
    for (let Q = 0; Q < N; ++Q)
    {
        while (ZBuf[K + 1] < Q) K++;
        const Dx = Q - VBuf[K];
        OutD[Q] = Dx * Dx + F[VBuf[K]];
    }
}

export function ComputeRegionMaskSdf2D(World, Region, Nx, Nz)
{
    const Count = Nx * Nz;
    const Coverage = new Float32Array(Count);
    const SdfMeters = new Float32Array(Count);
    const B = Region.bounds;
    const StepX = B.width / Math.max(1, Nx - 1);
    const StepZ = B.depth / Math.max(1, Nz - 1);
    const MetricScale = 0.5 * (StepX + StepZ);

    let InsideCount = 0;
    for (let Z = 0; Z < Nz; ++Z)
    {
        const Wz = B.z + Z * StepZ;
        const Row = Z * Nx;
        for (let X = 0; X < Nx; ++X)
        {
            const Wx = B.x + X * StepX;
            const Cov = World.sampleRegionMask(Region, Wx, Wz);
            Coverage[Row + X] = Cov;
            if (Cov >= 0.5) InsideCount++;
        }
    }

    if (InsideCount === 0)
    {
        SdfMeters.fill(Math.max(B.width, B.depth));
        return { coverage: Coverage, sdf2D: SdfMeters, hasLand: false };
    }
    if (InsideCount === Count)
    {
        for (let Z = 0; Z < Nz; ++Z)
        {
            const Dz = Math.min(Z * StepZ, (Nz - 1 - Z) * StepZ);
            for (let X = 0; X < Nx; ++X)
            {
                const Dx = Math.min(X * StepX, (Nx - 1 - X) * StepX);
                SdfMeters[Z * Nx + X] = -Math.min(Dx, Dz);
            }
        }
        return { coverage: Coverage, sdf2D: SdfMeters, hasLand: true };
    }

    const MaxDim = Math.max(Nx, Nz);
    const F1D = new Float64Array(MaxDim);
    const Out1D = new Float64Array(MaxDim);
    const VBuf = new Int32Array(MaxDim + 1);
    const ZBuf = new Float64Array(MaxDim + 2);

    const OutsideSq = new Float64Array(Count);
    const InsideSq = new Float64Array(Count);

    for (let I = 0; I < Count; ++I)
    {
        const IsLand = Coverage[I] >= 0.5;
        OutsideSq[I] = IsLand ? 0.0 : INF_DIST_SQ;
        InsideSq[I] = IsLand ? INF_DIST_SQ : 0.0;
    }

    const Run2DEdt = Grid =>
    {
        const AspectZ = (StepZ / StepX) * (StepZ / StepX);
        for (let X = 0; X < Nx; ++X)
        {
            for (let Z = 0; Z < Nz; ++Z) F1D[Z] = Grid[Z * Nx + X];
            Edt1D(F1D, Nz, Out1D, VBuf, ZBuf);
            for (let Z = 0; Z < Nz; ++Z)
            {
                const Raw = Out1D[Z];
                Grid[Z * Nx + X] = Raw >= INF_DIST_SQ * 0.5 ? INF_DIST_SQ : Raw * AspectZ;
            }
        }
        for (let Z = 0; Z < Nz; ++Z)
        {
            const Row = Z * Nx;
            for (let X = 0; X < Nx; ++X) F1D[X] = Grid[Row + X];
            Edt1D(F1D, Nx, Out1D, VBuf, ZBuf);
            for (let X = 0; X < Nx; ++X) Grid[Row + X] = Out1D[X];
        }
    };

    Run2DEdt(OutsideSq);
    Run2DEdt(InsideSq);

    for (let I = 0; I < Count; ++I)
    {
        const Cov = Coverage[I];
        const SubPixelShift = (0.5 - Cov) * MetricScale;
        if (Cov >= 0.5)
        {
            const DistToCoast = (Math.sqrt(InsideSq[I]) - 0.5) * StepX;
            SdfMeters[I] = -Math.max(0.0, DistToCoast) + SubPixelShift * 0.5;
        }
        else
        {
            const DistToLand = (Math.sqrt(OutsideSq[I]) - 0.5) * StepX;
            SdfMeters[I] = Math.max(0.0, DistToLand) + SubPixelShift * 0.5;
        }
    }

    return { coverage: Coverage, sdf2D: SdfMeters, hasLand: true };
}
