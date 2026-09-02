import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SimulationState } from '../engine';
import { saveToLocal, loadFromLocal, reconcile } from '../engine';

/**
 * Tiny store: the engine returns new immutable states; the UI keeps an undo
 * stack of prior states and autosaves to localStorage. All financial logic
 * stays in the engine; this only holds state and forwards operations.
 */
export interface Toast { id: number; text: string; kind: 'ok' | 'err' }

export function useSimStore() {
  const [state, setStateRaw] = useState<SimulationState | null>(() => {
    try { return loadFromLocal(); } catch { return null; }
  });
  const undo = useRef<SimulationState[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);

  /** Applies an engine operation that returns a new state. Errors roll back automatically (engine ops are atomic). */
  const apply = useCallback((fn: (s: SimulationState) => SimulationState, label?: string): boolean => {
    if (!state) return false;
    try {
      const next = fn(state);
      const rec = reconcile(next);
      if (!rec.ok) { toast(`Reconciliation failed after "${label ?? 'operation'}": ${rec.issues[0]}. Change rejected.`, 'err'); console.error(rec.issues); return false; }
      undo.current = [...undo.current.slice(-19), state];
      setStateRaw(next);
      if (label) toast(label);
      return true;
    } catch (e: any) {
      toast(e?.message ?? String(e), 'err');
      return false;
    }
  }, [state, toast]);

  /** Applies an in-place mutation on a cloned state (for small edits like overrides). */
  const mutate = useCallback((fn: (draft: SimulationState) => void, label?: string): boolean => {
    return apply((s) => { const d = structuredClone(s); fn(d); return d; }, label);
  }, [apply]);

  const undoLast = useCallback(() => {
    const prev = undo.current.pop();
    if (prev) { setStateRaw(prev); toast('Undid last change'); }
  }, [toast]);

  const replace = useCallback((s: SimulationState | null) => { undo.current = []; setStateRaw(s); }, []);

  useEffect(() => { if (state) { try { saveToLocal(state); } catch (e) { console.error(e); } } }, [state]);

  return useMemo(() => ({ state, apply, mutate, undoLast, replace, toasts, toast, canUndo: undo.current.length > 0 }), [state, apply, mutate, undoLast, replace, toasts, toast]);
}

export type Store = ReturnType<typeof useSimStore>;
