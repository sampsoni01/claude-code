import { describe, it, expect } from 'vitest';
import { makeSim } from './helpers';
import { planPurchase, commitPurchase, computeMetrics, reconcile, JURISDICTIONS, ownershipModel, createStorageLocation, assignStorage, ValidationError, availableCapacity, catalogById, revalueAsset, type PurchaseSpec } from '../src/engine';

const carSpec = (over: Partial<PurchaseSpec> = {}): PurchaseSpec => ({
  name: '2026 Porsche 911 Turbo S', category: 'vehicle', details: { kind: 'vehicle', vehicle: { make: 'Porsche', model: '911 Turbo S', year: 2026 } },
  price: { value: 300_000, source: { type: 'user_entered' } }, ...over,
});

describe('cash purchase', () => {
  it('converts cash to an asset; net worth falls only by taxes and fees', () => {
    const s0 = makeSim();
    const j = JURISDICTIONS['US-NY'];
    const model = ownershipModel('vehicle', 300_000, j);
    const plan = planPurchase(s0, carSpec());
    expect(plan.cashRequired).toBe(300_000 + model.acquisition.salesTax + model.acquisition.fees);
    const { state: s1, assetId } = commitPurchase(s0, carSpec());
    const m0 = computeMetrics(s0), m1 = computeMetrics(s1);
    expect(m1.cash).toBeCloseTo(m0.cash - plan.cashRequired, 2);
    expect(s1.assets[assetId].currentValue).toBe(300_000);
    expect(m1.netWorth).toBeCloseTo(m0.netWorth - model.acquisition.salesTax - model.acquisition.fees, 2);
    expect(m1.totalAssets).toBeCloseTo(m0.totalAssets - model.acquisition.salesTax - model.acquisition.fees, 2);
    expect(reconcile(s1).ok).toBe(true);
    // original untouched
    expect(computeMetrics(s0).cash).toBe(20_000_000);
  });

  it('creates recurring ownership costs attached to the asset', () => {
    const { state: s, assetId } = commitPurchase(makeSim(), carSpec());
    const a = s.assets[assetId];
    expect(a.recurringIds.length).toBeGreaterThanOrEqual(3);
    const names = a.recurringIds.map((id) => s.recurring[id].name);
    expect(names.some((n) => /insurance/i.test(n))).toBe(true);
    expect(a.acquisition?.transactionId).toBeDefined();
  });

  it('records an acquisition snapshot that survives later revaluation', () => {
    const { state: s, assetId } = commitPurchase(makeSim(), carSpec({ listing: { source: { type: 'retrieved_real_world', label: 'Dealer listing', reference: 'https://example.invalid/x', retrievedOn: '2026-01-01' }, listingPrice: 300_000, listingId: 'L1' } }));
    const snap = JSON.stringify(s.assets[assetId].acquisition);
    revalueAsset(s, assetId, 250_000, { type: 'market_estimate', label: 'test' });
    expect(JSON.stringify(s.assets[assetId].acquisition)).toBe(snap);
    expect(s.assets[assetId].currentValue).toBe(250_000);
    expect(s.assets[assetId].purchasePrice).toBe(300_000);
    expect(s.valuations.length).toBe(1);
  });

  it('allows overspending but warns (net worth ≠ liquidity)', () => {
    const s0 = makeSim({ startingCash: 1_000_000 });
    const plan = planPurchase(s0, carSpec({ price: { value: 5_000_000, source: { type: 'user_entered' } } }));
    expect(plan.cashShortfall).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => /liquidity|financing/i.test(w))).toBe(true);
    const { state: s1 } = commitPurchase(s0, carSpec({ price: { value: 5_000_000, source: { type: 'user_entered' } } }));
    expect(computeMetrics(s1).cash).toBeLessThan(0);
  });

  it('rejects duplicate commits with the same idempotency key', () => {
    const s0 = makeSim();
    const { state: s1 } = commitPurchase(s0, carSpec({ idempotencyKey: 'k1' }));
    expect(() => commitPurchase(s1, carSpec({ idempotencyKey: 'k1' }))).toThrow(/Duplicate/);
  });
});

