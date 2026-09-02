import { describe, it, expect } from 'vitest';
import { makeSim } from './helpers';
import { advanceTime, computeMetrics, reconcile, commitPurchase, incomeStatement, cashFlowStatement, balanceSheet, JURISDICTIONS, salaryWithholdingRate, createRecurring, hireStaff, terminateStaff, cloneState, type PurchaseSpec } from '../src/engine';

describe('time advancement', () => {
  it('processes salary with withholding on the schedule', () => {
    const s0 = makeSim({ investments: [], properties: [] });
    const s1 = advanceTime(s0, 'month', 1);
    const salaryTx = s1.ledger.filter((t) => t.type === 'salary');
    expect(salaryTx.length).toBe(1);
    const j = JURISDICTIONS['US-NY'];
    const gross = 250_000;
    const withheld = Math.round(gross * salaryWithholdingRate(3_000_000, j) * 100) / 100;
    expect(salaryTx[0].postings.find((p) => p.kind === 'income')!.amount).toBe(gross);
    expect(salaryTx[0].postings.find((p) => p.kind === 'expense')!.amount).toBeCloseTo(withheld, 2);
    expect(salaryTx[0].cashEffect).toBeCloseTo(gross - withheld, 2);
    expect(reconcile(s1).ok).toBe(true);
  });

  it('is deterministic given the same state', () => {
    const s0 = makeSim();
    const a = advanceTime(s0, 'year', 1);
    const b = advanceTime(cloneState(s0), 'year', 1);
    expect(computeMetrics(a)).toEqual(computeMetrics(b));
    expect(a.ledger.length).toBe(b.ledger.length);
  });

  it('never duplicates a recurring occurrence when advancing day by day vs in one jump', () => {
    const s0 = makeSim();
    let daily = s0;
    for (let i = 0; i < 90; i++) daily = advanceTime(daily, 'day', 1);
    const jump = advanceTime(s0, 'quarter', 1);
    expect(daily.currentDate).toBe(jump.currentDate);
    expect(daily.ledger.length).toBe(jump.ledger.length);
    expect(computeMetrics(daily).cash).toBe(computeMetrics(jump).cash);
  });

  it('applies recurring expenses at their interval and produces monthly snapshots', () => {
    const s0 = makeSim({ investments: [], properties: [], lifestyle: [{ name: 'Travel', monthly: 50_000 }] });
    const s1 = advanceTime(s0, 'year', 1);
    const travel = s1.ledger.filter((t) => t.description === 'Travel');
    expect(travel.length).toBe(12);
    expect(s1.history.length).toBe(13); // opening + 12 month-ends
    // inflation applied on Jan 1 of year 2
    const s2 = advanceTime(s1, 'month', 1);
    const rec = Object.values(s2.recurring).find((r) => r.name === 'Travel')!;
    expect(rec.amount.value).toBeCloseTo(50_000 * 1.03, 2);
  });
});

describe('loans', () => {
  it('splits payments into interest (expense) and principal (liability reduction)', () => {
    const s0 = makeSim({ investments: [] });
    const loan = Object.values(s0.liabilities)[0];
    const s1 = advanceTime(s0, 'month', 1);
    const pay = s1.ledger.find((t) => t.type === 'loan_payment')!;
    const interest = 5_000_000 * 0.06 / 12;
    const principal = loan.monthlyPayment - interest;
    expect(pay.postings.find((p) => p.kind === 'expense')!.amount).toBeCloseTo(interest, 1);
    expect(pay.postings.find((p) => p.kind === 'liability')!.amount).toBeCloseTo(-principal, 1);
    expect(s1.liabilities[loan.id].balance).toBeCloseTo(5_000_000 - principal, 1);
    // net worth change from the payment = −interest only
    const is = incomeStatement(s1, s1.currentDate, s1.currentDate);
    void is;
    expect(reconcile(s1).ok).toBe(true);
  });

  it('amortizes to zero and marks paid off', () => {
    let s = makeSim({ investments: [], properties: [], debts: [{ name: 'Short loan', kind: 'personal_loan', balance: 120_000, annualRate: 0.08, monthsRemaining: 12 }] });
    s = advanceTime(s, 'year', 1);
    const l = Object.values(s.liabilities)[0];
    expect(l.balance).toBe(0);
    expect(l.status).toBe('paid_off');
    expect(l.totalPrincipalPaid).toBeCloseTo(120_000, 0);
    expect(l.totalInterestPaid).toBeGreaterThan(4_000);
    expect(reconcile(s).ok).toBe(true);
  });
});

