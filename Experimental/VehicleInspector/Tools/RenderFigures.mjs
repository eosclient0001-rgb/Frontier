//============================================================================================================================================
//                                                        RENDERFIGURES.MJS
//============================================================================================================================================
// 🧩 Draws the vehicle inspector prototype's panels to PNG figures from the same specification the prototype uses.

// ⚠️ These are not screenshots. No browser runtime exists in this environment (Chromium cannot start: the sandbox image has no
//    libnss3/libgbm and no package source), so the figures are produced by this script: it lays the inspector out with the CSS
//    metrics of Experimental/VehicleInspector/Style/VehicleInspector.css and fills every value from the prototype's own modules
//    (VehicleSpecification.js, InspectorModel.js). They are evidence of what the panel contains and how it reads, NOT of the
//    browser's pixel output. The runtime behaviour is covered separately by Tools/InspectorValidation.mjs.
//
//    Layout constants below are transcribed from the stylesheet; where they drift, the stylesheet wins and this file is wrong.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { decompress } from 'wawoff2';

import {
    ConstructVehicleSpecification, LoadAllAuthors, CurveFields, SampleCurve, PeakOfCurve, TyreCompounds, UnitSystems
} from '../Source/VehicleSpecification.js';
import {
    EvaluateTorqueCurve, EvaluateVehicleReadings, EvaluateTyreGrip, QueryCorner
} from '../Source/InspectorModel.js';

const Here = dirname(fileURLToPath(import.meta.url));
const Root = resolve(Here, '..');
const ImagesRoot = resolve(Root, '../../Exhibits/VehicleInspector/Images');
const FontDir = resolve(Here, '.fonts');

//------------------------------------------------------------------------------------------------------------------------
//                                                         PALETTE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Every colour is the stylesheet's value; nothing is invented for the figures.
const C = Object.freeze({
    ground: '#101010', column: '#161616', edge: '#2a2a2a', text: '#dcdcdc', muted: '#7d7d7d',
    cardTop: '#222222', cardBottom: '#1f1f1f', cardEdge: '#2f2f2f',
    vehicle: '#e1d34a', on: '#3ec46d', warn: '#e0a24a',
    unitMass: '#b9c3d4', unitLength: '#8fb2e8', unitTorque: '#e1d34a', unitThermal: '#ef8f52',
    unitPressure: '#6fd08c', unitFraction: '#b9a4e8', unitRate: '#7fd0d0',
    rail: '#444444', railFill: '#c5c5c5', numberBack: '#151515', numberEdge: '#333333'
});

const UnitColour = (UnitClass) => ({
    'unit-mass': C.unitMass, 'unit-length': C.unitLength, 'unit-torque': C.unitTorque, 'unit-thermal': C.unitThermal,
    'unit-pressure': C.unitPressure, 'unit-fraction': C.unitFraction, 'unit-rate': C.unitRate
}[UnitClass] || C.unitFraction);

//------------------------------------------------------------------------------------------------------------------------
//                                                        SVG BUILDER
//------------------------------------------------------------------------------------------------------------------------

function Escape(Text)
{
    return String(Text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 📝 Rough advance widths for DM Sans at 1 em; only used to right-align numbers and to avoid overflowing a card, so an
//    approximation is enough and no font metrics library is needed.
function TextWidth(Text, Size, Weight = 400)
{
    const Factor = Weight >= 500 ? 0.545 : (Weight <= 300 ? 0.485 : 0.515);
    let Width = 0;
    for (const Character of String(Text))
    {
        if (Character === ' ') Width += 0.26 * Size;
        else if ('iljI.,:;|!'.includes(Character)) Width += 0.24 * Size;
        else if ('mwMW'.includes(Character)) Width += 0.8 * Size;
        else if (Character >= '0' && Character <= '9') Width += 0.56 * Size;
        else Width += Factor * Size;
    }
    return Width;
}

class SvgCanvas
{
    constructor(Width, Height)
    {
        this.Width = Width;
        this.Height = Height;
        this.Parts = [];
        this.Defs = [];
    }

    Rect(X, Y, Width, Height, Fill, Radius = 0, Stroke = null, StrokeWidth = 1)
    {
        const StrokeAttrs = Stroke ? ` stroke="${Stroke}" stroke-width="${StrokeWidth}"` : '';
        this.Parts.push(`<rect x="${X.toFixed(2)}" y="${Y.toFixed(2)}" width="${Width.toFixed(2)}" height="${Height.toFixed(2)}"
            rx="${Radius}" fill="${Fill}"${StrokeAttrs}/>`);
        return this;
    }

    GradientRect(Id, X, Y, Width, Height, Radius, Stroke)
    {
        this.Defs.push(`<linearGradient id="${Id}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${C.cardTop}"/><stop offset="1" stop-color="${C.cardBottom}"/></linearGradient>`);
        this.Parts.push(`<rect x="${X.toFixed(2)}" y="${Y.toFixed(2)}" width="${Width.toFixed(2)}" height="${Height.toFixed(2)}"
            rx="${Radius}" fill="url(#${Id})" stroke="${Stroke}" stroke-width="1"/>`);
        return this;
    }

    Text(X, Y, Content, Size, Fill, Weight = 400, Anchor = 'start', LetterSpacing = 0, Opacity = 1)
    {
        const Spacing = LetterSpacing ? ` letter-spacing="${LetterSpacing}"` : '';
        const Alpha = Opacity === 1 ? '' : ` opacity="${Opacity}"`;
        this.Parts.push(`<text x="${X.toFixed(2)}" y="${Y.toFixed(2)}" font-family="DM Sans" font-size="${Size}"
            font-weight="${Weight}" fill="${Fill}" text-anchor="${Anchor}"${Spacing}${Alpha}>${Escape(Content)}</text>`);
        return this;
    }

    Line(X1, Y1, X2, Y2, Stroke, Width = 1, Dash = null)
    {
        const DashAttrs = Dash ? ` stroke-dasharray="${Dash}"` : '';
        this.Parts.push(`<line x1="${X1.toFixed(2)}" y1="${Y1.toFixed(2)}" x2="${X2.toFixed(2)}" y2="${Y2.toFixed(2)}"
            stroke="${Stroke}" stroke-width="${Width}"${DashAttrs}/>`);
        return this;
    }

    Path(Data, Stroke, Width = 1.6, Fill = 'none', Dash = null, Opacity = 1)
    {
        const DashAttrs = Dash ? ` stroke-dasharray="${Dash}"` : '';
        this.Parts.push(`<path d="${Data}" fill="${Fill}" stroke="${Stroke}" stroke-width="${Width}"
            stroke-linejoin="round" stroke-linecap="round"${DashAttrs} opacity="${Opacity}"/>`);
        return this;
    }

    Circle(Cx, Cy, Radius, Fill, Stroke = null, StrokeWidth = 1)
    {
        const StrokeAttrs = Stroke ? ` stroke="${Stroke}" stroke-width="${StrokeWidth}"` : '';
        this.Parts.push(`<circle cx="${Cx.toFixed(2)}" cy="${Cy.toFixed(2)}" r="${Radius}" fill="${Fill}"${StrokeAttrs}/>`);
        return this;
    }

    Clip(Id, X, Y, Width, Height)
    {
        this.Defs.push(`<clipPath id="${Id}"><rect x="${X}" y="${Y}" width="${Width}" height="${Height}"/></clipPath>`);
        return this;
    }

    BeginGroup(Attributes)
    {
        this.Parts.push(`<g ${Attributes}>`);
        return this;
    }

    EndGroup()
    {
        this.Parts.push('</g>');
        return this;
    }

    Markup(Fragment)
    {
        this.Parts.push(Fragment);
        return this;
    }

    Serialize(Background)
    {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.Width}" height="${this.Height}"
            viewBox="0 0 ${this.Width} ${this.Height}">
            <defs>${this.Defs.join('')}</defs>
            <rect width="${this.Width}" height="${this.Height}" fill="${Background}"/>
            ${this.Parts.join('\n')}
        </svg>`;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      GLYPH PATHS
//------------------------------------------------------------------------------------------------------------------------

// 📝 The glyph paths come from the retained editor set (EditorIcons.js, lucide ISC). Only the ones the figures draw are listed;
//    Glyphs in that file remain the single authority.
const GlyphSource = readFileSync(resolve(Root, 'Source/EditorIcons.js'), 'utf8');
function GlyphPaths(Name)
{
    const Match = GlyphSource.match(new RegExp(`    ${Name}: '([^']*)'`));
    return Match ? Match[1] : '';
}

