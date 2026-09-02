import type { SimulationState, Project, Money, Id, Sourced, Assumption, ISODate } from './types';
import { round2 } from './money';
import { nextId } from './ids';
import { addMonths, compareDates } from './dates';
import { postTransaction } from './ledger';
import { ValidationError } from './errors';

export interface ProjectInput {
  name: string;
  description?: string;
  attachedAssetId?: Id;
  estimatedCost: Sourced<Money>;
  costRange?: { low: Money; high: Money };
  contingencyRate?: number;
  startDate?: ISODate;
  durationMonths: number;
  /** 0..1 fraction capitalized into the attached asset. Default 0.5 for renovations on real estate, 0 otherwise. */
  capitalizationRate?: number;
  payImmediately?: boolean;
  accountId?: Id;
  assumptions?: Assumption[];
  createdBy?: 'user' | 'assistant' | 'engine';
}

/** Builds the payment schedule: deposit at start, then equal monthly draws, final on completion. */
function buildSchedule(total: Money, start: ISODate, months: number, immediate: boolean): Project['payments'] {
  if (immediate || months <= 0) return [{ date: start, amount: round2(total), paid: false }];
  const deposit = round2(total * 0.25);
  const n = Math.max(1, months);
  const rest = round2(total - deposit);
  const per = round2(rest / n);
  const out: Project['payments'] = [{ date: start, amount: deposit, paid: false }];
  let acc = deposit;
  for (let i = 1; i <= n; i++) {
    const amt = i === n ? round2(total - acc) : per;
    acc = round2(acc + amt);
    out.push({ date: addMonths(start, i), amount: amt, paid: false });
  }
  return out;
}

export function createProject(state: SimulationState, input: ProjectInput): Project {
  if (input.estimatedCost.value <= 0) throw new ValidationError('Project cost must be positive');
  const attached = input.attachedAssetId ? state.assets[input.attachedAssetId] : undefined;
  if (input.attachedAssetId && !attached) throw new ValidationError('Unknown attached asset');
  const contingency = input.contingencyRate ?? 0.15;
  const total = round2(input.estimatedCost.value * (1 + contingency));
  const start = input.startDate ?? state.currentDate;
  const capRate = input.capitalizationRate ?? (attached && attached.category === 'real_estate' ? 0.5 : 0);
  const id = nextId(state, 'proj');
  const project: Project = {
    id,
    name: input.name,
    description: input.description,
    attachedAssetId: input.attachedAssetId,
    estimatedCost: input.estimatedCost,
    costRange: input.costRange,
    contingencyRate: contingency,
    startDate: start,
    durationMonths: input.durationMonths,
    capitalizationRate: capRate,
    payments: buildSchedule(total, start, input.durationMonths, input.payImmediately ?? false),
    actualCost: 0,
    overrunRate: 0,
    status: compareDates(start, state.currentDate) <= 0 ? 'in_progress' : 'planned',
    accountId: input.accountId ?? state.settings.defaultAccountId,
    assumptions: [
      { key: 'estimate', label: 'Base estimate', value: input.estimatedCost.value, kind: input.estimatedCost.source.type === 'user_entered' ? 'user_override' : 'calculated_value', source: input.estimatedCost.source },
      { key: 'contingency', label: 'Contingency', value: `${(contingency * 100).toFixed(0)}%`, kind: 'simulation_assumption' },
      { key: 'capitalization', label: 'Share of spend added to asset value', value: `${(capRate * 100).toFixed(0)}%`, kind: 'simulation_assumption' },
      { key: 'budget', label: 'Budget incl. contingency', value: total, kind: 'calculated_value' },
      ...(input.assumptions ?? []),
    ],
    createdBy: input.createdBy ?? 'user',
    createdOn: state.currentDate,
  };
  state.projects[id] = project;
  state.timeline.push({ id: nextId(state, 'tl'), date: state.currentDate, kind: 'project', title: `Started project: ${input.name}`, amount: total, assetId: input.attachedAssetId, detail: attached ? `Attached to ${attached.name}` : undefined });
  // Pay anything due today.
  processProjectPayments(state, project);
  return project;
}

