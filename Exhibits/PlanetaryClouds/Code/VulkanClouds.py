#!/usr/bin/env python3
# ============================================================================================================================================
#                                                             VULKANCLOUDS.PY
# ============================================================================================================================================
# 🧩 Guarded Vulkan compute residence, explicit mapped-memory dependencies and native cloud readbacks.

import argparse
from contextlib import ExitStack
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import time

import numpy as Np
import vulkan as Vk

import RenderClouds as Clouds


class VulkanIntegration:
    def __init__(self, Resources, Shader, Noise, PixelCapacity=8192 * 16, SurfaceCapacity=8192 * 16 * 4):
        self.Resources = Resources
        self.Instance = Vk.vkCreateInstance(Vk.VkInstanceCreateInfo(
            pApplicationInfo=Vk.VkApplicationInfo(apiVersion=Vk.VK_MAKE_VERSION(1, 1, 0))), None)
        Resources.callback(Vk.vkDestroyInstance, self.Instance, None)
        Physical, Family = next((Device, Index) for Device in Vk.vkEnumeratePhysicalDevices(self.Instance)
                                for Index, Queue in enumerate(Vk.vkGetPhysicalDeviceQueueFamilyProperties(Device))
                                if Queue.queueCount and Queue.queueFlags & Vk.VK_QUEUE_COMPUTE_BIT)
        self.Physical = Physical
        Properties = Vk.vkGetPhysicalDeviceProperties(Physical)
        self.Description = {"name": Properties.deviceName, "type": Properties.deviceType,
                            "physical_gpu": Properties.deviceType in (1, 2), "api_version": Properties.apiVersion}
        print(self.Description, flush=True)
        self.Memory = Vk.vkGetPhysicalDeviceMemoryProperties(Physical)
        self.Device = Device = Vk.vkCreateDevice(Physical, Vk.VkDeviceCreateInfo(pQueueCreateInfos=[
            Vk.VkDeviceQueueCreateInfo(queueFamilyIndex=Family, pQueuePriorities=[1.0])]), None)
        Resources.callback(Vk.vkDestroyDevice, Device, None)
        self.Queue = Vk.vkGetDeviceQueue(Device, Family, 0)
        Storage = Vk.VK_DESCRIPTOR_TYPE_STORAGE_BUFFER
        Types = [Vk.VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, Storage, Storage, Storage,
                 Vk.VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE, Vk.VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE,
                 Vk.VK_DESCRIPTOR_TYPE_SAMPLER]
        DescriptorLayout = Vk.vkCreateDescriptorSetLayout(Device, Vk.VkDescriptorSetLayoutCreateInfo(pBindings=[
            Vk.VkDescriptorSetLayoutBinding(binding=Index, descriptorType=Category, descriptorCount=1,
                                            stageFlags=Vk.VK_SHADER_STAGE_COMPUTE_BIT)
            for Index, Category in enumerate(Types)]), None)
        Resources.callback(Vk.vkDestroyDescriptorSetLayout, Device, DescriptorLayout, None)
        self.PipelineLayout = Vk.vkCreatePipelineLayout(Device, Vk.VkPipelineLayoutCreateInfo(pSetLayouts=[DescriptorLayout]), None)
        Resources.callback(Vk.vkDestroyPipelineLayout, Device, self.PipelineLayout, None)
        Bytecode = Path(Shader).read_bytes()
        ShaderBytecode = Vk.vkCreateShaderModule(Device, Vk.VkShaderModuleCreateInfo(codeSize=len(Bytecode), pCode=Bytecode), None)
        Resources.callback(Vk.vkDestroyShaderModule, Device, ShaderBytecode, None)
        ShaderSelection = Vk.VkPipelineShaderStageCreateInfo(stage=Vk.VK_SHADER_STAGE_COMPUTE_BIT,
                                                            module=ShaderBytecode, pName=Clouds.Entry)
        Start = time.monotonic()
        print("Creating selected cloud compute pipeline", flush=True)
        self.Pipeline = Vk.vkCreateComputePipelines(Device, Vk.VK_NULL_HANDLE, 1, [Vk.VkComputePipelineCreateInfo(
            stage=ShaderSelection, layout=self.PipelineLayout)], None)[0]
        Resources.callback(Vk.vkDestroyPipeline, Device, self.Pipeline, None)
        self.PipelineSeconds = time.monotonic() - Start
        print(f"Selected cloud pipeline created in {self.PipelineSeconds:.3f}s", flush=True)
        self.Capacities = [240, len(Noise), PixelCapacity, SurfaceCapacity]
        Regions = [self.AllocateBuffer(Size, Vk.VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT if Index == 0 else
                                      Vk.VK_BUFFER_USAGE_STORAGE_BUFFER_BIT)
                   for Index, Size in enumerate(self.Capacities)]
        self.Mapped = [Region[1] for Region in Regions]
        self.Mapped[1][:len(Noise)] = Noise
        self.CommandPool = Vk.vkCreateCommandPool(Device, Vk.VkCommandPoolCreateInfo(queueFamilyIndex=Family), None)
        Resources.callback(Vk.vkDestroyCommandPool, Device, self.CommandPool, None)
        self.Command = Vk.vkAllocateCommandBuffers(Device, Vk.VkCommandBufferAllocateInfo(
            commandPool=self.CommandPool, level=Vk.VK_COMMAND_BUFFER_LEVEL_PRIMARY, commandBufferCount=1))[0]
        self.Textures = [self.UploadNoiseVolume(Noise, 128, 0, 128 ** 3 + 64 ** 3 + 4096),
                         self.UploadNoiseVolume(Noise, 64, 128 ** 3, 128 ** 3 + 64 ** 3 + 4096 + 299593)]
        self.Sampler = Vk.vkCreateSampler(Device, Vk.VkSamplerCreateInfo(magFilter=Vk.VK_FILTER_LINEAR,
            minFilter=Vk.VK_FILTER_LINEAR, mipmapMode=Vk.VK_SAMPLER_MIPMAP_MODE_LINEAR,
            addressModeU=Vk.VK_SAMPLER_ADDRESS_MODE_REPEAT, addressModeV=Vk.VK_SAMPLER_ADDRESS_MODE_REPEAT,
            addressModeW=Vk.VK_SAMPLER_ADDRESS_MODE_REPEAT, minLod=0.0, maxLod=7.0), None)
        Resources.callback(Vk.vkDestroySampler, Device, self.Sampler, None)
        Pool = Vk.vkCreateDescriptorPool(Device, Vk.VkDescriptorPoolCreateInfo(maxSets=1, pPoolSizes=[
            Vk.VkDescriptorPoolSize(type=Types[0], descriptorCount=1), Vk.VkDescriptorPoolSize(type=Storage, descriptorCount=3),
            Vk.VkDescriptorPoolSize(type=Vk.VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE, descriptorCount=2),
            Vk.VkDescriptorPoolSize(type=Vk.VK_DESCRIPTOR_TYPE_SAMPLER, descriptorCount=1)]), None)
        Resources.callback(Vk.vkDestroyDescriptorPool, Device, Pool, None)
        self.Descriptors = Vk.vkAllocateDescriptorSets(Device, Vk.VkDescriptorSetAllocateInfo(
            descriptorPool=Pool, pSetLayouts=[DescriptorLayout]))[0]
        Writes = [Vk.VkWriteDescriptorSet(dstSet=self.Descriptors, dstBinding=Index, descriptorCount=1,
                                          descriptorType=Types[Index], pBufferInfo=[Vk.VkDescriptorBufferInfo(
                                              buffer=Regions[Index][0], offset=0, range=Size + 64 if Index != 0 else Size)])
                  for Index, Size in enumerate(self.Capacities)]
        for Index, Texture in enumerate(self.Textures):
            Writes.append(Vk.VkWriteDescriptorSet(dstSet=self.Descriptors, dstBinding=4 + Index, descriptorCount=1,
                descriptorType=Vk.VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE, pImageInfo=[Vk.VkDescriptorImageInfo(
                    imageView=Texture, imageLayout=Vk.VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL)]))
        Writes.append(Vk.VkWriteDescriptorSet(dstSet=self.Descriptors, dstBinding=6, descriptorCount=1,
            descriptorType=Vk.VK_DESCRIPTOR_TYPE_SAMPLER, pImageInfo=[Vk.VkDescriptorImageInfo(sampler=self.Sampler)]))
        Vk.vkUpdateDescriptorSets(Device, len(Writes), Writes, 0, None)


    def AllocateBuffer(self, Size, Usage):
        Device = self.Device
        Buffer = Vk.vkCreateBuffer(Device, Vk.VkBufferCreateInfo(size=Size + 64, usage=Usage,
                                                               sharingMode=Vk.VK_SHARING_MODE_EXCLUSIVE), None)
        try:
            Requirements = Vk.vkGetBufferMemoryRequirements(Device, Buffer)
            Access = Vk.VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | Vk.VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
            Index = next(Index for Index in range(self.Memory.memoryTypeCount)
                         if Requirements.memoryTypeBits & (1 << Index) and
                         self.Memory.memoryTypes[Index].propertyFlags & Access == Access)
            Allocation = Vk.vkAllocateMemory(Device, Vk.VkMemoryAllocateInfo(
                allocationSize=Requirements.size, memoryTypeIndex=Index), None)
        except BaseException:
            Vk.vkDestroyBuffer(Device, Buffer, None)
            raise
        self.Resources.callback(Vk.vkFreeMemory, Device, Allocation, None)
        self.Resources.callback(Vk.vkDestroyBuffer, Device, Buffer, None)
        Vk.vkBindBufferMemory(Device, Buffer, Allocation, 0)
        Mapped = Vk.vkMapMemory(Device, Allocation, 0, Size + 64, 0)
        self.Resources.callback(Vk.vkUnmapMemory, Device, Allocation)
        Mapped[:] = b"\xa5" * (Size + 64)
        return Buffer, Mapped

    def UploadNoiseVolume(self, Noise, Resolution, InitialOffset, MipOffset):
        Words = Np.frombuffer(Noise, dtype="<u4")
        Levels = int(Resolution).bit_length()
        Payload = bytearray()
        Copies = []
        Offset = InitialOffset
        Size = Resolution
        for Level in range(Levels):
            Copies.append(Vk.VkBufferImageCopy(bufferOffset=len(Payload),
                imageSubresource=Vk.VkImageSubresourceLayers(aspectMask=Vk.VK_IMAGE_ASPECT_COLOR_BIT,
                                                             mipLevel=Level, baseArrayLayer=0, layerCount=1),
                imageExtent=Vk.VkExtent3D(width=Size, height=Size, depth=Size)))
            Payload.extend(Words[Offset:Offset + Size ** 3].tobytes())
            Offset = MipOffset if Level == 0 else Offset + Size ** 3
            Size //= 2
        Format = Vk.VK_FORMAT_R8G8B8A8_UNORM
        Features = Vk.vkGetPhysicalDeviceFormatProperties(self.Physical, Format).optimalTilingFeatures
        Required = Vk.VK_FORMAT_FEATURE_SAMPLED_IMAGE_BIT | Vk.VK_FORMAT_FEATURE_SAMPLED_IMAGE_FILTER_LINEAR_BIT
        assert Features & Required == Required, "filterable RGBA8 3D images are required"
        Image = Vk.vkCreateImage(self.Device, Vk.VkImageCreateInfo(imageType=Vk.VK_IMAGE_TYPE_3D,
            format=Format, extent=Vk.VkExtent3D(width=Resolution, height=Resolution, depth=Resolution),
            mipLevels=Levels, arrayLayers=1, samples=Vk.VK_SAMPLE_COUNT_1_BIT, tiling=Vk.VK_IMAGE_TILING_OPTIMAL,
            usage=Vk.VK_IMAGE_USAGE_TRANSFER_DST_BIT | Vk.VK_IMAGE_USAGE_SAMPLED_BIT,
            sharingMode=Vk.VK_SHARING_MODE_EXCLUSIVE, initialLayout=Vk.VK_IMAGE_LAYOUT_UNDEFINED), None)
        try:
            Requirements = Vk.vkGetImageMemoryRequirements(self.Device, Image)
            Index = next(Index for Index in range(self.Memory.memoryTypeCount)
                         if Requirements.memoryTypeBits & (1 << Index) and
                         self.Memory.memoryTypes[Index].propertyFlags & Vk.VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT)
            Allocation = Vk.vkAllocateMemory(self.Device, Vk.VkMemoryAllocateInfo(
                allocationSize=Requirements.size, memoryTypeIndex=Index), None)
        except BaseException:
            Vk.vkDestroyImage(self.Device, Image, None)
            raise
        self.Resources.callback(Vk.vkFreeMemory, self.Device, Allocation, None)
        self.Resources.callback(Vk.vkDestroyImage, self.Device, Image, None)
        Vk.vkBindImageMemory(self.Device, Image, Allocation, 0)
        Range = Vk.VkImageSubresourceRange(aspectMask=Vk.VK_IMAGE_ASPECT_COLOR_BIT,
                                           baseMipLevel=0, levelCount=Levels, baseArrayLayer=0, layerCount=1)
        View = Vk.vkCreateImageView(self.Device, Vk.VkImageViewCreateInfo(image=Image,
            viewType=Vk.VK_IMAGE_VIEW_TYPE_3D, format=Format, subresourceRange=Range), None)
        self.Resources.callback(Vk.vkDestroyImageView, self.Device, View, None)
        Buffer, Mapped = self.AllocateBuffer(len(Payload), Vk.VK_BUFFER_USAGE_TRANSFER_SRC_BIT)
        Mapped[:len(Payload)] = bytes(Payload)
        Vk.vkResetCommandPool(self.Device, self.CommandPool, 0)
        Command = self.Command
        Vk.vkBeginCommandBuffer(Command, Vk.VkCommandBufferBeginInfo(flags=Vk.VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT))
        Host = Vk.VkMemoryBarrier(srcAccessMask=Vk.VK_ACCESS_HOST_WRITE_BIT, dstAccessMask=Vk.VK_ACCESS_TRANSFER_READ_BIT)
        Vk.vkCmdPipelineBarrier(Command, Vk.VK_PIPELINE_STAGE_HOST_BIT, Vk.VK_PIPELINE_STAGE_TRANSFER_BIT,
                                0, 1, [Host], 0, None, 0, None)
        Before = Vk.VkImageMemoryBarrier(srcAccessMask=0, dstAccessMask=Vk.VK_ACCESS_TRANSFER_WRITE_BIT,
            oldLayout=Vk.VK_IMAGE_LAYOUT_UNDEFINED, newLayout=Vk.VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
            srcQueueFamilyIndex=Vk.VK_QUEUE_FAMILY_IGNORED, dstQueueFamilyIndex=Vk.VK_QUEUE_FAMILY_IGNORED,
            image=Image, subresourceRange=Range)
        Vk.vkCmdPipelineBarrier(Command, Vk.VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, Vk.VK_PIPELINE_STAGE_TRANSFER_BIT,
                                0, 0, None, 0, None, 1, [Before])
        Vk.vkCmdCopyBufferToImage(Command, Buffer, Image, Vk.VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, len(Copies), Copies)
        After = Vk.VkImageMemoryBarrier(srcAccessMask=Vk.VK_ACCESS_TRANSFER_WRITE_BIT,
            dstAccessMask=Vk.VK_ACCESS_SHADER_READ_BIT, oldLayout=Vk.VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
            newLayout=Vk.VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
            srcQueueFamilyIndex=Vk.VK_QUEUE_FAMILY_IGNORED, dstQueueFamilyIndex=Vk.VK_QUEUE_FAMILY_IGNORED,
            image=Image, subresourceRange=Range)
        Vk.vkCmdPipelineBarrier(Command, Vk.VK_PIPELINE_STAGE_TRANSFER_BIT, Vk.VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                0, 0, None, 0, None, 1, [After])
        Vk.vkEndCommandBuffer(Command)
        Vk.vkQueueSubmit(self.Queue, 1, [Vk.VkSubmitInfo(pCommandBuffers=[Command])], Vk.VK_NULL_HANDLE)
        Vk.vkQueueWaitIdle(self.Queue)
        assert Mapped[len(Payload):len(Payload) + 64] == b"\xa5" * 64, "3D upload buffer tail changed"
        return View

    def Dispatch(self, Uniform, Surface, Width, Rows):
        assert len(Uniform) == 240 and len(Surface) <= self.Capacities[3] and Width * Rows * 16 <= self.Capacities[2]
        assert Width > 0 and Rows > 0
        self.Mapped[0][:240] = Uniform
        self.Mapped[3][:len(Surface)] = Surface
        self.Mapped[2][:self.Capacities[2]] = b"\xa5" * self.Capacities[2]
        Vk.vkResetCommandPool(self.Device, self.CommandPool, 0)
        Command = self.Command
        Vk.vkBeginCommandBuffer(Command, Vk.VkCommandBufferBeginInfo(flags=Vk.VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT))
        Before = Vk.VkMemoryBarrier(srcAccessMask=Vk.VK_ACCESS_HOST_WRITE_BIT,
                                    dstAccessMask=Vk.VK_ACCESS_SHADER_READ_BIT | Vk.VK_ACCESS_UNIFORM_READ_BIT)
        Vk.vkCmdPipelineBarrier(Command, Vk.VK_PIPELINE_STAGE_HOST_BIT, Vk.VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                0, 1, [Before], 0, None, 0, None)
        Vk.vkCmdBindPipeline(Command, Vk.VK_PIPELINE_BIND_POINT_COMPUTE, self.Pipeline)
        Vk.vkCmdBindDescriptorSets(Command, Vk.VK_PIPELINE_BIND_POINT_COMPUTE, self.PipelineLayout,
                                   0, 1, [self.Descriptors], 0, None)
        Vk.vkCmdDispatch(Command, (Width + 7) // 8, (Rows + 7) // 8, 1)
        After = Vk.VkMemoryBarrier(srcAccessMask=Vk.VK_ACCESS_SHADER_WRITE_BIT, dstAccessMask=Vk.VK_ACCESS_HOST_READ_BIT)
        Vk.vkCmdPipelineBarrier(Command, Vk.VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, Vk.VK_PIPELINE_STAGE_HOST_BIT,
                                0, 1, [After], 0, None, 0, None)
        Vk.vkEndCommandBuffer(Command)
        Vk.vkQueueSubmit(self.Queue, 1, [Vk.VkSubmitInfo(pCommandBuffers=[Command])], Vk.VK_NULL_HANDLE)
        Vk.vkQueueWaitIdle(self.Queue)
        for Mapped, Capacity in zip(self.Mapped, self.Capacities):
            assert Mapped[Capacity:Capacity + 64] == b"\xa5" * 64, "Vulkan buffer tail changed"
        return bytes(self.Mapped[2][:Width * Rows * 16])


def CompileVulkan(Slang, Optimizer, Validator, Directory, Formation, Selection=None):
    Directory.mkdir(parents=True, exist_ok=True)
    Name = f"Formation{Formation}" + (f"Query{Selection}" if Selection is not None else "Beauty")
    Shader = Directory / (Name + ".Raw.spv")
    Defines = ["-D", "FRONTIER_CLOUD_TEXTURES=1", "-D", f"FRONTIER_CLOUD_FORMATION={Formation}"]
    if Selection is None:
        Defines.extend(["-D", "FRONTIER_CLOUD_BEAUTY_ONLY=1"])
    else:
        Defines.extend(["-D", "FRONTIER_CLOUD_QUERY_ONLY=1", "-D", f"FRONTIER_CLOUD_QUERY_SELECTION={Selection}"])
    subprocess.run([str(Slang), str(Clouds.Source / "CloudCompute.slang"), "-entry", Clouds.Entry,
                    "-target", "spirv", "-profile", "spirv_1_3", "-fp-mode", "precise", "-fvk-use-entrypoint-name",
                    "-O0", *Defines, "-o", str(Shader), "-reflection-json", str(Shader.with_suffix(".json"))], check=True)
    if not Optimizer.is_file() or not Validator.is_file():
        raise RuntimeError("Build the pinned SPIR-V optimizer/validator first; never retry the raw SwiftShader pipeline")
    Optimized = Directory / (Name + ".spv")
    subprocess.run([str(Optimizer), "-O", "--preserve-bindings", str(Shader), "-o", str(Optimized)], check=True)
    subprocess.run([str(Validator), "--target-env", "vulkan1.1", str(Optimized)], check=True)
    return Optimized


def ConstructDensityQueries(View, Count=1024):
    Random = Np.random.default_rng(191 + View.Formation)
    Queries = Np.zeros((Count, 16), dtype="<f4")
    Extent = 550000.0 if View.Formation == 11 else (16000.0 if View.Formation in (9, 10) else 70000.0)
    Queries[:, :2] = Random.uniform(-Extent, Extent, size=(Count, 2))
    Queries[:, 2] = 6371000.0
    Normal = Queries[:, :3].astype(Np.float64)
    Normal /= Np.linalg.norm(Normal, axis=1)[:, None]
    Altitude = View.Floor + Random.uniform(-0.05, 1.05, size=Count) * View.Depth
    Queries[:, :3] = Normal * (6371000.0 + Altitude[:, None])
    Queries[:, 3] = 4
    Queries[:, 7] = Random.uniform(1.0, 1800.0, size=Count)
    return Queries


def ValidateQueries(Compute, Native, View, Queries, Selection, Arrays):
    LightSteps = 32 if Selection == 5 else 12
    Raw = Compute.Dispatch(Clouds.EncodeFootprint(View, len(Queries), 1, (len(Queries) * 16, 1),
                                                0, 1, 96, LightSteps, 1, 2), Queries.tobytes(), len(Queries), 1)
    Actual = Np.frombuffer(Raw, dtype="<f4").reshape(-1, 4)
    Expected = Native.Inspect(View, Queries, Steps=96, LightSteps=LightSteps)
    assert Np.isfinite(Actual).all(), "non-finite Vulkan query output"
    Difference = Np.abs(Actual - Expected)
    if Selection == 4:
        # RGBA8 image interpolation has an implementation-defined subtexel precision. Density remains in 1/metres.
        Limits = Np.array((0.00012, 0.00012, 0.00001, 4.0))
        assert (Difference.max(axis=0) < Limits).all(), "Vulkan/native density/weather/arc-distance disagreement"
        assert Np.array_equal(Actual[:, 0], Actual[:, 1]), "Vulkan light and view densities disagree"
        assert Np.count_nonzero(Actual[:, 0]) > 0, "empty density fixture"
    elif Selection == 5:
        assert (Difference.max(axis=0) < Np.array((0.0001, 0.0001, 0.0001, 0.02))).all(), "Vulkan solar air/depth disagreement"
        assert (Actual[:, 3] >= 0.0).all() and (Actual[:, 3] <= 18.0).all(), "Vulkan solar optical-depth bounds"
    elif Selection in (8, 9):
        assert float(Difference.max()) < 0.00008, "Vulkan filtered packed-volume disagreement"
    elif Selection == 10:
        assert float(Difference.max()) < 0.000001, "Vulkan bounded rotation-trigonometry disagreement"
        assert float(Np.abs(Actual[:, 2] - 1.0).max()) < 0.000001, "Vulkan rotation unit-circle disagreement"
    else:
        assert float(Difference.max()) < 3.0, f"Vulkan wind-characteristic disagreement: {Difference.max(axis=0).tolist()}"
        assert float(Np.abs(Actual[:, 3]).max()) <= 1.5, "Vulkan wind did not preserve radial altitude"
    Prefix = f"Formation{View.Formation}Query{Selection}"
    Arrays[Prefix + "Inputs"] = Queries.copy()
    Arrays[Prefix + "Native"] = Expected.copy()
    Arrays[Prefix + "Vulkan"] = Actual.copy()
    return {"formation": View.Formation, "selection": Selection, "queries": len(Queries),
            "time_seconds": View.Time, "view_steps": 96, "light_steps": LightSteps,
            "max_abs_by_channel": Difference.max(axis=0).tolist(),
            "mean_abs_by_channel": Difference.mean(axis=0).tolist(),
            "shader_rg_equal": bool(Np.array_equal(Actual[:, 0], Actual[:, 1])) if Selection == 4 else None,
            "float_sha256": sha256(Raw).hexdigest()}


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--slang", type=Path, default=Clouds.Root / "ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc")
    Parser.add_argument("--optimizer", type=Path, default=Clouds.Root / "_ClaudeScratch/build/SpirvNative/tools/spirv-opt")
    Parser.add_argument("--validator", type=Path, default=Clouds.Root / "_ClaudeScratch/build/SpirvNative/tools/spirv-val")
    Parser.add_argument("--out", type=Path, default=Clouds.Root / "_ClaudeScratch/tmp/CloudVulkanQueries")
    Parser.add_argument("--views", nargs="+", choices=sorted(Clouds.Views),
                        default=["cumulus", "cyclone", "cirrus", "cumulonimbus", "cirrocumulus"])
    Parser.add_argument("--beauty", action="store_true", help="Opt in to bounded low-resolution full-image Vulkan comparisons")
    Parser.add_argument("--library", type=Path)
    Parser.add_argument("--noise", type=Path)
    Arguments = Parser.parse_args()
    if bool(Arguments.library) != bool(Arguments.noise):
        Parser.error("--library and --noise must be provided together")
    Directory = Arguments.out
    Directory.mkdir(parents=True, exist_ok=True)
    if Arguments.library:
        Library, Noise, Identity = Arguments.library.resolve(), Arguments.noise.resolve(), Clouds.QuerySourceIdentity()
    else:
        Library, Noise, Identity = Clouds.CompileNative(Arguments.slang)
    Native = Clouds.NativeIntegration(Library, Noise)
    Results, Arrays = [], {}
    Report = {"source_sha256": Identity, "tests_passed": False, "full_beauty_entry_executed": False,
              "guarded_buffer_tails": True, "images": [], "queries": Results,
              "library_sha256": Native.LibraryIdentity, "noise_sha256": Native.NoiseIdentity,
              "array_archive": "VulkanBeauty.npz" if Arguments.beauty else "VulkanProbes.npz",
              "array_scope": "complete native/Vulkan images" if Arguments.beauty else "complete inputs/native/Vulkan point probes",
              "physical_gpu_verified": False, "photorealism_accepted": False, "production_accepted": False}
    try:
        for Name in Arguments.views:
            View = Clouds.Views[Name]
            Selection = None if Arguments.beauty else 4
            Shader = CompileVulkan(Arguments.slang, Arguments.optimizer, Arguments.validator,
                                   Directory, View.Formation, Selection)
            with ExitStack() as Resources:
                Compute = VulkanIntegration(Resources, Shader, Noise.read_bytes(), 64 * 36 * 16)
                Report["device"] = Compute.Description
                if Arguments.beauty:
                    Width, Height = 64, 36
                    Uniform = Clouds.EncodeFootprint(View, Width, Height, (1, 1), 0, Height, 96, 8, 1)
                    Start = time.monotonic()
                    Raw = Compute.Dispatch(Uniform, bytes((16, 42, 68, 255)), Width, Height)
                    Actual = Np.frombuffer(Raw, dtype="<f4").reshape(Height, Width, 4)
                    Report["full_beauty_entry_executed"] = True
                    Expected = Native.Capture(View, Width, Height, 96, 8)
                    Difference = Np.abs(Actual - Expected)
                    assert Np.isfinite(Actual).all() and (Actual >= 0).all() and (Actual[..., 3] <= 1).all(), "Vulkan beauty bounds"
                    Maximum = float(Difference.max())
                    RgbRmse = float(Np.sqrt(Np.mean(Difference[..., :3] ** 2)))
                    assert Maximum < 0.002 and RgbRmse < 0.0001, "Vulkan/native complete-image disagreement"
                    from dataclasses import asdict
                    Result = {"view": Name, "view_specification": asdict(View), "width": Width, "height": Height,
                              "steps": 96, "light_steps": 8, "samples": 1, "seconds": time.monotonic() - Start,
                              "max_abs": Maximum, "rgb_rmse": RgbRmse,
                              "max_abs_tolerance": 0.002, "rgb_rmse_tolerance": 0.0001,
                              "float_sha256": sha256(Raw).hexdigest(),
                              "native_float_sha256": sha256(Expected.tobytes()).hexdigest()}
                    Arrays[Name + "Native"], Arrays[Name + "Vulkan"] = Expected.copy(), Actual.copy()
                    from PIL import Image
                    Picture = Directory / (Name + ".png")
                    Image.fromarray(Clouds.EncodeDisplay(Actual, View.Exposure)).save(Picture)
                    Result["png_sha256"] = sha256(Picture.read_bytes()).hexdigest()
                    Report["images"].append(Result)
                else:
                    Result = ValidateQueries(Compute, Native, View, ConstructDensityQueries(View), 4, Arrays)
                    Results.append(Result)
                Result["pipeline_seconds"] = Compute.PipelineSeconds
                Result["spirv_sha256"] = sha256(Shader.read_bytes()).hexdigest()
                print(Result, flush=True)
        if not Arguments.beauty:
            from dataclasses import replace
            Random = Np.random.default_rng(617)
            for Selection, Period in ((8, 7200.0), (9, 1550.0), (3, 0.0), (10, 0.0)):
                View = replace(Clouds.Views["cumulus"], Time=1200.0)
                Queries = Np.zeros((256, 16), dtype="<f4")
                Queries[:, 3] = Selection
                if Selection in (8, 9):
                    Queries[:, :3] = Random.uniform(-2.0, 2.0, size=(256, 3))
                    Queries[:, 7] = Np.geomspace(1.0, 1000000.0, 256)
                    Queries[:, 8] = Period
                elif Selection == 10:
                    Queries[:, 0] = Np.linspace(-Np.pi, Np.pi, 256)
                else:
                    Positions = Random.normal(size=(256, 3))
                    Positions /= Np.linalg.norm(Positions, axis=1)[:, None]
                    Queries[:, :3] = Positions * (6371000.0 + Random.uniform(1200, 14000, 256)[:, None])
                Shader = CompileVulkan(Arguments.slang, Arguments.optimizer, Arguments.validator,
                                       Directory, View.Formation, Selection)
                with ExitStack() as Resources:
                    Compute = VulkanIntegration(Resources, Shader, Noise.read_bytes(), 256 * 16)
                    Result = ValidateQueries(Compute, Native, View, Queries, Selection, Arrays)
                    Result["pipeline_seconds"] = Compute.PipelineSeconds
                    Result["spirv_sha256"] = sha256(Shader.read_bytes()).hexdigest()
                    Results.append(Result)
                    print(Result, flush=True)
            from ValidateSolarDensity import SolarDensityMeasurement
            View = Clouds.Views["cumulus"]
            _, Solar = SolarDensityMeasurement(Native)
            Queries = Np.zeros((256, 16), dtype="<f4")
            Queries[:, :3], Queries[:, 3] = Solar["Positions"], 5
            Shader = CompileVulkan(Arguments.slang, Arguments.optimizer, Arguments.validator,
                                   Directory, View.Formation, 5)
            with ExitStack() as Resources:
                Compute = VulkanIntegration(Resources, Shader, Noise.read_bytes(), len(Queries) * 16)
                Result = ValidateQueries(Compute, Native, View, Queries, 5, Arrays)
                Result["pipeline_seconds"] = Compute.PipelineSeconds
                Result["spirv_sha256"] = sha256(Shader.read_bytes()).hexdigest()
                Results.append(Result)
                print(Result, flush=True)
        Report["tests_passed"] = True
    except BaseException as Failure:
        Report["failure"] = str(Failure)
        raise
    finally:
        Np.savez_compressed(Directory / Report["array_archive"], **Arrays)
        Name = "VulkanBeauty.json" if Arguments.beauty else "VulkanClouds.json"
        (Directory / Name).write_text(json.dumps(Report, indent=2) + "\n")


if __name__ == "__main__":
    Main()
