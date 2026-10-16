//============================================================================================================================================
//                                                             SPARKSEQUENCE.JS
//============================================================================================================================================
// 🧩 Sparks: hot metal ground off where a rim or the body slides on the road or a wall — thrown, cooling, bouncing, drawn as streaks.

// 📝 The vehicle solver reports each frame's scrapes (VehicleSolver.RecordScrape): the strongest per contact — a hull
//    patch dragged along the asphalt, a rim pinched through a flat or bare once the rubber has gone — with the contact
//    point, the sliding velocity of the metal over the surface, the surface normal and a strength. Each scrape throws
//    sparks in proportion, at 1500–2100 K:
//
//    | Source | Where a spark leaves                          | With what velocity                                    |
//    |--------|-----------------------------------------------|-------------------------------------------------------|
//    | hull   | the scraping point                            | 30–75 % of the slide, fanned, kicked off the surface  |
//    | rim    | the rim's edge a little (α ≤ 0.47 rad) behind | that point's own: Slip + S(1 − cos α)·F + |S| sin α·N |
//    |        | the patch, where the metal leaves the road    | (S = Spin·r) — up off the trailing edge, so the trail |
//    |        |                                               | streams back from a rolling wheel                     |
//
//    In flight a spark falls, feels air drag, cools radiatively, and skips off the course and obstacle boxes.
//
//    A few hundred particles: they are integrated here on the CPU and drawn after the temporal antialiasing as thin
//    additive streaks (2.2 mm across, at least a pixel) from where the camera saw them a frame ago to where it sees
//    them now (SparkRaster.wgsl), depth-tested against the scene — thin, bright and fast-moving, they would otherwise
//    be averaged away by the history.

import { ResolveCourseHeight, ResolveCourseNormal } from "./CourseStructure.js";

const SparkCapacity   = 2048;
const InstanceFloats  = 12;            // head xyz + width, tail xyz + 0, radiance rgb + 0
const Gravity         = 9.81;          // [m/s²]
const AirDrag         = 1.6;           // [1/s]
const CoolingSeconds  = 0.42;          // [s]  e-folding of a spark's excess temperature
const VisibleKelvin   = 950.0;         // [K]  below this a spark is gone
const SparksPerStrength = 700.0;       // [1/s] per unit scrape strength
const SparkWidth      = 0.0022;        // [m]  streak width at Size 1 — a glowing chip a fraction of a millimetre across, blurred

export const SparkSettingsDefaults = Object.freeze({ Enabled: true, Rate: 1.0, Brightness: 1.0, Size: 1.0 });

