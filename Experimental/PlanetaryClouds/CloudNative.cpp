/*==========================================================================================================================================
                                                              CLOUDNATIVE.CPP
==========================================================================================================================================*/
// 🧩 Bounded concurrent execution of the generated Slang C++ compute entry without a second cloud implementation.

#include "CloudGenerated.cpp"
#include "Experimental/PlanetaryClouds/CloudNoiseVolume.h"

#include <algorithm>
#include <atomic>
#include <array>
#include <cmath>
#include <cstring>
#include <thread>
#include <vector>

//------------------------------------------------------------------------------------------------------------------------
//                                                     NATIVE COMPUTE INPUTS
//------------------------------------------------------------------------------------------------------------------------

#ifndef FRONTIER_CLOUD_SOURCE_SHA256
#error "Compile through CMake or RenderClouds.py so the loaded cloud library authenticates its exact source inputs."
#endif

extern "C" const char* QueryCloudSourceIdentity()
{
    return FRONTIER_CLOUD_SOURCE_SHA256;
}

static_assert(sizeof(CloudCaptureFootprint_0) == 240 && offsetof(CloudCaptureFootprint_0, OriginTime_0) == 0 &&
              offsetof(CloudCaptureFootprint_0, Selection_0) == 176 &&
              offsetof(CloudCaptureFootprint_0, Size_0) == 192 && offsetof(CloudCaptureFootprint_0, Tile_0) == 208 &&
              offsetof(CloudCaptureFootprint_0, Switches_0) == 224);

