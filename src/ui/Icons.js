// Icons.js
// Frontier vector icon library with clean 24x24 stroke aesthetic

export const GlyphPaths = {
  flame: '<path d="M13 2c2 6-5 6-2 11-3-1-3-4-3-4C0 18 10 25 17 20c5-4 2-11-4-18Z"/>',
  smoke: '<path d="M6 20h12M5 15c-4-5 2-7 4-5-3-8 8-9 7-3 7-1 7 8 2 8H5Zm4 1v4m6-4v4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3m0 3h.01"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  file: '<path d="M14 2H5v20h14V7Zm0 0v6h5M8 13h8m-8 4h6"/>',
  folder: '<path d="M3 6h7l2 3h9l-2 11H3V6Zm0 3h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 17l9 5 9-5"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10L3 7m9 5 9-5m-9 5v10M7 4.5 17 10"/>',
  cube: '<path d="m21 16-9 5-9-5V8l9-5 9 5v8Zm-9 5V8m9 0L12 13 3 8"/>',
  link: '<path d="m10 14 4-4m-6 2-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-10 2-2a3.5 3.5 0 0 1 5 5l-2 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  viewport: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/>',
  focus: '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
  maximize: '<path d="M8 3H3v5m0-5 7 7m6 11h5v-5m0 5-7-7M16 3h5v5m0-5-7 7M8 21H3v-5m0 5 7-7"/>',
  orbit: '<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/>',
  brush: '<path d="m14 3 7 7-10 10H4v-7Zm-6 7 7 7M3 21h7"/>',
  eraser: '<path d="m18 13 3-3a2 2 0 0 0 0-2.8l-4.2-4.2a2 2 0 0 0-2.8 0L3 14a2 2 0 0 0 0 2.8l4.2 4.2c.4.4.9.6 1.4.6h11.4M6 11l8 8"/>',
  "paint-bucket": '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0L19 11ZM5 2v5M22 22a2 2 0 0 1-2-2c0-1.3 2-4 2-4s2 2.7 2 4a2 2 0 0 1-2 2Z"/>',
  stamp: '<path d="M5 22h14M19 17H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2ZM12 7V2"/>',
  pipette: '<path d="m2 22 5-5m1-1 7.5-7.5a2.1 2.1 0 1 0-3-3L5 13l-1 5 5-1ZM14 5l5 5"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  burst: '<path d="m12 2 2 6 6-4-3 7 5 3-7 1-1 7-4-6-7 4 4-7-5-4 7 1Z"/>',
  rotate: '<path d="M4 10a8 8 0 1 1 1 7M4 3v7h7"/>',
  warning: '<path d="m12 3 10 18H2Zm0 6v5m0 3h.01"/>',
  rewind: '<path d="M4 5v14m14-14L7 12l11 7Z"/>',
  pause: '<path d="M8 5v14m8-14v14"/>',
  play: '<path d="m7 4 13 8-13 8Z"/>',
  step: '<path d="m4 5 11 7-11 7Zm15 0v14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  wall: '<path d="M3 6h18v14H3Zm0 7h18M9 6v7m6 0v7"/>',
  cylinder: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  eye: '<path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M9 5c5-2 10 1 13 7l-4 5M6 6l-4 6c3 6 8 9 14 6"/>',
  undo: '<path d="M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>',
  duplicate: '<rect width="13" height="13" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  trash: '<path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6m4-6v6"/>',
  lock: '<rect width="16" height="11" x="4" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect width="16" height="11" x="4" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  split: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.5-1.1-.3-.3-.4-.8-.4-1.2 0-.9.8-1.7 1.7-1.7H16c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10Z"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'
};

export const Icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${GlyphPaths[name] || GlyphPaths.box}</svg>`;

export const FillIcons = (root = document) => {
  root.querySelectorAll("[data-icon]").forEach((element) => {
    element.innerHTML = Icon(element.dataset.icon);
  });
};
