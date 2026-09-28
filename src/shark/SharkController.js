import * as THREE from 'three';

/**
 * SharkController
 * Biomechanical procedural animation and hydrodynamic physics for Great Hammerhead Shark:
 * - Sub-carangiform traveling wave spine undulation
 * - Fully procedural directional turning system (C-curve / S-curve spine curvature, banking roll, pectoral fin trim)
 * - Kinetic palatoquadrate upper jaw protrusion and Meckel's cartilage lower jaw gape
 * - Violent lateral head-thrash feeding behavior
 * - Target tracking & predatory pursuit
 */

export class SharkController {
  constructor(sharkMeshGroup, boneMap, bones) {
    this.group = sharkMeshGroup;
    this.boneMap = boneMap;
    this.bones = bones;

    // Spatial Position & Orientation in Ocean World
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.heading = 0; // Current yaw heading in radians
    this.pitch = 0;
    this.roll = 0;

    // Movement Speeds
    this.speed = 1.6; // Current forward speed (m/s)
    this.targetSpeed = 1.6;
    this.cruiseSpeed = 1.6;
    this.sprintSpeed = 4.2;
    this.rushSpeed = 6.0;

    // Undulation wave parameters
    this.swimTime = 0;
    this.tailFrequency = 0.85; // Hz (strokes per second)
    this.targetTailFrequency = 0.85;
    this.tailAmplitude = 0.42;

    // Procedural Turning State
    this.targetHeading = 0;
    this.turnCurvature = 0; // Current lateral spine curvature (-1 to +1)
    this.targetTurnCurvature = 0;
    this.turnRate = 0; // Angular velocity (rad/s)
    this.maxTurnSpeed = 1.8; // rad/s
    this.bankAngle = 0;
    this.proceduralTurnInput = 0; // Direct user slider value (-1 to +1)

    // Attack & Kinetic Bite State Machine
    // States: 'CRUISE', 'SPRINT', 'RUSH', 'BITE_GAPE', 'BITE_PROTRUDE', 'BITE_SNAP', 'BITE_THRASH', 'RECOVER'
    this.state = 'CRUISE';
    this.stateTimer = 0;

    // Kinetic Jaw Parameters
    this.jawGape = 0; // 0 = closed, 1 = fully open
    this.palatoquadrateProtrusion = 0; // 0 = retracted, 1 = fully protruded
    this.thrashIntensity = 0; // 0 = calm, 1 = violent head thrash

    // Target tracking
    this.targetPoint = null;
    this.isHunting = false;

    // Tuning weights for spine bones during procedural turning
    // Higher flexibility toward posterior and anterior
    this.spineJoints = [
      { name: 'head_cephalofoil', flex: 0.35, waveAmp: 0.08, wavePhase: 0.0 },
      { name: 'neck', flex: 0.45, waveAmp: 0.12, wavePhase: 0.5 },
      { name: 'pectoral_spine', flex: 0.30, waveAmp: 0.15, wavePhase: 1.0 },
      { name: 'trunk_front', flex: 0.25, waveAmp: 0.18, wavePhase: 1.6 },
      { name: 'root', flex: 0.20, waveAmp: 0.22, wavePhase: 2.2 },
      { name: 'trunk_rear', flex: 0.30, waveAmp: 0.28, wavePhase: 2.8 },
      { name: 'pelvic_spine', flex: 0.45, waveAmp: 0.35, wavePhase: 3.4 },
      { name: 'tail_base', flex: 0.65, waveAmp: 0.45, wavePhase: 4.0 },
      { name: 'tail_mid', flex: 0.85, waveAmp: 0.58, wavePhase: 4.6 },
      { name: 'caudal_fin', flex: 1.00, waveAmp: 0.72, wavePhase: 5.2 }
    ];

    // Sound callbacks (hooked up by Audio system)
    this.onBiteSnap = null;
    this.onThrash = null;
    this.onRush = null;
  }

  /**
   * Set procedural turning direction directly (e.g. from UI slider or steering wheel)
   * value in [-1.0, 1.0] where -1 = max left turn, +1 = max right turn
   */
  setTurnInput(val) {
    this.proceduralTurnInput = THREE.MathUtils.clamp(val, -1.0, 1.0);
  }

  /**
   * Procedural Turn Around: Command shark to turn in a specific angle or 180° turnaround
   */
  turnByDegrees(degrees) {
    const rad = THREE.MathUtils.degToRad(degrees);
    this.targetHeading = this.normalizeAngle(this.heading + rad);
  }

  turnAround180() {
    this.turnByDegrees(180);
  }

  turnLeft90() {
    this.turnByDegrees(-90);
  }

  turnRight90() {
    this.turnByDegrees(90);
  }

