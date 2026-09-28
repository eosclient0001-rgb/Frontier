import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PRESETS = [
  { id:'hoodoo_bryce', name:'Hoodoo — Bryce', badge:'FROST + TAFONI', desc:'Claron limestone cap over mudstone; frost-wedged orthogonal joints, basal sapping alcoves, dense honeycomb tafoni. ~18 m.' },
  { id:'spire_monument', name:'Spire — Monument Valley', badge:'WIND + JOINTS', desc:'45 m Wingate sandstone; cross-bed laminae, 3 joint sets, yardang fluting, flow-guided rills.' },
  { id:'mesa_vermeillion', name:'Mesa — Vermillion', badge:'BENCH + SCARP', desc:'Broad caprock; 5 cliff-and-bench stairsteps, sapping overhangs, headward-indented planform.' },
  { id:'butte_monument', name:'Butte — Isolated', badge:'ERODED MESA', desc:'Mesa eroded till width<height; cap overhang, talus apron, isolated pedestal.' },
  { id:'columnar_giants', name:'Columnar Basalt', badge:'VORONOI HEX', desc:'Centroidal Voronoi colonnade CV≈0.36 + hackly entablature, transverse striae, ponded flow.' },
  { id:'cliff_tafoni', name:'Cliff — Entrada Tafoni', badge:'HONEYCOMB', desc:'22 m vertical wall; case-hardened filigree ribs, meter-scale caverna, wind-scoured flutes.' },
  { id:'dome_granite', name:'Dome — Granite', badge:'EXFOLIATION', desc:'Half-Dome analogue; onion-skin exfoliation sheets, grus roughness, orthogonal traces.' },
];

const state = {
  preset: 'hoodoo_bryce',
  wireframe:false,
  flat:false,
  vertexcolor:true,
  spin:false,
  exposure:1.0,
  ground:true
};

const presetListEl = document.getElementById('preset-list');
const loadingEl = document.getElementById('loading');
const labelPresetEl = document.getElementById('label-preset');
const labelDetailEl = document.getElementById('label-detail');
const descEl = document.getElementById('preset-desc');
const statsEl = document.getElementById('stats');
const histCanvas = document.getElementById('histogram');

// Build preset list
function renderPresetList(){
  presetListEl.innerHTML='';
  PRESETS.forEach(p=>{
    const btn=document.createElement('button');
    btn.className='preset'+(p.id===state.preset?' active':'');
    btn.innerHTML=`<div class="pname">${p.name} <span class="badge">${p.badge}</span></div><div class="pdesc">${p.desc}</div>`;
    btn.onclick=()=>{ state.preset=p.id; renderPresetList(); loadPreset(p.id); };
    btn.title=p.desc;
    presetListEl.appendChild(btn);
  });
}
renderPresetList();

// Three setup
const wrap = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();
// Fog for depth
scene.fog = new THREE.Fog(0x0d0f12, 30, 80);

const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true, alpha:false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(wrap.clientWidth, wrap.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = state.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(44, wrap.clientWidth/wrap.clientHeight, 0.1, 500);
camera.position.set(14, 10, 18);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping=true;
controls.dampingFactor=0.06;
controls.minDistance=2;
controls.maxDistance=80;
controls.target.set(0,6,0);
controls.update();

// Lights
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x121418, 0.8);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe8c8, 2.2);
key.position.set(18,22,12);
key.castShadow=true;
key.shadow.mapSize.set(2048,2048);
key.shadow.camera.near=1; key.shadow.camera.far=60;
// adjust shadow frustum dynamically after load
scene.add(key);
// fill
const fill = new THREE.DirectionalLight(0x7fb1ff, 0.55);
fill.position.set(-12, 10, -10);
scene.add(fill);
// rim
const rim = new THREE.DirectionalLight(0xffc07a, 0.45);
rim.position.set(0, 8, -14);
scene.add(rim);

