//============================================================================================================================================
// 📦 Frontier/DeviceExchange/PerformanceTrace.h — the application's RAM performance ledger, written to disk once, at close
//============================================================================================================================================
// 🧩 What this is for. ProjectZero_TelemetryReport answers "how is the frame doing" on a 5 s cadence, in prose plus
//    measurement rows. It deliberately does NOT answer "what exactly happened on this one frame" or "where did the
//    800 ms of startup go". This ledger does: it holds an explicit stage stopwatch that main() wraps around every
//    phase it runs (command line, scene decode, BVH build, window + device + pipeline bring-up, uploads, physics,
//    interface, audio), the device bring-up's own named stages as the swapchain runs them, per-shader SPIR-V sizes,
//    and ONE ROW PER FRAME with the CPU section times, the GPU stage times and the visibility counts.
//
//    The one rule of the file: NOTHING touches disk while the application runs. Every row lands in RAM — a vector
//    append, a few dozen bytes per frame — and the whole ledger is written out once, by WriteReport, when the
//    application closes (main()'s exit paths call it; the destructor covers any that forget). A run killed hard
//    (crash, TerminateProcess) loses the ledger by design: it is a development instrument, not a flight recorder.
//
//    The gate. FRONTIER_PERFORMANCE_TRACE is 1 when the build is a development or debug build
//    (FRONTIER_DEVELOPMENT or FRONTIER_DEBUG defined — ToolchainSequence.ps1 -Development (the default editor
//    build), or -Configuration Debug), and 0 otherwise. Every call site in the application is wrapped in
//    `#if FRONTIER_PERFORMANCE_TRACE … #endif`, so a production build does not even PARSE a trace call — no
//    strings, no timers, no branches, nothing to strip at link time. The class below is compiled out with them.
//    Tools/Build/CheckPerformanceTrace.sh proves both halves: it builds the gate twice, once defined (the ledger
//    fills, the report parses) and once not (the same call sites compile to an empty main).
//
//    Why a process-wide singleton rather than a hand-passed reference: the deepest call sites are inside
//    SwapchainExchange's bring-up stages and its record/submit path, which must not grow a trace parameter —
//    the seam rule keeps the engine ignorant of the project. The ledger is engine-side (beside DiagnosticMetrics),
//    so both sides write into it and neither includes the other.

#pragma once

#include <cstdint>

#if defined(FRONTIER_DEVELOPMENT) || defined(FRONTIER_DEBUG)
    #ifndef FRONTIER_PERFORMANCE_TRACE
        #define FRONTIER_PERFORMANCE_TRACE 1
    #endif
#endif
#ifndef FRONTIER_PERFORMANCE_TRACE
    #define FRONTIER_PERFORMANCE_TRACE 0
#endif

#if FRONTIER_PERFORMANCE_TRACE

#include <chrono>
#include <mutex>
#include <string>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                           PER-FRAME SAMPLE (one CSV row)
//------------------------------------------------------------------------------------------------------------------------
// Everything the frame loop can say about one frame, flattened so the report is one wide CSV a script can diff.
//    The CPU section times are stage stopwatches around the loop's numbered sections; the GPU times are the device's
//    own query-pool timestamps (VisibilityTelemetry), not host clocks. GpuTotal sums the PARENT stages only —
//    KernelMilliseconds already contains ReSTIR and Post as its breakdown (see PerformanceTelemetrySequence.cpp).

