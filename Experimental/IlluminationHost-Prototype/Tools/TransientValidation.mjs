// Exercise the dynamic-light and particle paths on Dawn's validating backend.
import assert from "node:assert/strict";
export default {
    BeforeFrame(Host, Frame)
    {
        if (Frame === 0)
        {
            const P = Host.Vehicle.Position;
            Host.Sparks.Particles.push({ Position: [P[0], P[1], P[2] + 1], Prior: [P[0], P[1], P[2] + 1],
                                         Velocity: [3, 0, 2], Kelvin: 2100, Age: 0, Fresh: true, Size: 1 });
            Host.Effects.DerezVehicle(Host.Vehicle);
        }
        if (Frame === 4)
        {
            assert.ok(Host.TransientLights.length >= 1);
            assert.ok(Host.TransientLights.length <= 4);
            assert.ok(Host.Effects.QueryLight());
        }
    },
    Report(Host)
    {
        assert.ok(Host.FrameIndex >= 12);
        assert.ok(Host.TransientLights.length <= 4);
        console.log("Transient lighting, derez and particles: OK");
    }
};
