/*====================================================================================================================================
                                                        RELIEFVIEWPORT.JS
====================================================================================================================================*/
// 🧩 3D workspace: orbit camera, adaptive-resolution SDF raymarch of the active cell, projected spline/bounds overlays

import * as Shaders from "./ShaderLibrary.js";
import { SplineVariants } from "./WorldDocument.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                    MATRIX ALGEBRA
//------------------------------------------------------------------------------------------------------------------------

function Perspective(FovY, Aspect, Near, Far)
{
    const F = 1 / Math.tan(FovY / 2), R = 1 / (Near - Far);
    return new Float32Array([F / Aspect, 0, 0, 0, 0, F, 0, 0, 0, 0, (Far + Near) * R, -1, 0, 0, 2 * Far * Near * R, 0]);
}

function LookAt(Eye, Target, Up)
{
    const Normalize = V => { const L = Math.hypot(...V) || 1; return V.map(Component => Component / L); };
    const Cross = (A, B) => [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
    const Dot = (A, B) => A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
    const Z = Normalize(Eye.map((Component, Index) => Component - Target[Index]));
    const X = Normalize(Cross(Up, Z));
    const Y = Cross(Z, X);
    return new Float32Array([X[0], Y[0], Z[0], 0, X[1], Y[1], Z[1], 0, X[2], Y[2], Z[2], 0, -Dot(X, Eye), -Dot(Y, Eye), -Dot(Z, Eye), 1]);
}

function Multiply(A, B)
{
    const Out = new Float32Array(16);
    for (let Column = 0; Column < 4; ++Column)
        for (let Row = 0; Row < 4; ++Row)
            Out[Column * 4 + Row] = A[Row] * B[Column * 4] + A[4 + Row] * B[Column * 4 + 1] + A[8 + Row] * B[Column * 4 + 2] + A[12 + Row] * B[Column * 4 + 3];
    return Out;
}

function Invert(M)
{
    const Inv = new Float64Array(16);
    Inv[0] = M[5] * M[10] * M[15] - M[5] * M[11] * M[14] - M[9] * M[6] * M[15] + M[9] * M[7] * M[14] + M[13] * M[6] * M[11] - M[13] * M[7] * M[10];
    Inv[4] = -M[4] * M[10] * M[15] + M[4] * M[11] * M[14] + M[8] * M[6] * M[15] - M[8] * M[7] * M[14] - M[12] * M[6] * M[11] + M[12] * M[7] * M[10];
    Inv[8] = M[4] * M[9] * M[15] - M[4] * M[11] * M[13] - M[8] * M[5] * M[15] + M[8] * M[7] * M[13] + M[12] * M[5] * M[11] - M[12] * M[7] * M[9];
    Inv[12] = -M[4] * M[9] * M[14] + M[4] * M[10] * M[13] + M[8] * M[5] * M[14] - M[8] * M[6] * M[13] - M[12] * M[5] * M[10] + M[12] * M[6] * M[9];
    Inv[1] = -M[1] * M[10] * M[15] + M[1] * M[11] * M[14] + M[9] * M[2] * M[15] - M[9] * M[3] * M[14] - M[13] * M[2] * M[11] + M[13] * M[3] * M[10];
    Inv[5] = M[0] * M[10] * M[15] - M[0] * M[11] * M[14] - M[8] * M[2] * M[15] + M[8] * M[3] * M[14] + M[12] * M[2] * M[11] - M[12] * M[3] * M[10];
    Inv[9] = -M[0] * M[9] * M[15] + M[0] * M[11] * M[13] + M[8] * M[1] * M[15] - M[8] * M[3] * M[13] - M[12] * M[1] * M[11] + M[12] * M[3] * M[9];
    Inv[13] = M[0] * M[9] * M[14] - M[0] * M[10] * M[13] - M[8] * M[1] * M[14] + M[8] * M[2] * M[13] + M[12] * M[1] * M[10] - M[12] * M[2] * M[9];
    Inv[2] = M[1] * M[6] * M[15] - M[1] * M[7] * M[14] - M[5] * M[2] * M[15] + M[5] * M[3] * M[14] + M[13] * M[2] * M[7] - M[13] * M[3] * M[6];
    Inv[6] = -M[0] * M[6] * M[15] + M[0] * M[7] * M[14] + M[4] * M[2] * M[15] - M[4] * M[3] * M[14] - M[12] * M[2] * M[7] + M[12] * M[3] * M[6];
    Inv[10] = M[0] * M[5] * M[15] - M[0] * M[7] * M[13] - M[4] * M[1] * M[15] + M[4] * M[3] * M[13] + M[12] * M[1] * M[7] - M[12] * M[3] * M[5];
    Inv[14] = -M[0] * M[5] * M[14] + M[0] * M[6] * M[13] + M[4] * M[1] * M[14] - M[4] * M[2] * M[13] - M[12] * M[1] * M[6] + M[12] * M[2] * M[5];
    Inv[3] = -M[1] * M[6] * M[11] + M[1] * M[7] * M[10] + M[5] * M[2] * M[11] - M[5] * M[3] * M[10] - M[9] * M[2] * M[7] + M[9] * M[3] * M[6];
    Inv[7] = M[0] * M[6] * M[11] - M[0] * M[7] * M[10] - M[4] * M[2] * M[11] + M[4] * M[3] * M[10] + M[8] * M[2] * M[7] - M[8] * M[3] * M[6];
    Inv[11] = -M[0] * M[5] * M[11] + M[0] * M[7] * M[9] + M[4] * M[1] * M[11] - M[4] * M[3] * M[9] - M[8] * M[1] * M[7] + M[8] * M[3] * M[5];
    Inv[15] = M[0] * M[5] * M[10] - M[0] * M[6] * M[9] - M[4] * M[1] * M[10] + M[4] * M[2] * M[9] + M[8] * M[1] * M[6] - M[8] * M[2] * M[5];
    const Determinant = M[0] * Inv[0] + M[1] * Inv[4] + M[2] * Inv[8] + M[3] * Inv[12];
    return new Float32Array(Inv.map(Component => Component / Determinant));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    RELIEF VIEWPORT
//------------------------------------------------------------------------------------------------------------------------

export class ReliefViewport
{
    constructor(Device, Pipeline)
    {
        this.Device = Device;
        this.Pipeline = Pipeline;
        this.Program = Device.CompileProgram("Relief", Shaders.FullscreenVertex, Shaders.ReliefFragment);
        this.Target = [0, 120, 0];          // [m]   - Orbit pivot
        this.Distance = 5200;               // [m]   - Pivot-to-eye distance
        this.Yaw = 0.55;                    // [rad] - Around +Y; 0 = eye on +Z looking toward −Z
        this.Pitch = 0.62;                  // [rad] - Elevation above the horizon
        this.FovY = 50 * Math.PI / 180;     // [rad] - Vertical field of view
        this.Scale = 1;                     // [0-1] - Raymarch resolution scale (adaptive)
        this.ScaleMode = "Auto";
        this.Offscreen = null;
        this.Region = { X: 0, Y: 0, Width: 1, Height: 1 };
        this.ViewProjection = new Float32Array(16);
        this.InverseViewProjection = new Float32Array(16);
        this.Brush = [0, 0, 0, 0];
        this.RecentMilliseconds = [];
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                CAMERA
    //--------------------------------------------------------------------------------------------------------------------

    Eye()
    {
        const C = Math.cos(this.Pitch);
        return [this.Target[0] + this.Distance * Math.sin(this.Yaw) * C, this.Target[1] + this.Distance * Math.sin(this.Pitch), this.Target[2] + this.Distance * Math.cos(this.Yaw) * C];
    }

    RefreshMatrices()
    {
        const Aspect = this.Region.Width / Math.max(this.Region.Height, 1);
        const Projection = Perspective(this.FovY, Aspect, Math.max(this.Distance * 0.002, 0.5), this.Distance * 40 + 1e5);
        const View = LookAt(this.Eye(), this.Target, [0, 1, 0]);
        this.ViewProjection = Multiply(Projection, View);
        this.InverseViewProjection = Invert(this.ViewProjection);
    }

    Orbit(Dx, Dy)
    {
        this.Yaw -= Dx * 0.005;
        this.Pitch = Math.min(1.5, Math.max(-0.2, this.Pitch + Dy * 0.005));
    }

    Pan(Dx, Dy)
    {
        const Scale = this.Distance * Math.tan(this.FovY / 2) * 2 / this.Region.Height;
        const Right = [Math.cos(this.Yaw), 0, -Math.sin(this.Yaw)];
        const Forward = [-Math.sin(this.Yaw), 0, -Math.cos(this.Yaw)];
        this.Target[0] += (-Dx * Right[0] + Dy * Forward[0]) * Scale;
        this.Target[2] += (-Dx * Right[2] + Dy * Forward[2]) * Scale;
    }

    Dolly(Factor)
    {
        this.Distance = Math.min(80000, Math.max(20, this.Distance * Factor));
    }

    FrameTerrain(Terrain, Height = 150)
    {
        this.Target = [Terrain.Min[0] + Terrain.Size[0] / 2, Height, Terrain.Min[1] + Terrain.Size[1] / 2];
        // 📝 Fit the cell's bounding circle into the narrower field of view.
        const Aspect = this.Region ? this.Region.Width / Math.max(this.Region.Height, 1) : 1;
        const HalfAngle = Math.min(this.FovY / 2, Math.atan(Math.tan(this.FovY / 2) * Aspect));
        this.Distance = 0.5 * Math.hypot(Terrain.Size[0], Terrain.Size[1]) / Math.sin(HalfAngle) * 0.92;
    }

    // 📝 CSS pixel (relative to the region) → world ray.
    RayFromScreen(Px, Py)
    {
        this.RefreshMatrices();
        const Nx = Px / this.Region.Width * 2 - 1, Ny = 1 - Py / this.Region.Height * 2;
        const Unproject = Z =>
        {
            const M = this.InverseViewProjection;
            const X = M[0] * Nx + M[4] * Ny + M[8] * Z + M[12], Y = M[1] * Nx + M[5] * Ny + M[9] * Z + M[13];
            const W2 = M[2] * Nx + M[6] * Ny + M[10] * Z + M[14], W = M[3] * Nx + M[7] * Ny + M[11] * Z + M[15];
            return [X / W, Y / W, W2 / W];
        };
        const Near = Unproject(-1), Far = Unproject(1);
        const Direction = Far.map((Component, Index) => Component - Near[Index]);
        const Length = Math.hypot(...Direction);
        return { Origin: this.Eye(), Direction: Direction.map(Component => Component / Length) };
    }

    Project(X, Y, Z)
    {
        const M = this.ViewProjection;
        const Cx = M[0] * X + M[4] * Y + M[8] * Z + M[12], Cy = M[1] * X + M[5] * Y + M[9] * Z + M[13], Cw = M[3] * X + M[7] * Y + M[11] * Z + M[15];
        if (Cw <= 1e-3) return null;
        return [(Cx / Cw * 0.5 + 0.5) * this.Region.Width, (1 - (Cy / Cw * 0.5 + 0.5)) * this.Region.Height];
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                RAYMARCH
    //--------------------------------------------------------------------------------------------------------------------

    Render(Region, DevicePixels, CanvasHeight, Document, Field, Terrain)
    {
        this.Region = Region;
        this.RefreshMatrices();
        const D = this.Device, GL = D.GL, S = Document.Settings;
        const Width = Math.max(1, Math.round(Region.Width * DevicePixels * this.Scale));
        const Height = Math.max(1, Math.round(Region.Height * DevicePixels * this.Scale));
        if (!this.Offscreen || this.Offscreen.Width !== Width || this.Offscreen.Height !== Height)
        {
            D.ReleaseTexture(this.Offscreen);
            this.Offscreen = D.CreateTexture2D(Width, Height, "RGBA8", { Linear: true });
        }
        const Azimuth = S.SunAzimuth * Math.PI / 180, Elevation = S.SunElevation * Math.PI / 180;
        const Started = performance.now();
        D.RasterizeTriangle(this.Program, this.Offscreen, {
            ...this.Pipeline.ReliefParameters(Field, Document, Terrain),
            uInverseViewProjection: this.InverseViewProjection, uCameraPosition: this.Eye(), uViewport: [0, 0, Width, Height],
            uPixelAngle: this.FovY / Height, uSurface: Field && Field.HasEvaluated ? Field.Surface : null, uMaterial: Field && Field.HasEvaluated ? Field.Material : null,
            uShadow: Field && Field.HasEvaluated ? Field.Shadow : null,
            uSunDirection: [Math.cos(Elevation) * Math.sin(Azimuth), Math.sin(Elevation), -Math.cos(Elevation) * Math.cos(Azimuth)],
            uSeaLevel: S.SeaLevel, uWaterVisible: S.WaterVisible ? 1 : 0, uContours: S.Contours ? 1 : 0, uContourInterval: S.ContourInterval,
            uSnowLine: S.SnowLine, uBrush: this.Brush, uCell: Terrain ? [Terrain.Size[0] / Field.Resolution, Terrain.Size[1] / Field.Resolution] : [1, 1] });
        GL.bindFramebuffer(GL.READ_FRAMEBUFFER, this.Offscreen.Target);
        GL.bindFramebuffer(GL.DRAW_FRAMEBUFFER, null);
        const X0 = Math.round(Region.X * DevicePixels), Y0 = Math.round(CanvasHeight - (Region.Y + Region.Height) * DevicePixels);
        GL.blitFramebuffer(0, 0, Width, Height, X0, Y0, X0 + Math.round(Region.Width * DevicePixels), Y0 + Math.round(Region.Height * DevicePixels), GL.COLOR_BUFFER_BIT, GL.LINEAR);
        GL.bindFramebuffer(GL.READ_FRAMEBUFFER, null);
        return performance.now() - Started;
    }

    // 📝 Adaptive resolution: hold the measured tick time near the 60 Hz budget while interacting.
    AdaptScale(TickMilliseconds)
    {
        if (this.ScaleMode !== "Auto") { this.Scale = this.ScaleMode === "Full" ? 1 : 0.5; return; }
        this.RecentMilliseconds.push(TickMilliseconds);
        if (this.RecentMilliseconds.length < 12) return;
        const Mean = this.RecentMilliseconds.reduce((Sum, Sample) => Sum + Sample, 0) / this.RecentMilliseconds.length;
        this.RecentMilliseconds = [];
        if (Mean > 24 && this.Scale > 0.4) this.Scale = Math.max(0.4, this.Scale * 0.8);
        else if (Mean < 12 && this.Scale < 1) this.Scale = Math.min(1, this.Scale * 1.15);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                OVERLAY
    //--------------------------------------------------------------------------------------------------------------------

    RenderOverlay(Context, Document, Session)
    {
        const R = this.Region;
        Context.save();
        Context.beginPath();
        Context.rect(R.X, R.Y, R.Width, R.Height);
        Context.clip();
        Context.translate(R.X, R.Y);
        const S = Document.Settings;
        const Terrain = Document.RetrieveTerrain();
        const Line = (Points, Colour, Width = 1, Dash = []) =>
        {
            Context.beginPath();
            let Open = false;
            for (const Point of Points)
            {
                const Screen = this.Project(...Point);
                if (!Screen) { Open = false; continue; }
                Open ? Context.lineTo(...Screen) : Context.moveTo(...Screen);
                Open = true;
            }
            Context.setLineDash(Dash);
            Context.strokeStyle = Colour;
            Context.lineWidth = Width;
            Context.stroke();
            Context.setLineDash([]);
        };
        if (Terrain)
        {
            const [X0, Z0] = Terrain.Min, X1 = X0 + Terrain.Size[0], Z1 = Z0 + Terrain.Size[1];
            const Y0 = S.Seabed, Y1 = S.Ceiling;
            Line([[X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1], [X0, Y0, Z0]], "rgba(255,180,84,0.8)", 1.2);
            Line([[X0, Y1, Z0], [X1, Y1, Z0], [X1, Y1, Z1], [X0, Y1, Z1], [X0, Y1, Z0]], "rgba(255,180,84,0.18)", 1, [4, 6]);
            for (const [X, Z] of [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]]) Line([[X, Y0, Z], [X, Y1, Z]], "rgba(255,180,84,0.18)", 1, [4, 6]);
        }
        const Atlas = this.Pipeline.Atlas;
        if (Atlas && Session.ShowSplines3D)
        {
            for (const Layer of Terrain ? Terrain.Layers : [])
            {
                if (Layer.Category !== "Spline" || !Layer.Visible) continue;
                const Range = Atlas.Ranges.get(Layer.Id);
                if (!Range) continue;
                const Colour = SplineVariants[Layer.Variant].Colour;
                for (const Spline of Layer.Splines)
                {
                    const Dense = Range.SampleSets.get(Spline.Id);
                    const Row = Range.SplineRows.get(Spline.Id);
                    if (!Dense) continue;
                    const Points = [];
                    const Handles = [];
                    Dense.forEach((Sample, Column) =>
                    {
                        const Y = this.Pipeline.RetrieveSampleHeight(Row, Column);
                        if (Y === null) return;
                        Points.push([Sample[0], Y + 1.5, Sample[1]]);
                        if (Sample[5] >= 0) Handles.push([Sample[5], [Sample[0], Y + 1.5, Sample[1]]]);
                    });
                    const Selected = Session.Selection.SplineId === Spline.Id;
                    Line(Points, Colour + (Selected ? "ff" : "99"), Selected ? 2.2 : 1.3, Layer.Variant === "Tunnel" ? [7, 5] : []);
                    for (const [Index, Position] of Handles)
                    {
                        const Screen = this.Project(...Position);
                        if (!Screen) continue;
                        const PointSelected = Selected && Session.Selection.PointIndex === Index;
                        Context.beginPath();
                        Context.arc(Screen[0], Screen[1], PointSelected ? 6 : 4.5, 0, Math.PI * 2);
                        Context.fillStyle = PointSelected ? "#ffffff" : "#121212";
                        Context.fill();
                        Context.strokeStyle = PointSelected ? "#ffb454" : Colour;
                        Context.lineWidth = 1.6;
                        Context.stroke();
                        Session.HandleScreens.push({ SplineId: Spline.Id, Index, X: Screen[0] + R.X, Y: Screen[1] + R.Y, World: Position });
                    }
                }
            }
        }
        Context.restore();
    }
}
