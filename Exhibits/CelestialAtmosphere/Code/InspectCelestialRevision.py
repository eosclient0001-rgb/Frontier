# ============================================================================================================================================
#                                                       INSPECTCELESTIALREVISION.PY
# ============================================================================================================================================
# 🧩 Verify the requested reference star field, finite anamorphic repair and distinct eight-point burst from complete native Float32 images.

from pathlib import Path
import math

import numpy as Numpy

Root = Path(__file__).resolve().parents[3]


def Assert(Condition, Description):
    if not Condition:
        raise AssertionError(Description)


def VerifyUpdatedStars(Captures, Raw, Directory, SolidAngles):
    Capture = Captures["CatalogueStarsSpace"]
    Table = Numpy.genfromtxt(Directory / "ProjectedUpdatedStars.csv", delimiter=",", names=True)
    Reference = Numpy.genfromtxt(Root / "Experimental/CelestialAtmosphere/Content/ReferenceStars.csv.gz", delimiter=",", names=True)
    Assert(len(Reference) == 15356 and Numpy.count_nonzero(Reference["authored"]) == 15200, "Requested upstream field coverage changed")
    Direction = Numpy.stack([Table[Name] for Name in ["east", "north", "up"]], axis=-1)
    Equatorial = Direction @ Numpy.asarray(Capture["equatorial_to_local"]).T
    Equatorial /= Numpy.linalg.norm(Equatorial, axis=-1)[:, None]
    RightAscension = Numpy.degrees(Numpy.arctan2(Equatorial[:, 1], Equatorial[:, 0])) % 360
    Declination = Numpy.degrees(Numpy.arcsin(Equatorial[:, 2]))
    ReferenceRa, ReferenceDec = Numpy.radians(Reference["ra_deg"]), Numpy.radians(Reference["dec_deg"])
    ReferenceDirections = Numpy.stack([Numpy.cos(ReferenceRa) * Numpy.cos(ReferenceDec),
                                       Numpy.sin(ReferenceRa) * Numpy.cos(ReferenceDec), Numpy.sin(ReferenceDec)], axis=-1)
    Keys = {}
    for Index, Row in enumerate(Reference):
        Key = (int(math.floor(Row["ra_deg"] * 1000)), int(math.floor(Row["dec_deg"] * 1000)))
        Keys.setdefault(Key, []).append(Index)
    Matches, AuthoredMatches = 0, 0
    for Index, (Ra, Dec) in enumerate(zip(RightAscension, Declination)):
        X, Y = int(math.floor(Ra * 1000)), int(math.floor(Dec * 1000))
        Candidates = [Entry for Dx in [-1, 0, 1] for Dy in [-1, 0, 1] for Entry in Keys.get(((X + Dx) % 360000, Y + Dy), [])]
        if not Candidates:
            continue
        Distances = Numpy.linalg.norm(ReferenceDirections[Candidates] - Equatorial[Index], axis=-1)
        Nearest = Candidates[int(Numpy.argmin(Distances))]
        if (Distances.min() < 5e-7 and abs(Reference["mag"][Nearest] - Table["magnitude"][Index]) < 5e-6 and
                abs(Reference["bv"][Nearest] - Table["bv"][Index]) < 5e-6 and Reference["authored"][Nearest] == Table["authored"][Index]):
            Matches += 1
            AuthoredMatches += int(Table["authored"][Index])
    Assert(Matches == len(Table), "Updated rendered stars are not the pinned reference catalogue or have lost provenance")
    Assert(AuthoredMatches == Capture["authored_projected_stars"] and AuthoredMatches > 1000, "Authored stars are missing or mislabelled")
    Width, Height = Capture["extent"]
    Depth = Direction @ Numpy.asarray(Capture["forward"])
    X = (.5 + .5 * (Direction @ Numpy.asarray(Capture["right"])) / (Depth * Capture["tangent"] * Width / Height)) * Width
    Y = (.5 - .5 * (Direction @ Numpy.asarray(Capture["up"])) / (Depth * Capture["tangent"])) * Height
    ProjectionError = float(max(Numpy.max(Numpy.abs(X - Table["pixel_x"])), Numpy.max(Numpy.abs(Y - Table["pixel_y"]))))
    Assert(ProjectionError < .001, "Updated GPU star projection is incorrect")
    Flux = 10 ** (-.4 * 26.74) * 10 ** (-.4 * Table["magnitude"])
    FluxError = float(Numpy.max(Numpy.abs(Table["flux"] / Flux - 1)))
    Assert(FluxError < 3e-6, "Updated reference magnitude-to-flux conversion changed")
    # Independent 8-node quadrature (shader uses four), original Gaussian analytic integral, and complete image reconstruction.
    Nodes, Weights = Numpy.polynomial.legendre.leggauss(8)
    Nodes *= .5
    Weights *= .5
    Expected = Numpy.zeros((Height, Width, 3))
    MissingTail = []
    for Row, Irradiance in zip(Table, Flux):
        Columns = Numpy.arange(math.floor(Row["pixel_x"]) - 12, math.floor(Row["pixel_x"]) + 13)
        Rows = Numpy.arange(math.floor(Row["pixel_y"]) - 12, math.floor(Row["pixel_y"]) + 13)
        Dx, Dy = Columns + .5 - Row["pixel_x"], Rows + .5 - Row["pixel_y"]
        GaussianX = Numpy.array([.5 * (math.erf((Delta + .5) / (math.sqrt(2) * .62)) -
                                      math.erf((Delta - .5) / (math.sqrt(2) * .62))) for Delta in Dx])
        GaussianY = Numpy.array([.5 * (math.erf((Delta + .5) / (math.sqrt(2) * .62)) -
                                      math.erf((Delta - .5) / (math.sqrt(2) * .62))) for Delta in Dy])
        Wing = Numpy.zeros((25, 25))
        for Vertical, Wy in zip(Nodes, Weights):
            for Horizontal, Wx in zip(Nodes, Weights):
                Squared = (Dy[:, None] + Vertical) ** 2 + (Dx[None, :] + Horizontal) ** 2
                Wing += Wy * Wx * 1.5 / (math.pi * 2.4 ** 2) * (1 + Squared / 2.4 ** 2) ** -2.5
        Mass = .82 * GaussianY[:, None] * GaussianX[None, :] + .18 * Wing
        MissingTail.append(1 - Mass.sum())
        VisibleX, VisibleY = (Columns >= 0) & (Columns < Width), (Rows >= 0) & (Rows < Height)
        Chromaticity = Numpy.array([Row["linear_r"], Row["linear_g"], Row["linear_b"]])
        Expected[Numpy.ix_(Rows[VisibleY], Columns[VisibleX])] += Mass[Numpy.ix_(VisibleY, VisibleX)][:, :, None] * Irradiance * Chromaticity
    Expected /= SolidAngles(Capture)[:, :, None]
    Actual = Raw["CatalogueStarsSpace"][0, :, :, :3]
    ImageError = float(Numpy.max(Numpy.abs(Expected - Actual)) / Expected.max())
    Assert(ImageError < 2e-5, "Full updated Gaussian/Moffat star image differs from independent pixel integration")
    Luminance = Numpy.array([.2126, .7152, .0722])
    ExpectedFlux = float(Numpy.sum((Expected @ Luminance) * SolidAngles(Capture)))
    ActualFlux = float(Numpy.sum((Actual @ Luminance) * SolidAngles(Capture)))
    ImageFluxError = abs(ActualFlux / ExpectedFlux - 1)
    Assert(ImageFluxError < 2e-5, "Updated full stellar image loses flux at pixel/tile boundaries beyond the declared finite support")
    Assert(0 < min(MissingTail) <= max(MissingTail) < .002, "Moffat support truncation is missing or larger than declared")
    NightViews = ["CatalogueStarsSpace", "CatalogueGalaxySpace", "CatalogueGalaxySurface", "GalaxyContoursSpace"]
    Assert(all(Captures[Name]["revised_stellar_psf"] and Captures[Name]["authored_catalogue_enabled"] for Name in NightViews),
           "Not all four requested night-sky presentations use the updated field and optics")
    Assert(not Captures["MeasuredCatalogueSpace"]["authored_catalogue_enabled"], "Measured-only validation contains authored stars")
    return {"reference_total": 15356, "reference_bright_stars": 156, "reference_authored_stars": 15200,
            "projected_sources": len(Table), "reference_coordinate_photometry_provenance_matches": Matches,
            "projected_authored_sources": AuthoredMatches, "gpu_projection_max_pixels": ProjectionError,
            "per_source_relative_flux_error": FluxError, "independent_full_image_relative_max_error": ImageError,
            "finite_support_image_relative_flux_error": ImageFluxError,
            "finite_25x25_support_omitted_flux_min": float(min(MissingTail)),
            "finite_25x25_support_omitted_flux_max": float(max(MissingTail)), "updated_night_views": NightViews,
            "photometry": "Reference 156 rounded bright-star entries plus 15200 authored points; not 15356 measured catalogue additions"}


