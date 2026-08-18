// Architecture patterns — FUTURE WORK, deliberately stubbed.
//
// The intent (from the project brief + owner direction): the user shapes the
// lower floors by hand, then applies a reusable pattern that procedurally
// extends/scales that design up the full stack — twists, tapers, lattices,
// complex repeated geometry — instead of shaping every floor manually.
// Patterns should eventually be copy/paste-able between buildings.
//
// The plumbing for this already exists in the data model and mesher:
//   - Plate.transform (rotation about centroid + offset) is honored by the
//     mesher and picking, so a "twist" is: split the run into per-floor
//     plates and write an interpolated rotationDeg to each.
//   - Plate outlines are plain polygons, so a "taper" is an interpolated
//     offsetPolygon() per floor.
//   - Building.patterns stores the applied patterns so they can be re-run
//     when the base floors change, or copied to another building.
//
// applyPattern() below is the single entry point the UI will call. It is a
// no-op today so nothing else needs to change when patterns land.
import type { Building, Pattern } from './types';

export function applyPattern(_building: Building, pattern: Pattern): void {
  // TODO(patterns): implement per-kind application. Sketches:
  //  - 'twist':  { totalDeg, fromLevel } -> split affected runs into
  //              per-floor plates; transform.rotationDeg = lerp by elevation.
  //  - 'taper':  { totalInsetFt, fromLevel } -> per-floor offsetPolygon().
  //  - 'lattice' and richer copied geometry ride on Phase 2 facade rules.
  throw new Error(`Pattern kind "${pattern.kind}" not implemented yet`);
}
