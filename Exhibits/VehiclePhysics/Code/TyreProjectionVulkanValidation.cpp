/*==========================================================================================================================================
                                             TYREPROJECTIONVULKANVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 Execute the Engine SPIR-V unchanged through Vulkan and compare each tyre with the Engine CPU solver.

#include "Engine/Physics/TyreContinuum.h"
#include "Engine/Physics/TyreProjectionDevice.h"
#include "Engine/Physics/TyreProjectionVulkan.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
void Confirm(VkResult Status, const char *Operation)
{
    if (Status != VK_SUCCESS) throw std::runtime_error(std::string(Operation) + " failed: " + std::to_string(Status));
}

struct Buffer
{
    VkBuffer Handle = VK_NULL_HANDLE;
    VkDeviceMemory Memory = VK_NULL_HANDLE;
    void *Mapped = nullptr;
};

struct VulkanFixture
{
    VkInstance Instance = VK_NULL_HANDLE;
    VkPhysicalDevice Physical = VK_NULL_HANDLE;
    VkDevice Device = VK_NULL_HANDLE;
    VkQueue Queue = VK_NULL_HANDLE;
    std::uint32_t QueueFamily = 0;
    VkPhysicalDeviceProperties Properties{};
    VkDescriptorSetLayout DescriptorLayout = VK_NULL_HANDLE;
    VkDescriptorPool DescriptorPool = VK_NULL_HANDLE;
    VkDescriptorSet Descriptors = VK_NULL_HANDLE;
    VkPipelineLayout PipelineLayout = VK_NULL_HANDLE;
    VkPipeline ResetPipeline = VK_NULL_HANDLE;
    VkPipeline AdvancePipeline = VK_NULL_HANDLE;
    VkCommandPool CommandPool = VK_NULL_HANDLE;
    VkCommandBuffer Commands = VK_NULL_HANDLE;
    Buffer CommandBuffer, ParticleBuffer, ResultBuffer;

    ~VulkanFixture()
    {
        if (Device) vkDeviceWaitIdle(Device);
        if (Device && CommandPool) vkDestroyCommandPool(Device, CommandPool, nullptr);
        if (Device && ResetPipeline) vkDestroyPipeline(Device, ResetPipeline, nullptr);
        if (Device && AdvancePipeline) vkDestroyPipeline(Device, AdvancePipeline, nullptr);
        if (Device && PipelineLayout) vkDestroyPipelineLayout(Device, PipelineLayout, nullptr);
        if (Device && DescriptorPool) vkDestroyDescriptorPool(Device, DescriptorPool, nullptr);
        if (Device && DescriptorLayout) vkDestroyDescriptorSetLayout(Device, DescriptorLayout, nullptr);
        for (Buffer *Item : {&CommandBuffer, &ParticleBuffer, &ResultBuffer})
        {
            if (Device && Item->Mapped) vkUnmapMemory(Device, Item->Memory);
            if (Device && Item->Handle) vkDestroyBuffer(Device, Item->Handle, nullptr);
            if (Device && Item->Memory) vkFreeMemory(Device, Item->Memory, nullptr);
        }
        if (Device) vkDestroyDevice(Device, nullptr);
        if (Instance) vkDestroyInstance(Instance, nullptr);
    }

    void InitializeDevice()
    {
        VkApplicationInfo App{VK_STRUCTURE_TYPE_APPLICATION_INFO};
        App.pApplicationName = "Frontier tyre projection validation";
        App.apiVersion = VK_API_VERSION_1_1;
        VkInstanceCreateInfo InstanceInfo{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
        InstanceInfo.pApplicationInfo = &App;
        Confirm(vkCreateInstance(&InstanceInfo, nullptr, &Instance), "vkCreateInstance");
        std::uint32_t Count = 0;
        Confirm(vkEnumeratePhysicalDevices(Instance, &Count, nullptr), "vkEnumeratePhysicalDevices count");
        if (!Count) throw std::runtime_error("No Vulkan device");
        std::vector<VkPhysicalDevice> Devices(Count);
        Confirm(vkEnumeratePhysicalDevices(Instance, &Count, Devices.data()), "vkEnumeratePhysicalDevices");
        Physical = Devices[0];
        vkGetPhysicalDeviceProperties(Physical, &Properties);
        std::uint32_t FamilyCount = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(Physical, &FamilyCount, nullptr);
        std::vector<VkQueueFamilyProperties> Families(FamilyCount);
        vkGetPhysicalDeviceQueueFamilyProperties(Physical, &FamilyCount, Families.data());
        bool Found = false;
        for (std::uint32_t I = 0; I < FamilyCount; ++I)
            if (Families[I].queueCount && (Families[I].queueFlags & VK_QUEUE_COMPUTE_BIT))
            { QueueFamily = I; Found = true; break; }
        if (!Found) throw std::runtime_error("No compute queue");
        const float Priority = 1.0f;
        VkDeviceQueueCreateInfo QueueInfo{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
        QueueInfo.queueFamilyIndex = QueueFamily;
        QueueInfo.queueCount = 1;
        QueueInfo.pQueuePriorities = &Priority;
        VkDeviceCreateInfo DeviceInfo{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
        DeviceInfo.queueCreateInfoCount = 1;
        DeviceInfo.pQueueCreateInfos = &QueueInfo;
        Confirm(vkCreateDevice(Physical, &DeviceInfo, nullptr, &Device), "vkCreateDevice");
        vkGetDeviceQueue(Device, QueueFamily, 0, &Queue);
        std::printf("VULKAN device=%s type=%u api=%u.%u.%u\n", Properties.deviceName,
                    unsigned(Properties.deviceType), VK_VERSION_MAJOR(Properties.apiVersion),
                    VK_VERSION_MINOR(Properties.apiVersion), VK_VERSION_PATCH(Properties.apiVersion));
    }

    void InitializeBuffer(Buffer &Target, VkDeviceSize Size)
    {
        VkBufferCreateInfo Info{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        Info.size = Size;
        Info.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
        Info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
        Confirm(vkCreateBuffer(Device, &Info, nullptr, &Target.Handle), "vkCreateBuffer");
        VkMemoryRequirements Requirements{};
        vkGetBufferMemoryRequirements(Device, Target.Handle, &Requirements);
        VkPhysicalDeviceMemoryProperties Types{};
        vkGetPhysicalDeviceMemoryProperties(Physical, &Types);
        std::uint32_t Chosen = Types.memoryTypeCount;
        const auto Flags = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
        for (std::uint32_t I = 0; I < Types.memoryTypeCount; ++I)
            if ((Requirements.memoryTypeBits & (1u << I)) && (Types.memoryTypes[I].propertyFlags & Flags) == Flags)
            { Chosen = I; break; }
        if (Chosen == Types.memoryTypeCount) throw std::runtime_error("No coherent host-visible Vulkan memory");
        VkMemoryAllocateInfo Allocation{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        Allocation.allocationSize = Requirements.size;
        Allocation.memoryTypeIndex = Chosen;
        Confirm(vkAllocateMemory(Device, &Allocation, nullptr, &Target.Memory), "vkAllocateMemory");
        Confirm(vkBindBufferMemory(Device, Target.Handle, Target.Memory, 0), "vkBindBufferMemory");
        Confirm(vkMapMemory(Device, Target.Memory, 0, Size, 0, &Target.Mapped), "vkMapMemory");
        std::memset(Target.Mapped, 0, static_cast<std::size_t>(Size));
    }

    VkPipeline InitializePipeline(const char *Path)
    {
        std::ifstream Input(Path, std::ios::binary | std::ios::ate);
        if (!Input) throw std::runtime_error(std::string("Cannot read shader ") + Path);
        const auto Bytes = Input.tellg();
        if (Bytes <= 0 || Bytes % 4 != 0) throw std::runtime_error("Invalid SPIR-V byte count");
        std::vector<std::uint32_t> Words(static_cast<std::size_t>(Bytes) / 4);
        Input.seekg(0);
        if (!Input.read(reinterpret_cast<char *>(Words.data()), Bytes)) throw std::runtime_error("SPIR-V read failed");
        VkShaderModuleCreateInfo ModuleInfo{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
        ModuleInfo.codeSize = static_cast<std::size_t>(Bytes);
        ModuleInfo.pCode = Words.data();
        VkShaderModule Module = VK_NULL_HANDLE;
        Confirm(vkCreateShaderModule(Device, &ModuleInfo, nullptr, &Module), "vkCreateShaderModule");
        VkPipelineShaderStageCreateInfo Stage{VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
        Stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        Stage.module = Module;
        Stage.pName = "main";
        VkComputePipelineCreateInfo Info{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
        Info.stage = Stage;
        Info.layout = PipelineLayout;
        VkPipeline Pipeline = VK_NULL_HANDLE;
        const VkResult Status = vkCreateComputePipelines(Device, VK_NULL_HANDLE, 1, &Info, nullptr, &Pipeline);
        vkDestroyShaderModule(Device, Module, nullptr);
        Confirm(Status, "vkCreateComputePipelines");
        return Pipeline;
    }

    void InitializeResources(std::uint32_t Count, const char *ResetPath, const char *AdvancePath)
    {
        using namespace Frontier;
        InitializeBuffer(CommandBuffer, sizeof(TyreProjectionCommand) * Count);
        InitializeBuffer(ParticleBuffer, sizeof(TyreProjectionParticle) * TyreContinuumParticleCount * Count);
        InitializeBuffer(ResultBuffer, sizeof(TyreProjectionResult) * Count);
        VkDescriptorSetLayoutBinding Bindings[3]{};
        for (std::uint32_t I = 0; I < 3; ++I)
        {
            Bindings[I].binding = I;
            Bindings[I].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            Bindings[I].descriptorCount = 1;
            Bindings[I].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        }
        VkDescriptorSetLayoutCreateInfo LayoutInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        LayoutInfo.bindingCount = 3;
        LayoutInfo.pBindings = Bindings;
        Confirm(vkCreateDescriptorSetLayout(Device, &LayoutInfo, nullptr, &DescriptorLayout), "vkCreateDescriptorSetLayout");
        VkPipelineLayoutCreateInfo PipelineInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
        PipelineInfo.setLayoutCount = 1;
        PipelineInfo.pSetLayouts = &DescriptorLayout;
        Confirm(vkCreatePipelineLayout(Device, &PipelineInfo, nullptr, &PipelineLayout), "vkCreatePipelineLayout");
        VkDescriptorPoolSize PoolSize{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 3};
        VkDescriptorPoolCreateInfo PoolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
        PoolInfo.maxSets = 1;
        PoolInfo.poolSizeCount = 1;
        PoolInfo.pPoolSizes = &PoolSize;
        Confirm(vkCreateDescriptorPool(Device, &PoolInfo, nullptr, &DescriptorPool), "vkCreateDescriptorPool");
        VkDescriptorSetAllocateInfo Allocate{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
        Allocate.descriptorPool = DescriptorPool;
        Allocate.descriptorSetCount = 1;
        Allocate.pSetLayouts = &DescriptorLayout;
        Confirm(vkAllocateDescriptorSets(Device, &Allocate, &Descriptors), "vkAllocateDescriptorSets");
        VkDescriptorBufferInfo BufferInfo[3]{};
        VkWriteDescriptorSet Writes[3]{};
        const VkBuffer Handles[3] = {CommandBuffer.Handle, ParticleBuffer.Handle, ResultBuffer.Handle};
        for (std::uint32_t I = 0; I < 3; ++I)
        {
            BufferInfo[I] = {Handles[I], 0, VK_WHOLE_SIZE};
            Writes[I].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            Writes[I].dstSet = Descriptors;
            Writes[I].dstBinding = I;
            Writes[I].descriptorCount = 1;
            Writes[I].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            Writes[I].pBufferInfo = &BufferInfo[I];
        }
        vkUpdateDescriptorSets(Device, 3, Writes, 0, nullptr);
        ResetPipeline = InitializePipeline(ResetPath);
        AdvancePipeline = InitializePipeline(AdvancePath);
        VkCommandPoolCreateInfo Pool{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        Pool.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        Pool.queueFamilyIndex = QueueFamily;
        Confirm(vkCreateCommandPool(Device, &Pool, nullptr, &CommandPool), "vkCreateCommandPool");
        VkCommandBufferAllocateInfo CommandsInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        CommandsInfo.commandPool = CommandPool;
        CommandsInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        CommandsInfo.commandBufferCount = 1;
        Confirm(vkAllocateCommandBuffers(Device, &CommandsInfo, &Commands), "vkAllocateCommandBuffers");
    }

    Frontier::TyreProjectionVulkanAccess QueryAccess() const
    {
        Frontier::TyreProjectionVulkanAccess Access;
        Access.PipelineLayout = PipelineLayout;
        Access.ResetPipeline = ResetPipeline;
        Access.AdvancePipeline = AdvancePipeline;
        Access.Descriptors = Descriptors;
        Access.BindPipeline = vkCmdBindPipeline;
        Access.BindDescriptors = vkCmdBindDescriptorSets;
        Access.Dispatch = vkCmdDispatch;
        Access.MaxGroupCountX = Properties.limits.maxComputeWorkGroupCount[0];
        return Access;
    }

    void Execute(Frontier::TyreProjectionOperation Operation, std::uint32_t Count)
    {
        VkCommandBufferBeginInfo Begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        Confirm(vkBeginCommandBuffer(Commands, &Begin), "vkBeginCommandBuffer");
        Frontier::RecordTyreProjection(Commands, QueryAccess(), Operation, Count);
        VkMemoryBarrier Barrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        Barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT | VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0, 1, &Barrier, 0, nullptr, 0, nullptr);
        Confirm(vkEndCommandBuffer(Commands), "vkEndCommandBuffer");
        VkSubmitInfo Submission{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        Submission.commandBufferCount = 1;
        Submission.pCommandBuffers = &Commands;
        Confirm(vkQueueSubmit(Queue, 1, &Submission, VK_NULL_HANDLE), "vkQueueSubmit");
        Confirm(vkQueueWaitIdle(Queue), "vkQueueWaitIdle");
        Confirm(vkResetCommandBuffer(Commands, 0), "vkResetCommandBuffer");
    }
};

Frontier::TyreContinuumInput Expand(const Frontier::TyreProjectionCommand &Command)
{
    Frontier::TyreContinuumInput Input;
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        Input.Centre[Axis] = Command.Centre[Axis];
        Input.GroundNormal[Axis] = Command.GroundNormalDeflection[Axis];
    }
    for (int Axis = 0; Axis < 4; ++Axis) Input.Orientation[Axis] = Command.Orientation[Axis];
    Input.Deflection = Command.GroundNormalDeflection[3];
    Input.Pressure = Command.PressureLateralSeconds[0];
    Input.LateralForce = Command.PressureLateralSeconds[1];
    return Input;
}

void CheckRejected(const Frontier::TyreContinuumInput &Input, double Seconds, std::uint32_t Substeps)
{
    try { (void)Frontier::CompileTyreProjectionCommand(Input, Seconds, Substeps); }
    catch (const std::invalid_argument &) { return; }
    throw std::runtime_error("Invalid CPU-side command was accepted");
}

int Run(int Count, char **Arguments)
{
    using namespace Frontier;
    if (Count != 5) throw std::runtime_error("Expected reset.spv advance.spv commands.bin output.bin");
    std::ifstream File(Arguments[3], std::ios::binary);
    if (!File) throw std::runtime_error("Cannot read fixture commands");
    std::uint32_t Tyres = 0, Steps = 0;
    File.read(reinterpret_cast<char *>(&Tyres), 4);
    File.read(reinterpret_cast<char *>(&Steps), 4);
    if (!File || Tyres == 0 || Tyres > 128 || Steps == 0 || Steps > 64)
        throw std::runtime_error("Invalid fixture dimensions");
    std::vector<TyreProjectionCommand> All(static_cast<std::size_t>(Tyres) * Steps);
    if (!File.read(reinterpret_cast<char *>(All.data()), static_cast<std::streamsize>(All.size() * sizeof(All[0]))) ||
        File.peek() != std::char_traits<char>::eof())
        throw std::runtime_error("Invalid fixture command bytes");
    std::ofstream Output(Arguments[4], std::ios::binary);
    if (!Output) throw std::runtime_error("Cannot write fixture output");

    VulkanFixture Device;
    Device.InitializeDevice();
    Device.InitializeResources(Tyres, Arguments[1], Arguments[2]);
    auto *MappedCommands = static_cast<TyreProjectionCommand *>(Device.CommandBuffer.Mapped);
    auto *Particles = static_cast<TyreProjectionParticle *>(Device.ParticleBuffer.Mapped);
    auto *Results = static_cast<TyreProjectionResult *>(Device.ResultBuffer.Mapped);
    std::memcpy(MappedCommands, All.data(), sizeof(All[0]) * Tyres);
    Device.Execute(TyreProjectionOperation::Reset, Tyres);
    std::vector<TyreCarcassProjection> Cpu(Tyres);
    for (std::uint32_t I = 0; I < Tyres; ++I) Cpu[I].Reset(Expand(All[I]));
    double WorstLocal = 0.0, WorstWorld = 0.0, WorstForce = 0.0;
    std::size_t Pinned = 0;
    for (std::uint32_t Step = 0; Step < Steps; ++Step)
    {
        const auto *Commands = All.data() + static_cast<std::size_t>(Step) * Tyres;
        for (std::uint32_t I = 0; I < Tyres; ++I)
        {
            const auto Packed = CompileTyreProjectionCommand(Expand(Commands[I]), Commands[I].PressureLateralSeconds[2],
                                                             Commands[I].IterationCounts[0]);
            if (std::memcmp(&Packed, &Commands[I], sizeof(Packed)) != 0)
                throw std::runtime_error("Fixture bytes differ from the Engine command ABI");
        }
        std::memcpy(MappedCommands, Commands, sizeof(Commands[0]) * Tyres);
        Device.Execute(TyreProjectionOperation::Advance, Tyres);
        for (std::uint32_t I = 0; I < Tyres; ++I)
        {
            const auto Input = Expand(Commands[I]);
            const double Force = Cpu[I].Advance(Input, Commands[I].PressureLateralSeconds[2], Commands[I].IterationCounts[0]);
            if (Results[I].ForceStatus[1] != 1.0f) throw std::runtime_error("Valid GPU command rejected");
            WorstForce = std::max(WorstForce, std::abs(Force - Results[I].ForceStatus[0]));
            for (int N = 0; N < TyreContinuumParticleCount; ++N)
            {
                const auto &Particle = Particles[I * TyreContinuumParticleCount + N];
                for (int Axis = 0; Axis < 3; ++Axis)
                {
                    if (!std::isfinite(Particle.Local[Axis]) || !std::isfinite(Particle.World[Axis]))
                        throw std::runtime_error("Nonfinite GPU particle");
                    WorstLocal = std::max(WorstLocal, std::abs(double(Particle.Local[Axis]) - Cpu[I].QueryLocalPositions()[N*3+Axis]));
                    WorstWorld = std::max(WorstWorld, std::abs(double(Particle.World[Axis]) - Cpu[I].QueryWorldPositions()[N*3+Axis]));
                    if (N % 5 == 0 || N % 5 == 4)
                    {
                        if (Particle.Local[Axis] != Particle.RestInverseMass[Axis])
                            throw std::runtime_error("Rim bead moved");
                        ++Pinned;
                    }
                }
            }
        }
        Output.write(reinterpret_cast<const char *>(Particles), sizeof(*Particles) * TyreContinuumParticleCount * Tyres);
        Output.write(reinterpret_cast<const char *>(Results), sizeof(*Results) * Tyres);
    }
    if (!Output) throw std::runtime_error("GPU output write failed");
    std::printf("TYRE_DEVICE_CPU tyres=%u steps=%u particles=%zu max_local_m=%.9g max_world_m=%.9g max_force_n=%.9g pinned_components=%zu\n",
                Tyres, Steps, std::size_t(Tyres) * Steps * TyreContinuumParticleCount, WorstLocal, WorstWorld, WorstForce, Pinned);
    if (WorstLocal > 0.0003 || WorstWorld > 0.0003 || WorstForce > 0.02)
        throw std::runtime_error("GPU differs from CPU solver beyond tolerance");

    // 📝 Failed shader commands must not mutate the first tyre's state.
    std::vector<TyreProjectionParticle> Saved(Particles, Particles + TyreContinuumParticleCount);
    MappedCommands[0].IterationCounts[0] = 0;
    Device.Execute(TyreProjectionOperation::Advance, Tyres);
    if (Results[0].ForceStatus[1] != 0.0f ||
        std::memcmp(Saved.data(), Particles, Saved.size() * sizeof(Saved[0])) != 0)
        throw std::runtime_error("Invalid advance changed tyre state");
    MappedCommands[0].IterationCounts[0] = 2;
    MappedCommands[0].PressureLateralSeconds[0] = std::numeric_limits<float>::quiet_NaN();
    Device.Execute(TyreProjectionOperation::Reset, Tyres);
    if (Results[0].ForceStatus[1] != 0.0f ||
        std::memcmp(Saved.data(), Particles, Saved.size() * sizeof(Saved[0])) != 0)
        throw std::runtime_error("Invalid reset changed tyre state");

    MappedCommands[0] = All[0];
    Device.Execute(TyreProjectionOperation::Reset, Tyres);
    for (std::uint32_t I = 0; I < Tyres; ++I)
    {
        if (Results[I].ForceStatus[0] != 0.0f || Results[I].ForceStatus[1] != 1.0f)
            throw std::runtime_error("Reset did not clear the force");
        for (int N = 0; N < TyreContinuumParticleCount; ++N)
        {
            const auto &Particle = Particles[I * TyreContinuumParticleCount + N];
            for (int Axis = 0; Axis < 3; ++Axis)
                if (Particle.Local[Axis] != Particle.RestInverseMass[Axis] ||
                    Particle.Previous[Axis] != Particle.RestInverseMass[Axis] || Particle.Velocity[Axis] != 0.0f)
                    throw std::runtime_error("Reset did not restore particle state");
        }
    }
    const std::vector<TyreProjectionParticle> AllSaved(Particles, Particles + Tyres * TyreContinuumParticleCount);
    const std::vector<TyreProjectionResult> ResultsSaved(Results, Results + Tyres);
    VkDescriptorBufferInfo ShortBuffer{Device.ParticleBuffer.Handle, 0,
                                      sizeof(TyreProjectionParticle) * (TyreContinuumParticleCount - 1)};
    VkWriteDescriptorSet ShortWrite{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    ShortWrite.dstSet = Device.Descriptors;
    ShortWrite.dstBinding = 1;
    ShortWrite.descriptorCount = 1;
    ShortWrite.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    ShortWrite.pBufferInfo = &ShortBuffer;
    vkUpdateDescriptorSets(Device.Device, 1, &ShortWrite, 0, nullptr);
    Device.Execute(TyreProjectionOperation::Advance, Tyres);
    if (std::memcmp(AllSaved.data(), Particles, AllSaved.size() * sizeof(AllSaved[0])) != 0 ||
        std::memcmp(ResultsSaved.data(), Results, ResultsSaved.size() * sizeof(ResultsSaved[0])) != 0)
        throw std::runtime_error("Undersized particle binding was not rejected");

    TyreContinuumInput Invalid;
    CheckRejected(Invalid, 0.0, 2);
    CheckRejected(Invalid, 1.0/120.0, 0);
    CheckRejected(Invalid, 1.0/120.0, 33);
    Invalid.Pressure = std::numeric_limits<double>::infinity();
    CheckRejected(Invalid, 1.0/120.0, 2);
    Invalid.Pressure = 220000.0;
    Invalid.Orientation[3] = 0.5;
    CheckRejected(Invalid, 1.0/120.0, 2);
    auto Access = Device.QueryAccess();
    Access.MaxGroupCountX = 0;
    bool Rejected = false;
    try { RecordTyreProjection(Device.Commands, Access, TyreProjectionOperation::Advance, 1); }
    catch (const std::invalid_argument &) { Rejected = true; }
    if (!Rejected) throw std::runtime_error("Dispatch group limit not enforced");
    RecordTyreProjection(VK_NULL_HANDLE, {}, TyreProjectionOperation::Reset, 0);
    std::printf("TYRE_DEVICE_GUARDS invalid_gpu_advance=1 invalid_gpu_reset=1 valid_reset=1 short_particle_buffer=1 invalid_cpu_commands=5 dispatch_limit=1 zero_count=1\n");
    return 0;
}
} // namespace

int main(int Count, char **Arguments)
{
    try { return Run(Count, Arguments); }
    catch (const std::exception &Error) { std::fprintf(stderr, "FAIL %s\n", Error.what()); return 1; }
}
