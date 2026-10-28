/*==========================================================================================================================================
                                                          VULKANPRESENTATION.CPP
==========================================================================================================================================*/
// 🧩 Adapt pinned ImGui Vulkan presentation to the shared editor without importing a scene renderer or Vulkan SDK loader.

#include "VulkanPresentation.h"
#include "Engine/Diagnostics/DiagnosticJournal.h"
// 📝 GLFW_INCLUDE_NONE suppresses its default GL/gl.h include (not every platform ships OpenGL
// dev headers, and this file never uses OpenGL); GLFW_INCLUDE_VULKAN still pulls in vulkan.h.
#ifndef GLFW_INCLUDE_NONE
#define GLFW_INCLUDE_NONE
#endif
#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>
#include <imgui.h>
#include <imgui_impl_vulkan.h>
#include <stdexcept>
#include <algorithm>
#include <cstring>
#include <string>
#include <vector>
#include <vulkan/vulkan.h>

namespace Frontier
{
namespace
{
//------------------------------------------------------------------------------------------------------------------------
//                                                     RESULT CONSTRAINTS
//------------------------------------------------------------------------------------------------------------------------

thread_local bool ReclamationEnabled = false;

// 📝 Name every failure code in diagnostics: a bare integer like -1000069000
// (VK_ERROR_OUT_OF_POOL_MEMORY) cost a full investigation to decode from a user screenshot.
const char *DescribeResult(VkResult Result)
{
    switch (Result)
    {
    case VK_SUCCESS: return "VK_SUCCESS";
    case VK_ERROR_OUT_OF_HOST_MEMORY: return "VK_ERROR_OUT_OF_HOST_MEMORY";
    case VK_ERROR_OUT_OF_DEVICE_MEMORY: return "VK_ERROR_OUT_OF_DEVICE_MEMORY";
    case VK_ERROR_OUT_OF_POOL_MEMORY: return "VK_ERROR_OUT_OF_POOL_MEMORY";
    case VK_ERROR_FRAGMENTED_POOL: return "VK_ERROR_FRAGMENTED_POOL";
    case VK_ERROR_DEVICE_LOST: return "VK_ERROR_DEVICE_LOST";
    case VK_ERROR_SURFACE_LOST_KHR: return "VK_ERROR_SURFACE_LOST_KHR";
    case VK_ERROR_OUT_OF_DATE_KHR: return "VK_ERROR_OUT_OF_DATE_KHR";
    case VK_SUBOPTIMAL_KHR: return "VK_SUBOPTIMAL_KHR";
    case VK_ERROR_INITIALIZATION_FAILED: return "VK_ERROR_INITIALIZATION_FAILED";
    case VK_ERROR_LAYER_NOT_PRESENT: return "VK_ERROR_LAYER_NOT_PRESENT";
    case VK_ERROR_EXTENSION_NOT_PRESENT: return "VK_ERROR_EXTENSION_NOT_PRESENT";
    case VK_ERROR_FEATURE_NOT_PRESENT: return "VK_ERROR_FEATURE_NOT_PRESENT";
    case VK_ERROR_INCOMPATIBLE_DRIVER: return "VK_ERROR_INCOMPATIBLE_DRIVER";
    case VK_ERROR_TOO_MANY_OBJECTS: return "VK_ERROR_TOO_MANY_OBJECTS";
    case VK_ERROR_FORMAT_NOT_SUPPORTED: return "VK_ERROR_FORMAT_NOT_SUPPORTED";
    default: return "VK_RESULT_UNKNOWN";
    }
}
void RequireSuccess(VkResult Result)
{
    if (Result < 0)
    {
        DiagnosticJournal::Append("VulkanError", "VkResult=" + std::to_string(static_cast<int>(Result)) +
            " (" + DescribeResult(Result) + ")" + (ReclamationEnabled ? " during reclamation" : ""));
        if (!ReclamationEnabled)
            throw std::runtime_error("Vulkan UI failure: " + std::to_string(static_cast<int>(Result)) +
                " (" + DescribeResult(Result) + ")");
    }
}

template <typename Function> Function Resolve(VkInstance Instance, const char *Name)
{
    auto Address = glfwGetInstanceProcAddress(Instance, Name);
    if (!Address)
        throw std::runtime_error(std::string("Vulkan entry point unavailable: ") + Name);
    return reinterpret_cast<Function>(Address);
}
} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     PRESENTATION ALLOCATION
//------------------------------------------------------------------------------------------------------------------------

struct VulkanPresentation::PresentationAllocation
{
    VkInstance               Instance       = VK_NULL_HANDLE;
    VkPhysicalDevice         PhysicalDevice = VK_NULL_HANDLE;
    VkDevice                 Device         = VK_NULL_HANDLE;
    VkQueue                  Queue          = VK_NULL_HANDLE;
    uint32_t                 QueueFamily    = 0;
    VkQueueFlags             QueueCapabilities = 0;
    ImGui_ImplVulkanH_Window Main;
    bool                     RendererReady = false;
    bool                     Rebuild       = false;
    bool                     Submitted     = false;
    uint64_t SubmissionSerial = 0, CompletedSerial = 0;
    std::vector<uint64_t> ImageSerials;
    std::function<void(VkCommandBuffer, uint64_t, uint64_t)> ConstructGpu;
    std::function<void()> ConfirmGpu;

