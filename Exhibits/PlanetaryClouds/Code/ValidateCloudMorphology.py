#!/usr/bin/env python3
# ============================================================================================================================================
#                                                        VALIDATECLOUDMORPHOLOGY.PY
# ============================================================================================================================================
# 🧩 Reproduce texture repetition and fragmented silhouettes using authenticated before/after Slang execution and matched captures.

import argparse
from dataclasses import asdict
import gzip
from hashlib import sha256
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory

import numpy as Np
from PIL import Image, ImageDraw

import RenderClouds as Clouds
from MeasureClouds import RetainCapture

CaptureSpecifications = (("cirrocumulus", 256, 144, 160, 12, 1),
                         ("cumulonimbus", 512, 288, 384, 32, 2),
                         ("cyclone", 480, 270, 384, 32, 2))
RadiusM = 6371000.0


def QueryDensity(Integration, View, Positions, FootprintM):
    Queries = Np.zeros((len(Positions), 16), dtype="<f4")
    Queries[:, :3], Queries[:, 3], Queries[:, 6], Queries[:, 7] = Positions, 4, 1, FootprintM
    return Integration.Inspect(View, Queries)[:, 0]


def MeasureRepeat(Integration):
    View = Clouds.Views["cirrocumulus"]
    Coordinates = Np.random.default_rng(8429).uniform(-9000, 9000, (512, 2))
    ShiftM = 7200 * View.Scale * Np.array((0.8, -0.6))
    Horizontal = Np.concatenate([Coordinates + Multiple * ShiftM for Multiple in (0, 1, 2)])
    Vertical = Np.sqrt((RadiusM + View.Floor + View.Depth * 0.36) ** 2 - Np.sum(Horizontal ** 2, axis=1))
    Positions = Np.column_stack((Horizontal, Vertical))
    return QueryDensity(Integration, View, Positions, 24).reshape(3, 512)


def MeasureCrossingHeights(Integration):
    DistanceM = Np.linspace(45000, 160000, 256)
    AzimuthRad = Np.array((0.27, 1.73, 3.21, 4.91))
    AngleRad = Np.tile(DistanceM / RadiusM, len(AzimuthRad))
    AzimuthRad = Np.repeat(AzimuthRad, len(DistanceM))
    Normals = Np.column_stack((Np.sin(AngleRad) * Np.cos(AzimuthRad),
                               Np.sin(AngleRad) * Np.sin(AzimuthRad), Np.cos(AngleRad)))
    HeightsM = Np.linspace(1000, Clouds.Views["cyclone"].Floor + Clouds.Views["cyclone"].Depth + 20, 128)
    Positions = (Normals[:, None, :] * (RadiusM + HeightsM)[None, :, None]).reshape(-1, 3)
    Density = QueryDensity(Integration, Clouds.Views["cyclone"], Positions, 1800).reshape(-1, len(HeightsM))
    Crossings = Np.where(Density > 0.0005, Np.arange(len(HeightsM)), -1).max(axis=1)
    assert (Crossings >= 0).all() and (Crossings < len(HeightsM) - 1).all(), "resolved cloud tops must be bracketed"
    LowM, HighM = HeightsM[Crossings], HeightsM[Crossings + 1]
    for Index in range(10):
        MidpointM = (LowM + HighM) * 0.5
        Occupied = QueryDensity(Integration, Clouds.Views["cyclone"], Normals * (RadiusM + MidpointM)[:, None], 1800) > 0.0005
        LowM, HighM = Np.where(Occupied, MidpointM, LowM), Np.where(Occupied, HighM, MidpointM)
    return ((LowM + HighM) * 0.5).astype("<f4").reshape(4, 256)


def CountConnectedRegions(Mask, InteriorOnly=False):
    Height, Width = Mask.shape
    Visited = Np.zeros_like(Mask)
    Sizes = []
    for Row, Column in Np.argwhere(Mask):
        if Visited[Row, Column]:
            continue
        Pending = [(Row, Column)]
        Visited[Row, Column] = True
        Count, BoundaryContact = 0, False
        while Pending:
            Y, X = Pending.pop()
            Count += 1
            BoundaryContact |= Y in (0, Height - 1) or X in (0, Width - 1)
            for NextY, NextX in ((Y - 1, X), (Y + 1, X), (Y, X - 1), (Y, X + 1)):
                if 0 <= NextY < Height and 0 <= NextX < Width and Mask[NextY, NextX] and not Visited[NextY, NextX]:
                    Visited[NextY, NextX] = True
                    Pending.append((NextY, NextX))
        if not InteriorOnly or not BoundaryContact:
            Sizes.append(Count)
    return {"regions": len(Sizes), "regions_at_most_four_pixels": sum(Count <= 4 for Count in Sizes),
            "occupied_pixels": sum(Sizes)}


