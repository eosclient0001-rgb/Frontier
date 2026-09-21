import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SurfaceReconstruction } from './reconstruction';
import { FluidSolver, materials, type MaterialKey } from './physics';

const quadVert = `varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}`;
const particleVert = `
attribute vec3 axisA; attribute vec3 axisB; attribute vec3 axisC; attribute float volumeWeight;
uniform float scale;
varying vec3 center; varying vec3 rowA; varying vec3 rowB; varying vec3 rowC; varying float weight;
void main(){
  vec4 p=modelViewMatrix*vec4(position,1.); center=p.xyz;
  vec3 a=mat3(modelViewMatrix)*axisA, b=mat3(modelViewMatrix)*axisB, c=mat3(modelViewMatrix)*axisC;
  rowA=a/dot(a,a); rowB=b/dot(b,b); rowC=c/dot(c,c); weight=volumeWeight;
  float bound=max(length(a),max(length(b),length(c)));
  gl_Position=projectionMatrix*p;
  gl_PointSize=bound*scale*1.2/max(.1,-p.z-bound);
}`;
const ellipsoidIntersection = `
uniform mat4 proj; uniform vec2 resolution;
varying vec3 center; varying vec3 rowA; varying vec3 rowB; varying vec3 rowC; varying float weight;
vec2 intersectEllipsoid(out vec3 ray){
  vec2 xy=gl_FragCoord.xy/resolution*2.-1.;
  ray=vec3(xy.x/proj[0][0],xy.y/proj[1][1],-1.);
  vec3 origin=vec3(dot(rowA,-center),dot(rowB,-center),dot(rowC,-center));
  vec3 direction=vec3(dot(rowA,ray),dot(rowB,ray),dot(rowC,ray));
  float a=dot(direction,direction), b=dot(origin,direction), c=dot(origin,origin)-1.;
  float disc=b*b-a*c;
  if(disc<=0.) discard;
  float root=sqrt(disc);return vec2((-b-root)/a,(-b+root)/a);
}`;
const particleFrag = ellipsoidIntersection + `
void main(){vec3 ray;vec2 hit=intersectEllipsoid(ray);if(hit.x<=0.)discard;
vec4 clip=proj*vec4(ray*hit.x,1.);gl_FragDepth=clip.z/clip.w*.5+.5;
gl_FragColor=vec4(hit.x,0.,0.,1.);}`;
const thicknessFrag = ellipsoidIntersection + `
uniform sampler2D sceneDepth; uniform float nearPlane; uniform float farPlane;
void main(){vec3 ray;vec2 hit=intersectEllipsoid(ray);
float raw=texture2D(sceneDepth,gl_FragCoord.xy/resolution).r;
float sceneD=(2.*nearPlane*farPlane)/(farPlane+nearPlane-(raw*2.-1.)*(farPlane-nearPlane));
float path=max(0.,min(hit.y,sceneD)-max(hit.x,0.))*length(ray);
if(path==0.)discard;
gl_FragColor=vec4(path*weight,0.,0.,1.);}`;
const blurFrag = `varying vec2 vUv; uniform sampler2D inputTex; uniform vec2 direction;
void main(){float d=texture2D(inputTex,vUv).r; if(d==0.){gl_FragColor=vec4(0.);return;}
float total=0.;float weight=0.; for(int i=-7;i<=7;i++){float x=float(i); float s=texture2D(inputTex,vUv+direction*x).r;
if(s>0.){float w=exp(-x*x/24.-pow((s-d)*7.,2.));total+=s*w;weight+=w;}}
gl_FragColor=vec4(total/max(weight,.0001),0.,0.,1.);}`;
const surfaceFrag = `varying vec2 vUv;
uniform sampler2D sceneTex; uniform sampler2D sceneDepth; uniform sampler2D fluidDepth; uniform sampler2D thicknessTex; uniform sampler2D environment;
uniform mat4 invProjection; uniform mat4 projection; uniform mat4 cameraWorld; uniform vec2 texel;
uniform vec3 liquidColor; uniform vec3 absorption; uniform float opacity; uniform float roughness; uniform float ior;
uniform float nearPlane; uniform float farPlane; uniform int debugMode;
vec3 positionAt(vec2 uv,float d){vec4 p=invProjection*vec4(uv*2.-1.,1.,1.);return p.xyz*(-d/p.z);}
vec3 env(vec3 r){vec2 uv=vec2(atan(r.z,r.x)/6.2831853+.5,asin(clamp(r.y,-1.,1.))/3.14159265+.5);return texture2D(environment,uv).rgb;}
vec3 outputColor(vec3 c){c=1.-exp(-c*1.12);return pow(max(c,vec3(0.)),vec3(1./2.2));}
void main(){vec3 base=texture2D(sceneTex,vUv).rgb;float d=texture2D(fluidDepth,vUv).r;
float raw=texture2D(sceneDepth,vUv).r;float sceneD=(2.*nearPlane*farPlane)/(farPlane+nearPlane-(raw*2.-1.)*(farPlane-nearPlane));
if(d<=0.||d>sceneD+.015){gl_FragColor=vec4(outputColor(base),1.);return;}
vec3 p=positionAt(vUv,d);
float l=texture2D(fluidDepth,vUv-vec2(texel.x,0.)).r;float r=texture2D(fluidDepth,vUv+vec2(texel.x,0.)).r;
float b=texture2D(fluidDepth,vUv-vec2(0.,texel.y)).r;float t=texture2D(fluidDepth,vUv+vec2(0.,texel.y)).r;
vec3 dx=(l==0.||abs(r-d)<abs(d-l))?positionAt(vUv+vec2(texel.x,0.),r)-p:p-positionAt(vUv-vec2(texel.x,0.),l);
vec3 dy=(b==0.||abs(t-d)<abs(d-b))?positionAt(vUv+vec2(0.,texel.y),t)-p:p-positionAt(vUv-vec2(0.,texel.y),b);
vec3 n=normalize(cross(dx,dy)); if(n.z<0.) n=-n;
vec3 wn=normalize(mat3(cameraWorld)*n);vec3 eye=normalize(-p);
float thick=clamp(texture2D(thicknessTex,vUv).r,.02,2.);
if(debugMode==2){gl_FragColor=vec4(wn*.5+.5,1.);return;}
if(debugMode==3){gl_FragColor=vec4(vec3(thick*.6),1.);return;}
vec3 transmitted=refract(-eye,n,1./ior);
vec4 exitClip=projection*vec4(p+transmitted*thick,1.);
vec2 refrUv=clamp(exitClip.xy/exitClip.w*.5+.5,vec2(.001),vec2(.999));
float behindRaw=texture2D(sceneDepth,refrUv).r;
float behindDepth=(2.*nearPlane*farPlane)/(farPlane+nearPlane-(behindRaw*2.-1.)*(farPlane-nearPlane));
if(behindDepth<d)refrUv=vUv;
vec3 behind=texture2D(sceneTex,refrUv).rgb;
vec3 trans=exp(-absorption*thick*1.7);
vec3 refr=behind*trans+liquidColor*(1.-trans)*.38;
float diffuse=.4+.6*max(dot(wn,normalize(vec3(-.5,1.,.6))),0.);
float scatter=1.-exp(-opacity*thick*8.);
refr=mix(refr,liquidColor*diffuse,scatter);
float f0=pow((ior-1.)/(ior+1.),2.);float fresnel=f0+(1.-f0)*pow(1.-max(dot(n,eye),0.),5.);
vec3 reflected=mat3(cameraWorld)*reflect(-eye,n);
vec3 tangent=normalize(cross(reflected,abs(reflected.y)>.95?vec3(1.,0.,0.):vec3(0.,1.,0.)));
vec3 bitangent=cross(reflected,tangent);float spread=roughness*roughness*.8;
vec3 reflection=(env(reflected)*2.+env(normalize(reflected+tangent*spread))+env(normalize(reflected-tangent*spread))+env(normalize(reflected+bitangent*spread))+env(normalize(reflected-bitangent*spread)))/6.;
vec3 color=mix(refr,reflection*1.5,min(.94,fresnel+roughness*.08));
vec3 light=normalize(mat3(cameraWorld)*eye+vec3(-.5,1.5,.7));
float spec=pow(max(dot(wn,light),0.),mix(240.,35.,roughness));
color+=vec3(.8,.95,1.)*spec*.48;
gl_FragColor=vec4(outputColor(color),1.);}`;

