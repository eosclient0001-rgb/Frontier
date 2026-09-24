// Minimal WebGL2 helpers.

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: false, depth: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 not supported in this browser.');
  return gl;
}

export function compileProgram(gl, vsSrc, fsSrc, name = 'program') {
  const mk = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      throw new Error(`${name} ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'} compile error:\n${log}\n${numbered}`);
    }
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`${name} link error: ${gl.getProgramInfoLog(prog)}`);
  }
  // cache uniform locations
  const uniforms = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const base = info.name.replace(/\[0\]$/, '');
    uniforms[base] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, uniforms };
}

export function createMesh(gl, { vertices, indices, attributes }) {
  // attributes: [{name, size, offset}] interleaved in vertices
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const stride = attributes.reduce((s, a) => s + a.size, 0) * 4;
  for (const a of attributes) {
    gl.enableVertexAttribArray(a.loc);
    gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, stride, a.offset * 4);
  }
  let ibo = null, count = 0, itype = gl.UNSIGNED_INT;
  if (indices) {
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    count = indices.length;
    itype = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  }
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, count, itype, mode: gl.TRIANGLES };
}

export function drawMesh(gl, mesh) {
  gl.bindVertexArray(mesh.vao);
  if (mesh.ibo) gl.drawElements(mesh.mode, mesh.count, mesh.itype, 0);
  else gl.drawArrays(mesh.mode, 0, mesh.count);
  gl.bindVertexArray(null);
}
