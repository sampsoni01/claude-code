import type { SimulationState, Liability, LiabilityKind, Money, Id, ISODate, SourceInfo } from './types';
import { round2 } from './money';
import { nextId } from './ids';
import { addMonths } from './dates';
import { postTransaction } from './ledger';
import { ValidationError } from './errors';

export interface FinancingTerms {
  kind: LiabilityKind;
  /** Down payment as absolute amount OR fraction (0..1). */
  downPayment?: Money;
  downPaymentPct?: number;
  annualRate: number;
  termMonths: number;
  interestOnly?: boolean;
  balloonPayment?: Money;
  source?: SourceInfo;
}

/** Standard amortizing payment. */
export function amortizedPayment(principal: Money, annualRate: number, termMonths: number): Money {
  if (termMonths <= 0) return round2(principal);
  const r = annualRate / 12;
  if (r === 0) return round2(principal / termMonths);
  const pmt = (principal * r) / (1 - Math.pow(1 + r, -termMonths));
  return round2(pmt);
}

export function amortizedPaymentWithBalloon(principal: Money, annualRate: number, termMonths: number, balloon: Money): Money {
  // Payment such that the remaining balance after termMonths equals balloon.
  const r = annualRate / 12;
  if (r === 0) return round2((principal - balloon) / termMonths);
  const pvBalloon = balloon / Math.pow(1 + r, termMonths);
  return amortizedPayment(principal - pvBalloon, annualRate, termMonths);
}

/** Default reference financing terms by loan kind. Rates are simulation assumptions. */
export function defaultTerms(kind: LiabilityKind, rateShift = 0): { annualRate: number; termMonths: number; downPaymentPct: number } {
  const base = {
    mortgage: { annualRate: 0.0625, termMonths: 360, downPaymentPct: 0.3 },
    auto_loan: { annualRate: 0.0699, termMonths: 60, downPaymentPct: 0.2 },
    securities_backed: { annualRate: 0.065, termMonths: 0, downPaymentPct: 0 },
    business_loan: { annualRate: 0.085, termMonths: 84, downPaymentPct: 0.35 },
    personal_loan: { annualRate: 0.095, termMonths: 60, downPaymentPct: 0 },
    aircraft_loan: { annualRate: 0.0725, termMonths: 180, downPaymentPct: 0.2 },
    marine_loan: { annualRate: 0.0775, termMonths: 240, downPaymentPct: 0.2 },
    custom: { annualRate: 0.07, termMonths: 120, downPaymentPct: 0.2 },
  }[kind];
  return { ...base, annualRate: round2((base.annualRate + rateShift) * 10000) / 10000 };
}

export function resolveDownPayment(price: Money, terms: FinancingTerms): Money {
  if (terms.downPayment != null) return round2(Math.min(price, Math.max(0, terms.downPayment)));
  const pct = terms.downPaymentPct ?? defaultTerms(terms.kind).downPaymentPct;
  return round2(price * pct);
}

/**
 * Creates a liability record. Does NOT post anything to the ledger by itself;
 * purchase flows include the liability posting in the purchase transaction so
 * the whole thing is one atomic ledger entry.
 */
export function createLiability(
  state: SimulationState,
  input: {
    name: string;
    kind: LiabilityKind;
    principal: Money;
    annualRate: number;
    termMonths: number;
    interestOnly?: boolean;
    balloonPayment?: Money;
    paymentAccountId: Id;
    securedByAssetId?: Id;
    source?: SourceInfo;
    firstPaymentDate?: ISODate;
  },
): Liability {
  if (input.principal <= 0) throw new ValidationError('Loan principal must be positive');
  const id = nextId(state, 'loan');
  const interestOnly = input.interestOnly ?? (input.kind === 'securities_backed');
  const balloon = interestOnly ? input.principal : (input.balloonPayment ?? 0);
  const termMonths = input.termMonths > 0 ? input.termMonths : 0;
  let monthlyPayment: Money;
  if (interestOnly) monthlyPayment = round2((input.principal * input.annualRate) / 12);
  else if (balloon > 0) monthlyPayment = amortizedPaymentWithBalloon(input.principal, input.annualRate, termMonths, balloon);
  else monthlyPayment = amortizedPayment(input.principal, input.annualRate, termMonths);

  const liability: Liability = {
    id,
    name: input.name,
    kind: input.kind,
    originalPrincipal: round2(input.principal),
    balance: 0, // set by the ledger posting
    annualRate: input.annualRate,
    termMonths,
    monthsRemaining: termMonths,
    monthlyPayment,
    balloonPayment: round2(balloon),
    interestOnly,
    nextPaymentDate: input.firstPaymentDate ?? addMonths(state.currentDate, 1),
    paymentAccountId: input.paymentAccountId,
    securedByAssetId: input.securedByAssetId,
    originatedOn: state.currentDate,
    status: 'active',
    totalInterestPaid: 0,
    totalPrincipalPaid: 0,
    source: input.source ?? { type: 'simulation_generated', label: 'Simulated loan terms' },
  };
  state.liabilities[id] = liability;
  return liability;
}

