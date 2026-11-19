/*==========================================================================================================================================
                                                             BAKECLOUDNOISE.CPP
==========================================================================================================================================*/
// 🧩 Reproduce the packed deterministic condensate shape, erosion and blue-rank volume outside tracked content.

#include "Experimental/PlanetaryClouds/CloudNoiseVolume.h"

#include <fstream>
#include <iostream>

//------------------------------------------------------------------------------------------------------------------------
//                                                    VOLUME SERIALIZATION
//------------------------------------------------------------------------------------------------------------------------

int main(int ArgumentCount, char** Arguments)
{
    if (ArgumentCount != 2) return 1;
    const auto&   Texels = Frontier::PlanetaryCloudExperiment::CondensateNoise::QueryTexels();
    std::ofstream Stream(Arguments[1], std::ios::binary);
    Stream.write(reinterpret_cast<const char*>(Texels.data()), std::streamsize(Texels.size() * sizeof(uint32_t)));
    std::cout << Texels.size() << " packed cloud texels\n";
    return Stream ? 0 : 2;
}
