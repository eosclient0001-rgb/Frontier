#!/usr/bin/env bash
# ============================================================================================================================================
#                                                               RUNCELESTIAL.SH
# ============================================================================================================================================
# 🧩 Reproduce isolated celestial Slang/Vulkan readbacks, independent accuracy checks and retained evidence without GitHub Actions.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
CMAKE="${CMAKE:-cmake}"
CTEST="${CTEST:-ctest}"
PYTHON="${PYTHON:-python3}"
BUILD="${BUILD:-$ROOT/_ClaudeScratch/build/CelestialAtmosphere}"
INPUTS="${INPUTS:-$ROOT/_ClaudeScratch/tmp/CelestialInputs}"
OUTPUT="${OUTPUT:-$ROOT/_ClaudeScratch/tmp/CelestialReadback}"
RETAIN="${RETAIN:-$ROOT/Exhibits/CelestialAtmosphere}"
SLANGC="${SLANGC:-$ROOT/ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc}"
VULKAN_DRIVER="${VULKAN_DRIVER:?Set VULKAN_DRIVER to an explicit Vulkan driver library, not an ICD JSON}"
mkdir -p "$OUTPUT" "$RETAIN/Results"
REFERENCE_OPTIONS=()
[[ "${REFERENCE_OFFLINE:-0}" != 1 ]] || REFERENCE_OPTIONS+=(--offline)
[[ -z "${REFERENCE_SOURCES:-}" ]] || REFERENCE_OPTIONS+=(--sources "$REFERENCE_SOURCES")
"$PYTHON" Exhibits/CelestialAtmosphere/Code/ReproduceCelestialReference.py --output "$OUTPUT/Upstream" "${REFERENCE_OPTIONS[@]}"
cp "$OUTPUT/Upstream/ReferenceSourceValidation.json" "$RETAIN/Results/"
"$PYTHON" Exhibits/CelestialAtmosphere/Code/PrepareCelestial.py "$INPUTS"
OPTIONS=(-DCMAKE_BUILD_TYPE=Release -DFRONTIER_CELESTIAL_SLANG="$SLANGC"
    -DFRONTIER_CELESTIAL_INPUTS="$INPUTS" -DFRONTIER_CELESTIAL_DRIVER="$VULKAN_DRIVER")
[[ -z "${VULKAN_INCLUDE_DIR:-}" ]] || OPTIONS+=(-DVulkan_INCLUDE_DIR="$VULKAN_INCLUDE_DIR")
[[ -z "${VULKAN_LIBRARY:-}" ]] || OPTIONS+=(-DVulkan_LIBRARY="$VULKAN_LIBRARY")
[[ -z "${CMAKE_MAKE_PROGRAM:-}" ]] || OPTIONS+=(-DCMAKE_MAKE_PROGRAM="$CMAKE_MAKE_PROGRAM")
"$CMAKE" -S Experimental/CelestialAtmosphere -B "$BUILD" "${OPTIONS[@]}"
"$CMAKE" --build "$BUILD" --parallel "${JOBS:-2}"
"$CTEST" --test-dir "$BUILD" --output-on-failure -j 1 | tee "$RETAIN/Results/CelestialCTest.txt"
EXECUTABLE="$BUILD/CelestialVulkan"
CATALOGUE_PROBE="$BUILD/CelestialCatalogueProbe"
if [[ -f "$BUILD/CelestialVulkan.exe" ]]; then
    EXECUTABLE="$BUILD/CelestialVulkan.exe"
    CATALOGUE_PROBE="$BUILD/CelestialCatalogueProbe.exe"
fi
"$EXECUTABLE" "$BUILD/Shaders" "$INPUTS" Exhibits/NightSky/Data/Hipparcos8.csv "$OUTPUT" "$VULKAN_DRIVER" render |
    tee "$RETAIN/Results/CelestialCaptures.txt"
"$PYTHON" Exhibits/NightSky/Code/ValidateStarCatalogue.py "$CATALOGUE_PROBE" |
    tee "$RETAIN/Results/StarCatalogue.txt"
RESULTS="$RETAIN/Results/Ephemeris.txt" PYTHON="$PYTHON" bash Exhibits/NightSky/RunEphemerisValidation.sh
"$PYTHON" Exhibits/CelestialAtmosphere/Code/ValidateCelestialControls.py --build "$BUILD" --inputs "$INPUTS" \
    --captures "$OUTPUT" --driver "$VULKAN_DRIVER" --slang "$SLANGC" --output "$OUTPUT/NegativeControls" |
    tee "$RETAIN/Results/CelestialControls.txt"
cp "$BUILD/Numeric/CelestialNumeric.json" "$RETAIN/Results/"
cp "$OUTPUT/NegativeControls/CelestialControls.json" "$RETAIN/Results/"
"$PYTHON" Exhibits/CelestialAtmosphere/Code/InspectCelestial.py "$OUTPUT" --inputs "$INPUTS" --build "$BUILD" --retain "$RETAIN"
"$PYTHON" Exhibits/CelestialAtmosphere/Code/ValidateCelestialEvidence.py "$RETAIN"
