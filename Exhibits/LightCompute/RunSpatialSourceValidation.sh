#!/usr/bin/env bash
# 🧩 Execute the retained VehicleHMI spatial shader in a controlled WebGPU fixture.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[[ "$(git hash-object Experimental/VehicleHmiReference/Shader/PackingCodec.wgsl)" == d8f6d426cbaccd94e782f424f89a354266232a04 ]]
[[ "$(git hash-object Experimental/VehicleHmiReference/Shader/ReservoirRecords.wgsl)" == a999b1cff7a48f6a34594dd611ce501bda424c7a ]]
[[ "$(git hash-object Experimental/VehicleHmiReference/Shader/ReservoirSpatial.wgsl)" == be6c589140c8fb9bc8ef699c5bb8abdd9284a3e6 ]]
TOOLS="${VULKAN_TOOLS:-$ROOT/ExternalPackages/VulkanCompute}"
export VK_ICD_FILENAMES="${VK_ICD_FILENAMES:-$TOOLS/SwiftShader/vk_swiftshader_icd.json}"
export LD_LIBRARY_PATH="$TOOLS/SwiftShader${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PYTHONPATH="$ROOT/ExternalPackages/WebGpuTools${PYTHONPATH:+:$PYTHONPATH}"
export WGPU_BACKEND_TYPE=Vulkan
RESULTS="${RESULTS:-$ROOT/Exhibits/LightCompute/Results/SpatialSourceValidation.txt}"
mkdir -p "$(dirname "$RESULTS")"
{
    echo 'VehicleHMI source WGSL: upstream 6afb6f00b5f25c45f7cda92c7da65b64845768f3; controlled fixture'
    echo 'Host source files verified as Git blobs; WebGPU through wgpu-native on Vulkan'
    python3 --version
    uname -srm
    sha256sum Exhibits/LightCompute/Code/SpatialSourceValidation.py
    "${PYTHON:-python3}" Exhibits/LightCompute/Code/SpatialSourceValidation.py
} 2>&1 | tee "$RESULTS"
