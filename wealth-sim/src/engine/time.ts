import type { SimulationState, ISODate } from './types';
import { addDays, compareDates, dayOf, monthOf, yearOf, addMonths, addYears, endOfMonth } from './dates';
import { processRecurringOccurrence, applyInflation } from './recurring';
import { processLoanPayment } from './loans';
import { applyMonthlyValueChanges, payDividends, payAccountInterest } from './investments';
import { processBusinessMonth, processBusinessYear } from './business';
import { processProjectPayments } from './projects';
import { processEvent } from './events';
import { maybeRealismEvent } from './realism';
import { computeAnnualSettlement, emptyTaxYear, JURISDICTIONS } from './tax';
import { postTransaction } from './ledger';
import { snapshotFor } from './metrics';
import { nextId } from './ids';
import { atomic } from './atomic';
import { round2 } from './money';

export type TimeUnit = 'day' | 'month' | 'quarter' | 'year';

/** Advances time by `n` units, processing every scheduled item on each day. Atomic. */
export function advanceTime(state: SimulationState, unit: TimeUnit, n = 1): SimulationState {
  const target = unit === 'day' ? addDays(state.currentDate, n) : unit === 'month' ? addMonths(state.currentDate, n) : unit === 'quarter' ? addMonths(state.currentDate, 3 * n) : addYears(state.currentDate, n);
  return advanceTo(state, target);
}

export function advanceTo(state: SimulationState, target: ISODate): SimulationState {
  if (compareDates(target, state.currentDate) <= 0) return state;
  const { state: s } = atomic(state, (d) => {
    while (compareDates(d.currentDate, target) < 0) {
      d.currentDate = addDays(d.currentDate, 1);
      processDay(d);
    }
  });
  return s;
}

/** Processes everything due on d.currentDate. Order is fixed so results are deterministic. */
export function processDay(d: SimulationState): void {
  const today = d.currentDate;
  const day = dayOf(today);
  const month = monthOf(today);
  const first = day === 1;

  if (first && month === 1) {
    // New year: inflation on recurring expenses, business annual step.
    applyInflation(d, d.settings.scenario.inflation);
    for (const a of Object.values(d.assets)) processBusinessYear(d, a);
  }

  // 1. Income & recurring items due today
  for (const r of Object.values(d.recurring)) {
    if (r.status !== 'active') continue;
    let guard = 0;
    while (r.status === 'active' && compareDates(r.nextDate, today) <= 0 && guard++ < 400) processRecurringOccurrence(d, r);
  }
  // 2. Loan payments
  for (const l of Object.values(d.liabilities)) {
    if (l.status !== 'active') continue;
    let guard = 0;
    while (l.status === 'active' && compareDates(l.nextPaymentDate, today) <= 0 && guard++ < 400) processLoanPayment(d, l.id);
  }
  // 3. Projects and events
  for (const p of Object.values(d.projects)) processProjectPayments(d, p);
  for (const e of Object.values(d.events)) processEvent(d, e);

  // 4. Month-end market moves, interest, business results
  if (today === endOfMonth(today)) {
    applyMonthlyValueChanges(d);
    payAccountInterest(d);
    for (const a of Object.values(d.assets)) processBusinessMonth(d, a);
    if (month % 3 === 0) payDividends(d);
    maybeRealismEvent(d);
    d.history.push(snapshotFor(d, today));
    // cap history to keep saves small (one snapshot per month for 100 years is fine)
  }

  // 5. Annual tax settlement
  if (first && month === d.settings.taxSettlementMonth && d.taxYear.year < yearOf(today)) settleTaxes(d);
  if (first && month === 1 && d.taxYear.year < yearOf(today) && d.settings.taxSettlementMonth === 1) settleTaxes(d);
}

export function settleTaxes(d: SimulationState): void {
  const j = JURISDICTIONS[d.profile.taxJurisdiction];
  const acc = d.taxYear;
  const s = computeAnnualSettlement(acc, j);
  const due = round2(s.balanceDue);
  if (Math.abs(due) >= 1) {
    postTransaction(d, {
      type: 'tax_settlement',
      category: 'tax',
      description: `${acc.year} tax settlement (simulated estimate): liability ${s.totalLiability.toLocaleString()}, withheld ${s.withheld.toLocaleString()} → ${due >= 0 ? 'payment' : 'refund'} ${Math.abs(due).toLocaleString()}`,
      postings: [
        { kind: 'cash', accountId: d.settings.defaultAccountId, amount: -due },
        { kind: 'expense', category: 'tax', amount: due },
      ],
      notes: JSON.stringify(s.breakdown),
      idempotencyKey: `tax:${acc.year}`,
    });
    d.timeline.push({ id: nextId(d, 'tl'), date: d.currentDate, kind: 'milestone', title: `${acc.year} taxes settled`, detail: `Total simulated liability ${s.totalLiability.toLocaleString()} (${j.name})`, amount: due });
  }
  d.taxYear = emptyTaxYear(yearOf(d.currentDate));
  // Income that already accrued this calendar year before settlement month stays: rebuild from ledger for the current year.
  for (const t of d.ledger) {
    if (yearOf(t.date) !== d.taxYear.year || !t.tax) continue;
    const ty = d.taxYear; const x = t.tax;
    if (x.ordinaryIncome) ty.ordinaryIncome = round2(ty.ordinaryIncome + x.ordinaryIncome);
    if (x.taxPaid) ty.withheld = round2(ty.withheld + x.taxPaid);
    if (x.capitalGain) { if (x.longTerm) ty.capitalGainsLong = round2(ty.capitalGainsLong + x.capitalGain); else ty.capitalGainsShort = round2(ty.capitalGainsShort + x.capitalGain); }
    if (x.dividend) ty.dividends = round2(ty.dividends + x.dividend);
    if (x.interestIncome) ty.interestIncome = round2(ty.interestIncome + x.interestIncome);
    if (x.businessIncome) ty.businessIncome = round2(ty.businessIncome + x.businessIncome);
    if (x.deductible) ty.deductions = round2(ty.deductions + x.deductible);
  }
}
