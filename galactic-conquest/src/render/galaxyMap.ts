import type { Galaxy, StarSystem } from '../core/galaxy/types';
import type { Camera } from './camera';
import { rgb, type PixelSurface } from './pixelSurface';

export interface GalaxyMapOptions {
  selected: number | null;
  colorBySector: boolean;
  showStarts: boolean;
}

export const MAP_COLORS = {
  background: rgb(10, 15, 30),
  nebula: rgb(30, 22, 64),
  lane: rgb(52, 62, 94),
  laneBetweenSectors: rgb(92, 104, 150),
  shortcut: rgb(190, 64, 64),
  node: rgb(138, 147, 168),
  nodeDim: rgb(78, 86, 108),
  blackHole: rgb(0, 0, 0),
  blackHoleRing: rgb(120, 140, 190),
  pulsar: rgb(80, 230, 240),
  nebulaHeart: rgb(170, 120, 230),
  start: rgb(240, 165, 58),
  selected: rgb(255, 255, 255),
};

const SECTOR_COLORS = [
  rgb(200, 90, 90), rgb(90, 170, 110), rgb(90, 130, 210), rgb(210, 170, 70),
  rgb(170, 90, 190), rgb(70, 190, 190), rgb(220, 120, 60), rgb(130, 190, 80),
  rgb(90, 100, 220), rgb(220, 90, 150), rgb(120, 200, 170), rgb(190, 150, 110),
  rgb(150, 120, 220), rgb(100, 180, 230),
];

/** Node box size per zoom index, always odd so a box centres on its pixel. */
const NODE_SIZE = [5, 7, 9, 15] as const;

export function drawGalaxyMap(surface: PixelSurface, galaxy: Galaxy, cam: Camera, opts: GalaxyMapOptions): void {
  surface.clear(MAP_COLORS.background);
  const pos = (s: StarSystem): { x: number; y: number } => cam.worldToScreen(s.x, s.y, surface);

  for (const n of galaxy.nebulae) {
    const c = galaxy.systems[n.center];
    if (!c) continue;
    const p = pos(c);
    surface.disc(p.x, p.y, Math.round(n.radius * cam.zoom), MAP_COLORS.nebula);
  }

  for (const lane of galaxy.lanes) {
    const a = galaxy.systems[lane.a];
    const b = galaxy.systems[lane.b];
    if (!a || !b) continue;
    const pa = pos(a);
    const pb = pos(b);
    if (offscreen(surface, pa) && offscreen(surface, pb)) continue;
    if (lane.kind === 'shortcut') surface.line(pa.x, pa.y, pb.x, pb.y, MAP_COLORS.shortcut, 3);
    else surface.line(pa.x, pa.y, pb.x, pb.y, lane.intersector ? MAP_COLORS.laneBetweenSectors : MAP_COLORS.lane);
  }

  const size = NODE_SIZE[cam.zoomIndex] ?? 9;
  const half = (size - 1) / 2;
  for (const s of galaxy.systems) {
    const p = pos(s);
    if (offscreen(surface, p, size + 4)) continue;
    const x = p.x - half;
    const y = p.y - half;
    let fill = opts.colorBySector ? (SECTOR_COLORS[s.sector % SECTOR_COLORS.length] as number) : MAP_COLORS.node;
    if (s.inNebula && !opts.colorBySector) fill = MAP_COLORS.nodeDim;
    if (s.special === 'black-hole') {
      surface.rect(x, y, size, size, MAP_COLORS.blackHole);
      surface.rectOutline(x, y, size, size, MAP_COLORS.blackHoleRing);
    } else if (s.special === 'pulsar') {
      surface.rect(x, y, size, size, fill);
      surface.rect(p.x - Math.max(1, half >> 1), p.y - Math.max(1, half >> 1), Math.max(1, half >> 1) * 2 + 1, Math.max(1, half >> 1) * 2 + 1, MAP_COLORS.pulsar);
    } else if (s.special === 'nebula-heart') {
      surface.rect(x, y, size, size, MAP_COLORS.nebulaHeart);
    } else {
      surface.rect(x, y, size, size, fill);
    }
    if (opts.showStarts && s.startCandidate) surface.rectOutline(x - 2, y - 2, size + 4, size + 4, MAP_COLORS.start);
    if (opts.selected === s.id) {
      surface.rectOutline(x - 3, y - 3, size + 6, size + 6, MAP_COLORS.selected);
      surface.rectOutline(x - 4, y - 4, size + 8, size + 8, MAP_COLORS.selected);
    }
  }
}

function offscreen(surface: PixelSurface, p: { x: number; y: number }, pad = 0): boolean {
  return p.x < -pad || p.y < -pad || p.x >= surface.width + pad || p.y >= surface.height + pad;
}

/** Nearest system to a screen point within reach, or null. */
export function pickSystem(galaxy: Galaxy, cam: Camera, surface: PixelSurface, sx: number, sy: number, reach: number): StarSystem | null {
  let best: StarSystem | null = null;
  let bestD = reach;
  for (const s of galaxy.systems) {
    const p = cam.worldToScreen(s.x, s.y, surface);
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
