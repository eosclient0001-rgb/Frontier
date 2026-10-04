// DecalLibrary.js
// Vector SVG Decals for sci-fi, industrial, military, and cyberpunk texture painting

export const SVG_DECALS = [
  {
    id: "hazard_stripes",
    name: "Hazard Stripes",
    category: "warning",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="stripes" width="40" height="40" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="20" height="40" fill="#ffcc00"/>
          <rect x="20" width="20" height="40" fill="#111111"/>
        </pattern>
      </defs>
      <rect width="200" height="200" rx="16" fill="url(#stripes)"/>
      <rect x="6" y="6" width="188" height="188" rx="12" fill="none" stroke="#111111" stroke-width="8"/>
    </svg>`
  },
  {
    id: "biohazard",
    name: "Biohazard",
    category: "warning",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="100" r="92" fill="#111111"/>
      <g fill="#ff9900">
        <path d="M100 24c-14 0-26 7-34 18 10 7 17 19 19 32 5-2 10-3 15-3s10 1 15 3c2-13 9-25 19-32-8-11-20-18-34-18zm-42 68c-12 7-20 19-22 34 11 5 24 3 34-4 2 5 5 10 9 14-8 10-12 24-9 37 13-3 24-11 31-22 7 11 18 19 31 22 3-13-1-27-9-37 4-4 7-9 9-14 10 7 23 9 34 4-2-15-10-27-22-34-3 12-11 22-22 26-6-8-15-13-26-14-11 1-20 6-26 14-11-4-19-14-22-26zm27-22c-8 6-13 16-15 26 10-3 18-9 24-18-3-3-6-5-9-8zm30 0c-3 3-6 5-9 8 6 9 14 15 24 18-2-10-7-20-15-26z"/>
        <circle cx="100" cy="100" r="14"/>
      </g>
    </svg>`
  },
  {
    id: "radiation",
    name: "Radiation Trefoil",
    category: "warning",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="100" r="92" fill="#ffcc00"/>
      <g fill="#111111">
        <circle cx="100" cy="100" r="22"/>
        <path d="M100 70 A30 30 0 0 1 100 70 L80 18 A90 90 0 0 1 120 18 Z"/>
        <path d="M74 115 L28 142 A90 90 0 0 1 8 107 L60 100 Z" transform="rotate(120 100 100)"/>
        <path d="M74 115 L28 142 A90 90 0 0 1 8 107 L60 100 Z" transform="rotate(240 100 100)"/>
        <circle cx="100" cy="100" r="10" fill="#ffcc00"/>
      </g>
    </svg>`
  },
  {
    id: "cyber_skull",
    name: "Cyber Skull",
    category: "cyber",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" rx="20" fill="#0c0d12"/>
      <path d="M50 80c0-30 22-54 50-54s50 24 50 54c0 18-8 32-18 42v28h-16v18h-8v-18h-16v18h-8v-18H68v-28C58 112 50 98 50 80z" fill="#00f0ff"/>
      <!-- Eyes & nose cavities -->
      <circle cx="78" cy="84" r="14" fill="#0c0d12"/>
      <circle cx="122" cy="84" r="14" fill="#0c0d12"/>
      <polygon points="100,102 93,116 107,116" fill="#0c0d12"/>
      <!-- Tech circuit traces -->
      <path d="M30 40h30v20M170 40h-30v20M25 160h40M175 160h-40M100 10v16" stroke="#ff0055" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="30" cy="40" r="4" fill="#ff0055"/>
      <circle cx="170" cy="40" r="4" fill="#ff0055"/>
      <circle cx="25" cy="160" r="4" fill="#ff0055"/>
      <circle cx="175" cy="160" r="4" fill="#ff0055"/>
    </svg>`
  },
  {
    id: "crosshair",
    name: "Target Reticle",
    category: "military",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="100" r="80" fill="none" stroke="#ff3333" stroke-width="4"/>
      <circle cx="100" cy="100" r="50" fill="none" stroke="#ff3333" stroke-width="2" stroke-dasharray="10 6"/>
      <circle cx="100" cy="100" r="6" fill="#ff3333"/>
      <line x1="100" y1="10" x2="100" y2="40" stroke="#ff3333" stroke-width="4"/>
      <line x1="100" y1="160" x2="100" y2="190" stroke="#ff3333" stroke-width="4"/>
      <line x1="10" y1="100" x2="40" y2="100" stroke="#ff3333" stroke-width="4"/>
      <line x1="160" y1="100" x2="190" y2="100" stroke="#ff3333" stroke-width="4"/>
      <path d="M40 40l10 10M160 40l-10 10M40 160l10-10M160 160l-10-10" stroke="#ff3333" stroke-width="3"/>
    </svg>`
  },
  {
    id: "military_star",
    name: "Airforce Star",
    category: "military",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="100" r="88" fill="#0b2240" stroke="#ffffff" stroke-width="8"/>
      <rect x="10" y="85" width="180" height="30" fill="#ffffff"/>
      <rect x="10" y="93" width="180" height="14" fill="#d92525"/>
      <polygon points="100,28 122,85 182,85 134,120 152,176 100,142 48,176 66,120 18,85 78,85" fill="#ffffff"/>
      <circle cx="100" cy="100" r="88" fill="none" stroke="#0b2240" stroke-width="4"/>
    </svg>`
  },
  {
    id: "barcode",
    name: "Tech Barcode & Serial",
    category: "industrial",
    svg: `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="120" rx="8" fill="#ffffff"/>
      <g fill="#000000">
        <rect x="20" y="15" width="6" height="70"/>
        <rect x="30" y="15" width="3" height="70"/>
        <rect x="37" y="15" width="8" height="70"/>
        <rect x="49" y="15" width="4" height="70"/>
        <rect x="57" y="15" width="10" height="70"/>
        <rect x="71" y="15" width="3" height="70"/>
        <rect x="78" y="15" width="6" height="70"/>
        <rect x="88" y="15" width="12" height="70"/>
        <rect x="104" y="15" width="4" height="70"/>
        <rect x="112" y="15" width="8" height="70"/>
        <rect x="124" y="15" width="3" height="70"/>
        <rect x="131" y="15" width="10" height="70"/>
        <rect x="145" y="15" width="4" height="70"/>
        <rect x="153" y="15" width="8" height="70"/>
        <rect x="165" y="15" width="5" height="70"/>
        <rect x="174" y="15" width="6" height="70"/>
      </g>
      <text x="100" y="105" font-family="monospace" font-size="14" font-weight="bold" fill="#000" text-anchor="middle" letter-spacing="4">NX-8049-F</text>
    </svg>`
  },
  {
    id: "caution_triangle",
    name: "High Voltage Bolt",
    category: "warning",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <polygon points="100,16 190,176 10,176" fill="#ffcc00" stroke="#111111" stroke-width="12" stroke-linejoin="round"/>
      <polygon points="105,48 76,108 108,108 85,160 135,96 105,96" fill="#111111"/>
    </svg>`
  },
  {
    id: "hex_circuit",
    name: "Hex Cyber Core",
    category: "cyber",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <polygon points="100,20 170,60 170,140 100,180 30,140 30,60" fill="none" stroke="#00e5ff" stroke-width="6"/>
      <polygon points="100,42 150,71 150,129 100,158 50,129 50,71" fill="none" stroke="#00e5ff" stroke-width="2" stroke-dasharray="6 4"/>
      <circle cx="100" cy="100" r="28" fill="#00e5ff" opacity="0.3"/>
      <circle cx="100" cy="100" r="16" fill="#00e5ff"/>
      <line x1="100" y1="20" x2="100" y2="42" stroke="#00e5ff" stroke-width="4"/>
      <line x1="170" y1="60" x2="150" y2="71" stroke="#00e5ff" stroke-width="4"/>
      <line x1="170" y1="140" x2="150" y2="129" stroke="#00e5ff" stroke-width="4"/>
      <line x1="100" y1="180" x2="100" y2="158" stroke="#00e5ff" stroke-width="4"/>
      <line x1="30" y1="140" x2="50" y2="129" stroke="#00e5ff" stroke-width="4"/>
      <line x1="30" y1="60" x2="50" y2="71" stroke="#00e5ff" stroke-width="4"/>
    </svg>`
  },
  {
    id: "flight_arrow",
    name: "Directional Arrow",
    category: "industrial",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" rx="16" fill="#111111"/>
      <polygon points="100,30 170,110 135,110 135,170 65,170 65,110 30,110" fill="#ffffff"/>
      <path d="M50 176h100" stroke="#ff9900" stroke-width="8" stroke-linecap="round"/>
    </svg>`
  },
  {
    id: "falcon_crest",
    name: "Frontier Crest",
    category: "military",
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <path d="M100 20 L180 50 L180 120 C180 160 100 190 100 190 C100 190 20 160 20 120 L20 50 Z" fill="#1a1c23" stroke="#e0e0e0" stroke-width="6"/>
      <path d="M100 45 L155 75 L145 130 C135 155 100 170 100 170 C100 170 65 155 55 130 L45 75 Z" fill="#3b82f6"/>
      <polygon points="100,60 112,85 140,88 118,106 125,134 100,118 75,134 82,106 60,88 88,85" fill="#ffffff"/>
    </svg>`
  },
  {
    id: "exhaust_warning",
    name: "Hot Exhaust Warning",
    category: "warning",
    svg: `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="120" rx="10" fill="#cc1111" stroke="#ffffff" stroke-width="4"/>
      <rect x="8" y="8" width="184" height="104" rx="6" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="8 4"/>
      <text x="100" y="44" font-family="sans-serif" font-size="16" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="2">DANGER</text>
      <text x="100" y="70" font-family="sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="1">HOT JET EXHAUST</text>
      <text x="100" y="92" font-family="monospace" font-size="10" fill="#ffcccc" text-anchor="middle">KEEP CLEAR 50FT</text>
    </svg>`
  }
];
