// Fixed sampling budgets, supplied as uniforms to discourage expansion of
// nested loops by ANGLE/D3D11. These are not user-facing quality reductions.
export const viewportUniforms = {
  renderLoopLimits: [360, 32, 4, 28], // trace, shadow, AO, water terrain ray
  waterLoopLimits: [64, 4, 8, 2], // route segments, waves, refinement, optical rays
  sampleLoopLimits: [3, 3, 2, 0], // material normal axes, curvature axes, fracture rows
};
export const viewportLoopGLSL = `
#ifndef VIEWPORT_LOOP_LIMITS
#define VIEWPORT_LOOP_LIMITS
uniform vec4 renderLoopLimits,waterLoopLimits,sampleLoopLimits;
// Zero defaults preserve standalone shader consumers and regression probes.
int viewportLimit(float supplied,int ceiling){return supplied>0.?int(min(supplied,float(ceiling))):ceiling;}
#endif
`;
