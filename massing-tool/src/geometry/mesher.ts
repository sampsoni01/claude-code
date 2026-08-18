// Builds the three.js scene representation from the plate stack.
// The whole view is regenerated on every model change — that regeneration
// being cheap is what makes the "drag and it re-details" feel possible.
import * as THREE from 'three';
import type { Building, LevelRef, Plate, Polygon2D, Vec2 } from '../model/types';
import { plateBase } from '../model/building';
import { transformPolygon } from './polygon';

// Outline as actually rendered: canonical outline + the plate's transform
// hook (used by future twist/slide patterns).
export function effectiveOutline(plate: Plate): Polygon2D {
  const t = plate.transform;
  if (!t) return plate.outline;
  return transformPolygon(plate.outline, t.rotationDeg, t.offset);
}

// Model [x, z] -> shape space [x, -z]; after geometry.rotateX(-PI/2) the
// extrusion runs up +Y and shape-y maps back to world z.
function ringToShapePoints(ring: Vec2[]): THREE.Vector2[] {
  return ring.map(([x, z]) => new THREE.Vector2(x, -z));
}

function toShape(poly: Polygon2D): THREE.Shape {
  const outer = ringToShapePoints(poly.outer);
  if (THREE.ShapeUtils.area(outer) < 0) outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const h of poly.holes) {
    const pts = ringToShapePoints(h);
    if (THREE.ShapeUtils.area(pts) > 0) pts.reverse();
    shape.holes.push(new THREE.Path(pts));
  }
  return shape;
}

function ringLoopGeometry(ring: Vec2[], y: number): THREE.BufferGeometry {
  const positions = new Float32Array(ring.length * 3);
  ring.forEach(([x, z], i) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

const floorLineMaterial = new THREE.LineBasicMaterial({ color: 0x1a2027, transparent: true, opacity: 0.28 });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x1a2027, transparent: true, opacity: 0.85 });
const selectRingMaterial = new THREE.LineBasicMaterial({ color: 0xff8c42, linewidth: 2 });

export interface BuildOptions {
  helpers: boolean; // floor lines, edges, selection highlight
  selected?: LevelRef | null;
}

// Rebuildable view of one building. Owns its group; dispose() frees GPU
// resources so per-frame rebuilds during drags don't leak.
export class BuildingView {
  readonly group = new THREE.Group();
  plateMeshes: THREE.Mesh[] = [];

  rebuild(b: Building | null, opts: BuildOptions): void {
    this.dispose();
    this.plateMeshes = [];
    if (!b) return;

    b.stack.forEach((plate, plateIndex) => {
      const outline = effectiveOutline(plate);
      const base = plateBase(b, plateIndex);
      const height = plate.floorHeight * plate.floorCount;
      const selectedPlate = opts.selected?.plateIndex === plateIndex;

      const geo = new THREE.ExtrudeGeometry(toShape(outline), { depth: height, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: plate.appearance.color,
        roughness: 0.85,
        metalness: 0.0,
        emissive: selectedPlate ? 0x1c3a52 : 0x000000,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = base;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.plateIndex = plateIndex;
      this.group.add(mesh);
      this.plateMeshes.push(mesh);

      if (!opts.helpers) return;

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMaterial);
      edges.position.y = base;
      this.group.add(edges);

      const rings = [outline.outer, ...outline.holes];
      for (let f = 1; f < plate.floorCount; f++) {
        for (const ring of rings) {
          this.group.add(new THREE.LineLoop(ringLoopGeometry(ring, base + f * plate.floorHeight + 0.02), floorLineMaterial));
        }
      }

      if (selectedPlate && opts.selected) {
        const lv = opts.selected.levelInPlate;
        for (const y of [base + lv * plate.floorHeight, base + (lv + 1) * plate.floorHeight]) {
          for (const ring of rings) {
            this.group.add(new THREE.LineLoop(ringLoopGeometry(ring, y + 0.03), selectRingMaterial));
          }
        }
      }
    });
  }

  // Meshes-only copy for export: no helper lines, no selection tint.
  buildExportGroup(b: Building): THREE.Group {
    const view = new BuildingView();
    view.rebuild(b, { helpers: false });
    view.group.name = b.name || 'massing';
    return view.group;
  }

  dispose(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const obj = child as THREE.Mesh;
      obj.geometry?.dispose();
      const m = obj.material as THREE.Material | undefined;
      // Shared line materials are module-level singletons; only dispose mesh materials.
      if (m && obj instanceof THREE.Mesh) m.dispose();
    }
  }
}
