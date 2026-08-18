// Pointer interaction: footprint drafting, level selection, height dragging
// (drag the top to add floors — new floors copy the floor below), and
// interactive setbacks (drag a wall of the selected run inward).
//
// Modeless where possible: in Edit mode, left-drag on empty ground orbits,
// left-drag on the building shapes it.
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Building, LevelRef, Vec2 } from '../model/types';
import {
  applySetback,
  cloneBuilding,
  createBuilding,
  dragTopTo,
  levelRefAt,
  plateBase,
  totalHeight,
} from '../model/building';
import { polygonArea, ringArea, ringCentroid } from '../geometry/polygon';
import { BuildingView, effectiveOutline } from '../geometry/mesher';
import type { Store } from '../state/store';

export type Mode = 'draw' | 'edit';

const GRID_SNAP = 1; // ft
const CLOSE_RADIUS = 3; // ft: clicking this close to the first vertex closes the footprint
const SETBACK_SNAP = 0.5; // ft
const MIN_DRAG_PX = 5;

type DragState =
  | { kind: 'height'; baseJson: string; base: Building; plane: THREE.Plane; grabY: number; startTopY: number }
  | {
      kind: 'setback';
      baseJson: string;
      base: Building;
      ref: LevelRef;
      grab: THREE.Vector3;
      axisPx: THREE.Vector2; // screen-space direction of the outward wall normal (CSS px, y down)
      worldPerPx: number;    // feet of axis travel per pixel at the grab depth
      startArea: number;
      moved: boolean;
    };

export class Controller {
  mode: Mode = 'draw';
  onModeChange: (() => void) | null = null;
  onHint: ((html: string) => void) | null = null;

  private drawPts: Vec2[] = [];
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private downAt: { x: number; y: number } | null = null;
  private moved = false;
  private drag: DragState | null = null;

  // draw-mode preview visuals
  private previewGroup = new THREE.Group();
  private markerMat = new THREE.MeshBasicMaterial({ color: 0xff8c42 });
  private markerGeo = new THREE.SphereGeometry(0.9, 12, 8);
  private rubberLine: THREE.Line;
  private closeMarker: THREE.Mesh;

