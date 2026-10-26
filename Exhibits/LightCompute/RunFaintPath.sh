#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 Exhibits/LightCompute/Code/FaintPathProbe.py
Build="$PWD/_ClaudeScratch/build/faint-path"
cp _ClaudeScratch/build/light-compute/*.spv "$Build/"
ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc "$Build/FaintPath.slang" -entry EvaluateFaintPath \
 -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$Build/Receivers.spv"
export VK_ICD_FILENAMES="$PWD/ExternalPackages/VulkanCompute/SwiftShader/vk_swiftshader_icd.json"
_ClaudeScratch/build/light-compute/LightComputeValidation "$PWD/ExternalPackages/VulkanCompute/SwiftShader/libvulkan.so.1" \
 "$Build" --faint-path | tee Exhibits/LightCompute/Results/FaintPath.txt
