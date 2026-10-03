/**
 * XPBD Metal Solver
 * 
 * Core idea vs cloth:
 * Cloth: C = |p_i-p_j| - L0, high compliance (soft), purely elastic, no plasticity
 * Metal: 
 *  - Very low compliance (1e-7) = near rigid
 *  - Yield threshold: if |strain| > yield, rest length permanently changes
 *  - Plastic flow + hardening
 *  - Bending constraints with rest-angle plasticity -> sharp permanent folds
 *  - Velocity damping + compliance damping to kill vibration (no rebound)
 *  - Strain hardening: after plastic flow, yield increases
 */

export class XPBDMetalSolver {
  constructor() {
    this.positions = null; // Float32Array N*3
    this.prevPositions = null;
    this.velocities = null;
    this.invMass = null;
    this.pinned = null;
    this.numParticles = 0;

    this.distanceConstraints = []; // {i,j, rest, rest0, lambda, compliance, yield, plasticRate, hardening, plasticStrain}
    this.bendingConstraints = []; // distance-based bending {i,j, rest, rest0, lambda, compliance, yield, plasticRate, plasticStrain}
    this.volumeConstraints = []; // for volumetric metal {i,j,k,l, rest, lambda, compliance}

    this.dt = 1/60;
    this.substeps = 12;
    this.iterations = 8;
    this.gravity = [0, -9.81, 0];

    // Metal params (steel-like)
    this.params = {
      stretchCompliance: 1e-7, // ~ 200GPa steel
      bendCompliance: 2e-6, // bending softer than stretch but still stiff
      stretchYield: 0.02, // 2% elastic limit then plastic
      bendYield: 0.15, // bending yield in terms of strain (for distance bending)
      plasticRate: 0.85, // how fast rest updates after yield (0-1)
      hardening: 0.15, // yield increases with plastic strain
      velocityDamping: 0.995,
      plasticDamping: 0.6, // extra damping when plastically flowing
      maxPlastic: 0.5, // max 50% plastic stretch before tearing (for demo)
    };

    this.stats = {
      avgPlastic: 0,
      maxPlastic: 0,
      numYielded: 0,
    };
  }

  initParticles(positionsArray) {
    // positionsArray: Float32Array or Array of [x,y,z]
    const N = positionsArray.length / 3;
    this.numParticles = N;
    this.positions = new Float32Array(N*3);
    this.prevPositions = new Float32Array(N*3);
    this.velocities = new Float32Array(N*3);
    this.invMass = new Float32Array(N);
    this.pinned = new Uint8Array(N);
    for (let i=0;i<N*3;i++) {
      this.positions[i] = positionsArray[i];
      this.prevPositions[i] = positionsArray[i];
      this.velocities[i] = 0;
    }
    for (let i=0;i<N;i++) this.invMass[i] = 1.0; // 1kg per particle
  }

  setInvMass(idx, invMass) {
    this.invMass[idx] = invMass;
  }
  pin(idx) {
    this.pinned[idx] = 1;
    this.invMass[idx] = 0;
  }

  addDistanceConstraint(i, j, restLength = null) {
    if (restLength === null) {
      const dx = this.positions[i*3]-this.positions[j*3];
      const dy = this.positions[i*3+1]-this.positions[j*3+1];
      const dz = this.positions[i*3+2]-this.positions[j*3+2];
      restLength = Math.hypot(dx,dy,dz);
    }
    if (restLength < 1e-6) return;
    this.distanceConstraints.push({
      i, j,
      rest: restLength,
      rest0: restLength,
      lambda: 0,
      compliance: this.params.stretchCompliance,
      yield: this.params.stretchYield,
      plasticRate: this.params.plasticRate,
      hardening: this.params.hardening,
      plasticStrain: 0,
      isYielding: false,
    });
  }

  addBendingConstraint(i, j, restLength = null) {
    if (restLength === null) {
      const dx = this.positions[i*3]-this.positions[j*3];
      const dy = this.positions[i*3+1]-this.positions[j*3+1];
      const dz = this.positions[i*3+2]-this.positions[j*3+2];
      restLength = Math.hypot(dx,dy,dz);
    }
    if (restLength < 1e-6) return;
    this.bendingConstraints.push({
      i, j,
      rest: restLength,
      rest0: restLength,
      lambda: 0,
      compliance: this.params.bendCompliance,
      yield: this.params.bendYield,
      plasticRate: this.params.plasticRate,
      hardening: this.params.hardening,
      plasticStrain: 0,
      isYielding: false,
    });
  }