def ValidateConnectivity():
    Mask = Np.zeros((7, 7), dtype=bool)
    Mask[1, 1], Mask[2, 2], Mask[4:6, 4:6] = True, True, True
    assert CountConnectedRegions(Mask) == {"regions": 3, "regions_at_most_four_pixels": 3, "occupied_pixels": 6}
    Mask = Np.ones((7, 7), dtype=bool)
    Mask[0, :], Mask[3, 3] = False, False
    assert CountConnectedRegions(~Mask, True) == {"regions": 1, "regions_at_most_four_pixels": 1, "occupied_pixels": 1}


def UnpackSupport(Arrays, Name, Revision):
    Width, Height = next((Width, Height) for Selection, Width, Height, *Budget in CaptureSpecifications
                         if Clouds.Views[Selection].Name == Name)
    return Np.unpackbits(Arrays[Name + Revision + "Support"], count=Width * Height).reshape(Height, Width).astype(bool)


def EvaluateStatistics(Arrays):
    Statistics = {}
    for Revision in ("Before", "After"):
        Repeat = Arrays["Repeat" + Revision]
        CrossingM = Arrays["CycloneCrossing" + Revision].astype(Np.float64)
        Statistics[Revision] = {
            "repeat_correlations": [float(Np.corrcoef(Repeat[0], Repeat[Multiple])[0, 1]) for Multiple in (1, 2)],
            "repeat_mean_extinction_per_m": float(Repeat[0].mean()),
            "cyclone_crossing_mean_m": float(CrossingM.mean()),
            "cyclone_crossing_relief_m": float(Np.ptp(CrossingM)),
            "cyclone_crossing_second_difference_rms_m": float(Np.sqrt(Np.mean(Np.diff(CrossingM, n=2, axis=1) ** 2)))}
        for Name in ("Cumulonimbus", "CycloneOrbit"):
            Support = UnpackSupport(Arrays, Name, Revision)
            Statistics[Revision][Name] = {"cloud": CountConnectedRegions(Support),
                                          "enclosed_clear": CountConnectedRegions(~Support, True)}
    return Statistics


def ValidateStatistics(Statistics):
    Before, After = Statistics["Before"], Statistics["After"]
    assert min(Before["repeat_correlations"]) > 0.95, "baseline repetition not reproduced"
    assert max(abs(Correlation) for Correlation in After["repeat_correlations"]) < 0.15, "cirrocumulus texture-period repetition"
    assert 0.7 < After["repeat_mean_extinction_per_m"] / Before["repeat_mean_extinction_per_m"] < 1.4, "de-tiling erased the cloud field"
    assert After["cyclone_crossing_second_difference_rms_m"] < 0.85 * Before["cyclone_crossing_second_difference_rms_m"], "cyclone small-scale top roughness"
    assert After["cyclone_crossing_relief_m"] > 3000, "cyclone was flattened to remove roughness"
    assert abs(After["cyclone_crossing_mean_m"] - Before["cyclone_crossing_mean_m"]) < 1500, "cyclone height shifted excessively"
    for Name in ("Cumulonimbus", "CycloneOrbit"):
        Original, Corrected = Before[Name]["cloud"], After[Name]["cloud"]
        assert Corrected["regions_at_most_four_pixels"] < 0.35 * Original["regions_at_most_four_pixels"], Name + " detached pixel fragments"
        assert 0.75 < Corrected["occupied_pixels"] / Original["occupied_pixels"] < 1.25, Name + " changed coverage excessively"
    assert After["CycloneOrbit"]["enclosed_clear"]["regions_at_most_four_pixels"] < 0.35 * Before["CycloneOrbit"]["enclosed_clear"]["regions_at_most_four_pixels"], "cyclone tiny canopy perforations"


