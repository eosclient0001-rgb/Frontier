/**
 * Geological Mountain Massif & Landform Synthesis
 * 
 * Synthesizes a true 3D SDF terrain volume with:
 * 1. Geomorphic Landform Archetypes:
 *    - Alpine Massif (Pyramidal Horns, Radiating Knife-Edge Arêtes, Glacial Cirques)
 *    - Tectonic Rift Valley & Graben (Sunken Graben Basin, Dual Sheer Fault Escarpments & Stepped Horst Terraces)
 *    - Tectonic Fault-Block (Asymmetric Sierra/Teton Escarpment with Dip Slope)
 *    - Glacial Fjord & U-Trough (Parabolic Glacial Valleys & Sheer Walls)
 *    - Volcanic Cone & Dyke Intrusions (Caldera Crater & Hard Igneous Fins)
 *    - Canyonlands & Stepped Mesas (Structural Caprock Plateaus & Step Amphitheaters)
 * 2. Glacial Cirque Amphitheater Sapping & Tarn Bowls
 * 3. Tectonic Rift Graben Extension & Stepped Fault Scarps
 * 4. 3D Bedrock Structural Jointing & Fracture Fields
 * 5. Exact Euclidean Signed Distance Field Phi(x, y, z)
 */

import { NoiseGenerator } from "./math-noise.js";

