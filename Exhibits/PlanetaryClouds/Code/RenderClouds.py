#!/usr/bin/env python3
# ============================================================================================================================================
#                                                            RENDERCLOUDS.PY
# ============================================================================================================================================
# 🧩 Compile, integrate and retain actual Slang volume captures with linear Float32 radiance and exact rendering inputs.

import argparse
import ctypes as Ct
from dataclasses import asdict, dataclass, replace
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import time
from tempfile import TemporaryDirectory

import numpy as Np
from PIL import Image

from CloudSourceIdentity import QuerySourceIdentity

Root = Path(__file__).resolve().parents[3]
Source = Root / "Experimental/PlanetaryClouds"
Cache = Root / "_ClaudeScratch/build/PlanetaryClouds"
Entry = "CloudCaptureEntry"


@dataclass(frozen=True)
class CloudView:
    Name: str
    Origin: tuple = (0.0, 0.0, 24.0)
    View: tuple = (0.0, 12.0)
    Sun: tuple = (-60.0, 35.0)
    Fov: float = 42.0
    Coverage: float = 0.67
    Extinction: float = 1.0
    Seed: float = 0.04
    Exposure: float = 1.0
    Floor: float = 1200.0
    Depth: float = 3900.0
    Scale: float = 1.0
    Phase: float = 0.82
    Formation: int = 0
    Surface: int = 0
    Air: tuple = (1.0, 0.72, 1.0)
    Solar: float = 16.0
    Time: float = 0.0
    Wind: tuple = (12.0, 4.0)
    Shear: float = 0.10
    Veer: float = 0.10
    Turbulence: float = 0.30
    Anvil: float = 0.60
    CycloneSpeed: float = 58.0
    Eye: float = 21000.0
    CycloneAxis: tuple = (0.0, 0.0, 1.0)
    Clouds: int = 1
    Shadows: int = 1
    UniformExtinction: float = -1.0


