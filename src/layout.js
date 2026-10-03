// Single source of truth for the byte layout of every GPU uniform.
//
// tools/wgsl-check.mjs asserts these tables against the structs wgsl_reflect
// reports for the WGSL sources, so a mismatch between the JS packing and the
// shaders is caught by `npm test` instead of by a silent black canvas.

export const CAMERA = {
  name: 'Camera',
  size: 256,
  floatCount: 64,
  members: [
    { name: 'viewProj', offset: 0, size: 64 },      // mat4x4f
    { name: 'model', offset: 64, size: 64 },        // mat4x4f
    { name: 'invViewProj', offset: 128, size: 64 }, // mat4x4f
    { name: 'eye', offset: 192, size: 16 },         // vec4f
    { name: 'lightDir', offset: 208, size: 16 },
    { name: 'lightCol', offset: 224, size: 16 },
    { name: 'ambient', offset: 240, size: 16 },
  ],
};

export const FABRIC = {
  name: 'Fabric',
  size: 128,
  floatCount: 32,
  members: [
    { name: 'colA', offset: 0, size: 16 },
    { name: 'colB', offset: 16, size: 16 },
    { name: 'colC', offset: 32, size: 16 },
    { name: 'p0', offset: 48, size: 16 },  // scale, stripeWidth, dotRadius, motifRadius
    { name: 'p1', offset: 64, size: 16 },  // amountStripe, amountPlaid, amountDot, amountMotif
    { name: 'p2', offset: 80, size: 16 },  // weaveAmount, weaveScale, noiseAmount, noiseScale
    { name: 'p3', offset: 96, size: 16 },  // stripeAngle, motifCount, motifStyle, rotation
    { name: 'p4', offset: 112, size: 16 }, // type, roughness, sheen, metalness
  ],
};

export const SIM = {
  name: 'Sim',
  size: 64,
  floatCount: 16,
  members: [
    { name: 'gravity', offset: 0, size: 16 },  // xyz gravity, w = substep dt
    { name: 'wind', offset: 16, size: 16 },    // xyz wind dir * strength, w = time
    { name: 'params', offset: 32, size: 16 },  // airDrag, damping, thickness, friction
    { name: 'params2', offset: 48, size: 16 }, // substeps, unbused, unused, floorY
  ],
};

export const COL = {
  name: 'Col',
  size: 176,
  floatCount: 44,
  members: [
    { name: 'modelInv', offset: 0, size: 64 },
    { name: 'model', offset: 64, size: 64 },
    { name: 'params', offset: 128, size: 16 },  // thickness, friction, restitution, dt
    { name: 'extra', offset: 144, size: 16 },   // floorY, time, unused, unused
    { name: 'counts', offset: 160, size: 16 },  // uvec4: ringCount, capsuleCount, collide, 0
  ],
};

export const PIN = {
  name: 'PinParams',
  size: 16,
  floatCount: 4,
  members: [{ name: 'params', offset: 0, size: 16 }], // blend, unused x3
};

export const PREVIEW = {
  name: 'Preview',
  size: 48,
  floatCount: 12,
  members: [
    { name: 'rect', offset: 0, size: 16 },
    { name: 'res', offset: 16, size: 16 },
    { name: 'flags', offset: 32, size: 16 },
  ],
};

/** The structs the shaders declare, in the order wgsl-check should verify them. */
export const CONTRACT = { Camera: CAMERA, Fabric: FABRIC, Sim: SIM, Col: COL, Preview: PREVIEW };

/**
 * Write a named-field uniform into a Float32Array using a layout table.
 * Values are plain arrays of floats; a Uint32Array writes into the same bytes
 * reinterpreted as unsigned ints (used by the collision `counts` member).
 */
export function writeUniform(out, layout, values) {
  for (const m of layout.members) {
    const v = values[m.name];
    if (!v) continue;
    const at = m.offset / 4;
    const slots = Math.min(v.length, m.size / 4);
    if (v instanceof Uint32Array) {
      const u = new Uint32Array(out.buffer, out.byteOffset, out.length);
      for (let i = 0; i < slots; i++) u[at + i] = v[i];
    } else {
      for (let i = 0; i < slots; i++) out[at + i] = v[i];
    }
  }
  return out;
}

export function uniform(layout) {
  return new Float32Array(layout.size / 4);
}
