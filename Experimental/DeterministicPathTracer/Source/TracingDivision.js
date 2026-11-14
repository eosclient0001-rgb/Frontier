/*====================================================================================================================================
                                                       TRACINGDIVISION.JS
====================================================================================================================================*/
// 🧩 WebGPU lifecycle owner: scene upload, deterministic accumulation dispatch, display resolve, readback and digest

import { RetrieveVehicleArchives } from './VehicleAssembly.js';
import { ConstructBoundingVolumes } from './BoundingVolumeConstruction.js';
import { ConstructMaterialTable, PackMaterialTable, ConstructShowcaseSpheres, ConstructSoftboxLights } from './StudioSceneAssembly.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const TracingUniformBytes  = 144;   // [B] - 9 × vec4
const DisplayUniformBytes  = 32;    // [B] - 2 × vec4
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

// 📝 Host replica of DisplayExposure.wgsl (ACES fitted + sRGB) for PNG export straight from the accumulation, so saved
//    images never depend on canvas compositor timing.
export function ResolveDisplayPixels(Accumulation, Width, Height, Exposure)
{
    const Pixels = new Uint8ClampedArray(Width * Height * 4);
    const Encode = Linear => (Linear <= 0.0031308 ? Linear * 12.92 : 1.055 * Math.pow(Linear, 1.0 / 2.4) - 0.055);
    for (let Pixel = 0; Pixel < Width * Height; Pixel++)
    {
        const Weight = Accumulation[Pixel * 4 + 3];
        const R = Weight > 0 ? Accumulation[Pixel * 4] / Weight * Exposure : 0;
        const G = Weight > 0 ? Accumulation[Pixel * 4 + 1] / Weight * Exposure : 0;
        const B = Weight > 0 ? Accumulation[Pixel * 4 + 2] / Weight * Exposure : 0;
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

        const [IntegrationSource, DisplaySource, Vehicle] = await Promise.all([
            RetrieveShaderSource('RadianceIntegration.wgsl'),
            RetrieveShaderSource('DisplayExposure.wgsl'),
            RetrieveVehicleArchives(AssetRoot)
        ]);
        this.ConstructPipelines(IntegrationSource, DisplaySource);
        await Promise.all([
            ValidateShaderCompilation(this.IntegrationUnit, 'RadianceIntegration.wgsl'),
            ValidateShaderCompilation(this.DisplayUnit, 'DisplayExposure.wgsl')
        ]);
        this.Vehicle = Vehicle;
        this.TracingUniformBuffer = this.Device.createBuffer({ size: TracingUniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.DisplayUniformBuffer = this.Device.createBuffer({ size: DisplayUniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }

    ConstructPipelines(IntegrationSource, DisplaySource)
    {
        const Device = this.Device;
        this.IntegrationUnit = Device.createShaderModule({ label: 'RadianceIntegration', code: IntegrationSource });
        this.DisplayUnit     = Device.createShaderModule({ label: 'DisplayExposure', code: DisplaySource });

        const ReadOnly = { type: 'read-only-storage' };
        this.IntegrationLayout = Device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ...[1, 2, 3, 4, 5, 6].map(Slot => ({ binding: Slot, visibility: GPUShaderStage.COMPUTE, buffer: ReadOnly })),
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
        ] });
        const IntegrationPipelineLayout = Device.createPipelineLayout({ bindGroupLayouts: [this.IntegrationLayout] });
        this.IntegrationPipeline = Device.createComputePipeline({ layout: IntegrationPipelineLayout, compute: { module: this.IntegrationUnit, entryPoint: 'IntegrateRadiance' } });
        this.QuadraturePipeline  = Device.createComputePipeline({ layout: IntegrationPipelineLayout, compute: { module: this.IntegrationUnit, entryPoint: 'ExtractQuadrature' } });

        this.DisplayLayout = Device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: ReadOnly }
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

        if (!this.TrianglePositionBuffer)
        {
            const Vehicle   = this.Vehicle;
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
            this.BoundsBuffer           = this.CreateStorage(BoundingVolumes.EntryWords, 'BoundsEntries');
            this.TrianglePositionBuffer = this.CreateStorage(Positions, 'TrianglePositions');
            this.TriangleNormalBuffer   = this.CreateStorage(Normals, 'TriangleNormals');
            this.SceneSummary = {
                TriangleCount:    Vehicle.TriangleCount,
                ArchiveFacets:    Vehicle.ArchiveFacets,
                BoundsEntryCount: BoundingVolumes.EntryCount,
                BoundsDepthTier:  BoundingVolumes.MaximumDepthTier
            };
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
        this.AccumulationWidth  = Width;
        this.AccumulationHeight = Height;
        this.AccumulationBuffer = this.Device.createBuffer({
            label: 'Accumulation', size: Width * Height * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });
        this.RebuildIntegrationGroup();
        this.ResetAccumulation();
    }

    RebuildIntegrationGroup()
    {
        if (!this.AccumulationBuffer || !this.MaterialBuffer) return;
        const Buffers = [this.TracingUniformBuffer, this.BoundsBuffer, this.TrianglePositionBuffer, this.TriangleNormalBuffer,
                         this.MaterialBuffer, this.LightBuffer, this.SphereBuffer, this.AccumulationBuffer];
        this.IntegrationGroup = this.Device.createBindGroup({ layout: this.IntegrationLayout,
            entries: Buffers.map((Buffer, Slot) => ({ binding: Slot, resource: { buffer: Buffer } })) });
        this.DisplayGroup = this.Device.createBindGroup({ layout: this.DisplayLayout, entries: [
            { binding: 0, resource: { buffer: this.DisplayUniformBuffer } },
            { binding: 1, resource: { buffer: this.AccumulationBuffer } }
        ] });
    }

    ResetAccumulation()
    {
        this.SampleCount = 0;
        if (!this.AccumulationBuffer) return;
        const Encoder = this.Device.createCommandEncoder();
        Encoder.clearBuffer(this.AccumulationBuffer);
        this.Device.queue.submit([Encoder.finish()]);
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

    WriteTracingUniforms(FirstSample, SampleBatch)
    {
        const Configuration = this.Configuration;
        const Camera = TracingDivision.ResolveCameraVectors(Configuration.Camera, this.AccumulationWidth / this.AccumulationHeight);
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
        this.Device.queue.writeBuffer(this.TracingUniformBuffer, 0, Bytes);
    }

    // 📝 Integrates samples [SampleCount, SampleCount + SampleBatch). Sample indices — and therefore results — do not
    //    depend on batch size, timing or device speed.
    AdvanceSamples(SampleBatch)
    {
        this.WriteTracingUniforms(this.SampleCount, SampleBatch);
        const Encoder = this.Device.createCommandEncoder();
        const Compute = Encoder.beginComputePass();
        Compute.setPipeline(this.IntegrationPipeline);
        Compute.setBindGroup(0, this.IntegrationGroup);
        Compute.dispatchWorkgroups(Math.ceil(this.AccumulationWidth / WorkgroupEdge), Math.ceil(this.AccumulationHeight / WorkgroupEdge));
        Compute.end();
        this.Device.queue.submit([Encoder.finish()]);
        this.SampleCount += SampleBatch;
    }

    PresentDisplay(Exposure)
    {
        if (this.ReadbackSurface) return this.PresentThroughReadback(Exposure);
        const Bytes = new ArrayBuffer(DisplayUniformBytes);
        new Uint32Array(Bytes).set([this.AccumulationWidth, this.AccumulationHeight, 0, 0], 0);
        new Float32Array(Bytes).set([Exposure, 0, 0, 0], 4);
        this.Device.queue.writeBuffer(this.DisplayUniformBuffer, 0, Bytes);
        const Encoder = this.Device.createCommandEncoder();
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
        const Pixels = ResolveDisplayPixels(await this.RetrieveAccumulation(), Width, Height, Exposure);
        this.ReadbackSurface.putImageData(new ImageData(Pixels, Width, Height), 0, 0);
    }

    async RetrieveBuffer(Source, ByteLength)
    {
        const Staging = this.Device.createBuffer({ size: ByteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const Encoder = this.Device.createCommandEncoder();
        Encoder.copyBufferToBuffer(Source, 0, Staging, 0, ByteLength);
        this.Device.queue.submit([Encoder.finish()]);
        await Staging.mapAsync(GPUMapMode.READ);
        const Copy = new Float32Array(Staging.getMappedRange().slice(0));
        Staging.unmap();
        Staging.destroy();
        return Copy;
    }

    RetrieveAccumulation()
    {
        return this.RetrieveBuffer(this.AccumulationBuffer, this.AccumulationWidth * this.AccumulationHeight * 16);
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
