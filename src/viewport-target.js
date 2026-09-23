import { allocateTexture2D, graphicsError } from './gl-resources.js';

// One full-precision linear RGB + signed ray-distance target. No geometry is
// resampled: both passes address the same viewport pixel and shared XYZ field.
export class ViewportTarget {
  constructor(gl) { this.gl = gl; }
  resize(width, height) {
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    // Release the old size first to avoid doubling peak resize storage.
    this.dispose();
    try {
      this.texture = allocateTexture2D(gl, width, height, gl.RGBA32F, 'Viewport solid pass');
      this.framebuffer = gl.createFramebuffer();
      if (!this.framebuffer) throw graphicsError(gl, 'Viewport framebuffer creation');
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw graphicsError(gl, 'Viewport framebuffer', 'RGBA32F color/distance target is incomplete.');
      this.width = width; this.height = height;
    } catch (error) { this.dispose(); throw error; }
    finally { gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  }
  dispose() {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    this.texture = this.framebuffer = null;
    this.width = this.height = 0;
  }
}
