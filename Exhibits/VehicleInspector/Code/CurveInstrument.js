//============================================================================================================================================
//                                                          CURVEINSTRUMENT.JS
//============================================================================================================================================
// 🧩 The editable curve plot: grid, filled polyline, draggable keys, hover readout — one instrument for every editable table.

// 📝 Drawn on a canvas rather than in the DOM because a key is a dragged disc on a continuous axis: 18 torque keys, a
//    hover crosshair and a live sampler are cheaper to paint than to lay out. The instrument knows nothing about which
//    curve it edits — it receives { Points, Field, Accent } and reports edits back through the callbacks, so the vehicle
//    card, a tyre card and a future suspension-travel curve all mount the same code.

import { SampleCurve } from './VehicleSpecification.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                         CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const PlotPadding = { Left: 44, Right: 14, Top: 14, Bottom: 26 };   // [px] - Axis gutters inside the canvas
const KeyRadius = 4.6;                                             // [px] - Drawn disc radius
const KeyRadiusActive = 6.4;                                       // [px] - Hovered / selected disc radius
const KeyHitRadius = 13;                                           // [px] - Pointer hit radius around a key
const GridRows = 4;                                                // [grid lines] - Horizontal divisions
const GridColumns = 6;                                             // [grid lines] - Vertical divisions
const DevicePixelCeiling = 2;                                      // [-] - Device pixel ratio ceiling for the backing store

// 📝 Palette mirrors Style/VehicleInspector.css so the canvas sits inside the card without a second design language.
const Palette = Object.freeze({
    Plot: '#141414',
    Grid: '#242424',
    GridStrong: '#333333',
    Axis: '#5c5c5c',
    AxisText: '#7c7c7c',
    Curve: '#e1d34a',
    CurveFillTop: 'rgba(225, 211, 74, 0.16)',
    CurveFillBottom: 'rgba(225, 211, 74, 0.0)',
    KeyRing: '#1f1f1f',
    KeyFill: '#e8e8e8',
    KeySelected: '#ffffff',
    Crosshair: '#4a4a4a',
    ReadoutText: '#d6d6d6',
    ReadoutBack: 'rgba(20, 20, 20, 0.86)'
});

//------------------------------------------------------------------------------------------------------------------------
//                                                       INSTRUMENT
//------------------------------------------------------------------------------------------------------------------------

export class CurveInstrument
{
    // Canvas: the <canvas class="curve-plot">. Handlers: { OnMove(Index, X, Y), OnSelect(Index), OnAdd(X, Y) }.
    constructor(Canvas, Handlers)
    {
        this.Canvas = Canvas;
        this.Context = Canvas.getContext('2d');
        this.Handlers = Handlers || {};
        this.Points = [];
        this.Field = null;
        this.Accent = Palette.Curve;
        this.SelectedIndex = -1;
        this.HoverIndex = -1;
        this.PointerX = null;
        this.DragIndex = -1;
        this.DragMoved = false;
        this.InstallPointerHandling();
    }

    // -- Binding -----------------------------------------------------------------------------------------------------------

    SetCurve(Points, Field, Accent)
    {
        this.Points = Points;
        this.Field = Field;
        this.Accent = Accent || Palette.Curve;
        this.SelectedIndex = Math.min(this.SelectedIndex, Points.length - 1);
        this.Paint();
    }

    // -- Geometry ----------------------------------------------------------------------------------------------------------

    QueryPlotRect()
    {
        const Width = this.Canvas.clientWidth || 320;
        const Height = this.Canvas.clientHeight || 168;
        return {
            X: PlotPadding.Left,
            Y: PlotPadding.Top,
            Width: Math.max(10, Width - PlotPadding.Left - PlotPadding.Right),
            Height: Math.max(10, Height - PlotPadding.Top - PlotPadding.Bottom)
        };
    }

    ProjectKey(Point, Rect)
    {
        const [XLow, XHigh] = this.Field.XBounds;
        const [YLow, YHigh] = this.Field.YBounds;
        const T = (Point[0] - XLow) / (XHigh - XLow);
        const U = (Point[1] - YLow) / (YHigh - YLow);
        return { X: Rect.X + T * Rect.Width, Y: Rect.Y + (1 - U) * Rect.Height };
    }

    UnprojectPoint(PixelX, PixelY, Rect)
    {
        const [XLow, XHigh] = this.Field.XBounds;
        const [YLow, YHigh] = this.Field.YBounds;
        const T = (PixelX - Rect.X) / Rect.Width;
        const U = 1 - (PixelY - Rect.Y) / Rect.Height;
        return [XLow + T * (XHigh - XLow), YLow + U * (YHigh - YLow)];
    }