extern "C" int IntegrateCloudTile(const void* UniformBytes,
                                  uint32_t*   NoiseTexels,
                                  size_t      NoiseCount,
                                  uint32_t*   SurfaceTexels,
                                  size_t      SurfaceCount,
                                  void*       PixelBytes,
                                  size_t      PixelCapacity,
                                  uint32_t    ThreadCount)
{
    if (!UniformBytes || !NoiseTexels || !SurfaceTexels || !PixelBytes || ThreadCount == 0) return 1;
    CloudCaptureFootprint_0 Footprint;
    std::memcpy(&Footprint, UniformBytes, sizeof(Footprint));
    std::array<float, 44> Scalars{};
    std::memcpy(Scalars.data(), UniformBytes, sizeof(Scalars));
    for (float Scalar : Scalars)
        if (!std::isfinite(Scalar) || std::abs(Scalar) > 100000000.0f) return 3;
    const auto SquaredLength = [](const auto& Direction)
    { return Direction.x * Direction.x + Direction.y * Direction.y + Direction.z * Direction.z; };
    const float CycloneAxisSquared = Scalars[40] * Scalars[40] + Scalars[41] * Scalars[41] + Scalars[42] * Scalars[42];
    if (Footprint.Selection_0.x > 2 || Footprint.Selection_0.w > 11 ||
        Footprint.FloorThicknessCoverageExtinction_0.x < 0.0f ||
        Footprint.FloorThicknessCoverageExtinction_0.y <= 0.0f ||
        Footprint.FloorThicknessCoverageExtinction_0.z < 0.0f ||
        Footprint.FloorThicknessCoverageExtinction_0.z > 1.0f ||
        Footprint.FloorThicknessCoverageExtinction_0.w < 0.0f || Footprint.ScaleSeedPhaseExposure_0.x < 0.1f ||
        Footprint.ScaleSeedPhaseExposure_0.x > 10.0f || std::abs(Footprint.ScaleSeedPhaseExposure_0.y) > 100000.0f ||
        std::abs(Footprint.OriginTime_0.w) > 604800.0f || Footprint.Cyclone_0.y < 1000.0f ||
        Footprint.SunIntensity_0.w < 0.0f || SquaredLength(Footprint.ForwardWindX_0) < 0.1f ||
        SquaredLength(Footprint.SunIntensity_0) < 0.1f || CycloneAxisSquared < 0.1f)
        return 3;
    const uint32_t Width  = Footprint.Size_0.x;
    const uint32_t Height = Footprint.Tile_0.y;
    if (Width == 0 || Width > 8192 || Height == 0 || Height > 8192 || Footprint.Size_0.y < Height ||
        Footprint.Tile_0.x > Footprint.Size_0.y - Height || Footprint.Tile_0.z == 0 || Footprint.Tile_0.z > 64 ||
        Footprint.Selection_0.y == 0 || Footprint.Selection_0.y > 4096 || Footprint.Selection_0.z == 0 ||
        Footprint.Selection_0.z > 256 || Footprint.Size_0.z == 0 || Footprint.Size_0.w == 0 ||
        size_t(Width) * Height * 16 > PixelCapacity ||
        NoiseCount != Frontier::PlanetaryCloudExperiment::CondensateNoise::TexelCount ||
        size_t(Footprint.Size_0.z) * Footprint.Size_0.w != SurfaceCount)
        return 2;
    if (Footprint.Tile_0.w > 3u || ThreadCount > 64u) return 2;
    if (Footprint.Tile_0.w == 2u)
    {
        if (Height != 1u || Footprint.Tile_0.x != 0u || SurfaceCount != size_t(Width) * 16u) return 2;
        for (uint32_t Index = 0u; Index < Width; ++Index)
        {
            std::array<float, 16> Query{};
            std::memcpy(Query.data(), SurfaceTexels + size_t(Index) * 16u, sizeof(Query));
            for (size_t ScalarIndex = 0; ScalarIndex < Query.size(); ++ScalarIndex)
            {
                const float Limit = ScalarIndex >= 8u && ScalarIndex < 12u ? 1.0e12f : 1.0e8f;
                if (!std::isfinite(Query[ScalarIndex]) || std::abs(Query[ScalarIndex]) > Limit) return 3;
            }
            const float Selection = Query[3];
            if (Selection < 0.0f || Selection > 10.0f || Selection != std::floor(Selection) || Query[7] < 0.0f)
                return 3;
            const float PositionSquared  = Query[0] * Query[0] + Query[1] * Query[1] + Query[2] * Query[2];
            const float DirectionSquared = Query[4] * Query[4] + Query[5] * Query[5] + Query[6] * Query[6];
            if (((Selection <= 1.0f || Selection == 6.0f || Selection == 7.0f) && DirectionSquared < 0.01f) ||
                ((Selection == 0.0f || (Selection >= 3.0f && Selection <= 7.0f)) && PositionSquared < 0.01f) ||
                (Selection == 0.0f && Query[8] <= 0.0f) ||
                (Selection == 1.0f && (Query[8] < 0.0f || Query[9] <= Query[8] || Query[10] <= 0.0f)) ||
                (Selection == 2.0f && (std::abs(Query[0]) > 1.0f || std::abs(Query[1]) >= 1.0f)) ||
                (Selection == 6.0f && (Query[8] <= 0.0f || Query[11] < 0.0f)) ||
                (Selection == 7.0f && Query[8] < 0.0f) ||
                ((Selection == 8.0f || Selection == 9.0f) && Query[8] <= 0.0f))
                return 3;
        }
    }
    GlobalParams_0 InputMap{};
    InputMap.PlanetaryCloudNoise_0 = {NoiseTexels, NoiseCount};
    InputMap.Capture_0             = &Footprint;
    InputMap.CloudPixels_0         = {reinterpret_cast<Vector<float, 4>*>(PixelBytes), size_t(Width) * Height};
    InputMap.PlanetSurface_0       = {SurfaceTexels, SurfaceCount};
    const uint32_t        GroupsY  = (Height + 7) / 8;
    const uint32_t        GroupsX  = (Width + 7) / 8;
    std::atomic<uint32_t> NextRow{0};
    auto                  IntegrateRows = [&]
    {
        for (uint32_t Row; (Row = NextRow.fetch_add(1, std::memory_order_relaxed)) < GroupsY;)
        {
            ComputeVaryingInput Region{{0, Row, 0}, {GroupsX, Row + 1, 1}};
            CloudCaptureEntry(&Region, nullptr, &InputMap);
        }
    };
    std::vector<std::jthread> Threads;
    for (uint32_t Index = 1; Index < std::min(ThreadCount, GroupsY); ++Index)
        Threads.emplace_back(IntegrateRows);
    IntegrateRows();
    return 0;
}
