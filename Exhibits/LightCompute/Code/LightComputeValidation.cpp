/*==========================================================================================================================================
                                                     LIGHTCOMPUTEVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 Execute shared Slang light selection and visibility in Vulkan, then
// compare actual readbacks to native references.

#define VK_NO_PROTOTYPES
#include "LightComputeFormat.h"
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <limits>
#include <numeric>
#include <vulkan/vulkan.h>
#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#else
#include <dlfcn.h>
#endif
using namespace Frontier;
namespace
{
void Require(bool Condition, const char* Message)
{
    if (!Condition)
        throw std::runtime_error(Message);
}
void Confirm(VkResult Result)
{
    if (Result != VK_SUCCESS)
        throw std::runtime_error("Vulkan error " + std::to_string(Result));
}
#define LightVulkanFunctions(F)                                                                              \
    F(DestroyInstance)                                                                                       \
    F(GetPhysicalDeviceProperties)                                                                           \
    F(GetPhysicalDeviceMemoryProperties)                                                                     \
    F(GetPhysicalDeviceQueueFamilyProperties)                                                                \
    F(EnumeratePhysicalDevices)                                                                              \
    F(EnumerateDeviceExtensionProperties)                                                                    \
    F(CreateDevice)                                                                                          \
    F(DestroyDevice)                                                                                         \
    F(GetDeviceQueue)                                                                                        \
    F(DeviceWaitIdle)                                                                                        \
    F(CreateBuffer)                                                                                          \
    F(DestroyBuffer)                                                                                         \
    F(GetBufferMemoryRequirements)                                                                           \
    F(AllocateMemory)                                                                                        \
    F(FreeMemory)                                                                                            \
    F(BindBufferMemory) F(MapMemory) F(UnmapMemory) F(CreateDescriptorSetLayout)                             \
        F(DestroyDescriptorSetLayout) F(CreateDescriptorPool) F(DestroyDescriptorPool)                       \
            F(AllocateDescriptorSets) F(UpdateDescriptorSets) F(CreatePipelineLayout)                        \
                F(DestroyPipelineLayout) F(CreateShaderModule) F(DestroyShaderModule)                        \
                    F(CreateComputePipelines) F(DestroyPipeline) F(CreateCommandPool) F(DestroyCommandPool)  \
                        F(AllocateCommandBuffers) F(BeginCommandBuffer) F(EndCommandBuffer)                  \
                            F(ResetCommandPool) F(CmdBindPipeline) F(CmdBindDescriptorSets)                  \
                                F(CmdPushConstants) F(CmdDispatch) F(CmdPipelineBarrier) F(QueueSubmit)      \
                                    F(CreateFence) F(DestroyFence) F(WaitForFences) F(ResetFences)
struct BufferSpan
{
    VkBuffer Buffer = VK_NULL_HANDLE;
    VkDeviceMemory Memory = VK_NULL_HANDLE;
    void* Address = nullptr;
    size_t Size = 0;
};
struct alignas(16) ComputeExtent
{
    std::array<uint32_t, 4> Dimensions{};
    std::array<float, 4> Minimum{-16, -16, -2, 0}, Maximum{16, 16, 10, 0};
    std::array<uint32_t, 4> Grid{8, 8, 4, 0}, Sampling{1, 8, 0, 0};
    std::array<uint32_t, 4> History{}, Reconstruction{}, Primary{};
};
static_assert(sizeof(ComputeExtent) == 128, "Push constant stride mismatch");
struct LightComputeSubmission
{
#ifdef _WIN32
    HMODULE Library = nullptr;
#else
    void* Library = nullptr;
#endif
    PFN_vkGetInstanceProcAddr Resolve = nullptr;
#define Declare(Name) PFN_vk##Name Name = nullptr;
    LightVulkanFunctions(Declare)
#undef Declare
        VkInstance Instance = VK_NULL_HANDLE;
    VkPhysicalDevice Physical = VK_NULL_HANDLE;
    VkDevice Device = VK_NULL_HANDLE;
    VkQueue Queue = VK_NULL_HANDLE;
    VkPhysicalDeviceProperties Properties{};
    VkPhysicalDeviceMemoryProperties MemoryProperties{};
    VkCommandPool Pool = VK_NULL_HANDLE;
    VkCommandBuffer Commands = VK_NULL_HANDLE;
    VkFence Completion = VK_NULL_HANDLE;
    VkDescriptorSetLayout DescriptorLayout = VK_NULL_HANDLE;
    VkDescriptorPool Descriptors = VK_NULL_HANDLE;
    VkDescriptorSet DescriptorSet = VK_NULL_HANDLE;
    VkPipelineLayout PipelineLayout = VK_NULL_HANDLE;
    VkPipeline CellPipeline = VK_NULL_HANDLE, ReceiverPipeline = VK_NULL_HANDLE,
               PrimaryPipeline = VK_NULL_HANDLE, TransportPipeline = VK_NULL_HANDLE;
    std::array<BufferSpan, 8> Buffers{};
    std::array<VkPipeline, 4> HistoryPipelines{};
    std::vector<LightComputeShape> PreviousLights;
    std::vector<float> PreviousAngles;
    uint32_t HistorySequence = 0, ReceiverCount = 0;
    bool HistoryDirty = true;
    uint32_t Family = 0;
    bool RayQueryExtensions = false;
    template <class T> T Lookup(const char* Name)
    {
        auto P = Resolve(Instance, Name);
        Require(P != nullptr, Name);
        return reinterpret_cast<T>(P);
    }
    explicit LightComputeSubmission(const char* Driver)
    {
        try
        {
#ifdef _WIN32
            Library = LoadLibraryA(Driver);
            if (Library)
                Resolve = reinterpret_cast<PFN_vkGetInstanceProcAddr>(
                    GetProcAddress(Library, "vkGetInstanceProcAddr"));
#else
            Library = dlopen(Driver, RTLD_NOW | RTLD_LOCAL);
            if (Library)
                Resolve =
                    reinterpret_cast<PFN_vkGetInstanceProcAddr>(dlsym(Library, "vkGetInstanceProcAddr"));
#endif
            Require(Resolve != nullptr, "Explicit Vulkan library could not load");
            VkApplicationInfo Application{};
            Application.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
            Application.pApplicationName = "Frontier light compute validation";
            Application.apiVersion = VK_API_VERSION_1_1;
            VkInstanceCreateInfo Creation{};
            Creation.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
            Creation.pApplicationInfo = &Application;
            Confirm(Lookup<PFN_vkCreateInstance>("vkCreateInstance")(&Creation, nullptr, &Instance));
#define Load(Name) Name = Lookup<PFN_vk##Name>("vk" #Name);
            LightVulkanFunctions(Load)
#undef Load
                uint32_t Count = 0;
            Confirm(EnumeratePhysicalDevices(Instance, &Count, nullptr));
            Require(Count > 0, "No Vulkan physical device enumerated");
            std::vector<VkPhysicalDevice> Devices(Count);
            Confirm(EnumeratePhysicalDevices(Instance, &Count, Devices.data()));
            for (auto Candidate : Devices)
            {
                uint32_t Families = 0;
                GetPhysicalDeviceQueueFamilyProperties(Candidate, &Families, nullptr);
                std::vector<VkQueueFamilyProperties> Queues(Families);
                GetPhysicalDeviceQueueFamilyProperties(Candidate, &Families, Queues.data());
                for (uint32_t I = 0; I < Families; ++I)
                    if (Queues[I].queueFlags & VK_QUEUE_COMPUTE_BIT)
                    {
                        Physical = Candidate;
                        Family = I;
                        break;
                    }
                if (Physical)
                    break;
            }
            Require(Physical != VK_NULL_HANDLE, "No compute-capable queue");
            GetPhysicalDeviceProperties(Physical, &Properties);
            GetPhysicalDeviceMemoryProperties(Physical, &MemoryProperties);
            Require(Properties.apiVersion >= VK_API_VERSION_1_1, "Vulkan 1.1 device required for SPIR-V 1.3");
            Require(Properties.limits.maxDescriptorSetStorageBuffers >= 8 &&
                        Properties.limits.maxPerStageDescriptorStorageBuffers >= 8,
                    "Device has fewer than eight compute storage buffers");
            uint32_t Extensions = 0;
            Confirm(EnumerateDeviceExtensionProperties(Physical, nullptr, &Extensions, nullptr));
            std::vector<VkExtensionProperties> ExtensionNames(Extensions);
            Confirm(
                EnumerateDeviceExtensionProperties(Physical, nullptr, &Extensions, ExtensionNames.data()));
            bool Acceleration = false, Query = false;
            for (auto Extension : ExtensionNames)
            {
                Acceleration |=
                    std::strcmp(Extension.extensionName, VK_KHR_ACCELERATION_STRUCTURE_EXTENSION_NAME) == 0;
                Query |= std::strcmp(Extension.extensionName, VK_KHR_RAY_QUERY_EXTENSION_NAME) == 0;
            }
            RayQueryExtensions = Acceleration && Query;
            float Priority = 1;
            VkDeviceQueueCreateInfo QueueCreation{};
            QueueCreation.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
            QueueCreation.queueFamilyIndex = Family;
            QueueCreation.queueCount = 1;
            QueueCreation.pQueuePriorities = &Priority;
            VkDeviceCreateInfo DeviceCreation{};
            DeviceCreation.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
            DeviceCreation.queueCreateInfoCount = 1;
            DeviceCreation.pQueueCreateInfos = &QueueCreation;
            Confirm(CreateDevice(Physical, &DeviceCreation, nullptr, &Device));
            GetDeviceQueue(Device, Family, 0, &Queue);
            VkCommandPoolCreateInfo PoolCreation{};
            PoolCreation.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
            PoolCreation.queueFamilyIndex = Family;
            Confirm(CreateCommandPool(Device, &PoolCreation, nullptr, &Pool));
            VkCommandBufferAllocateInfo Allocation{};
            Allocation.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
            Allocation.commandPool = Pool;
            Allocation.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
            Allocation.commandBufferCount = 1;
            Confirm(AllocateCommandBuffers(Device, &Allocation, &Commands));
            VkFenceCreateInfo FenceCreation{};
            FenceCreation.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
            Confirm(CreateFence(Device, &FenceCreation, nullptr, &Completion));
        }
        catch (...)
        {
            Release();
            throw;
        }
    }
    ~LightComputeSubmission() { Release(); }
    LightComputeSubmission(const LightComputeSubmission&) = delete;
    LightComputeSubmission& operator=(const LightComputeSubmission&) = delete;
    void Release()
    {
        if (Device)
        {
            DeviceWaitIdle(Device);
            for (auto Pipeline : HistoryPipelines)
                if (Pipeline)
                    DestroyPipeline(Device, Pipeline, nullptr);
            if (TransportPipeline)
                DestroyPipeline(Device, TransportPipeline, nullptr);
            if (PrimaryPipeline)
                DestroyPipeline(Device, PrimaryPipeline, nullptr);
            if (CellPipeline)
                DestroyPipeline(Device, CellPipeline, nullptr);
            if (ReceiverPipeline)
                DestroyPipeline(Device, ReceiverPipeline, nullptr);
            if (PipelineLayout)
                DestroyPipelineLayout(Device, PipelineLayout, nullptr);
            if (Descriptors)
                DestroyDescriptorPool(Device, Descriptors, nullptr);
            if (DescriptorLayout)
                DestroyDescriptorSetLayout(Device, DescriptorLayout, nullptr);
            for (auto& B : Buffers)
            {
                if (B.Address)
                    UnmapMemory(Device, B.Memory);
                if (B.Buffer)
                    DestroyBuffer(Device, B.Buffer, nullptr);
                if (B.Memory)
                    FreeMemory(Device, B.Memory, nullptr);
            }
            if (Completion)
                DestroyFence(Device, Completion, nullptr);
            if (Pool)
                DestroyCommandPool(Device, Pool, nullptr);
            DestroyDevice(Device, nullptr);
        }
        if (Instance && DestroyInstance)
            DestroyInstance(Instance, nullptr);
#ifdef _WIN32
        if (Library)
            FreeLibrary(Library);
#else
        if (Library)
            dlclose(Library);
#endif
        Device = VK_NULL_HANDLE;
        Instance = VK_NULL_HANDLE;
        Library = nullptr;
    }
    void ConstructBuffer(uint32_t Index, const void* Bytes, size_t Size)
    {
        auto& B = Buffers[Index];
        B.Size = std::max(size_t(16), Size);
        Require(B.Size <= Properties.limits.maxStorageBufferRange, "Storage buffer exceeds device limit");
        VkBufferCreateInfo Creation{};
        Creation.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
        Creation.size = B.Size;
        Creation.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
        Creation.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        Confirm(CreateBuffer(Device, &Creation, nullptr, &B.Buffer));
        VkMemoryRequirements Requirements{};
        GetBufferMemoryRequirements(Device, B.Buffer, &Requirements);
        uint32_t Type = UINT32_MAX;
        for (uint32_t I = 0; I < MemoryProperties.memoryTypeCount; ++I)
            if ((Requirements.memoryTypeBits & (1u << I)) &&
                (MemoryProperties.memoryTypes[I].propertyFlags &
                 (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)) ==
                    (VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT))
            {
                Type = I;
                break;
            }
        Require(Type != UINT32_MAX, "Host-coherent storage memory is unavailable");
        VkMemoryAllocateInfo Allocation{};
        Allocation.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
        Allocation.allocationSize = Requirements.size;
        Allocation.memoryTypeIndex = Type;
        Confirm(AllocateMemory(Device, &Allocation, nullptr, &B.Memory));
        Confirm(BindBufferMemory(Device, B.Buffer, B.Memory, 0));
        Confirm(MapMemory(Device, B.Memory, 0, B.Size, 0, &B.Address));
        std::memset(B.Address, 0, B.Size);
        if (Size && Bytes)
            std::memcpy(B.Address, Bytes, Size);
    }
    template <class T> void ConstructBuffer(uint32_t Index, const std::vector<T>& Sequence)
    {
        ConstructBuffer(Index, Sequence.data(), Sequence.size() * sizeof(T));
    }
    VkPipeline ConstructPipeline(const std::string& Path)
    {
        std::ifstream Input(Path, std::ios::binary | std::ios::ate);
        Require(bool(Input), "SPIR-V file unavailable");
        auto Length = Input.tellg();
        Require(Length > 0 && Length < 64 * 1024 * 1024 && Length % 4 == 0, "Invalid SPIR-V extent");
        std::vector<uint32_t> Words(size_t(Length) / 4);
        Input.seekg(0);
        Input.read(reinterpret_cast<char*>(Words.data()), Length);
        Require(bool(Input) && Words[0] == 0x07230203, "Invalid SPIR-V payload");
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
        auto Status = CreateComputePipelines(Device, VK_NULL_HANDLE, 1, &Pipeline, nullptr, &Result);
        DestroyShaderModule(Device, Shader, nullptr);
        Confirm(Status);
        return Result;
    }
    void Prepare(const LightComputeArchive& Scene, const std::string& Shaders)
    {
        for (const auto& B : Buffers)
            Require(B.Buffer == VK_NULL_HANDLE, "Compute buffers are already prepared");
        ConstructBuffer(0, Scene.Lights);
        ConstructBuffer(1, Scene.Receivers);
        // 📝 Poison the uploaded oracle channel: shader output must not depend on
        // native direct-light answers.
        std::array<float, 4> Poison;
        Poison.fill(std::numeric_limits<float>::quiet_NaN());
        for (size_t I = 0; I < Scene.Receivers.size(); ++I)
            std::memcpy(static_cast<char*>(Buffers[1].Address) + I * sizeof(LightComputeReceiver) +
                            offsetof(LightComputeReceiver, ExpectedDirect),
                        Poison.data(), sizeof(Poison));
        ConstructBuffer(2, Scene.Visibility.Enclosures);
        ConstructBuffer(3, PackedSurfaces(Scene));
        auto ProfileSamples = ProjectedAngles(Scene);
        if (Scene.Camera[10][2] > 0)
            ProfileSamples.resize(ProfileSamples.size() + Scene.Surfaces.size() * 4);
        ConstructBuffer(4, ProfileSamples);
        ConstructBuffer(5, nullptr, 256 * 17 * 4);
        ConstructBuffer(6, nullptr, Scene.Receivers.size() * 16 * 16);
        ConstructBuffer(7, nullptr, 64);
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
        Confirm(CreateDescriptorSetLayout(Device, &Layout, nullptr, &DescriptorLayout));
        VkPushConstantRange Push{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(ComputeExtent)};
        VkPipelineLayoutCreateInfo PipelineCreation{};
        PipelineCreation.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        PipelineCreation.setLayoutCount = 1;
        PipelineCreation.pSetLayouts = &DescriptorLayout;
        PipelineCreation.pushConstantRangeCount = 1;
        PipelineCreation.pPushConstantRanges = &Push;
        Confirm(CreatePipelineLayout(Device, &PipelineCreation, nullptr, &PipelineLayout));
        VkDescriptorPoolSize PoolSize{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 8};
        VkDescriptorPoolCreateInfo DescriptorCreation{};
        DescriptorCreation.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
        DescriptorCreation.maxSets = 1;
        DescriptorCreation.poolSizeCount = 1;
        DescriptorCreation.pPoolSizes = &PoolSize;
        Confirm(CreateDescriptorPool(Device, &DescriptorCreation, nullptr, &Descriptors));
        VkDescriptorSetAllocateInfo Allocation{};
        Allocation.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        Allocation.descriptorPool = Descriptors;
        Allocation.descriptorSetCount = 1;
        Allocation.pSetLayouts = &DescriptorLayout;
        Confirm(AllocateDescriptorSets(Device, &Allocation, &DescriptorSet));
        std::array<VkDescriptorBufferInfo, 8> Spans{};
        std::array<VkWriteDescriptorSet, 8> Writes{};
        for (uint32_t I = 0; I < 8; ++I)
        {
            Spans[I] = {Buffers[I].Buffer, 0, Buffers[I].Size};
            Writes[I].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            Writes[I].dstSet = DescriptorSet;
            Writes[I].dstBinding = I;
            Writes[I].descriptorCount = 1;
            Writes[I].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            Writes[I].pBufferInfo = &Spans[I];
        }
        UpdateDescriptorSets(Device, 8, Writes.data(), 0, nullptr);
        TransportPipeline = ConstructPipeline(Shaders + "/Transport.spv");
        PrimaryPipeline = ConstructPipeline(Shaders + "/Primary.spv");
        CellPipeline = ConstructPipeline(Shaders + "/Cells.spv");
        ReceiverPipeline = ConstructPipeline(Shaders + "/Receivers.spv");
        const char* Names[] = {"Reuse", "Reconstruct", "Filter", "Finalize"};
        for (uint32_t I = 0; I < 4; ++I)
            HistoryPipelines[I] = ConstructPipeline(Shaders + "/" + Names[I] + ".spv");
        ReceiverCount = uint32_t(Scene.Receivers.size());
        Upload(Scene);
    }
    std::vector<LightComputeFacet> PackedSurfaces(const LightComputeArchive& Scene) const
    {
        if (Scene.Surfaces.size() == Scene.Visibility.Corners.size())
            return Scene.Surfaces;
        std::vector<LightComputeFacet> Packed;
        for (auto C : Scene.Visibility.Corners)
        {
            LightComputeFacet F;
            F.A = C.A;
            F.B = C.B;
            F.C = C.C;
            Packed.push_back(F);
        }
        return Packed;
    }
    std::vector<float> ProjectedAngles(const LightComputeArchive& Scene) const
    {
        auto Samples = Scene.Angles;
        for (const auto& V : Scene.Camera)
            Samples.insert(Samples.end(), V.begin(), V.end());
        return Samples;
    }
    void Upload(const LightComputeArchive& Scene)
    {
        Require(Scene.Receivers.size() == ReceiverCount,
                "History receiver extent changed; recreate submission");
        auto Copy = [&](uint32_t Index, const void* Bytes, size_t Size)
        {
            Require(Size <= Buffers[Index].Size, "Scene exceeds prepared buffer span");
            if (Size)
                std::memcpy(Buffers[Index].Address, Bytes, Size);
        };
        Copy(0, Scene.Lights.data(), Scene.Lights.size() * sizeof(LightComputeShape));
        Copy(1, Scene.Receivers.data(), Scene.Receivers.size() * sizeof(LightComputeReceiver));
        Copy(2, Scene.Visibility.Enclosures.data(),
             Scene.Visibility.Enclosures.size() * sizeof(TriangleVisibilitySpace::FloatEnclosure));
        auto Surfaces = PackedSurfaces(Scene);
        Copy(3, Surfaces.data(), Surfaces.size() * sizeof(LightComputeFacet));
        auto Samples = ProjectedAngles(Scene);
        Copy(4, Samples.data(), Samples.size() * 4);
        std::array<float, 4> Poison;
        Poison.fill(std::numeric_limits<float>::quiet_NaN());
        for (size_t I = 0; I < Scene.Receivers.size(); ++I)
            std::memcpy(static_cast<char*>(Buffers[1].Address) + I * sizeof(LightComputeReceiver) +
                            offsetof(LightComputeReceiver, ExpectedDirect),
                        Poison.data(), 16);
        size_t RevisionAngles = Scene.Angles.size();
        if (Scene.Camera[10][2] > 0)
        {
            double Offset = Scene.Camera[10][2];
            Require(std::isfinite(Offset) && Offset < Scene.Angles.size() && std::floor(Offset) == Offset,
                    "Invalid emissive CDF offset");
            RevisionAngles = size_t(Offset);
            double Count = Scene.Angles[RevisionAngles];
            Require(std::isfinite(Count) && Count >= 0 && Count <= Scene.Surfaces.size() &&
                        std::floor(Count) == Count &&
                        RevisionAngles + 1 + size_t(Count) * 4 <= Scene.Angles.size(),
                    "Invalid emissive CDF extent");
            float Previous = 0;
            for (size_t I = 0; I < size_t(Count); ++I)
            {
                const float* Entry = Scene.Angles.data() + RevisionAngles + 1 + I * 4;
                Require(std::isfinite(Entry[0]) && Entry[0] >= 0 && Entry[0] < Scene.Surfaces.size() &&
                            std::floor(Entry[0]) == Entry[0] && std::isfinite(Entry[1]) && Entry[1] > 0 &&
                            std::isfinite(Entry[2]) && Entry[2] > 0 && std::isfinite(Entry[3]) &&
                            Entry[3] > Previous && Entry[3] <= 1 &&
                            std::abs((Entry[3] - Previous) - Entry[1]) < 1e-7,
                        "Invalid emissive CDF entry");
                Previous = Entry[3];
            }
            Require(Count == 0 || Previous == 1, "Emissive CDF is not normalized");
        }
        // 📝 Moving emissive geometry changes its CDF, not the analytic reservoirs' light/profile revision.
        bool Changed =
            PreviousLights.size() != Scene.Lights.size() || PreviousAngles.size() != RevisionAngles;
        if (!Changed)
        {
            Changed = (!Scene.Lights.empty() &&
                       std::memcmp(PreviousLights.data(), Scene.Lights.data(),
                                   Scene.Lights.size() * sizeof(LightComputeShape)) != 0) ||
                      (RevisionAngles != 0 &&
                       std::memcmp(PreviousAngles.data(), Scene.Angles.data(), RevisionAngles * 4) != 0);
        }
        if (Changed)
        {
            HistoryDirty = true;
            PreviousLights = Scene.Lights;
            PreviousAngles.assign(Scene.Angles.begin(), Scene.Angles.begin() + RevisionAngles);
        }
    }
    std::vector<std::array<float, 4>> Execute(const LightComputeArchive& Scene, uint32_t Mode,
                                              uint32_t Capacity = 16, uint32_t Seed = 1,
                                              uint32_t StackCapacity = 64, uint32_t Reconstruction = 7,
                                              bool ResetHistory = false, bool PrimaryVisibility = false,
                                              uint32_t TransportSamples = 0, bool Environment = false,
                                              bool EmissiveSampling = false)
    {
        Require(Capacity >= 1 && Capacity <= 16 && Mode <= 3 && StackCapacity >= 1 && StackCapacity <= 64,
                "Unsupported compute extent selection");
        Require((Scene.Receivers.size() + 63) / 64 <= Properties.limits.maxComputeWorkGroupCount[0],
                "Receiver dispatch exceeds device group limit");
        Require(uint64_t(Scene.Receivers.size()) * Scene.Lights.size() < UINT32_MAX,
                "Compute counter extent exceeds uint32");
        Require(!EmissiveSampling || (PrimaryVisibility && TransportSamples > 0 &&
                                      std::isfinite(Scene.Camera[10][2]) && Scene.Camera[10][2] > 0),
                "Area emission requires primary transport and a valid distribution");
        Upload(Scene);
        ComputeExtent Extent;
        Extent.Dimensions = {uint32_t(Scene.Receivers.size()), uint32_t(Scene.Lights.size()), Capacity, Mode};
        Extent.Grid[3] = uint32_t(Scene.Visibility.Enclosures.size());
        Extent.Sampling = {Seed, 8, uint32_t(Scene.Visibility.Corners.size()), StackCapacity};
        bool Reset = HistoryDirty || ResetHistory;
        Extent.History = {Scene.Width, Scene.Height, Reset ? 0 : HistorySequence, Reset ? 1u : 0u};
        Extent.Reconstruction = {Reconstruction & 1 ? 1u : 0u, Reconstruction & 2 ? 1u : 0u,
                                 Reconstruction & 4 ? 1u : 0u, 0};
        Extent.Primary = {PrimaryVisibility ? 1u : 0u, uint32_t(Scene.Angles.size()), TransportSamples,
                          (Environment ? 1u : 0u) | (EmissiveSampling ? 2u : 0u)};
        if (PrimaryVisibility)
        {
            // 📝 No uploaded CPU surface channel may supply primary geometry or
            // material information.
            std::vector<LightComputeReceiver> Poisoned(Scene.Receivers.size());
            for (auto& R : Poisoned)
            {
                std::array<float, 36> Poison;
                Poison.fill(std::numeric_limits<float>::quiet_NaN());
                std::memcpy(static_cast<void*>(&R), Poison.data(), sizeof(R));
            }
            std::memcpy(Buffers[1].Address, Poisoned.data(), Poisoned.size() * sizeof(LightComputeReceiver));
        }
        std::memset(Buffers[7].Address, 0, 64);
        Confirm(ResetCommandPool(Device, Pool, 0));
        Confirm(ResetFences(Device, 1, &Completion));
        VkCommandBufferBeginInfo Begin{};
        Begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        Confirm(BeginCommandBuffer(Commands, &Begin));
        VkMemoryBarrier Barrier{};
        Barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        Barrier.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        CmdPipelineBarrier(Commands, VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
        CmdBindDescriptorSets(Commands, VK_PIPELINE_BIND_POINT_COMPUTE, PipelineLayout, 0, 1, &DescriptorSet,
                              0, nullptr);
        CmdPushConstants(Commands, PipelineLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(Extent), &Extent);
        CmdBindPipeline(Commands, VK_PIPELINE_BIND_POINT_COMPUTE, CellPipeline);
        CmdDispatch(Commands, 4, 1, 1);
        Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        CmdPipelineBarrier(Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
        if (PrimaryVisibility)
        {
            CmdBindPipeline(Commands, VK_PIPELINE_BIND_POINT_COMPUTE, PrimaryPipeline);
            CmdDispatch(Commands, (Extent.Dimensions[0] + 63) / 64, 1, 1);
            Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            CmdPipelineBarrier(Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                               VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
        }
        if (PrimaryVisibility && TransportSamples)
        {
            Require(TransportSamples <= uint32_t(Scene.Camera[9][3]),
                    "Transport sample budget exceeds uploaded directions");
            CmdBindPipeline(Commands, VK_PIPELINE_BIND_POINT_COMPUTE, TransportPipeline);
            CmdDispatch(Commands, (Extent.Dimensions[0] + 63) / 64, 1, 1);
            CmdPipelineBarrier(Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                               VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
        }
        CmdBindPipeline(Commands, VK_PIPELINE_BIND_POINT_COMPUTE, ReceiverPipeline);
        CmdDispatch(Commands, (Extent.Dimensions[0] + 63) / 64, 1, 1);
        if (Mode == 3)
        {
            auto Dispatch = [&](VkPipeline Pipeline)
            {
                VkMemoryBarrier Dependency{};
                Dependency.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
                Dependency.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
                Dependency.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
                CmdPipelineBarrier(Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Dependency, 0, nullptr, 0,
                                   nullptr);
                CmdBindPipeline(Commands, VK_PIPELINE_BIND_POINT_COMPUTE, Pipeline);
                CmdDispatch(Commands, (Extent.Dimensions[0] + 63) / 64, 1, 1);
            };
            Dispatch(HistoryPipelines[0]);
            Dispatch(HistoryPipelines[1]);
            for (uint32_t I = 0; I < 2; ++I)
            {
                Extent.Reconstruction[3] = I;
                CmdPushConstants(Commands, PipelineLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(Extent),
                                 &Extent);
                Dispatch(HistoryPipelines[2]);
            }
            Dispatch(HistoryPipelines[3]);
        }
        Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        Barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        CmdPipelineBarrier(Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 1,
                           &Barrier, 0, nullptr, 0, nullptr);
        Confirm(EndCommandBuffer(Commands));
        VkSubmitInfo Submission{};
        Submission.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        Submission.commandBufferCount = 1;
        Submission.pCommandBuffers = &Commands;
        Confirm(QueueSubmit(Queue, 1, &Submission, Completion));
        Confirm(WaitForFences(Device, 1, &Completion, VK_TRUE, 120000000000ull));
        std::vector<std::array<float, 4>> Result(Scene.Receivers.size());
        std::memcpy(Result.data(), Buffers[6].Address, Result.size() * 16);
        if (Mode == 3)
        {
            HistorySequence = Reset ? 1 : HistorySequence + 1;
            HistoryDirty = false;
        }
        return Result;
    }
    std::array<uint32_t, 16> HistoryStatistics() const
    {
        std::array<uint32_t, 16> Counts{};
        std::memcpy(Counts.data(), Buffers[7].Address, 64);
        return Counts;
    }
    std::vector<std::array<float, 4>> HistoryLinks() const
    {
        std::vector<std::array<float, 4>> Links(ReceiverCount);
        std::memcpy(Links.data(),
                    static_cast<const char*>(Buffers[6].Address) + size_t(ReceiverCount) * 16 * 13,
                    ReceiverCount * 16);
        return Links;
    }
    std::vector<LightComputeReceiver> PrimaryReceivers() const
    {
        std::vector<LightComputeReceiver> R(ReceiverCount);
        std::memcpy(R.data(), Buffers[1].Address, R.size() * sizeof(LightComputeReceiver));
        return R;
    }
    std::vector<std::array<float, 4>> PrimaryStrikes() const
    {
        std::vector<std::array<float, 4>> R(ReceiverCount);
        std::memcpy(R.data(), static_cast<const char*>(Buffers[6].Address) + size_t(ReceiverCount) * 16 * 15,
                    R.size() * 16);
        return R;
    }
    std::array<uint32_t, 4> Statistics() const
    {
        std::array<uint32_t, 4> Counts{};
        std::memcpy(Counts.data(), Buffers[7].Address, 16);
        return Counts;
    }
};
void ValidateFreshSampling(const char* Driver, const std::string& Shaders)
{
    ReferenceScene Scene;
    for (uint32_t I = 0; I < 97; ++I)
    {
        ReferenceLight L;
        L.Vector = {double(int(I % 7) - 3), double(int(I % 5) - 2), 3. + I % 3};
        L.Radiance = {1. + I % 3, 2. + I % 7, 1. + I % 5};
        L.Reach = 12;
        if (I % 3 == 1)
        {
            L.Kind = ReferenceLight::Kind::Spot;
            L.InnerCosine = .9;
            L.OuterCosine = .1;
        }
        if (I % 3 == 2)
        {
            std::istringstream Text("IESNA:LM-63-2002\nTILT=NONE\n1 -1 1 3 3 1 2 0 0 "
                                    "0\n1 1 10\n0 45 90\n0 "
                                    "180 360\n100 80 0 100 20 0 100 80 0");
            L.Photometry = std::make_shared<CandelaDistribution>(CandelaDistribution::Read(Text));
        }
        Scene.Lights.push_back(L);
    }
    ReferenceImage Image;
    Image.Width = 32;
    Image.Height = 16;
    Image.Pixels.resize(512);
    Image.SurfaceSamples.resize(512);
    double Expected = 0;
    for (uint32_t I = 0; I < 512; ++I)
    {
        auto& R = Image.SurfaceSamples[I];
        R.Hit = true;
        R.Position = {double(int(I % 32) - 16) / 8, double(int(I / 32) - 8) / 8, 0};
        R.Normal = {0, 0, 1};
        R.View = {0, 0, 1};
        R.Material.Albedo = {.4, .6, .7};
        for (const auto& L : Scene.Lights)
        {
            SpatialVector Direction;
            double Distance;
            auto C = ReferenceLightArrival(L, R.Position, Direction, Distance);
            auto F = EvaluateReferenceBrdf(R.Material, R.Normal, R.View, Direction);
            double Cosine = std::max(Direction.Z, 0.);
            R.Direct.R += F.R * C.R * Cosine;
            R.Direct.G += F.G * C.G * Cosine;
            R.Direct.B += F.B * C.B * Cosine;
        }
        Image.Pixels[I] = R.Direct;
        Expected += .2126 * R.Direct.R + .7152 * R.Direct.G + .0722 * R.Direct.B;
    }
    auto Archive = PackLightCompute(Scene, Image);
    for (auto& R : Archive.Receivers)
        R.MotionPixel[2] = .25f;
    LightComputeSubmission Compute(Driver);
    Compute.Prepare(Archive, Shaders);
    auto All = Compute.Execute(Archive, 0);
    auto Local = Compute.Execute(Archive, 1);
    Require(All == Local, "Dense 97-light Vulkan cell dropped illumination");
    Require(Compute.Statistics()[1] == 512, "Dense cells did not use exhaustive fallback");
    double Maximum = 0;
    for (size_t I = 0; I < All.size(); ++I)
        for (uint32_t C = 0; C < 3; ++C)
            Maximum = std::max(Maximum, std::abs(double(All[I][C]) - Archive.Receivers[I].ExpectedDirect[C]));
    Require(Maximum < 2e-4, "Synthetic shader/profile response differs from native reference");
    double Sum = 0, Squares = 0;
    const uint32_t Repetitions = 256;
    for (uint32_t Seed = 1; Seed <= Repetitions; ++Seed)
    {
        auto Pixels = Compute.Execute(Archive, 2, 16, Seed);
        double Energy = 0;
        for (auto P : Pixels)
            Energy += P[3];
        Sum += Energy;
        Squares += Energy * Energy;
    }
    double Mean = Sum / Repetitions,
           Error = std::sqrt(std::max(0., Squares / Repetitions - Mean * Mean) / Repetitions);
    Require(std::abs(Mean - Expected) < 6 * Error + 1e-4, "Fresh Vulkan RIS differs from exhaustive energy");
    std::cout << "SAMPLING lights=97 receivers=512 seeds=" << Repetitions << " mean=" << Mean
              << " native_exact=" << Expected << " standard_error=" << Error << " native_max_abs=" << Maximum
              << "\n";
    double ReuseSum = 0, ReuseSquares = 0;
    const uint32_t Chains = 64;
    for (uint32_t Chain = 1; Chain <= Chains; ++Chain)
    {
        std::vector<std::array<float, 4>> Samples;
        for (uint32_t Step = 0; Step < 4; ++Step)
            Samples = Compute.Execute(Archive, 3, 16, Chain * 101 + Step, 64, 3, Step == 0);
        double Energy = 0;
        for (auto P : Samples)
            Energy += P[3];
        ReuseSum += Energy;
        ReuseSquares += Energy * Energy;
    }
    double ReuseMean = ReuseSum / Chains,
           ReuseError = std::sqrt(std::max(0., ReuseSquares / Chains - ReuseMean * ReuseMean) / Chains);
    Require(std::abs(ReuseMean - Expected) < 6 * ReuseError + 1e-4,
            "Reused unfiltered reservoirs differ from exact energy");
    std::cout << "REUSE_ENERGY chains=" << Chains << " steps=4 mean=" << ReuseMean
              << " native_exact=" << Expected << " standard_error=" << ReuseError << "\n";
    auto ChangedMaterial = Archive;
    for (size_t I = 0; I < ChangedMaterial.Receivers.size() / 2; ++I)
        ChangedMaterial.Receivers[I].AlbedoIor[0] += .2f;
    (void)Compute.Execute(ChangedMaterial, 3, 16, 901);
    auto Rejections = Compute.HistoryStatistics();
    Require(Rejections[4] == 256 && Rejections[5] == 256,
            "Material change did not reject exactly affected pixels");
    auto BadNormal = ChangedMaterial;
    for (auto& R : BadNormal.Receivers)
        R.MotionNormal = {0, 0, -1, 0};
    (void)Compute.Execute(BadNormal, 3, 16, 902);
    Require(Compute.HistoryStatistics()[4] == 0, "Normal mismatch retained history");
    auto InvalidMotion = ChangedMaterial;
    for (auto& R : InvalidMotion.Receivers)
        R.MotionPixel[3] = 0;
    auto Cut = Compute.Execute(InvalidMotion, 3, 16, 903, 64, 0);
    Require(Compute.HistoryStatistics()[4] == 0, "Camera cut retained history");
    auto Cold = Compute.Execute(InvalidMotion, 3, 16, 903, 64, 0, true);
    Require(Cut == Cold, "Rejected camera history differs from a cold restart");
    auto BadPosition = ChangedMaterial;
    for (auto& R : BadPosition.Receivers)
        R.MotionPositionToken[2] += 10;
    (void)Compute.Execute(BadPosition, 3, 16, 904);
    Require(Compute.HistoryStatistics()[4] == 0, "Disoccluded world position retained history");
    std::cout << "REJECTION material_accepted=256 material_rejected=256 "
                 "normal_rejected=512 "
                 "camera_cut_rejected=512 position_rejected=512 "
                 "cold_restart_exact_match=1\n";
    std::vector<std::array<SpatialVector, 3>> Caster;
    for (uint32_t I = 0; I < 5; ++I)
    {
        Caster.push_back({SpatialVector{-20, -20, 1}, SpatialVector{20, -20, 1}, SpatialVector{20, 20, 1}});
        Caster.push_back({SpatialVector{-20, -20, 1}, SpatialVector{20, 20, 1}, SpatialVector{-20, 20, 1}});
    }
    TriangleVisibilitySpace Visibility;
    Visibility.Build(Caster);
    Archive.Visibility = Visibility.PackFloat32();
    for (auto& R : Archive.Receivers)
        R.ExpectedDirect = {};
    LightComputeSubmission Shadow(Driver);
    Shadow.Prepare(Archive, Shaders);
    auto NormalStack = Shadow.Execute(Archive, 0), SmallStack = Shadow.Execute(Archive, 0, 16, 1, 1);
    Require(NormalStack == SmallStack && Shadow.Statistics()[3] > 0, "Enclosure stack fallback failed");
    for (auto P : SmallStack)
        Require(P[0] == 0 && P[1] == 0 && P[2] == 0, "Offscreen caster failed to occlude synthetic lights");
    std::cout << "VISIBILITY offscreen_caster_facets=10 forced_stack_fallbacks=" << Shadow.Statistics()[3]
              << " exhaustive_fallback_matches=1\n";
}

void WriteImage(const std::string& Path, const std::vector<std::array<float, 4>>& Pixels, uint32_t Width,
                uint32_t Height)
{
    std::ofstream Output(Path, std::ios::binary);
    Output.exceptions(std::ios::failbit | std::ios::badbit);
    Output << "P6\n" << Width << ' ' << Height << "\n255\n";
    ReferenceImage Image;
    Image.Width = Width;
    Image.Height = Height;
    Image.Pixels.reserve(Pixels.size());
    for (auto P : Pixels)
    {
        Require(std::isfinite(P[0]) && std::isfinite(P[1]) && std::isfinite(P[2]), "Nonfinite Vulkan colour");
        Image.Pixels.push_back({P[0], P[1], P[2]});
    }
    std::vector<uint8_t> Rgb;
    EncodeDisplayRgb8(Image, .45, Rgb);
    Output.write(reinterpret_cast<const char*>(Rgb.data()), std::streamsize(Rgb.size()));
}
#include "LightHistoryValidation.h"
#include "LightPrimaryValidation.h"
#include "LightPrimaryMotion.h"
#include "LightSurfaceTransport.h"
#include "EmissiveFacetQuadrature.h"
} // namespace
int main(int Count, char** Arguments)
{
    try
    {
        if (Count == 4 && std::string(Arguments[3]) == "--sampling-only")
        {
            ValidateFreshSampling(Arguments[1], Arguments[2]);
            return 0;
        }
        Require(Count == 5 || Count == 6 || Count == 7,
                "Usage: LightComputeValidation driver-library shader-directory "
                "input-archive output-directory");
        auto Scene = LightComputeArchive::Load(Arguments[3]);
        std::filesystem::create_directories(Arguments[4]);
        LightComputeSubmission Compute(Arguments[1]);
        std::cout << "DEVICE name=" << Compute.Properties.deviceName
                  << " type=" << Compute.Properties.deviceType << " api=" << Compute.Properties.apiVersion
                  << " ray_query_extensions=" << Compute.RayQueryExtensions
                  << " ray_query_executed=0 triangle_bvh_executed=1\n";
        Compute.Prepare(Scene, Arguments[2]);
        if (Count == 6 && std::string(Arguments[5]) == "--primary-only")
        {
            ValidatePrimaryClipping(Arguments[1], Arguments[2], Arguments[4]);
            ValidatePrimary(Compute, Scene, Arguments[4]);
            return 0;
        }
        if (Count == 7 && std::string(Arguments[5]) == "--primary-motion")
        {
            ValidatePrimaryMotion(Arguments[1], Arguments[2], Arguments[6], Arguments[4]);
            return 0;
        }
        if (Count == 6 && std::string(Arguments[5]) == "--transport-only")
        {
            ValidateSurfaceTransport(Arguments[1], Arguments[2], Scene, Arguments[4]);
            return 0;
        }
        if (Count == 7 && std::string(Arguments[5]) == "--transport-motion")
        {
            ValidateTransportMotion(Arguments[1], Arguments[2], Arguments[6], Arguments[4]);
            return 0;
        }
        if (Count == 6 && std::string(Arguments[5]) == "--emissive-only")
        {
            ValidateEmissiveQuadrature(Arguments[1], Arguments[2], Scene, Arguments[4]);
            return 0;
        }
        if (Count == 7 && std::string(Arguments[5]) == "--emissive-motion")
        {
            ValidateTransportMotion(Arguments[1], Arguments[2], Arguments[6], Arguments[4],
                                    &EmissiveQuadrature::AppendDistribution);
            return 0;
        }
        auto All = Compute.Execute(Scene, 0);
        auto GlobalCounts = Compute.Statistics();
        auto Local = Compute.Execute(Scene, 1);
        auto LocalCounts = Compute.Statistics();
        Require(All == Local, "Vulkan clustered output differs from Vulkan all-light evaluation");
        auto Overflow = Compute.Execute(Scene, 1, 1);
        Require(Overflow == All, "Vulkan overflow fallback changed output");
        double Absolute = 0, Maximum = 0;
        uint64_t Large = 0;
        double Energy = 0;
        for (size_t I = 0; I < All.size(); ++I)
            for (uint32_t Channel = 0; Channel < 3; ++Channel)
            {
                auto& R = Scene.Receivers[I];
                double Expected = R.ResidualSpecular[Channel] + R.ExpectedDirect[Channel];
                double Delta = std::abs(All[I][Channel] - Expected);
                Absolute += Delta;
                Maximum = std::max(Maximum, Delta);
                Large += Delta > 1e-3;
                Energy += R.ExpectedDirect[Channel] * (Channel == 0 ? .2126 : Channel == 1 ? .7152 : .0722);
                Require(std::isfinite(All[I][Channel]), "Nonfinite Vulkan readback");
            }
        std::cout << "COMPARE receivers=" << All.size() << " facets=" << Scene.Visibility.Corners.size()
                  << " all_visits=" << GlobalCounts[0] << " local_visits=" << LocalCounts[0]
                  << " fallbacks=" << LocalCounts[1] << " shadow_rays=" << LocalCounts[2]
                  << " stack_fallbacks=" << LocalCounts[3]
                  << " cpu_mean_abs_rgb=" << Absolute / (All.size() * 3) << " cpu_max_abs_rgb=" << Maximum
                  << " channels_over_1e-3=" << Large << "\n";
        Require(Maximum < .001 && Absolute / (All.size() * 3) < .001,
                "Mean Vulkan/native colour error exceeds acceptance");
        WriteImage(std::string(Arguments[4]) + "/All.ppm", All, Scene.Width, Scene.Height);
        WriteImage(std::string(Arguments[4]) + "/Clustered.ppm", Local, Scene.Width, Scene.Height);
        ValidateFreshSampling(Arguments[1], Arguments[2]);
        ValidateHistory(Arguments[1], Arguments[2], Scene, Arguments[4], Count == 6 ? Arguments[5] : "");
        auto Ris = Compute.Execute(Scene, 2);
        WriteImage(std::string(Arguments[4]) + "/FreshRis.ppm", Ris, Scene.Width, Scene.Height);
        double Sum = 0;
        for (auto P : Ris)
            Sum += P[3];
        std::cout << "RIS first_seed_luminance_sum=" << Sum << " native_exact_luminance_sum=" << Energy
                  << " fresh_ris_temporal_reuse=0\nPASS Vulkan "
                     "all-light/cluster/overflow equality and native "
                     "image comparison\n";
    }
    catch (const std::exception& Error)
    {
        std::cerr << Error.what() << '\n';
        return 1;
    }
}