describe('financed purchase', () => {
  it('creates a liability; net worth unaffected by the loan itself', () => {
    const s0 = makeSim();
    const spec = carSpec({ financing: { kind: 'auto_loan', downPaymentPct: 0.2, annualRate: 0.06, termMonths: 60 } });
    const plan = planPurchase(s0, spec);
    expect(plan.downPayment).toBe(60_000);
    expect(plan.loanAmount).toBe(240_000);
    expect(plan.loanMonthlyPayment).toBeCloseTo(4639.83, 0);
    const { state: s1, assetId } = commitPurchase(s0, spec);
    const m0 = computeMetrics(s0), m1 = computeMetrics(s1);
    expect(m1.totalLiabilities).toBe(m0.totalLiabilities + 240_000);
    expect(m1.cash).toBeCloseTo(m0.cash - plan.cashRequired, 2);
    expect(m1.netWorth).toBeCloseTo(m0.netWorth - plan.salesTax - plan.fees, 2);
    expect(s1.assets[assetId].liabilityIds.length).toBe(1);
    expect(reconcile(s1).ok).toBe(true);
  });

  it('mortgage with 40% down on a property', () => {
    const s0 = makeSim();
    const spec: PurchaseSpec = { name: 'London townhouse', category: 'real_estate', details: { kind: 'property', property: { address: 'Belgravia', propertyType: 'townhouse', use: 'vacation_residence', garageCapacity: 2, parkingSpaces: 2, storageCapacity: 20, annualPropertyTaxRate: 0.002 } }, price: { value: 15_000_000, source: { type: 'user_entered' } }, financing: { kind: 'mortgage', downPaymentPct: 0.4, annualRate: 0.055, termMonths: 300 } };
    const { state: s1, assetId } = commitPurchase(s0, spec);
    expect(s1.liabilities[s1.assets[assetId].liabilityIds[0]].balance).toBe(9_000_000);
    // property created a garage storage location
    expect(Object.values(s1.storage).some((l) => l.propertyId === assetId && l.kind === 'property_garage' && l.capacity === 2)).toBe(true);
    expect(reconcile(s1).ok).toBe(true);
  });
});

describe('storage capacity', () => {
  it('assigns a vehicle to available garage space and refuses when full', () => {
    let s = makeSim(); // Tribeca loft garage capacity 2
    const r1 = commitPurchase(s, carSpec()); s = r1.state;
    const r2 = commitPurchase(s, carSpec({ name: 'Car 2' })); s = r2.state;
    const garage = Object.values(s.storage).find((l) => l.kind === 'property_garage')!;
    expect(s.assets[r1.assetId].storageLocationId).toBe(garage.id);
    expect(availableCapacity(s, garage.id)).toBe(0);
    const plan3 = planPurchase(s, carSpec({ name: 'Car 3' }));
    expect(plan3.storage.locationId).toBeNull();
    expect(plan3.storage.options.length).toBeGreaterThan(0);
    const r3 = commitPurchase(s, carSpec({ name: 'Car 3' })); s = r3.state;
    expect(s.assets[r3.assetId].storageLocationId).toBeNull();
    expect(() => assignStorage(s, r3.assetId, garage.id)).toThrow(ValidationError);
    // rent a garage → assign
    const rented = createStorageLocation(s, { name: 'Rented garage', kind: 'rented_garage', capacity: 1, monthlyRent: 800 });
    assignStorage(s, r3.assetId, rented.id);
    expect(s.assets[r3.assetId].storageLocationId).toBe(rented.id);
    expect(Object.values(s.recurring).some((r) => r.storageLocationId === rented.id && r.amount.value === 800)).toBe(true);
    // never in two places: moving replaces
    const rented2 = createStorageLocation(s, { name: 'Rented garage 2', kind: 'rented_garage', capacity: 1 });
    assignStorage(s, r3.assetId, rented2.id);
    expect(availableCapacity(s, rented.id)).toBe(1);
    expect(availableCapacity(s, rented2.id)).toBe(0);
  });

  it('a hangar does not accept cars', () => {
    let s = makeSim();
    const r = commitPurchase(s, carSpec()); s = r.state;
    const hangar = createStorageLocation(s, { name: 'Hangar', kind: 'hangar', capacity: 1 });
    expect(() => assignStorage(s, r.assetId, hangar.id)).toThrow(/cannot store/);
  });
});

describe('catalog', () => {
  it('has consistent categories and reference source', () => {
    const item = catalogById('car_ferrari_12c')!;
    expect(item.category).toBe('vehicle');
    expect(item.price).toBeGreaterThan(0);
  });
});
