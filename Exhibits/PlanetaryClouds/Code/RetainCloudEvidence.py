#!/usr/bin/env python3
# ============================================================================================================================================
#                                                        RETAINCLOUDEVIDENCE.PY
# ============================================================================================================================================
# 🧩 Retain exact native PNGs, regularly spaced Float32 probes and measured reports without archiving large generated outputs.

import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil

import numpy as Np
from PIL import Image

import RenderClouds as Clouds


def RetainJson(Source, Destination, Identity):
    Report = json.loads(Source.read_text())
    assert Report["source_sha256"] == Identity, "stale measured source identity: " + str(Source)
    shutil.copyfile(Source, Destination)


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--captures", type=Path, required=True)
    Parser.add_argument("--measurements", type=Path, required=True)
    Parser.add_argument("--vulkan", type=Path, required=True)
    Parser.add_argument("--beauty", type=Path, required=True)
    Parser.add_argument("--wind", type=Path, required=True)
    Parser.add_argument("--solar", type=Path, required=True)
    Parser.add_argument("--morphology", type=Path, required=True)
    Parser.add_argument("--native", type=Path, required=True)
    Parser.add_argument("--sanitized", type=Path, required=True)
    Parser.add_argument("--library", type=Path, required=True)
    Parser.add_argument("--noise", type=Path, required=True)
    Parser.add_argument("--out", type=Path, default=Clouds.Root / "Exhibits/PlanetaryClouds")
    Arguments = Parser.parse_args()
    Images, Results = Arguments.out / "Images", Arguments.out / "Results"
    Images.mkdir(parents=True, exist_ok=True)
    Results.mkdir(parents=True, exist_ok=True)
    Identity = Clouds.QuerySourceIdentity()
    Captures = json.loads((Arguments.captures / "Captures.json").read_text())
    assert Captures["source_sha256"] == Identity
    Native = json.loads(Arguments.native.read_text())
    LibraryIdentity = sha256(Arguments.library.read_bytes()).hexdigest()
    NoiseIdentity = sha256(Arguments.noise.read_bytes()).hexdigest()
    assert LibraryIdentity == Native["library_sha256"]
    assert NoiseIdentity == Native["measurements"]["noise_sha256"]
    assert all(Capture["library_sha256"] == LibraryIdentity for Capture in Captures["captures"])
    Captures["noise_sha256"] = NoiseIdentity
    Captures["noise_identity_scope"] = "input file hashed at retention; same path as the recorded capture command"
    Arrays, Layout = {}, {}
    for Capture in Captures["captures"]:
        Name = Capture["view"]["Name"]
        Picture = Arguments.captures / (Name + ".png")
        assert sha256(Picture.read_bytes()).hexdigest() == Capture["png_sha256"], "capture PNG changed"
        with Np.load(Arguments.captures / (Name + ".npz")) as Archive:
            Pixels = Archive["Rgba"]
        assert Pixels.shape == (Capture["height"], Capture["width"], 4)
        assert sha256(Pixels.tobytes()).hexdigest() == Capture["float_sha256"], "capture Float32 changed"
        assert Np.isfinite(Pixels).all() and (Pixels >= 0.0).all()
        assert (Pixels[..., 3] <= 1.0).all()
        assert Np.array_equal(Clouds.EncodeDisplay(Pixels, Capture["view"]["Exposure"]), Np.asarray(Image.open(Picture)))
        shutil.copyfile(Picture, Images / Picture.name)
        Arrays[Name] = Pixels[::16, ::16].copy()
        Layout[Name] = {"native_extent": [Capture["width"], Capture["height"]], "first_pixel": [0, 0],
                        "pixel_stride": [16, 16], "channels": "linear RGB, cloud transmittance",
                        "display_exposure": Capture["view"]["Exposure"],
                        "float_probe_sha256": sha256(Arrays[Name].tobytes()).hexdigest()}
    Np.savez_compressed(Results / "RadianceProbes.npz", **Arrays)
    (Results / "ProbeLayout.json").write_text(json.dumps(Layout, indent=2) + "\n")
    Captures["retained_precision"] = "uninterpolated every-sixteenth-pixel Float32 probes; full arrays regenerate in ignored scratch"
    # 📝 Compact machine-readable input packets preserve every field without spending the artifact budget on indentation.
    (Results / "Captures.json").write_text(json.dumps(Captures, separators=(",", ":")) + "\n")
    for Name in ("Sampling.png", "DensitySections.png", "CloudShadowReceivers.png"):
        shutil.copyfile(Arguments.measurements / "Images" / Name, Images / Name)
    RetainJson(Arguments.measurements / "Results/CloudMeasurements.json", Results / "CloudMeasurements.json", Identity)
    with Np.load(Arguments.measurements / "Results/SamplingPixels.npz") as Archive:
        Np.savez_compressed(Results / "SamplingProbes.npz", **{Name: Archive[Name][::8, ::8] for Name in Archive.files})
    with Np.load(Arguments.measurements / "Results/DensitySections.npz") as Archive:
        Np.savez_compressed(Results / "DensitySections.npz", **{Name: Archive[Name] for Name in Archive.files})
    with Np.load(Arguments.measurements / "Results/CloudShadowReceivers.npz") as Archive:
        Np.savez_compressed(Results / "ReceiverProbes.npz", **{Name: Archive[Name][::4, ::4] for Name in Archive.files})
    for Source, Name in ((Arguments.native, "NativeValidation.json"), (Arguments.sanitized, "SanitizedValidation.json"),
                         (Arguments.vulkan, "VulkanClouds.json"), (Arguments.wind / "WindPrecision.json", "WindPrecision.json")):
        RetainJson(Source, Results / Name, Identity)
    Solar = json.loads((Arguments.solar / "SolarDensity.json").read_text())
    assert Solar["tests_passed"] and Solar["library_sha256"] == LibraryIdentity and Solar["noise_sha256"] == NoiseIdentity
    RetainJson(Arguments.solar / "SolarDensity.json", Results / "SolarDensity.json", Identity)
    shutil.copyfile(Arguments.solar / "SolarDensity.npz", Results / "SolarDensity.npz")
    Morphology = json.loads((Arguments.morphology / "Morphology.json").read_text())
    assert Morphology["tests_passed"] and Morphology["library_sha256"] == LibraryIdentity
    assert Morphology["noise_sha256"] == NoiseIdentity
    RetainJson(Arguments.morphology / "Morphology.json", Results / "Morphology.json", Identity)
    shutil.copyfile(Arguments.morphology / "Morphology.npz", Results / "Morphology.npz")
    Comparison = Arguments.morphology / "Morphology.jpg"
    assert sha256(Comparison.read_bytes()).hexdigest() == Morphology["comparison_sha256"]
    shutil.copyfile(Comparison, Images / Comparison.name)
    shutil.copyfile(Arguments.wind / "WindPrecision.npz", Results / "WindPrecision.npz")
    shutil.copyfile(Arguments.vulkan.with_name("VulkanProbes.npz"), Results / "VulkanProbes.npz")
    Beauty = json.loads(Arguments.beauty.read_text())
    assert Beauty["tests_passed"] and Beauty["full_beauty_entry_executed"]
    assert Beauty["library_sha256"] == LibraryIdentity and Beauty["noise_sha256"] == NoiseIdentity
    RetainJson(Arguments.beauty, Results / "VulkanBeauty.json", Identity)
    shutil.copyfile(Arguments.beauty.with_name("VulkanBeauty.npz"), Results / "VulkanBeauty.npz")
    for Case in Beauty["images"]:
        Picture = Arguments.beauty.with_name(Case["view"] + ".png")
        assert sha256(Picture.read_bytes()).hexdigest() == Case["png_sha256"], "Vulkan beauty PNG changed"
        shutil.copyfile(Picture, Images / ("Vulkan" + Clouds.Views[Case["view"]].Name + ".png"))
    (Results / "PrecisionScope.json").write_text(json.dumps({
        "source_sha256": Identity, "radiance_probes": "native pixel [0::16,0::16], RGB radiance plus cloud transmittance",
        "sampling_probes": "cloud-only arrays at native pixel [0::8,0::8], native extent 96 by 54",
        "density_sections": "complete two 480 by 180 extinction arrays; projection in CloudMeasurements.json",
        "receiver_probes": "native grid [0::4,0::4], native extent 128 by 128; solar air RGB and cloud optical depth",
        "wind_precision": "complete before/after/native point probes; rejected code identified separately",
        "solar_density": "complete 256 receiver positions, 8192 direct density samples, segment lengths and corrected/rejected depths",
        "morphology": "complete before/after repeat densities, 1024 resolved top crossings and packed native support masks; comparison JPEG is a preview, baseline source is retained as gzip",
        "vulkan_beauty": "complete native/software-Vulkan RGBA32F for one 64 by 36 cumulus fixture, not the native gallery",
        "full_native_gallery_hdr_archived": False, "small_vulkan_beauty_hdr_archived": True,
        "full_generated_arrays": "reproducible in ignored scratch",
        "photorealism_accepted": False, "production_accepted": False}, indent=2) + "\n")
    Sizes = [PathName.stat().st_size for Directory in (Arguments.out, Clouds.Source)
             for PathName in Directory.rglob("*") if PathName.is_file() and "__pycache__" not in PathName.parts]
    Total = sum(Sizes)
    assert Total < 2400000, f"cloud source/evidence exceeds its 2.4 MB allocation within the cumulative artifact budget: {Total} bytes"
    print(f"Retained {len(Captures['captures'])} native captures and exact probes in {Total} authored/product bytes")


if __name__ == "__main__":
    Main()
