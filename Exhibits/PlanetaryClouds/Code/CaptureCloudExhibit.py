#!/usr/bin/env python3
# ============================================================================================================================================
#                                                        CAPTURECLOUDEXHIBIT.PY
# ============================================================================================================================================
# 🧩 Reproducible native cloud views and a discrete wind timelapse, without image filtering or temporal colour reuse.

import argparse
from dataclasses import replace
from pathlib import Path
import json

import numpy as Np
from PIL import Image

import RenderClouds as Clouds
from MeasureClouds import RetainCapture


# ------------------------------------------------------------------------------------------------------------------------
#                                                      CAPTURE SPECIFICATIONS
# ------------------------------------------------------------------------------------------------------------------------

Captures = (
    ("cumulus", 640, 360, 384, 32, 2),
    ("cumulonimbus", 512, 288, 384, 32, 2),
    ("cirrus", 512, 288, 256, 24, 2),
    ("above", 480, 270, 320, 24, 2),
    ("sunset", 480, 270, 320, 24, 2),
    ("cyclone", 480, 270, 384, 32, 2),
    ("eye", 384, 216, 384, 32, 2),
    ("limb", 384, 216, 384, 32, 2),
)
FormationViews = ("stratocumulus", "stratus", "altocumulus", "altostratus", "nimbostratus",
                  "cirrostratus", "cirrocumulus", "towering")


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--library", type=Path, required=True)
    Parser.add_argument("--noise", type=Path, required=True)
    Parser.add_argument("--out", type=Path, default=Clouds.Root / "_ClaudeScratch/tmp/CloudFinalCaptures")
    Parser.add_argument("--resume", action="store_true")
    Arguments = Parser.parse_args()
    Integration = Clouds.NativeIntegration(Arguments.library.resolve(), Arguments.noise.resolve())
    Arguments.out.mkdir(parents=True, exist_ok=True)
    Reports = []
    for Name, Width, Height, Steps, LightSteps, Samples in Captures + tuple(
            (Name, 256, 144, 160, 12, 1) for Name in FormationViews):
        View = Clouds.Views[Name]
        Destination = Arguments.out / View.Name
        Metadata = Destination.with_suffix(".json")
        if Arguments.resume and Metadata.exists():
            Report = json.loads(Metadata.read_text())
            assert Report["source_sha256"] == Integration.SourceIdentity, "stale capture during resume"
            assert all(Report[Key] == Number for Key, Number in (("width", Width), ("height", Height),
                       ("steps", Steps), ("light_steps", LightSteps), ("samples", Samples))), "capture settings changed"
        else:
            Pixels, Report = RetainCapture(Integration, View, Destination, Width, Height, Steps, LightSteps, Samples)
        Reports.append(Report)
    for Seconds in (0, 30, 60, 90, 120, 150):
        View = replace(Clouds.Views["cumulus"], Name=f"Wind{Seconds:03d}", Time=float(Seconds))
        Destination = Arguments.out / View.Name
        Metadata = Destination.with_suffix(".json")
        if Arguments.resume and Metadata.exists():
            Report = json.loads(Metadata.read_text())
            assert Report["source_sha256"] == Integration.SourceIdentity
        else:
            Pixels, Report = RetainCapture(Integration, View, Destination, 320, 180, 256, 24, 2)
        Reports.append(Report)
    (Arguments.out / "Captures.json").write_text(json.dumps({"source_sha256": Integration.SourceIdentity,
        "execution": "Slang native C++ target", "captures": Reports, "photorealism_accepted": False,
        "production_accepted": False}, indent=2) + "\n")


if __name__ == "__main__":
    Main()
