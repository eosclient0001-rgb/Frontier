# ============================================================================================================================================
#                                                       VALIDATECELESTIALCONTROLS.PY
# ============================================================================================================================================
# 🧩 Require deliberate optical-math, planetary-boundary and spherical-contour defects to fail the unchanged celestial gates.

from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys

import numpy as Numpy

Root = Path(__file__).resolve().parents[3]


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--build", type=Path, required=True)
    Parser.add_argument("--inputs", type=Path, required=True)
    Parser.add_argument("--captures", type=Path, required=True)
    Parser.add_argument("--driver", type=Path, required=True)
    Parser.add_argument("--slang", type=Path, required=True)
    Parser.add_argument("--output", type=Path, required=True)
    Arguments = Parser.parse_args()
    Arguments.output.mkdir(parents=True, exist_ok=True)
    Executable = Arguments.build / "CelestialVulkan"
    if not Executable.exists():
        Executable = Executable.with_suffix(".exe")
    Observations = []
    for Category, Entry, Expected in [("GenericOpticalTrig", "InspectCelestialPhysics", "GPU solar limb/radial blur"),
                                      ("RoundedGroundLeak", "BakeAtmosphereMultiple", "Deep planetary night leaks"),
                                      ("MissingGalacticDust", "InspectCelestialPhysics", "Slang port disagrees with the original requested upstream")]:
        Directory = Arguments.output / Category
        Source = Directory / "Experimental/CelestialAtmosphere"
        Source.mkdir(parents=True, exist_ok=True)
        for Location in (Root / "Experimental/CelestialAtmosphere").glob("*.slang"):
            shutil.copyfile(Location, Source / Location.name)
        Reused = Directory / "Frontier/Engine/Rendering/Shaders"
        Reused.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Root / "Frontier/Engine/Rendering/Shaders/SolarOptics.slang", Reused / "SolarOptics.slang")
        Shaders = Directory / "Shaders"
        Shaders.mkdir(exist_ok=True)
        for Location in (Arguments.build / "Shaders").glob("*.spv"):
            shutil.copyfile(Location, Shaders / Location.name)
        if Category == "GenericOpticalTrig":
            Location = Source / "SolarAtmosphere.slang"
            Original = Location.read_text()
            Modified = Original
            for Line in ["#define sin CelestialSine\n", "#define cos CelestialCosine\n", "#define atan2 CelestialArctangent2\n", "#undef sin\n", "#undef cos\n", "#undef atan2\n"]:
                assert Line in Modified
                Modified = Modified.replace(Line, "")
            Location.write_text(Modified)
        elif Category == "MissingGalacticDust":
            Location = Source / "GalacticBulge.slang"
            Original = Location.read_text()
            assert "return Light * exp(-Dust * float3(.75, 1, 1.32));" in Original
            Modified = Original.replace("return Light * exp(-Dust * float3(.75, 1, 1.32));", "return Light;")
            Location.write_text(Modified)
        else:
            Location = Source / "CelestialFootprint.slang"
            Original = Location.read_text()
            Start = Original.index("bool GroundOccluded(")
            End = Original.index("float CelestialSine(float Angle);", Start)
            Modified = Original[:Start] + """bool GroundOccluded(float3 Position, float3 Direction)
{
    float2 Segment = SphereInterval(Position, Direction, Configuration(9).x);
    return Segment.x > .0001 && Segment.y >= Segment.x;
}
""" + Original[End:]
            Location.write_text(Modified)
        Compiled = Shaders / f"{Entry}.spv"
        subprocess.run([str(Arguments.slang.resolve()), str(Source / "CelestialAtmosphere.slang"), "-entry", Entry,
                        "-target", "spirv", "-profile", "glsl_450", "-fp-mode", "precise", "-O0", "-o", str(Compiled)], check=True)
        Run = subprocess.run([str(Executable.resolve()), str(Shaders), str(Arguments.inputs),
                              str(Root / "Exhibits/NightSky/Data/Hipparcos8.csv"), str(Directory / "Readback"),
                              str(Arguments.driver.resolve()), "validate"], capture_output=True, text=True)
        assert Run.returncode != 0 and Expected in Run.stderr, (Category, Run.returncode, Run.stdout, Run.stderr)
        Observations.append({"category": Category, "rejected": True, "exit_code": Run.returncode,
                             "gate": Expected, "actual_stderr": Run.stderr.strip(),
                             "modified_source_sha256": hashlib.sha256(Location.read_bytes()).hexdigest(),
                             "modified_spirv_sha256": hashlib.sha256(Compiled.read_bytes()).hexdigest()})
    Specification = importlib.util.spec_from_file_location("CelestialInspection", Root / "Exhibits/CelestialAtmosphere/Code/InspectCelestial.py")
    Inspection = importlib.util.module_from_spec(Specification)
    Specification.loader.exec_module(Inspection)
    Preparation = Root / "Exhibits/CelestialAtmosphere/Code/PrepareCelestial.py"
    Original = Preparation.read_text()
    assert "if abs(Longitude[-1] - Longitude[0]) > 180:" in Original
    Modified = Original.replace("if abs(Longitude[-1] - Longitude[0]) > 180:", "if False:")
    Namespace = {"__file__": str(Preparation), "__name__": "ContourNegativeControl"}
    exec(compile(Modified, str(Preparation), "exec"), Namespace)
    LegacyInputs = Arguments.output / "PlanarContourClosure"
    SavedArguments = sys.argv
    try:
        sys.argv = [str(Preparation), str(LegacyInputs)]
        Namespace["Execute"]()
    finally:
        sys.argv = SavedArguments
    try:
        Inspection.VerifyGalaxy(Arguments.captures, LegacyInputs)
    except AssertionError as Failure:
        assert "off the real Milky Way" in str(Failure)
        Observations.append({"category": "PlanarContourClosure", "rejected": True, "gate": str(Failure),
                             "modified_preparation_sha256": hashlib.sha256(Modified.encode()).hexdigest()})
    else:
        raise AssertionError("The galaxy gate accepts the incorrect circumpolar closure")
    CaptureReport = json.loads((Arguments.captures / "CelestialVulkan.json").read_text())
    Captures = {Entry["slug"]: Entry for Entry in CaptureReport["captures"]}
    Raw = {}
    for Capture in CaptureReport["captures"] + CaptureReport["diagnostics"]:
        Location = Arguments.captures / "Renders" / f"{Capture['slug']}.f32"
        Raw[Capture["slug"]] = Numpy.fromfile(Location, "<f4").reshape(Capture["planes"], 270, 480, 4)
    for Category, Slug, Replacement, Expected in [
            ("RejectedAnamorphicImage", "FlareAnamorphic", "AnamorphicLegacy", "edge-to-edge anamorphic defect"),
            ("DuplicatedSixRayStarburst", "FlareStarburst", "FlareDiffraction", "not visibly distinct")]:
        Changed = dict(Raw)
        Changed[Slug] = Raw[Replacement]
        try:
            Inspection.VerifyLensRevision(Captures, Changed, CaptureReport["diagnostics"], Raw)
        except AssertionError as Failure:
            assert Expected in str(Failure), str(Failure)
            Observations.append({"category": Category, "rejected": True, "gate": str(Failure),
                                 "actual_native_replacement": Replacement,
                                 "replacement_float_sha256": hashlib.sha256((Arguments.captures / "Renders" / f"{Replacement}.f32").read_bytes()).hexdigest()})
        else:
            raise AssertionError(f"Revision image gate accepts {Category}")
    Report = {"passed": True, "negative_controls": Observations, "production_accepted": False}
    (Arguments.output / "CelestialControls.json").write_text(json.dumps(Report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(Report, indent=2))


if __name__ == "__main__":
    Execute()
