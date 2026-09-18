#!/usr/bin/env bash
#============================================================================================================================================
#                                                CHECKPERFORMANCETRACE.SH
#============================================================================================================================================
# Runs Project-Zero's PerformanceTrace ledger twice: once compiled IN (a development build), once compiled OUT
#    (a production build). The second pass is the point: the ledger and every call site in the application live
#    behind #if FRONTIER_PERFORMANCE_TRACE, so a build without FRONTIER_DEVELOPMENT/FRONTIER_DEBUG must not parse
#    a single trace call — and the same source compiled that way proves it by producing a main with no trace in it.
#
#    Pass ① constructs the shipped ledger, feeds it nested synthetic stages, per-frame queue-path scratch, three
#    synthetic frames and named samples, points WriteReport at a staging directory, and asserts both the in-process
#    values and the written report (RAM-only ledger, one idempotent write, stage table, frame CSV).
#
#    usage: bash Tools/Build/CheckPerformanceTrace.sh

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

Failures=0
Pass() { echo "  PASS  $1"; }
Fail() { echo "  FAIL  $1"; Failures=$((Failures + 1)); }

Stage="$(mktemp -d)"
trap 'rm -rf "$Stage"' EXIT

# ── Pass ① — the ledger compiled IN, exactly as -Development (editor) or -Configuration Debug defines it ─────────────
if ! g++ -std=c++20 -O1 -g -DFRONTIER_DEVELOPMENT -I. \
        -o "$Stage/TraceGateOn" \
        Tools/Build/Gates/PerformanceTraceGate.cpp \
        Engine/DeviceExchange/PerformanceTrace.cpp
then
    echo "[perf-trace] the ledger TU itself does not compile with FRONTIER_DEVELOPMENT" >&2
    exit 2
fi
( cd "$Stage" && "$Stage/TraceGateOn" "$Stage" )
GateStatus=$?
if [ $GateStatus -ne 0 ]; then
    echo "[perf-trace] GREEN/RED line above; gate exited $GateStatus" >&2
    Fail "the in-process assertions did not hold (exit $GateStatus)"
fi

Report="$Stage/ProjectZero_PerformanceTrace.md"
[ -f "$Report" ] && Pass "the report exists after exactly one WriteReport" || Fail "no report was written"

# ── Pass ② — the ledger compiled OUT: neither FRONTIER_DEVELOPMENT nor FRONTIER_DEBUG — a production build ───────────
if ! g++ -std=c++20 -O2 -I. \
        -o "$Stage/TraceGateOff" \
        Tools/Build/Gates/PerformanceTraceGate.cpp \
        Engine/DeviceExchange/PerformanceTrace.cpp
then
    Fail "the ledger TU does not compile without the gate define — it must compile to an empty shell"
    exit 1
fi

TraceOffOutput="$("$Stage/TraceGateOff")"
if echo "$TraceOffOutput" | grep -q "trace compiled out"; then
    Pass "with no development/debug define the same source parses no trace code"
else
    Fail "the production build leaked trace code into main"
fi

OffSymbols="$(nm -C "$Stage/TraceGateOff" 2>/dev/null | grep -c "PerformanceTrace::" || true)"
if [ "$OffSymbols" -eq 0 ]; then
    Pass "the compiled-out binary carries no PerformanceTrace symbols at all"
else
    Fail "the compiled-out binary still defines $OffSymbols PerformanceTrace symbols"
fi

if grep -q "FRONTIER_PERFORMANCE_TRACE = 1" "$Report" 2>/dev/null; then
    Pass "the report states the gate that compiled it in"
else
    Fail "the report does not state its own gate"
fi

if [ $Failures -eq 0 ]; then
    echo ""
    echo "[perf-trace] GREEN — the ledger fills and writes once when the build is a development build,"
    echo "             and compiles to nothing when it is not"
    exit 0
else
    echo ""
    echo "[perf-trace] RED — $Failures failure(s)" >&2
    exit 1
fi
