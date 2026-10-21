import { describe, expect, it } from 'vitest';
import { generateGalaxy, MIN_SPACING, WORLD_HEIGHT, WORLD_WIDTH } from '../src/core/galaxy/generate';
import { dist, segmentsCross } from '../src/core/geometry';
import type { Galaxy } from '../src/core/galaxy/types';

const SEEDS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'];
const SIZES = [80, 100, 120, 150];

function connected(g: Galaxy): boolean {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const id = queue.pop() as number;
    for (const laneId of (g.systems[id] as Galaxy['systems'][number]).lanes) {
      const lane = g.lanes[laneId] as Galaxy['lanes'][number];
      const other = lane.a === id ? lane.b : lane.a;
      if (!seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen.size === g.systems.length;
}

describe('generateGalaxy', () => {
  it('is deterministic for a seed', () => {
    const a = JSON.stringify(generateGalaxy({ seed: 'ALPHA', systems: 120 }));
    const b = JSON.stringify(generateGalaxy({ seed: 'ALPHA', systems: 120 }));
    expect(a).toBe(b);
  });

  it('differs between seeds', () => {
    const a = JSON.stringify(generateGalaxy({ seed: 'ALPHA', systems: 100 }));
    const b = JSON.stringify(generateGalaxy({ seed: 'BRAVO', systems: 100 }));
    expect(a).not.toBe(b);
  });

  for (const size of SIZES) {
    for (const seed of SEEDS) {
      it(`${size} systems, seed ${seed}: well formed`, () => {
        const g = generateGalaxy({ seed, systems: size });
        expect(g.systems.length).toBe(size);
        expect(connected(g)).toBe(true);

        for (const s of g.systems) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(WORLD_WIDTH);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(WORLD_HEIGHT);
          expect(s.lanes.length).toBeGreaterThanOrEqual(1);
          expect(s.lanes.length).toBeLessThanOrEqual(8);
          expect(s.planets).toBeGreaterThanOrEqual(0);
          expect(s.planets).toBeLessThanOrEqual(7);
          expect(s.pois).toBeLessThanOrEqual(2);
        }

        let tooClose = 0;
        for (let i = 0; i < g.systems.length; i++) {
          for (let j = i + 1; j < g.systems.length; j++) {
            if (dist(g.systems[i]!, g.systems[j]!) < MIN_SPACING * 0.8) tooClose++;
          }
        }
        expect(tooClose).toBe(0);

        const normal = g.lanes.filter((l) => l.kind === 'normal');
        let crossings = 0;
        for (let i = 0; i < normal.length; i++) {
          for (let j = i + 1; j < normal.length; j++) {
            const p = normal[i]!;
            const q = normal[j]!;
            if (segmentsCross(g.systems[p.a]!, g.systems[p.b]!, g.systems[q.a]!, g.systems[q.b]!)) crossings++;
          }
        }
        // Connectivity fallbacks may cross once in a while; it must stay rare.
        expect(crossings).toBeLessThanOrEqual(3);

        const starts = g.systems.filter((s) => s.startCandidate);
        expect(starts.length).toBe(7);
        for (let i = 0; i < starts.length; i++) {
          for (let j = i + 1; j < starts.length; j++) {
            expect(dist(starts[i]!, starts[j]!)).toBeGreaterThan(180);
          }
        }

        expect(g.systems.filter((s) => s.special === 'black-hole').length).toBeGreaterThanOrEqual(1);
        expect(g.systems.filter((s) => s.special === 'pulsar').length).toBeGreaterThanOrEqual(2);
        expect(g.nebulae.length).toBeGreaterThanOrEqual(1);
        expect(g.lanes.filter((l) => l.intersector && l.kind === 'normal').length).toBeGreaterThanOrEqual(g.sectors.length - 1);
      });
    }
  }
});
