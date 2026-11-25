/*====================================================================================================================================
                                                        TERRAINSTACKEVALUATION.JS
====================================================================================================================================*/
// 🧩 GPU layer-stack evaluation per terrain cell: cached ping-pong stack, shape jump flood, spline probes, sculpt rasters,
//    derived surface fields, tile maxima, sparse tunnel SDF volume and ray picking

import * as Shaders from "./ShaderLibrary.js";
import { AtlasColumns, AtlasRows, GroupColumns, GroupRows, PackSplineAtlas } from "./SplineSampling.js";
import { SplineVariants } from "./WorldDocument.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const BinTexels = 32;             // [px] - Stack texels per spline-group bin tile
const TileTexels = 16;            // [px] - Height texels per tile-maximum cell
const RegionAreaLimit = 0.85;     // [-]  - Dirty-area fraction above which the full path is used instead
const RegionShadowReach = 400;    // [m]  - Height difference whose shadow is refreshed during a stroke (full on refine)
const TunnelVoxelLimitXZ = 192;   // [idx] - Max tunnel volume voxels along x / z
const TunnelVoxelLimitY = 96;     // [idx] - Max tunnel volume voxels along y

//------------------------------------------------------------------------------------------------------------------------
//                                                    PER-CELL GPU FIELD
//------------------------------------------------------------------------------------------------------------------------

export class TerrainCellField
{
    constructor(Device, Resolution)
    {
        this.Device = Device;
        this.Resolution = Resolution;
        const N = Resolution;
        this.StackA = Device.CreateTexture2D(N, N, "RGBA32F", { Linear: true });
        this.StackB = Device.CreateTexture2D(N, N, "RGBA32F", { Linear: true });
        this.Cache = Device.CreateTexture2D(N, N, "RGBA32F", { Linear: true });
        this.Surface = Device.CreateTexture2D(N, N, "RGBA8", { Linear: true, Mipmaps: true });
        this.Material = Device.CreateTexture2D(N, N, "RGBA8", { Linear: true, Mipmaps: true });
        this.SurfaceTarget = Device.CreateTarget(this.Surface, this.Material);
        this.Shadow = Device.CreateTexture2D(N / 2, N / 2, "R8", { Linear: true, Mipmaps: true });
        this.TileMaximum = Device.CreateTexture2D(N / TileTexels, N / TileTexels, "R32F");
        this.Final = this.StackA;
        this.FinalSignature = "";
        this.CacheSignature = "";
        this.CacheIndex = -1;
        this.ShapeFields = new Map();
        this.SculptFields = new Map();
        this.SculptRevisions = new Map();
        this.SplineBins = new Map();
        this.Tunnel = null;
        this.TunnelSignature = "";
        this.TunnelStale = false;
        this.HasEvaluated = false;
        this.Stale = true;
        this.LastEvaluation = { Layers: 0, Passes: 0, Milliseconds: 0, FromCache: false, CacheIndex: -1 };
    }

    ReleaseAll()
    {
        const D = this.Device;
        [this.StackA, this.StackB, this.Cache, this.Surface, this.Material, this.Shadow, this.TileMaximum].forEach(Surface => D.ReleaseTexture(Surface));
        D.GL.deleteFramebuffer(this.SurfaceTarget);
        this.ShapeFields.forEach(Entry => { D.ReleaseTexture(Entry.Surface); if (Entry.Noise) D.ReleaseTexture(Entry.Noise); });
        this.SculptFields.forEach(Surface => D.ReleaseTexture(Surface));
        this.SplineBins.forEach(Entry => { D.ReleaseTexture(Entry.Header); D.ReleaseTexture(Entry.List); });
        if (this.Tunnel) D.ReleaseTexture(this.Tunnel.Volume);
    }

