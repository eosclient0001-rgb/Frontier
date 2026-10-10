// Compact inline SVG icon set — 16×16 grid, 1.4 stroke, currentColor.

const P = (d, extra = '') =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"
        stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS = {
  // terrain layer types
  mountain: P('<path d="M1.5 12.5l4-7 2.6 4.2L10.4 6l4.1 6.5z"/><path d="M6.6 8.2l1.3 2" opacity=".5"/>'),
  cells: P('<path d="M8 1.6l5.2 3.4v6L8 14.4 2.8 11V5z"/><path d="M8 5.6l2.6 1.7v3.4L8 9.3 5.4 10.7V7.3z"/>'),
  crater: P('<ellipse cx="8" cy="9.5" rx="6" ry="3"/><path d="M4.4 7.6A3.6 3.6 0 0111.6 7.6" opacity=".6"/><path d="M6.8 8.6h2.4" opacity=".6"/>'),
  wind: P('<path d="M1.5 5h8a2.2 2.2 0 10-2.2-2.2"/><path d="M1.5 8.5h11a2.2 2.2 0 11-2.2 2.2"/><path d="M3 11.8h5"/>'),
  plane: P('<path d="M1.5 11.5h13"/><path d="M3 8.5h10" opacity=".45"/>'),
  talus: P('<path d="M1.5 12.5h13"/><path d="M3 12.5L6.5 5 10 12.5"/><path d="M6.5 5l1.4 2.6" opacity=".5"/>'),
  droplet: P('<path d="M8 1.8S3.8 6.6 3.8 9.4a4.2 4.2 0 108.4 0C12.2 6.6 8 1.8 8 1.8z"/>'),
  river: P('<path d="M2 2c3 0 2.5 3 5.5 3S11 2 14 2"/><path d="M2 8c3 0 2.5 3 5.5 3S11 8 14 8"/><path d="M2 13.5c3 0 2.5-1.5 5.5-1.5" opacity=".5"/>'),
  blur: P('<circle cx="8" cy="8" r="5.4" stroke-dasharray="2 2"/><circle cx="8" cy="8" r="2.2"/>'),
  smooth: P('<path d="M1.5 11c2 0 2.5-6 4.5-6s2.5 6 4.5 6 2.5-3 4-3"/>'),
  sharpen: P('<path d="M8 1.8l1.8 4.4L14 8l-4.2 1.8L8 14.2 6.2 9.8 2 8l4.2-1.8z"/>'),
  terrace: P('<path d="M1.5 13h3V10h3.5V7h3V4h3"/>'),
  strata: P('<path d="M1.5 4h13M1.5 7.2h13M1.5 10.4h13M1.5 13.4h13" opacity=".85"/><path d="M5 4v3.2M9.5 7.2v3.2M12 4v3.2" opacity=".35"/>'),
  curve: P('<path d="M1.5 13.5C4 13.5 5.5 2.5 14.5 2.5"/><path d="M1.5 13.5h13" opacity=".3"/>'),
  warp: P('<path d="M2 8c1.5-4 3.5 4 5 0s3.5 4 5 0"/><path d="M2 12.5c1.5-4 3.5 4 5 0s3.5 4 5 0" opacity=".4"/>'),
  snow: P('<path d="M8 1.5v13M2.3 4.8l11.4 6.4M13.7 4.8L2.3 11.2"/>'),
  clamp: P('<path d="M3 3v10M13 3v10"/><path d="M3 8h10"/><path d="M6 5.5L5 8l1 2.5M10 5.5l1 2.5-1 2.5" opacity=".6"/>'),

  // chrome
  eye: P('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: P('<path d="M2.5 5.5C1.8 6.5 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7"/><path d="M13.4 10c.7-1 1.1-2 1.1-2S12 3.5 8 3.5c-.6 0-1.1.1-1.6.2"/><path d="M2 2l12 12"/>'),
  grip: '<svg viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="3" r="1.1"/><circle cx="7.5" cy="3" r="1.1"/><circle cx="2.5" cy="7" r="1.1"/><circle cx="7.5" cy="7" r="1.1"/><circle cx="2.5" cy="11" r="1.1"/><circle cx="7.5" cy="11" r="1.1"/></svg>',
  plus: P('<path d="M8 3v10M3 8h10"/>'),
  trash: P('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/><path d="M6.6 6.5v5M9.4 6.5v5" opacity=".5"/>'),
  copy: P('<rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6"/><path d="M10.8 5.2V3.8A1.3 1.3 0 009.5 2.5H3.8a1.3 1.3 0 00-1.3 1.3v5.7A1.3 1.3 0 003.8 10.8h1.4"/>'),
  chevron: '<svg viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 3L4.5 6l3-3"/></svg>',
  mask: P('<rect x="2" y="2.5" width="12" height="11" rx="2"/><circle cx="8" cy="8" r="3.2" fill="currentColor" stroke="none" opacity=".85"/>'),
  layers: P('<path d="M8 1.8L1.8 5.2 8 8.6l6.2-3.4z"/><path d="M1.8 8.6L8 12l6.2-3.4" opacity=".55"/>'),
  sun: P('<circle cx="8" cy="8" r="3.2"/><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3"/>'),
  camera: P('<path d="M1.8 5.2h7.4a1 1 0 011 1v5.3a1 1 0 01-1 1H1.8a1 1 0 01-1-1V6.2a1 1 0 011-1z"/><path d="M10.2 8.6l3.6-2.1v6.4l-3.6-2.1z"/>'),
  water: P('<path d="M1.5 11c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.2-2"/><path d="M1.5 14c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.2-2" opacity=".55"/>'),
  grid: P('<path d="M2 2h12v12H2z"/><path d="M6 2v12M10 2v12M2 6h12M2 10h12" opacity=".4"/>'),
};

export function icon(name, cls = '') {
  return `<span class="${cls}">${ICONS[name] || ICONS.plane}</span>`;
}

export function iconEl(name) {
  const s = document.createElement('span');
  s.innerHTML = ICONS[name] || ICONS.plane;
  return s.firstElementChild;
}
