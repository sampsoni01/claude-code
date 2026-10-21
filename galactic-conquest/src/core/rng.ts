/**
 * Seeded random numbers. Every simulation feature draws from one of these so a
 * campaign, a battle, or a galaxy can be replayed exactly from its seed.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], both ends included. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Index chosen by weight. Weights must be non-negative and not all zero. */
  weighted(weights: readonly number[]): number;
  /** Shuffles a copy of the array. */
  shuffle<T>(items: readonly T[]): T[];
  /** A fresh generator derived from this one, for a named sub-stream. */
  fork(label: string): Rng;
}

/** cyrb128: hashes a string to four 32-bit words. */
function hashSeed(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32: small, fast, good statistical quality, deterministic across engines. */
export function makeRng(seed: string): Rng {
  let [a, b, c, d] = hashSeed(seed);
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Warm up so similar seeds diverge quickly.
  for (let i = 0; i < 12; i++) next();

  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] ?? 0;
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = t;
      }
      return out;
    },
    fork: (label) => makeRng(`${seed}/${label}`),
  };
  return rng;
}

/** A short random seed string for a new galaxy, from Math.random (outside the sim). */
export function randomSeed(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
