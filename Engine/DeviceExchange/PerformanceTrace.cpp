//============================================================================================================================================
//                                                PERFORMANCETRACE.CPP
//============================================================================================================================================
// See the header for the contract: RAM only, one disk write at close, compiled out of production builds entirely.

#include "PerformanceTrace.h"

#if FRONTIER_PERFORMANCE_TRACE

#include <cstdio>
#include <ctime>
#include <filesystem>

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                             REPORT FORMATTING
//------------------------------------------------------------------------------------------------------------------------

void WriteUtcStamp(std::FILE* File, const std::chrono::system_clock::time_point& When) noexcept
{
    std::time_t Time = std::chrono::system_clock::to_time_t(When);
    std::tm     Local{};
#ifdef _WIN32
    localtime_s(&Local, &Time);
#else
    localtime_r(&Time, &Local);
#endif
    char Stamp[32];
    std::strftime(Stamp, sizeof(Stamp), "%Y-%m-%d %H:%M:%S", &Local);
    std::fprintf(File, "%s", Stamp);
}

const char* BooleanText(bool Value) noexcept { return Value ? "yes" : "no"; }

} // namespace

namespace Frontier {

PerformanceTrace& PerformanceTrace::Query() noexcept
{
    static PerformanceTrace Ledger;
    return Ledger;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  SESSION
//------------------------------------------------------------------------------------------------------------------------

void PerformanceTrace::BeginSession(const char* Application) noexcept
{
    const std::lock_guard<std::mutex> Guard(Sync);

    ApplicationName      = Application ? Application : "";
    SessionStarted       = std::chrono::steady_clock::now();
    SessionStartedUtc    = std::chrono::system_clock::now();
    SessionStarted_      = true;
    ReportWritten        = false;   // a restart (unit harness) writes a fresh report
    FirstPresentMilliseconds = 0.0;

    OpenStages.clear();
    StageRows.clear();
    LastStageByName.clear();
    SampleRows.clear();
    FrameRows.clear();
    DroppedFrameCount = 0u;
}

double PerformanceTrace::QuerySessionMilliseconds() const noexcept
{
    const std::lock_guard<std::mutex> Guard(Sync);
    if (!SessionStarted_) return 0.0;
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - SessionStarted).count();
}

uint64_t PerformanceTrace::QueryFrameCount() const noexcept
{
    const std::lock_guard<std::mutex> Guard(Sync);
    return FrameRows.size();
}

bool PerformanceTrace::QuerySessionStarted() const noexcept
{
    const std::lock_guard<std::mutex> Guard(Sync);
    return SessionStarted_;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   STAGES
//------------------------------------------------------------------------------------------------------------------------

void PerformanceTrace::BeginStage(const char* StageName) noexcept
{
    if (!StageName) return;

    const std::lock_guard<std::mutex> Guard(Sync);
    OpenStages.push_back(StageOpen{ StageName, std::chrono::steady_clock::now() });
}

double PerformanceTrace::EndStage(bool RecordRow) noexcept
{
    const std::chrono::steady_clock::time_point Now = std::chrono::steady_clock::now();

    const std::lock_guard<std::mutex> Guard(Sync);
    if (OpenStages.empty()) return 0.0;

    const StageOpen Closed = OpenStages.back();
    OpenStages.pop_back();

    // The elapsed value is honest even when the row is dropped: the per-frame scratch always records it, because
    //    the loop's RecordSubmitMilliseconds and friends are read back by name, not by return value.
    const double Milliseconds = std::chrono::duration<double, std::milli>(Now - Closed.Started).count();

    bool Remembered = false;
    for (auto& Entry : LastStageByName)
    {
        if (Entry.first == Closed.Name) { Entry.second = Milliseconds; Remembered = true; break; }
    }
    if (!Remembered) LastStageByName.push_back({ Closed.Name, Milliseconds });

    if (RecordRow)
        StageRows.push_back(StageRow{ Closed.Name, Milliseconds, static_cast<uint32_t>(OpenStages.size()) });

    return Milliseconds;
}

double PerformanceTrace::QueryStageMilliseconds(const char* StageName) const noexcept
{
    if (!StageName) return 0.0;

    const std::lock_guard<std::mutex> Guard(Sync);
    for (const auto& Entry : LastStageByName)
        if (Entry.first == StageName) return Entry.second;
    return 0.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             FRAMES AND SAMPLES
//------------------------------------------------------------------------------------------------------------------------

void PerformanceTrace::RecordFrame(const PerformanceFrameSample& Frame) noexcept
{
    const std::lock_guard<std::mutex> Guard(Sync);

    if (!SessionStarted_) return;

    if (Frame.FrameIndex == 0u)
        FirstPresentMilliseconds =
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - SessionStarted).count();

    if (FrameRows.size() < kMaxFrameSamples) FrameRows.push_back(Frame);
    else                                     ++DroppedFrameCount;

    LastStageByName.clear();   // the queue-path figures were consumed; a stage that skips next frame reads as 0
}

void PerformanceTrace::RecordSample(const char* Token, double Value, const char* UnitAnnotation) noexcept
{
    if (!Token) return;

    const std::lock_guard<std::mutex> Guard(Sync);
    SampleRows.push_back(SampleRow{ Token, Value, UnitAnnotation ? UnitAnnotation : "" });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   REPORT
//------------------------------------------------------------------------------------------------------------------------

void PerformanceTrace::WriteSessionSection(std::FILE* File) const noexcept
{
    const double WallSeconds = std::chrono::duration<double>(SessionClosedUtc - SessionStartedUtc).count();

    std::fprintf(File, "## Session\n\n");
    std::fprintf(File, "| Token | Value | Unit |\n|---|---:|---|\n");
    std::fprintf(File, "| Application | %s | name |\n", ApplicationName.c_str());
    std::fprintf(File, "| Started | ");             WriteUtcStamp(File, SessionStartedUtc); std::fprintf(File, " | utc |\n");
    std::fprintf(File, "| Closed | ");              WriteUtcStamp(File, SessionClosedUtc);  std::fprintf(File, " | utc |\n");
    std::fprintf(File, "| WallSeconds | %.3f | s |\n", WallSeconds);
    std::fprintf(File, "| StageRows | %zu | count |\n", StageRows.size());
    std::fprintf(File, "| SampleRows | %zu | count |\n", SampleRows.size());
    std::fprintf(File, "| FrameRows | %zu | frames |\n", FrameRows.size());
    std::fprintf(File, "| FramesDropped | %llu | frames |\n", static_cast<unsigned long long>(DroppedFrameCount));
    std::fprintf(File, "| TimeToFirstPresent | %.3f | ms |\n", FirstPresentMilliseconds);
    std::fprintf(File, "| FrameRowBytes | ~%zu | bytes |\n", sizeof(PerformanceFrameSample));
    if (!OpenStages.empty())
    {
        std::fprintf(File, "| UnfinishedStages | ");
        for (size_t I = 0u; I < OpenStages.size(); ++I)
            std::fprintf(File, "%s%s", I ? ", " : "", OpenStages[I].Name.c_str());
        std::fprintf(File, " | names |\n");
    }
    std::fprintf(File, "\n");
}

void PerformanceTrace::WriteStageSection(std::FILE* File) const noexcept
{
    std::fprintf(File, "## Stages\n\n");
    std::fprintf(File, "| Stage | Milliseconds | Depth |\n|---|---:|---:|\n");
    for (const StageRow& Row : StageRows)
        std::fprintf(File, "| %s | %.3f | %u |\n", Row.Name.c_str(), Row.Milliseconds, Row.Depth);
    std::fprintf(File, "\n");
}

void PerformanceTrace::WriteSampleSection(std::FILE* File) const noexcept
{
    std::fprintf(File, "## Samples\n\n");
    std::fprintf(File, "| Token | Value | Unit |\n|---|---:|---|\n");
    for (const SampleRow& Row : SampleRows)
        std::fprintf(File, "| %s | %.3f | %s |\n", Row.Token.c_str(), Row.Value, Row.Unit.c_str());
    std::fprintf(File, "\n");
}

void PerformanceTrace::WriteFrameSection(std::FILE* File) const noexcept
{
    std::fprintf(File, "## Frames\n\n");
    std::fprintf(File, "One row per presented frame. delta includes the frame-cap sleep; the GPU columns are the "
                       "device's own timestamps and GpuTotal sums parent stages only (Kernel already contains "
                       "ReSTIR and Post).\n\n");
    std::fprintf(File, "frame,delta_ms,interface_ms,camera_ms,build_ms,dispatch_ms,records_ms,"
                       "queue_wait_ms,record_submit_ms,present_ms,"
                       "gpu_cull_ms,gpu_raster_ms,gpu_hiz_ms,gpu_resolve_ms,gpu_restir_ms,gpu_shadow_ms,"
                       "gpu_post_ms,gpu_sky_ms,gpu_volume_ms,gpu_total_ms,"
                       "clusters_tested,clusters_visible,triangles_drawn,draw_calls,rss_mib,fps_avg,gpu_valid\n");

    for (const PerformanceFrameSample& F : FrameRows)
    {
        std::fprintf(File, "%u,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,"
                           "%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,"
                           "%u,%u,%u,%u,%.1f,%.1f,%s\n",
                     F.FrameIndex, static_cast<double>(F.DeltaMilliseconds),
                     static_cast<double>(F.InterfaceMilliseconds),  static_cast<double>(F.CameraMilliseconds),
                     static_cast<double>(F.InterfaceBuildMilliseconds), static_cast<double>(F.DispatchMilliseconds),
                     static_cast<double>(F.SceneRecordsMilliseconds),
                     static_cast<double>(F.QueueWaitMilliseconds),  static_cast<double>(F.RecordSubmitMilliseconds),
                     static_cast<double>(F.PresentMilliseconds),
                     static_cast<double>(F.GpuCullMilliseconds),    static_cast<double>(F.GpuRasterMilliseconds),
                     static_cast<double>(F.GpuHiZMilliseconds),     static_cast<double>(F.GpuResolveMilliseconds),
                     static_cast<double>(F.GpuReSTIRMilliseconds),  static_cast<double>(F.GpuShadowMilliseconds),
                     static_cast<double>(F.GpuPostMilliseconds),    static_cast<double>(F.GpuSkyMilliseconds),
                     static_cast<double>(F.GpuVolumeMilliseconds),  static_cast<double>(F.GpuTotalMilliseconds),
                     F.ClustersTested, F.ClustersVisible, F.TrianglesDrawn, F.DrawCalls,
                     static_cast<double>(F.ResidentMebibytes), static_cast<double>(F.AverageFramesPerSecond),
                     BooleanText(F.GpuTimingsValid));
    }
    if (DroppedFrameCount > 0u)
        std::fprintf(File, "# %llu frames beyond the %llu-row RAM cap were not recorded.\n",
                     static_cast<unsigned long long>(DroppedFrameCount),
                     static_cast<unsigned long long>(kMaxFrameSamples));
    std::fprintf(File, "\n");
}

bool PerformanceTrace::WriteReport(const char* DestinationFolder) noexcept
{
    std::FILE* File   = nullptr;
    size_t     Stages = 0u, Samples = 0u, Frames = 0u;

    {
        const std::lock_guard<std::mutex> Guard(Sync);

        if (!SessionStarted_ || ReportWritten) return false;
        SessionClosedUtc = std::chrono::system_clock::now();

        std::filesystem::path Folder = DestinationFolder ? DestinationFolder : "Diagnostics";
        std::error_code     FsError;
        std::filesystem::create_directories(Folder, FsError);
        const std::filesystem::path ReportPath = Folder / "ProjectZero_PerformanceTrace.md";

        File = std::fopen(ReportPath.string().c_str(), "w");
        if (!File)
        {
            std::fprintf(stderr, "[PerformanceTrace] Could not open %s for writing - the trace stays in RAM (and dies with the process).\n",
                         ReportPath.string().c_str());
            return false;
        }
        ReportWritten = true;

        std::fprintf(File, "# %s — Performance Trace\n\n", ApplicationName.c_str());
        std::fprintf(File, "Runtime RAM ledger, compiled in because this build defines FRONTIER_DEVELOPMENT or "
                           "FRONTIER_DEBUG (FRONTIER_PERFORMANCE_TRACE = 1). A production build compiles none of "
                           "this: every call site is #if-wrapped. The ledger lives in RAM for the whole run — "
                           "this file, written once at close, is its only disk write.\n\n");
        WriteSessionSection(File);
        WriteStageSection(File);
        WriteSampleSection(File);
        WriteFrameSection(File);

        Stages  = StageRows.size();
        Samples = SampleRows.size();
        Frames  = FrameRows.size();
    }

    const bool Closed = std::fclose(File) == 0;

    std::fprintf(stderr, "[PerformanceTrace] Report written: %zu stage rows, %zu samples, %zu frames.\n",
                 Stages, Samples, Frames);
    return Closed;
}

PerformanceTrace::~PerformanceTrace() noexcept
{
    if (SessionStarted_ && !ReportWritten)
    {
        // An exit path forgot to flush. This is the safety net, not the designed write point.
        WriteReport("Diagnostics");
    }
}

} // namespace Frontier

#endif // FRONTIER_PERFORMANCE_TRACE
