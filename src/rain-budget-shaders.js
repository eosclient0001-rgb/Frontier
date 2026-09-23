import { atlasGLSL } from "./erosion-shaders.js";
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
`;
export const reduceParticles =
  header +
  `
uniform sampler2D positions,velocities,metadata,previousPositions,previousVelocity,previousMetadata,previousLife,impacts;
out vec4 sums;
void main(){ivec2 start=ivec2(gl_FragCoord.xy)*4;sums=vec4(0);
 for(int y=0;y<4;y++)for(int x=0;x<4;x++){
  ivec2 uv=start+ivec2(x,y);vec4 p=texelFetch(positions,uv,0),m=texelFetch(metadata,uv,0),oldP=texelFetch(previousPositions,uv,0),oldM=texelFetch(previousMetadata,uv,0);
  if(p.w>=0.&&m.x<.5&&texelFetch(impacts,uv,0).w>.5)sums.x++;
  if(oldP.w>=0.&&oldM.x<.5){float loss=max(0.,texelFetch(previousVelocity,uv,0).w-texelFetch(velocities,uv,0).w);
   if(p.w<0.||texelFetch(previousLife,uv,0).z>.5)sums.z+=loss;else sums.y+=loss;}
 }
}`;
export const reduceGroups =
  header +
  `
uniform sampler2D groups;
out vec4 sums;
void main(){ivec2 start=ivec2(gl_FragCoord.xy)*4;sums=vec4(0);for(int y=0;y<4;y++)for(int x=0;x<4;x++)sums+=texelFetch(groups,start+ivec2(x,y),0);}`;
export const reduceTotal =
  header +
  `
uniform sampler2D groups;
out vec4 sums;
void main(){sums=vec4(0);for(int y=0;y<18;y++)for(int x=0;x<4;x++)sums+=texelFetch(groups,ivec2(x,y),0);}`;
export const ledger =
  header +
  `
uniform sampler2D previousLedger,previousSources,totals;
uniform float stepRainVolume,shapingVolume;
layout(location=0) out vec4 nextLedger;
layout(location=1) out vec4 nextSources;
void main(){vec4 sum=texelFetch(totals,ivec2(0),0);nextSources=texelFetch(previousSources,ivec2(0),0)+vec4(shapingVolume>0.?0.:stepRainVolume,shapingVolume>0.?shapingVolume*sum.x:0.,0,0);nextLedger=texelFetch(previousLedger,ivec2(0),0)+vec4(sum.x>0.?(shapingVolume>0.?shapingVolume*sum.x:stepRainVolume):0.,sum.y,sum.z,sum.x);}`;
export const normalize =
  header +
  `
uniform sampler2D velocities,positions,metadata,impacts,totals;
uniform float stepRainVolume,shapingVolume;
out vec4 nextVelocity;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);nextVelocity=texelFetch(velocities,uv,0);
 if(texelFetch(positions,uv,0).w>=0.&&texelFetch(metadata,uv,0).x<.5&&texelFetch(impacts,uv,0).w>.5)nextVelocity.w=shapingVolume>0.?shapingVolume:stepRainVolume/max(1.,texelFetch(totals,ivec2(0),0).x);
}`;
