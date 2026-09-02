import type { SimulationState, ISODate, Money, Asset, Liability } from './types';
import { round2 } from './money';
import { ownedAssets, activeLiabilities, computeMetrics } from './metrics';
import { compareDates, addDays } from './dates';

export interface BalanceSheet {
  asOf: ISODate;
  cash: { id: string; name: string; balance: Money }[];
  assets: { category: string; items: Asset[]; total: Money }[];
  totalCash: Money;
  totalAssets: Money;
  liabilities: Liability[];
  totalLiabilities: Money;
  netWorth: Money;
}

export function balanceSheet(state: SimulationState): BalanceSheet {
  const m = computeMetrics(state);
  const groups = new Map<string, Asset[]>();
  for (const a of ownedAssets(state)) (groups.get(a.category) ?? groups.set(a.category, []).get(a.category)!).push(a);
  return {
    asOf: state.currentDate,
    cash: Object.values(state.accounts).map((a) => ({ id: a.id, name: a.name, balance: a.balance })),
    assets: Array.from(groups.entries()).map(([category, items]) => ({ category, items, total: round2(items.reduce((s, a) => s + a.currentValue, 0)) })).sort((a, b) => b.total - a.total),
    totalCash: m.cash,
    totalAssets: m.totalAssets,
    liabilities: activeLiabilities(state),
    totalLiabilities: m.totalLiabilities,
    netWorth: m.netWorth,
  };
}

export interface IncomeStatement {
  from: ISODate;
  to: ISODate;
  income: { category: string; amount: Money }[];
  expenses: { category: string; amount: Money }[];
  totalIncome: Money;
  totalExpenses: Money;
  netIncome: Money;
  unrealizedGains: Money;
  realizedGains: Money;
  comprehensiveChange: Money; // netIncome + unrealized + realized + equity
}

