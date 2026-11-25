/*====================================================================================================================================
                                                        APPLICATION.JS
====================================================================================================================================*/
// 🧩 Terrain authoring session: workspaces, tools, pointer routing, sculpt strokes, edit history, persistence, tick sequence

import { GpuDevice } from "./GpuDevice.js";
import { TerrainStackEvaluation, TerrainCellField } from "./TerrainStackEvaluation.js";
import { PlanViewport } from "./PlanViewport.js";
import { ReliefViewport } from "./ReliefViewport.js";
import { WorldDocument, EditHistory, ConstructExampleWorld, IssueToken, SplineVariants } from "./WorldDocument.js";
import { CondenseStroke } from "./SplineSampling.js";
import * as Panels from "./InterfacePanels.js";
import { RasterArchive } from "./RasterArchive.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const DocumentStorageKey = "FrontierTerrainAuthoring.Document.v1";
const StampsPerTick = 48;         // [-]  - Upper bound of sculpt stamps rasterized per tick
const IdleDelay = 350;            // [ms] - Quiet period before inactive cells refresh

//------------------------------------------------------------------------------------------------------------------------
//                                                    SESSION
//------------------------------------------------------------------------------------------------------------------------

export class AuthoringSession
{
    constructor()
    {
        this.Scene = document.getElementById("Scene");
        this.GpuCanvas = document.getElementById("GpuCanvas");
        this.OverlayCanvas = document.getElementById("OverlayCanvas");
        this.Overlay = this.OverlayCanvas.getContext("2d");
        this.Device = new GpuDevice(this.GpuCanvas);
        this.Pipeline = new TerrainStackEvaluation(this.Device);
        this.Plan = new PlanViewport(this.Device, this.Pipeline);
        this.Relief = new ReliefViewport(this.Device, this.Pipeline);
        this.Document = new WorldDocument();
        this.History = new EditHistory(this.Document);
        this.Fields = new Map();
        this.Archive = new RasterArchive();
        this.Workspace = "Split";
        this.Tool = "Select";
        this.ShapeSubtract = false;
        this.SplineVariant = "Road";
        this.Brush = { Mode: "Raise", Radius: 160, Strength: 0.5, Hardness: 0.3 };
        this.Selection = { Category: "World", LayerId: null, SplineId: null, PointIndex: -1 };
        this.Gesture = null;
        this.Draft = null;
        this.PlanHover = null;
        this.ReliefHover = null;
        this.LatestPointer = null;
        this.PickInFlight = false;
        this.SculptQueue = [];
        this.Stroke = null;
        this.StaleTerrains = new Set();
        this.HandleScreens = [];
        this.ShowSplines3D = true;
        this.SpaceHeld = false;
        this.LastInteraction = 0;
        this.NeedsRender = true;
        this.DirtyRasters = new Set();
        this.LastDocumentRevision = -1;
        this.LastAutosave = 0;
        this.TickCount = 0;
        this.Metrics = { EvaluateMilliseconds: 0, EvaluateGpu: -1, ReliefGpu: -1, ReliefSubmit: 0, TickRate: 0, Layers: 0, Passes: 0, FromCache: false, Stamps: 0, TotalStamps: 0 };
        this.Regions = { Plan: null, Relief: null };
        this.ConfigureInput();
        this.RestoreDocument();
        new ResizeObserver(() => this.ResizeCanvases()).observe(this.Scene);
        this.ResizeCanvases();
        this.ReconcileFields();
        const Terrain = this.Document.RetrieveTerrain();
        if (Terrain) { this.Relief.FrameTerrain(Terrain); this.FramePlanLater = Terrain; }
        Panels.RefreshAll(this);
        this.RateWindow = { Started: performance.now(), Count: 0 };
        requestAnimationFrame(() => this.Tick());
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                DOCUMENT LIFECYCLE
    //--------------------------------------------------------------------------------------------------------------------

    RestoreDocument()
    {
        const Stored = (() => { try { return localStorage.getItem(DocumentStorageKey); } catch { return null; } })();
        if (Stored && !new URLSearchParams(location.search).has("example"))
        {
            try { this.Document.Decode(Stored); this.ArchiveRestorePending = true; return; }
            catch (Error) { console.warn("Stored document rejected", Error); }
        }
        ConstructExampleWorld(this.Document);
        this.Selection = { Category: "Layer", LayerId: this.Document.Layers.find(Layer => Layer.Category === "Sculpt").Id, SplineId: null, PointIndex: -1 };
    }

    ReleaseFields()
    {
        this.Fields.forEach(Field => Field.ReleaseAll());
        this.Fields.clear();
    }

    ResetWorld(WithExample)
    {
        this.ReleaseFields();
        this.Document.Decode(new WorldDocument().Encode());
        if (WithExample) ConstructExampleWorld(this.Document);
        this.History.Undo = [];
        this.History.Redo = [];
        this.Selection = { Category: "World", LayerId: null, SplineId: null, PointIndex: -1 };
        this.Archive.ClearAll();
        this.ReconcileFields();
        const Terrain = this.Document.RetrieveTerrain();
        if (Terrain) { this.Relief.FrameTerrain(Terrain); this.Plan.FrameRectangle(Terrain.Min, Terrain.Size); }
        else { this.Plan.Centre = [0, 0]; this.Plan.PixelsPerMetre = 0.12; }
        this.Notify(WithExample ? "Example world loaded" : "New empty world — draw a shape [D], then a bounds box [R]");
        Panels.RefreshAll(this);
        this.Invalidate();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                FIELDS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Allocates per-cell GPU fields and migrates sculpt rasters when a cell's resolution changes.
    ReconcileFields()
    {
        for (const Terrain of this.Document.Terrains)
        {
            let Field = this.Fields.get(Terrain.Id);
            if (!Field)
            {
                Field = new TerrainCellField(this.Device, Terrain.Resolution);
                Field.Anchor = { Min: [...Terrain.Min], Size: [...Terrain.Size] };
                this.Fields.set(Terrain.Id, Field);
                if (this.ArchiveRestorePending) this.RestoreRasters(Terrain, Field);
            }
            else if (Field.Resolution !== Terrain.Resolution)
            {
                const Migrated = new TerrainCellField(this.Device, Terrain.Resolution);
                Migrated.Anchor = { Min: [...Terrain.Min], Size: [...Terrain.Size] };
                Field.SculptFields.forEach((Source, LayerId) =>
                {
                    const Target = this.Pipeline.EnsureSculpt(Migrated, LayerId);
                    this.Pipeline.ResampleSculptInto(Source, Target, Field.Anchor, Migrated.Anchor);
                    Migrated.SculptRevisions.set(LayerId, (Field.SculptRevisions.get(LayerId) || 0) + 1);
                });
                Field.ReleaseAll();
                this.Fields.set(Terrain.Id, Migrated);
            }
        }
        if (this.Document.ActiveTerrain && !this.Document.RetrieveTerrain()) this.Document.ActiveTerrain = this.Document.Terrains[0]?.Id || null;
    }

    RestoreRasters(Terrain, Field)
    {
        for (const Layer of Terrain.Layers.filter(Candidate => Candidate.Category === "Sculpt"))
        {
            this.Archive.Retrieve(`${Terrain.Id}:${Layer.Id}`).then(Deltas =>
            {
                if (!Deltas || Deltas.length !== Field.Resolution * Field.Resolution || this.Fields.get(Terrain.Id) !== Field) return;
                this.Pipeline.WriteSculptField(Field, Layer.Id, Deltas);
                this.Invalidate();
            });
        }
    }

    ActiveField() { return this.Fields.get(this.Document.ActiveTerrain) || null; }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                LAYOUT
    //--------------------------------------------------------------------------------------------------------------------

    ResizeCanvases()
    {
        const Box = this.Scene.getBoundingClientRect();
        this.DevicePixels = Math.min(window.devicePixelRatio || 1, 2);
        for (const Canvas of [this.GpuCanvas, this.OverlayCanvas])
        {
            Canvas.width = Math.max(1, Math.round(Box.width * this.DevicePixels));
            Canvas.height = Math.max(1, Math.round(Box.height * this.DevicePixels));
        }
        this.SceneWidth = Box.width;
        this.SceneHeight = Box.height;
        this.ComputeRegions();
        if (this.FramePlanLater && this.Regions.Plan)
        {
            this.Plan.Region = this.Regions.Plan;
            this.Plan.FrameRectangle(this.FramePlanLater.Min, this.FramePlanLater.Size);
            this.FramePlanLater = null;
        }
        this.Invalidate();
    }

    ComputeRegions()
    {
        const W = this.SceneWidth, H = this.SceneHeight;
        if (this.Workspace === "Plan") this.Regions = { Plan: { X: 0, Y: 0, Width: W, Height: H }, Relief: null };
        else if (this.Workspace === "Relief") this.Regions = { Plan: null, Relief: { X: 0, Y: 0, Width: W, Height: H } };
        else
        {
            const Half = Math.floor((W - 2) / 2);
            this.Regions = { Plan: { X: 0, Y: 0, Width: Half, Height: H }, Relief: { X: Half + 2, Y: 0, Width: W - Half - 2, Height: H } };
        }
        if (this.Regions.Plan) this.Plan.Region = this.Regions.Plan;
        if (this.Regions.Relief) this.Relief.Region = this.Regions.Relief;
    }

    SelectWorkspace(Name)
    {
        this.Workspace = Name;
        this.ComputeRegions();
        Panels.RenderViewportHead(this);
        Panels.RenderToolRow(this);
        this.Invalidate();
    }

    SelectTool(Name)
    {
        this.FinishDraft();
        this.Tool = Name;
        if (Name === "Sculpt") this.ResolveSculptLayer(false);
        Panels.RenderToolRow(this);
        Panels.RenderInspector(this);
        this.Relief.Brush = [0, 0, 0, 0];
        this.Invalidate();
    }

    Invalidate() { this.NeedsRender = true; }

    Notify(Message)
    {
        const Toast = document.getElementById("Toast");
        Toast.textContent = Message;
        Toast.classList.add("visible");
        clearTimeout(this.ToastTimer);
        this.ToastTimer = setTimeout(() => Toast.classList.remove("visible"), 2600);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SELECTION
    //--------------------------------------------------------------------------------------------------------------------

    SelectWorld() { this.Selection = { Category: "World", LayerId: null, SplineId: null, PointIndex: -1 }; this.OnSelectionChanged(); }
    SelectTerrain(Id)
    {
        this.Document.ActiveTerrain = Id;
        this.Selection = { Category: "Terrain", LayerId: null, SplineId: null, PointIndex: -1 };
        this.OnSelectionChanged();
    }
    // 📝 Selecting content inside a region makes that region active (one region is edited at a time).
    ActivateOwner(LayerId)
    {
        const Owner = this.Document.RetrieveOwner(LayerId);
        if (Owner) this.Document.ActiveTerrain = Owner;
    }
    SelectUnassigned() { this.Selection = { Category: "Unassigned", LayerId: null, SplineId: null, PointIndex: -1 }; this.OnSelectionChanged(); }
    SelectLayer(Id) { this.ActivateOwner(Id); this.Selection = { Category: "Layer", LayerId: Id, SplineId: null, PointIndex: -1 }; this.OnSelectionChanged(); }
    SelectSpline(LayerId, SplineId, PointIndex = -1) { this.ActivateOwner(LayerId); this.Selection = { Category: "Spline", LayerId, SplineId, PointIndex }; this.OnSelectionChanged(); }

    OnSelectionChanged()
    {
        Panels.RenderViewportHead(this);
        Panels.RenderOutliner(this);
        Panels.RenderInspector(this);
        this.Invalidate();
    }

    // 📝 Sculpt strokes land in the active region: its selected sculpt layer, else its topmost one, else a new layer on
    //    top of its stack.
    ResolveSculptLayer(Create = true)
    {
        const Terrain = this.Document.RetrieveTerrain();
        if (!Terrain) return null;
        const Selected = this.Document.RetrieveLayer(this.Selection.LayerId);
        if (Selected && Selected.Category === "Sculpt" && Terrain.Layers.includes(Selected)) return Selected;
        let Layer = [...Terrain.Layers].reverse().find(Candidate => Candidate.Category === "Sculpt");
        if (!Layer && Create)
        {
            const Before = this.History.CaptureVector();
            Layer = this.Document.CreateSculptLayer("Sculpt", Terrain.Id);
            this.History.RegisterVectorEdit("Add sculpt layer", Before);
        }
        if (Layer) { this.Selection = { Category: "Layer", LayerId: Layer.Id, SplineId: null, PointIndex: -1 }; Panels.RenderOutliner(this); Panels.RenderInspector(this); }
        return Layer;
    }

    // 📝 New geometry belongs to the region under the first point (active region first where regions overlap), or to
    //    the unassigned stack outside every region. A selected layer of the same kind in that stack is reused.
    ResolveTargetOwner(World)
    {
        const Region = this.Document.ResolveRegionAt(World[0], World[1]);
        return Region ? Region.Id : null;
    }

    ResolveSplineLayer(World)
    {
        const Owner = this.ResolveTargetOwner(World);
        const Stack = this.Document.RetrieveStack(Owner);
        const Selected = this.Document.RetrieveLayer(this.Selection.LayerId);
        if (Selected && Selected.Category === "Spline" && Selected.Variant === this.SplineVariant && Stack.includes(Selected)) return Selected;
        let Layer = [...Stack].reverse().find(Candidate => Candidate.Category === "Spline" && Candidate.Variant === this.SplineVariant);
        if (!Layer) Layer = this.Document.CreateSplineLayer(this.SplineVariant, null, Owner);
        return Layer;
    }

    ResolveShapeLayer(World)
    {
        const Owner = this.ResolveTargetOwner(World);
        const Stack = this.Document.RetrieveStack(Owner);
        const Selected = this.Document.RetrieveLayer(this.Selection.LayerId);
        if (Selected && Selected.Category === "Shape" && Stack.includes(Selected)) return Selected;
        return Stack.find(Candidate => Candidate.Category === "Shape") || this.Document.CreateShapeLayer("Landmass", Owner, true);
    }

    // 📝 Owner for layers added from the outliner: the stack of the selected layer, the selected unassigned group, or
    //    the active region (unassigned when no region exists).
    ResolveOutlinerOwner()
    {
        if (this.Selection.Category === "Unassigned") return null;
        const Owner = this.Selection.LayerId ? this.Document.RetrieveOwner(this.Selection.LayerId) : undefined;
        if (Owner !== undefined) return Owner;
        return this.Document.ActiveTerrain || null;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                INPUT CONFIGURATION
    //--------------------------------------------------------------------------------------------------------------------

    ConfigureInput()
    {
        const Canvas = this.OverlayCanvas;
        Canvas.addEventListener("contextmenu", Event => Event.preventDefault());
        Canvas.addEventListener("pointerdown", Event => this.OnPointerDown(Event));
        Canvas.addEventListener("pointermove", Event => this.OnPointerMove(Event));
        Canvas.addEventListener("pointerup", Event => this.OnPointerUp(Event));
        Canvas.addEventListener("pointercancel", Event => this.OnPointerUp(Event));
        Canvas.addEventListener("pointerleave", () => { this.PlanHover = null; this.Relief.Brush = [0, 0, 0, 0]; this.Invalidate(); });
        Canvas.addEventListener("dblclick", () => { if (this.Draft) this.FinishDraft(); });
        Canvas.addEventListener("wheel", Event => this.OnWheel(Event), { passive: false });
        window.addEventListener("keydown", Event => this.OnKeyDown(Event));
        window.addEventListener("keyup", Event => { if (Event.code === "Space") this.SpaceHeld = false; });
        document.getElementById("OpenFile").addEventListener("change", Event => this.OpenProject(Event.target.files[0]));
    }

    LocatePointer(Event)
    {
        const Box = this.OverlayCanvas.getBoundingClientRect();
        const X = Event.clientX - Box.left, Y = Event.clientY - Box.top;
        for (const View of ["Plan", "Relief"])
        {
            const R = this.Regions[View];
            if (R && X >= R.X && X < R.X + R.Width && Y >= R.Y && Y < R.Y + R.Height) return { View, X: X - R.X, Y: Y - R.Y, CanvasX: X, CanvasY: Y };
        }
        return null;
    }

    OnWheel(Event)
    {
        Event.preventDefault();
        const Pointer = this.LocatePointer(Event);
        if (!Pointer) return;
        const Factor = Math.exp(-Event.deltaY * 0.0015);
        if (Pointer.View === "Plan") this.Plan.ZoomAt(Pointer.X, Pointer.Y, Factor);
        else this.Relief.Dolly(1 / Factor);
        this.Invalidate();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                POINTER DOWN
    //--------------------------------------------------------------------------------------------------------------------

    OnPointerDown(Event)
    {
        const Pointer = this.LocatePointer(Event);
        if (!Pointer) return;
        this.OverlayCanvas.setPointerCapture(Event.pointerId);
        this.LastInteraction = performance.now();
        this.LatestPointer = Pointer;
        if (Pointer.View === "Plan") this.PlanPointerDown(Event, Pointer);
        else this.ReliefPointerDown(Event, Pointer);
        this.Invalidate();
    }

    PlanPointerDown(Event, Pointer)
    {
        const World = this.Plan.ScreenToWorld(Pointer.X, Pointer.Y);
        if (Event.button === 1 || (Event.button === 0 && this.SpaceHeld)) { this.Gesture = { Category: "PlanPan", View: "Plan", Last: [Pointer.X, Pointer.Y] }; return; }
        if (Event.button === 2)
        {
            if (this.Draft) { this.FinishDraft(); return; }
            this.Gesture = { Category: "PlanPan", View: "Plan", Last: [Pointer.X, Pointer.Y] };
            return;
        }
        if (Event.button !== 0) return;
        if (this.Tool === "Shape") return this.BeginShapeStroke(World);
        if (this.Tool === "Bounds") { this.Gesture = { Category: "Bounds", View: "Plan", Start: World, End: World }; return; }
        if (this.Tool === "Sculpt") return this.BeginSculpt("Plan", { X: World[0], Z: World[1] }, Event);
        const Handle = this.HitPlanControlPoint(Pointer.X, Pointer.Y);
        if (Handle) return this.BeginPointDrag(Handle, "Plan", Pointer);
        if (this.Tool === "Spline") return this.AppendSplinePoint(World);
        const Terrain = this.Document.RetrieveTerrain();
        if (Terrain)
        {
            const HandleIndex = this.Plan.BoundsHandles(Terrain).findIndex(([Hx, Hy]) => Math.hypot(Hx - Pointer.X, Hy - Pointer.Y) < 9);
            if (HandleIndex >= 0) return this.BeginBoundsEdit(Terrain, HandleIndex, World);
            const [Lx, Ly] = this.Plan.WorldToScreen(Terrain.Min[0], Terrain.Min[1]);
            if (Pointer.X >= Lx && Pointer.X <= Lx + 260 && Pointer.Y >= Ly - 26 && Pointer.Y <= Ly - 2) return this.BeginBoundsEdit(Terrain, -1, World);
        }
        const Spline = this.HitPlanSpline(Pointer.X, Pointer.Y);
        if (Spline) { this.SelectSpline(Spline.LayerId, Spline.SplineId); return; }
        const Cell = [...this.Document.Terrains].reverse().find(Candidate => World[0] >= Candidate.Min[0] && World[1] >= Candidate.Min[1] && World[0] <= Candidate.Min[0] + Candidate.Size[0] && World[1] <= Candidate.Min[1] + Candidate.Size[1]);
        if (Cell) { this.SelectTerrain(Cell.Id); this.Gesture = { Category: "PlanPan", View: "Plan", Last: [Pointer.X, Pointer.Y] }; return; }
        this.SelectWorld();
        this.Gesture = { Category: "PlanPan", View: "Plan", Last: [Pointer.X, Pointer.Y] };
    }

    ReliefPointerDown(Event, Pointer)
    {
        if (Event.button === 1 || (Event.button === 2 && Event.shiftKey)) { this.Gesture = { Category: "ReliefPan", View: "Relief", Last: [Pointer.X, Pointer.Y] }; return; }
        if (Event.button === 2 || (Event.button === 0 && Event.altKey && this.Tool !== "Select"))
        {
            if (Event.button === 2 && this.Draft) { this.FinishDraft(); return; }
            this.Gesture = { Category: "ReliefOrbit", View: "Relief", Last: [Pointer.X, Pointer.Y] };
            return;
        }
        if (Event.button !== 0) return;
        if (this.Tool === "Sculpt")
        {
            const Ray = this.Relief.RayFromScreen(Pointer.X, Pointer.Y);
            const Hit = this.Pipeline.PickSynchronous(this.ActiveField(), this.Document, this.Document.RetrieveTerrain(), Ray.Origin, Ray.Direction);
            if (Hit) return this.BeginSculpt("Relief", Hit, Event);
            this.Gesture = { Category: "ReliefOrbit", View: "Relief", Last: [Pointer.X, Pointer.Y] };
            return;
        }
        if (this.Tool === "Select" || this.Tool === "Spline")
        {
            const Handle = this.HandleScreens.find(Candidate => Math.hypot(Candidate.X - Pointer.CanvasX, Candidate.Y - Pointer.CanvasY) < 9);
            if (Handle)
            {
                const Located = this.Document.LocateSpline(Handle.SplineId);
                if (Located) return this.BeginPointDrag({ LayerId: Located.Layer.Id, SplineId: Handle.SplineId, Index: Handle.Index, PlaneY: Handle.World[1] }, "Relief", Pointer, Event.altKey);
            }
            if (this.Tool === "Spline")
            {
                const Ray = this.Relief.RayFromScreen(Pointer.X, Pointer.Y);
                const Hit = this.Pipeline.PickSynchronous(this.ActiveField(), this.Document, this.Document.RetrieveTerrain(), Ray.Origin, Ray.Direction);
                if (Hit) return this.AppendSplinePoint([Hit.X, Hit.Z]);
            }
        }
        if (this.Tool === "Shape" || this.Tool === "Bounds") this.Notify("Shapes and bounds are drawn in the 2D workspace");
        this.Gesture = { Category: "ReliefOrbit", View: "Relief", Last: [Pointer.X, Pointer.Y] };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                POINTER MOVE / UP
    //--------------------------------------------------------------------------------------------------------------------

    OnPointerMove(Event)
    {
        const Pointer = this.LocatePointer(Event) || (this.Gesture && this.LatestPointer ? { ...this.LatestPointer } : null);
        if (!Pointer) return;
        const Gesture = this.Gesture;
        if (Gesture && Gesture.View && Pointer.View !== Gesture.View)
        {
            const Box = this.OverlayCanvas.getBoundingClientRect();
            const R = this.Regions[Gesture.View];
            Pointer.View = Gesture.View;
            Pointer.X = Event.clientX - Box.left - R.X;
            Pointer.Y = Event.clientY - Box.top - R.Y;
            Pointer.CanvasX = Event.clientX - Box.left;
            Pointer.CanvasY = Event.clientY - Box.top;
        }
        this.LatestPointer = Pointer;
        if (Pointer.View === "Plan") this.PlanHover = this.Plan.ScreenToWorld(Pointer.X, Pointer.Y);
        if (!Gesture)
        {
            if (this.Tool === "Sculpt" || Pointer.View === "Plan") this.Invalidate();
            return;
        }
        this.LastInteraction = performance.now();
        const Dx = Gesture.Last ? Pointer.X - Gesture.Last[0] : 0, Dy = Gesture.Last ? Pointer.Y - Gesture.Last[1] : 0;
        switch (Gesture.Category)
        {
            case "PlanPan": this.Plan.PanBy(Dx, Dy); break;
            case "ReliefOrbit": this.Relief.Orbit(Dx, Dy); break;
            case "ReliefPan": this.Relief.Pan(Dx, Dy); break;
            case "Bounds":
            {
                const World = this.Plan.ScreenToWorld(Pointer.X, Pointer.Y);
                if (Event.shiftKey)
                {
                    const Side = Math.max(Math.abs(World[0] - Gesture.Start[0]), Math.abs(World[1] - Gesture.Start[1]));
                    Gesture.End = [Gesture.Start[0] + Side * Math.sign(World[0] - Gesture.Start[0] || 1), Gesture.Start[1] + Side * Math.sign(World[1] - Gesture.Start[1] || 1)];
                }
                else Gesture.End = World;
                break;
            }
            case "Shape": this.ContinueShapeStroke(Pointer); break;
            case "PointDrag": this.ContinuePointDrag(Pointer, Dy, Event.altKey); break;
            case "BoundsEdit": this.ContinueBoundsEdit(this.Plan.ScreenToWorld(Pointer.X, Pointer.Y), Event.shiftKey); break;
            case "Sculpt":
                if (Gesture.Origin === "Plan")
                {
                    const World = this.Plan.ScreenToWorld(Pointer.X, Pointer.Y);
                    this.SculptQueue.push([World[0], World[1]]);
                }
                break;
            default: break;
        }
        if (Gesture.Last) Gesture.Last = [Pointer.X, Pointer.Y];
        this.Invalidate();
    }

    OnPointerUp(Event)
    {
        const Gesture = this.Gesture;
        this.Gesture = null;
        if (!Gesture) return;
        this.LastInteraction = performance.now();
        switch (Gesture.Category)
        {
            case "Bounds": this.FinishBoundsGesture(Gesture); break;
            case "Shape": this.FinishShapeStroke(Gesture); break;
            case "PointDrag": this.History.RegisterVectorEdit("Move spline point", Gesture.Before); Panels.RenderInspector(this); break;
            case "BoundsEdit": this.FinishBoundsEdit(Gesture); break;
            case "Sculpt": this.FinishSculpt(); break;
            default: break;
        }
        this.Invalidate();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SHAPES
    //--------------------------------------------------------------------------------------------------------------------

    BeginShapeStroke(World)
    {
        const Before = this.History.CaptureVector();
        const Layer = this.ResolveShapeLayer(World);
        const Stroke = { Points: [World], Subtract: this.ShapeSubtract };
        Layer.Strokes.push(Stroke);
        this.Gesture = { Category: "Shape", View: "Plan", Before, LayerId: Layer.Id, Stroke, LastScreen: this.Plan.WorldToScreen(...World) };
        if (this.Selection.LayerId !== Layer.Id) this.SelectLayer(Layer.Id);
    }

    // 📝 The in-progress stroke is part of the layer, so the landmass re-evaluates live while drawing.
    ContinueShapeStroke(Pointer)
    {
        const Gesture = this.Gesture;
        if (Math.hypot(Pointer.X - Gesture.LastScreen[0], Pointer.Y - Gesture.LastScreen[1]) < 3) return;
        Gesture.LastScreen = [Pointer.X, Pointer.Y];
        Gesture.Stroke.Points.push(this.Plan.ScreenToWorld(Pointer.X, Pointer.Y));
        const Layer = this.Document.RetrieveLayer(Gesture.LayerId);
        if (Gesture.Stroke.Points.length >= 3) this.Document.TouchLayer(Layer, true);
    }

    FinishShapeStroke(Gesture)
    {
        const Layer = this.Document.RetrieveLayer(Gesture.LayerId);
        if (!Layer) return;
        if (Gesture.Stroke.Points.length < 3)
        {
            Layer.Strokes = Layer.Strokes.filter(Candidate => Candidate !== Gesture.Stroke);
            this.Document.TouchLayer(Layer, true);
            return;
        }
        Gesture.Stroke.Points = CondenseStroke(Gesture.Stroke.Points, 0.8 / this.Plan.PixelsPerMetre);
        this.Document.TouchLayer(Layer, true);
        this.History.RegisterVectorEdit(Gesture.Stroke.Subtract ? "Subtract shape" : "Add shape", Gesture.Before);
        Panels.RenderOutliner(this);
        Panels.RenderInspector(this);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                BOUNDS
    //--------------------------------------------------------------------------------------------------------------------

    FinishBoundsGesture(Gesture)
    {
        const Min = [Math.min(Gesture.Start[0], Gesture.End[0]), Math.min(Gesture.Start[1], Gesture.End[1])];
        const Size = [Math.abs(Gesture.End[0] - Gesture.Start[0]), Math.abs(Gesture.End[1] - Gesture.Start[1])];
        if (Size[0] < 64 || Size[1] < 64) { this.Notify("Bounds too small — drag a larger box"); return; }
        const Before = this.History.CaptureVector();
        const Terrain = this.Document.CreateTerrain(Min, Size, Math.max(Size[0], Size[1]) > 6000 ? 2048 : 1024);
        this.History.RegisterVectorEdit("Add terrain cell", Before);
        this.ReconcileFields();
        this.SelectTerrain(Terrain.Id);
        if (this.Document.Terrains.length === 1) this.Relief.FrameTerrain(Terrain);
        this.Notify(`${Terrain.Name} created — only content inside these bounds is evaluated`);
    }

    // 📝 Handle index 0–7 runs clockwise from the top-left corner; −1 moves the whole cell.
    BeginBoundsEdit(Terrain, HandleIndex, World)
    {
        const Field = this.Fields.get(Terrain.Id);
        const Originals = new Map();
        Field.SculptFields.forEach((Source, LayerId) => Originals.set(LayerId, this.Pipeline.CloneSculpt(Source)));
        this.Gesture = { Category: "BoundsEdit", View: "Plan", Before: this.History.CaptureVector(), TerrainId: Terrain.Id, HandleIndex, Start: World,
                         StartMin: [...Terrain.Min], StartSize: [...Terrain.Size], Originals, OriginalAnchor: { Min: [...Field.Anchor.Min], Size: [...Field.Anchor.Size] } };
        this.SelectTerrain(Terrain.Id);
    }

    ContinueBoundsEdit(World, Square)
    {
        const Gesture = this.Gesture;
        const Terrain = this.Document.RetrieveTerrain(Gesture.TerrainId);
        const Dx = World[0] - Gesture.Start[0], Dz = World[1] - Gesture.Start[1];
        let [X0, Z0] = Gesture.StartMin, X1 = X0 + Gesture.StartSize[0], Z1 = Z0 + Gesture.StartSize[1];
        const H = Gesture.HandleIndex;
        if (H < 0) { X0 += Dx; X1 += Dx; Z0 += Dz; Z1 += Dz; }
        else
        {
            if ([0, 6, 7].includes(H)) X0 = Math.min(X0 + Dx, X1 - 64);
            if ([2, 3, 4].includes(H)) X1 = Math.max(X1 + Dx, X0 + 64);
            if ([0, 1, 2].includes(H)) Z0 = Math.min(Z0 + Dz, Z1 - 64);
            if ([4, 5, 6].includes(H)) Z1 = Math.max(Z1 + Dz, Z0 + 64);
            if (Square) { const Side = Math.max(X1 - X0, Z1 - Z0); X1 = X0 + Side; Z1 = Z0 + Side; }
        }
        Terrain.Min = [X0, Z0];
        Terrain.Size = [X1 - X0, Z1 - Z0];
        this.Document.TouchTerrain(Terrain);
        const Field = this.Fields.get(Terrain.Id);
        Field.Anchor = { Min: [...Terrain.Min], Size: [...Terrain.Size] };
        Gesture.Originals.forEach((Original, LayerId) =>
        {
            this.Pipeline.ResampleSculptInto(Original, this.Pipeline.EnsureSculpt(Field, LayerId), Gesture.OriginalAnchor, Field.Anchor);
            Field.SculptRevisions.set(LayerId, (Field.SculptRevisions.get(LayerId) || 0) + 1);
        });
    }

    FinishBoundsEdit(Gesture)
    {
        const Field = this.Fields.get(Gesture.TerrainId);
        const AfterVector = this.Document.Encode();
        if (AfterVector === Gesture.Before) { Gesture.Originals.forEach(Surface => this.Device.ReleaseTexture(Surface)); return; }
        const AfterRasters = new Map();
        Field.SculptFields.forEach((Source, LayerId) => AfterRasters.set(LayerId, this.Pipeline.CloneSculpt(Source)));
        const AfterAnchor = { Min: [...Field.Anchor.Min], Size: [...Field.Anchor.Size] };
        const Apply = (Vector, Rasters, Anchor) =>
        {
            this.Document.Decode(Vector);
            const Current = this.Fields.get(Gesture.TerrainId);
            if (!Current) return;
            Rasters.forEach((Source, LayerId) =>
            {
                const Target = this.Pipeline.EnsureSculpt(Current, LayerId);
                if (Target.Width === Source.Width) this.Device.CopyRegion(Source, Target);
                Current.SculptRevisions.set(LayerId, (Current.SculptRevisions.get(LayerId) || 0) + 1);
            });
            Current.Anchor = { Min: [...Anchor.Min], Size: [...Anchor.Size] };
        };
        this.History.RegisterRasterEdit("Edit bounds",
            () => Apply(Gesture.Before, Gesture.Originals, Gesture.OriginalAnchor),
            () => Apply(AfterVector, AfterRasters, AfterAnchor),
            () => { Gesture.Originals.forEach(Surface => this.Device.ReleaseTexture(Surface)); AfterRasters.forEach(Surface => this.Device.ReleaseTexture(Surface)); });
        this.MarkRastersDirty(Gesture.TerrainId);
        Panels.RenderInspector(this);
        Panels.RenderOutliner(this);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SPLINES
    //--------------------------------------------------------------------------------------------------------------------

    AppendSplinePoint(World)
    {
        const Before = this.History.CaptureVector();
        if (!this.Draft || !this.Document.LocateSpline(this.Draft.SplineId))
        {
            const Layer = this.ResolveSplineLayer(World);
            const Spline = { Id: IssueToken("S"), Points: [] };
            Layer.Splines.push(Spline);
            this.Draft = { LayerId: Layer.Id, SplineId: Spline.Id };
        }
        const { Layer, Spline } = this.Document.LocateSpline(this.Draft.SplineId);
        Spline.Points.push({ X: World[0], Z: World[1], Width: 1, Lift: 0 });
        this.Document.TouchLayer(Layer, true);
        this.History.RegisterVectorEdit("Add spline point", Before);
        this.SelectSpline(Layer.Id, Spline.Id, Spline.Points.length - 1);
    }

    FinishDraft()
    {
        if (!this.Draft) return;
        const Located = this.Document.LocateSpline(this.Draft.SplineId);
        this.Draft = null;
        if (Located && Located.Spline.Points.length < 2)
        {
            Located.Layer.Splines = Located.Layer.Splines.filter(Candidate => Candidate !== Located.Spline);
            this.Document.TouchLayer(Located.Layer, true);
            this.SelectLayer(Located.Layer.Id);
        }
        Panels.RenderOutliner(this);
        this.Invalidate();
    }

    // 📝 Pick order: active region's stack (top first), then every other stack.
    RetrievePickOrder()
    {
        const Active = this.Document.RetrieveTerrain();
        const First = Active ? [...Active.Layers].reverse() : [];
        return First.concat([...this.Document.Layers].reverse().filter(Layer => !First.includes(Layer)));
    }

    HitPlanControlPoint(Px, Py)
    {
        for (const Layer of this.RetrievePickOrder())
        {
            if (Layer.Category !== "Spline" || !Layer.Visible) continue;
            for (const Spline of Layer.Splines)
            {
                const Index = Spline.Points.findIndex(Point => { const [Sx, Sy] = this.Plan.WorldToScreen(Point.X, Point.Z); return Math.hypot(Sx - Px, Sy - Py) < 8; });
                if (Index >= 0) return { LayerId: Layer.Id, SplineId: Spline.Id, Index };
            }
        }
        return null;
    }

    HitPlanSpline(Px, Py)
    {
        const Atlas = this.Pipeline.Atlas;
        if (!Atlas) return null;
        for (const Layer of this.RetrievePickOrder())
        {
            if (Layer.Category !== "Spline" || !Layer.Visible) continue;
            const Range = Atlas.Ranges.get(Layer.Id);
            if (!Range) continue;
            for (const [SplineId, Dense] of Range.SampleSets)
            {
                const Near = Dense.some(Sample => { const [Sx, Sy] = this.Plan.WorldToScreen(Sample[0], Sample[1]); return Math.hypot(Sx - Px, Sy - Py) < Math.max(6, Sample[2] * this.Plan.PixelsPerMetre); });
                if (Near) return { LayerId: Layer.Id, SplineId };
            }
        }
        return null;
    }

    BeginPointDrag(Handle, View, Pointer, LiftMode = false)
    {
        this.Gesture = { Category: "PointDrag", View, Before: this.History.CaptureVector(), ...Handle, PlaneY: Handle.PlaneY ?? 0, LiftMode, Last: [Pointer.X, Pointer.Y] };
        this.SelectSpline(Handle.LayerId, Handle.SplineId, Handle.Index);
    }

    ContinuePointDrag(Pointer, Dy, AltHeld)
    {
        const Gesture = this.Gesture;
        const Located = this.Document.LocateSpline(Gesture.SplineId);
        if (!Located) return;
        const Point = Located.Spline.Points[Gesture.Index];
        if (Gesture.View === "Plan")
        {
            const World = this.Plan.ScreenToWorld(Pointer.X, Pointer.Y);
            Point.X = World[0];
            Point.Z = World[1];
        }
        else if (AltHeld || Gesture.LiftMode)
        {
            Point.Lift = (Point.Lift || 0) - Dy * this.Relief.Distance * 0.0012;
        }
        else
        {
            const Ray = this.Relief.RayFromScreen(Pointer.X, Pointer.Y);
            if (Math.abs(Ray.Direction[1]) > 1e-4)
            {
                const T = (Gesture.PlaneY - Ray.Origin[1]) / Ray.Direction[1];
                if (T > 0) { Point.X = Ray.Origin[0] + Ray.Direction[0] * T; Point.Z = Ray.Origin[2] + Ray.Direction[2] * T; }
            }
        }
        this.Document.TouchLayer(Located.Layer, true);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SCULPT
    //--------------------------------------------------------------------------------------------------------------------

    EffectiveSculptMode(Event)
    {
        let Mode = ["Raise", "Lower", "Smooth", "Flatten"].indexOf(this.Brush.Mode);
        if (Event && Event.shiftKey) Mode = 2;
        else if (Event && (Event.ctrlKey || Event.metaKey) && Mode < 2) Mode = 1 - Mode;
        return Mode;
    }

    BeginSculpt(Origin, Hit, Event)
    {
        const Terrain = this.Document.RetrieveTerrain();
        const Field = this.ActiveField();
        if (!Terrain || !Field || !Field.HasEvaluated) { this.Notify("Create a terrain cell first — Bounds tool [R] in 2D"); return; }
        const Layer = this.ResolveSculptLayer(true);
        if (!Layer.Visible) { this.Notify(`${Layer.Name} is hidden`); return; }
        const N = Field.Resolution;
        const Before = this.Pipeline.SnapshotSculptRegion(Field, Layer.Id, [0, 0, N, N]);
        const FlattenHeight = Hit.Y ?? this.Pipeline.ProbeHeight(Field, Terrain, Hit.X, Hit.Z);
        this.Stroke = { LayerId: Layer.Id, TerrainId: Terrain.Id, Before, Rect: null, Last: null, Mode: this.EffectiveSculptMode(Event), FlattenHeight, Stamps: 0 };
        this.Gesture = { Category: "Sculpt", View: Origin, Origin };
        this.SculptQueue.push([Hit.X, Hit.Z]);
    }

    // 📝 Converts queued brush positions into evenly spaced stamps (spacing ∝ radius), capped per tick.
    ConsumeSculptQueue()
    {
        if (!this.Stroke || !this.SculptQueue.length) return 0;
        const Field = this.Fields.get(this.Stroke.TerrainId);
        const Terrain = this.Document.RetrieveTerrain(this.Stroke.TerrainId);
        const Layer = this.Document.RetrieveLayer(this.Stroke.LayerId);
        if (!Field || !Terrain || !Layer) { this.SculptQueue = []; return 0; }
        const Spacing = Math.max(this.Brush.Radius * 0.18, Terrain.Size[0] / Field.Resolution);
        let Stamped = 0;
        while (this.SculptQueue.length && Stamped < StampsPerTick)
        {
            const Target = this.SculptQueue[0];
            if (!this.Stroke.Last) this.Stroke.Last = [Target[0] - Spacing * 1.0001, Target[1]];
            const Dx = Target[0] - this.Stroke.Last[0], Dz = Target[1] - this.Stroke.Last[1];
            const Length = Math.hypot(Dx, Dz);
            if (Length < Spacing) { this.SculptQueue.shift(); continue; }
            const X = this.Stroke.Last[0] + Dx / Length * Spacing, Z = this.Stroke.Last[1] + Dz / Length * Spacing;
            const Rect = this.Pipeline.StampSculpt(Field, Terrain, Layer, { X, Z, Radius: this.Brush.Radius, Strength: this.Brush.Strength, Hardness: this.Brush.Hardness, Mode: this.Stroke.Mode, FlattenHeight: this.Stroke.FlattenHeight });
            this.Stroke.Last = [X, Z];
            if (Rect)
            {
                const R = this.Stroke.Rect;
                this.Stroke.Rect = R ? [Math.min(R[0], Rect[0]), Math.min(R[1], Rect[1]), 0, 0] : [Rect[0], Rect[1], 0, 0];
                this.Stroke.RectEnd = R ? [Math.max(this.Stroke.RectEnd[0], Rect[0] + Rect[2]), Math.max(this.Stroke.RectEnd[1], Rect[1] + Rect[3])] : [Rect[0] + Rect[2], Rect[1] + Rect[3]];
            }
            if (Rect)
            {
                const P = this.PendingDirty;
                this.PendingDirty = P ? [Math.min(P[0], Rect[0]), Math.min(P[1], Rect[1]), Math.max(P[2], Rect[0] + Rect[2]), Math.max(P[3], Rect[1] + Rect[3])] : [Rect[0], Rect[1], Rect[0] + Rect[2], Rect[1] + Rect[3]];
            }
            Stamped++;
            this.Stroke.Stamps++;
        }
        this.Metrics.TotalStamps += Stamped;
        return Stamped;
    }

    FinishSculpt()
    {
        const Stroke = this.Stroke;
        if (!Stroke) return;
        while (this.SculptQueue.length) this.ConsumeSculptQueue();
        this.Stroke = null;
        const Field = this.Fields.get(Stroke.TerrainId);
        if (!Stroke.Rect || !Field) { this.Device.ReleaseTexture(Stroke.Before); return; }
        const Rect = [Stroke.Rect[0], Stroke.Rect[1], Stroke.RectEnd[0] - Stroke.Rect[0], Stroke.RectEnd[1] - Stroke.Rect[1]];
        const BeforeCrop = this.Device.CreateTexture2D(Rect[2], Rect[3], "R32F");
        this.Device.CopyRegion(Stroke.Before, BeforeCrop, Rect[0], Rect[1], Rect[2], Rect[3], 0, 0);
        this.Device.ReleaseTexture(Stroke.Before);
        const After = this.Pipeline.SnapshotSculptRegion(Field, Stroke.LayerId, Rect);
        const Restore = Snapshot => () =>
        {
            const Current = this.Fields.get(Stroke.TerrainId);
            if (Current === Field) this.Pipeline.RestoreSculptRegion(Current, Stroke.LayerId, Rect, Snapshot);
            this.MarkRastersDirty(Stroke.TerrainId);
        };
        this.History.RegisterRasterEdit(`Sculpt (${Stroke.Stamps} stamps)`, Restore(BeforeCrop), Restore(After), () => { this.Device.ReleaseTexture(BeforeCrop); this.Device.ReleaseTexture(After); });
        this.MarkRastersDirty(Stroke.TerrainId);
        Panels.RenderInspector(this);
    }

    MarkRastersDirty(TerrainId) { this.DirtyRasters.add(TerrainId); this.RasterDirtySince = performance.now(); }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                KEYBOARD AND COMMANDS
    //--------------------------------------------------------------------------------------------------------------------

    OnKeyDown(Event)
    {
        if (Event.target instanceof HTMLInputElement || Event.target instanceof HTMLSelectElement) return;
        const Control = Event.ctrlKey || Event.metaKey;
        const Key = Event.key.toLowerCase();
        if (Control && Key === "z") { Event.preventDefault(); Event.shiftKey ? this.Redo() : this.Undo(); return; }
        if (Control && Key === "y") { Event.preventDefault(); this.Redo(); return; }
        if (Control && Key === "s") { Event.preventDefault(); this.SaveProject(); return; }
        if (Control) return;
        if (Event.code === "Space") { this.SpaceHeld = true; Event.preventDefault(); return; }
        const Tools = { v: "Select", d: "Shape", r: "Bounds", p: "Spline", b: "Sculpt" };
        if (Tools[Key]) { this.SelectTool(Tools[Key]); return; }
        if (Key === "1") return this.SelectWorkspace("Plan");
        if (Key === "2") return this.SelectWorkspace("Relief");
        if (Key === "3") return this.SelectWorkspace("Split");
        if (Key === "x") { this.ShapeSubtract = !this.ShapeSubtract; Panels.RenderToolRow(this); return; }
        if (Key === "f") return this.FrameActive();
        if (Key === "[" || Key === "]") { this.Brush.Radius = Math.min(4000, Math.max(5, this.Brush.Radius * (Key === "]" ? 1.15 : 1 / 1.15))); Panels.RenderInspector(this); this.Invalidate(); return; }
        if (Key === "enter" || Key === "escape") { this.FinishDraft(); return; }
        if (Key === "delete" || Key === "backspace") { Event.preventDefault(); this.DeleteSelection(); }
    }

    FrameActive()
    {
        const Terrain = this.Document.RetrieveTerrain();
        if (!Terrain) return;
        this.Relief.FrameTerrain(Terrain);
        if (this.Regions.Plan) this.Plan.FrameRectangle(Terrain.Min, Terrain.Size);
        this.Invalidate();
    }

    AfterHistoryStep(Label, Verb)
    {
        if (!Label) return;
        this.ReconcileFields();
        if (this.Selection.LayerId && !this.Document.RetrieveLayer(this.Selection.LayerId)) this.Selection = { Category: "World", LayerId: null, SplineId: null, PointIndex: -1 };
        if (this.Selection.SplineId && !this.Document.LocateSpline(this.Selection.SplineId)) this.Selection.SplineId = null;
        this.Notify(`${Verb}: ${Label}`);
        Panels.RefreshAll(this);
        this.Invalidate();
    }

    Undo() { this.FinishDraft(); this.AfterHistoryStep(this.History.StepBack(), "Undo"); }
    Redo() { this.AfterHistoryStep(this.History.StepForward(), "Redo"); }

    // 📝 Wraps a vector mutation so it is undoable and refreshes dependent panels.
    EditVector(Label, Mutation, Geometry = true)
    {
        const Before = this.History.CaptureVector();
        Mutation();
        this.History.RegisterVectorEdit(Label, Before);
        this.ReconcileFields();
        Panels.RefreshAll(this);
        this.Invalidate();
        void Geometry;
    }

    DeleteSelection()
    {
        const S = this.Selection;
        const Layer = this.Document.RetrieveLayer(S.LayerId);
        if (S.Category === "Spline" && Layer)
        {
            const Located = this.Document.LocateSpline(S.SplineId);
            if (!Located) return;
            this.EditVector(S.PointIndex >= 0 ? "Delete spline point" : "Delete spline", () =>
            {
                if (S.PointIndex >= 0 && Located.Spline.Points.length > 2) { Located.Spline.Points.splice(S.PointIndex, 1); S.PointIndex = Math.min(S.PointIndex, Located.Spline.Points.length - 1); }
                else { Located.Layer.Splines = Located.Layer.Splines.filter(Candidate => Candidate !== Located.Spline); this.Selection = { Category: "Layer", LayerId: Layer.Id, SplineId: null, PointIndex: -1 }; }
                this.Document.TouchLayer(Located.Layer, true);
            });
        }
        else if (S.Category === "Layer" && Layer) this.EditVector("Delete layer", () => { this.Document.RemoveLayer(Layer); this.Selection = { Category: "World", LayerId: null, SplineId: null, PointIndex: -1 }; });
        else if (S.Category === "Terrain") this.DeleteTerrain(this.Document.ActiveTerrain);
    }

    DeleteTerrain(Id)
    {
        this.EditVector("Delete terrain cell", () =>
        {
            this.Document.Terrains = this.Document.Terrains.filter(Candidate => Candidate.Id !== Id);
            this.Document.ActiveTerrain = this.Document.Terrains[0]?.Id || null;
            this.Document.Revision++;
            this.Selection = { Category: "World", LayerId: null, SplineId: null, PointIndex: -1 };
        });
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                FILES
    //--------------------------------------------------------------------------------------------------------------------

    DownloadBlob(Name, Blob)
    {
        const Link = document.createElement("a");
        Link.href = URL.createObjectURL(Blob);
        Link.download = Name;
        Link.click();
        setTimeout(() => URL.revokeObjectURL(Link.href), 4000);
    }

    // 📝 Project = vector document + every non-empty sculpt raster (Float32, base64) per cell and layer.
    SaveProject()
    {
        const Rasters = [];
        for (const Terrain of this.Document.Terrains)
        {
            const Field = this.Fields.get(Terrain.Id);
            if (!Field) continue;
            for (const LayerId of Field.SculptFields.keys())
            {
                const Deltas = this.Pipeline.ReadSculptField(Field, LayerId);
                if (!Deltas) continue;
                let Binary = "";
                const Bytes = new Uint8Array(Deltas.buffer);
                for (let Offset = 0; Offset < Bytes.length; Offset += 0x8000) Binary += String.fromCharCode.apply(null, Bytes.subarray(Offset, Offset + 0x8000));
                Rasters.push({ TerrainId: Terrain.Id, LayerId, Resolution: Field.Resolution, Float32Base64: btoa(Binary) });
            }
        }
        const Archive = JSON.stringify({ Document: JSON.parse(this.Document.Encode()), Rasters });
        this.DownloadBlob("TerrainProject.frontier-terrain.json", new Blob([Archive], { type: "application/json" }));
        this.Notify(`Project saved (${Rasters.length} sculpt raster${Rasters.length === 1 ? "" : "s"})`);
    }

    async OpenProject(File)
    {
        if (!File) return;
        try
        {
            const Archive = JSON.parse(await File.text());
            const DocumentText = JSON.stringify(Archive.Document || Archive);
            this.ReleaseFields();
            this.Document.Decode(DocumentText);
            this.History.Undo = [];
            this.History.Redo = [];
            this.ArchiveRestorePending = false;
            this.ReconcileFields();
            for (const Raster of Archive.Rasters || [])
            {
                const Field = this.Fields.get(Raster.TerrainId);
                if (!Field || Field.Resolution !== Raster.Resolution) continue;
                const Binary = atob(Raster.Float32Base64);
                const Bytes = new Uint8Array(Binary.length);
                for (let Index = 0; Index < Binary.length; ++Index) Bytes[Index] = Binary.charCodeAt(Index);
                this.Pipeline.WriteSculptField(Field, Raster.LayerId, new Float32Array(Bytes.buffer));
                this.MarkRastersDirty(Raster.TerrainId);
            }
            this.Selection = { Category: "World", LayerId: null, SplineId: null, PointIndex: -1 };
            this.FrameActive();
            Panels.RefreshAll(this);
            this.Notify(`Opened ${File.name}`);
        }
        catch (Error) { this.Notify(`Open failed: ${Error.message}`); }
        document.getElementById("OpenFile").value = "";
    }

    // 📝 Authoring bake hand-off: Float32 little-endian height grid (row 0 = minimum Z) + TOML-friendly JSON sidecar.
    BakeHeightfield()
    {
        const Terrain = this.Document.RetrieveTerrain();
        const Field = this.ActiveField();
        if (!Terrain || !Field || !Field.HasEvaluated) return;
        const Heights = this.Pipeline.ReadHeightField(Field);
        let Lo = Infinity, Hi = -Infinity;
        for (const H of Heights) { Lo = Math.min(Lo, H); Hi = Math.max(Hi, H); }
        this.DownloadBlob(`${Terrain.Name.replace(/\s+/g, "")}.r32`, new Blob([Heights.buffer], { type: "application/octet-stream" }));
        const Sidecar = { Format: "Float32LE", Resolution: Field.Resolution, OriginMetres: Terrain.Min, SizeMetres: Terrain.Size, RowOrder: "MinimumZFirst", HeightRangeMetres: [Lo, Hi], TunnelVolume: Field.Tunnel ? { MinMetres: Field.Tunnel.Min, SizeMetres: Field.Tunnel.Size, Voxels: [Field.Tunnel.Volume.Width, Field.Tunnel.Volume.Depth, Field.Tunnel.Volume.Height], Note: "Tunnel carve SDF is not included in the height grid" } : null };
        this.DownloadBlob(`${Terrain.Name.replace(/\s+/g, "")}.json`, new Blob([JSON.stringify(Sidecar, null, 2)], { type: "application/json" }));
        this.Notify(`Baked ${Field.Resolution}² heightfield · ${Lo.toFixed(0)} … ${Hi.toFixed(0)} m`);
    }

    // 📝 Runs the edit-cost benchmark on this machine's GPU and keeps the table for the World inspector.
    async RunBenchmark()
    {
        if (!this.ActiveField()) { this.Notify("Create a terrain cell first"); return; }
        this.Notify("Benchmarking… the view pauses for a few seconds");
        await new Promise(Resolve => setTimeout(Resolve, 60));
        const Probe = await import("./PerformanceProbe.js");
        this.Benchmark = Probe.MeasureEditCosts(this, 5);
        this.FinishDraft();
        this.SelectWorld();
        this.DownloadBlob("TerrainAuthoringBenchmark.json", new Blob([JSON.stringify(this.Benchmark, null, 2)], { type: "application/json" }));
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                TICK SEQUENCE
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 ① readbacks ② hover/sculpt picks ③ stamps ④ evaluate active cell (from cache) ⑤ idle refresh of other cells
    //    ⑥ render plan/relief + overlays ⑦ persistence. Rendering is on demand; continuous only while interacting.
    Tick()
    {
        if (this.Paused) { requestAnimationFrame(() => this.Tick()); return; }
        const Started = performance.now();
        this.Device.PollReadbacks();
        this.Device.PollTiming((Label, Milliseconds) => { if (Label === "Evaluate") this.Metrics.EvaluateGpu = Milliseconds; else this.Metrics.ReliefGpu = Milliseconds; });
        this.ReconcileFields();
        const Terrain = this.Document.RetrieveTerrain();
        const Field = this.ActiveField();
        this.RequestReliefPick(Terrain, Field);
        const Stamped = this.ConsumeSculptQueue();
        let Evaluated = false;
        if (Terrain && Field)
        {
            this.Device.OpenTiming();
            const Dirty = this.PendingDirty;
            this.PendingDirty = null;
            const DirtyRect = Dirty ? [Dirty[0], Dirty[1], Dirty[2] - Dirty[0], Dirty[3] - Dirty[1]] : null;
            Evaluated = this.Pipeline.EvaluateCell(Field, this.Document, Terrain, { SelectedLayerId: this.Selection.LayerId, Interactive: !!this.Gesture, DirtyRect });
            this.Device.CloseTiming("Evaluate");
            Field.DocumentRevision = this.Document.Revision;
            if (Evaluated)
            {
                this.Metrics.EvaluateMilliseconds = Field.LastEvaluation.Milliseconds;
                this.Metrics.Layers = Field.LastEvaluation.Layers;
                this.Metrics.Passes = Field.LastEvaluation.Passes;
                this.Metrics.FromCache = Field.LastEvaluation.FromCache;
                this.NeedsRender = true;
            }
        }
        this.RefreshIdleCells(Started);
        if (this.Pipeline.SampleHeightsHost !== this.LastHeightsHost) { this.LastHeightsHost = this.Pipeline.SampleHeightsHost; this.NeedsRender = true; }
        if (this.NeedsRender || this.Gesture || Stamped)
        {
            this.NeedsRender = false;
            this.RenderViews(Terrain, Field);
            this.RateWindow.Count++;
        }
        this.PersistIfIdle(Started);
        const Now = performance.now();
        if (Now - this.RateWindow.Started > 1000)
        {
            this.Metrics.TickRate = this.RateWindow.Count * 1000 / (Now - this.RateWindow.Started);
            this.RateWindow = { Started: Now, Count: 0 };
            Panels.RenderFooters(this);
        }
        if (this.Gesture) this.Relief.AdaptScale(Now - Started + (this.Metrics.ReliefGpu > 0 ? this.Metrics.ReliefGpu : 0));
        else if (this.Relief.ScaleMode === "Auto" && Now - this.LastInteraction > 600 && this.Relief.Scale < 1) { this.Relief.Scale = 1; this.NeedsRender = true; }
        this.TickCount++;
        requestAnimationFrame(() => this.Tick());
    }

    RequestReliefPick(Terrain, Field)
    {
        const Pointer = this.LatestPointer;
        if (this.Tool !== "Sculpt" || !Pointer || Pointer.View !== "Relief" || this.PickInFlight || !Field) return;
        if (this.LastPickPointer && this.LastPickPointer.X === Pointer.X && this.LastPickPointer.Y === Pointer.Y) return;
        this.LastPickPointer = { X: Pointer.X, Y: Pointer.Y };
        const Ray = this.Relief.RayFromScreen(Pointer.X, Pointer.Y);
        this.PickInFlight = true;
        this.Pipeline.PickAsynchronous(Field, this.Document, Terrain, Ray.Origin, Ray.Direction, Hit =>
        {
            this.PickInFlight = false;
            if (!Hit) { this.Relief.Brush = [0, 0, 0, 0]; return; }
            this.Relief.Brush = [Hit.X, Hit.Y, Hit.Z, this.Brush.Radius];
            if (this.Stroke && this.Gesture && this.Gesture.Origin === "Relief") this.SculptQueue.push([Hit.X, Hit.Z]);
            this.Invalidate();
        });
    }

    RefreshIdleCells(Now)
    {
        this.StaleTerrains.clear();
        const Idle = Now - this.LastInteraction > IdleDelay && !this.Gesture;
        let Refreshed = false;
        for (const Terrain of this.Document.Terrains)
        {
            if (Terrain.Id === this.Document.ActiveTerrain) continue;
            const Field = this.Fields.get(Terrain.Id);
            if (!Field || Field.DocumentRevision === this.Document.Revision) continue;
            if (Idle && !Refreshed)
            {
                if (this.Pipeline.EvaluateCell(Field, this.Document, Terrain, {})) this.NeedsRender = true;
                Field.DocumentRevision = this.Document.Revision;
                Refreshed = true;
                continue;
            }
            this.StaleTerrains.add(Terrain.Id);
        }
    }

    RenderViews(Terrain, Field)
    {
        const GL = this.Device.GL;
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        GL.viewport(0, 0, this.GpuCanvas.width, this.GpuCanvas.height);
        GL.clearColor(0.15, 0.15, 0.15, 1);
        GL.clear(GL.COLOR_BUFFER_BIT);
        if (this.Regions.Plan) this.Plan.Render(this.Regions.Plan, this.DevicePixels, this.GpuCanvas.height, this.Document, this.Fields);
        if (this.Regions.Relief)
        {
            if (this.Tool === "Sculpt" && this.Relief.Brush[3] > 0) this.Relief.Brush[3] = this.Brush.Radius;
            if (this.Tool !== "Sculpt") this.Relief.Brush = [0, 0, 0, 0];
            this.Device.OpenTiming();
            this.Metrics.ReliefSubmit = this.Relief.Render(this.Regions.Relief, this.DevicePixels, this.GpuCanvas.height, this.Document, Field, Terrain);
            this.Device.CloseTiming("Relief");
        }
        const Context = this.Overlay;
        Context.setTransform(this.DevicePixels, 0, 0, this.DevicePixels, 0, 0);
        Context.clearRect(0, 0, this.SceneWidth, this.SceneHeight);
        this.HandleScreens = [];
        if (this.Regions.Plan) this.Plan.RenderOverlay(Context, this.Document, this);
        if (this.Regions.Relief) this.Relief.RenderOverlay(Context, this.Document, this);
        Context.font = "500 9px 'DM Sans', sans-serif";
        for (const [View, Label] of [["Plan", "2D PLAN · INFINITE WORLD"], ["Relief", "3D RELIEF · SDF RAYMARCH"]])
        {
            const R = this.Regions[View];
            if (!R) continue;
            Context.fillStyle = "rgba(0,0,0,0.55)";
            Context.beginPath();
            Context.roundRect(R.X + 10, R.Y + 10, Context.measureText(Label).width + 16, 18, 8);
            Context.fill();
            Context.fillStyle = "rgba(255,255,255,0.75)";
            Context.fillText(Label, R.X + 18, R.Y + 22);
        }
        if (this.Workspace === "Split" && this.Regions.Plan)
        {
            Context.fillStyle = "#262626";
            Context.fillRect(this.Regions.Plan.Width, 0, 2, this.SceneHeight);
        }
    }

    PersistIfIdle(Now)
    {
        if (this.Gesture) return;
        if (this.Document.Revision !== this.LastDocumentRevision && Now - this.LastAutosave > 800)
        {
            this.LastDocumentRevision = this.Document.Revision;
            this.LastAutosave = Now;
            try { localStorage.setItem(DocumentStorageKey, this.Document.Encode()); } catch { /* storage unavailable */ }
            Panels.RenderOutliner(this);
        }
        if (this.DirtyRasters.size && Now - this.RasterDirtySince > 1500)
        {
            for (const TerrainId of this.DirtyRasters)
            {
                const Field = this.Fields.get(TerrainId);
                if (!Field) continue;
                Field.SculptFields.forEach((_, LayerId) =>
                {
                    const Deltas = this.Pipeline.ReadSculptField(Field, LayerId);
                    this.Archive.Store(`${TerrainId}:${LayerId}`, Deltas);
                });
            }
            this.DirtyRasters.clear();
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    MAIN
//------------------------------------------------------------------------------------------------------------------------

try
{
    window.TerrainAuthoring = new AuthoringSession();
}
catch (Error)
{
    const Panel = document.createElement("div");
    Panel.className = "fatal";
    Panel.textContent = `Terrain authoring could not start.\n\n${Error.message}`;
    document.body.appendChild(Panel);
    console.error(Error);
}
