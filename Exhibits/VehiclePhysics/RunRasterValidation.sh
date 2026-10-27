#!/usr/bin/env bash
# Matched baseline/current actual-vehicle timing; RunVehiclePhysics.sh prepares pinned Jolt and physics first.
set -euo pipefail
cd "$(dirname "$0")/../.."
BUILD="$PWD/_ClaudeScratch/build/vehicle-raster"
PHYSICS="$PWD/_ClaudeScratch/vehiclephysics"
JOLT="$PWD/_ClaudeScratch/jolt"
RESULTS="$PWD/Exhibits/VehiclePhysics/Results/Raster"
ARCHIVE="$PWD/Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds/Archive"
mkdir -p "$BUILD/before" "$BUILD/after" "$RESULTS"
BASELINE=ae0bb7d5056ed6c1bcae347d5310770a5e431de5
git show "$BASELINE:Exhibits/VehiclePhysics/Code/SceneRender.cpp" > "$BUILD/SceneRenderBefore.cpp"
CXX="${CXX:-g++}"
for VERSION in Before After; do
  EXTRA=()
  SOURCE="$PWD/Exhibits/VehiclePhysics/Code/SceneRender.cpp"
  if [ "$VERSION" = Before ]; then
    EXTRA=(-DRASTER_BASELINE)
    SOURCE="$BUILD/SceneRenderBefore.cpp"
  fi
  "$CXX" -std=c++17 -O2 -Wall -Wextra -Werror -I Frontier -I "$JOLT/JoltPhysics-5.2.0" -DNDEBUG \
    "-DRASTER_SOURCE=\"$SOURCE\"" "${EXTRA[@]}" Exhibits/VehiclePhysics/Code/RasterValidation.cpp \
    "$PHYSICS/VehicleSolver.o" "$PHYSICS/TyreSlipSolver.o" "$PHYSICS/TyreThermalSolver.o" \
    "$PHYSICS/TyreCarcassLattice.o" "$JOLT/libJolt.a" -pthread -o "$BUILD/Raster$VERSION"
done
{
  uname -a
  "$CXX" --version | head -1
  echo "Baseline $BASELINE; current source hash:"
  sha256sum Exhibits/VehiclePhysics/Code/SceneRender.cpp Exhibits/VehiclePhysics/Code/RasterValidation.cpp
  echo 'Flags: -std=c++17 -O2 -Wall -Wextra -Werror -DNDEBUG; CPU, single-threaded rendering'
} > "$RESULTS/Configuration.txt"
# Run only after dependency compilation has finished: no compiler load during the timings.
"$BUILD/RasterBefore" "$BUILD/before" "$ARCHIVE" > "$RESULTS/Before.txt"
"$BUILD/RasterAfter" "$BUILD/after" "$ARCHIVE" > "$RESULTS/After.txt"
"$BUILD/RasterAfter" "$BUILD/after" "$ARCHIVE" > "$RESULTS/AfterRepeat.txt"
"$BUILD/RasterBefore" "$BUILD/before" "$ARCHIVE" > "$RESULTS/BeforeRepeat.txt"
PYTHON="${PYTHON:-python3}"
"$PYTHON" - "$BUILD" "$RESULTS" <<'PY'
import sys
from pathlib import Path
from PIL import Image, ImageDraw
build, results = map(Path, sys.argv[1:])
images = [Image.open(build / version / 'Hero.ppm').convert('RGB') for version in ('before', 'after')]
canvas = Image.new('RGB', (1600, 480), '#151a23')
draw = ImageDraw.Draw(canvas)
for index, (image, label) in enumerate(zip(images, ('Before: linked branch', 'After: cheap Lambert / Blinn'))):
    canvas.paste(image.resize((800, 450)), (index * 800, 30))
    draw.text((index * 800 + 12, 9), label, fill='white')
    image.save(results / ('Before.png' if index == 0 else 'After.png'))
canvas.save(results / 'Comparison.png')
PY
cat "$RESULTS/Before.txt" "$RESULTS/After.txt"
