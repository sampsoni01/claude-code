// Operations on the plate stack. Everything here is pure data manipulation;
// the 3D view rebuilds from the model after each change.
import type { Building, LevelRef, Plate, Polygon2D, Vec2 } from './types';
import { ensureCCW, offsetPolygon, polygonArea } from '../geometry/polygon';

export const DEFAULT_FLOOR_HEIGHT = 10; // ft
export const MIN_FLOOR_HEIGHT = 6; // ft

let idCounter = 0;
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

const PLATE_COLORS = ['#8fb4c9', '#a3c1a3', '#c9b48f', '#b49fc9', '#c99f9f', '#9fc9c2'];

export function nextPlateColor(b: Building | null): string {
  const n = b ? b.stack.length : 0;
  return PLATE_COLORS[n % PLATE_COLORS.length];
}

export function createBuilding(footprint: Vec2[]): Building {
  const outline: Polygon2D = { outer: ensureCCW(footprint), holes: [] };
  return {
    id: newId('bldg'),
    name: 'Untitled massing',
    stack: [
      {
        id: newId('plate'),
        outline,
        floorHeight: DEFAULT_FLOOR_HEIGHT,
        floorCount: 1,
        appearance: { color: PLATE_COLORS[0] },
      },
    ],
    patterns: [],
  };
}

export function plateBase(b: Building, plateIndex: number): number {
  let y = 0;
  for (let i = 0; i < plateIndex && i < b.stack.length; i++) {
    y += b.stack[i].floorHeight * b.stack[i].floorCount;
  }
  return y;
}

export function totalHeight(b: Building): number {
  return plateBase(b, b.stack.length);
}

export function totalFloors(b: Building): number {
  return b.stack.reduce((n, p) => n + p.floorCount, 0);
}

export function grossFloorArea(b: Building): number {
  return b.stack.reduce((a, p) => a + polygonArea(p.outline) * p.floorCount, 0);
}

export function footprintArea(b: Building): number {
  return b.stack.length ? polygonArea(b.stack[0].outline) : 0;
}

export function firstGlobalLevel(b: Building, plateIndex: number): number {
  let g = 0;
  for (let i = 0; i < plateIndex; i++) g += b.stack[i].floorCount;
  return g;
}

// Resolve which floor of a plate a world-space height falls on.
export function levelRefAt(b: Building, plateIndex: number, y: number): LevelRef {
  const plate = b.stack[plateIndex];
  const base = plateBase(b, plateIndex);
  const raw = Math.floor((y - base) / plate.floorHeight);
  const levelInPlate = Math.min(plate.floorCount - 1, Math.max(0, raw));
  return { plateIndex, levelInPlate, globalLevel: firstGlobalLevel(b, plateIndex) + levelInPlate };
}

// Dragging the building's top: growing copies the floor below (the top
// plate's outline) into new floors; shrinking removes floors, consuming
// whole plates as it goes. Always leaves at least one floor.
export function dragTopTo(b: Building, targetY: number): void {
  for (;;) {
    const i = b.stack.length - 1;
    const top = b.stack[i];
    const base = plateBase(b, i);
    const floors = Math.round((targetY - base) / top.floorHeight);
    if (floors <= 0) {
      if (b.stack.length === 1) {
        top.floorCount = 1;
        return;
      }
      b.stack.pop();
      continue;
    }
    top.floorCount = floors;
    return;
  }
}

// Setback: from the given level up through the rest of its plate run, offset
// the outline (positive = inset, negative = outset). Splits the plate when
// the level is mid-run so floors below keep their outline. Returns the
// LevelRef of the (possibly new) plate holding the level, or null when the
// offset would collapse the footprint.
export function applySetback(b: Building, ref: LevelRef, inset: number): LevelRef | null {
  const plate = b.stack[ref.plateIndex];
  if (!plate || ref.levelInPlate >= plate.floorCount) return null;
  const newOutline = offsetPolygon(plate.outline, inset);
  if (!newOutline) return null;

  if (ref.levelInPlate === 0) {
    plate.outline = newOutline;
    return ref;
  }
  const upper: Plate = {
    ...plate,
    id: newId('plate'),
    outline: newOutline,
    floorCount: plate.floorCount - ref.levelInPlate,
    appearance: { ...plate.appearance },
    transform: plate.transform ? { ...plate.transform, offset: [...plate.transform.offset] as Vec2 } : undefined,
  };
  plate.floorCount = ref.levelInPlate;
  b.stack.splice(ref.plateIndex + 1, 0, upper);
  return { plateIndex: ref.plateIndex + 1, levelInPlate: 0, globalLevel: ref.globalLevel };
}

export function cloneBuilding(b: Building): Building {
  return JSON.parse(JSON.stringify(b)) as Building;
}
