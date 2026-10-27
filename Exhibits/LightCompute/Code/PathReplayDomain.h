/*==========================================================================================================================================
                                                    PATHREPLAYDOMAIN.H
==========================================================================================================================================*/
// 🧩 Validate diffuse triangle coefficients and the bounded BVH used by path-sequence replay.
#pragma once

namespace
{
void ValidateReplayDomain(const LightComputeArchive& Scene, bool PrimaryVisibility, bool RoughOpaque)
{
    Require(Scene.Lights.empty() && (!RoughOpaque || Scene.Angles.empty()) &&
                Scene.Surfaces.size() == Scene.Visibility.Corners.size() &&
                (Scene.Surfaces.empty() == Scene.Visibility.Enclosures.empty()),
            "Replay requires matching triangle/BVH extents and no analytic lights");
    for (size_t I = 0; I < Scene.Surfaces.size(); ++I)
    {
        const auto& F = Scene.Surfaces[I]; const auto& T = Scene.Visibility.Corners[I];
        Require(F.A == T.A && F.B == T.B && F.C == T.C && F.Emissive[3] == 0 &&
                    std::isfinite(F.OpticalToken[3]) && F.OpticalToken[3] > 0,
                "Replay accepts only matching, identified, untextured opaque facets");
        if (RoughOpaque)
            Require(std::isfinite(F.OpticalToken[0]) && F.OpticalToken[0] >= 0 && F.OpticalToken[0] <= 1 &&
                        std::isfinite(F.OpticalToken[1]) && F.OpticalToken[1] >= 1 && F.OpticalToken[1] <= 3 &&
                        std::isfinite(F.OpticalToken[2]) && F.OpticalToken[2] >= 0 && F.OpticalToken[2] <= 1 &&
                        std::isfinite(F.AlbedoRoughness[3]) && F.AlbedoRoughness[3] >= .25f &&
                        F.AlbedoRoughness[3] <= 1, "Rough replay facet lies outside the guarded GGX domain");
        else Require(F.OpticalToken[0] == 0, "Diffuse replay rejects metallic facets");
        for (uint32_t C = 0; C < 3; ++C)
            Require(std::isfinite(F.AlbedoRoughness[C]) && F.AlbedoRoughness[C] >= 0 && F.AlbedoRoughness[C] <= 1 &&
                        std::isfinite(F.Emissive[C]) && F.Emissive[C] >= 0 && F.Emissive[C] <= 256 &&
                        std::isfinite(F.A[C]) && std::isfinite(F.B[C]) && std::isfinite(F.C[C]) &&
                        std::isfinite(F.NormalA[C]) && std::isfinite(F.NormalB[C]) && std::isfinite(F.NormalC[C]),
                    "Invalid replay facet coefficients");
        for (const auto* N : {&F.NormalA, &F.NormalB, &F.NormalC})
            Require((*N)[0]*(*N)[0] + (*N)[1]*(*N)[1] + (*N)[2]*(*N)[2] > 1e-12f,
                    "Replay facet normal is degenerate");
    }
    if (!Scene.Visibility.Enclosures.empty())
    {
        std::vector<uint8_t> Seen(Scene.Visibility.Enclosures.size()), Covered(Scene.Surfaces.size());
        std::vector<uint32_t> Pending{0};
        while (!Pending.empty())
        {
            const uint32_t Index = Pending.back(); Pending.pop_back();
            Require(Index < Seen.size() && Seen[Index] == 0, "Replay BVH has an invalid or repeated enclosure");
            Seen[Index] = 1;
            const auto& Box = Scene.Visibility.Enclosures[Index];
            for (uint32_t C = 0; C < 3; ++C)
                Require(std::isfinite(Box.Minimum[C]) && std::isfinite(Box.Maximum[C]) &&
                            Box.Minimum[C] <= Box.Maximum[C], "Invalid replay BVH bounds");
            Require(Box.Links[2] <= 1, "Invalid replay BVH enclosure category");
            if (Box.Links[2] != 0)
            {
                const uint64_t End = uint64_t(Box.Links[0]) + Box.Links[1];
                Require(Box.Links[1] > 0 && End <= Scene.Surfaces.size(), "Replay BVH leaf exceeds facets");
                for (uint32_t F = Box.Links[0]; F < End; ++F)
                {
                    Require(Covered[F]++ == 0, "Replay BVH repeats a facet");
                    const auto& Facet = Scene.Surfaces[F];
                    for (const auto* P : {&Facet.A, &Facet.B, &Facet.C})
                        for (uint32_t C = 0; C < 3; ++C)
                            Require((*P)[C] >= Box.Minimum[C] && (*P)[C] <= Box.Maximum[C],
                                    "Replay BVH leaf does not enclose its facets");
                }
            }
            else
            {
                for (uint32_t Nested : {Box.Links[0], Box.Links[1]})
                {
                    Require(Nested < Scene.Visibility.Enclosures.size(), "Replay BVH nested enclosure exceeds extent");
                    const auto& Inner = Scene.Visibility.Enclosures[Nested];
                    for (uint32_t C = 0; C < 3; ++C)
                        Require(Inner.Minimum[C] >= Box.Minimum[C] && Inner.Maximum[C] <= Box.Maximum[C],
                                "Replay BVH enclosure does not contain its nested bounds");
                    Pending.push_back(Nested);
                }
            }
        }
        for (uint8_t Mark : Seen) Require(Mark == 1, "Replay BVH has an unreachable enclosure");
        for (uint8_t Mark : Covered) Require(Mark == 1, "Replay BVH omits a facet");
    }
    if (!PrimaryVisibility)
        for (const auto& R : Scene.Receivers)
        {
            Require(R.PositionHit[3] == 0 || R.PositionHit[3] == 1, "Invalid replay receiver hit indicator");
            if (R.PositionHit[3] == 0) continue;
            Require(std::isfinite(R.MotionPositionToken[3]) && R.MotionPositionToken[3] > 0,
                    "Replay receiver must have a positive surface token");
            if (RoughOpaque)
                Require(std::isfinite(R.ViewMetallic[3]) && R.ViewMetallic[3] >= 0 && R.ViewMetallic[3] <= 1 &&
                            std::isfinite(R.AlbedoIor[3]) && R.AlbedoIor[3] >= 1 && R.AlbedoIor[3] <= 3 &&
                            std::isfinite(R.ResidualSpecular[3]) && R.ResidualSpecular[3] >= 0 && R.ResidualSpecular[3] <= 1 &&
                            std::isfinite(R.NormalRoughness[3]) && R.NormalRoughness[3] >= .25f &&
                            R.NormalRoughness[3] <= 1, "Rough replay receiver lies outside the guarded GGX domain");
            else Require(R.ViewMetallic[3] == 0, "Diffuse replay rejects metallic receivers");
            double NormalSquared = 0, ViewSquared = 0, NormalView = 0;
            for (uint32_t C = 0; C < 3; ++C)
            {
                Require(std::isfinite(R.PositionHit[C]) && std::isfinite(R.NormalRoughness[C]) &&
                            std::isfinite(R.AlbedoIor[C]) && R.AlbedoIor[C] >= 0 && R.AlbedoIor[C] <= 1 &&
                            std::isfinite(R.MotionPositionToken[C]) && std::isfinite(R.ResidualSpecular[C]) &&
                            R.ResidualSpecular[C] >= 0, "Invalid replay receiver");
                NormalSquared += double(R.NormalRoughness[C]) * R.NormalRoughness[C];
                if (RoughOpaque)
                {
                    Require(std::isfinite(R.ViewMetallic[C]), "Invalid rough replay view");
                    ViewSquared += double(R.ViewMetallic[C]) * R.ViewMetallic[C];
                    NormalView += double(R.NormalRoughness[C]) * R.ViewMetallic[C];
                }
            }
            Require(NormalSquared > 1e-12 && (!RoughOpaque || (ViewSquared > 1e-12 && NormalView > 1e-8)) &&
                        std::isfinite(R.MotionPixel[0]) && std::isfinite(R.MotionPixel[1]) &&
                        std::isfinite(R.MotionPixel[3]), "Invalid replay receiver normal, view or motion");
        }
}
} // namespace
