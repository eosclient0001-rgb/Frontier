import * as THREE from 'three';

/**
 * Creates biologically authentic animation clips for the Scorpion model:
 * 1. Walk Cycle (Alternating Tetrapod Gait with Metachronal Phasing)
 * 2. Attack (Predatory Pincer Grab + Overhead Lightning Aculeus Stinger Strike)
 * 3. Stinger Strike (Defensive Tail Whip Strike)
 * 4. Pincer Attack (Rapid Chelae Snatch & Clamp)
 * 5. Threat Display (Warning / Intimidation Stance)
 * 6. Idle (Living Breathing Respiration & Sensory Micro-adjustments)
 */
export function createScorpionAnimations(joints) {
  const clips = [];

  // Helper: create a QuaternionKeyframeTrack from Euler angles (x, y, z)
  function makeRotTrack(jointName, times, eulerArray) {
    const quatValues = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();

    for (let i = 0; i < eulerArray.length; i++) {
      const [rx, ry, rz] = eulerArray[i];
      e.set(rx, ry, rz, 'XYZ');
      q.setFromEuler(e);
      quatValues.push(q.x, q.y, q.z, q.w);
    }

    return new THREE.QuaternionKeyframeTrack(`${jointName}.quaternion`, times, quatValues);
  }

  // Helper: create a Vector3KeyframeTrack for position
  function makePosTrack(jointName, times, posArray) {
    const flat = [];
    for (let i = 0; i < posArray.length; i++) {
      flat.push(posArray[i][0], posArray[i][1], posArray[i][2]);
    }
    return new THREE.VectorKeyframeTrack(`${jointName}.position`, times, flat);
  }

  // =========================================================================
  // 1. WALK CYCLE (Alternating Tetrapod Gait with Metachronal Lag)
  // =========================================================================
  // Scientific basis: Bowerman (1975, 1981); Spagna et al. (2011)
  // Two antiphase tetrapods:
  //   Tetrapod A: R1, L2, R3, L4
  //   Tetrapod B: L1, R2, L3, R4
  // Metachronal wave within tetrapods (rear leg initiates swing ~10% ahead)
  {
    const duration = 1.4;
    const numFrames = 29;
    const times = [];
    for (let i = 0; i < numFrames; i++) times.push((i / (numFrames - 1)) * duration);

    const tracks = [];

    // Root / Prosoma Heave & Sway (subtle bounce and roll)
    const prosomaRot = [];
    const prosomaPos = [];
    for (let i = 0; i < numFrames; i++) {
      const phase = (i / (numFrames - 1)) * Math.PI * 4; // 2 steps per walk cycle
      const heave = Math.sin(phase) * 0.012;
      const roll = Math.sin(phase * 0.5) * 0.025;
      const yaw = Math.cos(phase * 0.5) * 0.02;

      prosomaPos.push([0, 0.22 + heave, 0.25]);
      prosomaRot.push([0.02 + heave * 0.5, yaw, roll]);
    }
    tracks.push(makePosTrack('prosoma', times, prosomaPos));
    tracks.push(makeRotTrack('prosoma', times, prosomaRot));

    // Dynamic Tail (Metasoma) Counterbalance Sway
    // The tail curls over the back and gently counter-swoops to maintain balance
    for (let seg = 1; seg <= 5; seg++) {
      const segName = `metasoma_${seg}`;
      const defaultPitch = [0.32, 0.42, 0.50, 0.58, 0.65][seg - 1];
      const tailRot = [];
      for (let i = 0; i < numFrames; i++) {
        const tNorm = i / (numFrames - 1);
        const sway = Math.sin(tNorm * Math.PI * 2) * (0.04 * seg);
        const bob = Math.cos(tNorm * Math.PI * 4) * (0.02 * seg);
        tailRot.push([defaultPitch + bob, -sway, sway * 0.3]);
      }
      tracks.push(makeRotTrack(segName, times, tailRot));
    }

    // Telson balance
    const telsonRot = [];
    for (let i = 0; i < numFrames; i++) {
      const tNorm = i / (numFrames - 1);
      const sway = Math.sin(tNorm * Math.PI * 2) * 0.12;
      telsonRot.push([0.55 + Math.cos(tNorm * Math.PI * 4) * 0.05, -sway, 0]);
    }
    tracks.push(makeRotTrack('telson', times, telsonRot));

    // Pedipalps (Held aloft, scanning with subtle rhythm)
    ['L', 'R'].forEach((side) => {
      const isLeft = side === 'L';
      const sign = isLeft ? 1 : -1;
      const trochRot = [];
      const chelaRot = [];

      for (let i = 0; i < numFrames; i++) {
        const tNorm = i / (numFrames - 1);
        const osc = Math.sin(tNorm * Math.PI * 2 + (isLeft ? 0 : Math.PI)) * 0.04;
        trochRot.push([0, sign * 0.45 + osc, -sign * 0.1]);
        chelaRot.push([0, -sign * 0.25 + osc * 0.5, -sign * 0.18]);
      }
      tracks.push(makeRotTrack(`pedipalp_${side}_trochanter`, times, trochRot));
      tracks.push(makeRotTrack(`chela_${side}_manus`, times, chelaRot));
    });

    // 8 Legs Kinematics (Alternating Tetrapods + Metachronal Phasing)
    // Tetrapod assignment:
    // Tetrapod A (phaseOffset = 0): R1, L2, R3, L4
    // Tetrapod B (phaseOffset = 0.5): L1, R2, L3, R4
    const legList = [
      { side: 'L', id: 1, tetrapod: 'B', wave: 0.15 },
      { side: 'L', id: 2, tetrapod: 'A', wave: 0.10 },
      { side: 'L', id: 3, tetrapod: 'B', wave: 0.05 },
      { side: 'L', id: 4, tetrapod: 'A', wave: 0.00 },

      { side: 'R', id: 1, tetrapod: 'A', wave: 0.15 },
      { side: 'R', id: 2, tetrapod: 'B', wave: 0.10 },
      { side: 'R', id: 3, tetrapod: 'A', wave: 0.05 },
      { side: 'R', id: 4, tetrapod: 'B', wave: 0.00 },
    ];

    legList.forEach((leg) => {
      const sign = leg.side === 'L' ? 1 : -1;
      const basePhase = (leg.tetrapod === 'A' ? 0.0 : 0.5) + leg.wave;

      const trochRot = [];
      const femurRot = [];
      const tibiaRot = [];
      const tarsusRot = [];

      const defaultY = [0.45, 0.15, -0.22, -0.62][leg.id - 1];

      for (let i = 0; i < numFrames; i++) {
        const tNorm = i / (numFrames - 1);
        const cycleT = (tNorm + basePhase) % 1.0;

        // In a cycle: 0 to 0.45 is SWING (lift, forward arc, strike down)
        // 0.45 to 1.0 is STANCE (plant on ground, push backward)
        let swingFactor = 0;
        let liftFactor = 0;
        let reachFactor = 0;

        if (cycleT < 0.45) {
          // SWING PHASE
          const s = cycleT / 0.45; // 0 to 1
          liftFactor = Math.sin(s * Math.PI); // arch up and down
          reachFactor = -Math.cos(s * Math.PI); // reach from -1 (rear) to +1 (front)
        } else {
          // STANCE PHASE
          const s = (cycleT - 0.45) / 0.55; // 0 to 1
          liftFactor = 0; // firmly planted on substrate
          reachFactor = 1.0 - 2.0 * s; // push backward from +1 to -1
        }

        // Trochanter Y rotation: forward/backward stride
        const strideAngle = reachFactor * 0.18;
        trochRot.push([0, sign * (defaultY + strideAngle), 0]);

        // Femur Z rotation: lift during swing
        const femurLift = liftFactor * 0.22;
        femurRot.push([0.05, 0, -sign * (0.55 + femurLift)]);

        // Tibia Z rotation: extend and bend to plant
        const tibiaFlex = liftFactor * 0.15 - reachFactor * 0.08;
        tibiaRot.push([0, -sign * 0.1, sign * (1.05 + tibiaFlex)]);

        // Tarsus ground adaptation
        tarsusRot.push([0, 0, -sign * (0.40 + liftFactor * 0.1)]);
      }

      tracks.push(makeRotTrack(`leg_${leg.side}${leg.id}_trochanter`, times, trochRot));
      tracks.push(makeRotTrack(`leg_${leg.side}${leg.id}_femur`, times, femurRot));
      tracks.push(makeRotTrack(`leg_${leg.side}${leg.id}_tibia`, times, tibiaRot));
      tracks.push(makeRotTrack(`leg_${leg.side}${leg.id}_tarsus`, times, tarsusRot));
    });

    clips.push(new THREE.AnimationClip('Walk', duration, tracks));
  }

  // =========================================================================
  // 2. ATTACK ANIMATION (Predatory Pincer Snatch + Lightning Aculeus Stinger Strike)
  // =========================================================================
  // Scientific basis: Coelho et al. (2017) 500 fps high-speed stinger strike kinematics
  // Sequence:
  //   0.0 - 0.5s: Threat windup / Prosoma rears / Pincers splay open / Tail cocks back
  //   0.5 - 0.8s: Pincer snatch & clamp down on prey
  //   0.8 - 1.25s: Explosive overhead metasoma whip-thrust plunge
  //   1.25 - 1.6s: Venom injection hold & pulse
  //   1.6 - 2.0s: Stinger snap extraction & prey draw-in toward mouthparts
  //   2.0 - 2.4s: Return to alert guard
  {
    const duration = 2.4;
    const numFrames = 49;
    const times = [];
    for (let i = 0; i < numFrames; i++) times.push((i / (numFrames - 1)) * duration);

    const tracks = [];

    // Prosoma (Cephalothorax) Body Movement
    const prosomaPos = [];
    const prosomaRot = [];
    for (let i = 0; i < numFrames; i++) {
      const t = times[i];
      let y = 0.22;
      let pitch = 0.0;

      if (t < 0.6) {
        // Windup: rear up
        const s = t / 0.6;
        pitch = 0.25 * Math.sin(s * Math.PI * 0.5);
        y = 0.22 + 0.06 * Math.sin(s * Math.PI * 0.5);
      } else if (t < 0.9) {
        // Pincer grab: lunge forward
        const s = (t - 0.6) / 0.3;
        pitch = 0.25 - 0.35 * s; // dip forward
        y = 0.28 - 0.08 * s;
      } else if (t < 1.25) {
        // Stinger strike: brace body downward
        pitch = -0.10;
        y = 0.20;
      } else if (t < 1.6) {
        // Hold & venom pulse
        const pulse = Math.sin((t - 1.25) * 20) * 0.01;
        pitch = -0.08 + pulse;
        y = 0.21;
      } else {
        // Recovery
        const s = (t - 1.6) / 0.8;
        pitch = -0.08 * (1 - s);
        y = 0.21 + (0.22 - 0.21) * s;
      }

      prosomaPos.push([0, y, 0.25]);
      prosomaRot.push([pitch, 0, 0]);
    }
    tracks.push(makePosTrack('prosoma', times, prosomaPos));
    tracks.push(makeRotTrack('prosoma', times, prosomaRot));

    // Pedipalps & Chelae (Pincers) - Splay, Grab, Clamp, and Draw-In
    ['L', 'R'].forEach((side) => {
      const isLeft = side === 'L';
      const sign = isLeft ? 1 : -1;

      const trochRot = [];
      const femurRot = [];
      const patellaRot = [];
      const manusRot = [];
      const fingerRot = [];

      for (let i = 0; i < numFrames; i++) {
        const t = times[i];

        let splayAngle = sign * 0.45;
        let femurY = sign * 0.35;
        let patellaY = -sign * 0.85;
        let clampAngle = -sign * 0.20; // default slightly open

        if (t < 0.5) {
          // Windup: splay pincers wide apart and open jaws wide!
          const s = t / 0.5;
          splayAngle = sign * (0.45 + 0.35 * s); // wide abduction
          femurY = sign * (0.35 + 0.20 * s);
          patellaY = -sign * (0.85 - 0.25 * s);
          clampAngle = -sign * (0.20 + 0.55 * s); // jaws gaping wide (0.75 rad)
        } else if (t < 0.75) {
          // Rapid snap clamp: thrust forward & inward and clamp shut!
          const s = (t - 0.5) / 0.25;
          splayAngle = sign * (0.80 - 0.50 * s); // close inward
          patellaY = -sign * (0.60 + 0.50 * s); // bend inward
          clampAngle = -sign * (0.75 - 0.80 * s); // snap shut tight (-0.05 rad)
        } else if (t < 1.5) {
          // Hold prey clamped tightly in place while stinger strikes!
          splayAngle = sign * 0.30;
          patellaY = -sign * 1.10;
          clampAngle = sign * 0.02; // locked shut
        } else if (t < 1.9) {
          // Pull prey inward toward mouthparts
          const s = (t - 1.5) / 0.4;
          splayAngle = sign * (0.30 - 0.10 * s);
          patellaY = -sign * (1.10 + 0.15 * s);
          clampAngle = sign * 0.02;
        } else {
          // Return to alert guard
          const s = (t - 1.9) / 0.5;
          splayAngle = sign * (0.20 + 0.25 * s);
          patellaY = -sign * (1.25 - 0.40 * s);
          clampAngle = -sign * (0.02 + 0.18 * s);
        }

        trochRot.push([0, splayAngle, -sign * 0.1]);
        femurRot.push([0, femurY, -sign * 0.08]);
        patellaRot.push([-0.15, patellaY, 0]);
        manusRot.push([0, -sign * 0.25, -sign * 0.18]);
        fingerRot.push([0, clampAngle, 0]);
      }

      tracks.push(makeRotTrack(`pedipalp_${side}_trochanter`, times, trochRot));
      tracks.push(makeRotTrack(`pedipalp_${side}_femur`, times, femurRot));
      tracks.push(makeRotTrack(`pedipalp_${side}_patella`, times, patellaRot));
      tracks.push(makeRotTrack(`chela_${side}_manus`, times, manusRot));
      tracks.push(makeRotTrack(`finger_${side}_movable`, times, fingerRot));
    });

    // Metasoma (Tail) Strike Kinematics (Segments 1 to 5 + Telson)
    // The stinger performs a blinding overhead whip plunge!
    for (let seg = 1; seg <= 5; seg++) {
      const segName = `metasoma_${seg}`;
      const defaultPitch = [0.32, 0.42, 0.50, 0.58, 0.65][seg - 1];
      const tailRot = [];

      for (let i = 0; i < numFrames; i++) {
        const t = times[i];
        let pitch = defaultPitch;

        if (t < 0.6) {
          // Cock back into coiled spring tension
          const s = t / 0.6;
          pitch = defaultPitch - 0.25 * s;
        } else if (t < 0.85) {
          // Accelerate overhead in whip-like forward strike
          const s = (t - 0.6) / 0.25;
          const strikeCurve = Math.pow(s, 2.5); // explosive acceleration
          pitch = (defaultPitch - 0.25) + 0.70 * strikeCurve; // deep forward curl
        } else if (t < 1.15) {
          // Plunge stinger down into target!
          const s = (t - 0.85) / 0.30;
          pitch = (defaultPitch + 0.45) + 0.10 * Math.sin(s * Math.PI);
        } else if (t < 1.55) {
          // Hold embedded & pulse
          pitch = defaultPitch + 0.40;
        } else if (t < 1.9) {
          // Rapid snap extraction & recoil backward
          const s = (t - 1.55) / 0.35;
          pitch = (defaultPitch + 0.40) - 0.55 * s;
        } else {
          // Settle to default guard posture
          const s = (t - 1.9) / 0.5;
          pitch = (defaultPitch - 0.15) + 0.15 * s;
        }

        tailRot.push([pitch, 0, 0]);
      }
      tracks.push(makeRotTrack(segName, times, tailRot));
    }

    // Telson (Aculeus Stinger Needle) Angle & Plunge
    const telsonRot = [];
    for (let i = 0; i < numFrames; i++) {
      const t = times[i];
      let pitch = 0.55;

      if (t < 0.6) {
        // Cocked back
        pitch = 0.35;
      } else if (t < 0.9) {
        // Whip forward and angle stinger downward
        const s = (t - 0.6) / 0.3;
        pitch = 0.35 + 0.85 * Math.pow(s, 2); // 1.20 rad driving stinger down!
      } else if (t < 1.45) {
        // Penetrating target
        const pulse = Math.sin((t - 0.9) * 25) * 0.04;
        pitch = 1.25 + pulse;
      } else if (t < 1.8) {
        // Rapid extraction recoil
        const s = (t - 1.45) / 0.35;
        pitch = 1.25 - 0.90 * s;
      } else {
        // Settle back to default
        const s = (t - 1.8) / 0.6;
        pitch = 0.35 + 0.20 * s;
      }

      telsonRot.push([pitch, 0, 0]);
    }
    tracks.push(makeRotTrack('telson', times, telsonRot));

    // Legs: Brace and support high-impact strike
    ['L', 'R'].forEach((side) => {
      const sign = side === 'L' ? 1 : -1;
      [1, 2, 3, 4].forEach((id) => {
        const femurRot = [];
        for (let i = 0; i < numFrames; i++) {
          const t = times[i];
          let brace = 0;
          if (t > 0.6 && t < 1.4) {
            brace = 0.12; // crouch and brace
          }
          femurRot.push([0.05, 0, -sign * (0.55 - brace)]);
        }
        tracks.push(makeRotTrack(`leg_${side}${id}_femur`, times, femurRot));
      });
    });

    clips.push(new THREE.AnimationClip('Attack', duration, tracks));
  }

  // =========================================================================
  // 3. STINGER STRIKE (Dedicated Defensive Tail Whip)
  // =========================================================================
  {
    const duration = 1.2;
    const numFrames = 25;
    const times = [];
    for (let i = 0; i < numFrames; i++) times.push((i / (numFrames - 1)) * duration);

    const tracks = [];

    for (let seg = 1; seg <= 5; seg++) {
      const segName = `metasoma_${seg}`;
      const defaultPitch = [0.32, 0.42, 0.50, 0.58, 0.65][seg - 1];
      const tailRot = [];

      for (let i = 0; i < numFrames; i++) {
        const t = times[i];
        let pitch = defaultPitch;

        if (t < 0.2) {
          // Coil back
          const s = t / 0.2;
          pitch = defaultPitch - 0.30 * s;
        } else if (t < 0.45) {
          // Explosive whip forward
          const s = (t - 0.2) / 0.25;
          pitch = (defaultPitch - 0.30) + 0.85 * Math.pow(s, 2);
        } else if (t < 0.7) {
          // Rapid snap recoil
          const s = (t - 0.45) / 0.25;
          pitch = (defaultPitch + 0.55) - 0.70 * s;
        } else {
          // Settle
          const s = (t - 0.7) / 0.5;
          pitch = (defaultPitch - 0.15) + 0.15 * s;
        }

        tailRot.push([pitch, 0, 0]);
      }
      tracks.push(makeRotTrack(segName, times, tailRot));
    }

    // Telson stinger jab
    const telsonRot = [];
    for (let i = 0; i < numFrames; i++) {
      const t = times[i];
      let pitch = 0.55;
      if (t < 0.2) {
        pitch = 0.30;
      } else if (t < 0.45) {
        const s = (t - 0.2) / 0.25;
        pitch = 0.30 + 1.05 * Math.pow(s, 2);
      } else if (t < 0.7) {
        const s = (t - 0.45) / 0.25;
        pitch = 1.35 - 0.95 * s;
      } else {
        const s = (t - 0.7) / 0.5;
        pitch = 0.40 + 0.15 * s;
      }
      telsonRot.push([pitch, 0, 0]);
    }
    tracks.push(makeRotTrack('telson', times, telsonRot));

    clips.push(new THREE.AnimationClip('StingerStrike', duration, tracks));
  }

  // =========================================================================
  // 4. PINCER ATTACK (Dedicated Chelae Snatch & Clamp)
  // =========================================================================
  {
    const duration = 1.4;
    const numFrames = 29;
    const times = [];
    for (let i = 0; i < numFrames; i++) times.push((i / (numFrames - 1)) * duration);

    const tracks = [];

    ['L', 'R'].forEach((side) => {
      const isLeft = side === 'L';
      const sign = isLeft ? 1 : -1;

      const trochRot = [];
      const patellaRot = [];
      const fingerRot = [];

      for (let i = 0; i < numFrames; i++) {
        const t = times[i];
        let splayAngle = sign * 0.45;
        let patellaY = -sign * 0.85;
        let clampAngle = -sign * 0.20;

        if (t < 0.35) {
          // Open wide and raise
          const s = t / 0.35;
          splayAngle = sign * (0.45 + 0.35 * s);
          patellaY = -sign * (0.85 - 0.20 * s);
          clampAngle = -sign * (0.20 + 0.60 * s);
        } else if (t < 0.6) {
          // Snap shut 1
          const s = (t - 0.35) / 0.25;
          splayAngle = sign * (0.80 - 0.45 * s);
          patellaY = -sign * (0.65 + 0.45 * s);
          clampAngle = sign * 0.02; // shut
        } else if (t < 0.85) {
          // Quick release & reopen
          const s = (t - 0.6) / 0.25;
          clampAngle = -sign * (0.50 * s);
        } else if (t < 1.1) {
          // Hard clamp 2
          clampAngle = sign * 0.03;
        } else {
          // Return
          const s = (t - 1.1) / 0.3;
          splayAngle = sign * (0.35 + 0.10 * s);
          patellaY = -sign * (1.10 - 0.25 * s);
          clampAngle = -sign * (0.03 + 0.17 * s);
        }

        trochRot.push([0, splayAngle, -sign * 0.1]);
        patellaRot.push([-0.15, patellaY, 0]);
        fingerRot.push([0, clampAngle, 0]);
      }

      tracks.push(makeRotTrack(`pedipalp_${side}_trochanter`, times, trochRot));
      tracks.push(makeRotTrack(`pedipalp_${side}_patella`, times, patellaRot));
      tracks.push(makeRotTrack(`finger_${side}_movable`, times, fingerRot));
    });

    clips.push(new THREE.AnimationClip('PincerAttack', duration, tracks));
  }

  // =========================================================================
  // 5. THREAT DISPLAY (Warning / Intimidation Stance)
  // =========================================================================
  {
    const duration = 2.0;
    const numFrames = 41;
    const times = [];
    for (let i = 0; i < numFrames; i++) times.push((i / (numFrames - 1)) * duration);

    const tracks = [];

    // Reared Prosoma
    const prosomaRot = [];
    const prosomaPos = [];
    for (let i = 0; i < numFrames; i++) {
      const t = times[i];
      const tremor = Math.sin(t * 18) * 0.008;
      prosomaPos.push([0, 0.28, 0.25]);
      prosomaRot.push([0.22 + tremor, 0, 0]);
    }
    tracks.push(makePosTrack('prosoma', times, prosomaPos));
    tracks.push(makeRotTrack('prosoma', times, prosomaRot));

    // Splayed Gaping Pincers (Held high and wide)
    ['L', 'R'].forEach((side) => {
      const sign = side === 'L' ? 1 : -1;
      const trochRot = [];
      const femurRot = [];
      const fingerRot = [];

      for (let i = 0; i < numFrames; i++) {
        const t = times[i];
        const tremor = Math.sin(t * 15) * 0.015;
        trochRot.push([0, sign * (0.75 + tremor), -sign * 0.15]);
        femurRot.push([0.15, sign * 0.45, -sign * 0.25]); // high elevation
        fingerRot.push([0, -sign * (0.65 + tremor * 0.5), 0]); // gaping jaws
      }

      tracks.push(makeRotTrack(`pedipalp_${side}_trochanter`, times, trochRot));
      tracks.push(makeRotTrack(`pedipalp_${side}_femur`, times, femurRot));
      tracks.push(makeRotTrack(`finger_${side}_movable`, times, fingerRot));
    });

    // Rigid Arched Metasoma with trembling poised stinger
    for (let seg = 1; seg <= 5; seg++) {
      const segName = `metasoma_${seg}`;
      const defaultPitch = [0.38, 0.52, 0.62, 0.72, 0.78][seg - 1];
      const tailRot = [];
      for (let i = 0; i < numFrames; i++) {
        const t = times[i];
        const twitch = Math.sin(t * 22) * 0.012;
        tailRot.push([defaultPitch + twitch, 0, 0]);
      }
      tracks.push(makeRotTrack(segName, times, tailRot));
    }

    const telsonRot = [];
    for (let i = 0; i < numFrames; i++) {
      const t = times[i];
      const tremor = Math.sin(t * 24) * 0.02;
      telsonRot.push([0.85 + tremor, 0, 0]);
    }
    tracks.push(makeRotTrack('telson', times, telsonRot));

    clips.push(new THREE.AnimationClip('Threat', duration, tracks));
  }

  // =========================================================================
  // 6. IDLE ANIMATION (Organic Respiration & Micro-Adjustments)
  // =========================================================================
  {
    const duration = 3.2;
    const numFrames = 33;
    const times = [];
    for (let i = 0; i < numFrames; i++) times.push((i / (numFrames - 1)) * duration);

    const tracks = [];

    // Mesosoma breathing expansion (segments 2 to 6 expand/contract rhythmically)
    for (let seg = 2; seg <= 6; seg++) {
      const segName = `mesosoma_${seg}`;
      const scaleTrack = [];
      for (let i = 0; i < numFrames; i++) {
        const t = times[i];
        const breath = Math.sin((t / duration) * Math.PI * 2) * 0.025;
        scaleTrack.push(1.0 + breath, 1.0 + breath * 1.5, 1.0 + breath * 0.5);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${segName}.scale`, times, scaleTrack));
    }

    // Prosoma subtle breathing heave
    const prosomaPos = [];
    for (let i = 0; i < numFrames; i++) {
      const t = times[i];
      const breath = Math.sin((t / duration) * Math.PI * 2) * 0.005;
      prosomaPos.push([0, 0.22 + breath, 0.25]);
    }
    tracks.push(makePosTrack('prosoma', times, prosomaPos));

    // Tail subtle organic drift
    for (let seg = 1; seg <= 5; seg++) {
      const segName = `metasoma_${seg}`;
      const defaultPitch = [0.32, 0.42, 0.50, 0.58, 0.65][seg - 1];
      const tailRot = [];
      for (let i = 0; i < numFrames; i++) {
        const t = times[i];
        const drift = Math.sin((t / duration) * Math.PI * 2 + seg * 0.4) * 0.02;
        const sway = Math.cos((t / duration) * Math.PI * 2 + seg * 0.2) * 0.015;
        tailRot.push([defaultPitch + drift, sway, 0]);
      }
      tracks.push(makeRotTrack(segName, times, tailRot));
    }

    // Pedipalps sensory twitching (trichobothria micro-movements)
    ['L', 'R'].forEach((side) => {
      const sign = side === 'L' ? 1 : -1;
      const fingerRot = [];
      const chelaRot = [];

      for (let i = 0; i < numFrames; i++) {
        const t = times[i];
        const twitch = Math.sin(t * 7.5 + (side === 'L' ? 0 : 2.5)) * 0.02;
        fingerRot.push([0, -sign * (0.20 + twitch), 0]);
        chelaRot.push([0, -sign * (0.25 + twitch * 0.3), -sign * 0.18]);
      }
      tracks.push(makeRotTrack(`finger_${side}_movable`, times, fingerRot));
      tracks.push(makeRotTrack(`chela_${side}_manus`, times, chelaRot));
    });

    clips.push(new THREE.AnimationClip('Idle', duration, tracks));
  }

  return clips;
}
