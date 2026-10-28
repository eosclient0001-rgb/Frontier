/*==========================================================================================================================================
                                               REPLAYVIEWPORTRENDERER.CPP
==========================================================================================================================================*/
// 🧩 Live ReSTIR viewport renderer: combined temporal + spatial + seed-bank reservoir replay on Engine shaders.
// 📝 The submission pattern mirrors the validated LightCompute exhibit host (same buffers, push constants,
//    recorder and reset policy), productised here as Engine code: it loads an explicit Vulkan driver
//    library, owns a compute-only device, and records Frontier::RecordPathReplay with primary visibility,
//    temporal + spatial reservoir reuse and the seed-bank sample history all enabled. Scene, camera and
//    history lifecycle follow the combined-mode contract in ReplaySampleCombined.md.

#include "ReplayViewportRenderer.h"

#include "LightComputeFootprint.h"
#include "PathReplayDomain.h"
#include "PathReplayVulkan.h"
#include "TriangleVisibilitySpace.h"
#include "VisibilityCull.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <fstream>
#include <stdexcept>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#endif

#include <vulkan/vulkan.h>

namespace Frontier
{
namespace
{
void Require(bool Condition, const char *Message)
{
    if (!Condition) throw std::runtime_error(Message);
}
void Confirm(VkResult Result)
{
    if (Result != VK_SUCCESS) throw std::runtime_error("Vulkan viewport call failed: " + std::to_string(int(Result)));
}

#define FRONTIER_VIEWPORT_FUNCTIONS(F)                                                                                  \
    F(DestroyInstance) F(GetPhysicalDeviceProperties) F(GetPhysicalDeviceMemoryProperties)                              \
    F(GetPhysicalDeviceQueueFamilyProperties) F(EnumeratePhysicalDevices) F(CreateDevice) F(DestroyDevice)              \
    F(GetDeviceQueue) F(DeviceWaitIdle) F(CreateBuffer) F(DestroyBuffer) F(GetBufferMemoryRequirements)                 \
    F(AllocateMemory) F(FreeMemory) F(BindBufferMemory) F(MapMemory) F(UnmapMemory) F(CreateDescriptorSetLayout)        \
    F(DestroyDescriptorSetLayout) F(CreateDescriptorPool) F(DestroyDescriptorPool) F(AllocateDescriptorSets)            \
    F(UpdateDescriptorSets) F(CreatePipelineLayout) F(DestroyPipelineLayout) F(CreateShaderModule)                      \
    F(DestroyShaderModule) F(CreateComputePipelines) F(DestroyPipeline) F(CreateCommandPool) F(DestroyCommandPool)      \
    F(AllocateCommandBuffers) F(BeginCommandBuffer) F(EndCommandBuffer) F(ResetCommandPool) F(CmdBindPipeline)          \
    F(CmdBindDescriptorSets) F(CmdPushConstants) F(CmdDispatch) F(CmdPipelineBarrier) F(QueueSubmit) F(CreateFence)     \
    F(DestroyFence) F(WaitForFences) F(ResetFences)

struct BufferSpan
{
    VkBuffer Buffer = VK_NULL_HANDLE;
    VkDeviceMemory Memory = VK_NULL_HANDLE;
    void *Address = nullptr;
    size_t Size = 0;
};
} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       ALLOCATION
//------------------------------------------------------------------------------------------------------------------------

struct ReplayViewportRenderer::Allocation
{
#ifdef _WIN32
    HMODULE Library = nullptr;
#else
    void *Library = nullptr;
#endif
    PFN_vkGetInstanceProcAddr Resolve = nullptr;
#define FRONTIER_DECLARE(Name) PFN_vk##Name Name = nullptr;
    FRONTIER_VIEWPORT_FUNCTIONS(FRONTIER_DECLARE)
#undef FRONTIER_DECLARE
    VkInstance Instance = VK_NULL_HANDLE;
    VkPhysicalDevice Physical = VK_NULL_HANDLE;
    VkDevice Device = VK_NULL_HANDLE;
    VkQueue Queue = VK_NULL_HANDLE;
    uint32_t Family = 0;
    VkPhysicalDeviceProperties Properties{};
    VkPhysicalDeviceMemoryProperties MemoryProperties{};
    VkCommandPool Pool = VK_NULL_HANDLE;
    VkCommandBuffer Commands = VK_NULL_HANDLE;
    VkFence Completion = VK_NULL_HANDLE;
    VkDescriptorSetLayout DescriptorLayout = VK_NULL_HANDLE;
    VkDescriptorPool Descriptors = VK_NULL_HANDLE;
    VkDescriptorSet DescriptorSet = VK_NULL_HANDLE;
    VkPipelineLayout PipelineLayout = VK_NULL_HANDLE;
    VkPipeline PrimaryPipeline = VK_NULL_HANDLE, GeneratePipeline = VK_NULL_HANDLE, ResolvePipeline = VK_NULL_HANDLE;
    VkPipeline GatherPipeline = VK_NULL_HANDLE, FinalizePipeline = VK_NULL_HANDLE;
    std::array<BufferSpan, 8> Buffers{};

