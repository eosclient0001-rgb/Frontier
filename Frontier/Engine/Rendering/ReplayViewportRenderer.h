/*==========================================================================================================================================
                                               REPLAYVIEWPORTRENDERER.H
==========================================================================================================================================*/
// 🧩 Live ReSTIR viewport renderer: combined temporal + spatial + seed-bank reservoir replay on Engine shaders.

#pragma once

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace Frontier
{
//------------------------------------------------------------------------------------------------------------------------
//                                                   VIEWPORT RENDERER
//------------------------------------------------------------------------------------------------------------------------

struct ReplayViewportStats
{
    uint32_t Frame = 0;             // Frames since Initialize
    uint32_t AcceptedBanks = 0;     // Pixels whose gathered seed bank passed compatibility (counter 23)
    uint32_t Width = 0, Height = 0;
    double Milliseconds = 0;        // Host wall time of the last submission (not device timing)
};

// 📝 Renders a bounded diffuse room with the Engine path-replay compute pipeline in its combined
//    reservoir mode (temporal + spatial reuse with the retraced seed bank). It owns a private compute
//    device loaded from an explicit Vulkan driver library, independent of the presentation device.
//    This is software ray tracing through the triangle BVH; no hardware RT and no presentation.
class ReplayViewportRenderer
{
public:
    ReplayViewportRenderer();
    ~ReplayViewportRenderer();
    ReplayViewportRenderer(const ReplayViewportRenderer &) = delete;
    ReplayViewportRenderer &operator=(const ReplayViewportRenderer &) = delete;

    // ShaderDirectory must contain Primary.spv, ReplayGenerate.spv, ReplayResolve.spv,
    // ReplayGatherSampleHistory.spv and ReplayFinalizeSampleHistory.spv.
    bool Initialize(const char *DriverPath, const std::string &ShaderDirectory,
                    uint32_t Width, uint32_t Height, std::string &Diagnostic);
    // Advances the camera drift, submits one combined-mode frame and tonemaps the readback to RGBA8.
    bool RenderFrame(std::vector<std::array<uint8_t, 4>> &Rgba, ReplayViewportStats &Stats,
                     std::string &Diagnostic);
    void Release();

private:
    struct Allocation;
    std::unique_ptr<Allocation> Impl;
};
} // namespace Frontier