    // 📝 Viewport textures presented through ImGui::Image (see CreateDynamicTexture).
    struct DynamicTexture
    {
        VkImage Image = VK_NULL_HANDLE;
        VkDeviceMemory Memory = VK_NULL_HANDLE;
        VkImageView View = VK_NULL_HANDLE;
        VkSampler Sampler = VK_NULL_HANDLE;
        VkDescriptorSet Set = VK_NULL_HANDLE;
        uint32_t Width = 0, Height = 0;
    };
    std::vector<std::unique_ptr<DynamicTexture>> DynamicTextures;
    VkCommandPool TexturePool = VK_NULL_HANDLE;

#define FRONTIER_VULKAN_FUNCTIONS(Function)                                                                            \
    Function(GetPhysicalDeviceProperties) Function(DestroyInstance) Function(EnumeratePhysicalDevices)                 \
        Function(GetPhysicalDeviceQueueFamilyProperties) Function(GetPhysicalDeviceSurfaceSupportKHR)                  \
            Function(CreateDevice) Function(GetDeviceQueue) Function(DestroyDevice) Function(DeviceWaitIdle)           \
                Function(DestroySurfaceKHR) Function(AcquireNextImageKHR) Function(WaitForFences)                      \
                    Function(ResetFences) Function(ResetCommandPool) Function(BeginCommandBuffer)                      \
                        Function(CmdBeginRenderPass) Function(CmdEndRenderPass) Function(EndCommandBuffer)             \
                            Function(QueueSubmit) Function(QueuePresentKHR)                                            \
                                Function(EnumerateDeviceExtensionProperties)
#define FRONTIER_DECLARE_FUNCTION(Name) PFN_vk##Name Name = nullptr;
    FRONTIER_VULKAN_FUNCTIONS(FRONTIER_DECLARE_FUNCTION)
#undef FRONTIER_DECLARE_FUNCTION

