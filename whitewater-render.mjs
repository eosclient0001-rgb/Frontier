import * as THREE from 'three';
import {createFoamSurface} from './foam-surface.mjs?v=20260918-startup4';
export class WhitewaterView {
  constructor(capacity,field){
    this.surface=createFoamSurface(field);this.surfaceUniforms=this.surface.uniforms;
    this.group=new THREE.Group();this.group.name='Sparse spray';
    const quad=new THREE.PlaneGeometry(2,2),geometry=new THREE.InstancedBufferGeometry();
    geometry.index=quad.index;geometry.attributes.position=quad.attributes.position;geometry.attributes.uv=quad.attributes.uv;
    this.positions=new Float32Array(capacity*3);this.velocities=new Float32Array(capacity*3);this.data=new Float32Array(capacity*4);
    for(const [key,array,size] of [['iPosition',this.positions,3],['iVelocity',this.velocities,3],['iData',this.data,4]])geometry.setAttribute(key,new THREE.InstancedBufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount=0;this.geometry=geometry;
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      uniforms:{uTint:{value:new THREE.Color('#effcf5')}},
      vertexShader:`attribute vec3 iPosition,iVelocity;attribute vec4 iData;varying vec2 vUv;varying float vAge;
        void main(){vUv=uv;vAge=iData.y;vec4 view=modelViewMatrix*vec4(iPosition,1.);
          vec3 velocity=(viewMatrix*vec4(iVelocity,0.)).xyz;vec2 along=normalize(velocity.xy+vec2(.001)),across=vec2(-along.y,along.x);
          view.xy+=(across*position.x+along*position.y*(1.+min(2.,length(velocity.xy)*.2)))*iData.x;
          gl_Position=projectionMatrix*view;}`,
      fragmentShader:`uniform vec3 uTint;varying vec2 vUv;varying float vAge;void main(){
        vec2 p=vUv*2.-1.;float r=length(p);if(r>1.)discard;
        float fade=smoothstep(0.,.04,vAge)*(1.-smoothstep(.7,1.,vAge));
        float highlight=exp(-dot(p-vec2(-.25,.3),p-vec2(-.25,.3))*15.);
        vec3 color=mix(vec3(.19,.57,.68),uTint,.35+highlight*.65);
        float alpha=(1.-smoothstep(.55,1.,r))*(.5+highlight*.45)*fade;
        if(alpha<.015)discard;gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.frustumCulled=false;this.mesh.renderOrder=5;this.group.add(this.mesh);
    // A short-lived procedural sheet: a visual splash crown, not a liquid mesh solve.
    const segments=48,pos=[],uv=[],indices=[];
    for(let i=0;i<=segments;i++)for(let top=0;top<=1;top++){const a=i/segments*Math.PI*2;pos.push(Math.cos(a),top,Math.sin(a));uv.push(i/segments,top);if(i<segments&&top===0){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}
    const crownGeo=new THREE.InstancedBufferGeometry();crownGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));crownGeo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));crownGeo.setIndex(indices);
    this.crownPosition=new Float32Array(16*3);this.crownData=new Float32Array(16*4);
    crownGeo.setAttribute('iCenter',new THREE.InstancedBufferAttribute(this.crownPosition,3).setUsage(THREE.DynamicDrawUsage));crownGeo.setAttribute('iCrown',new THREE.InstancedBufferAttribute(this.crownData,4).setUsage(THREE.DynamicDrawUsage));crownGeo.instanceCount=0;
    const crownMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:`attribute vec3 iCenter;attribute vec4 iCrown;varying vec2 vUv;varying float vAge;varying vec3 vRadial;void main(){
        vUv=uv;vAge=iCrown.x;vRadial=position;float t=iCrown.x,angle=uv.x*6.283185;
        float crest=(.82+.12*sin(angle*9.+iCrown.z)+.06*sin(angle*17.));
        float rise=sin(t*3.14159265)*iCrown.y;
        float radius=.15+t*.75+position.y*rise*.2;
        vec3 wp=iCenter+vec3(position.x*radius,position.y*rise*crest,position.z*radius);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(wp,1.);
      }`,
      fragmentShader:`varying vec2 vUv;varying float vAge;varying vec3 vRadial;void main(){
        float edge=smoothstep(.84,1.,vUv.y);float streak=pow(.5+.5*sin(vUv.x*6.283185*36.),12.);
        float fade=smoothstep(0.,.07,vAge)*(1.-smoothstep(.5,1.,vAge));
        float alpha=(.18+edge*.55+streak*.12)*fade;
        vec3 c=mix(vec3(.06,.36,.43),vec3(.77,.98,.96),edge*.85+streak*.12);
        gl_FragColor=vec4(c,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
    this.crownGeo=crownGeo;this.crownMesh=new THREE.Mesh(crownGeo,crownMat);this.crownMesh.frustumCulled=false;this.crownMesh.renderOrder=4;this.group.add(this.crownMesh);this.crownsEnabled=true;
  }
  update(core,solver,level,style){
    this.surface.update(core.foam,core.foamEnabled,style);
    const n=core.count;
    for(let i=0;i<n;i++){
      const k=i*3,d=i*4;this.positions[k]=core.x[i];this.positions[k+1]=core.y[i];this.positions[k+2]=core.z[i];
      this.velocities[k]=core.vx[i];this.velocities[k+1]=core.vy[i];this.velocities[k+2]=core.vz[i];
      this.data[d]=core.size[i];this.data[d+1]=Math.min(1,core.age[i]/core.life[i]);this.data[d+2]=0;this.data[d+3]=core.seed[i];
    }
    this.geometry.instanceCount=n;this.mesh.visible=n>0;
    for(const key of ['iPosition','iVelocity','iData'])if(n){const attribute=this.geometry.attributes[key];attribute.clearUpdateRanges();attribute.addUpdateRange(0,n*attribute.itemSize);attribute.needsUpdate=true;}
    this.mesh.material.uniforms.uTint.value.set(style==='dirty'||style==='swamp'?'#ede9ce':'#edffff');
    this.crownMesh.visible=this.crownsEnabled&&core.crowns.length>0;this.crownGeo.instanceCount=core.crowns.length;
    for(let i=0;i<core.crowns.length;i++){const c=core.crowns[i],k=i*3,d=i*4;this.crownPosition[k]=c.x;this.crownPosition[k+1]=level+solver.sample(c.x,c.z)+.01;this.crownPosition[k+2]=c.z;this.crownData[d]=c.age/c.life;this.crownData[d+1]=c.scale;this.crownData[d+2]=c.phase;this.crownData[d+3]=0;}
    if(core.crowns.length){this.crownGeo.attributes.iCenter.needsUpdate=true;this.crownGeo.attributes.iCrown.needsUpdate=true;}
  }
}