export function incomeStatement(state: SimulationState, from: ISODate, to: ISODate): IncomeStatement {
  const inc = new Map<string, number>();
  const exp = new Map<string, number>();
  let unreal = 0, realized = 0, equity = 0;
  for (const t of state.ledger) {
    if (compareDates(t.date, from) < 0 || compareDates(t.date, to) > 0) continue;
    for (const p of t.postings) {
      if (p.kind === 'income') inc.set(p.category, (inc.get(p.category) ?? 0) + p.amount);
      else if (p.kind === 'expense') exp.set(p.category, (exp.get(p.category) ?? 0) + p.amount);
      else if (p.kind === 'valuation') unreal += p.amount;
      else if (p.kind === 'realized_gain') realized += p.amount;
      else if (p.kind === 'equity') equity += p.amount;
    }
  }
  const income = Array.from(inc.entries()).map(([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);
  const expenses = Array.from(exp.entries()).map(([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);
  const totalIncome = round2(income.reduce((s, x) => s + x.amount, 0));
  const totalExpenses = round2(expenses.reduce((s, x) => s + x.amount, 0));
  return { from, to, income, expenses, totalIncome, totalExpenses, netIncome: round2(totalIncome - totalExpenses), unrealizedGains: round2(unreal), realizedGains: round2(realized), comprehensiveChange: round2(totalIncome - totalExpenses + unreal + realized + equity) };
}

export interface CashFlowStatement {
  from: ISODate;
  to: ISODate;
  operating: { label: string; amount: Money }[];
  investing: { label: string; amount: Money }[];
  financing: { label: string; amount: Money }[];
  netOperating: Money;
  netInvesting: Money;
  netFinancing: Money;
  netChange: Money;
  openingCash: Money;
  closingCash: Money;
}

const INVESTING = new Set(['purchase', 'sale', 'project_payment']);
const FINANCING = new Set(['loan_payment', 'loan_origination', 'loan_payoff']);

export function cashFlowStatement(state: SimulationState, from: ISODate, to: ISODate): CashFlowStatement {
  const op = new Map<string, number>(), inv = new Map<string, number>(), fin = new Map<string, number>();
  let opening = 0, closing = 0;
  for (const t of state.ledger) {
    const cash = t.postings.filter((p) => p.kind === 'cash').reduce((s, p) => s + p.amount, 0);
    if (cash === 0) continue;
    if (compareDates(t.date, from) < 0) { opening += cash; closing += cash; continue; }
    if (compareDates(t.date, to) > 0) continue;
    closing += cash;
    if (t.type === 'opening_balance') { opening += cash; continue; }
    if (t.type === 'loan_payment') {
      // split: interest → operating, principal → financing
      const principal = -t.postings.filter((p) => p.kind === 'liability').reduce((s, p) => s + p.amount, 0);
      const interest = round2(-cash - principal);
      op.set('Loan interest', (op.get('Loan interest') ?? 0) - interest);
      fin.set('Loan principal repaid', (fin.get('Loan principal repaid') ?? 0) - principal);
      continue;
    }
    const bucket = INVESTING.has(t.type) ? inv : FINANCING.has(t.type) ? fin : op;
    const label = t.type === 'purchase' ? `Asset purchases (${t.category})` : t.type === 'sale' ? `Asset sales (${t.category})` : t.type === 'salary' ? 'Salary (net of withholding)' : t.category;
    bucket.set(label, (bucket.get(label) ?? 0) + cash);
    if (t.type === 'purchase') {
      // financed portion: show loan proceeds as financing inflow so investing shows gross price
      const loan = t.postings.filter((p) => p.kind === 'liability').reduce((s, p) => s + p.amount, 0);
      if (loan > 0) {
        bucket.set(label, (bucket.get(label) ?? 0) - loan);
        fin.set('Loan proceeds', (fin.get('Loan proceeds') ?? 0) + loan);
      }
    }
    if (t.type === 'sale') {
      const payoff = -t.postings.filter((p) => p.kind === 'liability').reduce((s, p) => s + p.amount, 0);
      if (payoff > 0) {
        bucket.set(label, (bucket.get(label) ?? 0) + payoff);
        fin.set('Loan payoff on sale', (fin.get('Loan payoff on sale') ?? 0) - payoff);
      }
    }
  }
  const toRows = (m: Map<string, number>) => Array.from(m.entries()).map(([label, amount]) => ({ label, amount: round2(amount) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const operating = toRows(op), investing = toRows(inv), financing = toRows(fin);
  const netOperating = round2(operating.reduce((s, x) => s + x.amount, 0));
  const netInvesting = round2(investing.reduce((s, x) => s + x.amount, 0));
  const netFinancing = round2(financing.reduce((s, x) => s + x.amount, 0));
  return { from, to, operating, investing, financing, netOperating, netInvesting, netFinancing, netChange: round2(netOperating + netInvesting + netFinancing), openingCash: round2(opening), closingCash: round2(closing) };
}

/**
 * Reconciliation: recomputes balances purely from the ledger and compares
 * to stored balances; also checks net worth change == comprehensive income.
 * Any discrepancy is a simulation bug.
 */
export function reconcile(state: SimulationState): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const cash: Record<string, number> = {}, assets: Record<string, number> = {}, liabs: Record<string, number> = {};
  for (const t of state.ledger) {
    for (const p of t.postings) {
      if (p.kind === 'cash') cash[p.accountId] = round2((cash[p.accountId] ?? 0) + p.amount);
      else if (p.kind === 'asset') assets[p.assetId] = round2((assets[p.assetId] ?? 0) + p.amount);
      else if (p.kind === 'liability') liabs[p.liabilityId] = round2((liabs[p.liabilityId] ?? 0) + p.amount);
    }
  }
  for (const a of Object.values(state.accounts)) if (Math.abs((cash[a.id] ?? 0) - a.balance) > 0.02) issues.push(`Account ${a.name}: ledger ${cash[a.id] ?? 0} vs balance ${a.balance}`);
  for (const a of Object.values(state.assets)) if (Math.abs((assets[a.id] ?? 0) - a.currentValue) > 0.02) issues.push(`Asset ${a.name}: ledger ${assets[a.id] ?? 0} vs value ${a.currentValue}`);
  for (const l of Object.values(state.liabilities)) if (Math.abs((liabs[l.id] ?? 0) - l.balance) > 0.02) issues.push(`Liability ${l.name}: ledger ${liabs[l.id] ?? 0} vs balance ${l.balance}`);
  const first = state.ledger[0]?.date ?? state.startDate;
  const is = incomeStatement(state, first, state.currentDate);
  const m = computeMetrics(state);
  if (Math.abs(is.comprehensiveChange - m.netWorth) > 0.05 * Math.max(1, state.ledger.length / 100)) issues.push(`Net worth ${m.netWorth} != comprehensive change since inception ${is.comprehensiveChange}`);
  const cf = cashFlowStatement(state, first, state.currentDate);
  if (Math.abs(cf.closingCash - m.cash) > 0.05) issues.push(`Cash flow closing ${cf.closingCash} != cash ${m.cash}`);
  // duplicate idempotency check
  const keys = new Set<string>();
  for (const t of state.ledger) if (t.idempotencyKey) { if (keys.has(t.idempotencyKey)) issues.push(`Duplicate key ${t.idempotencyKey}`); keys.add(t.idempotencyKey); }
  return { ok: issues.length === 0, issues };
}

export function periodBounds(state: SimulationState, period: 'month' | 'quarter' | 'year' | 'all'): { from: ISODate; to: ISODate } {
  const to = state.currentDate;
  if (period === 'all') return { from: state.startDate, to };
  const days = period === 'month' ? 30 : period === 'quarter' ? 91 : 365;
  return { from: addDays(to, -days + 1), to };
}
