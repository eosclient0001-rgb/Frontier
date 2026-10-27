/*==========================================================================================================================================
                                                REPLAYMOTIONVALIDATION.H
==========================================================================================================================================*/
// 🧩 Inspect primary-ray camera reprojection and path-reservoir acceptance.
#pragma once

namespace
{
LightComputeArchive ReplayMotionCamera(float Shift)
{
    auto Scene = ReplayRoom(7);
    Scene.Width = 96; Scene.Height = 96;
    Scene.Receivers.resize(size_t(Scene.Width) * Scene.Height);
    Scene.Camera[2][3] = Scene.Camera[3][3];
    for (uint32_t I = 0; I < 4; ++I) Scene.Camera[4+I] = Scene.Camera[I];
    Scene.Camera[0][0] += Shift;
    return Scene;
}
void ValidateReplayMotion(const char* Driver, const std::string& Shaders)
{
    const auto Previous = ReplayMotionCamera(0), Current = ReplayMotionCamera(.07f);
    LightComputeSubmission Compute(Driver);
    Compute.Prepare(Previous, Shaders, false, false, false, false, true);
    for (uint32_t Frame = 0; Frame < 8; ++Frame)
        (void)Compute.ExecuteReplay(Previous, 1, 41000 + Frame, true, false, Frame == 0,
                                    {.025f,.025f,.025f}, .01f, true, false, false, true);
    (void)Compute.ExecuteReplay(Current, 1, 41010, true, false, false,
                                {.025f,.025f,.025f}, .01f, true, false, false, true);
    const auto Counts = Compute.ExtendedStatistics();
    std::printf("MOTION_BASELINE camera_shift=.07 hits=%u accepted=%u rejected=%u reset=%u history_cap=%u\n",
                Counts[10], Counts[20], Counts[21], Compute.ReplayLastReset ? 1u : 0u, Compute.ReplayLastHistoryCap);
    Require(Counts[10] > 0 && !Compute.ReplayLastReset && Counts[20] < Counts[10] / 20,
            "Exact position comparison did not reproduce the camera-motion rejection");
    std::printf("PASS reproduced exact-position reprojection limitation; no fix claimed\n");
}
} // namespace