    QueryKeyAt(PixelX, PixelY)
    {
        const Rect = this.QueryPlotRect();
        for (let Index = 0; Index < this.Points.length; ++Index)
        {
            const Projected = this.ProjectKey(this.Points[Index], Rect);
            const Distance = Math.hypot(Projected.X - PixelX, Projected.Y - PixelY);
            if (Distance <= KeyHitRadius) return Index;
        }
        return -1;
    }

    // -- Pointer -----------------------------------------------------------------------------------------------------------

    InstallPointerHandling()
    {
        const Canvas = this.Canvas;
        const LocalPointer = (Event) =>
        {
            const Bounds = Canvas.getBoundingClientRect();
            return { X: Event.clientX - Bounds.left, Y: Event.clientY - Bounds.top };
        };

        Canvas.addEventListener('pointerdown', (Event) =>
        {
            if (!this.Field) return;
            const Pointer = LocalPointer(Event);
            const Hit = this.QueryKeyAt(Pointer.X, Pointer.Y);
            Canvas.setPointerCapture(Event.pointerId);
            if (Hit >= 0)
            {
                this.DragIndex = Hit;
                this.DragMoved = false;
                this.SelectedIndex = Hit;
                if (this.Handlers.OnSelect) this.Handlers.OnSelect(Hit);
                this.Paint();
                return;
            }
            // 📝 A press on empty plot space adds a key there and immediately starts dragging it: two gestures become one.
            const Rect = this.QueryPlotRect();
            if (Pointer.X < Rect.X - 2 || Pointer.X > Rect.X + Rect.Width + 2
                || Pointer.Y < Rect.Y - 2 || Pointer.Y > Rect.Y + Rect.Height + 2) return;
            const Unprojected = this.UnprojectPoint(Pointer.X, Pointer.Y, Rect);
            if (this.Handlers.OnAdd)
            {
                const Added = this.Handlers.OnAdd(Unprojected[0], Unprojected[1]);
                if (Added >= 0) { this.DragIndex = Added; this.SelectedIndex = Added; this.DragMoved = false; this.Paint(); }
            }
        });

        Canvas.addEventListener('pointermove', (Event) =>
        {
            if (!this.Field) return;
            const Pointer = LocalPointer(Event);
            this.PointerX = Pointer.X;
            this.HoverIndex = this.QueryKeyAt(Pointer.X, Pointer.Y);
            if (this.DragIndex >= 0 && this.Handlers.OnMove)
            {
                const Rect = this.QueryPlotRect();
                const Unprojected = this.UnprojectPoint(
                    Math.min(Math.max(Pointer.X, Rect.X), Rect.X + Rect.Width),
                    Math.min(Math.max(Pointer.Y, Rect.Y), Rect.Y + Rect.Height), Rect);
                this.DragMoved = true;
                this.Handlers.OnMove(this.DragIndex, Unprojected[0], Unprojected[1]);
            }
            this.Paint();
        });

        const EndDrag = () =>
        {
            this.DragIndex = -1;
            this.DragMoved = false;
            this.Paint();
        };
        Canvas.addEventListener('pointerup', EndDrag);
        Canvas.addEventListener('pointercancel', EndDrag);
        Canvas.addEventListener('pointerleave', () =>
        {
            this.PointerX = null;
            this.HoverIndex = -1;
            this.Paint();
        });
    }

    // -- Painting ----------------------------------------------------------------------------------------------------------

    Paint()
    {
        if (!this.Field || !this.Canvas) return;
        // 📝 The owning window is read from the canvas, not the module's global: an embedding page or a headless host can
        //    tear its window down without leaving this paint pointing at freed globals.
        const View = this.Canvas.ownerDocument.defaultView || window;
        const Ratio = Math.min(View.devicePixelRatio || 1, DevicePixelCeiling);
        const Width = this.Canvas.clientWidth || 320;
        const Height = this.Canvas.clientHeight || 168;
        if (this.Canvas.width !== Math.round(Width * Ratio) || this.Canvas.height !== Math.round(Height * Ratio))
        {
            this.Canvas.width = Math.round(Width * Ratio);
            this.Canvas.height = Math.round(Height * Ratio);
        }
        const Context = this.Context;
        Context.setTransform(Ratio, 0, 0, Ratio, 0, 0);
        Context.clearRect(0, 0, Width, Height);

        const Rect = this.QueryPlotRect();
        Context.fillStyle = Palette.Plot;
        Context.fillRect(Rect.X, Rect.Y, Rect.Width, Rect.Height);
        this.PaintGrid(Rect);
        this.PaintCurve(Rect);
        this.PaintKeys(Rect);
        this.PaintAxisLabels(Rect);
        this.PaintReadout(Rect, Width, Height);
    }

