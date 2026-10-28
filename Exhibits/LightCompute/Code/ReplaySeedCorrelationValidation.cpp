/*==========================================================================================================================================
                                              REPLAYSEEDCORRELATIONVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 Measure bias and cross-frame correlation of combined seed-bank reservoir reuse against fresh sampling.
// 📝 This mirrors GenerateReplayReservoirs candidate order, hash streams and the FinalizeReplaySampleHistory
//    bank shift (Frontier/Engine/Rendering/Shaders/PathReplayReservoir.slang and PathReplaySampleHistory.slang)
//    on a scalar one-bounce fixture. It is a statistical model of the reservoir arithmetic, not GPU ray
//    tracing: EvaluateReplayPath is replaced by a deterministic function of the same seed stream, so any
//    measured bias comes from candidate selection/retention bookkeeping, not scene geometry.

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

//------------------------------------------------------------------------------------------------------------------------
//                                                SHADER HASH STREAMS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Verbatim from LightInfluence.slang: NextRandom / RandomUnit (PCG-style output on an LCG state).
static uint32_t NextRandom(uint32_t &Bits)
{
    Bits = Bits * 747796405u + 2891336453u;
    uint32_t Word = ((Bits >> ((Bits >> 28u) + 4u)) ^ Bits) * 277803737u;
    return (Word >> 22u) ^ Word;
}

static double RandomUnit(uint32_t &Bits) { return double(NextRandom(Bits) >> 8) * (1.0 / 16777216.0); }

//------------------------------------------------------------------------------------------------------------------------
//                                                   SCALAR FIXTURE
//------------------------------------------------------------------------------------------------------------------------

// 📝 A seed drives the same two draws ReplayDirection consumes (radius, azimuth). The fixture maps them to a
//    peaked, heavy-tailed scalar radiance so reservoir target weighting actually matters; State shifts both
//    the peak position and the scale, emulating a lighting/albedo change at an otherwise identical surface.
static double EvaluateFixturePeak(uint32_t Seed, double Peak, double Scale)
{
    uint32_t Bits = Seed;
    double U = RandomUnit(Bits), V = RandomUnit(Bits);
    double D = (U - Peak) / 0.045;
    return Scale * (2.6 * std::exp(-D * D) * (0.35 + V) + 0.04 + 0.10 * U * V);
}

static double ReferenceExpectationPeak(double Peak, double Scale)
{
    const int StepsU = 4096, StepsV = 64;
    double Sum = 0;
    for (int I = 0; I < StepsU; ++I)
        for (int J = 0; J < StepsV; ++J)
        {
            double U = (I + 0.5) / StepsU, V = (J + 0.5) / StepsV, D = (U - Peak) / 0.045;
            Sum += Scale * (2.6 * std::exp(-D * D) * (0.35 + V) + 0.04 + 0.10 * U * V);
        }
    return Sum / (double(StepsU) * double(StepsV));
}

// 📝 ReplayTarget on grey radiance: Power() luminance of (L,L,L) is L, plus the Extent.Maximum.x floor.
static double FixtureTarget(double Radiance) { return Radiance > 0 ? Radiance + 1e-4 : 1e-4; }

// 📝 Reference expectation by deterministic quadrature over the two uniform draws (independent of any seed).
static double ReferenceExpectation(int State)
{
    const int StepsU = 4096, StepsV = 64;
    double Sum = 0;
    for (int I = 0; I < StepsU; ++I)
        for (int J = 0; J < StepsV; ++J)
        {
            double Peak = State == 0 ? 0.30 : 0.62, Scale = State == 0 ? 1.0 : 1.7;
            double U = (I + 0.5) / StepsU, V = (J + 0.5) / StepsV, D = (U - Peak) / 0.045;
            Sum += Scale * (2.6 * std::exp(-D * D) * (0.35 + V) + 0.04 + 0.10 * U * V);
        }
    return Sum / (double(StepsU) * double(StepsV));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                RESERVOIR MIRROR
//------------------------------------------------------------------------------------------------------------------------

enum class Mode { Fresh, Combined, CombinedTemporal };

struct PixelState
{
    uint32_t Bank[3] = {0, 0, 0};
    int BankCount = 0;
    uint32_t TemporalSeed = 0;
    double TemporalW = 0, TemporalCount = 0; // 📝 Packed slot 0: z = Sum/(Count*Target), w = Count.
    bool TemporalValid = false;
};

struct LocalReservoir { uint32_t Seed; double Radiance, Target, Sum, Count; };

// 📝 One GenerateReplayReservoirs dispatch for one pixel, followed by the FinalizeReplaySampleHistory
//    combined bank shift; returns the pre-spatial Local reservoir. Candidates mirrors Extent.Sampling.y.
static LocalReservoir GenerateLocal(PixelState &Pixel, uint32_t Sampling, uint32_t PixelIndex,
                                    double Peak, double Scale, Mode M, long &PathEvals, int Candidates = 1)
{
    uint32_t SeedBits = Sampling ^ (PixelIndex * 747796405u + 2891336453u);
    uint32_t SelectionBits = (Sampling * 277803737u + 1597334677u) ^ (PixelIndex * 2891336453u + 1u);
    uint32_t FreshSeed = NextRandom(SeedBits);
    double Radiance = EvaluateFixturePeak(FreshSeed, Peak, Scale); ++PathEvals;
    double Target = FixtureTarget(Radiance), Sum = Target, Count = 1;
    uint32_t Selected = FreshSeed;
    for (int CandidateIndex = 1; CandidateIndex < Candidates; ++CandidateIndex)
    {
        uint32_t Candidate = NextRandom(SeedBits);
        double CandidateRadiance = EvaluateFixturePeak(Candidate, Peak, Scale); ++PathEvals;
        double CandidateTarget = FixtureTarget(CandidateRadiance);
        Sum += CandidateTarget; Count += 1;
        if (RandomUnit(SelectionBits) * Sum < CandidateTarget) { Selected = Candidate; Radiance = CandidateRadiance; Target = CandidateTarget; }
    }
    bool TemporalEntered = false;
    if (M == Mode::CombinedTemporal && Pixel.TemporalValid)
    {
        double Replayed = EvaluateFixturePeak(Pixel.TemporalSeed, Peak, Scale); ++PathEvals;
        double ReplayedTarget = FixtureTarget(Replayed);
        double Retained = Pixel.TemporalCount < 8 ? Pixel.TemporalCount : 8; // 📝 Reconstruction.w cap mirror.
        double Weight = ReplayedTarget * Pixel.TemporalW * Retained;
        Sum += Weight; Count += Retained;
        if (RandomUnit(SelectionBits) * Sum < Weight) { Selected = Pixel.TemporalSeed; Radiance = Replayed; Target = ReplayedTarget; }
        TemporalEntered = true;
    }
    int BankEntries = Pixel.BankCount;
    if (M == Mode::CombinedTemporal && BankEntries > 1) BankEntries = 1; // 📝 Temporal: newest banked seed only.
    if (M != Mode::Fresh)
        for (int I = 0; I < BankEntries; ++I)
        {
            uint32_t Candidate = Pixel.Bank[I];
            if (TemporalEntered && Candidate == Pixel.TemporalSeed) continue; // 📝 Duplicate guard.
            double CandidateRadiance = EvaluateFixturePeak(Candidate, Peak, Scale); ++PathEvals;
            double CandidateTarget = FixtureTarget(CandidateRadiance);
            Sum += CandidateTarget; Count += 1;
            if (RandomUnit(SelectionBits) * Sum < CandidateTarget) { Selected = Candidate; Radiance = CandidateRadiance; Target = CandidateTarget; }
        }
    // 📝 Persist pre-spatial history (slot 0) for the temporal candidate, then shift the bank.
    Pixel.TemporalSeed = Selected;
    Pixel.TemporalW = Sum / (Count * Target);
    Pixel.TemporalCount = Count;
    Pixel.TemporalValid = true;
    if (M != Mode::Fresh)
    {
        // 📝 Bank the generator stream's next unused draw: skip the max(Candidates,1) draws generation
        //    consumed, exactly as FinalizeReplaySampleHistory skips max(Extent.Sampling.y, 1).
        uint32_t BankBits = Sampling ^ (PixelIndex * 747796405u + 2891336453u);
        for (int Draw = 0; Draw < (Candidates > 0 ? Candidates : 1); ++Draw) NextRandom(BankBits);
        uint32_t BankSeed = NextRandom(BankBits);
        Pixel.Bank[2] = Pixel.BankCount > 1 ? Pixel.Bank[1] : Pixel.Bank[2];
        Pixel.Bank[1] = Pixel.BankCount > 0 ? Pixel.Bank[0] : Pixel.Bank[1];
        Pixel.Bank[0] = BankSeed;
        Pixel.BankCount = Pixel.BankCount + 1 > 3 ? 3 : Pixel.BankCount + 1;
    }
    return {Selected, Radiance, Target, Sum, Count};
}

// 📝 Resolve with ProposalCount == 1: Chosen * Sum / (Count * ChosenTarget), the pre-spatial estimator.
static double RunFrame(PixelState &Pixel, uint32_t Sampling, uint32_t PixelIndex, int State, Mode M, long &PathEvals)
{
    const LocalReservoir Local = GenerateLocal(Pixel, Sampling, PixelIndex, State == 0 ? 0.30 : 0.62,
                                               State == 0 ? 1.0 : 1.7, M, PathEvals);
    return Local.Radiance * (Local.Sum / (Local.Count * Local.Target));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    STATISTICS
//------------------------------------------------------------------------------------------------------------------------

struct Summary { double Mean, Sd; };

static Summary Summarize(const std::vector<double> &Values)
{
    double Mean = 0; for (double V : Values) Mean += V;
    Mean /= (double)Values.size();
    double Var = 0; for (double V : Values) Var += (V - Mean) * (V - Mean);
    return {Mean, std::sqrt(Var / (double)(Values.size() - 1))};
}

int main()
{
    const int Replicates = 4096, Frames = 24, Warmup = 6, ChangeFrame = 30, DynamicFrames = 40;
    const double Ref0 = ReferenceExpectation(0), Ref1 = ReferenceExpectation(1);
    std::printf("Reference expectations: state0 %.8f state1 %.8f\n", Ref0, Ref1);
    bool Pass = true;
    long Evals[(size_t)Mode::CombinedTemporal + 1] = {0, 0, 0};

    // 📝 Stationary bias: independent replicate chains; per-chain means over post-warmup frames are the samples.
    for (Mode M : {Mode::Fresh, Mode::Combined, Mode::CombinedTemporal})
    {
        std::vector<double> ChainMeans;
        std::vector<double> FrameSums(Frames, 0);
        for (int R = 0; R < Replicates; ++R)
        {
            PixelState Pixel; double Acc = 0;
            for (int F = 0; F < Frames; ++F)
            {
                uint32_t Sampling = 1234567u + (uint32_t)R * 977u + (uint32_t)F * 2654435761u;
                double Out = RunFrame(Pixel, Sampling, 17u, 0, M, Evals[(size_t)M]);
                FrameSums[F] += Out;
                if (F >= Warmup) Acc += Out;
            }
            ChainMeans.push_back(Acc / (Frames - Warmup));
        }
        Summary S = Summarize(ChainMeans);
        double Z = (S.Mean - Ref0) / (S.Sd / std::sqrt((double)Replicates));
        std::printf("Stationary mode %d: mean %.6f ref %.6f bias %+.5f%% sd %.4f z %+.2f | frame0 %.4f frame3 %.4f frame12 %.4f\n",
                    (int)M, S.Mean, Ref0, 100.0 * (S.Mean - Ref0) / Ref0, S.Sd, Z,
                    FrameSums[0] / Replicates, FrameSums[3] / Replicates, FrameSums[12] / Replicates);
        if (std::fabs(Z) > 5) { std::printf("FAIL: stationary bias beyond 5 sigma\n"); Pass = false; }
    }

    // 📝 Dynamic response: state changes at ChangeFrame; post-change chain means must track the new reference.
    for (Mode M : {Mode::Fresh, Mode::Combined, Mode::CombinedTemporal})
    {
        std::vector<double> ChainMeans;
        for (int R = 0; R < Replicates; ++R)
        {
            PixelState Pixel; double Acc = 0;
            for (int F = 0; F < DynamicFrames; ++F)
            {
                uint32_t Sampling = 7654321u + (uint32_t)R * 131u + (uint32_t)F * 2654435761u;
                double Out = RunFrame(Pixel, Sampling, 29u, F < ChangeFrame ? 0 : 1, M, Evals[(size_t)M]);
                if (F >= ChangeFrame + 2) Acc += Out;
            }
            ChainMeans.push_back(Acc / (DynamicFrames - ChangeFrame - 2));
        }
        Summary S = Summarize(ChainMeans);
        double Z = (S.Mean - Ref1) / (S.Sd / std::sqrt((double)Replicates));
        std::printf("Dynamic mode %d: mean %.6f ref %.6f bias %+.5f%% z %+.2f\n", (int)M, S.Mean, Ref1, 100.0 * (S.Mean - Ref1) / Ref1, Z);
        if (std::fabs(Z) > 5) { std::printf("FAIL: post-change bias beyond 5 sigma\n"); Pass = false; }
    }

    // 📝 Cross-frame correlation: one long stationary chain; lag correlations of the per-frame output quantify
    //    how much retained candidates couple consecutive frames (variance, not bias). Fresh is the control.
    for (Mode M : {Mode::Fresh, Mode::Combined})
    {
        const int Long = 60000;
        std::vector<double> Series; Series.reserve(Long);
        PixelState Pixel; long Dummy = 0;
        for (int F = 0; F < Long; ++F)
            Series.push_back(RunFrame(Pixel, 424242u + (uint32_t)F * 2654435761u, 7u, 0, M, Dummy));
        Summary S = Summarize(Series);
        std::printf("Correlation mode %d: sd %.4f", (int)M, S.Sd);
        for (int Lag = 1; Lag <= 4; ++Lag)
        {
            double Cov = 0; int N = Long - Lag;
            for (int I = 0; I < N; ++I) Cov += (Series[I] - S.Mean) * (Series[I + Lag] - S.Mean);
            std::printf(" lag%d %+.4f", Lag, (Cov / N) / (S.Sd * S.Sd));
        }
        std::printf("\n");
    }

    // 📝 Cross-pixel (spatial) study: a six-pixel strip whose fixture peak drifts by 0.02 per pixel, so
    //    spatial donors carry slightly different integrands, as on a real surface. Resolve mirrors the
    //    shader's cross tap reduced to 1D (self, left, right): donors are retraced at the receiver,
    //    weighted by target * donor W * donor count, and temporal history persists the pre-spatial Local.
    {
        const int Strip = 6, SReplicates = 2048;
        for (Mode M : {Mode::Fresh, Mode::CombinedTemporal})
        {
            std::vector<std::vector<double>> ChainMeans(Strip);
            for (int R = 0; R < SReplicates; ++R)
            {
                PixelState Pixels[Strip];
                std::vector<double> Acc(Strip, 0);
                for (int F = 0; F < Frames; ++F)
                {
                    const uint32_t Base = 2463531u + (uint32_t)R * 613u + (uint32_t)F * 2654435761u;
                    LocalReservoir Locals[Strip];
                    long Dummy = 0;
                    for (int P = 0; P < Strip; ++P)
                        Locals[P] = GenerateLocal(Pixels[P], Base, 100u + (uint32_t)P, 0.26 + 0.02 * P, 0.9 + 0.05 * P, M, Dummy);
                    for (int P = 0; P < Strip; ++P)
                    {
                        uint32_t SelectionBits = (Base * 2891336453u + 1013904223u) ^ ((100u + (uint32_t)P) * 277803737u + 13u);
                        double Chosen = 0, ChosenTarget = 1e-4, Sum = 0, Count = 0;
                        const int Donors[3] = {P, P - 1, P + 1};
                        for (int D = 0; D < 3; ++D)
                        {
                            const int Q = Donors[D];
                            if (Q < 0 || Q >= Strip) continue;
                            const LocalReservoir &Source = Locals[Q];
                            double Radiance = D == 0 ? Source.Radiance
                                : EvaluateFixturePeak(Source.Seed, 0.26 + 0.02 * P, 0.9 + 0.05 * P);
                            double Target = FixtureTarget(Radiance);
                            double Weight = Target * (Source.Sum / (Source.Count * Source.Target)) * Source.Count;
                            Sum += Weight; Count += Source.Count;
                            if (RandomUnit(SelectionBits) * Sum < Weight) { Chosen = Radiance; ChosenTarget = Target; }
                        }
                        if (F >= Warmup) Acc[P] += Chosen * (Sum / (Count * ChosenTarget));
                    }
                }
                for (int P = 0; P < Strip; ++P) ChainMeans[P].push_back(Acc[P] / (Frames - Warmup));
            }
            double WorstZ = 0;
            for (int P = 0; P < Strip; ++P)
            {
                const Summary S = Summarize(ChainMeans[P]);
                const double Ref = ReferenceExpectationPeak(0.26 + 0.02 * P, 0.9 + 0.05 * P);
                const double Z = (S.Mean - Ref) / (S.Sd / std::sqrt((double)SReplicates));
                if (std::fabs(Z) > std::fabs(WorstZ)) WorstZ = Z;
                std::printf("Spatial mode %d pixel %d: mean %.6f ref %.6f bias %+.5f%% z %+.2f\n",
                            (int)M, P, S.Mean, Ref, 100.0 * (S.Mean - Ref) / Ref, Z);
            }
            if (std::fabs(WorstZ) > 5) { std::printf("FAIL: spatial bias beyond 5 sigma\n"); Pass = false; }
        }
    }

    // 📝 Multiple fresh candidates: the banked unused draw sits after max(Sampling.y,1) generator draws,
    //    so the skip in FinalizeReplaySampleHistory must stay exact for Sampling.y > 1 as well.
    for (int Candidates : {2, 4})
        for (Mode M : {Mode::Combined, Mode::CombinedTemporal})
        {
            std::vector<double> ChainMeans;
            long Dummy = 0;
            for (int R = 0; R < Replicates; ++R)
            {
                PixelState Pixel; double Acc = 0;
                for (int F = 0; F < Frames; ++F)
                {
                    uint32_t Sampling = 987123u + (uint32_t)R * 389u + (uint32_t)F * 2654435761u;
                    const LocalReservoir Local = GenerateLocal(Pixel, Sampling, 23u, 0.30, 1.0, M, Dummy, Candidates);
                    if (F >= Warmup) Acc += Local.Radiance * (Local.Sum / (Local.Count * Local.Target));
                }
                ChainMeans.push_back(Acc / (Frames - Warmup));
            }
            const Summary S = Summarize(ChainMeans);
            const double Z = (S.Mean - Ref0) / (S.Sd / std::sqrt((double)Replicates));
            std::printf("Candidates=%d mode %d: mean %.6f ref %.6f bias %+.5f%% z %+.2f\n",
                        Candidates, (int)M, S.Mean, Ref0, 100.0 * (S.Mean - Ref0) / Ref0, Z);
            if (std::fabs(Z) > 5) { std::printf("FAIL: multi-candidate bias beyond 5 sigma\n"); Pass = false; }
        }

    std::printf("Path evaluations: fresh %ld combined %ld combined-temporal %ld (per equal frame count; combined modes trace retained paths, so this is cost accounting, not a speedup claim)\n",
                Evals[0], Evals[1], Evals[2]);
    std::printf(Pass ? "ReplaySeedCorrelationValidation PASS\n" : "ReplaySeedCorrelationValidation FAIL\n");
    return Pass ? 0 : 1;
}
