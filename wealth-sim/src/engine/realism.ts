import type { SimulationState, Money } from './types';
import { round2, roundEstimate } from './money';
import { nextRandom, pick } from './rng';
import { postTransaction } from './ledger';
import { nextId } from './ids';
import { applyOverrun } from './projects';
import { revalueAsset } from './assets';
import { SCENARIOS } from './scenarios';

/**
 * Optional "realism events". Each one is explainable and traceable: it either
 * posts a normal ledger transaction, changes a recurring amount, or adjusts an
 * assumption (with a timeline entry saying why).
 */
export function maybeRealismEvent(state: SimulationState): void {
  if (!state.settings.realismEventsEnabled) return;
  if (nextRandom(state) > state.settings.realismEventRate) return;
  const owned = Object.values(state.assets).filter((a) => a.status === 'owned');
  const candidates: (() => void)[] = [];
  const acct = state.settings.defaultAccountId;
  const note = (title: string, detail: string, amount?: Money, assetId?: string) =>
    state.timeline.push({ id: nextId(state, 'tl'), date: state.currentDate, kind: 'realism', title, detail, amount, assetId });

  const props = owned.filter((a) => a.category === 'real_estate');
  if (props.length) candidates.push(() => {
    const p = pick(state, props);
    const amt = roundEstimate(p.currentValue * (0.002 + nextRandom(state) * 0.008), 2);
    postTransaction(state, { type: 'realism_event', category: 'maintenance', description: `Major repair at ${p.name} (roof/HVAC/plumbing)`, postings: [{ kind: 'cash', accountId: acct, amount: -amt }, { kind: 'expense', category: 'maintenance', amount: amt }], assetId: p.id });
    note(`Unexpected repair: ${p.name}`, 'Major systems failure; 0.2–1.0% of property value.', amt, p.id);
  });
  if (props.length) candidates.push(() => {
    const p = pick(state, props);
    const rec = p.recurringIds.map((id) => state.recurring[id]).find((r) => r && r.category === 'property_tax' && r.status === 'active');
    if (!rec) return;
    const bump = 0.05 + nextRandom(state) * 0.1;
    rec.amount = { ...rec.amount, value: round2(rec.amount.value * (1 + bump)), source: { type: 'simulation_generated', label: `Reassessment +${(bump * 100).toFixed(0)}%` } };
    note(`Property reassessment: ${p.name}`, `Property tax increased ${(bump * 100).toFixed(0)}% after reassessment.`, undefined, p.id);
  });
  const vehicles = owned.filter((a) => a.category === 'vehicle' || a.category === 'aircraft' || a.category === 'yacht');
  if (vehicles.length) candidates.push(() => {
    const v = pick(state, vehicles);
    const amt = roundEstimate(Math.max(2_000, v.currentValue * (0.01 + nextRandom(state) * 0.03)), 2);
    postTransaction(state, { type: 'realism_event', category: 'maintenance', description: `Unscheduled repair — ${v.name}`, postings: [{ kind: 'cash', accountId: acct, amount: -amt }, { kind: 'expense', category: 'maintenance', amount: amt }], assetId: v.id });
    note(`Unexpected repair: ${v.name}`, '1–4% of value for an unscheduled repair.', amt, v.id);
  });
  const insurance = Object.values(state.recurring).filter((r) => r.status === 'active' && r.category === 'insurance');
  if (insurance.length) candidates.push(() => {
    const r = pick(state, insurance);
    const bump = 0.08 + nextRandom(state) * 0.17;
    r.amount = { ...r.amount, value: round2(r.amount.value * (1 + bump)), source: { type: 'simulation_generated', label: `Premium increase +${(bump * 100).toFixed(0)}%` } };
    note(`Insurance premium increase: ${r.name}`, `Renewal came in ${(bump * 100).toFixed(0)}% higher.`);
  });
  const rentals = Object.values(state.recurring).filter((r) => r.status === 'active' && r.category === 'rental' && r.direction === 'income');
  if (rentals.length) candidates.push(() => {
    const r = pick(state, rentals);
    const months = 2 + Math.floor(nextRandom(state) * 4);
    r.assumptions.push({ key: 'vacancy', label: 'Tenant vacancy', value: `${months} months`, kind: 'simulation_assumption' });
    // Model vacancy as a lump refund of expected rent (negative income) to keep the ledger explicit.
    const lost = round2(r.amount.value * months);
    postTransaction(state, { type: 'realism_event', category: 'rental', description: `Tenant vacancy — ${r.name}: ${months} months of rent lost`, postings: [{ kind: 'cash', accountId: acct, amount: -lost }, { kind: 'income', category: 'rental', amount: -lost }], recurringId: r.id });
    note(`Tenant vacancy: ${r.name}`, `${months} months without rent.`, -lost);
  });
  const businesses = owned.filter((a) => a.details.kind === 'business');
  if (businesses.length) candidates.push(() => {
    const b = pick(state, businesses);
    if (b.details.kind !== 'business') return;
    const good = nextRandom(state) < 0.5;
    const pctChange = (0.05 + nextRandom(state) * 0.15) * (good ? 1 : -1);
    b.details.business.annualRevenue = round2(b.details.business.annualRevenue * (1 + pctChange));
    note(`${b.name}: ${good ? 'major contract won' : 'key customer lost'}`, `Annual revenue ${good ? 'up' : 'down'} ${(Math.abs(pctChange) * 100).toFixed(0)}%.`, undefined, b.id);
  });
  const securities = owned.filter((a) => a.details.kind === 'security');
  if (securities.length) candidates.push(() => {
    const s = pick(state, securities);
    const good = nextRandom(state) < 0.45;
    const pctChange = (0.05 + nextRandom(state) * 0.2) * (good ? 1 : -1);
    revalueAsset(state, s.id, s.currentValue * (1 + pctChange), { type: 'simulation_generated', label: good ? 'Positive surprise' : 'Negative surprise' }, undefined, `${s.name}: ${good ? 'strong results' : 'earnings miss'} (${(pctChange * 100).toFixed(0)}%)`);
    note(`${s.name}: ${good ? 'rallied' : 'sold off'} ${(Math.abs(pctChange) * 100).toFixed(0)}%`, good ? 'Positive company-specific news.' : 'Negative company-specific news.', undefined, s.id);
  });
  const projects = Object.values(state.projects).filter((p) => p.status === 'in_progress');
  if (projects.length) candidates.push(() => {
    const p = pick(state, projects);
    const rate = 0.05 + nextRandom(state) * 0.2;
    applyOverrun(state, p.id, rate, pick(state, ['permit delays', 'structural surprises', 'material price increases', 'scope creep']));
    note(`Cost overrun: ${p.name}`, `Remaining payments +${(rate * 100).toFixed(0)}%.`);
  });
  candidates.push(() => {
    const amt = roundEstimate(20_000 + nextRandom(state) * 200_000, 2);
    postTransaction(state, { type: 'realism_event', category: 'tax', description: 'Unexpected tax assessment / audit adjustment', postings: [{ kind: 'cash', accountId: acct, amount: -amt }, { kind: 'expense', category: 'tax', amount: amt }] });
    note('Unexpected tax expense', 'Prior-year adjustment after review.', amt);
  });
  if (state.settings.scenario.id === 'normal' && nextRandom(state) < 0.15) candidates.push(() => {
    state.settings.scenario = { ...SCENARIOS.recession };
    note('Economy entered recession', 'Market scenario switched to Recession. Change it back in Settings when you like.');
  });
  if (candidates.length === 0) return;
  pick(state, candidates)();
}
