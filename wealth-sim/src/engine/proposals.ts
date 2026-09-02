import type { SimulationState, Money, Id, Sourced, Assumption, ExpenseCategory, IncomeCategory, RecurrenceInterval, AssetCategory, AssetDetails, StorageKind, ISODate, SourceInfo, ValueRule } from './types';
import { round2 } from './money';
import { atomic } from './atomic';
import { nextId } from './ids';
import { planPurchase, commitPurchaseInPlace, type PurchaseSpec, type PurchasePlan } from './purchase';
import { estimateEvent } from './events';
import { createRecurring, hireStaff } from './recurring';
import { createProject, type ProjectInput } from './projects';
import { createEvent, type EventSpec } from './events';
import { createStorageLocation } from './storage';
import { createLiability } from './loans';
import { postTransaction } from './ledger';
import { computeMetrics, type Metrics } from './metrics';
import { ValidationError } from './errors';
import type { FinancingTerms } from './loans';

/**
 * Proposals are the ONLY way assistants (or the AI adapter) create things.
 * A proposal is a list of primitive operations. Primitives resolve to the
 * same engine functions and ledger postings as built-in content; nothing here
 * can invent new accounting behaviour.
 */
export type Primitive =
  | { kind: 'asset'; spec: PurchaseSpec }
  | { kind: 'recurring_expense'; name: string; category: ExpenseCategory; amount: Sourced<Money>; interval: RecurrenceInterval; assetRef?: string; assumptions?: Assumption[]; endDate?: ISODate }
  | { kind: 'one_time_expense'; name: string; category: ExpenseCategory; amount: Sourced<Money>; assetRef?: string; assumptions?: Assumption[] }
  | { kind: 'income_stream'; name: string; category: IncomeCategory; amount: Sourced<Money>; interval: RecurrenceInterval; assumptions?: Assumption[] }
  | { kind: 'staff'; role: string; name?: string; baseSalary: Sourced<Money>; overheadRate?: number; assetRef?: string; assumptions?: Assumption[] }
  | { kind: 'project'; input: Omit<ProjectInput, 'attachedAssetId'>; assetRef?: string }
  | { kind: 'event'; spec: EventSpec }
  | { kind: 'storage_location'; name: string; storageKind: StorageKind; capacity: number; monthlyRent?: Money; accepts?: AssetCategory[]; propertyRef?: string }
  | { kind: 'liability'; name: string; loanKind: FinancingTerms['kind']; principal: Money; annualRate: number; termMonths: number; interestOnly?: boolean; assetRef?: string }
  | { kind: 'custom_asset'; ref?: string; name: string; description?: string; category: AssetCategory; value: Sourced<Money>; valueRule?: Partial<ValueRule>; details?: AssetDetails; storageLocationId?: Id | null; resaleAllowed?: boolean; assumptions?: Assumption[]; recurring?: { name: string; category: ExpenseCategory; amount: Money; interval: RecurrenceInterval; source: SourceInfo }[] };

export interface Proposal {
  id: Id;
  title: string;
  /** Plain-language explanation of the structure and why. */
  explanation: string;
  primitives: Primitive[];
  assumptions: Assumption[];
  /** Named refs → created asset ids, filled at commit time. */
  refs?: Record<string, Id>;
  createdBy: 'assistant' | 'user' | 'llm';
  assistantId?: string;
  status: 'proposed' | 'committed' | 'rejected';
  createdOn: ISODate;
}

export interface ProposalPreview {
  proposal: Proposal;
  immediateCash: Money;
  annualRecurring: Money;
  newDebt: Money;
  newAssetValue: Money;
  before: Metrics;
  after: Metrics;
  purchasePlans: PurchasePlan[];
  warnings: string[];
  lines: { label: string; amount: Money; kind: 'one_time' | 'annual' | 'asset' | 'debt' }[];
}

export function newProposal(state: SimulationState, input: Omit<Proposal, 'id' | 'status' | 'createdOn'>): Proposal {
  return { ...input, id: nextId(state, 'prop'), status: 'proposed', createdOn: state.currentDate };
}

const PER: Record<RecurrenceInterval, number> = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, annual: 1 };

