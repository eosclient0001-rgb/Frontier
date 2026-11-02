// Axisymmetric C-plane photometry. Angles are degrees from the downward axis.
export function validate(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 1000) throw Error('A profile needs 2–1000 samples.');
  let previous = -1;
  for (const point of points) {
    if (!Number.isFinite(point.angle) || !Number.isFinite(point.cd) || point.angle < 0 || point.angle > 180 || point.cd < 0 || point.angle <= previous) throw Error('Angles must be increasing from 0° to 180°, with non-negative candela.');
    previous = point.angle;
  }
  if (points[0].angle !== 0 || points.at(-1).angle !== 180) throw Error('The profile must cover 0° through 180°.');
  return points;
}
export function sample(points, angle) {
  angle = Math.max(0, Math.min(180, angle));
  for (let i=1;i<points.length;i++) if (angle<=points[i].angle) {
    const a=points[i-1], b=points[i], t=(angle-a.angle)/(b.angle-a.angle);
    return a.cd+(b.cd-a.cd)*t;
  }
  return points.at(-1).cd;
}
export function flux(points) {
  validate(points);
  // Numerical integration of the interpolated intensity over a sphere.
  let total=0; const n=1800, dt=Math.PI/n;
  for(let i=0;i<n;i++){const theta=(i+.5)*dt; total+=sample(points,theta*180/Math.PI)*Math.sin(theta)*dt*2*Math.PI;}
  return total;
}
export function spotProfile(peak, inner, outer) {
  if (![peak,inner,outer].every(Number.isFinite) || peak<0 || inner<0 || outer<=inner || outer>180) throw Error('Spot angles require 0 ≤ inner < outer ≤ 180.');
  return [...new Set([...Array.from({length:37},(_,i)=>i*5), inner, outer])].sort((a,b)=>a-b).map(angle=>{const t=Math.max(0,Math.min(1,(angle-inner)/(outer-inner)));return {angle,cd:peak*(1-t*t*(3-2*t))};});
}
export function writeIES(points, name='Frontier custom profile') {
  validate(points);
  const fmt=n=>Number(n.toFixed(4)).toString();
  return ['IESNA:LM-63-2002', '[TEST] Frontier authored profile', '[LUMINAIRE] '+name.replace(/[\r\n]/g,' ').slice(0,80), 'TILT=NONE', `1 -1 1 ${points.length} 1 1 2 0 0 0`, '1 1 0', points.map(p=>fmt(p.angle)).join(' '), '0', points.map(p=>fmt(p.cd)).join(' '), ''].join('\n');
}
export function readIES(text) {
  const lines=text.replace(/\r/g,'').split('\n');
  if(!/^IESNA:LM-63-/i.test(lines[0]||'')) throw Error('Expected an LM-63 IES file.');
  const tilt=lines.findIndex(l=>/^\s*TILT\s*=/i.test(l));
  if(tilt<0 || !/^\s*TILT\s*=\s*NONE\s*$/i.test(lines[tilt])) throw Error('Only TILT=NONE files are supported.');
  const numbers=lines.slice(tilt+1).join(' ').trim().split(/[\s,]+/).map(Number);
  if(numbers.some(n=>!Number.isFinite(n)) || numbers.length<13) throw Error('Invalid photometric data.');
  const [lamps,lumens,mult,nv,nh,type,units,width,length,height,ballast,future,watts]=numbers;
  if(!Number.isInteger(nv)||nv<2||nv>1000||nh!==1||type!==1 || mult<=0 || lamps<1) throw Error('Only one-plane, rotationally symmetric Type C profiles are supported.');
  if(numbers.length !== 13+nv+nh+nv*nh) throw Error('Unexpected or incomplete candela table.');
  const angles=numbers.slice(13,13+nv), horizontal=numbers[13+nv];
  if(horizontal!==0) throw Error('The single horizontal angle must be 0°.');
  return validate(angles.map((angle,i)=>({angle,cd:numbers[13+nv+nh+i]*mult})));
}
