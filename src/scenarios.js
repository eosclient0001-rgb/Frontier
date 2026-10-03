export const QUALITY = { low: 0.06, med: 0.05, high: 0.042 };

export const SCENARIOS = {
  dambreak: { name: 'Dam Break', size: [3, 1.8, 1.2], setup(s) {
    s.addBlock([0, 0, 0], [1.0, 1.2, 1.2]);
    s.boxes.push({ c: [2.0, 0.2, 0.6], h: [0.12, 0.2, 0.25] });
  } },
  ocean: { name: 'Ocean Break', size: [3.4, 1.6, 1.0], setup(s) {
    s.piston = { amp: 0.45, period: 2.6, x: 0.02, vx: 0 };
    s.ramp = { x0: 1.6, slope: 0.32 };
    s.addBlock([0.03, 0, 0], [3.4, 0.5, 1.0]);
    s.addSphere([1.2, 0.7, 0.5], 0.09, 500);
    s.addSphere([2.2, 0.8, 0.3], 0.07, 450);
  } },
  splash: { name: 'Splash', size: [2.4, 2.0, 1.4], setup(s) {
    s.addBlock([0, 0, 0], [2.4, 0.3, 1.4]);
    s.addBlock([0.85, 1.0, 0.45], [1.55, 1.6, 0.95]);
    s.addSphere([0.5, 1.5, 0.4], 0.12, 3000, [1, 0, 0.5]);
    s.addSphere([1.9, 1.7, 1.0], 0.1, 700, [-1, 0, -0.3]);
  } },
  pour: { name: 'Pour & Stick', size: [2.0, 2.0, 1.2], setup(s) {
    s.boxes.push({ c: [0.75, 0.45, 0.6], h: [0.22, 0.06, 0.3] });
    s.addSphere([1.2, 0.85, 0.6], 0.18, 1000, [0, 0, 0], true);
    s.emitter = { pos: [0.95, 1.75, 0.6], dir: [0, -1, 0], speed: 2.0, radius: 0.12, acc: 0, until: 9 };
  } },
  mix: { name: 'Mix (A + B)', size: [2.2, 1.8, 1.2], defaults: ['chocolate', 'milk'], setup(s) {
    s.addBlock([0, 0, 0], [2.2, 0.32, 1.2]);
    s.emitters.push({ pos: [0.7, 1.6, 0.6], dir: [0, -1, 0], speed: 2.2, radius: 0.11, acc: 0, until: 6, conc: 1 });
    s.addSphere([1.6, 1.0, 0.6], 0.1, 600);
  } },
  objects: { name: 'Objects', size: [2.4, 2.0, 1.4], setup(s) {
    s.addBlock([0, 0, 0], [2.4, 0.5, 1.4]);
    const dens = [300, 700, 1200, 2500, 7800];
    dens.forEach((d, i) => s.addSphere([0.35 + i * 0.42, 1.2 + i * 0.12, 0.5 + (i % 2) * 0.4], 0.08 + (i % 3) * 0.025, d));
  } },
};