Views = {
    "cumulus": CloudView("Cumulus", Origin=(-3000.0, 4200.0, 24.0), View=(-42.0, 12.0), Sun=(-114.0, 26.0), Coverage=0.48, Exposure=0.68),
    "stratocumulus": CloudView("Stratocumulus", Formation=1, Floor=1000.0, Depth=1700.0, Scale=1.2, Coverage=0.83),
    "stratus": CloudView("Stratus", Formation=2, Floor=400.0, Depth=550.0, Scale=1.5, Coverage=0.96, Sun=(-70.0, 22.0)),
    "altocumulus": CloudView("Altocumulus", Formation=3, Floor=4200.0, Depth=1600.0, Scale=0.65, Coverage=0.76, View=(0.0, 28.0)),
    "altostratus": CloudView("Altostratus", Formation=4, Floor=4400.0, Depth=2200.0, Scale=1.7, Coverage=0.92, Extinction=0.54),
    "nimbostratus": CloudView("Nimbostratus", Formation=5, Floor=600.0, Depth=5400.0, Scale=2.1, Coverage=0.98, Extinction=1.4, Sun=(-80.0, 16.0)),
    "cirrus": CloudView("Cirrus", Formation=6, Floor=9300.0, Depth=2200.0, Scale=0.90, Coverage=0.73, Extinction=0.42, View=(0.0, 29.0)),
    "cirrostratus": CloudView("Cirrostratus", Formation=7, Floor=8500.0, Depth=2100.0, Scale=1.6, Coverage=0.96, Extinction=0.48, View=(0.0, 24.0)),
    "cirrocumulus": CloudView("Cirrocumulus", Formation=8, Floor=8200.0, Depth=900.0, Scale=0.42, Coverage=0.70, Extinction=0.63, View=(0.0, 26.0)),
    "towering": CloudView("ToweringCumulus", Formation=9, Floor=1100.0, Depth=8900.0, Scale=1.6, Coverage=0.78, View=(27.0, 13.0), Origin=(-21000.0, -10500.0, 50.0), Fov=42.0, Air=(0.9, 0.40, 1.0)),
    "cumulonimbus": CloudView("Cumulonimbus", Formation=10, Floor=1100.0, Depth=13300.0, Scale=2.4, Coverage=0.63, View=(27.0, 17.0), Origin=(-26000.0, -13000.0, 100.0), Fov=50.0, Air=(0.9, 0.40, 1.0), Sun=(-73.0, 18.0), Exposure=0.84),
    "cyclone": CloudView("CycloneOrbit", Formation=11, Floor=900.0, Depth=14000.0, Scale=1.4, Coverage=0.91, Origin=(0.0, 0.0, 1000000.0), View=(0.0, -89.999), Fov=44.0, Sun=(-44.0, 13.0), Exposure=0.64, Wind=(0.0, 0.0)),
    "eye": CloudView("CycloneEye", Formation=11, Floor=900.0, Depth=14000.0, Scale=1.4, Coverage=0.91,
                     Origin=(90000.0, -100000.0, 180000.0), View=(132.0, -51.0), Fov=44.0,
                     Sun=(-44.0, 18.0), Exposure=0.78, Wind=(0.0, 0.0)),
    "orbit": CloudView("CumulusOrbit", Origin=(-210000.0, -190000.0, 610000.0), View=(17.0, -36.0), Fov=44.0, Coverage=0.73, Sun=(-59.0, 39.0), Scale=1.3, Exposure=0.82),
    "limb": CloudView("CycloneLimb", Formation=11, Floor=900.0, Depth=14000.0, Origin=(-450000.0, -250000.0, 680000.0), View=(24.0, -44.0), Fov=42.0, Coverage=0.91, Sun=(-60.0, 24.0), Scale=1.4, Exposure=0.86, Wind=(0.0, 0.0)),
    "silver": CloudView("SilverLining", Origin=(-3000.0, 4200.0, 24.0), View=(-42.0, 18.0), Sun=(-35.0, 20.0), Coverage=0.65, Exposure=0.74),
    "sunset": CloudView("GoldenHour", Origin=(-3000.0, 4200.0, 24.0), View=(-42.0, 12.0), Sun=(-66.0, 3.5), Coverage=0.70, Exposure=1.5),
    "dawn": CloudView("Dawn", Origin=(-3000.0, 4200.0, 24.0), View=(-42.0, 12.0), Sun=(-66.0, -2.2), Coverage=0.70, Exposure=2.6),
    "inside": CloudView("InsideCumulus", Origin=(-4100.0, 2800.0, 2100.0), View=(-42.0, 4.0), Sun=(-114.0, 32.0), Coverage=0.78),
    "above": CloudView("AboveCumulus", Origin=(-3000.0, 4200.0, 7400.0), View=(-42.0, -24.0), Sun=(-114.0, 32.0), Coverage=0.73, Fov=46.0),
    "vacuum": CloudView("LunarVacuum", Surface=2),
}


def Direction(Azimuth, Elevation):
    Azimuth, Elevation = math.radians(Azimuth), math.radians(Elevation)
    return math.cos(Elevation) * math.cos(Azimuth), math.cos(Elevation) * math.sin(Azimuth), math.sin(Elevation)


def Cross(Left, Right):
    return (Left[1] * Right[2] - Left[2] * Right[1], Left[2] * Right[0] - Left[0] * Right[2],
            Left[0] * Right[1] - Left[1] * Right[0])


def EncodeFootprint(View, Width, Height, SurfaceSize, Row, Rows, Steps, LightSteps, Samples, Diagnostic=0):
    Forward = Direction(*View.View)
    Azimuth = math.radians(View.View[0])
    Right = (math.sin(Azimuth), -math.cos(Azimuth), 0.0)
    Up = Cross(Right, Forward)
    TangentY = math.tan(math.radians(View.Fov) / 2.0)
    return struct.pack("<44f16I", *View.Origin, View.Time, *Forward, View.Wind[0],
                       *Right, TangentY * Width / Height, *Up, TangentY, *Direction(*View.Sun), View.Solar,
                       View.Floor, View.Depth, View.Coverage, View.Extinction,
                       View.Scale, View.Seed, View.Phase, View.Exposure, *View.Air, View.Wind[1],
                       View.Shear, View.Veer, View.Turbulence, View.Anvil,
                       View.CycloneSpeed, View.Eye, View.UniformExtinction, 0.0, *View.CycloneAxis, 0.0,
                       View.Surface, Steps, LightSteps, View.Formation, Width, Height, *SurfaceSize,
                       Row, Rows, Samples, Diagnostic, View.Clouds, View.Shadows, int(View.UniformExtinction >= 0.0), 0)


