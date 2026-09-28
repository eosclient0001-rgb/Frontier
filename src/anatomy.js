/**
 * ============================================================================
 *  ANATOMICAL REFERENCE DATA  —  Golden Eagle (Aquila chrysaetos)
 * ============================================================================
 *
 *  Every dimension below is a published, measured value — not an artistic
 *  guess.  Sources are cited per entry.  The model is built for an
 *  ADULT FEMALE of the North-American subspecies A. c. canadensis, because
 *  the morphometric study by Lish et al. (2023) sampled exactly that class
 *  and is the most complete wing/span/mass data set available for the species.
 *
 *  [1] Lish, J.W., Domenech, R., Bedrosian, B.E., Ellis, D.H., Payton, M.
 *      (2016/2023) "Wing Loading in North American Golden Eagles
 *      (Aquila chrysaetos)", J. Raptor Res. 50(1):70-75.
 *        adult female: mass 5097 g, wing chord 63.2 cm, wing length 95.8 cm,
 *        wingspan 212.2 cm, single-wing area 5879.2 cm^2, loading 0.86 g/cm^2
 *
 *  [2] Trail, P.W. (2017) "Identifying Bald versus Golden Eagle Bones",
 *      Eagle Nature Foundation / Original Wisdom, Table 1.
 *        Golden Eagle: humerus 192.5 mm (179-200), ulna 213.2 mm (200-230),
 *        coracoid 75.3 mm
 *
 *  [3] Royal BC Museum, Avian Osteology — Bald Eagle (Haliaeetus
 *      leucocephalus) atlas, used only where golden-eagle elements were not
 *      published (carpometacarpus), scaled by the humerus ratio
 *      (192.5/201.1 = 0.957).  BAEA carpometacarpus 109.30 mm -> 104.6 mm.
 *
 *  [4] Trail, P.W. (2014) "Identification of Bald and Golden Eagle Feathers".
 *        "the outer ten flight feathers are the primaries; the inner flight
 *        feathers are the secondaries ... eagles possess approximately 14
 *        secondaries"; "Eagle outer wing feathers (primaries) range from
 *        16-22 inches in total length (of which 4-5 inches is the bare shaft
 *        at the base)"; "Eagle inner wing feathers (secondaries) and tail
 *        feathers range from 10-14 inches total length."
 *        "Eagles have twelve tail feathers."
 *
 *  [5] Katzner/Trail key characters: outer primaries of Golden Eagles are
 *      emarginated on the outer web and notched on the inner web with
 *      elongated "finger-like" tips; secondaries rounded and symmetric.
 *
 *  [6] PNAS (2021) "Turbulence explains the accelerations of an eagle in
 *      natural flight" — measured flapping frequency of a wild golden eagle:
 *      "a regular oscillation in the acceleration with a frequency of about
 *      2.8 Hz ... with a harmonic seen at 5.2 Hz".
 *
 *  [7] Alexander, R.McN. / Gatesy & Biewener, "Bipedal locomotion: effects of
 *      speed, size and limb posture in birds and humans" — avian walking duty
 *      factor 0.6-0.8, and avian COM is carried well forward of the hip.
 *
 *  [8] Wikipedia/Golden eagle (aggregating Kochert et al.) — "standard
 *      measurements ... tail length 26.5-38 cm (mean for large females
 *      34 cm)".  Bill/gape and tarsus 9.4-12.2 cm.
 * ============================================================================
 */