    MemoryBytes()
    {
        let Bytes = [this.StackA, this.StackB, this.Cache, this.Surface, this.Material, this.Shadow, this.TileMaximum].reduce((Sum, Surface) => Sum + Surface.Bytes, 0);
        this.ShapeFields.forEach(Entry => Bytes += Entry.Surface.Bytes + (Entry.Noise ? Entry.Noise.Bytes : 0));
        this.SculptFields.forEach(Surface => Bytes += Surface.Bytes);
        this.SplineBins.forEach(Entry => Bytes += Entry.Header.Bytes + Entry.List.Bytes);
        if (this.Tunnel) Bytes += this.Tunnel.Volume.Bytes;
        return Bytes;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    STACK EVALUATION
//------------------------------------------------------------------------------------------------------------------------

export class TerrainStackEvaluation
{
    constructor(Device)
    {
        this.Device = Device;
        const GL = Device.GL;
        const Compile = (Label, Vertex, Fragment) => Device.CompileProgram(Label, Vertex, Fragment);
        this.Programs = {
            MaskFill:        Compile("MaskFill", Shaders.FanVertex, Shaders.MaskWriteFragment),
            MaskCover:       Compile("MaskCover", Shaders.FullscreenVertex, Shaders.MaskWriteFragment),
            FloodSeed:       Compile("FloodSeed", Shaders.FullscreenVertex, Shaders.JumpFloodSeedFragment),
            FloodStep:       Compile("FloodStep", Shaders.FullscreenVertex, Shaders.JumpFloodStepFragment),
            FloodResolve:    Compile("FloodResolve", Shaders.FullscreenVertex, Shaders.JumpFloodResolveFragment),
            StackSeed:       Compile("StackSeed", Shaders.FullscreenVertex, Shaders.StackSeedFragment),
            Landmass:        Compile("Landmass", Shaders.FullscreenVertex, Shaders.LandmassFragment),
            LandmassNoise:   Compile("LandmassNoise", Shaders.FullscreenVertex, Shaders.LandmassNoiseFragment),
            LandmassInline:  Compile("LandmassInline", Shaders.FullscreenVertex, Shaders.LandmassFragment.replace("#define LANDMASS_INLINE 0", "#define LANDMASS_INLINE 1")),
            SculptApply:     Compile("SculptApply", Shaders.FullscreenVertex, Shaders.SculptApplyFragment),
            SplineApply:     Compile("SplineApply", Shaders.FullscreenVertex, Shaders.SplineApplyFragment),
            SampleProbe:     Compile("SampleProbe", Shaders.FullscreenVertex, Shaders.SampleProbeFragment),
            SampleSmooth:    Compile("SampleSmooth", Shaders.FullscreenVertex, Shaders.SampleSmoothFragment),
            SampleDownhill:  Compile("SampleDownhill", Shaders.FullscreenVertex, Shaders.SampleDownhillFragment),
            TunnelVolume:    Compile("TunnelVolume", Shaders.FullscreenVertex, Shaders.TunnelVolumeFragment),
            SculptStamp:     Compile("SculptStamp", Shaders.RectVertex, Shaders.SculptStampFragment),
            SculptResample:  Compile("SculptResample", Shaders.FullscreenVertex, Shaders.SculptResampleFragment),
            SurfaceField:    Compile("SurfaceField", Shaders.FullscreenVertex, Shaders.SurfaceFieldFragment),
            ShadowField:     Compile("ShadowField", Shaders.FullscreenVertex, Shaders.ShadowFieldFragment),
            TileMaximum:     Compile("TileMaximum", Shaders.FullscreenVertex, Shaders.TileMaximumFragment),
            PointProbe:      Compile("PointProbe", Shaders.FullscreenVertex, Shaders.PointProbeFragment),
            ReliefPick:      Compile("ReliefPick", Shaders.FullscreenVertex, Shaders.ReliefPickFragment),
        };
        this.SampleAtlas = Device.CreateTexture2D(AtlasColumns, AtlasRows, "RGBA32F");
        this.SampleArc = Device.CreateTexture2D(AtlasColumns, AtlasRows, "R32F");
        this.RowTable = Device.CreateTexture2D(AtlasRows, 1, "RGBA32F");
        this.GroupAtlas = Device.CreateTexture2D(GroupColumns, GroupRows, "RGBA32F");
        this.SampleHeights = Device.CreateTexture2D(AtlasColumns, AtlasRows, "R32F");
        this.SampleScratch = Device.CreateTexture2D(AtlasColumns, AtlasRows, "R32F");
        this.PickSurface = Device.CreateTexture2D(1, 1, "RGBA32F");
        this.ProbeSurface = Device.CreateTexture2D(1, 1, "RGBA32F");
        this.EmptyVolume = Device.CreateTexture3D(1, 1, 1, "R16F");
        this.Scratch = new Map();
        this.Atlas = null;
        this.AtlasSignature = "";
        this.SampleHeightsHost = null;
        this.SampleHeightsSerial = 0;
        this.FanBuffer = GL.createBuffer();
        this.FanArray = GL.createVertexArray();
        GL.bindVertexArray(this.FanArray);
        GL.bindBuffer(GL.ARRAY_BUFFER, this.FanBuffer);
        const Location = GL.getAttribLocation(this.Programs.MaskFill.Program, "aWorld");
        GL.enableVertexAttribArray(Location);
        GL.vertexAttribPointer(Location, 2, GL.FLOAT, false, 0, 0);
        GL.bindVertexArray(null);
        this.PassCounter = 0;
        this.BinTexels = BinTexels;                 // [px] - Bin tile size; = resolution gives one exhaustive bin
        this.ExhaustiveNoise = false;               // [-]  - Landmass computes noise inline on every texel (exactness reference)
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SCRATCH SURFACES
    //--------------------------------------------------------------------------------------------------------------------

    RetrieveScratch(N)
    {
        if (!this.Scratch.has(N))
        {
            const D = this.Device;
            const Mask = D.CreateTexture2D(N, N, "R8");
            D.AttachStencil(Mask);
            this.Scratch.set(N, { Mask, FloodA: D.CreateTexture2D(N, N, "RG32F"), FloodB: D.CreateTexture2D(N, N, "RG32F"), Sculpt: D.CreateTexture2D(N, N, "R32F") });
        }
        return this.Scratch.get(N);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SPLINE ATLAS
    //--------------------------------------------------------------------------------------------------------------------

    RefreshSplineAtlas(Document)
    {
        const Signature = Document.Layers.filter(Layer => Layer.Category === "Spline").map(Layer => `${Layer.Id}:${Layer.Revision}`).join("|");
        if (Signature === this.AtlasSignature && this.Atlas) return false;
        const D = this.Device;
        const Atlas = PackSplineAtlas(Document.Layers);
        D.UploadRegion(this.SampleAtlas, 0, 0, AtlasColumns, AtlasRows, Atlas.Samples);
        D.UploadRegion(this.SampleArc, 0, 0, AtlasColumns, AtlasRows, Atlas.Arcs);
        D.UploadRegion(this.RowTable, 0, 0, AtlasRows, 1, Atlas.RowTable);
        D.UploadRegion(this.GroupAtlas, 0, 0, GroupColumns, GroupRows, Atlas.Groups);
        this.Atlas = Atlas;
        this.AtlasSignature = Signature;
        return true;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SHAPE DISTANCE FIELDS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 ① stencil even-odd fill per stroke → binary mask ② jump-flood seeds at boundaries ③ log₂N flood strides
    //    ④ signed metric distance. Rebuilt only when stroke geometry or cell bounds change.
    RefreshShapeField(Field, Layer, Terrain)
    {
        const Signature = `${Layer.GeometryRevision}:${Terrain.Revision}:${Field.Resolution}`;
        let Entry = Field.ShapeFields.get(Layer.Id);
        if (Entry && Entry.Signature === Signature) return Entry.Surface;
        const D = this.Device, GL = D.GL, N = Field.Resolution;
        if (!Entry)
        {
            Entry = { Surface: D.CreateTexture2D(N, N, "R32F"), Signature: "" };
            Field.ShapeFields.set(Layer.Id, Entry);
        }
        const Scratch = this.RetrieveScratch(N);
        const Vertices = [];
        const Spans = [];
        for (const Stroke of Layer.Strokes)
        {
            if (Stroke.Points.length < 3) continue;
            Spans.push({ First: Vertices.length / 2, Count: Stroke.Points.length, Subtract: Stroke.Subtract });
            Stroke.Points.forEach(Point => Vertices.push(Point[0], Point[1]));
        }
        D.BindTarget(Scratch.Mask);
        GL.clearColor(0, 0, 0, 0);
        GL.clearStencil(0);
        GL.clear(GL.COLOR_BUFFER_BIT | GL.STENCIL_BUFFER_BIT);
        if (Spans.length)
        {
            GL.bindBuffer(GL.ARRAY_BUFFER, this.FanBuffer);
            GL.bufferData(GL.ARRAY_BUFFER, new Float32Array(Vertices), GL.DYNAMIC_DRAW);
            GL.enable(GL.STENCIL_TEST);
            const Bounds = { uOrigin: Terrain.Min, uSize: Terrain.Size, uMaskLevel: 1 };
            for (const Span of Spans)
            {
                GL.colorMask(false, false, false, false);
                GL.stencilFunc(GL.ALWAYS, 0, 0xff);
                GL.stencilOp(GL.KEEP, GL.KEEP, GL.INVERT);
                D.UseProgram(this.Programs.MaskFill, Bounds);
                GL.bindVertexArray(this.FanArray);
                GL.drawArrays(GL.TRIANGLE_FAN, Span.First, Span.Count);
                GL.bindVertexArray(null);
                GL.colorMask(true, true, true, true);
                GL.stencilFunc(GL.NOTEQUAL, 0, 0xff);
                GL.stencilOp(GL.ZERO, GL.ZERO, GL.ZERO);
                D.RasterizeTriangle(this.Programs.MaskCover, undefined, { uMaskLevel: Span.Subtract ? 0 : 1 });
                this.PassCounter += 2;
            }
            GL.disable(GL.STENCIL_TEST);
        }
        D.RasterizeTriangle(this.Programs.FloodSeed, Scratch.FloodA, { uMask: Scratch.Mask });
        let Source = Scratch.FloodA, Destination = Scratch.FloodB;
        const Strides = [];
        for (let Stride = N >> 1; Stride >= 1; Stride >>= 1) Strides.push(Stride);
        Strides.push(1);
        for (const Stride of Strides)
        {
            D.RasterizeTriangle(this.Programs.FloodStep, Destination, { uSeeds: Source, uStride: Stride });
            [Source, Destination] = [Destination, Source];
        }
        D.RasterizeTriangle(this.Programs.FloodResolve, Entry.Surface, { uSeeds: Source, uMask: Scratch.Mask, uCell: [Terrain.Size[0] / N, Terrain.Size[1] / N] });
        this.PassCounter += Strides.length + 2;
        Entry.Signature = Signature;
        return Entry.Surface;
    }

    // 📝 Noise is needed only where D + reach >= 0, which lies inside the stroke bounds grown by the feather reach. The
    //    cache keeps the covered texel rectangle and grows it under a scissor when strokes move outward.
    RefreshShapeNoise(Field, Layer, Terrain)
    {
        const D = this.Device, N = Field.Resolution, P = Layer.Parameters;
        const Entry = Field.ShapeFields.get(Layer.Id);
        const Key = `${P.Seed | 0}:${P.CoastWidth}:${P.ReliefScale}:${P.Ridged}:${Terrain.Revision}:${N}`;
        if (!Entry.Noise) Entry.Noise = D.CreateTexture2D(N, N, "RG32F");
        if (Entry.NoiseKey !== Key) { Entry.NoiseKey = Key; Entry.NoiseRect = null; }
        const Reach = Math.abs(P.CoastNoise) * Math.max(P.CoastWidth, 1) * 1.01 + 0.01;
        let Lo = [Infinity, Infinity], Hi = [-Infinity, -Infinity];
        for (const Stroke of Layer.Strokes)
        {
            if (Stroke.Points.length < 3) continue;
            for (const Point of Stroke.Points)
            {
                Lo = [Math.min(Lo[0], Point[0]), Math.min(Lo[1], Point[1])];
                Hi = [Math.max(Hi[0], Point[0]), Math.max(Hi[1], Point[1])];
            }
        }
        const ToTexel = (Value, Axis) => (Value - Terrain.Min[Axis]) / Terrain.Size[Axis] * N;
        const Needed = [
            Math.max(0, Math.floor(ToTexel(Lo[0] - Reach, 0)) - 2), Math.max(0, Math.floor(ToTexel(Lo[1] - Reach, 1)) - 2),
            Math.min(N, Math.ceil(ToTexel(Hi[0] + Reach, 0)) + 2), Math.min(N, Math.ceil(ToTexel(Hi[1] + Reach, 1)) + 2)];
        if (Needed[2] <= Needed[0] || Needed[3] <= Needed[1]) return Entry.Noise;
        const Covered = Entry.NoiseRect;
        if (Covered && Needed[0] >= Covered[0] && Needed[1] >= Covered[1] && Needed[2] <= Covered[2] && Needed[3] <= Covered[3]) return Entry.Noise;
        const Union = Covered ? [Math.min(Covered[0], Needed[0]), Math.min(Covered[1], Needed[1]), Math.max(Covered[2], Needed[2]), Math.max(Covered[3], Needed[3])] : Needed;
        D.Scissor([Union[0], Union[1], Union[2] - Union[0], Union[3] - Union[1]]);
        D.RasterizeTriangle(this.Programs.LandmassNoise, Entry.Noise, {
            uOrigin: Terrain.Min, uSize: Terrain.Size, uResolution: [N, N], uCoastWidth: P.CoastWidth, uReliefScale: P.ReliefScale,
            uRidged: P.Ridged, uSeed: P.Seed | 0 });
        D.Scissor(null);
        this.PassCounter++;
        Entry.NoiseRect = Union;
        return Entry.Noise;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SPLINE SAMPLE HEIGHTS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Probe → smooth (+lift) → optional downhill prefix-min, all on the GPU against the stack input of the layer.
    EvaluateSampleHeights(Input, Terrain, Layer, Range)
    {
        const D = this.Device;
        const Viewport = [0, Range.RowStart, this.Atlas.MaxCount, Range.RowCount];
        const P = Layer.Parameters;
        const Bore = Layer.Variant === "Tunnel" ? 1 : 0;
        D.RasterizeTriangle(this.Programs.SampleProbe, this.SampleScratch, { uInput: Input, uSampleAtlas: this.SampleAtlas, uSampleArc: this.SampleArc, uRowTable: this.RowTable, uOrigin: Terrain.Min, uSize: Terrain.Size, uBore: Bore }, Viewport);
        const Spacing = Math.max(1.5, Math.min((Layer.Variant === "Tunnel" ? P.Width * 2 : P.Width) * 0.35, 24));
        const Radius = Bore ? 0 : Math.min(64, Math.round(P.Smoothing / Spacing));
        D.RasterizeTriangle(this.Programs.SampleSmooth, this.SampleHeights, { uHeights: this.SampleScratch, uSampleAtlas: this.SampleAtlas, uRowTable: this.RowTable, uRadius: Radius }, Viewport);
        this.PassCounter += 2;
        if (P.Downhill && !Bore)
        {
            let Source = this.SampleHeights, Destination = this.SampleScratch;
            let Count = 0;
            for (let Stride = 1; Stride < this.Atlas.MaxCount; Stride <<= 1)
            {
                D.RasterizeTriangle(this.Programs.SampleDownhill, Destination, { uHeights: Source, uStride: Stride }, Viewport);
                [Source, Destination] = [Destination, Source];
                Count++;
            }
            if (Source !== this.SampleHeights) D.CopyRegion(Source, this.SampleHeights, 0, Range.RowStart, this.Atlas.MaxCount, Range.RowCount);
            this.PassCounter += Count;
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                LAYER APPLICATION
    //--------------------------------------------------------------------------------------------------------------------

    LayerAffectsTerrain(Layer, Terrain)
    {
        if (!Layer.Visible || Layer.Opacity <= 0) return false;
        if (Layer.Category === "Sculpt") return true;
        if (Layer.Category === "Shape") return Layer.Strokes.some(Stroke => Stroke.Points.length >= 3);
        if (Layer.Variant === "Tunnel") return false;
        const Range = this.Atlas && this.Atlas.Ranges.get(Layer.Id);
        if (!Range || !Range.GroupCount) return false;
        const B = Range.Bounds;
        return !(B[2] < Terrain.Min[0] || B[3] < Terrain.Min[1] || B[0] > Terrain.Min[0] + Terrain.Size[0] || B[1] > Terrain.Min[1] + Terrain.Size[1]);
    }

    // 📝 Scissor [x, y, w, h] limits only the write into Output; atlas passes (sample heights) always run unclipped.
    ApplyLayer(Field, Terrain, Document, Layer, Input, Output, Scissor = null)
    {
        const D = this.Device;
        if (Layer.Category === "Shape")
        {
            const Distance = this.RefreshShapeField(Field, Layer, Terrain);
            const Noise = this.RefreshShapeNoise(Field, Layer, Terrain);
            const P = Layer.Parameters;
            D.Scissor(Scissor);
            D.RasterizeTriangle(this.ExhaustiveNoise ? this.Programs.LandmassInline : this.Programs.Landmass, Output, {
                uInput: Input, uDistance: Distance, uOrigin: Terrain.Min, uSize: Terrain.Size,
                uOperation: ["Add", "Subtract", "Plateau", "Maximum"].indexOf(P.Operation), uElevation: P.Elevation, uCoastWidth: P.CoastWidth,
                uRelief: P.Relief, uReliefScale: P.ReliefScale, uRidged: P.Ridged, uCoastNoise: P.CoastNoise, uOpacity: Layer.Opacity,
                uSeabed: Document.Settings.Seabed, uSeed: P.Seed | 0, uNoise: Noise });
        }
        else if (Layer.Category === "Sculpt")
        {
            const Sculpt = Field.SculptFields.get(Layer.Id);
            if (!Sculpt) { if (Scissor) D.CopyRegion(Input, Output, ...Scissor); else D.CopyRegion(Input, Output); return; }
            D.Scissor(Scissor);
            D.RasterizeTriangle(this.Programs.SculptApply, Output, { uInput: Input, uSculpt: Sculpt, uOpacity: Layer.Opacity });
        }
        else
        {
            const Range = this.Atlas.Ranges.get(Layer.Id);
            this.EvaluateSampleHeights(Input, Terrain, Layer, Range);
            const Bins = this.ResolveSplineBins(Field, Layer, Range, Terrain);
            const P = Layer.Parameters;
            D.Scissor(Scissor);
            D.RasterizeTriangle(this.Programs.SplineApply, Output, {
                uInput: Input, uSampleAtlas: this.SampleAtlas, uSampleHeights: this.SampleHeights, uGroupAtlas: this.GroupAtlas,
                uBinHeader: Bins.Header, uBinList: Bins.List, uBinTiles: [Bins.Tiles, Bins.Tiles],
                uOrigin: Terrain.Min, uSize: Terrain.Size, uLayerBounds: Range.Bounds,
                uVariant: SplineVariants[Layer.Variant].Index, uShoulder: P.Shoulder, uDepth: P.Depth, uRise: P.Rise, uTerraceStep: P.TerraceStep,
                uWallSteepness: P.WallSteepness, uOpacity: Layer.Opacity });
        }
        D.Scissor(null);
        this.PassCounter++;
    }

    // 📝 CPU binning of a layer's culling groups into BinTexels² tiles of the cell. A group enters a tile when its
    //    circle (radius already includes half-width) inflated by the shoulder reaches the tile rectangle — exactly the
    //    groups that can produce a contact inside the shoulder, so the binned query equals the exhaustive one.
    ResolveSplineBins(Field, Layer, Range, Terrain)
    {
        const Key = `${Layer.Revision}:${Range.GroupStart}:${Range.GroupCount}:${Terrain.Revision}:${Field.Resolution}:${this.BinTexels}`;
        let Entry = Field.SplineBins.get(Layer.Id);
        if (Entry && Entry.Key === Key) return Entry;
        const D = this.Device;
        const Tiles = Math.max(1, Math.round(Field.Resolution / this.BinTexels));
        const TileSize = [Terrain.Size[0] / Tiles, Terrain.Size[1] / Tiles];
        const Reach = Math.max(Layer.Parameters.Shoulder, 0.5) + Math.hypot(Terrain.Size[0], Terrain.Size[1]) / Field.Resolution;
        const Lists = Array.from({ length: Tiles * Tiles }, () => []);
        const Groups = this.Atlas.Groups;
        let Total = 0;
        for (let G = 0; G < Range.GroupCount; ++G)
        {
            const Absolute = Range.GroupStart + G;
            const Cx = Groups[Absolute * 8], Cz = Groups[Absolute * 8 + 1], Radius = Groups[Absolute * 8 + 2] + Reach;
            const X0 = Math.max(0, Math.floor((Cx - Radius - Terrain.Min[0]) / TileSize[0])), X1 = Math.min(Tiles - 1, Math.floor((Cx + Radius - Terrain.Min[0]) / TileSize[0]));
            const Z0 = Math.max(0, Math.floor((Cz - Radius - Terrain.Min[1]) / TileSize[1])), Z1 = Math.min(Tiles - 1, Math.floor((Cz + Radius - Terrain.Min[1]) / TileSize[1]));
            for (let Tz = Z0; Tz <= Z1; ++Tz)
            {
                for (let Tx = X0; Tx <= X1; ++Tx)
                {
                    const Lx = Terrain.Min[0] + Tx * TileSize[0], Lz = Terrain.Min[1] + Tz * TileSize[1];
                    const Nx = Math.max(Lx, Math.min(Cx, Lx + TileSize[0])), Nz = Math.max(Lz, Math.min(Cz, Lz + TileSize[1]));
                    if (Math.hypot(Cx - Nx, Cz - Nz) > Radius) continue;
                    Lists[Tz * Tiles + Tx].push(Absolute);
                    Total++;
                }
            }
        }
        const Header = new Float32Array(Tiles * Tiles * 2);
        const Rows = Math.max(1, Math.ceil(Total / 1024));
        const Packed = new Float32Array(Rows * 1024);
        let Offset = 0;
        Lists.forEach((List, Tile) =>
        {
            Header[Tile * 2] = Offset;
            Header[Tile * 2 + 1] = List.length;
            Packed.set(List, Offset);
            Offset += List.length;
        });
        if (!Entry || Entry.Tiles !== Tiles || Entry.Rows < Rows)
        {
            if (Entry) { D.ReleaseTexture(Entry.Header); D.ReleaseTexture(Entry.List); }
            Entry = { Header: D.CreateTexture2D(Tiles, Tiles, "RG32F"), List: D.CreateTexture2D(1024, Rows, "R32F"), Tiles, Rows };
            Field.SplineBins.set(Layer.Id, Entry);
        }
        D.UploadRegion(Entry.Header, 0, 0, Tiles, Tiles, Header);
        D.UploadRegion(Entry.List, 0, 0, 1024, Rows, Packed);
        Entry.Key = Key;
        Entry.Entries = Total;
        return Entry;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                REGION EVALUATION
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Every stack pass is per-texel, and spline sample probes read the stack only inside their own layer bounds.
    //    So when exactly one layer k changed: dirty box = (sculpt: stamped texels | spline: old ∪ new layer bounds),
    //    grown by the bounds of every spline layer above that overlaps it (its probes see the change), to a fixed
    //    point. Layers above outside the box are skipped; everything else is re-applied under a scissor.
    //    Returns null when the full path is required, { Rect: null } when nothing inside the cell changed.
    ResolveRegion(Field, Terrain, Layers, Identities, EditedIndex, DirtyRect)
    {
        const Previous = Field.FinalIdentities;
        if (!Previous || Previous.length !== Identities.length || !Field.FinalCacheSignature || Field.FinalCacheSignature !== Field.CacheSignature) return null;
        for (let Index = 0; Index < Identities.length; ++Index)
        {
            if (Previous[Index].split(":")[0] !== Layers[Index].Id) return null;
            if (Index !== EditedIndex && Previous[Index] !== Identities[Index]) return null;
        }
        const N = Field.Resolution;
        const ToTexels = B => [(B[0] - Terrain.Min[0]) / Terrain.Size[0] * N - 2, (B[1] - Terrain.Min[1]) / Terrain.Size[1] * N - 2,
                               (B[2] - Terrain.Min[0]) / Terrain.Size[0] * N + 2, (B[3] - Terrain.Min[1]) / Terrain.Size[1] * N + 2];
        const Union = (A, B) => [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
        const Overlaps = (A, B) => !(A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1]);
        const Edited = Layers[EditedIndex];
        let Box;
        if (Edited.Category === "Sculpt")
        {
            if (!DirtyRect) return null;
            Box = [DirtyRect[0], DirtyRect[1], DirtyRect[0] + DirtyRect[2], DirtyRect[1] + DirtyRect[3]];
        }
        else if (Edited.Category === "Spline")
        {
            // 📝 Unit of change is a whole spline: smoothing / downhill passes carry height changes along its length.
            const Old = Field.SplineFootprints && Field.SplineFootprints.get(Edited.Id);
            const Range = this.Atlas.Ranges.get(Edited.Id);
            if (!Old || !Range) return null;
            const Current = this.ComputeSplineFootprints(Edited, Range);
            if (Old.ParameterKey !== Current.ParameterKey) Box = Union(ToTexels(Old.Bounds), ToTexels(Range.Bounds));
            else
            {
                Box = [Infinity, Infinity, -Infinity, -Infinity];
                const Identifiers = new Set([...Old.Splines.keys(), ...Current.Splines.keys()]);
                for (const SplineId of Identifiers)
                {
                    const Before = Old.Splines.get(SplineId), After = Current.Splines.get(SplineId);
                    if (Before && After && Before.Key === After.Key) continue;
                    if (Before) Box = Union(Box, ToTexels(Before.Bounds));
                    if (After) Box = Union(Box, ToTexels(After.Bounds));
                }
                if (Box[0] === Infinity) return { Rect: null, Chain: [] };
            }
        }
        else return null;
        const Included = new Set([EditedIndex]);
        for (let Grown = true; Grown;)
        {
            Grown = false;
            for (let Index = EditedIndex + 1; Index < Layers.length; ++Index)
            {
                if (Included.has(Index)) continue;
                const Layer = Layers[Index];
                if (Layer.Category !== "Spline") { Included.add(Index); continue; }
                const Bounds = ToTexels(this.Atlas.Ranges.get(Layer.Id).Bounds);
                if (Overlaps(Bounds, Box)) { Box = Union(Box, Bounds); Included.add(Index); Grown = true; }
            }
        }
        // 📝 Skipped spline layers reuse their previous sample heights, valid only if the atlas kept their rows.
        for (let Index = EditedIndex + 1; Index < Layers.length; ++Index)
        {
            const Layer = Layers[Index];
            if (Layer.Category === "Spline" && !Included.has(Index) && Field.LayerRows.get(Layer.Id) !== this.Atlas.Ranges.get(Layer.Id).RowStart) return null;
        }
        const X0 = Math.max(0, Math.floor(Box[0])), Y0 = Math.max(0, Math.floor(Box[1]));
        const X1 = Math.min(N, Math.ceil(Box[2])), Y1 = Math.min(N, Math.ceil(Box[3]));
        if (X1 <= X0 || Y1 <= Y0) return { Rect: null, Chain: [] };
        if ((X1 - X0) * (Y1 - Y0) > RegionAreaLimit * N * N) return null;
        return { Rect: [X0, Y0, X1 - X0, Y1 - Y0], Chain: [...Included].sort((A, B) => A - B) };
    }

    // 📝 Per-spline world bounds (corridor half-width + shoulder) and a key of its control points.
    ComputeSplineFootprints(Layer, Range)
    {
        const Reach = Layer.Variant === "Tunnel" ? Layer.Parameters.Width * 2 : Layer.Parameters.Shoulder;
        const Splines = new Map();
        for (const Spline of Layer.Splines)
        {
            const Dense = Range.SampleSets.get(Spline.Id);
            if (!Dense) continue;
            const Bounds = [Infinity, Infinity, -Infinity, -Infinity];
            for (const Sample of Dense)
            {
                Bounds[0] = Math.min(Bounds[0], Sample[0] - Sample[2] - Reach);
                Bounds[1] = Math.min(Bounds[1], Sample[1] - Sample[2] - Reach);
                Bounds[2] = Math.max(Bounds[2], Sample[0] + Sample[2] + Reach);
                Bounds[3] = Math.max(Bounds[3], Sample[1] + Sample[2] + Reach);
            }
            Splines.set(Spline.Id, { Bounds, Key: Spline.Points.map(Point => `${Point.X},${Point.Z},${Point.Width},${Point.Lift || 0}`).join(";") });
        }
        return { Bounds: [...Range.Bounds], ParameterKey: JSON.stringify(Layer.Parameters), Splines };
    }

    RegisterLayerFootprints(Field, Layers, Identities)
    {
        Field.FinalIdentities = Identities;
        Field.SplineFootprints = new Map();
        Field.LayerRows = new Map();
        for (const Layer of Layers)
        {
            if (Layer.Category !== "Spline") continue;
            const Range = this.Atlas.Ranges.get(Layer.Id);
            Field.SplineFootprints.set(Layer.Id, this.ComputeSplineFootprints(Layer, Range));
            Field.LayerRows.set(Layer.Id, Range.RowStart);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                EVALUATION ENTRY
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Cumulative signatures per layer let the stack restart from the cached input of the selected layer, so editing
    //    layer k costs (n − k) layer applications, independent of edit history length.
    // 📝 Region evaluation (see ResolveRegion): when only the selected layer changed — a sculpt stroke (DirtyRect,
    //    texels [x, y, w, h]) or a spline edit — the affected rectangle is re-rasterized under a scissor, and one
    //    full-quality refine of the derived fields (long shadows) runs once the interaction ends.
    EvaluateCell(Field, Document, Terrain, { SelectedLayerId = null, Interactive = false, DirtyRect = null } = {})
    {
        const D = this.Device, S = Document.Settings;
        this.RefreshSplineAtlas(Document);
        // 📝 Each region evaluates only its own stack; other regions and unassigned layers never touch this cell.
        const Layers = Terrain.Layers.filter(Layer => this.LayerAffectsTerrain(Layer, Terrain));
        const Signatures = [];
        let Running = `${Terrain.Revision}:${Field.Resolution}:${Document.SettingsRevision}:${S.Seabed}`;
        for (const Layer of Layers)
        {
            const SculptRevision = Layer.Category === "Sculpt" ? (Field.SculptRevisions.get(Layer.Id) || 0) : 0;
            Running += `|${Layer.Id}:${Layer.Revision}:${SculptRevision}:${Layer.Opacity}`;
            Signatures.push(Running);
        }
        const SeedSignature = `${Terrain.Revision}:${Field.Resolution}:${Document.SettingsRevision}:${S.Seabed}`;
        const FinalSignature = Layers.length ? Signatures[Signatures.length - 1] : SeedSignature;
        const TunnelLayers = Terrain.Layers.filter(Layer => Layer.Category === "Spline" && Layer.Variant === "Tunnel" && Layer.Visible && this.Atlas.Ranges.get(Layer.Id)?.RowCount);
        if (FinalSignature === Field.FinalSignature)
        {
            const Selected = Layers.findIndex(Layer => Layer.Id === SelectedLayerId);
            if (Selected > 0 && (Field.CacheIndex !== Selected || Field.CacheSignature !== (Selected === 0 ? SeedSignature : Signatures[Selected - 1])))
                this.WarmCache(Field, Document, Terrain, Layers, Selected, Signatures[Selected - 1]);
            if (Field.NeedsRefine && !Interactive)
            {
                const Started = performance.now();
                this.PassCounter = 0;
                this.RefreshDerivedFields(Field, Document, Terrain, null);
                Field.NeedsRefine = false;
                this.RefreshTunnelVolume(Field, Document, Terrain, TunnelLayers, Interactive);
                Field.LastEvaluation = { ...Field.LastEvaluation, Passes: this.PassCounter, Milliseconds: performance.now() - Started, Region: "Refine" };
                return true;
            }
            this.RefreshTunnelVolume(Field, Document, Terrain, TunnelLayers, Interactive);
            return false;
        }
        const Started = performance.now();
        this.PassCounter = 0;
        const SelectedIndex = Layers.findIndex(Layer => Layer.Id === SelectedLayerId);
        let StartIndex = 0;
        let Current;
        let FromCache = false;
        const InputSignature = Index => Index === 0 ? SeedSignature : Signatures[Index - 1];
        // 📝 Selection and first edit can land in the same frame (mouse down on a point, then drag). Final was built on
        //    the same lower layers when its signature extends the input signature, so warming keeps the region path.
        const CacheStale = SelectedIndex > 0 && (Field.CacheIndex !== SelectedIndex || Field.CacheSignature !== InputSignature(SelectedIndex));
        if (CacheStale && Field.FinalSignature && Field.FinalSignature.startsWith(`${InputSignature(SelectedIndex)}|`))
            this.WarmCache(Field, Document, Terrain, Layers, SelectedIndex, InputSignature(SelectedIndex));
        if (SelectedIndex > 0 && Field.CacheIndex === SelectedIndex && Field.CacheSignature === InputSignature(SelectedIndex))
        {
            StartIndex = SelectedIndex;
            Current = Field.Cache;
            FromCache = true;
        }
        else
        {
            D.RasterizeTriangle(this.Programs.StackSeed, Field.StackA, { uSeabed: S.Seabed });
            Current = Field.StackA;
            this.PassCounter++;
        }
        const Identities = Layers.map(Layer => `${Layer.Id}:${Layer.Revision}:${Layer.Category === "Sculpt" ? (Field.SculptRevisions.get(Layer.Id) || 0) : 0}:${Layer.Opacity}`);
        const Region = FromCache ? this.ResolveRegion(Field, Terrain, Layers, Identities, StartIndex, DirtyRect) : null;
        if (Region)
        {
            if (Region.Rect)
            {
                // 📝 Parity: the last write must land in the previous Final, whose texels outside Rect stay valid.
                const Other = Field.Final === Field.StackA ? Field.StackB : Field.StackA;
                let Input = Field.Cache;
                let Output = Region.Chain.length % 2 === 1 ? Field.Final : Other;
                for (const Index of Region.Chain)
                {
                    this.ApplyLayer(Field, Terrain, Document, Layers[Index], Input, Output, Region.Rect);
                    Input = Output;
                    Output = Output === Field.Final ? Other : Field.Final;
                }
                this.RefreshDerivedFields(Field, Document, Terrain, Region.Rect);
                Field.NeedsRefine = true;
                Field.TunnelStale = true;
            }
            Field.FinalSignature = FinalSignature;
            this.RegisterLayerFootprints(Field, Layers, Identities);
            this.RefreshTunnelVolume(Field, Document, Terrain, TunnelLayers, Interactive);
            this.RequestSampleHeightReadback();
            Field.LastEvaluation = { Layers: Region.Chain.length, Passes: this.PassCounter, Milliseconds: performance.now() - Started, FromCache: true, CacheIndex: StartIndex, Region: Region.Rect };
            return true;
        }
        for (let Index = StartIndex; Index < Layers.length; ++Index)
        {
            if (Index === SelectedIndex && !FromCache && Index > 0)
            {
                D.CopyRegion(Current, Field.Cache);
                Field.CacheIndex = Index;
                Field.CacheSignature = InputSignature(Index);
            }
            const Output = Current === Field.StackA ? Field.StackB : Field.StackA;
            this.ApplyLayer(Field, Terrain, Document, Layers[Index], Current, Output);
            Current = Output;
        }
        if (Current === Field.Cache)
        {
            D.CopyRegion(Field.Cache, Field.StackA);
            Current = Field.StackA;
        }
        Field.Final = Current;
        Field.FinalSignature = FinalSignature;
        Field.FinalCacheSignature = Field.CacheIndex > 0 && Field.CacheSignature === InputSignature(Field.CacheIndex) ? Field.CacheSignature : "";
        this.RegisterLayerFootprints(Field, Layers, Identities);
        Field.NeedsRefine = false;
        this.RefreshDerivedFields(Field, Document, Terrain, null);
        Field.TunnelStale = true;
        this.RefreshTunnelVolume(Field, Document, Terrain, TunnelLayers, Interactive);
        this.RequestSampleHeightReadback();
        Field.HasEvaluated = true;
        Field.Stale = false;
        Field.LastEvaluation = { Layers: Layers.length - StartIndex, Passes: this.PassCounter, Milliseconds: performance.now() - Started, FromCache, CacheIndex: StartIndex, Region: null };
        return true;
    }

    // 📝 Rebuilds the cached input of the selected layer without touching Final (ping-pong through the non-final stack
    //    and the cache), so the first edit of a newly selected layer already takes the cached / region path.
    WarmCache(Field, Document, Terrain, Layers, SelectedIndex, CacheSignature)
    {
        const D = this.Device;
        const Other = Field.Final === Field.StackA ? Field.StackB : Field.StackA;
        D.RasterizeTriangle(this.Programs.StackSeed, Other, { uSeabed: Document.Settings.Seabed });
        let Current = Other;
        for (let Index = 0; Index < SelectedIndex; ++Index)
        {
            const Output = Current === Other ? Field.Cache : Other;
            this.ApplyLayer(Field, Terrain, Document, Layers[Index], Current, Output);
            Current = Output;
        }
        if (Current !== Field.Cache) D.CopyRegion(Current, Field.Cache);
        Field.CacheIndex = SelectedIndex;
        Field.CacheSignature = CacheSignature;
        Field.FinalCacheSignature = CacheSignature;
    }

    // 📝 Region = dirty texel rectangle or null (full). Margins: AO reaches 90 m; shadows only fall away from the sun,
    //    bounded to RegionShadowReach during strokes (the refine pass afterwards restores full-length shadows).
    RefreshDerivedFields(Field, Document, Terrain, Region)
    {
        const D = this.Device, GL = D.GL, N = Field.Resolution, S = Document.Settings;
        const Cell = [Terrain.Size[0] / N, Terrain.Size[1] / N];
        const Azimuth = S.SunAzimuth * Math.PI / 180, Elevation = S.SunElevation * Math.PI / 180;
        const SunPlanar = [Math.sin(Azimuth), -Math.cos(Azimuth)];
        const Clip = (X0, Y0, X1, Y1, Limit) => { const A = [Math.max(0, Math.floor(X0)), Math.max(0, Math.floor(Y0))]; const B = [Math.min(Limit, Math.ceil(X1)), Math.min(Limit, Math.ceil(Y1))]; return [A[0], A[1], Math.max(0, B[0] - A[0]), Math.max(0, B[1] - A[1])]; };
        let SurfaceRect = null, ShadowRect = null, TileRect = null;
        if (Region)
        {
            const Margin = 92 / Math.min(Cell[0], Cell[1]) + 2;
            SurfaceRect = Clip(Region[0] - Margin, Region[1] - Margin, Region[0] + Region[2] + Margin, Region[1] + Region[3] + Margin, N);
            const Reach = Math.min(N / 4, RegionShadowReach / Math.max(Math.tan(Elevation), 0.05) / Math.min(Cell[0], Cell[1]));
            const Lo = [Region[0] - 2 + Math.min(0, -SunPlanar[0] * Reach), Region[1] - 2 + Math.min(0, -SunPlanar[1] * Reach)];
            const Hi = [Region[0] + Region[2] + 2 + Math.max(0, -SunPlanar[0] * Reach), Region[1] + Region[3] + 2 + Math.max(0, -SunPlanar[1] * Reach)];
            ShadowRect = Clip(Lo[0] / 2, Lo[1] / 2, Hi[0] / 2, Hi[1] / 2, N / 2);
            TileRect = Clip(Region[0] / TileTexels - 1, Region[1] / TileTexels - 1, (Region[0] + Region[2]) / TileTexels + 1, (Region[1] + Region[3]) / TileTexels + 1, N / TileTexels);
        }
        GL.bindFramebuffer(GL.FRAMEBUFFER, Field.SurfaceTarget);
        GL.viewport(0, 0, N, N);
        D.Scissor(SurfaceRect);
        D.RasterizeTriangle(this.Programs.SurfaceField, undefined, { uStack: Field.Final, uCell: Cell });
        D.Scissor(ShadowRect);
        D.RasterizeTriangle(this.Programs.ShadowField, Field.Shadow, { uStack: Field.Final, uSize: Terrain.Size, uSunPlanar: SunPlanar, uSunTangent: Math.tan(Elevation) });
        D.Scissor(TileRect);
        D.RasterizeTriangle(this.Programs.TileMaximum, Field.TileMaximum, { uStack: Field.Final, uTile: TileTexels });
        D.Scissor(null);
        D.RefreshMipmaps(Field.Surface);
        D.RefreshMipmaps(Field.Material);
        D.RefreshMipmaps(Field.Shadow);
        this.PassCounter += 3;
    }

    RequestSampleHeightReadback()
    {
        if (!this.Atlas || !this.Atlas.RowsUsed) { this.SampleHeightsHost = null; return; }
        const Serial = ++this.SampleHeightsSerial;
        const Columns = this.Atlas.MaxCount, Rows = this.Atlas.RowsUsed;
        const AtlasAtRequest = this.Atlas;
        this.Device.ReadAsynchronous(this.SampleHeights, 0, 0, Columns, Rows, Pixels =>
        {
            if (Serial !== this.SampleHeightsSerial || AtlasAtRequest !== this.Atlas) return;
            this.SampleHeightsHost = { Pixels, Columns, Rows };
        });
    }

    // 📝 Returns the evaluated path height of a dense spline sample, or null until the async readback lands.
    RetrieveSampleHeight(Row, Column)
    {
        const Host = this.SampleHeightsHost;
        if (!Host || Row >= Host.Rows || Column >= Host.Columns) return null;
        return Host.Pixels[(Row * Host.Columns + Column) * 4];
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SPARSE TUNNEL VOLUME
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Tunnels are true 3D carve-outs (overhangs a height field cannot hold). They are baked into a narrow 3D SDF
    //    texture bounding only the tunnels. Rebaked immediately when tunnel splines change; when only the terrain under
    //    the portals changes, rebaking waits until the interaction ends.
    RefreshTunnelVolume(Field, Document, Terrain, TunnelLayers, Interactive)
    {
        const D = this.Device, GL = D.GL;
        if (!TunnelLayers.length)
        {
            if (Field.Tunnel) { D.ReleaseTexture(Field.Tunnel.Volume); Field.Tunnel = null; }
            Field.TunnelSignature = "";
            return;
        }
        const LayerSignature = TunnelLayers.map(Layer => `${Layer.Id}:${Layer.Revision}`).join("|") + `:${Terrain.Revision}`;
        const LayersChanged = LayerSignature !== Field.TunnelSignature;
        if (!LayersChanged && !(Field.TunnelStale && !Interactive)) return;
        for (const Layer of TunnelLayers) this.EvaluateSampleHeights(Field.Final, Terrain, Layer, this.Atlas.Ranges.get(Layer.Id));
        let Lo = [Infinity, Infinity, Infinity], Hi = [-Infinity, -Infinity, -Infinity], MaxRadius = 1;
        for (const Layer of TunnelLayers)
        {
            const Range = this.Atlas.Ranges.get(Layer.Id);
            const Heights = D.ReadSynchronous(this.SampleHeights, 0, Range.RowStart, this.Atlas.MaxCount, Range.RowCount);
            Range.SampleSets.forEach((Dense, SplineId) =>
            {
                const RowOffset = Range.SplineRows.get(SplineId) - Range.RowStart;
                Dense.forEach((Sample, Column) =>
                {
                    const Y = Heights[(RowOffset * this.Atlas.MaxCount + Column) * 4];
                    Lo = [Math.min(Lo[0], Sample[0]), Math.min(Lo[1], Y), Math.min(Lo[2], Sample[1])];
                    Hi = [Math.max(Hi[0], Sample[0]), Math.max(Hi[1], Y), Math.max(Hi[2], Sample[1])];
                    MaxRadius = Math.max(MaxRadius, Sample[2]);
                });
            });
        }
        const Margin = MaxRadius * 2.5;
        Lo = Lo.map(Component => Component - Margin);
        Hi = Hi.map(Component => Component + Margin);
        const Extent = Hi.map((Component, Index) => Component - Lo[Index]);
        const Voxel = Math.max(MaxRadius / 3, Extent[0] / TunnelVoxelLimitXZ, Extent[2] / TunnelVoxelLimitXZ, Extent[1] / TunnelVoxelLimitY);
        const Dimensions = [Math.max(4, Math.ceil(Extent[0] / Voxel)), Math.max(4, Math.ceil(Extent[2] / Voxel)), Math.max(4, Math.ceil(Extent[1] / Voxel))];
        if (!Field.Tunnel || Field.Tunnel.Volume.Width !== Dimensions[0] || Field.Tunnel.Volume.Height !== Dimensions[1] || Field.Tunnel.Volume.Depth !== Dimensions[2])
        {
            if (Field.Tunnel) D.ReleaseTexture(Field.Tunnel.Volume);
            Field.Tunnel = { Volume: D.CreateTexture3D(Dimensions[0], Dimensions[1], Dimensions[2], "R16F") };
        }
        Field.Tunnel.Min = Lo;
        Field.Tunnel.Size = Extent;
        const Volume = Field.Tunnel.Volume;
        GL.viewport(0, 0, Volume.Width, Volume.Height);
        for (let Slice = 0; Slice < Volume.Depth; ++Slice)
        {
            GL.bindFramebuffer(GL.FRAMEBUFFER, Volume.LayerTargets[Slice]);
            GL.clearColor(1e4, 1e4, 1e4, 1e4);
            GL.clear(GL.COLOR_BUFFER_BIT);
        }
        GL.enable(GL.BLEND);
        GL.blendEquation(GL.MIN);
        for (const Layer of TunnelLayers)
        {
            const Range = this.Atlas.Ranges.get(Layer.Id);
            for (let Slice = 0; Slice < Volume.Depth; ++Slice)
            {
                GL.bindFramebuffer(GL.FRAMEBUFFER, Volume.LayerTargets[Slice]);
                D.RasterizeTriangle(this.Programs.TunnelVolume, undefined, {
                    uSampleAtlas: this.SampleAtlas, uSampleHeights: this.SampleHeights, uGroupAtlas: this.GroupAtlas,
                    uGroupStart: Range.GroupStart, uGroupCount: Range.GroupCount, uVolumeMin: Lo, uVolumeSize: Extent,
                    uVolumeTexels: [Volume.Width, Volume.Height, Volume.Depth], uSlice: Slice });
            }
        }
        GL.blendEquation(GL.FUNC_ADD);
        GL.disable(GL.BLEND);
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        Field.TunnelSignature = LayerSignature;
        Field.TunnelStale = false;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SCULPT RASTERS
    //--------------------------------------------------------------------------------------------------------------------

    EnsureSculpt(Field, LayerId)
    {
        if (!Field.SculptFields.has(LayerId)) Field.SculptFields.set(LayerId, this.Device.CreateTexture2D(Field.Resolution, Field.Resolution, "R32F", { Linear: true }));
        return Field.SculptFields.get(LayerId);
    }

    TexelRectangle(Field, Terrain, X, Z, Radius)
    {
        const N = Field.Resolution;
        const X0 = Math.max(0, Math.floor((X - Radius - Terrain.Min[0]) / Terrain.Size[0] * N) - 1);
        const Y0 = Math.max(0, Math.floor((Z - Radius - Terrain.Min[1]) / Terrain.Size[1] * N) - 1);
        const X1 = Math.min(N, Math.ceil((X + Radius - Terrain.Min[0]) / Terrain.Size[0] * N) + 1);
        const Y1 = Math.min(N, Math.ceil((Z + Radius - Terrain.Min[1]) / Terrain.Size[1] * N) + 1);
        return X1 > X0 && Y1 > Y0 ? [X0, Y0, X1 - X0, Y1 - Y0] : null;
    }

    // 📝 One stamp = region blit (sculpt → scratch) + one quad over the brush footprint. Strokes are unbounded.
    StampSculpt(Field, Terrain, Layer, Stamp)
    {
        const D = this.Device;
        const Sculpt = this.EnsureSculpt(Field, Layer.Id);
        const Rect = this.TexelRectangle(Field, Terrain, Stamp.X, Stamp.Z, Stamp.Radius);
        if (!Rect) return null;
        const Scratch = this.RetrieveScratch(Field.Resolution).Sculpt;
        D.CopyRegion(Sculpt, Scratch, ...Rect);
        const N = Field.Resolution;
        D.BindTarget(Sculpt);
        D.UseProgram(this.Programs.SculptStamp, {
            uRect: [Rect[0] / N, Rect[1] / N, (Rect[0] + Rect[2]) / N, (Rect[1] + Rect[3]) / N],
            uSource: Scratch, uHeight: Field.Final, uOrigin: Terrain.Min, uSize: Terrain.Size, uCentre: [Stamp.X, Stamp.Z, Stamp.FlattenHeight ?? 0],
            uRadius: Stamp.Radius, uStrength: Stamp.Strength, uHardness: Stamp.Hardness, uOpacity: Layer.Opacity, uMode: Stamp.Mode });
        const GL = D.GL;
        GL.bindVertexArray(D.TriangleArray);
        GL.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
        GL.bindVertexArray(null);
        Field.SculptRevisions.set(Layer.Id, (Field.SculptRevisions.get(Layer.Id) || 0) + 1);
        return Rect;
    }

    SnapshotSculptRegion(Field, LayerId, Rect)
    {
        const D = this.Device;
        const Sculpt = this.EnsureSculpt(Field, LayerId);
        const Snapshot = D.CreateTexture2D(Rect[2], Rect[3], "R32F");
        D.CopyRegion(Sculpt, Snapshot, Rect[0], Rect[1], Rect[2], Rect[3], 0, 0);
        return Snapshot;
    }

    RestoreSculptRegion(Field, LayerId, Rect, Snapshot)
    {
        const D = this.Device;
        const Sculpt = this.EnsureSculpt(Field, LayerId);
        D.CopyRegion(Snapshot, Sculpt, 0, 0, Rect[2], Rect[3], Rect[0], Rect[1]);
        Field.SculptRevisions.set(LayerId, (Field.SculptRevisions.get(LayerId) || 0) + 1);
    }

    ClearSculpt(Field, LayerId)
    {
        const Sculpt = Field.SculptFields.get(LayerId);
        if (!Sculpt) return;
        const GL = this.Device.GL;
        this.Device.BindTarget(Sculpt);
        GL.clearColor(0, 0, 0, 0);
        GL.clear(GL.COLOR_BUFFER_BIT);
        Field.SculptRevisions.set(LayerId, (Field.SculptRevisions.get(LayerId) || 0) + 1);
    }

    // 📝 Re-projects a sculpt raster when its cell bounds or resolution change (sculpting stays anchored in the world).
    ResampleSculptInto(Source, Target, OldBounds, NewBounds)
    {
        this.Device.RasterizeTriangle(this.Programs.SculptResample, Target, { uSource: Source, uOldOrigin: OldBounds.Min, uOldSize: OldBounds.Size, uOrigin: NewBounds.Min, uSize: NewBounds.Size, uTexels: [Target.Width, Target.Height] });
    }

    CloneSculpt(Source)
    {
        const Clone = this.Device.CreateTexture2D(Source.Width, Source.Height, "R32F", { Linear: true });
        this.Device.CopyRegion(Source, Clone);
        return Clone;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                PICKING AND PROBES
    //--------------------------------------------------------------------------------------------------------------------

    ReliefParameters(Field, Document, Terrain)
    {
        const S = Document.Settings;
        const Present = !!(Field && Field.HasEvaluated);
        const Tunnel = Present && Field.Tunnel;
        return {
            uOrigin: Terrain ? Terrain.Min : [0, 0], uSize: Terrain ? Terrain.Size : [1, 1], uHeightRange: [S.Seabed - 300, S.Ceiling + 600],
            uStack: Present ? Field.Final : null, uTileMaximum: Present ? Field.TileMaximum : null,
            uTileCount: Present ? [Field.TileMaximum.Width, Field.TileMaximum.Height] : [1, 1],
            uTunnelActive: Tunnel ? 1 : 0, uTunnel: Tunnel ? Field.Tunnel.Volume : this.EmptyVolume,
            uTunnelMin: Tunnel ? Field.Tunnel.Min : [0, 0, 0], uTunnelSize: Tunnel ? Field.Tunnel.Size : [1, 1, 1], uTerrainPresent: Present ? 1 : 0,
        };
    }

    PickSynchronous(Field, Document, Terrain, Origin, Direction)
    {
        if (!Field || !Field.HasEvaluated) return null;
        this.Device.RasterizeTriangle(this.Programs.ReliefPick, this.PickSurface, { ...this.ReliefParameters(Field, Document, Terrain), uPickOrigin: Origin, uPickDirection: Direction, uPixelAngle: 0.0008 });
        const Pixel = this.Device.ReadSynchronous(this.PickSurface, 0, 0, 1, 1);
        return Pixel[3] > 0 ? { X: Pixel[0], Y: Pixel[1], Z: Pixel[2], Carve: Pixel[3] > 1.5 } : null;
    }

    PickAsynchronous(Field, Document, Terrain, Origin, Direction, Resolve)
    {
        if (!Field || !Field.HasEvaluated) return Resolve(null);
        this.Device.RasterizeTriangle(this.Programs.ReliefPick, this.PickSurface, { ...this.ReliefParameters(Field, Document, Terrain), uPickOrigin: Origin, uPickDirection: Direction, uPixelAngle: 0.0008 });
        this.Device.ReadAsynchronous(this.PickSurface, 0, 0, 1, 1, Pixel => Resolve(Pixel[3] > 0 ? { X: Pixel[0], Y: Pixel[1], Z: Pixel[2], Carve: Pixel[3] > 1.5 } : null));
    }

    ProbeHeight(Field, Terrain, X, Z)
    {
        if (!Field || !Field.HasEvaluated) return 0;
        this.Device.RasterizeTriangle(this.Programs.PointProbe, this.ProbeSurface, { uStack: Field.Final, uOrigin: Terrain.Min, uSize: Terrain.Size, uPoint: [X, Z] });
        return this.Device.ReadSynchronous(this.ProbeSurface, 0, 0, 1, 1)[0];
    }

    ReadHeightField(Field)
    {
        const N = Field.Resolution;
        const Pixels = this.Device.ReadSynchronous(Field.Final, 0, 0, N, N);
        const Heights = new Float32Array(N * N);
        for (let Index = 0; Index < N * N; ++Index) Heights[Index] = Pixels[Index * 4];
        return Heights;
    }

    ReadSculptField(Field, LayerId)
    {
        const Sculpt = Field.SculptFields.get(LayerId);
        if (!Sculpt) return null;
        const N = Field.Resolution;
        const Pixels = this.Device.ReadSynchronous(Sculpt, 0, 0, N, N);
        const Deltas = new Float32Array(N * N);
        let Touched = false;
        for (let Index = 0; Index < N * N; ++Index) { Deltas[Index] = Pixels[Index * 4]; if (Deltas[Index] !== 0) Touched = true; }
        return Touched ? Deltas : null;
    }

    WriteSculptField(Field, LayerId, Deltas)
    {
        const Sculpt = this.EnsureSculpt(Field, LayerId);
        this.Device.UploadRegion(Sculpt, 0, 0, Field.Resolution, Field.Resolution, Deltas);
        Field.SculptRevisions.set(LayerId, (Field.SculptRevisions.get(LayerId) || 0) + 1);
    }
}