def SampleBilinear(Plane, X, Y):
    LowX, LowY = Numpy.floor(X).astype(int), Numpy.floor(Y).astype(int)
    Fx, Fy = X - LowX, Y - LowY
    Result = Numpy.zeros_like(X)
    for Vertical in range(2):
        for Horizontal in range(2):
            Result += Plane[LowY + Vertical, LowX + Horizontal] * (Fx if Horizontal else 1 - Fx) * (Fy if Vertical else 1 - Fy)
    return Result


def CountRays(Capture, Radiance):
    Sun = Numpy.asarray(Capture["sun"])
    Depth = Sun @ Numpy.asarray(Capture["forward"])
    SunX = (Sun @ Numpy.asarray(Capture["right"])) / (Depth * Capture["tangent"])
    SunY = (Sun @ Numpy.asarray(Capture["up"])) / (Depth * Capture["tangent"])
    Width, Height = Capture["extent"]
    Angles = Numpy.arange(720) * 2 * math.pi / 720
    Profile = Numpy.zeros_like(Angles)
    for Radius in Numpy.linspace(.24, .36, 25):
        X = Width / 2 + (SunX + Radius * Numpy.cos(Angles)) * Height / 2 - .5
        Y = Height / 2 - (SunY + Radius * Numpy.sin(Angles)) * Height / 2 - .5
        Profile += SampleBilinear(Radiance[:, :, 1], X, Y)
    Profile = sum(Numpy.roll(Profile, Offset) * math.exp(-.5 * (Offset / 2) ** 2) for Offset in range(-6, 7))
    Peaks = (Profile > Numpy.roll(Profile, 1)) & (Profile >= Numpy.roll(Profile, -1)) & (Profile > Profile.max() * .1)
    return int(Peaks.sum())


