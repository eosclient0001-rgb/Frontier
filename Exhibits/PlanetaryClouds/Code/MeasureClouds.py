#!/usr/bin/env python3
# ============================================================================================================================================
#                                                            MEASURECLOUDS.PY
# ============================================================================================================================================
# 🧩 Finite quadrature comparisons, camera-independent cloud rays, volumetric sections and moving receiver illumination.

import argparse
from dataclasses import asdict, replace
from hashlib import sha256
import json
import math
from pathlib import Path
import time

import numpy as Np
from PIL import Image, ImageDraw

import RenderClouds as Clouds
from ValidateClouds import Query

Radius = 6371000.0


def RetainCapture(Integration, View, Destination, Width=480, Height=270, Steps=320, LightSteps=32, Samples=2):
    Start = time.monotonic()
    Pixels = Integration.Capture(View, Width, Height, Steps, LightSteps, Samples)
    Image.fromarray(Clouds.EncodeDisplay(Pixels, View.Exposure)).save(Destination.with_suffix(".png"), optimize=True)
    Np.savez_compressed(Destination.with_suffix(".npz"), Rgba=Pixels)
    Report = {"view": asdict(View), "width": Width, "height": Height, "steps": Steps,
              "light_steps": LightSteps, "samples": Samples, "seconds": time.monotonic() - Start,
              "source_sha256": Integration.SourceIdentity, "execution": "Slang native C++ target",
              "library_sha256": Integration.LibraryIdentity, "noise_sha256": Integration.NoiseIdentity,
              "float_sha256": sha256(Pixels.tobytes()).hexdigest(),
              "png_sha256": sha256(Destination.with_suffix(".png").read_bytes()).hexdigest(),
              "filter": "none; native pixels, ACES fitted display curve and IEC sRGB",
              "temporal_history": False, "production_accepted": False}
    Destination.with_suffix(".json").write_text(json.dumps(Report, indent=2) + "\n")
    print(f"{Destination.name}: {Report['seconds']:.2f}s", flush=True)
    return Pixels, Report


# ------------------------------------------------------------------------------------------------------------------------
#                                                  FINITE SAMPLING COMPARISONS
# ------------------------------------------------------------------------------------------------------------------------


