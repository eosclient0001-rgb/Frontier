export const flowPathGLSL = `
uniform highp sampler2D flowPaths;
vec4 flowValue(int i){return texelFetch(flowPaths,ivec2(i,0),0);}
struct FlowFrame{vec2 point;vec2 tangent;float distance;float width;float speed;float along;};
FlowFrame closestFlow(vec2 p){FlowFrame f;f.point=p;f.tangent=vec2(0,1);f.distance=1e5;f.width=0.;f.speed=0.;f.along=0.;int count=int(flowValue(0).x);
 for(int i=0;i<64;i++){if(i>=count)break;vec4 a=flowValue(1+i*3),b=flowValue(2+i*3);vec2 ab=b.xy-a.xy;float l=length(ab),t=clamp(dot(p-a.xy,ab)/max(l*l,1e-8),0.,1.);vec2 q=a.xy+ab*t;float d=length(p-q);
 if(d-a.w<f.distance-f.width){f.point=q;f.tangent=ab/max(l,.0001);f.distance=d;f.width=a.w;f.speed=b.w;f.along=a.z+t*l;}}
 return f;
}
vec2 flowBirth(float randomValue,bool warm){vec4 meta=flowValue(0);float target=randomValue*meta.z;vec2 p=vec2(0);
 for(int i=0;i<64;i++){if(i>=int(meta.x))break;vec4 a=flowValue(1+i*3),b=flowValue(2+i*3),c=flowValue(3+i*3);if(target<=b.z){float t=clamp((target-c.z)/max(.001,b.z-c.z),0.,1.);p=warm?mix(a.xy,b.xy,t):c.xy;break;}}
 return p;
}
`;