  addVolumeConstraint(i,j,k,l) {
    // compute rest volume
    const p0 = [this.positions[i*3], this.positions[i*3+1], this.positions[i*3+2]];
    const p1 = [this.positions[j*3], this.positions[j*3+1], this.positions[j*3+2]];
    const p2 = [this.positions[k*3], this.positions[k*3+1], this.positions[k*3+2]];
    const p3 = [this.positions[l*3], this.positions[l*3+1], this.positions[l*3+2]];
    const vol = this.tetVolume(p0,p1,p2,p3);
    this.volumeConstraints.push({
      i,j,k,l,
      rest: vol,
      lambda: 0,
      compliance: 1e-7,
    });
  }

  tetVolume(a,b,c,d) {
    // 1/6 * ((b-a) x (c-a)) . (d-a)
    const abx = b[0]-a[0], aby = b[1]-a[1], abz = b[2]-a[2];
    const acx = c[0]-a[0], acy = c[1]-a[1], acz = c[2]-a[2];
    const adx = d[0]-a[0], ady = d[1]-a[1], adz = d[2]-a[2];
    const crossx = aby*acz - abz*acy;
    const crossy = abz*acx - abx*acz;
    const crossz = abx*acy - aby*acx;
    return (crossx*adx + crossy*ady + crossz*adz)/6.0;
  }

  // Main XPBD step
  step(dt, collisionCallback = null) {
    const subDt = dt / this.substeps;
    const subDt2 = subDt*subDt;

    for (let sub=0; sub<this.substeps; sub++) {
      // predict
      for (let i=0;i<this.numParticles;i++) {
        if (this.pinned[i]) continue;
        const idx = i*3;
        // save prev
        this.prevPositions[idx] = this.positions[idx];
        this.prevPositions[idx+1] = this.positions[idx+1];
        this.prevPositions[idx+2] = this.positions[idx+2];

        // integrate
        this.velocities[idx] += this.gravity[0]*subDt;
        this.velocities[idx+1] += this.gravity[1]*subDt;
        this.velocities[idx+2] += this.gravity[2]*subDt;

        this.positions[idx] += this.velocities[idx]*subDt;
        this.positions[idx+1] += this.velocities[idx+1]*subDt;
        this.positions[idx+2] += this.velocities[idx+2]*subDt;
      }

      // reset lambdas each substep? XPBD keeps lambda across iterations but zero per substep
      for (let c of this.distanceConstraints) c.lambda = 0;
      for (let c of this.bendingConstraints) c.lambda = 0;
      for (let c of this.volumeConstraints) c.lambda = 0;

      // solve constraints iteratively
      for (let iter=0; iter<this.iterations; iter++) {
        this.solveDistanceConstraints(subDt2);
        this.solveBendingConstraints(subDt2);
        if (this.volumeConstraints.length>0) this.solveVolumeConstraints(subDt2);
        if (collisionCallback) collisionCallback(this, subDt);
      }

      // handle plasticity AFTER solving (update rest states)
      this.applyPlasticity();

      // update velocities
      let numYielding = 0;
      for (let i=0;i<this.numParticles;i++) {
        if (this.pinned[i]) {
          this.velocities[i*3]=0;
          this.velocities[i*3+1]=0;
          this.velocities[i*3+2]=0;
          continue;
        }
        const idx = i*3;
        let vx = (this.positions[idx]-this.prevPositions[idx])/subDt;
        let vy = (this.positions[idx+1]-this.prevPositions[idx+1])/subDt;
        let vz = (this.positions[idx+2]-this.prevPositions[idx+2])/subDt;

        // damping
        let damp = this.params.velocityDamping;
        // extra damping if particle is part of yielding constraint (we approximate via global check)
        // We'll do per-particle yielding detection in plasticity step later, for now use uniform
        vx *= damp; vy *= damp; vz *= damp;

        this.velocities[idx]=vx;
        this.velocities[idx+1]=vy;
        this.velocities[idx+2]=vz;
      }

      // second collision pass after velocity update (for stability)
      if (collisionCallback) collisionCallback(this, subDt);
    }

    // update stats
    this.computeStats();
  }