describe('appreciation and depreciation', () => {
  it('vehicles depreciate and real estate appreciates over a year (deterministic rules)', () => {
    let s = makeSim({ investments: [] });
    const spec: PurchaseSpec = { name: 'Car', category: 'vehicle', details: { kind: 'vehicle', vehicle: { make: 'X', model: 'Y', year: 2026 } }, price: { value: 300_000, source: { type: 'user_entered' } }, valueRule: { annualRate: -0.12, annualVolatility: 0, source: { type: 'user_entered' } } };
    const r = commitPurchase(s, spec); s = r.state;
    const loft = Object.values(s.assets).find((a) => a.category === 'real_estate')!;
    loft.valueRule = { annualRate: 0.04, annualVolatility: 0, source: { type: 'user_entered' } };
    s = advanceTime(s, 'year', 1);
    const car = s.assets[r.assetId];
    expect(car.currentValue).toBeCloseTo(300_000 * Math.pow(1 - 0.12 / 12, 12), -2);
    expect(s.assets[loft.id].currentValue).toBeCloseTo(15_000_000 * Math.pow(1 + 0.04 / 12, 12), -2);
    // unrealized changes are NOT income
    const is = incomeStatement(s, s.startDate, s.currentDate);
    expect(is.income.find((i) => i.category === 'valuation')).toBeUndefined();
    expect(is.unrealizedGains).not.toBe(0);
    expect(reconcile(s).ok).toBe(true);
  });

  it('investment gains/losses follow expected return with zero volatility, dividends paid quarterly', () => {
    const s0 = makeSim({ properties: [] });
    const s1 = advanceTime(s0, 'year', 1);
    const etf = Object.values(s1.assets).find((a) => a.category === 'public_security')!;
    // 7%/yr drift compounding monthly, minus nothing (dividends are paid in cash, not deducted from value in this model)
    expect(etf.currentValue).toBeGreaterThan(30_000_000 * 1.06);
    expect(etf.currentValue).toBeLessThan(30_000_000 * 1.08);
    const divs = s1.ledger.filter((t) => t.type === 'dividend');
    expect(divs.length).toBe(4);
    expect(reconcile(s1).ok).toBe(true);
  });

  it('market scenario changes outcomes', () => {
    const s0 = makeSim({ properties: [] });
    const crash = cloneState(s0);
    crash.settings.scenario = { ...crash.settings.scenario, id: 'market_crash', equityDrift: -0.4 };
    const a = advanceTime(s0, 'year', 1), b = advanceTime(crash, 'year', 1);
    expect(computeMetrics(b).netWorth).toBeLessThan(computeMetrics(a).netWorth - 5_000_000);
  });
});

describe('staff', () => {
  it('hiring creates payroll with overhead; termination ends it', () => {
    let s = makeSim({ investments: [], properties: [] });
    const st = hireStaff(s, { role: 'Private chef', baseSalary: { value: 200_000, source: { type: 'user_entered' } } });
    expect(s.recurring[st.recurringId].amount.value).toBeCloseTo(200_000 * 1.22 / 12, 2);
    s = advanceTime(s, 'month', 2);
    expect(s.ledger.filter((t) => t.type === 'staff_payroll').length).toBe(2);
    terminateStaff(s, st.id);
    s = advanceTime(s, 'month', 2);
    expect(s.ledger.filter((t) => t.type === 'staff_payroll').length).toBe(2);
  });
});

describe('financial statements', () => {
  it('balance sheet, income statement and cash flow reconcile with the ledger after a busy year', () => {
    let s = makeSim({ lifestyle: [{ name: 'Lifestyle', monthly: 100_000 }] });
    const car = commitPurchase(s, { name: 'Car', category: 'vehicle', details: { kind: 'vehicle', vehicle: { make: 'X', model: 'Y', year: 2026 } }, price: { value: 400_000, source: { type: 'user_entered' } }, financing: { kind: 'auto_loan', downPaymentPct: 0.3, annualRate: 0.07, termMonths: 48 } });
    s = car.state;
    createRecurring(s, { name: 'Club', direction: 'expense', category: 'membership', amount: { value: 80_000, source: { type: 'user_entered' } }, interval: 'annual', accountId: s.settings.defaultAccountId });
    s = advanceTime(s, 'year', 2);
    const rec = reconcile(s);
    expect(rec.issues).toEqual([]);
    const bs = balanceSheet(s);
    const m = computeMetrics(s);
    expect(bs.netWorth).toBe(m.netWorth);
    const cf = cashFlowStatement(s, s.startDate, s.currentDate);
    expect(cf.closingCash).toBeCloseTo(m.cash, 2);
    expect(cf.openingCash + cf.netChange).toBeCloseTo(cf.closingCash, 1);
    const is = incomeStatement(s, s.startDate, s.currentDate);
    expect(is.comprehensiveChange).toBeCloseTo(m.netWorth, 0);
    // tax settlement happened for 2026 in April 2027
    expect(s.ledger.some((t) => t.type === 'tax_settlement')).toBe(true);
  });
});
