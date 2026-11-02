// Axisymmetric C-plane photometry. Angles are degrees from the downward axis.
export function ValidatePhotometrySamples(Points) {
  if (!Array.isArray(Points) || Points.length < 2 || Points.length > 1000) {
    throw Error("A profile needs 2–1000 samples.");
  }

  let PreviousAngle = -1;
  for (const Point of Points) {
    if (
      !Number.isFinite(Point.angle) ||
      !Number.isFinite(Point.cd) ||
      Point.angle < 0 ||
      Point.angle > 180 ||
      Point.cd < 0 ||
      Point.angle <= PreviousAngle
    ) {
      throw Error(
        "Angles must increase from 0° to 180°, with non-negative candela.",
      );
    }
    PreviousAngle = Point.angle;
  }

  if (Points[0].angle !== 0 || Points.at(-1).angle !== 180) {
    throw Error("The profile must cover 0° through 180°.");
  }
  return Points;
}

export function InterpolateCandela(Points, Angle) {
  const BoundedAngle = Math.max(0, Math.min(180, Angle));
  for (let SampleIndex = 1; SampleIndex < Points.length; SampleIndex++) {
    if (BoundedAngle <= Points[SampleIndex].angle) {
      const LowerPoint = Points[SampleIndex - 1];
      const UpperPoint = Points[SampleIndex];
      const Fraction =
        (BoundedAngle - LowerPoint.angle) /
        (UpperPoint.angle - LowerPoint.angle);
      return LowerPoint.cd + (UpperPoint.cd - LowerPoint.cd) * Fraction;
    }
  }
  return Points.at(-1).cd;
}

export function IntegrateLuminousFlux(Points) {
  ValidatePhotometrySamples(Points);
  let LuminousFlux = 0;
  const IntegrationIntervals = 1800;
  const AngularStep = Math.PI / IntegrationIntervals;
  for (
    let IntervalIndex = 0;
    IntervalIndex < IntegrationIntervals;
    IntervalIndex++
  ) {
    const PolarAngle = (IntervalIndex + 0.5) * AngularStep;
    const Candela = InterpolateCandela(Points, (PolarAngle * 180) / Math.PI);
    LuminousFlux += Candela * Math.sin(PolarAngle) * AngularStep * 2 * Math.PI;
  }
  return LuminousFlux;
}

export function GenerateSpotPhotometry(
  PeakCandela,
  InnerHalfAngle,
  OuterHalfAngle,
) {
  if (
    ![PeakCandela, InnerHalfAngle, OuterHalfAngle].every(Number.isFinite) ||
    PeakCandela < 0 ||
    InnerHalfAngle < 0 ||
    OuterHalfAngle <= InnerHalfAngle ||
    OuterHalfAngle > 180
  ) {
    throw Error("Spot angles require 0 ≤ inner < outer ≤ 180.");
  }

  const Angles = [
    ...new Set([
      ...Array.from({ length: 37 }, (_, Index) => Index * 5),
      InnerHalfAngle,
      OuterHalfAngle,
    ]),
  ].sort((FirstAngle, SecondAngle) => FirstAngle - SecondAngle);
  const Points = Angles.map((Angle) => {
    const Fraction = Math.max(
      0,
      Math.min(1, (Angle - InnerHalfAngle) / (OuterHalfAngle - InnerHalfAngle)),
    );
    return {
      angle: Angle,
      cd: PeakCandela * (1 - Fraction * Fraction * (3 - 2 * Fraction)),
    };
  });
  return ValidatePhotometrySamples(
    Points[0].angle === 0 && Points.at(-1).angle === 180
      ? Points
      : [
          { angle: 0, cd: AngleIntensity(Points, 0) },
          ...Points,
          { angle: 180, cd: 0 },
        ],
  );
}

function AngleIntensity(Points, Angle) {
  if (Angle <= Points[0].angle) return Points[0].cd;
  const FinalPoint = Points.at(-1);
  if (Angle >= FinalPoint.angle) return FinalPoint.cd;
  for (let SampleIndex = 1; SampleIndex < Points.length; SampleIndex++) {
    if (Angle <= Points[SampleIndex].angle) {
      const LowerPoint = Points[SampleIndex - 1];
      const UpperPoint = Points[SampleIndex];
      const Fraction =
        (Angle - LowerPoint.angle) / (UpperPoint.angle - LowerPoint.angle);
      return LowerPoint.cd + (UpperPoint.cd - LowerPoint.cd) * Fraction;
    }
  }
  return 0;
}

export function EncodeIES(Points, Name = "Frontier authored profile") {
  ValidatePhotometrySamples(Points);
  const FormatNumber = (PhotometricNumber) =>
    Number(PhotometricNumber.toFixed(4)).toString();
  return [
    "IESNA:LM-63-2002",
    "[TEST] Frontier authored profile",
    "[LUMINAIRE] " + Name.replace(/[\r\n]/g, " ").slice(0, 80),
    "TILT=NONE",
    `1 -1 1 ${Points.length} 1 1 2 0 0 0`,
    "1 1 0",
    Points.map((Point) => FormatNumber(Point.angle)).join(" "),
    "0",
    Points.map((Point) => FormatNumber(Point.cd)).join(" "),
    "",
  ].join("\n");
}

export function DecodeIES(Text) {
  const Lines = Text.replace(/\r/g, "").split("\n");
  if (!/^IESNA:LM-63-/i.test(Lines[0] || ""))
    throw Error("Expected an LM-63 IES file.");
  const TiltLineIndex = Lines.findIndex((Line) => /^\s*TILT\s*=/i.test(Line));
  if (
    TiltLineIndex < 0 ||
    !/^\s*TILT\s*=\s*NONE\s*$/i.test(Lines[TiltLineIndex])
  ) {
    throw Error("Only TILT=NONE files are supported.");
  }

  const PhotometryNumbers = Lines.slice(TiltLineIndex + 1)
    .join(" ")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    PhotometryNumbers.some(
      (PhotometricNumber) => !Number.isFinite(PhotometricNumber),
    ) ||
    PhotometryNumbers.length < 15
  ) {
    throw Error("Invalid photometric data.");
  }

  const [
    LampCount,
    ,
    CandelaMultiplier,
    VerticalCount,
    HorizontalCount,
    PhotometricType,
  ] = PhotometryNumbers;
  if (
    !Number.isInteger(VerticalCount) ||
    VerticalCount < 2 ||
    VerticalCount > 1000 ||
    HorizontalCount !== 1 ||
    PhotometricType !== 1 ||
    CandelaMultiplier <= 0 ||
    LampCount < 1
  ) {
    throw Error(
      "Only one-plane, rotationally symmetric Type C profiles are supported.",
    );
  }
  if (
    PhotometryNumbers.length !==
    13 + VerticalCount + HorizontalCount + VerticalCount * HorizontalCount
  ) {
    throw Error("Unexpected or incomplete candela table.");
  }

  const VerticalAngles = PhotometryNumbers.slice(13, 13 + VerticalCount);
  const HorizontalAngle = PhotometryNumbers[13 + VerticalCount];
  if (HorizontalAngle !== 0)
    throw Error("The single horizontal angle must be 0°.");
  const CandelaSamples = PhotometryNumbers.slice(
    13 + VerticalCount + HorizontalCount,
  ).map((Candela, SampleIndex) => ({
    angle: VerticalAngles[SampleIndex],
    cd: Candela * CandelaMultiplier,
  }));
  return ValidatePhotometrySamples(CandelaSamples);
}