    uint32_t Width = 0, Height = 0;
    std::vector<PathReplayFacet> Surfaces;
    std::vector<TriangleVisibilitySpace::FloatEnclosure> Enclosures;
    std::vector<TriangleVisibilitySpace::FloatFacet> Corners;
    uint32_t FacetStart = 0;
    PathReplayHistoryDomain Domain;
    uint32_t HistorySequence = 0;
    bool HistoryActive = false;
    bool PreviousTemporal = false, PreviousSpatial = false;
    std::array<std::array<float, 4>, 12> Camera{};
    std::array<std::array<float, 4>, 12> PreviousCamera{};
    bool HasPreviousCamera = false;
    uint32_t Frame = 0;

    template <class T> T Lookup(const char *Name)
    {
        auto Address = Resolve(Instance, Name);
        Require(Address != nullptr, Name);
        return reinterpret_cast<T>(Address);
    }

    void ConstructBuffer(uint32_t Index, size_t Size)
    {
        auto &B = Buffers[Index];
        B.Size = std::max<size_t>(16, Size);
        VkBufferCreateInfo Creation{};
        Creation.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
        Creation.size = B.Size;
        Creation.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
        Confirm(CreateBuffer(Device, &Creation, nullptr, &B.Buffer));
        VkMemoryRequirements Requirements{};
        GetBufferMemoryRequirements(Device, B.Buffer, &Requirements);
        uint32_t Type = UINT32_MAX;
        for (uint32_t I = 0; I < MemoryProperties.memoryTypeCount; ++I)
            if ((Requirements.memoryTypeBits & (1u << I)) &&
                (MemoryProperties.memoryTypes[I].propertyFlags &
                 (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)) ==
                    (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT))
            { Type = I; break; }
        Require(Type != UINT32_MAX, "No host-visible coherent memory for viewport buffers");
        VkMemoryAllocateInfo AllocationInfo{};
        AllocationInfo.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
        AllocationInfo.allocationSize = Requirements.size;
        AllocationInfo.memoryTypeIndex = Type;
        Confirm(AllocateMemory(Device, &AllocationInfo, nullptr, &B.Memory));
        Confirm(BindBufferMemory(Device, B.Buffer, B.Memory, 0));
        Confirm(MapMemory(Device, B.Memory, 0, B.Size, 0, &B.Address));
    }