  solveDistanceConstraints(dt2) {
    const pos = this.positions;
    const invMass = this.invMass;
    for (let c of this.distanceConstraints) {
      const i = c.i, j = c.j;
      const i3 = i*3, j3 = j*3;
      const wi = invMass[i], wj = invMass[j];
      const wSum = wi+wj;
      if (wSum < 1e-12) continue;

      const dx = pos[i3]-pos[j3];
      const dy = pos[i3+1]-pos[j3+1];
      const dz = pos[i3+2]-pos[j3+2];
      const len = Math.hypot(dx,dy,dz);
      if (len < 1e-8) continue;

      const C = len - c.rest;
      // early out if within tiny elastic tolerance to save perf, but need for plasticity detection later
      // if (Math.abs(C) < 1e-6) continue;

      const gradx = dx/len, grady = dy/len, gradz = dz/len;

      const alpha = c.compliance / dt2;
      const denom = wSum + alpha;
      if (denom < 1e-12) continue;

      const dLambda = (-C - alpha*c.lambda)/denom;
      c.lambda += dLambda;

      const corr = dLambda;
      // correction scaled by invMass
      pos[i3] += wi * gradx * corr;
      pos[i3+1] += wi * grady * corr;
      pos[i3+2] += wi * gradz * corr;

      pos[j3] -= wj * gradx * corr;
      pos[j3+1] -= wj * grady * corr;
      pos[j3+2] -= wj * gradz * corr;
    }
  }

  solveBendingConstraints(dt2) {
    // Same as distance but with different compliance (softer) and used for bending
    const pos = this.positions;
    const invMass = this.invMass;
    for (let c of this.bendingConstraints) {
      const i = c.i, j = c.j;
      const i3 = i*3, j3 = j*3;
      const wi = invMass[i], wj = invMass[j];
      const wSum = wi+wj;
      if (wSum < 1e-12) continue;

      const dx = pos[i3]-pos[j3];
      const dy = pos[i3+1]-pos[j3+1];
      const dz = pos[i3+2]-pos[j3+2];
      const len = Math.hypot(dx,dy,dz);
      if (len < 1e-8) continue;

      const C = len - c.rest;
      const gradx = dx/len, grady = dy/len, gradz = dz/len;

      const alpha = c.compliance / dt2;
      const denom = wSum + alpha;
      if (denom < 1e-12) continue;

      const dLambda = (-C - alpha*c.lambda)/denom;
      c.lambda += dLambda;

      const corr = dLambda;
      pos[i3] += wi * gradx * corr;
      pos[i3+1] += wi * grady * corr;
      pos[i3+2] += wi * gradz * corr;

      pos[j3] -= wj * gradx * corr;
      pos[j3+1] -= wj * grady * corr;
      pos[j3+2] -= wj * gradz * corr;
    }
  }

