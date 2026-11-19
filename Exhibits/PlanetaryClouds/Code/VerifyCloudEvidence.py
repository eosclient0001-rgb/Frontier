#!/usr/bin/env python3
# ============================================================================================================================================
#                                                         VERIFYCLOUDEVIDENCE.PY
# ============================================================================================================================================
# 🧩 Independently correlate retained Float32 probes, native PNG samples, readback statistics, source identities and file inventories.

import argparse
from dataclasses import asdict, replace
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
from tempfile import TemporaryDirectory

import numpy as Np
from PIL import Image

import CaptureCloudExhibit as CaptureSequence
import RenderClouds as Clouds
import ValidateCloudMorphology as Morphology

Directory = Path(__file__).resolve().parents[1]
Results = Directory / "Results"
GateCount = 0


def Enforce(Condition, Description):
    global GateCount
    GateCount += 1
    if not bool(Np.all(Condition)):
        raise AssertionError(Description)


def ReadJson(Name):
    return json.loads((Results / Name).read_text())


def Identity(PathName):
    return sha256(PathName.read_bytes()).hexdigest()


# ------------------------------------------------------------------------------------------------------------------------
#                                                     NATIVE PIXEL CORRELATION
# ------------------------------------------------------------------------------------------------------------------------


def VerifyCaptures(Generated):
    Manifest, Layout = ReadJson("Captures.json"), ReadJson("ProbeLayout.json")
    Specifications = {}
    for Name, Width, Height, Steps, LightSteps, Samples in CaptureSequence.Captures + tuple(
            (Name, 256, 144, 160, 12, 1) for Name in CaptureSequence.FormationViews):
        View = Clouds.Views[Name]
        Specifications[View.Name] = (View, Width, Height, Steps, LightSteps, Samples)
    for Seconds in (0, 30, 60, 90, 120, 150):
        View = replace(Clouds.Views["cumulus"], Name=f"Wind{Seconds:03d}", Time=float(Seconds))
        Specifications[View.Name] = (View, 320, 180, 256, 24, 2)
    Names = [Capture["view"]["Name"] for Capture in Manifest["captures"]]
    Enforce(len(Names) == len(set(Names)) == 22 and set(Names) == set(Specifications), "capture inventory")
    PixelCount = 0
    with Np.load(Results / "RadianceProbes.npz", allow_pickle=False) as Archive:
        Enforce(set(Archive.files) == set(Names) == set(Layout), "radiance archive inventory")
        for Capture in Manifest["captures"]:
            Name = Capture["view"]["Name"]
            View, Width, Height, Steps, LightSteps, Samples = Specifications[Name]
            Enforce(Capture["view"] == json.loads(json.dumps(asdict(View))), Name + " exact authored inputs")
            Enforce([Capture[Key] for Key in ("width", "height", "steps", "light_steps", "samples")] ==
                    [Width, Height, Steps, LightSteps, Samples], Name + " native budgets")
            Enforce(Capture["temporal_history"] is False and Capture["production_accepted"] is False, Name + " scope")
            Enforce(Capture["source_sha256"] == Manifest["source_sha256"], Name + " source")
            Enforce(Capture["library_sha256"] == ReadJson("NativeValidation.json")["library_sha256"], Name + " library")
            Picture = Directory / "Images" / (Name + ".png")
            Enforce(Identity(Picture) == Capture["png_sha256"], Name + " PNG identity")
            with Image.open(Picture) as Encoded:
                Enforce(Encoded.mode == "RGB" and Encoded.size == (Width, Height), Name + " PNG extent and format")
                Encoded = Np.asarray(Encoded)
            Probe = Archive[Name]
            Enforce(Probe.dtype == Np.dtype("<f4") and Probe.shape == ((Height + 15) // 16, (Width + 15) // 16, 4),
                    Name + " Float32 layout")
            Enforce(Np.isfinite(Probe) & (Probe >= 0), Name + " finite radiance")
            Enforce(Probe[..., 3] <= 1, Name + " transmittance")
            Enforce(sha256(Probe.tobytes()).hexdigest() == Layout[Name]["float_probe_sha256"], Name + " probe identity")
            Enforce(Layout[Name]["native_extent"] == [Width, Height] and Layout[Name]["pixel_stride"] == [16, 16] and
                    Layout[Name]["first_pixel"] == [0, 0], Name + " probe addressing")
            Enforce(Clouds.EncodeDisplay(Probe, View.Exposure) == Encoded[::16, ::16], Name + " exact PNG sample decoding")
            PixelCount += Probe.shape[0] * Probe.shape[1]
            if Generated:
                with Np.load(Generated / (Name + ".npz"), allow_pickle=False) as Full:
                    Pixels = Full["Rgba"]
                Enforce(sha256(Pixels.tobytes()).hexdigest() == Capture["float_sha256"], Name + " complete generated Float32")
                Enforce(Pixels[::16, ::16] == Probe, Name + " retained subset")
                Enforce(Clouds.EncodeDisplay(Pixels, View.Exposure) == Encoded, Name + " complete PNG conversion")
    return PixelCount


# ------------------------------------------------------------------------------------------------------------------------
#                                               SOFTWARE-VULKAN AND REJECTED CONTROL
# ------------------------------------------------------------------------------------------------------------------------


def VerifyVulkan(Native):
    Report = ReadJson("VulkanClouds.json")
    QueryCount = 0
    Enforce(Report["tests_passed"] and not Report["full_beauty_entry_executed"] and not Report["images"], "query-only scope")
    Cases = {(0, 4), (11, 4), (6, 4), (10, 4), (8, 4), (0, 8), (0, 9), (0, 3), (0, 10), (0, 5)}
    Enforce(len(Report["queries"]) == len(Cases) and
            {(Case["formation"], Case["selection"]) for Case in Report["queries"]} == Cases, "Vulkan diagnostic inventory")
    with Np.load(Results / "VulkanProbes.npz", allow_pickle=False) as Archive:
        Enforce(len(Archive.files) == len(Report["queries"]) * 3, "Vulkan archive inventory")
        for Case in Report["queries"]:
            Formation, Selection, Count = (Case[Key] for Key in ("formation", "selection", "queries"))
            Prefix = f"Formation{Formation}Query{Selection}"
            Queries, Expected, Actual = (Archive[Prefix + Suffix] for Suffix in ("Inputs", "Native", "Vulkan"))
            Enforce(Queries.shape == (Count, 16) and Expected.shape == Actual.shape == (Count, 4), Prefix + " extents")
            Enforce(all(Array.dtype == Np.dtype("<f4") for Array in (Queries, Expected, Actual)), Prefix + " Float32")
            Enforce(Np.isfinite(Queries).all() and Np.isfinite(Expected).all() and Np.isfinite(Actual).all(), Prefix + " finite")
            Enforce(sha256(Actual.tobytes()).hexdigest() == Case["float_sha256"], Prefix + " exact Vulkan readback")
            Difference = Np.abs(Actual - Expected)
            Enforce(Difference.max(axis=0).tolist() == Case["max_abs_by_channel"], Prefix + " measured maximum")
            Enforce(Difference.mean(axis=0).tolist() == Case["mean_abs_by_channel"], Prefix + " measured mean")
            if Selection == 4:
                Enforce(Difference.max(axis=0) < Np.array((0.00012, 0.00012, 0.00001, 4)), Prefix + " density tolerances")
                Enforce(Actual[:, 0] == Actual[:, 1], Prefix + " view/light density identity")
                Enforce(Np.count_nonzero(Actual[:, 0]) > 0, Prefix + " occupied volume")
            elif Selection == 5:
                Enforce(Difference.max(axis=0) < Np.array((0.0001, 0.0001, 0.0001, 0.02)), Prefix + " solar depth tolerance")
                Enforce((Actual[:, 3] >= 0) & (Actual[:, 3] <= 18), Prefix + " solar depth bounds")
            elif Selection in (8, 9):
                Enforce(Difference.max() < 0.00008, Prefix + " 3D mip interpolation")
            elif Selection == 10:
                Enforce(Difference.max() < 0.000001 and Np.abs(Actual[:, 2] - 1).max() < 0.000001, Prefix + " angular accuracy")
            else:
                Enforce(Difference.max() < 3 and Np.abs(Actual[:, 3]).max() <= 1.5, Prefix + " tangent wind")
            Enforce(Count == (1024 if Selection == 4 else 256) and Case["view_steps"] == 96 and
                    Case["light_steps"] == (32 if Selection == 5 else 12) and
                    Case["time_seconds"] == (1200 if Selection in (3, 8, 9, 10) else 0), Prefix + " exact query inputs")
            if Native:
                View = next(View for View in Clouds.Views.values() if View.Formation == Formation)
                View = replace(View, Time=Case["time_seconds"])
                Enforce(Native.Inspect(View, Queries, Steps=Case["view_steps"], LightSteps=Case["light_steps"]) == Expected,
                        Prefix + " fresh native replay")
            QueryCount += Count
    Enforce(QueryCount == 6400, "Vulkan query count")
    return QueryCount


def VerifyVulkanBeauty(Native):
    Report = ReadJson("VulkanBeauty.json")
    Enforce(Report["tests_passed"] and Report["full_beauty_entry_executed"] and Report["guarded_buffer_tails"] and
            not Report["queries"] and len(Report["images"]) == 1, "Vulkan beauty limited execution scope")
    Enforce(Report["library_sha256"] == ReadJson("NativeValidation.json")["library_sha256"] and
            Report["noise_sha256"] == ReadJson("Captures.json")["noise_sha256"], "Vulkan beauty input identities")
    Case = Report["images"][0]
    View = Clouds.Views["cumulus"]
    Enforce(Case["view"] == "cumulus" and Case["view_specification"] == json.loads(json.dumps(asdict(View))) and
            [Case[Key] for Key in ("width", "height", "steps", "light_steps", "samples")] == [64, 36, 96, 8, 1],
            "Vulkan beauty exact fixture inputs")
    with Np.load(Results / "VulkanBeauty.npz", allow_pickle=False) as Archive:
        Enforce(set(Archive.files) == {"cumulusNative", "cumulusVulkan"}, "Vulkan beauty archive inventory")
        Expected, Actual = Archive["cumulusNative"], Archive["cumulusVulkan"]
        Enforce(all(Array.shape == (36, 64, 4) and Array.dtype == Np.dtype("<f4") and Np.isfinite(Array).all() and
                    (Array >= 0).all() and (Array[..., 3] <= 1).all() for Array in (Expected, Actual)), "Vulkan beauty Float32 bounds")
        Enforce(sha256(Expected.tobytes()).hexdigest() == Case["native_float_sha256"] and
                sha256(Actual.tobytes()).hexdigest() == Case["float_sha256"], "Vulkan beauty full-array identities")
        Difference = Np.abs(Actual - Expected)
        Maximum = float(Difference.max())
        RgbRmse = float(Np.sqrt(Np.mean(Difference[..., :3] ** 2)))
        Enforce(Maximum == Case["max_abs"] and RgbRmse == Case["rgb_rmse"], "Vulkan beauty recomputed errors")
        Enforce(Case["max_abs_tolerance"] == 0.002 and Case["rgb_rmse_tolerance"] == 0.0001 and
                Maximum < 0.002 and RgbRmse < 0.0001, "Vulkan beauty complete-image tolerances")
        Picture = Directory / "Images/VulkanCumulus.png"
        Enforce(Identity(Picture) == Case["png_sha256"], "Vulkan beauty PNG identity")
        with Image.open(Picture) as Encoded:
            Enforce(Encoded.mode == "RGB" and Encoded.size == (64, 36), "Vulkan beauty PNG extent")
            Enforce(Clouds.EncodeDisplay(Actual, View.Exposure) == Np.asarray(Encoded), "Vulkan beauty complete display conversion")
        if Native:
            Enforce(Native.Capture(View, 64, 36, 96, 8) == Expected, "Vulkan beauty fresh native image replay")
    return 64 * 36


def VerifyWind(Native):
    Report = ReadJson("WindPrecision.json")
    Enforce(Identity(Path(__file__).with_name("RejectedWind.slang")) == Report["original_source_sha256"], "rejected source identity")
    Enforce(Report["tests_passed"] and Report["software_defect_reproduced"], "rejected defect reproduced")
    Before, After = [], []
    with Np.load(Results / "WindPrecision.npz", allow_pickle=False) as Archive:
        Queries = Archive["Queries"]
        for Index, (Shear, Veer) in enumerate(((0, 0), (0.1, 0), (0, 0.1), (0.1, 0.1))):
            Expected = Archive["Native" + str(Index)]
            for Name, Maxima in (("Original", Before), ("Repaired", After)):
                Actual = Archive[Name + str(Index)]
                Case = next(Case for Case in Report["cases"] if Case["selection"] == Name and
                            Case["shear"] == Shear and Case["veer"] == Veer)
                Difference = Np.abs(Actual - Expected)
                Maximum = float(Np.abs(Actual[:, 3]).max())
                Enforce(Difference.max(axis=0).tolist() == Case["max_abs_native_difference_by_channel"], Name + " native difference")
                Enforce(Maximum == Case["max_abs_radial_displacement_m"], Name + " radial displacement")
                Maxima.append(Maximum)
                if Name == "Repaired":
                    Enforce(Difference.max() < 3 and Maximum <= 1.5, "repaired wind limits")
            if Native:
                View = replace(Clouds.Views["cumulus"], Time=1200, Shear=Shear, Veer=Veer)
                Enforce(Native.Inspect(View, Queries) == Expected, "wind fresh native replay")
    Enforce(max(Before) == Report["before_max_radial_m"] and max(After) == Report["after_max_radial_m"], "before/after maxima")
    return 4 * len(Queries)


# ------------------------------------------------------------------------------------------------------------------------
#                                              ACTUAL SOLAR / WORLD-DENSITY AGREEMENT
# ------------------------------------------------------------------------------------------------------------------------


def VerifySolarDensity(Native):
    from ValidateSolarDensity import SolarDensityMeasurement
    Report = ReadJson("SolarDensity.json")
    Fragment = Path(__file__).with_name("RejectedSolarWeather.slang")
    Enforce(Report["tests_passed"] and Identity(Fragment) == Report["control_fragment_sha256"], "solar rejected fragment identity")
    Transport = Clouds.Source / "CloudTransport.slang"
    Text = Transport.read_text()
    Near, Far = Text.index("float IntegrateCloudSolarDepth("), Text.index("float CloudSolarOpticalDepth(")
    Rejected = (Text[:Near] + Fragment.read_text() + "\n" + Text[Far:]).encode("utf-8")
    Paths = sorted(Clouds.Source.glob("*.slang")) + [Clouds.Source / "CloudNative.cpp", Clouds.Source / "CloudNoiseVolume.h",
                                                   Path(__file__).with_name("BakeCloudNoise.cpp")]
    ControlIdentity = sha256(b"".join(Rejected if PathName == Transport else PathName.read_bytes() for PathName in Paths)).hexdigest()
    Enforce(ControlIdentity == Report["control_source_sha256"], "solar isolated rejected source identity")
    Enforce(Report["library_sha256"] == ReadJson("NativeValidation.json")["library_sha256"] and
            Report["noise_sha256"] == ReadJson("Captures.json")["noise_sha256"], "solar tested input identities")
    Layout = {"Positions": (256, 3), "Spans": (256, 4), "PointDensity": (256, 32), "SegmentM": (256, 32),
              "Expected": (256,), "Actual": (256,), "Rejected": (256,)}
    with Np.load(Results / "SolarDensity.npz", allow_pickle=False) as Archive:
        Enforce(set(Archive.files) == set(Layout), "solar archive inventory")
        for Name, Extent in Layout.items():
            Enforce(Archive[Name].shape == Extent and Archive[Name].dtype == Np.dtype("<f4") and
                    Np.isfinite(Archive[Name]).all(), Name + " solar Float32 extent")
        Enforce((Archive["PointDensity"] >= 0).all() and (Archive["SegmentM"] > 0).all() and
                Np.count_nonzero(Archive["PointDensity"]) > 0, "solar nonempty reference segments")
        Expected = Np.minimum(Np.float32(18), Np.sum(Archive["PointDensity"] * Archive["SegmentM"], axis=1, dtype=Np.float32))
        Enforce(Expected == Archive["Expected"], "solar independent density integral")
        for Name, Category in (("Actual", "corrected"), ("Rejected", "rejected")):
            Case = Report[Category]
            Difference = Np.abs(Archive[Name] - Expected)
            Enforce((Archive[Name] >= 0) & (Archive[Name] <= 18), Name + " optical depth bounds")
            Enforce(Case["world_receivers"] == 256 and Case["steps"] == 32 and Case["density_point_queries"] == 8192 and
                    Case["tolerance_optical_depth"] == 0.01, Name + " reference budgets")
            Enforce(float(Difference.max()) == Case["max_abs_optical_depth_difference"] and
                    float(Difference.mean()) == Case["mean_abs_optical_depth_difference"] and
                    int(Np.count_nonzero(Difference > 0.01)) == Case["rays_over_0_01"], Name + " recomputed solar errors")
        Enforce(Report["corrected"]["max_abs_optical_depth_difference"] < 0.01, "corrected solar world-density tolerance")
        Enforce(Report["rejected"]["max_abs_optical_depth_difference"] > 0.1 and
                Report["rejected"]["rays_over_0_01"] > 0, "solar endpoint-weather defect reproduced")
        with Np.load(Results / "VulkanProbes.npz", allow_pickle=False) as Vulkan:
            Enforce(Vulkan["Formation0Query5Inputs"][:, :3] == Archive["Positions"], "solar shared Vulkan receiver positions")
            Enforce(Vulkan["Formation0Query5Native"][:, 3] == Archive["Actual"], "solar shared native integration")
            Enforce(Np.abs(Vulkan["Formation0Query5Vulkan"][:, 3] - Expected).max() < 0.01,
                    "Vulkan actual solar world-density tolerance")
        if Native:
            Current, Arrays = SolarDensityMeasurement(Native)
            Enforce(Current == Report["corrected"], "solar fresh native measurement")
            for Name, Array in Arrays.items():
                Enforce(Array == Archive[Name], Name + " solar fresh native replay")
    return 256, 8192


# ------------------------------------------------------------------------------------------------------------------------
#                                                QUADRATURE AND SPATIAL DIAGNOSTICS
# ------------------------------------------------------------------------------------------------------------------------


def VerifyMeasurements(Generated):
    Report = ReadJson("CloudMeasurements.json")
    Enforce(Report["measurements_completed"] and not Report["sampling"]["convergence_accepted"], "finite comparison scope")
    for Case in Report["orbital_coherence"]:
        Enforce(Case["max_abs"] < 0.02 and Case["fixed_footprint_m"] == 1, "matched world-ray tolerance")
    for Name in ("SamplingProbes.npz", "ReceiverProbes.npz", "DensitySections.npz"):
        with Np.load(Results / Name, allow_pickle=False) as Archive:
            for Key in Archive.files:
                Enforce(Archive[Key].dtype == Np.dtype("<f4") and Np.isfinite(Archive[Key]).all() and
                        (Archive[Key] >= 0).all(), Name + " Float32 nonnegative finite " + Key)
    with Np.load(Results / "DensitySections.npz", allow_pickle=False) as Archive:
        for Case in Report["density_sections"]:
            Density = Archive[Case["view"]]
            Enforce(Density.shape == (180, 480) and Density.size == Case["density_queries"], "full radial section extent")
            Enforce(float(Density.max()) == Case["max_extinction_per_m"], "measured section extinction")
            Enforce(((Density.max(axis=0) - Density.min(axis=0)) > 0).sum() > 20, "nonempty vertically varying section")
    with Np.load(Results / "ReceiverProbes.npz", allow_pickle=False) as Archive:
        Enforce(Archive["NoCloudShadow"][..., 3] == 0, "shadow disabled gives zero cloud optical depth")
        Enforce(Np.max(Np.abs(Archive["Wind0"][..., 3] - Archive["Wind90"][..., 3])) > 0.1, "receiver illumination moves")
    if Generated:
        with Np.load(Generated / "Results/SamplingPixels.npz", allow_pickle=False) as Full:
            with Np.load(Results / "SamplingProbes.npz", allow_pickle=False) as Sparse:
                for Name in Sparse.files:
                    Enforce(Sparse[Name] == Full[Name][::8, ::8], "exact sampling subset " + Name)
            for Case in Report["sampling"]["cases"]:
                Reference = Full[Case["view"] + "Reference"]
                for Category, Suffix in (("view_budget", "View"), ("light_budget", "Light")):
                    for Budget in Case[Category]:
                        Difference = Full[Case["view"] + Suffix + str(Budget["steps"])] - Reference
                        Enforce(float(Np.sqrt(Np.mean(Difference[..., :3] ** 2))) == Budget["rgb_rmse"], "full linear RGB RMSE")
                        Enforce(float(Np.sqrt(Np.mean(Difference[..., 3] ** 2))) == Budget["transmittance_rmse"], "full transmittance RMSE")
        with Np.load(Generated / "Results/CloudShadowReceivers.npz", allow_pickle=False) as Full:
            with Np.load(Results / "ReceiverProbes.npz", allow_pickle=False) as Sparse:
                for Case in Report["receiver_illumination"]["cases"]:
                    Name = Case["name"]
                    Enforce(Full[Name][::4, ::4] == Sparse[Name], "exact receiver subset " + Name)
                    Enforce(float(Np.exp(-Full[Name][..., 3:4]).mean()) == Case["mean_transmittance"], "full receiver mean")


# ------------------------------------------------------------------------------------------------------------------------
#                                                   REJECTED EVIDENCE CONTROLS
# ------------------------------------------------------------------------------------------------------------------------


def VerifyMorphology(Native, Generated):
    import gzip
    from CloudSourceIdentity import QuerySourcePaths
    Report = ReadJson("Morphology.json")
    Morphology.ValidateConnectivity()
    Enforce(True, "independent four-connected adjacency and enclosed-hole fixtures")
    Baseline = Path(__file__).with_name("CloudDensityBefore.slang.gz")
    Enforce(Identity(Baseline) == Report["baseline_density_archive_sha256"], "baseline morphology source archive")
    BeforeIdentity = sha256(b"".join(gzip.decompress(Baseline.read_bytes()) if PathName.name == "CloudDensity.slang"
                                   else PathName.read_bytes() for PathName in QuerySourcePaths())).hexdigest()
    Enforce(BeforeIdentity == Report["baseline_source_sha256"], "baseline morphology numerical source reconstruction")
    Enforce(Report["tests_passed"] and Report["library_sha256"] == ReadJson("NativeValidation.json")["library_sha256"] and
            Report["noise_sha256"] == ReadJson("Captures.json")["noise_sha256"], "morphology executed input identities")
    Captures = {Capture["view"]["Name"]: Capture for Capture in ReadJson("Captures.json")["captures"]}
    with Np.load(Results / "Morphology.npz", allow_pickle=False) as Archive:
        Arrays = {Name: Archive[Name] for Name in Archive.files}
    ExpectedNames = {Prefix + Revision for Prefix in ("Repeat", "CycloneCrossing") for Revision in ("Before", "After")}
    ExpectedNames |= {Name + Revision + "Support" for Name in ("Cumulonimbus", "CycloneOrbit") for Revision in ("Before", "After")}
    Enforce(set(Arrays) == ExpectedNames, "complete morphology array inventory")
    for Revision in ("Before", "After"):
        Repeat, Crossing = Arrays["Repeat" + Revision], Arrays["CycloneCrossing" + Revision]
        Enforce(Repeat.shape == (3, 512) and Repeat.dtype == Np.dtype("<f4") and Np.isfinite(Repeat).all() and
                (Repeat >= 0).all() and (Repeat < 0.001).all(), Revision + " morphology repeated-period density bounds")
        Enforce(Crossing.shape == (4, 256) and Crossing.dtype == Np.dtype("<f4") and Np.isfinite(Crossing).all() and
                (Crossing >= 1000).all() and (Crossing <= 14900).all(), Revision + " resolved top crossing bounds")
    with Np.load(Results / "RadianceProbes.npz", allow_pickle=False) as Probes:
        for Selection, Width, Height, Steps, LightSteps, Samples in Morphology.CaptureSpecifications:
            Name = Clouds.Views[Selection].Name
            Before, After = Report["captures"][Name]["Before"], Report["captures"][Name]["After"]
            Enforce(After == Captures[Name], Name + " comparison uses the current gallery capture")
            Enforce(Before["source_sha256"] == BeforeIdentity and Before["library_sha256"] == Report["baseline_library_sha256"] and
                    Before["noise_sha256"] == Report["noise_sha256"], Name + " baseline execution inputs")
            Enforce(all(Before[Key] == After[Key] for Key in ("view", "width", "height", "steps", "light_steps", "samples")) and
                    not Before["temporal_history"] and not After["temporal_history"], Name + " exact before/after capture conditions")
            if Name == "Cirrocumulus":
                continue
            for Revision in ("Before", "After"):
                Packed = Arrays[Name + Revision + "Support"]
                Enforce(Packed.dtype == Np.uint8 and Packed.shape == ((Width * Height + 7) // 8,), Name + Revision + " packed support extent")
            Support = Morphology.UnpackSupport(Arrays, Name, "After")
            Enforce(Support[::16, ::16] == (Probes[Name][..., 3] < 0.9), Name + " support agrees with retained radiance")
            if Generated:
                with Np.load(Generated / (Name + ".npz"), allow_pickle=False) as Full:
                    Enforce(Support == (Full["Rgba"][..., 3] < 0.9), Name + " complete generated native support")
    Preserved = Report["unchanged_gallery_captures"]
    if Preserved:
        Expected = {Name for Name, Capture in Captures.items() if Capture["view"]["Formation"] not in (8, 10, 11)}
        Enforce({Capture["name"] for Capture in Preserved} == Expected and len(Preserved) == 17, "unchanged gallery scope")
        for Capture in Preserved:
            Current = Captures[Capture["name"]]
            Enforce(all(Capture[Key] == Current[Key] for Key in ("float_sha256", "png_sha256")), Capture["name"] + " unchanged before/after identities")
    Statistics = Morphology.EvaluateStatistics(Arrays)
    Enforce(Statistics == Report["statistics"], "morphology statistics independently recomputed from complete arrays")
    Morphology.ValidateStatistics(Statistics)
    Enforce(True, "fixed morphology regression limits")
    Enforce(Identity(Directory / "Images/Morphology.jpg") == Report["comparison_sha256"], "morphology comparison image identity")
    with Image.open(Directory / "Images/Morphology.jpg") as Comparison:
        Enforce(Comparison.size == (1060, 890), "morphology comparison extent")
    if Native:
        Enforce(Morphology.MeasureRepeat(Native) == Arrays["RepeatAfter"], "fresh native repetition replay")
        Enforce(Morphology.MeasureCrossingHeights(Native) == Arrays["CycloneCrossingAfter"], "fresh native resolved top replay")


def VerifyRejectedEvidence():
    global Directory, Results
    OriginalDirectory, OriginalResults = Directory, Results
    Outcomes = []
    GuardedPaths = [Directory / "Images/Cumulus.png", Results / "RadianceProbes.npz", Results / "VulkanProbes.npz",
                    Results / "SolarDensity.npz", Results / "VulkanBeauty.npz", Results / "Morphology.npz"]
    OriginalIdentities = [Identity(PathName) for PathName in GuardedPaths]

    def RequireRejection(Name, Description, Evaluation):
        try:
            Evaluation()
        except AssertionError as Failure:
            Enforce(Description in str(Failure), Name + " rejected for the expected reason")
            Outcomes.append({"control": Name, "rejection": str(Failure)})
        else:
            raise AssertionError("corrupt evidence unexpectedly accepted: " + Name)

    Scratch = Clouds.Root / "_ClaudeScratch/tmp"
    Scratch.mkdir(parents=True, exist_ok=True)
    try:
        with TemporaryDirectory(dir=Scratch) as Temporary:
            Directory = Path(Temporary) / "PlanetaryClouds"
            shutil.copytree(OriginalDirectory, Directory, ignore=shutil.ignore_patterns("__pycache__"))
            Results = Directory / "Results"
            Picture = Directory / "Images/Cumulus.png"
            Original = Picture.read_bytes()
            Changed = bytearray(Original)
            Changed[-1] ^= 1
            Picture.write_bytes(Changed)
            RequireRejection("altered native PNG", "Cumulus PNG identity", lambda: VerifyCaptures(None))
            Picture.write_bytes(Original)
            Probes = Results / "RadianceProbes.npz"
            Original = Probes.read_bytes()
            with Np.load(Probes, allow_pickle=False) as Archive:
                Arrays = {Name: Archive[Name] for Name in Archive.files}
            Arrays["Cumulus"][0, 0, 0] = 0
            Np.savez_compressed(Probes, **Arrays)
            Layout = ReadJson("ProbeLayout.json")
            Layout["Cumulus"]["float_probe_sha256"] = sha256(Arrays["Cumulus"].tobytes()).hexdigest()
            (Results / "ProbeLayout.json").write_text(json.dumps(Layout))
            RequireRejection("altered Float32 probe with matching probe hash", "exact PNG sample decoding",
                             lambda: VerifyCaptures(None))
            Probes.write_bytes(Original)
            shutil.copyfile(OriginalResults / "ProbeLayout.json", Results / "ProbeLayout.json")
            Probes = Results / "VulkanProbes.npz"
            with Np.load(Probes, allow_pickle=False) as Archive:
                Arrays = {Name: Archive[Name] for Name in Archive.files}
            Prefix = "Formation0Query3"
            Arrays[Prefix + "Vulkan"][0, 3] = 100
            Np.savez_compressed(Probes, **Arrays)
            Report = ReadJson("VulkanClouds.json")
            Case = next(Case for Case in Report["queries"] if Case["selection"] == 3)
            Difference = Np.abs(Arrays[Prefix + "Vulkan"] - Arrays[Prefix + "Native"])
            Case["float_sha256"] = sha256(Arrays[Prefix + "Vulkan"].tobytes()).hexdigest()
            Case["max_abs_by_channel"] = Difference.max(axis=0).tolist()
            Case["mean_abs_by_channel"] = Difference.mean(axis=0).tolist()
            (Results / "VulkanClouds.json").write_text(json.dumps(Report))
            RequireRejection("100 m wind drift with self-consistent hashes/statistics", "tangent wind",
                             lambda: VerifyVulkan(None))
            Probes = Results / "SolarDensity.npz"
            with Np.load(Probes, allow_pickle=False) as Archive:
                Arrays = {Name: Archive[Name] for Name in Archive.files}
            Arrays["Actual"] = Arrays["Rejected"].copy()
            Np.savez_compressed(Probes, **Arrays)
            Report = ReadJson("SolarDensity.json")
            Report["corrected"] = Report["rejected"].copy()
            (Results / "SolarDensity.json").write_text(json.dumps(Report))
            RequireRejection("rejected solar weather with self-consistent statistics", "corrected solar world-density tolerance",
                             lambda: VerifySolarDensity(None))
            Probes = Results / "VulkanBeauty.npz"
            with Np.load(Probes, allow_pickle=False) as Archive:
                Arrays = {Name: Archive[Name] for Name in Archive.files}
            Arrays["cumulusVulkan"][0, 0, 0] += 1
            Np.savez_compressed(Probes, **Arrays)
            Report = ReadJson("VulkanBeauty.json")
            Case = Report["images"][0]
            Difference = Np.abs(Arrays["cumulusVulkan"] - Arrays["cumulusNative"])
            Case["float_sha256"] = sha256(Arrays["cumulusVulkan"].tobytes()).hexdigest()
            Case["max_abs"] = float(Difference.max())
            Case["rgb_rmse"] = float(Np.sqrt(Np.mean(Difference[..., :3] ** 2)))
            (Results / "VulkanBeauty.json").write_text(json.dumps(Report))
            RequireRejection("Vulkan image drift with self-consistent hashes/statistics", "Vulkan beauty complete-image tolerances",
                             lambda: VerifyVulkanBeauty(None))
            Probes = Results / "Morphology.npz"
            with Np.load(Probes, allow_pickle=False) as Archive:
                Arrays = {Name: Archive[Name] for Name in Archive.files}
            Arrays["RepeatAfter"] = Arrays["RepeatBefore"].copy()
            Np.savez_compressed(Probes, **Arrays)
            Report = ReadJson("Morphology.json")
            Report["statistics"] = Morphology.EvaluateStatistics(Arrays)
            (Results / "Morphology.json").write_text(json.dumps(Report))
            RequireRejection("original cloud repetition with self-consistent statistics", "cirrocumulus texture-period repetition",
                             lambda: VerifyMorphology(None, None))
    finally:
        Directory, Results = OriginalDirectory, OriginalResults
    Enforce([Identity(PathName) for PathName in GuardedPaths] == OriginalIdentities, "original evidence unchanged by controls")
    return Outcomes


# ------------------------------------------------------------------------------------------------------------------------
#                                                   SOURCE AND PRODUCT IDENTITIES
# ------------------------------------------------------------------------------------------------------------------------


def Inventory():
    Paths = [PathName for Home in (Clouds.Source, Directory) for PathName in Home.rglob("*") if PathName.is_file() and
             "__pycache__" not in PathName.parts and PathName.name not in ("Integrity.json", "EvidenceValidation.json")]
    Paths.extend(Clouds.Root / Name for Name in ("README.md", "Exhibits/README.md", "Documentation/FolderStructure.md",
                                                "Documentation/Tracker.md"))
    return {str(PathName.relative_to(Clouds.Root)): {"bytes": PathName.stat().st_size, "sha256": Identity(PathName)}
            for PathName in sorted(Paths)}


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--refresh", action="store_true", help="Regenerate file identities only after all semantic checks succeed")
    Parser.add_argument("--negative-controls", action="store_true", help="Reject altered evidence in an isolated scratch copy")
    Parser.add_argument("--out", type=Path, help="Write a verification report; default verification is read-only")
    Parser.add_argument("--generated-captures", type=Path)
    Parser.add_argument("--generated-measurements", type=Path)
    Parser.add_argument("--library", type=Path)
    Parser.add_argument("--noise", type=Path)
    Arguments = Parser.parse_args()
    if bool(Arguments.library) != bool(Arguments.noise):
        Parser.error("--library and --noise must be provided together")
    SourceIdentity = Clouds.QuerySourceIdentity()
    for Name in ("Captures.json", "NativeValidation.json", "SanitizedValidation.json", "VulkanClouds.json",
                 "WindPrecision.json", "CloudMeasurements.json", "PrecisionScope.json", "Provenance.json",
                 "ExecutionScope.json", "ViewerValidation.json", "SolarDensity.json", "VulkanBeauty.json", "Morphology.json"):
        Report = ReadJson(Name)
        Enforce(Report["source_sha256"] == SourceIdentity, Name + " current numerical sources")
        Enforce(Report.get("production_accepted", False) is False and Report.get("photorealism_accepted", False) is False,
                Name + " no unsupported acceptance claims")
    for Name in ("NativeValidation.json", "SanitizedValidation.json"):
        Enforce(ReadJson(Name)["tests_passed"], Name + " numeric validation")
    Enforce(ReadJson("NativeValidation.json")["assertions"] == ReadJson("SanitizedValidation.json")["assertions"], "instrumented count")
    Viewer = ReadJson("ViewerValidation.json")
    Enforce(Viewer["tests_passed"] and Viewer["distinct_capture_images"] == 22 and not Viewer["page_errors"], "browser result")
    CacheCases = Viewer["cache_revisions"]
    Enforce(len(CacheCases) == 3 and {Case["scenario"] for Case in CacheCases} ==
            {"stale PNG cache", "stale manifest cache", "already-open revision"}, "browser cache regression inventory")
    for Case in CacheCases:
        Enforce(Case["tests_passed"] and len(Case["captures"]) == 5 and set(Case["captures"]) ==
                {"Cumulonimbus", "Cirrocumulus", "CycloneOrbit", "CycloneEye", "CycloneLimb"},
                Case["scenario"] + " revised captures authenticated")
    Enforce(Viewer["preview_cache_policy_verified"], "preview cache policy and stale conditional requests")
    Metrics = re.findall(r'<div class="metric"><strong>(.*?)</strong>', (Directory / "index.html").read_text())
    Enforce(Metrics == [f"{ReadJson('NativeValidation.json')['assertions']:,}",
                        f"{sum(Case['queries'] for Case in ReadJson('VulkanClouds.json')['queries']):,}", "Not accepted"],
            "viewer measured summary agrees with retained results")
    Native = Clouds.NativeIntegration(Arguments.library.resolve(), Arguments.noise.resolve()) if Arguments.library else None
    if Native:
        Enforce(Native.LibraryIdentity == ReadJson("NativeValidation.json")["library_sha256"], "replayed library identity")
        Enforce(Native.NoiseIdentity == ReadJson("Captures.json")["noise_sha256"], "replayed noise identity")
    ProbePixels = VerifyCaptures(Arguments.generated_captures)
    VulkanQueries = VerifyVulkan(Native)
    VulkanPixels = VerifyVulkanBeauty(Native)
    WindQueries = VerifyWind(Native)
    SolarReceivers, SolarPoints = VerifySolarDensity(Native)
    VerifyMeasurements(Arguments.generated_measurements)
    VerifyMorphology(Native, Arguments.generated_captures)
    for PathName in (Directory / "README.md", Clouds.Source / "README.md"):
        for Target in re.findall(r"\]\(([^)]+)\)", PathName.read_text()):
            if "://" not in Target and not Target.startswith("#"):
                Destination = PathName.parent / Target.split("#")[0]
                Enforce(Destination.is_file() or Destination == Results / "EvidenceValidation.json" or
                        (Arguments.refresh and Destination == Results / "Integrity.json"),
                        "document link " + str(Destination))
    Rejected = VerifyRejectedEvidence() if Arguments.negative_controls else []
    Files = Inventory()
    if Arguments.refresh:
        (Results / "Integrity.json").write_text(json.dumps({"source_sha256": SourceIdentity, "files": Files,
            "scope": "byte identities, not a digital signature; excludes this manifest and the verification output"}, indent=2) + "\n")
    else:
        Expected = ReadJson("Integrity.json")
        Enforce(Expected["source_sha256"] == SourceIdentity and Expected["files"] == Files, "retained source/product byte identities")
    Report = {"source_sha256": SourceIdentity, "tests_passed": True, "assertion_gates": GateCount,
              "assertion_accounting": "Boolean gate evaluations, not independent cases or every array component",
              "retained_files_identified": len(Files), "png_probe_pixels": ProbePixels, "vulkan_query_readbacks": VulkanQueries,
              "vulkan_beauty_pixels": VulkanPixels, "wind_reference_queries": WindQueries,
              "browser_cache_regression_cases": len(CacheCases),
              "solar_density_receivers": SolarReceivers,
              "solar_density_point_queries": SolarPoints, "morphology_repeat_points_per_revision": 1536,
              "morphology_resolved_top_crossings_per_revision": 1024, "fresh_native_query_replay": bool(Native),
              "complete_generated_captures_checked": bool(Arguments.generated_captures),
              "complete_generated_measurements_checked": bool(Arguments.generated_measurements),
              "rejected_controls": Rejected, "photorealism_accepted": False, "production_accepted": False}
    Destination = Arguments.out or (Results / "EvidenceValidation.json" if Arguments.refresh else None)
    if Destination:
        Destination.write_text(json.dumps(Report, indent=2) + "\n")
    print(json.dumps(Report, indent=2))


if __name__ == "__main__":
    Main()
