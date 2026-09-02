import type { Posting, SimulationState, Transaction, TransactionType, TaxRelevance, Id, ISODate } from './types';
import { round2, approxEqual } from './money';
import { nextId } from './ids';
import { ValidationError } from './errors';
import { compareDates } from './dates';

export interface TransactionInput {
  date?: ISODate;
  type: TransactionType;
  category: string;
  description: string;
  postings: Posting[];
  assetId?: Id;
  liabilityId?: Id;
  recurringId?: Id;
  projectId?: Id;
  eventId?: Id;
  recurring?: boolean;
  tax?: TaxRelevance;
  notes?: string;
  idempotencyKey?: string;
  createdBy?: 'user' | 'assistant' | 'engine';
  /** Allow cash accounts to go negative (overdraft). Default true: the sim does not protect from overspending, it reports it. */
  allowNegativeCash?: boolean;
}

/**
 * Validates that a set of postings satisfies the accounting identity:
 *   Δcash + Δassets − Δliabilities = income − expenses + valuation + realized_gain + equity
 */
export function validatePostings(postings: Posting[]): void {
  if (postings.length === 0) throw new ValidationError('Transaction has no postings');
  let balanceSide = 0;
  let resultSide = 0;
  for (const p of postings) {
    if (!Number.isFinite(p.amount)) throw new ValidationError(`Posting amount is not finite: ${JSON.stringify(p)}`);
    switch (p.kind) {
      case 'cash': balanceSide += p.amount; break;
      case 'asset': balanceSide += p.amount; break;
      case 'liability': balanceSide -= p.amount; break;
      case 'income': resultSide += p.amount; break;
      case 'expense': resultSide -= p.amount; break;
      case 'valuation': resultSide += p.amount; break;
      case 'realized_gain': resultSide += p.amount; break;
      case 'equity': resultSide += p.amount; break;
    }
  }
  if (!approxEqual(round2(balanceSide), round2(resultSide), 0.02)) {
    throw new ValidationError(
      `Unbalanced transaction: balance-sheet change ${round2(balanceSide)} != result change ${round2(resultSide)}. Postings: ${JSON.stringify(postings)}`,
    );
  }
}

/** Ensures every referenced account/asset/liability exists. */
function validateReferences(state: SimulationState, postings: Posting[]): void {
  for (const p of postings) {
    if (p.kind === 'cash' && !state.accounts[p.accountId]) throw new ValidationError(`Unknown account ${p.accountId}`);
    if ((p.kind === 'asset' || p.kind === 'valuation' || p.kind === 'realized_gain') && !state.assets[p.assetId]) throw new ValidationError(`Unknown asset ${p.assetId}`);
    if (p.kind === 'liability' && !state.liabilities[p.liabilityId]) throw new ValidationError(`Unknown liability ${p.liabilityId}`);
  }
}

/**
 * Posts a transaction to the ledger and applies its postings to balances.
 * This is the ONLY function that is allowed to change account balances,
 * asset carrying values or liability balances.
 *
 * Mutates `state` in place; callers wrap in `atomic()` to get rollback.
 */
