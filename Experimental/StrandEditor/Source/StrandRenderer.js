//============================================================================================================================================
//                                                             STRANDRENDERER.JS
//============================================================================================================================================
// 📦 WebGL2 pipeline: background, additive fibres, sparks and dust into an HDR target, glow chain, filmic composite and text.

import { HexToLinear, Mat3FromEulerDegrees } from './LinearAlgebra.js';
import { CameraMatrices } from './OrbitCamera.js';
import { RasterizeText } from './TextOverlay.js';
import * as Shaders from './Shaders.js';

const ShapeIndexes = { Bezier: 0, Bloom: 1, Wave: 2 };

// 📝 Names that the GLSL declares as int. Everything else numeric is a float uniform.
const IntegerNames = new Set([
    'Shape', 'StrandCount', 'SegmentCount', 'Seed', 'Harmonic', 'WindowCycles', 'ParticleHarmonic',
    'Mode', 'SceneTex', 'GlowA', 'GlowB', 'GlowC', 'GlowD', 'Source', 'TextTex',
]);

const GlowLevelCount = 4;
const BrightThreshold = 0.55;
const TextCacheLimit = 12;

function WrapFraction(Value) {
    return Value - Math.floor(Value);
}

function CheckFramebuffer(Gl) {
    const Status = Gl.checkFramebufferStatus(Gl.FRAMEBUFFER);
    if (Status !== Gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Framebuffer incomplete: 0x' + Status.toString(16));
    }
}

function CreateColourTarget(Gl, Width, Height, Internal, Type) {
    const Texture = Gl.createTexture();
    Gl.bindTexture(Gl.TEXTURE_2D, Texture);
    Gl.texImage2D(Gl.TEXTURE_2D, 0, Internal, Width, Height, 0, Gl.RGBA, Type, null);
    Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MIN_FILTER, Gl.LINEAR);
    Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MAG_FILTER, Gl.LINEAR);
    Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_WRAP_S, Gl.CLAMP_TO_EDGE);
    Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_WRAP_T, Gl.CLAMP_TO_EDGE);
    const Framebuffer = Gl.createFramebuffer();
    Gl.bindFramebuffer(Gl.FRAMEBUFFER, Framebuffer);
    Gl.framebufferTexture2D(Gl.FRAMEBUFFER, Gl.COLOR_ATTACHMENT0, Gl.TEXTURE_2D, Texture, 0);
    CheckFramebuffer(Gl);
    return { Texture, Framebuffer, Width, Height };
}

function CreateMultisampleTarget(Gl, Width, Height, Internal, Samples) {
    const Renderbuffer = Gl.createRenderbuffer();
    Gl.bindRenderbuffer(Gl.RENDERBUFFER, Renderbuffer);
    Gl.renderbufferStorageMultisample(Gl.RENDERBUFFER, Samples, Internal, Width, Height);
    const Framebuffer = Gl.createFramebuffer();
    Gl.bindFramebuffer(Gl.FRAMEBUFFER, Framebuffer);
    Gl.framebufferRenderbuffer(Gl.FRAMEBUFFER, Gl.COLOR_ATTACHMENT0, Gl.RENDERBUFFER, Renderbuffer);
    CheckFramebuffer(Gl);
    return { Framebuffer, Renderbuffer, Samples, Width, Height };
}

