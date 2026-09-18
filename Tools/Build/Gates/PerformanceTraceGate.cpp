//============================================================================================================================================
//                                                   PERFORMANCETRACEGATE.CPP
//============================================================================================================================================
// Drives the REAL PerformanceTrace — the one Project-Zero's main() and SwapchainExchange write into — and reads back
//    the report it produced. Like CheckPerformanceTelemetry.sh, this runs the shipped unit, it does not grep source.
//
//    The gate is built TWICE by CheckPerformanceTrace.sh, because the trace's defining property is the gate, not the
//    numbers:
//
//      ① with FRONTIER_DEVELOPMENT (the editor build): the ledger fills with synthetic stages, samples and frames,
//         WriteReport emits the report, and both the in-process values and the written file are asserted;
//      ② with NEITHER FRONTIER_DEVELOPMENT NOR FRONTIER_DEBUG (a production build): this same source compiles a
//         main that contains no trace code at all, and prints the one line below. Every trace call site in the
//         application sits inside the same #if, so pass ② is the proof that the production build parses none of it.
//
//    usage: bash Tools/Build/CheckPerformanceTrace.sh

#include "Engine/DeviceExchange/PerformanceTrace.h"

#if !FRONTIER_PERFORMANCE_TRACE

#include <cstdio>

int main()
{
    // Reaching this main at all means the header turned the ledger off without a development or debug define.
    std::printf("trace compiled out - the production build parses no trace code\n");
    return 0;
}

#else

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>
#include <thread>

using Frontier::PerformanceFrameSample;
using Frontier::PerformanceTrace;

namespace {

int Failures = 0;

void Check(bool Condition, const std::string& Message)
{
    std::printf("  %s  %s\n", Condition ? "PASS" : "FAIL", Message.c_str());
    if (!Condition) ++Failures;
}

void SleepMilliseconds(int Milliseconds) { std::this_thread::sleep_for(std::chrono::milliseconds(Milliseconds)); }

std::string ReadFile(const std::string& Path)
{
    std::ifstream In(Path);
    return std::string((std::istreambuf_iterator<char>(In)), std::istreambuf_iterator<char>());
}

} // namespace