function Glyph(Target, Name, X, Y, Size, Colour, StrokeWidth = 1.6)
{
    const Scale = Size / 24;
    Target.BeginGroup(`transform="translate(${X} ${Y}) scale(${Scale})" fill="none" stroke="${Colour}"
        stroke-width="${StrokeWidth}" stroke-linecap="round" stroke-linejoin="round"`);
    Target.Markup(GlyphPaths(Name));
    Target.EndGroup();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   INSPECTOR LAYOUT
//------------------------------------------------------------------------------------------------------------------------

// 📝 Metrics transcribed from Style/VehicleInspector.css.
const M = Object.freeze({
    PaddingX: 16, ContentTop: 20, CardGap: 12, CardPad: 18, CardRadius: 18,
    HeadingSize: 12, EyebrowSize: 9, HeaderSize: 19, LabelSize: 10, StatLabelSize: 9, StatValueSize: 17,
    UnitSize: 10, RailHeight: 3, RailThumb: 11, ControlGap: 8, ControlTop: 14,
    NumberBack: '#151515'
});

class CardLayout
{
    constructor(Target, X, Y, Width, Accent, Index, Title, GlyphName, Subtitle)
    {
        this.Target = Target;
        this.X = X;
        this.Width = Width;
        this.Pad = M.CardPad;
        this.Y = Y;
        this.Inner = Width - 2 * M.CardPad;
        this.StartY = Y;
    }

    // 📝 Card frame: gradient body, 1 px #2f2f2f edge, heading row with the accent glyph and a two-digit index.
    static Open(Target, X, Y, Width, Accent, Index, Title, GlyphName, Subtitle)
    {
        const Layout = new CardLayout(Target, X, Y, Width, Accent, Index, Title, GlyphName, Subtitle);
        // 📝 The card body is drawn before its own frame height is known, so the frame rect is inserted at the index the
        //    card started at: in SVG, paint order is document order, and a frame appended last would cover its content.
        Layout.FrameIndex = Target.Parts.length;
        let Cursor = Y + M.CardPad;
        Glyph(Target, GlyphName, X + M.CardPad, Cursor - 11, 15, Accent);
        Target.Text(X + M.CardPad + 24, Cursor + 2, Title, M.HeadingSize, '#c9c9c9');
        Target.Text(X + Width - M.CardPad, Cursor + 2, Index, 9, '#4f4f4f', 400, 'end', 1);
        Cursor += 18;
        if (Subtitle)
        {
            Target.Text(X + M.CardPad, Cursor + 2, Subtitle.toUpperCase(), 9, '#737373', 400, 'start', 1.4);
            Cursor += 18;
        }
        Layout.Cursor = Cursor;
        return Layout;
    }

    Close(Ident)
    {
        const Height = this.Cursor - this.StartY + 4;
        const Frame = `<rect x="${this.X.toFixed(2)}" y="${this.StartY.toFixed(2)}" width="${this.Width.toFixed(2)}"
            height="${Height.toFixed(2)}" rx="${M.CardRadius}" fill="url(#${Ident})" stroke="${C.cardEdge}" stroke-width="1"/>`;
        this.Target.Defs.push(`<linearGradient id="${Ident}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${C.cardTop}"/><stop offset="1" stop-color="${C.cardBottom}"/></linearGradient>`);
        this.Target.Parts.splice(this.FrameIndex, 0, Frame);
        return this.StartY + Height;
    }

    Move(Dy) { this.Cursor += Dy; return this; }

    // 📝 Metric row: one large weight-300 number, its unit in 14 px, and a pill on the right.
    Metric(Value, Unit, PillText, PillTone)
    {
        this.Target.Text(this.X + this.Pad, this.Cursor + 30, Value, 38, '#dfdfdf', 300, 'start', -1.8);
        const ValueWidth = TextWidth(Value, 38, 300);
        this.Target.Text(this.X + this.Pad + ValueWidth + 6, this.Cursor + 30, Unit, 14, '#7d7d7d', 300);

        const PillWidth = TextWidth(PillText, 9) + 18;
        const PillX = this.X + this.Width - this.Pad - PillWidth;
        const PillFill = PillTone === 'live' ? '#1d2c22' : (PillTone === 'warm' ? '#2c2416' : '#2c2c2c');
        const PillEdge = PillTone === 'live' ? '#2f6d45' : (PillTone === 'warm' ? '#6a5124' : '#414141');
        const PillInk = PillTone === 'live' ? '#9be3b5' : (PillTone === 'warm' ? '#f0c27a' : '#bcbcbc');
        this.Target.Rect(PillX, this.Cursor + 12, PillWidth, 22, PillFill, 20, PillEdge);
        this.Target.Text(PillX + PillWidth / 2, this.Cursor + 27, PillText, 9, PillInk, 400, 'middle');
        this.Cursor += 46;
        return this;
    }

    // 📝 A metric whose value is words rather than a number ("Removed", "No tyre", "—"): the 38 px dash reads as a rule, so
    //    text metrics drop to 26 px and keep the unit slot for the caption.
    MetricText(Text, Caption, PillText, PillTone)
    {
        this.Target.Text(this.X + this.Pad, this.Cursor + 24, Text, 26, '#cfcfcf', 300, 'start', -0.6);
        this.Target.Text(this.X + this.Pad + TextWidth(Text, 26, 300) + 14, this.Cursor + 24, Caption, 13, '#7d7d7d', 300);
        const PillWidth = TextWidth(PillText, 9) + 18;
        const PillX = this.X + this.Width - this.Pad - PillWidth;
        const PillFill = PillTone === 'live' ? '#1d2c22' : (PillTone === 'warm' ? '#2c2416' : '#2c2c2c');
        const PillEdge = PillTone === 'live' ? '#2f6d45' : (PillTone === 'warm' ? '#6a5124' : '#414141');
        const PillInk = PillTone === 'live' ? '#9be3b5' : (PillTone === 'warm' ? '#f0c27a' : '#bcbcbc');
        this.Target.Rect(PillX, this.Cursor + 12, PillWidth, 22, PillFill, 20, PillEdge);
        this.Target.Text(PillX + PillWidth / 2, this.Cursor + 27, PillText, 9, PillInk, 400, 'middle');
        this.Cursor += 42;
        return this;
    }

    // 📝 Stat grid: label above, value + coloured unit on the baseline. Columns are equal shares of the inner width.
    Stats(Rows, Columns, RawValues)
    {
        const Gap = 12;
        const ColumnWidth = (this.Inner - Gap * (Columns - 1)) / Columns;
        for (let Row = 0; Row < Rows.length; Row += Columns)
        {
            const Slice = Rows.slice(Row, Row + Columns);
            Slice.forEach((Entry, Column) =>
            {
                const X = this.X + this.Pad + Column * (ColumnWidth + Gap);
                this.Target.Text(X, this.Cursor + 9, Entry.Label, M.StatLabelSize, '#8a8a8a');
                const ValueColour = Entry.Tone === 'warm' ? C.warn : UnitColour(Entry.Class);
                this.Target.Text(X, this.Cursor + 30, Entry.Value, M.StatValueSize, ValueColour, 300);
                this.Target.Text(X + TextWidth(Entry.Value, M.StatValueSize, 300) + 5, this.Cursor + 30, Entry.Unit, 10, '#858585');
            });
            this.Cursor += 38;
        }
        return this;
    }

    Divider(TopGap = 16, BottomGap = 14)
    {
        this.Cursor += TopGap;
        this.Target.Line(this.X + this.Pad, this.Cursor, this.X + this.Width - this.Pad, this.Cursor, '#ffffff0b', 1);
        this.Cursor += BottomGap;
        return this;
    }

    // 📝 One control: label left, number field with its unit right, then the 3 px rail with its filled portion.
    Control(Label, Value, Unit, UnitClass, Minimum, Maximum, Digits)
    {
        this.Target.Text(this.X + this.Pad, this.Cursor + 10, Label, M.LabelSize, '#a3a3a3');
        const FieldWidth = 96;
        const FieldX = this.X + this.Width - this.Pad - FieldWidth;
        this.Target.Rect(FieldX, this.Cursor, FieldWidth, 24, M.NumberBack, 8, C.numberEdge);
        const Shown = Number(Value).toFixed(Digits);
        this.Target.Text(FieldX + FieldWidth - 12 - TextWidth(Unit, 9) - 6, this.Cursor + 16, Shown, 11, '#e2e2e2', 400, 'end');
        this.Target.Text(FieldX + FieldWidth - 9, this.Cursor + 16, Unit, 9, UnitColour(UnitClass), 400, 'end');

        const Ratio = Math.min(1, Math.max(0, (Number(Value) - Minimum) / (Maximum - Minimum)));
        const RailY = this.Cursor + 31;
        this.Target.Rect(this.X + this.Pad, RailY - 1.5, this.Inner, M.RailHeight, C.rail, 10);
        this.Target.Rect(this.X + this.Pad, RailY - 1.5, this.Inner * Ratio, M.RailHeight, C.railFill, 10);
        this.Target.Circle(this.X + this.Pad + this.Inner * Ratio, RailY, 5.5, '#e5e5e5', '#222222', 4);
        this.Cursor += 52;
        return this;
    }

    Muted(Text, Lines)
    {
        for (const Line of Lines)
        {
            this.Target.Text(this.X + this.Pad, this.Cursor + 8, Line, 10, '#7d7d7d');
            this.Cursor += 15;
        }
        this.Cursor += 4;
        void Text;
        return this;
    }

    SwitchRow(Label, Detail, On)
    {
        this.Target.Text(this.X + this.Pad, this.Cursor + 9, Label, 11, '#c4c4c4');
        this.Target.Text(this.X + this.Pad, this.Cursor + 22, Detail, 9, '#727272');
        const ToggleX = this.X + this.Width - this.Pad - 40;
        const ToggleY = this.Cursor;
        this.Target.Rect(ToggleX, ToggleY, 40, 23, On ? C.on : '#3a3a3a', 23, On ? '#53d684' : '#484848');
        this.Target.Circle(ToggleX + (On ? 26 : 12), ToggleY + 11.5, 8.5, On ? '#f4f4f4' : '#9c9c9c');
        this.Cursor += 36;
        return this;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CURVE PLOT
//------------------------------------------------------------------------------------------------------------------------

// 📝 The plot mirrors CurveInstrument.js: grid, filled polyline, key discs, hover crosshair and readout panel. The geometry is
//    recomputed here for SVG; the sampler is the prototype's own SampleCurve.
function DrawCurvePlot(Target, X, Y, Width, Height, Points, Field, Accent, HoverX)
{
    const Padding = { Left: 44, Right: 14, Top: 14, Bottom: 26 };
    const PlotX = X + Padding.Left, PlotY = Y + Padding.Top;
    const PlotWidth = Width - Padding.Left - Padding.Right;
    const PlotHeight = Height - Padding.Top - Padding.Bottom;
    const [XLow, XHigh] = Field.XBounds;
    const [YLow, YHigh] = Field.YBounds;
    const Project = ([Px, Py]) => [PlotX + ((Px - XLow) / (XHigh - XLow)) * PlotWidth,
                                  PlotY + (1 - (Py - YLow) / (YHigh - YLow)) * PlotHeight];

    Target.Rect(X, Y, Width, Height, '#141414', 12, '#262626');
    for (let Row = 1; Row < 4; ++Row)
    {
        const GridY = PlotY + (PlotHeight * Row) / 4;
        Target.Line(PlotX, GridY, PlotX + PlotWidth, GridY, '#242424');
    }
    for (let Column = 1; Column < 6; ++Column)
    {
        const GridX = PlotX + (PlotWidth * Column) / 6;
        Target.Line(GridX, PlotY, GridX, PlotY + PlotHeight, '#242424');
    }

    const Projected = Points.map(Project);
    const Area = [`M ${Projected[0][0].toFixed(2)} ${(PlotY + PlotHeight).toFixed(2)}`]
        .concat(Projected.map((Point) => `L ${Point[0].toFixed(2)} ${Point[1].toFixed(2)}`))
        .concat([`L ${Projected[Projected.length - 1][0].toFixed(2)} ${(PlotY + PlotHeight).toFixed(2)}`, 'Z']).join(' ');
    Target.Defs.push(`<linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${Accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${Accent}" stop-opacity="0"/>
        </linearGradient>`);
    Target.Path(Area, 'none', 0, 'url(#curveFill)');
    Target.Path(Projected.map((Point, Index) => `${Index === 0 ? 'M' : 'L'} ${Point[0].toFixed(2)} ${Point[1].toFixed(2)}`).join(' '),
             Accent, 1.8, 'none');

    for (const Point of Projected) Target.Circle(Point[0], Point[1], 4.6, '#e8e8e8', '#1f1f1f', 2);

    Target.Text(PlotX - 40, Y - 5, `${Field.YLabel} · ${Field.YUnit}`, 9, Accent);
    Target.Text(PlotX + PlotWidth, Y + Height - 3, `${Field.XLabel} · ${Field.XUnit}`, 9, Accent, 400, 'end');
    for (let Row = 0; Row <= 4; ++Row)
    {
        const Value = YLow + ((YHigh - YLow) * (4 - Row)) / 4;
        const Label = Math.abs(Value) >= 10000 ? `${Math.round(Value / 1000)}k` : Value.toFixed(Field.YPrecision);
        Target.Text(PlotX - 8, PlotY + (PlotHeight * Row) / 4 + 3, Label, 9, '#7c7c7c', 400, 'end');
    }
    for (let Column = 0; Column <= 6; Column += 2)
    {
        const Value = XLow + ((XHigh - XLow) * Column) / 6;
        const Anchor = Column === 0 ? 'start' : (Column === 6 ? 'end' : 'middle');
        Target.Text(PlotX + (PlotWidth * Column) / 6, PlotY + PlotHeight + 15,
                 Math.abs(Value) >= 10000 ? `${Math.round(Value / 1000)}k` : Value.toFixed(Field.XPrecision), 9, '#7c7c7c', 400, Anchor);
    }

    if (HoverX !== undefined && HoverX !== null)
    {
        const Clamped = Math.min(Math.max(HoverX, XLow), XHigh);
        const AxisX = Clamped;
        const Sampled = SampleCurve(Points, AxisX);
        const HoverPx = Project([AxisX, Sampled]);
        Target.Line(HoverPx[0], PlotY, HoverPx[0], PlotY + PlotHeight, '#4a4a4a', 1);
        Target.Circle(HoverPx[0], HoverPx[1], 3, Accent, '#1f1f1f', 2);
        const Label = `${AxisX.toFixed(Field.XPrecision)} ${Field.XUnit}  ·  ${Sampled.toFixed(Field.YPrecision)} ${Field.YUnit}`;
        const PanelWidth = TextWidth(Label, 10) + 16;
        const PanelX = Math.min(PlotX + PlotWidth - PanelWidth - 6, Math.max(PlotX + 6, HoverPx[0] + 10));
        Target.Rect(PanelX, PlotY + 8, PanelWidth, 22, '#141414', 8, '#2f2f2f');
        Target.Text(PanelX + 8, PlotY + 23, Label, 10, '#d6d6d6');
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   INSPECTOR COLUMN
//------------------------------------------------------------------------------------------------------------------------

function Present(Value, Unit, Digits)
{
    return { Value: Number(Value).toFixed(Digits), Unit };
}

function Stat(Label, Value, Unit, UnitClass, Tone)
{
    return { Label, Value, Unit, Class: UnitClass, Tone };
}

// 📝 The vehicle inspector column: header, switches, unit toggle and the cards, in the prototype's order.
function DrawVehicleInspector(Target, X, Y, Width, Height, Specification, Options = {})
{
    const Readings = EvaluateVehicleReadings(Specification);
    const Torque = EvaluateTorqueCurve(Specification.Curves.Torque, Specification.Powertrain.RedlineRpm);
    const ClipId = `inspectorClip${Math.round(X)}${Math.round(Y)}`;
    Target.Clip(ClipId, X, Y, Width, Height);
    Target.BeginGroup(`clip-path="url(#${ClipId})"`);
    Target.Rect(X, Y, Width, Height, '#171717');

    const Inner = X + M.PaddingX;
    const InnerWidth = Width - 2 * M.PaddingX;
    let Cursor = Y + M.ContentTop;

    Target.Text(Inner, Cursor + 7, 'VEHICLE · PROTO-X WEDGE COUPE', M.EyebrowSize, '#898989', 400, 'start', 1.7);
    Cursor += 18;
    Target.Text(Inner, Cursor + 15, 'ControlVehicle', M.HeaderSize, C.text, 400, 'start', -0.5);
    Target.Text(X + Width - M.PaddingX, Cursor + 14, 'Refit tyres', 10, '#8a8a8a', 400, 'end');
    Cursor += 24;
    Target.Text(Inner, Cursor + 8, 'ControlVehicle.blend — sockets, mass and powertrain read', 10, '#7d7d7d');
    Cursor += 14;
    Target.Text(Inner, Cursor + 8, 'from the engine sources, editable here.', 10, '#7d7d7d');
    Cursor += 20;

    // -- Property switches (four) ----------------------------------------------------------------------------------------
    const Switches = [['Body', 'Car'], ['Powertrain', 'Gauge'], ['Tyre set', 'CircleDot'], ['Suspension', 'Activity']];
    const SwitchWidth = (InnerWidth - 24) / 4;
    Switches.forEach(([Label, GlyphName], Index) =>
    {
        const SwitchX = Inner + Index * (SwitchWidth + 8);
        Target.Rect(SwitchX, Cursor, SwitchWidth, 78, '#202020', 16, '#323232');
        Target.Rect(SwitchX + SwitchWidth / 2 - 15, Cursor + 12, 30, 30, '#2f6d45', 10);
        Glyph(Target, GlyphName, SwitchX + SwitchWidth / 2 - 8, Cursor + 19, 16, '#d9f5e3');
        Target.Text(SwitchX + SwitchWidth / 2, Cursor + 58, Label, 10, '#cfcfcf', 400, 'middle');
        Target.Text(SwitchX + SwitchWidth / 2, Cursor + 70, 'ON', 8, '#7fd39d', 400, 'middle', 1.2);
    });
    Cursor += 90;

    // -- Unit toggle ------------------------------------------------------------------------------------------------------
    Target.Rect(Inner, Cursor, InnerWidth, 34, '#121212', 11, '#262626');
    Target.Rect(Inner + 4, Cursor + 4, (InnerWidth - 8) / 2, 26, '#2e2e2e', 8);
    Target.Text(Inner + 4 + (InnerWidth - 8) / 4, Cursor + 21, 'SI · Nm · kg · kPa', 10, '#f0f0f0', 400, 'middle');
    Target.Text(Inner + 4 + 3 * (InnerWidth - 8) / 4, Cursor + 21, 'Imperial · lb-ft · lb · psi', 10, '#8b8b8b', 400, 'middle');
    Cursor += 46;

    // -- Card 01: identity ------------------------------------------------------------------------------------------------
    let Card = CardLayout.Open(Target, Inner, Cursor, InnerWidth, C.vehicle, '01', 'Identity & body', 'Car',
                               'Authored asset · measured sockets');
    Card.Metric(String(Specification.Body.MassKg), 'kg', `${Readings.FittedTyres}/4 tyres fitted`, 'live');
    Card.Stats([Stat('Wheelbase', '3.396', 'm', 'unit-length'), Stat('Track front', '2.095', 'm', 'unit-length'),
                Stat('Overall length', '5.975', 'm', 'unit-length')], 3);
    Card.Muted('', ['VehicleGeometry.h (ControlVehicleSockets). Sockets are read from the', 'authored asset, not estimated; a tyre can be taken off']);
    Cursor = Card.Close(`card01${Math.round(X)}${Math.round(Y)}`) + M.CardGap;

    // -- Card 02: body ----------------------------------------------------------------------------------------------------
    Card = CardLayout.Open(Target, Inner, Cursor, InnerWidth, C.vehicle, '02', 'Body & mass', 'Box', 'Bound to VehicleGeometry');
    Card.Control('Mass', Specification.Body.MassKg, 'kg', 'unit-mass', 600, 2200, 0);
    Card.Control('Centre of mass height', Specification.Body.CoMHeightM, 'm', 'unit-length', 0.2, 1.0, 2);
    Card.Control('Wheelbase', Specification.Body.WheelbaseM, 'm', 'unit-length', 1.5, 5.0, 3);
    Card.Control('Front weight', Specification.Body.FrontWeightFraction * 100, '%', 'unit-fraction', 30, 70, 1);
    Card.Divider();
    Card.Stats([Stat('Sprung mass', Readings.SprungMassKg.toFixed(0), 'kg', 'unit-mass'),
                Stat('Unsprung', Readings.UnsprungMassKg.toFixed(0), 'kg', 'unit-mass'),
                Stat('Front load', (Readings.FrontLoadN / 9.81).toFixed(0), 'kg', 'unit-mass'),
                Stat('Rollover', Readings.RolloverThresholdG.toFixed(2), 'g', 'unit-fraction')], 4);
    Cursor = Card.Close(`card02${Math.round(X)}${Math.round(Y)}`) + M.CardGap;

    // -- Card 03: powertrain ----------------------------------------------------------------------------------------------
    Card = CardLayout.Open(Target, Inner, Cursor, InnerWidth, C.vehicle, '03', 'Powertrain', 'Gauge', 'Drivetrain.h · DefaultGTR');
    Card.Control('Idle speed', Specification.Powertrain.IdleRpm, 'rpm', 'unit-rate', 400, 1500, 0);
    Card.Control('Redline', Specification.Powertrain.RedlineRpm, 'rpm', 'unit-rate', 3000, 10000, 0);
    Card.Control('Wastegate ceiling', Specification.Powertrain.WastegateMaxBar, 'bar', 'unit-rate', 0.2, 2.5, 2);
    Card.Divider();
    Card.Stats([Stat('Peak torque', Torque.PeakTorqueNm.toFixed(0), 'Nm', 'unit-torque'),
                Stat('at', Torque.PeakTorqueRpm.toFixed(0), 'rpm', 'unit-rate'),
                Stat('Peak power', Torque.PeakPowerKw.toFixed(0), 'kW', 'unit-torque')], 3);
    Cursor = Card.Close(`card03${Math.round(X)}${Math.round(Y)}`) + M.CardGap;

    if (Options.StopAfterPowertrain) { Target.EndGroup(); return Cursor; }

    // -- Card 04: performance ---------------------------------------------------------------------------------------------
    Card = CardLayout.Open(Target, Inner, Cursor, InnerWidth, C.vehicle, '04', 'Performance (derived)', 'TrendingUp',
                           'Computed from the curve and the mass');
    Card.Metric(String(Math.round(Readings.WheelTorqueFirstGearNm)), 'Nm at the wheel', '1st gear · peak torque', 'warm');
    Card.Stats([Stat('Specific power', Readings.SpecificPowerKwPerTonne.toFixed(0), 'kW', 'unit-torque'),
                Stat('Yaw inertia', Readings.YawInertiaKgm2.toFixed(0), 'kg·m²', 'unit-mass'),
                Stat('Rollover limit', Readings.RolloverThresholdG.toFixed(2), 'g', 'unit-fraction')], 3);
    Cursor = Card.Close(`card04${Math.round(X)}${Math.round(Y)}`) + M.CardGap;

    // -- Card 05: tyre set ------------------------------------------------------------------------------------------------
    Card = CardLayout.Open(Target, Inner, Cursor, InnerWidth, C.vehicle, '05', 'Tyre set', 'CircleDot',
                           'Volumetric tyre physics · pressure · wear · failure');
    const ChipWidth = (Card.Inner - 3 * 8) / 4;
    Specification.Corners.forEach((Corner, Index) =>
    {
        const ChipX = Card.X + Card.Pad + Index * (ChipWidth + 8);
        const ChipY = Card.Cursor;
        const ChipHeight = 92;
        Target.Rect(ChipX, ChipY, ChipWidth, ChipHeight, Corner.Fitted ? '#191919' : '#161616', 12, Corner.Fitted ? '#2c2c2c' : '#343434');
        Target.Text(ChipX + 9, ChipY + 18, Corner.Key, 9, '#8a8a8a', 400, 'start', 1.2);
        Target.Circle(ChipX + ChipWidth - 13, ChipY + 15, 3.5, Corner.Fitted ? C.on : '#6a6a6a');
        Target.Text(ChipX + 9, ChipY + 42, Corner.Fitted ? String(Math.round(Corner.PressureKpa)) : '—', 15, '#dedede', 300);
        Target.Text(ChipX + 9 + TextWidth(String(Math.round(Corner.PressureKpa)), 15, 300) + 4, ChipY + 42,
                 Corner.Fitted ? 'kPa' : 'no tyre', 9, '#7c7c7c');
        Target.Text(ChipX + 9, ChipY + 60, Corner.Fitted ? `${Math.round(Corner.SurfaceK - 273.15)} °C` : 'in the bay', 9, '#8a8a8a');
        Target.Text(ChipX + 9, ChipY + 76, Corner.Fitted ? `${Math.round(Corner.WearFraction * 100)}% worn` : TyreCompounds[Specification.TyreSet.Compound].Label, 9, '#8a8a8a');
    });
    Card.Cursor += 104;
    Card.Control('Front cold pressure', Specification.TyreSet.ColdPressureFrontKpa, 'kPa', 'unit-pressure', 80, 400, 0);
    Card.Control('Rear cold pressure', Specification.TyreSet.ColdPressureRearKpa, 'kPa', 'unit-pressure', 80, 400, 0);
    Card.SwitchRow('Tread wear', 'Sliding work abrades the tread, faster when hot', Specification.TyreSet.Wear);
    Card.SwitchRow('Failure', 'Worn through, cooked or over-pressured tyres burst', Specification.TyreSet.Failure);
    Card.Divider(6, 14);
    Card.Stats([Stat('Optimum tread', (Specification.TyreSet.OptimumTemperatureK - 273.15).toFixed(0), '°C', 'unit-thermal'),
                Stat('Grip floor at', (Specification.TyreSet.GripFadeTemperatureK - 273.15).toFixed(0), '°C', 'unit-thermal'),
                Stat('Minimum grip', (Specification.TyreSet.MinimumGripFactor * 100).toFixed(0), '%', 'unit-fraction')], 3);
    Cursor = Card.Close(`card05${Math.round(X)}${Math.round(Y)}`) + M.CardGap;

    // -- Card 07: curve ---------------------------------------------------------------------------------------------------
    Card = CardLayout.Open(Target, Inner, Cursor, InnerWidth, C.vehicle, '07', 'Curve · Torque', 'Gauge',
                           'Drivetrain.h · DefaultGTR, 18 keys');
    const FieldKey = Options.CurveField || 'Torque';
    const Field = CurveFields[FieldKey];
    const Points = Specification.Curves[FieldKey];
    Target.Rect(Card.X + Card.Pad, Card.Cursor, (Card.Inner - 8) * 0.52, 32, '#191919', 9, '#393939');
    Target.Text(Card.X + Card.Pad + 8, Card.Cursor + 21, 'Engine torque', 10, '#c8c8c8');
    Target.Rect(Card.X + Card.Pad + (Card.Inner - 8) * 0.52 + 8, Card.Cursor, (Card.Inner - 8) * 0.48 - 8 + 8, 32, '#191919', 9, '#393939');
    Target.Text(Card.X + Card.Pad + (Card.Inner - 8) * 0.52 + 16, Card.Cursor + 21, 'GTR preset-1', 10, '#c8c8c8');
    Card.Cursor += 44;
    DrawCurvePlot(Target, Card.X + Card.Pad, Card.Cursor, Card.Inner, 168, Points, Field, Field.Accent, Options.HoverX);
    Card.Cursor += 180;

    Target.Rect(Card.X + Card.Pad, Card.Cursor, 96, 24, M.NumberBack, 8, C.numberEdge);
    Target.Text(Card.X + Card.Pad + 96 - 10 - 18 - 7, Card.Cursor + 16, '4800', 11, '#e2e2e2', 400, 'end');
    Target.Text(Card.X + Card.Pad + 96 - 10, Card.Cursor + 16, 'rpm', 9, C.unitRate, 400, 'end');
    Target.Rect(Card.X + Card.Pad + 104, Card.Cursor, 96, 24, M.NumberBack, 8, C.numberEdge);
    Target.Text(Card.X + Card.Pad + 104 + 96 - 10 - 14 - 7, Card.Cursor + 16, '520', 11, '#e2e2e2', 400, 'end');
    Target.Text(Card.X + Card.Pad + 104 + 96 - 10, Card.Cursor + 16, 'Nm', 9, C.unitTorque, 400, 'end');
    Card.Cursor += 40;
    const Peak = PeakOfCurve(Points);
    Card.Stats([Stat('Peak', Peak.Y.toFixed(0), Field.YUnit, 'unit-torque'),
                Stat('at', Peak.X.toFixed(0), Field.XUnit, 'unit-rate'),
                Stat('Keys', String(Points.length), '', 'unit-fraction')], 3);
    Cursor = Card.Close(`card07${Math.round(X)}${Math.round(Y)}`) + M.CardGap;

    Target.EndGroup();
    return Cursor;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      OUTLINER COLUMN
//------------------------------------------------------------------------------------------------------------------------

function DrawOutliner(Target, X, Y, Width, Height, Specification)
{
    Target.Rect(X, Y, Width, Height, C.column);
    let Cursor = Y + 34;
    Target.Rect(X, Y, Width, 34, '#0d0d0d');
    Target.Text(X + 16, Cursor - 11, 'Outliner', 11, '#cfcfcf');
    Target.Line(X + Width - 1, Y, X + Width - 1, Y + Height, C.edge);

    Cursor = Y + 20 + 24;
    Target.Text(X + 22, Cursor, 'Frontier', 23, '#e8e8e8', 500, 'start', -1.1);
    Target.Text(X + Width - 22, Cursor, '0.4 · VEHICLE', 9, '#6f6f6f', 500, 'end', 1.4);
    Cursor += 30;
    Target.Text(X + 24, Cursor, 'SCENE', 9, '#717171', 600, 'start', 1.6);
    Target.Circle(X + Width - 24, Cursor - 3, 2.5, C.on);
    Cursor += 24;
    Target.Text(X + 24, Cursor, 'Proving Grounds', 16, C.text, 400, 'start', -0.4);
    Cursor += 22;

    // Count tiles
    const TileWidth = (Width - 32) / 2;
    [['Enabled', '7', true], ['No tyre', '0', false]].forEach(([Label, Value, Live], Index) =>
    {
        const TileX = X + 16 + Index * (TileWidth + 9);
        Target.Rect(TileX, Cursor, TileWidth, 62, '#1c1c1c', 14, '#2c2c2c');
        Target.Circle(TileX + 23, Cursor + 22, 11, Live ? C.on : '#2c2c2c');
        Target.Text(TileX + TileWidth - 13, Cursor + 34, Value, 27, '#e6e6e6', 300, 'end', -1);
        Target.Text(TileX + 12, Cursor + 55, Label, 10, '#9a9a9a');
    });
    Cursor += 78;

    Target.Rect(X + 20, Cursor, Width - 28, 34, '#1d1d1d', 8, '#282828');
    Target.Text(X + 36, Cursor + 22, 'Search name or type', 11, '#767676');
    Cursor += 50;

    const Groups = [
        ['Render', [['Render settings', 'Editor', false]]],
        ['Environment', [['Sun', '38°', false], ['Atmosphere', 'Rayleigh', false]]],
        ['Forcefield', [['Wind', '7 m/s', false]]],
        ['Objects', [['Proving ground', '43 m', false]]],
        ['Vehicle', [['ControlVehicle', '4/4 tyres', true], ['Tyre · FL', '220 kPa', false, true],
                     ['Tyre · FR', '220 kPa', false, true], ['Tyre · RL', '220 kPa', false, true],
                     ['Tyre · RR', '220 kPa', false, true], ['Tyre marks', '0 m', false, true]]],
        ['Effects', [['Smoke & fire', 'idle', false]]],
        ['Destruction', [['Fracture', '4/4', false]]],
        ['Level', [['Chase camera', 'Orbit', false]]]
    ];
    for (const [GroupName, Rows] of Groups)
    {
        Target.Text(X + 24, Cursor, GroupName, 10, '#818181', 400, 'start', 0.3);
        Target.Text(X + Width - 20, Cursor, String(Rows.length), 9, '#575757', 400, 'end');
        Cursor += 14;
        for (const [Name, Meta, Selected, Nested] of Rows)
        {
            const RowY = Cursor;
            if (Selected)
            {
                Target.Rect(X + 16, RowY, Width - 30, 38, '#2d2d2d', 8, '#434343');
                Target.Rect(X + 12, RowY + 11, 2, 16, C.vehicle, 1);
            }
            const GlyphName = Name.startsWith('Tyre ·') ? 'CircleDot' : (Name === 'ControlVehicle' ? 'Car' : 'Box');
            Glyph(Target, GlyphName, X + (Nested ? 38 : 24), RowY + 12, 15, Selected ? C.vehicle : '#848484');
            Target.Text(X + (Nested ? 62 : 48), RowY + 24, Name, 12, Selected ? '#f1f1f1' : '#a3a3a3');
            Target.Text(X + Width - 32, RowY + 24, Meta, 9, '#666666', 400, 'end');
            Cursor += 40;
        }
        Cursor += 6;
    }
    void Specification;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       STAGE VIEW
//------------------------------------------------------------------------------------------------------------------------

// 📝 The stage as the prototype draws it on canvas: plan view from the bound sockets, body outline, centre of mass, tyres with
//    their wear bar and dashed socket rings for removed tyres, plus the readout box. Same geometry, different rasteriser.
function DrawStage(Target, X, Y, Width, Height, Specification)
{
    Target.Rect(X, Y, Width, Height, '#0c0c0c');
    const CentreX = X + Width * 0.5;
    const CentreY = Y + Height * 0.54;
    const Body = Specification.Body;
    const ModelLength = Math.max(Body.WheelbaseM * 1.2, Body.OverallLengthM);
    const ModelWidth = Math.max(Body.TrackFrontM * 0.9, Body.OverallWidthM);
    const Scale = Math.min((Width * 0.7) / ModelLength, (Height * 0.66) / (ModelWidth * 1.4));

    for (let Metres = -14; Metres <= 14; Metres += 1)
    {
        const GridX = CentreX + Metres * Scale;
        const GridY = CentreY + Metres * Scale;
        if (GridX > X && GridX < X + Width) Target.Line(GridX, Y + 52, GridX, Y + Height, '#191919');
        if (GridY > Y + 52 && GridY < Y + Height) Target.Line(X, GridY, X + Width, GridY, '#191919');
    }

    const HalfLength = (ModelLength / 2) * Scale;
    const HalfWidth = (ModelWidth / 2) * Scale;
    const Outline = [
        [CentreX + HalfLength, CentreY - HalfWidth * 0.42],
        [CentreX + HalfLength * 0.72, CentreY - HalfWidth],
        [CentreX - HalfLength * 0.84, CentreY - HalfWidth],
        [CentreX - HalfLength, CentreY - HalfWidth * 0.72],
        [CentreX - HalfLength, CentreY + HalfWidth * 0.72],
        [CentreX - HalfLength * 0.84, CentreY + HalfWidth],
        [CentreX + HalfLength * 0.72, CentreY + HalfWidth],
        [CentreX + HalfLength, CentreY + HalfWidth * 0.42]
    ];
    Target.Path(`M ${Outline.map((Point) => `${Point[0].toFixed(2)} ${Point[1].toFixed(2)}`).join(' L ')} Z`,
             'rgba(225,211,74,0.5)', 1.4, 'rgba(225,211,74,0.07)');

    const CoMOffset = ((Body.CoMHeightM - 0.2) / 0.8) * 26;
    Target.Circle(CentreX, CentreY + CoMOffset, 4, C.vehicle, '#1f1f1f', 2);

    for (const Corner of Specification.Corners)
    {
        const Px = CentreX + Corner.Local[0] * Scale;
        const Py = CentreY - Corner.Local[1] * Scale;
        const Radius = Specification.TyreSet.RadiusM * Scale;
        const TyreWidth = Specification.TyreSet.WidthM * Scale;
        if (Corner.Fitted)
        {
            const Heat = Math.min(1, Math.max(0, (Corner.SurfaceK - 293.15) / 160));
            const Fill = `rgb(${Math.round(30 + Heat * 200)}, ${Math.round(38 + Heat * 60)}, ${Math.round(40 * (1 - Heat) + 20)})`;
            // 📝 Plan view: the tyre's long axis runs fore-and-aft (x), its section width across the vehicle (y).
            Target.Rect(Px - Radius, Py - TyreWidth / 2, Radius * 2, TyreWidth, Fill, Math.min(TyreWidth, Radius) * 0.42, C.vehicle, 1.6);
            Target.Rect(Px + Radius - 4, Py - TyreWidth / 2, 3, TyreWidth, C.on, 1.5);
        }
        else
        {
            Target.Rect(Px - Radius, Py - TyreWidth / 2, Radius * 2, TyreWidth, 'none', Math.min(TyreWidth, Radius) * 0.42, '#4a4a4a', 1.2);
        }
        // 📝 Corner key to the outboard side of the tyre, where the plan view has empty ground to write on.
        const LabelX = Px + (Corner.Local[1] > 0 ? -Radius - 14 : Radius + 14);
        Target.Text(LabelX, Py + 3, Corner.Key, 9, Corner.Fitted ? '#8a8a80' : '#5c5c5c', 400, 'middle');
    }

    // Readout box, top left, as the prototype's HUD.
    const Torque = EvaluateTorqueCurve(Specification.Curves.Torque, Specification.Powertrain.RedlineRpm);
    const Lines = [
        'ControlVehicle   PROTO-X wedge coupe',
        `mass 1300 kg   wheelbase ${Body.WheelbaseM.toFixed(3)} m   track ${(Body.TrackFrontM * 1000).toFixed(0)} mm`,
        `tyres 4/4   pit bay 0   yaw inertia ${EvaluateVehicleReadings(Specification).YawInertiaKgm2.toFixed(0)} kg·m²`,
        `torque peak ${Torque.PeakTorqueNm} Nm @ ${Torque.PeakTorqueRpm} rpm   power ${Torque.PeakPowerKw.toFixed(1)} kW`,
        'curve keys 18 (Torque)   units SI'
    ];
    Target.Rect(X + 12, Y + 12, 430, 18 + Lines.length * 16, 'rgba(16,16,16,0.8)', 12, '#2c2c2c');
    Lines.forEach((Line, Index) => Target.Text(X + 25, Y + 34 + Index * 16, Line, 11, '#cfcfcf'));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          FIGURES
//------------------------------------------------------------------------------------------------------------------------

function LoadFontFiles()
{
    mkdirSync(FontDir, { recursive: true });
    const Sources = ['300', '400', '500'].map((Weight) => resolve(Root, `Style/Fonts/dm-sans-latin-${Weight}-normal.woff2`));
    const Out = [];
    for (const Source of Sources)
    {
        const Target = resolve(FontDir, Source.split('/').pop().replace('.woff2', '.ttf'));
        if (!existsSync(Target))
        {
            const Ttf = execFileSync(process.execPath, ['-e', `
                import('wawoff2').then(async (Module) => {
                    const Fs = await import('node:fs');
                    const Data = Fs.readFileSync(${JSON.stringify(Source)});
                    const Out = await Module.decompress(Data);
                    Fs.writeFileSync(${JSON.stringify(Target)}, Buffer.from(Out));
                });`], { stdio: 'inherit' });
            void Ttf;
        }
        Out.push(Target);
    }
    return Out;
}

function RenderFigure(Svg, Name, FontFiles, Scale = 1, CropHeight = null)
{
    mkdirSync(ImagesRoot, { recursive: true });
    // 📝 A card stack rarely ends on a round number; the figure is cropped to the content it actually drew.
    if (CropHeight !== null && CropHeight < Svg.Height)
    {
        Svg.Height = Math.round(CropHeight);
        Svg.Defs.push(`<clipPath id="figureCrop"><rect x="0" y="0" width="${Svg.Width}" height="${Svg.Height}"/></clipPath>`);
        Svg.Parts.unshift('<g clip-path="url(#figureCrop)">');
        Svg.Parts.push('</g>');
    }
    const SvgText = Svg.Serialize(C.ground);
    writeFileSync(resolve(FontDir, `${Name}.svg`), SvgText);
    const Renderer = new Resvg(SvgText, {
        font: { fontFiles: FontFiles, loadSystemFonts: false, defaultFontFamily: 'DM Sans' },
        fitTo: { mode: 'zoom', value: Scale }
    });
    const Png = Renderer.render().asPng();
    writeFileSync(resolve(ImagesRoot, `${Name}.png`), Png);
    console.log(`${Name}.png  ${Png.length} bytes`);
}

const Specification = ConstructVehicleSpecification();
LoadAllAuthors(Specification);
const FontFiles = LoadFontFiles();

// Figure 1 — the whole shell, vehicle selected.
{
    const Width = 1280, Height = 860;
    const Svg = new SvgCanvas(Width, Height);
    DrawOutliner(Svg, 0, 0, 288, Height - 28, Specification);
    DrawStage(Svg, 288, 34, Width - 288 - 384, Height - 28 - 34 - 52, Specification);
    Svg.Rect(288, 0, Width - 288 - 384, 34, '#0d0d0d');
    Svg.Text(304, 22, 'Viewport', 11, '#cfcfcf');
    Svg.Rect(288, 34, Width - 288 - 384, 52, C.column);
    Svg.Text(302, 56, 'ControlVehicle', 13, '#e2e2e2', 500);
    Svg.Text(302, 71, 'plan view · drawn from the bound geometry', 9, '#707070');
    Svg.Rect(288 + 200, 47, 44, 18, '#2a2416', 5, '#5a4a24');
    Svg.Text(288 + 222, 60, 'LIVE', 9, '#c9a24a', 400, 'middle', 1.2);
    Svg.Text(Width - 384 - 16, 44, 'schematic · no renderer', 9, '#9a9a9a', 400, 'end');
    Svg.Rect(Width - 384, 0, 384, 34, '#0d0d0d');
    Svg.Text(Width - 384 + 16, 22, 'Inspector', 11, '#cfcfcf');
    Svg.Rect(Width - 384, 34, 384, 34, '#161616');
    Svg.Text(Width - 384 + 18, 56, 'Inspector', 11, '#717171');
    Svg.Text(Width - 384 + 86, 56, '› Vehicle › ControlVehicle', 11, '#bfbfbf');
    Svg.Text(Width - 18, 56, 'Changes apply live', 10, '#7c7c7c', 400, 'end');
    DrawVehicleInspector(Svg, Width - 384, 68, 384, Height - 68 - 28, Specification, { StopAfterPowertrain: true });
    const LegendY = Height - 28 - 22;
    [['#e1d34a', 'centre of mass'], ['#3ec46d', 'tread fresh'], ['#e0a24a', 'tread worn'], ['#4a4a4a', 'socket, no tyre']]
        .forEach(([Colour, Label], Index) =>
        {
            const LegendX = 288 + 14 + Index * 148;
            Svg.Circle(LegendX, LegendY, 3, Colour);
            Svg.Text(LegendX + 10, LegendY + 3, Label.toUpperCase(), 9, '#6f6f6f', 400, 'start', 1.2);
        });
    Svg.Rect(0, Height - 28, Width, 28, '#0d0d0d');
    Svg.Text(14, Height - 10, 'Frontier · vehicle inspector prototype', 10, '#6f6f6f');
    Svg.Text(340, Height - 10, 'selection: vehicle', 10, '#6f6f6f');
    Svg.Text(Width - 300, Height - 10, 'values in stored SI units', 10, '#6f6f6f');
    Svg.Text(Width - 14, Height - 10, 'session 00:41', 10, '#6f6f6f', 400, 'end');
    RenderFigure(Svg, 'VehicleInspectorShell', FontFiles);
}

// Figure 2 — the inspector column alone, all eight cards, for detail.
{
    const Width = 384, Height = 2060;
    const Svg = new SvgCanvas(Width, Height);
    const End = DrawVehicleInspector(Svg, 0, 0, Width, Height, Specification, { HoverX: 5600 });
    RenderFigure(Svg, 'VehicleInspectorCards', FontFiles, 1.4, End + 14);
}

// Figure 3 — the tyre editor for one corner, with that tyre removed into the pit bay.
{
    const Scenario = ConstructVehicleSpecification();
    LoadAllAuthors(Scenario);
    const Corner = QueryCorner(Scenario, 'FL');
    // 📝 Scenario: the front-left tyre came off at a pit stop after a hot run.
    Scenario.PitBay.push({ Corner: 'FL', Compound: Scenario.TyreSet.Compound, PressureKpa: 236, SurfaceK: 371.15,
                           WearFraction: 0.47, Grip: 0.92, RemovedAtSeconds: 41, AgeSeconds: 0 });
    Corner.Fitted = false;
    Corner.PressureKpa = 0;
    Corner.SurfaceK = 293.15;
    Corner.WearFraction = 0.47;
    Scenario.PitLog.push({ AtSeconds: 41, Action: 'Removed', Corner: 'FL', Detail: 'Semi-slick · 47% worn' });

    const Width = 384, Height = 1800;   // [px] - Generous canvas; the figure is cropped to the cards it actually drew
    const Svg = new SvgCanvas(Width, Height);
    Svg.Rect(0, 0, Width, Height, '#171717');
    let Cursor = 20;
    Svg.Text(16, Cursor + 7, 'TYRE · FRONT AXLE · CORNER FL', 9, '#898989', 400, 'start', 1.7);
    Cursor += 18;
    Svg.Text(16, Cursor + 15, 'Front left', 19, C.text, 400, 'start', -0.5);
    const PillWidth = TextWidth('Fitted', 10) + 34;
    Svg.Rect(Width - 16 - PillWidth, Cursor + 1, PillWidth, 28, '#252525', 25, '#3a3a3a');
    Svg.Circle(Width - 16 - PillWidth + 12, Cursor + 15, 2.5, '#818181');
    Svg.Text(Width - 16 - PillWidth + 22, Cursor + 19, 'Removed', 10, '#b2b2b2');
    Cursor += 30;
    Svg.Text(16, Cursor + 8, 'Parented to the vehicle at socket (1.7274, 1.0475, 0.0914) m —', 10, '#7d7d7d');
    Cursor += 14;
    Svg.Text(16, Cursor + 8, 'removals and replacements are pit actions; the hub stays on the vehicle.', 10, '#7d7d7d');
    Cursor += 26;

    let Card = CardLayout.Open(Svg, 16, Cursor, Width - 32, '#d9c46a', '01', 'Fitting', 'CircleDot', 'Parented to the vehicle · removable');
    Card.MetricText('Removed', 'in the pit bay', 'Semi-slick', 'warm');
    Card.Stats([Stat('Tread', '20', '°C', 'unit-thermal'), Stat('Wear', '47', '%', 'unit-fraction'),
                Stat('Grip', '0', '%', 'unit-fraction')], 3);
    Svg.Rect(Card.X + Card.Pad, Card.Cursor, (Card.Inner - 8) / 2, 34, '#cfe0d6', 10);
    Svg.Text(Card.X + Card.Pad + (Card.Inner - 8) / 4, Card.Cursor + 22, 'Fit tyre', 10, '#1a2a20', 400, 'middle');
    Svg.Rect(Card.X + Card.Pad + (Card.Inner - 8) / 2 + 8, Card.Cursor, (Card.Inner - 8) / 2, 34, '#262626', 10, '#5a3434');
    Svg.Text(Card.X + Card.Pad + (Card.Inner - 8) / 2 + 8 + (Card.Inner - 8) / 4, Card.Cursor + 22, 'Remove (pit stop)', 10, '#8a6a66', 400, 'middle');
    Card.Cursor += 48;
    Card.Muted('', ['Removing keeps this tyre\'s own pressure, temperature, wear and grip', 'in the pit bay; fitting returns the same used tyre.']);
    Cursor = Card.Close('tyre01') + 12;

    Card = CardLayout.Open(Svg, 16, Cursor, Width - 32, '#d9c46a', '02', 'Tyre specification', 'Droplets', 'Measured geometry · radial spring');
    Card.Control('Pressure', 0, 'kPa', 'unit-pressure', 0, 400, 0);
    Card.Control('Tread temperature', 20, '°C', 'unit-thermal', -20, 250, 0);
    Card.Control('Tread wear', 47, '%', 'unit-fraction', 0, 100, 1);
    Card.Divider();
    Card.Stats([Stat('Radius', '0.509', 'm', 'unit-length'), Stat('Rim radius', '0.345', 'm', 'unit-length'),
                Stat('Section width', '0.396', 'm', 'unit-length')], 3);
    Card.Stats([Stat('Radial stiffness', '250', 'kN/m', 'unit-pressure'), Stat('Reference pressure', '110', 'kPa', 'unit-pressure'),
                Stat('Pressure share', '75', '%', 'unit-fraction')], 3);
    Cursor = Card.Close('tyre02') + 12;

    Card = CardLayout.Open(Svg, 16, Cursor, Width - 32, '#d9c46a', '03', 'Thermal & grip', 'Thermometer', 'Optimum, fade and pressure rules');
    Card.Control('Optimum tread', 353.15, 'K', 'unit-thermal', 280, 420, 1);
    Card.Control('Grip floor at', 473.15, 'K', 'unit-thermal', 360, 620, 1);
    Card.Control('Minimum grip', 60, '%', 'unit-fraction', 20, 100, 0);
    Card.Divider();
    Card.Stats([Stat('Wear rate', '6.0', 'x', 'unit-fraction'), Stat('Carcass limit', '220', '°C', 'unit-thermal'),
                Stat('Burst', '650', 'kPa', 'unit-pressure')], 3);
    Cursor = Card.Close('tyre03') + 12;

    // 📝 The grip curve card: the same instrument as the vehicle's torque card, bound to the tyre's own table.
    Card = CardLayout.Open(Svg, 16, Cursor, Width - 32, '#d9c46a', '04', 'Curve · grip', 'TrendingUp',
                           'Editable grip against tread temperature');
    DrawCurvePlot(Svg, Card.X + Card.Pad, Card.Cursor, Card.Inner, 168, Scenario.Curves.GripTemperature,
                  CurveFields.GripTemperature, CurveFields.GripTemperature.Accent, 95);
    Card.Cursor += 180;
    Card.Muted('', ['Grip = thermal fade from 80 °C to 200 °C, times the fractional', 'cold-pressure deviation and the compound grip scale.']);
    Cursor = Card.Close('tyre04') + 12;
    RenderFigure(Svg, 'TyreInspector', FontFiles, 1.4, Cursor + 8);
    void Cursor;
}

// Figure 4 — a tyre fitted, to show the fitted state and the calculated grip reading.
{
    const Scenario = ConstructVehicleSpecification();
    LoadAllAuthors(Scenario);
    const Corner = QueryCorner(Scenario, 'RL');
    Corner.PressureKpa = 242;
    Corner.SurfaceK = 366.15;
    Corner.WearFraction = 0.18;
    const Grip = EvaluateTyreGrip(Scenario, Corner);

    const Width = 384, Height = 470;
    const Svg = new SvgCanvas(Width, Height);
    Svg.Rect(0, 0, Width, Height, '#171717');
    Svg.Text(16, 27, 'TYRE · REAR AXLE · CORNER RL', 9, '#898989', 400, 'start', 1.7);
    Svg.Text(16, 51, 'Rear left', 19, C.text, 400, 'start', -0.5);
    const PillWidth = TextWidth('Fitted', 10) + 34;
    Svg.Rect(Width - 16 - PillWidth, 37, PillWidth, 28, '#252525', 25, '#3a3a3a');
    Svg.Circle(Width - 16 - PillWidth + 12, 51, 2.5, C.on);
    Svg.Text(Width - 16 - PillWidth + 22, 55, 'Fitted', 10, '#b2b2b2');

    let Card = CardLayout.Open(Svg, 16, 76, Width - 32, '#d9c46a', '01', 'Fitting', 'CircleDot', 'Parented to the vehicle · removable');
    Card.Metric('242', 'kPa cold', 'Semi-slick fitted', 'live');
    Card.Stats([Stat('Tread', '93', '°C', 'unit-thermal', 'warm'), Stat('Wear', '18', '%', 'unit-fraction'),
                Stat('Grip', (Grip * 100).toFixed(1), '%', 'unit-fraction')], 3);
    Card.Cursor += 6;
    Svg.Rect(Card.X + Card.Pad, Card.Cursor, (Card.Inner - 8) / 2, 34, '#262626', 10, '#383838');
    Svg.Text(Card.X + Card.Pad + (Card.Inner - 8) / 4, Card.Cursor + 22, 'Fit tyre', 10, '#5f5f5f', 400, 'middle');
    Svg.Rect(Card.X + Card.Pad + (Card.Inner - 8) / 2 + 8, Card.Cursor, (Card.Inner - 8) / 2, 34, '#262626', 10, '#5a3434');
    Svg.Text(Card.X + Card.Pad + (Card.Inner - 8) / 2 + 8 + (Card.Inner - 8) / 4, Card.Cursor + 22, 'Remove (pit stop)', 10, '#f0b0ab', 400, 'middle');
    Card.Cursor += 48;
    const FittedEnd = Card.Close('tyreFitted');
    RenderFigure(Svg, 'TyreFitted', FontFiles, 1.4, FittedEnd + 8);
}

// Figure 5 — the curve card on its own: keys, hover readout, peak/mean and the key fields.
{
    const Width = 420, Height = 460;
    const Svg = new SvgCanvas(Width, Height);
    Svg.Rect(0, 0, Width, Height, '#171717');
    const Field = CurveFields.Torque;
    const Points = Specification.Curves.Torque;
    let Card = CardLayout.Open(Svg, 16, 16, Width - 32, C.vehicle, '07', 'Curve · Torque', 'Gauge', Field.Source);
    Svg.Rect(Card.X + Card.Pad, Card.Cursor, (Card.Inner - 8) * 0.52, 32, '#191919', 9, '#393939');
    Svg.Text(Card.X + Card.Pad + 8, Card.Cursor + 21, 'Engine torque', 10, '#c8c8c8');
    Svg.Rect(Card.X + Card.Pad + (Card.Inner - 8) * 0.52 + 8, Card.Cursor, (Card.Inner - 8) * 0.48, 32, '#191919', 9, '#393939');
    Svg.Text(Card.X + Card.Pad + (Card.Inner - 8) * 0.52 + 16, Card.Cursor + 21, 'GTR preset-1 (engine default)', 10, '#c8c8c8');
    Card.Cursor += 44;
    DrawCurvePlot(Svg, Card.X + Card.Pad, Card.Cursor, Card.Inner, 168, Points, Field, Field.Accent, 5600);
    Card.Cursor += 180;
    const Peak = PeakOfCurve(Points);
    Card.Stats([Stat('Peak', Peak.Y.toFixed(0), 'Nm', 'unit-torque'), Stat('at', Peak.X.toFixed(0), 'rpm', 'unit-rate'),
                Stat('Mean', '445', 'Nm', 'unit-torque')], 3);
    const CurveEnd = Card.Close('curveCard');
    RenderFigure(Svg, 'CurveEditor', FontFiles, 2, CurveEnd + 16);
}

console.log('figures written to', ImagesRoot);
