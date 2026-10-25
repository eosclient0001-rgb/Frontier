/*==========================================================================================================================================
                                                   SOLIDDIELECTRICVALIDATION.H
==========================================================================================================================================*/
// 🧩 Trace outward-wound closed slabs, compare uniform emission with analytic slab transport and capture checker displacement.
void ValidateSolidDielectric(const char* Driver, const std::string& Shaders, const std::string& Output)
{
    using namespace TransportReference;
    std::filesystem::create_directories(Output);
    LightComputeArchive Scene;
    Prepare(Scene,128,4,false);
    auto Materials = AppendSceneMaterials(Scene,Shaders);
    uint32_t Address = DuplicateSceneMaterial(Scene,Materials[3],4,{1,1,1,0},0), Offset = Address-1;
    Scene.Angles[Offset+13] = 1.5f;
    MaterialRectangle(Scene,{0,-.5,1},{1,0,0},{0,0,1},Address,1100);
    MaterialRectangle(Scene,{0,.5,1},{-1,0,0},{0,0,1},Address,1100);
    MaterialRectangle(Scene,{1,0,1},{0,.5,0},{0,0,1},Address,1100);
    MaterialRectangle(Scene,{-1,0,1},{0,-.5,0},{0,0,1},Address,1100);
    MaterialRectangle(Scene,{0,0,2},{1,0,0},{0,.5,0},Address,1100);
    MaterialRectangle(Scene,{0,0,0},{1,0,0},{0,-.5,0},Address,1100);
    for (uint32_t Z = 0; Z < 12; ++Z)
        for (uint32_t X = 0; X < 20; ++X)
        {
            MaterialRectangle(Scene,{-3.8+X*.4,2,-1.2+Z*.4},{.2,0,0},{0,0,.2},0,1200+X+Z*20);
            for (size_t I = Scene.Surfaces.size()-2; I < Scene.Surfaces.size(); ++I) Scene.Surfaces[I].Emissive = {1,1,1,0};
        }
    RebuildMaterialVisibility(Scene);
    MaterialCamera(Scene,{0,-4,1},{0,0,1},96,64);
    Scene.Camera[8][2] = 1e9f;
    LightComputeSubmission Compute(Driver);
    Compute.Prepare(Scene,Shaders);
    std::cout << "SOLID_DEVICE name=" << Compute.Properties.deviceName << " type=" << Compute.Properties.deviceType << std::endl;
    for (uint32_t Case = 0; Case < 4; ++Case)
    {
        double Ior = Case < 2 ? 1 : 1.5;
        std::array<double,3> Sigma = Case%2 ? std::array<double,3>{.2,.6,1.2} : std::array<double,3>{0,0,0};
        Scene.Angles[Offset+13] = float(Ior);
        for (uint32_t C = 0; C < 3; ++C) Scene.Angles[Offset+16+C] = float(Sigma[C]);
        auto Pixels = Compute.Execute(Scene,0,16,71,64,0,true,true,128,false);
        auto R = Compute.PrimaryReceivers();
        uint32_t Count = 0, Glass = 0, Capped = 0, Unsupported = 0, Tir = 0;
        std::array<double,3> Sum{}, Expected{};
        for (size_t P = 0; P < R.size(); ++P)
        {
            for (uint32_t C = 0; C < 3; ++C) Require(std::isfinite(Pixels[P][C]) && Pixels[P][C] >= 0,"Invalid solid radiance");
            if (R[P].ExpectedDirect[0] != 5) continue;
            ++Glass;
            uint32_t Packed = uint32_t(R[P].ExpectedDirect[1]);
            Capped += Packed/65536; Tir += Packed%65536; Unsupported += uint32_t(R[P].ExpectedDirect[2]);
            if (std::abs(R[P].PositionHit[0]) > .25 || std::abs(R[P].PositionHit[2]-1) > .25) continue;
            double Cosine = std::abs(R[P].ViewMetallic[1]);
            auto Boundary = EvaluateDielectricRefraction({std::sqrt(1-Cosine*Cosine),0,-Cosine},{0,0,1},1,Ior);
            double Ct = std::sqrt(1-(1-Cosine*Cosine)/(Ior*Ior)), F = Boundary.Reflectance;
            for (uint32_t C = 0; C < 3; ++C)
            {
                double A = std::exp(-Sigma[C]/Ct);
                Expected[C] += (1-F)*(1-F)*A/(1-F*F*A*A);
                Sum[C] += Pixels[P][C];
            }
            ++Count;
        }
        double Error = 0;
        for (uint32_t C = 0; C < 3; ++C) Error = std::max(Error,std::abs(Sum[C]-Expected[C])/std::max(1u,Count));
        std::cout << "SOLID_SLAB case=" << Case << " ior=" << Ior << " glass_pixels=" << Glass << " analytic_pixels=" << Count
                  << " max_mean_error=" << Error << " capped=" << Capped << " unsupported=" << Unsupported << " tir=" << Tir << std::endl;
        Require(Glass > 500 && Count > 50 && !Capped && !Unsupported && Error < (Ior == 1 ? .0001 : .025),"Analytic closed-slab transport failed");
    }
    for (auto& F : Scene.Surfaces)
        if (F.OpticalToken[3] >= 1200)
        {
            uint32_t Tile = uint32_t(F.OpticalToken[3])-1200;
            F.Emissive = ((Tile%20)+(Tile/20))%2 ? std::array<float,4>{3,.7f,.12f,0} : std::array<float,4>{.08f,.35f,1.4f,0};
        }
    for (uint32_t Case = 0; Case < 3; ++Case)
    {
        Scene.Angles[Offset+13] = Case ? 1.5f : 1.f;
        for (uint32_t C = 0; C < 3; ++C) Scene.Angles[Offset+16+C] = Case == 2 ? std::array<float,3>{.2f,.6f,1.2f}[C] : 0;
        auto Pixels = Compute.Execute(Scene,0,16,71,64,0,true,true,128,false);
        WriteImage(Output+"/SolidDielectric"+std::to_string(Case)+".ppm",Pixels,Scene.Width,Scene.Height);
    }
    auto RejectUnsupported = [&](const char* Name) {
        auto Pixels = Compute.Execute(Scene,0,16,71,64,0,true,true,128,false);
        auto R = Compute.PrimaryReceivers();
        uint32_t Count = 0;
        for (size_t P = 0; P < R.size(); ++P)
            if (R[P].ExpectedDirect[0] == 5)
            {
                Require(R[P].ExpectedDirect[2] == 128,"Unsupported volume path was not diagnosed");
                for (uint32_t C = 0; C < 3; ++C) Require(Pixels[P][C] == 0,"Unsupported volume did not terminate black");
                ++Count;
            }
        Require(Count > 500,"Unsupported volume fixture missed glass");
        std::cout << "SOLID_REJECTION case=" << Name << " diagnosed_pixels=" << Count << std::endl;
    };
    for (auto& F : Scene.Surfaces) if (F.Emissive[3] == float(Address)) std::swap(F.B,F.C);
    RejectUnsupported("inverted_winding");
    for (auto& F : Scene.Surfaces) if (F.Emissive[3] == float(Address)) std::swap(F.B,F.C);
    MaterialCamera(Scene,{0,0,1},{0,1,1},96,64);
    RejectUnsupported("inside_camera");

}