// Ground
let groundMesh, gridHelper;
function makeGround(){
  if (groundMesh) scene.remove(groundMesh);
  if (gridHelper) scene.remove(gridHelper);
  const g = new THREE.PlaneGeometry(140,140, 40,40);
  // subtle displacement for ground undulation
  const pos=g.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), y=pos.getY(i);
    // y here is plane Y before rotation; after rotation it becomes Z? we rotate
    const h = Math.sin(x*0.07)*0.12 + Math.cos(y*0.08)*0.12 + (Math.random()-0.5)*0.03;
    pos.setZ(i, h);
  }
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color:0x182028, roughness:0.92, metalness:0.02 });
  groundMesh = new THREE.Mesh(g, mat);
  groundMesh.rotation.x = -Math.PI/2;
  groundMesh.position.y = 0;
  groundMesh.receiveShadow=true;
  scene.add(groundMesh);
  gridHelper = new THREE.GridHelper(80, 40, 0x283141, 0x1e2630);
  gridHelper.position.y=0.02;
  scene.add(gridHelper);
  groundMesh.visible = state.ground;
  gridHelper.visible = state.ground;
}
makeGround();

// Model holder
let currentRoot = null;
let currentMesh = null;

const loader = new GLTFLoader();

async function loadPreset(id){
  loadingEl.style.display='grid';
  labelPresetEl.textContent=id;
  const preset = PRESETS.find(p=>p.id===id);
  if (preset) descEl.textContent = preset.desc;
  // fetch meta
  try{
    const metaResp = await fetch(`models/${id}_meta.json`);
    if (metaResp.ok){
      const meta= await metaResp.json();
      labelDetailEl.textContent = `${meta.verts} verts · ${meta.faces} faces · grid ${meta.grid.join('×')}`;
      // histogram placeholder for hardness? we don't have per-vert hardness in meta, but we can approximate
      drawHistogram(null);
      // update stats panel
      statsEl.innerHTML = `
        <div>Verts<br><b>${meta.verts.toLocaleString()}</b></div>
        <div>Faces<br><b>${meta.faces.toLocaleString()}</b></div>
        <div>Grid<br><b>${meta.grid.join(' × ')}</b></div>
        <div>Bounds<br><b>Y ${meta.bounds[1][0]}–${meta.bounds[1][1]} m</b></div>
      `;
    }
  }catch(e){}

  // remove prior
  if (currentRoot){
    scene.remove(currentRoot);
    currentRoot.traverse(o=>{ if(o.isMesh){ o.geometry.dispose(); if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose()); else o.material.dispose(); }});
    currentRoot=null; currentMesh=null;
  }

  try{
    const gltf = await loader.loadAsync(`models/${id}.glb`);
    const root = gltf.scene;
    // center model? Preset bounds y 0..h, centered at origin xz. We want to keep as is, but adjust to ground.
    // Compute bbox to auto-frame camera
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // shift so center xz at 0, keep y as is (base at 0)
    root.position.x -= center.x;
    root.position.z -= center.z;
    // keep y base at 0 already, but ensure min y ~0
    // Do not shift y (ground alignment)

    // Materials
    root.traverse(o=>{
      if (o.isMesh){
        // The GLB was exported with vertex colors via trimesh; ensure they are used
        const geom = o.geometry;
        // compute normals if missing
        if (!geom.attributes.normal) geom.computeVertexNormals();
        // Ensure vertex colors processed
        let hasColor = !!geom.attributes.color;
        // Create material that respects vertex colors
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: hasColor && state.vertexcolor,
          color: hasColor && state.vertexcolor ? 0xffffff : 0xE8E0D2,
          roughness: 0.85,
          metalness: 0.02,
          flatShading: state.flat,
          wireframe: state.wireframe,
          side: THREE.DoubleSide
        });
        // subtle baked AO via vertex color luminance? Already encodes hardness, we keep.
        o.material = mat;
        o.castShadow=true;
        o.receiveShadow=true;
        if (!currentMesh) currentMesh = o;
      }
    });

    currentRoot = root;
    scene.add(root);

    // auto frame
    const box2 = new THREE.Box3().setFromObject(root);
    const sph = box2.getBoundingSphere(new THREE.Sphere());
    const target = box2.getCenter(new THREE.Vector3());
    target.y = sph.center.y; // focus mid-height
    // animate camera to frame
    const dist = Math.max(sph.radius*2.4, 12);
    const dir = new THREE.Vector3(0.85, 0.55, 0.95).normalize();
    const newPos = target.clone().add(dir.multiplyScalar(dist));
    // smooth transition via lerp over 600ms
    animateCamera(camera.position.clone(), newPos, target.clone());

    // Draw histogram if we can access vertex colors as hardness proxy (luminance)
    if (currentMesh && currentMesh.geometry.attributes.color){
      const cols = currentMesh.geometry.attributes.color;
      const vals=[];
      for(let i=0;i<cols.count;i++) vals.push((cols.getX(i)+cols.getY(i)+cols.getZ(i))/3);
      drawHistogram(vals);
      const minH = Math.min(...vals).toFixed(2), maxH = Math.max(...vals).toFixed(2);
      // update stats area hardness range
      const hr = statsEl.querySelector('div:last-child');
      // we add separate row instead
    }

  }catch(e){
    console.error(e);
    loadingEl.textContent = 'Failed to load '+id+' — did you generate it? Run  python -m frontier.cli --preset '+id;
    loadingEl.style.display='grid';
    return;
  }
  loadingEl.style.display='none';
  // Update shadow frustum to cover model
  updateShadows();
}

