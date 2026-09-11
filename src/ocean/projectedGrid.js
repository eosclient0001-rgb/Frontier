// Projected Grid + CDLOD for infinite ocean (Duan 2024 SSLLOD)
// Single draw call, no tiling, adaptive LOD based on screen space
import * as THREE from 'three';

export class ProjectedGrid {
  constructor(camera, resolution=256) {
    this.camera = camera;
    this.resolution = resolution;
    // Create grid in NDC space that will be unprojected to world
    const geom = new THREE.PlaneGeometry(2,2,resolution-1,resolution-1);
    this.geometry = geom;
  }
  // We use a custom shader that does projected grid in vertex shader
  createMesh(material) {
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }
}

// Vertex shader snippet for projected grid (included in waterMaterial)
export const projectedGridVertexCode = `
  // Projected grid: unproject NDC to world ocean plane
  uniform mat4 invViewProj;
  uniform vec3 cameraPos;
  uniform float oceanLevel;
  varying vec3 vWorldPos;
  varying vec2 vScreenUV;

  vec3 intersectOcean(vec3 rayOrigin, vec3 rayDir){
    float t = (oceanLevel - rayOrigin.y) / rayDir.y;
    if(t < 0.0) t = 1000.0;
    return rayOrigin + rayDir * t;
  }

  // For CDLOD, we also compute LOD factor based on distance
  float computeLOD(vec3 worldPos){
    float dist = length(worldPos - cameraPos);
    return clamp(dist / 400.0, 0.0, 1.0);
  }
`;