def ReadCapture(Directory, Integration, Specification):
    Selection, Width, Height, Steps, LightSteps, Samples = Specification
    Name = Clouds.Views[Selection].Name
    Report = json.loads((Directory / (Name + ".json")).read_text())
    assert Report["source_sha256"] == Integration.SourceIdentity and Report["library_sha256"] == Integration.LibraryIdentity
    assert Report["noise_sha256"] == Integration.NoiseIdentity
    assert Report["view"] == json.loads(json.dumps(asdict(Clouds.Views[Selection])))
    assert [Report[Key] for Key in ("width", "height", "steps", "light_steps", "samples")] == list(Specification[1:])
    with Np.load(Directory / (Name + ".npz"), allow_pickle=False) as Archive:
        Pixels = Archive["Rgba"]
    assert sha256(Pixels.tobytes()).hexdigest() == Report["float_sha256"]
    Picture = Directory / (Name + ".png")
    assert sha256(Picture.read_bytes()).hexdigest() == Report["png_sha256"]
    assert Np.array_equal(Clouds.EncodeDisplay(Pixels, Clouds.Views[Selection].Exposure), Np.asarray(Image.open(Picture)))
    return Pixels, Report


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--library", type=Path, required=True)
    Parser.add_argument("--noise", type=Path, required=True)
    Parser.add_argument("--before-library", type=Path)
    Parser.add_argument("--before-captures", type=Path)
    Parser.add_argument("--reference-gallery", type=Path)
    Parser.add_argument("--after-captures", type=Path, required=True)
    Parser.add_argument("--slang", type=Path, default=Clouds.Root / "ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc")
    Parser.add_argument("--out", type=Path, default=Clouds.Root / "_ClaudeScratch/tmp/CloudMorphology")
    Arguments = Parser.parse_args()
    ValidateConnectivity()
    Arguments.out.mkdir(parents=True, exist_ok=True)
    Native = Clouds.NativeIntegration(Arguments.library.resolve(), Arguments.noise.resolve())
    Baseline = Path(__file__).with_name("CloudDensityBefore.slang.gz")
    OriginalSource, OriginalQuery = Clouds.Source, Clouds.QuerySourceIdentity
    try:
        with TemporaryDirectory(dir=Clouds.Root / "_ClaudeScratch/tmp") as Temporary:
            Source = Path(Temporary) / "Source"
            shutil.copytree(OriginalSource, Source, ignore=shutil.ignore_patterns("__pycache__"))
            (Source / "CloudDensity.slang").write_bytes(gzip.decompress(Baseline.read_bytes()))
            Paths = sorted(Source.glob("*.slang")) + [Source / "CloudNative.cpp", Source / "CloudNoiseVolume.h",
                                                       Path(__file__).with_name("BakeCloudNoise.cpp")]
            BeforeIdentity = sha256(b"".join(PathName.read_bytes() for PathName in Paths)).hexdigest()
            Clouds.Source, Clouds.QuerySourceIdentity = Source, lambda: BeforeIdentity
            BeforeLibrary = Arguments.before_library
            if BeforeLibrary is None:
                BeforeLibrary, IgnoredNoise, IgnoredIdentity = Clouds.CompileNative(Arguments.slang)
            Control = Clouds.NativeIntegration(BeforeLibrary.resolve(), Arguments.noise.resolve())
    finally:
        Clouds.Source, Clouds.QuerySourceIdentity = OriginalSource, OriginalQuery
    BeforeCaptures = Arguments.before_captures or Arguments.out / "Before"
    BeforeCaptures.mkdir(parents=True, exist_ok=True)
    Arrays, Captures = {}, {}
    Canvas = Image.new("RGB", (1060, 890), "#101b29")
    Pen = ImageDraw.Draw(Canvas)
    Pen.text((18, 12), "CLOUD MORPHOLOGY / actual Slang-C++ captures", fill="white")
    Pen.text((18, 33), "BEFORE", fill="#b0c1d5")
    Pen.text((548, 33), "AFTER / same camera, lighting, exposure and sampling", fill="#b0c1d5")
    Top = 56
    for Specification in CaptureSpecifications:
        Selection, Width, Height, Steps, LightSteps, Samples = Specification
        Name = Clouds.Views[Selection].Name
        if Arguments.before_captures is None:
            RetainCapture(Control, Clouds.Views[Selection], BeforeCaptures / Name, Width, Height, Steps, LightSteps, Samples)
        Captures[Name] = {}
        Pen.text((18, Top), f"{Name} / {Width} x {Height} native pixels", fill="white")
        for Revision, Directory, Integration, Left in (("Before", BeforeCaptures, Control, 18),
                                                       ("After", Arguments.after_captures, Native, 548)):
            Pixels, Capture = ReadCapture(Directory, Integration, Specification)
            Canvas.paste(Image.open(Directory / (Name + ".png")), (Left + (512 - Width) // 2, Top + 20))
            Captures[Name][Revision] = Capture
            if Name != "Cirrocumulus":
                Arrays[Name + Revision + "Support"] = Np.packbits(Pixels[..., 3] < 0.9)
        Top += Height + 36
    Pen.text((18, 867), "No image blur, denoising or colour history. JPEG comparison only; exact current PNGs remain in the gallery.", fill="#b0c1d5")
    for Revision, Integration in (("Before", Control), ("After", Native)):
        Arrays["Repeat" + Revision] = MeasureRepeat(Integration)
        Arrays["CycloneCrossing" + Revision] = MeasureCrossingHeights(Integration)
    Statistics = EvaluateStatistics(Arrays)
    ValidateStatistics(Statistics)
    Preserved = []
    if Arguments.reference_gallery:
        Reference = json.loads((Arguments.reference_gallery / "Captures.json").read_text())
        assert Reference["source_sha256"] == BeforeIdentity
        for Capture in Reference["captures"]:
            if Capture["view"]["Formation"] in (8, 10, 11):
                continue
            Name = Capture["view"]["Name"]
            Current = json.loads((Arguments.after_captures / (Name + ".json")).read_text())
            assert Current["source_sha256"] == Native.SourceIdentity and Current["library_sha256"] == Native.LibraryIdentity
            assert Capture["library_sha256"] == Control.LibraryIdentity
            assert all(Current[Key] == Capture[Key] for Key in ("view", "width", "height", "steps", "light_steps", "samples"))
            for Directory, Description in ((Arguments.reference_gallery, Capture), (Arguments.after_captures, Current)):
                with Np.load(Directory / (Name + ".npz"), allow_pickle=False) as Archive:
                    assert sha256(Archive["Rgba"].tobytes()).hexdigest() == Capture["float_sha256"] == Description["float_sha256"]
                assert sha256((Directory / (Name + ".png")).read_bytes()).hexdigest() == Capture["png_sha256"] == Description["png_sha256"]
            Preserved.append({"name": Name, "float_sha256": Capture["float_sha256"], "png_sha256": Capture["png_sha256"]})
        assert len(Preserved) == 17, "unchanged gallery inventory"
    Canvas.save(Arguments.out / "Morphology.jpg", quality=72, optimize=True)
    Np.savez_compressed(Arguments.out / "Morphology.npz", **Arrays)
    Report = {"source_sha256": Native.SourceIdentity, "baseline_source_sha256": BeforeIdentity,
              "baseline_density_archive_sha256": sha256(Baseline.read_bytes()).hexdigest(),
              "baseline_reconstruction": "current numerical sources with only CloudDensity.slang replaced by the retained gzip source",
              "library_sha256": Native.LibraryIdentity, "baseline_library_sha256": Control.LibraryIdentity,
              "noise_sha256": Native.NoiseIdentity, "tests_passed": True, "statistics": Statistics, "captures": Captures,
              "unchanged_gallery_captures": Preserved,
              "repeat_fixture": "512 seeded points; 24 m footprint; shifts of one/two 3024 m shape periods at constant radial altitude",
              "crossing_fixture": "4 geodesic transects, 256 positions each, 45-160 km; 128 altitude samples 1-14.92 km then 10 bisections of highest resolved 0.0005/m crossing; 1800 m footprint",
              "support_fixture": "cloud transmittance below 0.9; four-connected native pixels; tiny means at most four pixels",
              "scope": "fixed-fixture repetition, silhouette fragmentation and resolved top roughness; not photographic acceptance or global weather topology",
              "comparison_sha256": sha256((Arguments.out / "Morphology.jpg").read_bytes()).hexdigest(),
              "photorealism_accepted": False, "production_accepted": False}
    (Arguments.out / "Morphology.json").write_text(json.dumps(Report, indent=2) + "\n")
    print(json.dumps(Statistics, indent=2), flush=True)


if __name__ == "__main__":
    Main()
