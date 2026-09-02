import type { SimulationState, Asset, Money, Id, Sourced, SecurityDetails } from './types';
import { round2 } from './money';
import { nextNormal } from './rng';
import { postTransaction } from './ledger';
import { JURISDICTIONS } from './tax';
import { revalueAsset } from './assets';

/**
 * Monthly investment performance. Each holding gets its own drift/volatility
 * (from its security details or value rule), adjusted by the active market
 * scenario. Returns are deterministic given the state's RNG seed.
 */
export function classDrift(state: SimulationState, a: Asset): number {
  const sc = state.settings.scenario;
  if (a.details.kind === 'security') {
    switch (a.details.security.assetClass) {
      case 'stock': case 'etf': return sc.equityDrift;
      case 'bond': case 'cash_equivalent': return sc.bondDrift;
      case 'real_estate_fund': return sc.realEstateDrift;
      case 'private_equity': case 'venture': case 'alternative': return sc.privateDrift;
    }
  }
  switch (a.category) {
    case 'real_estate': case 'land': return sc.realEstateDrift;
    case 'business': case 'private_investment': return sc.privateDrift;
    case 'public_security': return sc.equityDrift;
    default: return 0;
  }
}

/** Applies one month of value change to every owned asset with a value rule. */
export function applyMonthlyValueChanges(state: SimulationState): void {
  const sc = state.settings.scenario;
  for (const a of Object.values(state.assets)) {
    if (a.status !== 'owned') continue;
    if (a.details.kind === 'business') continue; // businesses are revalued annually from profit
    const drift = a.valueRule.annualRate + classDrift(state, a);
    const vol = a.valueRule.annualVolatility * sc.volatilityMultiplier;
    let monthly = drift / 12;
    if (vol > 0) monthly += (vol / Math.sqrt(12)) * nextNormal(state);
    let nv = a.currentValue * (1 + monthly);
    if (a.valueRule.floorFraction != null) nv = Math.max(nv, a.purchasePrice * a.valueRule.floorFraction);
    nv = round2(nv);
    const delta = round2(nv - a.currentValue);
    if (delta === 0) continue;
    postTransaction(state, {
      type: a.details.kind === 'security' ? 'investment_return' : 'valuation',
      category: a.category,
      description: `${a.name}: ${delta >= 0 ? 'gained' : 'lost'} ${Math.abs(delta).toLocaleString()} (${(monthly * 100).toFixed(2)}% this month)`,
      postings: [
        { kind: 'asset', assetId: a.id, amount: delta },
        { kind: 'valuation', assetId: a.id, amount: delta },
      ],
      assetId: a.id,
      idempotencyKey: `mkt:${a.id}:${state.currentDate}`,
    });
  }
}

/** Pays dividends / distributions from securities (quarterly). */
export function payDividends(state: SimulationState): void {
  for (const a of Object.values(state.assets)) {
    if (a.status !== 'owned' || a.details.kind !== 'security') continue;
    const y = a.details.security.dividendYield;
    if (y <= 0) continue;
    const amt = round2((a.currentValue * y) / 4);
    if (amt <= 0) continue;
    postTransaction(state, {
      type: 'dividend',
      category: 'dividend',
      description: `Dividend — ${a.name}`,
      postings: [
        { kind: 'cash', accountId: state.settings.defaultAccountId, amount: amt },
        { kind: 'income', category: 'dividend', amount: amt },
      ],
      assetId: a.id,
      recurring: true,
      tax: { dividend: amt },
      idempotencyKey: `div:${a.id}:${state.currentDate}`,
    });
  }
}

/** Pays interest on cash accounts (monthly). */
export function payAccountInterest(state: SimulationState): void {
  for (const acct of Object.values(state.accounts)) {
    if (acct.interestRate <= 0 || acct.balance <= 0) continue;
    const amt = round2((acct.balance * acct.interestRate) / 12);
    if (amt <= 0) continue;
    postTransaction(state, {
      type: 'interest',
      category: 'interest',
      description: `Interest — ${acct.name}`,
      postings: [
        { kind: 'cash', accountId: acct.id, amount: amt },
        { kind: 'income', category: 'interest', amount: amt },
      ],
      recurring: true,
      tax: { interestIncome: amt },
      idempotencyKey: `int:${acct.id}:${state.currentDate}`,
    });
  }
}

/** Buys a security holding with cash (a purchase, routed through the normal purchase flow by callers). */
export function securityValueRuleFor(sec: SecurityDetails) {
  return { annualRate: sec.expectedAnnualReturn, annualVolatility: sec.annualVolatility, source: { type: 'simulation_generated' as const, label: `Expected ${(sec.expectedAnnualReturn * 100).toFixed(1)}%/yr, vol ${(sec.annualVolatility * 100).toFixed(0)}%` } };
}

/** Partially sells a liquid holding (reduces value; proceeds to cash; realized gain pro-rata on basis). */
export function sellSecurityPortion(state: SimulationState, assetId: Id, amount: Money, accountId?: Id): void {
  const a = state.assets[assetId];
  if (!a || a.status !== 'owned' || a.liquidity !== 'liquid') throw new Error('Not a liquid holding');
  const amt = round2(Math.min(amount, a.currentValue));
  if (amt <= 0) return;
  const j = JURISDICTIONS[state.profile.taxJurisdiction];
  const fraction = amt / a.currentValue;
  const basisPortion = round2(a.costBasis * fraction);
  const fee = round2(Math.min(500, amt * 0.0005));
  const gain = round2(amt - fee - basisPortion);
  postTransaction(state, {
    type: 'sale',
    category: 'public_security',
    description: `Sold ${amt.toLocaleString()} of ${a.name}`,
    postings: [
      { kind: 'cash', accountId: accountId ?? state.settings.defaultAccountId, amount: round2(amt - fee) },
      { kind: 'asset', assetId, amount: -amt },
      { kind: 'expense', category: 'fees', amount: fee },
    ],
    assetId,
    tax: { capitalGain: gain, longTerm: true },
    createdBy: 'user',
  });
  void j;
  a.costBasis = round2(a.costBasis - basisPortion);
  a.purchasePrice = round2(a.purchasePrice * (1 - fraction));
  if (a.currentValue <= 0.005) { a.status = 'sold'; a.sale = { date: state.currentDate, price: amt, fees: fee, taxes: 0, proceeds: amt - fee, gain, transactionId: state.ledger[state.ledger.length - 1].id }; }
}

export function updateSecurityAssumptions(state: SimulationState, assetId: Id, patch: Partial<Pick<SecurityDetails, 'expectedAnnualReturn' | 'annualVolatility' | 'dividendYield'>>): void {
  const a = state.assets[assetId];
  if (!a || a.details.kind !== 'security') throw new Error('Not a security');
  a.details.security = { ...a.details.security, ...patch };
  a.valueRule = { ...a.valueRule, annualRate: a.details.security.expectedAnnualReturn, annualVolatility: a.details.security.annualVolatility, source: { type: 'user_override', label: 'User override' } };
}

export function revalueWithEstimate(state: SimulationState, assetId: Id, estimate: Sourced<Money>): void {
  revalueAsset(state, assetId, estimate.value, estimate.source, estimate.value);
}
