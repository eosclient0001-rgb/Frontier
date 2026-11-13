/*====================================================================================================================================
                                                        PLANARCANVAS.JS
====================================================================================================================================*/
// 🧩 Infinite 2D world workspace: pan/zoom, landmass shapes, region bounds boxes, spline authoring and GPU hillshade

import { SampleCenterline, ProjectOntoPolyline, PolygonContains, SimplifyPolyline } from "./CurveSampling.js";
import { SplineCategoryProfiles } from "./WorldDocument.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const HandleRadius = 6;        // [px] - Control point / region handle hit radius
const MinimumRegionSize = 64;  // [m]  - Smallest region side
const RegionSnap = 16;         // [m]  - Region corner snap increment

//------------------------------------------------------------------------------------------------------------------------
//                                                  PLANAR CANVAS
//------------------------------------------------------------------------------------------------------------------------

export class PlanarCanvas
{
    constructor(Canvas, Studio)
    {
        this.Canvas = Canvas;
        this.Studio = Studio;
        this.Context2D = Canvas.getContext("2d");
        this.View = { CentreX: 0, CentreZ: 0, Scale: 0.55 };
        this.Tool = "Select";
        this.Draft = null;
        this.Drag = null;
        this.Cursor = { X: 0, Z: 0, Inside: false };
        this.Hillshade = null;
        this.HillshadeCanvas = document.createElement("canvas");
        this.LandCanvas = document.createElement("canvas");
        this.Dirty = true;
        this.SpacePressed = false;
        this.AttachInput();
    }

    Invalidate() { this.Dirty = true; }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              COORDINATES
    //--------------------------------------------------------------------------------------------------------------------

    ProjectToScreen(X, Z)
    {
        return { X: (X - this.View.CentreX) * this.View.Scale + this.Canvas.clientWidth / 2, Y: (Z - this.View.CentreZ) * this.View.Scale + this.Canvas.clientHeight / 2 };
    }

    ProjectToWorld(ScreenX, ScreenY)
    {
        return { X: (ScreenX - this.Canvas.clientWidth / 2) / this.View.Scale + this.View.CentreX, Z: (ScreenY - this.Canvas.clientHeight / 2) / this.View.Scale + this.View.CentreZ };
    }

    LocalPointer(Event)
    {
        const Rect = this.Canvas.getBoundingClientRect();
        return { X: Event.clientX - Rect.left, Y: Event.clientY - Rect.top };
    }

    FocusRect(MinimumX, MinimumZ, SizeX, SizeZ)
    {
        this.View.CentreX = MinimumX + SizeX / 2;
        this.View.CentreZ = MinimumZ + SizeZ / 2;
        this.View.Scale = Math.min(this.Canvas.clientWidth / (SizeX * 1.3), this.Canvas.clientHeight / (SizeZ * 1.3));
        this.Dirty = true;
    }

