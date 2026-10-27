/*==========================================================================================================================================
                                                    PATHREPLAYDOMAIN.H
==========================================================================================================================================*/
// 🧩 Validate diffuse triangle coefficients and the bounded BVH used by path-sequence replay.
#pragma once

namespace
{
void ValidateReplayDomain(const LightComputeArchive& Scene, bool PrimaryVisibility)
{
    Require(Scene.Lights.empty() && Scene.Surfaces.size() == Scene.Visibility.Corners.size() &&
                (Scene.Surfaces.empty() == Scene.Visibility.Enclosures.empty()),
            "Replay requires matching triangle/BVH extents and no analytic lights");
    for (size_t I = 0; I < Scene.Surfaces.size(); ++I)
    {
        const auto& F = Scene.Surfaces[I]; const auto& T = Scene.Visibility.Corners[I];
        Require(F.A == T.A && F.B == T.B && F.C == T.C && F.Emissive[3] == 0 && F.OpticalToken[0] == 0 &&
                    std::isfinite(F.OpticalToken[3]) && F.OpticalToken[3] > 0,
                "Replay accepts only matching, identified, untextured nonmetallic facets");
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
            Require(R.ViewMetallic[3] == 0 && std::isfinite(R.MotionPositionToken[3]) && R.MotionPositionToken[3] > 0,
                    "Replay receiver must be nonmetallic with a positive surface token");
            double NormalSquared = 0;
            for (uint32_t C = 0; C < 3; ++C)
            {
                Require(std::isfinite(R.PositionHit[C]) && std::isfinite(R.NormalRoughness[C]) &&
                            std::isfinite(R.AlbedoIor[C]) && R.AlbedoIor[C] >= 0 && R.AlbedoIor[C] <= 1 &&
                            std::isfinite(R.MotionPositionToken[C]) && std::isfinite(R.ResidualSpecular[C]) &&
                            R.ResidualSpecular[C] >= 0, "Invalid replay receiver");
                NormalSquared += double(R.NormalRoughness[C]) * R.NormalRoughness[C];
            }
            Require(NormalSquared > 1e-12 && std::isfinite(R.MotionPixel[0]) && std::isfinite(R.MotionPixel[1]) &&
                        std::isfinite(R.MotionPixel[3]), "Invalid replay receiver normal or motion");
        }
}
} // namespace
