/*==========================================================================================================================================
                                                           VULKANPRESENTATION.H
==========================================================================================================================================*/
// 🧩 Own Vulkan UI presentation while the inherited ImGui adapter renders secondary GLFW windows.

#pragma once
#include <cstdint>
#include <memory>
#include <functional>
#include "Engine/Render/SurfaceRasterization.h"

struct GLFWwindow;
struct ImDrawData;

namespace Frontier
{
//------------------------------------------------------------------------------------------------------------------------
//                                                     VULKAN UI PRESENTATION
//------------------------------------------------------------------------------------------------------------------------

class VulkanPresentation
{
  public:
    VulkanPresentation();
    ~VulkanPresentation();
    VulkanPresentation(const VulkanPresentation &)            = delete;
    VulkanPresentation &operator=(const VulkanPresentation &) = delete;
    void                Initialize(GLFWwindow *Window, bool MaterialRendering = false);
    VulkanRasterAccess QueryRasterAccess() const;
    // 📝 Dynamic RGBA8 textures for viewport-style panels: the returned handle is an ImTextureID for
    //    ImGui::Image. Update replaces the full extent (staging upload, queue idle); sizes are fixed
    //    at creation. Handles are invalid after Finalize.
    uint64_t            CreateDynamicTexture(uint32_t Width, uint32_t Height);
    void                UpdateDynamicTexture(uint64_t Texture, const void *RgbaPixels, uint32_t Width, uint32_t Height);
    void                DestroyDynamicTexture(uint64_t Texture);
    void ConfigureRendering(std::function<void(VkCommandBuffer, uint64_t, uint64_t)> Construct,
                            std::function<void()> Confirm);
    bool                Reconfigure(int Width, int Height);
    void                RenderMain(ImDrawData *Commands);
    void                PresentMain();
    void                AwaitCompletion() noexcept;
    void                Finalize() noexcept;

  private:
    struct PresentationAllocation;
    std::unique_ptr<PresentationAllocation> Allocation;
};
} // namespace Frontier
