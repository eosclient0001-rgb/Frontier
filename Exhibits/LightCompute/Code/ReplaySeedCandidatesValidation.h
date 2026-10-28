/*==========================================================================================================================================
                                                      REPLAYSEEDCANDIDATESVALIDATION.H
==========================================================================================================================================*/
// 🧩 Validate unselected seed candidates combined with temporal and spatial replay reservoirs.

#pragma once

namespace
{
//------------------------------------------------------------------------------------------------------------------------
//                                                   TEST HELPERS
//------------------------------------------------------------------------------------------------------------------------

std::vector<std::array<float, 4>> ExecuteReplaySeedCandidates(LightComputeSubmission&     Compute,
                                                               const LightComputeArchive&  Scene,
                                                               uint32_t                    Seed,
                                                               bool                        Temporal,
                                                               bool                        Spatial,
                                                               bool                        Reset,
                                                               uint32_t                    Bounces = 1,
                                                               const std::array<float, 3>& Environment = {0, 0, 0},
                                                               bool                        SampleFacets = false)
{
    return ExecuteReplaySampleHistory(Compute, Scene, Seed, Reset, true, Bounces, Environment, 1,
                                      Temporal, Spatial, false, false, false, true, SampleFacets, true);
}

float ReplaySeedUnit(uint32_t& Bits)
{
    return float(NextReplayTailRandom(Bits) >> 8) * (1.f / 16777216.f);
}

//------------------------------------------------------------------------------------------------------------------------
//                                     HOST RESERVOIRS AND SUBPIXEL TRANSITION
//------------------------------------------------------------------------------------------------------------------------

void ValidateReplaySeedCandidateComposition(const char* Driver, const std::string& Shaders)
{
    const auto Previous = ReplayCameraPlane(0, 0), Current = ReplayCameraPlane(.03125f, 0);
    LightComputeSubmission Compute(Driver);
    Compute.Prepare(Previous, Shaders, false, false, false, false, true);
    for (uint32_t Frame = 0; Frame < 3; ++Frame)
        (void)ExecuteReplaySeedCandidates(Compute, Previous, 460001u + Frame * 7919u, true, true, Frame == 0);
    const auto OldGuides = Compute.PrimaryReceivers();
    std::vector<std::array<float, 4>> OldSource, OldFirst, OldSecond;
    for (uint32_t Pixel = 0; Pixel < OldGuides.size(); ++Pixel)
    {
        OldSource.push_back(ReplaySampleSlot(Compute, 0, Pixel));
        OldFirst.push_back(ReplaySampleSlot(Compute, 11, Pixel));
        OldSecond.push_back(ReplaySampleSlot(Compute, 12, Pixel));
    }
    constexpr uint32_t FrameSeed = 490003;
    const auto Image = ExecuteReplaySeedCandidates(Compute, Current, FrameSeed, true, true, false);
    const auto Guides = Compute.PrimaryReceivers();
    const auto Counts = Compute.ExtendedStatistics();
    uint32_t Accepted = 0, Disoccluded = 0, DisoccludedFresh = 0, StoredFresh = 0, DifferentWinner = 0;
    uint32_t ChangedVisibility = 0, LocalCompared = 0, SpatialCompared = 0, Ambiguous = 0;
    double LocalMaximum = 0, SpatialMaximum = 0;
    for (uint32_t Pixel = 0; Pixel < Guides.size(); ++Pixel)
    {
        const auto& R = Guides[Pixel];
        if (R.PositionHit[3] == 0 || R.MotionPositionToken[3] <= 0) continue;
        const auto First = ReplaySampleSlot(Compute, 13, Pixel);
        const auto Second = ReplaySampleSlot(Compute, 14, Pixel);
        const uint32_t BankCount = uint32_t(Second[2]);
        const auto NewFirst = ReplaySampleSlot(Compute, 11, Pixel);
        const auto NewSecond = ReplaySampleSlot(Compute, 12, Pixel);
        const auto Local = ReplaySampleSlot(Compute, 2, Pixel);
        const auto Selected = ReplaySampleSlot(Compute, 3, Pixel);
        Require(BankCount <= 3 && Local[3] >= 1, "Seed-candidate bank or local tally is invalid");
        const uint32_t Fresh = ReplayFreshSeed(FrameSeed, Pixel);
        Require(ReplaySampleSeed(NewFirst[0], NewFirst[1]) == Fresh &&
                    NewSecond[2] == float(std::min(BankCount + 1, 3u)),
                "Seed bank did not preserve the fresh unselected draw");
        if (BankCount > 0) Require(NewFirst[2] == First[0] && NewFirst[3] == First[1], "First bank shift differs");
        if (BankCount > 1) Require(NewSecond[0] == First[2] && NewSecond[1] == First[3], "Second bank shift differs");
        ++StoredFresh;
        DifferentWinner += ReplaySampleSeed(Local[0], Local[1]) != Fresh ? 1u : 0u;
        const int32_t X = int32_t(std::floor(R.MotionPixel[0] + .5f));
        const int32_t Y = int32_t(std::floor(R.MotionPixel[1] + .5f));
        const bool InBounds = R.MotionPixel[3] != 0 && X >= 0 && Y >= 0 && X < int32_t(Current.Width) &&
                              Y < int32_t(Current.Height);
        uint32_t Donor = 0;
        bool TemporalCompatible = false;
        if (InBounds)
        {
            Donor = uint32_t(Y) * Current.Width + uint32_t(X);
            const auto& Old = OldGuides[Donor];
            if (Old.MotionPositionToken[3] != R.MotionPositionToken[3])
            {
                ++Disoccluded;
                if (BankCount == 0 && Local[3] == 1) ++DisoccludedFresh;
            }
            float DeltaSquared = 0, PriorSquared = 0, MotionSquared = 0, Dot = 0;
            for (uint32_t Axis = 0; Axis < 3; ++Axis)
            {
                const float Delta = Old.PositionHit[Axis] - R.MotionPositionToken[Axis];
                DeltaSquared += Delta * Delta;
                PriorSquared += Old.NormalRoughness[Axis] * Old.NormalRoughness[Axis];
                MotionSquared += R.MotionNormal[Axis] * R.MotionNormal[Axis];
                Dot += Old.NormalRoughness[Axis] * R.MotionNormal[Axis];
            }
            const float Radius = std::clamp(R.MotionPixel[2], 0.f, .25f);
            TemporalCompatible = OldSource[Donor][3] > 0 && OldSource[Donor][2] > 0 &&
                Old.MotionPositionToken[3] == R.MotionPositionToken[3] && PriorSquared > 1e-12f &&
                MotionSquared > 1e-12f && DeltaSquared <= Radius * Radius &&
                Dot >= .9f * std::sqrt(PriorSquared * MotionSquared);
            if (BankCount > 0)
            {
                ++Accepted;
                Require(First == OldFirst[Donor] && Second == OldSecond[Donor],
                        "Gathered seed bank differs from its previous compatible pixel");
                if (R.MotionPositionToken[3] == 1)
                {
                    const uint32_t Retained = ReplaySampleSeed(First[0], First[1]);
                    const auto Before = ReplaySamplePlaneOracle(Old, Retained);
                    const auto After = ReplaySamplePlaneOracle(R, Retained);
                    if (!Before.Boundary && !After.Boundary && Before.Radiance != After.Radiance) ++ChangedVisibility;
                }
            }
        }
        if (R.MotionPositionToken[3] != 1) continue;
        uint32_t SelectionBits = (FrameSeed * 277803737u + 1597334677u) ^ (Pixel * 2891336453u + 1u);
        const auto FreshPath = ReplaySamplePlaneOracle(R, Fresh);
        bool Edge = FreshPath.Boundary;
        float Sum = FreshPath.Radiance + .01f, Tally = 1, ChosenTarget = Sum, ChosenRadiance = FreshPath.Radiance;
        uint32_t ChosenSeed = Fresh;
        const auto Merge = [&](uint32_t Seed, float Weight, float Radiance, float Represented)
        {
            const float Target = Radiance + .01f;
            Sum += Weight;
            Tally += Represented;
            const float Threshold = ReplaySeedUnit(SelectionBits) * Sum;
            if (std::abs(Threshold - Weight) < 1e-5f) Edge = true;
            if (Threshold < Weight) { ChosenSeed = Seed; ChosenTarget = Target; ChosenRadiance = Radiance; }
        };
        for (uint32_t I = 0; I < BankCount; ++I)
        {
            const uint32_t Seed = I == 0 ? ReplaySampleSeed(First[0], First[1]) :
                                  I == 1 ? ReplaySampleSeed(First[2], First[3]) :
                                           ReplaySampleSeed(Second[0], Second[1]);
            const auto Path = ReplaySamplePlaneOracle(R, Seed);
            Edge = Edge || Path.Boundary;
            Merge(Seed, Path.Radiance + .01f, Path.Radiance, 1);
        }
        if (TemporalCompatible)
        {
            const auto& Source = OldSource[Donor];
            const uint32_t Seed = ReplaySampleSeed(Source[0], Source[1]);
            const auto Path = ReplaySamplePlaneOracle(R, Seed);
            Edge = Edge || Path.Boundary;
            const float Retained = std::min(Source[3], float(Compute.ReplayLastHistoryCap));
            Merge(Seed, (Path.Radiance + .01f) * Source[2] * Retained, Path.Radiance, Retained);
        }
        Require(Local[3] == Tally, "Seed and temporal reservoir candidate counts differ from the host");
        if (!Edge)
        {
            const float ExpectedWeight = Sum / (Tally * ChosenTarget);
            const double Error = std::abs(double(Local[2]) - ExpectedWeight);
            LocalMaximum = std::max(LocalMaximum, Error);
            Require(ReplaySampleSeed(Local[0], Local[1]) == ChosenSeed &&
                        std::abs(Selected[0] - ChosenRadiance) < 1e-6 && Error < 2e-5,
                    "Seed/temporal reservoir differs from the host analytic path oracle");
            ++LocalCompared;
        }
        else ++Ambiguous;

        const int32_t CentreX = int32_t(Pixel % Current.Width), CentreY = int32_t(Pixel / Current.Width);
        const std::array<std::array<int32_t, 2>, 5> Offsets{{{0,0}, {-1,0}, {1,0}, {0,-1}, {0,1}}};
        uint32_t SpatialBits = (FrameSeed * 2891336453u + 1013904223u) ^ (Pixel * 277803737u + 13u);
        float SpatialSum = 0, SpatialTally = 0, SpatialTarget = 0, SpatialRadiance = 0;
        bool SpatialEdge = false;
        for (uint32_t I = 0; I < Offsets.size(); ++I)
        {
            const int32_t DX = CentreX + Offsets[I][0], DY = CentreY + Offsets[I][1];
            if (DX < 0 || DY < 0 || DX >= int32_t(Current.Width) || DY >= int32_t(Current.Height)) continue;
            const uint32_t Other = uint32_t(DY) * Current.Width + uint32_t(DX);
            const auto Source = ReplaySampleSlot(Compute, 2, Other);
            if (Source[3] <= 0 || Source[2] <= 0) continue;
            float Radiance = Selected[0];
            if (I != 0)
            {
                const auto Path = ReplaySamplePlaneOracle(R, ReplaySampleSeed(Source[0], Source[1]));
                SpatialEdge = SpatialEdge || Path.Boundary;
                Radiance = Path.Radiance;
            }
            const float Target = Radiance + .01f, Weight = Target * Source[2] * Source[3];
            SpatialSum += Weight;
            SpatialTally += Source[3];
            const float Threshold = ReplaySeedUnit(SpatialBits) * SpatialSum;
            if (std::abs(Threshold - Weight) < 1e-5f) SpatialEdge = true;
            if (Threshold < Weight) { SpatialRadiance = Radiance; SpatialTarget = Target; }
        }
        if (!SpatialEdge && SpatialTarget > 0)
        {
            const float Expected = SpatialRadiance * (SpatialSum / (SpatialTally * SpatialTarget)) + R.ResidualSpecular[0];
            const double Error = std::abs(double(Image[Pixel][0]) - Expected);
            SpatialMaximum = std::max(SpatialMaximum, Error);
            Require(Error < 2e-5, "Resolved spatial reservoir differs from the independent rectangle oracle");
            ++SpatialCompared;
        }
    }
    Require(!Compute.ReplayLastSampleHistoryReset && Compute.ReplayLastHistoryCap == 1 && Accepted == Counts[23] &&
                Accepted > 100 && Disoccluded > 5 && DisoccludedFresh == Disoccluded && Counts[20] > 100 &&
                Counts[22] > 100 && DifferentWinner > 100 && ChangedVisibility > 0 && LocalCompared > 500 &&
                SpatialCompared > 500 && LocalMaximum < 2e-5 && SpatialMaximum < 2e-5,
            "Subpixel seed candidates did not exercise the requested reservoir composition");
    std::printf("SEED_CANDIDATES_SUBPIXEL accepted=%u disoccluded=%u fresh_local=%u temporal=%u spatial=%u "
                "fresh_stored=%u different_winner=%u changed_visibility=%u local_oracle=%u spatial_oracle=%u "
                "ambiguous_local=%u local_max=%.9g spatial_max=%.9g\n",
                Accepted, Disoccluded, DisoccludedFresh, Counts[20], Counts[22], StoredFresh, DifferentWinner,
                ChangedVisibility, LocalCompared, SpatialCompared, Ambiguous, LocalMaximum, SpatialMaximum);
    std::fflush(stdout);
}

//------------------------------------------------------------------------------------------------------------------------
//                                       RESET, CORRUPTION AND POLICY CONTROLS
//------------------------------------------------------------------------------------------------------------------------

void ValidateReplaySeedCandidateGuards(const char* Driver, const std::string& Shaders)
{
    const auto Scene = ReplayCameraPlane(0, 0);
    LightComputeSubmission Compute(Driver), Control(Driver);
    Compute.Prepare(Scene, Shaders, false, false, false, false, true);
    Control.Prepare(Scene, Shaders, false, false, false, false, true);
    for (uint32_t Frame = 0; Frame < 3; ++Frame)
    {
        const uint32_t Seed = 510001u + Frame * 7919u;
        const auto A = ExecuteReplaySeedCandidates(Compute, Scene, Seed, true, true, Frame == 0);
        const auto B = ExecuteReplaySeedCandidates(Control, Scene, Seed, true, true, Frame == 0);
        Require(ReplayCandidateImagesEqual(A, B), "Paired seed-candidate warm-up differs");
    }
    const auto Moved = ReplayCameraPlane(.0625f, 0, .1f);
    Control.ReplaySampleHistoryActive = false;
    const auto A = ExecuteReplaySeedCandidates(Compute, Moved, 539003, true, true, false);
    const auto B = ExecuteReplaySeedCandidates(Control, Moved, 539003, true, true, false);
    const auto MotionCounts = Compute.ExtendedStatistics();
    Require(Compute.ReplayLastSampleHistoryReset && MotionCounts[23] == 0 && MotionCounts[20] > 100 &&
                MotionCounts[22] > 100 && ReplayCandidateImagesEqual(A, B),
            "Moving blocker did not reset seeds while retaining current-scene reservoir replay");
    const auto Settled = ReplayCameraPlane(.0625f, .0625f, .1f);
    (void)ExecuteReplaySeedCandidates(Compute, Settled, 540001, true, true, false);
    Require(Compute.ExtendedStatistics()[23] > 100, "Seed bank did not resume after the scene reset");
    (void)ExecuteReplaySeedCandidates(Compute, Settled, 540003, true, false, false);
    Require(Compute.ReplayLastSampleHistoryReset && Compute.ExtendedStatistics()[23] == 0,
            "A reservoir policy change retained the old seed bank");
    (void)ExecuteReplaySeedCandidates(Compute, Settled, 540005, true, false, false);
    const auto Guides = Compute.PrimaryReceivers();
    uint32_t Pixel = 0;
    while (Pixel < Guides.size() && Guides[Pixel].MotionPositionToken[3] != 1) ++Pixel;
    Require(Pixel < Guides.size(), "Corrupt-bank control needs a diffuse receiver");
    auto Bank = ReplaySampleSlot(Compute, 11, Pixel);
    Bank[0] = std::numeric_limits<float>::quiet_NaN();
    SetReplaySampleSlot(Compute, 11, Pixel, Bank);
    (void)ExecuteReplaySeedCandidates(Compute, Settled, 540007, true, false, false);
    const auto Scratch = ReplaySampleSlot(Compute, 14, Pixel);
    const auto NewFirst = ReplaySampleSlot(Compute, 11, Pixel);
    const auto Local = ReplaySampleSlot(Compute, 2, Pixel);
    Require(Scratch[2] == 0 && Compute.ExtendedStatistics()[23] > 100 && Local[3] > 1 &&
                ReplaySampleSeed(NewFirst[0], NewFirst[1]) == ReplayFreshSeed(540007, Pixel),
            "Corrupt seed bank was not rejected independently of valid temporal reuse");
    const uint32_t Sequence = Compute.HistorySequence;
    bool Rejected = false;
    try
    {
        (void)ExecuteReplaySampleHistory(Compute, Settled, 1, false, false, 1, {0,0,0}, 1,
                                         true, false, false, false, false, true, false, true);
    }
    catch (const std::exception&) { Rejected = true; }
    Require(Rejected && Compute.HistorySequence == Sequence, "Invalid seed-candidate request advanced history");
    (void)ExecuteReplayCameraPlane(Compute, Settled, 540009, true, false, false, false, false, 1, 1, {0,0,0}, false);
    Require(Compute.ReplayLastHistoryCap == 1 && !Compute.ReplaySampleHistoryActive,
            "Disabling seed candidates failed to cap the prior reservoir");
    (void)ExecuteReplaySeedCandidates(Compute, Settled, 540011, true, false, false);
    Require(Compute.ReplayLastHistoryCap == 1 && Compute.ReplayLastSampleHistoryReset &&
                Compute.ExtendedStatistics()[23] == 0, "Re-enabling seed candidates did not cap and reset history");
    (void)ExecuteReplaySeedCandidates(Compute, Settled, 540013, true, false, false);
    Require(Compute.ReplayLastHistoryCap == 64 && Compute.ExtendedStatistics()[23] > 100,
            "Stable seed-candidate history did not resume after the policy change");
    std::printf("SEED_CANDIDATES_GUARDS moving_reset=1 reset_matches_control=1 temporal=%u spatial=%u "
                "policy_reset=1 corrupt_bank_rejected=1 valid_temporal_retained=1 invalid_request=1 "
                "toggle_reservoir_cap=1 toggle_seed_reset=1\n", MotionCounts[20], MotionCounts[22]);
    std::fflush(stdout);
}

//------------------------------------------------------------------------------------------------------------------------
//                                      EXPLICIT EMITTER AND RELIGHTING CHECK
//------------------------------------------------------------------------------------------------------------------------

void ValidateReplaySeedCandidateFacets(const char* Driver, const std::string& Shaders)
{
    constexpr uint32_t Batches = 16, WarmFrames = 3;
    const auto Previous = ReplayCameraPlane(0, 0), Current = ReplayCameraPlane(.03125f, 0);
    LightComputeSubmission Combined(Driver), Fresh(Driver);
    Combined.Prepare(Previous, Shaders, false, false, false, false, true);
    Fresh.Prepare(Previous, Shaders, false, false, false, false, true);
    std::mt19937_64 BatchSeeds(0x75c30db1ull);
    std::vector<double> ReferencePoint(Previous.Receivers.size(), -1);
    DirectGpuMoments CombinedBatches, FreshBatches, Difference;
    double ReferenceSum = 0, QuadratureSquared = 0, CombinedSquared = 0, FreshSquared = 0;
    uint32_t Points = 0;
    for (uint32_t Batch = 0; Batch < Batches; ++Batch)
    {
        for (uint32_t Frame = 0; Frame < WarmFrames; ++Frame)
        {
            const uint32_t Seed = uint32_t(BatchSeeds());
            (void)ExecuteReplaySeedCandidates(Combined, Previous, Seed, true, true, Frame == 0, 1, {0,0,0}, true);
            (void)ExecuteReplayCameraPlane(Fresh, Previous, Seed, true, true, Frame == 0, false, false, 4, 1,
                                           {0,0,0}, true);
        }
        const uint32_t Seed = uint32_t(BatchSeeds());
        const auto Replayed = ExecuteReplaySeedCandidates(Combined, Current, Seed, true, true, false, 1, {0,0,0}, true);
        const auto FourFresh = ExecuteReplayCameraPlane(Fresh, Current, Seed, true, true, false, false, false, 4, 1,
                                                        {0,0,0}, true);
        const auto Guides = Combined.PrimaryReceivers();
        const auto Counts = Combined.ExtendedStatistics();
        Require(!Combined.ReplayLastSampleHistoryReset && Counts[23] > 100 && Counts[20] > 100 && Counts[22] > 100,
                "Emitter fixture did not exercise seed and reservoir reuse");
        if (Batch == 0)
        {
            for (uint32_t Pixel = 0; Pixel < Guides.size(); ++Pixel)
            {
                const auto& R = Guides[Pixel];
                if (R.MotionPositionToken[3] != 1 || ReplaySampleSlot(Combined, 14, Pixel)[2] != 3) continue;
                const double Reference = ReplayCameraPlaneArea(R, 128), Coarse = ReplayCameraPlaneArea(R, 64);
                ReferencePoint[Pixel] = Reference;
                ReferenceSum += Reference;
                QuadratureSquared += (Reference - Coarse) * (Reference - Coarse);
                ++Points;
            }
            Require(Points > 500, "Emitter reference needs fully retained plane pixels");
        }
        double CombinedMean = 0, FreshMean = 0;
        uint32_t Seen = 0;
        for (uint32_t Pixel = 0; Pixel < ReferencePoint.size(); ++Pixel)
        {
            if (ReferencePoint[Pixel] < 0) continue;
            Require(ReplaySampleSlot(Combined, 14, Pixel)[2] == 3, "Emitter seed bank changed between batches");
            CombinedMean += Replayed[Pixel][0];
            FreshMean += FourFresh[Pixel][0];
            CombinedSquared += std::pow(double(Replayed[Pixel][0]) - ReferencePoint[Pixel], 2);
            FreshSquared += std::pow(double(FourFresh[Pixel][0]) - ReferencePoint[Pixel], 2);
            ++Seen;
        }
        Require(Seen == Points, "Emitter reference point count changed");
        CombinedBatches.Accumulate(CombinedMean / Points);
        FreshBatches.Accumulate(FreshMean / Points);
        Difference.Accumulate((CombinedMean - FreshMean) / Points);
    }
    const double Correction = std::sqrt(double(Batches) / (Batches - 1));
    const double CombinedSe = CombinedBatches.StandardError() * Correction;
    const double FreshSe = FreshBatches.StandardError() * Correction;
    const double DifferenceSe = Difference.StandardError() * Correction;
    const double ReferenceMean = ReferenceSum / Points, QuadratureRmse = std::sqrt(QuadratureSquared / Points);
    std::printf("SEED_CANDIDATES_FACETS batches=%u points=%u reference=%.9g quadrature_rmse=%.9g "
                "four_fresh=%.9g fresh_se=%.9g combined=%.9g combined_se=%.9g fresh_rmse=%.9g "
                "combined_rmse=%.9g paired=%.9g paired_se=%.9g\n",
                Batches, Points, ReferenceMean, QuadratureRmse, FreshBatches.Mean(), FreshSe,
                CombinedBatches.Mean(), CombinedSe, std::sqrt(FreshSquared / (Batches * Points)),
                std::sqrt(CombinedSquared / (Batches * Points)), Difference.Mean(), DifferenceSe);
    Require(QuadratureRmse < .002 && std::abs(FreshBatches.Mean() - ReferenceMean) < 6 * FreshSe + .003 &&
                std::abs(CombinedBatches.Mean() - ReferenceMean) < 6 * CombinedSe + .003 &&
                std::abs(Difference.Mean()) < 6 * DifferenceSe + .003,
            "Combined emitter-sampling output differs from the independent area integral");
    const auto Dark = ReplayCameraPlane(.03125f, .03125f, 0, 0);
    const auto DarkImage = ExecuteReplaySeedCandidates(Combined, Dark, 610001, true, true, false, 1, {0,0,0}, true);
    Require(Combined.ReplayLastSampleHistoryReset && Combined.ExtendedStatistics()[23] == 0 &&
                std::all_of(DarkImage.begin(), DarkImage.end(), [](const auto& P)
                    { return P[0] == 0 && P[1] == 0 && P[2] == 0; }),
            "Source-off transition retained seed history or stale light");
    const auto Relit = ReplayCameraPlane(.03125f, .03125f);
    (void)ExecuteReplaySeedCandidates(Combined, Relit, 610003, true, true, false, 1, {0,0,0}, true);
    Require(Combined.ReplayLastSampleHistoryReset && Combined.ExtendedStatistics()[23] == 0,
            "Relighting failed to reset the seed bank");
    std::printf("SEED_CANDIDATES_RELIGHT source_off_black=1 source_off_reset=1 relight_reset=1\n");
    std::fflush(stdout);
}

//------------------------------------------------------------------------------------------------------------------------
//                                     FOUR-BOUNCE CPU REFERENCE COMPARISON
//------------------------------------------------------------------------------------------------------------------------

void ValidateReplaySeedCandidateMultibounce(const char* Driver, const std::string& Shaders)
{
    constexpr uint32_t Bounces = 4, WarmFrames = 3, Batches = 16, CpuSamples = 512;
    const auto Previous = ReplayCameraPlane(0, 0), Current = ReplayCameraPlane(.03125f, 0);
    const std::array<float, 3> Environment{.025f, .025f, .025f};
    LightComputeSubmission Combined(Driver), Fresh(Driver);
    Combined.Prepare(Previous, Shaders, false, false, false, false, true);
    Fresh.Prepare(Previous, Shaders, false, false, false, false, true);
    std::vector<double> ReferencePoint(Previous.Receivers.size(), -1);
    std::mt19937_64 BatchSeeds(0x2a1864f3ull);
    DirectGpuMoments CombinedBatches, FreshBatches, Difference;
    double ReferenceSum = 0, ReferenceVariance = 0, CombinedSquared = 0, FreshSquared = 0;
    uint32_t Points = 0, Accepted = 0;
    for (uint32_t Batch = 0; Batch < Batches; ++Batch)
    {
        for (uint32_t Frame = 0; Frame < WarmFrames; ++Frame)
        {
            const uint32_t Seed = uint32_t(BatchSeeds());
            (void)ExecuteReplaySeedCandidates(Combined, Previous, Seed, true, true, Frame == 0, Bounces, Environment);
            (void)ExecuteReplayCameraPlane(Fresh, Previous, Seed, true, true, Frame == 0, false, false, 4,
                                           Bounces, Environment, false);
        }
        const uint32_t Seed = uint32_t(BatchSeeds());
        const auto Replayed = ExecuteReplaySeedCandidates(Combined, Current, Seed, true, true, false, Bounces, Environment);
        const auto FourFresh = ExecuteReplayCameraPlane(Fresh, Current, Seed, true, true, false, false, false, 4,
                                                        Bounces, Environment, false);
        const auto Guides = Combined.PrimaryReceivers();
        const auto Counts = Combined.ExtendedStatistics();
        Require(!Combined.ReplayLastSampleHistoryReset && Counts[23] > 100 && Counts[20] > 100 && Counts[22] > 100,
                "Multibounce seed candidates did not exercise all three histories");
        if (Batch == 0)
        {
            Accepted = Counts[23];
            for (uint32_t Pixel = 0; Pixel < Guides.size(); ++Pixel)
            {
                const auto& R = Guides[Pixel];
                if (R.MotionPositionToken[3] != 1 || ReplaySampleSlot(Combined, 14, Pixel)[2] != 3) continue;
                std::mt19937_64 Random(0x1870c523ull + uint64_t(Pixel) * 0x9e3779b97f4a7c15ull);
                DirectGpuMoments Reference;
                for (uint32_t Sample = 0; Sample < CpuSamples; ++Sample)
                    Reference.Accumulate(ReplayReferencePath(Current, R, Bounces, Random)[0]);
                const double Se = Reference.StandardError() * std::sqrt(double(CpuSamples) / (CpuSamples - 1));
                ReferencePoint[Pixel] = Reference.Mean();
                ReferenceSum += Reference.Mean();
                ReferenceVariance += Se * Se;
                ++Points;
            }
            Require(Points > 500, "Multibounce reference needs fully retained plane pixels");
        }
        double CombinedMean = 0, FreshMean = 0;
        uint32_t Seen = 0;
        for (uint32_t Pixel = 0; Pixel < ReferencePoint.size(); ++Pixel)
        {
            if (ReferencePoint[Pixel] < 0) continue;
            Require(ReplaySampleSlot(Combined, 14, Pixel)[2] == 3, "Reference seed bank changed between batches");
            CombinedMean += Replayed[Pixel][0];
            FreshMean += FourFresh[Pixel][0];
            CombinedSquared += std::pow(double(Replayed[Pixel][0]) - ReferencePoint[Pixel], 2);
            FreshSquared += std::pow(double(FourFresh[Pixel][0]) - ReferencePoint[Pixel], 2);
            ++Seen;
        }
        Require(Seen == Points, "Multibounce reference point count changed");
        CombinedBatches.Accumulate(CombinedMean / Points);
        FreshBatches.Accumulate(FreshMean / Points);
        Difference.Accumulate((CombinedMean - FreshMean) / Points);
        if ((Batch + 1) % 4 == 0)
        {
            std::printf("SEED_CANDIDATES_BATCHES completed=%u/%u\n", Batch + 1, Batches);
            std::fflush(stdout);
        }
    }
    const double Correction = std::sqrt(double(Batches) / (Batches - 1));
    const double CombinedSe = CombinedBatches.StandardError() * Correction;
    const double FreshSe = FreshBatches.StandardError() * Correction;
    const double DifferenceSe = Difference.StandardError() * Correction;
    const double ReferenceSe = std::sqrt(ReferenceVariance) / Points;
    const double ReferenceMean = ReferenceSum / Points;
    const double CombinedRmse = std::sqrt(CombinedSquared / (Batches * Points));
    const double FreshRmse = std::sqrt(FreshSquared / (Batches * Points));
    std::printf("SEED_CANDIDATES_MULTIBOUNCE bounces=%u cpu_paths=%u batches=%u points=%u accepted=%u "
                "reference=%.9g cpu_mean_se=%.9g four_fresh=%.9g fresh_se=%.9g combined=%.9g combined_se=%.9g "
                "fresh_rmse=%.9g combined_rmse=%.9g paired=%.9g paired_se=%.9g\n",
                Bounces, Points * CpuSamples, Batches, Points, Accepted, ReferenceMean, ReferenceSe,
                FreshBatches.Mean(), FreshSe, CombinedBatches.Mean(), CombinedSe, FreshRmse, CombinedRmse,
                Difference.Mean(), DifferenceSe);
    Require(std::abs(FreshBatches.Mean() - ReferenceMean) < 6 * std::hypot(FreshSe, ReferenceSe) + .003 &&
                std::abs(CombinedBatches.Mean() - ReferenceMean) < 6 * std::hypot(CombinedSe, ReferenceSe) + .003 &&
                std::abs(Difference.Mean()) < 6 * DifferenceSe + .003,
            "Combined seed/reservoir multibounce output differs from the independent CPU reference");
}

//------------------------------------------------------------------------------------------------------------------------
//                                              ROOM READBACKS
//------------------------------------------------------------------------------------------------------------------------

void CaptureReplaySeedCandidates(const char* Driver, const std::string& Shaders, const std::string& Directory)
{
    constexpr uint32_t Width = 120, Height = 75, Bounces = 4, WarmFrames = 3;
    auto Previous = ReplayRoom(5);
    Previous.Width = Width;
    Previous.Height = Height;
    Previous.Receivers.resize(size_t(Width) * Height);
    auto Current = Previous;
    Current.Camera[0][0] += .03f;
    const std::array<float, 3> Environment{.025f, .025f, .025f};
    LightComputeSubmission Combined(Driver), Fresh(Driver);
    Combined.Prepare(Previous, Shaders, false, false, false, false, true);
    Fresh.Prepare(Previous, Shaders, false, false, false, false, true);
    for (uint32_t Frame = 0; Frame < WarmFrames; ++Frame)
    {
        const uint32_t Seed = 710001u + Frame * 7919u;
        (void)ExecuteReplaySeedCandidates(Combined, Previous, Seed, true, true, Frame == 0, Bounces, Environment, true);
        (void)ExecuteReplayCameraPlane(Fresh, Previous, Seed, true, true, Frame == 0, false, false, 4, Bounces,
                                       Environment, true);
    }
    constexpr uint32_t Seed = 750011;
    const auto Result = ExecuteReplaySeedCandidates(Combined, Current, Seed, true, true, false, Bounces, Environment, true);
    const auto FourFresh = ExecuteReplayCameraPlane(Fresh, Current, Seed, true, true, false, false, false, 4, Bounces,
                                                     Environment, true);
    const auto Guides = Combined.PrimaryReceivers();
    const auto Counts = Combined.ExtendedStatistics();
    std::vector<std::array<float, 4>> Mask(Result.size());
    uint32_t Full = 0, Partial = 0, Rejected = 0, Background = 0;
    for (uint32_t Pixel = 0; Pixel < Result.size(); ++Pixel)
    {
        if (Guides[Pixel].PositionHit[3] == 0 || Guides[Pixel].MotionPositionToken[3] <= 0)
        {
            ++Background;
            Mask[Pixel] = {0, 0, 0, 1};
            continue;
        }
        const float Count = ReplaySampleSlot(Combined, 14, Pixel)[2];
        if (Count == 3) { ++Full; Mask[Pixel] = {.1f, 1, .1f, 1}; }
        else if (Count > 0) { ++Partial; Mask[Pixel] = {.05f, .1f, 1, 1}; }
        else { ++Rejected; Mask[Pixel] = {.5f, .02f, .02f, 1}; }
    }
    Require(!Combined.ReplayLastSampleHistoryReset && Full > 100 && Counts[23] == Full + Partial &&
                Counts[20] > 100 && Counts[22] > 100, "Room capture did not retain seed and reservoir histories");
    std::filesystem::create_directories(Directory);
    WriteImage(Directory + "/ReplaySeedCandidatesFresh.ppm", FourFresh, Width, Height, .45f);
    WriteImage(Directory + "/ReplaySeedCandidatesCombined.ppm", Result, Width, Height, .45f);
    WriteImage(Directory + "/ReplaySeedCandidatesAcceptance.ppm", Mask, Width, Height, 3);
    std::printf("SEED_CANDIDATES_CAPTURE %ux%u bounces=%u warm_frames=%u camera_shift=.03 "
                "full=%u partial=%u rejected=%u background=%u temporal=%u spatial=%u\n",
                Width, Height, Bounces, WarmFrames, Full, Partial, Rejected, Background, Counts[20], Counts[22]);
    std::printf("PASS direct software-Vulkan room readbacks; no denoising or equal-time claim\n");
}

void ValidateReplaySeedCandidates(const char* Driver, const std::string& Shaders)
{
    ValidateReplaySeedCandidateComposition(Driver, Shaders);
    ValidateReplaySeedCandidateGuards(Driver, Shaders);
    ValidateReplaySeedCandidateFacets(Driver, Shaders);
    ValidateReplaySeedCandidateMultibounce(Driver, Shaders);
    std::printf("PASS bounded seed candidates with temporal/spatial replay and independent CPU checks\n");
}
} // namespace
