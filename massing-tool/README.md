# Massing Tool

Browser-based conceptual massing for residential architecture — houses through
highrises. Draw a footprint, drag the building up, carve setbacks, and read
floor area live. Phase 1 of the plan in the project brief: the massing core.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build into dist/
```

## Controls

| Action | How |
| --- | --- |
| Draw a footprint | **Draw** mode: click ground to place corners (1 ft snap). Click the first point, double-click, or press `Enter` to close. `Backspace` removes the last point, `Esc` cancels. |
| Add / remove floors | **Edit** mode: drag the orange handle (or the roof of the top run) up or down. New floors copy the floor below. |
| Select a level | Click a wall. |
| Setback | With a level selected, drag its wall inward (snaps to 0.5 ft), or type a value and **Apply setback**. Applies from that level up through the rest of its run; floors below keep their outline. Negative values outset. |
| Per-run edits | Floor height, floor count, and color in the selection card. |
| Orbit / zoom | Drag empty ground (Edit mode) or right-drag anywhere; scroll to zoom. |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |

Units are **imperial**: 1 world unit = 1 foot, areas in square feet.

## Data model

A building is an ordered stack of **plates** — 2D polygons with a floor height
and a floor count (a "run" of identical floors). Never a freeform mesh. All
shaping is polygon math (clipper offsets), which is why area, GFA, and height
are always exact and free. See `src/model/types.ts`.

- **Editing mid-run splits the run**: setting back level 12 of a 1–20 run
  yields runs 1–11 and 12–20, the upper with the inset outline.
- **`Polygon2D.holes`** is carried through clipper and the mesher for future
  courtyard/donut plans.

## Persistence & export

- Autosaves to `localStorage` on every change; **Save/Load** round-trips a
  versioned `.massing.json`.
- **Export GLB** writes plain meshes that open in Blender / Unreal / Unity or
  any glTF renderer, for when it's time to make it pretty/marketable. Checked
  by default: scale feet → meters (the glTF standard unit).

## Where future work plugs in (intentional hooks)

- **Appearance** (`Plate.appearance`): only `color` is used today;
  `materialId` / `textureId` / `roughness` are reserved for Phase 2 facade
  rules and richer materials.
- **Columns** (`Plate.columns`): reserved for structural expression.
- **Patterns** (`Building.patterns`, `src/model/patterns.ts`): copy/paste-able
  architecture patterns — twist, taper, lattice. The mesher and picking already
  honor `Plate.transform` (rotation about centroid + offset), so a twist is
  "split runs per floor, interpolate `rotationDeg`" with no renderer changes.
  Shape the lower floors by hand; the pattern scales the design up the stack.
- **Facade rules** (`Plate.facadeRuleId`): Phase 2 panelization walks plate
  edges and instances panels (`InstancedMesh`).
- **Drag-and-drop designs**: not built yet by request; saved designs are plain
  JSON (`SaveFile`), so dragging a design in is "parse + `store.loadSaveFile`".
- **Site / zoning**: `Building.site` reserved. Zoning overlay was removed from
  scope for now; every plate has a computable area + elevation, so an envelope
  check can be added later without a rewrite.

## Out of scope (v1, per the brief)

Interiors, structure/MEP/cost, photoreal rendering, Revit/IFC export, curved
facades, multiple buildings per site.
