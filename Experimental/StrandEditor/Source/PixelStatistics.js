//============================================================================================================================================
//                                                             PIXELSTATISTICS.JS
//============================================================================================================================================
// 📦 Summaries and frame differences over RGBA byte images, used by the browser proof and by tests.

// 📝 Luma uses Rec. 709 weights on display-referred bytes; a value is a fraction of full scale in [0, 1].
export function MeanLuma(Pixels) {
    let Sum = 0;
    const Count = Pixels.length / 4;
    for (let Index = 0; Index < Pixels.length; Index += 4) {
        Sum += (0.2126 * Pixels[Index] + 0.7152 * Pixels[Index + 1] + 0.0722 * Pixels[Index + 2]) / 255;
    }
    return Count > 0 ? Sum / Count : 0;
}

export function MaxChannel(Pixels) {
    let Largest = 0;
    for (let Index = 0; Index < Pixels.length; Index += 4) {
        Largest = Math.max(Largest, Pixels[Index], Pixels[Index + 1], Pixels[Index + 2]);
    }
    return Largest;
}

export function Summarise(Pixels) {
    let Bright = 0;
    const Count = Pixels.length / 4;
    for (let Index = 0; Index < Pixels.length; Index += 4) {
        const Luma = (0.2126 * Pixels[Index] + 0.7152 * Pixels[Index + 1] + 0.0722 * Pixels[Index + 2]) / 255;
        if (Luma > 0.5) Bright += 1;
    }
    return {
        MeanLuma: MeanLuma(Pixels),
        MaxChannel: MaxChannel(Pixels),
        BrightShare: Count > 0 ? Bright / Count : 0,
    };
}

// 🔢 Mean absolute difference over the colour channels, on the 0..255 byte scale.
export function MeanDifference(First, Second) {
    if (First.length !== Second.length) throw new Error('Frames differ in size');
    let Sum = 0;
    let Channels = 0;
    for (let Index = 0; Index < First.length; Index += 4) {
        Sum += Math.abs(First[Index] - Second[Index]);
        Sum += Math.abs(First[Index + 1] - Second[Index + 1]);
        Sum += Math.abs(First[Index + 2] - Second[Index + 2]);
        Channels += 3;
    }
    return Channels > 0 ? Sum / Channels : 0;
}
