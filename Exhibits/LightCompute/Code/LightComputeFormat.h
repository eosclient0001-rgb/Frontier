/*==========================================================================================================================================
                                                        LIGHTCOMPUTEFORMAT.H
==========================================================================================================================================*/
// 🧩 Explicit float32 scene buffers shared by native reference export and Vulkan compute validation.
#pragma once
#include "Engine/Rendering/ReferenceRenderer.h"
#include <array>
#include <fstream>
namespace Frontier
{
struct alignas(16) LightComputeShape
{
    std::array<float, 4> PositionReach{}, RadianceCategory{}, DirectionInner{}, UpOuter{};
    std::array<uint32_t, 4> Profile{};
    std::array<float, 4> PeakActive{};
};
struct alignas(16) LightComputeReceiver
{
    std::array<float, 4> PositionHit{}, NormalRoughness{}, ViewMetallic{}, AlbedoIor{}, ResidualSpecular{},
        ExpectedDirect{};
};
struct LightComputeArchive
{
    uint32_t Width = 0, Height = 0;
    std::vector<LightComputeShape> Lights;
    std::vector<LightComputeReceiver> Receivers;
    TriangleVisibilitySpace::FloatAtlas Visibility;
    std::vector<float> Angles;
    template <class T> static void Write(std::ostream& Stream, const std::vector<T>& Sequence)
    {
        uint32_t Count = uint32_t(Sequence.size());
        Stream.write(reinterpret_cast<const char*>(&Count), 4);
        Stream.write(reinterpret_cast<const char*>(Sequence.data()),
                     std::streamsize(Sequence.size() * sizeof(T)));
    }
    template <class T> static void Read(std::istream& Stream, std::vector<T>& Sequence, uint32_t Limit)
    {
        uint32_t Count = 0;
        Stream.read(reinterpret_cast<char*>(&Count), 4);
        if (Count > Limit)
            throw std::runtime_error("Compute archive extent exceeds budget");
        Sequence.resize(Count);
        Stream.read(reinterpret_cast<char*>(Sequence.data()), std::streamsize(Count * sizeof(T)));
    }
    void Save(const std::string& Path) const
    {
        std::ofstream Stream(Path, std::ios::binary);
        Stream.exceptions(std::ios::failbit | std::ios::badbit);
        const uint32_t Magic = 0x31434c46;
        Stream.write(reinterpret_cast<const char*>(&Magic), 4);
        Stream.write(reinterpret_cast<const char*>(&Width), 4);
        Stream.write(reinterpret_cast<const char*>(&Height), 4);
        Write(Stream, Lights);
        Write(Stream, Receivers);
        Write(Stream, Visibility.Enclosures);
        Write(Stream, Visibility.Corners);
        Write(Stream, Angles);
    }
    static LightComputeArchive Load(const std::string& Path)
    {
        std::ifstream Stream(Path, std::ios::binary);
        Stream.exceptions(std::ios::failbit | std::ios::badbit);
        LightComputeArchive Archive;
        uint32_t Magic = 0;
        Stream.read(reinterpret_cast<char*>(&Magic), 4);
        if (Magic != 0x31434c46)
            throw std::runtime_error("Compute archive signature rejected");
        Stream.read(reinterpret_cast<char*>(&Archive.Width), 4);
        Stream.read(reinterpret_cast<char*>(&Archive.Height), 4);
        Read(Stream, Archive.Lights, 32768);
        Read(Stream, Archive.Receivers, 4194304);
        Read(Stream, Archive.Visibility.Enclosures, 2097152);
        Read(Stream, Archive.Visibility.Corners, 1048576);
        Read(Stream, Archive.Angles, 2097152);
        if (uint64_t(Archive.Width) * Archive.Height != Archive.Receivers.size())
            throw std::runtime_error("Compute receiver extent mismatch");
        return Archive;
    }
};
inline LightComputeArchive PackLightCompute(const ReferenceScene& Scene, const ReferenceImage& Image)
{
    LightComputeArchive Archive;
    Archive.Width = Image.Width;
    Archive.Height = Image.Height;
    auto Vector = [](SpatialVector P, double W) {
        return std::array<float, 4>{float(P.X), float(P.Y), float(P.Z), float(W)};
    };
    auto Color = [](SpectrumRgb C, double W) {
        return std::array<float, 4>{float(C.R), float(C.G), float(C.B), float(W)};
    };
    for (const auto& Light : Scene.Lights)
    {
        LightComputeShape Packed;
        Packed.PositionReach = Vector(Light.Vector, Light.Reach);
        Packed.RadianceCategory = Color(Light.Radiance, Light.Kind == ReferenceLight::Kind::Directional ? 0
                                                        : Light.Kind == ReferenceLight::Kind::Point     ? 1
                                                                                                        : 2);
        Packed.DirectionInner = Vector(Light.Direction, Light.InnerCosine);
        Packed.UpOuter = Vector(Light.Up, Light.OuterCosine);
        Packed.PeakActive[1] = Light.Active ? 1.f : 0.f;
        if (Light.Photometry)
        {
            const auto& P = *Light.Photometry;
            Packed.Profile = {uint32_t(Archive.Angles.size()), uint32_t(P.VerticalAngles().size()), 0,
                              uint32_t(P.HorizontalAngles().size())};
            for (auto A : P.VerticalAngles())
                Archive.Angles.push_back(float(A));
            Packed.Profile[2] = uint32_t(Archive.Angles.size());
            for (auto A : P.HorizontalAngles())
                Archive.Angles.push_back(float(A));
            Packed.PeakActive[2] = float(Archive.Angles.size());
            Packed.PeakActive[0] = 1.f;
            for (auto C : P.CandelaSamples())
                Archive.Angles.push_back(float(C / P.PeakCandela()));
        }
        Archive.Lights.push_back(Packed);
    }
    std::vector<std::array<SpatialVector, 3>> Facets;
    for (const auto& Surface : Scene.Meshes)
        for (size_t I = 0; I < Surface.Geometry.Indices.size(); I += 3)
        {
            std::array<SpatialVector, 3> Corners;
            for (uint32_t J = 0; J < 3; ++J)
            {
                auto P = Surface.Geometry.Vertices[Surface.Geometry.Indices[I + J]];
                Corners[J] = {P.X * Surface.Scale + Surface.Translation.X,
                              P.Y * Surface.Scale + Surface.Translation.Y,
                              P.Z * Surface.Scale + Surface.Translation.Z};
            }
            Facets.push_back(Corners);
        }
    TriangleVisibilitySpace Space;
    Space.Build(std::move(Facets));
    Archive.Visibility = Space.PackFloat32();
    if (Image.SurfaceSamples.size() != Image.Pixels.size())
        throw std::runtime_error("Missing exact reference surface samples");
    for (size_t I = 0; I < Image.Pixels.size(); ++I)
    {
        const auto& S = Image.SurfaceSamples[I];
        auto C = Image.Pixels[I];
        LightComputeReceiver R;
        R.PositionHit = Vector(S.Position, S.Hit ? 1 : 0);
        R.NormalRoughness = Vector(S.Normal, S.Material.Roughness);
        R.ViewMetallic = Vector(S.View, S.Material.Metallic);
        R.AlbedoIor = Color(S.Material.Albedo, S.Material.Ior);
        R.ResidualSpecular =
            Color({C.R - S.Direct.R, C.G - S.Direct.G, C.B - S.Direct.B}, S.Material.SpecularLevel);
        R.ExpectedDirect = Color(S.Direct, 0);
        Archive.Receivers.push_back(R);
    }
    return Archive;
}
static_assert(sizeof(LightComputeShape) == 96 && sizeof(LightComputeReceiver) == 96,
              "Slang storage stride mismatch");
} // namespace Frontier
