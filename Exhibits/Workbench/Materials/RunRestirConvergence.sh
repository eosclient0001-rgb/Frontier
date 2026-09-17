#!/usr/bin/env bash
# CPU ReSTIR — the FIX-EVIDENCE sheet: what the two reuse paths were doing before, and what they do now.
#
#    The standard sheet (RunRestirViewport.sh) shows the product pipeline. This one shows the two convergence
#    paths the sheet cannot: every panel is the SAME renderer at the SAME budget, one switch apart, and each cell
#    carries its error against ①. Read it left to right, top to bottom:
#
#      ① the converged reference (brute force, 512 spp, one frame)
#      ② brute force at the same budget as the ReSTIR cells (4 spp × 128 frames)
#      ③ ReSTIR, 128 frames, 0 spatial taps   ⎫ the pre-fix signature was ③ improving with frames while ④ and ⑤
#      ④ ReSTIR, 128 frames, 2 spatial taps   ⎬ DEGRADED — spatial reuse fed its own output back into the
#      ⑤ ReSTIR, 128 frames, 4 spatial taps   ⎭ temporal history, so M compounded (mean 1 879, max 4 436 at
#                                                frame 16; 843 633 by frame 20). The fix: history takes the
#                                                TEMPORAL reservoir, and a tap's M cap reads the receiver's
#                                                PRE-merge count. Now more taps is strictly better.
#      ⑥ ④ with --restir-no-history-split (the fix's own A/B: history := post-spatial, the old loop)
#      ⑦ ④ with --restir-no-gi-reuse (the indirect half's single-sample arm)
#      ⑧ ④                                  (the indirect half's pool: ReSTIR GI-style reuse of the first-bounce
#                                            vertex's NEE stratum, temporally and over the same taps)
#
#    Deterministic, like the standard sheet: every RNG is seeded from (pixel, sample index, frame).
#    Usage: RunRestirConvergence.sh [fast|full]
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

Mode="${1:-full}"
Host="Projects/Project-Zero/Host"
Bin="$Host/MaterialLevelViewport"
Gallery="Exhibits/Gallery/Materials"
Work="$(mktemp -d /tmp/RestirConvergence.XXXXXX)"
trap 'rm -rf "$Work"' EXIT

Vk=""
for candidate in "$PWD/ExternalPackages" "${MATERIAL_SCENES_EXT:-}" "$HOME/.cache/m7"; do
    [ -n "$candidate" ] && [ -f "$candidate/Vulkan-Headers/include/vulkan/vulkan.h" ] && Vk="$candidate" && break
done
if [ -z "$Vk" ]; then
    echo "[RestirConvergence] RED — Vulkan-Headers not found (tried ExternalPackages/, \$MATERIAL_SCENES_EXT, ~/.cache/m7)"
    exit 1
fi

echo "[RestirConvergence] building the Project-Zero CPU viewport"
if ! make -C "$Host" MaterialLevelViewport >/tmp/RestirConvergence.build 2>&1; then
    echo "[RestirConvergence] BUILD FAILED"; sed 's/^/    /' /tmp/RestirConvergence.build | tail -25; exit 1
fi

W=240; H=135; Spp=4; Frames=128; Reference=512; Taps=2
if [ "$Mode" = "fast" ]; then W=160; H=90; Spp=2; Frames=16; Reference=64; fi

Render() { # $1 = tag, $2 = extra args, $3 = label
    echo "[RestirConvergence] $3"
    "$Bin" --width "$W" --height "$H" --view default --out "$Work/$1.png" $2 > "$Work/$1.log" 2>&1 || {
        echo "[RestirConvergence] RED — $1 exited $?"; sed 's/^/    /' "$Work/$1.log" | tail -20; exit 1; }
    grep -E "\[restir( gi)?\] +frame +$Frames:|reservoirs:|film:" "$Work/$1.log" | sed 's/^/    /'
    if ! grep -q ", 0 non-finite/out-of-range samples" "$Work/$1.log"; then
        echo "[RestirConvergence] RED — $1 has non-finite or out-of-range samples"; exit 1
    fi
}

Render reference "--spp $Reference --frames 1" \
       "① reference — brute force, ${Reference} spp, 1 frame"
Render plain     "--spp $Spp --frames $Frames" \
       "② brute force at the same budget — ${Spp} spp × ${Frames} frames"
Render taps0     "--spp $Spp --frames $Frames --restir --taps 0" \
       "③ ReSTIR — ${Frames} frames, 0 spatial taps"
Render taps2     "--spp $Spp --frames $Frames --restir --taps 2" \
       "④ ReSTIR — ${Frames} frames, ${Taps} spatial taps"
Render taps4     "--spp $Spp --frames $Frames --restir --taps 4" \
       "⑤ ReSTIR — ${Frames} frames, 4 spatial taps"
Render splitoff  "--spp $Spp --frames $Frames --restir --taps $Taps --restir-no-history-split" \
       "⑥ the history split OFF (spatial feeds temporal — the old loop)"
Render gioff     "--spp $Spp --frames $Frames --restir --taps $Taps --restir-no-gi-reuse" \
       "⑦ the indirect half's single-sample arm (no pool)"
Render gion      "--spp $Spp --frames $Frames --restir --taps $Taps" \
       "⑧ the indirect half's pool (ReSTIR GI-style reuse on)"

echo "[RestirConvergence] error against ① (display space, RMSE / normalised):"
for panel in plain taps0 taps2 taps4 splitoff gioff gion; do
    printf "    %-9s " "$panel"
    compare -metric RMSE "$Work/$panel.png" "$Work/reference.png" null: 2>&1; echo
done
printf "    %-9s " "④vs⑦"
compare -metric RMSE "$Work/taps2.png" "$Work/gioff.png" null: 2>&1; echo
printf "    %-9s " "④vs⑥"
compare -metric RMSE "$Work/taps2.png" "$Work/splitoff.png" null: 2>&1; echo

Sheet="$Gallery/RestirConvergenceSheet.png"
montage -label "① reference — brute force ${Reference} spp" "$Work/reference.png" \
        -label "② brute force — ${Spp} spp × ${Frames} frames" "$Work/plain.png" \
        -label "③ ReSTIR — 0 taps" "$Work/taps0.png" \
        -label "④ ReSTIR — ${Taps} taps" "$Work/taps2.png" \
        -label "⑤ ReSTIR — 4 taps" "$Work/taps4.png" \
        -label '⑥ history split OFF (the old loop)' "$Work/splitoff.png" \
        -label '⑦ indirect, single-sample arm' "$Work/gioff.png" \
        -label '⑧ indirect pool on (GI reuse)' "$Work/gion.png" \
        -tile 4x2 -geometry +6+6 -background '#141414' -fill '#e8e8e8' -font DejaVu-Sans -pointsize 15 \
        "$Sheet"
echo "[RestirConvergence] wrote $Sheet"
sha256sum "$Sheet"
