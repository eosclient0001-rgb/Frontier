#!/usr/bin/env bash
# 🧩 Reproduce the real-world verification: production sky/Sun/Moon/flare + tyre vs published measurements.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$ROOT/_ClaudeScratch/build/real-world"
mkdir -p "$BUILD"
g++ -std=c++17 -O2 -Wall -Wextra -Werror -I "$ROOT/Frontier" \
    "$ROOT/Exhibits/NightSky/Code/RealWorldValidation.cpp" \
    "$ROOT/Frontier/Engine/Rendering/CelestialModel.cpp" \
    "$ROOT/Frontier/Engine/Rendering/AtmosphereModel.cpp" \
    "$ROOT/Frontier/Engine/Physics/TyreSlipSolver.cpp" -o "$BUILD/RealWorldValidation"
"$BUILD/RealWorldValidation" "$ROOT/EngineContent/CelestialMaps/MoonAlbedo1024.ppm" \
    | tee "$ROOT/Exhibits/NightSky/ResultsRealWorld.txt"