function animateCamera(from, to, target){
  const start=performance.now(), dur=900;
  const cTarget = controls.target.clone();
  function tick(now){
    const t = Math.min((now-start)/dur,1);
    const e = 1 - Math.pow(1-t,3); // easeOutCubic
    camera.position.lerpVectors(from,to,e);
    controls.target.lerpVectors(cTarget,target,e);
    controls.update();
    if(t<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function updateShadows(){
  if(!currentRoot) return;
  const box = new THREE.Box3().setFromObject(currentRoot);
  const sz = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(sz.x, sz.z, sz.y);
  key.position.set(center.x + maxDim*0.9, center.y + maxDim*1.4, center.z + maxDim*0.8);
  key.target.position.copy(center);
  key.target.updateMatrixWorld();
  // adjust orthographic shadow cam
  const pad = maxDim*0.9;
  key.shadow.camera.left = -pad; key.shadow.camera.right=pad;
  key.shadow.camera.top=pad; key.shadow.camera.bottom=-pad;
  key.shadow.camera.near=1; key.shadow.camera.far=maxDim*3;
  key.shadow.camera.updateProjectionMatrix();
}

function drawHistogram(vals){
  const ctx=histCanvas.getContext('2d');
  const W=histCanvas.width, H=histCanvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0f1317';
  ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#283141';
  ctx.strokeRect(0.5,0.5,W-1,H-1);
  if(!vals || vals.length===0){
    ctx.fillStyle='#9aa6bb';
    ctx.font='11px Inter, sans-serif';
    ctx.textAlign='center';
    ctx.fillText('Hardness histogram (luma of vertex color)', W/2, H/2);
    return;
  }
  // bins 0..1
  const bins=32; const hist=new Array(bins).fill(0);
  vals.forEach(v=>{ let b=Math.floor(Math.max(0,Math.min(0.999,v))*bins); hist[b]++; });
  const maxC=Math.max(...hist);
  const pad=8, bw=(W-pad*2)/bins;
  // gradient: soft shale brown to limestone pale
  hist.forEach((c,i)=>{
    const h=c/maxC;
    const x=pad+i*bw, y=H-pad - h*(H-pad*2);
    const barH=h*(H-pad*2);
    // color interpolate
    const t=i/bins;
    // brown->tan->pale
    let col;
    if(t<0.5) col=`rgb(${Math.round(85+t*60)},${Math.round(72+t*30)},${Math.round(65+t*10)})`;
    else col=`rgb(${Math.round(145+(t-0.5)*90)},${Math.round(102+(t-0.5)*100)},${Math.round(75+(t-0.5)*110)})`;
    ctx.fillStyle=col;
    ctx.fillRect(x+1, y, bw-1, barH);
  });
  ctx.fillStyle='#9aa6bb';
  ctx.font='10px Inter, sans-serif';
  ctx.textAlign='left'; ctx.fillText('soft shale', pad, H-2);
  ctx.textAlign='right'; ctx.fillText('hard cap', W-pad, H-2);
  ctx.textAlign='center'; ctx.fillText('0 → 1 hardness', W/2, 10);
}

// UI handlers
document.getElementById('chk-wireframe').addEventListener('change', e=>{
  state.wireframe=e.target.checked;
  if(currentRoot) currentRoot.traverse(o=>{ if(o.isMesh) o.material.wireframe=state.wireframe; });
});
document.getElementById('chk-flatshade').addEventListener('change', e=>{
  state.flat=e.target.checked;
  if(currentRoot) currentRoot.traverse(o=>{ if(o.isMesh){ o.material.flatShading=state.flat; o.material.needsUpdate=true; }});
});
document.getElementById('chk-vertexcolor').addEventListener('change', e=>{
  state.vertexcolor=e.target.checked;
  if(currentRoot) currentRoot.traverse(o=>{
    if(o.isMesh){
      const hasColor=!!o.geometry.attributes.color;
      o.material.vertexColors = hasColor && state.vertexcolor;
      if(!state.vertexcolor) o.material.color.set(0xE8E0D2);
      else o.material.color.set(0xffffff);
      o.material.needsUpdate=true;
    }
  });
});
document.getElementById('chk-spin').addEventListener('change', e=>{ state.spin=e.target.checked; });
document.getElementById('chk-ground').addEventListener('change', e=>{
  state.ground=e.target.checked;
  if(groundMesh) groundMesh.visible=state.ground;
  if(gridHelper) gridHelper.visible=state.ground;
});
document.getElementById('rng-exposure').addEventListener('input', e=>{
  state.exposure=parseFloat(e.target.value);
  renderer.toneMappingExposure=state.exposure;
  document.getElementById('val-exposure').textContent=state.exposure.toFixed(2);
});
document.getElementById('btn-reset-cam').addEventListener('click', ()=>{
  if(currentRoot){
    const box=new THREE.Box3().setFromObject(currentRoot);
    const sph=box.getBoundingSphere(new THREE.Sphere());
    const center=box.getCenter(new THREE.Vector3());
    const dist=Math.max(sph.radius*2.4,12);
    const dir=new THREE.Vector3(0.85,0.55,0.95).normalize();
    const newPos=center.clone().add(dir.multiplyScalar(dist));
    newPos.y = center.y + sph.radius*0.4;
    animateCamera(camera.position.clone(), newPos, center);
  } else {
    camera.position.set(14,10,18); controls.target.set(0,6,0); controls.update();
  }
});
document.getElementById('btn-export-png').addEventListener('click', ()=>{
  renderer.render(scene,camera);
  const url=renderer.domElement.toDataURL('image/png');
  const a=document.createElement('a'); a.href=url; a.download=`frontier_${state.preset}.png`; a.click();
});

// Resize
function onResize(){
  const w=wrap.clientWidth, h=wrap.clientHeight;
  camera.aspect=w/h; camera.updateProjectionMatrix();
  renderer.setSize(w,h);
}
window.addEventListener('resize', onResize);

// Render loop
function animate(){
  requestAnimationFrame(animate);
  if(state.spin && currentRoot){
    currentRoot.rotation.y += 0.003;
  }
  controls.update();
  renderer.render(scene,camera);
}
animate();

// Initial load
loadPreset(state.preset);
onResize();