  /**
   * Set target coordinate in 3D ocean space to swim towards / stalk
   */
  setTargetPoint(point, hunt = false) {
    this.targetPoint = point ? point.clone() : null;
    this.isHunting = hunt;
  }

  /**
   * Trigger Palatoquadrate Bite Strike
   */
  triggerBite() {
    if (this.state.startsWith('BITE')) return; // Already in bite sequence
    this.state = 'BITE_GAPE';
    this.stateTimer = 0;
    if (this.onRush) this.onRush();
  }

  /**
   * Trigger Violent Attack Combo: Charge Rush -> Gape -> Kinetic Protrusion -> Snap Bite -> Thrash -> Recover
   */
  triggerAttackCombo() {
    this.state = 'RUSH';
    this.stateTimer = 0;
    this.targetSpeed = this.rushSpeed;
    this.targetTailFrequency = 2.2;
    if (this.onRush) this.onRush();
  }

  /**
   * Main update tick (called every frame in render loop)
   */
  update(delta) {
    const dt = Math.min(delta, 0.1);

    // 1. Update State Machine (Attack & Kinetic Bite)
    this.updateStateMachine(dt);

    // 2. Procedural Navigation & Steering
    this.updateNavigation(dt);

    // 3. Movement Physics (Position & Velocity)
    this.updatePhysics(dt);

    // 4. Procedural Biomechanical Spine Kinematics & Wave Undulation
    this.updateSpineKinematics(dt);

    // 5. Kinetic Jaw & Feeding Articulation
    this.updateJawKinetics(dt);

    // 6. Fin Trimming & Hydrofoil Stabilization
    this.updateFinTrims(dt);
  }

  /**
   * Attack and Kinetic Feeding State Machine
   */
  updateStateMachine(dt) {
    this.stateTimer += dt;

    switch (this.state) {
      case 'CRUISE':
        this.targetSpeed = this.cruiseSpeed;
        this.targetTailFrequency = 0.85;
        this.jawGape = THREE.MathUtils.lerp(this.jawGape, 0.0, dt * 6.0);
        this.palatoquadrateProtrusion = THREE.MathUtils.lerp(this.palatoquadrateProtrusion, 0.0, dt * 6.0);
        this.thrashIntensity = THREE.MathUtils.lerp(this.thrashIntensity, 0.0, dt * 6.0);
        break;

      case 'SPRINT':
        this.targetSpeed = this.sprintSpeed;
        this.targetTailFrequency = 1.75;
        this.jawGape = THREE.MathUtils.lerp(this.jawGape, 0.0, dt * 6.0);
        this.palatoquadrateProtrusion = THREE.MathUtils.lerp(this.palatoquadrateProtrusion, 0.0, dt * 6.0);
        this.thrashIntensity = THREE.MathUtils.lerp(this.thrashIntensity, 0.0, dt * 6.0);
        break;

      case 'RUSH':
        // Accelerate into predatory burst
        this.targetSpeed = this.rushSpeed;
        this.targetTailFrequency = 2.4;
        if (this.stateTimer > 0.8) {
          this.state = 'BITE_GAPE';
          this.stateTimer = 0;
        }
        break;

      case 'BITE_GAPE':
        // Lower jaw opens wide (gape expansion)
        this.jawGape = THREE.MathUtils.lerp(this.jawGape, 1.0, dt * 14.0);
        // Kinetic palatoquadrate upper jaw begins detaching and pushing forward
        this.palatoquadrateProtrusion = THREE.MathUtils.lerp(this.palatoquadrateProtrusion, 0.6, dt * 12.0);
        if (this.stateTimer > 0.28) {
          this.state = 'BITE_PROTRUDE';
          this.stateTimer = 0;
        }
        break;

      case 'BITE_PROTRUDE':
        // Full kinetic palatoquadrate protrusion: upper jaw thrusts down and outward!
        this.jawGape = 1.0;
        this.palatoquadrateProtrusion = THREE.MathUtils.lerp(this.palatoquadrateProtrusion, 1.0, dt * 18.0);
        if (this.stateTimer > 0.16) {
          this.state = 'BITE_SNAP';
          this.stateTimer = 0;
          if (this.onBiteSnap) this.onBiteSnap();
        }
        break;

      case 'BITE_SNAP':
        // Rapid snap shut: jaws clamp together with high bite force!
        this.jawGape = THREE.MathUtils.lerp(this.jawGape, 0.12, dt * 26.0);
        // Upper jaw remains protruded during clamping
        this.palatoquadrateProtrusion = 0.85;
        if (this.stateTimer > 0.22) {
          this.state = 'BITE_THRASH';
          this.stateTimer = 0;
          if (this.onThrash) this.onThrash();
        }
        break;

      case 'BITE_THRASH':
        // Violent lateral head-shake (thrash) to cut prey tissue with serrated teeth
        this.thrashIntensity = THREE.MathUtils.lerp(this.thrashIntensity, 1.0, dt * 12.0);
        this.jawGape = 0.18 + 0.12 * Math.sin(this.stateTimer * 25.0); // subtle chewing clamp
        this.palatoquadrateProtrusion = 0.75;
        this.targetSpeed = 1.8;
        if (this.stateTimer > 1.2) {
          this.state = 'RECOVER';
          this.stateTimer = 0;
        }
        break;

      case 'RECOVER':
        // Retract palatoquadrate back inside skull, relax lower jaw, resume cruising
        this.thrashIntensity = THREE.MathUtils.lerp(this.thrashIntensity, 0.0, dt * 5.0);
        this.jawGape = THREE.MathUtils.lerp(this.jawGape, 0.0, dt * 4.0);
        this.palatoquadrateProtrusion = THREE.MathUtils.lerp(this.palatoquadrateProtrusion, 0.0, dt * 4.0);
        this.targetSpeed = this.cruiseSpeed;
        this.targetTailFrequency = 0.85;
        if (this.stateTimer > 0.9) {
          this.state = 'CRUISE';
          this.stateTimer = 0;
        }
        break;
    }
  }

