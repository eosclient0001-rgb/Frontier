// HOOKS=Tools/AppearanceValidation.mjs node Tools/HeadlessHarness.mjs . 12 '?capture=1&quality=low'
import assert from "node:assert/strict";

export default {
    BeforeFrame(Host, Frame)
    {
        if (Frame === 0)
        {
            Host.AssignAppearance("Paint", "blue");
            Host.AssignAppearance("Wheel", "bronze");
            Host.AssignAppearance("Finish", "matte");
            Host.AssignAppearance("Ghost", true);
        }
        if (Frame === 4) Host.AssignAppearance("Ghost", false);
    },
    Report(Host)
    {
        assert.equal(Host.Appearance.Paint, "blue");
        assert.equal(Host.Appearance.Wheel, "bronze");
        assert.equal(Host.Appearance.Finish, "matte");
        assert.equal(Host.Settings.GhostView, false);
        assert.equal(Host.Materials[6].CoatWeight, 0);
        assert.deepEqual(Host.Materials[10].Emission, [0, 0, 0]);
        console.log("Garage appearance and ghost transitions: OK");
    }
};