    PaintGrid(Rect)
    {
        const Context = this.Context;
        const [XLow, XHigh] = this.Field.XBounds;
        const [YLow, YHigh] = this.Field.YBounds;

        Context.lineWidth = 1;
        Context.strokeStyle = Palette.Grid;
        Context.beginPath();
        for (let Row = 1; Row < GridRows; ++Row)
        {
            const Y = Math.round(Rect.Y + (Rect.Height * Row) / GridRows) + 0.5;
            Context.moveTo(Rect.X, Y);
            Context.lineTo(Rect.X + Rect.Width, Y);
        }
        for (let Column = 1; Column < GridColumns; ++Column)
        {
            const X = Math.round(Rect.X + (Rect.Width * Column) / GridColumns) + 0.5;
            Context.moveTo(X, Rect.Y);
            Context.lineTo(X, Rect.Y + Rect.Height);
        }
        Context.stroke();

        // 📝 Zero line: on a curve whose field spans zero (a grip offset, an offset torque) the origin row is emphasised.
        if (YLow < 0 && YHigh > 0)
        {
            const ZeroY = Math.round(Rect.Y + Rect.Height * (1 - (0 - YLow) / (YHigh - YLow))) + 0.5;
            Context.strokeStyle = Palette.GridStrong;
            Context.beginPath();
            Context.moveTo(Rect.X, ZeroY);
            Context.lineTo(Rect.X + Rect.Width, ZeroY);
            Context.stroke();
        }
        void XLow;
        void XHigh;
    }

    PaintCurve(Rect)
    {
        if (this.Points.length < 2) return;
        const Context = this.Context;
        const Projected = this.Points.map((Point) => this.ProjectKey(Point, Rect));

        // 📝 Filled area under the curve: the accent at 16 % over the plot floor, so the shaded mass distinguishes a
        //    "curve card" from a plain grid at a glance, exactly as in the reference dashboard's efficiency chart.
        const Gradient = Context.createLinearGradient(0, Rect.Y, 0, Rect.Y + Rect.Height);
        Gradient.addColorStop(0, this.HexToRgba(this.Accent, 0.20));
        Gradient.addColorStop(1, this.HexToRgba(this.Accent, 0.0));
        Context.beginPath();
        Context.moveTo(Projected[0].X, Rect.Y + Rect.Height);
        for (const Point of Projected) Context.lineTo(Point.X, Point.Y);
        Context.lineTo(Projected[Projected.length - 1].X, Rect.Y + Rect.Height);
        Context.closePath();
        Context.fillStyle = Gradient;
        Context.fill();

        Context.beginPath();
        Context.moveTo(Projected[0].X, Projected[0].Y);
        for (const Point of Projected) Context.lineTo(Point.X, Point.Y);
        Context.lineWidth = 1.8;
        Context.lineJoin = 'round';
        Context.strokeStyle = this.Accent;
        Context.stroke();
    }

    PaintKeys(Rect)
    {
        const Context = this.Context;
        for (let Index = 0; Index < this.Points.length; ++Index)
        {
            const Projected = this.ProjectKey(this.Points[Index], Rect);
            const Active = Index === this.SelectedIndex || Index === this.HoverIndex;
            Context.beginPath();
            Context.arc(Projected.X, Projected.Y, Active ? KeyRadiusActive : KeyRadius, 0, Math.PI * 2);
            Context.fillStyle = Index === this.SelectedIndex ? Palette.KeySelected : Palette.KeyFill;
            Context.fill();
            Context.lineWidth = 2;
            Context.strokeStyle = Palette.KeyRing;
            Context.stroke();
        }
    }

    PaintAxisLabels(Rect)
    {
        const Context = this.Context;
        Context.font = '9px "DM Sans", sans-serif';
        Context.fillStyle = Palette.AxisText;
        Context.textBaseline = 'middle';

        const [YLow, YHigh] = this.Field.YBounds;
        for (let Row = 0; Row <= GridRows; ++Row)
        {
            const Value = YLow + ((YHigh - YLow) * (GridRows - Row)) / GridRows;
            const Y = Rect.Y + (Rect.Height * Row) / GridRows;
            Context.textAlign = 'right';
            Context.fillText(this.FormatAxis(Value, this.Field.YPrecision), Rect.X - 8, Y);
        }

        const [XLow, XHigh] = this.Field.XBounds;
        Context.textBaseline = 'top';
        for (let Column = 0; Column <= GridColumns; Column += 2)
        {
            const Value = XLow + ((XHigh - XLow) * Column) / GridColumns;
            const X = Rect.X + (Rect.Width * Column) / GridColumns;
            Context.textAlign = Column === 0 ? 'left' : (Column === GridColumns ? 'right' : 'center');
            Context.fillText(this.FormatAxis(Value, this.Field.XPrecision), X, Rect.Y + Rect.Height + 7);
        }

        // 📝 Axis captions sit in the gutters: y unit at the top left, x unit at the bottom right, both in the unit colour.
        Context.textAlign = 'left';
        Context.textBaseline = 'top';
        Context.fillStyle = this.Accent;
        Context.fillText(`${this.Field.YLabel} · ${this.Field.YUnit}`, Rect.X - 40, 0);
        Context.textAlign = 'right';
        Context.textBaseline = 'bottom';
        Context.fillText(`${this.Field.XLabel} · ${this.Field.XUnit}`, Rect.X + Rect.Width, Rect.Y + Rect.Height + 24);
    }

