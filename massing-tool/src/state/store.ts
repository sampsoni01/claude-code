// Single source of truth: the building, the selection, and undo/redo.
// All mutation goes through here so the view and panel stay in sync.
import type { Building, LevelRef, SaveFile } from '../model/types';

const AUTOSAVE_KEY = 'massing-tool.autosave.v1';
const HISTORY_LIMIT = 200;

type Listener = () => void;

export class Store {
  building: Building | null = null;
  selected: LevelRef | null = null;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
  }

  notify(): void {
    this.autosave();
    for (const fn of this.listeners) fn();
  }

  private snap(): string {
    return JSON.stringify(this.building);
  }

  // Run a mutation with history. `fn` returns false to signal "nothing
  // changed / operation failed" (no history entry, no notify).
  withHistory(fn: () => boolean): boolean {
    const before = this.snap();
    let changed = false;
    try {
      changed = fn();
    } finally {
      if (changed) {
        this.pushUndo(before);
        this.notify();
      }
    }
    return changed;
  }

  // Live preview during a drag: replace the model without touching history.
  preview(b: Building): void {
    this.building = b;
    this.clampSelection();
    this.notify();
  }

  // End of a drag: `baseJson` is the pre-drag state captured at drag start.
  commitPreview(baseJson: string): void {
    if (this.snap() !== baseJson) {
      this.pushUndo(baseJson);
    }
    this.notify();
  }

  private pushUndo(json: string): void {
    this.undoStack.push(json);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    const json = this.undoStack.pop();
    if (json === undefined) return;
    this.redoStack.push(this.snap());
    this.building = JSON.parse(json) as Building | null;
    this.clampSelection();
    this.notify();
  }

  redo(): void {
    const json = this.redoStack.pop();
    if (json === undefined) return;
    this.undoStack.push(this.snap());
    this.building = JSON.parse(json) as Building | null;
    this.clampSelection();
    this.notify();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  select(ref: LevelRef | null): void {
    this.selected = ref;
    this.notify();
  }

  // Keep the selection valid across structural changes (splits, undo, ...).
  clampSelection(): void {
    if (!this.selected || !this.building) {
      this.selected = null;
      return;
    }
    const { plateIndex, levelInPlate } = this.selected;
    const plate = this.building.stack[plateIndex];
    if (!plate || levelInPlate >= plate.floorCount) this.selected = null;
  }

  serialize(): SaveFile | null {
    return this.building ? { version: 1, building: this.building } : null;
  }

  loadSaveFile(file: SaveFile): void {
    this.withHistory(() => {
      this.building = file.building;
      this.selected = null;
      return true;
    });
  }

  private autosave(): void {
    try {
      const s = this.serialize();
      if (s) localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(s));
      else localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // storage full or unavailable; autosave is best-effort
    }
  }

  restoreAutosave(): boolean {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const file = JSON.parse(raw) as SaveFile;
      if (file?.version !== 1 || !file.building?.stack?.length) return false;
      this.building = file.building;
      return true;
    } catch {
      return false;
    }
  }
}
