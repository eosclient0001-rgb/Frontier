import * as THREE from 'three';

/**
 * High-Realism Underwater Environment
 * - Rolling sand seabed with caustic light patterns
 * - Volumetric god rays / sunlight shafts
 * - Floating marine snow / plankton particulates
 * - Realistic ocean surface with refractive ripples
 * - Kelp clusters and rock outcrops
 */

export function createUnderwaterEnvironment(scene) {
  // Ocean Fog (Deep pelagic turquoise/indigo extinction)
  scene.fog = new THREE.FogExp2(0x041926, 0.025);

  // Underwater Lighting
  const ambientLight = new THREE.AmbientLight(0x082e3f, 1.4);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0x9bf5ff, 2.8);
  sunLight.position.set(15, 35, 10);
  sunLight.castShadow = false;
  scene.add(sunLight);

  // Secondary bounce light from seabed sand
  const bounceLight = new THREE.DirectionalLight(0x1a4552, 0.8);
  bounceLight.position.set(0, -20, 0);
  scene.add(bounceLight);

  // 1. Seabed Sand Dunes
  const seabed = createSeabed();
  scene.add(seabed);

  // 2. God Rays / Sunlight Shafts
  const godRays = createGodRays();
  scene.add(godRays);

  // 3. Floating Marine Snow / Plankton Particles
  const marineSnow = createMarineSnow();
  scene.add(marineSnow.points);

  // 4. Water Surface
  const waterSurface = createWaterSurface();
  scene.add(waterSurface);

  // 5. Kelp & Rock Outcrops
  const floraGroup = createKelpAndRocks();
  scene.add(floraGroup);

  return {
    ambientLight,
    sunLight,
    seabed,
    godRays,
    marineSnow,
    waterSurface,
    update: (delta, time) => {
      // Animate marine snow floating in water current
      marineSnow.update(delta);
      // Animate god rays subtle shimmer
      godRays.rotation.y = time * 0.02;
      // Animate water surface ripples
      waterSurface.material.uniforms.uTime.value = time;
      // Animate seabed caustics
      if (seabed.material.uniforms) {
        seabed.material.uniforms.uTime.value = time;
      }
    }
  };
}

/**
 * Seabed with Procedural Sand Dunes & Animated Caustics Shader
 */
function createSeabed() {
  const size = 120;
  const segments = 90;
  const geom = new THREE.PlaneGeometry(size, size, segments, segments);
  geom.rotateX(-Math.PI * 0.5);

  const pos = geom.attributes.position;
  // Sculpt gentle rolling sand ripples and dunes
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    const dune1 = Math.sin(x * 0.08 + z * 0.05) * 1.8;
    const dune2 = Math.cos(x * 0.04 - z * 0.07) * 1.2;
    const ripple = Math.sin(x * 0.8 + z * 0.3) * 0.12;

    pos.setY(i, -14.0 + dune1 + dune2 + ripple);
  }
  geom.computeVertexNormals();

  // Custom Caustic Seabed Shader
  const seabedMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: new THREE.Color(0x153846) },
      uSandColor: { value: new THREE.Color(0x27596b) },
      uCausticColor: { value: new THREE.Color(0x7afcff) }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;

      void main() {
        vUv = uv;
        vec4 worldP = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldP.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldP;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uSandColor;
      uniform vec3 uCausticColor;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;

      // Caustic Voronoi pattern approximation
      float causticPattern(vec2 uv, float t) {
        vec2 p = uv * 3.5;
        vec2 p1 = p + vec2(sin(t * 0.7 + p.y * 0.5), cos(t * 0.6 + p.x * 0.5)) * 0.4;
        vec2 p2 = p * 1.4 - vec2(cos(t * 0.5 + p.y * 0.7), sin(t * 0.8 + p.x * 0.6)) * 0.35;
        
        float c1 = sin(p1.x * 4.0 + p1.y * 3.0);
        float c2 = cos(p2.x * 3.5 - p2.y * 4.2);
        float c = (c1 + c2) * 0.5;
        return pow(max(0.0, c * 0.5 + 0.5), 3.0) * 2.2;
      }

      void main() {
        float caustic = causticPattern(vWorldPos.xz * 0.08, uTime);
        
        // Depth gradient
        float depthFactor = clamp((-vWorldPos.y - 8.0) / 8.0, 0.0, 1.0);
        vec3 col = mix(uSandColor, uBaseColor, depthFactor * 0.6);
        
        // Add caustics highlight
        col += uCausticColor * caustic * 0.45;

        // Subtle distance falloff
        float dist = length(vWorldPos.xz);
        float fogFactor = clamp((dist - 15.0) / 45.0, 0.0, 1.0);
        vec3 fogCol = vec3(0.015, 0.098, 0.149);
        col = mix(col, fogCol, fogFactor);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geom, seabedMaterial);
  return mesh;
}