    VkPipeline ConstructPipeline(const std::string &Path)
    {
        std::ifstream Input(Path, std::ios::binary | std::ios::ate);
        Require(bool(Input), "Viewport SPIR-V file unavailable");
        const auto Length = Input.tellg();
        Require(Length > 0 && Length < 64 * 1024 * 1024 && Length % 4 == 0, "Invalid viewport SPIR-V extent");
        std::vector<uint32_t> Words(size_t(Length) / 4);
        Input.seekg(0);
        Input.read(reinterpret_cast<char *>(Words.data()), Length);
        Require(bool(Input) && Words[0] == 0x07230203u, "Invalid viewport SPIR-V payload");
        VkShaderModuleCreateInfo Creation{};
        Creation.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
        Creation.codeSize = size_t(Length);
        Creation.pCode = Words.data();
        VkShaderModule Shader = VK_NULL_HANDLE;
        Confirm(CreateShaderModule(Device, &Creation, nullptr, &Shader));
        VkComputePipelineCreateInfo Pipeline{};
        Pipeline.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        Pipeline.layout = PipelineLayout;
        Pipeline.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        Pipeline.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        Pipeline.stage.module = Shader;
        Pipeline.stage.pName = "main";
        VkPipeline Result = VK_NULL_HANDLE;
        const VkResult Status = CreateComputePipelines(Device, VK_NULL_HANDLE, 1, &Pipeline, nullptr, &Result);
        DestroyShaderModule(Device, Shader, nullptr);
        Confirm(Status);
        return Result;
    }

    // 📝 Bounded diffuse room: coloured walls, a centre blocker and two emissive panels. Geometry is
    //    static; only the camera drifts, which is the validated camera-only history transition.
    void BuildScene()
    {
        struct Patch { std::array<SpatialVector, 3> Corners; std::array<float, 3> Normal, Albedo, Radiance; float Token; };
        std::vector<Patch> Patches;
        const auto Quad = [&](SpatialVector A, SpatialVector B, SpatialVector C, SpatialVector D,
                              std::array<float, 3> Normal, std::array<float, 3> Albedo,
                              std::array<float, 3> Radiance, float Token)
        {
            Patches.push_back({{A, B, C}, Normal, Albedo, Radiance, Token});
            Patches.push_back({{A, C, D}, Normal, Albedo, Radiance, Token});
        };
        Quad({-5,-6,0}, {5,-6,0}, {5,6,0}, {-5,6,0}, {0,0,1}, {.48f,.46f,.44f}, {0,0,0}, 1);            // floor
        Quad({-5,-6,3.4}, {-5,6,3.4}, {5,6,3.4}, {5,-6,3.4}, {0,0,-1}, {.60f,.60f,.62f}, {0,0,0}, 1);     // ceiling
        Quad({-5,6,0}, {5,6,0}, {5,6,3.4}, {-5,6,3.4}, {0,-1,0}, {.55f,.50f,.45f}, {0,0,0}, 1);          // front wall
        Quad({5,-6,0}, {-5,-6,0}, {-5,-6,3.4}, {5,-6,3.4}, {0,1,0}, {.50f,.50f,.50f}, {0,0,0}, 1);        // back wall
        Quad({-5,-6,0}, {-5,6,0}, {-5,6,3.4}, {-5,-6,3.4}, {1,0,0}, {.60f,.42f,.34f}, {0,0,0}, 1);       // left (warm)
        Quad({5,6,0}, {5,-6,0}, {5,-6,3.4}, {5,6,3.4}, {-1,0,0}, {.36f,.44f,.58f}, {0,0,0}, 1);          // right (cool)
        Quad({-1.5,-1.5,3.39}, {-1.5,1.5,3.39}, {1.5,1.5,3.39}, {1.5,-1.5,3.39}, {0,0,-1}, {0,0,0},
             {6.f,5.6f,4.8f}, 3);                                                                           // ceiling light
        Quad({4.99,0.5,1.1}, {4.99,2.5,1.1}, {4.99,2.5,2.5}, {4.99,0.5,2.5}, {-1,0,0}, {0,0,0},
             {3.5f,3.2f,2.6f}, 3);                                                                          // window light
        const auto Box = [&](SpatialVector Min, SpatialVector Max, std::array<float, 3> Albedo)
        {
            Quad({Min.X,Min.Y,Max.Z}, {Max.X,Min.Y,Max.Z}, {Max.X,Max.Y,Max.Z}, {Min.X,Max.Y,Max.Z}, {0,0,1}, Albedo, {0,0,0}, 2);
            Quad({Min.X,Max.Y,Min.Z}, {Max.X,Max.Y,Min.Z}, {Max.X,Max.Y,Max.Z}, {Min.X,Max.Y,Max.Z}, {0,1,0}, Albedo, {0,0,0}, 2);
            Quad({Max.X,Min.Y,Min.Z}, {Min.X,Min.Y,Min.Z}, {Min.X,Max.Y,Min.Z}, {Max.X,Max.Y,Min.Z}, {0,-1,0}, Albedo, {0,0,0}, 2);
            Quad({Max.X,Max.Y,Min.Z}, {Max.X,Min.Y,Min.Z}, {Max.X,Min.Y,Max.Z}, {Max.X,Max.Y,Max.Z}, {1,0,0}, Albedo, {0,0,0}, 2);
            Quad({Min.X,Min.Y,Min.Z}, {Min.X,Max.Y,Min.Z}, {Min.X,Max.Y,Max.Z}, {Min.X,Min.Y,Max.Z}, {-1,0,0}, Albedo, {0,0,0}, 2);
        };
        Box({0.2,-0.4,0}, {1.8,1.2,1.7}, {.30f,.34f,.40f});                                                 // centre blocker

        std::vector<std::array<SpatialVector, 3>> Geometry;
        for (const auto &P : Patches) Geometry.push_back(P.Corners);
        TriangleVisibilitySpace Space;
        Space.Build(Geometry);
        const auto Atlas = Space.PackFloat32();
        Enclosures = Atlas.Enclosures;
        Corners = Atlas.Corners;
        for (size_t Index = 0; Index < Atlas.Corners.size(); ++Index)
        {
            const auto &Triangle = Atlas.Corners[Index];
            const auto &P = Patches[Atlas.OriginalFacets[Index]];
            PathReplayFacet Facet;
            Facet.A = Triangle.A; Facet.B = Triangle.B; Facet.C = Triangle.C;
            Facet.NormalA = Facet.NormalB = Facet.NormalC = {P.Normal[0], P.Normal[1], P.Normal[2], 0};
            Facet.AlbedoRoughness = {P.Albedo[0], P.Albedo[1], P.Albedo[2], 1};
            Facet.OpticalToken = {0, 1.5f, .5f, P.Token};
            Facet.Emissive = {P.Radiance[0], P.Radiance[1], P.Radiance[2], 0};
            Surfaces.push_back(Facet);
        }
    }

