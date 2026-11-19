#!/usr/bin/env python3
# ============================================================================================================================================
#                                                            VALIDATECLOUDS.PY
# ============================================================================================================================================
# 🧩 Independent geometry, normalized phase, Beer transport, wind, cyclone, illumination and stateless volume checks.

import argparse
from dataclasses import replace
from hashlib import sha256
import json
import math
from pathlib import Path
import struct
import subprocess
import time

import numpy as Np

import RenderClouds as Clouds

Radius = 6371000.0
Assertions = 0
Measurements = {}


def Enforce(Condition, Label, Count=1):
    global Assertions
    if not Condition:
        raise AssertionError(Label)
    Assertions += Count
    print(f"PASS: {Label}", flush=True)


def Query(Selection, Position=(0.0, 0.0, Radius + 2400.0), Direction=(0.0, 0.0, 1.0), Footprint=12.0,
          Parameters=(0.0, 0.0, 0.0, 0.0)):
    return (*Position, Selection, *Direction, Footprint, *Parameters, 0.0, 0.0, 0.0, 0.0)


def ValidateGeometry(Integration):
    Random = Np.random.default_rng(407)
    Queries = []
    for Altitude in (0.0, 2.0, 100.0, 1400.0, 10000.0, 400000.0, 1400000.0):
        for Elevation in (-90.0, -45.0, -5.0, 0.0, 5.0, 45.0, 90.0):
            Queries.append(Query(0, (0.0, 0.0, Radius + Altitude), Clouds.Direction(17.0, Elevation),
                                  Parameters=(Radius, 0.0, 0.0, 0.0)))
    for Index in range(256):
        Position = Random.normal(size=3)
        Position *= (Radius + Random.uniform(10.0, 1600000.0)) / Np.linalg.norm(Position)
        Direction = Random.normal(size=3)
        Direction /= Np.linalg.norm(Direction)
        Queries.append(Query(0, Position, Direction, Parameters=(Radius, 0.0, 0.0, 0.0)))
    Packed = Np.asarray(Queries, dtype=Np.float32)
    Actual = Integration.Inspect(Clouds.Views["cumulus"], Queries)
    Errors = []
    for Index, Input in enumerate(Packed):
        Position = Input[:3].astype(Np.float64)
        Direction = Input[4:7].astype(Np.float64)
        Direction /= Np.linalg.norm(Direction)
        Along = Np.dot(Position, Direction)
        Perpendicular = Np.linalg.norm(Np.cross(Position, Direction))
        Discriminant = (Radius - Perpendicular) * (Radius + Perpendicular)
        if Discriminant < -100000.0:
            Enforce(Actual[Index, 1] < Actual[Index, 0], f"sphere miss {Index}")
        elif Discriminant > 100000.0:
            Roots = Np.array((-Along - math.sqrt(Discriminant), -Along + math.sqrt(Discriminant)))
            Error = Np.abs(Actual[Index, :2] - Roots)
            Enforce(bool((Error < 2.5 + Np.abs(Roots) * 2.0e-6).all()), f"independent double roots {Index}", 2)
            Errors.extend(Error.tolist())
    Measurements["sphere_double_max_abs_m"] = max(Errors)
    Cases = [(1200.0, (0.0, 0.0, 1.0), (0.0, 800.0)),
             (100.0, (0.0, 0.0, 1.0), (900.0, 1900.0)),
             (800000.0, (0.0, 0.0, -1.0), (798000.0, 799000.0))]
    for Altitude, Direction, Expected in Cases:
        Limit = Altitude if Direction[2] < 0 else 1.0e9
        Result = Integration.Inspect(Clouds.Views["cumulus"], [Query(1, (0.0, 0.0, Radius + Altitude), Direction,
                                               Parameters=(1000.0, 2000.0, Limit, 0.0))])[0]
        Occupied = [(Result[0], Result[1]), (Result[2], Result[3])]
        Occupied = [Span for Span in Occupied if Span[1] > Span[0]]
        Enforce(len(Occupied) == 1 and Np.max(Np.abs(Np.array(Occupied[0]) - Expected)) < 1.0,
                f"ordered interval at altitude {Altitude:g}m")
    Inward = Integration.Inspect(Clouds.Views["cumulus"], [Query(0, (0.0, 0.0, Radius), (0.0, 0.0, -1.0),
                                                             Parameters=(Radius, 0.0, 0.0, 0.0))])[0]
    Enforce(Inward[2] == 0.0, "rounded ground boundary blocks an inward ray immediately")


