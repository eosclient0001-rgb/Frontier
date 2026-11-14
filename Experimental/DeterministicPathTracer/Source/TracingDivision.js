/*====================================================================================================================================
                                                       TRACINGDIVISION.JS
====================================================================================================================================*/
// 🧩 WebGPU lifecycle owner: scene upload, deterministic accumulation dispatch, display resolve, readback and digest

import { RetrieveVehicleArchives } from './VehicleAssembly.js';
import { ConstructBoundingVolumes } from './BoundingVolumeConstruction.js';
import { ConstructMaterialTable, PackMaterialTable, ConstructShowcaseSpheres, ConstructSoftboxLights, ResolveParkingBays } from './StudioSceneAssembly.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const TracingUniformBytes  = 240;   // [B] - 15 × vec4
const PointPatternCodes    = Object.freeze({ shared: 0, pixel: 1, bluenoise: 2 });   // 📝 Tracing.Realtime.x
const DisplayUniformBytes  = 32;    // [B] - 2 × vec4
const RasterUniformBytes   = 80;    // [B] - 5 × vec4
const AccumulationRegions  = 4;     // [-]  - Exact sums, two ping-pong history regions, luminance moments
const ReconstructionRegions = 4;    // [-]  - Estimate, two à-trous ping-pong regions, display radiance
const ReconstructionSlotBytes = 256; // [B] - One uniform block per reconstruction dispatch (offset alignment)
const AtrousSteps          = [1, 2, 4, 8, 16];   // [px]
const DenoiseFullUntil     = 4;     // [spp] - Full filter strength up to here …
const DenoiseFadedAt       = 64;    // [spp] - … fading (log₂) to the exact image here
const FloorRadius          = 60.0;  // [m]
const WorkgroupEdge        = 8;     // [px]


//------------------------------------------------------------------------------------------------------------------------
//                                                    INTERNAL FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

async function RetrieveShaderSource(Name)
{
    const Response = await fetch(new URL(Name, import.meta.url));
    if (!Response.ok) throw new Error(`${Name}: HTTP ${Response.status}`);
    return Response.text();
}

// 📝 Two 64² void-and-cluster rank masks built offline by Tools/BlueNoiseConstruction.mjs (16 KiB, one r32uint texture).
async function RetrieveBlueNoiseRanks(AssetRoot)
{
    const Response = await fetch(new URL('BlueNoiseRanks.bin', AssetRoot));
    if (!Response.ok) throw new Error(`BlueNoiseRanks.bin: HTTP ${Response.status}`);
    const Ranks = new Uint32Array(await Response.arrayBuffer());
    if (Ranks.length !== 4096) throw new Error(`BlueNoiseRanks.bin: expected 4096 texels, found ${Ranks.length}`);
    return Ranks;
}

async function ValidateShaderCompilation(ShaderUnit, Label)
{
    const Compilation = await ShaderUnit.getCompilationInfo();
    const Failures = Compilation.messages.filter(Message => Message.type === 'error');
    if (Failures.length)
    {
        throw new Error(`${Label} failed to compile:\n` + Failures.map(Message => `${Message.lineNum}:${Message.linePos} ${Message.message}`).join('\n'));
    }
}

// 📝 FNV-1a over the raw IEEE-754 bytes of the accumulation: equal digests mean bit-identical sums.
export function DigestFloatBuffer(Floats)
{
    const Bytes = new Uint8Array(Floats.buffer, Floats.byteOffset, Floats.byteLength);
    let Hash = 0x811c9dc5;
    for (let Index = 0; Index < Bytes.length; Index++)
    {
        Hash ^= Bytes[Index];
        Hash = Math.imul(Hash, 0x01000193) >>> 0;
    }
    return Hash.toString(16).padStart(8, '0');
}

// 📝 Denoiser strength by sample count: 1 up to DenoiseFullUntil, smooth (in log₂ n) to 0 at DenoiseFadedAt, so a
//    converged image is exactly the accumulation.
export function ResolveDenoiseStrength(SampleCount)
{
    const Position = (Math.log2(Math.max(SampleCount, 1)) - Math.log2(DenoiseFullUntil)) / (Math.log2(DenoiseFadedAt) - Math.log2(DenoiseFullUntil));
    const Clamped  = Math.min(1, Math.max(0, Position));
    return 1 - Clamped * Clamped * (3 - 2 * Clamped);
}

