//============================================================================================================================================
//                                                           PULSESPECIFICATION.JS                                                            
//============================================================================================================================================
// 📦 CPU mirror of the GLSL pulse curves, so the checks can pin their range, periodicity and beat count; no DOM access.

// 📝 The shader evaluates the same curves per fibre. These are the reference values the checks compare against.
//    Breathe and Ripple share an eased sine, which rests at the bottom and crests at the middle of each cycle, like an
//    inhale and exhale. Heartbeat is two short beats per cycle followed by rest.
export const PulseShapeNames = Object.freeze(['Breathe', 'Heartbeat', 'Ripple']);

function Fraction(Position) {
    return Position - Math.floor(Position);
}

// 📝 Periodic distance on the unit circle of cycles, so a beat near the seam is not cut in half.
function PeriodicGap(First, Second) {
    const Gap = Math.abs(Fraction(First) - Fraction(Second));
    return Math.min(Gap, 1 - Gap);
}

// 🔢 Returns a level in [0, 1] for a cycle fraction. Periodic: PulseLevelAt(c, Shape) equals PulseLevelAt(c + 1, Shape).
export function PulseLevelAt(Cycle, Shape) {
    if (Shape === 'Heartbeat') {
        const FirstBeat = Math.exp(-((PeriodicGap(Cycle, 0.10) / 0.045) ** 2));
        const SecondBeat = 0.55 * Math.exp(-((PeriodicGap(Cycle, 0.27) / 0.055) ** 2));
        return Math.min(1, Math.max(0, FirstBeat + SecondBeat));
    }
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * Cycle);
}
