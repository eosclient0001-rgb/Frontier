// Deterministic seeded random numbers (mulberry32). Same seed => same infinite track.
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range(lo, hi) {
      return lo + (hi - lo) * next();
    },
    int(lo, hi) {
      return Math.floor(lo + (hi - lo + 1) * next());
    },
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length) % arr.length];
    },
    /** weighted pick from an object { key: weight } */
    weighted(weights) {
      let total = 0;
      for (const k in weights) total += weights[k];
      let r = next() * total;
      for (const k in weights) {
        r -= weights[k];
        if (r <= 0) return k;
      }
      return Object.keys(weights)[0];
    },
  };
}

/** Cheap string -> 32-bit hash (FNV-1a) for per-section deterministic decoration. */
export function hashInt(...vals) {
  let h = 2166136261;
  for (const v of vals) {
    const n = Math.round(v * 1000) | 0;
    h ^= n;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
