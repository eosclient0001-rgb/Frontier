/**
 * 3D Signed Distance Field (SDF) Volumetric Engine
 * 
 * Manages the authoritative 3D volumetric representation:
 * - Signed distance field Phi(x, y, z) in meters (negative inside rock, positive in air)
 * - Solid mass fraction S(x, y, z) in [0, 1] for exact mass conservation
 * - 3D Rock Strata Hardness H(x, y, z) representing geological bedding planes & dip/strike
 * - Loose sediment inventory Q_sed(x, y, z)
 * - Normalized Euclidean distance with slope gradient compensation |grad Phi| = 1
 */

export class SDFVolume {
  constructor({
    nx = 160,
    ny = 96,
    nz = 160,
    boundsMin = [-100, -20, -100],
    boundsMax = [100, 60, 100],
    narrowBand = 6.0, // meters
  } = {}) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.totalVoxels = nx * ny * nz;

    this.boundsMin = [...boundsMin];
    this.boundsMax = [...boundsMax];
    this.size = [
      boundsMax[0] - boundsMin[0],
      boundsMax[1] - boundsMin[1],
      boundsMax[2] - boundsMin[2],
    ];

    this.dx = this.size[0] / (nx - 1);
    this.dy = this.size[1] / (ny - 1);
    this.dz = this.size[2] / (nz - 1);
    this.voxelVolume = this.dx * this.dy * this.dz;
    this.narrowBand = narrowBand;

    // Allocate 3D volumetric arrays
    this.sdf = new Float32Array(this.totalVoxels);
    this.solid = new Float32Array(this.totalVoxels);
    this.strata = new Float32Array(this.totalVoxels);
    this.sediment = new Float32Array(this.totalVoxels);
    this.moisture = new Float32Array(this.totalVoxels);