def MeasureSampling(Integration, Results, Images):
    Report = {"reference": "finite 768 view / 64 solar steps, one pixel sample; not ground truth",
              "image_extent": [96, 54], "cloud_radiance_only": True, "cases": [], "convergence_accepted": False}
    Arrays = {}
    for Name in ("cumulus", "cirrus", "cumulonimbus", "cyclone"):
        View = Clouds.Views[Name]
        Reference = Integration.Capture(View, 96, 54, 768, 64, Diagnostic=3)
        Arrays[Name + "Reference"] = Reference
        Case = {"view": Name, "view_budget": [], "light_budget": []}
        for Steps in (64, 128, 256, 384):
            Actual = Integration.Capture(View, 96, 54, Steps, 64, Diagnostic=3)
            Difference = Actual - Reference
            Case["view_budget"].append({"steps": Steps,
                "rgb_rmse": float(Np.sqrt(Np.mean(Difference[..., :3] ** 2))),
                "transmittance_rmse": float(Np.sqrt(Np.mean(Difference[..., 3] ** 2))),
                "max_abs": float(Np.abs(Difference).max())})
            Arrays[Name + f"View{Steps}"] = Actual
        for Steps in (8, 16, 32):
            Actual = Integration.Capture(View, 96, 54, 768, Steps, Diagnostic=3)
            Difference = Actual - Reference
            Case["light_budget"].append({"steps": Steps,
                "rgb_rmse": float(Np.sqrt(Np.mean(Difference[..., :3] ** 2))),
                "transmittance_rmse": float(Np.sqrt(Np.mean(Difference[..., 3] ** 2)))})
            Arrays[Name + f"Light{Steps}"] = Actual
        Case["view_384_improves_on_64"] = Case["view_budget"][-1]["rgb_rmse"] < Case["view_budget"][0]["rgb_rmse"]
        Report["cases"].append(Case)
        print(json.dumps(Case), flush=True)
    Np.savez_compressed(Results / "SamplingPixels.npz", **Arrays)
    Canvas = Image.new("RGB", (960, 500), "#111b29")
    Pen = ImageDraw.Draw(Canvas)
    Pen.text((20, 12), "Cloud-only linear RGB RMSE to finite 768/64 quadrature (not ground truth)", fill="white")
    for Index, Case in enumerate(Report["cases"]):
        Left = 38 + (Index % 2) * 475
        Top = 58 + (Index // 2) * 220
        Width, Height = 410, 150
        Pen.text((Left, Top - 18), Case["view"], fill="white")
        Pen.line((Left, Top, Left, Top + Height, Left + Width, Top + Height), fill="#8192aa")
        Maximum = max(Entry["rgb_rmse"] for Entry in Case["view_budget"]) * 1.1
        Points = []
        for Entry in Case["view_budget"]:
            X = Left + (Entry["steps"] - 64) / 320 * Width
            Y = Top + Height * (1.0 - Entry["rgb_rmse"] / max(Maximum, 1.0e-8))
            Points.append((X, Y))
            Pen.ellipse((X - 3, Y - 3, X + 3, Y + 3), fill="#91d9ea")
            Pen.text((X - 10, Top + Height + 7), str(Entry["steps"]), fill="white")
        Pen.line(Points, fill="#91d9ea", width=2)
        Pen.text((Left + 4, Top + 4), f"max axis {Maximum:.5f}", fill="#c3cfdd")
    Canvas.save(Images / "Sampling.png", optimize=True)
    return Report


def MeasureOrbitalCoherence(Integration):
    Report = []
    for Name, Extent in (("cumulus", 18000.0), ("cyclone", 220000.0)):
        View = Clouds.Views[Name]
        Random = Np.random.default_rng(901)
        Queries = []
        for X, Y in Random.uniform(-Extent, Extent, size=(96, 2)):
            for Altitude in (200000.0, 50000.0):
                Queries.append(Query(6, (X, Y, Radius + Altitude), (0.0, 0.0, -1.0),
                                     Parameters=(1000000.0, 0.0, 0.0, 0.0)))
        Actual = Integration.Inspect(View, Queries, Steps=768, LightSteps=64).reshape(-1, 2, 4)
        Difference = Np.abs(Actual[:, 0] - Actual[:, 1])
        Report.append({"view": Name, "world_rays": 96, "origin_separation_m": 150000,
                       "fixed_footprint_m": 1, "max_abs": float(Difference.max()),
                       "mean_abs": float(Difference.mean()),
                       "within_declared_0_02_max_tolerance": bool(Difference.max() < 0.02)})
    return Report


# ------------------------------------------------------------------------------------------------------------------------
#                                               VOLUME AND RECEIVER DIAGNOSTICS
# ------------------------------------------------------------------------------------------------------------------------


def MeasureSections(Integration, Results, Images):
    Width, Height = 480, 180
    Arrays = {}
    Report = []
    Canvas = Image.new("RGB", (960, 270), "#111b29")
    Pen = ImageDraw.Draw(Canvas)
    for Index, (Name, Extent) in enumerate((("cyclone", 100000.0), ("cumulonimbus", 17000.0))):
        View = Clouds.Views[Name]
        Queries = []
        for Altitude in Np.linspace(16000.0, 0.0, Height):
            for Distance in Np.linspace(-Extent, Extent, Width):
                Angle = Distance / Radius
                Position = ((Radius + Altitude) * math.sin(Angle), 0.0, (Radius + Altitude) * math.cos(Angle))
                Queries.append(Query(4, Position, Footprint=1.0))
        Density = Integration.Inspect(View, Queries)[:, 0].reshape(Height, Width)
        Arrays[Name] = Density
        Intensity = Np.clip(Np.sqrt(Density / max(float(Density.max()), 1.0e-9)), 0.0, 1.0)
        Color = Np.stack((0.13 + 0.85 * Intensity, 0.20 + 0.78 * Intensity, 0.30 + 0.68 * Intensity), axis=-1)
        Canvas.paste(Image.fromarray(Np.rint(Color * 255).astype(Np.uint8)), (Index * Width, 50))
        Pen.text((Index * Width + 12, 10), Name + " - actual radial extinction section", fill="white")
        Pen.text((Index * Width + 12, 30), "16 km top / 0 km bottom; y=0; no image-height inference", fill="#c3cfdd")
        Pen.text((Index * Width + 12, 240), f"x = +/-{Extent / 1000:g} km; sqrt display; max {Density.max():.6f}/m", fill="white")
        Report.append({"view": Name, "extent_m": [-Extent, Extent, 0, 16000], "density_queries": len(Queries),
                       "max_extinction_per_m": float(Density.max()), "display": "square root normalized to measured maximum"})
    Canvas.save(Images / "DensitySections.png", optimize=True)
    Np.savez_compressed(Results / "DensitySections.npz", **Arrays)
    return Report


def MeasureReceivers(Integration, Results, Images):
    Width = 128
    Extent = 24000.0
    Axis = Np.linspace(-Extent, Extent, Width)
    Queries = []
    for Y in Axis[::-1]:
        for X in Axis:
            Normal = Np.array((X, Y, Radius))
            Normal /= Np.linalg.norm(Normal)
            Queries.append(Query(5, Normal * (Radius + 2.0), Footprint=1.0))
    View = Clouds.Views["cumulus"]
    Normals = Np.asarray(Queries, dtype=Np.float32)[:, :3].astype(Np.float64)
    Normals /= Np.linalg.norm(Normals, axis=1)[:, None]
    Cosine = Np.maximum(Normals @ Np.asarray(Clouds.Direction(*View.Sun)), 0.0).reshape(Width, Width, 1)
    Arrays = {}
    Report = []
    Canvas = Image.new("RGB", (Width * 3, Width + 40), "#111b29")
    Pen = ImageDraw.Draw(Canvas)
    for Index, (Name, Modified) in enumerate((("Wind0", View), ("Wind90", replace(View, Time=90.0)),
                                              ("NoCloudShadow", replace(View, Shadows=0)))):
        Actual = Integration.Inspect(Modified, Queries, LightSteps=64).reshape(Width, Width, 4)
        Shadow = Np.exp(-Actual[..., 3:4])
        # This is a receiver-normal grid, not a primary camera image. Lambert albedo and ambient are explicit.
        Radiance = 0.4 * View.Solar / math.pi * (Actual[..., :3] * Shadow * Cosine + 0.008)
        Canvas.paste(Image.fromarray(Clouds.EncodeDisplay(Radiance, 0.68)), (Index * Width, 30))
        Pen.text((Index * Width + 5, 10), Name, fill="white")
        Arrays[Name] = Actual
        Report.append({"name": Name, "world_receiver_queries": len(Queries), "mean_transmittance": float(Shadow.mean()),
                       "radiance_sha256": sha256(Radiance.tobytes()).hexdigest()})
    Canvas.save(Images / "CloudShadowReceivers.png", optimize=True)
    Np.savez_compressed(Results / "CloudShadowReceivers.npz", **Arrays)
    return {"projection": "normal grid on curved ground, not a camera capture", "extent_m": [-Extent, Extent], "cases": Report}


# ------------------------------------------------------------------------------------------------------------------------
#                                                   STATELESS WIND SEQUENCE
# ------------------------------------------------------------------------------------------------------------------------


def CaptureMotion(Integration, Results, Images):
    Reports = []
    Pictures = []
    for Seconds in (0, 30, 60, 90, 120, 150):
        View = replace(Clouds.Views["cumulus"], Name=f"Wind{Seconds:03d}", Time=float(Seconds))
        Pixels, Report = RetainCapture(Integration, View, Images / View.Name, Width=384, Height=216,
                                       Steps=256, LightSteps=24, Samples=2)
        Pictures.append(Image.fromarray(Clouds.EncodeDisplay(Pixels, View.Exposure)))
        Reports.append(Report)
    Pictures[0].save(Images / "Wind.gif", save_all=True, append_images=Pictures[1:], duration=600, loop=0,
                     optimize=False, disposal=2)
    return {"time_step_seconds": 30, "gif_picture_duration_ms": 600, "interpolation": False,
            "gif_note": "timelapse with palette quantization, not real-time performance or Float32 evidence", "captures": Reports}


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--slang", type=Path, default=Clouds.Root / "ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc")
    Parser.add_argument("--library", type=Path)
    Parser.add_argument("--noise", type=Path)
    Parser.add_argument("--out", type=Path, default=Clouds.Root / "_ClaudeScratch/tmp/CloudMeasurements")
    Parser.add_argument("--motion", action="store_true")
    Parser.add_argument("--skip-sampling", action="store_true")
    Arguments = Parser.parse_args()
    if bool(Arguments.library) != bool(Arguments.noise):
        Parser.error("--library and --noise must be provided together")
    if Arguments.library:
        Library, Noise = Arguments.library.resolve(), Arguments.noise.resolve()
    else:
        Library, Noise, Identity = Clouds.CompileNative(Arguments.slang)
    Integration = Clouds.NativeIntegration(Library, Noise)
    Results, Images = Arguments.out / "Results", Arguments.out / "Images"
    Results.mkdir(parents=True, exist_ok=True)
    Images.mkdir(parents=True, exist_ok=True)
    Report = {"source_sha256": Integration.SourceIdentity, "library_sha256": Integration.LibraryIdentity,
              "execution": "actual Slang native C++ target", "photorealism_accepted": False,
              "production_accepted": False, "measurements_completed": False}
    try:
        if not Arguments.skip_sampling:
            Report["sampling"] = MeasureSampling(Integration, Results, Images)
        Report["orbital_coherence"] = MeasureOrbitalCoherence(Integration)
        Report["density_sections"] = MeasureSections(Integration, Results, Images)
        Report["receiver_illumination"] = MeasureReceivers(Integration, Results, Images)
        if Arguments.motion:
            Report["motion"] = CaptureMotion(Integration, Results, Images)
        Report["measurements_completed"] = True
    except BaseException as Failure:
        Report["failure"] = str(Failure)
        raise
    finally:
        (Results / "CloudMeasurements.json").write_text(json.dumps(Report, indent=2) + "\n")


if __name__ == "__main__":
    Main()