def ValidatePhase(Integration):
    Count = 8192
    Cosines = (Np.arange(Count, dtype=Np.float64) + 0.5) * (2.0 / Count) - 1.0
    MaxNormalizationError = 0.0
    for Asymmetry in (0.0, 0.40, 0.82, 0.92):
        Queries = [Query(2, (Cosine, Asymmetry, 0.0)) for Cosine in Cosines]
        Actual = Integration.Inspect(Clouds.Views["cumulus"], Queries).astype(Np.float64)
        PackedCosines = Np.asarray(Cosines, dtype=Np.float32).astype(Np.float64)
        PackedAsymmetry = float(Np.float32(Asymmetry))
        Expected = (1.0 - PackedAsymmetry ** 2) / (4.0 * math.pi *
                   (1.0 + PackedAsymmetry ** 2 - 2.0 * PackedAsymmetry * PackedCosines) ** 1.5)
        Relative = Np.abs(Actual[:, 0] - Expected) / Np.maximum(1.0e-6, Expected)
        Error = float(Np.max(Np.abs(Actual.mean(axis=0) * 4.0 * math.pi - 1.0)))
        MaxNormalizationError = max(MaxNormalizationError, Error)
        Enforce(float(Relative.max()) < 3.0e-5, f"independent HG point quadrature g={Asymmetry:g}", Count)
        Enforce(Error < 0.0005, f"all four phase integrals normalize, g={Asymmetry:g}", 4)
    Measurements["phase_normalization_max_abs"] = MaxNormalizationError


def ValidateWind(Integration):
    Random = Np.random.default_rng(712)
    Queries = []
    for Index in range(256):
        Position = Random.normal(size=3)
        Position *= (Radius + Random.uniform(1200.0, 14000.0)) / Np.linalg.norm(Position)
        Queries.append(Query(3, Position))
    View = replace(Clouds.Views["cumulus"], Time=1200.0, Wind=(12.0, 4.0), Shear=0.0, Veer=0.0)
    Actual = Integration.Inspect(View, Queries).astype(Np.float64)
    Positions = Np.asarray(Queries, dtype=Np.float32)[:, :3].astype(Np.float64)
    Speed = math.hypot(*View.Wind)
    Axis = Np.array((-View.Wind[1], View.Wind[0], 0.0)) / Speed
    Angle = -Speed * View.Time / Radius
    Expected = (Positions * math.cos(Angle) + Np.cross(Axis, Positions) * math.sin(Angle) +
                Np.outer(Positions @ Axis, Axis) * (1.0 - math.cos(Angle)))
    Error = Np.linalg.norm(Actual[:, :3] - Expected, axis=1)
    Enforce(float(Error.max()) < 2.0, "wind follows independent spherical rotation characteristics", 256)
    Enforce(float(Np.abs(Actual[:, 3]).max()) <= 1.5, "wind retains altitude across the planet", 256)
    Measurements["wind_characteristic_max_abs_m"] = float(Error.max())
    NoTime = Integration.Inspect(replace(View, Time=0.0), Queries)
    Enforce(Np.array_equal(NoTime[:, :3], Positions.astype(Np.float32)), "zero time does not displace condensate", 256)
    Queries = []
    Radii = (20000.0, 40000.0, 100000.0, 300000.0)
    for Altitude in (2000.0, 13000.0):
        for Distance in Radii:
            Angle = Distance / Radius
            Queries.append(Query(3, ((Radius + Altitude) * math.sin(Angle), 0.0,
                                      (Radius + Altitude) * math.cos(Angle))))
    Cyclone = replace(Clouds.Views["cyclone"], Time=600.0)
    Rotated = Integration.Inspect(Cyclone, Queries)
    Angles = Np.arctan2(Rotated[:, 1], Rotated[:, 0]).reshape(2, -1)
    Enforce(bool((Angles[0] < 0.0).all() and (Angles[1] > 0.0).all()), "low cyclonic rotation and high anticyclonic outflow", 8)
    Enforce(bool((Np.diff(Np.abs(Angles[0])) < 0.0).all()), "differential rotation shears inner and outer rainbands", 3)
    Measurements["cyclone_advected_angles_rad"] = Angles.tolist()


