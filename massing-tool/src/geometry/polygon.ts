// 2D polygon math. All coordinates are [x, z] ground-plane feet.
import ClipperLib from 'clipper-lib';
import type { Polygon2D, Vec2 } from '../model/types';

const SCALE = 1000; // clipper works on integers; 0.001 ft precision

interface ClipperPt { X: number; Y: number }

export function ringArea(ring: Vec2[]): number {
  // Signed shoelace area; positive = counter-clockwise.
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function polygonArea(poly: Polygon2D): number {
  let a = Math.abs(ringArea(poly.outer));
  for (const h of poly.holes) a -= Math.abs(ringArea(h));
  return Math.max(0, a);
}

export function ensureCCW(ring: Vec2[]): Vec2[] {
  return ringArea(ring) < 0 ? [...ring].reverse() : ring;
}

export function ringCentroid(ring: Vec2[]): Vec2 {
  const a = ringArea(ring);
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return [sx / ring.length, sy / ring.length];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function toClipper(ring: Vec2[]): ClipperPt[] {
  return ring.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
}

function fromClipper(path: ClipperPt[]): Vec2[] {
  return path.map((p) => [p.X / SCALE, p.Y / SCALE] as Vec2);
}

// Uniform offset of the whole polygon: positive inset shrinks, negative
// expands. Returns null when the polygon collapses (inset too deep).
// Miter joins keep architectural corners sharp.
export function offsetPolygon(poly: Polygon2D, inset: number): Polygon2D | null {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  co.AddPath(toClipper(ensureCCW(poly.outer)), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  for (const h of poly.holes) {
    // Holes run opposite the outer ring so clipper offsets them the right way.
    const hole = ringArea(h) > 0 ? [...h].reverse() : h;
    co.AddPath(toClipper(hole), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  }
  const out: ClipperPt[][] = [];
  co.Execute(out, -inset * SCALE);
  if (!out.length) return null;

  const rings = out.map(fromClipper).filter((r) => r.length >= 3);
  if (!rings.length) return null;
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const outer = ensureCCW(rings[0]);
  if (Math.abs(ringArea(outer)) < 1) return null; // collapsed below 1 SF
  const holes = rings.slice(1).filter((r) => Math.abs(ringArea(r)) > 1);
  return { outer, holes };
}

// Apply a plate transform (rotation about the outer centroid + offset) to a
// polygon. Used at render/pick time so the canonical outline stays clean.
export function transformPolygon(poly: Polygon2D, rotationDeg: number, offset: Vec2): Polygon2D {
  if (rotationDeg === 0 && offset[0] === 0 && offset[1] === 0) return poly;
  const [cx, cy] = ringCentroid(poly.outer);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const tx = (ring: Vec2[]): Vec2[] =>
    ring.map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      return [cx + dx * cos - dy * sin + offset[0], cy + dx * sin + dy * cos + offset[1]];
    });
  return { outer: tx(poly.outer), holes: poly.holes.map(tx) };
}