export class SparkSequence
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders  = Shaders;
        this.Settings = { ...SparkSettingsDefaults };
        this.Particles = [];
        this.Instances = new Float32Array(SparkCapacity * InstanceFloats);
        this.InstanceRecords = Exchange.ConstructRecords(SparkCapacity * InstanceFloats * 4, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, "Spark instances");
        this.Metrics = { Live: 0, Emitted: 0, Scrapes: 0, Collisions: 0 };
        this.CollisionBoxes = [];
        this.Seed = 0x5EED;
        this.Live = 0;
    }

    async ConstructPrograms(FrameRecords)
    {
        this.Layout = this.Exchange.ConstructDescriptorLayout(["Uniform"], GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, "Spark raster");
        this.Group = this.Exchange.ConstructDescriptorGroup(this.Layout, [FrameRecords]);
        this.Program = await this.Shaders.ConstructRasterProgram("SparkRaster.wgsl", {
            VertexEntry: "SparkVertex", FragmentEntry: "SparkFragment",
            VertexLayouts: [{ arrayStride: InstanceFloats * 4, stepMode: "instance", attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x4" },
                { shaderLocation: 1, offset: 16, format: "float32x4" },
                { shaderLocation: 2, offset: 32, format: "float32x4" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
            Targets: [{ format: "rgba16float", blend: { color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                                                        alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" } } }]
        }, [this.Layout]);
    }

    Random()
    {
        this.Seed = (Math.imul(this.Seed, 1664525) + 1013904223) >>> 0;
        return this.Seed / 4294967296;
    }

    // 📝 Scrapes: [{ Point, Velocity (the metal's slide over the surface), Normal, Strength, Wheel,
    //    Rim: { Forward, SpinSpeed, Radius } for a rim, null for the hull }].
    Emit(Scrapes, Seconds)
    {
        if (!this.Settings.Enabled || !(Seconds > 0.0))
            return;
        this.Metrics.Scrapes = Scrapes.length;
        for (const Scrape of Scrapes)
        {
            const Expected = SparksPerStrength * this.Settings.Rate * Scrape.Strength * Seconds;
            let Count = Math.floor(Expected) + (this.Random() < Expected - Math.floor(Expected) ? 1 : 0);
            Count = Math.min(Count, 96);
            const Normal = Scrape.Normal || [0.0, 0.0, 1.0];
            const Slide = Scrape.Velocity;
            const SlideSpeed = Math.hypot(Slide[0], Slide[1], Slide[2]);
            for (let Spark = 0; Spark < Count && this.Particles.length < SparkCapacity; ++Spark)
            {
                const Spread = [this.Random() * 2.0 - 1.0, this.Random() * 2.0 - 1.0, this.Random() * 2.0 - 1.0];
                let Origin, Velocity;
                if (Scrape.Rim)
                {
                    // 📐 Detached α behind the patch in the sense the rim turns (most right behind it): from the patch at
                    //    R((1 − cos α)·N − σ·sin α·F), moving at Slip + S(1 − cos α)·F + |S|·sin α·N, σ = sign S; it keeps
                    //    75–100 % of that, scattered in a narrow cone and bounced a little off the road.
                    const { Forward, SpinSpeed, Radius } = Scrape.Rim;
                    const Sense = SpinSpeed < 0.0 ? -1.0 : 1.0;
                    const Detach = 0.02 + 0.45 * this.Random() * this.Random();
                    const Cosine = Math.cos(Detach), Sine = Math.sin(Detach);
                    Origin = [0, 1, 2].map((Axis) => Scrape.Point[Axis] + Radius * ((1.0 - Cosine) * Normal[Axis] - Sense * Sine * Forward[Axis]));
                    const Metal = [0, 1, 2].map((Axis) => Slide[Axis] + SpinSpeed * (1.0 - Cosine) * Forward[Axis] + Math.abs(SpinSpeed) * Sine * Normal[Axis]);
                    const Speed = Math.hypot(Metal[0], Metal[1], Metal[2]);
                    const Share = 0.75 + 0.25 * this.Random();
                    const Scatter = 0.12 * Speed + 0.4;
                    const Bounce = 0.3 + 1.2 * this.Random();
                    Velocity = [0, 1, 2].map((Axis) => Metal[Axis] * Share + Spread[Axis] * Scatter + Normal[Axis] * Bounce);
                }
                else
                {
                    // 📝 Along the slide at 30–75 % of its speed, fanned ±35° and kicked 1–4 m/s off the surface.
                    const Share = 0.3 + 0.45 * this.Random();
                    const Fan = 0.6 * Math.max(2.0, SlideSpeed * 0.35);
                    const Kick = 1.0 + 3.0 * this.Random();
                    const Jitter = 0.04;
                    Origin = [Scrape.Point[0] + (this.Random() - 0.5) * Jitter, Scrape.Point[1] + (this.Random() - 0.5) * Jitter,
                              Scrape.Point[2] + 0.01 + this.Random() * 0.02];
                    Velocity = [0, 1, 2].map((Axis) => Slide[Axis] * Share + Spread[Axis] * Fan + Normal[Axis] * Kick);
                }
                // 📝 Born part-way through the frame, with a tail back along its path so even a new spark is a streak.
                const Born = this.Random() * Seconds;
                const Position = [0, 1, 2].map((Axis) => Origin[Axis] + Velocity[Axis] * Born);
                this.Particles.push({
                    Position,
                    Prior: Origin,
                    Velocity,
                    Kelvin: 1500.0 + 600.0 * this.Random(),
                    Age: 0.0,
                    Fresh: true,
                    Size: (0.6 + 0.8 * this.Random()) * this.Settings.Size
                });
                this.Metrics.Emitted++;
            }
        }
    }

    // Static scene AABBs and the nearby active convex bodies' conservative AABBs.
    AssignCollisionWorld(Boxes)
    {
        this.CollisionBoxes = Boxes;
    }

    // Capped clustered point lights; no per-particle light or expensive readback.
    QueryLights(Maximum = 3)
    {
        if (!this.Settings.Enabled) return [];
        const Clusters = new Map();
        for (const Spark of this.Particles)
        {
            if (Spark.Kelvin < 1150) continue;
            const Key = Spark.Position.map((V) => Math.floor(V / 2)).join(":");
            const Weight = Math.min(2, ResolveSparkRadiance(Spark.Kelvin)[0] / 18);
            const Group = Clusters.get(Key) || { Position: [0, 0, 0], Colour: [0, 0, 0], Weight: 0 };
            const Colour = ResolveSparkRadiance(Spark.Kelvin);
            for (let Axis = 0; Axis < 3; ++Axis)
            {
                Group.Position[Axis] += Spark.Position[Axis] * Weight;
                Group.Colour[Axis] += Colour[Axis] / Math.max(Colour[0], 1) * Weight;
            }
            Group.Weight += Weight;
            Clusters.set(Key, Group);
        }
        return [...Clusters.values()].sort((A, B) => B.Weight - A.Weight).slice(0, Maximum).map((Group) => ({
            Position: Group.Position.map((Value) => Value / Group.Weight),
            Colour: Group.Colour.map((Value) => Value / Group.Weight),
            Intensity: Math.min(70, Group.Weight * 2.2) * this.Settings.Brightness,
            Reach: 7
        }));
    }

    // 📝 Ballistic with drag and swept collisions against course, walls, props and active body bounds.
    Advance(Seconds)
    {
        if (!(Seconds > 0.0))
            return;
        const Survivors = [];
        for (const Spark of this.Particles)
        {
            // 📝 A spark born this frame already sits where it flew to since; the rest step from where they were.
            if (Spark.Fresh)
            {
                Spark.Fresh = false;
                Survivors.push(Spark);
                continue;
            }
            Spark.Age += Seconds;
            Spark.Prior = Spark.Position.slice();
            const Damping = Math.exp(-AirDrag * Seconds);
            Spark.Velocity = [Spark.Velocity[0] * Damping, Spark.Velocity[1] * Damping, Spark.Velocity[2] * Damping - Gravity * Seconds];
            // Substeps prevent a fast chip crossing a thin wall between render frames.
            const Steps = Math.max(1, Math.min(8, Math.ceil(Math.hypot(...Spark.Velocity) * Seconds / 0.35)));
            for (let Step = 0; Step < Steps; ++Step)
            {
                const To = Spark.Position.map((Value, Axis) => Value + Spark.Velocity[Axis] * Seconds / Steps);
                const Hit = ResolveSparkCollision(Spark.Position, To, this.CollisionBoxes);
                if (Hit)
                {
                    const Dot = Spark.Velocity.reduce((Sum, Value, Axis) => Sum + Value * Hit.Normal[Axis], 0);
                    Spark.Position = Hit.Point.map((Value, Axis) => Value + Hit.Normal[Axis] * 0.006);
                    if (Dot < 0)
                        Spark.Velocity = Spark.Velocity.map((Value, Axis) => 0.56 * (Value - Dot * Hit.Normal[Axis]) - 0.28 * Dot * Hit.Normal[Axis]);
                    this.Metrics.Collisions++;
                }
                else Spark.Position = To;
            }
            Spark.Kelvin = 293.0 + (Spark.Kelvin - 293.0) * Math.exp(-Seconds / CoolingSeconds);
            if (Spark.Kelvin > VisibleKelvin && Spark.Age < 2.5)
                Survivors.push(Spark);
        }
        this.Particles = Survivors;
        this.Live = Survivors.length;
        this.Metrics.Live = this.Live;
        if (this.Live === 0)
            return;
        // 📝 Instances: the streak from where the spark was a frame ago (the raster projects it with last frame's camera,
        //    so the streak is the motion the camera saw) to where it is.
        const Brightness = this.Settings.Brightness;
        for (let Index = 0; Index < this.Live; ++Index)
        {
            const Spark = this.Particles[Index];
            const Offset = Index * InstanceFloats;
            const Tail = Spark.Prior || Spark.Position;
            const Radiance = ResolveSparkRadiance(Spark.Kelvin).map((Channel) => Channel * Brightness);
            this.Instances.set([...Spark.Position, SparkWidth * Spark.Size, ...Tail, 0.0, ...Radiance, 0.0], Offset);
        }
        this.Exchange.Device.queue.writeBuffer(this.InstanceRecords, 0, this.Instances, 0, this.Live * InstanceFloats);
    }

    // 📝 Additively over the post radiance, depth-tested against the opaque surface (read only).
    Record(Encoder, TargetView, DepthView)
    {
        if (!this.Program || this.Live === 0)
            return;
        const Pass = Encoder.beginRenderPass({
            label: "Sparks",
            colorAttachments: [{ view: TargetView, loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: DepthView, depthReadOnly: true }
        });
        Pass.setPipeline(this.Program);
        Pass.setBindGroup(0, this.Group);
        Pass.setVertexBuffer(0, this.InstanceRecords);
        Pass.draw(6, this.Live, 0, 0);
        Pass.end();
    }

    Clear()
    {
        this.Particles = [];
        this.Live = 0;
        this.Metrics.Live = 0;
    }

    QueryReadout()
    {
        return [`sparks live: ${this.Metrics.Live} · emitted ${this.Metrics.Emitted} · world impacts ${this.Metrics.Collisions} · scrapes this frame ${this.Metrics.Scrapes}`];
    }
}

// Approximate Planck spectral ratios at red/green/blue wavelengths, with a bounded luminous
// intensity. Hot cores have some yellow-white; cooling shifts continuously to dim deep orange/red.
export function ResolveSparkRadiance(Kelvin)
{
    const T = Math.max(700, Math.min(3500, Kelvin));
    const Planck = (Wavelength) => 1 / (Wavelength ** 5 * Math.expm1(14387769 / (Wavelength * T)));
    const Red = Planck(620);
    const Green = Math.min(0.65, Planck(540) / Red * 0.9);
    const Blue = Math.min(0.25, Planck(460) / Red * 0.45);
    const Energy = Math.min(27, 9 * (T / 1800) ** 7);
    return [Energy, Energy * Green, Energy * Blue];
}

// Earliest swept hit: analytic relief (including ramps/kerbs) and obstacle AABBs. AABBs
// conservatively approximate moving rigid bodies; this is particle collision, not solver contact.
export function ResolveSparkCollision(From, To, Boxes = [])
{
    let Best = null;
    const Start = From[2] - ResolveCourseHeight(From[0], From[1]) - 0.005;
    const End = To[2] - ResolveCourseHeight(To[0], To[1]) - 0.005;
    if (Start >= 0 && End < 0)
    {
        let Lo = 0, Hi = 1;
        for (let I = 0; I < 8; ++I)
        {
            const Mid = (Lo + Hi) / 2;
            const P = From.map((V, Axis) => V + (To[Axis] - V) * Mid);
            if (P[2] - ResolveCourseHeight(P[0], P[1]) > 0.005) Lo = Mid;
            else Hi = Mid;
        }
        const Point = From.map((V, Axis) => V + (To[Axis] - V) * Hi);
        Best = { Time: Hi, Point, Normal: ResolveCourseNormal(Point[0], Point[1]) };
    }
    for (const Box of Boxes)
    {
        let Enter = 0, Leave = 1, Normal = null;
        for (let Axis = 0; Axis < 3; ++Axis)
        {
            const Delta = To[Axis] - From[Axis];
            if (Math.abs(Delta) < 1e-9)
            {
                if (From[Axis] < Box.Minimum[Axis] || From[Axis] > Box.Maximum[Axis]) { Enter = 2; break; }
                continue;
            }
            const A = (Box.Minimum[Axis] - From[Axis]) / Delta;
            const B = (Box.Maximum[Axis] - From[Axis]) / Delta;
            const Near = Math.min(A, B), Far = Math.max(A, B);
            if (Near > Enter)
            {
                Enter = Near;
                Normal = [0, 0, 0];
                Normal[Axis] = A < B ? -1 : 1;
            }
            Leave = Math.min(Leave, Far);
        }
        if (Normal && Enter <= Leave && Enter < (Best?.Time ?? 1))
            Best = { Time: Enter, Point: From.map((V, Axis) => V + (To[Axis] - V) * Enter), Normal };
    }
    return Best;
}
