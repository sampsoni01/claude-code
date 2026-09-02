import type { SimulationState, Asset, Money, Id, BusinessDetails } from './types';
import { round2 } from './money';
import { nextNormal } from './rng';
import { postTransaction } from './ledger';
import { nextId } from './ids';
import { ValidationError } from './errors';

/**
 * Businesses run on their own P&L. Each month:
 *   owner share of profit accrues as retained earnings inside the business
 *   (asset value goes up by retained profit, down by retained losses);
 *   the configured distribution rate is paid out to the owner as cash income.
 * Business revenue never becomes personal cash unless distributed.
 */
export function businessProfit(b: BusinessDetails): Money {
  return round2(b.annualRevenue - b.annualOperatingExpenses - b.annualPayroll);
}

export function processBusinessMonth(state: SimulationState, a: Asset): void {
  if (a.details.kind !== 'business' || a.status !== 'owned') return;
  const b = a.details.business;
  // monthly revenue noise: ±6% around plan, scaled by scenario growth multiplier trend
  const noise = 1 + 0.06 * nextNormal(state);
  const monthlyRevenue = round2((b.annualRevenue / 12) * noise);
  const monthlyCosts = round2((b.annualOperatingExpenses + b.annualPayroll) / 12);
  const profit = round2(monthlyRevenue - monthlyCosts);
  const ownerShare = round2(profit * b.ownershipPct);
  const distribution = ownerShare > 0 ? round2(ownerShare * b.distributionRate) : 0;
  const retained = round2(ownerShare - distribution);

  if (retained !== 0) {
    postTransaction(state, {
      type: 'business_result',
      category: 'business',
      description: `${a.name}: ${profit >= 0 ? 'profit' : 'loss'} ${Math.abs(profit).toLocaleString()} (revenue ${monthlyRevenue.toLocaleString()}); owner share retained ${retained.toLocaleString()}`,
      postings: [
        { kind: 'asset', assetId: a.id, amount: retained },
        { kind: 'valuation', assetId: a.id, amount: retained },
      ],
      assetId: a.id,
      recurring: true,
      idempotencyKey: `biz:${a.id}:${state.currentDate}`,
    });
    b.retainedEarnings = round2(b.retainedEarnings + retained);
  }
  if (distribution > 0) {
    postTransaction(state, {
      type: 'business_distribution',
      category: 'business_distribution',
      description: `Owner distribution — ${a.name}`,
      postings: [
        { kind: 'cash', accountId: state.settings.defaultAccountId, amount: distribution },
        { kind: 'income', category: 'business_distribution', amount: distribution },
      ],
      assetId: a.id,
      recurring: true,
      tax: { businessIncome: distribution },
      idempotencyKey: `dist:${a.id}:${state.currentDate}`,
    });
  }
}

/** Annual step: grow revenue by growth rate × scenario; revalue on profit × multiple. */
export function processBusinessYear(state: SimulationState, a: Asset): void {
  if (a.details.kind !== 'business' || a.status !== 'owned') return;
  const b = a.details.business;
  const g = b.annualGrowthRate * state.settings.scenario.businessGrowthMultiplier + 0.03 * nextNormal(state);
  b.annualRevenue = round2(b.annualRevenue * (1 + g));
  b.annualOperatingExpenses = round2(b.annualOperatingExpenses * (1 + Math.max(0, g * 0.7) + state.settings.scenario.inflation * 0.5));
  b.annualPayroll = round2(b.annualPayroll * (1 + state.settings.scenario.inflation));
  const profit = businessProfit(b);
  const target = round2(Math.max(0, profit) * b.valuationMultiple * b.ownershipPct + b.retainedEarnings * 0.5);
  const delta = round2(target - a.currentValue);
  if (delta !== 0) {
    postTransaction(state, {
      type: 'valuation',
      category: 'business',
      description: `${a.name} annual revaluation: profit ${profit.toLocaleString()} × ${b.valuationMultiple}x → ${target.toLocaleString()}`,
      postings: [
        { kind: 'asset', assetId: a.id, amount: delta },
        { kind: 'valuation', assetId: a.id, amount: delta },
      ],
      assetId: a.id,
      idempotencyKey: `bizval:${a.id}:${state.currentDate}`,
    });
    state.valuations.push({ id: nextId(state, 'val'), assetId: a.id, date: state.currentDate, previousValue: round2(target - delta), newValue: target, source: { type: 'simulation_generated', label: 'Annual profit × multiple revaluation' }, transactionId: state.ledger[state.ledger.length - 1].id });
    state.timeline.push({ id: nextId(state, 'tl'), date: state.currentDate, kind: 'business', title: `${a.name} revalued to ${target.toLocaleString()}`, detail: `Revenue grew ${(g * 100).toFixed(1)}%`, assetId: a.id });
  }
}

export function updateBusiness(state: SimulationState, assetId: Id, patch: Partial<BusinessDetails>): void {
  const a = state.assets[assetId];
  if (!a || a.details.kind !== 'business') throw new ValidationError('Not a business');
  a.details.business = { ...a.details.business, ...patch };
  a.assumptions.push({ key: 'business_override', label: 'Business assumptions edited', value: JSON.stringify(patch), kind: 'user_override' });
}

/** One-off distribution of retained earnings to the owner. */
export function distributeRetainedEarnings(state: SimulationState, assetId: Id, amount: Money): void {
  const a = state.assets[assetId];
  if (!a || a.details.kind !== 'business') throw new ValidationError('Not a business');
  const b = a.details.business;
  const amt = round2(Math.min(amount, b.retainedEarnings));
  if (amt <= 0) throw new ValidationError('No retained earnings available');
  postTransaction(state, {
    type: 'business_distribution',
    category: 'business_distribution',
    description: `Special distribution from ${a.name}`,
    postings: [
      { kind: 'cash', accountId: state.settings.defaultAccountId, amount: amt },
      { kind: 'asset', assetId: a.id, amount: -amt },
      { kind: 'income', category: 'business_distribution', amount: amt },
      { kind: 'valuation', assetId: a.id, amount: -amt },
    ],
    assetId: a.id,
    tax: { businessIncome: amt },
    createdBy: 'user',
  });
  b.retainedEarnings = round2(b.retainedEarnings - amt);
}