    void Initialize(GLFWwindow *Window, bool MaterialRendering)
    {
        if (!glfwVulkanSupported())
            throw std::runtime_error("Vulkan loader/driver unavailable.");
        const auto CreateInstance = Resolve<PFN_vkCreateInstance>(VK_NULL_HANDLE, "vkCreateInstance");
        uint32_t   ExtensionCount = 0;
        const auto Extensions     = glfwGetRequiredInstanceExtensions(&ExtensionCount);
        if (!Extensions || !ExtensionCount)
            throw std::runtime_error("GLFW Vulkan surface extensions unavailable.");
        VkApplicationInfo Application{VK_STRUCTURE_TYPE_APPLICATION_INFO};
        Application.pApplicationName = "Frontier Editor";
        Application.apiVersion       = MaterialRendering ? VK_API_VERSION_1_2 : VK_API_VERSION_1_1;
        VkInstanceCreateInfo Description{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
        Description.pApplicationInfo        = &Application;
        Description.enabledExtensionCount   = ExtensionCount;
        Description.ppEnabledExtensionNames = Extensions;
        RequireSuccess(CreateInstance(&Description, nullptr, &Instance));
#define FRONTIER_RESOLVE_FUNCTION(Name) Name = Resolve<PFN_vk##Name>(Instance, "vk" #Name);
        FRONTIER_VULKAN_FUNCTIONS(FRONTIER_RESOLVE_FUNCTION)
#undef FRONTIER_RESOLVE_FUNCTION
        if (!ImGui_ImplVulkan_LoadFunctions(
                VK_API_VERSION_1_1,
                [](const char *Name, void *Context) -> PFN_vkVoidFunction
                {
                    return reinterpret_cast<PFN_vkVoidFunction>(
                        glfwGetInstanceProcAddress(*static_cast<VkInstance *>(Context), Name));
                },
                &Instance))
            throw std::runtime_error("ImGui Vulkan entry point loading failed.");
        RequireSuccess(glfwCreateWindowSurface(Instance, Window, nullptr, &Main.Surface));
        uint32_t DeviceCount = 0;
        RequireSuccess(EnumeratePhysicalDevices(Instance, &DeviceCount, nullptr));
        std::vector<VkPhysicalDevice> Devices(DeviceCount);
        RequireSuccess(EnumeratePhysicalDevices(Instance, &DeviceCount, Devices.data()));
        for (auto Candidate : Devices)
        {
            VkPhysicalDeviceProperties DeviceProperties{};
            GetPhysicalDeviceProperties(Candidate, &DeviceProperties);
            DiagnosticJournal::Append("VulkanDevice", std::string(DeviceProperties.deviceName) +
                " vendor=" + std::to_string(DeviceProperties.vendorID) + " device=" + std::to_string(DeviceProperties.deviceID) +
                " api=" + std::to_string(DeviceProperties.apiVersion) + " driver=" + std::to_string(DeviceProperties.driverVersion));
            if (DeviceProperties.apiVersion < Application.apiVersion)
                continue;
            uint32_t PropertyCount = 0;
            RequireSuccess(EnumerateDeviceExtensionProperties(Candidate, nullptr, &PropertyCount, nullptr));
            std::vector<VkExtensionProperties> Properties(PropertyCount);
            RequireSuccess(EnumerateDeviceExtensionProperties(Candidate, nullptr, &PropertyCount, Properties.data()));
            bool SwapchainSupported = false;
            for (const auto &Property : Properties)
                SwapchainSupported |= std::string(Property.extensionName) == VK_KHR_SWAPCHAIN_EXTENSION_NAME;
            if (!SwapchainSupported)
                continue;
            uint32_t QueueCount = 0;
            GetPhysicalDeviceQueueFamilyProperties(Candidate, &QueueCount, nullptr);
            std::vector<VkQueueFamilyProperties> Queues(QueueCount);
            GetPhysicalDeviceQueueFamilyProperties(Candidate, &QueueCount, Queues.data());
            for (uint32_t Index = 0; Index < QueueCount; ++Index)
            {
                VkBool32 PresentationSupported = VK_FALSE;
                RequireSuccess(
                    GetPhysicalDeviceSurfaceSupportKHR(Candidate, Index, Main.Surface, &PresentationSupported));
                if ((Queues[Index].queueFlags & (VK_QUEUE_GRAPHICS_BIT | VK_QUEUE_COMPUTE_BIT)) ==
                    (VK_QUEUE_GRAPHICS_BIT | VK_QUEUE_COMPUTE_BIT) && PresentationSupported)
                {
                    PhysicalDevice = Candidate;
                    QueueFamily = Index;
                    QueueCapabilities = Queues[Index].queueFlags;
                    DiagnosticJournal::Append("VulkanDevice", "Selected " + std::string(DeviceProperties.deviceName) + " graphics queue=" + std::to_string(Index));
                    break;
                }
            }
            if (PhysicalDevice)
                break;
        }
        if (!PhysicalDevice)
            throw std::runtime_error("No Vulkan graphics queue supports this GLFW window surface.");
        constexpr float         Priority = 1;
        VkDeviceQueueCreateInfo QueueDescription{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
        QueueDescription.queueFamilyIndex     = QueueFamily;
        QueueDescription.queueCount           = 1;
        QueueDescription.pQueuePriorities     = &Priority;
        const char        *DeviceExtensions[] = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
        VkDeviceCreateInfo DeviceDescription{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
        DeviceDescription.queueCreateInfoCount    = 1;
        DeviceDescription.pQueueCreateInfos       = &QueueDescription;
        DeviceDescription.enabledExtensionCount   = 1;
        DeviceDescription.ppEnabledExtensionNames = DeviceExtensions;
        RequireSuccess(CreateDevice(PhysicalDevice, &DeviceDescription, nullptr, &Device));
        GetDeviceQueue(Device, QueueFamily, 0, &Queue);
        constexpr VkFormat Formats[] = {VK_FORMAT_B8G8R8A8_UNORM, VK_FORMAT_R8G8B8A8_UNORM};
        Main.SurfaceFormat           = ImGui_ImplVulkanH_SelectSurfaceFormat(PhysicalDevice, Main.Surface, Formats, 2,
                                                                             VK_COLORSPACE_SRGB_NONLINEAR_KHR);
        constexpr VkPresentModeKHR Modes[] = {VK_PRESENT_MODE_FIFO_KHR};
        Main.PresentMode = ImGui_ImplVulkanH_SelectPresentMode(PhysicalDevice, Main.Surface, Modes, 1);
        int Width, Height;
        glfwGetFramebufferSize(Window, &Width, &Height);
        if (Width <= 0 || Height <= 0)
            throw std::runtime_error("Cannot initialize Vulkan presentation with a zero-size window.");
        ImGui_ImplVulkanH_CreateOrResizeWindow(Instance, PhysicalDevice, Device, &Main, QueueFamily, nullptr, Width,
                                               Height, 2, 0);
        ImGui_ImplVulkan_InitInfo Initialization{};
        Initialization.ApiVersion                   = Application.apiVersion;
        Initialization.Instance                     = Instance;
        Initialization.PhysicalDevice               = PhysicalDevice;
        Initialization.Device                       = Device;
        Initialization.QueueFamily                  = QueueFamily;
        Initialization.Queue                        = Queue;
        // 📝 Sized and accounted, not guessed: hosts bind a bounded set of user textures (material atlas,
        // preview + frame-lagged retirements, pattern atlas, ≤9 coverage slots, icon atlas + 1 retired)
        // and reclaim them; 512 leaves generous headroom while still failing loudly on a real leak.
        Initialization.DescriptorPoolSize           = 512;
        Initialization.MinImageCount                = 2;
        Initialization.ImageCount                   = Main.ImageCount;
        Initialization.PipelineInfoMain.RenderPass  = Main.RenderPass;
        Initialization.PipelineInfoMain.MSAASamples = VK_SAMPLE_COUNT_1_BIT;
        Initialization.CheckVkResultFn              = RequireSuccess;
        RendererReady                               = ImGui_ImplVulkan_Init(&Initialization);
        if (!RendererReady)
            throw std::runtime_error("ImGui Vulkan initialization failed.");
        Main.ClearValue.color = {{.065f, .065f, .07f, 1}};
    }

    void Finalize() noexcept
    {
        const bool PreviousReclamation = ReclamationEnabled;
        ReclamationEnabled             = true;
        if (Device && DeviceWaitIdle)
            (void)DeviceWaitIdle(Device);
        for (auto &Texture : DynamicTextures)
        {
            if (Texture->Set) ImGui_ImplVulkan_RemoveTexture(Texture->Set);
            if (Texture->Sampler) Resolve<PFN_vkDestroySampler>(Instance, "vkDestroySampler")(Device, Texture->Sampler, nullptr);
            if (Texture->View) Resolve<PFN_vkDestroyImageView>(Instance, "vkDestroyImageView")(Device, Texture->View, nullptr);
            if (Texture->Image) Resolve<PFN_vkDestroyImage>(Instance, "vkDestroyImage")(Device, Texture->Image, nullptr);
            if (Texture->Memory) Resolve<PFN_vkFreeMemory>(Instance, "vkFreeMemory")(Device, Texture->Memory, nullptr);
        }
        DynamicTextures.clear();
        if (TexturePool) Resolve<PFN_vkDestroyCommandPool>(Instance, "vkDestroyCommandPool")(Device, TexturePool, nullptr);
        TexturePool = VK_NULL_HANDLE;
        // 📝 Destroy secondary swapchains before the shared Vulkan device and before GLFW window reclamation.
        if (RendererReady)
        {
            ImGui::DestroyPlatformWindows();
            ImGui_ImplVulkan_Shutdown();
            RendererReady = false;
        }
        if (Device && Main.Swapchain)
            ImGui_ImplVulkanH_DestroyWindow(Instance, Device, &Main, nullptr);
        if (Main.Surface && DestroySurfaceKHR)
            DestroySurfaceKHR(Instance, Main.Surface, nullptr);
        Main.Surface = VK_NULL_HANDLE;
        if (Device && DestroyDevice)
            DestroyDevice(Device, nullptr);
        Device = VK_NULL_HANDLE;
        if (Instance && DestroyInstance)
            DestroyInstance(Instance, nullptr);
        Instance           = VK_NULL_HANDLE;
        ReclamationEnabled = PreviousReclamation;
    }
};
#undef FRONTIER_VULKAN_FUNCTIONS

//------------------------------------------------------------------------------------------------------------------------
//                                                     PRESENTATION LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

VulkanPresentation::VulkanPresentation() : Allocation(std::make_unique<PresentationAllocation>())
{
}
VulkanPresentation::~VulkanPresentation()
{
    Finalize();
}
void VulkanPresentation::Initialize(GLFWwindow *Window, bool MaterialRendering)
{
    Allocation->Initialize(Window, MaterialRendering);
}
void VulkanPresentation::Finalize() noexcept
{
    Allocation->Finalize();
}

VulkanRasterAccess VulkanPresentation::QueryRasterAccess() const
{
    const auto &Display = *Allocation;
    return {Display.Device, Display.PhysicalDevice,
        Resolve<PFN_vkGetDeviceProcAddr>(Display.Instance, "vkGetDeviceProcAddr"),
        Resolve<PFN_vkGetPhysicalDeviceMemoryProperties>(Display.Instance, "vkGetPhysicalDeviceMemoryProperties"),
        Resolve<PFN_vkGetPhysicalDeviceFormatProperties>(Display.Instance, "vkGetPhysicalDeviceFormatProperties"),
        Display.GetPhysicalDeviceProperties, Display.QueueCapabilities};
}
void VulkanPresentation::ConfigureRendering(std::function<void(VkCommandBuffer, uint64_t, uint64_t)> Construct,
                                           std::function<void()> Confirm)
{
    Allocation->ConstructGpu = std::move(Construct);
    Allocation->ConfirmGpu = std::move(Confirm);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DYNAMIC TEXTURES
//------------------------------------------------------------------------------------------------------------------------

uint64_t VulkanPresentation::CreateDynamicTexture(uint32_t Width, uint32_t Height)
{
    auto &Display = *Allocation;
    if (!Display.RendererReady || Width == 0 || Height == 0)
        return 0;
    auto Texture = std::make_unique<PresentationAllocation::DynamicTexture>();
    Texture->Width = Width;
    Texture->Height = Height;
    VkImageCreateInfo ImageInfo{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    ImageInfo.imageType = VK_IMAGE_TYPE_2D;
    ImageInfo.format = VK_FORMAT_R8G8B8A8_UNORM;
    ImageInfo.extent = {Width, Height, 1};
    ImageInfo.mipLevels = 1;
    ImageInfo.arrayLayers = 1;
    ImageInfo.samples = VK_SAMPLE_COUNT_1_BIT;
    ImageInfo.tiling = VK_IMAGE_TILING_OPTIMAL;
    ImageInfo.usage = VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    ImageInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    RequireSuccess(Resolve<PFN_vkCreateImage>(Display.Instance, "vkCreateImage")(Display.Device, &ImageInfo, nullptr, &Texture->Image));
    VkMemoryRequirements Requirements{};
    Resolve<PFN_vkGetImageMemoryRequirements>(Display.Instance, "vkGetImageMemoryRequirements")(Display.Device, Texture->Image, &Requirements);
    VkPhysicalDeviceMemoryProperties MemoryProperties{};
    Resolve<PFN_vkGetPhysicalDeviceMemoryProperties>(Display.Instance, "vkGetPhysicalDeviceMemoryProperties")(Display.PhysicalDevice, &MemoryProperties);
    uint32_t MemoryType = UINT32_MAX;
    for (uint32_t I = 0; I < MemoryProperties.memoryTypeCount; ++I)
        if ((Requirements.memoryTypeBits & (1u << I)) &&
            (MemoryProperties.memoryTypes[I].propertyFlags & VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT))
        { MemoryType = I; break; }
    if (MemoryType == UINT32_MAX)
        throw std::runtime_error("Vulkan dynamic texture: no device-local memory type.");
    VkMemoryAllocateInfo AllocateInfo{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    AllocateInfo.allocationSize = Requirements.size;
    AllocateInfo.memoryTypeIndex = MemoryType;
    RequireSuccess(Resolve<PFN_vkAllocateMemory>(Display.Instance, "vkAllocateMemory")(Display.Device, &AllocateInfo, nullptr, &Texture->Memory));
    RequireSuccess(Resolve<PFN_vkBindImageMemory>(Display.Instance, "vkBindImageMemory")(Display.Device, Texture->Image, Texture->Memory, 0));
    VkImageViewCreateInfo ViewInfo{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    ViewInfo.image = Texture->Image;
    ViewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
    ViewInfo.format = VK_FORMAT_R8G8B8A8_UNORM;
    ViewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    RequireSuccess(Resolve<PFN_vkCreateImageView>(Display.Instance, "vkCreateImageView")(Display.Device, &ViewInfo, nullptr, &Texture->View));
    VkSamplerCreateInfo SamplerInfo{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
    SamplerInfo.magFilter = VK_FILTER_LINEAR;
    SamplerInfo.minFilter = VK_FILTER_LINEAR;
    SamplerInfo.addressModeU = SamplerInfo.addressModeV = SamplerInfo.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    RequireSuccess(Resolve<PFN_vkCreateSampler>(Display.Instance, "vkCreateSampler")(Display.Device, &SamplerInfo, nullptr, &Texture->Sampler));
    Texture->Set = ImGui_ImplVulkan_AddTexture(Texture->Sampler, Texture->View, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
    const uint64_t Handle = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(Texture->Set));
    Display.DynamicTextures.push_back(std::move(Texture));
    return Handle;
}

void VulkanPresentation::UpdateDynamicTexture(uint64_t Handle, const void *RgbaPixels, uint32_t Width, uint32_t Height)
{
    auto &Display = *Allocation;
    if (!Handle || !RgbaPixels)
        return;
    PresentationAllocation::DynamicTexture *Texture = nullptr;
    for (auto &Candidate : Display.DynamicTextures)
        if (static_cast<uint64_t>(reinterpret_cast<uintptr_t>(Candidate->Set)) == Handle)
            Texture = Candidate.get();
    if (!Texture || Texture->Width != Width || Texture->Height != Height)
        return;
    const VkDeviceSize Bytes = VkDeviceSize(Width) * Height * 4;
    VkBuffer Staging = VK_NULL_HANDLE;
    VkDeviceMemory StagingMemory = VK_NULL_HANDLE;
    VkBufferCreateInfo BufferInfo{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    BufferInfo.size = Bytes;
    BufferInfo.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    RequireSuccess(Resolve<PFN_vkCreateBuffer>(Display.Instance, "vkCreateBuffer")(Display.Device, &BufferInfo, nullptr, &Staging));
    VkMemoryRequirements Requirements{};
    Resolve<PFN_vkGetBufferMemoryRequirements>(Display.Instance, "vkGetBufferMemoryRequirements")(Display.Device, Staging, &Requirements);
    VkPhysicalDeviceMemoryProperties MemoryProperties{};
    Resolve<PFN_vkGetPhysicalDeviceMemoryProperties>(Display.Instance, "vkGetPhysicalDeviceMemoryProperties")(Display.PhysicalDevice, &MemoryProperties);
    uint32_t MemoryType = UINT32_MAX;
    for (uint32_t I = 0; I < MemoryProperties.memoryTypeCount; ++I)
        if ((Requirements.memoryTypeBits & (1u << I)) &&
            (MemoryProperties.memoryTypes[I].propertyFlags & (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)) ==
                (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT))
        { MemoryType = I; break; }
    if (MemoryType == UINT32_MAX)
        throw std::runtime_error("Vulkan dynamic texture: no host-visible memory type.");
    VkMemoryAllocateInfo AllocateInfo{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    AllocateInfo.allocationSize = Requirements.size;
    AllocateInfo.memoryTypeIndex = MemoryType;
    RequireSuccess(Resolve<PFN_vkAllocateMemory>(Display.Instance, "vkAllocateMemory")(Display.Device, &AllocateInfo, nullptr, &StagingMemory));
    RequireSuccess(Resolve<PFN_vkBindBufferMemory>(Display.Instance, "vkBindBufferMemory")(Display.Device, Staging, StagingMemory, 0));
    void *Mapped = nullptr;
    RequireSuccess(Resolve<PFN_vkMapMemory>(Display.Instance, "vkMapMemory")(Display.Device, StagingMemory, 0, Bytes, 0, &Mapped));
    std::memcpy(Mapped, RgbaPixels, size_t(Bytes));
    Resolve<PFN_vkUnmapMemory>(Display.Instance, "vkUnmapMemory")(Display.Device, StagingMemory);
    if (!Display.TexturePool)
    {
        VkCommandPoolCreateInfo PoolInfo{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        PoolInfo.queueFamilyIndex = Display.QueueFamily;
        PoolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        RequireSuccess(Resolve<PFN_vkCreateCommandPool>(Display.Instance, "vkCreateCommandPool")(Display.Device, &PoolInfo, nullptr, &Display.TexturePool));
    }
    VkCommandBufferAllocateInfo CommandInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    CommandInfo.commandPool = Display.TexturePool;
    CommandInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    CommandInfo.commandBufferCount = 1;
    VkCommandBuffer Commands = VK_NULL_HANDLE;
    RequireSuccess(Resolve<PFN_vkAllocateCommandBuffers>(Display.Instance, "vkAllocateCommandBuffers")(Display.Device, &CommandInfo, &Commands));
    VkCommandBufferBeginInfo Begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    RequireSuccess(Resolve<PFN_vkBeginCommandBuffer>(Display.Instance, "vkBeginCommandBuffer")(Commands, &Begin));
    VkImageMemoryBarrier Barrier{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    Barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    Barrier.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    Barrier.srcQueueFamilyIndex = Barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    Barrier.image = Texture->Image;
    Barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    Barrier.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    Resolve<PFN_vkCmdPipelineBarrier>(Display.Instance, "vkCmdPipelineBarrier")(Commands, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
        VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1, &Barrier);
    VkBufferImageCopy Region{};
    Region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    Region.imageExtent = {Width, Height, 1};
    Resolve<PFN_vkCmdCopyBufferToImage>(Display.Instance, "vkCmdCopyBufferToImage")(Commands, Staging, Texture->Image,
        VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &Region);
    Barrier.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    Barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    Barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    Resolve<PFN_vkCmdPipelineBarrier>(Display.Instance, "vkCmdPipelineBarrier")(Commands, VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 0, 0, nullptr, 0, nullptr, 1, &Barrier);
    RequireSuccess(Resolve<PFN_vkEndCommandBuffer>(Display.Instance, "vkEndCommandBuffer")(Commands));
    VkSubmitInfo Submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    Submit.commandBufferCount = 1;
    Submit.pCommandBuffers = &Commands;
    RequireSuccess(Display.QueueSubmit(Display.Queue, 1, &Submit, VK_NULL_HANDLE));
    RequireSuccess(Display.DeviceWaitIdle(Display.Device));
    Resolve<PFN_vkFreeCommandBuffers>(Display.Instance, "vkFreeCommandBuffers")(Display.Device, Display.TexturePool, 1, &Commands);
    Resolve<PFN_vkDestroyBuffer>(Display.Instance, "vkDestroyBuffer")(Display.Device, Staging, nullptr);
    Resolve<PFN_vkFreeMemory>(Display.Instance, "vkFreeMemory")(Display.Device, StagingMemory, nullptr);
}

void VulkanPresentation::DestroyDynamicTexture(uint64_t Handle)
{
    auto &Display = *Allocation;
    for (auto It = Display.DynamicTextures.begin(); It != Display.DynamicTextures.end(); ++It)
    {
        auto &Texture = *It;
        if (static_cast<uint64_t>(reinterpret_cast<uintptr_t>(Texture->Set)) != Handle)
            continue;
        if (Display.Device && Display.DeviceWaitIdle)
            (void)Display.DeviceWaitIdle(Display.Device);
        if (Texture->Set) ImGui_ImplVulkan_RemoveTexture(Texture->Set);
        if (Texture->Sampler) Resolve<PFN_vkDestroySampler>(Display.Instance, "vkDestroySampler")(Display.Device, Texture->Sampler, nullptr);
        if (Texture->View) Resolve<PFN_vkDestroyImageView>(Display.Instance, "vkDestroyImageView")(Display.Device, Texture->View, nullptr);
        if (Texture->Image) Resolve<PFN_vkDestroyImage>(Display.Instance, "vkDestroyImage")(Display.Device, Texture->Image, nullptr);
        if (Texture->Memory) Resolve<PFN_vkFreeMemory>(Display.Instance, "vkFreeMemory")(Display.Device, Texture->Memory, nullptr);
        Display.DynamicTextures.erase(It);
        return;
    }
}

bool VulkanPresentation::Reconfigure(int Width, int Height)
{
    auto &Display = *Allocation;
    if (Width <= 0 || Height <= 0)
        return false;
    if (Display.Rebuild || Width != Display.Main.Width || Height != Display.Main.Height)
    {
        RequireSuccess(Display.DeviceWaitIdle(Display.Device));
        ImGui_ImplVulkan_SetMinImageCount(2);
        ImGui_ImplVulkanH_CreateOrResizeWindow(Display.Instance, Display.PhysicalDevice, Display.Device, &Display.Main,
                                               Display.QueueFamily, nullptr, Width, Height, 2, 0);
        Display.Main.FrameIndex = 0;
        Display.Rebuild         = false;
    }
    return true;
}

void VulkanPresentation::RenderMain(ImDrawData *Commands)
{
    auto &Display          = *Allocation;
    auto &Main             = Display.Main;
    Display.Submitted      = false;
    const auto &Semaphores = Main.FrameSemaphores[Main.SemaphoreIndex];
    const auto  Result =
        Display.AcquireNextImageKHR(Display.Device, Main.Swapchain, UINT64_MAX, Semaphores.ImageAcquiredSemaphore,
                                    VK_NULL_HANDLE, &Main.FrameIndex);
    if (Result == VK_ERROR_OUT_OF_DATE_KHR)
    {
        Display.Rebuild = true;
        return;
    }
    if (Result == VK_SUBOPTIMAL_KHR)
        Display.Rebuild = true;
    else
        RequireSuccess(Result);
    static int TracedFrames = 0;
    const bool TraceFrame = TracedFrames < 4;
    if (TraceFrame) DiagnosticJournal::Append("FrameAcquire", "image=" + std::to_string(Main.FrameIndex));
    auto &Submission = Main.Frames[Main.FrameIndex];
    if (TraceFrame) DiagnosticJournal::Append("FrameWait", "image=" + std::to_string(Main.FrameIndex) +
        " serial=" + std::to_string(Display.ImageSerials.size() == Main.ImageCount ? Display.ImageSerials[Main.FrameIndex] : 0));
    RequireSuccess(Display.WaitForFences(Display.Device, 1, &Submission.Fence, VK_TRUE, UINT64_MAX));
    if (TraceFrame) DiagnosticJournal::Append("FrameFenced", "image=" + std::to_string(Main.FrameIndex));
    if (Display.ImageSerials.size() != Main.ImageCount)
    {
        // 📝 Reconfigure waits for device completion before replacing swapchain allocations.
        Display.CompletedSerial = Display.SubmissionSerial;
        Display.ImageSerials.assign(Main.ImageCount, 0);
    }
    Display.CompletedSerial = std::max(Display.CompletedSerial, Display.ImageSerials[Main.FrameIndex]);
    RequireSuccess(Display.ResetCommandPool(Display.Device, Submission.CommandPool, 0));
    VkCommandBufferBeginInfo Begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    RequireSuccess(Display.BeginCommandBuffer(Submission.CommandBuffer, &Begin));
    if (Display.ConstructGpu) Display.ConstructGpu(Submission.CommandBuffer, Display.CompletedSerial, Display.SubmissionSerial + 1);
    VkRenderPassBeginInfo Rasterization{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    Rasterization.renderPass        = Main.RenderPass;
    Rasterization.framebuffer       = Submission.Framebuffer;
    Rasterization.renderArea.extent = {static_cast<uint32_t>(Main.Width), static_cast<uint32_t>(Main.Height)};
    Rasterization.clearValueCount   = 1;
    Rasterization.pClearValues      = &Main.ClearValue;
    Display.CmdBeginRenderPass(Submission.CommandBuffer, &Rasterization, VK_SUBPASS_CONTENTS_INLINE);
    ImGui_ImplVulkan_RenderDrawData(Commands, Submission.CommandBuffer);
    Display.CmdEndRenderPass(Submission.CommandBuffer);
    RequireSuccess(Display.EndCommandBuffer(Submission.CommandBuffer));
    constexpr VkPipelineStageFlags Wait = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo                   Submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    Submit.waitSemaphoreCount   = 1;
    Submit.pWaitSemaphores      = &Semaphores.ImageAcquiredSemaphore;
    Submit.pWaitDstStageMask    = &Wait;
    Submit.commandBufferCount   = 1;
    Submit.pCommandBuffers      = &Submission.CommandBuffer;
    Submit.signalSemaphoreCount = 1;
    Submit.pSignalSemaphores    = &Semaphores.RenderCompleteSemaphore;
    RequireSuccess(Display.ResetFences(Display.Device, 1, &Submission.Fence));
    RequireSuccess(Display.QueueSubmit(Display.Queue, 1, &Submit, Submission.Fence));
    Display.ImageSerials[Main.FrameIndex] = ++Display.SubmissionSerial;
    if (TraceFrame)
    {
        DiagnosticJournal::Append("FrameSubmit", "serial=" + std::to_string(Display.SubmissionSerial));
        ++TracedFrames;
    }
    if (Display.ConfirmGpu) Display.ConfirmGpu();
    Display.Submitted = true;
}

void VulkanPresentation::AwaitCompletion() noexcept
{
    if (Allocation && Allocation->Device && Allocation->DeviceWaitIdle)
        (void)Allocation->DeviceWaitIdle(Allocation->Device);
}

void VulkanPresentation::PresentMain()
{
    auto &Display = *Allocation;
    if (!Display.Submitted)
        return;
    auto            &Main = Display.Main;
    VkPresentInfoKHR Present{VK_STRUCTURE_TYPE_PRESENT_INFO_KHR};
    Present.waitSemaphoreCount = 1;
    Present.pWaitSemaphores    = &Main.FrameSemaphores[Main.SemaphoreIndex].RenderCompleteSemaphore;
    Present.swapchainCount     = 1;
    Present.pSwapchains        = &Main.Swapchain;
    Present.pImageIndices      = &Main.FrameIndex;
    const auto Result          = Display.QueuePresentKHR(Display.Queue, &Present);
    if (Result == VK_ERROR_OUT_OF_DATE_KHR || Result == VK_SUBOPTIMAL_KHR)
        Display.Rebuild = true;
    else
        RequireSuccess(Result);
    Main.SemaphoreIndex = (Main.SemaphoreIndex + 1) % Main.SemaphoreCount;
    static int TracedPresents = 0;
    if (TracedPresents < 4)
    {
        DiagnosticJournal::Append("FramePresented", "serial=" + std::to_string(Display.SubmissionSerial));
        ++TracedPresents;
    }
    Display.Submitted   = false;
}
} // namespace Frontier
