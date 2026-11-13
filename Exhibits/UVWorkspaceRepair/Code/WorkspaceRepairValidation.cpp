/*============================================================================================================================================
                                                     WORKSPACEREPAIRVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Production Vulkan visibility, finish, camera, input, and native UV workspace interaction validation

#include "Engine/Components/Appearance/TypographyRepository.h"
#include "Engine/Components/Docking/WorkspaceDockContainer.h"
#include "Engine/Editor/Viewports/ViewportProjection.h"
#include "Engine/GeometricRaster/UV/UVWorkspaceRasterizer.h"
#include "Engine/Workspaces/UV/UVWorkspaceHost.h"
#include "Exhibits/SoftwareCanvasRasterizer.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <limits>
#include <set>
#include <string>
#include <vector>

namespace
{

using namespace Frontier;
using namespace Frontier::Mathematics;

uint32_t AssertionCount = 0u;
uint32_t FailureCount   = 0u;

bool Verify(bool Condition, const char* Description)
{
    ++AssertionCount;
    if (!Condition) ++FailureCount;
    std::printf("[%s] %s\n", Condition ? "PASS" : "FAIL", Description);
    return Condition;
}

Axis3D Unpack(GPUAxis4 Packed)
{
    return { Packed.X, Packed.Y, Packed.Z };
}

float IntersectTriangle(const Editor::ViewportRay3D& Ray, const Editor::GizmoGPUVertex* Triangle)
{
    const Axis3D Origin = Unpack(Triangle[0].PositionAndAlpha);
    const Axis3D EdgeU  = Unpack(Triangle[1].PositionAndAlpha) - Origin;
    const Axis3D EdgeV  = Unpack(Triangle[2].PositionAndAlpha) - Origin;
    const Axis3D Cross  = EvaluateCross(Ray.Direction, EdgeV);
    const float  Det   = EvaluateDot(EdgeU, Cross);
    if (std::abs(Det) < 1.0e-8f) return std::numeric_limits<float>::max();
    const Axis3D Offset = Ray.Origin - Origin;
    const float  U      = EvaluateDot(Offset, Cross) / Det;
    const Axis3D CrossV = EvaluateCross(Offset, EdgeU);
    const float  V      = EvaluateDot(Ray.Direction, CrossV) / Det;
    const float  T      = EvaluateDot(EdgeV, CrossV) / Det;
    return U >= 0.0f && V >= 0.0f && U + V <= 1.0f && T > 0.0f ? T : std::numeric_limits<float>::max();
}

bool CaptureRGBA(const std::filesystem::path& Path, const std::vector<uint8_t>& Pixels, uint32_t Width, uint32_t Height)
{
    Exhibits::SoftwareRasterCanvas Canvas(Width, Height, { 14, 14, 16, 255 });
    Canvas.BlitRgbaRegion(0u, 0u, Width, Height, Pixels.data());
    return Verify(Canvas.WritePngFile(Path), Path.filename().string().c_str());
}

GeometrySpace::PolygonNetwork ConstructFacingQuad(const Editor::ViewportProjection& Projection, float HalfExtent)
{
    Axis3D Right {}, Up {}, Forward {};
    Projection.EvaluateCameraBasis(Right, Up, Forward);
    GeometrySpace::PolygonNetwork Network {};
    for (const Axis3D Position : std::array<Axis3D, 4u>{{
        -Right * HalfExtent - Up * HalfExtent, Right * HalfExtent - Up * HalfExtent,
        Right * HalfExtent + Up * HalfExtent, -Right * HalfExtent + Up * HalfExtent }})
    {
        (void)Network.AppendVertex(Position);
    }
    const std::array<uint32_t, 4u> Corners {{ 0u, 1u, 2u, 3u }};
    const std::array<UVAxes, 4u> Parameters {{ { 0, 0 }, { 1, 0 }, { 1, 1 }, { 0, 1 } }};
    (void)Network.AppendFace(Corners, Parameters);
    Network.RecomputeNormals();
    return Network;
}

void ValidateGizmoVisibility(GeometricRaster::UVWorkspaceRasterizer& Rasterizer, const std::filesystem::path& Images)
{
    constexpr uint32_t Extent = 480u;
    Editor::ViewportProjection Projection {};
    Editor::SpatialCameraRig Camera {};
    Camera.TargetPivot = {};
    Camera.YawRadians = 0.71f;
    Camera.PitchRadians = 0.37f;
    Camera.DistanceMeters = 3.4f;
    Projection.ConfigureSpatialCamera(Camera);
    auto Network = ConstructFacingQuad(Projection, 0.01f);
    Verify(Rasterizer.UploadPolygonNetwork(Network, 1u), "upload gizmo visibility fixture");
    Editor::TransformGizmo Gizmo {};
    Gizmo.ConfigureAnchor({}, 1.0f);
    Axis3D Right {}, Up {}, Forward {};
    Projection.EvaluateCameraBasis(Right, Up, Forward);
    const auto Triangles = Gizmo.BuildTriangleStream(Right, Up, Forward);
    uint32_t InvertedCount = 0u;
    uint32_t ShadedCount = 0u;
    for (std::size_t Index = 0u; Index + 2u < Triangles.size(); Index += 3u)
    {
        if (Triangles[Index].ColorRGBAndShaded.W < 0.9f) continue;
        ++ShadedCount;
        const Axis3D Winding = EvaluateCross(
            Unpack(Triangles[Index + 1u].PositionAndAlpha) - Unpack(Triangles[Index].PositionAndAlpha),
            Unpack(Triangles[Index + 2u].PositionAndAlpha) - Unpack(Triangles[Index].PositionAndAlpha));
        if (EvaluateDot(Winding, Unpack(Triangles[Index].NormalAndHandle)) < -1.0e-9f) ++InvertedCount;
    }
    std::printf("MEASURE GizmoShadedTriangles=%u InvertedTriangles=%u\n", ShadedCount, InvertedCount);
    Verify(ShadedCount > 100u && InvertedCount == 0u, "gizmo winding agrees with outward shading normals");
    GeometricRaster::Viewport3DRenderOptions Options {};
    Options.Camera.TargetPivot = Camera.TargetPivot;
    Options.Camera.YawRadians = Camera.YawRadians;
    Options.Camera.PitchRadians = Camera.PitchRadians;
    Options.Camera.DistanceMeters = Camera.DistanceMeters;
    Options.Camera.VerticalFovDeg = Camera.VerticalFovDeg;
    Options.GroundGridEnabled = false;
    Options.WireframeEnabled = false;
    std::vector<uint8_t> Pixels {};
    Verify(Rasterizer.Rasterize3DViewport(Extent, Extent, Options, &Gizmo, &Pixels), "rasterize actual 3D gizmo");
    CaptureRGBA(Images / "Gizmo.png", Pixels, Extent, Extent);
    uint32_t NearestCount = 0u;
    uint32_t MatchingCount = 0u;
    const Axis3D Light = NormalizeAxis({ 0.45f, 0.72f, 0.52f });
    for (uint32_t Y = 2u; Y < Extent; Y += 3u)
    {
        for (uint32_t X = 2u; X < Extent; X += 3u)
        {
            const auto Ray = Projection.BuildSpatialRay(Extent, Extent, X + 0.5f, Y + 0.5f);
            float Nearest = std::numeric_limits<float>::max();
            const Editor::GizmoGPUVertex* Hit = nullptr;
            for (std::size_t Index = 0u; Index + 2u < Triangles.size(); Index += 3u)
            {
                const float Distance = IntersectTriangle(Ray, &Triangles[Index]);
                if (Distance < Nearest)
                {
                    Nearest = Distance;
                    Hit = &Triangles[Index];
                }
            }
            if (Hit == nullptr || Hit->ColorRGBAndShaded.W < 0.9f || Hit->PositionAndAlpha.W < 0.95f) continue;
            ++NearestCount;
            const float Lambert = 0.62f + 0.38f * std::clamp(EvaluateDot(
                NormalizeAxis(Unpack(Hit->NormalAndHandle) + Axis3D{ 0, 0, 1.0e-5f }), Light), 0.0f, 1.0f);
            const Axis3D Expected = Unpack(Hit->ColorRGBAndShaded) * Lambert;
            const std::size_t Offset = (Y * Extent + X) * 4u;
            if (std::abs(Pixels[Offset] - Expected.X * 255.0f) <= 2.0f &&
                std::abs(Pixels[Offset + 1u] - Expected.Y * 255.0f) <= 2.0f &&
                std::abs(Pixels[Offset + 2u] - Expected.Z * 255.0f) <= 2.0f) ++MatchingCount;
        }
    }
    std::printf("MEASURE GizmoNearestSamples=%u MatchingSamples=%u\n", NearestCount, MatchingCount);
    Verify(NearestCount > 40u && MatchingCount > NearestCount * 0.96f,
        "visible solid gizmo pixels use the nearest facet, not the last submitted rear facet");
}

void ValidateFinishes(GeometricRaster::UVWorkspaceRasterizer& Rasterizer, const std::filesystem::path& Images)
{
    constexpr uint32_t Extent = 320u;
    Editor::ViewportProjection Projection {};
    Editor::SpatialCameraRig Camera {};
    Camera.TargetPivot = {};
    Camera.DistanceMeters = 3.4f;
    Projection.ConfigureSpatialCamera(Camera);
    auto Network = ConstructFacingQuad(Projection, 1.0f);
    GeometricRaster::Viewport3DRenderOptions Options {};
    Options.Camera.TargetPivot = Camera.TargetPivot;
    Options.Camera.DistanceMeters = Camera.DistanceMeters;
    Options.Camera.YawRadians = Camera.YawRadians;
    Options.Camera.PitchRadians = Camera.PitchRadians;
    Options.Camera.VerticalFovDeg = Camera.VerticalFovDeg;
    Options.GroundGridEnabled = false;
    Options.WireframeEnabled = false;
    Options.DisplayMode = GeometricRaster::SurfaceDisplayMode::MatCapPreview;
    for (const uint8_t Slot : std::array<uint8_t, 5u>{{ 7u, 10u, 11u, 12u, 13u }})
    {
        Network.Faces[0].Shading.MatCapSlot = Slot;
        Verify(Rasterizer.UploadPolygonNetwork(Network, 1u), "upload MatCap assignment");
        std::vector<uint8_t> Pixels {};
        Verify(Rasterizer.Rasterize3DViewport(Extent, Extent, Options, nullptr, &Pixels), "render MatCap finish fixture");
        std::set<uint32_t> DistinctColors {};
        for (uint32_t Y = 90u; Y < 230u; ++Y)
        {
            for (uint32_t X = 90u; X < 230u; ++X)
            {
                const std::size_t Offset = (Y * Extent + X) * 4u;
                DistinctColors.insert(Pixels[Offset] | (Pixels[Offset + 1u] << 8u) | (Pixels[Offset + 2u] << 16u));
            }
        }
        std::printf("MEASURE MatCapSlot=%u DistinctFlatSurfaceColors=%zu\n", Slot, DistinctColors.size());
        Verify(DistinctColors.size() > 30u, "MatCap finish has visible variation on a flat panel");
        CaptureRGBA(Images / ("MatCap" + std::to_string(Slot) + ".png"), Pixels, Extent, Extent);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                               PROJECTION & DAMPING CONTRACTS
//------------------------------------------------------------------------------------------------------------------------

void ValidateProjectionAndDamping(GeometricRaster::UVWorkspaceRasterizer& Rasterizer)
{
    Editor::ViewportProjection Projection {};
    Axis3D Right {}, Up {}, Forward {};
    Projection.EvaluateCameraBasis(Right, Up, Forward);
    Verify(Up.Y > 0.9f && EvaluateDot(EvaluateCross(Right, Up), -Forward) > 0.999f,
        "Y-up camera basis is orthonormal and right-handed");
    Projection.ApplySpatialPreset(Editor::SpatialProjectionPreset::Top);
    const auto TopRay = Projection.BuildSpatialRay(400u, 400u, 200.0f, 200.0f);
    Verify(TopRay.Direction.Y < -0.9999f, "Top preset looks exactly down negative Y, not a tilted Z-up view");
    Projection.ApplySpatialPreset(Editor::SpatialProjectionPreset::Front);
    const auto FrontRay = Projection.BuildSpatialRay(400u, 400u, 200.0f, 200.0f);
    Verify(FrontRay.Direction.Z < -0.9999f, "Front preset looks down negative Z");
    Projection.ApplySpatialPreset(Editor::SpatialProjectionPreset::Right);
    const auto RightRay = Projection.BuildSpatialRay(400u, 400u, 200.0f, 200.0f);
    Verify(RightRay.Direction.X < -0.9999f, "Right preset looks down negative X");
    const auto OrthoLeft = Projection.BuildSpatialRay(400u, 400u, 70.0f, 150.0f);
    const auto OrthoRight = Projection.BuildSpatialRay(400u, 400u, 330.0f, 150.0f);
    Verify(EvaluateDistance(OrthoLeft.Direction, OrthoRight.Direction) < 1.0e-6f &&
        EvaluateDistance(OrthoLeft.Origin, OrthoRight.Origin) > 0.5f,
        "orthographic CPU rays are parallel with distinct origins");
    Projection.ApplySpatialPreset(Editor::SpatialProjectionPreset::Perspective);
    const auto PerspectiveLeft = Projection.BuildSpatialRay(400u, 400u, 70.0f, 150.0f);
    const auto PerspectiveRight = Projection.BuildSpatialRay(400u, 400u, 330.0f, 150.0f);
    Verify(EvaluateDistance(PerspectiveLeft.Origin, PerspectiveRight.Origin) < 1.0e-6f &&
        EvaluateDistance(PerspectiveLeft.Direction, PerspectiveRight.Direction) > 0.1f,
        "perspective CPU rays share an eye and diverge across the image");
    Editor::ViewportProjection SixtyHz {}, OneTwentyHz {};
    for (auto* Camera : { &SixtyHz, &OneTwentyHz })
    {
        Camera->ConfigureCameraLag(true, 0.075f);
        Camera->DollySpatialCamera(0.5f);
        Camera->OrbitSpatialCamera(0.25f, -0.1f);
        Camera->PanSpatialCamera(0.2f, 0.1f);
    }
    for (uint32_t Index = 0u; Index < 15u; ++Index) (void)SixtyHz.AdvanceCameraMotion(1.0 / 60.0);
    for (uint32_t Index = 0u; Index < 30u; ++Index) (void)OneTwentyHz.AdvanceCameraMotion(1.0 / 120.0);
    const auto& Sixty = SixtyHz.InspectDisplayedSpatialCamera();
    const auto& OneTwenty = OneTwentyHz.InspectDisplayedSpatialCamera();
    Verify(std::abs(Sixty.DistanceMeters - OneTwenty.DistanceMeters) < 1.0e-5f &&
        std::abs(Sixty.YawRadians - OneTwenty.YawRadians) < 1.0e-5f &&
        EvaluateDistance(Sixty.TargetPivot, OneTwenty.TargetPivot) < 1.0e-5f,
        "exponential camera lag is invariant between 60 Hz and 120 Hz at equal elapsed time");
    const auto BeforeInvalidStep = SixtyHz.InspectDisplayedSpatialCamera();
    Verify(!SixtyHz.AdvanceCameraMotion(std::numeric_limits<double>::quiet_NaN()) &&
        EvaluateDistance(BeforeInvalidStep.TargetPivot, SixtyHz.InspectDisplayedSpatialCamera().TargetPivot) == 0.0f,
        "non-finite frame duration cannot corrupt or advance the camera");
    Editor::ViewportProjection Narrow {}, Wide {};
    Narrow.FitSpatialExtents({ -3.0f, 0.0f, -1.0f }, { 3.0f, 2.0f, 1.0f }, 0.5f);
    Wide.FitSpatialExtents({ -3.0f, 0.0f, -1.0f }, { 3.0f, 2.0f, 1.0f }, 1.5f);
    Verify(Narrow.InspectSpatialCamera().DistanceMeters > Wide.InspectSpatialCamera().DistanceMeters * 1.8f,
        "framing accounts for horizontal FOV in tall split viewports");

    Editor::SpatialCameraRig Camera {};
    Camera.TargetPivot = {};
    Camera.YawRadians = 0.0f;
    Camera.PitchRadians = 0.0f;
    Camera.DistanceMeters = 3.0f;
    Camera.Preset = Editor::SpatialProjectionPreset::Front;
    Projection.ConfigureSpatialCamera(Camera);
    auto Network = ConstructFacingQuad(Projection, 0.8f);
    GeometricRaster::Viewport3DRenderOptions Options {};
    Options.Camera.TargetPivot = {};
    Options.Camera.YawRadians = 0.0f;
    Options.Camera.PitchRadians = 0.0f;
    Options.Camera.DistanceMeters = Camera.DistanceMeters;
    Options.Camera.VerticalFovDeg = Camera.VerticalFovDeg;
    Options.Camera.Orthographic = true;
    Options.GroundGridEnabled = false;
    Options.WireframeEnabled = false;
    Options.RenderGizmo = false;
    Verify(Rasterizer.UploadPolygonNetwork(Network, 1u) &&
        Rasterizer.Rasterize3DViewport(320u, 320u, Options), "render actual orthographic picking fixture");
    uint32_t Matching = 0u;
    uint32_t Samples = 0u;
    for (uint32_t Y = 20u; Y < 320u; Y += 35u)
    {
        for (uint32_t X = 20u; X < 320u; X += 35u)
        {
            const auto Ray = Projection.BuildSpatialRay(320u, 320u, X + 0.5f, Y + 0.5f);
            const auto VulkanRay = GeometricRaster::UVWorkspaceRasterizer::ConstructCameraRay3D(
                Options.Camera, 320u, 320u, X + 0.5f, Y + 0.5f);
            const bool Inside = std::abs(Ray.Origin.X) < 0.8f && std::abs(Ray.Origin.Y) < 0.8f;
            const auto Hit = Rasterizer.Pick3DPixel(static_cast<int32_t>(X), static_cast<int32_t>(Y));
            ++Samples;
            if (Inside == Hit.HitSurfaceFace() && EvaluateDistance(Ray.Direction, VulkanRay.Direction) < 1.0e-5f &&
                EvaluateDistance(Ray.Origin, VulkanRay.Origin) < 1.0e-5f) ++Matching;
        }
    }
    std::printf("MEASURE OrthographicRayPickAgreement=%u/%u\n", Matching, Samples);
    Verify(Matching == Samples, "editor/rasterizer orthographic rays and actual Vulkan visibility agree at every sampled pixel");
}

//------------------------------------------------------------------------------------------------------------------------
//                                               MATERIAL & MATCAP SENSITIVITY
//------------------------------------------------------------------------------------------------------------------------

void ValidateMaterialResponse(GeometricRaster::UVWorkspaceRasterizer& Rasterizer, const std::filesystem::path& Images)
{
    Editor::ViewportProjection Projection {};
    Editor::SpatialCameraRig Camera {};
    Camera.TargetPivot = {};
    Camera.DistanceMeters = 3.4f;
    Projection.ConfigureSpatialCamera(Camera);
    auto Network = ConstructFacingQuad(Projection, 1.0f);
    auto& Finish = Network.Faces.front().Shading;
    Finish.AlbedoLinearRGB = { 0.20f, 0.36f, 0.58f };
    Finish.MatCapBlend = 0.0f;
    GeometricRaster::Viewport3DRenderOptions Options {};
    Options.Camera.TargetPivot = {};
    Options.Camera.DistanceMeters = Camera.DistanceMeters;
    Options.GroundGridEnabled = false;
    Options.WireframeEnabled = false;
    Options.RenderGizmo = false;
    Options.DisplayMode = GeometricRaster::SurfaceDisplayMode::SurfaceMaterial;
    for (uint32_t Component = 0u; Component < 3u; ++Component)
    {
        std::array<std::vector<uint8_t>, 2u> Pixels {};
        for (uint32_t Endpoint = 0u; Endpoint < 2u; ++Endpoint)
        {
            Finish.Metallic = Component == 0u ? static_cast<float>(Endpoint) : 0.0f;
            Finish.Roughness = Component == 1u ? (Endpoint ? 0.9f : 0.08f) : 0.3f;
            Finish.Specular = Component == 2u ? static_cast<float>(Endpoint) : 0.68f;
            (void)Rasterizer.UploadPolygonNetwork(Network, 1u);
            (void)Rasterizer.Rasterize3DViewport(320u, 320u, Options, nullptr, &Pixels[Endpoint]);
        }
        double Difference = 0.0;
        uint32_t Changed = 0u;
        for (uint32_t Y = 90u; Y < 230u; ++Y)
        {
            for (uint32_t X = 90u; X < 230u; ++X)
            {
                const std::size_t Offset = (Y * 320u + X) * 4u;
                for (uint32_t Channel = 0u; Channel < 3u; ++Channel)
                {
                    const float Delta = std::abs(static_cast<float>(Pixels[0][Offset + Channel]) - Pixels[1][Offset + Channel]);
                    Difference += Delta;
                    if (Delta > 0.0f) ++Changed;
                }
            }
        }
        std::printf("MEASURE MaterialComponent=%u MeanCentralChannelDifference=%.6f ChangedChannels=%u\n",
            Component, Difference / (140.0 * 140.0 * 3.0), Changed);
        Verify(Changed > 1000u && Difference > 140.0 * 140.0 * 3.0,
            "roughness, metallic and dielectric specular each produce a measurable visible material response");
        CaptureRGBA(Images / ("Material" + std::to_string(Component) + "Low.png"), Pixels[0], 320u, 320u);
        CaptureRGBA(Images / ("Material" + std::to_string(Component) + "High.png"), Pixels[1], 320u, 320u);
    }
    std::set<uint64_t> SlotFingerprints {};
    Options.DisplayMode = GeometricRaster::SurfaceDisplayMode::MatCapPreview;
    for (uint8_t Slot = 0u; Slot < 16u; ++Slot)
    {
        Finish.MatCapSlot = Slot;
        (void)Rasterizer.UploadPolygonNetwork(Network, 1u);
        std::vector<uint8_t> Pixels {};
        if (!Rasterizer.Rasterize3DViewport(320u, 320u, Options, nullptr, &Pixels)) continue;
        uint64_t Fingerprint = 1469598103934665603ull;
        for (const uint8_t Channel : Pixels)
        {
            Fingerprint ^= Channel;
            Fingerprint *= 1099511628211ull;
        }
        SlotFingerprints.insert(Fingerprint);
    }
    Verify(SlotFingerprints.size() == 16u, "all sixteen per-face MatCap assignments render distinct production images");
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const bool Baseline = ArgumentCount > 1 && std::string(Arguments[1]) == "--baseline";
    const std::filesystem::path Root = Frontier::Exhibits::ResolveRepositoryRootPath();
    const auto Images = Root / "Exhibits/UVWorkspaceRepair/Images" / (Baseline ? "Before" : "After");
    std::filesystem::create_directories(Images);
    Frontier::GeometricRaster::VulkanInterchange Device {};
    std::string Diagnostic {};
    if (!Verify(Device.InitializeInterchange(Root, &Diagnostic), "initialize production Vulkan device")) return 1;
    Frontier::GeometricRaster::UVWorkspaceRasterizer Rasterizer {};
    if (!Verify(Rasterizer.InitializeRasterizer(&Device, FRONTIER_COMPILED_SHADER_DIR), "initialize production rasterizer")) return 1;
    ValidateGizmoVisibility(Rasterizer, Images);
    ValidateFinishes(Rasterizer, Images);
    if (!Baseline)
    {
        ValidateProjectionAndDamping(Rasterizer);
        ValidateMaterialResponse(Rasterizer, Images);
    }
    Rasterizer.TeardownRasterizer();
    std::printf("WorkspaceRepairValidation: %u/%u assertions passed%s\n", AssertionCount - FailureCount,
        AssertionCount, Baseline ? " (negative-control baseline)" : "");
    return FailureCount == 0u || Baseline ? 0 : 1;
}
