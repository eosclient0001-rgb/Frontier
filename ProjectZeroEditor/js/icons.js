/*==============================================================================================================================
  ICONS — the native row glyphs (Engine/DisplayPresentation/VectorCodec outliner set: a 24-unit viewBox, 1.6 stroke,
  round caps and joins) plus the filled-in set this redesign adds for the items the native list had no artwork for:
  tyres, wheels, rims and carcasses, vehicles and their parts, cloth and soft bodies, and the authoring families.
  Every icon below is a native vector — no raster, no font dependency, no network asset.
==============================================================================================================================*/

const ICONS = (() => {
  const S = (body, opt = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" ${opt}>${body}</svg>`;
  const F = (body) => `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">${body}</svg>`;
  const st = (body) => S(body);
  const dash = (d, on = 2, off = 1.6) => `<path d="${d}" stroke-dasharray="${on} ${off}"/>`;
  const P = (d) => `<path d="${d}"/>`;

  return {
  /*──────────────────────────────────────── native chrome glyphs ────────────────────────────────*/
  check:      st(P('M4 12.5 9.5 18 20 6')),
  warn:       st(P('M12 4 21 20H3z') + P('M12 10v4') + '<circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none"/>'),
  search:     st('<circle cx="11" cy="11" r="6.2"/>' + P('M15.6 15.6 21 21')),
  sliders:    st(P('M4 7h9M17 7h3M4 12h3M11 12h9M4 17h7M15 17h5') + '<circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="17" r="2"/>'),
  compact:    st(P('M4 8h16M4 12h10M4 16h16')),
  chevron:    st(P('M9 5l7 7-7 7')),
  chevronUp:  st(P('M5 15l7-7 7 7')),
  plus:       st(P('M12 5v14M5 12h14')),
  minus:      st(P('M5 12h14')),
  trash:      st(P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')),
  key:        st('<circle cx="8" cy="14" r="4"/>' + P('M11 11l8-8M17 5l2 2M15 7l2 2')),
  eye:        st(P('M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z') + '<circle cx="12" cy="12" r="2.6"/>'),
  eyeOff:     st(P('M4 5l16 14') + P('M9.5 6.4A10.6 10.6 0 0 1 12 6c6 0 10 6 10 6a18 18 0 0 1-3.2 3.7M6.5 8.2A17.6 17.6 0 0 0 2 12s4 6 10 6c1.3 0 2.4-.3 3.5-.8')),
  dot:        F('<circle cx="12" cy="12" r="3"/>'),
  play:       F('<path d="M7 5l12 7-12 7z"/>'),
  pause:      F('<rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/>'),
  stop:       F('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  step:       F('<path d="M7 5l9 7-9 7z"/><rect x="16.6" y="5" width="2.4" height="14"/>'),
  simulate:   st('<path d="M12 3a9 9 0 1 1-6.4 2.6"/>' + P('M12 12V7M12 12l3.4 2') + F('<path d="M17 3l4 2-4 2z"/>')),
  command:    st(P('M6 3H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-2M6 15H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2')),
  gear:       st('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.2" stroke-dasharray="1.6 2.4"/>'),
  lock:       st('<rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/><path d="M8.4 10.5V8a3.6 3.6 0 0 1 7.2 0v2.5"/>'),
  unlock:     st('<rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/><path d="M8.4 10.5V8a3.6 3.6 0 0 1 7.2 0"/>'),
  axes:       st(P('M12 21V3M12 21H4M12 21h8') + F('<circle cx="12" cy="3" r="1.6"/><circle cx="4" cy="21" r="1.6"/><circle cx="20" cy="21" r="1.6"/>')),

  /*──────────────────────────────────────── world & celestial ────────────────────────────────────*/
  globe:      st('<circle cx="12" cy="12" r="8.6"/>' + P('M3.6 9.6h16.8M3.6 14.4h16.8') + P('M12 3.4c2.6 2.6 3.4 6 3.4 8.6S14.6 18.6 12 20.6M12 3.4C9.4 6 8.6 9.4 8.6 12s.8 6 3.4 8.6')),
  sun:        st('<circle cx="12" cy="12" r="4.2"/>' + P('M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9')),
  moonsun:    st(P('M17 4.2A8 8 0 1 0 20.4 15 6.4 6.4 0 0 1 17 4.2z')),
  moon:       st(P('M15.6 3.4A8.4 8.4 0 1 0 20.4 13 6.6 6.6 0 0 1 15.6 3.4z')),
  stars:      F('<path d="M12 2.4l1.9 5.2 5.3.2-4.3 3.1 1.7 5.1L12 13.1l-4.6 2.9 1.7-5.1L4.8 7.8l5.3-.2z"/><circle cx="19" cy="17.4" r="1.5"/><circle cx="6.4" cy="19" r="1.1"/>'),
  sky:        st('<circle cx="12" cy="12" r="8.6"/>' + P('M4.2 8.6h15.6') + '<circle cx="15.6" cy="8.6" r="1.5" fill="currentColor" stroke="none"/>'),
  atmosphere: st('<circle cx="12" cy="12" r="3.2"/>' + '<circle cx="12" cy="12" r="6.6" opacity=".55"/>' + '<circle cx="12" cy="12" r="9.6" opacity=".3"/>'),
  cloud:      st(P('M6.4 18.5h11a4 4 0 0 0 .3-8 5.6 5.6 0 0 0-10.7-1.2 4.3 4.3 0 0 0-.6 9.2z')),
  cloudVolume:st(P('M6.4 16.5h11a3.6 3.6 0 0 0 .3-7.2A5.2 5.2 0 0 0 7 8.3a3.9 3.9 0 0 0-.6 8.2z') + '<path d="M4 20.5h16" stroke-dasharray="2 2"/>'),
  localCloud: st(P('M7 15h10a3.2 3.2 0 0 0 .2-6.4A4.7 4.7 0 0 0 7.8 7.4a3.5 3.5 0 0 0-.8 7.6z') + P('M4 19h16') + P('M4 5v14M20 5v14')),
  fog:        st(P('M3 9h13M7 13h14M3 17h11')),
  heightFog:  st(P('M3 8.5h11M6 12h15M3 15.5h11M8 19h13') + P('M3 5h6')),
  aerialFog:  st(P('M2.5 15.5h19M5 18.5h14M7 12.5h10') + '<circle cx="12" cy="6.4" r="2.8"/>'),
  volumeFog:  st('<rect x="4" y="7" width="16" height="11" rx="2"/>' + P('M4 11.5h16M4 15h16')),
  wind:       st(P('M3 8.5h11a2.6 2.6 0 1 0-2.6-2.6') + P('M3 12.5h15.5a2.6 2.6 0 1 1-2.6 2.6') + P('M3 16.5h7')),
  rain:       st(P('M7 15.5h10a3.6 3.6 0 0 0 .2-7.2A4.8 4.8 0 0 0 7.6 8a3.6 3.6 0 0 0-.6 7.5z') + P('M8 18l-1 3M12 18l-1 3M16 18l-1 3')),
  drizzle:    st(P('M7 15h10a3.6 3.6 0 0 0 .2-7.2A4.8 4.8 0 0 0 7.6 7.6a3.6 3.6 0 0 0-.6 7.4z') + P('M9 18v1.6M12 18v2.2M15 18v1.6')),
  snow:       st(P('M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9') + P('M12 6.6l-1.8-1.8M12 6.6l1.8-1.8M12 17.4l-1.8 1.8M12 17.4l1.8 1.8')),
  hail:       st(P('M7 13h10a3.4 3.4 0 0 0 .2-6.8A4.6 4.6 0 0 0 7.6 6a3.4 3.4 0 0 0-.6 7z') + '<circle cx="9" cy="17" r="1.3"/><circle cx="13" cy="19" r="1.3"/><circle cx="16.5" cy="16.5" r="1.3"/>'),
  sleet:      st(P('M7 14h10a3.4 3.4 0 0 0 .2-6.8A4.6 4.6 0 0 0 7.6 7a3.4 3.4 0 0 0-.6 7z') + P('M9 17l-1 2.4M13 17l-1 2.4') + '<circle cx="16.5" cy="18.4" r="1.2"/>'),
  rainbow:    st('<path d="M3.5 19a8.5 8.5 0 0 1 17 0"/><path d="M6.6 19a5.4 5.4 0 0 1 10.8 0" opacity=".6"/><path d="M9.6 19a2.4 2.4 0 0 1 4.8 0" opacity=".4"/>'),
  flare:      F('<circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="12" r="5" opacity=".35"/>') + st('<circle cx="12" cy="12" r="8.4" stroke-dasharray="1.4 2.6"/>'),
  lightning:  F('<path d="M13.2 2.6 5.4 13h5.2l-.8 8.4L18.6 11h-5.4z"/>'),
  exposure:   st('<circle cx="12" cy="12" r="8.6"/>' + P('M12 3.4v17.2') + P('M12 3.4a8.6 8.6 0 0 1 0 17.2z')),
  horizon:    st('<circle cx="12" cy="12" r="8.6"/>' + P('M3.4 12h17.2') + P('M8 12a4 4 0 0 1 8 0')),
  wave:       st(P('M2.5 9.5c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0M2.5 15c2-2.6 4-2.6 6 0s4 2.6 6 0 4-2.6 6 0')),

  /*──────────────────────────────────────── geometry & bodies ───────────────────────────────────*/
  cube:       st(P('M12 3.2 20.4 8v8L12 20.8 3.6 16V8z') + P('M12 12 20.4 8M12 12 3.6 8M12 12v8.8')),
  sphere:     st('<circle cx="12" cy="12" r="8.6"/>' + '<ellipse cx="12" cy="12" rx="8.6" ry="3.4" opacity=".55"/>'),
  cylinder:   st('<ellipse cx="12" cy="6.4" rx="7" ry="2.8"/>' + P('M5 6.4v11.2M19 6.4v11.2') + '<path d="M5 17.6a7 2.8 0 0 0 14 0"/>'),
  cone:       st(P('M12 3.4 20 19H4z') + '<ellipse cx="12" cy="19" rx="8" ry="2.6"/>'),
  torus:      st('<ellipse cx="12" cy="12" rx="9" ry="5.4"/>' + '<ellipse cx="12" cy="12" rx="3.4" ry="2"/>'),
  plane:      st(P('M2.6 16 12 11.4l9.4 4.6L12 20.6z')),
  pyramid:    st(P('M12 4 21 19.4H3z') + P('M12 4v15.4')),
  lattice:    st(P('M4 6h16M4 12h16M4 18h16M8 3v18M16 3v18')),
  mesh:       st(P('M12 3.4 20.6 8v8L12 20.6 3.4 16V8z') + P('M12 12 20.6 8M12 12 3.4 8') + P('M12 3.4 12 12M12 12v8.6')),
  terrain:    st(P('M2.5 19h19L15 8.5l-3.6 5-2.2-3z')),
  foliage:    st(P('M12 20.5v-4') + '<circle cx="12" cy="10.5" r="6.4"/>' + P('M12 6.6v7.8')),
  water:      st(P('M12 3.4c3.8 4.4 6.6 7.3 6.6 10.4a6.6 6.6 0 0 1-13.2 0C5.4 10.7 8.2 7.8 12 3.4z')),
  ground:     st(P('M3 17h18M6 17l2.6-8h6.8L18 17') + P('M9 13h6')),

  /*──────────────────────────────────────── lights ───────────────────────────────────────────────*/
  directional:st('<circle cx="7.6" cy="7.6" r="3"/>' + P('M10 10l8 8M15 6.4h5.6M17.8 3.6v5.6')),
  pointlight: st('<circle cx="12" cy="12" r="3.4"/>' + P('M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7')),
  spotlight:  st(P('M9 3.6h6l2.6 5.4H6.4z') + P('M12 9v4') + P('M6.4 14.4 12 21l5.6-6.6')),
  arealight:  st('<rect x="3.4" y="9" width="17.2" height="6" rx="1.4"/>' + P('M6 18h12M8 15v3M16 15v3')),
  bulb:       st('<path d="M9 17h6M10 20h4"/>' + P('M12 3a5.6 5.6 0 0 1 3.4 10v4H8.6v-4A5.6 5.6 0 0 1 12 3z')),
  headlight:  st(P('M2.6 12h4a5.4 5.4 0 0 1 10.8 0h4') + P('M12 6.6V4M6.4 8.2 4.8 6.6M17.6 8.2l1.6-1.6')),

  /*──────────────────────────────────────── cameras & optics ────────────────────────────────────*/
  camera:     st('<rect x="3" y="7.4" width="13.6" height="9.2" rx="2"/>' + P('M16.6 12l4.4-3v6z') + '<circle cx="9.8" cy="12" r="2.6"/>'),
  cinecamera: st('<rect x="2.6" y="8.6" width="11.4" height="7.6" rx="1.8"/>' + P('M14 12l4-2.6v5.2z') + P('M6.4 8.6V6h5.4v2.6')),
  aperture:   st('<circle cx="12" cy="12" r="8.6"/>' + P('M12 3.4 7 12M20.4 12h-9.6M16.6 19.4 12 12M7 12 3.6 18.4M7.4 5.4 12 12')),
  lens:       st('<ellipse cx="12" cy="12" rx="4.6" ry="8.6"/>' + '<ellipse cx="12" cy="12" rx="8.6" ry="4.6" opacity=".5"/>'),

  /*──────────────────────────────────────── authoring ───────────────────────────────────────────*/
  material:   st('<circle cx="12" cy="12" r="8.4"/>' + P('M6.6 7.4a7 7 0 0 1 3.6-2') + '<circle cx="9.4" cy="9.2" r="2" opacity=".6"/>'),
  texture:    st('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.4"/>' + P('M3.4 12h17.2M12 3.4v17.2') + '<circle cx="8" cy="8" r="1.6" opacity=".7"/>'),
  script:     st('<rect x="4.6" y="3.4" width="14.8" height="17.2" rx="2.2"/>' + P('M8.4 8h7.2M8.4 12h7.2M8.4 16h4')),
  animation:  st('<circle cx="8" cy="6" r="2.2"/>' + P('M8 8.2V15a4 4 0 0 0 4 4h4') + '<circle cx="17.6" cy="19" r="2.2"/>'),
  bone:       st('<circle cx="6.4" cy="6.4" r="2.4"/><circle cx="17.6" cy="17.6" r="2.4"/>' + P('M8.2 8.2 15.8 15.8')),
  audio:      st('<rect x="3.4" y="9" width="4.4" height="6" rx="1.4"/>' + P('M7.8 12l4.6-4.4v12.8L7.8 12M14.4 8.6a5 5 0 0 1 0 6.8M17 6.4a8.6 8.6 0 0 1 0 11.2')),
  rigid:      st('<circle cx="12" cy="12" r="8.6"/>' + P('M12 3.4v3.2M12 17.4v3.2M3.4 12h3.2M17.4 12h3.2')),
  collider:   st('<rect x="4" y="4" width="12" height="12" rx="1.6" stroke-dasharray="3 2"/>' + '<circle cx="15.4" cy="15.4" r="4.6"/>'),
  trigger:    st('<circle cx="12" cy="12" r="8.6" stroke-dasharray="3 2"/>' + P('M12 8v4.6l3 1.8')),
  prefab:     st(P('M12 3.4 19.4 7.4v7.2L12 18.6 4.6 14.6V7.4z') + P('M4.6 7.4 12 11.4l7.4-4M12 11.4v7.2')),
  instance:   st('<rect x="3.4" y="3.4" width="9" height="9" rx="1.6"/>' + '<rect x="11.6" y="11.6" width="9" height="9" rx="1.6" stroke-dasharray="3 2"/>' + P('M12.4 12.4 11.6 11.6')),
  grid:       st(P('M3.4 3.4h17.2v17.2H3.4z M3.4 9h17.2M3.4 15h17.2M9 3.4v17.2M15 3.4v17.2')),
  particle:   st('<circle cx="7" cy="8" r="1.6"/><circle cx="12" cy="6.4" r="1.2"/><circle cx="17" cy="8.6" r="1.4"/><circle cx="9.4" cy="13" r="1.2"/><circle cx="14.6" cy="13.6" r="1.6"/><circle cx="12" cy="18" r="1.2"/>'),
  keyframe:   F('<path d="M12 3.4 20.6 12 12 20.6 3.4 12z"/>'),
  layer:      st(P('M12 3.4 21 8.4l-9 5-9-5z') + P('M4 12.4l8 4.4 8-4.4') + P('M4 16.2l8 4.4 8-4.4')),
  mask:       st('<rect x="3.4" y="4" width="17.2" height="16" rx="2.4"/>' + '<circle cx="10" cy="12" r="4.6" fill="currentColor" stroke="none"/>'),
  physics:    st('<circle cx="7.6" cy="8.4" r="2.6"/>' + P('M9.6 10.4 14.4 5.6') + '<circle cx="17" cy="17" r="3.4"/>' + P('M11.6 14.4 14 12')),
  ragdoll:    st('<circle cx="12" cy="5" r="2.4"/>' + P('M12 7.4v6M12 9.4 8 12M12 9.4 16 12M12 13.4 9.4 19M12 13.4 14.6 19')),

  /*──────────────────────────────────────── tyres, wheels, vehicles ────────────────────────────*/
  tyre:       st('<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.2"/>' + P('M12 3.4v4.4M12 16.2v4.4M3.4 12h4.4M16.2 12h4.4M6 6l3.1 3.1M14.9 14.9 18 18M18 6l-3.1 3.1M9.1 14.9 6 18')),
  tyreTread:  st('<circle cx="12" cy="12" r="8.4" stroke-dasharray="3.1 1.5"/>' + '<circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  carcass:    st('<circle cx="12" cy="12" r="8.4"/>' + '<circle cx="12" cy="12" r="5.6" stroke-dasharray="1.8 1.6"/>' + '<circle cx="12" cy="12" r="2.6"/>'),
  rim:        st('<circle cx="12" cy="12" r="8.4"/>' + '<circle cx="12" cy="12" r="3.4"/>' + P('M12 8.6 13.6 5M15.4 12l3.4-1M12 15.4l-1.6 3M8.6 12 5.2 13')),
  wheel:      st('<circle cx="9.6" cy="13.4" r="5.6"/>' + '<circle cx="9.6" cy="13.4" r="2.4"/>' + P('M9.6 7.8v3.2M9.6 16.6v3.2M4 13.4h3.2M12 13.4h3.2') + P('M13.6 8.4h4.6L21 12.6')),
  suspension: st(P('M8 3v3M8 18v3') + P('M8 6l3 2-3 2 3 2-3 2 3 2') + '<circle cx="16.6" cy="17.6" r="3.4"/>'),
  brakeDisc:  st('<circle cx="12" cy="12" r="8.4" stroke-dasharray="2.4 1.4"/><circle cx="12" cy="12" r="3.6"/>'),
  car:        st(P('M3 14.6l1.8-5.2A2 2 0 0 1 6.7 8h10.6a2 2 0 0 1 1.9 1.4l1.8 5.2v4H3z') + '<circle cx="7.4" cy="18.6" r="1.9"/><circle cx="16.6" cy="18.6" r="1.9"/>' + P('M4.4 14.6h15.2')),
  carBody:    st(P('M2.6 15.4 4.6 9a2.2 2.2 0 0 1 2-1.4h10.8a2.2 2.2 0 0 1 2 1.4l2 6.4v3.2H2.6z') + P('M6.4 12.4h11.2') + P('M9 7.6 8 12.4M15 7.6l1 4.8')),
  chassis:    st('<rect x="3.4" y="9.4" width="17.2" height="5.2" rx="1.4"/>' + P('M6 14.6v3M18 14.6v3M6 6.4v3M18 6.4v3M12 9.4V6.4')),
  engine:     st('<rect x="4.6" y="8.4" width="12" height="8" rx="1.6"/>' + P('M16.6 10.4h2.8v4h-2.8M7.6 8.4V6h6v2.4M7.6 16.4v2h6v-2')),
  gearbox:    st('<circle cx="12" cy="12" r="2.8"/>' + P('M12 3.4v5.8M12 14.8v5.8M3.4 12h5.8M14.8 12h5.8') + '<circle cx="12" cy="12" r="8.4" stroke-dasharray="2.4 1.6"/>'),
  vehicle:    st(P('M2.6 13.4 4 7.6A2 2 0 0 1 6 6h12a2 2 0 0 1 2 1.6l1.4 5.8') + P('M2.6 13.4h18.8v4.2H2.6z') + '<circle cx="7" cy="19.4" r="1.8"/><circle cx="17" cy="19.4" r="1.8"/>' + P('M8 9.6h8')),
  truck:      st('<rect x="2.6" y="8.4" width="10" height="7.6"/>' + P('M12.6 10.4h3.6l3.2 3.2v2.4h-6.8z') + '<circle cx="6.4" cy="18.4" r="1.8"/><circle cx="16.4" cy="18.4" r="1.8"/>'),
  bike:       st('<circle cx="6" cy="16.4" r="3.6"/><circle cx="18" cy="16.4" r="3.6"/>' + P('M6 16.4 10.6 8h3.6') + P('M9.4 16.4h6.2') + P('M14.2 8h3.8l1.6 8.4')),

  /*──────────────────────────────────────── cloth, soft bodies ──────────────────────────────────*/
  cloth:      st('<path d="M3.4 7.4c2.8 1.6 5.6-1.6 8.4 0s5.6-1.6 8.4 0"/>' + '<path d="M3.4 7.4v9.2c2.8 1.6 5.6-1.6 8.4 0 2.8 1.6 5.6-1.6 8.4 0V7.4"/>' + P('M7.6 8.6v9M12 9.2v9.4M16.4 8.6v9')),
  clothWeave: st('<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2"/>' + P('M3.4 9h17.2M3.4 15h17.2') + P('M9 3.4v17.2M15 3.4v17.2')),
  rope:       st('<path d="M3.4 9c3 0 3 6 6 6s3-6 6-6 3 6 6 6"/>' + '<path d="M3.4 12c3 0 3 6 6 6s3-6 6-6 3 6 6 6" opacity=".5"/>'),
  softbody:   st('<circle cx="12" cy="12" r="8.4" stroke-dasharray="3 2"/>' + '<path d="M7.6 14.4c1.6-4 7.2-4 8.8 0"/>' + '<circle cx="12" cy="9.4" r="1.6" fill="currentColor" stroke="none"/>'),
  flag:       st(P('M6 21V3') + '<path d="M6 4h12l-2.4 3.6L18 11H6z"/>'),
  deform:     st('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2"/>' + P('M4 12h4l2-4 3 8 2-4h5')),

  /*──────────────────────────────────────── pieces from the proof sheets ──────────────────────────*/
  globeWire:  st('<circle cx="12" cy="12" r="8.4"/>' + P('M3.6 12h16.8M12 3.6c3 3 3 13.8 0 16.8M12 3.6c-3 3-3 13.8 0 16.8')),
  shadow:     st('<circle cx="12" cy="10" r="5.4"/>' + '<ellipse cx="12" cy="18.4" rx="6.4" ry="2.2" fill="currentColor" stroke="none" opacity=".35"/>'),
  bounce:     st('<circle cx="8.4" cy="15.6" r="4"/><circle cx="8.4" cy="15.6" r="1.4" fill="currentColor" stroke="none"/>' + P('M12.4 12.4 18 6.4M14.6 6.4H18v3.4')),
  collide:    st('<circle cx="9.4" cy="9.4" r="5.4"/>' + '<path d="M13.4 14.6a5.4 5.4 0 1 1 6-6" stroke-dasharray="2.4 1.6"/>'),
  orbit:      st('<ellipse cx="12" cy="12" rx="9" ry="5" transform="rotate(-24 12 12)"/><circle cx="12" cy="12" r="3"/>' + '<circle cx="19.6" cy="8.4" r="1.6" fill="currentColor" stroke="none"/>'),
  galaxy:     st('<ellipse cx="12" cy="12" rx="9.4" ry="3.4" transform="rotate(-28 12 12)"/><circle cx="12" cy="12" r="2.6"/>' + '<circle cx="5.6" cy="16.4" r="1.2" fill="currentColor" stroke="none"/>'),
  layers:     st(P('M12 3.6 3 8.2l9 4.6 9-4.6z') + P('M3 12.4l9 4.6 9-4.6') + P('M3 16.6l9 4.6 9-4.6')),
  palette:    st('<path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.4 0 2-.9 2-1.9s-.6-1.8-.6-2.4.5-1.1 1.3-1.1h1.9a5.4 5.4 0 0 0 5.4-5.4c0-3.5-4.3-6.4-10-6.4z"/>' + '<circle cx="8.4" cy="11" r="1.3" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8.4" r="1.3" fill="currentColor" stroke="none"/>')
  };
})();

/** icon(name, size, colour) — an inline SVG string, sized and tinted. */
function icon(name, size = 16, colour = 'currentColor') {
  const body = ICONS[name] || ICONS.dot;
  return body.replace('<svg ', `<svg width="${size}" height="${size}" style="color:${colour}" `);
}

/* the page's other scripts read these by name */
window.ICONS = ICONS;
window.icon = icon;