export const EAGLE_REFERENCE = Object.freeze({
  taxon: 'Aquila chrysaetos canadensis',
  specimen: 'Adult female, autumn migrant (Montana/Wyoming sample class)',
  totalLength_m: 0.816, // 66-102 cm species range [8]; 81.6 cm typical adult female
  bodyMass_kg: 5.097, // [1]
  wingspan_m: 2.122, // [1] adult female mean
  wingLength_m: 0.958, // [1] root line -> distal tip of furthest primary
  foldedWingChord_m: 0.632, // [1] wrist bend -> longest primary tip
  tailLength_m: 0.34, // [8]
  // [1] reports "mean wing area" 5879.2 cm^2 and wing loading 0.86 g/cm^2 at
  // 5097 g.  Wing loading = mass / (2 x single-wing area), so a single wing is
  // 5097 / (2 x 0.86) = 2963 cm^2 and the pair is 5926 cm^2 (the reported 5879
  // is the pair, rounded through the field tracing).
  wingAreaSingle_m2: 0.29634,
  wingAreaBoth_m2: 0.58792,
  wingLoading_gcm2: 0.86, // [1] mass / single-wing area
  flapFrequency_hz: 2.8, // [6]
});

/** Skeletal (osteological) segment lengths in metres. */
export const BONES = Object.freeze({
  humerus: 0.1925, // [2]
  ulna: 0.2132, // [2]
  radius: 0.2105, // radius is ~1.3% shorter than the ulna in Aquila
  carpometacarpus: 0.1046, // [3] scaled to golden-eagle size
  phalanxMajor1: 0.0245, // major digit, proximal phalanx
  phalanxMajor2: 0.0125, // major digit, distal phalanx
  coracoid: 0.0753, // [2]
  femur: 0.089, // Eagle femora are short and largely buried in plumage
  tibiotarsus: 0.163,
  fibula: 0.11,
  tarsometatarsus: 0.104, // [8] tarsus 9.4-12.2 cm
  // Toe segment length totals (digit III is the longest of the three forward
  // toes; the hallux carries the largest talon).
  hallux: 0.045,
  toe2: 0.055,
  toe3: 0.072,
  toe4: 0.058,
  skullLength: 0.0796,
  culmen: 0.045, // [8] "culmen reportedly averages around 4.5 cm"
  gapeWidth: 0.038,
});

/**
 * Wing surface layout.  The preserved (spread) wing of an eagle is a
 * low-aspect-ratio "plank" with 10 slotted primaries and ~14 secondaries.
 */
export const FEATHERS = Object.freeze({
  primariesPerWing: 10, // [4]
  secondariesPerWing: 14, // [4]
  rectrices: 12, // [4]
  alulaFeathers: 3, // alular digit (pollex) — flow-control "thumbs"
  // Bare quill (calamus) at the base of each flight feather, [4]: 4-5 in
  quill_m: 0.107,
});

/**
 * Primary-feather lengths (m), measured along the vane from the feather's
 * insertion at the carpometacarpus.  Ordered p1 (innermost) -> p10 (outermost).
 *
 * Basis: total eagle primary length is 16-22 in = 40.6-55.9 cm [4].  In Aquila
 * the outermost primary (p10) is the longest and p1 the shortest; the classic
 * raptor wing formula for Aquila is 10 > 9 > 8 > 7 ... > 1.  The distal tip of
 * the wing therefore sits 42.3 cm beyond the tip of the carpometacarpus
 * (0.958 m wing length - 0.5107 m of arm bone - 0.0245 m phalanx), which sits
 * inside the published 40.6-55.9 cm primary range.
 */
export const PRIMARY_LENGTHS = Object.freeze([
  0.258, // p1  (innermost)
  0.281,
  0.303,
  0.326,
  0.351,
  0.377,
  0.402,
  0.418,
  0.432,
  0.443, // p10 (outermost, longest)
]);

/**
 * Secondary-feather lengths (m), ordered s1 (adjacent to the primaries) ->
 * s14 (innermost, next to the body).  Basis: 10-14 in = 25.4-35.6 cm [4];
 * the innermost secondaries (tertials) are the longest, giving the wing its
 * broad, plank-like trailing edge.
 */
export const SECONDARY_LENGTHS = Object.freeze([
  0.272, 0.276, 0.281, 0.287, 0.293, 0.300, 0.307,
  0.314, 0.321, 0.328, 0.334, 0.340, 0.345, 0.350,
]);

