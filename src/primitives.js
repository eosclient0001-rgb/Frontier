// Analytic local XYZ primitives shared by the CPU reference and GPU composer.
export const PRIMITIVES = [
  { id: 0, name: "Ellipsoid / boulder", hint: "Anisotropic rounded stone." },
  {
    id: 1,
    name: "Rounded box",
    hint: "Blocky rock with adjustable edge rounding.",
  },
  {
    id: 2,
    name: "Capsule / river stone",
    hint: "Organic profile changes the fraction occupied by the rounded caps.",
  },
  {
    id: 3,
    name: "Torus / rock ring",
    hint: "Organic profile controls ring thickness. High noise can close the hole.",
  },
  {
    id: 4,
    name: "Egg / teardrop",
    hint: "Organic profile controls the asymmetry between the narrow top and full bottom.",
  },
  {
    id: 5,
    name: "Organic cluster",
    hint: "Three smoothly joined lobes. Organic profile controls their blend softness.",
  },
  {
    id: 6,
    name: "Rounded cylinder",
    hint: "A pillar or worn disc; adjust XYZ size and edge rounding.",
  },
];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothMin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export function primitiveDistance(q, r, type, rounding = 0.3, profile = 0.5) {
  if (type === 1) {
    const b = Math.min(rounding, Math.min(...r) * 0.9),
      v = q.map((v, k) => Math.abs(v) - r[k] + b);
    return (
      Math.hypot(...v.map((v) => Math.max(0, v))) +
      Math.min(0, Math.max(...v)) -
      b
    );
  }
  if (type === 0) {
    const k0 = Math.hypot(...q.map((v, k) => v / r[k])),
      k1 = Math.hypot(...q.map((v, k) => v / (r[k] * r[k])));
    return k1 < 1e-7 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
  }
  const t = q.map((v, k) => v / r[k]),
    c = clamp(profile, 0.2, 0.8),
    m = Math.min(...r);
  if (type === 2) {
    const y = (t[1] - clamp(t[1], -(1 - c), 1 - c)) / c;
    return (Math.hypot(t[0], y, t[2]) - 1) * Math.min(r[0], r[1] * c, r[2]);
  }
  if (type === 3) {
    const tube = c * 0.5;
    return (
      (Math.hypot(Math.hypot(t[0], t[2]) - (1 - tube), t[1] * tube) - tube) *
      Math.min(r[0], r[1] / tube, r[2])
    );
  }
  if (type === 4) {
    const width = clamp(1 - 0.65 * c * t[1], 0.4, 1.6);
    return (Math.hypot(t[0] / width, t[1], t[2] / width) - 1) * m * 0.5;
  }
  if (type === 5) {
    const lobe = (center, size) =>
      (Math.hypot(...t.map((v, k) => (v - center[k]) / size[k])) - 1) *
      Math.min(...size);
    return (
      smoothMin(
        smoothMin(
          lobe([-0.32, -0.18, 0], [0.64, 0.7, 0.7]),
          lobe([0.3, 0.12, 0.06], [0.68, 0.64, 0.64]),
          c * 0.5,
        ),
        lobe([-0.04, 0.36, -0.19], [0.58, 0.62, 0.62]),
        c * 0.5,
      ) * m
    );
  }
  const bevel = clamp(rounding / m, 0, 0.45),
    d = [Math.hypot(t[0], t[2]) - 1 + bevel, Math.abs(t[1]) - 1 + bevel];
  return (
    (Math.hypot(...d.map((v) => Math.max(v, 0))) +
      Math.min(Math.max(...d), 0) -
      bevel) *
    m
  );
}
export const primitiveGLSL = `
float primitiveSmoothMin(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}
float primitiveLobe(vec3 t,vec3 center,vec3 size){return (length((t-center)/size)-1.)*min(size.x,min(size.y,size.z));}
float densityPrimitive(vec3 q,vec3 r,int kind,float rounding,float profile){
 float m=min(r.x,min(r.y,r.z));
 if(kind==1){float b=min(rounding,m*.9);vec3 v=abs(q)-r+b;return length(max(v,0.))+min(0.,max(v.x,max(v.y,v.z)))-b;}
 if(kind==0){float k0=length(q/r),k1=length(q/(r*r));return k1<1e-7?-m:k0*(k0-1.)/k1;}
 vec3 t=q/r;float c=clamp(profile,.2,.8);
 if(kind==2){float y=(t.y-clamp(t.y,-(1.-c),1.-c))/c;return (length(vec3(t.x,y,t.z))-1.)*min(r.x,min(r.y*c,r.z));}
 if(kind==3){float tube=c*.5;return (length(vec2(length(t.xz)-(1.-tube),t.y*tube))-tube)*min(r.x,min(r.y/tube,r.z));}
 if(kind==4){float width=clamp(1.-.65*c*t.y,.4,1.6);return (length(vec3(t.x/width,t.y,t.z/width))-1.)*m*.5;}
 if(kind==5){float a=primitiveLobe(t,vec3(-.32,-.18,0),vec3(.64,.7,.7)),b=primitiveLobe(t,vec3(.3,.12,.06),vec3(.68,.64,.64)),d=primitiveLobe(t,vec3(-.04,.36,-.19),vec3(.58,.62,.62));return primitiveSmoothMin(primitiveSmoothMin(a,b,c*.5),d,c*.5)*m;}
 float bevel=clamp(rounding/m,0.,.45);vec2 d=vec2(length(t.xz),abs(t.y))-1.+bevel;return (length(max(d,0.))+min(max(d.x,d.y),0.)-bevel)*m;
}
`;
