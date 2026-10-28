/*==========================================================================================================================================
                                                         REPLAYSEEDDOMAINAUDIT.CPP
==========================================================================================================================================*/
// 🧩 Enumerate retained unselected seed candidates combined with a temporal reservoir on a finite domain.

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include <array>
#include <cmath>
#include <cstdio>

namespace
{
//------------------------------------------------------------------------------------------------------------------------
//                                              FINITE-DOMAIN ENUMERATION
//------------------------------------------------------------------------------------------------------------------------

template <std::size_t Extent>
double Evaluate(const std::array<double, Extent>& Previous,
                const std::array<double, Extent>& Current,
                double                            Floor,
                double                            Retained,
                bool                              UseSelectedSeed)
{
    // 📝 Enumerate two previous draws, one current draw and both reservoir selections. The bank retains the
    //    first previous draw without conditioning on the result of prior reservoir selection.
    const double DrawProbability = 1.0 / double(Extent * Extent * Extent);
    double Result = 0;
    for (std::size_t First = 0; First < Extent; ++First)
    {
        for (std::size_t Second = 0; Second < Extent; ++Second)
        {
            for (std::size_t Fresh = 0; Fresh < Extent; ++Fresh)
            {
                const std::array<std::size_t, 2> Prior{First, Second};
                const double PreviousSum = Previous[First] + Previous[Second] + 2 * Floor;
                for (std::size_t Selection = 0; Selection < Prior.size(); ++Selection)
                {
                    const std::size_t Chosen = Prior[Selection];
                    const double PreviousTarget   = Previous[Chosen] + Floor;
                    const double PriorProbability = PreviousTarget / PreviousSum;
                    const double PriorWeight      = PreviousSum / (2 * PreviousTarget);
                    const std::size_t Bank = UseSelectedSeed ? Chosen : First;
                    const std::array<std::size_t, 3> Candidates{Fresh, Bank, Chosen};
                    const std::array<double, 3> Weights{
                        Current[Fresh] + Floor,
                        Current[Bank] + Floor,
                        (Current[Chosen] + Floor) * PriorWeight * Retained};
                    const double Sum   = Weights[0] + Weights[1] + Weights[2];
                    const double Count = 2 + Retained;
                    for (std::size_t I = 0; I < Candidates.size(); ++I)
                    {
                        const double FinalProbability = Weights[I] / Sum;
                        const double Estimate = Current[Candidates[I]] * Sum /
                                                (Count * (Current[Candidates[I]] + Floor));
                        Result += DrawProbability * PriorProbability * FinalProbability * Estimate;
                    }
                }
            }
        }
    }
    return Result;
}

template <std::size_t Extent>
bool Validate(const char*                       Label,
              const std::array<double, Extent>& Previous,
              const std::array<double, Extent>& Current,
              bool                              ExpectSelectedBias)
{
    double Reference = 0;
    for (double Radiance : Current) Reference += Radiance / double(Extent);
    const double Full     = Evaluate(Previous, Current, .125, 2, false);
    const double Capped   = Evaluate(Previous, Current, .125, 1, false);
    const double Selected = Evaluate(Previous, Current, .125, 2, true);
    const bool Correct = std::abs(Full - Reference) < 1e-12 && std::abs(Capped - Reference) < 1e-12;
    const bool NegativeControl = !ExpectSelectedBias || std::abs(Selected - Reference) > .01;
    std::printf("%s exact=%.12g unselected_full=%.12g unselected_cap_one=%.12g selected_seed=%.12g\n",
                Label, Reference, Full, Capped, Selected);
    return Correct && NegativeControl;
}
} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                           MAIN
//------------------------------------------------------------------------------------------------------------------------

int main()
{
    bool Valid = true;
    Valid &= Validate("INVERTED", std::array<double, 2>{1, 0}, std::array<double, 2>{0, 1}, true);
    Valid &= Validate("DARK_TO_BRIGHT", std::array<double, 2>{0, 0}, std::array<double, 2>{1, 1}, false);
    Valid &= Validate("UNEQUAL", std::array<double, 4>{0, 1, 0, 3}, std::array<double, 4>{0, 0, 2, 5}, true);
    Valid &= Validate("UNCHANGED", std::array<double, 4>{0, 1, 2, 3}, std::array<double, 4>{0, 1, 2, 3}, true);
    std::printf("%s finite common-domain enumeration; not a proof for adaptive GPU reuse or RNG independence\n",
                Valid ? "PASS" : "FAIL");
    return Valid ? 0 : 1;
}
