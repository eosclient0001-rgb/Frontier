/*==========================================================================================================================================
                                                   TYREPROJECTIONVULKAN.H
==========================================================================================================================================*/
// 🧩 Record a caller-owned Vulkan dispatch for the standalone GPU tyre projection.
#pragma once

#include <cstdint>
#include <vulkan/vulkan.h>

namespace Frontier
{

enum class TyreProjectionOperation { Reset, Advance };

struct TyreProjectionVulkanAccess
{
    VkPipelineLayout PipelineLayout = VK_NULL_HANDLE;
    VkPipeline ResetPipeline = VK_NULL_HANDLE;
    VkPipeline AdvancePipeline = VK_NULL_HANDLE;
    VkDescriptorSet Descriptors = VK_NULL_HANDLE;
    PFN_vkCmdBindPipeline BindPipeline = nullptr;
    PFN_vkCmdBindDescriptorSets BindDescriptors = nullptr;
    PFN_vkCmdDispatch Dispatch = nullptr;
    std::uint32_t MaxGroupCountX = 0;
};

// 📝 Bindings 0/1/2 are command/particle/result storage buffers, respectively. Dispatch has 32
//    invocations per group and exactly one invocation per tyre. The caller supplies correctly sized
//    buffers, valid descriptor sets/pipelines and barriers between reset, advance and other consumers;
//    it retains all objects until GPU completion. Zero tyres records no commands.
void RecordTyreProjection(VkCommandBuffer Commands, const TyreProjectionVulkanAccess &Access,
                          TyreProjectionOperation Operation, std::uint32_t TyreCount);

} // namespace Frontier