    // 📝 Hover readout: a crosshair at the pointer plus the sampled curve value at that x, drawn as a small panel in the
    //    plot's top-right corner. The value is sampled with the engine's own lookup so the readout is the solver's answer.
    PaintReadout(Rect, Width, Height)
    {
        if (this.PointerX === null || !this.Field) return;
        const Context = this.Context;
        const ClampedX = Math.min(Math.max(this.PointerX, Rect.X), Rect.X + Rect.Width);
        const [XLow, XHigh] = this.Field.XBounds;
        const AxisX = XLow + ((ClampedX - Rect.X) / Rect.Width) * (XHigh - XLow);
        const Sampled = SampleCurve(this.Points, AxisX);
        const [YLow, YHigh] = this.Field.YBounds;
        const SampleY = Rect.Y + Rect.Height * (1 - (Sampled - YLow) / (YHigh - YLow));

        Context.strokeStyle = Palette.Crosshair;
        Context.lineWidth = 1;
        Context.beginPath();
        Context.moveTo(Math.round(ClampedX) + 0.5, Rect.Y);
        Context.lineTo(Math.round(ClampedX) + 0.5, Rect.Y + Rect.Height);
        Context.stroke();

        Context.beginPath();
        Context.arc(ClampedX, SampleY, 3, 0, Math.PI * 2);
        Context.fillStyle = this.Accent;
        Context.fill();
        Context.lineWidth = 2;
        Context.strokeStyle = Palette.KeyRing;
        Context.stroke();

        const Text = `${this.FormatAxis(AxisX, this.Field.XPrecision)} ${this.Field.XUnit}  ·  `
                   + `${this.FormatAxis(Sampled, this.Field.YPrecision)} ${this.Field.YUnit}`;
        Context.font = '10px "DM Sans", sans-serif';
        const TextWidth = Context.measureText(Text).width;
        const PanelWidth = TextWidth + 16;
        const PanelX = Math.min(Rect.X + Rect.Width - PanelWidth, Math.max(Rect.X, ClampedX + 10));
        const PanelY = Rect.Y + 8;
        Context.fillStyle = Palette.ReadoutBack;
        this.RoundRect(Context, PanelX, PanelY, PanelWidth, 22, 8);
        Context.fill();
        Context.strokeStyle = '#2f2f2f';
        Context.lineWidth = 1;
        this.RoundRect(Context, PanelX, PanelY, PanelWidth, 22, 8);
        Context.stroke();
        Context.fillStyle = Palette.ReadoutText;
        Context.textAlign = 'left';
        Context.textBaseline = 'middle';
        Context.fillText(Text, PanelX + 8, PanelY + 11);
        void Height;
        void Width;
    }

    // -- Helpers -----------------------------------------------------------------------------------------------------------

    FormatAxis(Value, Precision)
    {
        if (Math.abs(Value) >= 10000) return `${Math.round(Value / 1000)}k`;
        return Value.toFixed(Precision);
    }

    HexToRgba(Hex, Alpha)
    {
        const Clean = Hex.replace('#', '');
        const R = parseInt(Clean.substring(0, 2), 16);
        const G = parseInt(Clean.substring(2, 4), 16);
        const B = parseInt(Clean.substring(4, 6), 16);
        return `rgba(${R}, ${G}, ${B}, ${Alpha})`;
    }

    RoundRect(Context, X, Y, Width, Height, Radius)
    {
        Context.beginPath();
        Context.moveTo(X + Radius, Y);
        Context.lineTo(X + Width - Radius, Y);
        Context.quadraticCurveTo(X + Width, Y, X + Width, Y + Radius);
        Context.lineTo(X + Width, Y + Height - Radius);
        Context.quadraticCurveTo(X + Width, Y + Height, X + Width - Radius, Y + Height);
        Context.lineTo(X + Radius, Y + Height);
        Context.quadraticCurveTo(X, Y + Height, X, Y + Height - Radius);
        Context.lineTo(X, Y + Radius);
        Context.quadraticCurveTo(X, Y, X + Radius, Y);
        Context.closePath();
    }
}
