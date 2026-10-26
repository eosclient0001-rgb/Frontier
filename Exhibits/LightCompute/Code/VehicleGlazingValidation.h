/*==========================================================================================================================================
                                                     VEHICLEGLAZINGVALIDATION.H
==========================================================================================================================================*/
// 🧩 Render retained vehicle window surfaces as validated closed panes using native saved material coefficients.

void ValidateVehicleGlazing(const char*        Driver,
                           const std::string& Shaders,
                           LightComputeArchive Scene,
                           const std::string& Output,
                           const std::string& Saved,
                           bool               Probe = false)
{
    using namespace TransportReference;
    std::filesystem::create_directories(Output);
    std::array<std::array<float,4>,4> Coefficients;
    std::ifstream Input(Saved,std::ios::binary | std::ios::ate);
    Require(Input && Input.tellg() == std::streamoff(sizeof(Coefficients)),"Missing native glazing coefficients");
    Input.seekg(0); Input.read(reinterpret_cast<char*>(Coefficients.data()),sizeof(Coefficients));
    Require(bool(Input),"Truncated native glazing coefficients");
    for (const auto &Volume : Coefficients)
    {
        Require(std::isfinite(Volume[0]) && Volume[0] >= 1 && Volume[0] <= 3,"Invalid saved glazing IOR");
        for (uint32_t C = 1; C < 4; ++C)
            Require(std::isfinite(Volume[C]) && Volume[C] >= 0 && Volume[C] <= 100,"Invalid glazing absorption");
    }
    for (auto& L : Scene.Lights)
        if (L.RadianceCategory[3] == 0) L.RadianceCategory = {5.5f,5.2f,4.7f,0};
    Prepare(Scene,16,24,true);
    const auto Materials = AppendSceneMaterials(Scene,Shaders);
    AssignVehicleSurfaces(Scene,Materials);
    SurfaceGeometry Windows;
    for (const auto &F : Scene.Surfaces)
        if (F.Emissive[3] == float(Materials[2]))
            for (const auto &P : {F.A,F.B,F.C})
            {
                SurfaceCorner Corner;
                Corner.Position = {P[0],P[1],P[2]}; Corner.Normal = {0,0,1};
                Windows.TriangleCorners.push_back(uint32_t(Windows.Corners.size()));
                Windows.Corners.push_back(Corner);
            }
    Require(Windows.TriangleCorners.size()/3 == 74,"Original glazing selection changed");
    const auto Glazing = ThickenPane(Windows,.006);
    Require(Glazing.PaneCount == 3 && Glazing.BoundaryEdges == 68 &&
            Glazing.Surface.TriangleCorners.size()/3 == 284,"Vehicle pane closure changed");
    std::cout << "GLAZING_GEOMETRY source_triangles=74 panes=" << Glazing.PaneCount
              << " closed_triangles=284 source_boundary=68 output_boundary=0 thickness_m=0.006 volume_m3="
              << Glazing.SignedVolume << std::endl;
    const auto Mirror = DuplicateSceneMaterial(Scene,Materials[3],1,{.94f,.94f,.94f,.04f},1);
    const auto Orange = DuplicateSceneMaterial(Scene,Materials[3],3,{.85f,.105f,.009f,.22f},0);
    const auto Band = DuplicateSceneMaterial(Scene,Materials[3],3,{.82f,.85f,.88f,.12f},.65f);
    MaterialCone(Scene,2.8,-2.9,Orange,Band); MaterialCone(Scene,-.4,-3.5,Orange,Band);
    for (double Side : {-1.,1.})
        MaterialRectangle(Scene,{.85,Side*1.24,1.30},{.035,Side*.17,0},{0,0,.09},Mirror,301);
    MaterialCamera(Scene,{6,-7,3.5},{0,0,1},320,200);
    RebuildMaterialVisibility(Scene);
    const auto Thin = Scene;
    Scene.Surfaces.erase(std::remove_if(Scene.Surfaces.begin(),Scene.Surfaces.end(),[&](const auto &F)
        { return F.Emissive[3] == float(Materials[2]); }),Scene.Surfaces.end());
    const auto Address = DuplicateSceneMaterial(Scene,Materials[2],4,{1,1,1,0},0);
    const auto Offset = Address-1;
    for (size_t I = 0; I < Glazing.Surface.TriangleCorners.size(); I += 3)
    {
        auto P = [&](uint32_t C)
        {
            const auto &V = Glazing.Surface.Corners[Glazing.Surface.TriangleCorners[I+C]].Position;
            return SpatialVector{V[0],V[1],V[2]};
        };
        MaterialTriangle(Scene,P(0),P(1),P(2),Address,700);
    }
    RebuildMaterialVisibility(Scene);
    LightComputeSubmission Compute(Driver);
    auto Capacity = Scene;
    Capacity.Visibility.Enclosures.resize(std::max(Capacity.Visibility.Enclosures.size(),Thin.Visibility.Enclosures.size()));
    Compute.Prepare(Capacity,Shaders);
    std::cout << "GLAZING_DEVICE name=" << Compute.Properties.deviceName << " type=" << Compute.Properties.deviceType
              << " triangle_bvh=1 hardware_ray_query=0 interaction_cap=2048" << std::endl;
    auto Render = [&](const char* Name)
    {
        const auto Pixels = Compute.Execute(Scene,0,16,71,64,0,true,true,16,true);
        WriteImage(Output+"/"+Name+".ppm",Pixels,Scene.Width,Scene.Height);
        std::cout << "GLAZING_CAPTURE name=" << Name << " width=320 height=200" << std::endl;
        return Pixels;
    };
    const auto Closed = Scene;
    if (!Probe) { Scene = Thin; Render("VehicleGlazingSheet"); Scene = Closed; }
    auto Apply = [&](uint32_t Case)
    {
        Scene.Angles[Offset+13] = Coefficients[Case][0];
        for (uint32_t C = 0; C < 3; ++C) Scene.Angles[Offset+16+C] = Coefficients[Case][C+1];
    };
    if (Probe)
    {
        Apply(3); Render("VehicleGlazingProbe");
        const auto Receivers = Compute.PrimaryReceivers();
        uint32_t Capped = 0, Unsupported = 0;
        for (uint32_t I = 0; I < Receivers.size(); ++I)
            if (Receivers[I].MotionPositionToken[3] == 700)
            {
                const auto &R = Receivers[I];
                Capped += uint32_t(R.ExpectedDirect[1])/65536; Unsupported += uint32_t(R.ExpectedDirect[2]);
                if (uint32_t(R.ExpectedDirect[1])/65536 || R.ExpectedDirect[2])
                    std::cout << "GLAZING_PROBE pixel=" << I << " capped=" << uint32_t(R.ExpectedDirect[1])/65536
                              << " tir=" << uint32_t(R.ExpectedDirect[1])%65536 << " unsupported=" << R.ExpectedDirect[2] << std::endl;
            }
        std::cout << "GLAZING_PROBE_TOTAL capped=" << Capped << " unsupported=" << Unsupported << std::endl;
        return;
    }
    Apply(2); const auto Clear = Render("VehicleGlazingClear");
    Apply(3); const auto Absorbed = Render("VehicleGlazingAbsorbed");
    const auto Repeat = Compute.Execute(Scene,0,16,71,64,0,true,true,16,true);
    Require(Repeat == Absorbed,"Vehicle glazing seeded repeat changed");
    uint32_t GlassPixels = 0, Capped = 0, Unsupported = 0, Changed = 0;
    double Maximum = 0, Decrease = 0;
    const auto Receivers = Compute.PrimaryReceivers();
    for (uint32_t I = 0; I < Receivers.size(); ++I)
    {
        for (uint32_t C = 0; C < 3; ++C)
            Require(std::isfinite(Absorbed[I][C]) && Absorbed[I][C] >= 0,"Invalid vehicle radiance");
        if (Receivers[I].MotionPositionToken[3] != 700) continue;
        ++GlassPixels;
        Capped += uint32_t(Receivers[I].ExpectedDirect[1])/65536;
        Unsupported += uint32_t(Receivers[I].ExpectedDirect[2]);
        for (uint32_t C = 0; C < 3; ++C)
        {
            Require(Absorbed[I][C] <= Clear[I][C]+1e-5,"Absorption increased primary glass radiance");
            const double Delta = Clear[I][C]-Absorbed[I][C];
            Changed += Delta > 1e-5; Maximum = std::max(Maximum,Delta); Decrease += Delta;
        }
    }
    std::cout << "GLAZING_RENDER glass_pixels=" << GlassPixels << " changed_channels=" << Changed
              << " max_decrease=" << Maximum << " total_decrease=" << Decrease << " capped=" << Capped
              << " unsupported=" << Unsupported << " repeat_exact=1" << std::endl;
    Require(GlassPixels > 100 && Changed > 100 && !Capped && !Unsupported,"Vehicle glass acceptance failed");
    MaterialCamera(Scene,{5.8,-6.8,3.4},{0,0,1},320,200);
    const auto Moved = Compute.Execute(Scene,0,16,72,64,0,false,true,16,true);
    const auto Cold = Compute.Execute(Scene,0,16,72,64,0,true,true,16,true);
    Require(Moved == Cold,"Moved glazing camera differs from cold transport");
    WriteImage(Output+"/VehicleGlazingMoved.ppm",Moved,Scene.Width,Scene.Height);
    std::cout << "GLAZING_MOTION camera_moved=1 cold_equal=1 fresh_transport=1" << std::endl;
    for (auto &F : Scene.Surfaces) F.Emissive[0] = F.Emissive[1] = F.Emissive[2] = 0;
    for (auto &L : Scene.Lights) L.PeakActive[1] = 0;
    Scene.Camera[10][3] = 0;
    const auto Black = Compute.Execute(Scene,0,16,71,64,0,false,true,16,true);
    for (const auto &P : Black) Require(P[0] == 0 && P[1] == 0 && P[2] == 0,"Vehicle glass retained a removed source");
    std::cout << "GLAZING_RESET all_sources_off_black=1 pixels=" << Black.size() << std::endl;
}
