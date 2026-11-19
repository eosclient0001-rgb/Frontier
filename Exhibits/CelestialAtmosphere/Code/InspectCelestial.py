# ============================================================================================================================================
#                                                            INSPECTCELESTIAL.PY
# ============================================================================================================================================
# 🧩 Independently inspect complete Float32 captures, catalogue flux/coordinates, lunar texture samples and authentic galactic geometry.

from pathlib import Path
import argparse
import csv
import hashlib
import json
import math
import re
import shutil
import subprocess

import astropy.units as Units
from astropy.coordinates import AltAz, EarthLocation, ICRS, SkyCoord
from astropy.time import Time
from astropy.utils import iers
import numpy as Numpy
from PIL import Image, ImageDraw, ImageFont

Root = Path(__file__).resolve().parents[3]
iers.conf.auto_download = False


def Sha(Location):
    return hashlib.sha256(Location.read_bytes()).hexdigest()


def Assert(Condition, Description):
    if not Condition:
        raise AssertionError(Description)


def SaveJson(Location, Contents):
    Location.write_text(json.dumps(Contents, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def Display(Radiance, Exposure):
    Exposed = Numpy.maximum(0, Radiance.astype(Numpy.float64) * Exposure)
    Mapped = Numpy.clip(Exposed * (2.51 * Exposed + .03) / (Exposed * (2.43 * Exposed + .59) + .14), 0, 1)
    Encoded = Numpy.where(Mapped <= .0031308, 12.92 * Mapped, 1.055 * Mapped ** (1 / 2.4) - .055)
    return Image.fromarray(Numpy.rint(Encoded * 255).astype(Numpy.uint8))


def Rays(Capture, X, Y):
    Width, Height = Capture["extent"]
    Tangent = Capture["tangent"]
    Directions = (Numpy.asarray(Capture["forward"]) +
                  Numpy.asarray(Capture["right"]) * ((2 * Numpy.asarray(X) / Width - 1) * Tangent * Width / Height)[..., None] +
                  Numpy.asarray(Capture["up"]) * ((1 - 2 * Numpy.asarray(Y) / Height) * Tangent)[..., None])
    return Directions / Numpy.linalg.norm(Directions, axis=-1)[..., None]


def SolidAngles(Capture):
    Width, Height = Capture["extent"]
    X, Y = Numpy.meshgrid(Numpy.arange(Width) + .5, Numpy.arange(Height) + .5)
    Tangent = Capture["tangent"]
    Squared = ((2 * X / Width - 1) * Tangent * Width / Height) ** 2 + ((1 - 2 * Y / Height) * Tangent) ** 2
    return 4 * Tangent ** 2 * Width / Height / (Width * Height * (1 + Squared) ** 1.5)


def Bilinear(Field, X, Y, Wrap=False):
    Height, Width = Field.shape[:2]
    LowX, LowY = Numpy.floor(X).astype(int), Numpy.floor(Y).astype(int)
    Fx, Fy = Numpy.asarray(X) - LowX, Numpy.asarray(Y) - LowY
    if Field.ndim == 3:
        Fx, Fy = Fx[..., None], Fy[..., None]
    Result = 0.
    for Vertical in range(2):
        for Horizontal in range(2):
            Column = (LowX + Horizontal) % Width if Wrap else Numpy.clip(LowX + Horizontal, 0, Width - 1)
            Row = Numpy.clip(LowY + Vertical, 0, Height - 1)
            Result += Field[Row, Column] * (Fx if Horizontal else 1 - Fx) * (Fy if Vertical else 1 - Fy)
    return Result


# ------------------------------------------------------------------------------------------------------------------------
#                                                  SAME-TEXTURE LUNAR IMAGE CHECK
# ------------------------------------------------------------------------------------------------------------------------

def VerifyMoon(Captures, Raw):
    Source = Numpy.asarray(Image.open(Root / "EngineContent/CelestialMaps/MoonAlbedoSource2048.jpg").convert("RGB"), float) / 255
    Linear = Numpy.where(Source <= .04045, Source / 12.92, ((Source + .055) / 1.055) ** 2.4)
    MaximumError, Fractions = 0., {}
    for Slug in ["MoonFull", "MoonQuarter", "MoonCrescent"]:
        C, Actual = Captures[Slug], Raw[Slug]
        Width, Height = C["extent"]
        X, Y = Numpy.meshgrid(Numpy.arange(13, Width, 13) + .5, Numpy.arange(11, Height, 11) + .5)
        X, Y = X.ravel(), Y.ravel()
        Moon = Numpy.asarray(C["moon"])
        North = Numpy.array([0., 0., 1.]); North -= Moon * Numpy.dot(Moon, North); North /= Numpy.linalg.norm(North)
        East = Numpy.cross(Moon, North)
        Sun = Numpy.asarray(C["sun"])
        Phase = Numpy.arccos(Numpy.clip(-Numpy.dot(Moon, Sun), -1, 1))
        Expected = Numpy.zeros((len(X), 3))
        for Vertical in range(4):
            for Horizontal in range(4):
                Direction = Rays(C, X + (Horizontal + .5) / 4 - .5, Y + (Vertical + .5) / 4 - .5)
                A, B = Direction @ East / math.sin(C["moon_radius_rad"]), Direction @ North / math.sin(C["moon_radius_rad"])
                Coverage = A * A + B * B <= 1
                Toward = Numpy.sqrt(Numpy.maximum(0, 1 - A * A - B * B))
                Longitude, Latitude = Numpy.arctan2(A, Toward), Numpy.arcsin(Numpy.clip(B, -1, 1))
                Albedo = Bilinear(Linear, Numpy.mod((Longitude + math.pi) / (2 * math.pi), 1) * 2048 - .5,
                                 (.5 - Latitude / math.pi) * 1024 - .5, True)
                Normal = A[:, None] * East + B[:, None] * North - Toward[:, None] * Moon
                Incidence = Numpy.maximum(0, Normal @ Sun)
                Law = 2 * Incidence / Numpy.maximum(1e-20, Incidence + Numpy.maximum(Toward, 1e-4))
                Expected += Albedo * (Coverage * Law * Numpy.exp(-1.10 * Phase) / math.pi / 16)[:, None]
        Selected = Actual[1, Y.astype(int), X.astype(int), :3]
        Error = float(Numpy.max(Numpy.abs(Expected - Selected)))
        if Error >= .00015:
            Index = Numpy.unravel_index(Numpy.argmax(Numpy.abs(Expected - Selected)), Expected.shape)
            print("Moon image mismatch", Slug, Error, "sample", X[Index[0]], Y[Index[0]], "expected", Expected[Index], "actual", Selected[Index])
        MaximumError = max(MaximumError, Error)
        Interior = Actual[1, :, :, 3] > .999
        Lit = Numpy.max(Actual[1, :, :, :3], axis=-1) > 1e-12
        Fraction = float(Numpy.count_nonzero(Lit & Interior) / Numpy.count_nonzero(Interior))
        ExpectedFraction = .5 * (1 + math.cos(Phase))
        Assert(abs(Fraction - ExpectedFraction) < .025, f"{Slug} has wrong illuminated geometry")
        Fractions[Slug] = {"observed_lit_area": Fraction, "geometric_lit_area": ExpectedFraction}
    Assert(MaximumError < .00015, "Full GPU lunar image does not match original JPEG decoded to linear light")
    Gas = Raw["MoonExospherePhysical"][2, :, :, :3]
    Assert(float(Gas.max()) > 0 and float(Gas.max()) < 1e-12, "Nominal lunar gas is missing or implausibly opaque")
    C = Captures["MoonExosphereAmplified"]
    Reconstructed = Raw["MoonExosphereAmplified"][1, :, :, :3] + Gas * C["exosphere_display_gain"]
    Error = float(Numpy.max(Numpy.abs(Reconstructed - Raw["MoonExosphereAmplified"][0, :, :, :3])))
    Assert(Error < 1e-6, "Amplified lunar diagnostic changed physical coefficients instead of display gain")
    return {"full_image_texture_sample_max_error": MaximumError, "phases": Fractions,
            "nominal_exosphere_max_radiance": float(Gas.max()), "diagnostic_radiance_gain": C["exosphere_display_gain"],
            "diagnostic_reconstruction_error": Error}


# ------------------------------------------------------------------------------------------------------------------------
#                                             CATALOGUE PHOTOMETRY / INDEPENDENT ASTROMETRY
# ------------------------------------------------------------------------------------------------------------------------

def VerifyStars(Captures, Raw, Directory):
    C = Captures["CatalogueStarsSpace"]
    Table = Numpy.genfromtxt(Directory / "ProjectedStars.csv", delimiter=",", names=True)
    Direction = Numpy.stack([Table[Name] for Name in ["east", "north", "up"]], axis=-1)
    Depth = Direction @ Numpy.asarray(C["forward"])
    X = (.5 + .5 * (Direction @ Numpy.asarray(C["right"])) / (Depth * C["tangent"] * 480 / 270)) * 480
    Y = (.5 - .5 * (Direction @ Numpy.asarray(C["up"])) / (Depth * C["tangent"])) * 270
    ProjectionError = float(max(Numpy.max(Numpy.abs(X - Table["pixel_x"])), Numpy.max(Numpy.abs(Y - Table["pixel_y"]))))
    Assert(ProjectionError < .001, "Actual GPU stellar projection is not the capture camera")
    ExpectedFlux = 10 ** (-.4 * 26.74) * 10 ** (-.4 * Table["magnitude"])
    FluxError = float(Numpy.max(Numpy.abs(Table["flux"] / ExpectedFlux - 1)))
    Assert(FluxError < 3e-6, "Magnitude-to-irradiance conversion changed in the real shader")
    Luminance = Table["linear_r"] * .2126 + Table["linear_g"] * .7152 + Table["linear_b"] * .0722
    Assert(float(Numpy.max(Numpy.abs(Luminance - 1))) < 5e-7, "B-V colour changes visual stellar flux")
    ExpectedFieldFlux = 0.
    for Row in Table:
        MassX = .5 * (math.erf((480 - Row["pixel_x"]) / (math.sqrt(2) * .75)) - math.erf(-Row["pixel_x"] / (math.sqrt(2) * .75)))
        MassY = .5 * (math.erf((270 - Row["pixel_y"]) / (math.sqrt(2) * .75)) - math.erf(-Row["pixel_y"] / (math.sqrt(2) * .75)))
        ExpectedFieldFlux += Row["flux"] * MassX * MassY
    ImageLuminance = Raw["CatalogueStarsSpace"][0, :, :, :3] @ Numpy.array([.2126, .7152, .0722])
    ObservedFieldFlux = float(Numpy.sum(ImageLuminance * SolidAngles(C)))
    FieldFluxError = abs(ObservedFieldFlux / ExpectedFieldFlux - 1)
    Assert(FieldFluxError < 2e-5, "Full-image star PSFs lose flux at bin, pixel or image boundaries")
    # Recover the J2000 sources through the retained orthogonal decoder basis, then independently use ERFA.
    Equatorial = Direction @ Numpy.asarray(C["equatorial_to_local"]).T
    Equatorial /= Numpy.linalg.norm(Equatorial, axis=-1)[:, None]
    Stars = SkyCoord(x=Equatorial[:, 0] * Units.one, y=Equatorial[:, 1] * Units.one,
                     z=Equatorial[:, 2] * Units.one, representation_type="cartesian", frame="icrs")
    Epoch = Time(C["julian_utc"], format="jd", scale="utc")
    Location = EarthLocation.from_geodetic(C["longitude_deg"] * Units.deg, C["latitude_deg"] * Units.deg, 0 * Units.m)
    Independent = Stars.transform_to(AltAz(obstime=Epoch, location=Location, pressure=0 * Units.hPa))
    Altitude, Azimuth = Independent.alt.rad, Independent.az.rad
    Reference = Numpy.stack([Numpy.cos(Altitude) * Numpy.sin(Azimuth), Numpy.cos(Altitude) * Numpy.cos(Azimuth),
                             Numpy.sin(Altitude)], axis=-1)
    Error = Numpy.degrees(Numpy.arctan2(Numpy.linalg.norm(Numpy.cross(Reference, Direction), axis=-1), Numpy.sum(Reference * Direction, axis=-1)))
    Assert(float(Error.max()) < .03, "Rendered catalogue directions fail independent Astropy/ERFA")
    Catalogue = Numpy.genfromtxt(Root / "Exhibits/NightSky/Data/Hipparcos8.csv", delimiter=",", names=True, skip_header=1)
    # Every rendered vector must round back to an actual retained catalogue coordinate, not a synthetic insertion.
    Keys = {}
    for Index, Row in enumerate(Catalogue):
        Key = (int(math.floor(float(Row["ra_deg"]) * 1000)), int(math.floor(float(Row["dec_deg"]) * 1000)))
        Keys.setdefault(Key, []).append(Index)
    Ra, Dec = Numpy.radians(Catalogue["ra_deg"]), Numpy.radians(Catalogue["dec_deg"])
    CatalogueDirections = Numpy.stack([Numpy.cos(Ra) * Numpy.cos(Dec), Numpy.sin(Ra) * Numpy.cos(Dec), Numpy.sin(Dec)], axis=-1)
    RightAscension = Numpy.degrees(Numpy.arctan2(Equatorial[:, 1], Equatorial[:, 0])) % 360
    Declination = Numpy.degrees(Numpy.arcsin(Equatorial[:, 2]))
    Matches = 0
    for Index, (Ra, Dec) in enumerate(zip(RightAscension, Declination)):
        X, Y = int(math.floor(float(Ra) * 1000)), int(math.floor(float(Dec) * 1000))
        Candidates = [Entry for Dx in [-1, 0, 1] for Dy in [-1, 0, 1] for Entry in Keys.get(((X + Dx) % 360000, Y + Dy), [])]
        if Candidates:
            Distance = Numpy.linalg.norm(CatalogueDirections[Candidates] - Equatorial[Index], axis=-1)
            Nearest = Candidates[int(Numpy.argmin(Distance))]
            if Distance.min() < 5e-7 and abs(Catalogue["mag"][Nearest] - Table["magnitude"][Index]) < 5e-6:
                Matches += 1
    Assert(Matches == len(Table), "Rendered stars do not correspond one for one to the retained measured catalogue")
    return {"projected_sources": len(Table), "catalogue_coordinate_rounding_matches": Matches,
            "gpu_projection_max_pixels": ProjectionError, "per_source_relative_flux_error": FluxError,
            "integrated_image_relative_flux_error": FieldFluxError, "astropy_max_deg": float(Error.max()),
            "astropy_mean_deg": float(Error.mean()), "proper_motion_refraction_parallax": "not modeled"}


def VerifyGalaxy(Directory, Inputs):
    Table = Numpy.genfromtxt(Directory / "GalaxyProbes.csv", delimiter=",", names=True)
    Equatorial = SkyCoord(x=Table["equatorial_x"] * Units.one, y=Table["equatorial_y"] * Units.one,
                          z=Table["equatorial_z"] * Units.one, representation_type="cartesian", frame=ICRS())
    Expected = Equatorial.galactic.cartesian.xyz.value.T
    Actual = Numpy.stack([Table[Name] for Name in ["gpu_galactic_x", "gpu_galactic_y", "gpu_galactic_z"]], axis=-1)
    RotationError = float(Numpy.max(Numpy.linalg.norm(Expected - Actual, axis=-1)))
    Assert(RotationError < 5e-7, "Actual shader galactic axes disagree with Astropy ICRS-to-Galactic")
    Field = Numpy.fromfile(Inputs / "MilkyWay1024x512.f32", "<f4").reshape(512, 1024)
    Y, X = Numpy.meshgrid(Numpy.arange(512), Numpy.arange(1024), indexing="ij")
    Sky = SkyCoord(ra=((X + .5) * 360 / 1024 - 180) * Units.deg,
                   dec=(90 - (Y + .5) * 180 / 512) * Units.deg, frame="icrs")
    Latitude = Numpy.abs(Sky.galactic.b.deg)
    Weight = Field * Numpy.cos(Sky.dec.rad)
    MeanLatitude = float(Numpy.sum(Latitude * Weight) / Numpy.sum(Weight))
    OffPlane = float(Numpy.sum(Weight[Latitude > 20]) / Numpy.sum(Weight))
    Assert(MeanLatitude < 8 and OffPlane < .01, "Pinned equatorial contours are mirrored or placed off the real Milky Way")
    return {"gpu_rotation_astropy_vector_error": RotationError, "contour_weighted_abs_galactic_latitude_deg": MeanLatitude,
            "brightness_fraction_above_20deg_galactic_latitude": OffPlane,
            "photometry": "assigned surface brightness on Jose R. Vieira/d3-celestial outlines; not a measured panorama"}


# ------------------------------------------------------------------------------------------------------------------------
#                                                   IMAGE / RESULTS PRESENTATION
# ------------------------------------------------------------------------------------------------------------------------

def Font(Size):
    Location = Root / "EngineContent/FontArchives/Inter/Inter-Regular.ttf"
    if not Location.exists():
        Candidates = list((Root / "EngineContent/FontArchives").rglob("*Regular.ttf"))
        Location = Candidates[0] if Candidates else None
    return ImageFont.truetype(str(Location), Size) if Location else ImageFont.load_default(size=Size)


def Sheet(Location, Captures, Selected, Images, Columns, Heading, Subheading):
    Width, Height, Gap, Top = 400, 225, 16, 100
    Rows = (len(Selected) + Columns - 1) // Columns
    Canvas = Image.new("RGB", (Columns * (Width + Gap) + Gap, Top + Rows * (Height + 57) + 26), "#0a111d")
    Pen = ImageDraw.Draw(Canvas)
    Pen.text((Gap, 19), Heading, font=Font(29), fill="#f3f6fb")
    Pen.text((Gap, 61), Subheading, font=Font(14), fill="#a9bbd2")
    for Index, Slug in enumerate(Selected):
        X, Y = Gap + (Index % Columns) * (Width + Gap), Top + (Index // Columns) * (Height + 57)
        ImagePath = Images / f"{Slug}.png"
        Canvas.paste(Image.open(ImagePath).resize((Width, Height), Image.Resampling.LANCZOS), (X, Y))
        Short = {"MoonFull": "Moon / retained 2K texture", "MoonQuarter": "Quarter / Lommel-Seeliger surface",
                 "MoonCrescent": "Crescent / geometric lunar phase", "MoonExospherePhysical": "Exosphere / nominal density (invisible)",
                 "MoonExosphereAmplified": "Exosphere / x1e14 RADIANCE DIAGNOSTIC", "SunDisc": "Sun / limb darkening and radial falloff",
                 "SolarCorona": "Corona / occulted disc, no density boost", "CatalogueGalaxySpace": "Hipparcos + authentic Milky Way contours",
                 "CatalogueGalaxySurface": "Night stars / atmospheric extinction",
                 "FlareApertureGhosts": "Aperture ghosts", "FlareDiffraction": "Diffraction starburst",
                 "FlareAnamorphic": "Anamorphic streak", "FlareAntipodeHalo": "Antipode halo",
                 "FlareVeilingGlare": "Veiling glare", "FlareCombined": "Five components / additive irradiance"}
        SkyNames = {"BeforeSunrise": "Before sunrise (nautical twilight)", "Dawn": "Dawn (civil twilight)",
                    "Sunrise": "Sunrise (geometric centre)", "Zenith": "Zenith (subsolar calibration)",
                    "Sunset": "Sunset (geometric centre)", "Dusk": "Dusk (civil twilight)"}
        Caption = Short.get(Slug, Captures[Slug]["title"])
        for View in ["Surface", "Orbit"]:
            if Slug.startswith(View) and Slug[len(View):] in SkyNames:
                Caption = ("Surface" if View == "Surface" else "400 km orbit") + " / " + SkyNames[Slug[len(View):]]
        Assert(Pen.textlength(Caption, font=Font(14)) <= Width, f"Contact sheet caption is clipped: {Slug}")
        Pen.text((X, Y + Height + 8), Caption, font=Font(14), fill="#d7e3f3")
        C = Captures[Slug]
        Detail = f"480 x 270 native / display exposure {C['exposure']:g}"
        if Slug.startswith(("Surface", "Orbit")):
            Detail = f"Sun {math.degrees(math.asin(C['sun'][2])):+.1f} deg / {C['camera_km'][2] - 6360:g} km / exposure {C['exposure']:g}"
        Pen.text((X, Y + Height + 29), Detail, font=Font(12), fill="#8299b5")
    Canvas.save(Location, optimize=True)


def Execute():
    Parser = argparse.ArgumentParser()
    Parser.add_argument("Directory", type=Path)
    Parser.add_argument("--inputs", type=Path, required=True)
    Parser.add_argument("--build", type=Path, required=True)
    Parser.add_argument("--retain", type=Path, default=Root / "Exhibits/CelestialAtmosphere")
    Arguments = Parser.parse_args()
    Directory, Destination = Arguments.Directory, Arguments.retain
    Results, Images = Destination / "Results", Destination / "Images"
    Results.mkdir(parents=True, exist_ok=True); Images.mkdir(parents=True, exist_ok=True)
    Report = json.loads((Directory / "CelestialVulkan.json").read_text())
    Assert(Report["passed"] and len(Report["executed_entries"]) == 10, "Missing actual scoped GPU verification")
    Captures = {Capture["slug"]: Capture for Capture in Report["captures"]}
    Assert(len(Captures) == 30, "Every requested native scene must be captured")
    Raw, Evidence, ProbeArchive = {}, [], {}
    for Slug, C in Captures.items():
        Location = Directory / "Renders" / f"{Slug}.f32"
        Width, Height = C["extent"]
        A = Numpy.fromfile(Location, "<f4").reshape(C["planes"], Height, Width, 4)
        Assert(Numpy.isfinite(A).all() and Numpy.min(A[:, :, :, :3]) >= 0, f"Invalid native pixels in {Slug}")
        Raw[Slug] = A
        ImagePath = Images / f"{Slug}.png"
        Display(A[0, :, :, :3], C["exposure"]).save(ImagePath, optimize=True)
        if Slug.startswith("Flare"):
            Display(A[1, :, :, :3], C["exposure"]).save(Images / f"{Slug}Isolated.png", optimize=True)
        if Slug.startswith(("Surface", "Orbit")):
            Assert(float(A[1, :, :, :3].max()) > 1e-8, f"Atmosphere is absent in {Slug}")
            Assert(float(A[2, :, :, :3].min()) >= 0 and float(A[2, :, :, :3].max()) <= 1.00001, "Invalid camera transmission")
        # Identical stratified complete RGB(A) values, not 8-bit screenshots, remain available for every view/layer.
        Indices = (Numpy.arange(1024, dtype=Numpy.uint32) * 7919 + 36347) % (Width * Height)
        ProbeArchive[f"{Slug}Indices"] = Indices
        ProbeArchive[Slug] = A.reshape(C["planes"], -1, 4)[:, Indices, :]
        Evidence.append({**C, "native_float_sha256": Sha(Location), "png_sha256": Sha(ImagePath),
                         "image": f"Images/{Slug}.png", "native_float_retention": "1024 RGBA probes per layer; selected full planes in NativeRadiance.npz"})
    Moon = VerifyMoon(Captures, Raw)
    Stars = VerifyStars(Captures, Raw, Directory)
    Galaxy = VerifyGalaxy(Directory, Arguments.inputs)
    SolarFlux = Numpy.sum(Raw["SunDisc"][1, :, :, :3] * SolidAngles(Captures["SunDisc"])[:, :, None], axis=(0, 1))
    Assert(float(Numpy.max(Numpy.abs(SolarFlux - 1))) < .015, "Complete solar disc does not conserve its declared unit irradiance")
    FlareNames = ["ApertureGhosts", "Diffraction", "Anamorphic", "AntipodeHalo", "VeilingGlare"]
    FlareSum = sum(Raw[f"Flare{Name}"][1, :, :, :3] for Name in FlareNames)
    LensError = float(Numpy.max(Numpy.abs(FlareSum - Raw["FlareCombined"][1, :, :, :3])))
    Assert(LensError < 1e-6 and Numpy.max(Raw["FlareOccluded"][:, :, :, :3]) == 0, "Full-image flare additivity/occlusion failed")
    for Slug, Plane in [("MoonFull", 0), ("MoonExospherePhysical", 2), ("SunDisc", 1), ("SolarCorona", 0), ("CatalogueStarsSpace", 0)]:
        ProbeArchive[f"Full{Slug}"] = Raw[Slug][Plane]
    ProbeArchive["AtmosphericTables"] = Numpy.fromfile(Directory / "AtmosphericTables.f32", "<f4").reshape(-1, 4)
    Numpy.savez_compressed(Results / "NativeRadiance.npz", **ProbeArchive)
    for Name in ["CelestialVulkan.json", "GalaxyProbes.csv", "ScatteringProbes.csv"]:
        shutil.copyfile(Directory / Name, Results / Name)
    # Catalogue rows are retained losslessly in a compressed float64 table to avoid a duplicate multi-megabyte CSV.
    StellarTable = Numpy.genfromtxt(Directory / "ProjectedStars.csv", delimiter=",", names=True)
    Numpy.savez_compressed(Results / "ProjectedStars.npz", rows=StellarTable)
    shutil.copyfile(Arguments.inputs / "CelestialInputs.json", Results / "CelestialInputs.json")
    Summary = {"passed": True, "capture_count": len(Captures), "native_dimensions": [480, 270],
               "moon": Moon, "stars": Stars, "galaxy": Galaxy, "solar_integrated_irradiance_rgb": SolarFlux.tolist(),
               "five_flare_full_image_addition_error": LensError, "occluded_flare_rgb_max": 0,
               "display": "ACES fitted curve then IEC sRGB, with each declared photographic exposure; no AI imagery",
               "production_accepted": False, "windows_physical_gpu_editor_realtime": "not tested"}
    SaveJson(Results / "CelestialInspection.json", Summary)
    SaveJson(Destination / "Captures.json", Evidence)
    Sky = [f"{View}{Moment}" for Moment in ["BeforeSunrise", "Dawn", "Sunrise", "Zenith", "Sunset", "Dusk"] for View in ["Surface", "Orbit"]]
    Sheet(Images / "SkyStates.png", Captures, Sky, Images, 2, "Six skies / surface and orbit", "Actual Slang / Vulkan readbacks - Rayleigh, aerosols and ozone - 480 x 270 native - SwiftShader CPU")
    Celestial = ["MoonFull", "MoonQuarter", "MoonCrescent", "MoonExospherePhysical", "MoonExosphereAmplified", "SunDisc", "SolarCorona", "CatalogueGalaxySpace", "CatalogueGalaxySurface"]
    Sheet(Images / "CelestialOverview.png", Captures, Celestial, Images, 3, "Celestial atmosphere / verified renders", "Same Moon texture - nominal lunar gas plus labelled x1e14 diagnostic - finite Sun/corona - measured Hipparcos catalogue")
    Sheet(Images / "FiveFlares.png", Captures, [f"Flare{Name}" for Name in FlareNames] + ["FlareCombined"], Images, 3,
          "Five lens-flare types", "Aperture ghosts / diffraction / anamorphic streak / antipode halo / veiling glare - parametric, unmeasured lens")
    Dependencies = list((Root / "Experimental/CelestialAtmosphere").rglob("*")) + list((Root / "Exhibits/CelestialAtmosphere/Code").glob("*"))
    Dependencies += [Root / "Frontier/Engine/Rendering" / Name for Name in ["AtmosphereModel.h", "AtmosphereModel.cpp", "CelestialModel.h", "CelestialModel.cpp", "LensFlareModel.h", "SolarOpticsPayload.h", "Shaders/SolarOptics.slang"]]
    Dependencies += [Root / "Exhibits/NightSky/Data/Hipparcos8.csv",
                     Root / "EngineContent/CelestialMaps/MoonAlbedoSource2048.jpg",
                     Root / "EngineContent/CelestialMaps/MoonAlbedoProvenance.md",
                     Root / "Exhibits/Renderer/Code/VulkanReadback.h",
                     Root / "Frontier/Engine/Rendering/ClusterNesting.h",
                     Root / "Exhibits/CelestialAtmosphere/RunCelestial.sh",
                     Root / "Exhibits/CelestialAtmosphere/Requirements.txt"]
    Dependencies += [Root / "Exhibits/NightSky" / Name for Name in ["RunEphemerisValidation.sh",
                     "Code/StarCatalogueProbe.cpp", "Code/ValidateStarCatalogue.py",
                     "Code/EphemerisProbe.cpp", "Code/ValidateEphemeris.py"]]
    # Include transitive repository headers, not just the top-level files that directly own celestial math.
    Closure = {P.resolve() for P in Dependencies if P.is_file() and "__pycache__" not in str(P)}
    Pending = list(Closure)
    while Pending:
        Location = Pending.pop()
        if Location.suffix not in {".cpp", ".h", ".slang"}:
            continue
        for Include in re.findall(r'^\s*#include\s+"([^"]+)"', Location.read_text(), flags=re.MULTILINE):
            Candidates = [Location.parent / Include, Root / Include, Root / "Frontier" / Include]
            Resolved = next((P.resolve() for P in Candidates if P.is_file()), None)
            Assert(Resolved is not None, f"Repository include missing from source identities: {Location}: {Include}")
            Assert(Resolved.is_relative_to(Root), "Source include escapes the repository")
            if Resolved not in Closure:
                Closure.add(Resolved)
                Pending.append(Resolved)
    SourceHashes = {str(P.relative_to(Root)): Sha(P) for P in sorted(Closure)}
    ShaderHashes = {P.name: Sha(P) for P in sorted((Arguments.build / "Shaders").glob("*.spv"))}
    Assert(len(ShaderHashes) == 10, "Compiled shader identity count changed")
    for Location in sorted((Arguments.build / "Shaders").glob("*.spv")):
        Digest = 14695981039346656037
        for Byte in Location.read_bytes():
            Digest = ((Digest ^ Byte) * 1099511628211) & 0xffffffffffffffff
        Assert(str(Digest) == Report["spirv_fnv1a64"][Location.stem], f"Compiled shader differs from executed capture: {Location.name}")
    Reflection = {}
    for Location in sorted((Arguments.build / "Shaders").glob("*.spv.json")):
        Declaration = json.loads(Location.read_text())
        Slots = [P["binding"]["index"] for P in Declaration["parameters"] if P["binding"]["kind"] == "descriptorTableSlot"]
        Push = next(P for P in Declaration["parameters"] if P["name"] == "Extent")
        Size = next(S["value"] for S in Push["type"]["elementType"]["sizes"] if S["kind"] == "uniform")
        Assert(Slots == list(range(8)) and Size == 128 and Declaration["entryPoints"][0]["threadGroupSize"] == [64, 1, 1],
               "Slang reflection disagrees with guarded host ABI")
        Reflection[Location.name] = {"storage_slots": Slots, "push_bytes": Size, "group_size": [64, 1, 1]}
    Assert(len(Reflection) == 10, "Missing per-entry reflection validation")
    SaveJson(Results / "ShaderAbi.json", Reflection)
    Executable = Arguments.build / "CelestialVulkan"
    if not Executable.exists():
        Executable = Executable.with_suffix(".exe")
    Manifest = {"native_base_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Root, text=True).strip(),
                "working_tree_sources": SourceHashes, "compiled_spirv_sha256": ShaderHashes,
                "native_executable_sha256": Sha(Executable),
                "retained_files_sha256": {str(P.relative_to(Destination)): Sha(P) for P in sorted(Destination.rglob("*"))
                                           if P.is_file() and P.name not in {"Integrity.json", "CelestialEvidence.json"} and "Code" not in P.relative_to(Destination).parts}}
    SaveJson(Results / "Integrity.json", Manifest)
    print(json.dumps(Summary, indent=2))


if __name__ == "__main__":
    Execute()
