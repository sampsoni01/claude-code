import { generateGalaxy } from '../../core/galaxy/generate';
import type { Galaxy, StarSystem } from '../../core/galaxy/types';
import { randomSeed } from '../../core/rng';
import { Camera, ZOOMS } from '../../render/camera';
import { drawGalaxyMap, pickSystem } from '../../render/galaxyMap';
import { ART_WIDTH, PixelSurface } from '../../render/pixelSurface';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>('map');
const topBar = document.querySelector<HTMLElement>('.bar.top');
const bottomBar = document.querySelector<HTMLElement>('.bar.bottom');
const seedLabel = el<HTMLSpanElement>('seed');
const sizeSelect = el<HTMLSelectElement>('size');
const info = el<HTMLDivElement>('info');
const btnSectors = el<HTMLButtonElement>('btnSectors');
const btnStarts = el<HTMLButtonElement>('btnStarts');

const surface = new PixelSurface(canvas);
const cam = new Camera();

const hashSeed = location.hash.replace('#', '').toUpperCase();
let seed = /^[A-Z0-9]{3,12}$/.test(hashSeed) ? hashSeed : randomSeed();
let galaxy: Galaxy = generateGalaxy({ seed, systems: Number(sizeSelect.value) });
let selected: number | null = null;
let colorBySector = false;
let showStarts = true;

/** CSS pixels to art pixels. */
const scale = (): number => ART_WIDTH / (canvas.clientWidth || ART_WIDTH);

function barHeights(): { top: number; bottom: number } {
  const s = scale();
  return { top: (topBar?.offsetHeight ?? 0) * s, bottom: (bottomBar?.offsetHeight ?? 0) * s };
}

function fitView(): void {
  surface.fit();
  cam.zoomIndex = 0;
  const bars = barHeights();
  cam.x = galaxy.width / 2;
  cam.y = galaxy.height / 2 - (bars.top - bars.bottom) / (2 * cam.zoom);
  invalidate();
}

let pending = false;
function invalidate(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    surface.fit();
    drawGalaxyMap(surface, galaxy, cam, { selected, colorBySector, showStarts });
    surface.present();
  });
}

function describe(): void {
  const s = selected === null ? null : galaxy.systems[selected];
  if (!s) {
    const normal = galaxy.lanes.filter((l) => l.kind === 'normal');
    const between = normal.filter((l) => l.intersector).length;
    const shortcuts = galaxy.lanes.length - normal.length;
    const holes = galaxy.systems.filter((x) => x.special === 'black-hole').length;
    const pulsars = galaxy.systems.filter((x) => x.special === 'pulsar').length;
    const inNebula = galaxy.systems.filter((x) => x.inNebula).length;
    const degree = galaxy.systems.reduce((sum, x) => sum + x.lanes.length, 0) / galaxy.systems.length;
    info.innerHTML = `
      <p class="panel-title">Galaxy ${seed}</p>
      <p>${galaxy.systems.length} systems in ${galaxy.sectors.length} sectors. ${normal.length} lanes, ${between} of them between sectors, ${degree.toFixed(1)} per system.</p>
      <p>${holes} black hole${holes === 1 ? '' : 's'}, ${pulsars} pulsars with ${shortcuts} shortcut lanes, ${galaxy.nebulae.length} nebula${galaxy.nebulae.length === 1 ? '' : 'e'} covering ${inNebula} systems.</p>
      <p class="muted">Drag to pan. Pinch or the buttons to zoom. Tap a box for its system.</p>`;
    return;
  }
  const sector = galaxy.sectors[s.sector];
  const neighbours = s.lanes
    .map((id) => galaxy.lanes[id])
    .filter((l): l is NonNullable<typeof l> => Boolean(l))
    .map((l) => {
      const other = galaxy.systems[l.a === s.id ? l.b : l.a];
      const tag = l.kind === 'shortcut' ? ' (shortcut)' : l.intersector ? ' (other sector)' : '';
      return `${other?.name ?? '?'} ${l.length}${tag}`;
    });
  const special = s.special === 'none' ? '' : `<p>Special: ${s.special.replace('-', ' ')}</p>`;
  const home = s.startCandidate ? '<p>Possible home system.</p>' : '';
  info.innerHTML = `
    <p class="panel-title">${s.name} <span class="muted">in ${sector?.name ?? '?'}</span></p>
    <p>${s.star.replace('-', ' ')} star, ${s.planets} planet${s.planets === 1 ? '' : 's'}, ${s.pois} point${s.pois === 1 ? '' : 's'} of interest${s.inNebula ? ', inside a nebula' : ''}.</p>
    ${special}${home}
    <p>Lanes: ${neighbours.join(' · ')}</p>`;
}

