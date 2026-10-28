#!/usr/bin/env bash
# 🧩 Check temporal replay reservoir intake and valid-history parity.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TOOLS="${VULKAN_TOOLS:-$ROOT/ExternalPackages/VulkanCompute}"
CMAKE="${CMAKE:-cmake}"
CTEST="${CTEST:-ctest}"
SLANG="${SLANGC:-$TOOLS/Slang/slangtorch/bin/slangc}"
DRIVER="${VULKAN_LIBRARY:-$TOOLS/SwiftShader/libvulkan.so.1}"
if [[ -z "${VULKAN_LIBRARY:-}" ]]; then export VK_ICD_FILENAMES="$TOOLS/SwiftShader/vk_swiftshader_icd.json"; fi
export LD_LIBRARY_PATH="$TOOLS/SwiftShader${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
MODE=release
OPTIONS=(-DCMAKE_BUILD_TYPE=Release)
if [[ "${SANITIZE:-0}" == 1 ]]; then
    MODE=sanitized
    OPTIONS=(-DCMAKE_BUILD_TYPE=Debug '-DCMAKE_CXX_FLAGS=-fsanitize=address,undefined -fno-omit-frame-pointer'
             '-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined')
    export ASAN_OPTIONS="${ASAN_OPTIONS:-detect_leaks=0}" UBSAN_OPTIONS="${UBSAN_OPTIONS:-halt_on_error=1}"
fi
BUILD="$ROOT/_ClaudeScratch/build/replay-intake-$MODE"
RESULTS="${RESULTS:-$ROOT/Exhibits/LightCompute/Results/ReplayReservoirIntake-$MODE.txt}"
mkdir -p "$BUILD" "$(dirname "$RESULTS")"
compile_replay() {
    local SOURCE="$1" DESTINATION="$2"
    for PAIR in 'GenerateReplayReservoirs ReplayGenerate' 'ResolveReplayReservoirs ReplayResolve'; do
        read -r ENTRY STEM <<< "$PAIR"
        "$SLANG" "$SOURCE" -I Frontier/Engine/Rendering/Shaders -entry "$ENTRY" -target spirv \
            -profile spirv_1_3 -emit-spirv-directly -O0 -o "$DESTINATION/$STEM.spv"
    done
}
compile_replay Frontier/Engine/Rendering/Shaders/PathReplayReservoir.slang "$BUILD"
"$SLANG" Frontier/Engine/Rendering/Shaders/LightInfluence.slang -entry TracePrimarySurfaces -target spirv \
    -profile spirv_1_3 -emit-spirv-directly -O0 -o "$BUILD/Primary.spv"
if [[ "${PARITY:-0}" == 1 ]]; then
    mkdir -p "$BUILD/prior"
    git show 3de9061:Frontier/Engine/Rendering/Shaders/PathReplayReservoir.slang > "$BUILD/prior/PathReplayReservoir.slang"
    compile_replay "$BUILD/prior/PathReplayReservoir.slang" "$BUILD/prior"
    cp "$BUILD/Primary.spv" "$BUILD/prior/Primary.spv"
fi
"$CMAKE" -S Exhibits/LightCompute -B "$BUILD" "${OPTIONS[@]}" >/dev/null
"$CMAKE" --build "$BUILD" --parallel "${BUILD_JOBS:-2}" >/dev/null
{
    echo "Temporal reservoir intake: $MODE; external driver and shader are not sanitizer-instrumented"
    echo "Base $(git rev-parse --short HEAD), plus working changes; source hashes below"
    uname -srm
    "${CXX:-c++}" --version | head -1
    "$SLANG" -version 2>&1
    sha256sum Frontier/Engine/Rendering/Shaders/{PathReplayReservoir,PathReplaySampleHistory}.slang \
        Exhibits/LightCompute/Code/{LightComputeValidation.cpp,ReplaySampleHistoryValidation.h} \
        Exhibits/LightCompute/RunReplayReservoirIntake.sh
    "$CTEST" --test-dir "$BUILD" --output-on-failure
    "$BUILD/LightComputeValidation" "$DRIVER" "$BUILD" --replay-reservoir-intake
    if [[ "${PARITY:-0}" == 1 ]]; then
        echo 'Prior shader: 3de9061; valid-history parity:'
        "$BUILD/LightComputeValidation" "$DRIVER" "$BUILD" --replay-candidates-parity "$BUILD/prior"
    fi
} 2>&1 | tee "$RESULTS"
