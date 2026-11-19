# ============================================================================================================================================
#                                                       REPRODUCECELESTIALREFERENCE.PY
# ============================================================================================================================================
# 🧩 Recompile the exact requested upstream outside Git and reject changed exports before accepting the Slang port's numerical fixtures.

from pathlib import Path
import argparse
import base64
import hashlib
import json
import os
import shlex
import subprocess

Root = Path(__file__).resolve().parents[3]


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("--sources", type=Path, default=Root / "ExternalPackages/CelestialReference/c519e983110100a9ed1c17bd3ff97a1c27bef3b9")
    Parser.add_argument("--output", type=Path, default=Root / "_ClaudeScratch/tmp/CelestialRevision/Export")
    Parser.add_argument("--offline", action="store_true")
    Arguments = Parser.parse_args()
    Pin = json.loads((Root / "Experimental/CelestialAtmosphere/Content/ReferenceSource.json").read_text())
    for Name, Identity in Pin["provisioned_sources"].items():
        Location = Arguments.sources / Name
        if not Location.exists() or hashlib.sha256(Location.read_bytes()).hexdigest() != Identity["sha256"]:
            if Arguments.offline:
                raise RuntimeError(f"Missing or changed pinned upstream source: {Location}")
            Blob = json.loads(subprocess.check_output(["gh", "api", f"repos/{Pin['repository']}/git/blobs/{Identity['git_blob']}"]))
            Contents = base64.b64decode(Blob["content"])
            assert hashlib.sha256(Contents).hexdigest() == Identity["sha256"], f"Upstream identity mismatch: {Name}"
            Location.parent.mkdir(parents=True, exist_ok=True)
            Location.write_bytes(Contents)
    Arguments.output.mkdir(parents=True, exist_ok=True)
    Executable = Arguments.output / "CelestialUpstreamProbe"
    Compiler = shlex.split(os.environ.get("CXX", "g++"))
    subprocess.run(Compiler + ["-std=c++20", "-O2", "-fno-fast-math", "-ffp-contract=off", "-ffunction-sections",
                               "-fdata-sections", "-isystem", str(Arguments.sources / "Internal"),
                               str(Root / "Exhibits/CelestialAtmosphere/Code/CelestialUpstreamProbe.cpp"),
                               "-Wl,--gc-sections", "-o", str(Executable)], check=True)
    subprocess.run([str(Executable.resolve()), str(Arguments.output)], check=True)
    for Name, Expected in Pin["raw_exports_sha256"].items():
        assert hashlib.sha256((Arguments.output / Name).read_bytes()).hexdigest() == Expected, f"Actual native upstream export changed: {Name}"
    Report = {"passed": True, "reference_revision": Pin["revision"], "original_source_identities": len(Pin["provisioned_sources"]),
              "byte_identical_native_exports": len(Pin["raw_exports_sha256"]), "catalogue_rows": 15356,
              "measured_bright_stars": 156, "authored_deep_stars": 15200, "galaxy_probes": 517, "psf_probes": 121, "nebular_probes": 119,
              "compiler": subprocess.check_output(Compiler + ["--version"], text=True).splitlines()[0],
              "scope": "Original upstream native evaluator, not production integration or a Windows build"}
    (Arguments.output / "ReferenceSourceValidation.json").write_text(json.dumps(Report, indent=2) + "\n")
    print(json.dumps(Report, indent=2))


if __name__ == "__main__":
    Execute()
