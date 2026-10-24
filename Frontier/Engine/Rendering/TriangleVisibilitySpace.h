/*==========================================================================================================================================
                                                        TRIANGLEVISIBILITYSPACE.H
==========================================================================================================================================*/
// 🧩 Bounded double-precision triangle visibility over all scene facets, independent of primary-view culling.

#pragma once
#include "ClusterNesting.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <utility>
#include <vector>

//------------------------------------------------------------------------------------------------------------------------
//                                                  TRIANGLE INTERVAL QUERIES
//------------------------------------------------------------------------------------------------------------------------

namespace Frontier
{
class TriangleVisibilitySpace
{
    struct Enclosure
    {
        std::array<double, 3> Minimum{}, Maximum{};
        uint32_t First = 0, Count = 0, Lower = 0, Upper = 0;
    };
    std::vector<std::array<SpatialVector, 3>> Facets;
    std::vector<uint32_t> Order;
    std::vector<Enclosure> Bounds;

    static double Coordinate(SpatialVector Point, uint32_t Axis)
    {
        return Axis == 0 ? Point.X : Axis == 1 ? Point.Y : Point.Z;
    }
    static bool Finite(SpatialVector Point)
    {
        return std::isfinite(Point.X) && std::isfinite(Point.Y) && std::isfinite(Point.Z);
    }
    uint32_t Partition(uint32_t First, uint32_t Count)
    {
        Enclosure Region;
        Region.First = First;
        Region.Count = Count;
        Region.Minimum.fill(std::numeric_limits<double>::infinity());
        Region.Maximum.fill(-std::numeric_limits<double>::infinity());
        for (uint32_t Slot = First; Slot < First + Count; ++Slot)
            for (auto Corner : Facets[Order[Slot]])
                for (uint32_t Axis = 0; Axis < 3; ++Axis)
                {
                    Region.Minimum[Axis] = std::min(Region.Minimum[Axis], Coordinate(Corner, Axis));
                    Region.Maximum[Axis] = std::max(Region.Maximum[Axis], Coordinate(Corner, Axis));
                }
        const uint32_t Index = uint32_t(Bounds.size());
        Bounds.push_back(Region);
        if (Count > 8)
        {
            uint32_t Axis = 0;
            for (uint32_t Other = 1; Other < 3; ++Other)
                if (Region.Maximum[Other] - Region.Minimum[Other] >
                    Region.Maximum[Axis] - Region.Minimum[Axis])
                    Axis = Other;
            const uint32_t Middle = First + Count / 2;
            auto Centre           = [&](uint32_t Facet) {
                const auto &Triangle = Facets[Facet];
                return Coordinate(Triangle[0], Axis) / 3 + Coordinate(Triangle[1], Axis) / 3 +
                       Coordinate(Triangle[2], Axis) / 3;
            };
            std::nth_element(Order.begin() + First, Order.begin() + Middle, Order.begin() + First + Count,
                             [&](uint32_t A, uint32_t B) { return Centre(A) < Centre(B); });
            const uint32_t Lower = Partition(First, Middle - First);
            const uint32_t Upper = Partition(Middle, First + Count - Middle);
            Bounds[Index].Lower  = Lower;
            Bounds[Index].Upper  = Upper;
            Bounds[Index].Count  = 0;
        }
        return Index;
    }

  public:
    void Build(std::vector<std::array<SpatialVector, 3>> Geometry)
    {
        if (Geometry.size() > std::numeric_limits<uint32_t>::max() / 2)
            throw std::runtime_error("Triangle visibility capacity exceeded");
        for (const auto &Triangle : Geometry)
            for (auto Corner : Triangle)
                if (!Finite(Corner))
                    throw std::runtime_error("Nonfinite triangle visibility coordinate");
        Facets = std::move(Geometry);
        Order.resize(Facets.size());
        std::iota(Order.begin(), Order.end(), 0u);
        Bounds.clear();
        if (!Facets.empty())
            Partition(0, uint32_t(Facets.size()));
    }

    bool Occluded(SpatialVector Origin, SpatialVector Direction, double Minimum,
                  double Maximum) const noexcept
    {
        if (Bounds.empty() || !Finite(Origin) || !Finite(Direction) || !std::isfinite(Minimum) ||
            Minimum < 0 || !(Maximum > Minimum) || (Direction.X == 0 && Direction.Y == 0 && Direction.Z == 0))
            return false;
        std::array<uint32_t, 64> Pending{};
        uint32_t Count = 1;
        while (Count)
        {
            const auto &Region = Bounds[Pending[--Count]];
            double Near = Minimum, Far = Maximum;
            bool Intersects = true;
            for (uint32_t Axis = 0; Axis < 3; ++Axis)
            {
                const double O = Coordinate(Origin, Axis), D = Coordinate(Direction, Axis);
                if (D == 0)
                {
                    if (O < Region.Minimum[Axis] || O > Region.Maximum[Axis])
                        Intersects = false;
                }
                else
                {
                    double A = (Region.Minimum[Axis] - O) / D, B = (Region.Maximum[Axis] - O) / D;
                    if (A > B)
                        std::swap(A, B);
                    Near = std::max(Near, A);
                    Far  = std::min(Far, B);
                }
            }
            if (!Intersects || Near > Far)
                continue;
            if (!Region.Count)
            {
                // Balanced median splits and the uint32 capacity bound keep pending depth below 32.
                Pending[Count++] = Region.Lower;
                Pending[Count++] = Region.Upper;
                continue;
            }
            for (uint32_t Slot = Region.First; Slot < Region.First + Region.Count; ++Slot)
            {
                const auto &Triangle = Facets[Order[Slot]];
                auto Subtract        = [](SpatialVector A, SpatialVector B) {
                    return SpatialVector{A.X - B.X, A.Y - B.Y, A.Z - B.Z};
                };
                auto Cross = [](SpatialVector A, SpatialVector B) {
                    return SpatialVector{A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X};
                };
                auto Dot = [](SpatialVector A, SpatialVector B) { return A.X * B.X + A.Y * B.Y + A.Z * B.Z; };
                const auto E1 = Subtract(Triangle[1], Triangle[0]), E2 = Subtract(Triangle[2], Triangle[0]);
                const auto P             = Cross(Direction, E2);
                const double Determinant = Dot(E1, P);
                if (std::abs(Determinant) < 1e-14)
                    continue;
                const auto Offset = Subtract(Origin, Triangle[0]);
                const double U    = Dot(Offset, P) / Determinant;
                if (U < 0 || U > 1)
                    continue;
                const auto Q   = Cross(Offset, E1);
                const double V = Dot(Direction, Q) / Determinant;
                if (V < 0 || U + V > 1)
                    continue;
                const double Travel = Dot(E2, Q) / Determinant;
                if (Travel > Minimum && Travel < Maximum)
                    return true;
            }
        }
        return false;
    }
};
} // namespace Frontier
