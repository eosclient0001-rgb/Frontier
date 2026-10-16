//============================================================================================================================================
//                                                         DRIVERINPUTINTEGRATOR.JS
//============================================================================================================================================
// 🧩 Keyboard samples ramped into the smooth throttle, brake and steer command the vehicle solver consumes.

// 📝 DriverInputIntegrator.h's keyboard path: digital keys ramp in and decay out at the Frontier rates, steering builds
//    toward ±1 while A/D are held and self-centres when released. Layout: W throttle, S brake / reverse, A/D steer,
//    Space handbrake, R respawn — Project-Drive's README controls. Arrow keys mirror WASD.
const InputConfiguration = Object.freeze({
    ThrottleRiseRate: 3.0,   // [1/s]
    ThrottleFallRate: 6.0,   // [1/s]
    BrakeRiseRate:    4.0,   // [1/s]
    BrakeFallRate:    8.0,   // [1/s]
    SteerRate:        3.5    // [1/s]; hands-off return is speed/grip dependent below
});

function Ramp(Current, Target, Rise, Fall, Δτ)
{
    if (Target > Current)
        return Math.min(Target, Current + Rise * Δτ);
    return Math.max(Target, Current - Fall * Δτ);
}

// Steering return is a driver input assist, not a force on the vehicle. Grip loss weakens it;
// at parking speed it stays gentle. A small optional slip correction is active only hands-off.
export function ResolveSteeringReturnRate(Speed, Grip, Enabled = true)
{
    if (!Enabled) return 0.9;
    const Pace = Math.min(1, Math.max(0, (Math.abs(Speed) - 1.5) / 18));
    return (1.5 + 5.5 * Pace) * Math.max(0.35, Math.min(1, Grip));
}

export class DriverInputIntegrator
{
    constructor()
    {
        this.Throttle = 0.0;
        this.Brake    = 0.0;
        this.Steer    = 0.0;
    }

    Advance(Keys, Δτ, Assist = {})
    {
        const Forward  = Keys.has("KeyW") || Keys.has("ArrowUp");
        const Backward = Keys.has("KeyS") || Keys.has("ArrowDown");
        const Left     = Keys.has("KeyA") || Keys.has("ArrowLeft");
        const Right    = Keys.has("KeyD") || Keys.has("ArrowRight");
        this.Throttle = Ramp(this.Throttle, Forward ? 1.0 : 0.0, InputConfiguration.ThrottleRiseRate, InputConfiguration.ThrottleFallRate, Δτ);
        this.Brake    = Ramp(this.Brake, Backward ? 1.0 : 0.0, InputConfiguration.BrakeRiseRate, InputConfiguration.BrakeFallRate, Δτ);
        const SteerTarget = (Left ? 1.0 : 0.0) - (Right ? 1.0 : 0.0);
        if (Left || Right)
            this.Steer += (SteerTarget - this.Steer) * Math.min(1.0, Δτ * InputConfiguration.SteerRate);
        else
        {
            const Speed = Assist.Speed || 0.0;
            const Grip = Assist.Grip ?? 1.0;
            const Rate = ResolveSteeringReturnRate(Speed, Grip, Assist.SelfCenter !== false);
            // Countersteer follows the velocity vector only above walking pace; the sign is
            // relative to the car's forward vector, so reverse and parking remain manual.
            const Slip = Assist.Countersteer && Speed > 4.0 && Grip > 0.25
                       ? Math.max(-0.25, Math.min(0.25, (Assist.SideSpeed || 0) / Math.max(Speed, 1) * 0.8)) : 0;
            this.Steer += (Slip - this.Steer) * Math.min(1.0, Δτ * Rate);
        }
        return { Throttle: this.Throttle, Brake: this.Brake, Steer: this.Steer, Handbrake: Keys.has("Space") };
    }

    Reset()
    {
        this.Throttle = 0.0;
        this.Brake    = 0.0;
        this.Steer    = 0.0;
    }
}