/**
 * Volumetric God Rays (Crepuscular light shafts streaming from water surface)
 */
function createGodRays() {
  const group = new THREE.Group();
  const rayGeom = new THREE.CylinderGeometry(0.8, 12.0, 32.0, 16, 1, true);

  const rayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x6ee9ff) }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        // Fade at top and bottom
        float fade = sin(vUv.y * 3.14159);
        float alpha = fade * 0.075;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const positions = [
    { x: -8, z: -5, rotZ: 0.12, scale: 1.1 },
    { x: 10, z: 8, rotZ: -0.15, scale: 1.3 },
    { x: -14, z: 12, rotZ: 0.08, scale: 0.9 },
    { x: 6, z: -16, rotZ: -0.10, scale: 1.2 }
  ];

  for (const p of positions) {
    const ray = new THREE.Mesh(rayGeom, rayMaterial);
    ray.position.set(p.x, 2, p.z);
    ray.rotation.z = p.rotZ;
    ray.scale.set(p.scale, 1, p.scale);
    group.add(ray);
  }

  return group;
}

/**
 * Marine Snow / Floating Organic Micro-Particulates
 */
function createMarineSnow() {
  const count = 1800;
  const geom = new THREE.BufferGeometry();
  const posArray = new Float32Array(count * 3);
  const velArray = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    posArray[i * 3 + 0] = (Math.random() - 0.5) * 80;
    posArray[i * 3 + 1] = -14 + Math.random() * 15;
    posArray[i * 3 + 2] = (Math.random() - 0.5) * 80;

    velArray[i * 3 + 0] = (Math.random() - 0.5) * 0.15;
    velArray[i * 3 + 1] = -0.05 - Math.random() * 0.08;
    velArray[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
  }

  geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

  const mat = new THREE.PointsMaterial({
    color: 0x9be8ff,
    size: 0.12,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const points = new THREE.Points(geom, mat);

  return {
    points,
    update: (delta) => {
      const p = geom.attributes.position.array;
      for (let i = 0; i < count; i++) {
        p[i * 3 + 0] += velArray[i * 3 + 0] * delta;
        p[i * 3 + 1] += velArray[i * 3 + 1] * delta;
        p[i * 3 + 2] += velArray[i * 3 + 2] * delta;

        // Loop back up if fallen to floor
        if (p[i * 3 + 1] < -14) {
          p[i * 3 + 1] = 0.5;
        }
      }
      geom.attributes.position.needsUpdate = true;
    }
  };
}

/**
 * Water Surface Plane with Caustic Fresnel Ripples
 */
function createWaterSurface() {
  const geom = new THREE.PlaneGeometry(120, 120, 60, 60);
  geom.rotateX(Math.PI * 0.5);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }
    },
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(p.x * 0.4 + uTime * 1.5) * 0.15 + cos(p.z * 0.3 + uTime * 1.2) * 0.12;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      void main() {
        // Fresnel reflection from below water looking up
        float ripple = sin(vWorldPos.x * 0.8 + uTime * 2.0) * cos(vWorldPos.z * 0.8 + uTime * 1.8);
        vec3 skyColor = vec3(0.55, 0.90, 1.0);
        vec3 deepColor = vec3(0.02, 0.12, 0.18);
        vec3 col = mix(skyColor, deepColor, 0.35 + ripple * 0.15);

        gl_FragColor = vec4(col, 0.65);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = 0.8;
  return mesh;
}

/**
 * Ocean Outcrops: Kelp Clusters and Seabed Rocks
 */
function createKelpAndRocks() {
  const group = new THREE.Group();

  // Rock outcrops
  const rockGeom = new THREE.DodecahedronGeometry(1.5, 1);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x1c323d,
    roughness: 0.9,
    metalness: 0.1
  });

  const rockPositions = [
    { x: -18, z: -12, y: -13.5, s: 2.2 },
    { x: 22, z: 14, y: -13.8, s: 3.1 },
    { x: 12, z: -24, y: -13.6, s: 2.6 },
    { x: -25, z: 20, y: -13.2, s: 3.4 }
  ];

  for (const r of rockPositions) {
    const rock = new THREE.Mesh(rockGeom, rockMat);
    rock.position.set(r.x, r.y, r.z);
    rock.scale.set(r.s, r.s * 0.7, r.s);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    group.add(rock);
  }

  return group;
}
