import type { SimulationState, Id, Money, Sourced, Posting } from './types';
import { round2 } from './money';
import { JURISDICTIONS } from './tax';
import { sellingCosts } from './costModels';
import { computeMetrics, type Metrics } from './metrics';
import { postTransaction } from './ledger';
import { atomic } from './atomic';
import { ValidationError } from './errors';
import { nextId } from './ids';
import { daysBetween } from './dates';

export interface SalePlan {
  assetId: Id;
  assetName: string;
  salePrice: Money;
  carryingValue: Money;
  costBasis: Money;
  fees: Money;
  feeBreakdown: { label: string; amount: Money }[];
  loanPayoff: Money;
  taxableGain: Money;
  longTerm: boolean;
  estimatedCapitalGainsTax: Money;
  netProceeds: Money; // cash actually received now (tax settles at year end)
  endedRecurringAnnual: Money;
  before: Metrics;
  after: Metrics;
  warnings: string[];
}

export function planSale(state: SimulationState, assetId: Id, salePrice: Sourced<Money>, accountId?: Id): SalePlan {
  const a = state.assets[assetId];
  if (!a || a.status !== 'owned') throw new ValidationError('Asset is not owned');
  if (!a.resaleAllowed) throw new ValidationError(`${a.name} cannot be sold`);
  if (salePrice.value < 0) throw new ValidationError('Sale price cannot be negative');
  const j = JURISDICTIONS[state.profile.taxJurisdiction];
  const costs = sellingCosts(a.category, salePrice.value, j);
  const loanPayoff = round2(a.liabilityIds.map((id) => state.liabilities[id]).filter((l) => l && l.status === 'active').reduce((s, l) => s + l.balance, 0));
  const taxableGain = round2(salePrice.value - costs.fees - a.costBasis);
  const longTerm = daysBetween(a.purchaseDate, state.currentDate) > 365;
  const cgRate = longTerm || !j.shortTermCapitalGainsAsOrdinary ? j.longTermCapitalGainsRate : j.ordinaryBrackets[j.ordinaryBrackets.length - 1].rate;
  const estTax = round2(Math.max(0, taxableGain) * cgRate);
  const netProceeds = round2(salePrice.value - costs.fees - loanPayoff);
  const endedAnnual = round2(a.recurringIds.map((id) => state.recurring[id]).filter((r) => r && r.status === 'active' && r.direction === 'expense').reduce((s, r) => s + r.amount.value * ({ daily: 365, weekly: 52, monthly: 12, quarterly: 4, annual: 1 }[r.interval]), 0));
  const before = computeMetrics(state);
  const { state: after } = atomic(state, (d) => commitSaleInternal(d, assetId, salePrice, accountId));
  const warnings: string[] = [];
  if (netProceeds < 0) warnings.push('Sale proceeds do not cover the outstanding loan; the shortfall will be paid from cash.');
  if (salePrice.value < a.currentValue * 0.9) warnings.push(`Sale price is ${(100 - (salePrice.value / a.currentValue) * 100).toFixed(0)}% below the current carrying value.`);
  if (estTax > 0) warnings.push(`Estimated capital gains tax of ${estTax.toLocaleString()} will be due at the next annual tax settlement (simulated estimate).`);
  return {
    assetId,
    assetName: a.name,
    salePrice: salePrice.value,
    carryingValue: a.currentValue,
    costBasis: a.costBasis,
    fees: costs.fees,
    feeBreakdown: costs.breakdown.map((b) => ({ label: b.label, amount: b.amount })),
    loanPayoff,
    taxableGain,
    longTerm,
    estimatedCapitalGainsTax: estTax,
    netProceeds,
    endedRecurringAnnual: endedAnnual,
    before,
    after: computeMetrics(after),
    warnings,
  };
}

export function commitSale(state: SimulationState, assetId: Id, salePrice: Sourced<Money>, accountId?: Id): { state: SimulationState; transactionId: Id } {
  const { state: s, result } = atomic(state, (d) => commitSaleInternal(d, assetId, salePrice, accountId));
  return { state: s, transactionId: result };
}

function commitSaleInternal(d: SimulationState, assetId: Id, salePrice: Sourced<Money>, accountId?: Id): Id {
  const a = d.assets[assetId];
  if (!a || a.status !== 'owned') throw new ValidationError('Asset is not owned');
  if (!a.resaleAllowed) throw new ValidationError(`${a.name} cannot be sold`);
  const acct = accountId ?? d.settings.defaultAccountId;
  const j = JURISDICTIONS[d.profile.taxJurisdiction];
  const costs = sellingCosts(a.category, salePrice.value, j);
  const price = round2(salePrice.value);
  const longTerm = daysBetween(a.purchaseDate, d.currentDate) > 365;
  const taxableGain = round2(price - costs.fees - a.costBasis);
  const realizedVsCarrying = round2(price - a.currentValue);

  const postings: Posting[] = [
    { kind: 'asset', assetId, amount: -a.currentValue },
    { kind: 'realized_gain', assetId, amount: realizedVsCarrying },
  ];
  if (costs.fees > 0) postings.push({ kind: 'expense', category: 'fees', amount: costs.fees });
  let loanPayoff = 0;
  for (const lid of a.liabilityIds) {
    const l = d.liabilities[lid];
    if (!l || l.status !== 'active' || l.balance <= 0) continue;
    loanPayoff += l.balance;
    postings.push({ kind: 'liability', liabilityId: l.id, amount: -l.balance });
    l.status = 'settled';
    l.monthsRemaining = 0;
  }
  const cash = round2(price - costs.fees - loanPayoff);
  postings.push({ kind: 'cash', accountId: acct, amount: cash });

  const txn = postTransaction(d, {
    type: 'sale',
    category: a.category,
    description: `Sold ${a.name} for ${price.toLocaleString()}${loanPayoff > 0 ? ` (paid off ${loanPayoff.toLocaleString()} loan)` : ''}`,
    postings,
    assetId,
    tax: { capitalGain: taxableGain, longTerm },
    createdBy: 'user',
  });

  for (const rid of a.recurringIds) {
    const r = d.recurring[rid];
    if (r && r.status === 'active') { r.status = 'ended'; r.endDate = d.currentDate; }
  }
  for (const s of Object.values(d.staff)) {
    if (s.assignedAssetId === assetId && s.status === 'active') {
      s.status = 'terminated'; s.endDate = d.currentDate;
      const r = d.recurring[s.recurringId]; if (r) { r.status = 'ended'; r.endDate = d.currentDate; }
    }
  }
  // Close property-owned storage; assets inside become unassigned.
  for (const loc of Object.values(d.storage)) {
    if (loc.propertyId === assetId && loc.status === 'active') {
      for (const other of Object.values(d.assets)) if (other.storageLocationId === loc.id) other.storageLocationId = null;
      loc.status = 'closed';
    }
  }
  a.status = 'sold';
  a.storageLocationId = null;
  a.sale = { date: d.currentDate, price, fees: costs.fees, taxes: 0, proceeds: cash, gain: taxableGain, transactionId: txn.id };
  d.timeline.push({ id: nextId(d, 'tl'), date: d.currentDate, kind: 'sale', title: `Sold ${a.name}`, amount: price, transactionId: txn.id, assetId, detail: `Gain/loss vs basis: ${taxableGain.toLocaleString()}` });
  return txn.id;
}