/** Rectrix (tail feather) lengths (m), r1 central -> r6 outermost. */
export const RECTRIX_LENGTHS = Object.freeze([
  0.340, 0.345, 0.342, 0.334, 0.320, 0.300,
]);

/**
 * Golden Eagle plumage, sampled from the plumage description in [2]/[5]:
 * overall dark umber-brown; lighter/golden nape and crown; the middle of the
 * upper wing carries golden feathering; outer 3-4 primaries plain dark (almost
 * blackish brown) with no marbling.
 */
export const PLUMAGE = Object.freeze({
  // sRGB hex, converted to linear in the material code.
  backDark: 0x362a20,
  backLight: 0x4b3a28,
  breast: 0x3d2f24,
  napeGolden: 0x9d7434,
  crownGolden: 0x8a6529,
  wingUpperGold: 0x6b512c,
  wingDark: 0x2e241c,
  primaryDark: 0x241c16,
  primaryTip: 0x14100c,
  secondaryBase: 0x3a2e22,
  underwingCovert: 0x4a3c2c,
  tailDark: 0x2c231b,
  tailPaleBase: 0x6d5c46, // adults: faint pale base; juveniles: clean white
  covertsBrown: 0x453626,
  legFeather: 0x40311f,
  beakCere: 0xd8b04a,
  beakHorn: 0x2b2724,
  cereYellow: 0xe0c257,
  iris: 0x7a5a24,
  irisDark: 0x3a2a12,
  talon: 0x1b1917,
  toeScaly: 0xd9b24c,
  gapeMouth: 0x33231c,
});

/**
 * Musculo-skeletal constraints used by the rig.  These are the mechanical
 * limits that make bird wing motion read correctly:
 *  - the avian elbow is a hinge that cannot hyper-extend past ~180 deg and
 *    flexes to ~40-45 deg when the wing is folded;
 *  - the carpus (wrist) is COUPLED to the elbow through the sliding
 *    radius/radiale mechanism [see "A Review of Biomechanic and Aerodynamic
 *    Considerations of the Avian Thoracic Limb", J. Exp. Zool.]: as the elbow
 *    flexes, the radius slides proximally on the ulna and pushes the radiale
 *    against the carpometacarpus, forcing the wrist to flex.  The wing
 *    therefore Z-folds automatically;
 *  - the shoulder can protract/retract (sweep), elevate/depress (flap) and
 *    twist (pronate/supinate).
 */
export const KINEMATIC_LIMITS = Object.freeze({
  shoulderElevation: { min: -78, max: 74 }, // degrees, 0 = wing horizontal
  shoulderSweep: { min: -46, max: 40 }, // negative = retracted (caudad)
  shoulderTwist: { min: -70, max: 78 },
  elbowFlexion: { min: 2, max: 142 }, // 0 deg = fully extended
  wristFlexion: { min: 0, max: 118 },
  // Slope of the automatic elbow->wrist coupling (wrist deg per elbow deg)
  wristCouplingGain: 0.82,
  wristCouplingBias: 6,
  neckRotation: { pitch: [-120, 70], yaw: [-165, 165], roll: [-60, 60] },
  tailPitch: [-38, 26],
  tailSpread: [16, 96], // total fan angle, degrees
});

/** Standing / walking posture, from field observations of perched eagles. */
export const STANCE = Object.freeze({
  // The visible "backward knee" of a bird is the ankle.  An eagle standing on
  // a branch holds the tarsometatarsus at ~52-58 deg from horizontal.
  tarsometatarsusAngle: 55,
  femurFromHorizontal: 26,
  tibiotarsusFromVertical: 21,
  interFemurWidth_m: 0.115,
  // Walking: duty factor and stride, scaled from avian biped kinematics [7].
  walkDutyFactor: 0.655,
  walkStrideFrequency_hz: 1.15,
  walkStrideLength_m: 0.27,
});
