//============================================================================================================================================
//                                                              DISPLAYPANEL.JS
//============================================================================================================================================
// 📦 Lays out the display panel's 2D controls (ten preset toggles and a preset slider) and rasterises them over a transparent canvas.

// 📝 Panel size in pixels, 16:10 tablet landscape. The light is drawn behind these controls, so they keep the same positions for every preset.
export const PanelWidth = 1280;
export const PanelHeight = 800;

// 📝 Positions are in panel pixels with the origin at the top-left, the same space as the output frame.
const ChipSize = { Width: 100, Height: 56, Gap: 14, Top: 620 };
const TrackSpec = { Y: 752, Hit: 24, LabelY: 716, KnobRadius: 13 };
const Accent = '#5fd8ff';
const Ink = '#f2f8ff';
const Muted = 'rgba(190, 222, 245, 0.82)';
const FontStack = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';

// 📝 Traces a rounded rectangle with arcTo, so every browser gets the same corners.
function RoundRect(Context, X, Y, Width, Height, Radius) {
    Context.beginPath();
    Context.moveTo(X + Radius, Y);
    Context.arcTo(X + Width, Y, X + Width, Y + Height, Radius);
    Context.arcTo(X + Width, Y + Height, X, Y + Height, Radius);
    Context.arcTo(X, Y + Height, X, Y, Radius);
    Context.arcTo(X, Y, X + Width, Y, Radius);
    Context.closePath();
}

export class DisplayPanel {
    constructor(Labels) {
        this.Labels = Labels.slice();
        const Count = this.Labels.length;
        const Span = Count * ChipSize.Width + (Count - 1) * ChipSize.Gap;
        const First = (PanelWidth - Span) / 2;
        this.Chips = this.Labels.map((Label, Index) => ({
            Index,
            X: First + Index * (ChipSize.Width + ChipSize.Gap),
            Y: ChipSize.Top,
            Width: ChipSize.Width,
            Height: ChipSize.Height,
        }));
        this.TrackLeft = First;
        this.TrackRight = First + Span;
        this.TrackY = TrackSpec.Y;
        this.LabelY = TrackSpec.LabelY;
        this.KnobRadius = TrackSpec.KnobRadius;
    }

    // 📝 Returns what a panel position hits: a preset toggle, a slider position, or null for the light underneath.
    HitTest(X, Y) {
        const Cell = this.Chips.find((Chip) => X >= Chip.X && X <= Chip.X + Chip.Width && Y >= Chip.Y && Y <= Chip.Y + Chip.Height);
        if (Cell) return { Action: 'Chip', Index: Cell.Index };
        const OnTrack = X >= this.TrackLeft - 20 && X <= this.TrackRight + 20 && Math.abs(Y - TrackSpec.Y) <= TrackSpec.Hit;
        if (OnTrack) return { Action: 'Slide', Index: this.IndexAtX(X) };
        return null;
    }

    // 📝 Maps a panel x position on the slider track to a preset index, clamped at both ends.
    IndexAtX(X) {
        const Last = this.Labels.length - 1;
        const Share = (X - this.TrackLeft) / (this.TrackRight - this.TrackLeft);
        return Math.min(Last, Math.max(0, Math.round(Share * Last)));
    }

    // 📝 Draws the controls for the active preset onto a transparent canvas the size of the output.
    Rasterize(Active, Width, Height) {
        const Canvas = document.createElement('canvas');
        Canvas.width = Width;
        Canvas.height = Height;
        const Context = Canvas.getContext('2d');
        if (!Context) return Canvas;
        const Scale = Width / PanelWidth;
        Context.setTransform(Scale, 0, 0, Scale, 0, 0);
        this.DrawTitle(Context, Active);
        for (const Cell of this.Chips) this.DrawChip(Context, Cell, Cell.Index === Active);
        this.DrawSlider(Context, Active);
        return Canvas;
    }

    DrawTitle(Context, Active) {
        Context.save();
        Context.textAlign = 'left';
        Context.textBaseline = 'alphabetic';
        Context.shadowColor = 'rgba(0, 0, 0, 0.65)';
        Context.shadowBlur = 18;
        Context.fillStyle = Accent;
        Context.font = '600 22px ' + FontStack;
        Context.fillText('PRESET ' + (Active + 1) + ' OF ' + this.Labels.length, this.TrackLeft, 104);
        Context.fillStyle = Ink;
        Context.font = '300 64px ' + FontStack;
        Context.fillText(this.Labels[Active], this.TrackLeft, 186);
        Context.restore();
    }

    DrawChip(Context, Cell, On) {
        Context.save();
        RoundRect(Context, Cell.X, Cell.Y, Cell.Width, Cell.Height, 10);
        Context.fillStyle = On ? 'rgba(95, 216, 255, 0.3)' : 'rgba(6, 10, 18, 0.58)';
        Context.fill();
        Context.lineWidth = On ? 3 : 1.5;
        Context.strokeStyle = On ? Accent : 'rgba(170, 215, 255, 0.4)';
        Context.stroke();
        Context.font = '600 24px ' + FontStack;
        Context.textAlign = 'center';
        Context.textBaseline = 'middle';
        Context.fillStyle = On ? Ink : 'rgba(220, 236, 250, 0.85)';
        Context.fillText(String(Cell.Index + 1), Cell.X + Cell.Width / 2, Cell.Y + Cell.Height / 2 + 1);
        Context.restore();
    }

    DrawSlider(Context, Active) {
        const Last = this.Labels.length - 1;
        const Span = this.TrackRight - this.TrackLeft;
        const KnobX = this.TrackLeft + Span * (Active / Last);
        Context.save();
        Context.shadowColor = 'rgba(0, 0, 0, 0.6)';
        Context.shadowBlur = 10;
        Context.textBaseline = 'alphabetic';
        Context.textAlign = 'left';
        Context.font = '600 16px ' + FontStack;
        Context.fillStyle = Muted;
        Context.fillText('PRESET', this.TrackLeft, TrackSpec.LabelY);
        Context.textAlign = 'right';
        Context.font = '400 20px ' + FontStack;
        Context.fillStyle = Ink;
        Context.fillText(this.Labels[Active], this.TrackRight, TrackSpec.LabelY);
        Context.shadowBlur = 0;
        RoundRect(Context, this.TrackLeft, TrackSpec.Y - 3, Span, 6, 3);
        Context.fillStyle = 'rgba(255, 255, 255, 0.2)';
        Context.fill();
        RoundRect(Context, this.TrackLeft, TrackSpec.Y - 3, KnobX - this.TrackLeft, 6, 3);
        Context.fillStyle = Accent;
        Context.fill();
        for (let Step = 0; Step <= Last; Step++) {
            Context.beginPath();
            Context.arc(this.TrackLeft + Span * (Step / Last), TrackSpec.Y, 3, 0, Math.PI * 2);
            Context.fillStyle = Step <= Active ? Accent : 'rgba(255, 255, 255, 0.45)';
            Context.fill();
        }
        Context.beginPath();
        Context.arc(KnobX, TrackSpec.Y, TrackSpec.KnobRadius, 0, Math.PI * 2);
        Context.fillStyle = Ink;
        Context.fill();
        Context.lineWidth = 3;
        Context.strokeStyle = Accent;
        Context.stroke();
        Context.restore();
    }
}
