#!/usr/bin/env python3
# ============================================================================================================================================
#                                                         CLOUDSOURCEIDENTITY.PY
# ============================================================================================================================================
# 🧩 Exact authored shader, native execution and deterministic noise input identity for every compiled cloud library.

from hashlib import sha256
from pathlib import Path

Root = Path(__file__).resolve().parents[3]
Source = Root / "Experimental/PlanetaryClouds"


def QuerySourcePaths():
    return sorted(Source.glob("*.slang")) + [Source / "CloudNative.cpp", Source / "CloudNoiseVolume.h",
                                            Path(__file__).with_name("BakeCloudNoise.cpp")]


def QuerySourceIdentity():
    return sha256(b"".join(PathName.read_bytes() for PathName in QuerySourcePaths())).hexdigest()


if __name__ == "__main__":
    print(QuerySourceIdentity())
