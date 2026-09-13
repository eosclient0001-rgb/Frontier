/**
 * 3D paint tools — write directly into simulator mask channels.
 * Painting never touches the SDF itself (no geometry change, no remesh needed
 * for shape); it stages rain/hardness/solubility that the simulators consume.
 */
import { Volume } from '../core/volume';

export type PaintMode = 'rain' | 'harden' | 'soften' | 'soluble' | 'erase';

export const PAINT_COLORS: Record<PaintMode, number> = {
  rain: 0x53c8ff,
  harden: 0x9d9d9d,
  soften: 0xffb347,
  soluble: 0x7dff8a,
  erase: 0xff5d5d,
};

export class PaintTool {
  mode: PaintMode = 'rain';
  radius = 6;
  strength = 0.9;

  /** Stamp the current brush at a world point. Returns true if anything changed. */
  apply(vol: Volume, cx: number, cy: number, cz: number): boolean {
    const R = Math.max(this.radius, vol.vox);
    const s = this.strength;
    const { res, vox, ox, oy, oz } = vol;
    const i0 = Math.max(0, Math.floor((cx - R - ox) / vox - 0.5));
    const i1 = Math.min(res - 1, Math.ceil((cx + R - ox) / vox - 0.5));
    const j0 = Math.max(0, Math.floor((cy - R - oy) / vox - 0.5));
    const j1 = Math.min(res - 1, Math.ceil((cy + R - oy) / vox - 0.5));
    const k0 = Math.max(0, Math.floor((cz - R - oz) / vox - 0.5));
    const k1 = Math.min(res - 1, Math.ceil((cz + R - oz) / vox - 0.5));
    const inv = 1 / R;
    let touched = false;
    for (let k = k0; k <= k1; k++) {
      const wz = oz + (k + 0.5) * vox - cz;
      for (let j = j0; j <= j1; j++) {
        const wy = oy + (j + 0.5) * vox - cy;
        for (let i = i0; i <= i1; i++) {
          const wx = ox + (i + 0.5) * vox - cx;
          const d = Math.sqrt(wx * wx + wy * wy + wz * wz) * inv;
          if (d > 1) continue;
          // Paint a shell around the surface (cheap relevance test).
          const id = (k * res + j) * res + i;
          if (vol.sdf[id] < -R * 0.7 || vol.sdf[id] > R * 0.7) continue;
          const fall = 0.5 + 0.5 * Math.cos(d * Math.PI);
          const f = fall * s;
          switch (this.mode) {
            case 'rain': {
              const v = f;
              if (v > vol.rain[id]) { vol.rain[id] = v > 1 ? 1 : v; touched = true; }
              break;
            }
            case 'harden':
              vol.hard[id] += (1 - vol.hard[id]) * f * 0.35; touched = true; break;
            case 'soften':
              vol.hard[id] *= 1 - f * 0.35; touched = true; break;
            case 'soluble':
              vol.sol[id] += (1 - vol.sol[id]) * f * 0.35; touched = true; break;
            case 'erase':
              if (vol.rain[id] > 0) { vol.rain[id] *= 1 - f * 0.6; touched = true; }
              break;
          }
        }
      }
    }
    return touched;
  }
}
