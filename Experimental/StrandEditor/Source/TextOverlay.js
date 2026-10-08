//============================================================================================================================================
//                                                               TEXTOVERLAY.JS
//============================================================================================================================================
// 📦 Rasterises a text layer onto a transparent canvas the size of the output, ready for WebGL compositing.

const Faces = {
    Sans: { Weight: 500, Stack: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif' },
    Light: { Weight: 300, Stack: '"Avenir Next", "Century Gothic", "Trebuchet MS", Arial, "Liberation Sans", sans-serif' },
    Condensed: { Weight: 400, Stack: '"Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif' },
};

// 📝 Tracking is applied per glyph, so every browser gets the same spacing without relying on letterSpacing support.
function DrawTracked(Context, Text, X, Y, Spacing, Alignment) {
    const Glyphs = Array.from(Text);
    const Widths = Glyphs.map((Glyph) => Context.measureText(Glyph).width);
    const Total = Widths.reduce((Sum, Width) => Sum + Width, 0) + Spacing * Math.max(0, Glyphs.length - 1);
    let Left = X;
    if (Alignment === 'Centre') Left = X - Total / 2;
    else if (Alignment === 'Right') Left = X - Total;
    let Cursor = Left;
    Glyphs.forEach((Glyph, Index) => {
        Context.fillText(Glyph, Cursor, Y);
        Cursor += Widths[Index] + Spacing;
    });
}

export function RasterizeText(Layer, Width, Height) {
    const Canvas = document.createElement('canvas');
    Canvas.width = Width;
    Canvas.height = Height;
    const Context = Canvas.getContext('2d');
    if (!Context) return Canvas;
    const Face = Faces[Layer.Face] || Faces.Sans;
    const TitlePixels = Layer.TitleSize * Height;
    const SubtitlePixels = Layer.SubtitleSize * Height;
    const AnchorX = Layer.X * Width;
    const AnchorY = (1 - Layer.Y) * Height;
    Context.textBaseline = 'middle';
    Context.textAlign = 'left';

    const Lines = [];
    if (Layer.Title) Lines.push({ Text: Layer.Title, Pixels: TitlePixels, Y: AnchorY });
    if (Layer.Subtitle) {
        Lines.push({ Text: Layer.Subtitle, Pixels: SubtitlePixels, Y: AnchorY + TitlePixels * 0.5 + SubtitlePixels * 1.1 });
    }
    for (const Line of Lines) {
        Context.font = Face.Weight + ' ' + Line.Pixels + 'px ' + Face.Stack;
        Context.fillStyle = Layer.Colour;
        Context.shadowColor = Layer.Colour;
        Context.shadowBlur = Layer.Glow * Line.Pixels * 0.9;
        DrawTracked(Context, Line.Text, AnchorX, Line.Y, Layer.Tracking * Line.Pixels, Layer.Align);
        // A second, unblurred pass gives the glyph a crisp core inside its halo.
        Context.shadowBlur = 0;
        DrawTracked(Context, Line.Text, AnchorX, Line.Y, Layer.Tracking * Line.Pixels, Layer.Align);
    }
    return Canvas;
}