    InstallHillshade(Hillshade)
    {
        if (!Hillshade) return;
        this.HillshadeCanvas.width = Hillshade.Width;
        this.HillshadeCanvas.height = Hillshade.Height;
        this.HillshadeCanvas.getContext("2d").putImageData(new ImageData(Hillshade.Pixels, Hillshade.Width, Hillshade.Height), 0, 0);
        this.Hillshade = Hillshade;
        this.Dirty = true;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                               HIT TESTING
    //--------------------------------------------------------------------------------------------------------------------

    // Priority: selected spline points → splines → region handles → regions → shapes.
    IdentifyAt(ScreenX, ScreenY)
    {
        const Document = this.Studio.Document;
        const World = this.ProjectToWorld(ScreenX, ScreenY);
        const Tolerance = HandleRadius / this.View.Scale;
        const Selection = this.Studio.Selection;
        for (const Layer of Document.Layers)
        {
            for (const Spline of Layer.Splines)
            {
                if (!Layer.VisibilityEnabled || !Spline.VisibilityEnabled) continue;
                if (Selection.Category === "Spline" && Selection.Token === Spline.Token)
                {
                    const PointIndex = Spline.Points.findIndex((Point) => Math.hypot(Point.X - World.X, Point.Z - World.Z) <= Tolerance * 1.4);
                    if (PointIndex >= 0) return { Category: "SplinePoint", Token: Spline.Token, PointIndex };
                }
            }
        }
        for (const Layer of Document.Layers)
        {
            if (!Layer.VisibilityEnabled) continue;
            for (const Spline of Layer.Splines)
            {
                if (!Spline.VisibilityEnabled) continue;
                const Projection = ProjectOntoPolyline(this.ResolveCenterline(Spline), World.X, World.Z);
                if (Projection.Distance <= Math.max(Tolerance, Spline.Width * 0.5)) return { Category: "Spline", Token: Spline.Token, Projection };
            }
        }
        for (const Region of Document.Regions)
        {
            const Handle = this.IdentifyRegionHandle(Region, ScreenX, ScreenY);
            if (Handle && Selection.Category === "Region" && Selection.Token === Region.Token) return { Category: "RegionHandle", Token: Region.Token, Handle };
        }
        for (const Region of Document.Regions)
        {
            const Inside = World.X >= Region.MinimumX && World.X <= Region.MinimumX + Region.SizeX && World.Z >= Region.MinimumZ && World.Z <= Region.MinimumZ + Region.SizeZ;
            const Edge = Inside && Math.min(World.X - Region.MinimumX, Region.MinimumX + Region.SizeX - World.X, World.Z - Region.MinimumZ, Region.MinimumZ + Region.SizeZ - World.Z) < Tolerance * 2;
            if (Edge) return { Category: "Region", Token: Region.Token };
        }
        for (let Index = Document.Shapes.length - 1; Index >= 0; Index--)
        {
            const Shape = Document.Shapes[Index];
            if (!Shape.VisibilityEnabled) continue;
            if (Shape.Category === "Stroke")
            {
                if (ProjectOntoPolyline(Shape.Points, World.X, World.Z).Distance <= Shape.Width * 0.5) return { Category: "Shape", Token: Shape.Token };
            }
            else if (PolygonContains(Shape.Points, World.X, World.Z)) return { Category: "Shape", Token: Shape.Token };
        }
        for (const Region of Document.Regions)
        {
            if (World.X >= Region.MinimumX && World.X <= Region.MinimumX + Region.SizeX && World.Z >= Region.MinimumZ && World.Z <= Region.MinimumZ + Region.SizeZ) return { Category: "Region", Token: Region.Token };
        }
        return null;
    }

    IdentifyRegionHandle(Region, ScreenX, ScreenY)
    {
        const A = this.ProjectToScreen(Region.MinimumX, Region.MinimumZ);
        const B = this.ProjectToScreen(Region.MinimumX + Region.SizeX, Region.MinimumZ + Region.SizeZ);
        const MidX = (A.X + B.X) / 2, MidY = (A.Y + B.Y) / 2;
        const Handles = { NW: [A.X, A.Y], N: [MidX, A.Y], NE: [B.X, A.Y], E: [B.X, MidY], SE: [B.X, B.Y], S: [MidX, B.Y], SW: [A.X, B.Y], W: [A.X, MidY] };
        for (const [Name, [X, Y]] of Object.entries(Handles)) if (Math.hypot(ScreenX - X, ScreenY - Y) <= HandleRadius + 2) return Name;
        return null;
    }

    ResolveCenterline(Spline)
    {
        const Signature = JSON.stringify(Spline.Points);
        if (Spline.CachedSignature !== Signature)
        {
            Object.defineProperty(Spline, "CachedCenterline", { value: SampleCenterline(Spline.Points, 3), writable: true, configurable: true, enumerable: false });
            Object.defineProperty(Spline, "CachedSignature", { value: Signature, writable: true, configurable: true, enumerable: false });
        }
        return Spline.CachedCenterline;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  INPUT
    //--------------------------------------------------------------------------------------------------------------------

    AttachInput()
    {
        const Canvas = this.Canvas;
        Canvas.addEventListener("contextmenu", (Event) => Event.preventDefault());
        Canvas.addEventListener("wheel", (Event) =>
        {
            Event.preventDefault();
            const Local = this.LocalPointer(Event);
            const Before = this.ProjectToWorld(Local.X, Local.Y);
            this.View.Scale = Math.min(60, Math.max(0.0008, this.View.Scale * Math.exp(-Event.deltaY * 0.0015)));
            const After = this.ProjectToWorld(Local.X, Local.Y);
            this.View.CentreX += Before.X - After.X;
            this.View.CentreZ += Before.Z - After.Z;
            this.Dirty = true;
        }, { passive: false });
        Canvas.addEventListener("pointerdown", (Event) => this.PointerDown(Event));
        Canvas.addEventListener("pointermove", (Event) => this.PointerMove(Event));
        Canvas.addEventListener("pointerup", (Event) => this.PointerUp(Event));
        Canvas.addEventListener("pointerleave", () => { this.Cursor.Inside = false; this.Dirty = true; });
        Canvas.addEventListener("dblclick", (Event) => this.DoubleClick(Event));
    }

    PointerDown(Event)
    {
        const Local = this.LocalPointer(Event);
        const World = this.ProjectToWorld(Local.X, Local.Y);
        this.Canvas.setPointerCapture(Event.pointerId);
        if (Event.button === 1 || Event.button === 2 || this.Tool === "Pan" || (Event.button === 0 && this.SpacePressed))
        {
            this.Drag = { Category: "Pan", LastX: Local.X, LastY: Local.Y };
            return;
        }
        if (Event.button !== 0) return;
        const Studio = this.Studio;
        if (this.Tool === "Lasso" || this.Tool === "Stroke")
        {
            this.Draft = { Tool: this.Tool, Points: [World], LastScreen: Local };
        }
        else if (this.Tool === "Region")
        {
            const Snapped = { X: Math.round(World.X / RegionSnap) * RegionSnap, Z: Math.round(World.Z / RegionSnap) * RegionSnap };
            this.Draft = { Tool: "Region", Anchor: Snapped, Corner: Snapped };
        }
        else if (this.Tool === "Polygon" || this.Tool === "Spline")
        {
            if (!this.Draft || this.Draft.Tool !== this.Tool) this.Draft = { Tool: this.Tool, Points: [] };
            const Points = this.Draft.Points;
            if (this.Tool === "Polygon" && Points.length >= 3)
            {
                const First = this.ProjectToScreen(Points[0].X, Points[0].Z);
                if (Math.hypot(First.X - Local.X, First.Y - Local.Y) <= HandleRadius * 1.6) { this.FinalizeDraft(); return; }
            }
            Points.push(World);
        }
        else if (this.Tool === "Select")
        {
            const Hit = this.IdentifyAt(Local.X, Local.Y);
            if (!Hit)
            {
                Studio.Select({ Category: null });
                this.Drag = { Category: "Pan", LastX: Local.X, LastY: Local.Y };
                return;
            }
            if (Hit.Category === "SplinePoint")
            {
                Studio.Select({ Category: "Spline", Token: Hit.Token, PointIndex: Hit.PointIndex });
                this.Drag = { Category: "SplinePoint", Token: Hit.Token, PointIndex: Hit.PointIndex, Origin: World, Started: false };
            }
            else if (Hit.Category === "Spline")
            {
                Studio.Select({ Category: "Spline", Token: Hit.Token, PointIndex: -1 });
                this.Drag = { Category: "Spline", Token: Hit.Token, Origin: World, Started: false };
            }
            else if (Hit.Category === "RegionHandle")
            {
                this.Drag = { Category: "RegionHandle", Token: Hit.Token, Handle: Hit.Handle, Origin: World, Started: false };
            }
            else if (Hit.Category === "Region")
            {
                Studio.Select({ Category: "Region", Token: Hit.Token });
                this.Drag = { Category: "Region", Token: Hit.Token, Origin: World, Started: false };
            }
            else if (Hit.Category === "Shape")
            {
                Studio.Select({ Category: "Shape", Token: Hit.Token });
                this.Drag = { Category: "Shape", Token: Hit.Token, Origin: World, Started: false };
            }
        }
        this.Dirty = true;
    }

    PointerMove(Event)
    {
        const Local = this.LocalPointer(Event);
        const World = this.ProjectToWorld(Local.X, Local.Y);
        this.Cursor = { X: World.X, Z: World.Z, Inside: true, ScreenX: Local.X, ScreenY: Local.Y };
        this.Studio.ReportCursor(World.X, World.Z);
        this.Dirty = true;
        const Drag = this.Drag;
        if (Drag && Drag.Category === "Pan")
        {
            this.View.CentreX -= (Local.X - Drag.LastX) / this.View.Scale;
            this.View.CentreZ -= (Local.Y - Drag.LastY) / this.View.Scale;
            Drag.LastX = Local.X;
            Drag.LastY = Local.Y;
            return;
        }
        if (this.Draft && (this.Draft.Tool === "Lasso" || this.Draft.Tool === "Stroke") && (Event.buttons & 1))
        {
            if (Math.hypot(Local.X - this.Draft.LastScreen.X, Local.Y - this.Draft.LastScreen.Y) >= 3)
            {
                this.Draft.Points.push(World);
                this.Draft.LastScreen = Local;
            }
            return;
        }
        if (this.Draft && this.Draft.Tool === "Region" && (Event.buttons & 1))
        {
            this.Draft.Corner = { X: Math.round(World.X / RegionSnap) * RegionSnap, Z: Math.round(World.Z / RegionSnap) * RegionSnap };
            return;
        }
        if (!Drag || !(Event.buttons & 1)) return;
        const DeltaX = World.X - Drag.Origin.X;
        const DeltaZ = World.Z - Drag.Origin.Z;
        if (!Drag.Started)
        {
            if (Math.hypot(DeltaX, DeltaZ) * this.View.Scale < 3) return;
            Drag.Started = true;
            this.Studio.BeginDocumentEdit();
            Drag.Snapshot = JSON.parse(JSON.stringify(this.ResolveDragTarget(Drag)));
        }
        this.ApplyDrag(Drag, DeltaX, DeltaZ, World);
    }

    ResolveDragTarget(Drag)
    {
        const Document = this.Studio.Document;
        if (Drag.Category === "Spline" || Drag.Category === "SplinePoint") return Document.Layers.flatMap((Layer) => Layer.Splines).find((Spline) => Spline.Token === Drag.Token);
        if (Drag.Category === "Shape") return Document.Shapes.find((Shape) => Shape.Token === Drag.Token);
        return Document.Regions.find((Region) => Region.Token === Drag.Token);
    }

    ApplyDrag(Drag, DeltaX, DeltaZ, World)
    {
        const Target = this.ResolveDragTarget(Drag);
        if (!Target) return;
        const Snapshot = Drag.Snapshot;
        if (Drag.Category === "SplinePoint")
        {
            Target.Points[Drag.PointIndex].X = Snapshot.Points[Drag.PointIndex].X + DeltaX;
            Target.Points[Drag.PointIndex].Z = Snapshot.Points[Drag.PointIndex].Z + DeltaZ;
            this.Studio.NotifyDocumentEdit("Splines");
        }
        else if (Drag.Category === "Spline" || Drag.Category === "Shape")
        {
            Target.Points.forEach((Point, Index) => { Point.X = Snapshot.Points[Index].X + DeltaX; Point.Z = Snapshot.Points[Index].Z + DeltaZ; });
            this.Studio.NotifyDocumentEdit(Drag.Category === "Shape" ? "Shapes" : "Splines");
        }
        else if (Drag.Category === "Region")
        {
            Target.MinimumX = Math.round((Snapshot.MinimumX + DeltaX) / RegionSnap) * RegionSnap;
            Target.MinimumZ = Math.round((Snapshot.MinimumZ + DeltaZ) / RegionSnap) * RegionSnap;
            this.Studio.NotifyDocumentEdit("Regions");
        }
        else if (Drag.Category === "RegionHandle")
        {
            let X0 = Snapshot.MinimumX, Z0 = Snapshot.MinimumZ, X1 = Snapshot.MinimumX + Snapshot.SizeX, Z1 = Snapshot.MinimumZ + Snapshot.SizeZ;
            const SnapX = Math.round(World.X / RegionSnap) * RegionSnap;
            const SnapZ = Math.round(World.Z / RegionSnap) * RegionSnap;
            if (Drag.Handle.includes("W")) X0 = Math.min(SnapX, X1 - MinimumRegionSize);
            if (Drag.Handle.includes("E")) X1 = Math.max(SnapX, X0 + MinimumRegionSize);
            if (Drag.Handle.includes("N")) Z0 = Math.min(SnapZ, Z1 - MinimumRegionSize);
            if (Drag.Handle.includes("S")) Z1 = Math.max(SnapZ, Z0 + MinimumRegionSize);
            Object.assign(Target, { MinimumX: X0, MinimumZ: Z0, SizeX: X1 - X0, SizeZ: Z1 - Z0 });
            this.Studio.NotifyDocumentEdit("Regions");
        }
    }

    PointerUp(Event)
    {
        if (this.Canvas.hasPointerCapture(Event.pointerId)) this.Canvas.releasePointerCapture(Event.pointerId);
        if (this.Drag && this.Drag.Started) this.Studio.FinalizeDocumentEdit();
        this.Drag = null;
        if (this.Draft && (this.Draft.Tool === "Lasso" || this.Draft.Tool === "Stroke" || this.Draft.Tool === "Region")) this.FinalizeDraft();
        this.Dirty = true;
    }

    DoubleClick(Event)
    {
        const Local = this.LocalPointer(Event);
        if (this.Draft && (this.Draft.Tool === "Polygon" || this.Draft.Tool === "Spline"))
        {
            this.Draft.Points.pop();
            this.FinalizeDraft();
            return;
        }
        if (this.Tool !== "Select") return;
        const Hit = this.IdentifyAt(Local.X, Local.Y);
        if (Hit && Hit.Category === "Spline") this.Studio.InsertSplinePoint(Hit.Token, this.ProjectToWorld(Local.X, Local.Y));
        else if (Hit && Hit.Category === "Region") this.Studio.ActivateRegion(Hit.Token);
    }

    // Keyboard routed from the studio while the planar workspace has focus.
    InterpretKey(Event)
    {
        if (!this.Draft) return false;
        if (Event.key === "Escape") { this.Draft = null; this.Dirty = true; return true; }
        if (Event.key === "Enter") { this.FinalizeDraft(); return true; }
        if (Event.key === "Backspace" && this.Draft.Points) { this.Draft.Points.pop(); this.Dirty = true; return true; }
        return false;
    }

    FinalizeDraft()
    {
        const Draft = this.Draft;
        this.Draft = null;
        this.Dirty = true;
        if (!Draft) return;
        const Tolerance = 1.2 / this.View.Scale;
        if (Draft.Tool === "Lasso" && Draft.Points.length >= 3) this.Studio.CreateShape("Lasso", SimplifyPolyline(Draft.Points, Tolerance));
        else if (Draft.Tool === "Stroke" && Draft.Points.length >= 1) this.Studio.CreateShape("Stroke", SimplifyPolyline(Draft.Points, Tolerance));
        else if (Draft.Tool === "Polygon" && Draft.Points.length >= 3) this.Studio.CreateShape("Polygon", Draft.Points);
        else if (Draft.Tool === "Spline" && Draft.Points.length >= 2) this.Studio.CreateSpline(Draft.Points);
        else if (Draft.Tool === "Region")
        {
            const X0 = Math.min(Draft.Anchor.X, Draft.Corner.X), X1 = Math.max(Draft.Anchor.X, Draft.Corner.X);
            const Z0 = Math.min(Draft.Anchor.Z, Draft.Corner.Z), Z1 = Math.max(Draft.Anchor.Z, Draft.Corner.Z);
            if (X1 - X0 >= MinimumRegionSize && Z1 - Z0 >= MinimumRegionSize) this.Studio.CreateRegion(X0, Z0, X1 - X0, Z1 - Z0);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                RENDERING
    //--------------------------------------------------------------------------------------------------------------------

    Render()
    {
        if (!this.Dirty) return;
        const Canvas = this.Canvas;
        const Width = Canvas.clientWidth, Height = Canvas.clientHeight;
        if (Width < 2 || Height < 2) return;
        const PixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        if (Canvas.width !== Math.round(Width * PixelRatio) || Canvas.height !== Math.round(Height * PixelRatio))
        {
            Canvas.width = Math.round(Width * PixelRatio);
            Canvas.height = Math.round(Height * PixelRatio);
        }
        const Context = this.Context2D;
        Context.setTransform(PixelRatio, 0, 0, PixelRatio, 0, 0);
        Context.fillStyle = "#0b0c0d";
        Context.fillRect(0, 0, Width, Height);
        this.RenderGrid(Context, Width, Height);
        this.RenderLand(Context, Width, Height, PixelRatio);
        this.RenderHillshade(Context);
        this.RenderShapeOutlines(Context);
        this.RenderRegions(Context);
        this.RenderSplines(Context);
        this.RenderDraft(Context);
        this.RenderScaleBar(Context, Height);
        this.Dirty = false;
    }

    RenderGrid(Context, Width, Height)
    {
        const Scale = this.View.Scale;
        const Raw = 48 / Scale;
        const Magnitude = 10 ** Math.floor(Math.log10(Raw));
        const Spacing = [1, 2, 5, 10].map((Factor) => Factor * Magnitude).find((Candidate) => Candidate >= Raw);
        const TopLeft = this.ProjectToWorld(0, 0);
        const BottomRight = this.ProjectToWorld(Width, Height);
        Context.lineWidth = 1;
        for (let X = Math.floor(TopLeft.X / Spacing) * Spacing; X <= BottomRight.X; X += Spacing)
        {
            const Screen = this.ProjectToScreen(X, 0).X;
            Context.strokeStyle = Math.abs(X) < Spacing * 0.01 ? "#3a3f45" : (Math.round(X / Spacing) % 5 === 0 ? "#1d2024" : "#141618");
            Context.beginPath(); Context.moveTo(Math.round(Screen) + 0.5, 0); Context.lineTo(Math.round(Screen) + 0.5, Height); Context.stroke();
        }
        for (let Z = Math.floor(TopLeft.Z / Spacing) * Spacing; Z <= BottomRight.Z; Z += Spacing)
        {
            const Screen = this.ProjectToScreen(0, Z).Y;
            Context.strokeStyle = Math.abs(Z) < Spacing * 0.01 ? "#3a3f45" : (Math.round(Z / Spacing) % 5 === 0 ? "#1d2024" : "#141618");
            Context.beginPath(); Context.moveTo(0, Math.round(Screen) + 0.5); Context.lineTo(Width, Math.round(Screen) + 0.5); Context.stroke();
        }
    }

    TraceShape(Context, Shape)
    {
        Context.beginPath();
        Shape.Points.forEach((Point, Index) =>
        {
            const Screen = this.ProjectToScreen(Point.X, Point.Z);
            if (Index === 0) Context.moveTo(Screen.X, Screen.Y); else Context.lineTo(Screen.X, Screen.Y);
        });
        if (Shape.Category !== "Stroke") Context.closePath();
    }

    // 📝 Union shapes paint, subtract shapes erase (destination-out) in document order — matching the GPU mask.
    RenderLand(Context, Width, Height, PixelRatio)
    {
        const Land = this.LandCanvas;
        if (Land.width !== Math.round(Width * PixelRatio) || Land.height !== Math.round(Height * PixelRatio))
        {
            Land.width = Math.round(Width * PixelRatio);
            Land.height = Math.round(Height * PixelRatio);
        }
        const LandContext = Land.getContext("2d");
        LandContext.setTransform(1, 0, 0, 1, 0, 0);
        LandContext.clearRect(0, 0, Land.width, Land.height);
        LandContext.setTransform(PixelRatio, 0, 0, PixelRatio, 0, 0);
        LandContext.lineCap = "round";
        LandContext.lineJoin = "round";
        for (const Shape of this.Studio.Document.Shapes)
        {
            if (!Shape.VisibilityEnabled) continue;
            LandContext.globalCompositeOperation = Shape.Operation === "Subtract" ? "destination-out" : "source-over";
            LandContext.fillStyle = "#2f3a2b";
            LandContext.strokeStyle = "#2f3a2b";
            this.TraceShape(LandContext, Shape);
            if (Shape.Category === "Stroke")
            {
                LandContext.lineWidth = Math.max(1, Shape.Width * this.View.Scale);
                if (Shape.Points.length === 1)
                {
                    const Screen = this.ProjectToScreen(Shape.Points[0].X, Shape.Points[0].Z);
                    LandContext.arc(Screen.X, Screen.Y, Shape.Width * 0.5 * this.View.Scale, 0, Math.PI * 2);
                    LandContext.fill();
                }
                else LandContext.stroke();
            }
            else LandContext.fill("evenodd");
        }
        LandContext.globalCompositeOperation = "source-over";
        Context.drawImage(Land, 0, 0, Width, Height);
    }

    RenderHillshade(Context)
    {
        const Hillshade = this.Hillshade;
        const Region = this.Studio.Document.Regions.find((Candidate) => Candidate.Token === Hillshade?.RegionToken);
        if (!Hillshade || !Region || !this.Studio.PlanarHillshadeEnabled) return;
        const [X, Z, SizeX, SizeZ] = Hillshade.Rect;
        const A = this.ProjectToScreen(X, Z);
        const B = this.ProjectToScreen(X + SizeX, Z + SizeZ);
        Context.imageSmoothingEnabled = true;
        Context.globalAlpha = 0.96;
        Context.drawImage(this.HillshadeCanvas, A.X, A.Y, B.X - A.X, B.Y - A.Y);
        Context.globalAlpha = 1;
    }

    RenderShapeOutlines(Context)
    {
        const Selection = this.Studio.Selection;
        for (const Shape of this.Studio.Document.Shapes)
        {
            if (!Shape.VisibilityEnabled) continue;
            const Selected = Selection.Category === "Shape" && Selection.Token === Shape.Token;
            Context.setLineDash(Shape.Operation === "Subtract" ? [6, 4] : []);
            Context.lineWidth = Selected ? 2 : 1;
            Context.strokeStyle = Selected ? "#f2f2f2" : (Shape.Operation === "Subtract" ? "#c46a5a" : "#7f9a6f");
            this.TraceShape(Context, Shape);
            Context.stroke();
        }
        Context.setLineDash([]);
    }

    RenderRegions(Context)
    {
        const Document = this.Studio.Document;
        const Selection = this.Studio.Selection;
        for (const Region of Document.Regions)
        {
            const Active = Region.Token === Document.ActiveRegionToken;
            const Selected = Selection.Category === "Region" && Selection.Token === Region.Token;
            const A = this.ProjectToScreen(Region.MinimumX, Region.MinimumZ);
            const B = this.ProjectToScreen(Region.MinimumX + Region.SizeX, Region.MinimumZ + Region.SizeZ);
            Context.setLineDash(Active ? [] : [8, 6]);
            Context.lineWidth = Active ? 2 : 1.25;
            Context.strokeStyle = Active ? "#f0a83a" : "#8a8f96";
            Context.strokeRect(A.X, A.Y, B.X - A.X, B.Y - A.Y);
            Context.setLineDash([]);
            Context.font = "500 11px 'DM Sans', sans-serif";
            const Label = `${Region.Name} · ${(Region.SizeX / 1000).toFixed(2)} × ${(Region.SizeZ / 1000).toFixed(2)} km${Active ? " · ACTIVE" : ""}`;
            const LabelWidth = Context.measureText(Label).width + 14;
            Context.fillStyle = Active ? "#f0a83a" : "#2a2c30";
            Context.beginPath();
            Context.roundRect(A.X, A.Y - 22, LabelWidth, 18, 9);
            Context.fill();
            Context.fillStyle = Active ? "#111" : "#d0d0d0";
            Context.fillText(Label, A.X + 7, A.Y - 9);
            if (Selected)
            {
                const MidX = (A.X + B.X) / 2, MidY = (A.Y + B.Y) / 2;
                for (const [X, Y] of [[A.X, A.Y], [MidX, A.Y], [B.X, A.Y], [B.X, MidY], [B.X, B.Y], [MidX, B.Y], [A.X, B.Y], [A.X, MidY]])
                {
                    Context.fillStyle = "#f2f2f2";
                    Context.strokeStyle = "#111";
                    Context.beginPath();
                    Context.rect(X - 4.5, Y - 4.5, 9, 9);
                    Context.fill();
                    Context.stroke();
                }
            }
        }
    }

    RenderSplines(Context)
    {
        const Document = this.Studio.Document;
        const Selection = this.Studio.Selection;
        Context.lineCap = "round";
        Context.lineJoin = "round";
        for (const Layer of Document.Layers)
        {
            if (Layer.Category !== "Spline" || !Layer.VisibilityEnabled) continue;
            for (const Spline of Layer.Splines)
            {
                if (!Spline.VisibilityEnabled) continue;
                const Selected = Selection.Category === "Spline" && Selection.Token === Spline.Token;
                const Colour = SplineCategoryProfiles[Spline.Category].Colour;
                const Centerline = this.ResolveCenterline(Spline);
                const Trace = () =>
                {
                    Context.beginPath();
                    Centerline.forEach((Sample, Index) =>
                    {
                        const Screen = this.ProjectToScreen(Sample.X, Sample.Z);
                        if (Index === 0) Context.moveTo(Screen.X, Screen.Y); else Context.lineTo(Screen.X, Screen.Y);
                    });
                };
                if (Spline.Category !== "Tunnel")
                {
                    Context.globalAlpha = Selected ? 0.16 : 0.08;
                    Context.strokeStyle = Colour;
                    Context.lineWidth = Math.max(2, (Spline.Width + 2 * Spline.Falloff) * this.View.Scale);
                    Trace(); Context.stroke();
                }
                Context.globalAlpha = Selected ? 0.55 : 0.35;
                Context.strokeStyle = Colour;
                Context.lineWidth = Math.max(2, Spline.Width * this.View.Scale);
                Context.setLineDash(Spline.Category === "Tunnel" ? [10, 6] : []);
                Trace(); Context.stroke();
                Context.globalAlpha = 1;
                Context.lineWidth = Selected ? 2 : 1.25;
                Context.strokeStyle = Selected ? "#ffffff" : Colour;
                Trace(); Context.stroke();
                Context.setLineDash([]);
                if (Centerline.length > 3)
                {
                    const Middle = Centerline[Math.floor(Centerline.length / 2)];
                    const Ahead = Centerline[Math.min(Centerline.length - 1, Math.floor(Centerline.length / 2) + 2)];
                    const A = this.ProjectToScreen(Middle.X, Middle.Z), B = this.ProjectToScreen(Ahead.X, Ahead.Z);
                    const θ = Math.atan2(B.Y - A.Y, B.X - A.X);
                    Context.fillStyle = Selected ? "#ffffff" : Colour;
                    Context.beginPath();
                    Context.moveTo(A.X + Math.cos(θ) * 7, A.Y + Math.sin(θ) * 7);
                    Context.lineTo(A.X + Math.cos(θ + 2.5) * 6, A.Y + Math.sin(θ + 2.5) * 6);
                    Context.lineTo(A.X + Math.cos(θ - 2.5) * 6, A.Y + Math.sin(θ - 2.5) * 6);
                    Context.fill();
                }
                Spline.Points.forEach((Point, PointIndex) =>
                {
                    const Screen = this.ProjectToScreen(Point.X, Point.Z);
                    const Active = Selected && Selection.PointIndex === PointIndex;
                    Context.fillStyle = Active ? "#ffd84d" : (Selected ? "#ffffff" : Colour);
                    Context.strokeStyle = "#111";
                    Context.lineWidth = 1.5;
                    Context.beginPath();
                    Context.arc(Screen.X, Screen.Y, Active ? 6 : (Selected ? 5 : 3.5), 0, Math.PI * 2);
                    Context.fill();
                    Context.stroke();
                });
                if (Selected || this.View.Scale > 0.25)
                {
                    const Start = this.ProjectToScreen(Spline.Points[0].X, Spline.Points[0].Z);
                    Context.font = "500 11px 'DM Sans', sans-serif";
                    Context.fillStyle = Selected ? "#ffffff" : "#c9c9c9";
                    Context.fillText(Spline.Name, Start.X + 9, Start.Y - 8);
                }
            }
        }
    }

    RenderDraft(Context)
    {
        const Draft = this.Draft;
        if (!Draft) return;
        Context.strokeStyle = "#ffffff";
        Context.fillStyle = "rgba(255,255,255,0.08)";
        Context.lineWidth = 1.5;
        if (Draft.Tool === "Region")
        {
            const A = this.ProjectToScreen(Draft.Anchor.X, Draft.Anchor.Z);
            const B = this.ProjectToScreen(Draft.Corner.X, Draft.Corner.Z);
            Context.setLineDash([6, 4]);
            Context.strokeStyle = "#f0a83a";
            Context.strokeRect(A.X, A.Y, B.X - A.X, B.Y - A.Y);
            Context.setLineDash([]);
            Context.font = "500 11px 'DM Sans', sans-serif";
            Context.fillStyle = "#f0a83a";
            Context.fillText(`${Math.abs(Draft.Corner.X - Draft.Anchor.X)} × ${Math.abs(Draft.Corner.Z - Draft.Anchor.Z)} m`, Math.min(A.X, B.X), Math.max(A.Y, B.Y) + 16);
            return;
        }
        const Points = Draft.Points.slice();
        if ((Draft.Tool === "Polygon" || Draft.Tool === "Spline") && this.Cursor.Inside) Points.push({ X: this.Cursor.X, Z: this.Cursor.Z });
        if (Points.length === 0) return;
        if (Draft.Tool === "Spline")
        {
            const Colour = SplineCategoryProfiles[this.Studio.ToolOptions.SplineCategory].Colour;
            const Centerline = Points.length >= 2 ? SampleCenterline(Points.map((Point) => ({ ...Point, Height: 0 })), 3) : Points;
            Context.strokeStyle = Colour;
            Context.lineWidth = 2;
            Context.beginPath();
            Centerline.forEach((Sample, Index) =>
            {
                const Screen = this.ProjectToScreen(Sample.X, Sample.Z);
                if (Index === 0) Context.moveTo(Screen.X, Screen.Y); else Context.lineTo(Screen.X, Screen.Y);
            });
            Context.stroke();
        }
        else
        {
            const Stroke = Draft.Tool === "Stroke";
            Context.lineCap = "round";
            Context.lineJoin = "round";
            Context.strokeStyle = this.Studio.ToolOptions.ShapeOperation === "Subtract" ? "rgba(220,110,90,0.55)" : "rgba(150,190,120,0.55)";
            Context.lineWidth = Stroke ? Math.max(2, this.Studio.ToolOptions.StrokeWidth * this.View.Scale) : 1.5;
            this.TraceShape(Context, { Points, Category: Stroke || Draft.Tool === "Polygon" ? "Stroke" : "Lasso" });
            if (!Stroke) Context.fill();
            Context.stroke();
        }
        Context.fillStyle = "#ffffff";
        for (const Point of Draft.Points)
        {
            if (Draft.Tool === "Lasso" || Draft.Tool === "Stroke") break;
            const Screen = this.ProjectToScreen(Point.X, Point.Z);
            Context.beginPath();
            Context.arc(Screen.X, Screen.Y, 3.5, 0, Math.PI * 2);
            Context.fill();
        }
    }

    RenderScaleBar(Context, Height)
    {
        const Raw = 120 / this.View.Scale;
        const Magnitude = 10 ** Math.floor(Math.log10(Raw));
        const Length = [1, 2, 5].map((Factor) => Factor * Magnitude).reverse().find((Candidate) => Candidate <= Raw) ?? Magnitude;
        const Pixels = Length * this.View.Scale;
        Context.fillStyle = "rgba(10,10,10,0.75)";
        Context.beginPath();
        Context.roundRect(12, Height - 40, Pixels + 120, 28, 14);
        Context.fill();
        Context.strokeStyle = "#e0e0e0";
        Context.lineWidth = 2;
        Context.beginPath();
        Context.moveTo(24, Height - 22); Context.lineTo(24, Height - 18); Context.lineTo(24 + Pixels, Height - 18); Context.lineTo(24 + Pixels, Height - 22);
        Context.stroke();
        Context.font = "500 11px 'DM Sans', sans-serif";
        Context.fillStyle = "#e0e0e0";
        Context.fillText(Length >= 1000 ? `${Length / 1000} km` : `${Length} m`, 32 + Pixels, Height - 15);
        if (this.Cursor.Inside)
        {
            Context.fillStyle = "#9a9a9a";
            Context.fillText(`X ${this.Cursor.X.toFixed(0)}  Z ${this.Cursor.Z.toFixed(0)}`, 74 + Pixels, Height - 15);
        }
    }
}