    void SetCamera(float DriftX)
    {
        PreviousCamera = HasPreviousCamera ? Camera : Camera;
        const float Aspect = Height > 0 ? float(Width) / float(Height) : 1.6f;
        Camera[0] = {DriftX, -3.4f, 1.7f, .01f};
        Camera[1] = {0, 1, 0, 40};
        Camera[2] = {1, 0, 0, .70f};
        Camera[3] = {0, 0, 1, .70f / Aspect};
        if (!HasPreviousCamera) PreviousCamera = Camera;
        Camera[4] = PreviousCamera[0];
        Camera[5] = PreviousCamera[1];
        Camera[6] = PreviousCamera[2];
        Camera[7] = PreviousCamera[3];
        Camera[8] = {0, 0, 1000, 0};
        Camera[9] = Camera[8];
        Camera[10] = {0, 0, 0, 1};
        Camera[11] = {1, 0, 1, 0};
        HasPreviousCamera = true;
    }

    void Release() noexcept
    {
        if (Device)
        {
            (void)DeviceWaitIdle(Device);
            for (VkPipeline Pipeline : {PrimaryPipeline, GeneratePipeline, ResolvePipeline, GatherPipeline, FinalizePipeline})
                if (Pipeline) DestroyPipeline(Device, Pipeline, nullptr);
            if (PipelineLayout) DestroyPipelineLayout(Device, PipelineLayout, nullptr);
            if (Descriptors) DestroyDescriptorPool(Device, Descriptors, nullptr);
            if (DescriptorLayout) DestroyDescriptorSetLayout(Device, DescriptorLayout, nullptr);
            for (auto &B : Buffers)
            {
                if (B.Address) UnmapMemory(Device, B.Memory);
                if (B.Buffer) DestroyBuffer(Device, B.Buffer, nullptr);
                if (B.Memory) FreeMemory(Device, B.Memory, nullptr);
            }
            if (Completion) DestroyFence(Device, Completion, nullptr);
            if (Pool) DestroyCommandPool(Device, Pool, nullptr);
            DestroyDevice(Device, nullptr);
            Device = VK_NULL_HANDLE;
        }
        if (Instance && DestroyInstance) DestroyInstance(Instance, nullptr);
        Instance = VK_NULL_HANDLE;
#ifdef _WIN32
        if (Library) FreeLibrary(Library);
#else
        if (Library) dlclose(Library);
#endif
        Library = nullptr;
    }
};

ReplayViewportRenderer::ReplayViewportRenderer() : Impl(std::make_unique<Allocation>()) {}
ReplayViewportRenderer::~ReplayViewportRenderer() { Release(); }

//------------------------------------------------------------------------------------------------------------------------
//                                                        LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

bool ReplayViewportRenderer::Initialize(const char *DriverPath, const std::string &ShaderDirectory,
                                        uint32_t InWidth, uint32_t InHeight, std::string &Diagnostic)
{
    try
    {
        auto &A = *Impl;
        A.Width = InWidth;
        A.Height = InHeight;
        Require(DriverPath != nullptr && InWidth > 0 && InHeight > 0 && InWidth * InHeight <= 1048576u,
                "Invalid viewport extent or driver");
#ifdef _WIN32
        A.Library = LoadLibraryA(DriverPath);
        if (A.Library) A.Resolve = reinterpret_cast<PFN_vkGetInstanceProcAddr>(GetProcAddress(A.Library, "vkGetInstanceProcAddr"));
#else
        A.Library = dlopen(DriverPath, RTLD_NOW | RTLD_LOCAL);
        if (A.Library) A.Resolve = reinterpret_cast<PFN_vkGetInstanceProcAddr>(dlsym(A.Library, "vkGetInstanceProcAddr"));
#endif
        Require(A.Resolve != nullptr, "Explicit Vulkan library could not load");
        VkApplicationInfo Application{};
        Application.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
        Application.pApplicationName = "Frontier ReSTIR viewport";
        Application.apiVersion = VK_API_VERSION_1_1;
        VkInstanceCreateInfo Creation{};
        Creation.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
        Creation.pApplicationInfo = &Application;
        Require(A.Lookup<PFN_vkCreateInstance>("vkCreateInstance")(&Creation, nullptr, &A.Instance) == VK_SUCCESS,
                "Viewport Vulkan instance failed");
#define FRONTIER_LOAD(Name) A.Name = A.Lookup<PFN_vk##Name>("vk" #Name);
        FRONTIER_VIEWPORT_FUNCTIONS(FRONTIER_LOAD)
#undef FRONTIER_LOAD
        uint32_t Count = 0;
        Confirm(A.EnumeratePhysicalDevices(A.Instance, &Count, nullptr));
        Require(Count > 0, "No Vulkan physical device enumerated");
        std::vector<VkPhysicalDevice> Devices(Count);
        Confirm(A.EnumeratePhysicalDevices(A.Instance, &Count, Devices.data()));
        for (auto Candidate : Devices)
        {
            uint32_t Families = 0;
            A.GetPhysicalDeviceQueueFamilyProperties(Candidate, &Families, nullptr);
            std::vector<VkQueueFamilyProperties> Queues(Families);
            A.GetPhysicalDeviceQueueFamilyProperties(Candidate, &Families, Queues.data());
            for (uint32_t I = 0; I < Families; ++I)
                if (Queues[I].queueFlags & VK_QUEUE_COMPUTE_BIT) { A.Physical = Candidate; A.Family = I; break; }
            if (A.Physical) break;
        }
        Require(A.Physical != VK_NULL_HANDLE, "No compute-capable Vulkan queue");
        A.GetPhysicalDeviceProperties(A.Physical, &A.Properties);
        A.GetPhysicalDeviceMemoryProperties(A.Physical, &A.MemoryProperties);
        Require(A.Properties.apiVersion >= VK_API_VERSION_1_1, "Vulkan 1.1 device required");
        const float Priority = 1.0f;
        VkDeviceQueueCreateInfo QueueInfo{};
        QueueInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
        QueueInfo.queueFamilyIndex = A.Family;
        QueueInfo.queueCount = 1;
        QueueInfo.pQueuePriorities = &Priority;
        VkDeviceCreateInfo DeviceInfo{};
        DeviceInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
        DeviceInfo.queueCreateInfoCount = 1;
        DeviceInfo.pQueueCreateInfos = &QueueInfo;
        Confirm(A.CreateDevice(A.Physical, &DeviceInfo, nullptr, &A.Device));
        A.GetDeviceQueue(A.Device, A.Family, 0, &A.Queue);

        A.BuildScene();
        const uint32_t Receivers = InWidth * InHeight;
        A.ConstructBuffer(0, 16);
        A.ConstructBuffer(1, size_t(Receivers) * sizeof(PathReplayReceiver));
        A.ConstructBuffer(2, A.Enclosures.size() * sizeof(TriangleVisibilitySpace::FloatEnclosure));
        A.ConstructBuffer(3, A.Surfaces.size() * sizeof(PathReplayFacet));
        A.FacetStart = PathReplayCameraFloats + 1024;
        A.ConstructBuffer(4, (size_t(A.FacetStart) + 1 + A.Surfaces.size() * 4) * sizeof(float));
        A.ConstructBuffer(5, 256 * 17 * 4);
        A.ConstructBuffer(6, size_t(PathReplayRequiredSampleHistoryOutputRecords(Receivers)) * 16);
        A.ConstructBuffer(7, 96);
        std::memcpy(A.Buffers[2].Address, A.Enclosures.data(), A.Enclosures.size() * sizeof(TriangleVisibilitySpace::FloatEnclosure));
        std::memcpy(A.Buffers[3].Address, A.Surfaces.data(), A.Surfaces.size() * sizeof(PathReplayFacet));

        std::array<VkDescriptorSetLayoutBinding, 8> Slots{};
        for (uint32_t I = 0; I < 8; ++I)
        {
            Slots[I].binding = I;
            Slots[I].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            Slots[I].descriptorCount = 1;
            Slots[I].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        }
        VkDescriptorSetLayoutCreateInfo Layout{};
        Layout.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        Layout.bindingCount = 8;
        Layout.pBindings = Slots.data();
        Confirm(A.CreateDescriptorSetLayout(A.Device, &Layout, nullptr, &A.DescriptorLayout));
        VkPushConstantRange Push{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(LightComputeFootprint)};
        VkPipelineLayoutCreateInfo PipelineCreation{};
        PipelineCreation.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        PipelineCreation.setLayoutCount = 1;
        PipelineCreation.pSetLayouts = &A.DescriptorLayout;
        PipelineCreation.pushConstantRangeCount = 1;
        PipelineCreation.pPushConstantRanges = &Push;
        Confirm(A.CreatePipelineLayout(A.Device, &PipelineCreation, nullptr, &A.PipelineLayout));
        VkDescriptorPoolSize PoolSize{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 8};
        VkDescriptorPoolCreateInfo DescriptorCreation{};
        DescriptorCreation.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
        DescriptorCreation.maxSets = 1;
        DescriptorCreation.poolSizeCount = 1;
        DescriptorCreation.pPoolSizes = &PoolSize;
        Confirm(A.CreateDescriptorPool(A.Device, &DescriptorCreation, nullptr, &A.Descriptors));
        VkDescriptorSetAllocateInfo AllocationInfo{};
        AllocationInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        AllocationInfo.descriptorPool = A.Descriptors;
        AllocationInfo.descriptorSetCount = 1;
        AllocationInfo.pSetLayouts = &A.DescriptorLayout;
        Confirm(A.AllocateDescriptorSets(A.Device, &AllocationInfo, &A.DescriptorSet));
        std::array<VkDescriptorBufferInfo, 8> Spans{};
        std::array<VkWriteDescriptorSet, 8> Writes{};
        for (uint32_t I = 0; I < 8; ++I)
        {
            Spans[I] = {A.Buffers[I].Buffer, 0, VK_WHOLE_SIZE};
            Writes[I].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            Writes[I].dstSet = A.DescriptorSet;
            Writes[I].dstBinding = I;
            Writes[I].descriptorCount = 1;
            Writes[I].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            Writes[I].pBufferInfo = &Spans[I];
        }
        A.UpdateDescriptorSets(A.Device, 8, Writes.data(), 0, nullptr);
        VkCommandPoolCreateInfo PoolInfo{};
        PoolInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
        PoolInfo.queueFamilyIndex = A.Family;
        PoolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        Confirm(A.CreateCommandPool(A.Device, &PoolInfo, nullptr, &A.Pool));
        VkCommandBufferAllocateInfo CommandInfo{};
        CommandInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        CommandInfo.commandPool = A.Pool;
        CommandInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        CommandInfo.commandBufferCount = 1;
        Confirm(A.AllocateCommandBuffers(A.Device, &CommandInfo, &A.Commands));
        VkFenceCreateInfo FenceInfo{};
        FenceInfo.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
        Confirm(A.CreateFence(A.Device, &FenceInfo, nullptr, &A.Completion));

        A.PrimaryPipeline = A.ConstructPipeline(ShaderDirectory + "/Primary.spv");
        A.GeneratePipeline = A.ConstructPipeline(ShaderDirectory + "/ReplayGenerate.spv");
        A.ResolvePipeline = A.ConstructPipeline(ShaderDirectory + "/ReplayResolve.spv");
        A.GatherPipeline = A.ConstructPipeline(ShaderDirectory + "/ReplayGatherSampleHistory.spv");
        A.FinalizePipeline = A.ConstructPipeline(ShaderDirectory + "/ReplayFinalizeSampleHistory.spv");
        return true;
    }
    catch (const std::exception &Failure)
    {
        Diagnostic = Failure.what();
        Impl->Release();
        return false;
    }
}

bool ReplayViewportRenderer::RenderFrame(std::vector<std::array<uint8_t, 4>> &Rgba,
                                         ReplayViewportStats &Stats, std::string &Diagnostic)
{
    auto &A = *Impl;
    if (!A.Device)
    {
        Diagnostic = "Viewport renderer is not initialised";
        return false;
    }
    try
    {
        const auto Started = std::chrono::steady_clock::now();
        const uint32_t Receivers = A.Width * A.Height;
        A.SetCamera(0.6f * std::sin(float(A.Frame) * 0.02f));

        std::vector<PathReplayReceiver> EmptyReceivers(Receivers);
        std::memcpy(A.Buffers[1].Address, EmptyReceivers.data(), EmptyReceivers.size() * sizeof(PathReplayReceiver));
        std::memset(A.Buffers[4].Address, 0, A.Buffers[4].Size);
        float *Angles = static_cast<float *>(A.Buffers[4].Address);
        std::memcpy(Angles, A.Camera.data(), sizeof(A.Camera));

        const PathReplayHistorySpecification Specification{4, .01f, {.025f, .025f, .025f}, true,
                                                           false, false, false, false, false, false, false, false, false, 1};
        const PathReplaySceneView View{EmptyReceivers, A.Surfaces, A.Enclosures, A.Corners, {}, A.Camera, 0};
        ValidatePathReplayDomain(View, {true, false, false, false, true});
        const PathReplayHistoryDecision Decision = A.Domain.Resolve(View, Specification, false);
        const bool CameraTransition = Decision.CameraOnly;
        const bool Reset = A.Frame == 0 || (Decision.Changed && !CameraTransition) || !A.HistoryActive;

        LightComputeFootprint Extent;
        Extent.Dimensions[0] = Receivers;
        Extent.Grid[3] = uint32_t(A.Enclosures.size());
        Extent.Sampling = {150001u + 7919u * A.Frame, 0, uint32_t(A.Surfaces.size()), 64};
        Extent.History = {A.Width, A.Height, Reset ? 0u : A.HistorySequence, Reset ? 1u : 0u};
        Extent.Reconstruction = {1, 1, 0, Decision.MaximumHistory};
        const uint32_t Flags = PathReplaySampleHistory | (Reset ? PathReplayResetSampleHistory : 0u);
        Extent.Primary = {1, 0, 4, Flags};
        Extent.Minimum = {.025f, .025f, .025f, 0};
        Extent.Maximum = {.01f, 0, 0, 0};
        std::memcpy(&Extent.Maximum[1], &A.FacetStart, sizeof(A.FacetStart));
        std::memset(A.Buffers[7].Address, 0, 96);

        Confirm(A.ResetCommandPool(A.Device, A.Pool, 0));
        Confirm(A.ResetFences(A.Device, 1, &A.Completion));
        VkCommandBufferBeginInfo Begin{};
        Begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        Confirm(A.BeginCommandBuffer(A.Commands, &Begin));
        VkMemoryBarrier Barrier{};
        Barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        Barrier.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        A.CmdPipelineBarrier(A.Commands, VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
        const PathReplayVulkanAccess Access{A.PipelineLayout, A.DescriptorSet, A.PrimaryPipeline,
            A.GeneratePipeline, A.ResolvePipeline, A.CmdBindPipeline, A.CmdBindDescriptorSets,
            A.CmdPushConstants, A.CmdDispatch, A.CmdPipelineBarrier,
            A.Properties.limits.maxComputeWorkGroupCount[0], A.Properties.limits.maxPushConstantsSize,
            VK_NULL_HANDLE, VK_NULL_HANDLE, A.GatherPipeline, A.FinalizePipeline};
        const PathReplayVulkanBuffers Spans{A.Buffers[1].Size / sizeof(PathReplayReceiver),
            A.Buffers[2].Size / sizeof(TriangleVisibilitySpace::FloatEnclosure),
            A.Buffers[3].Size / sizeof(PathReplayFacet), A.Buffers[4].Size / sizeof(float),
            A.Buffers[6].Size / sizeof(std::array<float, 4>), A.Buffers[7].Size / sizeof(uint32_t)};
        RecordPathReplay(A.Commands, Access, Spans, Extent);
        Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        Barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        A.CmdPipelineBarrier(A.Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_HOST_BIT,
                             0, 1, &Barrier, 0, nullptr, 0, nullptr);
        Confirm(A.EndCommandBuffer(A.Commands));
        VkSubmitInfo Submission{};
        Submission.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        Submission.commandBufferCount = 1;
        Submission.pCommandBuffers = &A.Commands;
        Confirm(A.QueueSubmit(A.Queue, 1, &Submission, A.Completion));
        Confirm(A.WaitForFences(A.Device, 1, &A.Completion, VK_TRUE, 600000000000ull));

        const auto *Output = static_cast<const std::array<float, 4> *>(A.Buffers[6].Address);
        Rgba.resize(Receivers);
        for (uint32_t I = 0; I < Receivers; ++I)
        {
            for (uint32_t C = 0; C < 3; ++C)
            {
                const float Value = std::isfinite(Output[I][C]) ? std::max(0.0f, Output[I][C]) : 0.0f;
                Rgba[I][C] = uint8_t(std::clamp(1.0f - std::exp(-Value), 0.0f, 1.0f) * 255.0f);
            }
            Rgba[I][3] = 255;
        }
        const auto *Counters = static_cast<const uint32_t *>(A.Buffers[7].Address);
        Stats.Frame = A.Frame + 1;
        Stats.AcceptedBanks = Counters[23];
        Stats.Width = A.Width;
        Stats.Height = A.Height;
        Stats.Milliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Started).count();
        A.HistorySequence = Reset ? 1 : A.HistorySequence + 1;
        A.HistoryActive = true;
        ++A.Frame;
        return true;
    }
    catch (const std::exception &Failure)
    {
        Diagnostic = Failure.what();
        return false;
    }
}

void ReplayViewportRenderer::Release() { Impl->Release(); }
} // namespace Frontier
