#!/usr/bin/env bash
#============================================================================================================================================
#                                                     CHECKTELEMETRYROWS.SH
#============================================================================================================================================
# ProjectZero_TelemetryReport must contain performance and GPU measurement rows.
#
#    It did not. The frame loop logged frame times, per-stage GPU timings and cluster counts — but all of it through
#    RecordMessage, which writes a sentence. RecordMeasurement writes the row. Nothing in the application called it.
#
#    usage: bash Tools/Build/CheckTelemetryRows.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

Stage="$(mktemp -d)"
trap 'rm -rf "$Stage"' EXIT

g++ -std=c++20 -O1 -g -I. \
    -o "$Stage/TelemetryRowGate" \
    Tools/Build/Gates/TelemetryRowGate.cpp \
    Engine/DeviceExchange/DiagnosticMetrics.cpp

( cd "$Stage" && "$Stage/TelemetryRowGate" "$OLDPWD/Projects/Project-Zero/Source/GameExecution.cpp" )