// 📝 Host replica of DisplayExposure.wgsl (ACES fitted + sRGB) for PNG export straight from the accumulation, so saved
//    images never depend on canvas compositor timing.
//    History (optional) is the reprojected region, blended exactly as DisplayExposure.wgsl does.
export function ResolveDisplayPixels(Accumulation, Width, Height, Exposure, History = null)
{
    const Pixels = new Uint8ClampedArray(Width * Height * 4);
    const Encode = Linear => (Linear <= 0.0031308 ? Linear * 12.92 : 1.055 * Math.pow(Linear, 1.0 / 2.4) - 0.055);
    for (let Pixel = 0; Pixel < Width * Height; Pixel++)
    {
        const SampleWeight  = Accumulation[Pixel * 4 + 3];
        const HistoryWeight = History ? Math.max(History[Pixel * 4 + 3] - SampleWeight, 0) : 0;
        const Weight = SampleWeight + HistoryWeight;
        const Blend  = Channel => (Accumulation[Pixel * 4 + Channel] + (HistoryWeight > 0 ? History[Pixel * 4 + Channel] * HistoryWeight : 0)) / Weight * Exposure;
        const R = Weight > 0 ? Blend(0) : 0;
        const G = Weight > 0 ? Blend(1) : 0;
        const B = Weight > 0 ? Blend(2) : 0;
        const V = [0.59719 * R + 0.35458 * G + 0.04823 * B, 0.07600 * R + 0.90834 * G + 0.01566 * B, 0.02840 * R + 0.13383 * G + 0.83777 * B];
        const T = V.map(C => (C * (C + 0.0245786) - 0.000090537) / (C * (0.983729 * C + 0.4329510) + 0.238081));
        const Mapped = [
            1.60475 * T[0] - 0.53108 * T[1] - 0.07367 * T[2],
           -0.10208 * T[0] + 1.10813 * T[1] - 0.00605 * T[2],
           -0.00327 * T[0] - 0.07276 * T[1] + 1.07602 * T[2]];
        for (let Channel = 0; Channel < 3; Channel++)
        {
            Pixels[Pixel * 4 + Channel] = Math.round(255 * Encode(Math.min(1, Math.max(0, Mapped[Channel]))));
        }
        Pixels[Pixel * 4 + 3] = 255;
    }
    return Pixels;
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    TRACING DIVISION
//------------------------------------------------------------------------------------------------------------------------

export class TracingDivision
{
    constructor()
    {
        this.Device          = null;
        this.CanvasContext   = null;
        this.ReadbackSurface = null;
        this.SampleCount     = 0;
        this.AccumulationWidth  = 0;
        this.AccumulationHeight = 0;
        this.SceneSummary    = null;
        this.HistoryActive   = false;    // 📝 A reprojected history region is blended into the display
        this.HistoryRegion   = 1;        // 📝 Region (1 or 2) holding the current history
        this.ReprojectionPending = false;
        this.AccumulatedCamera   = null; // 📝 Camera vectors the exact sums were traced with
    }

    // 📝 ReadbackPresentationEnabled shows the image through a 2D canvas (GPU readback + CPU tone map) instead of a
    //    WebGPU swap chain, for browsers that cannot back a WebGPU canvas (e.g. headless SwiftShader).
    async Initialize(Canvas, AssetRoot, ReadbackPresentationEnabled = false)
    {
        if (!navigator.gpu) throw new Error('WebGPU is unavailable in this browser (navigator.gpu missing).');
        const Adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!Adapter) throw new Error('No WebGPU adapter was granted.');
        this.AdapterDescription = [Adapter.info?.vendor, Adapter.info?.architecture, Adapter.info?.description].filter(Boolean).join(' · ') || 'WebGPU adapter';
        this.Device = await Adapter.requestDevice({
            requiredLimits: { maxStorageBuffersPerShaderStage: 8, maxStorageBufferBindingSize: Math.min(Adapter.limits.maxStorageBufferBindingSize, 256 * 1024 * 1024) }
        });
        this.Device.lost.then(Loss => console.error(`WebGPU device lost: ${Loss.message}`));

        this.CanvasFormat = navigator.gpu.getPreferredCanvasFormat();
        if (ReadbackPresentationEnabled)
        {
            this.ReadbackSurface = Canvas.getContext('2d');
        }
        else
        {
            this.CanvasContext = Canvas.getContext('webgpu');
            this.CanvasContext.configure({ device: this.Device, format: this.CanvasFormat, alphaMode: 'opaque' });
        }

        const [QuadratureSource, IntegrationSource, DisplaySource, RasterSource, ReconstructionSource, Vehicle, BlueNoiseRanks] = await Promise.all([
            RetrieveShaderSource('QuadratureSequence.wgsl'),
            RetrieveShaderSource('RadianceIntegration.wgsl'),
            RetrieveShaderSource('DisplayExposure.wgsl'),
            RetrieveShaderSource('VisibilityRasterization.wgsl'),
            RetrieveShaderSource('DisplayReconstruction.wgsl'),
            RetrieveVehicleArchives(AssetRoot),
            RetrieveBlueNoiseRanks(AssetRoot)
        ]);
        this.ConstructPipelines(QuadratureSource + IntegrationSource, DisplaySource, QuadratureSource + RasterSource, ReconstructionSource);
        await Promise.all([
            ValidateShaderCompilation(this.ReconstructionUnit, 'DisplayReconstruction.wgsl'),
            ValidateShaderCompilation(this.IntegrationUnit, 'RadianceIntegration.wgsl'),
            ValidateShaderCompilation(this.DisplayUnit, 'DisplayExposure.wgsl'),
            ValidateShaderCompilation(this.RasterUnit, 'VisibilityRasterization.wgsl')
        ]);
        this.Vehicle = Vehicle;
        this.TracingUniformBuffer = this.Device.createBuffer({ size: TracingUniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.DisplayUniformBuffer = this.Device.createBuffer({ size: DisplayUniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.RasterUniformBuffer  = this.Device.createBuffer({ size: RasterUniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.ReconstructionUniformBuffer = this.Device.createBuffer({ size: ReconstructionSlotBytes * (1 + AtrousSteps.length), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.BlueNoiseTexture     = this.Device.createTexture({ label: 'BlueNoiseRanks', size: [64, 64], format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        this.Device.queue.writeTexture({ texture: this.BlueNoiseTexture }, BlueNoiseRanks, { bytesPerRow: 64 * 4 }, [64, 64]);
    }

    ConstructPipelines(IntegrationSource, DisplaySource, RasterSource, ReconstructionSource)
    {
        const Device = this.Device;
        this.ReconstructionUnit = Device.createShaderModule({ label: 'DisplayReconstruction', code: ReconstructionSource });
        this.IntegrationUnit = Device.createShaderModule({ label: 'RadianceIntegration', code: IntegrationSource });
        this.DisplayUnit     = Device.createShaderModule({ label: 'DisplayExposure', code: DisplaySource });
        this.RasterUnit      = Device.createShaderModule({ label: 'VisibilityRasterization', code: RasterSource });

        const ReadOnly = { type: 'read-only-storage' };
        this.IntegrationLayout = Device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ...[1, 2, 3, 4, 5, 6].map(Slot => ({ binding: Slot, visibility: GPUShaderStage.COMPUTE, buffer: ReadOnly })),
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 8, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
            { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
            { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
        ] });
        const IntegrationPipelineLayout = Device.createPipelineLayout({ bindGroupLayouts: [this.IntegrationLayout] });
        this.IntegrationPipeline = Device.createComputePipeline({ layout: IntegrationPipelineLayout, compute: { module: this.IntegrationUnit, entryPoint: 'IntegrateRadiance' } });
        this.QuadraturePipeline  = Device.createComputePipeline({ layout: IntegrationPipelineLayout, compute: { module: this.IntegrationUnit, entryPoint: 'ExtractQuadrature' } });
        this.ReprojectionPipeline = Device.createComputePipeline({ layout: IntegrationPipelineLayout, compute: { module: this.IntegrationUnit, entryPoint: 'ReprojectHistory' } });
        this.FeaturePipeline      = Device.createComputePipeline({ layout: IntegrationPipelineLayout, compute: { module: this.IntegrationUnit, entryPoint: 'ResolveSurfaceFeatures' } });

        this.ReconstructionLayout = Device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: ReadOnly },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: ReadOnly },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
        ] });
        const ReconstructionPipelineLayout = Device.createPipelineLayout({ bindGroupLayouts: [this.ReconstructionLayout] });
        this.GatherPipeline = Device.createComputePipeline({ layout: ReconstructionPipelineLayout, compute: { module: this.ReconstructionUnit, entryPoint: 'GatherEstimate' } });
        this.AtrousPipeline = Device.createComputePipeline({ layout: ReconstructionPipelineLayout, compute: { module: this.ReconstructionUnit, entryPoint: 'FilterAtrous' } });

        this.RasterLayout = Device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: ReadOnly }
        ] });
        this.RasterPipeline = Device.createRenderPipeline({
            layout:       Device.createPipelineLayout({ bindGroupLayouts: [this.RasterLayout] }),
            vertex:       { module: this.RasterUnit, entryPoint: 'ProjectTriangleCorner' },
            fragment:     { module: this.RasterUnit, entryPoint: 'WriteTriangleIdentifier', targets: [{ format: 'r32uint' }] },
            primitive:    { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }
        });

        this.DisplayLayout = Device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: ReadOnly },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: ReadOnly }
        ] });
        this.DisplayPipeline = Device.createRenderPipeline({
            layout:    Device.createPipelineLayout({ bindGroupLayouts: [this.DisplayLayout] }),
            vertex:    { module: this.DisplayUnit, entryPoint: 'ProjectScreenTriangle' },
            fragment:  { module: this.DisplayUnit, entryPoint: 'ResolveDisplay', targets: [{ format: this.CanvasFormat }] },
            primitive: { topology: 'triangle-list' }
        });
    }

    CreateStorage(Contents, Label)
    {
        const Buffer = this.Device.createBuffer({ label: Label, size: Math.max(16, Contents.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.Device.queue.writeBuffer(Buffer, 0, Contents);
        return Buffer;
    }

    // 📝 Materials and lights change with the inspector; geometry is uploaded once per material layout.
    ConfigureScene(Configuration)
    {
        const MaterialTable = ConstructMaterialTable(Configuration);
        const Spheres       = ConstructShowcaseSpheres(MaterialTable.SlotIndex);
        const Lights        = ConstructSoftboxLights(Configuration);

        const VehicleCount = Configuration.VehicleCount ?? 1;
        if (!this.TrianglePositionBuffer || this.GeometryVehicleCount !== VehicleCount)
        {
            const ConstructionStart = performance.now();
            const Vehicle   = TracingDivision.ArrangeFleet(this.Vehicle, ResolveParkingBays(VehicleCount));
            const BoundingVolumes = ConstructBoundingVolumes(Vehicle.Positions, Vehicle.TriangleCount);
            const Positions = new Float32Array(Vehicle.TriangleCount * 12);
            const PositionWords = new Uint32Array(Positions.buffer);
            const Normals   = new Float32Array(Vehicle.TriangleCount * 12);
            for (let Slot = 0; Slot < Vehicle.TriangleCount; Slot++)
            {
                const Source = BoundingVolumes.Order[Slot], P = Source * 9, O = Slot * 12;
                const Ax = Vehicle.Positions[P], Ay = Vehicle.Positions[P + 1], Az = Vehicle.Positions[P + 2];
                Positions.set([Ax, Ay, Az, 0,
                               Vehicle.Positions[P + 3] - Ax, Vehicle.Positions[P + 4] - Ay, Vehicle.Positions[P + 5] - Az, 0,
                               Vehicle.Positions[P + 6] - Ax, Vehicle.Positions[P + 7] - Ay, Vehicle.Positions[P + 8] - Az, 0], O);
                PositionWords[O + 3] = MaterialTable.SlotIndex[Vehicle.Slots[Source]];
                Normals.set([Vehicle.Normals[P], Vehicle.Normals[P + 1], Vehicle.Normals[P + 2], 0,
                             Vehicle.Normals[P + 3], Vehicle.Normals[P + 4], Vehicle.Normals[P + 5], 0,
                             Vehicle.Normals[P + 6], Vehicle.Normals[P + 7], Vehicle.Normals[P + 8], 0], O);
            }
            this.BoundsBuffer?.destroy(); this.TrianglePositionBuffer?.destroy(); this.TriangleNormalBuffer?.destroy();
            this.BoundsBuffer           = this.CreateStorage(BoundingVolumes.EntryWords, 'BoundsEntries');
            this.TrianglePositionBuffer = this.CreateStorage(Positions, 'TrianglePositions');
            this.TriangleNormalBuffer   = this.CreateStorage(Normals, 'TriangleNormals');
            this.SceneSummary = {
                TriangleCount:    Vehicle.TriangleCount,
                ArchiveFacets:    Vehicle.ArchiveFacets,
                BoundsEntryCount: BoundingVolumes.EntryCount,
                BoundsDepthTier:  BoundingVolumes.MaximumDepthTier,
                VehicleCount,
                ConstructionMilliseconds: Math.round(performance.now() - ConstructionStart)
            };
            this.GeometryVehicleCount = VehicleCount;
        }

        this.MaterialBuffer?.destroy(); this.LightBuffer?.destroy(); this.SphereBuffer?.destroy();
        this.MaterialBuffer = this.CreateStorage(PackMaterialTable(MaterialTable), 'Materials');
        this.LightBuffer    = this.CreateStorage(Lights.Packed, 'AreaLights');
        this.SphereBuffer   = this.CreateStorage(Spheres.Packed, 'Spheres');
        this.SceneSummary.SphereCount = Spheres.Count;
        this.SceneSummary.LightCount  = Lights.Count;
        this.SceneSummary.MaterialCount = MaterialTable.Slots.length;
        this.FloorSlot  = MaterialTable.SlotIndex.StudioFloor;
        this.Configuration = { ...Configuration };
        this.RebuildIntegrationGroup();
        this.ResetAccumulation();
    }

    ResizeAccumulation(Width, Height)
    {
        if (Width === this.AccumulationWidth && Height === this.AccumulationHeight && this.AccumulationBuffer) return;
        this.AccumulationBuffer?.destroy();
        this.ReconstructionBuffer?.destroy();
        this.FeatureBuffer?.destroy();
        this.VisibilityTexture?.destroy();
        this.RasterDepthTexture?.destroy();
        this.AccumulationWidth  = Width;
        this.AccumulationHeight = Height;
        this.AccumulationBuffer = this.Device.createBuffer({
            label: 'Accumulation', size: Width * Height * 16 * AccumulationRegions,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });
        this.ReconstructionBuffer = this.Device.createBuffer({
            label: 'Reconstruction', size: Width * Height * 16 * ReconstructionRegions,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        this.FeatureBuffer = this.Device.createBuffer({ label: 'SurfaceFeatures', size: Width * Height * 16 * 2, usage: GPUBufferUsage.STORAGE });
        this.VisibilityTexture = this.Device.createTexture({ label: 'VisibilityIds', size: [Width, Height], format: 'r32uint',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.RasterDepthTexture = this.Device.createTexture({ label: 'VisibilityDepth', size: [Width, Height], format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT });
        this.AccumulatedCamera = null;
        this.RebuildIntegrationGroup();
        this.ResetAccumulation();
    }

    RebuildIntegrationGroup()
    {
        if (!this.AccumulationBuffer || !this.MaterialBuffer) return;
        const Buffers = [this.TracingUniformBuffer, this.BoundsBuffer, this.TrianglePositionBuffer, this.TriangleNormalBuffer,
                         this.MaterialBuffer, this.LightBuffer, this.SphereBuffer, this.AccumulationBuffer];
        this.IntegrationGroup = this.Device.createBindGroup({ layout: this.IntegrationLayout, entries: [
            ...Buffers.map((Buffer, Slot) => ({ binding: Slot, resource: { buffer: Buffer } })),
            { binding: 8, resource: this.VisibilityTexture.createView() },
            { binding: 9, resource: this.BlueNoiseTexture.createView() },
            { binding: 10, resource: { buffer: this.FeatureBuffer } }
        ] });
        this.ReconstructionGroups = Array.from({ length: 1 + AtrousSteps.length }, (_, Slot) => this.Device.createBindGroup({ layout: this.ReconstructionLayout, entries: [
            { binding: 0, resource: { buffer: this.ReconstructionUniformBuffer, offset: Slot * ReconstructionSlotBytes, size: 64 } },
            { binding: 1, resource: { buffer: this.AccumulationBuffer } },
            { binding: 2, resource: { buffer: this.FeatureBuffer } },
            { binding: 3, resource: { buffer: this.ReconstructionBuffer } }
        ] }));
        this.FeaturesStale = true;
        this.RasterGroup = this.Device.createBindGroup({ layout: this.RasterLayout, entries: [
            { binding: 0, resource: { buffer: this.RasterUniformBuffer } },
            { binding: 1, resource: { buffer: this.TrianglePositionBuffer } }
        ] });
        this.DisplayGroup = this.Device.createBindGroup({ layout: this.DisplayLayout, entries: [
            { binding: 0, resource: { buffer: this.DisplayUniformBuffer } },
            { binding: 1, resource: { buffer: this.AccumulationBuffer } },
            { binding: 2, resource: { buffer: this.ReconstructionBuffer } }
        ] });
    }

    // 📝 ReprojectHistory = true (camera moved, reprojection enabled): the clear is deferred to the next dispatch or
    //    present, so several camera events within one display frame cost a single reprojection.
    ResetAccumulation(ReprojectHistory = false)
    {
        this.SampleCount = 0;
        if (!this.AccumulationBuffer) return;
        if (ReprojectHistory && this.Configuration?.ReprojectionEnabled && this.AccumulatedCamera)
        {
            this.ReprojectionPending = true;
            return;
        }
        this.ReprojectionPending = false;
        this.HistoryActive       = false;
        this.AccumulatedCamera   = this.Configuration?.Camera ? this.ResolveCurrentCamera() : null;
        this.FeaturesStale       = true;
        const Encoder = this.Device.createCommandEncoder();
        this.EncodeSumClear(Encoder);
        this.Device.queue.submit([Encoder.finish()]);
    }

    // 📝 Copies the assembled vehicle into each parking bay (rotation about +Y, then translation). Bay 0 is the identity,
    //    so a single vehicle keeps its original float bits.
    static ArrangeFleet(Vehicle, Bays)
    {
        if (Bays.length === 1 && Bays[0].X === 0 && Bays[0].Z === 0 && Bays[0].Yaw === 0) return Vehicle;
        const Stride = Vehicle.TriangleCount * 9;
        const Positions = new Float32Array(Stride * Bays.length), Normals = new Float32Array(Stride * Bays.length), Slots = [];
        Bays.forEach((Bay, BayIndex) =>
        {
            const Cosine = Math.cos(Bay.Yaw), Sine = Math.sin(Bay.Yaw), Base = BayIndex * Stride;
            for (let Corner = 0; Corner < Stride; Corner += 3)
            {
                const X = Vehicle.Positions[Corner], Y = Vehicle.Positions[Corner + 1], Z = Vehicle.Positions[Corner + 2];
                Positions.set([Cosine * X + Sine * Z + Bay.X, Y, -Sine * X + Cosine * Z + Bay.Z], Base + Corner);
                const NormalX = Vehicle.Normals[Corner], NormalY = Vehicle.Normals[Corner + 1], NormalZ = Vehicle.Normals[Corner + 2];
                Normals.set([Cosine * NormalX + Sine * NormalZ, NormalY, -Sine * NormalX + Cosine * NormalZ], Base + Corner);
            }
            for (const Slot of Vehicle.Slots) Slots.push(Bay.PaintSlot && Slot === 'BodyCoat' ? Bay.PaintSlot : Slot);
        });
        return { ...Vehicle, TriangleCount: Vehicle.TriangleCount * Bays.length, Positions, Normals, Slots };
    }

    ResolveCurrentCamera()
    {
        return TracingDivision.ResolveCameraVectors(this.Configuration.Camera, this.AccumulationWidth / this.AccumulationHeight);
    }

    // 📝 Carries the displayed image of the previous camera into the other history region, then clears the sums.
    FlushPendingReprojection()
    {
        if (!this.ReprojectionPending) return;
        const PixelCount   = this.AccumulationWidth * this.AccumulationHeight;
        const TargetRegion = 3 - this.HistoryRegion;
        this.WriteTracingUniforms(0, 1, this.AccumulatedCamera, this.HistoryRegion * PixelCount, TargetRegion * PixelCount);
        const Encoder = this.Device.createCommandEncoder();
        const Compute = Encoder.beginComputePass();
        Compute.setPipeline(this.ReprojectionPipeline);
        Compute.setBindGroup(0, this.IntegrationGroup);
        Compute.dispatchWorkgroups(Math.ceil(this.AccumulationWidth / WorkgroupEdge), Math.ceil(this.AccumulationHeight / WorkgroupEdge));
        Compute.end();
        this.EncodeSumClear(Encoder);
        this.Device.queue.submit([Encoder.finish()]);
        this.FeaturesStale       = true;
        this.HistoryRegion       = TargetRegion;
        this.HistoryActive       = true;
        this.ReprojectionPending = false;
        this.AccumulatedCamera   = this.ResolveCurrentCamera();
    }

    // 📝 Clears the exact sums and their luminance moments (regions 0 and 3); history regions are kept.
    EncodeSumClear(Encoder)
    {
        const RegionBytes = this.AccumulationWidth * this.AccumulationHeight * 16;
        Encoder.clearBuffer(this.AccumulationBuffer, 0, RegionBytes);
        Encoder.clearBuffer(this.AccumulationBuffer, 3 * RegionBytes, RegionBytes);
    }

    // 📝 The display goes through DisplayReconstruction.wgsl when history is blended in or the denoiser has strength;
    //    otherwise it shows the exact sums directly.
    DenoiseStrength()
    {
        return this.Configuration?.DenoiseEnabled ? ResolveDenoiseStrength(this.SampleCount) : 0;
    }

    ReconstructionActive()
    {
        return this.HistoryActive || this.DenoiseStrength() > 0;
    }

    // 📝 ① Guide buffers when the camera or scene changed, ② gather (history clamp + fade), ③ à-trous steps when the
    //    denoiser is on. Result: display radiance (rgb, 1) in region 3 of the reconstruction buffer.
    EncodeReconstruction(Encoder)
    {
        const Width = this.AccumulationWidth, Height = this.AccumulationHeight, PixelCount = Width * Height;
        const Workgroups = [Math.ceil(Width / WorkgroupEdge), Math.ceil(Height / WorkgroupEdge)];
        const Configuration = this.Configuration;
        if (this.FeaturesStale)
        {
            this.WriteTracingUniforms(this.SampleCount, 0);
            const Compute = Encoder.beginComputePass();
            Compute.setPipeline(this.FeaturePipeline);
            Compute.setBindGroup(0, this.IntegrationGroup);
            Compute.dispatchWorkgroups(...Workgroups);
            Compute.end();
            this.FeaturesStale = false;
        }
        const Strength  = this.DenoiseStrength();
        const Steps     = Strength > 0 ? AtrousSteps : [];
        const Footprint = 2.0 * Math.tan(Configuration.Camera.FieldOfView * Math.PI / 360.0) / Height;
        const HistoryOffset = this.HistoryRegion * PixelCount;
        const Bytes = new ArrayBuffer(ReconstructionSlotBytes * (1 + AtrousSteps.length));
        const WriteSlot = (Slot, Step, Mode, ReadOffset, WriteOffset) =>
        {
            const Base = Slot * ReconstructionSlotBytes / 4;
            new Uint32Array(Bytes).set([Width, Height, Step, Mode, ReadOffset, WriteOffset, HistoryOffset, this.SampleCount], Base);
            new Float32Array(Bytes).set([Configuration.HistoryClamp ?? 0, Configuration.HistorySpan ?? 8, Strength,
                                         (Configuration.DenoiseLuminanceSigma ?? 4) / Math.max(this.SampleCount, 1),
                                         Footprint, 64, 2, 0], Base + 8);
        };
        const HistoryMode = this.HistoryActive ? 1 : 0;
        WriteSlot(0, 0, HistoryMode | 4 | (Steps.length ? 0 : 2), 0, Steps.length ? 0 : 3 * PixelCount);
        let ReadRegion = 0;
        Steps.forEach((Step, Index) =>
        {
            const Last = Index === Steps.length - 1;
            const WriteRegion = Last ? 3 : (ReadRegion === 1 ? 2 : 1);
            WriteSlot(1 + Index, Step, Last ? 2 : 0, ReadRegion * PixelCount, WriteRegion * PixelCount);
            ReadRegion = WriteRegion;
        });
        this.Device.queue.writeBuffer(this.ReconstructionUniformBuffer, 0, Bytes);
        const Compute = Encoder.beginComputePass();
        Compute.setPipeline(this.GatherPipeline);
        Compute.setBindGroup(0, this.ReconstructionGroups[0]);
        Compute.dispatchWorkgroups(...Workgroups);
        Compute.setPipeline(this.AtrousPipeline);
        Steps.forEach((_, Index) => { Compute.setBindGroup(0, this.ReconstructionGroups[1 + Index]); Compute.dispatchWorkgroups(...Workgroups); });
        Compute.end();
    }

    // 📝 Linear radiance exactly as displayed, as (rgb sum, weight) texels: reconstruction region 3 when active, the exact
    //    sums otherwise. Feed to ResolveDisplayPixels without history.
    async RetrieveDisplayRadiance()
    {
        this.FlushPendingReprojection();
        if (!this.ReconstructionActive()) return this.RetrieveAccumulation();
        const Encoder = this.Device.createCommandEncoder();
        this.EncodeReconstruction(Encoder);
        this.Device.queue.submit([Encoder.finish()]);
        const RegionBytes = this.AccumulationWidth * this.AccumulationHeight * 16;
        return this.RetrieveBuffer(this.ReconstructionBuffer, RegionBytes, 3 * RegionBytes);
    }

    // 📝 Camera = orbit about a target. Returns the vectors the integration uniform expects.
    static ResolveCameraVectors(Camera, Aspect)
    {
        const CosPitch = Math.cos(Camera.Pitch);
        const Origin = [Camera.Target[0] + Camera.Distance * CosPitch * Math.sin(Camera.Yaw),
                        Camera.Target[1] + Camera.Distance * Math.sin(Camera.Pitch),
                        Camera.Target[2] + Camera.Distance * CosPitch * Math.cos(Camera.Yaw)];
        const Normalize = V => { const L = Math.hypot(V[0], V[1], V[2]) || 1; return V.map(C => C / L); };
        const Cross = (A, B) => [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
        const Forward = Normalize([Camera.Target[0] - Origin[0], Camera.Target[1] - Origin[1], Camera.Target[2] - Origin[2]]);
        const Right   = Normalize(Cross(Forward, [0, 1, 0]));
        const Up      = Cross(Right, Forward);
        const TangentHalf = Math.tan(Camera.FieldOfView * Math.PI / 360.0);
        return { Origin, Forward, Right: Right.map(C => C * TangentHalf * Aspect), Up: Up.map(C => C * TangentHalf) };
    }

    WriteTracingUniforms(FirstSample, SampleBatch, PreviousCamera = null, HistoryReadOffset = 0, HistoryWriteOffset = 0)
    {
        const Configuration = this.Configuration;
        const Camera = this.ResolveCurrentCamera();
        const Bytes  = new ArrayBuffer(TracingUniformBytes);
        const Floats = new Float32Array(Bytes), Words = new Uint32Array(Bytes);
        const FocusDistance = Configuration.FocusDistance > 0 ? Configuration.FocusDistance : Configuration.Camera.Distance;
        Floats.set([...Camera.Origin, Configuration.ApertureRadius], 0);
        Floats.set([...Camera.Forward, FocusDistance], 4);
        Floats.set([...Camera.Right, 0], 8);
        Floats.set([...Camera.Up, 0], 12);
        Floats.set([1, 1, 1, Configuration.EnvironmentIntensity], 16);
        Words.set([this.AccumulationWidth, this.AccumulationHeight, FirstSample, SampleBatch], 20);
        Words.set([Configuration.BounceLimit, Configuration.DepthLimit, this.SceneSummary.LightCount, Configuration.ShowcaseEnabled === false ? 0 : this.SceneSummary.SphereCount], 24);
        Words.set([this.FloorSlot, Configuration.EnvironmentCategory, this.SceneSummary.BoundsEntryCount, Configuration.VehicleEnabled === false ? 0 : 1], 28);
        Floats.set([Configuration.ThroughputCutoff, FloorRadius, Configuration.LightsVisibleToCamera ? 1 : 0, 0], 32);
        const Previous = PreviousCamera ?? Camera;
        Floats.set([...Previous.Origin, 0, ...Previous.Forward, 0, ...Previous.Right, 0, ...Previous.Up, 0], 36);
        Words.set([PointPatternCodes[Configuration.PointPattern] ?? 0, this.RasterizedVisibilityActive() ? 1 : 0, HistoryReadOffset, HistoryWriteOffset], 52);
        Floats.set([Configuration.HistoryCapacity ?? 32, this.HistoryActive ? 1 : 0, 0, 0], 56);
        this.Device.queue.writeBuffer(this.TracingUniformBuffer, 0, Bytes);
    }

    // 📝 Integrates samples [SampleCount, SampleCount + SampleBatch). Sample indices — and therefore results — do not
    //    depend on batch size, timing or device speed.
    //    With the visibility raster each sample needs its own raster (its own subpixel offset), so samples are submitted
    //    one by one; the integrated values are the same either way.
    AdvanceSamples(SampleBatch)
    {
        this.FlushPendingReprojection();
        const Rasterized = this.RasterizedVisibilityActive();
        for (let Submitted = 0; Submitted < SampleBatch; Submitted += Rasterized ? 1 : SampleBatch)
        {
            const FirstSample = this.SampleCount + Submitted;
            const Count       = Rasterized ? 1 : SampleBatch;
            this.WriteTracingUniforms(FirstSample, Count);
            const Encoder = this.Device.createCommandEncoder();
            if (Rasterized) this.EncodeVisibilityRasterization(Encoder, FirstSample);
            const Compute = Encoder.beginComputePass();
            Compute.setPipeline(this.IntegrationPipeline);
            Compute.setBindGroup(0, this.IntegrationGroup);
            Compute.dispatchWorkgroups(Math.ceil(this.AccumulationWidth / WorkgroupEdge), Math.ceil(this.AccumulationHeight / WorkgroupEdge));
            Compute.end();
            this.Device.queue.submit([Encoder.finish()]);
        }
        this.SampleCount += SampleBatch;
    }

    // 📝 Raster replaces only pinhole camera rays to the vehicle; a thick lens or a hidden vehicle uses the traced path.
    RasterizedVisibilityActive()
    {
        const Configuration = this.Configuration;
        return Boolean(Configuration?.VisibilityRasterEnabled) && Configuration.ApertureRadius <= 0 && Configuration.VehicleEnabled !== false;
    }

    EncodeVisibilityRasterization(Encoder, SampleIndex)
    {
        const Camera = this.ResolveCurrentCamera();
        const Bytes  = new ArrayBuffer(RasterUniformBytes);
        new Float32Array(Bytes).set([...Camera.Origin, 0, ...Camera.Forward, 0, ...Camera.Right, 0, ...Camera.Up, 0], 0);
        new Uint32Array(Bytes).set([this.AccumulationWidth, this.AccumulationHeight, SampleIndex, 0], 16);
        this.Device.queue.writeBuffer(this.RasterUniformBuffer, 0, Bytes);
        const Raster = Encoder.beginRenderPass({
            colorAttachments: [{ view: this.VisibilityTexture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
            depthStencilAttachment: { view: this.RasterDepthTexture.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1.0 }
        });
        Raster.setPipeline(this.RasterPipeline);
        Raster.setBindGroup(0, this.RasterGroup);
        Raster.draw(this.SceneSummary.TriangleCount * 3);
        Raster.end();
    }

    PresentDisplay(Exposure)
    {
        this.FlushPendingReprojection();
        if (this.ReadbackSurface) return this.PresentThroughReadback(Exposure);
        const Reconstructed = this.ReconstructionActive();
        const PixelCount = this.AccumulationWidth * this.AccumulationHeight;
        const Bytes = new ArrayBuffer(DisplayUniformBytes);
        new Uint32Array(Bytes).set([this.AccumulationWidth, this.AccumulationHeight, 0, Reconstructed ? 3 * PixelCount : 0], 0);
        new Float32Array(Bytes).set([Exposure, 0, Reconstructed ? 1 : 0, 0], 4);
        this.Device.queue.writeBuffer(this.DisplayUniformBuffer, 0, Bytes);
        const Encoder = this.Device.createCommandEncoder();
        if (Reconstructed) this.EncodeReconstruction(Encoder);
        const Raster  = Encoder.beginRenderPass({ colorAttachments: [{
            view: this.CanvasContext.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }] });
        Raster.setPipeline(this.DisplayPipeline);
        Raster.setBindGroup(0, this.DisplayGroup);
        Raster.draw(3);
        Raster.end();
        this.Device.queue.submit([Encoder.finish()]);
    }

    async PresentThroughReadback(Exposure)
    {
        const Width = this.AccumulationWidth, Height = this.AccumulationHeight;
        const Pixels = ResolveDisplayPixels(await this.RetrieveDisplayRadiance(), Width, Height, Exposure);
        this.ReadbackSurface.putImageData(new ImageData(Pixels, Width, Height), 0, 0);
    }

    async RetrieveBuffer(Source, ByteLength, ByteOffset = 0)
    {
        const Staging = this.Device.createBuffer({ size: ByteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const Encoder = this.Device.createCommandEncoder();
        Encoder.copyBufferToBuffer(Source, ByteOffset, Staging, 0, ByteLength);
        this.Device.queue.submit([Encoder.finish()]);
        await Staging.mapAsync(GPUMapMode.READ);
        const Copy = new Float32Array(Staging.getMappedRange().slice(0));
        Staging.unmap();
        Staging.destroy();
        return Copy;
    }

    RetrieveAccumulation()
    {
        this.FlushPendingReprojection();
        return this.RetrieveBuffer(this.AccumulationBuffer, this.AccumulationWidth * this.AccumulationHeight * 16);
    }

    RetrieveHistory()
    {
        const RegionBytes = this.AccumulationWidth * this.AccumulationHeight * 16;
        return this.RetrieveBuffer(this.AccumulationBuffer, RegionBytes, this.HistoryRegion * RegionBytes);
    }

    async ComputeAccumulationDigest()
    {
        return DigestFloatBuffer(await this.RetrieveAccumulation());
    }

    // 📝 Validation: runs the shader's own QuadraturePair for k < SampleTotal, p < PairTotal through the accumulation
    //    buffer (which must hold at least SampleTotal × PairTotal texels), then resets it.
    async ExtractQuadratureOnDevice(SampleTotal, PairTotal)
    {
        const Bytes = new ArrayBuffer(TracingUniformBytes);
        new Uint32Array(Bytes).set([SampleTotal, PairTotal, 0, 0], 20);
        this.Device.queue.writeBuffer(this.TracingUniformBuffer, 0, Bytes);
        const Encoder = this.Device.createCommandEncoder();
        const Compute = Encoder.beginComputePass();
        Compute.setPipeline(this.QuadraturePipeline);
        Compute.setBindGroup(0, this.IntegrationGroup);
        Compute.dispatchWorkgroups(Math.ceil(SampleTotal * PairTotal / 64));
        Compute.end();
        this.Device.queue.submit([Encoder.finish()]);
        const Points = await this.RetrieveBuffer(this.AccumulationBuffer, SampleTotal * PairTotal * 16);
        this.ResetAccumulation();
        return Points;
    }
}
