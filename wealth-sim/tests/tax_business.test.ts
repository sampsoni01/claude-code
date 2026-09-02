import { describe, it, expect } from 'vitest';
import { makeSim } from './helpers';
import { advanceTime, computeMetrics, reconcile, JURISDICTIONS, bracketTax, computeAnnualSettlement, commitSale, commitPurchase, distributeRetainedEarnings, businessProfit, type PurchaseSpec } from '../src/engine';

describe('taxes', () => {
  it('bracket tax is progressive', () => {
    const j = JURISDICTIONS['US-FL'];
    expect(bracketTax(0, j.ordinaryBrackets)).toBe(0);
    expect(bracketTax(100_000, j.ordinaryBrackets)).toBeLessThan(100_000 * 0.22);
    expect(bracketTax(3_000_000, j.ordinaryBrackets) / 3_000_000).toBeGreaterThan(0.33);
  });

  it('no-income-tax jurisdiction withholds nothing', () => {
    const s = advanceTime(makeSim({ taxJurisdiction: 'AE', investments: [], properties: [] }), 'month', 1);
    const sal = s.ledger.find((t) => t.type === 'salary')!;
    expect(sal.cashEffect).toBe(250_000);
  });

  it('capital gains from a sale are settled in the annual settlement', () => {
    let s = makeSim({ investments: [], properties: [], annualSalary: 0 });
    const art: PurchaseSpec = { name: 'Painting', category: 'art', details: { kind: 'generic', fields: {} }, price: { value: 1_000_000, source: { type: 'user_entered' } }, valueRule: { annualRate: 0, annualVolatility: 0, source: { type: 'user_entered' } } };
    const r = commitPurchase(s, art); s = r.state;
    s = advanceTime(s, 'month', 14); // long-term
    const { state: s2 } = commitSale(s, r.assetId, { value: 3_000_000, source: { type: 'user_entered' } });
    s = s2;
    expect(s.taxYear.capitalGainsLong).toBeGreaterThan(1_000_000);
    const settlement = computeAnnualSettlement(s.taxYear, JURISDICTIONS['US-NY']);
    expect(settlement.capitalGainsTax).toBeGreaterThan(0);
    s = advanceTime(s, 'month', 14); // through next April
    const tx = s.ledger.filter((t) => t.type === 'tax_settlement');
    expect(tx.length).toBeGreaterThanOrEqual(1);
    expect(tx.some((t) => t.cashEffect < -100_000)).toBe(true);
    expect(reconcile(s).ok).toBe(true);
  });

  it('property tax and sales tax are recorded', () => {
    let s = makeSim({ investments: [] });
    s = advanceTime(s, 'year', 1);
    expect(s.ledger.filter((t) => t.type === 'property_tax').length).toBe(4);
    const r = commitPurchase(s, { name: 'Car', category: 'vehicle', details: { kind: 'vehicle', vehicle: { make: 'X', model: 'Y', year: 2026 } }, price: { value: 100_000, source: { type: 'user_entered' } } });
    expect(r.state.taxYear.salesTaxPaid).toBeCloseTo(100_000 * JURISDICTIONS['US-NY'].vehicleSalesTaxRate, 2);
  });
});

describe('businesses', () => {
  const biz: PurchaseSpec = { name: 'Car wash chain', category: 'business', details: { kind: 'business', business: { industry: 'Services', annualRevenue: 12_000_000, annualOperatingExpenses: 5_000_000, annualPayroll: 4_000_000, employees: 80, ownershipPct: 1, annualGrowthRate: 0.05, distributionRate: 0.5, valuationMultiple: 6, retainedEarnings: 0 } }, price: { value: 18_000_000, source: { type: 'user_entered' } } };

  it('profit is split between distributions (cash income) and retained earnings (asset value)', () => {
    let s = makeSim({ investments: [], properties: [], annualSalary: 0 });
    s.settings.realismEventsEnabled = false;
    const r = commitPurchase(s, biz); s = r.state;
    const m0 = computeMetrics(s);
    s = advanceTime(s, 'month', 1);
    const dist = s.ledger.filter((t) => t.type === 'business_distribution');
    const result = s.ledger.filter((t) => t.type === 'business_result');
    expect(dist.length).toBe(1);
    expect(result.length).toBe(1);
    const distAmt = dist[0].cashEffect;
    const retained = result[0].postings.find((p) => p.kind === 'asset')!.amount;
    // revenue noise ±6% → profit around 250k/mo; distribution ≈ retained
    expect(distAmt).toBeGreaterThan(50_000);
    expect(Math.abs(distAmt - retained)).toBeLessThan(1);
    expect(computeMetrics(s).cash).toBeGreaterThan(m0.cash + distAmt - 200_000); // minus interest-free month expenses
    // revenue is not personal income
    const inc = s.ledger.filter((t) => t.postings.some((p) => p.kind === 'income' && p.amount > 500_000));
    expect(inc.length).toBe(0);
    expect(reconcile(s).ok).toBe(true);
  });

  it('annual revaluation on profit × multiple and special distributions reduce value', () => {
    let s = makeSim({ investments: [], properties: [], annualSalary: 0 });
    const r = commitPurchase(s, biz); s = r.state;
    s = advanceTime(s, 'year', 1);
    const a = s.assets[r.assetId];
    if (a.details.kind !== 'business') throw new Error();
    expect(a.details.business.retainedEarnings).toBeGreaterThan(1_000_000);
    expect(s.valuations.some((v) => v.assetId === a.id)).toBe(true);
    const before = computeMetrics(s);
    distributeRetainedEarnings(s, a.id, 1_000_000);
    const after = computeMetrics(s);
    expect(after.cash).toBeCloseTo(before.cash + 1_000_000, 2);
    expect(after.netWorth).toBeCloseTo(before.netWorth, 2);
    expect(businessProfit(a.details.business)).toBeGreaterThan(0);
    expect(reconcile(s).ok).toBe(true);
  });
});
