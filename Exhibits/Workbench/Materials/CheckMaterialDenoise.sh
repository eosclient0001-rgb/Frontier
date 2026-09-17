#!/usr/bin/env bash
# M9 gate — the re-enable milestone. Three things, none of them needing a GPU:
#    ① the live configuration (Engine/DisplayPresentation/ReSTIRIntegrator.cpp compiled as a real TU): the denoiser and
#       the motion-vector reprojection default ON, the tier ladder never turns them off, BuildDispatch sets the two
#       feature bits the shader reads, and the two toggles keep their documented accumulation semantics;
#    ② the shipped shaders, compiled 1:1 as C++: Engine/Shaders/AtrousDenoise.slang through DenoiseCpuShim.h (three
#       mechanical substitutions, re-derived and verified by the proof) — identity switch, mean preservation, edge
#       stopping, variance propagation, early-out equivalence, and the presentation A/B (identical at convergence,
#       different before it);
#    ③ the text audits for what cannot be compiled here (ReSTIRViewport.slang's accumulation + reprojection, the
#       dispatcher's level chain, and the reprojection rule mirror).
#    Headers: Vulkan-Headers ($PWD/ExternalPackages, $MATERIAL_SCENES_EXT, or ~/.cache/m7) for SwapchainExchange.h's
#    DispatchConfiguration. No imgui, no toml, no GPU, no window.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

Vk=""
for candidate in "$PWD/ExternalPackages" "${MATERIAL_SCENES_EXT:-}" "$HOME/.cache/m7"; do
    [ -n "$candidate" ] && [ -f "$candidate/Vulkan-Headers/include/vulkan/vulkan.h" ] && Vk="$candidate" && break
done
if [ -z "$Vk" ]; then
    echo "[MaterialDenoise] RED — Vulkan-Headers not found (tried ExternalPackages/, \$MATERIAL_SCENES_EXT, ~/.cache/m7)"
    exit 1
fi
echo "[MaterialDenoise] headers: $Vk"

#──────────────────────────────────────────────────────────────────────────────────────────────────────────────
# ① the transformed shader: three mechanical substitutions, each asserted, then re-derived by the proof (§C0).
#──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Stage="$(mktemp -d /tmp/DenoiseMirror.XXXXXX)"
if ! DO_STAGE="$Stage" python3 - <<'PY'
import os, re, sys
stage = os.environ["DO_STAGE"]
source = "Engine/Shaders/AtrousDenoise.slang"
lines = open(source, encoding="utf-8").read().split("\n")

prologue = [i for i, l in enumerate(lines) if l.startswith("#") or l.startswith("layout(local_size")]
assert len(prologue) == 2, f"expected 2 prologue lines (#version + the workgroup size), found {len(prologue)}"
assert lines[prologue[0]].startswith("#version") and lines[prologue[1]].startswith("layout(local_size"), "unexpected prologue"
array_lines = [i for i, l in enumerate(lines) if "float[5](" in l]
assert len(array_lines) == 1, f"expected 1 GLSL array constructor, found {len(array_lines)}"
closers = [i for i, l in enumerate(lines) if l.strip() == "};"]
push = [i for i, l in enumerate(lines) if "push_constant" in l]
assert len(closers) == 1 and len(push) == 1 and closers[0] > push[0], "push-constant block not found as a single '};'"
assert lines[push[0]] == "layout(push_constant) uniform DenoiseConstants", f"unexpected push-constant opener: {lines[push[0]]!r}"
split = closers[0]
array = array_lines[0]

values = re.findall(r"-?\d+\.?\d*", lines[array].split("float[5](")[1])
assert len(values) == 5, f"array constructor has {len(values)} literals"
replacement = "    const float Weights[5] = float[5](" + ", ".join(values) + ");"

