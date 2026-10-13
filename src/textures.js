import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Asphalt with 3 lanes. UV.x runs across the track, UV.y along it (repeats every 12 m).
export const trackTexture = canvas(512, 512, (g, w, h) => {
  g.fillStyle = '#33373c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.16)';
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.fillStyle = '#f3f4f2';
  g.fillRect(14, 0, 7, h); g.fillRect(w - 21, 0, 7, h);          // solid edge lines
  g.fillStyle = 'rgba(240,240,235,0.85)';
  for (const x of [w / 3, (2 * w) / 3]) for (let y = 0; y < h; y += 128) g.fillRect(x - 3, y, 6, 62); // dashes
  g.fillStyle = 'rgba(255,122,26,0.9)';
  g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);             // orange Wipeout-style edge accent
});

export const buildingTexture = canvas(256, 512, (g, w, h) => {
  g.fillStyle = '#dfe3e6'; g.fillRect(0, 0, w, h);
  for (let y = 12; y < h - 8; y += 26) for (let x = 10; x < w - 8; x += 24) {
    const lit = Math.random();
    g.fillStyle = lit > 0.82 ? '#ffd98a' : (Math.random() > 0.5 ? '#8fb2c9' : '#6f8ea3');
    g.fillRect(x, y, 16, 17);
  }
  g.fillStyle = 'rgba(70,80,88,0.55)'; g.fillRect(0, 0, w, 8);
});

export const cityTexture = canvas(512, 512, (g, w, h) => {
  g.fillStyle = '#9aa0a3'; g.fillRect(0, 0, w, h);                 // pavement blocks
  for (let i = 0; i < 2600; i++) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  g.fillStyle = '#4a4e52';                                          // roads around each city block
  g.fillRect(0, 0, w, 54); g.fillRect(0, h - 54, w, 54); g.fillRect(0, 0, 54, h); g.fillRect(w - 54, 0, 54, h);
  g.fillStyle = '#e8e8e2';
  for (let x = 0; x < w; x += 42) { g.fillRect(x, 24, 22, 4); g.fillRect(x, h - 28, 22, 4); }
  for (let y = 0; y < h; y += 42) { g.fillRect(24, y, 4, 22); g.fillRect(w - 28, y, 4, 22); }
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 3;
  g.strokeRect(57, 57, w - 114, h - 114);                           // kerb line
});

export const padTexture = canvas(256, 256, (g, w, h) => {
  g.fillStyle = '#20262b'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ff7a1a';
  for (let i = 0; i < 3; i++) {
    const y = 28 + i * 74;
    g.beginPath(); g.moveTo(38, y + 44); g.lineTo(w / 2, y); g.lineTo(w - 38, y + 44); g.lineTo(w - 38, y + 66); g.lineTo(w / 2, y + 24); g.lineTo(38, y + 66); g.fill();
  }
  g.strokeStyle = '#ffb37a'; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8);
});

export function signTexture(title, sub, arrow) {
  return canvas(512, 256, (g, w, h) => {
    g.fillStyle = '#1d2731'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff7a1a'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#ffffff'; g.font = 'bold 64px Arial'; g.textAlign = 'center';
    g.fillText(title, w / 2, 96);
    g.fillStyle = '#ffb37a'; g.font = 'bold 40px Arial';
    g.fillText(sub, w / 2, 156);
    g.fillStyle = '#ffffff'; g.font = 'bold 74px Arial';
    g.fillText(arrow, w / 2, 232);
  });
}
