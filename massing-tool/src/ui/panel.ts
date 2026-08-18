// Right-hand panel: mode switching, live metrics, per-level editing, I/O.
import type { Store } from '../state/store';
import type { Controller } from '../interaction/controller';
import {
  applySetback,
  firstGlobalLevel,
  footprintArea,
  grossFloorArea,
  totalFloors,
  totalHeight,
  MIN_FLOOR_HEIGHT,
} from '../model/building';
import { polygonArea } from '../geometry/polygon';
import { exportGLB, parseSaveFile, saveJSON } from '../export/exporters';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const sf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ft = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function initPanel(store: Store, controller: Controller): void {
  const btnDraw = $('btnDraw');
  const btnEdit = $('btnEdit');
  const btnUndo = $<HTMLButtonElement>('btnUndo');
  const btnRedo = $<HTMLButtonElement>('btnRedo');
  const err = $('err');
  const hint = $('hint');

  const selCard = $('selCard');
  const inSetback = $<HTMLInputElement>('inSetback');
  const inFH = $<HTMLInputElement>('inFH');
  const inFC = $<HTMLInputElement>('inFC');
  const inColor = $<HTMLInputElement>('inColor');
  const chkMeters = $<HTMLInputElement>('chkMeters');
  const fileInput = $<HTMLInputElement>('fileInput');

  const setErr = (msg: string) => {
    err.textContent = msg;
    if (msg) setTimeout(() => { if (err.textContent === msg) err.textContent = ''; }, 4000);
  };

  controller.onHint = (html) => { hint.innerHTML = html; };
  controller.onModeChange = refresh;

  btnDraw.onclick = () => controller.setMode('draw');
  btnEdit.onclick = () => controller.setMode('edit');
  btnUndo.onclick = () => store.undo();
  btnRedo.onclick = () => store.redo();

  $('btnNew').onclick = () => {
    if (store.building && !confirm('Clear the current building?')) return;
    store.withHistory(() => {
      store.building = null;
      store.selected = null;
      return true;
    });
    controller.setMode('draw');
    controller.updateHint();
  };

  $('btnSave').onclick = () => {
    const file = store.serialize();
    if (!file) return setErr('Nothing to save yet');
    saveJSON(file);
  };

  $('btnLoad').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      store.loadSaveFile(parseSaveFile(await f.text()));
      controller.setMode('edit');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load file');
    }
  };

  $('btnExport').onclick = async () => {
    if (!store.building) return setErr('Nothing to export yet');
    try {
      await exportGLB(store.building, chkMeters.checked);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    }
  };

  $('btnSetback').onclick = () => {
    const sel = store.selected;
    if (!store.building || !sel) return;
    const inset = Number(inSetback.value);
    if (!Number.isFinite(inset) || inset === 0) return setErr('Enter a non-zero setback');
    const ok = store.withHistory(() => {
      const ref = applySetback(store.building!, sel, inset);
      if (!ref) return false;
      store.selected = ref;
      return true;
    });
    if (!ok) setErr('That setback collapses the footprint');
  };

  inFH.onchange = () => {
    const sel = store.selected;
    if (!store.building || !sel) return;
    const v = Number(inFH.value);
    if (!Number.isFinite(v) || v < MIN_FLOOR_HEIGHT) return setErr(`Floor height must be at least ${MIN_FLOOR_HEIGHT} ft`);
    store.withHistory(() => {
      store.building!.stack[sel.plateIndex].floorHeight = v;
      return true;
    });
  };

  inFC.onchange = () => {
    const sel = store.selected;
    if (!store.building || !sel) return;
    const v = Math.round(Number(inFC.value));
    if (!Number.isFinite(v) || v < 1) return setErr('A run needs at least 1 floor');
    store.withHistory(() => {
      store.building!.stack[sel.plateIndex].floorCount = v;
      store.clampSelection();
      return true;
    });
  };

  inColor.onchange = () => {
    const sel = store.selected;
    if (!store.building || !sel) return;
    store.withHistory(() => {
      store.building!.stack[sel.plateIndex].appearance.color = inColor.value;
      return true;
    });
  };

  function refresh(): void {
    const b = store.building;
    btnDraw.classList.toggle('active', controller.mode === 'draw');
    btnEdit.classList.toggle('active', controller.mode === 'edit');
    btnUndo.disabled = !store.canUndo;
    btnRedo.disabled = !store.canRedo;

    $('stFloors').textContent = b ? String(totalFloors(b)) : '–';
    $('stHeight').textContent = b ? `${ft.format(totalHeight(b))} ft` : '–';
    $('stFootprint').textContent = b ? `${sf.format(footprintArea(b))} SF` : '–';
    $('stGFA').textContent = b ? `${sf.format(grossFloorArea(b))} SF` : '–';

    const sel = store.selected;
    const plate = b && sel ? b.stack[sel.plateIndex] : null;
    selCard.classList.toggle('hidden', !plate);
    if (!b || !sel || !plate) return;

    const runStart = firstGlobalLevel(b, sel.plateIndex) + 1;
    const runEnd = runStart + plate.floorCount - 1;
    $('selTitle').textContent = `Level ${sel.globalLevel + 1}`;
    $('selArea').textContent = `${sf.format(polygonArea(plate.outline))} SF`;
    $('selRun').textContent = runStart === runEnd ? `floor ${runStart}` : `floors ${runStart}–${runEnd}`;

    // don't clobber a field the user is typing in
    if (document.activeElement !== inFH) inFH.value = String(plate.floorHeight);
    if (document.activeElement !== inFC) inFC.value = String(plate.floorCount);
    if (document.activeElement !== inColor) inColor.value = plate.appearance.color;
  }

  store.subscribe(refresh);
  refresh();
  controller.updateHint();
}
