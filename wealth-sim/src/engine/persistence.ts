import type { SimulationState } from './types';
import { SCHEMA_VERSION } from './state';
import { ValidationError } from './errors';

export interface SaveFile { app: 'wealth-sim'; schemaVersion: number; savedAt: string; state: SimulationState }

export function serialize(state: SimulationState): string {
  const file: SaveFile = { app: 'wealth-sim', schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), state };
  return JSON.stringify(file);
}

export function deserialize(json: string): SimulationState {
  let parsed: SaveFile;
  try { parsed = JSON.parse(json); } catch { throw new ValidationError('Save file is not valid JSON'); }
  if (!parsed || parsed.app !== 'wealth-sim' || !parsed.state) throw new ValidationError('Not a wealth-sim save file');
  const state = migrate(parsed.state, parsed.schemaVersion);
  const required = ['accounts', 'assets', 'liabilities', 'recurring', 'ledger', 'settings', 'counters'];
  for (const k of required) if (!(k in state)) throw new ValidationError(`Save file missing "${k}"`);
  return state;
}

/** Forward migrations. Existing ids/assets are never regenerated. */
function migrate(state: SimulationState, from: number): SimulationState {
  let s = state;
  if (from < 1) s = { ...s, schemaVersion: 1 };
  // future: if (from < 2) { ... }
  s.schemaVersion = SCHEMA_VERSION;
  s.staff ??= {}; s.storage ??= {}; s.projects ??= {}; s.events ??= {}; s.valuations ??= []; s.timeline ??= []; s.history ??= []; s.assistantHistory ??= []; s.proposals ??= {}; s.idempotencyKeys ??= {};
  return s;
}

const KEY = 'wealth-sim:save';
const LIST_KEY = 'wealth-sim:saves';

export function saveToLocal(state: SimulationState, slot = 'default'): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`${KEY}:${slot}`, serialize(state));
  const list = listLocalSaves();
  if (!list.includes(slot)) localStorage.setItem(LIST_KEY, JSON.stringify([...list, slot]));
}

export function loadFromLocal(slot = 'default'): SimulationState | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(`${KEY}:${slot}`);
  return raw ? deserialize(raw) : null;
}

export function listLocalSaves(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]'); } catch { return []; }
}

export function deleteLocalSave(slot: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(`${KEY}:${slot}`);
  localStorage.setItem(LIST_KEY, JSON.stringify(listLocalSaves().filter((s) => s !== slot)));
}
