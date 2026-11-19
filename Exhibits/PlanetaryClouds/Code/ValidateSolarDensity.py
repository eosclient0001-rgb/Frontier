#!/usr/bin/env python3
# ============================================================================================================================================
#                                                         VALIDATESOLARDENSITY.PY
# ============================================================================================================================================
# 🧩 Compare actual solar integration with direct world-density samples on the identical segments, including a rejected endpoint-weather control.

import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory

import numpy as Np

import RenderClouds as Clouds


# ------------------------------------------------------------------------------------------------------------------------
#                                                  MATCHED WORLD-DENSITY QUADRATURE
# ------------------------------------------------------------------------------------------------------------------------


def SolarDensityMeasurement(Integration, Count=256, Steps=32):
    View = Clouds.Views["cumulus"]
    Scalar = Np.float32
    Random = Np.random.default_rng(6183)
    Positions = Np.column_stack((Random.uniform(-24000, 24000, (Count, 2)), Np.full(Count, 6371000.0)))
    Positions *= 6371002.0 / Np.linalg.norm(Positions, axis=1)[:, None]
    Positions = Positions.astype("<f4")
    Sun = Np.array(Clouds.Direction(*View.Sun), dtype="<f4")
    Sun *= Scalar(1) / Np.sqrt(Np.sum(Sun * Sun, dtype=Scalar))

    def Query(Selection, Position, Direction=(0, 0, 1), Footprint=1, Parameters=(0, 0, 0, 0)):
        return (*Position, Selection, *Direction, Footprint, *Parameters, 0, 0, 0, 0)

    SpanQueries = [Query(1, Point, Clouds.Direction(*View.Sun),
                         Parameters=(View.Floor, View.Floor + View.Depth, 1e8, 0)) for Point in Positions]
    Spans = Integration.Inspect(View, SpanQueries)
    Valid = Spans.reshape(Count, 2, 2)[..., 1] > Spans.reshape(Count, 2, 2)[..., 0]
    if not (Valid.sum(axis=1) == 1).all():
        raise AssertionError("solar density reference requires one complete upward interval per receiver")
    Intervals = Np.where(Valid[:, :1], Spans[:, :2], Spans[:, 2:])
    Queries, Segments = [], []
    for Point, Span in zip(Positions, Intervals):
        Length = Scalar(Span[1] - Span[0])
        Start = Scalar(0)
        for Index in range(Steps):
            Fraction = Scalar(Index + 1) / Scalar(Steps)
            End = Scalar(Scalar(Length * Fraction) * Fraction)
            Distance = Scalar(End - Start)
            At = Scalar(Span[0] + Scalar(Scalar(0.5) * Scalar(Start + End)))
            Position = Point + Sun * At
            Footprint = max(Scalar(1), Scalar(Scalar(8) + Scalar(Scalar(0.12) * Distance)))
            Queries.append(Query(4, Position, Footprint=Footprint))
            Segments.append(Distance)
            Start = End
    Density = Integration.Inspect(View, Queries)[:, 0].reshape(Count, Steps)
    SegmentM = Np.asarray(Segments, dtype="<f4").reshape(Count, Steps)
    Expected = Np.minimum(Scalar(18), Np.sum(Density * SegmentM, axis=1, dtype=Scalar))
    Actual = Integration.Inspect(View, [Query(5, Point) for Point in Positions], LightSteps=Steps)[:, 3]
    Difference = Np.abs(Actual - Expected)
    Report = {"world_receivers": Count, "steps": Steps, "density_point_queries": Count * Steps,
              "max_abs_optical_depth_difference": float(Difference.max()),
              "mean_abs_optical_depth_difference": float(Difference.mean()),
              "rays_over_0_01": int(Np.count_nonzero(Difference > 0.01)),
              "tolerance_optical_depth": 0.01,
              "scope": "same Float32 segments/footprints; 0.01 permits independent host/shader coordinate roundoff, not alternate weather"}
    return Report, {"Positions": Positions, "Spans": Spans, "PointDensity": Density, "SegmentM": SegmentM,
                    "Expected": Expected, "Actual": Actual}