export function previewProposal(state: SimulationState, proposal: Proposal): ProposalPreview {
  const before = computeMetrics(state);
  const lines: ProposalPreview['lines'] = [];
  let immediate = 0, annual = 0, debt = 0, assetValue = 0;
  const purchasePlans: PurchasePlan[] = [];
  const warnings: string[] = [];
  for (const p of proposal.primitives) {
    switch (p.kind) {
      case 'asset': {
        const plan = planPurchase(state, p.spec);
        purchasePlans.push(plan);
        immediate += plan.cashRequired; annual += plan.annualOwnershipCost; debt += plan.loanAmount; assetValue += plan.price;
        lines.push({ label: `${p.spec.name} (cash required)`, amount: plan.cashRequired, kind: 'one_time' });
        if (plan.loanAmount) lines.push({ label: `Loan — ${p.spec.name}`, amount: plan.loanAmount, kind: 'debt' });
        lines.push({ label: `${p.spec.name} — ownership costs`, amount: plan.annualOwnershipCost, kind: 'annual' });
        warnings.push(...plan.warnings);
        break;
      }
      case 'recurring_expense': { const a = p.amount.value * PER[p.interval]; annual += a; lines.push({ label: p.name, amount: a, kind: 'annual' }); break; }
      case 'income_stream': { const a = p.amount.value * PER[p.interval]; annual -= a; lines.push({ label: p.name, amount: -a, kind: 'annual' }); break; }
      case 'one_time_expense': { immediate += p.amount.value; lines.push({ label: p.name, amount: p.amount.value, kind: 'one_time' }); break; }
      case 'staff': { const a = p.baseSalary.value * (1 + (p.overheadRate ?? 0.22)); annual += a; lines.push({ label: `${p.role} (loaded)`, amount: round2(a), kind: 'annual' }); break; }
      case 'project': { const total = p.input.estimatedCost.value * (1 + (p.input.contingencyRate ?? 0.15)); lines.push({ label: `${p.input.name} budget (over ${p.input.durationMonths} months)`, amount: round2(total), kind: 'one_time' }); immediate += p.input.payImmediately ? total : total * 0.25; break; }
      case 'event': { const { total } = estimateEvent(p.spec); immediate += total; lines.push({ label: p.spec.name, amount: total, kind: 'one_time' }); break; }
      case 'storage_location': { if (p.monthlyRent) { annual += p.monthlyRent * 12; lines.push({ label: `${p.name} rent`, amount: p.monthlyRent * 12, kind: 'annual' }); } break; }
      case 'liability': { debt += p.principal; immediate -= p.principal; lines.push({ label: p.name, amount: p.principal, kind: 'debt' }); annual += p.principal * p.annualRate; break; }
      case 'custom_asset': { immediate += p.value.value; assetValue += p.value.value; lines.push({ label: p.name, amount: p.value.value, kind: 'asset' }); for (const r of p.recurring ?? []) { annual += r.amount * PER[r.interval]; lines.push({ label: r.name, amount: r.amount * PER[r.interval], kind: 'annual' }); } break; }
    }
  }
  const { state: afterState } = atomic(state, (d) => commitProposalInternal(d, proposal));
  const after = computeMetrics(afterState);
  if (after.cash < 0 && before.cash >= 0) warnings.push(`Cash would go negative (${after.cash.toLocaleString()}). Consider financing or selling assets.`);
  return { proposal, immediateCash: round2(immediate), annualRecurring: round2(annual), newDebt: round2(debt), newAssetValue: round2(assetValue), before, after, purchasePlans, warnings: Array.from(new Set(warnings)), lines };
}

export function commitProposal(state: SimulationState, proposal: Proposal): { state: SimulationState; refs: Record<string, Id> } {
  const { state: s, result } = atomic(state, (d) => commitProposalInternal(d, proposal));
  return { state: s, refs: result };
}