int main(int Argc, char** Argv)
{
    if (Argc < 2)
    {
        std::fprintf(stderr, "usage: PerformanceTraceGate <destination-folder>\n");
        return 2;
    }
    const std::string Folder = Argv[1];

    PerformanceTrace& Trace = PerformanceTrace::Query();
    Trace.BeginSession("Project-Zero-TraceGate");

    //──────────────────────────────────────────────────────────────────────────
    // Startup, shaped like main()'s: outer stage, nested children
    //──────────────────────────────────────────────────────────────────────────
    Trace.BeginStage("Startup");

    Trace.BeginStage("SceneDecode");
    SleepMilliseconds(2);
    const double DecodeMs = Trace.EndStage();
    Check(DecodeMs >= 1.0 && DecodeMs < 500.0, "EndStage returns the elapsed stopwatch value, not zero (" +
                                               std::to_string(DecodeMs).substr(0, 5) + " ms for a 2 ms stage)");

    Trace.BeginStage("SwapchainBring");
    Trace.BeginStage("BringComputePipeline");
    SleepMilliseconds(2);
    Trace.EndStage();                     // nested: recorded at depth 2
    SleepMilliseconds(1);
    const double BringMs = Trace.EndStage();
    Check(BringMs > 2.0, "nested stages add up inside their parent (SwapchainBring " +
                         std::to_string(BringMs).substr(0, 5) + " ms contains BringComputePipeline)");

    Trace.EndStage();                     // Startup

    //──────────────────────────────────────────────────────────────────────────
    // Per-frame scratch and frame rows — the queue-path contract
    //──────────────────────────────────────────────────────────────────────────
    Trace.BeginStage("Frame.Record");
    SleepMilliseconds(1);
    Trace.EndStage(/*RecordRow=*/false);  // the loop's stages stay out of the stage table
    Check(Trace.QueryStageMilliseconds("Frame.Record") >= 1.0,
          "a stage closed without a row is still readable by name for the frame");

    PerformanceFrameSample FrameZero;
    FrameZero.FrameIndex        = 0u;
    FrameZero.DeltaMilliseconds = 16.667f;
    FrameZero.PresentMilliseconds = 2.5f;
    Trace.RecordFrame(FrameZero);
    Check(Trace.QueryStageMilliseconds("Frame.Record") == 0.0,
          "RecordFrame clears the per-frame scratch - a stage that skips next frame reads as zero");

    Check(Trace.QuerySessionMilliseconds() > 0.0, "the session clock runs");

    //──────────────────────────────────────────────────────────────────────────
    // Samples — named scalars the report carries verbatim
    //──────────────────────────────────────────────────────────────────────────
    Trace.RecordSample("TraversalBuildMs", 4.5, "ms");
    Trace.RecordSample("SpirvBytes/ReSTIRViewport.spv", 91234.0, "bytes");

    //──────────────────────────────────────────────────────────────────────────
    // Three frame rows with fixed numbers the report can be diffed against
    //──────────────────────────────────────────────────────────────────────────
    PerformanceFrameSample A; A.FrameIndex = 1u; A.DeltaMilliseconds = 16.667f; A.GpuReSTIRMilliseconds = 11.2f;
    A.GpuTotalMilliseconds = 18.18f; A.ClustersTested = 4096u; A.ClustersVisible = 512u; A.TrianglesDrawn = 100000u;
    A.DrawCalls = 24u; A.ResidentMebibytes = 812.0f; A.AverageFramesPerSecond = 60.0f; A.GpuTimingsValid = true;
    PerformanceFrameSample B; B.FrameIndex = 2u; B.DeltaMilliseconds = 33.333f; B.GpuTimingsValid = false;
    Trace.RecordFrame(A);
    Trace.RecordFrame(B);
    Check(Trace.QueryFrameCount() == 3u, "three frame rows are held in RAM");

    //──────────────────────────────────────────────────────────────────────────
    // The single disk write — and its idempotence
    //──────────────────────────────────────────────────────────────────────────
    Check(Trace.WriteReport(Folder.c_str()),                    "WriteReport writes the report");
    Check(!Trace.WriteReport(Folder.c_str()),                   "a second WriteReport is refused - the ledger writes once");
    Check(Trace.QuerySessionStarted(),                          "the session stayed started after the write");

    const std::string Report = ReadFile(Folder + "/ProjectZero_PerformanceTrace.md");

    Check(Report.find("| Application | Project-Zero-TraceGate | name |") != std::string::npos,
          "the session names its application");
    Check(Report.find("| TimeToFirstPresent |") != std::string::npos,
          "the session stamps the time to the first present");
    Check(Report.find("| FrameRows | 3 | frames |") != std::string::npos,
          "the session counts the frames it held");
    Check(Report.find("| Startup |") != std::string::npos &&
          Report.find("| BringComputePipeline |") != std::string::npos,
          "the stage table carries the outer stage and the nested bring-up stage");
    Check(Report.find("| TraversalBuildMs | 4.500 | ms |") != std::string::npos &&
          Report.find("| SpirvBytes/ReSTIRViewport.spv | 91234.000 | bytes |") != std::string::npos,
          "the samples land with their units, verbatim");
    Check(Report.find("16.667") != std::string::npos && Report.find("33.333") != std::string::npos,
          "the frame CSV carries each frame's delta");
    Check(Report.find(",yes\n") != std::string::npos && Report.find(",no\n") != std::string::npos,
          "the frame CSV says whether the GPU timestamps were valid per frame");
    Check(Report.find("| FramesDropped | 0 | frames |") != std::string::npos,
          "no frames were dropped at three frames");
    Check(Report.find("FRONTIER_PERFORMANCE_TRACE = 1") != std::string::npos,
          "the report says which gate compiled it in");

    std::printf("%s\n", Failures == 0 ? "GREEN — the trace ledger fills, reads back and writes once" :
                                        "RED — see the FAIL lines above");
    return Failures == 0 ? 0 : 1;
}

#endif // FRONTIER_PERFORMANCE_TRACE
