/*====================================================================================================================================
                                                        PLANVIEWPORT.JS
====================================================================================================================================*/
// 🧩 2D workspace: infinite world plane (pan/zoom), GPU terrain-cell previews, vector overlays for shapes, bounds and splines

import * as Shaders from "./ShaderLibrary.js";
import { SplineVariants } from "./WorldDocument.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                    PLAN VIEWPORT
//------------------------------------------------------------------------------------------------------------------------

export class PlanViewport
{
    constructor(Device, Pipeline)
    {
        this.Device = Device;
        this.Pipeline = Pipeline;
        this.Programs = {
            Grid: Device.CompileProgram("PlanGrid", Shaders.FullscreenVertex, Shaders.PlanGridFragment),
            Terrain: Device.CompileProgram("PlanTerrain", Shaders.PlanTerrainVertex, Shaders.PlanTerrainFragment),
        };
        this.Centre = [0, 0];               // [m]  - World (x, z) at the viewport centre (double precision on CPU)
        this.PixelsPerMetre = 0.12;         // [px/m] - CSS pixels per metre
        this.Region = { X: 0, Y: 0, Width: 1, Height: 1 };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                COORDINATES
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Screen up = world −Z (north), matching the default 3D camera which looks toward −Z.
    ScreenToWorld(Px, Py)
    {
        return [this.Centre[0] + (Px - this.Region.Width / 2) / this.PixelsPerMetre, this.Centre[1] + (Py - this.Region.Height / 2) / this.PixelsPerMetre];
    }

    WorldToScreen(X, Z)
    {
        return [(X - this.Centre[0]) * this.PixelsPerMetre + this.Region.Width / 2, (Z - this.Centre[1]) * this.PixelsPerMetre + this.Region.Height / 2];
    }

    ZoomAt(Px, Py, Factor)
    {
        const Before = this.ScreenToWorld(Px, Py);
        this.PixelsPerMetre = Math.min(40, Math.max(0.0005, this.PixelsPerMetre * Factor));
        const After = this.ScreenToWorld(Px, Py);
        this.Centre[0] += Before[0] - After[0];
        this.Centre[1] += Before[1] - After[1];
    }

    PanBy(Dx, Dy)
    {
        this.Centre[0] -= Dx / this.PixelsPerMetre;
        this.Centre[1] -= Dy / this.PixelsPerMetre;
    }

    FrameRectangle(Min, Size, Margin = 1.25)
    {
        this.Centre = [Min[0] + Size[0] / 2, Min[1] + Size[1] / 2];
        this.PixelsPerMetre = Math.min(this.Region.Width / (Size[0] * Margin), this.Region.Height / (Size[1] * Margin));
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                GPU RASTERIZATION
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Region is in CSS pixels from the top-left of the canvas; DevicePixels converts to the GL viewport.
    Render(Region, DevicePixels, CanvasHeight, Document, Fields)
    {
        this.Region = Region;
        const D = this.Device, GL = D.GL;
        const Viewport = [Math.round(Region.X * DevicePixels), Math.round(CanvasHeight - (Region.Y + Region.Height) * DevicePixels), Math.round(Region.Width * DevicePixels), Math.round(Region.Height * DevicePixels)];
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        GL.viewport(...Viewport);
        GL.enable(GL.SCISSOR_TEST);
        GL.scissor(...Viewport);
        const Ppm = this.PixelsPerMetre * DevicePixels;
        const Spacing = Math.pow(10, Math.ceil(Math.log10(14 / Ppm)));
        const Period = Spacing * 10;
        const Modulo = this.Centre.map(Component => Component - Math.floor(Component / Period) * Period);
        D.RasterizeTriangle(this.Programs.Grid, undefined, { uViewport: Viewport, uCentreModulo: Modulo, uPixelsPerMetre: Ppm, uSpacing: Spacing, uCentre: this.Centre });
        const S = Document.Settings;
        for (const Terrain of Document.Terrains)
        {
            const Field = Fields.get(Terrain.Id);
            if (!Terrain.Visible || !Field || !Field.HasEvaluated) continue;
            D.UseProgram(this.Programs.Terrain, {
                uWorldRect: [Terrain.Min[0], Terrain.Min[1], Terrain.Min[0] + Terrain.Size[0], Terrain.Min[1] + Terrain.Size[1]],
                uCentre: this.Centre, uPixelsPerMetre: Ppm, uViewportSize: [Viewport[2], Viewport[3]],
                uStack: Field.Final, uSurface: Field.Surface, uMaterial: Field.Material, uShadow: Field.Shadow,
                uSeaLevel: S.SeaLevel, uWaterVisible: S.WaterVisible ? 1 : 0, uContourInterval: S.ContourInterval, uContours: S.Contours ? 1 : 0,
                uActive: Terrain.Id === Document.ActiveTerrain ? 1 : 0.55, uCeiling: S.Ceiling });
            GL.bindVertexArray(D.TriangleArray);
            GL.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
            GL.bindVertexArray(null);
        }
        GL.disable(GL.SCISSOR_TEST);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                VECTOR OVERLAY
    //--------------------------------------------------------------------------------------------------------------------

    RenderOverlay(Context, Document, Session)
    {
        const R = this.Region;
        Context.save();
        Context.beginPath();
        Context.rect(R.X, R.Y, R.Width, R.Height);
        Context.clip();
        Context.translate(R.X, R.Y);
        const ToScreen = (X, Z) => this.WorldToScreen(X, Z);

        // 📝 Layers of other regions and unassigned layers are dimmed: only the active region's stack is edited live.
        const ActiveRegion = Document.RetrieveTerrain();
        const ActiveLayers = new Set(ActiveRegion ? ActiveRegion.Layers : []);
        const Dim = Layer => { Context.globalAlpha = ActiveLayers.has(Layer) ? 1 : 0.4; };

        // 📝 Shapes: translucent fill (even-odd) + outline; the selected layer is emphasised.
        for (const Layer of Document.Layers)
        {
            if (Layer.Category !== "Shape" || !Layer.Visible) continue;
            Dim(Layer);
            const Selected = Session.Selection.LayerId === Layer.Id;
            for (const Stroke of Layer.Strokes)
            {
                if (Stroke.Points.length < 2) continue;
                Context.beginPath();
                Stroke.Points.forEach((Point, Index) => { const [Sx, Sy] = ToScreen(Point[0], Point[1]); Index ? Context.lineTo(Sx, Sy) : Context.moveTo(Sx, Sy); });
                Context.closePath();
                Context.fillStyle = Stroke.Subtract ? "rgba(198,115,112,0.10)" : "rgba(255,180,84,0.05)";
                Context.fill("evenodd");
                Context.setLineDash(Stroke.Subtract ? [6, 4] : []);
                Context.strokeStyle = Stroke.Subtract ? "rgba(198,115,112,0.9)" : (Selected ? "rgba(255,180,84,0.95)" : "rgba(255,180,84,0.45)");
                Context.lineWidth = Selected ? 1.6 : 1;
                Context.stroke();
                Context.setLineDash([]);
            }
        }

        Context.globalAlpha = 1;

        // 📝 Terrain cells: bounds rectangle, label, resize handles on the active cell.
        for (const Terrain of Document.Terrains)
        {
            const Active = Terrain.Id === Document.ActiveTerrain;
            const [X0, Y0] = ToScreen(Terrain.Min[0], Terrain.Min[1]);
            const [X1, Y1] = ToScreen(Terrain.Min[0] + Terrain.Size[0], Terrain.Min[1] + Terrain.Size[1]);
            Context.strokeStyle = Active ? "#ffb454" : "rgba(255,255,255,0.35)";
            Context.lineWidth = Active ? 1.5 : 1;
            Context.setLineDash(Terrain.Visible ? [] : [3, 3]);
            Context.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
            Context.setLineDash([]);
            const Label = `${Terrain.Name}  ·  ${(Terrain.Size[0] / 1000).toFixed(2)} × ${(Terrain.Size[1] / 1000).toFixed(2)} km  ·  ${Terrain.Resolution}²`;
            Context.font = "400 11px 'DM Sans', sans-serif";
            const LabelWidth = Context.measureText(Label).width + 18;
            Context.fillStyle = Active ? "rgba(255,180,84,0.95)" : "rgba(30,30,30,0.85)";
            Context.beginPath();
            Context.roundRect(X0, Y0 - 24, LabelWidth, 20, 10);
            Context.fill();
            Context.fillStyle = Active ? "#1a1206" : "#cfcfcf";
            Context.fillText(Label, X0 + 9, Y0 - 10);
            if (Active && Session.Tool === "Select")
            {
                for (const [Hx, Hy] of this.BoundsHandles(Terrain))
                {
                    Context.fillStyle = "#121212";
                    Context.strokeStyle = "#ffb454";
                    Context.lineWidth = 1.5;
                    Context.beginPath();
                    Context.rect(Hx - 4.5, Hy - 4.5, 9, 9);
                    Context.fill();
                    Context.stroke();
                }
            }
            if (Session.StaleTerrains.has(Terrain.Id))
            {
                Context.fillStyle = "rgba(255,255,255,0.55)";
                Context.fillText("stale · refreshes when idle", X0 + 6, Y1 - 8);
            }
        }

        // 📝 Splines: corridor edges (half-width), centreline, control points; colour by variant.
        for (const Layer of Document.Layers)
        {
            if (Layer.Category !== "Spline" || !Layer.Visible) continue;
            Dim(Layer);
            const Range = this.Pipeline.Atlas && this.Pipeline.Atlas.Ranges.get(Layer.Id);
            const Colour = SplineVariants[Layer.Variant].Colour;
            const LayerSelected = Session.Selection.LayerId === Layer.Id;
            for (const Spline of Layer.Splines)
            {
                const Dense = Range && Range.SampleSets.get(Spline.Id);
                const SplineSelected = Session.Selection.SplineId === Spline.Id;
                if (Dense && Dense.length > 1)
                {
                    for (const Side of [-1, 1])
                    {
                        Context.beginPath();
                        Dense.forEach((Sample, Index) =>
                        {
                            const Next = Dense[Math.min(Index + 1, Dense.length - 1)], Previous = Dense[Math.max(Index - 1, 0)];
                            let Tx = Next[0] - Previous[0], Tz = Next[1] - Previous[1];
                            const Length = Math.hypot(Tx, Tz) || 1;
                            Tx /= Length; Tz /= Length;
                            const [Sx, Sy] = ToScreen(Sample[0] - Tz * Sample[2] * Side, Sample[1] + Tx * Sample[2] * Side);
                            Index ? Context.lineTo(Sx, Sy) : Context.moveTo(Sx, Sy);
                        });
                        Context.strokeStyle = Colour + (SplineSelected ? "aa" : "55");
                        Context.lineWidth = 1;
                        Context.stroke();
                    }
                    Context.beginPath();
                    Dense.forEach((Sample, Index) => { const [Sx, Sy] = ToScreen(Sample[0], Sample[1]); Index ? Context.lineTo(Sx, Sy) : Context.moveTo(Sx, Sy); });
                    Context.strokeStyle = Colour;
                    Context.setLineDash(Layer.Variant === "Tunnel" ? [8, 5] : []);
                    Context.lineWidth = SplineSelected ? 2.4 : (LayerSelected ? 1.8 : 1.3);
                    Context.stroke();
                    Context.setLineDash([]);
                }
                Spline.Points.forEach((Point, Index) =>
                {
                    const [Sx, Sy] = ToScreen(Point.X, Point.Z);
                    const PointSelected = SplineSelected && Session.Selection.PointIndex === Index;
                    Context.beginPath();
                    Context.arc(Sx, Sy, PointSelected ? 6 : 4.5, 0, Math.PI * 2);
                    Context.fillStyle = PointSelected ? "#ffffff" : "#121212";
                    Context.fill();
                    Context.strokeStyle = PointSelected ? "#ffb454" : Colour;
                    Context.lineWidth = 1.6;
                    Context.stroke();
                });
            }
        }

        Context.globalAlpha = 1;

        // 📝 In-progress gestures: freehand stroke, bounds rectangle, brush cursor.
        const Gesture = Session.Gesture;
        if (Gesture && Gesture.Category === "Bounds")
        {
            const [X0, Y0] = ToScreen(Gesture.Start[0], Gesture.Start[1]);
            const [X1, Y1] = ToScreen(Gesture.End[0], Gesture.End[1]);
            Context.setLineDash([6, 4]);
            Context.strokeStyle = "#ffb454";
            Context.strokeRect(Math.min(X0, X1), Math.min(Y0, Y1), Math.abs(X1 - X0), Math.abs(Y1 - Y0));
            Context.setLineDash([]);
            Context.fillStyle = "#ffb454";
            Context.fillText(`${(Math.abs(Gesture.End[0] - Gesture.Start[0]) / 1000).toFixed(2)} × ${(Math.abs(Gesture.End[1] - Gesture.Start[1]) / 1000).toFixed(2)} km`, Math.min(X0, X1) + 6, Math.min(Y0, Y1) - 8);
        }
        if (Session.Tool === "Sculpt" && Session.PlanHover)
        {
            const [Sx, Sy] = ToScreen(Session.PlanHover[0], Session.PlanHover[1]);
            Context.beginPath();
            Context.arc(Sx, Sy, Session.Brush.Radius * this.PixelsPerMetre, 0, Math.PI * 2);
            Context.strokeStyle = "#ffb454";
            Context.lineWidth = 1.5;
            Context.stroke();
        }

        // 📝 Scale bar.
        const Target = 120 / this.PixelsPerMetre;
        const Magnitude = Math.pow(10, Math.floor(Math.log10(Target)));
        const Step = [1, 2, 5, 10].map(Factor => Factor * Magnitude).filter(Candidate => Candidate <= Target).pop();
        const Pixels = Step * this.PixelsPerMetre;
        Context.fillStyle = "rgba(255,255,255,0.75)";
        Context.fillRect(16, R.Height - 22, Pixels, 2);
        Context.font = "400 10px 'DM Sans', sans-serif";
        Context.fillText(Step >= 1000 ? `${Step / 1000} km` : `${Step} m`, 16, R.Height - 28);
        Context.restore();
    }

    BoundsHandles(Terrain)
    {
        const [X0, Y0] = this.WorldToScreen(Terrain.Min[0], Terrain.Min[1]);
        const [X1, Y1] = this.WorldToScreen(Terrain.Min[0] + Terrain.Size[0], Terrain.Min[1] + Terrain.Size[1]);
        const Xm = (X0 + X1) / 2, Ym = (Y0 + Y1) / 2;
        return [[X0, Y0], [Xm, Y0], [X1, Y0], [X1, Ym], [X1, Y1], [Xm, Y1], [X0, Y1], [X0, Ym]];
    }
}