export function postTransaction(state: SimulationState, input: TransactionInput): Transaction {
  const postings = input.postings.map((p) => ({ ...p, amount: round2(p.amount) })).filter((p) => p.amount !== 0 || p.kind === 'equity');
  if (postings.length === 0) {
    // A transaction that moves nothing is a no-op; still record for traceability? No: skip silently is a source of confusion.
    throw new ValidationError(`Transaction "${input.description}" has no non-zero postings`);
  }
  validatePostings(postings);
  validateReferences(state, postings);

  if (input.idempotencyKey) {
    const existing = state.idempotencyKeys[input.idempotencyKey];
    if (existing) throw new ValidationError(`Duplicate transaction: key ${input.idempotencyKey} already posted as ${existing}`);
  }

  const date = input.date ?? state.currentDate;
  if (compareDates(date, state.currentDate) > 0) {
    throw new ValidationError(`Cannot post a transaction dated in the future (${date} > ${state.currentDate})`);
  }

  const id = nextId(state, 'txn');
  const seq = (state.counters['seq'] = (state.counters['seq'] ?? 0) + 1);

  let cashEffect = 0;
  for (const p of postings) {
    switch (p.kind) {
      case 'cash': {
        const acct = state.accounts[p.accountId];
        acct.balance = round2(acct.balance + p.amount);
        cashEffect += p.amount;
        if (acct.balance < -0.005 && input.allowNegativeCash === false) {
          throw new ValidationError(`Account ${acct.name} would go negative (${acct.balance})`);
        }
        break;
      }
      case 'asset': {
        const a = state.assets[p.assetId];
        a.currentValue = round2(a.currentValue + p.amount);
        break;
      }
      case 'liability': {
        const l = state.liabilities[p.liabilityId];
        l.balance = round2(l.balance + p.amount);
        break;
      }
      default:
        break;
    }
  }

  const txn: Transaction = {
    id,
    date,
    seq,
    type: input.type,
    category: input.category,
    description: input.description,
    cashEffect: round2(cashEffect),
    postings,
    assetId: input.assetId,
    liabilityId: input.liabilityId,
    recurringId: input.recurringId,
    projectId: input.projectId,
    eventId: input.eventId,
    recurring: input.recurring ?? false,
    tax: input.tax,
    notes: input.notes,
    idempotencyKey: input.idempotencyKey,
    createdBy: input.createdBy ?? 'engine',
  };
  state.ledger.push(txn);
  if (input.idempotencyKey) state.idempotencyKeys[input.idempotencyKey] = id;
  accumulateTax(state, txn);
  return txn;
}

function accumulateTax(state: SimulationState, txn: Transaction): void {
  const t = txn.tax;
  if (!t) return;
  const ty = state.taxYear;
  if (t.ordinaryIncome) ty.ordinaryIncome = round2(ty.ordinaryIncome + t.ordinaryIncome);
  if (t.taxPaid) ty.withheld = round2(ty.withheld + t.taxPaid);
  if (t.capitalGain) {
    if (t.longTerm) ty.capitalGainsLong = round2(ty.capitalGainsLong + t.capitalGain);
    else ty.capitalGainsShort = round2(ty.capitalGainsShort + t.capitalGain);
  }
  if (t.dividend) ty.dividends = round2(ty.dividends + t.dividend);
  if (t.interestIncome) ty.interestIncome = round2(ty.interestIncome + t.interestIncome);
  if (t.businessIncome) ty.businessIncome = round2(ty.businessIncome + t.businessIncome);
  if (t.deductible) ty.deductions = round2(ty.deductions + t.deductible);
}

/**
 * Reverses a transaction by posting the exact opposite postings. Balances are
 * restored; the original stays in the ledger marked as reversed (audit trail).
 */
export function reverseTransaction(state: SimulationState, transactionId: Id, reason: string): Transaction {
  const orig = state.ledger.find((t) => t.id === transactionId);
  if (!orig) throw new ValidationError(`Unknown transaction ${transactionId}`);
  if (orig.reversedBy) throw new ValidationError(`Transaction ${transactionId} already reversed by ${orig.reversedBy}`);
  const negTax: TaxRelevance | undefined = orig.tax
    ? Object.fromEntries(Object.entries(orig.tax).map(([k, v]) => [k, typeof v === 'number' ? -v : v])) as TaxRelevance
    : undefined;
  const rev = postTransaction(state, {
    type: 'reversal',
    category: orig.category,
    description: `Reversal of "${orig.description}": ${reason}`,
    postings: orig.postings.map((p) => ({ ...p, amount: -p.amount }) as Posting),
    assetId: orig.assetId,
    liabilityId: orig.liabilityId,
    tax: negTax,
    createdBy: 'user',
  });
  rev.reverses = orig.id;
  orig.reversedBy = rev.id;
  return rev;
}

/** Sum of postings of a given kind over a date range (inclusive). */
export function sumPostings(
  state: SimulationState,
  kind: Posting['kind'],
  from: ISODate,
  to: ISODate,
  filter?: (p: Posting, t: Transaction) => boolean,
): number {
  let sum = 0;
  for (const t of state.ledger) {
    if (compareDates(t.date, from) < 0 || compareDates(t.date, to) > 0) continue;
    for (const p of t.postings) {
      if (p.kind !== kind) continue;
      if (filter && !filter(p, t)) continue;
      sum += p.amount;
    }
  }
  return round2(sum);
}

export function transactionsBetween(state: SimulationState, from: ISODate, to: ISODate): Transaction[] {
  return state.ledger.filter((t) => compareDates(t.date, from) >= 0 && compareDates(t.date, to) <= 0);
}
