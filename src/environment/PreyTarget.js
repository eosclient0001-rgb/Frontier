import * as THREE from 'three';

/**
 * Interactive Prey Target: Southern Stingray (Hypanus americanus)
 * Hammerheads specialize in hunting rays on the sea floor using electroreceptors!
 * Features:
 * - Diamond ray disc with realistic pectoral wing undulation
 * - Slender whip tail with venom spine
 * - Autonomous swimming or user-draggable target
 */

export function createPreyStingray(scene) {
  const rayGroup = new THREE.Group();

  // Create Stingray Geometry
  const width = 2.2;
  const length = 2.4;
  const discGeom = new THREE.PlaneGeometry(width, length, 32, 32);
  discGeom.rotateX(-Math.PI * 0.5);

  const pos = discGeom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    // Diamond disc shape profile
    const normDist = Math.abs(x) / (width * 0.5) + Math.abs(z) / (length * 0.5);
    let y = 0;
    if (normDist < 1.0) {
      // Dorsal hump in center
      y = (1.0 - normDist) * 0.22;
    } else {
      // Flatten outer edges
      y = 0.01;
    }
    pos.setY(i, y);
  }
  discGeom.computeVertexNormals();

  const discMat = new THREE.MeshStandardMaterial({
    color: 0x4a433a, // Sandy brown dorsal
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide
  });

  const discMesh = new THREE.Mesh(discGeom, discMat);
  rayGroup.add(discMesh);

  // Whip Tail
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.05, -length * 0.5),
    new THREE.Vector3(0, 0.06, -length * 0.5 - 1.2),
    new THREE.Vector3(0, 0.12, -length * 0.5 - 2.4)
  ]);
  const tailGeom = new THREE.TubeGeometry(tailCurve, 20, 0.03, 8, false);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x302a24, roughness: 0.8 });
  const tailMesh = new THREE.Mesh(tailGeom, tailMat);
  rayGroup.add(tailMesh);

  // Target Indicator Ring (Glowing cyan holographic circle)
  const ringGeom = new THREE.RingGeometry(1.6, 1.8, 32);
  ringGeom.rotateX(-Math.PI * 0.5);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.65
  });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  ringMesh.position.y = 0.05;
  rayGroup.add(ringMesh);

  // Initial Position (swimming above seabed)
  rayGroup.position.set(10, -10.5, 8);
  scene.add(rayGroup);

  let swimTime = 0;
  let targetPos = new THREE.Vector3(10, -10.5, 8);
  let wanderHeading = 0;

  return {
    group: rayGroup,
    ring: ringMesh,
    position: rayGroup.position,
    setTargetPos: (x, y, z) => {
      targetPos.set(x, y, z);
    },
    update: (delta, time) => {
      swimTime += delta * 1.5;

      // Animate ray pectoral wing undulation
      const posAttr = discGeom.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);

        // Wing wave propagates from anterior to posterior and outward to wingtips
        const wingDist = Math.abs(x) / (width * 0.5);
        if (wingDist > 0.25) {
          const wave = Math.sin(swimTime * 4.0 - z * 3.0) * (wingDist - 0.25) * 0.20;
          posAttr.setY(i, wave);
        }
      }
      discGeom.computeVertexNormals();
      discGeom.attributes.position.needsUpdate = true;

      // Target indicator pulse
      ringMat.opacity = 0.4 + 0.3 * Math.sin(time * 5.0);

      // Wander around seabed
      wanderHeading += (Math.random() - 0.5) * delta * 0.5;
      const speed = 1.0;
      rayGroup.position.x += Math.sin(wanderHeading) * speed * delta;
      rayGroup.position.z += Math.cos(wanderHeading) * speed * delta;

      // Constrain within seabed zone
      if (Math.abs(rayGroup.position.x) > 28) rayGroup.position.x *= -0.9;
      if (Math.abs(rayGroup.position.z) > 28) rayGroup.position.z *= -0.9;

      rayGroup.rotation.y = wanderHeading;
    }
  };
}