  solveVolumeConstraints(dt2) {
    const pos = this.positions;
    const invMass = this.invMass;
    for (let c of this.volumeConstraints) {
      const i=c.i,j=c.j,k=c.k,l=c.l;
      const i3=i*3,j3=j*3,k3=k*3,l3=l*3;
      const wi=invMass[i],wj=invMass[j],wk=invMass[k],wl=invMass[l];
      // compute current volume and gradients
      const p0x=pos[i3], p0y=pos[i3+1], p0z=pos[i3+2];
      const p1x=pos[j3], p1y=pos[j3+1], p1z=pos[j3+2];
      const p2x=pos[k3], p2y=pos[k3+1], p2z=pos[k3+2];
      const p3x=pos[l3], p3y=pos[l3+1], p3z=pos[l3+2];

      // vectors
      const abx=p1x-p0x, aby=p1y-p0y, abz=p1z-p0z;
      const acx=p2x-p0x, acy=p2y-p0y, acz=p2z-p0z;
      const adx=p3x-p0x, ady=p3y-p0y, adz=p3z-p0z;

      // cross ac x ad etc for grads
      // vol = dot( cross(ab,ac), ad)/6
      // grads: 
      // grad p1 = cross(ac,ad)/6 etc - simplified approximate using formula
      const cross_ac_ad_x = acy*adz - acz*ady;
      const cross_ac_ad_y = acz*adx - acx*adz;
      const cross_ac_ad_z = acx*ady - acy*adx;

      const cross_ad_ab_x = ady*abz - adz*aby;
      const cross_ad_ab_y = adz*abx - adx*abz;
      const cross_ad_ab_z = adx*aby - ady*abx;

      const cross_ab_ac_x = aby*acz - abz*acy;
      const cross_ab_ac_y = abz*acx - abx*acz;
      const cross_ab_ac_z = abx*acy - aby*acx;

      const vol = (abx*cross_ac_ad_x + aby*cross_ac_ad_y + abz*cross_ac_ad_z)/6.0;
      const C = vol - c.rest;

      // gradients
      const g1x = cross_ac_ad_x/6, g1y = cross_ac_ad_y/6, g1z = cross_ac_ad_z/6;
      const g2x = cross_ad_ab_x/6, g2y = cross_ad_ab_y/6, g2z = cross_ad_ab_z/6;
      const g3x = cross_ab_ac_x/6, g3y = cross_ab_ac_y/6, g3z = cross_ab_ac_z/6;
      const g0x = -g1x - g2x - g3x;
      const g0y = -g1y - g2y - g3y;
      const g0z = -g1z - g2z - g3z;

      const wSum = wi*(g0x*g0x+g0y*g0y+g0z*g0z) + wj*(g1x*g1x+g1y*g1y+g1z*g1z) + wk*(g2x*g2x+g2y*g2y+g2z*g2z) + wl*(g3x*g3x+g3y*g3y+g3z*g3z);
      const alpha = c.compliance / dt2;
      const denom = wSum + alpha;
      if (Math.abs(denom) < 1e-12) continue;
      const dLambda = (-C - alpha*c.lambda)/denom;
      c.lambda += dLambda;

      pos[i3] += wi * g0x * dLambda;
      pos[i3+1] += wi * g0y * dLambda;
      pos[i3+2] += wi * g0z * dLambda;

      pos[j3] += wj * g1x * dLambda;
      pos[j3+1] += wj * g1y * dLambda;
      pos[j3+2] += wj * g1z * dLambda;

      pos[k3] += wk * g2x * dLambda;
      pos[k3+1] += wk * g2y * dLambda;
      pos[k3+2] += wk * g2z * dLambda;

      pos[l3] += wl * g3x * dLambda;
      pos[l3+1] += wl * g3y * dLambda;
      pos[l3+2] += wl * g3z * dLambda;
    }
  }

  applyPlasticity() {
    // For each distance constraint, check if strain beyond yield -> update rest
    const pos = this.positions;
    let totalPlastic = 0;
    let maxPlastic = 0;
    let numYield = 0;

    const process = (arr, isBend=false) => {
      for (let c of arr) {
        const i=c.i, j=c.j;
        const i3=i*3, j3=j*3;
        const dx = pos[i3]-pos[j3];
        const dy = pos[i3+1]-pos[j3+1];
        const dz = pos[i3+2]-pos[j3+2];
        const len = Math.hypot(dx,dy,dz);
        if (len < 1e-8) continue;

        const strain = (len - c.rest)/c.rest0; // engineering strain relative to original rest? or current rest?
        // Actually for plasticity we compare to current rest: elastic strain = (len - rest)/rest
        const elasticStrain = (len - c.rest)/c.rest;
        const absElastic = Math.abs(elasticStrain);

        // Yield with hardening: effective yield = initial yield + hardening * accumulated plastic
        const effectiveYield = c.yield + c.hardening * Math.abs(c.plasticStrain);

        if (absElastic > effectiveYield) {
          c.isYielding = true;
          numYield++;
          const excess = absElastic - effectiveYield;
          const sign = elasticStrain >=0 ? 1 : -1;
          // plastic flow: rest moves towards current length
          let deltaRest = excess * c.plasticRate * c.rest * sign;
          // limit plastic flow to avoid explosion
          // For metal, plastic deformation is permanent, so rest += delta
          c.rest += deltaRest;

          // accumulate plastic strain metric (relative to original)
          const newPlasticStrain = (c.rest - c.rest0)/c.rest0;
          // clamp
          if (Math.abs(newPlasticStrain) > this.params.maxPlastic) {
            c.rest = c.rest0 * (1 + Math.sign(newPlasticStrain)*this.params.maxPlastic);
          }
          c.plasticStrain = (c.rest - c.rest0)/c.rest0;

          // apply extra velocity damping for particles involved when yielding (handled in stats)
        } else {
          c.isYielding = false;
        }
        totalPlastic += Math.abs(c.plasticStrain);
        maxPlastic = Math.max(maxPlastic, Math.abs(c.plasticStrain));
      }
    };

    process(this.distanceConstraints, false);
    process(this.bendingConstraints, true);

    const totalConstraints = this.distanceConstraints.length + this.bendingConstraints.length;
    this.stats.avgPlastic = totalConstraints>0 ? totalPlastic/totalConstraints : 0;
    this.stats.maxPlastic = maxPlastic;
    this.stats.numYielded = numYield;
  }

