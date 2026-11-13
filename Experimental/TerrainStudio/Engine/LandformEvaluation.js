/*====================================================================================================================================
                                                     LANDFORMEVALUATION.JS
====================================================================================================================================*/
// 🧩 GPU landform evaluation for the active region: coast field, foundation, ordered layer stack, spline ops, volumes

import { CompileProgram, ConstructSurfaceTarget, ConstructVolumeTarget, ConstructLineTexture, ConstructCoverageTriangle, ConstructStreamingGeometry } from "./GpuContext.js";
import * as Shaders from "./LandformShaders.js";
import { SampleCenterline, EvaluateExtent, CenterlineSampleCeiling } from "./CurveSampling.js";
import { ResolveActiveRegion, EvaluateRegionLattice, SplineCategoryIndex, ProfileModes, FalloffProfiles } from "./WorldDocument.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const DomainPaddingFraction = 0.125; // [0-1] - Coast field margin outside the region so coastlines just outside still count
const ClearanceVoxels = 8;           // [-]   - Volume channels store min(distance, ClearanceVoxels × voxel)

//------------------------------------------------------------------------------------------------------------------------
//                                                 INTERNAL FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

function InjectDefines(Source, Names)
{
    return Names.reduce((Text, Name) => Text.replace("#version 300 es\n", `#version 300 es\n#define ${Name}\n`), Source);
}

function NextPowerOfTwo(Number)
{
    return 2 ** Math.ceil(Math.log2(Math.max(1, Number)));
}

//------------------------------------------------------------------------------------------------------------------------
//                                               LANDFORM EVALUATION
//------------------------------------------------------------------------------------------------------------------------