struct PerformanceFrameSample
{
    uint32_t FrameIndex                = 0u;     // [idx] 0-based, first presented frame is 0
    float    DeltaMilliseconds         = 0.0f;   // [ms]  whole frame wall time, including the frame-cap sleep
    // CPU sections — the loop's own stopwatches around each numbered section
    float    InterfaceMilliseconds     = 0.0f;   // [ms]  ① input poll, Control Centre, panels, celestial tick, alerts
    float    CameraMilliseconds        = 0.0f;   // [ms]  ② camera kinematics
    float    InterfaceBuildMilliseconds = 0.0f;  // [ms]  ③ ImGui draw data, editor feed, celestial metas, write-backs
    float    DispatchMilliseconds      = 0.0f;   // [ms]  ④ dispatch configuration, camera front end, spatial interface
    float    SceneRecordsMilliseconds  = 0.0f;   // [ms]  ④c-④f instance transforms, sky, moon and post records
    // Queue path — measured inside SwapchainExchange::RecordAndPresent
    float    QueueWaitMilliseconds     = 0.0f;   // [ms]  waiting for a free cycle slot (queue-depth back-pressure)
    float    RecordSubmitMilliseconds  = 0.0f;   // [ms]  acquire → record → submit (includes the previous image's fence)
    float    PresentMilliseconds       = 0.0f;   // [ms]  vkQueuePresentKHR — the FIFO queue's blocking lives here
    // GPU stages — device timestamps; a stage that did not run contributes 0
    float    GpuCullMilliseconds       = 0.0f;   // [ms]
    float    GpuRasterMilliseconds     = 0.0f;   // [ms]
    float    GpuHiZMilliseconds        = 0.0f;   // [ms]
    float    GpuResolveMilliseconds    = 0.0f;   // [ms]
    float    GpuReSTIRMilliseconds     = 0.0f;   // [ms]  candidate + resolve kernel (inside KernelMilliseconds)
    float    GpuShadowMilliseconds     = 0.0f;   // [ms]
    float    GpuPostMilliseconds       = 0.0f;   // [ms]  à-trous + grade (inside KernelMilliseconds)
    float    GpuSkyMilliseconds        = 0.0f;   // [ms]
    float    GpuVolumeMilliseconds     = 0.0f;   // [ms]
    float    GpuTotalMilliseconds      = 0.0f;   // [ms]  parent stages summed — see the ⚠️ note above
    // What the frame had to work with
    uint32_t ClustersTested            = 0u;     // [cnt]
    uint32_t ClustersVisible           = 0u;     // [cnt]
    uint32_t TrianglesDrawn            = 0u;     // [cnt]
    uint32_t DrawCalls                 = 0u;     // [cnt]
    float    ResidentMebibytes         = 0.0f;   // [MiB] process resident set (TelemetryMetrics' 0.5 s sample)
    float    AverageFramesPerSecond    = 0.0f;   // [fps] TelemetryMetrics' rolling average
    bool     GpuTimingsValid           = false;  // [bool] query pool had a completed frame
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  PERFORMANCE TRACE
//------------------------------------------------------------------------------------------------------------------------

class PerformanceTrace
{
public:
    // Process-wide ledger. The first call starts nothing — BeginSession does — so a unit harness can construct
    //    the ledger, inspect it, and only then start a session.
    static PerformanceTrace& Query() noexcept;

    // Starts (or restarts) the session clock. Called once, as the first statement of main().
    void BeginSession(const char* ApplicationName) noexcept;

    // Stage stopwatch. Stages nest — SwapchainBring opens one stage per bring-up step inside itself — and each
    //    closed stage lands in the report's stage table with its nesting depth. The frame loop opens stages too,
    //    but passes RecordRow=false: its numbers live in the frame CSV, not in a stage table that would repeat
    //    them once per frame.
    void BeginStage(const char* StageName) noexcept;

    // Closes the innermost open stage and returns its elapsed milliseconds. RecordRow=false keeps the stage
    //    table clean for per-frame use; the elapsed value is still returned and remembered by name for one
    //    frame (QueryStageMilliseconds), which is how the queue-path figures get from SwapchainExchange's
    //    RecordAndPresent into the loop's frame sample.
    double EndStage(bool RecordRow = true) noexcept;

    // Elapsed milliseconds of the last stage closed under this name since the last RecordFrame. 0.0 when the
    //    name has not been seen this frame — a stage that did not run reads as zero, like the GPU stages.
    [[nodiscard]] double QueryStageMilliseconds(const char* StageName) const noexcept;

    // Appends one frame row. Also clears the per-frame stage-name scratch and, on frame 0, stamps the session's
    //    time-to-first-present (the loop calls this right after the first present returns).
    void RecordFrame(const PerformanceFrameSample& Frame) noexcept;

    // One scalar the report should carry verbatim: SPIR-V byte sizes, BVH build milliseconds the startup code
    //    already computed, anything with a name, a number and a unit.
    void RecordSample(const char* Token, double Value, const char* UnitAnnotation) noexcept;

