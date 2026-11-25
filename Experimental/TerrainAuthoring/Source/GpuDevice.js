/*====================================================================================================================================
                                                        GPUDEVICE.JS
====================================================================================================================================*/
// 🧩 WebGL2 device: program compilation, float render targets, fullscreen rasterization, async readback and GPU timing

//------------------------------------------------------------------------------------------------------------------------
//                                                    DEVICE
//------------------------------------------------------------------------------------------------------------------------

export class GpuDevice
{
    constructor(Canvas)
    {
        const GL = Canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
        if (!GL) throw new Error("WebGL2 is unavailable in this browser.");
        this.GL = GL;
        this.Canvas = Canvas;
        this.FloatTargets = !!GL.getExtension("EXT_color_buffer_float");
        this.FloatLinear  = !!GL.getExtension("OES_texture_float_linear");
        this.FloatBlend   = !!GL.getExtension("EXT_float_blend");
        this.TimerQuery   = GL.getExtension("EXT_disjoint_timer_query_webgl2");
        if (!this.FloatTargets) throw new Error("EXT_color_buffer_float is required for Float32 terrain targets.");
        const Debug = GL.getExtension("WEBGL_debug_renderer_info");
        this.RendererLabel = Debug ? GL.getParameter(Debug.UNMASKED_RENDERER_WEBGL) : GL.getParameter(GL.RENDERER);
        this.TriangleArray = GL.createVertexArray();          // 📝 Attribute-less fullscreen triangle (gl_VertexID)
        this.PendingReadbacks = [];
        this.TimerQueue = [];
        this.LastGpuMilliseconds = -1;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                PROGRAMS
    //--------------------------------------------------------------------------------------------------------------------

    CompileProgram(Label, VertexSource, FragmentSource, Defines = {})
    {
        const GL = this.GL;
        const Prefix = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler3D;\n" +
            (this.FloatLinear ? "#define FLOAT_LINEAR 1\n" : "") +
            Object.entries(Defines).map(([Key, Literal]) => `#define ${Key} ${Literal}\n`).join("");
        const CompileUnit = (Category, Source) =>
        {
            const Unit = GL.createShader(Category);
            GL.shaderSource(Unit, Prefix + Source);
            GL.compileShader(Unit);
            if (!GL.getShaderParameter(Unit, GL.COMPILE_STATUS))
            {
                const Log = GL.getShaderInfoLog(Unit);
                const Numbered = (Prefix + Source).split("\n").map((Line, Index) => `${Index + 1}: ${Line}`).join("\n");
                console.error(Numbered);
                throw new Error(`${Label}: shader compilation failed\n${Log}`);
            }
            return Unit;
        };
        const Program = GL.createProgram();
        GL.attachShader(Program, CompileUnit(GL.VERTEX_SHADER, VertexSource));
        GL.attachShader(Program, CompileUnit(GL.FRAGMENT_SHADER, FragmentSource));
        GL.linkProgram(Program);
        if (!GL.getProgramParameter(Program, GL.LINK_STATUS)) throw new Error(`${Label}: link failed\n${GL.getProgramInfoLog(Program)}`);
        const Uniforms = new Map();
        const Count = GL.getProgramParameter(Program, GL.ACTIVE_UNIFORMS);
        let SamplerUnit = 0;
        for (let Index = 0; Index < Count; ++Index)
        {
            const Active = GL.getActiveUniform(Program, Index);
            const Name = Active.name.replace(/\[0\]$/, "");
            const IsSampler = [GL.SAMPLER_2D, GL.SAMPLER_3D, GL.INT_SAMPLER_2D, GL.UNSIGNED_INT_SAMPLER_2D].includes(Active.type);
            Uniforms.set(Name, { Location: GL.getUniformLocation(Program, Active.name), Category: Active.type, Size: Active.size, Unit: IsSampler ? SamplerUnit++ : -1 });
        }
        return { Label, Program, Uniforms };
    }

    // 📝 Binds a program and uploads uniforms by reflected type; textures are bound to the units reserved at link time.
    UseProgram(Shader, Parameters)
    {
        const GL = this.GL;
        GL.useProgram(Shader.Program);
        for (const [Name, Entry] of Shader.Uniforms)
        {
            if (!(Name in Parameters)) continue;
            const Input = Parameters[Name];
            switch (Entry.Category)
            {
                case GL.FLOAT:       Entry.Size > 1 ? GL.uniform1fv(Entry.Location, Input) : GL.uniform1f(Entry.Location, Input); break;
                case GL.FLOAT_VEC2:  GL.uniform2fv(Entry.Location, Input); break;
                case GL.FLOAT_VEC3:  GL.uniform3fv(Entry.Location, Input); break;
                case GL.FLOAT_VEC4:  GL.uniform4fv(Entry.Location, Input); break;
                case GL.INT:
                case GL.BOOL:        GL.uniform1i(Entry.Location, Input | 0); break;
                case GL.INT_VEC2:    GL.uniform2iv(Entry.Location, Input); break;
                case GL.FLOAT_MAT4:  GL.uniformMatrix4fv(Entry.Location, false, Input); break;
                case GL.SAMPLER_2D:
                case GL.INT_SAMPLER_2D:
                case GL.UNSIGNED_INT_SAMPLER_2D:
                    GL.activeTexture(GL.TEXTURE0 + Entry.Unit);
                    GL.bindTexture(GL.TEXTURE_2D, Input ? Input.Texture : null);
                    GL.uniform1i(Entry.Location, Entry.Unit);
                    break;
                case GL.SAMPLER_3D:
                    GL.activeTexture(GL.TEXTURE0 + Entry.Unit);
                    GL.bindTexture(GL.TEXTURE_3D, Input ? Input.Texture : null);
                    GL.uniform1i(Entry.Location, Entry.Unit);
                    break;
                default: break;
            }
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                TEXTURES AND TARGETS
    //--------------------------------------------------------------------------------------------------------------------

    static FormatTable(GL)
    {
        return {
            R32F:    { Internal: GL.R32F,    Format: GL.RED,  Type: GL.FLOAT,         Bytes: 4,  Filterable: false },
            RG32F:   { Internal: GL.RG32F,   Format: GL.RG,   Type: GL.FLOAT,         Bytes: 8,  Filterable: false },
            RGBA32F: { Internal: GL.RGBA32F, Format: GL.RGBA, Type: GL.FLOAT,         Bytes: 16, Filterable: false },
            R16F:    { Internal: GL.R16F,    Format: GL.RED,  Type: GL.HALF_FLOAT,    Bytes: 2,  Filterable: true  },
            RGBA16F: { Internal: GL.RGBA16F, Format: GL.RGBA, Type: GL.HALF_FLOAT,    Bytes: 8,  Filterable: true  },
            R8:      { Internal: GL.R8,      Format: GL.RED,  Type: GL.UNSIGNED_BYTE, Bytes: 1,  Filterable: true  },
            RGBA8:   { Internal: GL.RGBA8,   Format: GL.RGBA, Type: GL.UNSIGNED_BYTE, Bytes: 4,  Filterable: true  },
        };
    }

    CreateTexture2D(Width, Height, FormatName, { Linear = false, Mipmaps = false, Pixels = null } = {})
    {
        const GL = this.GL;
        const Format = GpuDevice.FormatTable(GL)[FormatName];
        const CanFilter = Format.Filterable || this.FloatLinear;
        const Texture = GL.createTexture();
        GL.bindTexture(GL.TEXTURE_2D, Texture);
        GL.texImage2D(GL.TEXTURE_2D, 0, Format.Internal, Width, Height, 0, Format.Format, Format.Type, Pixels);
        const Filter = Linear && CanFilter ? GL.LINEAR : GL.NEAREST;
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, Mipmaps && CanFilter ? GL.LINEAR_MIPMAP_LINEAR : Filter);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, Filter);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
        const Surface = { Texture, Width, Height, FormatName, Format, Mipmaps: Mipmaps && CanFilter, Target: null, Bytes: Width * Height * Format.Bytes };
        Surface.Target = this.CreateTarget(Surface);
        return Surface;
    }

    CreateTexture3D(Width, Height, Depth, FormatName)
    {
        const GL = this.GL;
        const Format = GpuDevice.FormatTable(GL)[FormatName];
        const Texture = GL.createTexture();
        GL.bindTexture(GL.TEXTURE_3D, Texture);
        GL.texImage3D(GL.TEXTURE_3D, 0, Format.Internal, Width, Height, Depth, 0, Format.Format, Format.Type, null);
        GL.texParameteri(GL.TEXTURE_3D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
        GL.texParameteri(GL.TEXTURE_3D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
        for (const Wrap of [GL.TEXTURE_WRAP_S, GL.TEXTURE_WRAP_T, GL.TEXTURE_WRAP_R]) GL.texParameteri(GL.TEXTURE_3D, Wrap, GL.CLAMP_TO_EDGE);
        const LayerTargets = [];
        for (let Layer = 0; Layer < Depth; ++Layer)
        {
            const Target = GL.createFramebuffer();
            GL.bindFramebuffer(GL.FRAMEBUFFER, Target);
            GL.framebufferTextureLayer(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, Texture, 0, Layer);
            LayerTargets.push(Target);
        }
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        return { Texture, Width, Height, Depth, FormatName, LayerTargets, Bytes: Width * Height * Depth * Format.Bytes };
    }

    CreateTarget(...Surfaces)
    {
        const GL = this.GL;
        const Target = GL.createFramebuffer();
        GL.bindFramebuffer(GL.FRAMEBUFFER, Target);
        Surfaces.forEach((Surface, Index) => GL.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0 + Index, GL.TEXTURE_2D, Surface.Texture, 0));
        if (Surfaces.length > 1) GL.drawBuffers(Surfaces.map((_, Index) => GL.COLOR_ATTACHMENT0 + Index));
        const Status = GL.checkFramebufferStatus(GL.FRAMEBUFFER);
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        if (Status !== GL.FRAMEBUFFER_COMPLETE) throw new Error(`Render target incomplete (0x${Status.toString(16)}) for ${Surfaces.map(Surface => Surface.FormatName).join("+")}`);
        return Target;
    }

    AttachStencil(Surface)
    {
        const GL = this.GL;
        const Buffer = GL.createRenderbuffer();
        GL.bindRenderbuffer(GL.RENDERBUFFER, Buffer);
        GL.renderbufferStorage(GL.RENDERBUFFER, GL.DEPTH24_STENCIL8, Surface.Width, Surface.Height);
        GL.bindFramebuffer(GL.FRAMEBUFFER, Surface.Target);
        GL.framebufferRenderbuffer(GL.FRAMEBUFFER, GL.DEPTH_STENCIL_ATTACHMENT, GL.RENDERBUFFER, Buffer);
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        Surface.Stencil = Buffer;
    }

    ReleaseTexture(Surface)
    {
        if (!Surface) return;
        const GL = this.GL;
        if (Surface.Target) GL.deleteFramebuffer(Surface.Target);
        if (Surface.LayerTargets) Surface.LayerTargets.forEach(Target => GL.deleteFramebuffer(Target));
        if (Surface.Stencil) GL.deleteRenderbuffer(Surface.Stencil);
        GL.deleteTexture(Surface.Texture);
    }

    UploadRegion(Surface, X, Y, Width, Height, Pixels)
    {
        const GL = this.GL;
        GL.bindTexture(GL.TEXTURE_2D, Surface.Texture);
        GL.texSubImage2D(GL.TEXTURE_2D, 0, X, Y, Width, Height, Surface.Format.Format, Surface.Format.Type, Pixels);
    }

    RefreshMipmaps(Surface)
    {
        if (!Surface.Mipmaps) return;
        const GL = this.GL;
        GL.bindTexture(GL.TEXTURE_2D, Surface.Texture);
        GL.generateMipmap(GL.TEXTURE_2D);
    }

    // 📝 Region copy between equally formatted surfaces through framebuffer blits (no shader, no CPU round trip).
    CopyRegion(Source, Destination, X = 0, Y = 0, Width = Source.Width, Height = Source.Height, DestinationX = X, DestinationY = Y)
    {
        const GL = this.GL;
        GL.bindFramebuffer(GL.READ_FRAMEBUFFER, Source.Target);
        GL.bindFramebuffer(GL.DRAW_FRAMEBUFFER, Destination.Target);
        GL.blitFramebuffer(X, Y, X + Width, Y + Height, DestinationX, DestinationY, DestinationX + Width, DestinationY + Height, GL.COLOR_BUFFER_BIT, GL.NEAREST);
        GL.bindFramebuffer(GL.READ_FRAMEBUFFER, null);
        GL.bindFramebuffer(GL.DRAW_FRAMEBUFFER, null);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                RASTERIZATION
    //--------------------------------------------------------------------------------------------------------------------

    BindTarget(Surface, Viewport = null)
    {
        const GL = this.GL;
        GL.bindFramebuffer(GL.FRAMEBUFFER, Surface ? Surface.Target : null);
        if (Viewport) GL.viewport(Viewport[0], Viewport[1], Viewport[2], Viewport[3]);
        else if (Surface) GL.viewport(0, 0, Surface.Width, Surface.Height);
    }

    // 📝 Restricts subsequent rasterization to a texel rectangle [x, y, w, h]; null disables the scissor.
    Scissor(Rect)
    {
        const GL = this.GL;
        if (!Rect) { GL.disable(GL.SCISSOR_TEST); return; }
        GL.enable(GL.SCISSOR_TEST);
        GL.scissor(Rect[0], Rect[1], Rect[2], Rect[3]);
    }

    RasterizeTriangle(Shader, Target, Parameters, Viewport = null)
    {
        const GL = this.GL;
        if (Target !== undefined) this.BindTarget(Target, Viewport);
        this.UseProgram(Shader, Parameters);
        GL.bindVertexArray(this.TriangleArray);
        GL.drawArrays(GL.TRIANGLES, 0, 3);
        GL.bindVertexArray(null);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                READBACK
    //--------------------------------------------------------------------------------------------------------------------

    ReadSynchronous(Surface, X, Y, Width, Height)
    {
        const GL = this.GL;
        const Output = new Float32Array(Width * Height * 4);
        GL.bindFramebuffer(GL.FRAMEBUFFER, Surface.Target);
        GL.readPixels(X, Y, Width, Height, GL.RGBA, GL.FLOAT, Output);
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        return Output;
    }

    // 📝 Non-blocking float readback through a pixel-pack buffer and fence; Resolve fires on a later tick.
    ReadAsynchronous(Surface, X, Y, Width, Height, Resolve)
    {
        const GL = this.GL;
        const Buffer = GL.createBuffer();
        const ByteLength = Width * Height * 16;
        GL.bindBuffer(GL.PIXEL_PACK_BUFFER, Buffer);
        GL.bufferData(GL.PIXEL_PACK_BUFFER, ByteLength, GL.STREAM_READ);
        GL.bindFramebuffer(GL.FRAMEBUFFER, Surface.Target);
        GL.readPixels(X, Y, Width, Height, GL.RGBA, GL.FLOAT, 0);
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        GL.bindBuffer(GL.PIXEL_PACK_BUFFER, null);
        const Fence = GL.fenceSync(GL.SYNC_GPU_COMMANDS_COMPLETE, 0);
        GL.flush();
        this.PendingReadbacks.push({ Buffer, Fence, ByteLength, Resolve, Age: 0 });
    }

    PollReadbacks()
    {
        const GL = this.GL;
        this.PendingReadbacks = this.PendingReadbacks.filter(Pending =>
        {
            const Status = GL.clientWaitSync(Pending.Fence, 0, 0);
            Pending.Age++;
            if (Status === GL.TIMEOUT_EXPIRED && Pending.Age < 8) return true;
            const Output = new Float32Array(Pending.ByteLength / 4);
            GL.bindBuffer(GL.PIXEL_PACK_BUFFER, Pending.Buffer);
            GL.getBufferSubData(GL.PIXEL_PACK_BUFFER, 0, Output);
            GL.bindBuffer(GL.PIXEL_PACK_BUFFER, null);
            GL.deleteSync(Pending.Fence);
            GL.deleteBuffer(Pending.Buffer);
            Pending.Resolve(Output);
            return false;
        });
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                GPU TIMING
    //--------------------------------------------------------------------------------------------------------------------

    OpenTiming()
    {
        if (!this.TimerQuery || this.ActiveQuery) return;
        const GL = this.GL;
        this.ActiveQuery = GL.createQuery();
        GL.beginQuery(this.TimerQuery.TIME_ELAPSED_EXT, this.ActiveQuery);
    }

    CloseTiming(Label)
    {
        if (!this.ActiveQuery) return;
        const GL = this.GL;
        GL.endQuery(this.TimerQuery.TIME_ELAPSED_EXT);
        this.TimerQueue.push({ Query: this.ActiveQuery, Label });
        this.ActiveQuery = null;
    }

    PollTiming(Resolve)
    {
        if (!this.TimerQuery) return;
        const GL = this.GL;
        const Disjoint = GL.getParameter(this.TimerQuery.GPU_DISJOINT_EXT);
        while (this.TimerQueue.length)
        {
            const Head = this.TimerQueue[0];
            if (!GL.getQueryParameter(Head.Query, GL.QUERY_RESULT_AVAILABLE)) break;
            const Nanoseconds = GL.getQueryParameter(Head.Query, GL.QUERY_RESULT);
            GL.deleteQuery(Head.Query);
            this.TimerQueue.shift();
            if (!Disjoint) Resolve(Head.Label, Nanoseconds / 1e6);
        }
    }
}
