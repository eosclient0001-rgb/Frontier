//============================================================================================================================================
//                                                            DEVICEEXCHANGE.JS
//============================================================================================================================================
// 📦 WebGL2 device ownership, shared-shader pipelines, vertex uploads, depth targets and integer-identity pixel readback.

import { CompileSources } from "./ShaderCodec.js";

export class DeviceExchange
{
    constructor(Canvas)
    {
        this.Canvas = Canvas;
        this.Gl = Canvas.getContext("webgl2", {alpha: true, antialias: false, depth: true, preserveDrawingBuffer: true});
        if (!this.Gl) throw Error("WebGL2 is unavailable. SolidArc will not silently fall back to CPU rasterization.");
        const Gl = this.Gl;
        const Extension = Gl.getExtension("WEBGL_debug_renderer_info");
        this.MaximumExtent = Math.min(4096, Gl.getParameter(Gl.MAX_RENDERBUFFER_SIZE), Gl.getParameter(Gl.MAX_TEXTURE_SIZE));
        this.Samples = Math.min(4, Gl.getParameter(Gl.MAX_SAMPLES));
        this.Adapter = Extension ? Gl.getParameter(Extension.UNMASKED_RENDERER_WEBGL) : Gl.getParameter(Gl.RENDERER);
        this.Software = /swiftshader|llvmpipe|lavapipe|software|softpipe/i.test(this.Adapter);
        this.Programs = new Map();
        this.Vertices = [];
        this.Targets = [];
        this.Extent = [0, 0];
        this.FrameNumber = 0;
        this.DrawCalls = 0;
        this.UploadedBytes = 0;
        this.Screen = Gl.createVertexArray();
        for (const Kind of ["surface", "line", "point", "lattice", "display", "studio"])
        {
            const Source = CompileSources(Kind);
            const Program = Gl.createProgram();
            const Shaders = [];
            try
            {
                for (const [Stage, Text] of [[Gl.VERTEX_SHADER, Source.vertex], [Gl.FRAGMENT_SHADER, Source.fragment]])
                {
                    const Shader = Gl.createShader(Stage);
                    Shaders.push(Shader);
                    Gl.shaderSource(Shader, Text);
                    Gl.compileShader(Shader);
                    if (!Gl.getShaderParameter(Shader, Gl.COMPILE_STATUS))
                        throw Error(`${Kind} shader failed: ${Gl.getShaderInfoLog(Shader)}`);
                    Gl.attachShader(Program, Shader);
                }
                Gl.linkProgram(Program);
                if (!Gl.getProgramParameter(Program, Gl.LINK_STATUS))
                    throw Error(`${Kind} pipeline failed: ${Gl.getProgramInfoLog(Program)}`);
                this.Programs.set(Kind, {program: Program, uniforms: new Map()});
            }
            catch (ErrorValue)
            {
                Gl.deleteProgram(Program);
                this.Release();
                throw ErrorValue;
            }
            finally
            {
                for (const Shader of Shaders) Gl.deleteShader(Shader);
            }
        }
        this.Lost = false;
        this.LossContact = (Event) =>
        {
            Event.preventDefault();
            this.Lost = true;
            Canvas.dispatchEvent(new CustomEvent("solidarc-device-lost"));
        };
        Canvas.addEventListener("webglcontextlost", this.LossContact);
        Gl.disable(Gl.DITHER);
        Gl.disable(Gl.CULL_FACE);
        Gl.frontFace(Gl.CCW);
        this.BakeStudio();
    }

