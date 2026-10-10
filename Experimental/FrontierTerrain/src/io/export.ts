// ---------------------------------------------------------------------------
// File I/O: 16-bit RAW heightmap (.r16), grayscale PNG preview, project JSON.
// Heights arrive normalised to [0,1] (1 = maxH metres) from Engine.readHeights().
// RAW is little-endian u16, row-major, row 0 = world z minimum.
// Each exporter triggers a browser download and returns once it is started.
// ---------------------------------------------------------------------------
import type { Project } from '../engine/model';

const FORMAT = 'frontier-terrain';
const FORMAT_VERSION = 1;

/** Triggers a browser download of a Blob. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = (s: string) => (s.trim() || 'terrain').replace(/[^\w.-]+/g, '_');

/** Normalised heights -> 16-bit little-endian RAW. */
export function exportRaw16(heights: Float32Array, n: number, name: string): void {
  if (heights.length !== n * n) throw new Error(`exportRaw16: expected ${n * n} samples, got ${heights.length}`);
  const out = new Uint16Array(n * n);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(Math.min(1, Math.max(0, heights[i])) * 65535);
  }
  // Explicit little-endian write, independent of host endianness.
  const bytes = new Uint8Array(out.length * 2);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < out.length; i++) dv.setUint16(i * 2, out[i], true);
  download(new Blob([bytes], { type: 'application/octet-stream' }), `${safeName(name)}_${n}x${n}.r16`);
}

/** Grayscale PNG of the height field (8-bit preview). */
export function exportPng(heights: Float32Array, n: number, name: string): void {
  if (heights.length !== n * n) throw new Error(`exportPng: expected ${n * n} samples, got ${heights.length}`);
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const cx = cv.getContext('2d');
  if (!cx) throw new Error('exportPng: 2D context unavailable');
  const img = cx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const g = Math.round(Math.min(1, Math.max(0, heights[i])) * 255);
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  cv.toBlob((b) => {
    if (b) download(b, `${safeName(name)}_${n}x${n}.png`);
  }, 'image/png');
}

/** Serialises the project (settings, generation and texture stacks) as JSON. */
export function saveProject(proj: Project): void {
  const doc = { format: FORMAT, version: FORMAT_VERSION, project: proj };
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${safeName(proj.name)}.frontier.json`);
}

/** Parses a project file written by saveProject. Throws on invalid or newer files. */
export async function loadProjectFile(file: File): Promise<Project> {
  const doc = JSON.parse(await file.text()) as { format?: string; version?: number; project?: Project };
  if (doc.format !== FORMAT || !doc.project) throw new Error('Not a Frontier terrain project file.');
  if ((doc.version ?? 0) > FORMAT_VERSION) throw new Error(`Project format v${doc.version} is newer than this app supports.`);
  const p = doc.project;
  if (!p.settings || !Array.isArray(p.gen) || !Array.isArray(p.tex)) throw new Error('Project file is missing settings or stacks.');
  return p;
}
