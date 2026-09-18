/* GPU sum-reduction: collapses a large texture to 1×1 by repeated 4-tap
 * halving. Used to measure the real per-frame eroded/deposited volume from
 * the acceptance texture without stalling every frame.
 */
import { fullscreenVertex } from "./volume.js";
import { program, makeTarget } from "./gl.js";

const reduceFragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D src;
uniform ivec2 srcSize;
out vec4 outSum;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2;
  vec4 s = vec4(0.);
  for (int y = 0; y < 2; y++)
  for (int x = 0; x < 2; x++) {
    ivec2 p = min(base + ivec2(x, y), srcSize - 1);
    s += texelFetch(src, p, 0);
  }
  outSum = s;
}`;

export class Reducer {
  constructor(gl, w, h) {
    this.gl = gl;
    this.prog = program(gl, fullscreenVertex, reduceFragment, "reduce");
    this.levels = [];
    let cw = Math.floor(w / 2), ch = Math.floor(h / 2);
    while (cw >= 1 && ch >= 1) {
      // RGBA32F so the final 1×1 readPixels(RGBA, FLOAT) is spec-guaranteed
      this.levels.push(makeTarget(gl, cw, ch, 1, { internal: gl.RGBA32F }));
      if (cw === 1 && ch === 1) break;
      cw = Math.max(1, Math.floor(cw / 2));
      ch = Math.max(1, Math.floor(ch / 2));
    }
  }

  /** Sum all texels of `texture` (w×h). Returns [r,g,b,a]. */
  sum(texture, w, h) {
    const gl = this.gl;
    let src = texture;
    let sw = w, sh = h;
    gl.useProgram(this.prog.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.prog.u("src"), 0);
    for (const level of this.levels) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.fbo);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform2i(this.prog.u("srcSize"), sw, sh);
      gl.viewport(0, 0, level.w, level.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = level.textures[0];
      sw = level.w;
      sh = level.h;
    }
    const buf = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Array.from(buf);
  }
}
