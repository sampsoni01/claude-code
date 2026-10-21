import { makeRng, type Rng } from '../rng';
import { dist, insideEllipse, pointSegmentDistance, segmentsCross, type Point } from '../geometry';
import type { Galaxy, GalaxyConfig, Lane, LaneKind, Nebula, Sector, StarSystem, StarType } from './types';

/** World units are art pixels at zoom 1. Portrait, taller than wide. */
export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 1600;
const CENTER: Point = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
const RADIUS_X = 430;
const RADIUS_Y = 740;

/** Closest two systems may sit. At the overview zoom this is 23 art pixels. */
export const MIN_SPACING = 46;
/** A lane may not pass closer than this to a system it does not touch. */
const LANE_CLEARANCE = 14;
/** Longest lane drawn inside a sector by the neighbour pass. */
const MAX_LOCAL_LANE = 230;
/** Longest extra lane between sectors beyond the ones needed for connectivity. */
const MAX_EXTRA_INTERSECTOR_LANE = 280;
/** Most lanes a system takes from the optional passes. Connectivity passes ignore it. */
const MAX_DEGREE = 5;

const STAR_TYPES: readonly StarType[] = ['yellow', 'orange', 'red-dwarf', 'white', 'blue-giant', 'binary'];
const STAR_WEIGHTS = [30, 22, 24, 12, 7, 5];
const PLANET_WEIGHTS_NORMAL = [3, 8, 14, 20, 20, 16, 12, 7];
const PLANET_WEIGHTS_BLACK_HOLE = [50, 35, 15];
const PLANET_WEIGHTS_PULSAR = [30, 40, 20, 10];
const POI_WEIGHTS = [55, 32, 13];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function generateGalaxy(config: GalaxyConfig): Galaxy {
  const count = clamp(Math.round(config.systems), 20, 400);
  const startCount = clamp(config.starts ?? 7, 1, 11);
  const rng = makeRng(`galaxy:${config.seed}`);
  const sectorCount = clamp(Math.round(count / 12), 4, 14);

  const centers = placeSectorCenters(rng.fork('sectors'), sectorCount);
  const counts = splitCounts(rng.fork('counts'), count, sectorCount);
  const systems = placeSystems(rng.fork('systems'), centers, counts);
  const lanes = buildLanes(rng.fork('lanes'), systems, sectorCount);
  const nebulae = assignSpecials(rng.fork('special'), systems, lanes, count);
  assignContents(rng.fork('contents'), systems);
  chooseStarts(rng.fork('starts'), systems, startCount);

  const sectors: Sector[] = centers.map((c, i) => ({
    id: i,
    name: `Sector ${String.fromCharCode(65 + i)}`,
    cx: Math.round(c.x),
    cy: Math.round(c.y),
    systems: systems.filter((s) => s.sector === i).map((s) => s.id),
  }));

  return { seed: config.seed, width: WORLD_WIDTH, height: WORLD_HEIGHT, systems, lanes, sectors, nebulae };
}

function randomInEllipse(rng: Rng, shrink = 1): Point {
  for (;;) {
    const p = { x: rng.range(CENTER.x - RADIUS_X, CENTER.x + RADIUS_X), y: rng.range(CENTER.y - RADIUS_Y, CENTER.y + RADIUS_Y) };
    if (insideEllipse(p, CENTER, RADIUS_X * shrink, RADIUS_Y * shrink)) return p;
  }
}

