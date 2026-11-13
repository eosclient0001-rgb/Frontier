/*====================================================================================================================================
                                                       TERRAINVIEWPORT.JS
====================================================================================================================================*/
// 🧩 3D landform viewport: direct SDF ray march of the evaluated region (no meshing), orbit camera, picking, overlays

import { CompileProgram, ConstructSurfaceTarget, ConstructCoverageTriangle, ConstructStreamingGeometry } from "./GpuContext.js";
import * as Shaders from "./LandformShaders.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                 MATRIX ALGEBRA
//------------------------------------------------------------------------------------------------------------------------

function MultiplyMatrices(A, B)
{
    const Product = new Float32Array(16);
    for (let Column = 0; Column < 4; Column++)
    {
        for (let Row = 0; Row < 4; Row++)
        {
            let Sum = 0;
            for (let Inner = 0; Inner < 4; Inner++) Sum += A[Inner * 4 + Row] * B[Column * 4 + Inner];
            Product[Column * 4 + Row] = Sum;
        }
    }
    return Product;
}

function ConstructPerspective(FieldOfView, Aspect, Near, Far)
{
    const Focal = 1 / Math.tan(FieldOfView / 2);
    return new Float32Array([Focal / Aspect, 0, 0, 0, 0, Focal, 0, 0, 0, 0, (Far + Near) / (Near - Far), -1, 0, 0, (2 * Far * Near) / (Near - Far), 0]);
}

function ConstructLookAt(Eye, Target, Up)
{
    let ForwardX = Eye[0] - Target[0], ForwardY = Eye[1] - Target[1], ForwardZ = Eye[2] - Target[2];
    let Length = Math.hypot(ForwardX, ForwardY, ForwardZ);
    ForwardX /= Length; ForwardY /= Length; ForwardZ /= Length;
    let RightX = Up[1] * ForwardZ - Up[2] * ForwardY, RightY = Up[2] * ForwardX - Up[0] * ForwardZ, RightZ = Up[0] * ForwardY - Up[1] * ForwardX;
    Length = Math.hypot(RightX, RightY, RightZ);
    RightX /= Length; RightY /= Length; RightZ /= Length;
    const UpX = ForwardY * RightZ - ForwardZ * RightY, UpY = ForwardZ * RightX - ForwardX * RightZ, UpZ = ForwardX * RightY - ForwardY * RightX;
    return new Float32Array([
        RightX, UpX, ForwardX, 0, RightY, UpY, ForwardY, 0, RightZ, UpZ, ForwardZ, 0,
        -(RightX * Eye[0] + RightY * Eye[1] + RightZ * Eye[2]), -(UpX * Eye[0] + UpY * Eye[1] + UpZ * Eye[2]), -(ForwardX * Eye[0] + ForwardY * Eye[1] + ForwardZ * Eye[2]), 1]);
}

