#!/usr/bin/env bash
# Reproduce the night-sky exhibit: build the native CPU renderer, run its checks, convert captures to PNG.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$ROOT/_ClaudeScratch/build/night-sky"
mkdir -p "$BUILD" "$ROOT/Exhibits/NightSky/Capture" "$ROOT/Exhibits/NightSky/Images"
g++ -std=c++17 -O2 -Wall -Wextra -Werror -I "$ROOT/Frontier" \
    "$ROOT/Exhibits/NightSky/Code/NightSkyValidation.cpp" \
    "$ROOT/Frontier/Engine/Rendering/CelestialModel.cpp" -o "$BUILD/NightSkyValidation"
"$BUILD/NightSkyValidation" "$ROOT/Exhibits/NightSky/Capture/" | tee "$ROOT/Exhibits/NightSky/Results.txt"
python3 "$ROOT/Exhibits/NightSky/Code/NightSkyImages.py" "$ROOT/Exhibits/NightSky/Capture" "$ROOT/Exhibits/NightSky/Images"