export class StrandRenderer {
    constructor(Canvas) {
        this.Canvas = Canvas;
        this.Gl = Canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
        });
        if (!this.Gl) {
            throw new Error('WebGL2 is unavailable in this browser. Use a current Chromium, Firefox or Safari build.');
        }
        const Gl = this.Gl;
        this.FloatTargets = Boolean(Gl.getExtension('EXT_color_buffer_float'));
        this.Samples = Math.min(4, Gl.getParameter(Gl.MAX_SAMPLES) || 1);
        this.Programs = new Map();
        this.Targets = null;
        this.TextTextures = new Map();
        this.VertexArray = Gl.createVertexArray();
        this.DrawCalls = 0;
        this.VertexCount = 0;
        this.DefineAll();
    }

    DefineAll() {
        const Head = Shaders.Header;
        const Shared = Shaders.UniformChunk + Shaders.HashChunk + Shaders.CurveChunk;
        const Lookup = Shaders.UniformChunk + Shaders.HashChunk;
        this.Define('Strand', Head + Shared + Shaders.StrandVertex, Head + Lookup + Shaders.StrandFragment);
        this.Define('Spark', Head + Shared + Shaders.SparkVertex, Head + Lookup + Shaders.SparkFragment);
        this.Define('Particle', Head + Shared + Shaders.ParticleVertex, Head + Shaders.ParticleFragment);
        this.Define('Background', Head + Shaders.FullscreenVertex, Head + Shaders.BackgroundFragment);
        this.Define('Downsample', Head + Shaders.FullscreenVertex, Head + Shaders.DownsampleFragment);
        this.Define('Blur', Head + Shaders.FullscreenVertex, Head + Shaders.BlurFragment);
        this.Define('Composite', Head + Shaders.FullscreenVertex, Head + Shaders.CompositeFragment);
        this.Define('Text', Head + Shaders.FullscreenVertex, Head + Shaders.TextFragment);
    }

    Define(Name, VertexSource, FragmentSource) {
        const Gl = this.Gl;
        const Vertex = this.Compile(Gl.VERTEX_SHADER, VertexSource, Name + '.vertex');
        const Fragment = this.Compile(Gl.FRAGMENT_SHADER, FragmentSource, Name + '.fragment');
        const Program = Gl.createProgram();
        Gl.attachShader(Program, Vertex);
        Gl.attachShader(Program, Fragment);
        Gl.linkProgram(Program);
        if (!Gl.getProgramParameter(Program, Gl.LINK_STATUS)) {
            throw new Error(Name + ' link failed: ' + Gl.getProgramInfoLog(Program));
        }
        this.Programs.set(Name, { Program, Locations: new Map() });
    }

    Compile(Type, Source, Name) {
        const Gl = this.Gl;
        const Shader = Gl.createShader(Type);
        Gl.shaderSource(Shader, Source);
        Gl.compileShader(Shader);
        if (!Gl.getShaderParameter(Shader, Gl.COMPILE_STATUS)) {
            throw new Error(Name + ' failed to compile: ' + Gl.getShaderInfoLog(Shader));
        }
        return Shader;
    }

    UseProgram(Name) {
        const Pack = this.Programs.get(Name);
        this.Gl.useProgram(Pack.Program);
        return Pack;
    }

    SetUniform(Pack, Name, Value) {
        const Gl = this.Gl;
        let Location = Pack.Locations.get(Name);
        if (Location === undefined) {
            Location = Gl.getUniformLocation(Pack.Program, Name);
            Pack.Locations.set(Name, Location);
        }
        if (Location === null) return;
        if (typeof Value === 'number') {
            if (IntegerNames.has(Name)) Gl.uniform1i(Location, Value);
            else Gl.uniform1f(Location, Value);
            return;
        }
        switch (Value.length) {
            case 2: Gl.uniform2fv(Location, Value); break;
            case 3: Gl.uniform3fv(Location, Value); break;
            case 4: Gl.uniform4fv(Location, Value); break;
            case 9: Gl.uniformMatrix3fv(Location, false, Value); break;
            case 16: Gl.uniformMatrix4fv(Location, false, Value); break;
            default: throw new Error('Unsupported uniform length for ' + Name);
        }
    }

    BindTexture(Unit, Texture) {
        this.Gl.activeTexture(this.Gl.TEXTURE0 + Unit);
        this.Gl.bindTexture(this.Gl.TEXTURE_2D, Texture);
    }

    EnsureTargets(Width, Height) {
        const Existing = this.Targets;
        if (Existing && Existing.Width === Width && Existing.Height === Height) return;
        const Gl = this.Gl;
        const Internal = this.FloatTargets ? Gl.RGBA16F : Gl.RGBA8;
        const Type = this.FloatTargets ? Gl.HALF_FLOAT : Gl.UNSIGNED_BYTE;
        const Targets = {
            Width,
            Height,
            Scene: CreateColourTarget(Gl, Width, Height, Internal, Type),
            Glow: [],
            Msaa: null,
        };
        let LevelWidth = Width;
        let LevelHeight = Height;
        for (let Level = 0; Level < GlowLevelCount; Level++) {
            LevelWidth = Math.max(1, Math.floor(LevelWidth / 2));
            LevelHeight = Math.max(1, Math.floor(LevelHeight / 2));
            Targets.Glow.push({
                Width: LevelWidth,
                Height: LevelHeight,
                A: CreateColourTarget(Gl, LevelWidth, LevelHeight, Internal, Type),
                B: CreateColourTarget(Gl, LevelWidth, LevelHeight, Internal, Type),
            });
        }
        if (this.FloatTargets && this.Samples > 1) {
            Targets.Msaa = CreateMultisampleTarget(Gl, Width, Height, Internal, this.Samples);
        }
        this.Targets = Targets;
    }

    Draw(Scene, Seconds) {
        const Gl = this.Gl;
        const Width = Scene.Width;
        const Height = Scene.Height;
        if (this.Canvas.width !== Width) this.Canvas.width = Width;
        if (this.Canvas.height !== Height) this.Canvas.height = Height;
        this.EnsureTargets(Width, Height);
        this.DrawCalls = 0;
        this.VertexCount = 0;

        const Camera = CameraMatrices(Scene.Camera, Width / Height);
        const Frame = {
            ViewProjection: Camera.ViewProjection,
            CameraPosition: Camera.Position,
            LoopFraction: WrapFraction(Seconds / Scene.Playback.LoopSeconds),
            ViewportHeight: Height,
            ProjectionScale: 0.5 * Height / Math.tan(Scene.Camera.Fov * Math.PI / 360),
            Resolution: [Width, Height],
            Brightness: Scene.Post.Brightness,
        };
        const Targets = this.Targets;

        // Step 1: background, then additive fibres and dust into the HDR target.
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, Targets.Msaa ? Targets.Msaa.Framebuffer : Targets.Scene.Framebuffer);
        Gl.viewport(0, 0, Width, Height);
        Gl.disable(Gl.BLEND);
        Gl.clearColor(0, 0, 0, 1);
        Gl.clear(Gl.COLOR_BUFFER_BIT);
        this.DrawBackground(Scene, Frame);
        Gl.enable(Gl.BLEND);
        Gl.blendFunc(Gl.ONE, Gl.ONE);
        for (const Layer of Scene.Layers) {
            if (!Layer.Visible) continue;
            if (Layer.Mechanism === 'Strands') this.DrawStrands(Layer, Frame);
            else if (Layer.Mechanism === 'Particles') this.DrawParticles(Layer, Frame);
        }
        Gl.disable(Gl.BLEND);
        if (Targets.Msaa) {
            Gl.bindFramebuffer(Gl.READ_FRAMEBUFFER, Targets.Msaa.Framebuffer);
            Gl.bindFramebuffer(Gl.DRAW_FRAMEBUFFER, Targets.Scene.Framebuffer);
            Gl.blitFramebuffer(0, 0, Width, Height, 0, 0, Width, Height, Gl.COLOR_BUFFER_BIT, Gl.NEAREST);
        }

        // Step 2: threshold, downsample and blur the HDR target into a short glow chain.
        this.DrawGlow();

        // Step 3: filmic composite onto the canvas.
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        Gl.viewport(0, 0, Width, Height);
        this.DrawComposite(Scene, Frame);

        // Step 4: text overlays are LDR and sit on top of the finished frame.
        Gl.enable(Gl.BLEND);
        Gl.blendFunc(Gl.ONE, Gl.ONE_MINUS_SRC_ALPHA);
        for (const Layer of Scene.Layers) {
            if (Layer.Visible && Layer.Mechanism === 'Text') this.DrawText(Layer, Frame);
        }
        Gl.disable(Gl.BLEND);
        return { DrawCalls: this.DrawCalls, Vertices: this.VertexCount };
    }

    Draw3() {
        this.Gl.bindVertexArray(this.VertexArray);
        this.Gl.drawArrays(this.Gl.TRIANGLES, 0, 3);
        this.DrawCalls += 1;
        this.VertexCount += 3;
    }

    DrawBackground(Scene, Frame) {
        const Pack = this.UseProgram('Background');
        this.SetUniform(Pack, 'InnerColour', HexToLinear(Scene.Background.Inner));
        this.SetUniform(Pack, 'OuterColour', HexToLinear(Scene.Background.Outer));
        this.SetUniform(Pack, 'Resolution', Frame.Resolution);
        this.Draw3();
    }

    ApplyCurveUniforms(Pack, Layer, Frame) {
        this.SetUniform(Pack, 'Shape', ShapeIndexes[Layer.Shape]);
        this.SetUniform(Pack, 'StrandCount', Layer.Strands);
        this.SetUniform(Pack, 'SegmentCount', Layer.Segments);
        this.SetUniform(Pack, 'Seed', Layer.Seed);
        this.SetUniform(Pack, 'Length', Layer.Length);
        this.SetUniform(Pack, 'Spread', Layer.Spread);
        this.SetUniform(Pack, 'Amplitude', Layer.Amplitude);
        this.SetUniform(Pack, 'Frequency', Layer.Frequency);
        this.SetUniform(Pack, 'Direction', Layer.Direction);
        this.SetUniform(Pack, 'Ruffle', Layer.Ruffle);
        this.SetUniform(Pack, 'SheetWidth', Layer.SheetWidth);
        this.SetUniform(Pack, 'Ripple', Layer.Ripple);
        this.SetUniform(Pack, 'Waves', Layer.Waves);
        this.SetUniform(Pack, 'PhaseSpread', Layer.PhaseSpread);
        this.SetUniform(Pack, 'Harmonic', Layer.Harmonic);
        this.SetUniform(Pack, 'WindowCycles', Layer.WindowCycles);
        this.SetUniform(Pack, 'LoopFraction', Frame.LoopFraction);
        this.SetUniform(Pack, 'ModelRotation', Mat3FromEulerDegrees(Layer.Rotation[0], Layer.Rotation[1], Layer.Rotation[2]));
        this.SetUniform(Pack, 'ModelPosition', Layer.Position);
        this.SetUniform(Pack, 'ModelScale', Layer.Scale);
        this.SetUniform(Pack, 'ViewProjection', Frame.ViewProjection);
        this.SetUniform(Pack, 'CameraPosition', Frame.CameraPosition);
        this.SetUniform(Pack, 'ProjectionScale', Frame.ProjectionScale);
    }

    DrawStrands(Layer, Frame) {
        const Gl = this.Gl;
        const Pack = this.UseProgram('Strand');
        this.ApplyCurveUniforms(Pack, Layer, Frame);
        this.SetUniform(Pack, 'Width', Layer.Width);
        this.SetUniform(Pack, 'Taper', Layer.Taper);
        this.SetUniform(Pack, 'Intensity', Layer.Intensity);
        this.SetUniform(Pack, 'Core', Layer.Core);
        this.SetUniform(Pack, 'Halo', Layer.Halo);
        this.SetUniform(Pack, 'Baseline', Layer.Baseline);
        this.SetUniform(Pack, 'Window', Layer.Window);
        this.SetUniform(Pack, 'AccentMix', Layer.AccentMix);
        this.SetUniform(Pack, 'ColourStart', HexToLinear(Layer.ColourStart));
        this.SetUniform(Pack, 'ColourEnd', HexToLinear(Layer.ColourEnd));
        this.SetUniform(Pack, 'ColourAccent', HexToLinear(Layer.ColourAccent));
        const Vertices = Layer.Strands * Layer.Segments * 6;
        Gl.bindVertexArray(this.VertexArray);
        Gl.drawArrays(Gl.TRIANGLES, 0, Vertices);
        this.DrawCalls += 1;
        this.VertexCount += Vertices;

        if (Layer.Sparks > 0 && Layer.SparkSize > 0) {
            const Spark = this.UseProgram('Spark');
            this.ApplyCurveUniforms(Spark, Layer, Frame);
            this.SetUniform(Spark, 'SparkSize', Layer.SparkSize);
            this.SetUniform(Spark, 'SparkBrightness', Layer.SparkBrightness);
            this.SetUniform(Spark, 'Sparks', Layer.Sparks);
            this.SetUniform(Spark, 'ColourStart', HexToLinear(Layer.ColourStart));
            this.SetUniform(Spark, 'ColourEnd', HexToLinear(Layer.ColourEnd));
            Gl.drawArrays(Gl.POINTS, 0, Layer.Strands);
            this.DrawCalls += 1;
            this.VertexCount += Layer.Strands;
        }
    }

    DrawParticles(Layer, Frame) {
        if (Layer.Count === 0) return;
        const Gl = this.Gl;
        const Pack = this.UseProgram('Particle');
        this.SetUniform(Pack, 'ModelRotation', Mat3FromEulerDegrees(Layer.Rotation[0], Layer.Rotation[1], Layer.Rotation[2]));
        this.SetUniform(Pack, 'ModelPosition', Layer.Position);
        this.SetUniform(Pack, 'ModelScale', Layer.Scale);
        this.SetUniform(Pack, 'ViewProjection', Frame.ViewProjection);
        this.SetUniform(Pack, 'ProjectionScale', Frame.ProjectionScale);
        this.SetUniform(Pack, 'LoopFraction', Frame.LoopFraction);
        this.SetUniform(Pack, 'Seed', Layer.Seed);
        this.SetUniform(Pack, 'ParticleSize', Layer.Size);
        this.SetUniform(Pack, 'ParticleBrightness', Layer.Brightness);
        this.SetUniform(Pack, 'ParticleSpread', Layer.Spread);
        this.SetUniform(Pack, 'ParticleDrift', Layer.Drift);
        this.SetUniform(Pack, 'ParticleColour', HexToLinear(Layer.Colour));
        this.SetUniform(Pack, 'ParticleHarmonic', Layer.Harmonic);
        this.SetUniform(Pack, 'Bokeh', Layer.Bokeh);
        this.SetUniform(Pack, 'Focus', Layer.Focus);
        Gl.bindVertexArray(this.VertexArray);
        Gl.drawArrays(Gl.POINTS, 0, Layer.Count);
        this.DrawCalls += 1;
        this.VertexCount += Layer.Count;
    }

    DrawGlow() {
        const Gl = this.Gl;
        const Targets = this.Targets;
        let Source = Targets.Scene;
        for (let Level = 0; Level < Targets.Glow.length; Level++) {
            const Glow = Targets.Glow[Level];
            Gl.bindFramebuffer(Gl.FRAMEBUFFER, Glow.A.Framebuffer);
            Gl.viewport(0, 0, Glow.Width, Glow.Height);
            let Pack = this.UseProgram('Downsample');
            this.BindTexture(0, Source.Texture);
            this.SetUniform(Pack, 'Source', 0);
            this.SetUniform(Pack, 'TexelSize', [1 / Source.Width, 1 / Source.Height]);
            this.SetUniform(Pack, 'Threshold', BrightThreshold);
            this.SetUniform(Pack, 'Mode', Level === 0 ? 0 : 1);
            this.Draw3();

            Pack = this.UseProgram('Blur');
            Gl.bindFramebuffer(Gl.FRAMEBUFFER, Glow.B.Framebuffer);
            this.BindTexture(0, Glow.A.Texture);
            this.SetUniform(Pack, 'Source', 0);
            this.SetUniform(Pack, 'BlurStep', [1 / Glow.Width, 0]);
            this.Draw3();

            Gl.bindFramebuffer(Gl.FRAMEBUFFER, Glow.A.Framebuffer);
            this.BindTexture(0, Glow.B.Texture);
            this.SetUniform(Pack, 'BlurStep', [0, 1 / Glow.Height]);
            this.Draw3();
            Source = Glow.A;
        }
    }

    DrawComposite(Scene, Frame) {
        const Targets = this.Targets;
        const Pack = this.UseProgram('Composite');
        this.BindTexture(0, Targets.Scene.Texture);
        Targets.Glow.forEach((Glow, Index) => this.BindTexture(1 + Index, Glow.A.Texture));
        this.SetUniform(Pack, 'SceneTex', 0);
        this.SetUniform(Pack, 'GlowA', 1);
        this.SetUniform(Pack, 'GlowB', 2);
        this.SetUniform(Pack, 'GlowC', 3);
        this.SetUniform(Pack, 'GlowD', 4);
        const Spread = Scene.Post.GlowSpread;
        this.SetUniform(Pack, 'GlowWeights', [1.0 - 0.55 * Spread, 0.85, 0.55 + 0.45 * Spread, 0.35 + 0.65 * Spread]);
        this.SetUniform(Pack, 'Exposure', Scene.Post.Exposure);
        this.SetUniform(Pack, 'GlowAmount', Scene.Post.Glow);
        this.SetUniform(Pack, 'Saturation', Scene.Post.Saturation);
        this.SetUniform(Pack, 'Brightness', Scene.Post.Brightness);
        this.SetUniform(Pack, 'Vignette', Scene.Background.Vignette);
        this.SetUniform(Pack, 'Grain', Scene.Background.Grain);
        this.SetUniform(Pack, 'Resolution', Frame.Resolution);
        this.Draw3();
    }

    DrawText(Layer, Frame) {
        const Entry = this.TextTexture(Layer, Frame.Resolution[0], Frame.Resolution[1]);
        const Pack = this.UseProgram('Text');
        this.BindTexture(0, Entry.Texture);
        this.SetUniform(Pack, 'TextTex', 0);
        this.SetUniform(Pack, 'Brightness', Frame.Brightness);
        this.Draw3();
    }

    TextTexture(Layer, Width, Height) {
        const Key = JSON.stringify([Layer, Width, Height]);
        const Known = this.TextTextures.get(Key);
        if (Known) return Known;
        const Gl = this.Gl;
        const Canvas2d = RasterizeText(Layer, Width, Height);
        const Texture = Gl.createTexture();
        Gl.bindTexture(Gl.TEXTURE_2D, Texture);
        Gl.pixelStorei(Gl.UNPACK_FLIP_Y_WEBGL, true);
        Gl.pixelStorei(Gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        Gl.texImage2D(Gl.TEXTURE_2D, 0, Gl.RGBA, Gl.RGBA, Gl.UNSIGNED_BYTE, Canvas2d);
        Gl.pixelStorei(Gl.UNPACK_FLIP_Y_WEBGL, false);
        Gl.pixelStorei(Gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MIN_FILTER, Gl.LINEAR);
        Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_MAG_FILTER, Gl.LINEAR);
        Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_WRAP_S, Gl.CLAMP_TO_EDGE);
        Gl.texParameteri(Gl.TEXTURE_2D, Gl.TEXTURE_WRAP_T, Gl.CLAMP_TO_EDGE);
        const Entry = { Texture };
        if (this.TextTextures.size >= TextCacheLimit) {
            const Oldest = this.TextTextures.keys().next().value;
            Gl.deleteTexture(this.TextTextures.get(Oldest).Texture);
            this.TextTextures.delete(Oldest);
        }
        this.TextTextures.set(Key, Entry);
        return Entry;
    }

    // 📝 Returns the last drawn frame as RGBA bytes, bottom row first, for statistics and proof images.
    ReadPixels() {
        const Gl = this.Gl;
        const Width = this.Canvas.width;
        const Height = this.Canvas.height;
        const Pixels = new Uint8Array(Width * Height * 4);
        Gl.bindFramebuffer(Gl.FRAMEBUFFER, null);
        Gl.readPixels(0, 0, Width, Height, Gl.RGBA, Gl.UNSIGNED_BYTE, Pixels);
        return Pixels;
    }
}