def ValidateRotationTrigonometry(Integration):
    Angles = Np.concatenate((Np.linspace(-math.pi, math.pi, 4097),
                             Np.geomspace(1.0e-8, 0.01, 128), -Np.geomspace(1.0e-8, 0.01, 128)))
    Packed = Angles.astype(Np.float32).astype(Np.float64)
    Actual = Integration.Inspect(Clouds.Views["cumulus"], [Query(10, (Angle, 0.0, 0.0)) for Angle in Angles])
    Expected = Np.stack((Np.sin(Packed), Np.cos(Packed)), axis=1)
    Error = float(Np.abs(Actual[:, :2] - Expected).max())
    Enforce(Error < 0.000001, "bounded rotation sine and cosine match independent double evaluation", len(Angles) * 2)
    Enforce(float(Np.abs(Actual[:, 2] - 1.0).max()) < 0.000001,
            "bounded rotation sine and cosine preserve the unit circle", len(Angles))
    Measurements["rotation_trigonometry_max_abs"] = Error


def ValidateDensity(Integration):
    Random = Np.random.default_rng(91)
    Queried = 0
    Nonzero = {}
    for Name in list(Clouds.Views)[:12]:
        View = Clouds.Views[Name]
        Queries = []
        for Index in range(128):
            Extent = 9000.0 if View.Formation in (9, 10) else 80000.0
            X, Y = Random.uniform(-Extent, Extent, size=2)
            Normal = Np.array((X, Y, Radius))
            Normal /= Np.linalg.norm(Normal)
            Altitude = View.Floor + View.Depth * Random.uniform(-0.15, 1.15)
            Queries.append(Query(4, Normal * (Radius + Altitude), Footprint=Random.uniform(1.0, 400.0)))
        Density = Integration.Inspect(View, Queries)
        Enforce(bool(Np.isfinite(Density).all() and (Density[:, :2] >= 0.0).all() and (Density[:, :2] < 0.02).all()),
                f"bounded 3D extinction for {Name}", 128)
        Enforce(Np.array_equal(Density[:, 0], Density[:, 1]), f"light and view query the identical density for {Name}", 128)
        Nonzero[Name] = int(Np.count_nonzero(Density[:, 0]))
        Enforce(Nonzero[Name] > 0, f"occupied three-dimensional probes for {Name}")
        Queried += len(Queries)
    View = Clouds.Views["cyclone"]
    EyeQueries = [Query(4, (0.0, 0.0, Radius + Altitude)) for Altitude in Np.linspace(1000.0, 14800.0, 64)]
    Eye = Integration.Inspect(View, EyeQueries)
    Enforce(bool((Eye[:, 0] == 0.0).all()), "the cyclonic eye is clear throughout the actual 3D volume", 64)
    Queries = []
    for Azimuth in Np.linspace(0.0, 2.0 * math.pi, 96, endpoint=False):
        Angle = (View.Eye * 1.7) / Radius
        Normal = (math.sin(Angle) * math.cos(Azimuth), math.sin(Angle) * math.sin(Azimuth), math.cos(Angle))
        Queries.append(Query(4, Np.array(Normal) * (Radius + 3000.0)))
    Wall = Integration.Inspect(View, Queries)
    Enforce(float(Wall[:, 0].mean()) > 0.0008, "a dense volumetric eyewall surrounds the clear eye", 96)
    Measurements["density_queries"] = Queried + len(EyeQueries) + len(Queries)
    Measurements["formation_occupied_probe_counts"] = Nonzero
    Measurements["cyclone_eyewall_mean_extinction_per_m"] = float(Wall[:, 0].mean())


