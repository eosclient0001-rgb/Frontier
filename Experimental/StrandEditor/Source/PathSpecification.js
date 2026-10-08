//============================================================================================================================================
//                                                            PATHSPECIFICATION.JS                                                            
//============================================================================================================================================
// 📦 Closed parametric paths for trails and flower heads, resampled at equal arc length into a texture-ready table; no DOM access.

// 📝 Each curve is closed over one period of its parameter, so the first and last samples meet and a trail can cross
//    the seam without a jump. Every curve is scaled so its furthest point sits Size metres from the origin, in the
//    XY plane, which is the plane the camera looks at.
export const PathShapeNames = Object.freeze(['Ring', 'Figure eight', 'Rose', 'Weave', 'Loop', 'Stadium']);

// 🔢 Samples in the table. The shader indexes it with one fraction, so this sets the arc resolution of a path.
export const PathSampleCount = 512;

const DenseSampleCount = 4096;

const Curves = {
    Ring: (Angle) => [Math.cos(Angle), Math.sin(Angle)],
    'Figure eight': (Angle) => [Math.sin(Angle), 0.5 * Math.sin(2 * Angle)],
    Rose: (Angle) => {
        const Radius = Math.cos(5 * Angle);
        return [Radius * Math.cos(Angle), Radius * Math.sin(Angle)];
    },
    Weave: (Angle) => [Math.sin(3 * Angle), 0.6 * Math.sin(2 * Angle + 0.5)],
    Loop: (Angle) => {
        const Radius = (0.5 + Math.cos(Angle)) / 1.5;
        return [Radius * Math.cos(Angle), Radius * Math.sin(Angle)];
    },
    // 📝 Stadium is a squircle, flat along X: the loop a light guide follows round a dashboard or door trim.
    //    Its exponent is four, so x to the fourth plus (y over 0.36) to the fourth equals one.
    Stadium: (Angle) => {
        const Cosine = Math.cos(Angle);
        const Sine = Math.sin(Angle);
        return [Math.sign(Cosine) * Math.abs(Cosine) ** 0.5, 0.36 * Math.sign(Sine) * Math.abs(Sine) ** 0.5];
    },
};

// 📝 Densely sampled, scaled, then resampled at equal chord length. Equal arc length makes light travel at one speed
//    along every path, instead of bunching where a parametric curve happens to slow down.
export function SamplePath(Shape, Size, Count = PathSampleCount) {
    const Curve = Object.hasOwn(Curves, Shape) ? Curves[Shape] : Curves.Ring;
    const Dense = [];
    for (let Index = 0; Index <= DenseSampleCount; Index++) {
        Dense.push(Curve((Index / DenseSampleCount) * 2 * Math.PI));
    }
    let Furthest = 0;
    for (const [X, Y] of Dense) Furthest = Math.max(Furthest, Math.hypot(X, Y));
    const Scale = Furthest > 0 ? Size / Furthest : 0;
    const Cumulative = [0];
    for (let Index = 1; Index <= DenseSampleCount; Index++) {
        const [PreviousX, PreviousY] = Dense[Index - 1];
        const [X, Y] = Dense[Index];
        Cumulative.push(Cumulative[Index - 1] + Math.hypot(X - PreviousX, Y - PreviousY));
    }
    const Total = Cumulative[DenseSampleCount];
    const Samples = new Float32Array(Count * 4);
    let Cursor = 0;
    for (let Sample = 0; Sample < Count; Sample++) {
        const Target = (Sample / Count) * Total;
        while (Cursor < DenseSampleCount - 1 && Cumulative[Cursor + 1] < Target) Cursor++;
        const Span = Cumulative[Cursor + 1] - Cumulative[Cursor];
        const Ratio = Span > 0 ? (Target - Cumulative[Cursor]) / Span : 0;
        const [AX, AY] = Dense[Cursor];
        const [BX, BY] = Dense[Cursor + 1];
        Samples[Sample * 4] = (AX + (BX - AX) * Ratio) * Scale;
        Samples[Sample * 4 + 1] = (AY + (BY - AY) * Ratio) * Scale;
        Samples[Sample * 4 + 2] = 0;
        Samples[Sample * 4 + 3] = 0;
    }
    return { Samples, Count, Length: Total * Scale };
}