/** Posts due payments. Capitalized share raises the attached asset's value; the rest is expensed. */
export function processProjectPayments(state: SimulationState, p: Project): void {
  if (p.status === 'cancelled' || p.status === 'completed') return;
  for (const pay of p.payments) {
    if (pay.paid || compareDates(pay.date, state.currentDate) > 0) continue;
    const amount = round2(pay.amount * (1 + p.overrunRate));
    const attached = p.attachedAssetId ? state.assets[p.attachedAssetId] : undefined;
    const cap = attached && attached.status === 'owned' ? round2(amount * p.capitalizationRate) : 0;
    const exp = round2(amount - cap);
    const postings: import('./types').Posting[] = [{ kind: 'cash', accountId: p.accountId, amount: -amount }];
    if (cap > 0 && attached) postings.push({ kind: 'asset', assetId: attached.id, amount: cap });
    if (exp > 0) postings.push({ kind: 'expense', category: 'project', amount: exp });
    const txn = postTransaction(state, {
      date: pay.date,
      type: 'project_payment',
      category: 'project',
      description: `${p.name} — payment ${p.payments.indexOf(pay) + 1}/${p.payments.length}`,
      postings,
      projectId: p.id,
      assetId: p.attachedAssetId,
      idempotencyKey: `proj:${p.id}:${pay.date}:${p.payments.indexOf(pay)}`,
    });
    if (cap > 0 && attached) attached.costBasis = round2(attached.costBasis + cap);
    pay.paid = true;
    pay.transactionId = txn.id;
    p.actualCost = round2(p.actualCost + amount);
    if (p.status === 'planned') p.status = 'in_progress';
  }
  if (p.payments.every((x) => x.paid)) {
    p.status = 'completed';
    state.timeline.push({ id: nextId(state, 'tl'), date: state.currentDate, kind: 'project', title: `Completed: ${p.name}`, amount: p.actualCost, assetId: p.attachedAssetId });
  }
}

export function cancelProject(state: SimulationState, projectId: Id): void {
  const p = state.projects[projectId];
  if (!p) throw new ValidationError('Unknown project');
  if (p.status === 'completed') throw new ValidationError('Project already completed');
  p.status = 'cancelled';
  state.timeline.push({ id: nextId(state, 'tl'), date: state.currentDate, kind: 'project', title: `Cancelled: ${p.name}`, amount: p.actualCost });
}

export function applyOverrun(state: SimulationState, projectId: Id, rate: number, reason: string): void {
  const p = state.projects[projectId];
  if (!p || p.status !== 'in_progress') return;
  p.overrunRate = round2((p.overrunRate + rate) * 100) / 100;
  p.assumptions.push({ key: 'overrun', label: 'Cost overrun', value: `+${(rate * 100).toFixed(0)}% on remaining payments: ${reason}`, kind: 'simulation_assumption' });
}

/** Reference cost ranges for common project types (per sq ft or flat). Simulation assumptions. */
export const PROJECT_REFERENCE: Record<string, { label: string; lowPerSqFt?: number; highPerSqFt?: number; low?: Money; high?: Money; months: number }> = {
  kitchen_renovation: { label: 'High-end kitchen renovation', low: 150_000, high: 600_000, months: 5 },
  full_renovation: { label: 'Complete high-end renovation', lowPerSqFt: 800, highPerSqFt: 1_500, months: 14 },
  interior_design: { label: 'Interior design overhaul', lowPerSqFt: 250, highPerSqFt: 600, months: 8 },
  garage_expansion: { label: 'Garage expansion (per car bay)', low: 80_000, high: 200_000, months: 6 },
  pool: { label: 'Pool installation', low: 150_000, high: 800_000, months: 6 },
  landscaping: { label: 'Landscaping redesign', low: 100_000, high: 2_000_000, months: 6 },
  home_theater: { label: 'Home theater', low: 100_000, high: 750_000, months: 4 },
  wine_cellar: { label: 'Underground wine cellar', low: 150_000, high: 1_200_000, months: 8 },
  aircraft_refurb: { label: 'Aircraft interior refurbishment', low: 1_000_000, high: 5_000_000, months: 5 },
  yacht_refit: { label: 'Yacht refit', low: 2_000_000, high: 25_000_000, months: 12 },
  art_installation: { label: 'Art installation', low: 50_000, high: 500_000, months: 3 },
  dressing_room: { label: 'Bedroom to dressing room conversion', low: 80_000, high: 300_000, months: 3 },
};
