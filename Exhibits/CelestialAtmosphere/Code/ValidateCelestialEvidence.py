# ============================================================================================================================================
#                                                      VALIDATECELESTIALEVIDENCE.PY
# ============================================================================================================================================
# 🧩 Verify retained source identities, numerical gates, native dimensions and lossless Float32 samples without running a GPU.

from pathlib import Path
import argparse
import hashlib
import json

import numpy as Numpy
from PIL import Image

Root = Path(__file__).resolve().parents[3]


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("Directory", type=Path)
    Arguments = Parser.parse_args()
    Directory = Arguments.Directory.resolve()
    Results = Directory / "Results"
    Manifest = json.loads((Results / "Integrity.json").read_text())
    Assertions = 0

    def Assert(Condition, Description):
        nonlocal Assertions
        Assertions += 1
        if not Condition:
            raise AssertionError(Description)

    for Relative, Expected in Manifest["working_tree_sources"].items():
        Assert(hashlib.sha256((Root / Relative).read_bytes()).hexdigest() == Expected, f"Changed executed source: {Relative}")
    for Relative, Expected in Manifest["retained_files_sha256"].items():
        Assert(hashlib.sha256((Directory / Relative).read_bytes()).hexdigest() == Expected, f"Changed retained evidence: {Relative}")
    Assert(len(Manifest["compiled_spirv_sha256"]) == 10, "Missing executed shader identities")
    Native = json.loads((Results / "CelestialNumeric.json").read_text())
    Gpu = json.loads((Results / "CelestialVulkan.json").read_text())
    Inspection = json.loads((Results / "CelestialInspection.json").read_text())
    Controls = json.loads((Results / "CelestialControls.json").read_text())
    Assert(Native["passed"] and Native["assertions"] >= 51899, "Native physics checks are incomplete")
    Assert(Gpu["passed"] and Gpu["physics_probes"] == 3282 and len(Gpu["executed_entries"]) == 10, "Not all shaders were exercised")
    Assert(not Gpu["production_accepted"] and not Inspection["production_accepted"], "Experimental software rendering was relabelled as production acceptance")
    Assert(Gpu["transmission_max_abs_error"] < .007 and Gpu["single_scattering_max_relative_error"] < .04, "Atmospheric gates changed")
    Assert(Gpu["moon_surface_max_abs_error"] < .0001 and Gpu["solar_profile_max_abs_error"] < .00002, "Lunar/solar gates changed")
    Assert(Controls["passed"] and len(Controls["negative_controls"]) == 3 and all(C["rejected"] for C in Controls["negative_controls"]), "Negative controls did not fail")
    Assert(Inspection["passed"] and Inspection["capture_count"] == 30, "Full-image independent inspection did not finish")
    Assert(Inspection["moon"]["full_image_texture_sample_max_error"] < .00015, "Retained JPEG parity failed")
    Assert(Inspection["stars"]["catalogue_coordinate_rounding_matches"] == Inspection["stars"]["projected_sources"] == 8080, "Actual rendered catalogue correspondence failed")
    Assert(Inspection["stars"]["astropy_max_deg"] < .03 and Inspection["stars"]["integrated_image_relative_flux_error"] < .00002, "Stellar accuracy/flux gate failed")
    Assert(Inspection["galaxy"]["contour_weighted_abs_galactic_latitude_deg"] < 8 and
           Inspection["galaxy"]["brightness_fraction_above_20deg_galactic_latitude"] < .01, "Authentic Milky Way geometry gate failed")
    Inputs = json.loads((Results / "CelestialInputs.json").read_text())
    Assert(Inputs["moon_source_sha256"] == hashlib.sha256((Root / Inputs["moon_source"]).read_bytes()).hexdigest(), "Same lunar texture was replaced")
    Captures = json.loads((Directory / "Captures.json").read_text())
    Assert(len(Captures) == 30 and len({C["slug"] for C in Captures}) == 30, "Native capture coverage is incomplete")
    Radiance = Numpy.load(Results / "NativeRadiance.npz", allow_pickle=False)
    Moments = {"BeforeSunrise": -10, "Sunrise": 0, "Dawn": -4, "Zenith": 90, "Sunset": 0, "Dusk": -6}
    for C in Captures:
        Slug = C["slug"]
        with Image.open(Directory / C["image"]) as Picture:
            Assert(Picture.size == tuple(C["extent"]) == (480, 270), f"Image is not a full native capture: {Slug}")
        Assert(hashlib.sha256((Directory / C["image"]).read_bytes()).hexdigest() == C["png_sha256"], "Native PNG identity changed")
        A = Radiance[Slug]
        Assert(A.shape == (C["planes"], 1024, 4) and A.dtype == Numpy.dtype("float32") and Numpy.isfinite(A).all(), "Missing exact per-layer Float32 probes")
        Assert(Numpy.min(A[:, :, :3]) >= 0, "Negative retained radiance")
        for View in ["Surface", "Orbit"]:
            if Slug.startswith(View) and Slug[len(View):] in Moments:
                Elevation = Numpy.degrees(Numpy.arcsin(C["sun"][2]))
                Assert(abs(Elevation - Moments[Slug[len(View):]]) < .01, f"Incorrect actual solar elevation for {Slug}")
                Assert(abs(C["camera_km"][2] - (6361.64 if View == "Surface" else 6760)) < 1e-6, "Viewpoint altitude changed")
    for Slug, Plane in [("MoonFull", 0), ("MoonExospherePhysical", 2), ("SunDisc", 1), ("SolarCorona", 0), ("CatalogueStarsSpace", 0)]:
        A = Radiance[f"Full{Slug}"]
        Assert(A.shape == (270, 480, 4) and A.dtype == Numpy.dtype("float32"), "Selected full HDR plane is missing")
        Assert(Numpy.array_equal(A.reshape(-1, 4)[Radiance[f"{Slug}Indices"]], Radiance[Slug][Plane]), "Lossless full plane differs from its native probes")
    Table = Radiance["AtmosphericTables"].reshape(-1, 4)
    Multiple = Table[256 * 64:].reshape(16, 32, 4)
    Assert(Numpy.max(Multiple[:, :5, :3]) == 0 and Numpy.max(Multiple[:, :, 3]) < .98, "Deep-night/energy regression reappeared")
    Reflection = json.loads((Results / "ShaderAbi.json").read_text())
    Assert(len(Reflection) == 10 and all(C["push_bytes"] == 128 and C["storage_slots"] == list(range(8)) for C in Reflection.values()), "Shader ABI evidence changed")
    Report = {"passed": True, "assertions": Assertions, "source_identities": len(Manifest["working_tree_sources"]),
              "retained_file_identities": len(Manifest["retained_files_sha256"]), "native_captures": 30,
              "float_probes_per_layer": 1024, "full_float_planes": 5, "source_and_evidence_integrity": True,
              "production_accepted": False}
    (Results / "CelestialEvidence.json").write_text(json.dumps(Report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(Report, indent=2))


if __name__ == "__main__":
    Execute()
