import type { SimulationState } from './types';

/**
 * Deterministic PRNG (mulberry32). State lives in the simulation so that
 * advancing time from the same saved state always produces the same result.
 */
export function nextRandom(state: SimulationState): number {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Standard normal via Box-Muller. */
export function nextNormal(state: SimulationState): number {
  let u = 0, v = 0;
  while (u === 0) u = nextRandom(state);
  while (v === 0) v = nextRandom(state);
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function pick<T>(state: SimulationState, items: T[]): T {
  return items[Math.floor(nextRandom(state) * items.length)];
}