def ValidateBeer(Integration):
    View = replace(Clouds.Views["cumulus"], UniformExtinction=0.0004, Solar=0.0, Air=(0.0, 0.0, 0.0))
    Cases = [(10.0, (0.0, 0.0, 1.0), 1.0e8, View.Depth),
             (10000.0, (0.0, 0.0, -1.0), 1.0e8, View.Depth),
             (2000.0, (0.0, 0.0, 1.0), 1.0e8, View.Floor + View.Depth - 2000.0),
             (10.0, (0.0, 0.0, 1.0), 3000.0, 1810.0)]
    Queries = [Query(6, (0.0, 0.0, Radius + Altitude), Direction,
                      Parameters=(Limit, 0.0, 0.0, 0.0)) for Altitude, Direction, Limit, Length in Cases]
    Expected = Np.array([math.exp(-float(Np.float32(View.UniformExtinction)) * Length) for _, _, _, Length in Cases])
    for Steps in (32, 96, 384):
        Actual = Integration.Inspect(View, Queries, Steps=Steps)
        Enforce(float(Np.max(Np.abs(Actual[:, 3] - Expected))) < 3.0e-5, f"independent Beer integral, {Steps} steps", 4)
        Enforce(bool((Actual[:, :3] == 0.0).all()), f"zero irradiance adds no hidden light, {Steps} steps", 12)
    Empty = Integration.Inspect(replace(View, Coverage=0.0), Queries)
    Enforce(bool((Empty[:, 3] == 1.0).all() and (Empty[:, :3] == 0.0).all()), "zero coverage bypasses cloud volume exactly", 16)


def ValidateNoise(Integration, NoisePath):
    Words = Np.frombuffer(Path(NoisePath).read_bytes(), dtype="<u4")
    Enforce(len(Words) == 2700434, "packed shape, erosion, ranks and both mip chains have the exact extent")
    BlueOffset = 128 ** 3 + 64 ** 3
    Ranks = Words[BlueOffset:BlueOffset + 64 ** 2]
    Enforce(Np.array_equal(Np.sort(Ranks), Np.arange(4096)), "blue ranks are an exact 0..4095 permutation", 4096)
    Levels = {}
    for Name, Resolution, Offset, MipOffset in (("shape", 128, 0, BlueOffset + 4096),
                                              ("erosion", 64, 128 ** 3, BlueOffset + 4096 + 299593)):
        Fine = Words[Offset:Offset + Resolution ** 3].reshape(Resolution, Resolution, Resolution)
        Levels[Name] = [Fine]
        Destination = MipOffset
        while Resolution > 1:
            CoarseSize = Resolution // 2
            Coarse = Words[Destination:Destination + CoarseSize ** 3].reshape(CoarseSize, CoarseSize, CoarseSize)
            for Shift in (0, 8, 16, 24):
                Channels = ((Fine >> Shift) & 255).reshape(CoarseSize, 2, CoarseSize, 2, CoarseSize, 2)
                Expected = (Channels.sum(axis=(1, 3, 5), dtype=Np.uint32) + 4) // 8
                Enforce(Np.array_equal((Coarse >> Shift) & 255, Expected),
                        f"independent {Name} {CoarseSize} cubed mip, channel {Shift // 8}", CoarseSize ** 3)
            Levels[Name].append(Coarse)
            Fine = Coarse
            Resolution = CoarseSize
            Destination += CoarseSize ** 3

    def Interpolate(Volume, Coordinate):
        Size = Volume.shape[0]
        Projected = (Coordinate - Np.floor(Coordinate)) * Size
        Corner = Np.floor(Projected).astype(int)
        Fraction = Projected - Corner
        Result = Np.zeros(4, dtype=Np.float64)
        for Z in (0, 1):
            for Y in (0, 1):
                for X in (0, 1):
                    Packed = int(Volume[(Corner[2] + Z) % Size, (Corner[1] + Y) % Size, (Corner[0] + X) % Size])
                    Channels = Np.array([(Packed >> Shift) & 255 for Shift in (0, 8, 16, 24)]) / 255.0
                    Weight = math.prod(Fraction[Axis] if CornerOffset else 1.0 - Fraction[Axis]
                                       for Axis, CornerOffset in enumerate((X, Y, Z)))
                    Result += Channels * Weight
        return Result

    Random = Np.random.default_rng(137)
    MaxError = 0.0
    for Name, Selection, Period, Resolution in (("shape", 8, 7200.0, 128), ("erosion", 9, 1550.0, 64)):
        Queries = []
        Expected = []
        for Footprint in (1.0, 35.0, 120.0, 900.0, 1000000.0):
            for Index in range(40):
                Coordinate = Random.uniform(-2.0, 2.0, size=3).astype(Np.float32).astype(Np.float64)
                Level = min(math.log2(Resolution), max(0.0, math.log2(max(1.0, Footprint * Resolution / Period))))
                Near = int(math.floor(Level))
                Far = min(len(Levels[Name]) - 1, Near + 1)
                Fraction = Level - Near
                NearSize = Resolution >> Near
                FarSize = Resolution >> Far
                NearSample = Interpolate(Levels[Name][Near], Coordinate - (0.5 / NearSize - 0.5 / Resolution))
                FarSample = Interpolate(Levels[Name][Far], Coordinate - (0.5 / FarSize - 0.5 / Resolution))
                Expected.append(NearSample * (1.0 - Fraction) + FarSample * Fraction)
                Queries.append(Query(Selection, Coordinate, Footprint=Footprint, Parameters=(Period, 0.0, 0.0, 0.0)))
        Actual = Integration.Inspect(Clouds.Views["cumulus"], Queries)
        Error = float(Np.max(Np.abs(Actual.astype(Np.float64) - Np.array(Expected))))
        MaxError = max(MaxError, Error)
        Enforce(Error < 2.0e-5, f"independent packed trilinear and mip interpolation for {Name}", len(Queries) * 4)
        Enforce(float(Np.ptp(Actual[-40:], axis=0).max()) == 0.0,
                f"unresolved {Name} converges to its actual volume mean, not orbital noise", 40 * 4)
    Measurements["noise_texels"] = len(Words)
    Measurements["noise_sha256"] = sha256(Words.tobytes()).hexdigest()
    Measurements["noise_interpolation_max_abs"] = MaxError