export class LandformEvaluation
{
    constructor(Gpu)
    {
        this.Gpu = Gpu;
        const Context = this.Context = Gpu.Context;
        const HeightDefines = Gpu.LinearFloat ? ["HEIGHT_LINEAR"] : [];
        const Coverage = (Fragment, Label, Defines = []) => CompileProgram(Context, Shaders.CoverageVertex, InjectDefines(Fragment, Defines), Label);
        this.Programs = {
            Copy:              Coverage(Shaders.CopyFragment, "Copy"),
            Resample:          Coverage(Shaders.ResampleFragment, "Resample"),
            ShapeFill:         CompileProgram(Context, Shaders.ShapeFillVertex, Shaders.ShapeFillFragment, "ShapeFill"),
            ShapeStroke:       CompileProgram(Context, Shaders.ShapeStrokeVertex, Shaders.ShapeStrokeFragment, "ShapeStroke"),
            SeedInitialization: Coverage(Shaders.SeedInitializationFragment, "SeedInitialization"),
            SeedJump:          Coverage(Shaders.SeedJumpFragment, "SeedJump"),
            CoastDistance:     Coverage(Shaders.CoastDistanceFragment, "CoastDistance"),
            Foundation:        Coverage(Shaders.FoundationFragment, "Foundation"),
            LayerAccumulate:   Coverage(Shaders.LayerAccumulateFragment, "LayerAccumulate"),
            HeightBrush:       Coverage(Shaders.HeightBrushFragment, "HeightBrush"),
            ProfileSample:     Coverage(Shaders.ProfileSampleFragment, "ProfileSample", HeightDefines),
            ProfileSmooth:     Coverage(Shaders.ProfileSmoothFragment, "ProfileSmooth"),
            ProfileDescent:    Coverage(Shaders.ProfileDescentFragment, "ProfileDescent"),
            SplineField:       CompileProgram(Context, Shaders.SplineFieldVertex, Shaders.SplineFieldFragment, "SplineField"),
            SplineOperation:   Coverage(Shaders.SplineOperationFragment, "SplineOperation"),
            VolumeLayerMinimum: Coverage(Shaders.VolumeLayerMinimumFragment, "VolumeLayerMinimum"),
            VolumeCopy:        Coverage(Shaders.VolumeCopyFragment, "VolumeCopy"),
            VolumeResample:    Coverage(Shaders.VolumeResampleFragment, "VolumeResample"),
            VolumeBrush:       Coverage(Shaders.VolumeBrushFragment, "VolumeBrush"),
            Tunnel:            CompileProgram(Context, Shaders.TunnelVertex, Shaders.TunnelFragment, "Tunnel"),
            Hillshade:         Coverage(Shaders.HillshadeFragment, "Hillshade", HeightDefines),
        };
        this.CoverageTriangle = ConstructCoverageTriangle(Context);
        this.FillGeometry = ConstructStreamingGeometry(Context, [[0, 2]]);
        this.StrokeGeometry = ConstructStreamingGeometry(Context, [[0, 2], [1, 4]]);
        this.SplineGeometry = ConstructStreamingGeometry(Context, [[0, 2], [1, 4], [2, 2]]);
        this.TunnelGeometry = ConstructStreamingGeometry(Context, [[0, 2], [1, 2]]);
        this.ProfileTemporaries = [0, 1].map(() => ConstructSurfaceTarget(Context, CenterlineSampleCeiling, 1, "R32F"));
        this.RegionStores = new Map();
        this.SplineStores = new Map();
        this.Work = null;
        this.WorkSignature = "";
        this.Region = null;
        this.Lattice = null;
        this.FoundationInvalid = true;
        this.StackInvalid = true;
        this.TunnelsInvalid = true;
        this.VolumeLayersInvalid = true;
        this.CheckpointLayerToken = null;
        this.CheckpointValid = false;
        this.CurrentHeightIndex = 0;
        this.TunnelCount = 0;
        this.VolumeLayerCount = 0;
        this.AdditionActive = false;
        this.Revision = 0;
        this.Timings = { Foundation: 0, Stack: 0, Tunnels: 0, VolumeLayers: 0, Brush: 0, Submission: 0, GpuMilliseconds: null };
        this.PendingQueries = [];
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              CONFIGURATION
    //--------------------------------------------------------------------------------------------------------------------

    InvalidateFoundation() { this.FoundationInvalid = true; this.StackInvalid = true; }
    InvalidateStack() { this.StackInvalid = true; }
    InvalidateVolumeLayers() { this.VolumeLayersInvalid = true; }

    get HeightTarget() { return this.Work ? this.Work.Heights[this.CurrentHeightIndex] : null; }
    get VolumeTarget() { return this.Work ? this.Work.Volume : null; }
    get VolumeActive() { return this.TunnelCount > 0 || this.VolumeLayerCount > 0; }
    get Clearance() { return this.Lattice ? this.Lattice.VolumeVoxel * ClearanceVoxels : 32; }

    // 📝 Shared work targets are sized for the active region only; persistent sculpt targets live in RegionStores.
    AllocateWork(Lattice)
    {
        const Context = this.Context;
        if (this.Work) for (const Target of this.Work.All) Target.Release();
        const Width = Lattice.HeightWidth;
        const Depth = Lattice.HeightDepth;
        const Padding = Math.round(Math.max(Width, Depth) * DomainPaddingFraction);
        const DomainWidth = Width + Padding * 2;
        const DomainDepth = Depth + Padding * 2;
        const Linear = this.Gpu.LinearFloat;
        const Work = {
            Width, Depth, Padding, DomainWidth, DomainDepth,
            Mask: ConstructSurfaceTarget(Context, DomainWidth, DomainDepth, "R8", { DepthStencil: true }),
            Seeds: [0, 1].map(() => ConstructSurfaceTarget(Context, DomainWidth, DomainDepth, "RG32F")),
            Coast: ConstructSurfaceTarget(Context, DomainWidth, DomainDepth, "R32F"),
            Foundation: ConstructSurfaceTarget(Context, Width, Depth, "R32F"),
            Heights: [0, 1].map(() => ConstructSurfaceTarget(Context, Width, Depth, "R32F", { Linear })),
            Checkpoint: ConstructSurfaceTarget(Context, Width, Depth, "R32F"),
            Field: ConstructSurfaceTarget(Context, Width, Depth, "RGBA32F", { Depth: true }),
            Scratch: ConstructSurfaceTarget(Context, Width, Depth, "R32F"),
            Hillshade: ConstructSurfaceTarget(Context, Math.min(Width, 768), Math.max(8, Math.round(Math.min(Width, 768) * Depth / Width)), "RGBA8"),
            Volume: ConstructVolumeTarget(Context, Lattice.VolumeWidth, Lattice.VolumeDepth, Lattice.VolumeHeight, "RGBA16F"),
            VolumeScratch: ConstructVolumeTarget(Context, Lattice.VolumeWidth, Lattice.VolumeDepth, Lattice.VolumeHeight, "RG16F"),
        };
        Work.All = [Work.Mask, ...Work.Seeds, Work.Coast, Work.Foundation, ...Work.Heights, Work.Checkpoint, Work.Field, Work.Scratch, Work.Hillshade, Work.Volume, Work.VolumeScratch];
        Work.ByteFootprint = (DomainWidth * DomainDepth * (1 + 4 + 8 + 8 + 4)) + Width * Depth * (4 * 5 + 16 + 4)
            + Lattice.VolumeWidth * Lattice.VolumeDepth * Lattice.VolumeHeight * (8 + 4);
        this.Work = Work;
    }

    // Bind the active region; reallocates work targets on lattice change and re-projects sculpt layers on move/resize.
    Configure(Document)
    {
        const Region = ResolveActiveRegion(Document);
        this.Region = Region;
        if (!Region) return false;
        const Lattice = EvaluateRegionLattice(Region);
        const Signature = [Lattice.HeightWidth, Lattice.HeightDepth, Lattice.VolumeWidth, Lattice.VolumeDepth, Lattice.VolumeHeight].join("x");
        if (Signature !== this.WorkSignature)
        {
            this.AllocateWork(Lattice);
            this.WorkSignature = Signature;
            this.FoundationInvalid = this.StackInvalid = this.TunnelsInvalid = this.VolumeLayersInvalid = true;
            this.CheckpointValid = false;
        }
        const Placement = [Region.Token, Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ, Region.MinimumHeight, Region.MaximumHeight].join("|");
        if (Placement !== this.Placement)
        {
            this.Placement = Placement;
            this.FoundationInvalid = this.StackInvalid = this.TunnelsInvalid = this.VolumeLayersInvalid = true;
            this.CheckpointValid = false;
        }
        this.Lattice = Lattice;
        this.ReprojectRegionStore(Region, Lattice);
        return true;
    }

    ResolveRegionStore(Region)
    {
        if (!this.RegionStores.has(Region.Token))
        {
            this.RegionStores.set(Region.Token, { SculptTargets: new Map(), VolumeTargets: new Map(), AdditionLayers: new Set(), Rect: null, Lattice: null });
        }
        return this.RegionStores.get(Region.Token);
    }

    // 📝 Sculpt layers are world-anchored: moving or resizing a region resamples them, it never shifts the strokes.
    ReprojectRegionStore(Region, Lattice)
    {
        const Store = this.ResolveRegionStore(Region);
        const Rect = { MinimumX: Region.MinimumX, MinimumZ: Region.MinimumZ, SizeX: Region.SizeX, SizeZ: Region.SizeZ, MinimumHeight: Region.MinimumHeight, MaximumHeight: Region.MaximumHeight };
        if (Store.Rect && Store.Lattice && JSON.stringify(Store.Rect) === JSON.stringify(Rect) && JSON.stringify(Store.Lattice) === JSON.stringify(Lattice)) return;
        const Context = this.Context;
        if (Store.Rect && Store.Lattice)
        {
            for (const [LayerToken, Previous] of Store.SculptTargets)
            {
                const Next = ConstructSurfaceTarget(Context, Lattice.HeightWidth, Lattice.HeightDepth, "R32F");
                this.Programs.Resample.Activate()
                    .Texture("SourceTexture", Previous.Texture)
                    .Vector4("SourceRect", Store.Rect.MinimumX, Store.Rect.MinimumZ, Store.Rect.SizeX, Store.Rect.SizeZ)
                    .Vector4("TargetRect", Rect.MinimumX, Rect.MinimumZ, Rect.SizeX, Rect.SizeZ)
                    .Vector2("TargetSize", Next.Width, Next.Height);
                this.RasterizeCoverage(Next);
                Store.SculptTargets.set(LayerToken, Next);
                Previous.Release();
            }
            for (const [LayerToken, Previous] of Store.VolumeTargets)
            {
                const Next = ConstructVolumeTarget(Context, Lattice.VolumeWidth, Lattice.VolumeDepth, Lattice.VolumeHeight, "RG16F");
                const Program = this.Programs.VolumeResample.Activate()
                    .Texture("SourceTexture", Previous.Texture, Context.TEXTURE_3D)
                    .Vector3("SourceMinimum", Store.Rect.MinimumX, Store.Rect.MinimumHeight, Store.Rect.MinimumZ)
                    .Vector3("SourceSize", Store.Rect.SizeX, Store.Rect.MaximumHeight - Store.Rect.MinimumHeight, Store.Rect.SizeZ)
                    .Vector3("TargetMinimum", Rect.MinimumX, Rect.MinimumHeight, Rect.MinimumZ)
                    .Vector3("TargetSize", Rect.SizeX, Rect.MaximumHeight - Rect.MinimumHeight, Rect.SizeZ)
                    .Vector3("TargetDimensions", Next.Width, Next.Height, Next.Depth)
                    .Float("Clearance", Lattice.VolumeVoxel * ClearanceVoxels);
                for (let SliceIndex = 0; SliceIndex < Next.Depth; SliceIndex++)
                {
                    Program.Integer("SliceIndex", SliceIndex);
                    this.RasterizeCoverageSlice(Next, SliceIndex);
                }
                Store.VolumeTargets.set(LayerToken, Next);
                Previous.Release();
            }
        }
        Store.Rect = Rect;
        Store.Lattice = Lattice;
    }

    EnsureSculptTarget(LayerToken)
    {
        const Store = this.ResolveRegionStore(this.Region);
        if (!Store.SculptTargets.has(LayerToken))
        {
            const Context = this.Context;
            const Target = ConstructSurfaceTarget(Context, this.Lattice.HeightWidth, this.Lattice.HeightDepth, "R32F");
            Context.bindFramebuffer(Context.FRAMEBUFFER, Target.Framebuffer);
            Context.clearBufferfv(Context.COLOR, 0, [0, 0, 0, 0]);
            Store.SculptTargets.set(LayerToken, Target);
        }
        return Store.SculptTargets.get(LayerToken);
    }

    EnsureVolumeTarget(LayerToken)
    {
        const Store = this.ResolveRegionStore(this.Region);
        if (!Store.VolumeTargets.has(LayerToken))
        {
            const Context = this.Context;
            const Lattice = this.Lattice;
            const Target = ConstructVolumeTarget(Context, Lattice.VolumeWidth, Lattice.VolumeDepth, Lattice.VolumeHeight, "RG16F");
            const Clearance = this.Clearance;
            for (const Framebuffer of Target.SliceFramebuffers)
            {
                Context.bindFramebuffer(Context.FRAMEBUFFER, Framebuffer);
                Context.clearBufferfv(Context.COLOR, 0, [Clearance, Clearance, Clearance, Clearance]);
            }
            Store.VolumeTargets.set(LayerToken, Target);
        }
        return Store.VolumeTargets.get(LayerToken);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                           RASTERIZATION PRIMITIVES
    //--------------------------------------------------------------------------------------------------------------------

    RasterizeCoverage(Target, Width = Target.Width, Height = Target.Height)
    {
        const Context = this.Context;
        Context.bindFramebuffer(Context.FRAMEBUFFER, Target.Framebuffer);
        Context.viewport(0, 0, Width, Height);
        Context.bindVertexArray(this.CoverageTriangle);
        Context.drawArrays(Context.TRIANGLES, 0, 3);
    }

    RasterizeCoverageSlice(Target, SliceIndex)
    {
        const Context = this.Context;
        Context.bindFramebuffer(Context.FRAMEBUFFER, Target.SliceFramebuffers[SliceIndex]);
        Context.viewport(0, 0, Target.Width, Target.Height);
        Context.bindVertexArray(this.CoverageTriangle);
        Context.drawArrays(Context.TRIANGLES, 0, 3);
    }

    CopySurface(Source, Target, Width = Target.Width, Height = Target.Height)
    {
        this.Programs.Copy.Activate().Texture("SourceTexture", Source.Texture);
        this.RasterizeCoverage(Target, Width, Height);
    }

    BlitSurface(Source, Target, Rect = null)
    {
        const Context = this.Context;
        const [X0, Y0, X1, Y1] = Rect ?? [0, 0, Source.Width, Source.Height];
        Context.bindFramebuffer(Context.READ_FRAMEBUFFER, Source.Framebuffer);
        Context.bindFramebuffer(Context.DRAW_FRAMEBUFFER, Target.Framebuffer);
        Context.blitFramebuffer(X0, Y0, X1, Y1, X0, Y0, X1, Y1, Context.COLOR_BUFFER_BIT, Context.NEAREST);
        Context.bindFramebuffer(Context.READ_FRAMEBUFFER, null);
        Context.bindFramebuffer(Context.DRAW_FRAMEBUFFER, null);
    }

    // World X/Z extent → clamped texel rectangle [X0, Y0, X1, Y1) of the region height lattice; null when empty.
    ResolveTexelRect(Extent)
    {
        const Region = this.Region;
        const Width = this.Work.Width;
        const Depth = this.Work.Depth;
        const X0 = Math.max(0, Math.floor((Extent.MinimumX - Region.MinimumX) / Region.SizeX * Width) - 1);
        const Y0 = Math.max(0, Math.floor((Extent.MinimumZ - Region.MinimumZ) / Region.SizeZ * Depth) - 1);
        const X1 = Math.min(Width, Math.ceil((Extent.MaximumX - Region.MinimumX) / Region.SizeX * Width) + 1);
        const Y1 = Math.min(Depth, Math.ceil((Extent.MaximumZ - Region.MinimumZ) / Region.SizeZ * Depth) + 1);
        return X1 > X0 && Y1 > Y0 ? [X0, Y0, X1, Y1] : null;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              EVALUATION LOOP
    //--------------------------------------------------------------------------------------------------------------------

    // Run every invalidated pass. Returns true when the visible landform changed.
    Evaluate(Document)
    {
        if (!this.Configure(Document)) return false;
        if (!this.FoundationInvalid && !this.StackInvalid && !this.TunnelsInvalid && !this.VolumeLayersInvalid) return false;
        const SubmissionStart = performance.now();
        const Query = this.BeginTimer();
        if (this.FoundationInvalid)
        {
            const Start = performance.now();
            this.EvaluateFoundation(Document);
            this.Timings.Foundation = performance.now() - Start;
        }
        if (this.StackInvalid)
        {
            const Start = performance.now();
            this.EvaluateStack(Document, false);
            this.Timings.Stack = performance.now() - Start;
        }
        if (this.TunnelsInvalid)
        {
            const Start = performance.now();
            this.EvaluateTunnels(Document);
            this.Timings.Tunnels = performance.now() - Start;
        }
        if (this.VolumeLayersInvalid)
        {
            const Start = performance.now();
            this.EvaluateVolumeLayers(Document, null, null);
            this.Timings.VolumeLayers = performance.now() - Start;
        }
        this.EndTimer(Query, "Evaluate");
        this.Timings.Submission = performance.now() - SubmissionStart;
        this.Revision++;
        return true;
    }

    // ① shape mask (stencil polygon fill + capsule strokes) ② jump flood ③ signed coast distance ④ foundation height.
    EvaluateFoundation(Document)
    {
        const Context = this.Context;
        const Work = this.Work;
        const Region = this.Region;
        const Texel = this.Lattice.HeightTexel;
        const Domain = [Region.MinimumX - Work.Padding * Texel, Region.MinimumZ - Work.Padding * Texel, Work.DomainWidth * Texel, Work.DomainDepth * Texel];
        Context.bindFramebuffer(Context.FRAMEBUFFER, Work.Mask.Framebuffer);
        Context.viewport(0, 0, Work.DomainWidth, Work.DomainDepth);
        Context.clearColor(0, 0, 0, 0);
        Context.clearStencil(0);
        Context.clear(Context.COLOR_BUFFER_BIT | Context.STENCIL_BUFFER_BIT);
        for (const Shape of Document.Shapes)
        {
            if (!Shape.VisibilityEnabled || Shape.Points.length === 0) continue;
            const Coverage = Shape.Operation === "Subtract" ? 0 : 1;
            if (Shape.Category === "Stroke")
            {
                const Radius = Shape.Width * 0.5;
                const Points = Shape.Points.length === 1 ? [Shape.Points[0], Shape.Points[0]] : Shape.Points;
                const Floats = [];
                for (let SegmentIndex = 0; SegmentIndex < Points.length - 1; SegmentIndex++)
                {
                    const A = Points[SegmentIndex];
                    const B = Points[SegmentIndex + 1];
                    let DirectionX = B.X - A.X, DirectionZ = B.Z - A.Z;
                    const Length = Math.hypot(DirectionX, DirectionZ) || 1;
                    DirectionX /= Length; DirectionZ /= Length;
                    const LateralX = -DirectionZ * Radius, LateralZ = DirectionX * Radius;
                    const Corners = [
                        [A.X - DirectionX * Radius - LateralX, A.Z - DirectionZ * Radius - LateralZ],
                        [A.X - DirectionX * Radius + LateralX, A.Z - DirectionZ * Radius + LateralZ],
                        [B.X + DirectionX * Radius + LateralX, B.Z + DirectionZ * Radius + LateralZ],
                        [B.X + DirectionX * Radius - LateralX, B.Z + DirectionZ * Radius - LateralZ],
                    ];
                    for (const CornerIndex of [0, 1, 2, 0, 2, 3]) Floats.push(Corners[CornerIndex][0], Corners[CornerIndex][1], A.X, A.Z, B.X, B.Z);
                }
                this.StrokeGeometry.Upload(new Float32Array(Floats));
                this.Programs.ShapeStroke.Activate().Vector4("DomainRect", ...Domain).Float("Radius", Radius).Float("Coverage", Coverage);
                Context.bindVertexArray(this.StrokeGeometry.VertexArray);
                Context.drawArrays(Context.TRIANGLES, 0, this.StrokeGeometry.VertexCount);
                continue;
            }
            if (Shape.Points.length < 3) continue;
            // 📝 Even-odd stencil fill handles concave and self-intersecting freehand outlines without triangulation.
            const Fan = new Float32Array(Shape.Points.length * 2);
            Shape.Points.forEach((Point, Index) => { Fan[Index * 2] = Point.X; Fan[Index * 2 + 1] = Point.Z; });
            const Extent = EvaluateExtent(Shape.Points, 1);
            this.Programs.ShapeFill.Activate().Vector4("DomainRect", ...Domain).Float("Coverage", Coverage);
            Context.enable(Context.STENCIL_TEST);
            Context.colorMask(false, false, false, false);
            Context.stencilFunc(Context.ALWAYS, 0, 0xff);
            Context.stencilOp(Context.KEEP, Context.KEEP, Context.INVERT);
            this.FillGeometry.Upload(Fan);
            Context.bindVertexArray(this.FillGeometry.VertexArray);
            Context.drawArrays(Context.TRIANGLE_FAN, 0, Shape.Points.length);
            Context.colorMask(true, true, true, true);
            Context.stencilFunc(Context.NOTEQUAL, 0, 0xff);
            Context.stencilOp(Context.ZERO, Context.ZERO, Context.ZERO);
            this.FillGeometry.Upload(new Float32Array([
                Extent.MinimumX, Extent.MinimumZ, Extent.MaximumX, Extent.MinimumZ, Extent.MaximumX, Extent.MaximumZ,
                Extent.MinimumX, Extent.MinimumZ, Extent.MaximumX, Extent.MaximumZ, Extent.MinimumX, Extent.MaximumZ]));
            Context.drawArrays(Context.TRIANGLES, 0, 6);
            Context.disable(Context.STENCIL_TEST);
        }
        this.Programs.SeedInitialization.Activate().Texture("MaskTexture", Work.Mask.Texture);
        this.RasterizeCoverage(Work.Seeds[0]);
        let SeedIndex = 0;
        const JumpSequence = [];
        for (let Jump = NextPowerOfTwo(Math.max(Work.DomainWidth, Work.DomainDepth)) / 2; Jump >= 1; Jump /= 2) JumpSequence.push(Jump);
        JumpSequence.push(1);
        for (const Jump of JumpSequence)
        {
            this.Programs.SeedJump.Activate().Texture("SeedTexture", Work.Seeds[SeedIndex].Texture).Integer("JumpDistance", Jump);
            this.RasterizeCoverage(Work.Seeds[1 - SeedIndex]);
            SeedIndex = 1 - SeedIndex;
        }
        this.Programs.CoastDistance.Activate().Texture("MaskTexture", Work.Mask.Texture).Texture("SeedTexture", Work.Seeds[SeedIndex].Texture).Float("DomainTexel", Texel);
        this.RasterizeCoverage(Work.Coast);
        const Landform = Document.Landform;
        this.Programs.Foundation.Activate()
            .Texture("CoastTexture", Work.Coast.Texture)
            .Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ)
            .Vector4("DomainRect", ...Domain)
            .Vector2("TargetSize", Work.Width, Work.Depth)
            .Float("SeaFloorHeight", Landform.SeaFloorHeight)
            .Float("ShoreHeight", Landform.ShoreHeight)
            .Float("ShelfWidth", Landform.ShelfWidth)
            .Float("CoastFalloff", Landform.CoastFalloff)
            .Integer("FalloffProfile", Math.max(0, FalloffProfiles.indexOf(Landform.FalloffProfile)))
            .Float("PlateauHeight", Landform.PlateauHeight)
            .Float("ReliefAmplitude", Landform.ReliefAmplitude)
            .Float("ReliefScale", Landform.ReliefScale)
            .Float("RidgeBlend", Landform.RidgeBlend)
            .Float("CoastNoiseAmplitude", Landform.CoastNoiseAmplitude)
            .Float("CoastNoiseScale", Landform.CoastNoiseScale)
            .Float("Seed", Landform.Seed);
        this.RasterizeCoverage(Work.Foundation);
        this.FoundationInvalid = false;
    }

    // 📝 The ordered stack. FromCheckpoint resumes at the checkpoint layer (the layer being sculpted) so a brush dab
    //    re-evaluates only that layer and everything above it — layers below are never touched during a stroke.
    EvaluateStack(Document, FromCheckpoint)
    {
        const Work = this.Work;
        const Layers = Document.Layers.filter((Layer) => Layer.VisibilityEnabled);
        let StartIndex = 0;
        let Current = 0;
        const Resume = FromCheckpoint && this.CheckpointValid ? Layers.findIndex((Layer) => Layer.Token === this.CheckpointLayerToken) : -1;
        if (Resume >= 0)
        {
            StartIndex = Resume;
            this.CopySurface(Work.Checkpoint, Work.Heights[0]);
        }
        else
        {
            this.CopySurface(Work.Foundation, Work.Heights[0]);
            this.CheckpointValid = false;
        }
        const Store = this.ResolveRegionStore(this.Region);
        let ProfiledTunnels = 0;
        for (let LayerIndex = StartIndex; LayerIndex < Layers.length; LayerIndex++)
        {
            const Layer = Layers[LayerIndex];
            if (Layer.Token === this.CheckpointLayerToken && !(Resume >= 0 && LayerIndex === StartIndex))
            {
                this.CopySurface(Work.Heights[Current], Work.Checkpoint);
                this.CheckpointValid = true;
            }
            if (Layer.Category === "HeightSculpt")
            {
                const Displacement = Store.SculptTargets.get(Layer.Token);
                if (!Displacement) continue;
                this.Programs.LayerAccumulate.Activate()
                    .Texture("InputHeightTexture", Work.Heights[Current].Texture)
                    .Texture("DisplacementTexture", Displacement.Texture)
                    .Float("Opacity", Layer.Opacity);
                this.RasterizeCoverage(Work.Heights[1 - Current]);
                Current = 1 - Current;
            }
            else if (Layer.Category === "Spline")
            {
                for (const Spline of Layer.Splines)
                {
                    if (!Spline.VisibilityEnabled || Spline.Points.length < 2) continue;
                    const SplineStore = this.PrepareSpline(Spline);
                    this.EvaluateProfile(Spline, SplineStore, Work.Heights[Current]);
                    if (Spline.Category === "Tunnel") { ProfiledTunnels++; continue; }
                    if (this.ApplySpline(Spline, SplineStore, Layer.Opacity, Work.Heights[Current], Work.Heights[1 - Current])) Current = 1 - Current;
                }
            }
        }
        this.CurrentHeightIndex = Current;
        this.StackInvalid = false;
        // 📝 A partial (checkpoint) run only re-profiles tunnels above the sculpted layer; rebuild bores only then.
        if (ProfiledTunnels > 0 || (Resume < 0 && this.TunnelCount > 0)) this.TunnelsInvalid = true;
    }

    // Centerline samples and per-spline GPU storage are rebuilt only when the control points change.
    PrepareSpline(Spline)
    {
        const Context = this.Context;
        if (!this.SplineStores.has(Spline.Token))
        {
            this.SplineStores.set(Spline.Token, {
                Signature: "",
                CenterlineTexture: ConstructLineTexture(Context, CenterlineSampleCeiling),
                ProfileTarget: ConstructSurfaceTarget(Context, CenterlineSampleCeiling, 1, "R32F"),
                Samples: [],
                Spacing: 1,
                Revision: 0,
            });
        }
        const Store = this.SplineStores.get(Spline.Token);
        const Spacing = Math.max(this.Lattice.HeightTexel, 1.5);
        const Signature = JSON.stringify(Spline.Points) + "|" + Spacing;
        if (Signature !== Store.Signature)
        {
            const Samples = SampleCenterline(Spline.Points, Spacing);
            const Floats = new Float32Array(Samples.length * 4);
            Samples.forEach((Sample, Index) => Floats.set([Sample.X, Sample.Z, Sample.Height, Sample.Arc], Index * 4));
            Context.bindTexture(Context.TEXTURE_2D, Store.CenterlineTexture);
            Context.texSubImage2D(Context.TEXTURE_2D, 0, 0, 0, Samples.length, 1, Context.RGBA, Context.FLOAT, Floats);
            Store.Samples = Samples;
            Store.Spacing = Samples.length > 1 ? Samples[Samples.length - 1].Arc / (Samples.length - 1) : Spacing;
            Store.Signature = Signature;
            Store.Extent = EvaluateExtent(Samples);
            Store.Revision++;
        }
        return Store;
    }

    // Profile = centerline height per sample: terrain-following (smoothed, optionally monotonic), graded or manual.
    EvaluateProfile(Spline, Store, HeightTarget)
    {
        const Count = Store.Samples.length;
        const Temporaries = this.ProfileTemporaries;
        const Region = this.Region;
        const ModeIndex = Math.max(0, ProfileModes.indexOf(Spline.ProfileMode));
        this.Programs.ProfileSample.Activate()
            .Texture("HeightTexture", HeightTarget.Texture)
            .Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ)
            .Texture("CenterlineTexture", Store.CenterlineTexture)
            .Integer("ProfileMode", ModeIndex)
            .Integer("SampleCount", Count);
        this.RasterizeCoverage(Temporaries[0], Count, 1);
        let Source = 0;
        if (ModeIndex === 0 && Spline.Smoothing > 0)
        {
            this.Programs.ProfileSmooth.Activate()
                .Texture("ProfileTexture", Temporaries[Source].Texture)
                .Integer("SampleCount", Count)
                .Float("SmoothingSamples", Spline.Smoothing / Math.max(Store.Spacing, 0.01));
            this.RasterizeCoverage(Temporaries[1 - Source], Count, 1);
            Source = 1 - Source;
        }
        if (ModeIndex === 0 && Spline.DescentEnabled)
        {
            for (let Stride = 1; Stride < Count; Stride *= 2)
            {
                this.Programs.ProfileDescent.Activate().Texture("ProfileTexture", Temporaries[Source].Texture).Integer("Stride", Stride);
                this.RasterizeCoverage(Temporaries[1 - Source], Count, 1);
                Source = 1 - Source;
            }
        }
        this.CopySurface(Temporaries[Source], Store.ProfileTarget, Count, 1);
    }

    // Spline distance field (depth-tested segment quads) then the category operation, both clipped to the reach.
    ApplySpline(Spline, Store, Opacity, Input, Output)
    {
        const Context = this.Context;
        const Work = this.Work;
        const Region = this.Region;
        const HalfWidth = Spline.Width * 0.5;
        const Reach = HalfWidth + Spline.Falloff + Math.abs(Spline.Roughness) + this.Lattice.HeightTexel * 2;
        const Extent = Store.Extent;
        const Rect = this.ResolveTexelRect({ MinimumX: Extent.MinimumX - Reach, MinimumZ: Extent.MinimumZ - Reach, MaximumX: Extent.MaximumX + Reach, MaximumZ: Extent.MaximumZ + Reach });
        if (!Rect) return false;
        const Samples = Store.Samples;
        const Floats = new Float32Array((Samples.length - 1) * 6 * 8);
        let Cursor = 0;
        for (let SampleIndex = 0; SampleIndex < Samples.length - 1; SampleIndex++)
        {
            const A = Samples[SampleIndex];
            const B = Samples[SampleIndex + 1];
            let DirectionX = B.X - A.X, DirectionZ = B.Z - A.Z;
            const Length = Math.hypot(DirectionX, DirectionZ) || 1;
            DirectionX /= Length; DirectionZ /= Length;
            const LateralX = -DirectionZ * Reach, LateralZ = DirectionX * Reach;
            const Corners = [
                [A.X - DirectionX * Reach - LateralX, A.Z - DirectionZ * Reach - LateralZ],
                [A.X - DirectionX * Reach + LateralX, A.Z - DirectionZ * Reach + LateralZ],
                [B.X + DirectionX * Reach + LateralX, B.Z + DirectionZ * Reach + LateralZ],
                [B.X + DirectionX * Reach - LateralX, B.Z + DirectionZ * Reach - LateralZ],
            ];
            for (const CornerIndex of [0, 1, 2, 0, 2, 3])
            {
                Floats[Cursor++] = Corners[CornerIndex][0]; Floats[Cursor++] = Corners[CornerIndex][1];
                Floats[Cursor++] = A.X; Floats[Cursor++] = A.Z; Floats[Cursor++] = B.X; Floats[Cursor++] = B.Z;
                Floats[Cursor++] = SampleIndex; Floats[Cursor++] = SampleIndex + 1;
            }
        }
        this.SplineGeometry.Upload(Floats);
        Context.bindFramebuffer(Context.FRAMEBUFFER, Work.Field.Framebuffer);
        Context.viewport(0, 0, Work.Width, Work.Depth);
        Context.enable(Context.SCISSOR_TEST);
        Context.scissor(Rect[0], Rect[1], Rect[2] - Rect[0], Rect[3] - Rect[1]);
        Context.clearBufferfv(Context.COLOR, 0, [0, 0, 0, 0]);
        Context.clearDepth(1);
        Context.clear(Context.DEPTH_BUFFER_BIT);
        Context.enable(Context.DEPTH_TEST);
        Context.depthFunc(Context.LESS);
        this.Programs.SplineField.Activate().Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ).Float("Reach", Reach);
        Context.bindVertexArray(this.SplineGeometry.VertexArray);
        Context.drawArrays(Context.TRIANGLES, 0, this.SplineGeometry.VertexCount);
        Context.disable(Context.DEPTH_TEST);
        Context.disable(Context.SCISSOR_TEST);
        this.BlitSurface(Input, Output);
        Context.enable(Context.SCISSOR_TEST);
        this.Programs.SplineOperation.Activate()
            .Texture("InputHeightTexture", Input.Texture)
            .Texture("FieldTexture", Work.Field.Texture)
            .Texture("ProfileTexture", Store.ProfileTarget.Texture)
            .Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ)
            .Vector2("TargetSize", Work.Width, Work.Depth)
            .Integer("Category", SplineCategoryIndex[Spline.Category])
            .Integer("ProfileMode", Math.max(0, ProfileModes.indexOf(Spline.ProfileMode)))
            .Integer("SampleCount", Samples.length)
            .Float("HalfWidth", HalfWidth)
            .Float("Falloff", Spline.Falloff)
            .Float("Depth", Spline.Depth)
            .Float("Roughness", Spline.Roughness)
            .Float("StrataInterval", Spline.StrataInterval)
            .Float("Offset", Spline.Offset)
            .Float("Opacity", Opacity);
        this.RasterizeCoverage(Output);
        Context.disable(Context.SCISSOR_TEST);
        return true;
    }

    // Rebuild the tunnel channel (R) of the composite volume from every visible tunnel's centerline + profile.
    EvaluateTunnels(Document)
    {
        const Context = this.Context;
        const Volume = this.Work.Volume;
        const Region = this.Region;
        const Clearance = this.Clearance;
        const VoxelHeight = (Region.MaximumHeight - Region.MinimumHeight) / Volume.Depth;
        Context.colorMask(true, false, false, false);
        for (const Framebuffer of Volume.SliceFramebuffers)
        {
            Context.bindFramebuffer(Context.FRAMEBUFFER, Framebuffer);
            Context.clearBufferfv(Context.COLOR, 0, [Clearance, Clearance, Clearance, Clearance]);
        }
        let TunnelCount = 0;
        Context.enable(Context.BLEND);
        Context.blendEquation(Context.MIN);
        for (const Layer of Document.Layers)
        {
            if (!Layer.VisibilityEnabled || Layer.Category !== "Spline") continue;
            for (const Spline of Layer.Splines)
            {
                if (Spline.Category !== "Tunnel" || !Spline.VisibilityEnabled || Spline.Points.length < 2) continue;
                const Store = this.SplineStores.get(Spline.Token);
                if (!Store || Store.Samples.length < 2) continue;
                TunnelCount++;
                const Floats = new Float32Array((Store.Samples.length - 1) * 6 * 4);
                let Cursor = 0;
                for (let SampleIndex = 0; SampleIndex < Store.Samples.length - 1; SampleIndex++)
                {
                    for (const [Along, Lateral] of [[-1, -1], [-1, 1], [1, 1], [-1, -1], [1, 1], [1, -1]])
                    {
                        Floats[Cursor++] = Along; Floats[Cursor++] = Lateral; Floats[Cursor++] = SampleIndex; Floats[Cursor++] = SampleIndex + 1;
                    }
                }
                this.TunnelGeometry.Upload(Floats);
                const Program = this.Programs.Tunnel.Activate()
                    .Texture("CenterlineTexture", Store.CenterlineTexture)
                    .Texture("ProfileTexture", Store.ProfileTarget.Texture)
                    .Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ)
                    .Float("Clearance", Clearance)
                    .Float("HalfWidth", Spline.Width * 0.5)
                    .Float("BoreHeight", Spline.Depth)
                    .Float("Offset", Spline.Offset);
                Context.bindVertexArray(this.TunnelGeometry.VertexArray);
                for (let SliceIndex = 0; SliceIndex < Volume.Depth; SliceIndex++)
                {
                    Context.bindFramebuffer(Context.FRAMEBUFFER, Volume.SliceFramebuffers[SliceIndex]);
                    Context.viewport(0, 0, Volume.Width, Volume.Height);
                    Program.Float("SliceHeight", Region.MinimumHeight + (SliceIndex + 0.5) * VoxelHeight);
                    Context.drawArrays(Context.TRIANGLES, 0, this.TunnelGeometry.VertexCount);
                }
            }
        }
        Context.disable(Context.BLEND);
        Context.blendEquation(Context.FUNC_ADD);
        Context.colorMask(true, true, true, true);
        this.TunnelCount = TunnelCount;
        this.TunnelsInvalid = false;
    }

    // Rebuild carve (G) and addition (B) channels: per-voxel minimum over visible volume sculpt layers.
    EvaluateVolumeLayers(Document, SliceRange, Rect)
    {
        const Context = this.Context;
        const Volume = this.Work.Volume;
        const Clearance = this.Clearance;
        const Store = this.ResolveRegionStore(this.Region);
        const Targets = Document.Layers
            .filter((Layer) => Layer.Category === "VolumeSculpt" && Layer.VisibilityEnabled && Store.VolumeTargets.has(Layer.Token))
            .map((Layer) => ({ Target: Store.VolumeTargets.get(Layer.Token), Addition: Store.AdditionLayers.has(Layer.Token) }));
        const [FirstSlice, LastSlice] = SliceRange ?? [0, Volume.Depth - 1];
        Context.colorMask(false, true, true, false);
        if (Rect)
        {
            Context.enable(Context.SCISSOR_TEST);
            Context.scissor(Rect[0], Rect[1], Rect[2] - Rect[0], Rect[3] - Rect[1]);
        }
        const Program = this.Programs.VolumeLayerMinimum.Activate().Float("Clearance", Clearance);
        for (let SliceIndex = FirstSlice; SliceIndex <= LastSlice; SliceIndex++)
        {
            Context.bindFramebuffer(Context.FRAMEBUFFER, Volume.SliceFramebuffers[SliceIndex]);
            Context.viewport(0, 0, Volume.Width, Volume.Height);
            Context.clearBufferfv(Context.COLOR, 0, [Clearance, Clearance, Clearance, Clearance]);
            if (Targets.length === 0) continue;
            Context.enable(Context.BLEND);
            Context.blendEquation(Context.MIN);
            Program.Integer("SliceIndex", SliceIndex);
            for (const { Target } of Targets)
            {
                Program.Texture("LayerTexture", Target.Texture, Context.TEXTURE_3D);
                Context.bindVertexArray(this.CoverageTriangle);
                Context.drawArrays(Context.TRIANGLES, 0, 3);
                Program.Activate().Float("Clearance", Clearance).Integer("SliceIndex", SliceIndex);
            }
            Context.disable(Context.BLEND);
            Context.blendEquation(Context.FUNC_ADD);
        }
        Context.disable(Context.SCISSOR_TEST);
        Context.colorMask(true, true, true, true);
        this.VolumeLayerCount = Targets.length;
        this.AdditionActive = Targets.some((Entry) => Entry.Addition);
        if (!SliceRange) this.VolumeLayersInvalid = false;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 BRUSHES
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 A batch of height-brush dabs (one frame of stroke input) on a displacement layer, followed by ONE partial
    //    stack re-evaluation from that layer upward. Each dab reads the previous dab's result (blit-back per dab).
    ApplyHeightBrush(Document, LayerToken, Brush, Centres)
    {
        if (!this.Configure(Document) || Centres.length === 0) return;
        const Start = performance.now();
        const Query = this.BeginTimer();
        if (this.FoundationInvalid) this.EvaluateFoundation(Document);
        if (this.CheckpointLayerToken !== LayerToken || !this.CheckpointValid || this.StackInvalid)
        {
            this.CheckpointLayerToken = LayerToken;
            this.EvaluateStack(Document, false);
        }
        const Context = this.Context;
        const Work = this.Work;
        const Region = this.Region;
        const Target = this.EnsureSculptTarget(LayerToken);
        const Program = this.Programs.HeightBrush;
        for (const Centre of Centres)
        {
            const Rect = this.ResolveTexelRect({ MinimumX: Centre.X - Brush.Radius, MinimumZ: Centre.Z - Brush.Radius, MaximumX: Centre.X + Brush.Radius, MaximumZ: Centre.Z + Brush.Radius });
            if (!Rect) continue;
            Context.enable(Context.SCISSOR_TEST);
            Context.scissor(Rect[0], Rect[1], Rect[2] - Rect[0], Rect[3] - Rect[1]);
            Program.Activate()
                .Texture("DisplacementTexture", Target.Texture)
                .Texture("InputHeightTexture", Work.Checkpoint.Texture)
                .Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ)
                .Vector2("TargetSize", Work.Width, Work.Depth)
                .Vector2("BrushCentre", Centre.X, Centre.Z)
                .Float("BrushRadius", Brush.Radius)
                .Float("BrushHardness", Brush.Hardness)
                .Float("BrushAmount", Brush.Amount)
                .Float("BrushBlend", Brush.Blend)
                .Integer("BrushMode", Brush.Mode)
                .Float("FlattenHeight", Brush.FlattenHeight)
                .Float("TerraceInterval", Math.max(Brush.TerraceInterval, 0.5))
                .Float("NoiseScale", Brush.Radius * 0.35);
            this.RasterizeCoverage(Work.Scratch);
            Context.disable(Context.SCISSOR_TEST);
            this.BlitSurface(Work.Scratch, Target, Rect);
        }
        this.EvaluateStack(Document, true);
        if (this.TunnelsInvalid) this.EvaluateTunnels(Document);
        this.EndTimer(Query, "Brush");
        this.Timings.Brush = performance.now() - Start;
        this.Timings.BrushDabs = Centres.length;
        this.Revision++;
    }

    // A batch of volumetric dabs (add / carve / restore) into a volume layer, then one scissored composite refresh.
    ApplyVolumeBrush(Document, LayerToken, Brush, Centres)
    {
        if (!this.Configure(Document) || Centres.length === 0) return;
        if (this.FoundationInvalid || this.StackInvalid || this.TunnelsInvalid || this.VolumeLayersInvalid) this.Evaluate(Document);
        const Start = performance.now();
        const Query = this.BeginTimer();
        const Context = this.Context;
        const Region = this.Region;
        const Target = this.EnsureVolumeTarget(LayerToken);
        const Scratch = this.Work.VolumeScratch;
        const Clearance = this.Clearance;
        const VoxelX = Region.SizeX / Target.Width;
        const VoxelZ = Region.SizeZ / Target.Height;
        const VoxelY = (Region.MaximumHeight - Region.MinimumHeight) / Target.Depth;
        const Margin = Brush.Radius * (1 + Brush.Roughness * 0.4) + Clearance;
        if (Brush.Mode === 0) this.ResolveRegionStore(Region).AdditionLayers.add(LayerToken);
        const Union = { FirstSlice: Infinity, LastSlice: -Infinity, X0: Infinity, Y0: Infinity, X1: -Infinity, Y1: -Infinity };
        for (const Centre of Centres)
        {
            const FirstSlice = Math.max(0, Math.floor((Centre.Y - Margin - Region.MinimumHeight) / VoxelY));
            const LastSlice = Math.min(Target.Depth - 1, Math.ceil((Centre.Y + Margin - Region.MinimumHeight) / VoxelY));
            const X0 = Math.max(0, Math.floor((Centre.X - Margin - Region.MinimumX) / VoxelX));
            const Y0 = Math.max(0, Math.floor((Centre.Z - Margin - Region.MinimumZ) / VoxelZ));
            const X1 = Math.min(Target.Width, Math.ceil((Centre.X + Margin - Region.MinimumX) / VoxelX));
            const Y1 = Math.min(Target.Height, Math.ceil((Centre.Z + Margin - Region.MinimumZ) / VoxelZ));
            if (LastSlice < FirstSlice || X1 <= X0 || Y1 <= Y0) continue;
            Union.FirstSlice = Math.min(Union.FirstSlice, FirstSlice); Union.LastSlice = Math.max(Union.LastSlice, LastSlice);
            Union.X0 = Math.min(Union.X0, X0); Union.Y0 = Math.min(Union.Y0, Y0); Union.X1 = Math.max(Union.X1, X1); Union.Y1 = Math.max(Union.Y1, Y1);
            Context.enable(Context.SCISSOR_TEST);
            Context.scissor(X0, Y0, X1 - X0, Y1 - Y0);
            for (let SliceIndex = FirstSlice; SliceIndex <= LastSlice; SliceIndex++)
            {
                this.Programs.VolumeBrush.Activate()
                    .Texture("LayerTexture", Target.Texture, Context.TEXTURE_3D)
                    .Integer("SliceIndex", SliceIndex)
                    .Vector3("VolumeMinimum", Region.MinimumX, Region.MinimumHeight, Region.MinimumZ)
                    .Vector3("VolumeSize", Region.SizeX, Region.MaximumHeight - Region.MinimumHeight, Region.SizeZ)
                    .Vector3("VolumeDimensions", Target.Width, Target.Height, Target.Depth)
                    .Vector3("BrushCentre", Centre.X, Centre.Y, Centre.Z)
                    .Float("BrushRadius", Brush.Radius)
                    .Float("BrushBlend", Brush.Blend)
                    .Float("BrushRoughness", Brush.Roughness)
                    .Integer("BrushMode", Brush.Mode)
                    .Float("Clearance", Clearance);
                this.RasterizeCoverageSlice(Scratch, SliceIndex);
            }
            for (let SliceIndex = FirstSlice; SliceIndex <= LastSlice; SliceIndex++)
            {
                this.Programs.VolumeCopy.Activate().Texture("SourceTexture", Scratch.Texture, Context.TEXTURE_3D).Integer("SliceIndex", SliceIndex);
                this.RasterizeCoverageSlice(Target, SliceIndex);
            }
            Context.disable(Context.SCISSOR_TEST);
        }
        if (Union.LastSlice >= Union.FirstSlice)
        {
            this.EvaluateVolumeLayers(Document, [Union.FirstSlice, Union.LastSlice], [Union.X0, Union.Y0, Union.X1, Union.Y1]);
        }
        this.EndTimer(Query, "Brush");
        this.Timings.Brush = performance.now() - Start;
        this.Timings.BrushDabs = Centres.length;
        this.Revision++;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                             UNDO SNAPSHOTS
    //--------------------------------------------------------------------------------------------------------------------

    // GPU-side copy of a sculpt layer before a stroke; restoring swaps the copy in (so undo and redo are both swaps).
    CaptureLayerSnapshot(Category, LayerToken)
    {
        const Context = this.Context;
        const Store = this.ResolveRegionStore(this.Region);
        if (Category === "HeightSculpt")
        {
            const Source = this.EnsureSculptTarget(LayerToken);
            const Copy = ConstructSurfaceTarget(Context, Source.Width, Source.Height, "R32F");
            this.BlitSurface(Source, Copy);
            return { Category, RegionToken: this.Region.Token, LayerToken, Target: Copy, AdditionUsed: false };
        }
        const Source = this.EnsureVolumeTarget(LayerToken);
        const Copy = ConstructVolumeTarget(Context, Source.Width, Source.Height, Source.Depth, "RG16F");
        for (let SliceIndex = 0; SliceIndex < Source.Depth; SliceIndex++)
        {
            this.Programs.VolumeCopy.Activate().Texture("SourceTexture", Source.Texture, Context.TEXTURE_3D).Integer("SliceIndex", SliceIndex);
            this.RasterizeCoverageSlice(Copy, SliceIndex);
        }
        return { Category, RegionToken: this.Region.Token, LayerToken, Target: Copy, AdditionUsed: Store.AdditionLayers.has(LayerToken) };
    }

    SwapLayerSnapshot(Snapshot)
    {
        const Store = this.RegionStores.get(Snapshot.RegionToken);
        if (!Store) return;
        const Map = Snapshot.Category === "HeightSculpt" ? Store.SculptTargets : Store.VolumeTargets;
        const Current = Map.get(Snapshot.LayerToken);
        if (!Current || Current.Width !== Snapshot.Target.Width || Current.Height !== Snapshot.Target.Height) return;
        Map.set(Snapshot.LayerToken, Snapshot.Target);
        Snapshot.Target = Current;
        if (Snapshot.Category === "VolumeSculpt")
        {
            const AdditionUsed = Store.AdditionLayers.has(Snapshot.LayerToken);
            if (Snapshot.AdditionUsed) Store.AdditionLayers.add(Snapshot.LayerToken); else Store.AdditionLayers.delete(Snapshot.LayerToken);
            Snapshot.AdditionUsed = AdditionUsed;
            this.VolumeLayersInvalid = true;
        }
        else
        {
            this.StackInvalid = true;
            this.CheckpointValid = false;
        }
    }

    ReleaseSnapshot(Snapshot)
    {
        Snapshot.Target?.Release();
        Snapshot.Target = null;
    }

    ClearLayer(Category, LayerToken)
    {
        const Context = this.Context;
        if (Category === "HeightSculpt")
        {
            const Target = this.EnsureSculptTarget(LayerToken);
            Context.bindFramebuffer(Context.FRAMEBUFFER, Target.Framebuffer);
            Context.clearBufferfv(Context.COLOR, 0, [0, 0, 0, 0]);
            this.StackInvalid = true;
            this.CheckpointValid = false;
            return;
        }
        const Target = this.EnsureVolumeTarget(LayerToken);
        const Clearance = this.Clearance;
        for (const Framebuffer of Target.SliceFramebuffers)
        {
            Context.bindFramebuffer(Context.FRAMEBUFFER, Framebuffer);
            Context.clearBufferfv(Context.COLOR, 0, [Clearance, Clearance, Clearance, Clearance]);
        }
        this.ResolveRegionStore(this.Region).AdditionLayers.delete(LayerToken);
        this.VolumeLayersInvalid = true;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                          READBACK + PERSISTENCE
    //--------------------------------------------------------------------------------------------------------------------

    // RGBA8 hillshade of the evaluated region for the planar workspace (one readback, issued only after changes).
    ExtractHillshade(WaterLevel)
    {
        if (!this.Work || !this.Region) return null;
        const Context = this.Context;
        const Target = this.Work.Hillshade;
        const Region = this.Region;
        this.Programs.Hillshade.Activate()
            .Texture("HeightTexture", this.HeightTarget.Texture)
            .Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ)
            .Vector2("TargetSize", Target.Width, Target.Height)
            .Float("WaterLevel", WaterLevel);
        this.RasterizeCoverage(Target);
        const Pixels = new Uint8ClampedArray(Target.Width * Target.Height * 4);
        Context.bindFramebuffer(Context.FRAMEBUFFER, Target.Framebuffer);
        Context.readPixels(0, 0, Target.Width, Target.Height, Context.RGBA, Context.UNSIGNED_BYTE, Pixels);
        Context.bindFramebuffer(Context.FRAMEBUFFER, null);
        return { Width: Target.Width, Height: Target.Height, Pixels, RegionToken: Region.Token, Rect: [Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ] };
    }

    // Evaluated height at world X/Z points (nearest texel readback; creation-time only, never per frame).
    SampleHeights(Points)
    {
        const Target = this.HeightTarget;
        const Region = this.Region;
        if (!Target || !Region) return Points.map(() => 0);
        const Context = this.Context;
        const Texel = new Float32Array(4);
        Context.bindFramebuffer(Context.FRAMEBUFFER, Target.Framebuffer);
        const Heights = Points.map((Point) =>
        {
            const X = Math.min(Target.Width - 1, Math.max(0, Math.floor((Point.X - Region.MinimumX) / Region.SizeX * Target.Width)));
            const Y = Math.min(Target.Height - 1, Math.max(0, Math.floor((Point.Z - Region.MinimumZ) / Region.SizeZ * Target.Height)));
            Context.readPixels(X, Y, 1, 1, Context.RGBA, Context.FLOAT, Texel);
            return Texel[0];
        });
        Context.bindFramebuffer(Context.FRAMEBUFFER, null);
        return Heights;
    }

    // Read one height texel row-major grid (R channel) from any R32F target — used by validation and export.
    ExtractSurface(Target)
    {
        const Context = this.Context;
        const Rgba = new Float32Array(Target.Width * Target.Height * 4);
        Context.bindFramebuffer(Context.FRAMEBUFFER, Target.Framebuffer);
        Context.readPixels(0, 0, Target.Width, Target.Height, Context.RGBA, Context.FLOAT, Rgba);
        Context.bindFramebuffer(Context.FRAMEBUFFER, null);
        const Single = new Float32Array(Target.Width * Target.Height);
        for (let Index = 0; Index < Single.length; Index++) Single[Index] = Rgba[Index * 4];
        return Single;
    }

    ExtractVolume(Target)
    {
        const Context = this.Context;
        const SliceTexels = Target.Width * Target.Height;
        const Rgba = new Float32Array(SliceTexels * 4);
        const Pairs = new Float32Array(SliceTexels * 2 * Target.Depth);
        for (let SliceIndex = 0; SliceIndex < Target.Depth; SliceIndex++)
        {
            Context.bindFramebuffer(Context.FRAMEBUFFER, Target.SliceFramebuffers[SliceIndex]);
            Context.readPixels(0, 0, Target.Width, Target.Height, Context.RGBA, Context.FLOAT, Rgba);
            for (let Index = 0; Index < SliceTexels; Index++)
            {
                Pairs[(SliceIndex * SliceTexels + Index) * 2] = Rgba[Index * 4];
                Pairs[(SliceIndex * SliceTexels + Index) * 2 + 1] = Rgba[Index * 4 + 1];
            }
        }
        Context.bindFramebuffer(Context.FRAMEBUFFER, null);
        return Pairs;
    }

    // Serialize every persistent sculpt texture (all regions) for project storage.
    ExtractSculptArchive()
    {
        const Archive = [];
        for (const [RegionToken, Store] of this.RegionStores)
        {
            if (!Store.Rect) continue;
            for (const [LayerToken, Target] of Store.SculptTargets)
            {
                Archive.push({ RegionToken, LayerToken, Category: "HeightSculpt", Rect: Store.Rect, Width: Target.Width, Height: Target.Height, Depth: 1, Values: this.ExtractSurface(Target) });
            }
            for (const [LayerToken, Target] of Store.VolumeTargets)
            {
                Archive.push({ RegionToken, LayerToken, Category: "VolumeSculpt", Rect: Store.Rect, Width: Target.Width, Height: Target.Height, Depth: Target.Depth, Values: this.ExtractVolume(Target), AdditionUsed: Store.AdditionLayers.has(LayerToken) });
            }
        }
        return Archive;
    }

    InstallSculptArchive(Document, Archive)
    {
        const Context = this.Context;
        for (const Entry of Archive)
        {
            const Region = Document.Regions.find((Candidate) => Candidate.Token === Entry.RegionToken);
            if (!Region) continue;
            const Store = this.ResolveRegionStore(Region);
            if (Store.Rect && JSON.stringify(Store.Rect) !== JSON.stringify(Entry.Rect)) continue;
            Store.Rect = Entry.Rect;
            Store.Lattice = EvaluateRegionLattice(Region);
            if (Entry.Category === "HeightSculpt")
            {
                const Target = ConstructSurfaceTarget(Context, Entry.Width, Entry.Height, "R32F");
                Context.bindTexture(Context.TEXTURE_2D, Target.Texture);
                Context.texSubImage2D(Context.TEXTURE_2D, 0, 0, 0, Entry.Width, Entry.Height, Context.RED, Context.FLOAT, Entry.Values);
                Store.SculptTargets.get(Entry.LayerToken)?.Release();
                Store.SculptTargets.set(Entry.LayerToken, Target);
            }
            else
            {
                const Target = ConstructVolumeTarget(Context, Entry.Width, Entry.Height, Entry.Depth, "RG16F");
                Context.bindTexture(Context.TEXTURE_3D, Target.Texture);
                Context.texSubImage3D(Context.TEXTURE_3D, 0, 0, 0, 0, Entry.Width, Entry.Height, Entry.Depth, Context.RG, Context.FLOAT, Entry.Values);
                Store.VolumeTargets.get(Entry.LayerToken)?.Release();
                Store.VolumeTargets.set(Entry.LayerToken, Target);
                if (Entry.AdditionUsed) Store.AdditionLayers.add(Entry.LayerToken);
            }
        }
        this.FoundationInvalid = this.StackInvalid = this.TunnelsInvalid = this.VolumeLayersInvalid = true;
        this.CheckpointValid = false;
    }

    // Drop GPU storage of splines no longer present in the document.
    ReclaimSplineStores(Document)
    {
        const Present = new Set(Document.Layers.flatMap((Layer) => Layer.Splines.map((Spline) => Spline.Token)));
        for (const [Token, Store] of this.SplineStores)
        {
            if (Present.has(Token)) continue;
            this.Context.deleteTexture(Store.CenterlineTexture);
            Store.ProfileTarget.Release();
            this.SplineStores.delete(Token);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                               GPU TIMING
    //--------------------------------------------------------------------------------------------------------------------

    BeginTimer()
    {
        const Extension = this.Gpu.TimerQuery;
        if (!Extension || this.PendingQueries.length > 4) return null;
        const Query = this.Context.createQuery();
        this.Context.beginQuery(Extension.TIME_ELAPSED_EXT, Query);
        return Query;
    }

    EndTimer(Query, Label)
    {
        if (!Query) return;
        this.Context.endQuery(this.Gpu.TimerQuery.TIME_ELAPSED_EXT);
        this.PendingQueries.push({ Query, Label });
    }

    // Poll finished timer queries (non-blocking); results land in Timings.GpuMilliseconds.
    CollectTimers()
    {
        const Context = this.Context;
        const Extension = this.Gpu.TimerQuery;
        if (!Extension) return;
        const Disjoint = Context.getParameter(Extension.GPU_DISJOINT_EXT);
        while (this.PendingQueries.length)
        {
            const { Query, Label } = this.PendingQueries[0];
            if (!Context.getQueryParameter(Query, Context.QUERY_RESULT_AVAILABLE)) break;
            const Nanoseconds = Context.getQueryParameter(Query, Context.QUERY_RESULT);
            if (!Disjoint) this.Timings.GpuMilliseconds = { Label, Milliseconds: Nanoseconds / 1e6 };
            Context.deleteQuery(Query);
            this.PendingQueries.shift();
        }
    }
}
