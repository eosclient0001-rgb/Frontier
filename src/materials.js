// Material presets: simulation behavior + optical (shader) properties.
// flip: FLIP/PIC blend (1 = energetic splashy, low = viscous damped)
export const MATERIALS = {
  water: {
    flip: 0.97, dry: 0.35, name: 'Water', density: 1000,
    visc: 0.02, viscIters: 1, cohesion: 0.04, adhesion: 0.6, friction: 0.03, yieldV: 0, foam: 1,
    render: { absorb: [1.6, 0.42, 0.22], scatter: 0.0, albedo: [0.1, 0.3, 0.4], rough: 0.04, f0: 0.02, refract: 1.0, wrap: 0.0, sss: [0, 0, 0], grain: 0, env: 1.0 },
  },
  milk: {
    flip: 0.92, dry: 0.12, name: 'Milk', density: 1030,
    visc: 0.08, viscIters: 1, cohesion: 0.06, adhesion: 1.5, friction: 0.12, yieldV: 0, foam: 0.35,
    render: { absorb: [0.2, 0.22, 0.3], scatter: 60, albedo: [0.93, 0.92, 0.88], rough: 0.12, f0: 0.025, refract: 0.2, wrap: 0.6, sss: [1.0, 0.95, 0.85], grain: 0, env: 0.7 },
  },
  chocolate: {
    flip: 0.55, dry: 0.015, name: 'Chocolate', density: 1300,
    visc: 0.75, viscIters: 4, cohesion: 0.22, adhesion: 7, friction: 0.6, yieldV: 0.02, foam: 0,
    render: { absorb: [8, 10, 12], scatter: 120, albedo: [0.2, 0.085, 0.035], rough: 0.18, f0: 0.04, refract: 0.0, wrap: 0.3, sss: [0.5, 0.15, 0.04], grain: 0, env: 0.9 },
  },
  honey: {
    flip: 0.25, dry: 0.006, name: 'Honey', density: 1420,
    visc: 0.95, viscIters: 10, cohesion: 0.3, adhesion: 9, friction: 0.88, yieldV: 0.0, foam: 0,
    render: { absorb: [0.35, 1.5, 6.0], scatter: 0.0, albedo: [0.8, 0.45, 0.05], rough: 0.06, f0: 0.045, refract: 1.4, wrap: 0.0, sss: [1.0, 0.55, 0.1], grain: 0, env: 1.0 },
  },
  mud: {
    flip: 0.35, dry: 0.01, name: 'Mud', density: 1700,
    visc: 0.85, viscIters: 5, cohesion: 0.28, adhesion: 11, friction: 0.92, yieldV: 0.12, foam: 0,
    render: { absorb: [10, 12, 14], scatter: 200, albedo: [0.24, 0.17, 0.11], rough: 0.55, f0: 0.03, refract: 0.0, wrap: 0.2, sss: [0.2, 0.12, 0.06], grain: 1, env: 0.35 },
  },
};