  // edit-mode visuals
  private hoverRing: THREE.LineLoop;
  private topHandle: THREE.Group;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLElement,
    private orbit: OrbitControls,
    private store: Store,
    private view: BuildingView,
  ) {
    this.scene.add(this.previewGroup);

    this.rubberLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xff8c42 }),
    );
    this.rubberLine.visible = false;
    this.scene.add(this.rubberLine);

    this.closeMarker = new THREE.Mesh(
      new THREE.RingGeometry(CLOSE_RADIUS - 0.4, CLOSE_RADIUS, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff8c42, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    this.closeMarker.visible = false;
    this.scene.add(this.closeMarker);

    this.hoverRing = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x4fa3d1 }),
    );
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);

    this.topHandle = this.makeTopHandle();
    this.topHandle.visible = false;
    this.scene.add(this.topHandle);

    // capture:true so these run before OrbitControls' own listeners and can
    // steal the gesture (orbit.enabled=false) when the drag hits the building
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true });
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    canvas.addEventListener('dblclick', () => this.tryCloseFootprint());

    store.subscribe(() => this.syncHandle());
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.cancelDraw();
    // In draw mode the left button places vertices; orbit stays on right/middle.
    this.orbit.mouseButtons.LEFT = m === 'draw' ? (null as unknown as number) : THREE.MOUSE.ROTATE;
    this.syncHandle();
    this.updateHint();
    this.onModeChange?.();
  }

  private makeTopHandle(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8c42 });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 16), mat);
    cone.position.y = 5.5;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 3.5, 8), mat);
    stem.position.y = 1.7;
    g.add(cone, stem);
    return g;
  }

  syncHandle(): void {
    const b = this.store.building;
    if (!b || this.mode !== 'edit') {
      this.topHandle.visible = false;
      return;
    }
    const top = b.stack[b.stack.length - 1];
    const [cx, cz] = ringCentroid(effectiveOutline(top).outer);
    this.topHandle.position.set(cx, totalHeight(b), cz);
    this.topHandle.visible = true;
  }

  // ---- picking helpers -------------------------------------------------

  private setRayFrom(e: PointerEvent | MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  private groundPoint(e: PointerEvent | MouseEvent, snap = true): Vec2 | null {
    this.setRayFrom(e);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return null;
    if (!snap) return [p.x, p.z];
    return [Math.round(p.x / GRID_SNAP) * GRID_SNAP, Math.round(p.z / GRID_SNAP) * GRID_SNAP];
  }

  private pickBuilding(e: PointerEvent | MouseEvent): THREE.Intersection | null {
    this.setRayFrom(e);
    const hits = this.raycaster.intersectObjects(this.view.plateMeshes, false);
    return hits[0] ?? null;
  }

  private pickHandle(e: PointerEvent | MouseEvent): boolean {
    if (!this.topHandle.visible) return false;
    this.setRayFrom(e);
    return this.raycaster.intersectObject(this.topHandle, true).length > 0;
  }

  private worldNormal(hit: THREE.Intersection): THREE.Vector3 {
    const n = hit.face!.normal.clone();
    n.transformDirection(hit.object.matrixWorld);
    return n;
  }

  // A vertical plane through `point`, facing the camera: raycasts against it
  // convert 2D mouse motion into a stable world-space height.
  private verticalDragPlane(point: THREE.Vector3): THREE.Plane {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(dir, point);
  }

  // Screen-space (CSS px, y down) direction of a world axis at a point.
  private screenAxis(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    const toPx = (v: THREE.Vector3): THREE.Vector2 => {
      const q = v.clone().project(this.camera);
      return new THREE.Vector2(((q.x + 1) / 2) * r.width, ((1 - q.y) / 2) * r.height);
    };
    const a = toPx(origin);
    const b = toPx(origin.clone().addScaledVector(dir, 10));
    const axis = b.sub(a);
    // Nearly face-on the projection shrinks toward zero but keeps its sign;
    // normalizing recovers a stable direction.
    return axis.lengthSq() < 1e-6 ? new THREE.Vector2(0, 1) : axis.normalize();
  }

  // Feet of world travel per screen pixel at a point's camera depth.
  private worldPerPixel(point: THREE.Vector3): number {
    const r = this.canvas.getBoundingClientRect();
    const dist = this.camera.position.distanceTo(point);
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / r.height;
  }

  // ---- pointer events ---------------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    this.moved = false;

    if (this.mode !== 'edit' || !this.store.building) return;

    if (this.pickHandle(e)) {
      this.startHeightDrag(e, this.topHandle.position.clone());
      return;
    }

    const hit = this.pickBuilding(e);
    if (!hit) return; // empty ground: let OrbitControls have the gesture

    const b = this.store.building;
    const plateIndex = hit.object.userData.plateIndex as number;
    const n = this.worldNormal(hit);

    if (n.y > 0.7 && plateIndex === b.stack.length - 1) {
      // top cap of the top plate: drag height directly
      this.startHeightDrag(e, hit.point.clone());
      return;
    }

    if (Math.abs(n.y) < 0.5) {
      // a wall: select the level and arm an interactive setback drag
      const ref = levelRefAt(b, plateIndex, hit.point.y);
      this.store.select(ref);
      this.orbit.enabled = false;
      this.drag = {
        kind: 'setback',
        baseJson: JSON.stringify(b),
        base: cloneBuilding(b),
        ref,
        grab: hit.point.clone(),
        axisPx: this.screenAxis(hit.point, new THREE.Vector3(n.x, 0, n.z).normalize()),
        worldPerPx: this.worldPerPixel(hit.point),
        startArea: polygonArea(b.stack[plateIndex].outline),
        moved: false,
      };
      return;
    }

    // top of a lower plate (an exposed roof) or a soffit: selection only,
    // handled on pointerup so orbiting still works from here
  }

  private startHeightDrag(e: PointerEvent, grabPoint: THREE.Vector3): void {
    const b = this.store.building!;
    this.orbit.enabled = false;
    this.drag = {
      kind: 'height',
      baseJson: JSON.stringify(b),
      base: cloneBuilding(b),
      plane: this.verticalDragPlane(grabPoint),
      grabY: grabPoint.y,
      startTopY: totalHeight(b),
    };
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.downAt) {
      const dx = e.clientX - this.downAt.x;
      const dy = e.clientY - this.downAt.y;
      if (dx * dx + dy * dy > MIN_DRAG_PX * MIN_DRAG_PX) this.moved = true;
    }

    if (this.drag) {
      if (this.drag.kind === 'height') this.updateHeightDrag(e);
      else this.updateSetbackDrag(e);
      return;
    }

    if (this.mode === 'draw') {
      this.updateDrawPreview(e);
    } else {
      this.updateHover(e);
    }
  }

  private updateHeightDrag(e: PointerEvent): void {
    const d = this.drag as Extract<DragState, { kind: 'height' }>;
    this.setRayFrom(e);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(d.plane, p)) return;
    const targetTopY = d.startTopY + (p.y - d.grabY);
    const preview = cloneBuilding(d.base);
    dragTopTo(preview, targetTopY);
    this.store.preview(preview);
    const top = preview.stack[preview.stack.length - 1];
    this.setHintText(
      `Height <b>${fmt(totalHeight(preview))} ft</b> &middot; top run <b>${top.floorCount}</b> floor${top.floorCount === 1 ? '' : 's'} &mdash; release to commit`,
    );
  }

  private updateSetbackDrag(e: PointerEvent): void {
    const d = this.drag as Extract<DragState, { kind: 'setback' }>;
    // SketchUp-style push/pull: pixel travel along the wall normal's screen
    // projection, at a fixed world-per-pixel scale for the grab depth.
    // Predictable at every camera angle (a face-on ray/axis intersection
    // degenerates; this never does).
    const dxPx = e.clientX - (this.downAt?.x ?? e.clientX);
    const dyPx = e.clientY - (this.downAt?.y ?? e.clientY);
    const along = dxPx * d.axisPx.x + dyPx * d.axisPx.y; // px along the outward axis
    let inset = -along * d.worldPerPx; // dragging inward (against the normal) insets
    inset = Math.round(inset / SETBACK_SNAP) * SETBACK_SNAP;

    if (!d.moved && inset === 0) return;
    d.moved = true;

    if (Math.abs(inset) < SETBACK_SNAP / 2) {
      this.store.preview(cloneBuilding(d.base));
      this.setHintText('Setback <b>0 ft</b>');
      return;
    }
    const preview = cloneBuilding(d.base);
    const newRef = applySetback(preview, d.ref, inset);
    // Guard against accidental slivers: a drag that leaves less than 10% of
    // the plate reads as a collapse (the numeric input still allows anything).
    const minArea = Math.max(25, d.startArea * 0.1);
    if (!newRef || polygonArea(preview.stack[newRef.plateIndex].outline) < minArea) {
      this.setHintText(`Setback <b>${fmt(inset)} ft</b> &mdash; collapses the footprint`);
      return; // keep the last valid preview
    }
    this.store.selected = newRef;
    this.store.preview(preview);
    this.setHintText(
      `${inset >= 0 ? 'Setback' : 'Outset'} <b>${fmt(Math.abs(inset))} ft</b> &mdash; release to commit`,
    );
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.drag) {
      const baseJson = this.drag.baseJson;
      this.drag = null;
      this.orbit.enabled = true;
      this.store.commitPreview(baseJson);
      this.updateHint();
      this.downAt = null;
      return;
    }

    if (this.downAt && !this.moved && e.button === 0) {
      if (this.mode === 'draw') this.handleDrawClick(e);
      else this.handleEditClick(e);
    }
    this.downAt = null;
  }

  // ---- draw mode ---------------------------------------------------------

  private handleDrawClick(e: PointerEvent): void {
    const pt = this.groundPoint(e);
    if (!pt) return;

    if (this.drawPts.length >= 3) {
      const [fx, fz] = this.drawPts[0];
      if (Math.hypot(pt[0] - fx, pt[1] - fz) <= CLOSE_RADIUS) {
        this.tryCloseFootprint();
        return;
      }
    }
    const last = this.drawPts[this.drawPts.length - 1];
    if (last && last[0] === pt[0] && last[1] === pt[1]) return; // ignore duplicate clicks
    this.drawPts.push(pt);
    this.refreshDrawMarkers();
    this.updateHint();
  }

  tryCloseFootprint(): void {
    if (this.mode !== 'draw' || this.drawPts.length < 3) return;
    if (Math.abs(ringArea(this.drawPts)) < 1) return; // degenerate
    const pts = this.drawPts;
    this.store.withHistory(() => {
      this.store.building = createBuilding(pts);
      this.store.selected = null;
      return true;
    });
    this.cancelDraw();
    this.setMode('edit');
  }

  cancelDraw(): void {
    this.drawPts = [];
    this.refreshDrawMarkers();
    this.rubberLine.visible = false;
    this.closeMarker.visible = false;
  }

  private refreshDrawMarkers(): void {
    for (const c of [...this.previewGroup.children]) {
      this.previewGroup.remove(c);
    }
    for (const [x, z] of this.drawPts) {
      const m = new THREE.Mesh(this.markerGeo, this.markerMat);
      m.position.set(x, 0.5, z);
      this.previewGroup.add(m);
    }
    if (this.drawPts.length >= 3) {
      const [fx, fz] = this.drawPts[0];
      this.closeMarker.position.set(fx, 0.05, fz);
      this.closeMarker.visible = true;
    } else {
      this.closeMarker.visible = false;
    }
  }

  private updateDrawPreview(e: PointerEvent): void {
    if (!this.drawPts.length) {
      this.rubberLine.visible = false;
      return;
    }
    const pt = this.groundPoint(e);
    if (!pt) return;
    const pts: THREE.Vector3[] = this.drawPts.map(([x, z]) => new THREE.Vector3(x, 0.1, z));
    pts.push(new THREE.Vector3(pt[0], 0.1, pt[1]));
    this.rubberLine.geometry.dispose();
    this.rubberLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.rubberLine.visible = true;

    const last = this.drawPts[this.drawPts.length - 1];
    const segLen = Math.hypot(pt[0] - last[0], pt[1] - last[1]);
    this.setHintText(
      `${this.drawPts.length} point${this.drawPts.length === 1 ? '' : 's'} &middot; segment <b>${fmt(segLen)} ft</b> &mdash; ` +
        `click to add &middot; click the first point / <kbd>Enter</kbd> to close &middot; <kbd>Backspace</kbd> undo point &middot; <kbd>Esc</kbd> cancel`,
    );
  }

  // ---- edit mode ----------------------------------------------------------

  private handleEditClick(e: PointerEvent): void {
    const b = this.store.building;
    if (!b) return;
    const hit = this.pickBuilding(e);
    if (!hit) {
      this.store.select(null);
      return;
    }
    const plateIndex = hit.object.userData.plateIndex as number;
    this.store.select(levelRefAt(b, plateIndex, hit.point.y));
  }

  private updateHover(e: PointerEvent): void {
    const b = this.store.building;
    if (!b) {
      this.hoverRing.visible = false;
      return;
    }
    const overHandle = this.pickHandle(e);
    const hit = overHandle ? null : this.pickBuilding(e);
    this.canvas.style.cursor = overHandle ? 'ns-resize' : hit ? 'pointer' : '';
    if (!hit) {
      this.hoverRing.visible = false;
      return;
    }
    const plateIndex = hit.object.userData.plateIndex as number;
    const ref = levelRefAt(b, plateIndex, hit.point.y);
    const plate = b.stack[plateIndex];
    const y = plateBase(b, plateIndex) + ref.levelInPlate * plate.floorHeight + 0.05;
    const ring = effectiveOutline(plate).outer;
    const positions = new Float32Array(ring.length * 3);
    ring.forEach(([x, z], i) => {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    });
    this.hoverRing.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.hoverRing.geometry = geo;
    this.hoverRing.visible = true;
  }

  // ---- keyboard -----------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    const inField = (e.target as HTMLElement)?.tagName === 'INPUT';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inField) {
      e.preventDefault();
      this.store.redo();
      return;
    }
    if (inField) return;
    if (this.mode === 'draw') {
      if (e.key === 'Enter') this.tryCloseFootprint();
      else if (e.key === 'Escape') {
        this.cancelDraw();
        this.updateHint();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this.drawPts.pop();
        this.refreshDrawMarkers();
        this.updateHint();
      }
    } else if (e.key === 'Escape') {
      this.store.select(null);
    }
  }

  // ---- hints ----------------------------------------------------------------

  private setHintText(html: string): void {
    this.onHint?.(html);
  }

  updateHint(): void {
    if (this.mode === 'draw') {
      this.setHintText(
        this.drawPts.length
          ? `Click to add points &middot; click the first point or press <kbd>Enter</kbd> to close &middot; <kbd>Esc</kbd> cancel`
          : `<b>Draw the footprint:</b> click on the ground to place corners (snaps to 1 ft). Right-drag orbits, scroll zooms.`,
      );
    } else {
      this.setHintText(
        this.store.building
          ? `<b>Edit:</b> drag the orange handle (or the roof) to add floors &mdash; new floors copy the one below. ` +
            `Click a wall to select a level; drag a wall inward for a setback. Drag empty ground to orbit. <kbd>Ctrl+Z</kbd> undo.`
          : `No building yet &mdash; switch to Draw and outline a footprint.`,
      );
    }
  }
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('en-US');
}