/** Processes one scheduled payment: interest is an expense; principal reduces cash and debt. */
export function processLoanPayment(state: SimulationState, liabilityId: Id): void {
  const l = state.liabilities[liabilityId];
  if (!l || l.status !== 'active') return;
  if (l.balance <= 0) { l.status = 'paid_off'; return; }
  const interest = round2((l.balance * l.annualRate) / 12);
  let principal: Money;
  const isFinal = !l.interestOnly && l.termMonths > 0 && l.monthsRemaining <= 1;
  const isMaturity = l.interestOnly && l.termMonths > 0 && l.monthsRemaining <= 1;
  if (l.interestOnly) {
    principal = isMaturity ? l.balance : 0;
  } else if (isFinal) {
    principal = l.balance; // final payment clears everything including balloon
  } else {
    principal = round2(Math.min(l.balance, Math.max(0, l.monthlyPayment - interest)));
  }
  const payment = round2(interest + principal);
  postTransaction(state, {
    type: 'loan_payment',
    category: 'debt_service',
    description: `${l.name} payment (interest ${interest.toFixed(2)}, principal ${principal.toFixed(2)})`,
    postings: [
      { kind: 'cash', accountId: l.paymentAccountId, amount: -payment },
      { kind: 'liability', liabilityId: l.id, amount: -principal },
      { kind: 'expense', category: 'interest', amount: interest },
    ],
    liabilityId: l.id,
    assetId: l.securedByAssetId,
    recurring: true,
    tax: l.kind === 'mortgage' ? { deductible: interest } : undefined,
    idempotencyKey: `loan:${l.id}:${l.nextPaymentDate}`,
  });
  l.totalInterestPaid = round2(l.totalInterestPaid + interest);
  l.totalPrincipalPaid = round2(l.totalPrincipalPaid + principal);
  if (l.termMonths > 0) l.monthsRemaining -= 1;
  l.nextPaymentDate = addMonths(l.nextPaymentDate, 1);
  if (l.balance <= 0.005) {
    l.balance = 0;
    l.status = 'paid_off';
  }
}

/** Pays off a loan in full from an account. */
export function payOffLoan(state: SimulationState, liabilityId: Id, accountId?: Id): void {
  const l = state.liabilities[liabilityId];
  if (!l || l.status !== 'active') throw new ValidationError('Loan is not active');
  const acct = accountId ?? l.paymentAccountId;
  const accrued = 0; // simplification: no accrued interest between payments
  postTransaction(state, {
    type: 'loan_payoff',
    category: 'debt_service',
    description: `Paid off ${l.name}`,
    postings: [
      { kind: 'cash', accountId: acct, amount: -(l.balance + accrued) },
      { kind: 'liability', liabilityId: l.id, amount: -l.balance },
    ],
    liabilityId: l.id,
    assetId: l.securedByAssetId,
    createdBy: 'user',
  });
  l.totalPrincipalPaid = round2(l.totalPrincipalPaid + l.originalPrincipal - l.totalPrincipalPaid);
  l.status = 'paid_off';
  l.monthsRemaining = 0;
}

/** Projected amortization schedule (no state mutation). */
export function amortizationSchedule(l: Pick<Liability, 'balance' | 'annualRate' | 'monthlyPayment' | 'monthsRemaining' | 'interestOnly'>): { month: number; interest: Money; principal: Money; balance: Money }[] {
  const rows: { month: number; interest: Money; principal: Money; balance: Money }[] = [];
  let bal = l.balance;
  const n = l.monthsRemaining > 0 ? l.monthsRemaining : 12;
  for (let m = 1; m <= n && bal > 0; m++) {
    const interest = round2((bal * l.annualRate) / 12);
    let principal = l.interestOnly ? 0 : round2(Math.min(bal, l.monthlyPayment - interest));
    if (m === n) principal = bal;
    bal = round2(bal - principal);
    rows.push({ month: m, interest, principal, balance: bal });
  }
  return rows;
}