  computeStats() {
    // already in applyPlasticity
  }

  // Collision helpers
  collideSphere(center, radius, friction=0.2) {
    const pos = this.positions;
    const vel = this.velocities;
    for (let i=0;i<this.numParticles;i++) {
      if (this.pinned[i]) continue;
      const idx=i*3;
      const dx = pos[idx]-center[0];
      const dy = pos[idx+1]-center[1];
      const dz = pos[idx+2]-center[2];
      const dist = Math.hypot(dx,dy,dz);
      if (dist < radius) {
        if (dist < 1e-8) continue;
        const nxn = dx/dist, nyn = dy/dist, nzn = dz/dist;
        const penetration = radius - dist;
        // push out
        pos[idx] += nxn*penetration;
        pos[idx+1] += nyn*penetration;
        pos[idx+2] += nzn*penetration;
        // friction on velocity: remove normal component and damp tangential
        const vdot = vel[idx]*nxn + vel[idx+1]*nyn + vel[idx+2]*nzn;
        if (vdot < 0) {
          // reflect partially with friction
          vel[idx] -= (1+friction)*vdot*nxn;
          vel[idx+1] -= (1+friction)*vdot*nyn;
          vel[idx+2] -= (1+friction)*vdot*nzn;
          // tangential damping
          vel[idx]*=(1-friction);
          vel[idx+1]*=(1-friction);
          vel[idx+2]*=(1-friction);
        }
      }
    }
  }

  collidePlane(point, normal, friction=0.3) {
    const pos = this.positions;
    const vel = this.velocities;
    const nx=normal[0], ny=normal[1], nz=normal[2];
    const px=point[0], py=point[1], pz=point[2];
    for (let i=0;i<this.numParticles;i++) {
      if (this.pinned[i]) continue;
      const idx=i*3;
      const dx = pos[idx]-px;
      const dy = pos[idx+1]-py;
      const dz = pos[idx+2]-pz;
      const dist = dx*nx + dy*ny + dz*nz;
      if (dist < 0) {
        // push out
        pos[idx] -= dist*nx;
        pos[idx+1] -= dist*ny;
        pos[idx+2] -= dist*nz;
        const vdot = vel[idx]*nx + vel[idx+1]*ny + vel[idx+2]*nz;
        if (vdot < 0) {
          vel[idx] -= (1+friction)*vdot*nx;
          vel[idx+1] -= (1+friction)*vdot*ny;
          vel[idx+2] -= (1+friction)*vdot*nz;
          vel[idx]*=(1-friction);
          vel[idx+1]*=(1-friction);
          vel[idx+2]*=(1-friction);
        }
      }
    }
  }

  collideBox(min, max, friction=0.3) {
    // simple AABB outside collision: keep particles outside box? Actually for wall
    const pos = this.positions;
    const vel = this.velocities;
    for (let i=0;i<this.numParticles;i++) {
      if (this.pinned[i]) continue;
      const idx=i*3;
      const x=pos[idx], y=pos[idx+1], z=pos[idx+2];
      if (x>=min[0] && x<=max[0] && y>=min[1] && y<=max[1] && z>=min[2] && z<=max[2]) {
        // find closest face
        const dmin = [x-min[0], y-min[1], z-min[2]];
        const dmax = [max[0]-x, max[1]-y, max[2]-z];
        let minDist = dmin[0], axis=0, dir=-1;
        if (dmin[1]<minDist){minDist=dmin[1];axis=1;dir=-1;}
        if (dmin[2]<minDist){minDist=dmin[2];axis=2;dir=-1;}
        if (dmax[0]<minDist){minDist=dmax[0];axis=0;dir=1;}
        if (dmax[1]<minDist){minDist=dmax[1];axis=1;dir=1;}
        if (dmax[2]<minDist){minDist=dmax[2];axis=2;dir=1;}
        if (axis===0){
          pos[idx]+= dir*minDist;
          if (dir*vel[idx]<0) vel[idx]*= -friction;
        } else if (axis===1){
          pos[idx+1]+= dir*minDist;
          if (dir*vel[idx+1]<0) vel[idx+1]*= -friction;
        } else {
          pos[idx+2]+= dir*minDist;
          if (dir*vel[idx+2]<0) vel[idx+2]*= -friction;
        }
      }
    }
  }

  getPositionsArray() {
    return this.positions;
  }
}