export class FluidRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, .1, 50);
  readonly controls: OrbitControls;
  private depthScene = new THREE.Scene();
  private thicknessScene = new THREE.Scene();
  private points: THREE.Points;
  readonly reconstruction: SurfaceReconstruction;
  anisotropic = true;
  reconstructionMs = 0;
  private reconstructedRevision = -1;
  private reconstructedMode = true;
  private thicknessPoints: THREE.Points;
  private sceneRT: THREE.WebGLRenderTarget;
  private depthRT: THREE.WebGLRenderTarget;
  private blurA: THREE.WebGLRenderTarget;
  private blurB: THREE.WebGLRenderTarget;
  private thickRT: THREE.WebGLRenderTarget;
  private compositeRT: THREE.WebGLRenderTarget;
  private fxaaMaterial: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private blurMaterial: THREE.ShaderMaterial;
  private surfaceMaterial: THREE.ShaderMaterial;
  private depthMaterial: THREE.ShaderMaterial;
  private thicknessMaterial: THREE.ShaderMaterial;
  private debugParticles: THREE.Points;
  private grid: THREE.GridHelper;
  private emitter: THREE.Group;
  private obstacleMesh: THREE.Mesh;
  private boundaryPoints: THREE.Points;
  private boundaryRevision = -1;
  showBoundaries = false;
  private environment: THREE.DataTexture;
  private w = 1; private h = 1;
  private quality = .85;
  debug = 0;
  solver: FluidSolver;
  constructor(container: HTMLElement, solver: FluidSolver) {
    this.solver = solver;
    this.reconstruction = new SurfaceReconstruction(solver.maxParticles);
    this.reconstruction.update(solver.positions, solver.count);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) throw new Error('This renderer needs WebGL2 with floating-point render targets. Try a recent Chrome, Edge, or Firefox browser with hardware acceleration.');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x111715);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);
    this.camera.position.set(5.6, 4.25, 6.3);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, .65, 0);
    this.controls.enableDamping = true; this.controls.dampingFactor = .075;
    this.controls.minDistance = 5; this.controls.maxDistance = 15;
    this.controls.maxPolarAngle = Math.PI * .475; this.controls.minPolarAngle = .18;
    this.controls.enablePan = false;
    this.controls.update();
    this.environment = this.createEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromEquirectangular(this.environment);
    this.scene.environment = envRT.texture; pmrem.dispose();
    this.scene.background = new THREE.Color('#151c19');
    this.scene.fog = new THREE.FogExp2('#101713', .065);
    this.scene.add(new THREE.HemisphereLight(0xd6e6de, 0x303b32, 2.1));
    const key = new THREE.DirectionalLight(0xf1fff7, 3); key.position.set(-3, 6, 3); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x83c1ac, 1.5); fill.position.set(4, 2, -4); this.scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#090e0c', roughness: .95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.28; this.scene.add(floor);
    this.grid = new THREE.GridHelper(40, 80, 0x46594c, 0x2b3b32); this.grid.position.y = -.272;
    (this.grid.material as THREE.Material).transparent = true; (this.grid.material as THREE.Material).opacity = .34; this.scene.add(this.grid);
    this.buildTank();
    this.obstacleMesh = new THREE.Mesh(new THREE.SphereGeometry(solver.obstacle.radius, 40, 28), new THREE.MeshStandardMaterial({ color: '#c5c3b4', roughness: .2, metalness: .65 }));
    this.obstacleMesh.position.set(solver.obstacle.x, solver.obstacle.y, solver.obstacle.z);
    this.obstacleMesh.visible = solver.obstacle.enabled; this.scene.add(this.obstacleMesh);
    const boundaryGeometry = new THREE.BufferGeometry();
    boundaryGeometry.setAttribute('position', new THREE.BufferAttribute(solver.boundaries.positions, 3).setUsage(THREE.DynamicDrawUsage));
    boundaryGeometry.setDrawRange(0, solver.boundaries.count);
    this.boundaryPoints = new THREE.Points(boundaryGeometry, new THREE.PointsMaterial({ color: '#f3d282', size: .026 }));
    this.boundaryPoints.frustumCulled = false; this.boundaryPoints.visible = false; this.scene.add(this.boundaryPoints);
    this.emitter = this.buildEmitter(); this.scene.add(this.emitter);
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { ...opts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.depthRT = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.FloatType });
    this.blurA = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.FloatType });
    this.blurB = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.FloatType });
    this.compositeRT = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.fxaaMaterial = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false });
    this.fxaaMaterial.uniforms.tDiffuse.value = this.compositeRT.texture;
    this.thickRT = new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.reconstruction.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('axisA', new THREE.BufferAttribute(this.reconstruction.axisA, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('axisB', new THREE.BufferAttribute(this.reconstruction.axisB, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('axisC', new THREE.BufferAttribute(this.reconstruction.axisC, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('volumeWeight', new THREE.BufferAttribute(this.reconstruction.volumeWeight, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, solver.count);
    const particleUniforms = {
      scale: { value: 1 }, proj: { value: this.camera.projectionMatrix }, resolution: { value: new THREE.Vector2() },
    };
    this.depthMaterial = new THREE.ShaderMaterial({ vertexShader: particleVert, fragmentShader: particleFrag, uniforms: particleUniforms });
    this.points = new THREE.Points(geometry, this.depthMaterial); this.points.frustumCulled = false; this.depthScene.add(this.points);
    this.thicknessMaterial = new THREE.ShaderMaterial({ vertexShader: particleVert, fragmentShader: thicknessFrag,
      uniforms: { ...particleUniforms, sceneDepth: { value: this.sceneRT.depthTexture }, nearPlane: { value: this.camera.near }, farPlane: { value: this.camera.far } },
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending });
    this.thicknessPoints = new THREE.Points(geometry, this.thicknessMaterial); this.thicknessPoints.frustumCulled = false; this.thicknessScene.add(this.thicknessPoints);
    // Debug view deliberately shows the simulation positions, never smoothed render centers.
    const debugGeometry = new THREE.BufferGeometry();
    debugGeometry.setAttribute('position', new THREE.BufferAttribute(solver.positions, 3).setUsage(THREE.DynamicDrawUsage));
    debugGeometry.setDrawRange(0, solver.count);
    this.debugParticles = new THREE.Points(debugGeometry, new THREE.PointsMaterial({ color: '#aaffdd', size: .065, sizeAttenuation: true }));
    this.debugParticles.frustumCulled = false; this.debugParticles.visible = false; this.scene.add(this.debugParticles);
    this.blurMaterial = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: blurFrag,
      uniforms: { inputTex: { value: null }, direction: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    this.surfaceMaterial = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: surfaceFrag, depthTest: false, depthWrite: false,
      uniforms: { sceneTex: { value: this.sceneRT.texture }, sceneDepth: { value: this.sceneRT.depthTexture }, fluidDepth: { value: null }, thicknessTex: { value: this.thickRT.texture }, environment: { value: this.environment },
        projection: { value: this.camera.projectionMatrix }, invProjection: { value: this.camera.projectionMatrixInverse }, cameraWorld: { value: this.camera.matrixWorld }, texel: { value: new THREE.Vector2(1, 1) },
        liquidColor: { value: new THREE.Color() }, absorption: { value: new THREE.Vector3() }, opacity: { value: .2 }, roughness: { value: .1 }, ior: { value: 1.333 },
        nearPlane: { value: this.camera.near }, farPlane: { value: this.camera.far }, debugMode: { value: 0 } } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial); this.quadScene.add(this.quad);
    this.setMaterial('water');
    new ResizeObserver(() => this.resize(container.clientWidth, container.clientHeight)).observe(container);
    this.resize(container.clientWidth, container.clientHeight);
  }
  private createEnvironment() {
    const w = 512, h = 256, data = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const k = (y * w + x) * 4;
      const softbox = (cx: number, cy: number, wx: number, wy: number) => Math.exp(-(Math.pow((u - cx) / wx, 8) + Math.pow((v - cy) / wy, 8)));
      const bright = softbox(.27, .7, .12, .045) * 4.8 + softbox(.72, .65, .045, .12) * 3.2 + softbox(.95, .85, .3, .06) * 2.4;
      data[k] = .11 + v * .21 + bright * .85; data[k + 1] = .16 + v * .24 + bright; data[k + 2] = .14 + v * .22 + bright * .94; data[k + 3] = 1;
    }
    const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    texture.mapping = THREE.EquirectangularReflectionMapping; texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true; return texture;
  }
  private buildTank() {
    const body = new THREE.MeshStandardMaterial({ color: '#33463e', metalness: .8, roughness: .24 });
    const inner = new THREE.MeshStandardMaterial({ color: '#607b6e', metalness: .45, roughness: .32 });
    const base = new THREE.Mesh(new RoundedBoxGeometry(4.42, .25, 3.05, 4, .1), body); base.position.y = -.04; this.scene.add(base);
    const bed = new THREE.Mesh(new RoundedBoxGeometry(4.1, .10, 2.71, 4, .04), inner); bed.position.y = .08; this.scene.add(bed);
    // Low, rounded metal lip, with taller transparent containment walls.
    for (const z of [-1.4, 1.4]) {
      const rim = new THREE.Mesh(new RoundedBoxGeometry(4.4, .12, .12, 3, .04), body); rim.position.set(0, .2, z); this.scene.add(rim);
    }
    for (const x of [-2.14, 2.14]) {
      const rim = new THREE.Mesh(new RoundedBoxGeometry(.12, .12, 2.8, 3, .04), body); rim.position.set(x, .2, 0); this.scene.add(rim);
    }
    const glass = new THREE.MeshPhysicalMaterial({ color: '#bbdfce', metalness: .15, roughness: .12, transparent: true, opacity: .075, depthWrite: false, side: THREE.DoubleSide });
    for (const z of [-1.35, 1.35]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.25, .025), glass); wall.position.set(0, .755, z); this.scene.add(wall);
    }
    for (const x of [-2.06, 2.06]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(.025, 1.25, 2.7), glass); wall.position.set(x, .755, 0); this.scene.add(wall);
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4.15, 1.25, 2.7)), new THREE.LineBasicMaterial({ color: '#a1cbb7', transparent: true, opacity: .2 }));
    edges.position.y = .755; this.scene.add(edges);
    // Calibration marks on the back edge.
    for (let i = -9; i <= 9; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(.012, .003, i % 3 === 0 ? .09 : .045), new THREE.MeshBasicMaterial({ color: '#9ab6a5' }));
      tick.position.set(i * .21, .269, -1.4); this.scene.add(tick);
    }
    const accent = new THREE.Mesh(new THREE.BoxGeometry(.55, .025, .005), new THREE.MeshBasicMaterial({ color: '#baf7aa' }));
    accent.position.set(1.4, -.005, 1.529); this.scene.add(accent);
    // Soft contact shadow; no external assets.
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!; const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');ctx.fillStyle = g;ctx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7, 5.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.265; this.scene.add(shadow);
  }
  private buildEmitter() {
    const group = new THREE.Group(); group.position.set(-.65, 2.79, -.15);
    const metal = new THREE.MeshStandardMaterial({ color: '#5d7466', metalness: .9, roughness: .23 });
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.19, .15, .3, 32, 1, true), metal); group.add(nozzle);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(.15, .021, 10, 40), metal); lip.rotation.x = Math.PI / 2; lip.position.y = -.15; group.add(lip);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.19, .012, 8, 40), new THREE.MeshBasicMaterial({ color: '#b8f99f' })); ring.rotation.x = Math.PI / 2; ring.position.y = .035; group.add(ring);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(.215, .215, .035, 32), metal); top.position.y = .16; group.add(top);
    return group;
  }
  resize(w: number, h: number) {
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.zoom = Math.min(1, this.camera.aspect / 1.2);
    this.camera.updateProjectionMatrix();
    const ratio = Math.min(window.devicePixelRatio, 1.5);
    this.w = Math.round(w * ratio * this.quality); this.h = Math.round(h * ratio * this.quality);
    for (const rt of [this.sceneRT, this.depthRT, this.blurA, this.blurB, this.thickRT, this.compositeRT]) rt.setSize(this.w, this.h);
    this.fxaaMaterial.uniforms.resolution.value.set(1 / this.w, 1 / this.h);
    const scale = this.h * this.camera.projectionMatrix.elements[5];
    this.depthMaterial.uniforms.resolution.value.set(this.w, this.h);
    this.depthMaterial.uniforms.scale.value = scale; this.thicknessMaterial.uniforms.scale.value = scale;
    this.surfaceMaterial.uniforms.texel.value.set(1 / this.w, 1 / this.h);
  }
  setMaterial(key: MaterialKey) {
    const m = materials[key], u = this.surfaceMaterial.uniforms;
    u.liquidColor.value.set(m.color); u.absorption.value.set(...m.absorption); u.opacity.value = m.opacity; u.roughness.value = m.roughness; u.ior.value = m.ior;
    (this.debugParticles.material as THREE.PointsMaterial).color.set(m.color);
  }
  setQuality(quality: number) { this.quality = quality; const s = this.renderer.getSize(new THREE.Vector2()); this.resize(s.x, s.y); }
  setGrid(visible: boolean) { this.grid.visible = visible; }
  setEmitter(visible: boolean) { this.emitter.visible = visible; }
  resetCamera() { this.camera.position.set(5.6, 4.25, 6.3); this.controls.target.set(0, .65, 0); this.controls.update(); }
  render() {
    this.controls.update();
    this.obstacleMesh.visible = this.solver.obstacle.enabled;
    this.boundaryPoints.visible = this.showBoundaries;
    if (this.boundaryRevision !== this.solver.boundaries.revision) {
      this.boundaryPoints.geometry.attributes.position.needsUpdate = true;
      this.boundaryPoints.geometry.setDrawRange(0, this.solver.boundaries.count);
      this.boundaryRevision = this.solver.boundaries.revision;
    }
    this.reconstructionMs = 0;
    if (this.reconstructedRevision !== this.solver.revision || this.reconstructedMode !== this.anisotropic) {
      const start = performance.now();
      this.reconstruction.update(this.solver.positions, this.solver.count, this.anisotropic);
      this.reconstructionMs = performance.now() - start;
      this.reconstructedRevision = this.solver.revision; this.reconstructedMode = this.anisotropic;
      for (const attribute of Object.values(this.points.geometry.attributes)) attribute.needsUpdate = true;
    }
    this.points.geometry.setDrawRange(0, this.solver.count);
    this.debugParticles.geometry.attributes.position.needsUpdate = true;
    this.debugParticles.geometry.setDrawRange(0, this.solver.count);
    this.debugParticles.visible = this.debug === 1;
    this.renderer.setRenderTarget(this.sceneRT); this.renderer.render(this.scene, this.camera);
    const old = this.renderer.getClearColor(new THREE.Color()); this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.depthRT); this.renderer.clear();
    if (this.debug !== 1) this.renderer.render(this.depthScene, this.camera);
    this.renderer.setRenderTarget(this.thickRT); this.renderer.clear();
    if (this.debug !== 1) this.renderer.render(this.thicknessScene, this.camera);
    this.quad.material = this.blurMaterial;
    let input = this.depthRT.texture;
    for (let i = 0; i < 6; i++) {
      const target = i % 2 === 0 ? this.blurA : this.blurB;
      this.blurMaterial.uniforms.inputTex.value = input;
      this.blurMaterial.uniforms.direction.value.set(i % 2 === 0 ? 1.45 / this.w : 0, i % 2 === 1 ? 1.45 / this.h : 0);
      this.renderer.setRenderTarget(target); this.renderer.render(this.quadScene, this.quadCamera); input = target.texture;
    }
    this.surfaceMaterial.uniforms.fluidDepth.value = input;
    this.surfaceMaterial.uniforms.debugMode.value = this.debug;
    this.quad.material = this.surfaceMaterial;
    this.renderer.setRenderTarget(this.compositeRT); this.renderer.render(this.quadScene, this.quadCamera);
    this.quad.material = this.fxaaMaterial;
    this.renderer.setRenderTarget(null); this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.setClearColor(old, 1);
  }
  screenshot() {
    this.render(); const a = document.createElement('a'); a.download = `flux-${this.solver.material}-${Date.now()}.png`; a.href = this.renderer.domElement.toDataURL('image/png'); a.click();
  }
}