  /**
   * Procedural Navigation:
   * Smoothly steers towards targetHeading, handles procedural input, and targets prey
   */
  updateNavigation(dt) {
    // If hunting target point, update heading to face it
    if (this.targetPoint) {
      const dx = this.targetPoint.x - this.position.x;
      const dz = this.targetPoint.z - this.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 0.4) {
        // In our coordinate system: +Z is forward along shark body axis
        // Heading is angle around Y axis
        this.targetHeading = Math.atan2(dx, dz);

        // Pitch towards target vertical position
        const dy = this.targetPoint.y - this.position.y;
        const targetPitch = THREE.MathUtils.clamp(-dy / dist, -0.45, 0.45);
        this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, dt * 3.0);

        // Auto trigger attack when close enough during hunting
        if (this.isHunting && dist < 4.0 && this.state === 'CRUISE') {
          this.triggerAttackCombo();
        }
      } else {
        // Arrived at target
        if (this.isHunting && this.state === 'CRUISE') {
          this.triggerBite();
        }
      }
    }

    // Direct turn input from slider overrides or biases target heading
    if (Math.abs(this.proceduralTurnInput) > 0.01) {
      this.targetHeading = this.normalizeAngle(this.heading + this.proceduralTurnInput * this.maxTurnSpeed * dt);
    }

    // Shortest angular difference between current heading and target heading
    let diff = this.normalizeAngle(this.targetHeading - this.heading);

    // Dynamic turning curvature (-1 = sharp left, +1 = sharp right)
    this.targetTurnCurvature = THREE.MathUtils.clamp(diff / (Math.PI * 0.5), -1.0, 1.0);
    this.turnCurvature = THREE.MathUtils.lerp(this.turnCurvature, this.targetTurnCurvature, dt * 4.5);

    // Angular velocity
    const turnVel = diff * 2.8;
    this.turnRate = THREE.MathUtils.clamp(turnVel, -this.maxTurnSpeed, this.maxTurnSpeed);
    this.heading = this.normalizeAngle(this.heading + this.turnRate * dt);

    // Realistic Banking (Roll):
    // Great hammerheads bank up to 25°-45° into sharp turns
    const targetBank = -this.turnCurvature * 0.55 * (this.speed / this.cruiseSpeed);
    this.bankAngle = THREE.MathUtils.lerp(this.bankAngle, targetBank, dt * 3.5);
  }

  /**
   * Movement Physics: Forward propulsion, velocity smoothing, and world position update
   */
  updatePhysics(dt) {
    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, dt * 2.5);
    this.tailFrequency = THREE.MathUtils.lerp(this.tailFrequency, this.targetTailFrequency, dt * 3.0);

    // Advance swimming wave clock
    this.swimTime += dt * this.tailFrequency;

    // Forward displacement vector (+Z in shark's local frame)
    const forwardX = Math.sin(this.heading) * Math.cos(this.pitch);
    const forwardY = -Math.sin(this.pitch);
    const forwardZ = Math.cos(this.heading) * Math.cos(this.pitch);

    this.velocity.set(forwardX, forwardY, forwardZ).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    // Constrain within virtual ocean boundaries (-40m to +40m horizontal, -12m to -0.8m depth)
    const oceanLimit = 38.0;
    if (Math.abs(this.position.x) > oceanLimit) {
      this.position.x = Math.sign(this.position.x) * oceanLimit;
      this.targetHeading = Math.atan2(-this.position.x, this.position.z);
    }
    if (Math.abs(this.position.z) > oceanLimit) {
      this.position.z = Math.sign(this.position.z) * oceanLimit;
      this.targetHeading = Math.atan2(this.position.x, -this.position.z);
    }
    if (this.position.y > -0.6) {
      this.position.y = -0.6;
      this.pitch = Math.max(0, this.pitch);
    }
    if (this.position.y < -12.5) {
      this.position.y = -12.5;
      this.pitch = Math.min(0, this.pitch);
    }

    // Apply translation & overall body rotation to root group
    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0);
    this.group.rotateY(this.heading);
    this.group.rotateX(this.pitch);
    this.group.rotateZ(this.bankAngle);
  }

  /**
   * Biomechanical Spine Kinematics:
   * 1. Traveling transverse undulation wave: y_i = A(z) * sin(2*pi*f*t - k*z)
   * 2. Procedural turning curvature: Joint bending proportional to turn curvature
   * 3. Violent lateral thrash: Rapid high-frequency head oscillation when tearing prey
   */
  updateSpineKinematics(dt) {
    const wavePhaseBase = this.swimTime * Math.PI * 2.0;

    // Thrash oscillation (rapid violent shake ~5 Hz)
    const thrashAngle = this.thrashIntensity * 0.45 * Math.sin(this.swimTime * Math.PI * 12.0);

    for (let i = 0; i < this.spineJoints.length; i++) {
      const joint = this.spineJoints[i];
      const bone = this.boneMap[joint.name];
      if (!bone) continue;

      // 1. Undulation wave angle for this joint
      const waveAngle = Math.sin(wavePhaseBase - joint.wavePhase) * joint.waveAmp * (this.speed / this.cruiseSpeed);

      // 2. Procedural turning flexure:
      // When turning, the spine forms an organic C-curve / S-curve
      // Curvature accumulates along the vertebral chain
      const turnFlex = this.turnCurvature * joint.flex * 0.38;

      // 3. Head thrash (most prominent at head, fades toward tail)
      const jointThrash = (1.0 - i / this.spineJoints.length) * thrashAngle;

      // Combined lateral yaw angle around Y axis
      bone.rotation.y = waveAngle + turnFlex + jointThrash;

      // Subtle vertical pitch undulation (heterocercal caudal fin lift compensation)
      if (joint.name === 'caudal_fin') {
        bone.rotation.x = Math.sin(wavePhaseBase - joint.wavePhase + 0.8) * 0.08;
      }
    }
  }

  /**
   * Kinetic Jaw & Palatoquadrate Articulation:
   * Sphyrna mokarran upper jaw (palatoquadrate) disconnects and protrudes forward & downward,
   * while lower jaw (Meckel's cartilage) swings open.
   */
  updateJawKinetics(dt) {
    const jawUpper = this.boneMap['jaw_upper'];
    const jawLower = this.boneMap['jaw_lower'];

    if (jawUpper) {
      // Palatoquadrate Protrusion:
      // Slides downwards (negative Y) and forwards (positive Z)
      const protrudeY = -0.12 - this.palatoquadrateProtrusion * 0.12; // extends down by up to 12 cm!
      const protrudeZ = -0.22 + this.palatoquadrateProtrusion * 0.09; // pushes forward by 9 cm!
      jawUpper.position.set(0, protrudeY, protrudeZ);
      // Slight downward tilt of upper jaw when protruded
      jawUpper.rotation.x = -this.palatoquadrateProtrusion * 0.22;
    }

    if (jawLower) {
      // Meckel's Cartilage:
      // Rotates down around the quadrate-articular hinge
      // Max gape angle ~ 48 degrees (0.84 radians)
      jawLower.rotation.x = -this.jawGape * 0.84;
      // Slight downward translation during maximum gape
      jawLower.position.y = -0.16 - this.jawGape * 0.06;
    }
  }

  /**
   * Fin Trimming & Hydrofoil Stabilization:
   * Dynamic pectoral fin trim for banking roll, pitch control, and turn stabilization
   */
  updateFinTrims(dt) {
    const pecL = this.boneMap['pec_L'];
    const pecR = this.boneMap['pec_R'];

    if (pecL && pecR) {
      // Asymmetric trim for turning:
      // The inside fin pitches to induce turning roll, outside fin stabilizes
      const trimRoll = this.turnCurvature * 0.28;

      // Vertical pitch trim: flare downward when braking/rushing
      const flarePitch = this.state === 'RUSH' || this.state === 'BITE_GAPE' ? -0.35 : 0.0;

      // Rhythmic trimming wave with swim stroke
      const trimFlutter = Math.sin(this.swimTime * Math.PI * 2) * 0.06;

      pecL.rotation.z = 0.20 + trimRoll + trimFlutter;
      pecL.rotation.x = flarePitch;

      pecR.rotation.z = -0.20 + trimRoll - trimFlutter;
      pecR.rotation.x = flarePitch;
    }
  }

  /**
   * Helper to normalize angles to [-PI, PI]
   */
  normalizeAngle(angle) {
    let a = angle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
}
