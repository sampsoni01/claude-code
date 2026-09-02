import { describe, it, expect } from 'vitest';
import { makeSim } from './helpers';
import { commitPurchase, planSale, commitSale, computeMetrics, reconcile, advanceTime, revalueAsset, JURISDICTIONS, sellingCosts, type PurchaseSpec } from '../src/engine';

const carSpec: PurchaseSpec = { name: 'Car', category: 'vehicle', details: { kind: 'vehicle', vehicle: { make: 'X', model: 'Y', year: 2026 } }, price: { value: 300_000, source: { type: 'user_entered' } } };

describe('asset sale', () => {
  it('converts asset back to cash net of fees and records gain vs basis', () => {
    let s = makeSim();
    const { state: s1, assetId } = commitPurchase(s, carSpec); s = s1;
    revalueAsset(s, assetId, 280_000, { type: 'market_estimate', label: 'test' });
    const plan = planSale(s, assetId, { value: 250_000, source: { type: 'user_entered' } });
    const fees = sellingCosts('vehicle', 250_000, JURISDICTIONS['US-NY']).fees;
    expect(plan.fees).toBe(fees);
    expect(plan.netProceeds).toBe(250_000 - fees);
    expect(plan.taxableGain).toBe(250_000 - fees - s.assets[assetId].costBasis);
    const m0 = computeMetrics(s);
    const { state: s2 } = commitSale(s, assetId, { value: 250_000, source: { type: 'user_entered' } });
    const m1 = computeMetrics(s2);
    expect(m1.cash).toBeCloseTo(m0.cash + 250_000 - fees, 2);
    expect(m1.netWorth).toBeCloseTo(m0.netWorth - 280_000 + 250_000 - fees, 2);
    expect(s2.assets[assetId].status).toBe('sold');
    expect(s2.assets[assetId].sale?.proceeds).toBe(250_000 - fees);
    // recurring ended
    expect(s2.assets[assetId].recurringIds.every((id) => s2.recurring[id].status === 'ended')).toBe(true);
    // history preserved
    expect(s2.assets[assetId].purchasePrice).toBe(300_000);
    expect(reconcile(s2).ok).toBe(true);
  });

  it('pays off attached loan from proceeds', () => {
    let s = makeSim();
    const { state: s1, assetId } = commitPurchase(s, { ...carSpec, financing: { kind: 'auto_loan', downPaymentPct: 0.2, annualRate: 0.06, termMonths: 60 } }); s = s1;
    const loanId = s.assets[assetId].liabilityIds[0];
    const bal = s.liabilities[loanId].balance;
    const m0 = computeMetrics(s);
    const plan = planSale(s, assetId, { value: 300_000, source: { type: 'user_entered' } });
    expect(plan.loanPayoff).toBe(bal);
    const { state: s2 } = commitSale(s, assetId, { value: 300_000, source: { type: 'user_entered' } });
    expect(s2.liabilities[loanId].status).toBe('settled');
    expect(s2.liabilities[loanId].balance).toBe(0);
    expect(computeMetrics(s2).totalLiabilities).toBe(m0.totalLiabilities - bal);
    expect(reconcile(s2).ok).toBe(true);
  });

  it('long-term vs short-term classification', () => {
    let s = makeSim();
    const { state: s1, assetId } = commitPurchase(s, carSpec); s = s1;
    expect(planSale(s, assetId, { value: 1, source: { type: 'user_entered' } }).longTerm).toBe(false);
    s = advanceTime(s, 'year', 2);
    expect(planSale(s, assetId, { value: 1, source: { type: 'user_entered' } }).longTerm).toBe(true);
  });

  it('selling a property closes its garage and unassigns the cars', () => {
    let s = makeSim();
    const { state: s1, assetId } = commitPurchase(s, carSpec); s = s1;
    const loft = Object.values(s.assets).find((a) => a.category === 'real_estate')!;
    expect(s.assets[assetId].storageLocationId).not.toBeNull();
    const { state: s2 } = commitSale(s, loft.id, { value: 16_000_000, source: { type: 'user_entered' } });
    expect(s2.assets[assetId].storageLocationId).toBeNull();
    expect(Object.values(s2.storage).filter((l) => l.propertyId === loft.id).every((l) => l.status === 'closed')).toBe(true);
    expect(reconcile(s2).ok).toBe(true);
  });
});