def CompileNative(Slang, Compiler=None, Sanitizer=False):
    Cache.mkdir(parents=True, exist_ok=True)
    Compiler = Compiler or os.environ.get("CXX", "c++")
    Identity = QuerySourceIdentity()
    CompilerVersion = subprocess.run([Compiler, "--version"], check=True, capture_output=True, text=True).stdout.splitlines()[0]
    SlangVersion = subprocess.run([str(Slang), "-version"], check=True, capture_output=True, text=True)
    SlangVersion = (SlangVersion.stdout + SlangVersion.stderr).strip()
    BuildIdentity = sha256((Identity + CompilerVersion + SlangVersion + str(Sanitizer)).encode()).hexdigest()
    Directory = Cache / BuildIdentity[:20]
    Directory.mkdir(exist_ok=True)
    Library = Directory / ("CloudNative.dll" if os.name == "nt" else "CloudNative.so")
    if not Library.exists():
        with TemporaryDirectory(dir=Directory) as Scratch:
            Work = Path(Scratch)
            Generated = Work / "CloudGenerated.cpp"
            Candidate = Work / Library.name
            subprocess.run([str(Slang), str(Source / "CloudCompute.slang"), "-entry", Entry, "-target", "cpp",
                            "-O0", "-fp-mode", "precise", "-o", str(Generated)], check=True)
            Command = [Compiler, "-std=c++20", "-O2" if Sanitizer else "-O3", "-fno-math-errno", "-pthread", "-shared",
                       "-fPIC", "-fno-fast-math", "-ffp-contract=off", f'-DFRONTIER_CLOUD_SOURCE_SHA256="{Identity}"',
                       "-I", str(Root), "-I", str(Work),
                       str(Source / "CloudNative.cpp"), "-o", str(Candidate)]
            if Sanitizer:
                Command.extend(["-fsanitize=address,undefined", "-fno-omit-frame-pointer", "-g"])
            subprocess.run(Command, check=True)
            shutil.copy2(Generated, Directory / Generated.name)
            Candidate.replace(Library)
            (Directory / "CloudBuild.json").write_text(json.dumps({"source_sha256": Identity,
                "library_sha256": sha256(Library.read_bytes()).hexdigest(), "compiler": CompilerVersion,
                "slang": SlangVersion, "sanitizers": Sanitizer, "cpp_command": Command}, indent=2) + "\n")
    NoiseSources = [Source / "CloudNoiseVolume.h", Path(__file__).with_name("BakeCloudNoise.cpp")]
    NoiseIdentity = sha256(b"".join(PathName.read_bytes() for PathName in NoiseSources)).hexdigest()
    Noise = Cache / (NoiseIdentity[:20] + ".volume")
    if not Noise.exists():
        with TemporaryDirectory(dir=Cache) as Scratch:
            Work = Path(Scratch)
            Baker = Work / "CloudNoiseBake"
            Candidate = Work / "CloudNoise.volume"
            subprocess.run([Compiler, "-std=c++20", "-O3", "-I", str(Root), str(NoiseSources[1]), "-o", str(Baker)], check=True)
            subprocess.run([str(Baker), str(Candidate)], check=True)
            Candidate.replace(Noise)
    return Library, Noise, Identity