export function generateMountainMassif(volume, params = {}) {
  const {
    archetype = "alpine",    // "alpine", "riftValley", "faultBlock", "glacialFjord", "volcanic", "canyonlands"
    seed = 1337,
    peakHeight = 48.0,       // meters from sea level
    peakRadius = 80.0,       // meters
    spineSharpness = 2.2,    // ridge crest power
    cirqueSapping = 1.0,     // glacial cirque bowl sapping strength
    riftWidth = 36.0,        // rift valley graben width
    riftDepth = 24.0,        // rift valley graben subsidence depth
    riftSteps = 2,           // stepped normal fault terraces
    faultTiltDeg = 24.0,     // fault-block tilt angle
    jointDensity = 0.45,     // bedrock structural jointing density
    dykeProminence = 0.6,    // igneous dyke fin prominence
    octaves = 6,
    frequency = 0.012,
    persistence = 0.52,
    lacunarity = 2.15,
    ridgedBlend = 0.60,      // blend between ridged arêtes and fBm
    warpAmp = 16.0,          // meters domain warp
    warpFreq = 0.012,
    seaLevel = 0.0,
  } = params;

  const noise = new NoiseGenerator(seed);
  const warpNoise = new NoiseGenerator(seed + 101);
  const strataNoise = new NoiseGenerator(seed + 202);
  const jointNoise = new NoiseGenerator(seed + 303);

  const nx = volume.nx;
  const ny = volume.ny;
  const nz = volume.nz;

  const spineAngle = ((seed % 360) * Math.PI) / 180;
  const cosSpine = Math.cos(spineAngle);
  const sinSpine = Math.sin(spineAngle);

  const height2D = new Float32Array(nx * nz);
  const slopeMag2D = new Float32Array(nx * nz);

  // 1. Generate continuous organic mountain elevation based on archetype
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const idx2D = iz * nx + ix;
      const [wx, , wz] = volume.voxelToCoord(ix, 0, iz);

      // Organic continuous domain warping
      const qx = warpNoise.noise2D(wx * warpFreq, wz * warpFreq);
      const qz = warpNoise.noise2D(wx * warpFreq + 5.2, wz * warpFreq + 1.8);
      const px = wx + warpAmp * qx;
      const pz = wz + warpAmp * qz;

      // Coordinate projections
      const spineCoord = px * cosSpine + pz * sinSpine;
      const spurCoord = -px * sinSpine + pz * cosSpine;
      const distFromCenter = Math.hypot(px, pz);
      const radialMask = Math.max(0.0, 1.0 - Math.pow(distFromCenter / peakRadius, 1.8));

      // Base multi-octave relief
      const ridged = noise.ridged2D(px * frequency, pz * frequency, octaves, lacunarity, persistence, 2.0);
      const fbm = noise.fBm2D(px * frequency, pz * frequency, octaves, lacunarity, persistence);
      const rockyRelief = (1.0 - ridgedBlend) * fbm + ridgedBlend * ridged;

      let elevation = 0;

      if (archetype === "riftValley") {
        // --------------------------------------------------------------------
        // ARCHETYPE: Tectonic Rift Valley & Graben (East African / Baikal Rift)
        // Dual parallel fault scarps (Horst shoulders) flanking a sunken graben trough
        // --------------------------------------------------------------------
        const faultOffset = noise.noise2D(spineCoord * 0.02, 3.4) * 8.0;
        const riftDist = Math.abs(spurCoord + faultOffset);
        const halfWidth = riftWidth * 0.5;

        // Horst flank mountains on both sides
        const horstRidge1 = Math.exp(-Math.pow(Math.abs(spurCoord + faultOffset - halfWidth) / 22.0, spineSharpness));
        const horstRidge2 = Math.exp(-Math.pow(Math.abs(spurCoord + faultOffset + halfWidth) / 22.0, spineSharpness));
        const horstEnvelope = Math.max(horstRidge1, horstRidge2);

        // Base elevated tectonic plateau
        const horstPlateau = seaLevel + peakHeight * radialMask * (0.55 + 0.45 * rockyRelief) * (1.0 + 0.6 * horstEnvelope);

        // Graben subsidence profile with stepped normal fault terraces
        let grabenDrop = 0.0;
        if (riftDist < halfWidth) {
          // Inside central sunken graben floor
          grabenDrop = riftDepth;
        } else if (riftDist < halfWidth * 1.6) {
          // Stepped normal fault terrace escarpment
          const stepFrac = (riftDist - halfWidth) / (halfWidth * 0.6);
          const stepNum = Math.floor(stepFrac * riftSteps) / riftSteps;
          grabenDrop = riftDepth * (1.0 - stepNum);
        }

        elevation = Math.max(seaLevel - 4.0, horstPlateau - grabenDrop * radialMask);

        // Axial graben river basin bed
        if (riftDist < halfWidth * 0.4) {
          const axialTrough = Math.pow(1.0 - riftDist / (halfWidth * 0.4), 2.0) * 3.5;
          elevation -= axialTrough;
        }

      } else if (archetype === "faultBlock") {
        // --------------------------------------------------------------------
        // ARCHETYPE: Tectonic Fault-Block (Asymmetric Escarpment & Dip Slope)
        // --------------------------------------------------------------------
        const faultNormalDist = spurCoord;
        const tiltRads = (faultTiltDeg * Math.PI) / 180;
        const dipSlope = faultNormalDist < 0
          ? 1.0 - Math.abs(faultNormalDist) * Math.tan(tiltRads * 1.8) * 0.04
          : 1.0 - faultNormalDist * Math.tan(tiltRads) * 0.02;

        const faultSpine = Math.exp(-Math.pow(Math.abs(faultNormalDist) / 22.0, spineSharpness));
        elevation = seaLevel + peakHeight * Math.max(0, dipSlope) * radialMask * (0.4 + 0.6 * rockyRelief) * (1.0 + 0.8 * faultSpine);

      } else if (archetype === "glacialFjord") {
        // --------------------------------------------------------------------
        // ARCHETYPE: Glacial Fjord & Parabolic U-Trough
        // --------------------------------------------------------------------
        const troughWidth = 32.0;
        const troughDist = Math.abs(spurCoord);
        const uProfile = Math.min(1.0, Math.pow(troughDist / troughWidth, 2.2));
        const plateau = 0.85 + 0.15 * fbm;
        elevation = seaLevel + peakHeight * radialMask * (0.25 + 0.75 * uProfile * plateau);

        if (troughDist > troughWidth * 0.7 && troughDist < troughWidth * 1.3) {
          const bench = Math.sin(spineCoord * 0.08) * 4.0;
          elevation += Math.max(0, bench);
        }

      } else if (archetype === "volcanic") {
        // --------------------------------------------------------------------
        // ARCHETYPE: Volcanic Cone & Caldera with Radial Dykes
        // --------------------------------------------------------------------
        const coneSlope = Math.exp(-Math.pow(distFromCenter / (peakRadius * 0.65), 1.5));
        const craterRadius = 14.0;
        const craterDepth = distFromCenter < craterRadius
          ? Math.pow(1.0 - distFromCenter / craterRadius, 2.0) * 0.45
          : 0.0;

        const polarAngle = Math.atan2(pz, px);
        const dykeFins = Math.pow(Math.abs(Math.sin(polarAngle * 3.0 + noise.noise2D(px * 0.02, pz * 0.02))), 16.0) * dykeProminence;

        elevation = seaLevel + peakHeight * Math.max(0, coneSlope - craterDepth) * (0.4 + 0.6 * rockyRelief) * (1.0 + dykeFins * 0.6);

      } else if (archetype === "canyonlands") {
        // --------------------------------------------------------------------
        // ARCHETYPE: Canyonlands & Stepped Structural Caprock Mesas
        // --------------------------------------------------------------------
        const plateauBase = radialMask * (0.6 + 0.4 * fbm);
        const bench1 = Math.tanh((plateauBase - 0.35) * 6.0) * 0.5 + 0.5;
        const bench2 = Math.tanh((plateauBase - 0.70) * 8.0) * 0.5 + 0.5;
        const steppedRelief = 0.3 * plateauBase + 0.4 * bench1 + 0.3 * bench2;

        elevation = seaLevel + peakHeight * steppedRelief * (0.5 + 0.5 * rockyRelief);

      } else {
        // --------------------------------------------------------------------
        // ARCHETYPE: Alpine Massif (Pyramidal Horns & Glacial Cirques)
        // --------------------------------------------------------------------
        const spineWarp = noise.noise2D(spineCoord * 0.02, 1.5) * 12.0;
        const mainSpineDist = Math.abs(spurCoord + spineWarp);
        const spineProfile = Math.exp(-Math.pow(mainSpineDist / 26.0, spineSharpness));

        // Radiating 3-branch arête spines for Matterhorn pyramidal peak
        const a1 = spineCoord;
        const a2 = -0.5 * spineCoord + 0.866 * spurCoord;
        const a3 = -0.5 * spineCoord - 0.866 * spurCoord;
        const hornSpine = Math.max(
          Math.exp(-Math.pow(Math.abs(a1) / 24.0, spineSharpness)),
          Math.exp(-Math.pow(Math.abs(a2) / 24.0, spineSharpness)),
          Math.exp(-Math.pow(Math.abs(a3) / 24.0, spineSharpness))
        );

        const spineBoost = 1.0 + 0.9 * (spineProfile * 0.4 + hornSpine * 0.6);
        elevation = seaLevel + peakHeight * radialMask * spineBoost * (0.35 + 0.65 * rockyRelief);

        // Glacial Cirque Amphitheater Sapping
        if (cirqueSapping > 0) {
          const cirqueCenters = [
            { x: 26.0, z: 18.0, r: 24.0, depth: 14.0 },
            { x: -28.0, z: 22.0, r: 26.0, depth: 16.0 },
            { x: 2.0, z: -32.0, r: 28.0, depth: 18.0 },
          ];

          for (const c of cirqueCenters) {
            const dCirque = Math.hypot(px - c.x, pz - c.z);
            if (dCirque < c.r) {
              const bowlProfile = Math.pow(1.0 - dCirque / c.r, 2.0);
              const sappingHole = bowlProfile * c.depth * cirqueSapping * radialMask;
              elevation -= sappingHole;
            }
          }
        }
      }

      // Bedrock Jointing & Angular Cleavage Fractures
      if (jointDensity > 0) {
        const j1 = jointNoise.noise2D(px * 0.08, pz * 0.08);
        const j2 = jointNoise.noise2D(px * 0.08 + 12.0, -pz * 0.08 + 8.0);
        const angularBlock = (Math.abs(j1) + Math.abs(j2)) * jointDensity * 1.5;
        elevation += angularBlock * (elevation > seaLevel + 6.0 ? 1.0 : 0.0);
      }

      // Organic foothills skirt
      const foothill = noise.fBm2D(wx * 0.015, wz * 0.015, 3, 2.0, 0.5) * 4.0;
      elevation += foothill * (1.0 - radialMask * 0.5);

      height2D[idx2D] = elevation;
    }
  }

  // 2. Compute smooth 2D gradient magnitude for Euclidean distance normalization
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const idx = iz * nx + ix;
      const xL = Math.max(0, ix - 1), xR = Math.min(nx - 1, ix + 1);
      const zU = Math.max(0, iz - 1), zD = Math.min(nz - 1, iz + 1);
      const dhdx = (height2D[iz * nx + xR] - height2D[iz * nx + xL]) / ((xR - xL) * volume.dx);
      const dhdz = (height2D[zD * nx + ix] - height2D[zU * nx + ix]) / ((zD - zU) * volume.dz);
      slopeMag2D[idx] = Math.hypot(dhdx, dhdz);
    }
  }

  // 3. Populate 3D SDF volume with smooth continuous Euclidean distances and organic hardness
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const [wx, wy, wz] = volume.voxelToCoord(ix, iy, iz);
        const idx2D = iz * nx + ix;
        const surfH = height2D[idx2D];
        const slopeMag = slopeMag2D[idx2D];
        const normFactor = Math.sqrt(1.0 + slopeMag * slopeMag);

        // Organic continuous 3D rock hardness
        const hardness = 1.0 + 0.15 * strataNoise.fBm3D(wx * 0.01, wy * 0.01, wz * 0.01, 3, 2.0, 0.5);

        // Exact continuous Euclidean signed distance
        const signedDist = (wy - surfH) / normFactor;
        const clampedDist = Math.max(-volume.narrowBand, Math.min(volume.narrowBand, signedDist));

        volume.setVoxel(ix, iy, iz, clampedDist, hardness, 0.0);
      }
    }
  }

  return volume;
}
