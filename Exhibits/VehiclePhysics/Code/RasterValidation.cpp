/*============================================================================================================================================
                                                          RASTERVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Cheap vehicle rasterization: shadow isolation, ground coverage, highlight encoding and matched timing

#define main SceneRenderEntry
#ifndef RASTER_SOURCE
#define RASTER_SOURCE "SceneRender.cpp"
#endif
#include RASTER_SOURCE
#undef main

#include <chrono>

//------------------------------------------------------------------------------------------------------------------------
//                                                    VALIDATION AND TIMING
//------------------------------------------------------------------------------------------------------------------------

int main(int Argc, char** Argv)
{
    if (Argc != 3) return 2;
    int Failed = 0;
    const auto Check = [&](const char* Label, bool Accepted)
    {
        std::printf("%s %s\n", Accepted ? "PASS" : "FAIL", Label);
        if (!Accepted) ++Failed;
    };
#ifndef RASTER_BASELINE
    Renderer Ground;
    Ground.Init(320, 180);
    Ground.Cam = LookAt({ 0, -5, 4 }, {}, 42.0f, 320.0f / 180.0f);
    Ground.SunDir = { 0, 0, 1 };
    Ground.Background();
    Ground.GroundPlane();
    bool Covered = true, Reprojected = true;
    for (int Row = 0; Row < Ground.H; ++Row)
    {
        for (int X = 0; X < Ground.W; ++X)
        {
            const size_t Index = (size_t)Row * Ground.W + X;
            Covered = Covered && Ground.Depth[Index] < 1e20f && Ground.WorldPos[Index].Z == 0.0f;
            float Sx, Sy;
            Ground.Project(Ground.WorldPos[Index], Sx, Sy);
            Reprojected = Reprojected && std::fabs(Sx - X - 0.5f) < 0.002f
                && std::fabs(Sy - (Ground.H - Row - 0.5f)) < 0.002f;
        }
    }
    Check("downward view: ground has no near-camera holes", Covered);
    Check("ground ray intersections reproject to pixel centres", Reprojected);
    const size_t Centre = (size_t)90 * 320 + 160;
    const F3 CentreWorld = Ground.WorldPos[Centre];
    const F3 Expected = Ground.Shade(Ground.GroundAlbedo(CentreWorld), 0.9f, 0.0f, {}, { 0, 0, 1 }, CentreWorld, 0.0f);
    Ground.ShadowTriangle({ -2, -2, 1 }, { 2, -2, 1 }, { 0, 2, 1 });
    Check("shadow preserves sky fill and haze", std::fabs(Ground.Colour[Centre * 3] - Expected.X) < 1e-6f
        && std::fabs(Ground.Colour[Centre * 3 + 1] - Expected.Y) < 1e-6f
        && std::fabs(Ground.Colour[Centre * 3 + 2] - Expected.Z) < 1e-6f);
    const auto Once = Ground.Colour;
    Ground.ShadowTriangle({ -2, -2, 1 }, { 2, -2, 1 }, { 0, 2, 1 });
    Check("overlapping casters do not multiply shadow darkness", Once == Ground.Colour);
    Ground.SunDir = { 1, 0, 0 };
    Ground.ShadowTriangle({ -2, -2, 1 }, { 2, -2, 1 }, { 0, 2, 1 });
    Check("horizon sun cannot divide by zero in projection", Once == Ground.Colour);
    const F3 Lamp = Ground.Shade({}, 1.0f, 0.0f, { 2, 1, 0.5f }, { 0, 0, -1 }, CentreWorld, 0.0f);
    Check("occlusion retains lamp radiance", Lamp.X > Lamp.Y && Lamp.Y > Lamp.Z && Lamp.Z > 0.4f);
    Renderer Ramp;
    Ramp.Init(8, 1);
    for (int X = 0; X < 8; ++X)
        for (int C = 0; C < 3; ++C) Ramp.Colour[X * 3 + C] = (float)(1 << X);
    const std::string RampPath = std::string(Argv[1]) + "/HighlightRamp.ppm";
    Check("highlight ramp writes", Ramp.WritePpm(RampPath));
    std::FILE* RampFile = std::fopen(RampPath.c_str(), "rb");
    bool HighlightSeparated = RampFile != nullptr;
    if (RampFile)
    {
        int Width, Height, Max;
        const int Parsed = std::fscanf(RampFile, "P6\n%d %d\n%d\n", &Width, &Height, &Max);
        unsigned char Bytes[24] = {};
        const size_t Read = std::fread(Bytes, 1, sizeof Bytes, RampFile);
        HighlightSeparated = Parsed == 3 && Read == sizeof Bytes && Bytes[0] < Bytes[3]
            && Bytes[3] < Bytes[6] && Bytes[6] < Bytes[9] && Bytes[9] < 255;
        std::fclose(RampFile);
    }
    Check("1, 2, 4, 8 linear highlights remain distinct, not clipped", HighlightSeparated);
#endif
    VehicleMeshes Geometry;
    if (!LoadVehicle(Argv[2], Geometry)) return 1;
    VehicleSolver Car;
    const double Spawn[3] = { 0, 0, 0.55 };
    Car.Respawn(Spawn, -0.55);
    for (int S = 0; S < 300; ++S) Car.Advance({}, 1.0 / 120.0);
    std::vector<F3> BodyWorld;
    WheelRenderState Wheels[4];
    PoseVehicle(Car, Geometry, BodyWorld, Wheels);
    Renderer R;
    R.Init(1600, 900);
    R.Cam = LookAt({ 5.6f, -5.4f, 1.55f }, { 0.1f, 0, 0.42f }, 42.0f, 1600.0f / 900.0f);
    const float NoHeat[4] = {};
    std::vector<double> Milliseconds;
    for (int Repeat = 0; Repeat < 15; ++Repeat)
    {
        const auto Begin = std::chrono::steady_clock::now();
        R.Background();
        R.GroundPlane();
        RenderVehicle(R, Geometry, BodyWorld, Wheels, false, NoHeat);
        const auto End = std::chrono::steady_clock::now();
        const double Elapsed = std::chrono::duration<double, std::milli>(End - Begin).count();
        if (Repeat >= 3) Milliseconds.push_back(Elapsed);
        std::printf("TIMING %d %.6f ms\n", Repeat, Elapsed);
    }
    std::sort(Milliseconds.begin(), Milliseconds.end());
    std::printf("MEDIAN %.6f ms (12 samples after 3 warmups, 1600x900, no file IO or simulation)\n",
        0.5 * (Milliseconds[5] + Milliseconds[6]));
    Check("hero capture writes", R.WritePpm(std::string(Argv[1]) + "/Hero.ppm"));
    bool Finite = true;
    for (float C : R.Colour) Finite = Finite && std::isfinite(C) && C >= 0.0f;
    Check("actual vehicle HDR pixels finite and nonnegative", Finite);
    std::printf("SUMMARY failed %d\n", Failed);
    return Failed ? 1 : 0;
}