    BakeStudio()
    {
        const Gl = this.Gl;
        // Same 128x128 studio cache as the CPU reference, but generated entirely by GPU
        // shader draws. Unsupported float targets retain analytic shading, never CPU pixels.
        if (!Gl.getExtension("EXT_color_buffer_float")) return;
        const Texture = Gl.createTexture(), Framebuffer = Gl.createFramebuffer();
        Gl.activeTexture(Gl.TEXTURE1);
        Gl.bindTexture(Gl.TEXTURE_2D_ARRAY, Texture);
        Gl.texImage3D(Gl.TEXTURE_2D_ARRAY, 0, Gl.RGBA16F, 128, 128, 14, 0, Gl.RGBA, Gl.HALF_FLOAT, null);
        Gl.texParameteri(Gl.TEXTURE_2D_ARRAY, Gl.TEXTURE_MIN_FILTER, Gl.LINEAR);
        Gl.texParameteri(Gl.TEXTURE_2D_ARRAY, Gl.TEXTURE_MAG_FILTER, Gl.LINEAR);
        Gl.texParameteri(Gl.TEXTURE_2D_ARRAY, Gl.TEXTURE_WRAP_S, Gl.CLAMP_TO_EDGE);
        Gl.texParameteri(Gl.TEXTURE_2D_ARRAY, Gl.TEXTURE_WRAP_T, Gl.CLAMP_TO_EDGE);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, Framebuffer);
        const Pipeline = this.Programs.get("studio");
        Gl.useProgram(Pipeline.program);
        Gl.bindVertexArray(this.Screen);
        Gl.viewport(0, 0, 128, 128);
        for (let Layer = 0; Layer < 14; ++Layer)
        {
            Gl.framebufferTextureLayer(Gl.FRAMEBUFFER, Gl.COLOR_ATTACHMENT0, Texture, 0, Layer);
            if (Gl.checkFramebufferStatus(Gl.FRAMEBUFFER) !== Gl.FRAMEBUFFER_COMPLETE)
            {
                Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
                Gl.deleteFramebuffer(Framebuffer);
                Gl.deleteTexture(Texture);
                Gl.activeTexture(Gl.TEXTURE0);
                return;
            }
            Gl.uniform1ui(this.Uniform(Pipeline, "StudioLayer"), Layer);
            Gl.drawArrays(Gl.TRIANGLES, 0, 3);
        }
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        Gl.deleteFramebuffer(Framebuffer);
        Gl.activeTexture(Gl.TEXTURE0);
        this.Studio = Texture;
    }

    Uniform(Pipeline, Name)
    {
        if (!Pipeline.uniforms.has(Name))
            Pipeline.uniforms.set(Name, this.Gl.getUniformLocation(Pipeline.program, Name));
        return Pipeline.uniforms.get(Name);
    }

    ReleaseTargets()
    {
        const Gl = this.Gl;
        for (const Target of this.Targets)
        {
            Gl.deleteFramebuffer(Target.framebuffer);
            Gl.deleteTexture(Target.colour);
            Gl.deleteRenderbuffer(Target.multisample);
            Gl.deleteRenderbuffer(Target.depth);
        }
        this.Targets = [];
    }

    Resize(Width, Height)
    {
        if (this.Extent[0] === Width && this.Extent[1] === Height) return;
        this.ReleaseTargets();
        const Gl = this.Gl;
        this.Canvas.width = Width;
        this.Canvas.height = Height;
        this.Extent = [Width, Height];
        for (let Index = 0; Index < 3; ++Index)
        {
            const Framebuffer = Gl.createFramebuffer();
            const Texture = Index !== 0 ? Gl.createTexture() : null;
            const Multisample = Index === 0 ? Gl.createRenderbuffer() : null;
            const Depth = Index < 2 ? Gl.createRenderbuffer() : null;
            this.Targets.push({framebuffer: Framebuffer, colour: Texture, multisample: Multisample, depth: Depth});
            Gl.bindFramebuffer(Gl.FRAMEBUFFER, Framebuffer);
            if (Index === 0)
            {
                Gl.bindRenderbuffer(Gl.RENDERBUFFER, Multisample);
                Gl.renderbufferStorageMultisample(Gl.RENDERBUFFER, this.Samples, Gl.RGBA8, Width, Height);
                Gl.framebufferRenderbuffer(Gl.FRAMEBUFFER, Gl.COLOR_ATTACHMENT0, Gl.RENDERBUFFER, Multisample);
            }
            else
            {
                Gl.bindTexture(Gl.TEXTURE_2D, Texture);
                // Device storage only: never an uploaded CPU display image.
                Gl.texImage2D(Gl.TEXTURE_2D, 0, Gl.RGBA8, Width, Height, 0, Gl.RGBA, Gl.UNSIGNED_BYTE, null);
                Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MIN_FILTER, Gl.NEAREST);
                Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MAG_FILTER, Gl.NEAREST);
                Gl.framebufferTexture2D(Gl.FRAMEBUFFER, Gl.COLOR_ATTACHMENT0, Gl.TEXTURE_2D, Texture, 0);
            }
            if (Depth)
            {
                Gl.bindRenderbuffer(Gl.RENDERBUFFER, Depth);
                Gl.renderbufferStorageMultisample(Gl.RENDERBUFFER, Index === 0 ? this.Samples : 0, Gl.DEPTH_COMPONENT24, Width, Height);
                Gl.framebufferRenderbuffer(Gl.FRAMEBUFFER, Gl.DEPTH_ATTACHMENT, Gl.RENDERBUFFER, Depth);
            }
            if (Index === 2)
                Gl.framebufferRenderbuffer(Gl.FRAMEBUFFER, Gl.DEPTH_ATTACHMENT, Gl.RENDERBUFFER, this.Targets[1].depth);
            if (Gl.checkFramebufferStatus(Gl.FRAMEBUFFER) !== Gl.FRAMEBUFFER_COMPLETE)
                throw Error("SolidArc graphics framebuffer is incomplete");
        }
    }

    Upload(Command, Index)
    {
        const Gl = this.Gl;
        if (this.Vertices[Index]?.kind !== Command.kind)
        {
            if (this.Vertices[Index]) this.ReleaseVertices(this.Vertices[Index]);
            this.Vertices[Index] = {kind: Command.kind, vao: Gl.createVertexArray(), buffers: {}};
        }
        const Mesh = this.Vertices[Index];
        if (Mesh.source === Command) return Mesh;
        Gl.bindVertexArray(Mesh.vao);
        let Slot = 0;
        const Buffer = (Target, Values, Type) =>
        {
            const Storage = Mesh.buffers[`${Target}:${Slot}`] || (Mesh.buffers[`${Target}:${Slot}`] = Gl.createBuffer());
            ++Slot;
            const ArrayValue = new Type(Values);
            Gl.bindBuffer(Target, Storage);
            Gl.bufferData(Target, ArrayValue, Gl.DYNAMIC_DRAW);
            this.UploadedBytes += ArrayValue.byteLength;
        };
        const Attribute = (Location, Components, Stride, Offset, Divisor) =>
        {
            Gl.enableVertexAttribArray(Location);
            Gl.vertexAttribPointer(Location, Components, Gl.FLOAT, false, Stride, Offset);
            Gl.vertexAttribDivisor(Location, Divisor);
        };
        Buffer(Gl.ARRAY_BUFFER, Command.positions, Float32Array);
        if (Command.kind === "surface")
        {
            Attribute(0, 3, 0, 0, 0);
            Buffer(Gl.ARRAY_BUFFER, Command.normals, Float32Array);
            Attribute(1, 3, 0, 0, 0);
            if (Command.parameters.length)
            {
                Buffer(Gl.ARRAY_BUFFER, Command.parameters, Float32Array);
                Attribute(2, 2, 0, 0, 0);
            }
            else
            {
                Gl.disableVertexAttribArray(2);
                Gl.vertexAttrib2f(2, 0, 0);
            }
            Buffer(Gl.ELEMENT_ARRAY_BUFFER, Command.indices, Uint32Array);
            Mesh.count = Command.indices.length;
        }
        else if (Command.kind === "line")
        {
            Attribute(0, 3, 24, 0, 1);
            Attribute(1, 3, 24, 12, 1);
            Mesh.count = Command.positions.length / 6;
        }
        else
        {
            Attribute(0, 4, 16, 0, 1);
            Mesh.count = Command.positions.length / 4;
        }
        Mesh.source = Command;
        return Mesh;
    }

    Render(Frame, Options = {})
    {
        if (this.Lost) throw Error("Graphics device lost. Reload to recreate the device; CPU fallback is disabled.");
        if (!Frame || typeof Frame !== "object")
            throw Error("No GPU command frame was received. Reload the GPU preview to replace an outdated geometry worker.");
        if (Frame.cpuFragments !== 0 || Frame.rgbaUploads !== 0)
            throw Error("Rejected a CPU-raster frame on the GPU command route");
        const Start = performance.now();
        const PreviousBytes = this.UploadedBytes;
        const Interactive = Frame.localNavigation === true && !Options.pickOnly;
        const Passes = Options.pickOnly ? [1] : Interactive ? [0] : [0, 1];
        const Gl = this.Gl;
        this.Resize(Frame.width, Frame.height);
        const Meshes = Frame.draws.map((Command, Index) => Command.kind === "lattice" ? null : this.Upload(Command, Index));
        while (this.Vertices.length > Frame.draws.length)
        {
            const Mesh = this.Vertices.pop();
            if (Mesh) this.ReleaseVertices(Mesh);
        }
        this.DrawCalls = 0;
        for (const Pass of Passes)
        {
            const Intersection = Pass === 1;
            const ViewPipelines = new Set();
            Gl.bindFramebuffer(Gl.FRAMEBUFFER, this.Targets[Interactive && Pass === 0 ? 2 : Pass].framebuffer);
            Gl.viewport(0, 0, Frame.width, Frame.height);
            Gl.colorMask(true, true, true, true);
            Gl.depthMask(true);
            Gl.clearDepth(1);
            Gl.clearColor(...(Intersection ? [0, 0, 0, 0] : Frame.clear));
            Gl.clear(Gl.COLOR_BUFFER_BIT | Gl.DEPTH_BUFFER_BIT);
            if (Intersection) Gl.disable(Gl.BLEND);
            else
            {
                Gl.enable(Gl.BLEND);
                Gl.blendFuncSeparate(Gl.SRC_ALPHA, Gl.ONE_MINUS_SRC_ALPHA, Gl.ONE, Gl.ONE_MINUS_SRC_ALPHA);
            }
            for (let Index = 0; Index < Frame.draws.length; ++Index)
            {
                const Command = Frame.draws[Index];
                if (Options.overlayOnly && !Command.overlay) continue;
                if (Intersection && (Command.kind === "lattice" || Command.overlay && !Command.pick && !Options.overlayOnly)) continue;
                Gl.colorMask(!Intersection || !!Command.pick || !!Options.overlayOnly, !Intersection || !!Command.pick || !!Options.overlayOnly, !Intersection || !!Command.pick || !!Options.overlayOnly, !Intersection || !!Command.pick || !!Options.overlayOnly);
                const Pipeline = this.Programs.get(Command.kind);
                if (!Pipeline) throw Error(`Unknown device primitive: ${Command.kind}`);
                Gl.useProgram(Pipeline.program);
                const Location = (Name) => this.Uniform(Pipeline, Name);
                if (!ViewPipelines.has(Pipeline))
                {
                    for (const [Name, Values] of Object.entries(Frame.view))
                    {
                        if (!Array.isArray(Values)) continue;
                        if (Values.length === 16) Gl.uniformMatrix4fv(Location(`View.${Name}`), false, Values);
                        else Gl.uniform4fv(Location(`View.${Name}`), Values);
                    }
                    Gl.uniform1i(Location("IntersectionPass"), Intersection);
                    if (Command.kind === "surface")
                    {
                        Gl.uniform1i(Location("StudioCached"), !!this.Studio);
                        Gl.uniform1i(Location("StudioImage"), 1);
                        Gl.activeTexture(Gl.TEXTURE1);
                        Gl.bindTexture(Gl.TEXTURE_2D_ARRAY, this.Studio || null);
                        Gl.activeTexture(Gl.TEXTURE0);
                    }
                    ViewPipelines.add(Pipeline);
                }
                Gl.uniform1ui(Location("PickIdentity"), Options.overlayOnly ? 1 : Command.pick || 0);
                Gl.uniform1i(Location("Dashed"), Command.dashed || false);
                if (Command.overlay) Gl.disable(Gl.DEPTH_TEST);
                else Gl.enable(Gl.DEPTH_TEST);
                Gl.depthFunc(Gl.LEQUAL);
                Gl.depthMask(!Command.overlay && Command.kind !== "lattice" && Command.tint[3] > 0.5);
                if (Command.kind === "lattice")
                {
                    Gl.bindVertexArray(this.Screen);
                    Gl.uniform2f(Location("PixelExtent"), Frame.view.PixelAngle, Frame.view.PixelWorld);
                    Gl.drawArrays(Gl.TRIANGLES, 0, 3);
                }
                else
                {
                    Gl.uniformMatrix4fv(Location("Draw.LocalWorld"), false, Command.local);
                    Gl.uniform4fv(Location("Draw.Tint"), Command.tint);
                    Gl.uniform4fv(Location("Draw.Selection"), Command.selection);
                    Gl.uniform4fv(Location("Draw.Surface"), Command.surface);
                    const Mesh = Meshes[Index];
                    Gl.bindVertexArray(Mesh.vao);
                    if (Command.kind === "surface") Gl.drawElements(Gl.TRIANGLES, Mesh.count, Gl.UNSIGNED_INT, 0);
                    else Gl.drawArraysInstanced(Gl.TRIANGLES, 0, 6, Mesh.count);
                }
                ++this.DrawCalls;
            }
        }
        Gl.colorMask(true, true, true, true);
        if (!Options.pickOnly)
        {
            if (!Interactive)
            {
                Gl.bindFramebuffer(Gl.READ_FRAMEBUFFER, this.Targets[0].framebuffer);
                Gl.bindFramebuffer(Gl.DRAW_FRAMEBUFFER, this.Targets[2].framebuffer);
                Gl.blitFramebuffer(0, 0, Frame.width, Frame.height, 0, 0, Frame.width, Frame.height, Gl.COLOR_BUFFER_BIT, Gl.NEAREST);
            }
            Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
            Gl.disable(Gl.DEPTH_TEST);
            Gl.depthMask(false);
            Gl.disable(Gl.BLEND);
            const Display = this.Programs.get("display");
            Gl.useProgram(Display.program);
            Gl.activeTexture(Gl.TEXTURE0);
            Gl.bindTexture(Gl.TEXTURE_2D, this.Targets[2].colour);
            Gl.uniform1i(this.Uniform(Display, "LinearImage"), 0);
            Gl.bindVertexArray(this.Screen);
            Gl.drawArrays(Gl.TRIANGLES, 0, 3);
            ++this.DrawCalls;
        }
        else Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        this.IntersectionsDirty = !!Options.overlayOnly || !Passes.includes(1);
        const ErrorCode = Interactive ? Gl.NO_ERROR : Gl.getError();
        if (ErrorCode !== Gl.NO_ERROR) throw Error(`WebGL device error 0x${ErrorCode.toString(16)}`);
        if (Options.pickOnly) return this.Metrics;
        this.LastFrame = Frame;
        ++this.FrameNumber;
        this.Canvas.dataset.renderer = "webgl2";
        this.Canvas.dataset.adapter = this.Adapter;
        this.Canvas.dataset.device = this.Software ? "software-driver" : "hardware-or-undisclosed";
        this.Metrics = {backend: "WebGL2", adapter: this.Adapter, softwareDriver: this.Software,
            frame: this.FrameNumber, samples: Interactive ? 1 : this.Samples, studioCached: !!this.Studio, drawCalls: this.DrawCalls, cpuFragments: 0, rgbaUploads: 0,
            vertexBytes: this.UploadedBytes, frameVertexBytes: this.UploadedBytes - PreviousBytes,
            triangles: Frame.draws.reduce((Sum, Command) => Sum + (Command.kind === "surface" ? Command.indices.length / 3 : 0), 0),
            submitMilliseconds: performance.now() - Start,
            primitives: [...new Set(Frame.draws.map((Command) => Command.kind))]};
        return this.Metrics;
    }

    ResolveOverlayNear(U, V)
    {
        if (!this.LastFrame || !this.LastFrame.draws.some((Command) => Command.overlay)) return false;
        if (!Number.isFinite(U) || !Number.isFinite(V) || U < 0 || V < 0 || U >= 1 || V >= 1) return false;
        // Broad-phase only: test a small GPU-rendered neighbourhood of the actual native
        // overlay geometry. The original C++ analytic gizmo still decides the precise grip.
        this.Render(this.LastFrame, {pickOnly: true, overlayOnly: true});
        const Gl = this.Gl, [Width, Height] = this.Extent;
        const Radius = Math.ceil(12 * Width / this.Canvas.getBoundingClientRect().width);
        const X = Math.max(0, Math.floor(U * Width) - Radius), Y = Math.max(0, Math.floor((1 - V) * Height) - Radius);
        const W = Math.min(Width - X, Radius * 2 + 1), H = Math.min(Height - Y, Radius * 2 + 1);
        const Pixels = new Uint8Array(W * H * 4);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, this.Targets[1].framebuffer);
        Gl.readPixels(X, Y, W, H, Gl.RGBA, Gl.UNSIGNED_BYTE, Pixels);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        return Pixels.some((Value, Index) => Index % 4 === 0 && Value !== 0);
    }

    ResolveIntersection(U, V)
    {
        if (!this.Targets.length || this.Lost || !Number.isFinite(U) || !Number.isFinite(V)) return 0;
        if (U < 0 || V < 0 || U >= 1 || V >= 1) return 0;
        if (this.IntersectionsDirty) this.Render(this.LastFrame, {pickOnly: true});
        const Gl = this.Gl;
        const Pixel = new Uint8Array(4);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, this.Targets[1].framebuffer);
        Gl.readPixels(Math.floor(U * this.Extent[0]), this.Extent[1] - 1 - Math.floor(V * this.Extent[1]), 1, 1, Gl.RGBA, Gl.UNSIGNED_BYTE, Pixel);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        return (Pixel[0] | (Pixel[1] << 8) | (Pixel[2] << 16) | (Pixel[3] << 24)) >>> 0;
    }

    ResolveIntersectionRuns()
    {
        if (this.IntersectionsDirty) this.Render(this.LastFrame, {pickOnly: true});
        const [Width, Height] = this.Extent;
        const Gl = this.Gl;
        // Only box selection reads a GPU identity region; these are IDs, never display pixels.
        const Pixels = new Uint8Array(Width * Height * 4);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, this.Targets[1].framebuffer);
        Gl.readPixels(0, 0, Width, Height, Gl.RGBA, Gl.UNSIGNED_BYTE, Pixels);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        const Runs = [String(Width)];
        let Previous = 0, Start = 0;
        for (let Offset = 0; Offset <= Width * Height; ++Offset)
        {
            const Index = ((Height - 1 - Math.floor(Offset / Width)) * Width + Offset % Width) * 4;
            const Identity = Offset === Width * Height ? 0 : (Pixels[Index] | Pixels[Index + 1] << 8 | Pixels[Index + 2] << 16 | Pixels[Index + 3] << 24) >>> 0;
            if (Identity !== Previous)
            {
                if (Previous) Runs.push(`${Start} ${Offset - Start} ${Previous}`);
                Previous = Identity;
                Start = Offset;
            }
        }
        return Runs.join("\n");
    }

    ReleaseVertices(Mesh)
    {
        this.Gl.deleteVertexArray(Mesh.vao);
        for (const Buffer of Object.values(Mesh.buffers)) this.Gl.deleteBuffer(Buffer);
    }

    Release()
    {
        this.ReleaseTargets();
        for (const Mesh of this.Vertices) if (Mesh) this.ReleaseVertices(Mesh);
        this.Vertices = [];
        for (const Pipeline of this.Programs.values()) this.Gl.deleteProgram(Pipeline.program);
        this.Programs.clear();
        this.Gl.deleteVertexArray(this.Screen);
        if (this.Studio) this.Gl.deleteTexture(this.Studio);
        if (this.LossContact) this.Canvas.removeEventListener("webglcontextlost", this.LossContact);
    }
}