def VerifyLensRevision(Captures, Raw, DiagnosticCaptures, Diagnostics):
    Fixed = Raw["FlareAnamorphic"][1, :, :, :3]
    Legacy = Diagnostics["AnamorphicLegacy"][1, :, :, :3]
    OldEdge = float(max(Legacy[:, 0].max(), Legacy[:, -1].max()) / Legacy.max())
    NewEdge = float(max(Fixed[:, 0].max(), Fixed[:, -1].max()) / Fixed.max())
    Assert(OldEdge > .1 and NewEdge < .01, "The reproduced edge-to-edge anamorphic defect was not repaired")
    Rotated = Diagnostics["AnamorphicRotated"][1, :, :, 2].astype(float)
    Y, X = Numpy.meshgrid(Numpy.arange(Rotated.shape[0]), Numpy.arange(Rotated.shape[1]), indexing="ij")
    X = X - Numpy.sum(X * Rotated) / Rotated.sum()
    Y = -(Y - Numpy.sum(Y * Rotated) / Rotated.sum())
    Angle = .5 * math.atan2(2 * float(Numpy.sum(X * Y * Rotated)), float(Numpy.sum((X * X - Y * Y) * Rotated)))
    Assert(abs(Angle - .4) < .01, "Rendered anamorphic repair does not rotate with the optical axis")
    Shifted = Diagnostics["AnamorphicSubpixel"][1, :, :, :3]
    TranslationError = abs(float(Shifted.sum(dtype=float) / Fixed.sum(dtype=float)) - 1)
    Assert(TranslationError < .01, "Anamorphic intensity flickers under a half-pixel source displacement")
    StarburstRays = CountRays(Captures["FlareStarburst"], Raw["FlareStarburst"][1, :, :, :3])
    DiffractionRays = CountRays(Captures["FlareDiffraction"], Raw["FlareDiffraction"][1, :, :, :3])
    Assert(StarburstRays == 8 and DiffractionRays == 6, "The sixth burst is not visibly distinct from six-ray diffraction")
    return {"reproduced_legacy_edge_to_peak_ratio": OldEdge, "repaired_edge_to_peak_ratio": NewEdge,
            "rotation_requested_rad": .4, "rotation_measured_rad": Angle,
            "half_pixel_translation_integrated_radiance_error": TranslationError,
            "sixth_starburst_measured_rays": StarburstRays, "original_diffraction_measured_rays": DiffractionRays,
            "diagnostic_captures": [Entry["slug"] for Entry in DiagnosticCaptures],
            "scope": "Actual isolated native Float32 lens planes; finite parametric coating streak, not measured camera calibration"}
