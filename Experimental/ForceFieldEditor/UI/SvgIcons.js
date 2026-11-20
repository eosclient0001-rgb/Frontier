/*============================================================================================================================================
                                                            SVGICONS.JS
============================================================================================================================================*/
// Self-hosted SVG icon library matching Project-Zero / Frontier World Editor UI & 19 ForceModel generators.

import { FORCE_MODEL_SVG_PATHS, GetForceModelMeta } from "../Engine/ForceFieldCore.js";

const GLYPH_PATHS = {
  folder: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.4 1.5h4.6A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/>',
  camera: '<path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h6A1.5 1.5 0 0 1 11 5.5v5A1.5 1.5 0 0 1 9.5 12h-6A1.5 1.5 0 0 1 2 10.5z"/><path d="M11 7l3-1.8v5.6L11 9z"/>',
  particles: '<circle cx="4.5" cy="5.5" r="1.4"/><circle cx="11" cy="4.5" r="1.2"/><circle cx="8" cy="8.5" r="1.7"/><circle cx="4" cy="11.5" r="1.1"/><circle cx="11.8" cy="11" r="1.4"/>',
  probe: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  filter: '<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>',
  chevronDown: '<path d="M4 6l4 4 4-4"/>',
  chevronRight: '<path d="M6 4l4 4-4 4"/>',
  eye: '<path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z"/><circle cx="8" cy="8" r="1.8"/>',
  eyeOff: '<path d="M2 2l12 12M6.2 4.3A6.8 6.8 0 0 1 8 4c4.1 0 6.5 4 6.5 4a11 11 0 0 1-2.2 2.7M4.1 5.9A11 11 0 0 0 1.5 8s2.4 4 6.5 4c.8 0 1.5-.1 2.2-.3"/>',
  power: '<path d="M8 2.5v5M4.6 4.8a5 5 0 1 0 6.8 0"/>',
  check: '<path d="M3.5 8.5l3 3 6-6.5"/>',
  play: '<path d="M5 3.5l7.5 4.5L5 12.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="4" y="3.5" width="2.8" height="9" rx="0.8" fill="currentColor" stroke="none"/><rect x="9.2" y="3.5" width="2.8" height="9" rx="0.8" fill="currentColor" stroke="none"/>',
  step: '<path d="M4 3.5l6 4.5-6 4.5z" fill="currentColor" stroke="none"/><rect x="11" y="3.5" width="2" height="9" rx="0.6" fill="currentColor" stroke="none"/>',
  reset: '<path d="M3.5 7A4.8 4.8 0 1 1 5 11.2"/><path d="M3.5 3.5v3.5H7"/>',
  split: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 3v10"/>',
  diagnostics: '<path d="M2.5 11.5L6 7.5l2.5 2.5L13.5 4.5"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/>',
  focus: '<path d="M2.5 5.5V3h2.5M11 3h2.5v2.5M13.5 10.5V13H11M5 13H2.5v-2.5"/><circle cx="8" cy="8" r="2"/>',
  zap: '<path d="M9 2L4 9h4l-1 5 5-7H8z"/>',
  copy: '<rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V4a1 1 0 0 1 1-1h7"/>',
  trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.8 8.5h5.4l.8-8.5"/>',
  code: '<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3.5l-2 9"/>',
  download: '<path d="M8 2.5v7.5M5 7.5l3 3 3-3M3 13h10"/>',
  upload: '<path d="M8 10V2.5M5 5.5l3-3 3 3M3 13h10"/>',
  sliders: '<path d="M3 4.5h10M3 8h10M3 11.5h10"/><circle cx="6" cy="4.5" r="1.4" fill="#181818"/><circle cx="10.5" cy="8" r="1.4" fill="#181818"/><circle cx="5" cy="11.5" r="1.4" fill="#181818"/>',
  edit: '<path d="M3 11.5V13h1.5l7-7-1.5-1.5-7 7zM10.2 3.8l1.5 1.5"/>',
  sim: '<path d="M6 2.5h4M7 2.5v3.2l-3.4 6A1 1 0 0 0 4.5 13h7a1 1 0 0 0 .9-1.3L9 5.7V2.5"/>',
  gizmo: '<path d="M8 8V2.5M8 8l4.8 2.8M8 8L3.2 10.8"/><circle cx="8" cy="8" r="1.4"/>',
};

export function SvgGlyph(Name, Size = 14, ExtraClass = "") {
  const Body = GLYPH_PATHS[Name] || '<circle cx="8" cy="8" r="4"/>';
  return `<svg class="svg-glyph ${ExtraClass}" width="${Size}" height="${Size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Body}</svg>`;
}

export function ForceModelIconHtml(ModelId, Size = 16, CustomColor = null) {
  const Meta = GetForceModelMeta(ModelId);
  const Stroke = CustomColor || Meta.Color || "#4AA8FF";
  const Body = FORCE_MODEL_SVG_PATHS[Meta.Id] || '<circle cx="8" cy="8" r="4"/>';
  return `<svg class="force-model-svg" width="${Size}" height="${Size}" viewBox="0 0 16 16" fill="none" stroke="${Stroke}" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Body}</svg>`;
}
