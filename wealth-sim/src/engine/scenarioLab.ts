import type { SimulationState, Money, Id, Sourced } from './types';
import { cloneState } from './atomic';
import { advanceTime } from './time';
import { computeMetrics, type Metrics } from './metrics';
import { commitPurchase, type PurchaseSpec } from './purchase';
import { commitSale } from './sell';
import { SCENARIOS } from './scenarios';
import { revalueAsset } from './assets';
import { createRecurring, endRecurring } from './recurring';
import type { MarketScenarioId } from './types';

/**
 * Scenario Lab: runs hypothetical decisions on a cloned state and projects
 * forward. The live simulation is never touched. Randomness is seeded from
 * the same RNG state so baseline vs scenario are comparable.
 */
export type ScenarioAction =
  | { kind: 'purchase'; spec: PurchaseSpec }
  | { kind: 'sell'; assetId: Id; price: Sourced<Money> }
  | { kind: 'quit_job' }
  | { kind: 'set_annual_spend'; annual: Money }
  | { kind: 'market'; scenario: MarketScenarioId }
  | { kind: 'add_expense'; name: string; monthly: Money }
  | { kind: 'add_income'; name: string; monthly: Money }
  | { kind: 'shock'; assetCategory: 'public_security' | 'real_estate' | 'all'; pct: number };

export interface ProjectionPoint { years: number; date: string; metrics: Metrics }
export interface ScenarioResult {
  label: string;
  baseline: ProjectionPoint[];
  scenario: ProjectionPoint[];
  immediate: { before: Metrics; after: Metrics };
  warnings: string[];
}

export function applyScenarioActions(state: SimulationState, actions: ScenarioAction[]): SimulationState {
  let s = cloneState(state);
  for (const a of actions) {
    switch (a.kind) {
      case 'purchase': s = commitPurchase(s, { ...a.spec, idempotencyKey: undefined }).state; break;
      case 'sell': s = commitSale(s, a.assetId, a.price).state; break;
      case 'quit_job':
        for (const r of Object.values(s.recurring)) if (r.status === 'active' && r.direction === 'income' && (r.category === 'salary' || r.category === 'bonus')) endRecurring(s, r.id);
        break;
      case 'set_annual_spend': {
        // Replace discretionary lifestyle (non-asset-attached) expenses with a single line.
        for (const r of Object.values(s.recurring)) if (r.status === 'active' && r.direction === 'expense' && !r.assetId && !r.storageLocationId && !r.staffId) endRecurring(s, r.id);
        createRecurring(s, { name: 'Lifestyle spending (scenario)', direction: 'expense', category: 'custom', amount: { value: a.annual / 12, source: { type: 'user_entered' } }, interval: 'monthly', accountId: s.settings.defaultAccountId, createdBy: 'user' });
        break;
      }
      case 'market': s.settings.scenario = { ...SCENARIOS[a.scenario] }; break;
      case 'add_expense': createRecurring(s, { name: a.name, direction: 'expense', category: 'custom', amount: { value: a.monthly, source: { type: 'user_entered' } }, interval: 'monthly', accountId: s.settings.defaultAccountId }); break;
      case 'add_income': createRecurring(s, { name: a.name, direction: 'income', category: 'custom', amount: { value: a.monthly, source: { type: 'user_entered' } }, interval: 'monthly', accountId: s.settings.defaultAccountId }); break;
      case 'shock': {
        for (const asset of Object.values(s.assets)) {
          if (asset.status !== 'owned') continue;
          const hit = a.assetCategory === 'all' || asset.category === a.assetCategory || (a.assetCategory === 'public_security' && asset.details.kind === 'security');
          if (!hit) continue;
          revalueAsset(s, asset.id, asset.currentValue * (1 + a.pct), { type: 'simulation_generated', label: `Scenario shock ${(a.pct * 100).toFixed(0)}%` });
        }
        break;
      }
    }
  }
  return s;
}

export function runScenario(state: SimulationState, label: string, actions: ScenarioAction[], years = 10): ScenarioResult {
  const before = computeMetrics(state);
  const scenarioStart = applyScenarioActions(state, actions);
  const after = computeMetrics(scenarioStart);
  const points = (start: SimulationState) => {
    const out: ProjectionPoint[] = [{ years: 0, date: start.currentDate, metrics: computeMetrics(start) }];
    let s = cloneState(start);
    s.settings.realismEventsEnabled = false; // keep projections comparable
    for (let y = 1; y <= years; y++) {
      s = advanceTime(s, 'year', 1);
      out.push({ years: y, date: s.currentDate, metrics: computeMetrics(s) });
    }
    return out;
  };
  const warnings: string[] = [];
  const scenario = points(scenarioStart);
  const baseline = points(state);
  const negCash = scenario.find((p) => p.metrics.cash < 0);
  if (negCash) warnings.push(`Cash goes negative by year ${negCash.years} under this scenario. You would need to sell assets or borrow.`);
  if (after.monthlyCashFlow < 0) warnings.push(`Monthly cash flow is negative (${after.monthlyCashFlow.toLocaleString()}/month) immediately after these actions.`);
  if (after.cash < 0) warnings.push(`This requires more cash than you have (cash after: ${after.cash.toLocaleString()}). Net worth is ${after.netWorth.toLocaleString()} but net worth is not liquidity.`);
  return { label, baseline, scenario, immediate: { before, after }, warnings };
}
