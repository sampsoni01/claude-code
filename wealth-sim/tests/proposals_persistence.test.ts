import { describe, it, expect } from 'vitest';
import { makeSim } from './helpers';
import { newProposal, previewProposal, commitProposal, respond, reconcile, computeMetrics, serialize, deserialize, advanceTime, createProject, createEvent, estimateEvent, runScenario, manualListing, commitPurchase, searchAssets, cloneState, type Primitive } from '../src/engine';

describe('AI-created custom objects', () => {
  it('assistant builds a horse proposal from primitives and commit is atomic', () => {
    const s0 = makeSim();
    const reply = respond(s0, 'Keep three horses at a stable');
    expect(reply.proposal).toBeDefined();
    const prims = reply.proposal!.primitives;
    expect(prims.filter((p) => p.kind === 'custom_asset').length).toBe(3);
    const preview = previewProposal(s0, reply.proposal!);
    expect(preview.annualRecurring).toBeGreaterThan(100_000);
    expect(computeMetrics(s0).cash).toBe(20_000_000); // preview didn't touch
    const { state: s1, refs } = commitProposal(s0, reply.proposal!);
    expect(Object.keys(refs).length).toBe(3);
    const horses = Object.values(s1.assets).filter((a) => a.name.startsWith('Horse'));
    expect(horses.length).toBe(3);
    expect(horses[0].recurringIds.length).toBe(3);
    expect(horses[0].assumptions.length).toBeGreaterThan(0);
    expect(reconcile(s1).ok).toBe(true);
  });

  it('a proposal that fails midway rolls back entirely', () => {
    const s0 = makeSim();
    const prims: Primitive[] = [
      { kind: 'recurring_expense', name: 'ok', category: 'custom', amount: { value: 100, source: { type: 'user_entered' } }, interval: 'monthly' },
      { kind: 'recurring_expense', name: 'bad', category: 'custom', amount: { value: 100, source: { type: 'user_entered' } }, interval: 'monthly', assetRef: 'does-not-exist' },
    ];
    const p = newProposal(s0, { title: 't', explanation: '', primitives: prims, assumptions: [], createdBy: 'assistant' });
    expect(() => commitProposal(s0, p)).toThrow(/Unknown asset reference/);
    expect(Object.values(s0.recurring).some((r) => r.name === 'ok')).toBe(false);
  });

  it('hire chef → staff + food budget with transparent assumptions', () => {
    const s0 = makeSim();
    const reply = respond(s0, 'Hire a Michelin-level private chef');
    expect(reply.proposal!.primitives.some((p) => p.kind === 'staff')).toBe(true);
    const { state: s1 } = commitProposal(s0, reply.proposal!);
    const staff = Object.values(s1.staff)[0];
    expect(staff.assumptions.some((a) => a.kind === 'real_world_data')).toBe(true);
    expect(staff.assumptions.some((a) => a.kind === 'simulation_assumption')).toBe(true);
    expect(staff.assumptions.some((a) => a.kind === 'calculated_value')).toBe(true);
  });

  it('assistant purchase goes through the same engine (catalog car with financing)', () => {
    const s0 = makeSim();
    const reply = respond(s0, 'Buy a Ferrari 12Cilindri with 20% down financing');
    expect(reply.proposal).toBeDefined();
    const prim = reply.proposal!.primitives[0];
    if (prim.kind !== 'asset') throw new Error();
    expect(prim.spec.financing?.kind).toBe('auto_loan');
    expect(prim.spec.price.source.type).toBe('builtin_reference');
    const { state: s1 } = commitProposal(s0, reply.proposal!);
    expect(Object.values(s1.liabilities).some((l) => l.kind === 'auto_loan')).toBe(true);
    expect(reconcile(s1).ok).toBe(true);
  });

  it('what-if scenarios never mutate live state', () => {
    const s0 = makeSim();
    const before = JSON.stringify(s0);
    const reply = respond(s0, 'What if the stock market falls 30%?');
    expect(reply.scenario).toBeDefined();
    expect(reply.scenario!.immediate.after.netWorth).toBeLessThan(reply.scenario!.immediate.before.netWorth);
    // id counters may advance but nothing financial changes
    const after = JSON.parse(JSON.stringify(s0)); const b = JSON.parse(before);
    expect(after.ledger).toEqual(b.ledger); expect(after.assets).toEqual(b.assets);
    const r2 = runScenario(s0, 'house', [{ kind: 'purchase', spec: { name: 'House', category: 'real_estate', details: { kind: 'property', property: { address: 'x', propertyType: 'house', use: 'primary_residence', garageCapacity: 2, parkingSpaces: 2, storageCapacity: 10, annualPropertyTaxRate: 0.01 } }, price: { value: 45_000_000, source: { type: 'user_entered' } } } }], 5);
    expect(r2.warnings.length).toBeGreaterThan(0);
    expect(r2.scenario.length).toBe(6);
  });
});

