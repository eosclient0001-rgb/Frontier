/*====================================================================================================================================
                                                         GPUCONTEXT.JS
====================================================================================================================================*/
// 🧩 WebGL2 substrate: capability validation, program compilation, float render targets and volume slice targets

//------------------------------------------------------------------------------------------------------------------------
//                                                CAPABILITY CHECKS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Float render targets (EXT_color_buffer_float) are mandatory: heights are R32F and volumes RGBA16F.
export function InitializeGpuContext(Canvas)
{
    const Context = Canvas.getContext("webgl2", { antialias: false, depth: true, stencil: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    if (!Context) throw new Error("WebGL2 is unavailable in this browser.");
    if (!Context.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is required for float render targets.");
    const LinearFloat = !!Context.getExtension("OES_texture_float_linear");
    const TimerQuery = Context.getExtension("EXT_disjoint_timer_query_webgl2");
    Context.pixelStorei(Context.UNPACK_ALIGNMENT, 1);
    const Renderer = Context.getExtension("WEBGL_debug_renderer_info");
    const AdapterName = Renderer ? Context.getParameter(Renderer.UNMASKED_RENDERER_WEBGL) : Context.getParameter(Context.RENDERER);
    return { Context, LinearFloat, TimerQuery, AdapterName, Maximum3DSize: Context.getParameter(Context.MAX_3D_TEXTURE_SIZE) };
}

//------------------------------------------------------------------------------------------------------------------------
//                                               PROGRAM COMPILATION
//------------------------------------------------------------------------------------------------------------------------

function CompileShaderSource(Context, Category, Source, Label)
{
    const Shader = Context.createShader(Category);
    Context.shaderSource(Shader, Source);
    Context.compileShader(Shader);
    if (!Context.getShaderParameter(Shader, Context.COMPILE_STATUS))
    {
        const Log = Context.getShaderInfoLog(Shader);
        const Numbered = Source.split("\n").map((Line, Index) => `${String(Index + 1).padStart(4)}| ${Line}`).join("\n");
        console.error(`[${Label}] shader compile failure\n${Log}\n${Numbered}`);
        throw new Error(`${Label}: ${Log}`);
    }
    return Shader;
}

// Compile and link a program; uniforms are resolved lazily and cached by name.
export function CompileProgram(Context, VertexSource, FragmentSource, Label, AttributeLocations = {})
{
    const Program = Context.createProgram();
    Context.attachShader(Program, CompileShaderSource(Context, Context.VERTEX_SHADER, VertexSource, Label));
    Context.attachShader(Program, CompileShaderSource(Context, Context.FRAGMENT_SHADER, FragmentSource, Label));
    for (const [Name, Location] of Object.entries(AttributeLocations)) Context.bindAttribLocation(Program, Location, Name);
    Context.linkProgram(Program);
    if (!Context.getProgramParameter(Program, Context.LINK_STATUS)) throw new Error(`${Label}: ${Context.getProgramInfoLog(Program)}`);
    const UniformLocations = new Map();
    const Locate = (Name) =>
    {
        if (!UniformLocations.has(Name)) UniformLocations.set(Name, Context.getUniformLocation(Program, Name));
        return UniformLocations.get(Name);
    };
    // 📝 Each sampler name owns a fixed texture unit for the program's lifetime, so loops never exhaust units.
    const TextureUnits = new Map();
    return {
        Program,
        Label,
        Activate()
        {
            Context.useProgram(Program);
            return this;
        },
        Float(Name, X) { Context.uniform1f(Locate(Name), X); return this; },
        Integer(Name, X) { Context.uniform1i(Locate(Name), X); return this; },
        Vector2(Name, X, Y) { Context.uniform2f(Locate(Name), X, Y); return this; },
        Vector3(Name, X, Y, Z) { Context.uniform3f(Locate(Name), X, Y, Z); return this; },
        Vector4(Name, X, Y, Z, W) { Context.uniform4f(Locate(Name), X, Y, Z, W); return this; },
        Matrix4(Name, Elements) { Context.uniformMatrix4fv(Locate(Name), false, Elements); return this; },
        Texture(Name, Texture, Target = Context.TEXTURE_2D)
        {
            if (!TextureUnits.has(Name)) TextureUnits.set(Name, TextureUnits.size);
            const Unit = TextureUnits.get(Name);
            Context.activeTexture(Context.TEXTURE0 + Unit);
            Context.bindTexture(Target, Texture);
            Context.uniform1i(Locate(Name), Unit);
            return this;
        },
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 RENDER TARGETS
//------------------------------------------------------------------------------------------------------------------------

const FormatTable = {
    R8:      { Internal: "R8",      Format: "RED",  Category: "UNSIGNED_BYTE" },
    RGBA8:   { Internal: "RGBA8",   Format: "RGBA", Category: "UNSIGNED_BYTE" },
    R32F:    { Internal: "R32F",    Format: "RED",  Category: "FLOAT" },
    RG32F:   { Internal: "RG32F",   Format: "RG",   Category: "FLOAT" },
    RGBA32F: { Internal: "RGBA32F", Format: "RGBA", Category: "FLOAT" },
    RG16F:   { Internal: "RG16F",   Format: "RG",   Category: "HALF_FLOAT" },
    RGBA16F: { Internal: "RGBA16F", Format: "RGBA", Category: "HALF_FLOAT" },
};

// 2D colour target with its own framebuffer. Filter "LINEAR" is downgraded for non-filterable formats by the caller.
export function ConstructSurfaceTarget(Context, Width, Height, FormatName, Options = {})
{
    const Format = FormatTable[FormatName];
    const Texture = Context.createTexture();
    Context.bindTexture(Context.TEXTURE_2D, Texture);
    Context.texStorage2D(Context.TEXTURE_2D, 1, Context[Format.Internal], Width, Height);
    const Filter = Options.Linear ? Context.LINEAR : Context.NEAREST;
    Context.texParameteri(Context.TEXTURE_2D, Context.TEXTURE_MIN_FILTER, Filter);
    Context.texParameteri(Context.TEXTURE_2D, Context.TEXTURE_MAG_FILTER, Filter);
    Context.texParameteri(Context.TEXTURE_2D, Context.TEXTURE_WRAP_S, Context.CLAMP_TO_EDGE);
    Context.texParameteri(Context.TEXTURE_2D, Context.TEXTURE_WRAP_T, Context.CLAMP_TO_EDGE);
    const Framebuffer = Context.createFramebuffer();
    Context.bindFramebuffer(Context.FRAMEBUFFER, Framebuffer);
    Context.framebufferTexture2D(Context.FRAMEBUFFER, Context.COLOR_ATTACHMENT0, Context.TEXTURE_2D, Texture, 0);
    let Renderbuffer = null;
    if (Options.DepthStencil || Options.Depth)
    {
        Renderbuffer = Context.createRenderbuffer();
        Context.bindRenderbuffer(Context.RENDERBUFFER, Renderbuffer);
        Context.renderbufferStorage(Context.RENDERBUFFER, Options.DepthStencil ? Context.DEPTH24_STENCIL8 : Context.DEPTH_COMPONENT24, Width, Height);
        Context.framebufferRenderbuffer(Context.FRAMEBUFFER, Options.DepthStencil ? Context.DEPTH_STENCIL_ATTACHMENT : Context.DEPTH_ATTACHMENT, Context.RENDERBUFFER, Renderbuffer);
    }
    const Completeness = Context.checkFramebufferStatus(Context.FRAMEBUFFER);
    Context.bindFramebuffer(Context.FRAMEBUFFER, null);
    if (Completeness !== Context.FRAMEBUFFER_COMPLETE) throw new Error(`Render target ${FormatName} ${Width}x${Height} incomplete (0x${Completeness.toString(16)}).`);
    return {
        Texture, Framebuffer, Renderbuffer, Width, Height, FormatName,
        Release()
        {
            Context.deleteTexture(Texture);
            Context.deleteFramebuffer(Framebuffer);
            if (Renderbuffer) Context.deleteRenderbuffer(Renderbuffer);
        },
    };
}

// 3D colour target: one framebuffer per depth slice so passes can address any slice range.
export function ConstructVolumeTarget(Context, Width, Height, Depth, FormatName)
{
    const Format = FormatTable[FormatName];
    const Texture = Context.createTexture();
    Context.bindTexture(Context.TEXTURE_3D, Texture);
    Context.texStorage3D(Context.TEXTURE_3D, 1, Context[Format.Internal], Width, Height, Depth);
    Context.texParameteri(Context.TEXTURE_3D, Context.TEXTURE_MIN_FILTER, Context.LINEAR);
    Context.texParameteri(Context.TEXTURE_3D, Context.TEXTURE_MAG_FILTER, Context.LINEAR);
    for (const Wrap of [Context.TEXTURE_WRAP_S, Context.TEXTURE_WRAP_T, Context.TEXTURE_WRAP_R]) Context.texParameteri(Context.TEXTURE_3D, Wrap, Context.CLAMP_TO_EDGE);
    const SliceFramebuffers = [];
    for (let SliceIndex = 0; SliceIndex < Depth; SliceIndex++)
    {
        const Framebuffer = Context.createFramebuffer();
        Context.bindFramebuffer(Context.FRAMEBUFFER, Framebuffer);
        Context.framebufferTextureLayer(Context.FRAMEBUFFER, Context.COLOR_ATTACHMENT0, Texture, 0, SliceIndex);
        SliceFramebuffers.push(Framebuffer);
    }
    const Completeness = Context.checkFramebufferStatus(Context.FRAMEBUFFER);
    Context.bindFramebuffer(Context.FRAMEBUFFER, null);
    if (Completeness !== Context.FRAMEBUFFER_COMPLETE) throw new Error(`Volume target ${FormatName} incomplete (0x${Completeness.toString(16)}).`);
    return {
        Texture, SliceFramebuffers, Width, Height, Depth, FormatName,
        Release()
        {
            Context.deleteTexture(Texture);
            for (const Framebuffer of SliceFramebuffers) Context.deleteFramebuffer(Framebuffer);
        },
    };
}

// Upload a Float32Array into an RGBA32F texture of Width x 1 (used for centerline samples).
export function ConstructLineTexture(Context, Width)
{
    const Texture = Context.createTexture();
    Context.bindTexture(Context.TEXTURE_2D, Texture);
    Context.texStorage2D(Context.TEXTURE_2D, 1, Context.RGBA32F, Width, 1);
    Context.texParameteri(Context.TEXTURE_2D, Context.TEXTURE_MIN_FILTER, Context.NEAREST);
    Context.texParameteri(Context.TEXTURE_2D, Context.TEXTURE_MAG_FILTER, Context.NEAREST);
    return Texture;
}

// Big-triangle vertex array shared by every full-target pass.
export function ConstructCoverageTriangle(Context)
{
    const VertexArray = Context.createVertexArray();
    Context.bindVertexArray(VertexArray);
    const Buffer = Context.createBuffer();
    Context.bindBuffer(Context.ARRAY_BUFFER, Buffer);
    Context.bufferData(Context.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), Context.STATIC_DRAW);
    Context.enableVertexAttribArray(0);
    Context.vertexAttribPointer(0, 2, Context.FLOAT, false, 0, 0);
    Context.bindVertexArray(null);
    return VertexArray;
}

// Streaming vertex array with interleaved float attributes; Layout = [[location, components], ...].
export function ConstructStreamingGeometry(Context, Layout)
{
    const VertexArray = Context.createVertexArray();
    const Buffer = Context.createBuffer();
    const Stride = Layout.reduce((Total, [, Components]) => Total + Components, 0) * 4;
    Context.bindVertexArray(VertexArray);
    Context.bindBuffer(Context.ARRAY_BUFFER, Buffer);
    let ByteOffset = 0;
    for (const [Location, Components] of Layout)
    {
        Context.enableVertexAttribArray(Location);
        Context.vertexAttribPointer(Location, Components, Context.FLOAT, false, Stride, ByteOffset);
        ByteOffset += Components * 4;
    }
    Context.bindVertexArray(null);
    return {
        VertexArray,
        FloatsPerVertex: Stride / 4,
        VertexCount: 0,
        Upload(Floats)
        {
            Context.bindBuffer(Context.ARRAY_BUFFER, Buffer);
            Context.bufferData(Context.ARRAY_BUFFER, Floats, Context.DYNAMIC_DRAW);
            this.VertexCount = Floats.length / (Stride / 4);
        },
    };
}
