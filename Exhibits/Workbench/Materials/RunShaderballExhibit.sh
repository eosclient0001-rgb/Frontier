#!/usr/bin/env bash
# Shaderball exhibit driver — builds the kept harness and renders the triptych sheet. NOT part of
# CheckMaterialsProof.sh (the full sheet is minutes, not seconds); run on demand or before material milestones.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1
Size="${1:-512}" Spp="${2:-256}"
Bin="$(mktemp -u /tmp/ShaderballExhibit.XXXXXX)"
echo "[ShaderballExhibit] building"
if ! g++ -std=c++20 -O2 -DFRONTIER_CPU_PORT -I Exhibits/Workbench/Materials -I Engine/DisplayPresentation \
     -I Engine/Shaders -I Exhibits/Workbench/Editor Exhibits/Workbench/Materials/ShaderballExhibit.cpp \
     Engine/DisplayPresentation/ShadingTableCodec.cpp -o "$Bin" 2>/tmp/ShaderballExhibit.build; then
    echo "  BUILD FAILED"; head -30 /tmp/ShaderballExhibit.build; exit 1
fi
echo "[ShaderballExhibit] smoke (128px, 8spp)"
if ! "$Bin" --out /tmp/ShaderballExhibit.smoke.png --size 128 --spp 8 2>&1 | tee /tmp/ShaderballExhibit.smoke.log | grep -q "wrote"; then
    echo "  SMOKE FAILED"; tail -5 /tmp/ShaderballExhibit.smoke.log; rm -f "$Bin"; exit 1
fi
if grep -q "bad=[1-9]" /tmp/ShaderballExhibit.smoke.log; then echo "  SMOKE: non-finite pixels"; rm -f "$Bin"; exit 1; fi
echo "[ShaderballExhibit] full sheet (${Size}px, ${Spp}spp)"
"$Bin" --out /tmp/ShaderballExhibit.raw.png --size "$Size" --spp "$Spp" 2>&1 | tail -5
rm -f "$Bin"
if command -v convert >/dev/null 2>&1; then convert /tmp/ShaderballExhibit.raw.png -strip -define png:compression-level=9 Exhibits/Gallery/Materials/ShaderballSheet_GlassClothCoat.png; else cp /tmp/ShaderballExhibit.raw.png Exhibits/Gallery/Materials/ShaderballSheet_GlassClothCoat.png; fi
rm -f /tmp/ShaderballExhibit.raw.png
sha256sum Exhibits/Gallery/Materials/ShaderballSheet_GlassClothCoat.png