describe('projects and events', () => {
  it('project spreads payments over time and capitalizes part into the property', () => {
    let s = makeSim({ investments: [] });
    const loft = Object.values(s.assets).find((a) => a.category === 'real_estate')!;
    loft.valueRule = { annualRate: 0, annualVolatility: 0, source: { type: 'user_entered' } };
    const p = createProject(s, { name: 'Kitchen', attachedAssetId: loft.id, estimatedCost: { value: 400_000, source: { type: 'user_entered' } }, durationMonths: 4, contingencyRate: 0.1 });
    expect(p.payments.length).toBe(5);
    expect(p.payments[0].paid).toBe(true);
    const v0 = s.assets[loft.id].currentValue;
    s = advanceTime(s, 'month', 5);
    const proj = s.projects[p.id];
    expect(proj.status).toBe('completed');
    expect(proj.actualCost).toBeCloseTo(440_000, 0);
    expect(s.assets[loft.id].currentValue).toBeCloseTo(v0 + 165_000, 0); // 50% of the remaining 330k (v0 already includes the deposit's capitalized share)
    expect(reconcile(s).ok).toBe(true);
  });

  it('event costs scale with guests and tiers', () => {
    const small = estimateEvent({ name: 'a', kind: 'dinner', location: 'x', guestCount: 20, venueTier: 'standard', foodTier: 'standard', entertainment: 'none', security: false, transportation: false, decorTier: 'standard', production: false });
    const big = estimateEvent({ name: 'b', kind: 'gala', location: 'x', guestCount: 300, venueTier: 'ultra', foodTier: 'ultra', entertainment: 'headline_act', security: true, transportation: true, decorTier: 'ultra', production: true });
    expect(big.total).toBeGreaterThan(small.total * 20);
    const s = makeSim();
    const ev = createEvent(s, { name: 'Dinner', kind: 'dinner', location: 'x', guestCount: 20, venueTier: 'standard', foodTier: 'standard', entertainment: 'none', security: false, transportation: false, decorTier: 'standard', production: false });
    expect(ev.status).toBe('held');
    expect(s.ledger.some((t) => t.eventId === ev.id)).toBe(true);
  });
});

describe('external data and persistence', () => {
  it('builtin provider search returns sourced listings', async () => {
    const { results, provider } = await searchAssets('gulfstream');
    expect(provider?.id).toBe('builtin');
    expect(results[0].listing.source.type).toBe('builtin_reference');
  });

  it('manual listing import is snapshotted on the asset', () => {
    const s0 = makeSim();
    const listing = manualListing({ price: 27_500_000, sourceLabel: 'Broker listing', url: 'https://example.invalid/listing/1', retrievedOn: '2026-01-01', location: 'Tribeca', specifications: { sqft: 6000 }, listingId: 'ABC' });
    const { state: s1, assetId } = commitPurchase(s0, { name: 'Penthouse', category: 'real_estate', details: { kind: 'property', property: { address: 'Tribeca', propertyType: 'penthouse', use: 'primary_residence', garageCapacity: 1, parkingSpaces: 1, storageCapacity: 10, annualPropertyTaxRate: 0.009 } }, price: { value: listing.listingPrice, source: listing.source }, listing });
    expect(s1.assets[assetId].acquisition!.listing!.listingId).toBe('ABC');
    expect(s1.assets[assetId].acquisition!.price.source.type).toBe('retrieved_real_world');
  });

  it('save/load round trip preserves ids, balances, and produces identical futures', () => {
    let s = makeSim();
    s = commitPurchase(s, { name: 'Car', category: 'vehicle', details: { kind: 'vehicle', vehicle: { make: 'X', model: 'Y', year: 2026 } }, price: { value: 200_000, source: { type: 'user_entered' } } }).state;
    s = advanceTime(s, 'month', 7);
    const json = serialize(s);
    const loaded = deserialize(json);
    expect(loaded).toEqual(s);
    expect(Object.keys(loaded.assets)).toEqual(Object.keys(s.assets));
    const a = advanceTime(cloneState(s), 'year', 1), b = advanceTime(loaded, 'year', 1);
    expect(computeMetrics(a)).toEqual(computeMetrics(b));
    expect(reconcile(b).ok).toBe(true);
    expect(() => deserialize('{"nope":1}')).toThrow();
  });
});