/** Mitchell's best-candidate sampling: each new centre is the candidate farthest from the others. */
function placeSectorCenters(rng: Rng, n: number): Point[] {
  const centers: Point[] = [];
  for (let i = 0; i < n; i++) {
    let best: Point | null = null;
    let bestScore = -1;
    const candidates = i === 0 ? 1 : 40;
    for (let c = 0; c < candidates; c++) {
      const p = randomInEllipse(rng, 0.86);
      let score = Infinity;
      for (const q of centers) score = Math.min(score, dist(p, q));
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    centers.push(best as Point);
  }
  return centers;
}

function splitCounts(rng: Rng, total: number, sectors: number): number[] {
  const base = Math.floor(total / sectors);
  const counts = new Array<number>(sectors).fill(base);
  let remainder = total - base * sectors;
  for (const i of rng.shuffle(counts.map((_, i) => i))) {
    if (remainder === 0) break;
    counts[i] = (counts[i] ?? base) + 1;
    remainder--;
  }
  // Nudge a few systems between sectors so sizes vary.
  for (let k = 0; k < sectors; k++) {
    const from = rng.int(0, sectors - 1);
    const to = rng.int(0, sectors - 1);
    if (from !== to && (counts[from] ?? 0) > Math.max(5, base - 2)) {
      counts[from] = (counts[from] ?? 0) - 1;
      counts[to] = (counts[to] ?? 0) + 1;
    }
  }
  return counts;
}

function placeSystems(rng: Rng, centers: Point[], counts: number[]): StarSystem[] {
  const systems: StarSystem[] = [];
  const placed: Point[] = [];
  centers.forEach((center, sector) => {
    let nearest = Infinity;
    centers.forEach((other, j) => {
      if (j !== sector) nearest = Math.min(nearest, dist(center, other));
    });
    let radius = Math.max(90, nearest * 0.52);
    const wanted = counts[sector] ?? 0;
    for (let k = 0; k < wanted; k++) {
      let chosen: Point | null = null;
      for (let grow = 0; grow < 6 && !chosen; grow++) {
        let best: Point | null = null;
        let bestGap = -1;
        for (let t = 0; t < 120; t++) {
          const angle = rng.range(0, Math.PI * 2);
          const r = radius * Math.sqrt(rng.next());
          const p = { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
          if (!insideEllipse(p, CENTER, RADIUS_X, RADIUS_Y)) continue;
          let gap = Infinity;
          for (const q of placed) gap = Math.min(gap, dist(p, q));
          if (gap >= MIN_SPACING) {
            chosen = p;
            break;
          }
          if (gap > bestGap) {
            bestGap = gap;
            best = p;
          }
        }
        if (!chosen) {
          if (best && bestGap >= MIN_SPACING * 0.8) chosen = best;
          else radius *= 1.2;
        }
      }
      if (!chosen) chosen = randomInEllipse(rng);
      const p = { x: Math.round(chosen.x), y: Math.round(chosen.y) };
      placed.push(p);
      systems.push({
        id: systems.length,
        name: '',
        sector,
        x: p.x,
        y: p.y,
        star: 'yellow',
        planets: 0,
        pois: 0,
        special: 'none',
        inNebula: false,
        lanes: [],
        startCandidate: false,
      });
    }
  });
  systems.forEach((s) => {
    s.name = `S-${String(s.id).padStart(3, '0')}`;
  });
  return systems;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root] as number;
    while (this.parent[i] !== root) {
      const next = this.parent[i] as number;
      this.parent[i] = root;
      i = next;
    }
    return root;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

interface Pair { a: number; b: number; d: number }

function buildLanes(rng: Rng, systems: StarSystem[], sectorCount: number): Lane[] {
  const lanes: Lane[] = [];
  const have = new Set<string>();
  const key = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const at = (i: number): StarSystem => systems[i] as StarSystem;

  const clear = (a: number, b: number): boolean => {
    const pa = at(a);
    const pb = at(b);
    for (const l of lanes) {
      if (l.kind === 'normal' && segmentsCross(pa, pb, at(l.a), at(l.b))) return false;
    }
    for (const s of systems) {
      if (s.id !== a && s.id !== b && pointSegmentDistance(s, pa, pb) < LANE_CLEARANCE) return false;
    }
    return true;
  };

  const add = (a: number, b: number, kind: LaneKind = 'normal'): Lane | null => {
    if (a === b || have.has(key(a, b))) return null;
    have.add(key(a, b));
    const lane: Lane = {
      id: lanes.length,
      a,
      b,
      length: Math.round(dist(at(a), at(b))),
      kind,
      intersector: at(a).sector !== at(b).sector,
    };
    lanes.push(lane);
    at(a).lanes.push(lane.id);
    at(b).lanes.push(lane.id);
    return lane;
  };

  const degree = (i: number): number => at(i).lanes.length;

  // Pass 1: each system reaches for its two nearest neighbours in its sector.
  for (const s of systems) {
    const neighbours = systems
      .filter((o) => o.sector === s.sector && o.id !== s.id)
      .map((o) => ({ id: o.id, d: dist(s, o) }))
      .sort((p, q) => p.d - q.d);
    let made = 0;
    for (const n of neighbours) {
      if (made >= 2 || n.d > MAX_LOCAL_LANE) break;
      if (degree(s.id) >= MAX_DEGREE || degree(n.id) >= MAX_DEGREE) continue;
      if (have.has(key(s.id, n.id))) {
        made++;
        continue;
      }
      if (clear(s.id, n.id) && add(s.id, n.id)) made++;
    }
  }

  // Pass 2: every sector is internally connected, preferring lanes that cross nothing.
  for (let sector = 0; sector < sectorCount; sector++) {
    const members = systems.filter((s) => s.sector === sector).map((s) => s.id);
    const pairs: Pair[] = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i] as number;
        const b = members[j] as number;
        pairs.push({ a, b, d: dist(at(a), at(b)) });
      }
    }
    pairs.sort((p, q) => p.d - q.d);
    const uf = new UnionFind(systems.length);
    for (const l of lanes) uf.union(l.a, l.b);
    for (const strict of [true, false]) {
      for (const p of pairs) {
        if (uf.find(p.a) === uf.find(p.b)) continue;
        if (strict && !clear(p.a, p.b)) continue;
        if (add(p.a, p.b)) uf.union(p.a, p.b);
      }
    }
  }

  // Pass 3: sectors joined by their closest pairs, as a spanning tree. These are the chokepoints.
  const sectorPairs: { i: number; j: number; candidates: Pair[] }[] = [];
  for (let i = 0; i < sectorCount; i++) {
    for (let j = i + 1; j < sectorCount; j++) {
      const candidates: Pair[] = [];
      for (const a of systems) {
        if (a.sector !== i) continue;
        for (const b of systems) {
          if (b.sector !== j) continue;
          candidates.push({ a: a.id, b: b.id, d: dist(a, b) });
        }
      }
      candidates.sort((p, q) => p.d - q.d);
      sectorPairs.push({ i, j, candidates: candidates.slice(0, 6) });
    }
  }
  sectorPairs.sort((p, q) => (p.candidates[0]?.d ?? Infinity) - (q.candidates[0]?.d ?? Infinity));
  const sectorUf = new UnionFind(sectorCount);
  for (const sp of sectorPairs) {
    if (sectorUf.find(sp.i) === sectorUf.find(sp.j)) continue;
    const pick = sp.candidates.find((c) => clear(c.a, c.b)) ?? sp.candidates[0];
    if (pick && add(pick.a, pick.b)) sectorUf.union(sp.i, sp.j);
  }

  // Pass 4: a few extra lanes between near sectors, so not every border is one chokepoint.
  for (const sp of sectorPairs) {
    const first = sp.candidates[0];
    if (!first || first.d > MAX_EXTRA_INTERSECTOR_LANE) continue;
    if (!rng.chance(0.4)) continue;
    const pick = sp.candidates.find(
      (c) => !have.has(key(c.a, c.b)) && c.d <= MAX_EXTRA_INTERSECTOR_LANE && degree(c.a) < MAX_DEGREE && degree(c.b) < MAX_DEGREE && clear(c.a, c.b),
    );
    if (pick) add(pick.a, pick.b);
  }

  // Pass 5: whatever is still apart gets joined by the shortest possible lane.
  const uf = new UnionFind(systems.length);
  for (const l of lanes) uf.union(l.a, l.b);
  const all: Pair[] = [];
  for (let i = 0; i < systems.length; i++) {
    for (let j = i + 1; j < systems.length; j++) {
      if (uf.find(i) !== uf.find(j)) all.push({ a: i, b: j, d: dist(at(i), at(j)) });
    }
  }
  all.sort((p, q) => p.d - q.d);
  for (const p of all) {
    if (uf.find(p.a) === uf.find(p.b)) continue;
    if (add(p.a, p.b)) uf.union(p.a, p.b);
  }

  return lanes;
}

