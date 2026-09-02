import type { SimulationState, Money, Asset, Snapshot, ISODate } from './types';
import { round2 } from './money';
import { addMonths, addInterval, compareDates, intervalsPerYear, startOfMonth, endOfMonth } from './dates';
import { sumPostings } from './ledger';

export interface Metrics {
  cash: Money;
  liquidAssets: Money; // cash + liquid securities
  totalAssets: Money; // cash + all non-cash assets
  nonCashAssets: Money;
  totalLiabilities: Money;
  netWorth: Money;
  liquidNetWorth: Money; // liquid assets minus liabilities secured against them (securities-backed) and short-term obligations
  monthlyIncome: Money; // gross recurring income + expected business distributions + est. dividends
  monthlyExpenses: Money; // recurring expenses + debt service (interest+principal) + property taxes etc.
  monthlyDebtService: Money;
  monthlyInterest: Money;
  monthlyCashFlow: Money;
  annualLifestyleBurn: Money; // recurring expenses excluding debt principal
  annualCashFlow: Money;
  passiveMonthlyIncome: Money;
  allocation: Record<string, Money>;
}

export function ownedAssets(state: SimulationState): Asset[] {
  return Object.values(state.assets).filter((a) => a.status === 'owned');
}

export function activeLiabilities(state: SimulationState) {
  return Object.values(state.liabilities).filter((l) => l.status === 'active' && l.balance > 0);
}

export function totalCash(state: SimulationState): Money {
  return round2(Object.values(state.accounts).reduce((s, a) => s + a.balance, 0));
}

export function monthlyAmount(amount: Money, interval: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'): Money {
  return (amount * intervalsPerYear(interval)) / 12;
}

export function computeMetrics(state: SimulationState): Metrics {
  const cash = totalCash(state);
  const assets = ownedAssets(state);
  const nonCashAssets = round2(assets.reduce((s, a) => s + a.currentValue, 0));
  const liquidSecurities = round2(assets.filter((a) => a.liquidity === 'liquid').reduce((s, a) => s + a.currentValue, 0));
  const liabilities = activeLiabilities(state);
  const totalLiabilities = round2(liabilities.reduce((s, l) => s + l.balance, 0));
  const securitiesBacked = round2(liabilities.filter((l) => l.kind === 'securities_backed' || l.kind === 'personal_loan').reduce((s, l) => s + l.balance, 0));

  let monthlyIncome = 0;
  let monthlyExpenses = 0;
  let passive = 0;
  for (const r of Object.values(state.recurring)) {
    if (r.status !== 'active') continue;
    const m = monthlyAmount(r.amount.value, r.interval);
    if (r.direction === 'income') {
      monthlyIncome += m;
      if (r.category !== 'salary' && r.category !== 'bonus' && r.category !== 'consulting') passive += m;
    } else monthlyExpenses += m;
  }
  // Expected business distributions and dividends (annualized / 12)
  for (const a of assets) {
    if (a.details.kind === 'business') {
      const b = a.details.business;
      const profit = b.annualRevenue - b.annualOperatingExpenses - b.annualPayroll;
      const dist = Math.max(0, profit) * b.ownershipPct * b.distributionRate;
      monthlyIncome += dist / 12;
      passive += dist / 12;
    }
    if (a.details.kind === 'security') {
      const d = a.currentValue * a.details.security.dividendYield;
      monthlyIncome += d / 12;
      passive += d / 12;
    }
    if (a.details.kind === 'property' && a.details.property.monthlyRentIncome) {
      // rent is modeled as a recurring income item on creation; skip to avoid double count
    }
  }
  // account interest
  for (const acct of Object.values(state.accounts)) {
    if (acct.interestRate > 0 && acct.balance > 0) {
      monthlyIncome += (acct.balance * acct.interestRate) / 12;
      passive += (acct.balance * acct.interestRate) / 12;
    }
  }

  let debtService = 0;
  let interest = 0;
  for (const l of liabilities) {
    debtService += l.monthlyPayment;
    interest += (l.balance * l.annualRate) / 12;
  }

  const allocation: Record<string, Money> = { cash };
  for (const a of assets) {
    allocation[a.category] = round2((allocation[a.category] ?? 0) + a.currentValue);
  }

  const lifestyleMonthly = monthlyExpenses + interest; // interest is a true expense; principal is not
  const monthlyCashFlow = monthlyIncome - monthlyExpenses - debtService;

  return {
    cash,
    liquidAssets: round2(cash + liquidSecurities),
    totalAssets: round2(cash + nonCashAssets),
    nonCashAssets,
    totalLiabilities,
    netWorth: round2(cash + nonCashAssets - totalLiabilities),
    liquidNetWorth: round2(cash + liquidSecurities - securitiesBacked),
    monthlyIncome: round2(monthlyIncome),
    monthlyExpenses: round2(monthlyExpenses + debtService),
    monthlyDebtService: round2(debtService),
    monthlyInterest: round2(interest),
    monthlyCashFlow: round2(monthlyCashFlow),
    annualLifestyleBurn: round2(lifestyleMonthly * 12),
    annualCashFlow: round2(monthlyCashFlow * 12),
    passiveMonthlyIncome: round2(passive),
    allocation,
  };
}

/** Upcoming scheduled payments in the next N days (recurring expenses, loan payments, project payments). */
export function upcomingPayments(state: SimulationState, days = 30): { date: ISODate; label: string; amount: Money; kind: string }[] {
  const out: { date: ISODate; label: string; amount: Money; kind: string }[] = [];
  const horizon = addMonths(state.currentDate, Math.ceil(days / 30));
  for (const r of Object.values(state.recurring)) {
    if (r.status !== 'active' || r.direction !== 'expense') continue;
    let d = r.nextDate;
    let guard = 0;
    while (compareDates(d, horizon) <= 0 && guard++ < 40) {
      out.push({ date: d, label: r.name, amount: r.amount.value, kind: 'recurring' });
      d = addInterval(d, r.interval);
    }
  }
  for (const l of activeLiabilities(state)) {
    let d = l.nextPaymentDate;
    let guard = 0;
    while (compareDates(d, horizon) <= 0 && guard++ < 3) {
      out.push({ date: d, label: `${l.name} payment`, amount: l.monthlyPayment, kind: 'loan' });
      d = addMonths(d, 1);
    }
  }
  for (const p of Object.values(state.projects)) {
    if (p.status === 'cancelled' || p.status === 'completed') continue;
    for (const pay of p.payments) {
      if (!pay.paid && compareDates(pay.date, horizon) <= 0) out.push({ date: pay.date, label: `${p.name} payment`, amount: pay.amount, kind: 'project' });
    }
  }
  return out.sort((a, b) => compareDates(a.date, b.date));
}

export function snapshotFor(state: SimulationState, date: ISODate): Snapshot {
  const m = computeMetrics(state);
  const from = startOfMonth(date);
  const to = endOfMonth(date);
  return {
    date,
    netWorth: m.netWorth,
    liquidNetWorth: m.liquidNetWorth,
    cash: m.cash,
    liquidAssets: m.liquidAssets,
    totalAssets: m.totalAssets,
    totalLiabilities: m.totalLiabilities,
    monthIncome: sumPostings(state, 'income', from, to),
    monthExpenses: sumPostings(state, 'expense', from, to),
  };
}
