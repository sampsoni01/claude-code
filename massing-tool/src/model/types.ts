// Core data model for the massing tool.
//
// Units: 1 world unit = 1 foot. Imperial throughout.
//
// The load-bearing decision (see project brief): a building is an ordered
// stack of floor plates, never a freeform mesh. Every operation is a polygon
// operation, and area / GFA / height fall out of the data for free.

export type Vec2 = [number, number]; // [x, z] on the ground plane, in feet

export interface Polygon2D {
  outer: Vec2[];   // outer ring, counter-clockwise viewed from above, implicitly closed
  holes: Vec2[][]; // future: courtyards / lightwells (clipper + the facade walker must handle inner rings)
}

// Display / material assignment. Only `color` is used by the massing view
// today; the other fields are reserved so Phase 2 facade rules and richer
// materials (textures, PBR) can land without a schema change.
export interface Appearance {
  color: string;       // hex, e.g. '#8fb4c9'
  materialId?: string; // future: 'glass' | 'brick' | 'precast' | 'metal-panel' | ...
  textureId?: string;  // future: texture assignment
  roughness?: number;  // future: PBR knob carried through export
}

// Render-time transform hook, applied about the plate's centroid.
// Patterns (e.g. a tower "twist") write here: the canonical outline stays
// measurable (area is rotation-invariant) while the rendered floor rotates
// or slides. The mesher already honors this, so pattern code only needs to
// set values — no mesher changes required.
export interface PlateTransform {
  rotationDeg: number; // rotation about the outline centroid
  offset: Vec2;        // horizontal slide, feet
}

// Future: structural expression. Reserved so column grids can be added
// per-plate without a schema change.
export interface ColumnRule {
  spacing: number; // feet between columns
  size: number;    // column dimension, feet
}

// A run of identical floors sharing one outline. Dragging the building top
// up extends the top plate (i.e. copies the floor below); customizing a
// level mid-run splits the plate at that level.
export interface Plate {
  id: string;
  outline: Polygon2D;  // world-space footprint, feet
  floorHeight: number; // feet
  floorCount: number;  // identical floors sharing this outline
  appearance: Appearance;
  transform?: PlateTransform;
  facadeRuleId?: string; // Phase 2: panel module / spandrel ratio / mullion depth
  columns?: ColumnRule;  // future
}

// Future: copy/paste-able architecture patterns (twist, taper, lattice,
// complex repeated geometry). The intent: the user shapes the lower floors
// by hand, then a pattern procedurally extends/scales that design up the
// full stack instead of shaping every floor manually.
// See model/patterns.ts for the (stubbed) application pipeline.
export interface Pattern {
  id: string;
  name: string;
  kind: 'twist' | 'taper' | 'lattice' | 'custom';
  params: Record<string, number>;
}

export interface Building {
  id: string;
  name: string;
  stack: Plate[];      // ordered bottom -> top
  patterns: Pattern[]; // future: applied over the stack (see patterns.ts)
  site?: Polygon2D;    // future: property boundary (Phase 3)
}

// A single floor addressed within the stack.
export interface LevelRef {
  plateIndex: number;   // index into building.stack
  levelInPlate: number; // 0-based within the plate run
  globalLevel: number;  // 0-based within the whole building
}

// Serialization wrapper so saved files can be migrated later.
export interface SaveFile {
  version: 1;
  building: Building;
}