def ValidateVolume(Integration):
    View = Clouds.Views["cumulus"]
    Queries = []
    for X in Np.linspace(-16000.0, 16000.0, 12):
        for Y in Np.linspace(-16000.0, 16000.0, 12):
            Normal = Np.array((X, Y, Radius))
            Normal /= Np.linalg.norm(Normal)
            for Height in (0.08, 0.32, 0.60, 0.88):
                Queries.append(Query(4, Normal * (Radius + View.Floor + View.Depth * Height)))
    Densities = Integration.Inspect(View, Queries)[:, 0].reshape(-1, 4)
    Varying = int(Np.count_nonzero(Np.ptp(Densities, axis=1) > 0.0002))
    Enforce(Varying >= 12, "fixed horizontal positions contain genuinely different vertical condensate", 144)
    Measurements["vertically_varying_columns"] = Varying
    PolarView = replace(Clouds.Views["cyclone"], CycloneAxis=(0.0, 1.0, 0.0))
    Pole = Integration.Inspect(PolarView, [Query(4, (0.0, Radius + 3000.0, 0.0))])
    Enforce(bool(Np.isfinite(Pole).all() and Pole[0, 0] == 0.0), "cyclonic coordinates stay finite on the alternate polar axis", 4)


def ValidateInputRejection(Integration):
    import ctypes as Ct
    View = Clouds.Views["cumulus"]
    Uniform = Clouds.EncodeFootprint(View, 8, 8, (1, 1), 0, 8, 64, 8, 1)
    Cases = []
    for Offset, Encoded, Expected in ((192, 0, 2), (192, 0xffffffff, 2), (180, 0, 2), (184, 0, 2),
                                      (208, 8, 2), (216, 0, 2), (196, 1, 2), (200, 0, 2)):
        Invalid = bytearray(Uniform)
        struct.pack_into("<I", Invalid, Offset, Encoded)
        Cases.append((bytes(Invalid), Expected, 0, 0))
    for Offset, Encoded in ((0, float("nan")), (12, float("inf")), (12, 604801.0), (76, -1.0), (88, 1.1), (96, 0.0)):
        Invalid = bytearray(Uniform)
        struct.pack_into("<f", Invalid, Offset, Encoded)
        Cases.append((bytes(Invalid), 3, 0, 0))
    Cases.extend(((Uniform, 2, -1, 0), (Uniform, 2, 0, -1)))
    for Index, (Packet, Expected, NoiseOffset, CapacityOffset) in enumerate(Cases):
        Pixels = Ct.create_string_buffer(b"\xa5" * (8 * 8 * 16 + 64), 8 * 8 * 16 + 64)
        Result = Integration.Entry(Packet, Integration.Noise, len(Integration.Noise) // 4 + NoiseOffset,
                                   Integration.Surface, len(Integration.Surface) // 4,
                                   Pixels, 8 * 8 * 16 + CapacityOffset, 2)
        Enforce(Result == Expected and Pixels.raw == b"\xa5" * len(Pixels), f"malformed input rejected without output writes {Index}")
    Diagnostic = bytearray(Uniform)
    struct.pack_into("<I", Diagnostic, 220, 2)
    Cases = [(bytes(Diagnostic), Integration.Surface, len(Integration.Surface) // 4, 2)]
    ValidQuery = Np.asarray([Query(4)], dtype="<f4")
    Packet = Clouds.EncodeFootprint(View, 1, 1, (16, 1), 0, 1, 64, 8, 1, 2)
    for Offset, Number in ((3, -1.0), (3, 11.0), (3, 4.5), (0, float("nan")), (7, -1.0)):
        InvalidQuery = ValidQuery.copy()
        InvalidQuery[0, Offset] = Number
        Encoded = InvalidQuery.tobytes()
        Cases.append((Packet, Ct.create_string_buffer(Encoded, len(Encoded)), 16, 3))
    for Selection, Offset, Number in ((6, 6, 0.0), (8, 8, 0.0), (2, 1, 1.0)):
        InvalidQuery = Np.asarray([Query(Selection)], dtype="<f4")
        InvalidQuery[0, Offset] = Number
        Encoded = InvalidQuery.tobytes()
        Cases.append((Packet, Ct.create_string_buffer(Encoded, len(Encoded)), 16, 3))
    for Index, (Packet, Surface, Count, Expected) in enumerate(Cases):
        Pixels = Ct.create_string_buffer(b"\xa5" * (8 * 8 * 16 + 64), 8 * 8 * 16 + 64)
        Result = Integration.Entry(Packet, Integration.Noise, len(Integration.Noise) // 4,
                                   Surface, Count, Pixels, 8 * 8 * 16, 2)
        Enforce(Result == Expected and Pixels.raw == b"\xa5" * len(Pixels),
                f"numeric query extent or arithmetic rejected without output writes {Index}")
    Measurements["rejected_input_cases"] = 16 + len(Cases)



def ValidateImages(Integration):
    View = Clouds.Views["cumulus"]
    Width, Height = 80, 45
    Arguments = (Width, Height, 160, 16)
    First = Integration.Capture(View, *Arguments, Diagnostic=3)
    Moved = Integration.Capture(replace(View, Time=90.0), *Arguments, Diagnostic=3)
    Repeated = Integration.Capture(View, *Arguments, Diagnostic=3)
    Enforce(Np.array_equal(First, Repeated), "stateless A, moved B, replayed A images are byte identical", Width * Height * 4)
    Difference = float(Np.mean(Np.abs(First - Moved)))
    Enforce(Difference > 0.004, "actual wind changes rendered radiance and optical depth")
    Still = replace(View, Wind=(0.0, 0.0))
    NoWind = Integration.Capture(Still, *Arguments, Diagnostic=3)
    NoWindLater = Integration.Capture(replace(Still, Time=90.0), *Arguments, Diagnostic=3)
    Enforce(Np.array_equal(NoWind, NoWindLater), "zero velocity keeps the rendered volume stationary", Width * Height * 4)
    Half = Integration.Capture(replace(View, Solar=View.Solar * 0.5), *Arguments, Diagnostic=3)
    Off = Integration.Capture(replace(View, Solar=0.0), *Arguments, Diagnostic=3)
    Enforce(float(Np.max(Np.abs(First[..., :3] - 2.0 * Half[..., :3]))) < 2.0e-6,
            "linear-light cloud radiance doubles with solar irradiance", Width * Height * 3)
    Enforce(bool((Off[..., :3] == 0.0).all()), "solar-off cloud capture is exactly black", Width * Height * 3)
    Enforce(Np.array_equal(First[..., 3], Half[..., 3]) and Np.array_equal(First[..., 3], Off[..., 3]),
            "relighting never changes density or primary optical depth", Width * Height * 2)
    Unshadowed = Integration.Capture(replace(View, Shadows=0), *Arguments, Diagnostic=3)
    Enforce(float(Unshadowed[..., :3].mean()) > float(First[..., :3].mean()) * 1.08,
            "removing self-shadowing measurably increases the rendered illumination")
    SideLight = Integration.Capture(replace(View, Sun=(80.0, 15.0)), *Arguments, Diagnostic=3)
    Enforce(float(Np.mean(Np.abs(SideLight[..., :3] - First[..., :3]))) > 0.01,
            "changing Sun direction relights the occupied 3D volume")
    DeepNight = Integration.Capture(replace(View, Sun=(0.0, -90.0)), *Arguments, Diagnostic=3)
    Enforce(bool((DeepNight[..., :3] == 0.0).all()), "planet-occluded Sun leaves no artificial cloud night glow", Width * Height * 3)
    Vacuum = Integration.Capture(Clouds.Views["vacuum"], 32, 18, 64, 4)
    Enforce(bool((Vacuum[..., :3] == 0.0).all() and (Vacuum[..., 3] == 1.0).all()), "airless body is exactly clear and black", 32 * 18 * 4)
    Measurements["wind_image_mean_abs_float"] = Difference
    Measurements["self_shadowed_mean_radiance"] = float(First[..., :3].mean())
    Measurements["unshadowed_mean_radiance"] = float(Unshadowed[..., :3].mean())
    Measurements["stateless_image_sha256"] = sha256(First.tobytes()).hexdigest()


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--slang", type=Path, default=Clouds.Root / "ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc")
    Parser.add_argument("--library", type=Path)
    Parser.add_argument("--noise", type=Path)
    Parser.add_argument("--out", type=Path, default=Clouds.Root / "_ClaudeScratch/tmp/CloudValidation")
    Parser.add_argument("--numeric-only", action="store_true")
    Arguments = Parser.parse_args()
    if bool(Arguments.library) != bool(Arguments.noise):
        Parser.error("--library and --noise must be provided together")
    if Arguments.library:
        Library, Noise, Identity = Arguments.library.resolve(), Arguments.noise.resolve(), Clouds.QuerySourceIdentity()
    else:
        Library, Noise, Identity = Clouds.CompileNative(Arguments.slang)
    Integration = Clouds.NativeIntegration(Library, Noise)
    Arguments.out.mkdir(parents=True, exist_ok=True)
    Start = time.monotonic()
    Report = {"source_sha256": Identity, "execution": "actual Slang native C++ target", "tests_passed": False,
              "photorealism_accepted": False, "production_accepted": False, "measurements": Measurements,
              "library_sha256": Integration.LibraryIdentity,
              "assertion_accounting": "scalar and texel checks, not independent test cases"}
    try:
        ValidateNoise(Integration, Noise)
        ValidateGeometry(Integration)
        ValidatePhase(Integration)
        ValidateWind(Integration)
        ValidateRotationTrigonometry(Integration)
        ValidateDensity(Integration)
        ValidateBeer(Integration)
        ValidateVolume(Integration)
        from ValidateSolarDensity import SolarDensityMeasurement
        SolarDensity, SolarArrays = SolarDensityMeasurement(Integration)
        Enforce(SolarDensity["max_abs_optical_depth_difference"] < 0.01,
                "actual solar integration matches direct world-density samples on identical segments/footprints",
                SolarDensity["world_receivers"])
        Measurements["solar_density_coherence"] = SolarDensity
        ValidateInputRejection(Integration)
        if not Arguments.numeric_only:
            ValidateImages(Integration)
        Report["tests_passed"] = True
    except BaseException as Failure:
        Report["failure"] = str(Failure)
        raise
    finally:
        Report["assertions"] = Assertions
        Report["seconds"] = time.monotonic() - Start
        (Arguments.out / "CloudValidation.json").write_text(json.dumps(Report, indent=2) + "\n")
    print(json.dumps(Report, indent=2), flush=True)


if __name__ == "__main__":
    Main()