function regenerate(newSeed: string): void {
  seed = newSeed;
  seedLabel.textContent = seed;
  galaxy = generateGalaxy({ seed, systems: Number(sizeSelect.value) });
  selected = null;
  describe();
  fitView();
}

function zoomBy(step: number, sx = ART_WIDTH / 2, sy = surface.height / 2): void {
  if (cam.setZoom(cam.zoomIndex + step, sx, sy, surface)) invalidate();
}

// Pointer handling: one finger pans or taps, two fingers pinch.
interface Touch { x: number; y: number }
const pointers = new Map<number, Touch>();
let gestureMoved = false;
let gestureStart = 0;
let pinchBase = 0;
let lastTap = 0;
let lastTapAt: Touch = { x: 0, y: 0 };

function artPoint(e: PointerEvent): Touch {
  const r = canvas.getBoundingClientRect();
  const s = scale();
  return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s };
}

function pinchDistance(): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, artPoint(e));
  if (pointers.size === 1) {
    gestureMoved = false;
    gestureStart = performance.now();
  } else if (pointers.size === 2) {
    pinchBase = pinchDistance();
    gestureMoved = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const now = artPoint(e);
  if (pointers.size === 1) {
    const dx = now.x - prev.x;
    const dy = now.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) gestureMoved = true;
    if (gestureMoved) {
      cam.pan(dx, dy);
      cam.clampTo(galaxy.width, galaxy.height, 200);
      invalidate();
    }
    pointers.set(e.pointerId, now);
  } else {
    pointers.set(e.pointerId, now);
    const d = pinchDistance();
    if (pinchBase > 0) {
      const [a, b] = [...pointers.values()];
      const mid = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: ART_WIDTH / 2, y: surface.height / 2 };
      if (d / pinchBase > 1.3) {
        zoomBy(1, mid.x, mid.y);
        pinchBase = d;
      } else if (d / pinchBase < 0.77) {
        zoomBy(-1, mid.x, mid.y);
        pinchBase = d;
      }
    }
  }
});

function endPointer(e: PointerEvent): void {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p || pointers.size > 0) return;
  pinchBase = 0;
  const quick = performance.now() - gestureStart < 400;
  if (gestureMoved || !quick) return;
  const now = performance.now();
  const doubleTap = now - lastTap < 320 && Math.hypot(p.x - lastTapAt.x, p.y - lastTapAt.y) < 24;
  lastTap = now;
  lastTapAt = p;
  if (doubleTap) {
    zoomBy(1, p.x, p.y);
    return;
  }
  const hit = pickSystem(galaxy, cam, surface, p.x, p.y, 16);
  selected = hit ? hit.id : null;
  describe();
  invalidate();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

el<HTMLButtonElement>('btnNew').addEventListener('click', () => regenerate(randomSeed()));
sizeSelect.addEventListener('change', () => regenerate(seed));
el<HTMLButtonElement>('btnIn').addEventListener('click', () => zoomBy(1));
el<HTMLButtonElement>('btnOut').addEventListener('click', () => zoomBy(-1));
el<HTMLButtonElement>('btnFit').addEventListener('click', fitView);
btnSectors.addEventListener('click', () => {
  colorBySector = !colorBySector;
  btnSectors.classList.toggle('on', colorBySector);
  invalidate();
});
btnStarts.addEventListener('click', () => {
  showStarts = !showStarts;
  btnStarts.classList.toggle('on', showStarts);
  invalidate();
});
window.addEventListener('resize', () => invalidate());

seedLabel.textContent = seed;
describe();
fitView();
void ZOOMS;

/** Exposed for quick checks from the console in test builds. */
declare global {
  interface Window { starshine?: { galaxy: () => Galaxy; select: (id: number) => StarSystem | undefined } }
}
window.starshine = { galaxy: () => galaxy, select: (id) => galaxy.systems[id] };
