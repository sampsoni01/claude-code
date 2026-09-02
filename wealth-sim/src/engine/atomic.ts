import type { SimulationState } from './types';

/**
 * Runs `fn` against a deep copy of the state. If it throws, the original state
 * is untouched (rollback). If it succeeds, the modified copy is returned.
 *
 * All public engine operations go through this so a multi-step purchase can
 * never leave a half-created asset, loan or ledger entry behind.
 */
export function atomic<R>(state: SimulationState, fn: (draft: SimulationState) => R): { state: SimulationState; result: R } {
  const draft = cloneState(state);
  const result = fn(draft);
  return { state: draft, result };
}

export function cloneState(state: SimulationState): SimulationState {
  return structuredClone(state);
}