function assignSpecials(rng: Rng, systems: StarSystem[], lanes: Lane[], count: number): Nebula[] {
  const order = rng.shuffle(systems.map((s) => s.id));
  let cursor = 0;
  const take = (): StarSystem => systems[order[cursor++] as number] as StarSystem;

  const blackHoles = Math.max(1, Math.round(count * 0.04));
  for (let i = 0; i < blackHoles; i++) take().special = 'black-hole';

  const pulsars = count >= 110 ? 3 : 2;
  for (let i = 0; i < pulsars; i++) {
    const p = take();
    p.special = 'pulsar';
    const far = systems.filter((s) => s.id !== p.id && s.special === 'none' && dist(s, p) > WORLD_HEIGHT * 0.3 && dist(s, p) < WORLD_HEIGHT * 0.65);
    if (far.length === 0) continue;
    const target = rng.pick(far);
    const lane: Lane = { id: lanes.length, a: p.id, b: target.id, length: Math.round(dist(p, target)), kind: 'shortcut', intersector: p.sector !== target.sector };
    lanes.push(lane);
    p.lanes.push(lane.id);
    target.lanes.push(lane.id);
  }

  const nebulae: Nebula[] = [];
  const nebulaCount = count >= 110 ? 2 : 1;
  for (let i = 0; i < nebulaCount; i++) {
    const heart = take();
    heart.special = 'nebula-heart';
    const radius = rng.int(130, 190);
    const inside = systems.filter((s) => dist(s, heart) <= radius).map((s) => s.id);
    for (const id of inside) (systems[id] as StarSystem).inNebula = true;
    nebulae.push({ id: i, center: heart.id, radius, systems: inside });
  }
  return nebulae;
}

