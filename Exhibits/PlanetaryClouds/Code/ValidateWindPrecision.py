#!/usr/bin/env python3
# ============================================================================================================================================
#                                                        VALIDATEWINDPRECISION.PY
# ============================================================================================================================================
# 🧩 Reproduce rejected generic-trig radial displacement and verify repaired native/Vulkan wind at the same world coordinates.

import argparse
from contextlib import ExitStack
from dataclasses import replace
from hashlib import sha256
import json
from pathlib import Path
import subprocess

import numpy as Np

import RenderClouds as Clouds
import VulkanClouds as Vulkan


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--out", type=Path, default=Clouds.Root / "_ClaudeScratch/tmp/CloudWindPrecision")
    Parser.add_argument("--slang", type=Path, default=Clouds.Root / "ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc")
    Parser.add_argument("--optimizer", type=Path, default=Clouds.Root / "_ClaudeScratch/build/SpirvNative/tools/spirv-opt")
    Parser.add_argument("--validator", type=Path, default=Clouds.Root / "_ClaudeScratch/build/SpirvNative/tools/spirv-val")
    Parser.add_argument("--library", type=Path)
    Parser.add_argument("--noise", type=Path)
    Arguments = Parser.parse_args()
    if bool(Arguments.library) != bool(Arguments.noise):
        Parser.error("--library and --noise must be provided together")
    Arguments.out.mkdir(parents=True, exist_ok=True)
    Slang, Optimizer, Validator = Arguments.slang, Arguments.optimizer, Arguments.validator
    if Arguments.library:
        Library, Noise, Identity = Arguments.library.resolve(), Arguments.noise.resolve(), Clouds.QuerySourceIdentity()
    else:
        Library, Noise, Identity = Clouds.CompileNative(Slang)
    Native = Clouds.NativeIntegration(Library, Noise)
    OriginalSource = Path(__file__).with_name("RejectedWind.slang")
    RejectedRaw = Arguments.out / "RejectedWind.Raw.spv"
    Rejected = Arguments.out / "RejectedWind.spv"
    subprocess.run([str(Slang), str(OriginalSource), "-entry", Clouds.Entry, "-target", "spirv", "-profile", "spirv_1_3",
                    "-fp-mode", "precise", "-fvk-use-entrypoint-name", "-O0", "-o", str(RejectedRaw)], check=True)
    subprocess.run([str(Optimizer), "-O", str(RejectedRaw), "-o", str(Rejected)], check=True)
    subprocess.run([str(Validator), "--target-env", "vulkan1.1", str(Rejected)], check=True)
    Repaired = Vulkan.CompileVulkan(Slang, Optimizer, Validator, Arguments.out, 0, 3)
    Random = Np.random.default_rng(617)
    Random.uniform(-2, 2, (256, 3))
    Random.uniform(-2, 2, (256, 3))
    Positions = Random.normal(size=(256, 3))
    Positions /= Np.linalg.norm(Positions, axis=1)[:, None]
    Queries = Np.zeros((256, 16), dtype="<f4")
    Queries[:, :3] = Positions * (6371000.0 + Random.uniform(1200, 14000, 256)[:, None])
    Queries[:, 3] = 3
    Arrays = {"Queries": Queries}
    Report = {"source_sha256": Identity, "tests_passed": False, "original_source_sha256": sha256(OriginalSource.read_bytes()).hexdigest(),
              "original_spirv_sha256": sha256(Rejected.read_bytes()).hexdigest(),
              "repaired_spirv_sha256": sha256(Repaired.read_bytes()).hexdigest(),
              "library_sha256": Native.LibraryIdentity, "noise_sha256": Native.NoiseIdentity,
              "native_reference": "repaired native implementation, same positions and wind parameters",
              "time_seconds": 1200, "cases": [], "physical_gpu_verified": False, "production_accepted": False}
    try:
        for Name, Shader in (("Original", Rejected), ("Repaired", Repaired)):
            with ExitStack() as Resources:
                Compute = Vulkan.VulkanIntegration(Resources, Shader, Noise.read_bytes(), 256 * 16)
                Report["device"] = Compute.Description
                for Index, (Shear, Veer) in enumerate(((0.0, 0.0), (0.1, 0.0), (0.0, 0.1), (0.1, 0.1))):
                    View = replace(Clouds.Views["cumulus"], Time=1200.0, Shear=Shear, Veer=Veer)
                    Uniform = Clouds.EncodeFootprint(View, 256, 1, (4096, 1), 0, 1, 96, 12, 1, 2)
                    Actual = Np.frombuffer(Compute.Dispatch(Uniform, Queries.tobytes(), 256, 1), dtype="<f4").reshape(-1, 4)
                    Expected = Native.Inspect(View, Queries)
                    Difference = Np.abs(Actual - Expected)
                    Arrays[Name + str(Index)] = Actual
                    Arrays["Native" + str(Index)] = Expected
                    Case = {"selection": Name, "shear": Shear, "veer": Veer, "world_points": len(Queries),
                            "max_abs_native_difference_by_channel": Difference.max(axis=0).tolist(),
                            "max_abs_radial_displacement_m": float(Np.abs(Actual[:, 3]).max()),
                            "native_max_abs_radial_displacement_m": float(Np.abs(Expected[:, 3]).max())}
                    Report["cases"].append(Case)
                    print(Case, flush=True)
                    if Name == "Repaired":
                        assert float(Difference.max()) < 3.0, "repaired wind differs from native by at least 3m"
                        assert Case["max_abs_radial_displacement_m"] <= 1.5, "repaired wind lost radial altitude"
        Before = max(Case["max_abs_radial_displacement_m"] for Case in Report["cases"] if Case["selection"] == "Original")
        After = max(Case["max_abs_radial_displacement_m"] for Case in Report["cases"] if Case["selection"] == "Repaired")
        Report["before_max_radial_m"], Report["after_max_radial_m"] = Before, After
        Report["software_defect_reproduced"] = Before > 10.0
        if str(Report["device"]["name"]).startswith("SwiftShader"):
            assert Before > 10.0, "the rejected control did not reproduce the recorded software-ICD defect"
        Report["tests_passed"] = True
    except BaseException as Failure:
        Report["failure"] = str(Failure)
        raise
    finally:
        Np.savez_compressed(Arguments.out / "WindPrecision.npz", **Arrays)
        (Arguments.out / "WindPrecision.json").write_text(json.dumps(Report, indent=2) + "\n")


if __name__ == "__main__":
    Main()
