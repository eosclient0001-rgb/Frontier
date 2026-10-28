#!/usr/bin/env bash
# 🧩 Run the pinned original VehicleHMI CPU/source ReSTIR suite in ignored storage.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
REVISION=6afb6f00b5f25c45f7cda92c7da65b64845768f3
DIRECTORY="$ROOT/_ClaudeScratch/vehicle-web/Frontier-$REVISION/Experimental/VehicleHmiPrototype"
RESULTS="${RESULTS:-$ROOT/Exhibits/LightCompute/Results/VehicleHmiRestirSourceTests.txt}"
if [[ ! -f "$DIRECTORY/Tools/RestirPathTracer.test.mjs" ]]; then
    mkdir -p "$ROOT/_ClaudeScratch/vehicle-web"
    curl -fL --retry 2 "https://codeload.github.com/SultanAladin/Frontier/tar.gz/$REVISION" | \
        tar -xz -C "$ROOT/_ClaudeScratch/vehicle-web" --wildcards \
        '*/Experimental/VehicleHmiPrototype/Source/*' '*/Experimental/VehicleHmiPrototype/Shader/*' \
        '*/Experimental/VehicleHmiPrototype/Archive/*' '*/Experimental/VehicleHmiPrototype/Tools/RestirPathTracer.test.mjs' \
        '*/Experimental/VehicleHmiPrototype/package.json'
fi
[[ "$(git hash-object "$DIRECTORY/Shader/ReservoirSpatial.wgsl")" == be6c589140c8fb9bc8ef699c5bb8abdd9284a3e6 ]]
[[ "$(git hash-object "$DIRECTORY/Shader/ReservoirRecords.wgsl")" == a999b1cff7a48f6a34594dd611ce501bda424c7a ]]
[[ "$(git hash-object "$DIRECTORY/Shader/ReservoirTemporal.wgsl")" == a1d4f4eb272f38690ebde1f79d90d59cece6ede9 ]]
mkdir -p "$(dirname "$RESULTS")"
{
    echo "VehicleHMI reference: SultanAladin/Frontier $REVISION"
    echo 'Original Node suite: source and CPU geometry tests, not browser shader execution'
    node --version
    uname -srm
    (cd "$DIRECTORY" && node --test Tools/RestirPathTracer.test.mjs)
} 2>&1 | tee "$RESULTS"