# ------------------------------------------------------------------------------------------------------------------------
#                                              AUTHENTICATED REJECTED SOURCE VARIANT
# ------------------------------------------------------------------------------------------------------------------------


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--library", type=Path, required=True)
    Parser.add_argument("--noise", type=Path, required=True)
    Parser.add_argument("--slang", type=Path, default=Clouds.Root / "ExternalPackages/VulkanCompute/Slang/slangtorch/bin/slangc")
    Parser.add_argument("--out", type=Path, default=Clouds.Root / "_ClaudeScratch/tmp/CloudSolarDensity")
    Arguments = Parser.parse_args()
    Arguments.out.mkdir(parents=True, exist_ok=True)
    OriginalSource, OriginalQuery = Clouds.Source, Clouds.QuerySourceIdentity
    SourceIdentity = OriginalQuery()
    Native = Clouds.NativeIntegration(Arguments.library.resolve(), Arguments.noise.resolve())
    Corrected, Arrays = SolarDensityMeasurement(Native)
    if Corrected["max_abs_optical_depth_difference"] >= 0.01:
        raise AssertionError("solar integration does not match the visible world-density field")
    RejectedSource = Path(__file__).with_name("RejectedSolarWeather.slang")
    try:
        with TemporaryDirectory(dir=Clouds.Root / "_ClaudeScratch/tmp") as Temporary:
            Source = Path(Temporary) / "Source"
            shutil.copytree(OriginalSource, Source, ignore=shutil.ignore_patterns("__pycache__"))
            Transport = Source / "CloudTransport.slang"
            Text = Transport.read_text()
            Near = Text.index("float IntegrateCloudSolarDepth(")
            Far = Text.index("float CloudSolarOpticalDepth(", Near)
            Transport.write_text(Text[:Near] + RejectedSource.read_text() + "\n" + Text[Far:])
            Paths = sorted(Source.glob("*.slang")) + [Source / "CloudNative.cpp", Source / "CloudNoiseVolume.h",
                                                       Path(__file__).with_name("BakeCloudNoise.cpp")]
            ControlIdentity = sha256(b"".join(PathName.read_bytes() for PathName in Paths)).hexdigest()
            Clouds.Source = Source
            Clouds.QuerySourceIdentity = lambda: ControlIdentity
            Library, Noise, Identity = Clouds.CompileNative(Arguments.slang)
            Control = Clouds.NativeIntegration(Library, Noise)
            Rejected, ControlArrays = SolarDensityMeasurement(Control)
            if Rejected["max_abs_optical_depth_difference"] <= 0.1:
                raise AssertionError("rejected endpoint-weather code did not reproduce the density disagreement")
            if not Np.array_equal(Arrays["Expected"], ControlArrays["Expected"]):
                raise AssertionError("the negative control changed the reference world-density samples")
    finally:
        Clouds.Source, Clouds.QuerySourceIdentity = OriginalSource, OriginalQuery
    Arrays["Rejected"] = ControlArrays["Actual"]
    Np.savez_compressed(Arguments.out / "SolarDensity.npz", **Arrays)
    Report = {"source_sha256": SourceIdentity, "tests_passed": True, "corrected": Corrected, "rejected": Rejected,
              "control_source_sha256": ControlIdentity, "control_fragment_sha256": sha256(RejectedSource.read_bytes()).hexdigest(),
              "library_sha256": Native.LibraryIdentity, "noise_sha256": Native.NoiseIdentity,
              "source_isolation": "temporary copy; replace only the solar integration function, authenticate the resulting variant identity",
              "photorealism_accepted": False, "production_accepted": False}
    (Arguments.out / "SolarDensity.json").write_text(json.dumps(Report, indent=2) + "\n")
    print(json.dumps(Report, indent=2))


if __name__ == "__main__":
    Main()