function InvertMatrix(M)
{
    const Inverse = new Float32Array(16);
    Inverse[0] = M[5] * M[10] * M[15] - M[5] * M[11] * M[14] - M[9] * M[6] * M[15] + M[9] * M[7] * M[14] + M[13] * M[6] * M[11] - M[13] * M[7] * M[10];
    Inverse[4] = -M[4] * M[10] * M[15] + M[4] * M[11] * M[14] + M[8] * M[6] * M[15] - M[8] * M[7] * M[14] - M[12] * M[6] * M[11] + M[12] * M[7] * M[10];
    Inverse[8] = M[4] * M[9] * M[15] - M[4] * M[11] * M[13] - M[8] * M[5] * M[15] + M[8] * M[7] * M[13] + M[12] * M[5] * M[11] - M[12] * M[7] * M[9];
    Inverse[12] = -M[4] * M[9] * M[14] + M[4] * M[10] * M[13] + M[8] * M[5] * M[14] - M[8] * M[6] * M[13] - M[12] * M[5] * M[10] + M[12] * M[6] * M[9];
    Inverse[1] = -M[1] * M[10] * M[15] + M[1] * M[11] * M[14] + M[9] * M[2] * M[15] - M[9] * M[3] * M[14] - M[13] * M[2] * M[11] + M[13] * M[3] * M[10];
    Inverse[5] = M[0] * M[10] * M[15] - M[0] * M[11] * M[14] - M[8] * M[2] * M[15] + M[8] * M[3] * M[14] + M[12] * M[2] * M[11] - M[12] * M[3] * M[10];
    Inverse[9] = -M[0] * M[9] * M[15] + M[0] * M[11] * M[13] + M[8] * M[1] * M[15] - M[8] * M[3] * M[13] - M[12] * M[1] * M[11] + M[12] * M[3] * M[9];
    Inverse[13] = M[0] * M[9] * M[14] - M[0] * M[10] * M[13] - M[8] * M[1] * M[14] + M[8] * M[2] * M[13] + M[12] * M[1] * M[10] - M[12] * M[2] * M[9];
    Inverse[2] = M[1] * M[6] * M[15] - M[1] * M[7] * M[14] - M[5] * M[2] * M[15] + M[5] * M[3] * M[14] + M[13] * M[2] * M[7] - M[13] * M[3] * M[6];
    Inverse[6] = -M[0] * M[6] * M[15] + M[0] * M[7] * M[14] + M[4] * M[2] * M[15] - M[4] * M[3] * M[14] - M[12] * M[2] * M[7] + M[12] * M[3] * M[6];
    Inverse[10] = M[0] * M[5] * M[15] - M[0] * M[7] * M[13] - M[4] * M[1] * M[15] + M[4] * M[3] * M[13] + M[12] * M[1] * M[7] - M[12] * M[3] * M[5];
    Inverse[14] = -M[0] * M[5] * M[14] + M[0] * M[6] * M[13] + M[4] * M[1] * M[14] - M[4] * M[2] * M[13] - M[12] * M[1] * M[6] + M[12] * M[2] * M[5];
    Inverse[3] = -M[1] * M[6] * M[11] + M[1] * M[7] * M[10] + M[5] * M[2] * M[11] - M[5] * M[3] * M[10] - M[9] * M[2] * M[7] + M[9] * M[3] * M[6];
    Inverse[7] = M[0] * M[6] * M[11] - M[0] * M[7] * M[10] - M[4] * M[2] * M[11] + M[4] * M[3] * M[10] + M[8] * M[2] * M[7] - M[8] * M[3] * M[6];
    Inverse[11] = -M[0] * M[5] * M[11] + M[0] * M[7] * M[9] + M[4] * M[1] * M[11] - M[4] * M[3] * M[9] - M[8] * M[1] * M[7] + M[8] * M[3] * M[5];
    Inverse[15] = M[0] * M[5] * M[10] - M[0] * M[6] * M[9] - M[4] * M[1] * M[10] + M[4] * M[2] * M[9] + M[8] * M[1] * M[6] - M[8] * M[2] * M[5];
    const Determinant = M[0] * Inverse[0] + M[1] * Inverse[4] + M[2] * Inverse[8] + M[3] * Inverse[12];
    for (let Index = 0; Index < 16; Index++) Inverse[Index] /= Determinant;
    return Inverse;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 TERRAIN VIEWPORT
//------------------------------------------------------------------------------------------------------------------------

export class TerrainViewport
{
    constructor(Canvas, Gpu, Evaluation)
    {
        this.Canvas = Canvas;
        this.Gpu = Gpu;
        this.Evaluation = Evaluation;
        const Context = this.Context = Gpu.Context;
        const HeightDefines = Gpu.LinearFloat ? "#define HEIGHT_LINEAR\n" : "";
        const March = Shaders.TerrainMarchFragment.replace("#version 300 es\n", `#version 300 es\n${HeightDefines}`);
        this.MarchProgram = CompileProgram(Context, Shaders.CoverageVertex, March, "TerrainMarch");
        this.PickProgram = CompileProgram(Context, Shaders.CoverageVertex, March.replace("#version 300 es\n", "#version 300 es\n#define PICK\n"), "TerrainPick");
        this.OverlayProgram = CompileProgram(Context, Shaders.OverlayVertex.replace("#version 300 es\n", `#version 300 es\n${HeightDefines}`), Shaders.OverlayFragment, "Overlay");
        this.CoverageTriangle = ConstructCoverageTriangle(Context);
        this.OverlayGeometry = ConstructStreamingGeometry(Context, [[0, 4]]);
        this.PickTarget = ConstructSurfaceTarget(Context, 1, 1, "RGBA32F");
        this.ColourTarget = null;
        this.Camera = { Target: [0, 60, 0], Yaw: 0.75, Pitch: 0.55, Distance: 1500, FieldOfView: 50 * Math.PI / 180 };
        this.Settings = { Lens: 0, ContoursEnabled: false, ShadowsEnabled: true, WaterEnabled: true, ContourInterval: 10, WaterLevel: 0, RenderScale: 0.75, SunAzimuth: 2.3, SunElevation: 0.6 };
        this.Brush = { Visible: false, X: 0, Y: 0, Z: 0, Radius: 30, Volumetric: false };
        this.Overlay = { Document: null, SelectedSplineToken: null, SelectedPointIndex: -1, RegionVisible: true };
        this.Dirty = true;
        this.RenderMilliseconds = 0;
        this.Interacting = false;
    }

    Invalidate() { this.Dirty = true; }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 CAMERA
    //--------------------------------------------------------------------------------------------------------------------

    ResolveEye()
    {
        const Camera = this.Camera;
        return [
            Camera.Target[0] + Math.cos(Camera.Pitch) * Math.sin(Camera.Yaw) * Camera.Distance,
            Camera.Target[1] + Math.sin(Camera.Pitch) * Camera.Distance,
            Camera.Target[2] + Math.cos(Camera.Pitch) * Math.cos(Camera.Yaw) * Camera.Distance,
        ];
    }

    ResolveMatrices(Width, Height)
    {
        const Eye = this.ResolveEye();
        const Projection = ConstructPerspective(this.Camera.FieldOfView, Width / Math.max(Height, 1), Math.max(0.5, this.Camera.Distance * 0.002), this.Camera.Distance * 20 + 20000);
        const View = ConstructLookAt(Eye, this.Camera.Target, [0, 1, 0]);
        const ViewProjection = MultiplyMatrices(Projection, View);
        return { Eye, ViewProjection, InverseViewProjection: InvertMatrix(ViewProjection) };
    }

    Orbit(DeltaX, DeltaY)
    {
        this.Camera.Yaw -= DeltaX * 0.005;
        this.Camera.Pitch = Math.min(1.53, Math.max(-0.2, this.Camera.Pitch + DeltaY * 0.005));
        this.Dirty = true;
    }

    Pan(DeltaX, DeltaY)
    {
        const Camera = this.Camera;
        const Scale = Camera.Distance * Math.tan(Camera.FieldOfView / 2) * 2 / Math.max(this.Canvas.clientHeight, 1);
        const RightX = Math.cos(Camera.Yaw), RightZ = -Math.sin(Camera.Yaw);
        const ForwardX = -Math.sin(Camera.Yaw), ForwardZ = -Math.cos(Camera.Yaw);
        Camera.Target[0] -= (RightX * DeltaX - ForwardX * DeltaY * (1 / Math.max(Math.sin(Camera.Pitch), 0.35))) * Scale;
        Camera.Target[2] -= (RightZ * DeltaX - ForwardZ * DeltaY * (1 / Math.max(Math.sin(Camera.Pitch), 0.35))) * Scale;
        this.Dirty = true;
    }

    Dolly(Factor, Anchor)
    {
        const Camera = this.Camera;
        const Next = Math.min(12000, Math.max(8, Camera.Distance * Factor));
        if (Anchor)
        {
            const Blend = 1 - Next / Camera.Distance;
            for (let Axis = 0; Axis < 3; Axis++) Camera.Target[Axis] += (Anchor[Axis] - Camera.Target[Axis]) * Blend;
        }
        Camera.Distance = Next;
        this.Dirty = true;
    }

    FocusRegion(Region)
    {
        if (!Region) return;
        this.Camera.Target = [Region.MinimumX + Region.SizeX / 2, Math.max(0, Region.MinimumHeight + (Region.MaximumHeight - Region.MinimumHeight) * 0.2), Region.MinimumZ + Region.SizeZ / 2];
        const Aspect = this.Canvas.clientHeight > 0 ? this.Canvas.clientWidth / this.Canvas.clientHeight : 1.6;
        this.Camera.Distance = Math.max(Region.SizeX, Region.SizeZ) * 1.25 / Math.min(1, Aspect) ** 0.85; // 📝 portrait panes need extra distance
        this.Camera.Pitch = 0.62;
        this.Dirty = true;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              MARCH UNIFORMS
    //--------------------------------------------------------------------------------------------------------------------

    ParameterizeMarch(Program, Matrices, Width, Height)
    {
        const Evaluation = this.Evaluation;
        const Region = Evaluation.Region;
        const Settings = this.Settings;
        const Sun = [Math.cos(Settings.SunElevation) * Math.sin(Settings.SunAzimuth), Math.sin(Settings.SunElevation), Math.cos(Settings.SunElevation) * Math.cos(Settings.SunAzimuth)];
        Program.Activate()
            .Texture("HeightTexture", Evaluation.HeightTarget.Texture)
            .Texture("VolumeTexture", Evaluation.VolumeTarget.Texture, this.Context.TEXTURE_3D)
            .Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ)
            .Vector3("RegionMinimum", Region.MinimumX, Region.MinimumHeight, Region.MinimumZ)
            .Vector3("RegionMaximum", Region.MinimumX + Region.SizeX, Region.MaximumHeight, Region.MinimumZ + Region.SizeZ)
            .Matrix4("InverseViewProjection", Matrices.InverseViewProjection)
            .Matrix4("ViewProjection", Matrices.ViewProjection)
            .Vector3("CameraPosition", ...Matrices.Eye)
            .Vector2("ViewportSize", Width, Height)
            .Integer("VolumeEnabled", Evaluation.VolumeActive ? 1 : 0)
            .Integer("AdditionEnabled", Evaluation.AdditionActive ? 1 : 0)
            .Vector3("SunDirection", ...Sun)
            .Integer("Lens", Settings.Lens)
            .Integer("ContoursEnabled", Settings.ContoursEnabled ? 1 : 0)
            .Integer("ShadowsEnabled", Settings.ShadowsEnabled && !this.Interacting ? 1 : 0)
            .Integer("WaterEnabled", Settings.WaterEnabled ? 1 : 0)
            .Float("ContourInterval", Settings.ContourInterval)
            .Float("WaterLevel", Settings.WaterLevel)
            .Float("PixelFootprint", 2 * Math.tan(this.Camera.FieldOfView / 2) / Height)
            .Vector4("Brush", this.Brush.X, this.Brush.Y, this.Brush.Z, this.Brush.Visible ? this.Brush.Radius : 0)
            .Integer("BrushVolumetric", this.Brush.Volumetric ? 1 : 0)
            .Float("LipschitzScale", 0.6);
    }

    // Ray-march one pixel through the evaluated SDF; returns world hit { X, Y, Z, Travel } or null.
    Pick(ClientX, ClientY)
    {
        const Evaluation = this.Evaluation;
        if (!Evaluation.HeightTarget || !Evaluation.Region) return null;
        const Rect = this.Canvas.getBoundingClientRect();
        const Width = Math.max(1, Rect.width);
        const Height = Math.max(1, Rect.height);
        const Context = this.Context;
        const Matrices = this.ResolveMatrices(Width, Height);
        this.ParameterizeMarch(this.PickProgram, Matrices, Width, Height);
        this.PickProgram.Vector2("PickPixel", ClientX - Rect.left, Height - (ClientY - Rect.top));
        Context.bindFramebuffer(Context.FRAMEBUFFER, this.PickTarget.Framebuffer);
        Context.viewport(0, 0, 1, 1);
        Context.disable(Context.DEPTH_TEST);
        Context.bindVertexArray(this.CoverageTriangle);
        Context.drawArrays(Context.TRIANGLES, 0, 3);
        const Texel = new Float32Array(4);
        Context.readPixels(0, 0, 1, 1, Context.RGBA, Context.FLOAT, Texel);
        Context.bindFramebuffer(Context.FRAMEBUFFER, null);
        return Texel[3] < 0 ? null : { X: Texel[0], Y: Texel[1], Z: Texel[2], Travel: Texel[3] };
    }

    // Intersect the camera ray through a client pixel with the horizontal plane Y = PlaneHeight.
    ProjectRayToPlane(ClientX, ClientY, PlaneHeight)
    {
        const Rect = this.Canvas.getBoundingClientRect();
        const Matrices = this.ResolveMatrices(Rect.width, Rect.height);
        const DeviceX = ((ClientX - Rect.left) / Rect.width) * 2 - 1;
        const DeviceY = 1 - ((ClientY - Rect.top) / Rect.height) * 2;
        const M = Matrices.InverseViewProjection;
        const Unproject = (Z) =>
        {
            const W = M[3] * DeviceX + M[7] * DeviceY + M[11] * Z + M[15];
            return [(M[0] * DeviceX + M[4] * DeviceY + M[8] * Z + M[12]) / W, (M[1] * DeviceX + M[5] * DeviceY + M[9] * Z + M[13]) / W, (M[2] * DeviceX + M[6] * DeviceY + M[10] * Z + M[14]) / W];
        };
        const Near = Unproject(-1);
        const Far = Unproject(1);
        const DirectionY = Far[1] - Near[1];
        if (Math.abs(DirectionY) < 1e-6) return null;
        const Travel = (PlaneHeight - Near[1]) / DirectionY;
        if (Travel < 0) return null;
        return { X: Near[0] + (Far[0] - Near[0]) * Travel, Y: PlaneHeight, Z: Near[2] + (Far[2] - Near[2]) * Travel };
    }

    // Project a world point to client pixels (for 3D handle picking).
    ProjectToClient(X, Y, Z)
    {
        const Rect = this.Canvas.getBoundingClientRect();
        const Matrices = this.ResolveMatrices(Rect.width, Rect.height);
        const M = Matrices.ViewProjection;
        const ClipX = M[0] * X + M[4] * Y + M[8] * Z + M[12];
        const ClipY = M[1] * X + M[5] * Y + M[9] * Z + M[13];
        const ClipW = M[3] * X + M[7] * Y + M[11] * Z + M[15];
        if (ClipW <= 0) return null;
        return { X: Rect.left + (ClipX / ClipW * 0.5 + 0.5) * Rect.width, Y: Rect.top + (1 - (ClipY / ClipW * 0.5 + 0.5)) * Rect.height };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                RENDERING
    //--------------------------------------------------------------------------------------------------------------------

    EnsureColourTarget(Width, Height)
    {
        if (this.ColourTarget && this.ColourTarget.Width === Width && this.ColourTarget.Height === Height) return;
        this.ColourTarget?.Release();
        this.ColourTarget = ConstructSurfaceTarget(this.Context, Width, Height, "RGBA8", { Depth: true, Linear: true });
    }

    Render()
    {
        if (!this.Dirty) return false;
        const Canvas = this.Canvas;
        const ClientWidth = Canvas.clientWidth;
        const ClientHeight = Canvas.clientHeight;
        if (ClientWidth < 2 || ClientHeight < 2) return false;
        const Start = performance.now();
        const PixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const BackingWidth = Math.round(ClientWidth * PixelRatio);
        const BackingHeight = Math.round(ClientHeight * PixelRatio);
        if (Canvas.width !== BackingWidth || Canvas.height !== BackingHeight)
        {
            Canvas.width = BackingWidth;
            Canvas.height = BackingHeight;
        }
        const Scale = this.Interacting ? Math.min(this.Settings.RenderScale, 0.6) : this.Settings.RenderScale;
        const Width = Math.max(2, Math.round(BackingWidth * Scale));
        const Height = Math.max(2, Math.round(BackingHeight * Scale));
        this.EnsureColourTarget(Width, Height);
        const Context = this.Context;
        const Evaluation = this.Evaluation;
        Context.bindFramebuffer(Context.FRAMEBUFFER, this.ColourTarget.Framebuffer);
        Context.viewport(0, 0, Width, Height);
        Context.clearColor(0.07, 0.07, 0.07, 1);
        Context.clearDepth(1);
        Context.clear(Context.COLOR_BUFFER_BIT | Context.DEPTH_BUFFER_BIT);
        if (Evaluation.HeightTarget && Evaluation.Region)
        {
            const Matrices = this.ResolveMatrices(Width, Height);
            Context.enable(Context.DEPTH_TEST);
            Context.depthFunc(Context.ALWAYS);
            this.ParameterizeMarch(this.MarchProgram, Matrices, Width, Height);
            Context.bindVertexArray(this.CoverageTriangle);
            Context.drawArrays(Context.TRIANGLES, 0, 3);
            this.RasterizeOverlays(Matrices, Scale * PixelRatio);
            Context.disable(Context.DEPTH_TEST);
        }
        Context.bindFramebuffer(Context.READ_FRAMEBUFFER, this.ColourTarget.Framebuffer);
        Context.bindFramebuffer(Context.DRAW_FRAMEBUFFER, null);
        Context.blitFramebuffer(0, 0, Width, Height, 0, 0, BackingWidth, BackingHeight, Context.COLOR_BUFFER_BIT, Context.LINEAR);
        Context.bindFramebuffer(Context.READ_FRAMEBUFFER, null);
        this.Dirty = false;
        this.RenderMilliseconds = performance.now() - Start;
        return true;
    }

    // Region box edges, spline centerlines and control points; occluded parts are drawn faintly (x-ray for tunnels).
    RasterizeOverlays(Matrices, PixelScale)
    {
        const Context = this.Context;
        const Evaluation = this.Evaluation;
        const Region = Evaluation.Region;
        const Document = this.Overlay.Document;
        const Program = this.OverlayProgram;
        Program.Activate()
            .Matrix4("ViewProjection", Matrices.ViewProjection)
            .Texture("HeightTexture", Evaluation.HeightTarget.Texture)
            .Vector4("RegionRect", Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ)
            .Texture("ProfileTexture", Evaluation.HeightTarget.Texture)
            .Float("Offset", 0)
            .Float("Lift", 0)
            .Float("PointSize", 1)
            .Integer("PointMode", 0);
        Context.enable(Context.BLEND);
        Context.blendFunc(Context.SRC_ALPHA, Context.ONE_MINUS_SRC_ALPHA);
        Context.depthMask(false);
        const RasterizeTwice = (Mode, Count, Colour) =>
        {
            Context.depthFunc(Context.GREATER);
            Program.Vector4("Colour", Colour[0], Colour[1], Colour[2], Colour[3] * 0.28);
            Context.drawArrays(Mode, 0, Count);
            Context.depthFunc(Context.LEQUAL);
            Program.Vector4("Colour", ...Colour);
            Context.drawArrays(Mode, 0, Count);
        };
        Context.bindVertexArray(this.OverlayGeometry.VertexArray);
        if (this.Overlay.RegionVisible)
        {
            const X0 = Region.MinimumX, X1 = Region.MinimumX + Region.SizeX, Z0 = Region.MinimumZ, Z1 = Region.MinimumZ + Region.SizeZ;
            const Y0 = Region.MinimumHeight, Y1 = Region.MaximumHeight;
            const Corners = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
            const Floats = [];
            for (let Index = 0; Index < 4; Index++)
            {
                const A = Corners[Index], B = Corners[(Index + 1) % 4];
                Floats.push(A[0], A[1], Y0, 0, B[0], B[1], Y0, 0, A[0], A[1], Y1, 0, B[0], B[1], Y1, 0, A[0], A[1], Y0, 0, A[0], A[1], Y1, 0);
            }
            this.OverlayGeometry.Upload(new Float32Array(Floats));
            Program.Integer("HeightSource", 2);
            RasterizeTwice(Context.LINES, this.OverlayGeometry.VertexCount, [0.98, 0.72, 0.25, 0.85]);
        }
        if (Document)
        {
            for (const Layer of Document.Layers)
            {
                if (!Layer.VisibilityEnabled || Layer.Category !== "Spline") continue;
                for (const Spline of Layer.Splines)
                {
                    const Store = Evaluation.SplineStores.get(Spline.Token);
                    if (!Spline.VisibilityEnabled || !Store || Store.Samples.length < 2) continue;
                    const Selected = Spline.Token === this.Overlay.SelectedSplineToken;
                    const Tunnel = Spline.Category === "Tunnel";
                    const Colour = Selected ? [1, 1, 1, 1] : Tunnel ? [0.95, 0.63, 0.29, 0.9] : [0.95, 0.95, 0.95, 0.55];
                    const Floats = new Float32Array(Store.Samples.length * 4);
                    Store.Samples.forEach((Sample, Index) => Floats.set([Sample.X, Sample.Z, Index, 0], Index * 4));
                    this.OverlayGeometry.Upload(Floats);
                    Program.Integer("PointMode", 0)
                        .Integer("HeightSource", Tunnel ? 1 : 0)
                        .Texture("ProfileTexture", Store.ProfileTarget.Texture)
                        .Float("Offset", Tunnel ? Spline.Offset + Spline.Depth * 0.5 : 0)
                        .Float("Lift", Tunnel ? 0 : 1.2);
                    RasterizeTwice(Context.LINE_STRIP, Store.Samples.length, Colour);
                    const Handles = new Float32Array(Spline.Points.length * 4);
                    Spline.Points.forEach((Point, PointIndex) =>
                    {
                        const SampleIndex = Store.Samples.findIndex((Sample) => Sample.ControlParameter >= PointIndex - 1e-4);
                        Handles.set([Point.X, Point.Z, Math.max(0, SampleIndex), 0], PointIndex * 4);
                    });
                    this.OverlayGeometry.Upload(Handles);
                    Program.Integer("PointMode", 1).Float("PointSize", (Selected ? 11 : 7) * PixelScale);
                    RasterizeTwice(Context.POINTS, Spline.Points.length, Selected ? [1, 0.84, 0.3, 1] : [Colour[0], Colour[1], Colour[2], 0.9]);
                    if (Selected && this.Overlay.SelectedPointIndex >= 0 && this.Overlay.SelectedPointIndex < Spline.Points.length)
                    {
                        Context.bindVertexArray(this.OverlayGeometry.VertexArray);
                        Program.Float("PointSize", 15 * PixelScale).Vector4("Colour", 1, 1, 1, 1);
                        Context.depthFunc(Context.ALWAYS);
                        Context.drawArrays(Context.POINTS, this.Overlay.SelectedPointIndex, 1);
                    }
                    Program.Float("PointSize", 1);
                }
            }
        }
        Context.depthMask(true);
        Context.depthFunc(Context.LESS);
        Context.disable(Context.BLEND);
    }
}