    this.sdf.fill(narrowBand);
    this.strata.fill(1.0);
  }

  index(ix, iy, iz) {
    return (iz * this.ny + iy) * this.nx + ix;
  }

  coordToVoxel(x, y, z) {
    const vx = ((x - this.boundsMin[0]) / this.size[0]) * (this.nx - 1);
    const vy = ((y - this.boundsMin[1]) / this.size[1]) * (this.ny - 1);
    const vz = ((z - this.boundsMin[2]) / this.size[2]) * (this.nz - 1);
    return [vx, vy, vz];
  }

  voxelToCoord(ix, iy, iz) {
    const x = this.boundsMin[0] + (ix / (this.nx - 1)) * this.size[0];
    const y = this.boundsMin[1] + (iy / (this.ny - 1)) * this.size[1];
    const z = this.boundsMin[2] + (iz / (this.nz - 1)) * this.size[2];
    return [x, y, z];
  }

  setVoxel(ix, iy, iz, distance, hardness = 1.0, sed = 0.0) {
    if (ix < 0 || ix >= this.nx || iy < 0 || iy >= this.ny || iz < 0 || iz >= this.nz) return;
    const idx = this.index(ix, iy, iz);
    this.sdf[idx] = distance;
    this.solid[idx] = Math.max(0.0, Math.min(1.0, 0.5 - distance / (2.0 * this.dy)));
    this.strata[idx] = hardness;
    this.sediment[idx] = sed;
  }

  sampleSDF(x, y, z) {
    const [vx, vy, vz] = this.coordToVoxel(x, y, z);
    if (vx < 0 || vx > this.nx - 1 || vy < 0 || vy > this.ny - 1 || vz < 0 || vz > this.nz - 1) {
      const dx = Math.max(this.boundsMin[0] - x, 0, x - this.boundsMax[0]);
      const dy = Math.max(this.boundsMin[1] - y, 0, y - this.boundsMax[1]);
      const dz = Math.max(this.boundsMin[2] - z, 0, z - this.boundsMax[2]);
      return Math.hypot(dx, dy, dz) + 0.1;
    }

    const x0 = Math.floor(vx), x1 = Math.min(x0 + 1, this.nx - 1);
    const y0 = Math.floor(vy), y1 = Math.min(y0 + 1, this.ny - 1);
    const z0 = Math.floor(vz), z1 = Math.min(z0 + 1, this.nz - 1);

    const fx = vx - x0, fy = vy - y0, fz = vz - z0;

    const c000 = this.sdf[this.index(x0, y0, z0)];
    const c100 = this.sdf[this.index(x1, y0, z0)];
    const c010 = this.sdf[this.index(x0, y1, z0)];
    const c110 = this.sdf[this.index(x1, y1, z0)];
    const c001 = this.sdf[this.index(x0, y0, z1)];
    const c101 = this.sdf[this.index(x1, y0, z1)];
    const c011 = this.sdf[this.index(x0, y1, z1)];
    const c111 = this.sdf[this.index(x1, y1, z1)];

    const c00 = c000 * (1 - fx) + c100 * fx;
    const c10 = c010 * (1 - fx) + c110 * fx;
    const c01 = c001 * (1 - fx) + c101 * fx;
    const c11 = c011 * (1 - fx) + c111 * fx;

    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;

    return c0 * (1 - fz) + c1 * fz;
  }

  sampleHardness(x, y, z) {
    const [vx, vy, vz] = this.coordToVoxel(x, y, z);
    const x0 = Math.max(0, Math.min(this.nx - 1, Math.floor(vx)));
    const y0 = Math.max(0, Math.min(this.ny - 1, Math.floor(vy)));
    const z0 = Math.max(0, Math.min(this.nz - 1, Math.floor(vz)));
    return this.strata[this.index(x0, y0, z0)] || 1.0;
  }

  /**
   * Extract 2D surface elevation and gradients h(x, z) from 3D SDF volume
   */
  extractSurfaceGrid() {
    const size = this.nx * this.nz;
    const height = new Float32Array(size);
    const normalX = new Float32Array(size);
    const normalY = new Float32Array(size);
    const normalZ = new Float32Array(size);
    const slope = new Float32Array(size);
    const slopeDeg = new Float32Array(size);
    const surfaceHardness = new Float32Array(size);
    const surfaceSediment = new Float32Array(size);
    const curvature = new Float32Array(size);

    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const idx2D = iz * this.nx + ix;
        let h = this.boundsMin[1];

        // Search for zero-crossing
        for (let iy = this.ny - 1; iy >= 0; iy--) {
          const idx3D = this.index(ix, iy, iz);
          const d = this.sdf[idx3D];

          if (d <= 0.0) {
            const yCurrent = this.boundsMin[1] + (iy / (this.ny - 1)) * this.size[1];
            if (iy < this.ny - 1) {
              const dAbove = this.sdf[this.index(ix, iy + 1, iz)];
              const diff = dAbove - d;
              const t = diff > 1e-5 ? Math.max(0.0, Math.min(1.0, -d / diff)) : 0.5;
              h = yCurrent + t * this.dy;
            } else {
              h = yCurrent;
            }
            surfaceHardness[idx2D] = this.strata[idx3D];
            surfaceSediment[idx2D] = this.sediment[idx3D];
            break;
          }
        }

        height[idx2D] = h;
      }
    }

    // Compute central-difference surface gradients and curvature
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const idx = iz * this.nx + ix;
        const xL = Math.max(0, ix - 1);
        const xR = Math.min(this.nx - 1, ix + 1);
        const zU = Math.max(0, iz - 1);
        const zD = Math.min(this.nz - 1, iz + 1);

        const dhdx = (height[iz * this.nx + xR] - height[iz * this.nx + xL]) / ((xR - xL) * this.dx);
        const dhdz = (height[zD * this.nx + ix] - height[zU * this.nx + ix]) / ((zD - zU) * this.dz);

        const gradLen = Math.hypot(dhdx, dhdz);
        slope[idx] = gradLen;
        slopeDeg[idx] = (Math.atan(gradLen) * 180) / Math.PI;

        const nx = -dhdx;
        const ny = 1.0;
        const nz = -dhdz;
        const nLen = Math.hypot(nx, ny, nz) || 1.0;

        normalX[idx] = nx / nLen;
        normalY[idx] = ny / nLen;
        normalZ[idx] = nz / nLen;

        const lap =
          height[iz * this.nx + xL] +
          height[iz * this.nx + xR] +
          height[zU * this.nx + ix] +
          height[zD * this.nx + ix] -
          4 * height[idx];
        curvature[idx] = Math.max(-1.0, Math.min(1.0, lap * 0.25));
      }
    }

    return {
      nx: this.nx,
      nz: this.nz,
      dx: this.dx,
      dz: this.dz,
      height,
      normalX,
      normalY,
      normalZ,
      slope,
      slopeDeg,
      hardness: surfaceHardness,
      sediment: surfaceSediment,
      curvature,
    };
  }

  /**
   * Apply 2D surface modifications back to the 3D SDF volume with slope compensation
   */
  applySurfaceDelta(dhGrid, sedimentDelta = null) {
    const surf = this.extractSurfaceGrid();

    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const idx2D = iz * this.nx + ix;
        const dh = dhGrid[idx2D];
        if (Math.abs(dh) < 1e-6) continue;

        const dSed = sedimentDelta ? sedimentDelta[idx2D] : 0.0;
        const slopeMag = surf.slope[idx2D];
        const normFactor = Math.sqrt(1.0 + slopeMag * slopeMag);

        // Exact Euclidean distance delta projected along surface normal
        const distDelta = dh / normFactor;

        for (let iy = 0; iy < this.ny; iy++) {
          const idx3D = this.index(ix, iy, iz);
          const currentDist = this.sdf[idx3D];

          if (Math.abs(currentDist) < this.narrowBand + 2.0 * this.dy) {
            const newDist = currentDist - distDelta;
            this.sdf[idx3D] = Math.max(-this.narrowBand, Math.min(this.narrowBand, newDist));
            this.solid[idx3D] = Math.max(0.0, Math.min(1.0, 0.5 - newDist / (2.0 * this.dy)));

            if (dSed > 0 && Math.abs(newDist) < this.dy * 2) {
              this.sediment[idx3D] = Math.max(0.0, this.sediment[idx3D] + dSed);
            }
          }
        }
      }
    }
  }

  /**
   * 3D Volumetric Sculpting Brush
   */
  sculptBrush(type = "raise", center = [0, 10, 0], radius = 15.0, strength = 1.0) {
    const [cx, cy, cz] = center;
    const rSq = radius * radius;

    const minX = Math.max(0, Math.floor(((cx - radius - this.boundsMin[0]) / this.size[0]) * (this.nx - 1)));
    const maxX = Math.min(this.nx - 1, Math.ceil(((cx + radius - this.boundsMin[0]) / this.size[0]) * (this.nx - 1)));
    const minY = Math.max(0, Math.floor(((cy - radius - this.boundsMin[1]) / this.size[1]) * (this.ny - 1)));
    const maxY = Math.min(this.ny - 1, Math.ceil(((cy + radius - this.boundsMin[1]) / this.size[1]) * (this.ny - 1)));
    const minZ = Math.max(0, Math.floor(((cz - radius - this.boundsMin[2]) / this.size[2]) * (this.nz - 1)));
    const maxZ = Math.min(this.nz - 1, Math.ceil(((cz + radius - this.boundsMin[2]) / this.size[2]) * (this.nz - 1)));

    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let iy = minY; iy <= maxY; iy++) {
        for (let ix = minX; ix <= maxX; ix++) {
          const idx = this.index(ix, iy, iz);
          const [wx, wy, wz] = this.voxelToCoord(ix, iy, iz);
          const distToCenter = Math.hypot(wx - cx, wy - cy, wz - cz);

          if (distToCenter > radius) continue;

          const falloff = Math.pow(1.0 - distToCenter / radius, 2);
          const delta = strength * falloff * this.dy;
          let d = this.sdf[idx];

          switch (type) {
            case "raise":
              d -= delta;
              break;
            case "lower":
              d += delta;
              break;
            case "gorge":
              const canyonFalloff = Math.exp(-Math.pow(distToCenter / (radius * 0.4), 2));
              d += strength * canyonFalloff * this.dy * 2.0;
              break;
            case "terrace":
              const stepHeight = 4.0;
              const stepTarget = Math.round(wy / stepHeight) * stepHeight;
              const stepDiff = wy - stepTarget;
              d += Math.sign(stepDiff) * Math.min(Math.abs(stepDiff), delta * 0.5);
              break;
            case "cave":
              if (Math.abs(wy - cy) < radius * 0.4) {
                const caveRadius = radius * (1.0 - Math.abs(wy - cy) / (radius * 0.4));
                const caveDist = Math.hypot(wx - cx, wz - cz) - caveRadius;
                d = Math.max(d, -caveDist);
              }
              break;
            case "smooth":
              let sum = 0, count = 0;
              for (let dz = -1; dz <= 1; dz++) {
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    const nx = ix + dx, ny = iy + dy, nz = iz + dz;
                    if (nx >= 0 && nx < this.nx && ny >= 0 && ny < this.ny && nz >= 0 && nz < this.nz) {
                      sum += this.sdf[this.index(nx, ny, nz)];
                      count++;
                    }
                  }
                }
              }
              const avg = sum / count;
              d = d * (1.0 - falloff * 0.5) + avg * (falloff * 0.5);
              break;
          }

          this.sdf[idx] = Math.max(-this.narrowBand, Math.min(this.narrowBand, d));
          this.solid[idx] = Math.max(0.0, Math.min(1.0, 0.5 - d / (2.0 * this.dy)));
        }
      }
    }
  }
}