class NativeIntegration:
    def __init__(self, Library, Noise, Surface=None, Threads=2):
        self.Library = Ct.CDLL(str(Library))
        SourceQuery = self.Library.QueryCloudSourceIdentity
        SourceQuery.restype = Ct.c_char_p
        self.SourceIdentity = SourceQuery().decode("ascii")
        if self.SourceIdentity != QuerySourceIdentity():
            raise RuntimeError("Cloud library source identity does not match the current authored inputs; rebuild it")
        self.LibraryIdentity = sha256(Path(Library).read_bytes()).hexdigest()
        self.Entry = self.Library.IntegrateCloudTile
        self.Entry.restype = Ct.c_int
        self.Entry.argtypes = [Ct.c_void_p, Ct.c_void_p, Ct.c_size_t, Ct.c_void_p, Ct.c_size_t,
                               Ct.c_void_p, Ct.c_size_t, Ct.c_uint32]
        NoiseBytes = Path(Noise).read_bytes()
        self.NoiseIdentity = sha256(NoiseBytes).hexdigest()
        self.Noise = Ct.create_string_buffer(NoiseBytes, len(NoiseBytes))
        self.SurfaceSize = Surface.size if Surface else (1, 1)
        SurfaceBytes = Surface.convert("RGBA").tobytes() if Surface else bytes((16, 42, 68, 255))
        self.Surface = Ct.create_string_buffer(SurfaceBytes, len(SurfaceBytes))
        self.Threads = Threads

    def Dispatch(self, Uniform, Width, Rows):
        Capacity = Width * Rows * 16
        Pixels = Ct.create_string_buffer(Capacity + 64)
        Ct.memset(Ct.addressof(Pixels) + Capacity, 0xA5, 64)
        Result = self.Entry(Uniform, self.Noise, len(self.Noise) // 4, self.Surface, len(self.Surface) // 4,
                            Pixels, Capacity, self.Threads)
        if Result != 0:
            raise RuntimeError(f"Cloud compute input rejected: {Result}")
        assert Pixels.raw[Capacity:] == b"\xa5" * 64, "native output tail changed"
        return Pixels.raw[:Capacity]

    def Inspect(self, View, Queries, Steps=256, LightSteps=32):
        Queries = Np.asarray(Queries, dtype="<f4").reshape(-1, 16)
        Surface = self.Surface
        SurfaceSize = self.SurfaceSize
        Output = []
        try:
            for Start in range(0, len(Queries), 4096):
                Region = Queries[Start:Start + 4096]
                Raw = Region.tobytes()
                self.Surface = Ct.create_string_buffer(Raw, len(Raw))
                self.SurfaceSize = (len(Raw) // 4, 1)
                Uniform = EncodeFootprint(View, len(Region), 1, self.SurfaceSize, 0, 1, Steps, LightSteps, 1, 2)
                Output.append(Np.frombuffer(self.Dispatch(Uniform, len(Region), 1), dtype="<f4").reshape(-1, 4))
        finally:
            self.Surface = Surface
            self.SurfaceSize = SurfaceSize
        return Np.concatenate(Output)

    def Capture(self, View, Width, Height, Steps, LightSteps, Samples=1, Diagnostic=0):
        Output = bytearray()
        for Row in range(0, Height, 32):
            Rows = min(32, Height - Row)
            Uniform = EncodeFootprint(View, Width, Height, self.SurfaceSize, Row, Rows, Steps, LightSteps, Samples, Diagnostic)
            Output.extend(self.Dispatch(Uniform, Width, Rows))
        Pixels = Np.frombuffer(bytes(Output), dtype="<f4").reshape(Height, Width, 4)
        assert Np.isfinite(Pixels).all() and (Pixels >= 0.0).all(), "invalid linear cloud capture"
        return Pixels


def EncodeDisplay(Pixels, Exposure):
    Linear = Np.maximum(Pixels[..., :3].astype(Np.float64) * Exposure, 0.0)
    Display = Np.clip((Linear * (2.51 * Linear + 0.03)) / (Linear * (2.43 * Linear + 0.59) + 0.14), 0.0, 1.0)
    Display = Np.where(Display <= 0.0031308, Display * 12.92, 1.055 * Display ** (1.0 / 2.4) - 0.055)
    return Np.rint(Display * 255.0).astype(Np.uint8)


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("views", nargs="*", choices=sorted(Views), default=["cumulus"])
    Parser.add_argument("--slang", type=Path, default=Root / "ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc")
    Parser.add_argument("--library", type=Path)
    Parser.add_argument("--noise", type=Path)
    Parser.add_argument("--width", type=int, default=640)
    Parser.add_argument("--height", type=int, default=360)
    Parser.add_argument("--steps", type=int, default=192)
    Parser.add_argument("--light-steps", type=int, default=12)
    Parser.add_argument("--samples", type=int, default=1)
    Parser.add_argument("--threads", type=int, default=2)
    Parser.add_argument("--time", type=float)
    Parser.add_argument("--coverage", type=float)
    Parser.add_argument("--diagnostic", type=int, default=0, choices=(0, 1, 3))
    Parser.add_argument("--out", type=Path, default=Root / "_ClaudeScratch/tmp/CloudCaptures")
    Arguments = Parser.parse_args()
    if not (0 < Arguments.width <= 8192 and 0 < Arguments.height <= 8192 and 0 < Arguments.steps <= 4096 and
            0 < Arguments.light_steps <= 256 and 0 < Arguments.samples <= 64 and Arguments.threads > 0):
        Parser.error("dimensions, steps, samples or thread count out of bounds")
    if bool(Arguments.library) != bool(Arguments.noise):
        Parser.error("--library and --noise must be provided together")
    if Arguments.library:
        Library, Noise, Identity = Arguments.library.resolve(), Arguments.noise.resolve(), QuerySourceIdentity()
    else:
        Library, Noise, Identity = CompileNative(Arguments.slang)
    Integration = NativeIntegration(Library, Noise, Threads=Arguments.threads)
    Arguments.out.mkdir(parents=True, exist_ok=True)
    for Name in Arguments.views:
        View = Views[Name]
        if Arguments.time is not None:
            View = replace(View, Time=Arguments.time)
        if Arguments.coverage is not None:
            View = replace(View, Coverage=Arguments.coverage)
        Start = time.monotonic()
        Pixels = Integration.Capture(View, Arguments.width, Arguments.height, Arguments.steps,
                                     Arguments.light_steps, Arguments.samples, Arguments.diagnostic)
        Duration = time.monotonic() - Start
        Suffix = f"T{int(View.Time):05d}" if View.Time else ""
        if Arguments.diagnostic:
            Suffix += f"Diagnostic{Arguments.diagnostic}"
        Destination = Arguments.out / (View.Name + Suffix)
        Pixels.tofile(Destination.with_suffix(".f32"))
        Display = EncodeDisplay(Pixels, View.Exposure)
        if Arguments.diagnostic == 1:
            Display = Np.repeat(Np.rint(Np.clip(Pixels[..., :1], 0.0, 1.0) * 255.0).astype(Np.uint8), 3, axis=-1)
        Image.fromarray(Display).save(Destination.with_suffix(".png"), optimize=True)
        Report = {"view": asdict(View), "source_sha256": Identity, "execution": "Slang native C++ target",
                  "library_sha256": Integration.LibraryIdentity, "noise_sha256": sha256(Path(Noise).read_bytes()).hexdigest(),
                  "width": Arguments.width, "height": Arguments.height, "steps": Arguments.steps,
                  "light_steps": Arguments.light_steps, "samples": Arguments.samples, "seconds": Duration,
                  "diagnostic": Arguments.diagnostic, "linear_float_sha256": sha256(Pixels.tobytes()).hexdigest(),
                  "png_sha256": sha256(Destination.with_suffix(".png").read_bytes()).hexdigest(),
                  "transmittance_range": [float(Pixels[..., 3].min()), float(Pixels[..., 3].max())],
                  "image_filter": "none; native pixels; ACES fitted curve then IEC sRGB",
                  "temporal_history": False, "production_accepted": False}
        Destination.with_suffix(".json").write_text(json.dumps(Report, indent=2) + "\n")
        print(f"{Destination.name}: {Arguments.width}x{Arguments.height}, {Duration:.2f}s, T={Report['transmittance_range']}", flush=True)


if __name__ == "__main__":
    Main()