function commitProposalInternal(d: SimulationState, proposal: Proposal): Record<string, Id> {
  const refs: Record<string, Id> = {};
  const resolveRef = (ref?: string): Id | undefined => {
    if (!ref) return undefined;
    if (refs[ref]) return refs[ref];
    if (d.assets[ref]) return ref;
    throw new ValidationError(`Unknown asset reference "${ref}"`);
  };
  const acct = d.settings.defaultAccountId;
  for (const p of proposal.primitives) {
    switch (p.kind) {
      case 'asset': {
        const r = commitInto(d, p.spec);
        refs[p.spec.name] = r;
        if (p.spec.tags) for (const t of p.spec.tags) if (t.startsWith('ref:')) refs[t.slice(4)] = r;
        break;
      }
      case 'recurring_expense':
        createRecurring(d, { name: p.name, direction: 'expense', category: p.category, amount: p.amount, interval: p.interval, accountId: acct, assetId: resolveRef(p.assetRef), assumptions: p.assumptions, endDate: p.endDate, createdBy: 'assistant' });
        break;
      case 'income_stream':
        createRecurring(d, { name: p.name, direction: 'income', category: p.category, amount: p.amount, interval: p.interval, accountId: acct, assumptions: p.assumptions, createdBy: 'assistant' });
        break;
      case 'one_time_expense':
        postTransaction(d, { type: 'one_time_expense', category: p.category, description: p.name, postings: [{ kind: 'cash', accountId: acct, amount: -p.amount.value }, { kind: 'expense', category: p.category, amount: p.amount.value }], assetId: resolveRef(p.assetRef), createdBy: 'assistant', notes: p.assumptions ? JSON.stringify(p.assumptions) : undefined });
        break;
      case 'staff':
        hireStaff(d, { role: p.role, name: p.name, baseSalary: p.baseSalary, overheadRate: p.overheadRate, assignedAssetId: resolveRef(p.assetRef), assumptions: p.assumptions, createdBy: 'assistant' });
        break;
      case 'project':
        createProject(d, { ...p.input, attachedAssetId: resolveRef(p.assetRef), createdBy: 'assistant' });
        break;
      case 'event':
        createEvent(d, p.spec);
        break;
      case 'storage_location':
        createStorageLocation(d, { name: p.name, kind: p.storageKind, capacity: p.capacity, monthlyRent: p.monthlyRent, accepts: p.accepts, propertyId: resolveRef(p.propertyRef), createdBy: 'assistant' });
        break;
      case 'liability': {
        const l = createLiability(d, { name: p.name, kind: p.loanKind, principal: p.principal, annualRate: p.annualRate, termMonths: p.termMonths, interestOnly: p.interestOnly, paymentAccountId: acct, securedByAssetId: resolveRef(p.assetRef) });
        postTransaction(d, { type: 'loan_origination', category: 'financing', description: `Borrowed ${p.principal.toLocaleString()} — ${p.name}`, postings: [{ kind: 'cash', accountId: acct, amount: p.principal }, { kind: 'liability', liabilityId: l.id, amount: p.principal }], liabilityId: l.id, createdBy: 'assistant' });
        const a = resolveRef(p.assetRef); if (a) d.assets[a].liabilityIds.push(l.id);
        d.timeline.push({ id: nextId(d, 'tl'), date: d.currentDate, kind: 'financing', title: `New loan: ${p.name}`, amount: p.principal });
        break;
      }
      case 'custom_asset': {
        const spec: PurchaseSpec = {
          name: p.name, description: p.description, category: p.category,
          details: p.details ?? { kind: 'generic', fields: {} },
          price: p.value, storageLocationId: p.storageLocationId,
          valueRule: p.valueRule ? { annualRate: p.valueRule.annualRate ?? 0, annualVolatility: p.valueRule.annualVolatility ?? 0, floorFraction: p.valueRule.floorFraction, source: p.valueRule.source ?? { type: 'calculated_estimate', label: 'Assistant assumption' } } : undefined,
          extraRecurring: p.recurring, skipModelRecurring: !!p.recurring, assumptions: p.assumptions, createdBy: 'assistant',
        };
        const id = commitInto(d, spec);
        refs[p.ref ?? p.name] = id;
        if (p.resaleAllowed === false) d.assets[id].resaleAllowed = false;
        break;
      }
    }
  }
  proposal.status = 'committed';
  proposal.refs = refs;
  d.proposals[proposal.id] = structuredClone(proposal);
  return refs;
}

function commitInto(d: SimulationState, spec: PurchaseSpec): Id {
  return commitPurchaseInPlace(d, spec).assetId;
}
