// Catalogue labels and explicit numeric defaults; interactive sketch placement is owned by WorkspaceFlow.
const Point = (...Values) =>
  `(${Values.map((Value) => Number(Value.toFixed(6))).join(",")})`;
export const ConstructionCatalogue = [
  [
    "Reference",
    "Workplane",
    "surface",
    "",
    (Horizontal, Vertical) =>
      `plane ${Point(Horizontal - 0.7, Vertical - 0.7, 0)} 1.4 1.4`,
  ],
  [
    "Sketch Draw",
    "Line",
    "edge",
    "L",
    (Horizontal, Vertical) =>
      `line ${Point(Horizontal - 0.7, Vertical - 0.5)} ${Point(Horizontal + 0.7, Vertical + 0.5)}`,
  ],
  [
    "Sketch Draw",
    "Polyline",
    "polyline",
    "",
    (Horizontal, Vertical) =>
      `polyline ${Point(Horizontal - 0.8, Vertical - 0.5)} ${Point(Horizontal - 0.3, Vertical + 0.5)} ${Point(Horizontal + 0.3, Vertical - 0.2)} ${Point(Horizontal + 0.8, Vertical + 0.5)}`,
  ],
  [
    "Sketch Draw",
    "Rectangle",
    "rectangle",
    "R",
    (Horizontal, Vertical) =>
      `rect ${Point(Horizontal - 0.7, Vertical - 0.5)} ${Point(Horizontal + 0.7, Vertical + 0.5)}`,
  ],
  [
    "Sketch Draw",
    "Centre Rect.",
    "centre",
    "",
    (Horizontal, Vertical) =>
      `rect ${Point(Horizontal, Vertical)} ${Point(Horizontal + 0.7, Vertical + 0.5)} --center`,
  ],
  [
    "Sketch Draw",
    "Slot",
    "slot",
    "",
    (Horizontal, Vertical) =>
      `slot ${Point(Horizontal - 0.5, Vertical)} ${Point(Horizontal + 0.5, Vertical)} .25`,
  ],
  [
    "Sketch Draw",
    "Circle",
    "circle",
    "C",
    (Horizontal, Vertical) => `circle ${Point(Horizontal, Vertical)} .6`,
  ],
  [
    "Sketch Draw",
    "Arc",
    "arc",
    "A",
    (Horizontal, Vertical) => `arc ${Point(Horizontal, Vertical)} .7 -60 240`,
  ],
  [
    "Sketch Draw",
    "Ellipse",
    "ellipse",
    "",
    (Horizontal, Vertical) => `ellipse ${Point(Horizontal, Vertical)} .8 .45`,
  ],
  [
    "Sketch Draw",
    "Polygon",
    "polygon",
    "P",
    (Horizontal, Vertical) => `polygon ${Point(Horizontal, Vertical)} .6 6`,
  ],
  [
    "Sketch Draw",
    "Spline",
    "curve",
    "",
    (Horizontal, Vertical) =>
      `spline ${Point(Horizontal - 0.8, Vertical - 0.3)} ${Point(Horizontal - 0.3, Vertical + 0.5)} ${Point(Horizontal + 0.3, Vertical - 0.5)} ${Point(Horizontal + 0.8, Vertical + 0.3)}`,
  ],
  [
    "Sketch Draw",
    "Control Curve",
    "controlcurve",
    "",
    (Horizontal, Vertical) =>
      `cpcurve ${Point(Horizontal - 0.8, Vertical - 0.3)} ${Point(Horizontal - 0.3, Vertical + 0.6)} ${Point(Horizontal + 0.3, Vertical - 0.6)} ${Point(Horizontal + 0.8, Vertical + 0.3)}`,
  ],
  [
    "Solid",
    "Box",
    "body",
    "",
    (Horizontal, Vertical) =>
      `box ${Point(Horizontal - 0.5, Vertical - 0.5, 0)} 1 1 1`,
  ],
  [
    "Solid",
    "Sphere",
    "sphere",
    "",
    (Horizontal, Vertical) => `sphere ${Point(Horizontal, Vertical, 0.6)} .6`,
  ],
  [
    "Solid",
    "Cylinder",
    "cylinder",
    "",
    (Horizontal, Vertical) =>
      `cylinder ${Point(Horizontal, Vertical, 0)} .45 1.2`,
  ],
  [
    "Solid",
    "Cone",
    "cone",
    "",
    (Horizontal, Vertical) =>
      `cone ${Point(Horizontal, Vertical, 0)} .6 .15 1.2`,
  ],
  [
    "Solid",
    "Torus",
    "ring",
    "",
    (Horizontal, Vertical) =>
      `torus ${Point(Horizontal, Vertical, 0.3)} .6 .25`,
  ],
  [
    "Surface",
    "Sphere Sheet",
    "sphere",
    "",
    (Horizontal, Vertical) =>
      `sphere ${Point(Horizontal, Vertical, 0.6)} .6 --sheet`,
  ],
  [
    "Surface",
    "Cylinder Sheet",
    "cylinder",
    "",
    (Horizontal, Vertical) =>
      `cylinder ${Point(Horizontal, Vertical, 0)} .45 1.2 --sheet`,
  ],
  [
    "Surface",
    "Cone Sheet",
    "cone",
    "",
    (Horizontal, Vertical) =>
      `cone ${Point(Horizontal, Vertical, 0)} .6 .15 1.2 --sheet`,
  ],
  [
    "Surface",
    "Torus Sheet",
    "ring",
    "",
    (Horizontal, Vertical) =>
      `torus ${Point(Horizontal, Vertical, 0.3)} .6 .25 --sheet`,
  ],
  [
    "Surface",
    "Patch",
    "cage",
    "",
    (Horizontal, Vertical) =>
      `patch 3 3 --degree=2 ${Array.from({ length: 9 }, (_, Index) => Point(Horizontal + ((Index % 3) - 1) * 0.7, Vertical + (Math.floor(Index / 3) - 1) * 0.7, Index === 4 ? 0.5 : 0)).join(" ")}`,
  ],
  ["Sketch Draw","Polyline Slot","pslot","",(H,V)=>`draw pslot (${H},${V}) (${H+1},${V}) (${H+1},${V+1}) --radius=.25`],
  ["Sketch Draw","Point","point","",(H,V)=>`draw sketch-point (${H},${V})`],
  ["Reference","Datum Point","point","",(H,V)=>`draw datum-point (${H},${V})`],
  ["Sketch Draw","Circle · 3 points","circle","",(H,V)=>`draw circle3 (${H+1},${V}) (${H},${V+1}) (${H-1},${V})`],
  ["Sketch Draw","Arc · 3 points","arc","",(H,V)=>`draw arc3 (${H-1},${V}) (${H+1},${V}) (${H},${V+1})`],
].map(([section, label, icon, key, command]) => ({
  section,
  label,
  icon,
  key,
  command,
}));
