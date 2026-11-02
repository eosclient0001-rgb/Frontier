import { EvaluateWind, NewWindComponent } from './WindSpecification.js';
const $ = s => document.querySelector(s);
const key = 'frontier-forcefield-debug-v1';
const initial = () => ({...NewWindComponent('Directional'), Name:'Prevailing wind', Infinite:true, Activation:'always', Start:0, Duration:0, TriggeredAt:null});
let fields;
try { fields = JSON.parse(localStorage.getItem(key)); } catch {}
if (!Array.isArray(fields) || !fields.length) fields = [initial()];
let selected = 0, time = 0, playing = false, last = 0;
const save = () => { try { localStorage.setItem(key, JSON.stringify(fields)); } catch {} };
const active = f => { const start = f.Activation === 'always' ? f.Start : f.TriggeredAt; return f.Enabled && start != null && time >= start && (!f.Duration || time < start + f.Duration); };
function sample(x,z,t=time) {
  let vx=0, vz=0;
  for (const f of fields) {
    const start=f.Activation==='always'?f.Start:f.TriggeredAt;
    if(!f.Enabled || start == null || t<start || (f.Duration>0 && t>=start+f.Duration)) continue;
    // Directional wind in the original model is unbounded. Apply a spherical XZ falloff only when explicitly bounded.
    const [a,b]=EvaluateWind({Components:[f]},x,z,t);
    const factor=f.Type==='Directional' && !f.Infinite ? Math.max(0,1-((x-f.X)**2+(z-f.Z)**2)/(f.Radius*f.Radius))**2 : 1;
    vx+=a*factor;vz+=b*factor;
  }
  return [vx,vz];
}
function measure(x,z,kind) {
 const [vx,vz]=sample(x,z), h=1, xp=sample(x+h,z), xm=sample(x-h,z), zp=sample(x,z+h), zm=sample(x,z-h);
 if(kind==='vx')return vx;if(kind==='vz')return vz;
 if(kind==='divergence')return (xp[0]-xm[0]+zp[1]-zm[1])/(2*h);
 if(kind==='vorticity')return (zp[0]-zm[0]-xp[1]+xm[1])/(2*h);
 return Math.hypot(vx,vz);
}
const stops=[[5,18,81],[0,112,241],[0,224,210],[235,239,39],[239,60,18]];
function color(v,kind,scale){let t=kind==='speed'?v/scale:(v/scale+1)/2;t=Math.max(0,Math.min(1,t))*(stops.length-1);const i=Math.min(stops.length-2,Math.floor(t)), f=t-i;return `rgb(${stops[i].map((v,j)=>Math.round(v*(1-f)+stops[i+1][j]*f)).join(',')})`;}
function renderList(){const root=$('#outliner');root.replaceChildren();fields.forEach((f,i)=>{const b=document.createElement('button');b.className='field'+(i===selected?' active':'');b.textContent=(f.Enabled?'● ':'○ ')+f.Name+' · '+f.Type;b.onclick=()=>{selected=i;render();};root.append(b)});}
function renderProps(){const f=fields[selected], root=$('#properties');root.replaceChildren();
 function input(label, prop, type='number', opts={}) {const row=document.createElement('label');row.textContent=label;let n=document.createElement(type==='select'?'select':'input');if(type==='select'){for(const v of opts.values){const o=document.createElement('option');o.value=v;o.textContent=v;n.append(o)}}else {n.type=type;if(opts.min!==undefined)n.min=opts.min;n.step=opts.step||'any'} if(type==='checkbox')n.checked=!!f[prop];else n.value=f[prop];n.onchange=()=>{f[prop]=type==='checkbox'?n.checked:type==='number'?Number(n.value):n.value;if(prop==='Radius')f.Radius=Math.max(1,f.Radius||1);if(prop==='Type' && f.Type!=='Directional')f.Infinite=false;save();render();};row.append(n);root.append(row)}
 input('Name','Name','text');input('Enabled','Enabled','checkbox');input('Type','Type','select',{values:['Directional','Gust','Tornado','Radial']});input('Infinite (directional)','Infinite','checkbox');input('Centre X [m]','X');input('Centre Z [m]','Z');input('Radius [m]','Radius','number',{min:1});input('Strength [m/s]','Strength');input('Bearing [°]','Bearing');input('Frequency [Hz]','Frequency','number',{min:0});
 const del=document.createElement('button');del.textContent='Remove field';del.disabled=fields.length===1;del.onclick=()=>{fields.splice(selected,1);selected=0;save();render()};root.append(del);
 $('#activation').value=f.Activation;$('#start').value=f.Start;$('#duration').value=f.Duration;
}
function renderTracks(){const root=$('#tracks');root.replaceChildren();for(const f of fields){const row=document.createElement('div');row.className='track';const name=document.createElement('span');name.textContent=f.Name;const bar=document.createElement('div'), span=document.createElement('i');const start=f.Activation==='always'?f.Start:f.TriggeredAt;if(start!==null){span.style.left=(Math.min(60,start)/60*100)+'%';span.style.width=(Math.max(0,Math.min(60-start,f.Duration||60-start))/60*100)+'%';bar.append(span)}row.append(name,bar);root.append(row)}$('#state').textContent=fields.filter(active).length+' active';}
function render(){renderList();renderProps();renderTracks()}
$('#add').onclick=()=>{fields.push({...initial(),Id:crypto.randomUUID(),Name:'Wind '+(fields.length+1),Infinite:false});selected=fields.length-1;save();render()};
for(const [id,prop] of [['activation','Activation'],['start','Start'],['duration','Duration']]) $('#'+id).onchange=e=>{fields[selected][prop]=id==='activation'?e.target.value:Math.max(0,Number(e.target.value)||0);fields[selected].TriggeredAt=null;save();render()};
$('#trigger').onclick=()=>{fields[selected].TriggeredAt=time;save();render()};$('#reset-trigger').onclick=()=>{fields[selected].TriggeredAt=null;save();render()};
$('#time').oninput=e=>{time=+e.target.value;renderTracks()};$('#play').onclick=()=>{playing=!playing;$('#play').textContent=playing?'❚❚ Pause':'▶ Play';last=0};$('#reset').onclick=()=>{time=0;fields.forEach(f=>f.TriggeredAt=null);save();renderTracks()};
const canvas=$('#canvas'), ctx=canvas.getContext('2d');
function frame(now){requestAnimationFrame(frame);if(playing && last)time=Math.min(60,time+(now-last)/1000);last=now;$('#time').value=time;$('#clock').textContent=time.toFixed(1)+' s';renderTracks();const rect=canvas.getBoundingClientRect(), ratio=Math.min(devicePixelRatio||1,2), w=Math.round(rect.width*ratio),h=Math.round(rect.height*ratio);if(!w||!h)return;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}ctx.setTransform(ratio,0,0,ratio,0,0);const W=rect.width,H=rect.height;ctx.fillStyle='#050b12';ctx.fillRect(0,0,W,H);const kind=$('#quantity').value, scale=Math.max(.001,+$('#scale').value||1), mode=$('#view').value;const unit=kind==='speed'||kind==='vx'||kind==='vz'?'m/s':'1/s';$('#legend').textContent=`${kind.toUpperCase()} [${unit}]\n${kind==='speed'?'0':(-scale)} → ${scale} (clamped)`;
 const N=42, span=1000, project=(x,z)=>mode==='2d'?[W*(.5+x/span*.85),H*(.5+z/span*.85)]:[W*.5+(x-z)/span*W*.37,H*.48+(x+z)/span*H*.27];
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){const x=(i/N-.5)*span,z=(j/N-.5)*span, d=span/N, p=[project(x,z),project(x+d,z),project(x+d,z+d),project(x,z+d)];ctx.fillStyle=color(measure(x+d/2,z+d/2,kind),kind,scale);ctx.beginPath();ctx.moveTo(...p[0]);p.slice(1).forEach(q=>ctx.lineTo(...q));ctx.closePath();ctx.fill();if(mode==='3d'){ctx.strokeStyle='#8cdde12b';ctx.lineWidth=.5;ctx.stroke()}}
 if($('#vectors').checked)for(let j=0;j<15;j++)for(let i=0;i<15;i++){const x=(i/14-.5)*span,z=(j/14-.5)*span,[vx,vz]=sample(x,z),m=Math.hypot(vx,vz);if(m<.01)continue;const p=project(x,z),q=project(x+vx/m*25,z+vz/m*25);const a=Math.atan2(q[1]-p[1],q[0]-p[0]);ctx.strokeStyle='#efffffc0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.lineTo(q[0]-5*Math.cos(a-.55),q[1]-5*Math.sin(a-.55));ctx.moveTo(...q);ctx.lineTo(q[0]-5*Math.cos(a+.55),q[1]-5*Math.sin(a+.55));ctx.stroke()}
}
canvas.onmousemove=e=>{if($('#view').value!=='2d')return;const r=canvas.getBoundingClientRect(),x=((e.clientX-r.left)/r.width-.5)/.85*1000,z=((e.clientY-r.top)/r.height-.5)/.85*1000,[vx,vz]=sample(x,z);$('#probe').textContent=`X ${x.toFixed(1)} m · Z ${z.toFixed(1)} m  |  Vx ${vx.toFixed(2)} · Vz ${vz.toFixed(2)} m/s  |  ${$('#quantity').value}: ${measure(x,z,$('#quantity').value).toFixed(3)}`};
render();requestAnimationFrame(frame);
