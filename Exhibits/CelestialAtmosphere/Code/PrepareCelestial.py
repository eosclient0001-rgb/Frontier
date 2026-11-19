# ============================================================================================================================================
#                                                            PREPARECELESTIAL.PY
# ============================================================================================================================================
# 🧩 Decode the retained Moon JPEG and rasterize pinned equatorial Milky Way contours without inventing a replacement sky map.

from pathlib import Path
import argparse
import hashlib
import json

import numpy as Numpy
from PIL import Image, ImageChops, ImageDraw

Root = Path(__file__).resolve().parents[3]


def Digest(Location):
    return hashlib.sha256(Location.read_bytes()).hexdigest()


# ------------------------------------------------------------------------------------------------------------------------
#                                                 EXTERNAL CONTENT DECODE / PROVENANCE
# ------------------------------------------------------------------------------------------------------------------------

def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("Destination", type=Path)
    Arguments = Parser.parse_args()
    Arguments.Destination.mkdir(parents=True, exist_ok=True)
    Moon = Root / "EngineContent/CelestialMaps/MoonAlbedoSource2048.jpg"
    Contours = Root / "Experimental/CelestialAtmosphere/Content/MilkyWayContours.json"
    assert Digest(Contours) == "aee221a7a0e879418e685de00c3e68fbdfac5667c0a8aab74929ef9cf4aab4fb"
    Source = Image.open(Moon).convert("RGB")
    assert Source.size == (2048, 1024)
    Source.save(Arguments.Destination / "MoonAlbedo2048.ppm")
    Width, Height = 1024, 512
    Field = Numpy.zeros((Height, Width), dtype=Numpy.float32)
    Coverage = []
    Features = json.loads(Contours.read_bytes())["features"]
    for Feature, Weight in zip(Features, [.12, .18, .22, .25, .23]):
        PolygonMask = Image.new("1", (Width, Height))
        for Polygon in Feature["geometry"]["coordinates"]:
            for Ring in Polygon:
                Coordinates = Numpy.asarray(Ring, dtype=Numpy.float64)
                Longitude = Numpy.degrees(Numpy.unwrap(Numpy.radians(Coordinates[:, 0])))
                Points = Numpy.stack(((Longitude + 180) / 360 * Width,
                                      (90 - Coordinates[:, 1]) / 180 * Height), axis=1)
                # Circumpolar rings wind once around RA. Close both outer and hole rings at
                # the same pole before parity fill; closing across the map invents off-plane light.
                if abs(Longitude[-1] - Longitude[0]) > 180:
                    Points = Numpy.concatenate((Points, [[Points[-1, 0], 0], [Points[0, 0], 0]]))
                RingMask = Image.new("1", (Width, Height))
                Pen = ImageDraw.Draw(RingMask)
                for Shift in range(-2, 3):
                    Pen.polygon([(float(X + Shift * Width), float(Y)) for X, Y in Points], fill=1)
                PolygonMask = ImageChops.logical_xor(PolygonMask, RingMask)
        Pixels = Numpy.asarray(PolygonMask).astype(Numpy.float32)
        Field += Pixels * Weight
        Coverage.append({"id": Feature["id"], "fraction": float(Pixels.mean()), "weight": Weight})
    # Smooth assigned surface photometry, not catalogue positions; wrap right ascension across the seam.
    Kernel = Numpy.exp(-.5 * (Numpy.arange(-6, 7, dtype=Numpy.float32) / 1.7) ** 2)
    Kernel /= Kernel.sum()
    Field = sum(Weight * Numpy.roll(Field, Shift, axis=1) for Shift, Weight in zip(range(-6, 7), Kernel))
    Padded = Numpy.pad(Field, ((6, 6), (0, 0)), mode="edge")
    Field = sum(Weight * Padded[Shift:Shift + Height] for Shift, Weight in enumerate(Kernel)).astype(Numpy.float32)
    Field.tofile(Arguments.Destination / "MilkyWay1024x512.f32")
    Image.fromarray(Numpy.rint(Numpy.clip(Field, 0, 1) * 255).astype(Numpy.uint8)).save(Arguments.Destination / "MilkyWayContours.png")
    Manifest = {"moon_source": str(Moon.relative_to(Root)), "moon_source_sha256": Digest(Moon),
                "moon_extent": list(Source.size), "moon_ppm_sha256": Digest(Arguments.Destination / "MoonAlbedo2048.ppm"),
                "contours_source": str(Contours.relative_to(Root)), "contours_sha256": Digest(Contours),
                "contours_revision": "7e720a3de062059d4c5400a379146a601d9010e0", "galaxy_extent": [Width, Height],
                "galaxy_linear_field_sha256": Digest(Arguments.Destination / "MilkyWay1024x512.f32"),
                "layers": Coverage, "coordinates": "J2000 equatorial longitude [-180,180], north at row zero",
                "galaxy_photometry": "Assigned contour surface brightness, 0.60-degree Gaussian smoothing; not a measured HDR panorama"}
    (Arguments.Destination / "CelestialInputs.json").write_text(json.dumps(Manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(Manifest))


if __name__ == "__main__":
    Execute()
