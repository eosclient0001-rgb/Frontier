#!/usr/bin/env bash
# Reproduce the night-sky exhibit: build the native CPU renderer, run its 19 checks, convert captures to PNG.
# PNG conversion needs Pillow (PyPI). Set PYTHON to a Python with Pillow installed, e.g. a virtualenv.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$ROOT/_ClaudeScratch/build/night-sky"
CAPTURE="$ROOT/_ClaudeScratch/night-sky"
PYTHON="${PYTHON:-python3}"
mkdir -p "$BUILD" "$CAPTURE" "$ROOT/Exhibits/NightSky/Images"
g++ -std=c++17 -O2 -Wall -Wextra -Werror -I "$ROOT/Frontier" \
    "$ROOT/Exhibits/NightSky/Code/NightSkyValidation.cpp" \
    "$ROOT/Frontier/Engine/Rendering/CelestialModel.cpp" \
    "$ROOT/Frontier/Engine/Rendering/AtmosphereModel.cpp" -o "$BUILD/NightSkyValidation"
"$BUILD/NightSkyValidation" "$CAPTURE/" "$ROOT/Exhibits/NightSky/Data/Hipparcos8.csv" | tee "$ROOT/Exhibits/NightSky/Results.txt"
"$PYTHON" "$ROOT/Exhibits/NightSky/Code/NightSkyImages.py" "$CAPTURE" "$ROOT/Exhibits/NightSky/Images"
