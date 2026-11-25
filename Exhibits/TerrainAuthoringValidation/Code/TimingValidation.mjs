/*====================================================================================================================================
                                                      TIMINGVALIDATION.MJS
====================================================================================================================================*/
// 🧩 Runs the prototype's PerformanceProbe at 512² and 1024², the unbounded stamp test, and captures the stamp spiral

const Results = new URL("../Results/", import.meta.url);
const Images = new URL("../Images/", import.meta.url).pathname;

export default async function Run(Page)
{
    const Fs = await import("node:fs");
    const Output = { Measurements: [], Unbounded: null };
    for (const Resolution of [512, 1024])
    {
        const Row = await Page.evaluate(async Resolution =>
        {
            const S = window.TerrainAuthoring;
            const Probe = await import("./Source/PerformanceProbe.js");
            const Terrain = S.Document.RetrieveTerrain();
            Terrain.Resolution = Resolution;
            S.Document.TouchTerrain(Terrain);
            S.ReconcileFields();
            return Probe.MeasureEditCosts(S, 3);
        }, Resolution);
        console.log(`[T] ${Resolution}: ${JSON.stringify(Row.Rows)}`);
        Output.Measurements.push(Row);
    }
    Output.Unbounded = await Page.evaluate(async () => (await import("./Source/PerformanceProbe.js")).MeasureUnboundedStamps(window.TerrainAuthoring, 3000, 300));
    console.log(`[T] unbounded: ${JSON.stringify(Output.Unbounded)}`);
    Fs.writeFileSync(new URL("TimingValidation.json", Results), JSON.stringify(Output, null, 2));
    // 📝 Close-up of the 3000-stamp spiral through the normal app render path.
    await Page.evaluate(() =>
    {
        const S = window.TerrainAuthoring;
        const T = S.Document.RetrieveTerrain();
        S.Relief.Target = [T.Min[0] + T.Size[0] * 0.5, 120, T.Min[1] + T.Size[1] * 0.5];
        S.Relief.Distance = 3400; S.Relief.Pitch = 0.6; S.Relief.Yaw = 0.5; S.Relief.Scale = 1;
        S.Plan.FrameRectangle([T.Min[0] + T.Size[0] * 0.5 - 1300, T.Min[1] + T.Size[1] * 0.5 - 1300], [2600, 2600], 1.05);
        S.Invalidate();
    });
    await new Promise(Resolve => setTimeout(Resolve, 8000));
    await Page.screenshot({ path: Images + "06_ThreeThousandStampSpiral.png" });
}