function assignContents(rng: Rng, systems: StarSystem[]): void {
  for (const s of systems) {
    s.star = STAR_TYPES[rng.weighted(STAR_WEIGHTS)] as StarType;
    const weights = s.special === 'black-hole' ? PLANET_WEIGHTS_BLACK_HOLE : s.special === 'pulsar' ? PLANET_WEIGHTS_PULSAR : PLANET_WEIGHTS_NORMAL;
    s.planets = rng.weighted(weights);
    s.pois = rng.weighted(POI_WEIGHTS);
  }
}

/** Farthest-point sampling over systems fit to be a home, so starts spread across the map. */
function chooseStarts(rng: Rng, systems: StarSystem[], wanted: number): void {
  const eligible = systems.filter((s) => s.special === 'none' && !s.inNebula && s.planets >= 3 && s.lanes.length >= 2);
  if (eligible.length === 0) return;
  const chosen: StarSystem[] = [rng.pick(eligible)];
  while (chosen.length < Math.min(wanted, eligible.length)) {
    let best: StarSystem | null = null;
    let bestGap = -1;
    for (const s of eligible) {
      if (chosen.includes(s)) continue;
      let gap = Infinity;
      for (const c of chosen) gap = Math.min(gap, dist(s, c));
      if (gap > bestGap) {
        bestGap = gap;
        best = s;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  for (const s of chosen) s.startCandidate = true;
}
