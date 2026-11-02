import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sample } from './photometry.mjs';

// A small real-time diffuse test scene. Profile samples are candela, not a baked image.
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1a19');
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
  camera.position.set(7.4, 5.6, 8.6);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.25, 0);
  controls.enableDamping = true;
  controls.minDistance = 3; controls.maxDistance = 25;
  controls.maxPolarAngle = Math.PI / 2 - .04;
  controls.update(); controls.saveState();
  const data = new Uint8Array(512 * 4);
  const profile = new THREE.DataTexture(data, 512, 1, THREE.RGBAFormat);
  profile.magFilter = THREE.LinearFilter; profile.minFilter = THREE.LinearFilter;
  profile.needsUpdate = true;
  const light = new THREE.Vector3(0, 3.9, 0);
  const sphere = new THREE.Vector3(.7, .72, -.45);
  const common = { uProfile: {value: profile}, uPeak: {value: 1}, uLight: {value: light}, uSphere: {value: sphere} };
  const vertex = `varying vec3 positionWorld; varying vec3 normalWorld;
    void main(){vec4 world=modelMatrix*vec4(position,1.);positionWorld=world.xyz;normalWorld=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*world;}`;
  const fragment = `uniform sampler2D uProfile;uniform float uPeak;uniform vec3 uLight;uniform vec3 uSphere;uniform vec3 uColour;uniform float uOcclusion;
    varying vec3 positionWorld;varying vec3 normalWorld;
    void main(){vec3 delta=uLight-positionWorld;float distanceToLight=length(delta);vec3 towardLight=delta/max(distanceToLight,0.001);
    vec3 fromLight=-towardLight;float angle=acos(clamp(dot(fromLight,vec3(0.,-1.,0.)),-1.,1.))/3.14159265;
    float candela=texture2D(uProfile,vec2(angle,0.5)).r*uPeak;
    float lambert=max(dot(normalize(normalWorld),towardLight),0.);
    vec3 rayOrigin=positionWorld+normalWorld*0.005;vec3 oc=rayOrigin-uSphere;float b=dot(oc,towardLight);float c=dot(oc,oc)-0.72*0.72;float disc=b*b-c;float hit=disc>0. ? -b-sqrt(max(0.,disc)) : -1.;
    float visibility=(uOcclusion>0.5 && hit>0.01 && hit<distanceToLight)?0.0:1.0;
    float lux=candela/(distanceToLight*distanceToLight)*lambert*visibility;
    vec3 linear=uColour*(0.045+lux*0.0035)*vec3(1.0,0.91,0.80);linear=linear/(linear+vec3(1.0));gl_FragColor=vec4(pow(linear,vec3(1.0/2.2)),1.);}`;
  function material(colour, occlusion=1){return new THREE.ShaderMaterial({uniforms:{...common,uColour:{value:new THREE.Color(colour)},uOcclusion:{value:occlusion}},vertexShader:vertex,fragmentShader:fragment,side:THREE.DoubleSide});}
  function plane(width,height,x,y,z,rx,ry,colour){const m=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material(colour));m.position.set(x,y,z);m.rotation.set(rx,ry,0);scene.add(m)}
  plane(10,10,0,0,0,-Math.PI/2,0,'#a9a7a2');
  plane(10,5,0,2.5,-5,0,0,'#85807b');
  plane(10,5,-5,2.5,0,0,Math.PI/2,'#928b82');
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.72,48,32),material('#dad3c8',0)); ball.position.copy(sphere);scene.add(ball);
  const block = new THREE.Mesh(new THREE.BoxGeometry(1.25,1.1,1.25),material('#aaa199'));block.position.set(-1.5,.55,-1.35);scene.add(block);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.52,.52,.14,48),material('#6f6963'));plinth.position.set(.7,.07,-.45);scene.add(plinth);
  const fixture = new THREE.Mesh(new THREE.CylinderGeometry(.26,.3,.18,40),new THREE.MeshBasicMaterial({color:'#d5cec5'}));fixture.position.copy(light);scene.add(fixture);
  const aperture = new THREE.Mesh(new THREE.CircleGeometry(.22,32),new THREE.MeshBasicMaterial({color:'#fff0cf',side:THREE.DoubleSide}));aperture.rotation.x=Math.PI/2;aperture.position.set(0,3.8,0);scene.add(aperture);
  let stopped=false;
  function tick(){if(stopped)return;requestAnimationFrame(tick);const w=canvas.clientWidth,h=canvas.clientHeight;if(w&&h){const size=renderer.getSize(new THREE.Vector2());if(size.x!==w||size.y!==h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}controls.update();renderer.render(scene,camera)}}
  tick();
  return {
    update(points){const peak=Math.max(...points.map(p=>p.cd),0);common.uPeak.value=peak;for(let i=0;i<512;i++){let value=peak?Math.round(255*sample(points,i/511*180)/peak):0;data[i*4]=value;data[i*4+1]=value;data[i*4+2]=value;data[i*4+3]=255}profile.needsUpdate=true;},
    reset(){controls.reset()},
    dispose(){stopped=true;controls.dispose();renderer.dispose();profile.dispose()}
  };
}