drop = set(prologue)
body = [l for i, l in enumerate(lines) if i not in drop]
# Re-index after the prologue removal, then rewrite the array line and close the push block with its instance.
shift = sum(1 for i in prologue if i < array)
shift_push = sum(1 for i in prologue if i < push[0])
shift_close = sum(1 for i in prologue if i < split)
body[array - shift] = "    const float Weights[5] = { " + ", ".join(v + "f" for v in values) + " };"
body[push[0] - shift_push] = "struct DenoiseConstants"
body[split - shift_close] = body[split - shift_close].replace("};", "} DenoiseParameters;")

open(os.path.join(stage, "AtrousDenoise.cpu.1.h"), "w", encoding="utf-8").write("\n".join(body[:split - shift_close + 1]) + "\n")
open(os.path.join(stage, "AtrousDenoise.cpu.2.h"), "w", encoding="utf-8").write("\n".join(body[split - shift_close + 1:]))
open(os.path.join(stage, "transform.manifest"), "w", encoding="utf-8").write(
    f"source {source}\n"
    f"dropped {lines[prologue[0]]}\n"
    f"dropped {lines[prologue[1]]}\n"
    f"rewrote {lines[array].strip()}\n"
    f"        -> {body[array - shift].strip()}\n"
    f"rewrote {lines[push[0]].strip()}\n"
    f"        -> {body[push[0] - shift_push].strip()}\n"
    f"split after {body[split - shift_close].strip()}\n")
print("[MaterialDenoise] staged " + stage)
PY
then
    echo "[MaterialDenoise] RED — the shader did not match the transform's expectations"; rm -rf "$Stage"; exit 1
fi
sed 's/^/    /' "$Stage/transform.manifest"

#──────────────────────────────────────────────────────────────────────────────────────────────────────────────
# ② compile the gate: the mirror TU (shader as C++) + the real engine TUs + the proof.
#──────────────────────────────────────────────────────────────────────────────────────────────────────────────
Bin="$(mktemp -u /tmp/MaterialDenoise.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra -ffunction-sections -fdata-sections -Wl,--gc-sections -DFRONTIER_CPU_PORT \
     -I Exhibits/Workbench/Materials -I Engine/DisplayPresentation -I Engine/ContentInterchange -I Engine/DeviceExchange \
     -I Engine/GeometricRaster -I Engine/Shaders -I Projects/Project-Zero/Source -I "$Stage" -I "$Vk/Vulkan-Headers/include" \
     Exhibits/Workbench/Materials/DenoiseReprojectionProof.cpp \
     Exhibits/Workbench/Materials/AtrousDenoiseMirror.cpp \
     Engine/DisplayPresentation/ReSTIRIntegrator.cpp \
     Engine/DisplayPresentation/ExposureIntegrator.cpp \
     Engine/DisplayPresentation/FidelityClassifier.cpp \
     Projects/Project-Zero/Source/FlyThroughSolver.cpp \
     Engine/GeometricRaster/CameraProjection.cpp \
     Engine/DeviceExchange/InputExchange.cpp \
     Engine/DeviceExchange/OrientationClassifier.cpp \
     -o "$Bin" 2>/tmp/MaterialDenoise.build; then
    echo "[MaterialDenoise] COMPILE FAILED"; sed 's/^/    /' /tmp/MaterialDenoise.build | head -40; rm -rf "$Stage"; exit 1
fi
if [ -s /tmp/MaterialDenoise.build ]; then echo "[MaterialDenoise] warnings:"; sed 's/^/    /' /tmp/MaterialDenoise.build | head -20; fi

DO_STAGE="$Stage" "$Bin" 2>&1 | tee /tmp/MaterialDenoise.log
if ! grep -q "MATERIAL DENOISE: PASS" /tmp/MaterialDenoise.log; then
    echo "[MaterialDenoise] RED"; grep "FAIL" /tmp/MaterialDenoise.log | sed 's/^/    /' | head -30; rm -f "$Bin"; rm -rf "$Stage"; exit 1
fi
grep -c "^ok " /tmp/MaterialDenoise.log | xargs echo "[MaterialDenoise] GREEN — checks passed:"
rm -f "$Bin"; rm -rf "$Stage"
