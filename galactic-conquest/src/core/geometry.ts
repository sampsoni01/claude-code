export interface Point { x: number; y: number }

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * True when segments ab and cd cross at an interior point. Segments that only
 * share an endpoint do not count as crossing.
 */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  if (a === c || a === d || b === c || b === d) return false;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Shortest distance from point p to segment ab. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when p lies inside the ellipse centred on c with radii rx, ry. */
export function insideEllipse(p: Point, c: Point, rx: number, ry: number): boolean {
  const nx = (p.x - c.x) / rx;
  const ny = (p.y - c.y) / ry;
  return nx * nx + ny * ny <= 1;
}
