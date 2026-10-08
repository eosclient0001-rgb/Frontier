//============================================================================================================================================
//                                                           PULSESPECIFICATION.JS                                                            
//============================================================================================================================================
// 📦 CPU mirror of the GLSL pulse curves, so the checks can pin their range, periodicity and beat count; no DOM access.

// 📝 The shader evaluates the same curves per fibre. These are the reference values the checks compare against.
//    Breathe and Ripple share an eased sine, which rests at the bottom and crests at the middle of each cycle, like an
//    inhale and exhale. Heartbeat is two short beats per cycle followed by rest.
//    Sweep is one front that runs along the fibre once per cycle; it also reads the arc position (see SweepLevelAt).
export const PulseShapeNames = Object.freeze(['Breathe', 'Heartbeat', 'Ripple', 'Sweep']);

function Fraction(Position) {
    return Position - Math.floor(Position);
}

// 📝 Periodic distance on the unit circle of cycles, so a beat near the seam is not cut in half.
function PeriodicGap(First, Second) {
    const Gap = Math.abs(Fraction(First) - Fraction(Second));
    return Math.min(Gap, 1 - Gap);
}

// 🔢 Returns a level in [0, 1] for a cycle fraction. Periodic: PulseLevelAt(c, Shape) equals PulseLevelAt(c + 1, Shape).
//    Sweep also reads the fibre's arc position, so it takes Position; the other shapes ignore it.
export function PulseLevelAt(Cycle, Shape, Position = 0) {
    if (Shape === 'Sweep') return SweepLevelAt(Position, Cycle);
    if (Shape === 'Heartbeat') {
        const FirstBeat = Math.exp(-((PeriodicGap(Cycle, 0.10) / 0.045) ** 2));
        const SecondBeat = 0.55 * Math.exp(-((PeriodicGap(Cycle, 0.27) / 0.055) ** 2));
        return Math.min(1, Math.max(0, FirstBeat + SecondBeat));
    }
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * Cycle);
}

// 📝 CPU mirror of SweepLevel in Shaders.js: the same front, lit body, ridge and hold, so the checks read the same curve.
//    Position is the fibre's arc position in [0, 1]; Cycle is the loop fraction. Both are periodic.
export function SweepLevelAt(Position, Cycle) {
    const Phase = Fraction(Cycle);
    const Front = -0.03 + 1.06 * Math.min(Phase / 0.45, 1);
    const Done = Smoothstep(1.0, 1.01, Front - 0.02);
    const Origin = Done + (1 - Done) * Smoothstep(0, 0.04, Position);
    const Body = Origin * (1 - Smoothstep(Front - 0.02, Front + 0.005, Position));
    const Offset = (Position - (Front - 0.012)) / 0.012;
    const Ridge = Origin * Math.exp(-0.5 * Offset * Offset) * Smoothstep(0, 0.04, Phase) * (1 - Smoothstep(0.85, 1, Front - 0.012));
    const Hold = 1 - Smoothstep(0.75, 1, Phase);
    return Math.min(1, Math.max(0, Hold * Math.min(1, Math.max(0, 0.65 * Body + 0.35 * Ridge))));
}

// 📝 Hermite ease between two edges, the same curve as GLSL smoothstep.
function Smoothstep(Edge0, Edge1, Input) {
    const Share = Math.min(1, Math.max(0, (Input - Edge0) / (Edge1 - Edge0)));
    return Share * Share * (3 - 2 * Share);
}
