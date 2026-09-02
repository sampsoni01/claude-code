import type { SimulationState, Id } from './types';

/**
 * Stable, deterministic ids. Ids are derived from a per-prefix monotonic
 * counter stored in state so save/load never renumbers anything.
 */
export function nextId(state: SimulationState, prefix: string): Id {
  const n = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = n;
  return `${prefix}_${n.toString(36).padStart(4, '0')}`;
}