    // The only disk write of the ledger's life. Creates the folder if needed, writes the whole report in one
    //    pass, and is idempotent — a second call reports false and writes nothing. Returns false when the
    //    session never started or the file could not be opened.
    bool WriteReport(const char* DestinationFolder) noexcept;

    [[nodiscard]] double QuerySessionMilliseconds() const noexcept;   // [ms] since BeginSession
    [[nodiscard]] uint64_t QueryFrameCount() const noexcept;
    [[nodiscard]] bool     QuerySessionStarted() const noexcept;

    // Safety net: an exit path that forgot WriteReport flushes here instead. Static destruction order puts this
    //    after main()'s locals, which is fine — the ledger owns every byte it writes.
    ~PerformanceTrace() noexcept;

    PerformanceTrace(const PerformanceTrace&)            = delete;
    PerformanceTrace& operator=(const PerformanceTrace&) = delete;

private:
    PerformanceTrace() noexcept = default;

    struct StageOpen
    {
        std::string                                Name;
        std::chrono::steady_clock::time_point      Started;
    };

    struct StageRow
    {
        std::string Name;
        double      Milliseconds = 0.0;   // [ms]
        uint32_t    Depth        = 0u;    // [lvl] 0 = top level
    };

    struct SampleRow
    {
        std::string Token;
        double      Value    = 0.0;
        std::string Unit;
    };

    void WriteSessionSection(std::FILE* File) const noexcept;
    void WriteStageSection(std::FILE* File) const noexcept;
    void WriteSampleSection(std::FILE* File) const noexcept;
    void WriteFrameSection(std::FILE* File) const noexcept;

    static constexpr uint64_t kMaxFrameSamples = 400000u;   // [rows] ≈ 45 MiB of RAM at ~112 B/row before rows drop

    mutable std::mutex                       Sync;                 // [sync] bring-up and the loop are main-thread, but the preview TUs are not
    std::string                              ApplicationName;      // [name]
    std::chrono::steady_clock::time_point    SessionStarted{};     // [clock] steady clock — monotonic, immune to NTP
    std::chrono::system_clock::time_point    SessionStartedUtc{};  // [clock] wall clock, for the report stamp only
    std::chrono::system_clock::time_point    SessionClosedUtc{};   // [clock] stamped by WriteReport
    bool                                     SessionStarted_ = false;
    bool                                     ReportWritten   = false;

    std::vector<StageOpen>                   OpenStages;           // [stack] innermost last
    std::vector<StageRow>                    StageRows;
    std::vector<std::pair<std::string, double>> LastStageByName;   // [scratch] per-frame, cleared by RecordFrame
    std::vector<SampleRow>                   SampleRows;

    std::vector<PerformanceFrameSample>      FrameRows;
    uint64_t                                 DroppedFrameCount = 0u;
    double                                   FirstPresentMilliseconds = 0.0;   // [ms] session start → first present returned
};

//------------------------------------------------------------------------------------------------------------------------
//                                     SCOPED STAGE (for functions with early exits)
//------------------------------------------------------------------------------------------------------------------------
// RecordAndPresent has three early-return paths between its acquire and its present; a plain Begin/End pair would
//    leave a stage open on every one of them. The scope closes wherever the function leaves.

class PerformanceStageScope
{
public:
    PerformanceStageScope(const char* StageName, bool RecordRow = true) noexcept
        : Trace(PerformanceTrace::Query()), Record(RecordRow)
    {
        Trace.BeginStage(StageName);
    }

    ~PerformanceStageScope() noexcept { Trace.EndStage(Record); }

    PerformanceStageScope(const PerformanceStageScope&)            = delete;
    PerformanceStageScope& operator=(const PerformanceStageScope&) = delete;

private:
    PerformanceTrace& Trace;
    bool              Record;
};

} // namespace Frontier

#else

// Production build: the ledger does not exist. One well-formed declaration keeps the translation unit non-empty;
//    every call site in the application is inside #if FRONTIER_PERFORMANCE_TRACE and is not even parsed here.
namespace Frontier { namespace { typedef int PerformanceTraceCompiledOut; } }

#endif // FRONTIER_PERFORMANCE_TRACE
