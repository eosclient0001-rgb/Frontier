// Beach Particles: GPU particles for foam spray, sand suspension, wet sand interaction
// Runs on GTX via instanced rendering + texture buffer for positions
// Based on 2023 "Screened Foam Particles" but optimized for beach
import * as THREE from 'three';

export class BeachParticles {
  constructor(renderer, count=65536) {
    this.renderer = renderer;
    this.count = count;
    this.time = 0;

    // GPU particle data: positions, velocities, lifetimes stored in DataTexture for WebGL2 path,
    // but for Three.js we use InstancedMesh + custom shader
    const geometry = new THREE.PlaneGeometry(0.3, 0.3);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        oceanDisp0: { value: null },
        oceanDisp1: { value: null },
        oceanDisp2: { value: null },
        foamTex: { value: null },
        bathymetryTex: { value: null },
        windDir: { value: new THREE.Vector2(Math.cos(0.15*Math.PI), Math.sin(0.15*Math.PI)) },
      },
      vertexShader: `
        attribute vec3 instancePos;
        attribute vec3 instanceVel;
        attribute float instanceLife;
        attribute float instanceSize;
        uniform float time;
        uniform sampler2D oceanDisp0;
        uniform sampler2D bathymetryTex;
        varying float vLife;
        varying float vFoam;
        varying vec2 vUv;
        // hash
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        void main(){
          vUv = uv;
          vLife = instanceLife;
          // sample bathymetry to know beach
          // instancePos is world XZ + Y height offset
          vec2 worldXZ = instancePos.xz;
          // simple wave advection
          vec3 pos = instancePos;
          // gravity + drag
          float t = time - instanceLife;
          // velocity integration (cheap)
          pos += instanceVel * t * 0.5;
          pos.y -= 0.5*9.81*t*t*0.02; // gravity scaled
          pos.y += instanceVel.y * t;
          // fade with life
          float life = 1.0 - clamp(t*0.3,0.0,1.0);
          vLife = life;
          // scale with foam
          float s = instanceSize * (0.5+life*0.5);
          vec3 transformed = position;
          transformed.xy *= s;
          // billboard
          mat4 mv = modelViewMatrix;
          mv[0][0]=1.0; mv[0][1]=0.0; mv[0][2]=0.0;
          mv[1][0]=0.0; mv[1][1]=1.0; mv[1][2]=0.0;
          mv[2][0]=0.0; mv[2][1]=0.0; mv[2][2]=1.0;
          vec4 mvPos = mv * vec4(pos,1.0);
          mvPos.xy += transformed.xy;
          gl_Position = projectionMatrix * mvPos;
          vFoam = 1.0;
        }
      `,
      fragmentShader: `
        varying float vLife;
        varying float vFoam;
        varying vec2 vUv;
        void main(){
          float d = length(vUv-0.5);
          float alpha = 1.0 - smoothstep(0.2,0.5,d);
          alpha *= vLife;
          // foam particle color: white to slightly blue
          vec3 col = vec3(1.0,0.97,0.92) * (0.8+0.2*vFoam);
          // soft
          float soft = exp(-d*3.0);
          gl_FragColor = vec4(col, alpha*soft*0.6);
          if(gl_FragColor.a < 0.01) discard;
        }
      `
    });

    // create instanced attributes
    const instPos = new Float32Array(count*3);
    const instVel = new Float32Array(count*3);
    const instLife = new Float32Array(count);
    const instSize = new Float32Array(count);
    for(let i=0;i<count;i++){
      // distribute along beach line (x from -200 to 200, z near 0)
      const bx = (Math.random()-0.5)*400;
      const bz = (Math.random()-0.5)*80 - 20; // beach band
      instPos[i*3+0]=bx;
      instPos[i*3+1]=Math.random()*0.5;
      instPos[i*3+2]=bz;
      instVel[i*3+0]=(Math.random()-0.5)*2;
      instVel[i*3+1]=Math.random()*3+1;
      instVel[i*3+2]=(Math.random()-0.5)*2;
      instLife[i]=Math.random()*10;
      instSize[i]=0.2+Math.random()*0.8;
    }
    const instGeom = new THREE.InstancedBufferGeometry();
    instGeom.instanceCount = count;
    instGeom.setAttribute('position', geometry.attributes.position);
    instGeom.setAttribute('uv', geometry.attributes.uv);
    instGeom.setIndex(geometry.index);
    instGeom.setAttribute('instancePos', new THREE.InstancedBufferAttribute(instPos,3));
    instGeom.setAttribute('instanceVel', new THREE.InstancedBufferAttribute(instVel,3));
    instGeom.setAttribute('instanceLife', new THREE.InstancedBufferAttribute(instLife,1));
    instGeom.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(instSize,1));

    this.mesh = new THREE.Mesh(instGeom, material);
    this.mesh.frustumCulled = false;

    // bathymetry texture for beach detection (simple gradient)
    const bathySize = 512;
    const bathyData = new Float32Array(bathySize*bathySize*4);
    for(let y=0;y<bathySize;y++) for(let x=0;x<bathySize;x++){
      const i=(y*bathySize+x)*4;
      // beach slope: depth 0 at z=0, increases to 50m at z=-200
      const worldZ = (y/bathySize*400 -200);
      let depth = 0;
      if(worldZ < 0) depth = -worldZ * 0.25; // slope
      else depth = 0.1; // sand
      bathyData[i]=depth;
      bathyData[i+1]=worldZ<0?1:0; // water mask
      bathyData[i+2]=0;
      bathyData[i+3]=1;
    }
    const bathyTex = new THREE.DataTexture(bathyData,bathySize,bathySize,THREE.RGBAFormat,THREE.FloatType);
    bathyTex.needsUpdate=true;
    bathyTex.minFilter=THREE.LinearFilter;
    bathyTex.magFilter=THREE.LinearFilter;
    material.uniforms.bathymetryTex.value=bathyTex;
    this.bathyTex=bathyTex;
  }
  update(time, oceanTextures, foamTex) {
    this.time=time;
    this.mesh.material.uniforms.time.value=time;
    if(oceanTextures && oceanTextures[0]) {
      this.mesh.material.uniforms.oceanDisp0.value=oceanTextures[0].disp;
    }
    if(foamTex) this.mesh.material.uniforms.foamTex.value=foamTex;
    // respawn logic on CPU for simplicity (GTX can handle)
    const posAttr = this.mesh.geometry.getAttribute('instancePos');
    const lifeAttr = this.mesh.geometry.getAttribute('instanceLife');
    // spawn new particles near breaking waves
    for(let i=0;i<200;i++){
      const idx = Math.floor(Math.random()*this.count);
      if(Math.random()>0.7){
        posAttr.array[idx*3+0]=(Math.random()-0.5)*300;
        posAttr.array[idx*3+1]=Math.random()*0.2;
        posAttr.array[idx*3+2]=(Math.random()-0.5)*60 -10;
        lifeAttr.array[idx]=time + Math.random()*0.5;
      }
    }
    posAttr.needsUpdate=true;
    lifeAttr.needsUpdate=true;
  }
}
