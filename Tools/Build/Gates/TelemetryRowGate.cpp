//============================================================================================================================================
//                                                       TELEMETRYROWGATE.CPP
//============================================================================================================================================
// The telemetry report must contain performance and GPU rows.
//
//    ProjectZero_TelemetryReport had no performance or GPU measurements in it at all. The frame loop was not silent —
//    it logged frame times, per-stage GPU timings and cluster counts — but every one of those went through
//    RecordMessage, which writes a SENTENCE. RecordMeasurement is the call that writes a
//    "Measurement: <token> = <value> [<unit>]" row, and the application never called it once; only the offline
//    CpuReferenceMain did. So the numbers existed, scrolled past in prose, and nothing could parse, diff or trend
//    them. "No perf rows in the report" was exactly right.
//
//    This gate drives the real DiagnosticMetrics sink and asserts the rows it must emit, then checks the shipped
//    GameExecution.cpp actually calls RecordMeasurement for each required token — the sink being capable of writing
//    a row means nothing if the frame loop never asks for one.
//
//    usage: bash Tools/Build/CheckTelemetryRows.sh

#include "Engine/DeviceExchange/DiagnosticMetrics.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using namespace Frontier;

namespace {

int Failures = 0;

void Check(bool Condition, const std::string& Message)
{
    std::printf("  %s  %s\n", Condition ? "PASS" : "FAIL", Message.c_str());
    if (!Condition) ++Failures;
}

// Every token the frame loop must put in the report, grouped the way a reader would want them.
const char* const kCpuTokens[] = {
    "FrameTimeMeanMs", "FrameTimePeakMs", "FramesPerSecond", "FrameSampleCount", "ResidentMemory",
};
const char* const kGpuTokens[] = {
    "GpuFrameTotalMs", "GpuCullMs", "GpuRasterMs", "GpuHiZMs", "GpuResolveMs",
    "GpuReSTIRMs", "GpuShadowMs", "GpuPostMs", "GpuSkyMs", "GpuVolumeMs",
};
const char* const kWorkloadTokens[] = {
    "RenderPixels", "ReSTIRCandidates", "ReSTIRExtra", "ReSTIRSpatialTaps", "DenoiseLevels",
    "GpuBound", "ReSTIRShareOfFrame",
    "ClustersTested", "ClustersFrustum", "ClustersCone", "ClustersVisible", "TrianglesDrawn", "DrawCalls",
};

std::string SlurpFile(const std::string& Path)
{
    std::ifstream In(Path, std::ios::binary);
    std::ostringstream Buffer;
    Buffer << In.rdbuf();
    return Buffer.str();
}

} // namespace

int main(int ArgumentCount, char** ArgumentValues)
{
    const std::string Source = ArgumentCount > 1 ? ArgumentValues[1]
                                                 : "Projects/Project-Zero/Source/GameExecution.cpp";

    std::printf("================================================================================\n");
    std::printf("   TELEMETRY ROW GATE — the report must carry performance and GPU measurements\n");
    std::printf("================================================================================\n");

    // ── ① the sink writes a parseable row ───────────────────────────────────────────────────────────────────────
    //    RecordMeasurement's output format is what any downstream reader keys on, so it is asserted literally
    //    rather than assumed.
    {
        DiagnosticConfiguration Config{};
        Config.DestinationFolder          = ".";
        Config.OutputFileStem             = "TelemetryRowGate_Probe";
        Config.FileExtension              = ".md";
        Config.TimestampPrefixEnabled     = false;
        Config.ConsoleEchoEnabled         = false;
        // The shipped report is a markdown table, which is exactly where the missing rows were noticed.
        Config.MarkdownTableFormatEnabled = true;

        const std::string Path = "./TelemetryRowGate_Probe.md";
        {
            DiagnosticMetrics Sink(Config);
            if (!Sink.InitializeSink())
            {
                std::printf("  FAIL  the diagnostic sink would not open\n");
                return 1;
            }
            Sink.RecordMeasurement("FrameTimeMeanMs", 16.25, "ms");
            Sink.RecordMessage(DiagnosticSeverity::Information, "Performance", "CPU 16.25 ms/frame - prose, not a row");
            Sink.FlushSink();
            Sink.TerminateSink();
        }
        const std::string Written = SlurpFile(Path);
        std::remove(Path.c_str());

        Check(Written.find("Measurement: FrameTimeMeanMs = 16.25 [ms]") != std::string::npos,
              "RecordMeasurement writes a parseable 'Measurement: <token> = <value> [<unit>]' row");
        Check(Written.find("TelemetryMetrics") != std::string::npos,
              "rows land under the TelemetryMetrics category, so they can be filtered out of the prose");
    }

    // ── ② the frame loop actually asks for those rows ───────────────────────────────────────────────────────────
    //    This is the half that was missing. A sink that CAN write rows is useless if nothing calls it.
    const std::string Code = SlurpFile(Source);
    if (Code.empty())
    {
        std::printf("  FAIL  cannot read %s\n", Source.c_str());
        return 1;
    }

    const auto Emits = [&](const char* Token)
    {
        // Look for the call, not merely the token: the string could appear in a comment.
        return Code.find(std::string("RecordMeasurement(\"") + Token + "\"") != std::string::npos;
    };

    std::printf("\nCPU rows:\n");
    for (const char* Token : kCpuTokens)      Check(Emits(Token), std::string("the frame loop records ") + Token);
    std::printf("GPU rows (device timestamp pool):\n");
    for (const char* Token : kGpuTokens)      Check(Emits(Token), std::string("the frame loop records ") + Token);
    std::printf("Workload rows (what makes the milliseconds mean something):\n");
    for (const char* Token : kWorkloadTokens) Check(Emits(Token), std::string("the frame loop records ") + Token);

    // ── ③ the regression itself ─────────────────────────────────────────────────────────────────────────────────
    //    The original defect in one assertion: prose only, no rows.
    size_t Rows = 0, Position = 0;
    while ((Position = Code.find("RecordMeasurement(", Position)) != std::string::npos) { ++Rows; Position += 18; }
    std::printf("\n%zu RecordMeasurement call(s) in %s\n", Rows, Source.c_str());
    Check(Rows >= 25, "the frame loop emits the full measurement set, not a token sample");

    std::printf(Failures ? "\nRED — %d check(s) failed\n"
                         : "\nGREEN — the telemetry report carries real performance and GPU rows\n", Failures);
    return Failures ? 1 : 0;
}
