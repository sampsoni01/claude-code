import type { SimulationState, RecurringItem, RecurrenceInterval, ExpenseCategory, IncomeCategory, Sourced, Money, Id, ISODate, Assumption, StaffMember, TaxRelevance } from './types';
import { nextId } from './ids';
import { round2 } from './money';
import { addInterval, compareDates } from './dates';
import { postTransaction } from './ledger';
import { ValidationError } from './errors';
import { JURISDICTIONS, salaryWithholdingRate } from './tax';
import { intervalsPerYear } from './dates';

export interface RecurringInput {
  name: string;
  direction: 'expense' | 'income';
  category: ExpenseCategory | IncomeCategory;
  amount: Sourced<Money>;
  interval: RecurrenceInterval;
  accountId: Id;
  nextDate?: ISODate;
  endDate?: ISODate;
  assetId?: Id;
  storageLocationId?: Id;
  staffId?: Id;
  projectId?: Id;
  inflationRate?: number;
  taxTreatment?: RecurringItem['taxTreatment'];
  assumptions?: Assumption[];
  createdBy?: 'user' | 'assistant' | 'catalog' | 'engine';
  notes?: string;
}

export function createRecurring(state: SimulationState, input: RecurringInput): RecurringItem {
  if (!Number.isFinite(input.amount.value) || input.amount.value < 0) throw new ValidationError(`Recurring amount invalid for ${input.name}`);
  if (!state.accounts[input.accountId]) throw new ValidationError(`Unknown account ${input.accountId}`);
  const id = nextId(state, 'rec');
  const item: RecurringItem = {
    id,
    name: input.name,
    direction: input.direction,
    category: input.category,
    amount: { ...input.amount, value: round2(input.amount.value) },
    interval: input.interval,
    nextDate: input.nextDate ?? addInterval(state.currentDate, input.interval),
    endDate: input.endDate,
    accountId: input.accountId,
    assetId: input.assetId,
    storageLocationId: input.storageLocationId,
    staffId: input.staffId,
    projectId: input.projectId,
    inflationRate: input.inflationRate ?? 0.03,
    taxTreatment: input.taxTreatment ?? (input.direction === 'income' ? 'ordinary_income' : 'non_deductible'),
    status: 'active',
    assumptions: input.assumptions ?? [],
    createdBy: input.createdBy ?? 'user',
    createdOn: state.currentDate,
    notes: input.notes,
  };
  state.recurring[id] = item;
  if (input.assetId && state.assets[input.assetId]) state.assets[input.assetId].recurringIds.push(id);
  return item;
}

export function endRecurring(state: SimulationState, id: Id, endDate?: ISODate): void {
  const r = state.recurring[id];
  if (!r) throw new ValidationError(`Unknown recurring item ${id}`);
  r.status = 'ended';
  r.endDate = endDate ?? state.currentDate;
}

export function overrideRecurringAmount(state: SimulationState, id: Id, value: Money, note?: string): void {
  const r = state.recurring[id];
  if (!r) throw new ValidationError(`Unknown recurring item ${id}`);
  if (value < 0) throw new ValidationError('Amount cannot be negative');
  const original = r.amount.override?.original ?? r.amount.value;
  r.amount = { value: round2(value), source: { type: 'user_override', label: note ?? 'User override' }, override: { original, overriddenOn: state.currentDate, note } };
}

function expenseCategoryToType(cat: string): 'property_tax' | 'insurance' | 'maintenance' | 'staff_payroll' | 'recurring_expense' {
  if (cat === 'property_tax') return 'property_tax';
  if (cat === 'insurance') return 'insurance';
  if (cat === 'maintenance') return 'maintenance';
  if (cat === 'staff') return 'staff_payroll';
  return 'recurring_expense';
}

/** Posts one occurrence of a recurring item and advances its next date. */
export function processRecurringOccurrence(state: SimulationState, item: RecurringItem): void {
  const date = item.nextDate;
  const amount = item.amount.value;
  const key = `rec:${item.id}:${date}`;
  if (item.direction === 'expense') {
    if (amount > 0) {
      const tax: TaxRelevance | undefined =
        item.category === 'property_tax' ? { deductible: amount } :
        item.taxTreatment === 'deductible' ? { deductible: amount } : undefined;
      postTransaction(state, {
        date,
        type: expenseCategoryToType(item.category),
        category: item.category,
        description: item.name,
        postings: [
          { kind: 'cash', accountId: item.accountId, amount: -amount },
          { kind: 'expense', category: item.category as ExpenseCategory, amount },
        ],
        assetId: item.assetId,
        recurringId: item.id,
        projectId: item.projectId,
        recurring: true,
        tax,
        idempotencyKey: key,
      });
      if (item.category === 'property_tax') state.taxYear.propertyTaxPaid = round2(state.taxYear.propertyTaxPaid + amount);
    }
  } else {
    if (amount > 0) {
      const gross = amount;
      let withheld = 0;
      if (item.taxTreatment === 'ordinary_income' || item.taxTreatment === 'withheld_at_source') {
        const j = JURISDICTIONS[state.profile.taxJurisdiction];
        const annual = gross * intervalsPerYear(item.interval);
        withheld = round2(gross * salaryWithholdingRate(annual, j));
      }
      const net = round2(gross - withheld);
      const postings = [
        { kind: 'cash' as const, accountId: item.accountId, amount: net },
        { kind: 'income' as const, category: item.category as IncomeCategory, amount: gross },
      ];
      if (withheld > 0) postings.push({ kind: 'expense', category: 'tax', amount: withheld } as any);
      postTransaction(state, {
        date,
        type: item.category === 'salary' ? 'salary' : 'income',
        category: item.category,
        description: withheld > 0 ? `${item.name} (gross ${gross.toFixed(0)}, tax withheld ${withheld.toFixed(0)})` : item.name,
        postings,
        assetId: item.assetId,
        recurringId: item.id,
        recurring: true,
        tax: item.taxTreatment === 'tax_free' ? undefined : { ordinaryIncome: gross, taxPaid: withheld },
        idempotencyKey: key,
      });
    }
  }
  item.nextDate = addInterval(date, item.interval);
  if (item.endDate && compareDates(item.nextDate, item.endDate) > 0) item.status = 'ended';
}

/** Applies annual inflation to recurring expenses (called each Jan 1). */
export function applyInflation(state: SimulationState, rate: number): void {
  for (const r of Object.values(state.recurring)) {
    if (r.status !== 'active' || r.direction !== 'expense') continue;
    const eff = r.inflationRate > 0 ? rate : 0;
    if (eff === 0) continue;
    r.amount = { ...r.amount, value: round2(r.amount.value * (1 + eff)) };
  }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export function hireStaff(
  state: SimulationState,
  input: { role: string; name?: string; baseSalary: Sourced<Money>; overheadRate?: number; accountId?: Id; assignedAssetId?: Id; assumptions?: Assumption[]; createdBy?: 'user' | 'assistant' | 'catalog' },
): StaffMember {
  const overhead = input.overheadRate ?? 0.22;
  const annualCost = round2(input.baseSalary.value * (1 + overhead));
  const id = nextId(state, 'staff');
  const rec = createRecurring(state, {
    name: `${input.role} payroll${input.name ? ` (${input.name})` : ''}`,
    direction: 'expense',
    category: 'staff',
    amount: { value: round2(annualCost / 12), source: { type: 'calculated_estimate', label: `Salary × (1 + ${(overhead * 100).toFixed(0)}% employer overhead) / 12` } },
    interval: 'monthly',
    accountId: input.accountId ?? state.settings.defaultAccountId,
    assetId: input.assignedAssetId,
    staffId: id,
    assumptions: input.assumptions,
    createdBy: input.createdBy ?? 'user',
  });
  const staff: StaffMember = {
    id,
    role: input.role,
    name: input.name,
    baseSalary: input.baseSalary,
    overheadRate: overhead,
    recurringId: rec.id,
    assignedAssetId: input.assignedAssetId,
    startDate: state.currentDate,
    status: 'active',
    assumptions: [
      { key: 'base_salary', label: 'Base salary', value: input.baseSalary.value, kind: input.baseSalary.source.type === 'user_entered' ? 'user_override' : 'real_world_data', source: input.baseSalary.source },
      { key: 'overhead', label: 'Employer payroll/benefits overhead', value: `${(overhead * 100).toFixed(0)}%`, kind: 'simulation_assumption' },
      { key: 'annual_cost', label: 'Annual simulated cost', value: annualCost, kind: 'calculated_value' },
      ...(input.assumptions ?? []),
    ],
  };
  state.staff[id] = staff;
  state.timeline.push({ id: nextId(state, 'tl'), date: state.currentDate, kind: 'staff', title: `Hired ${input.role}`, amount: annualCost });
  return staff;
}

export function terminateStaff(state: SimulationState, staffId: Id): void {
  const s = state.staff[staffId];
  if (!s) throw new ValidationError('Unknown staff member');
  s.status = 'terminated';
  s.endDate = state.currentDate;
  endRecurring(state, s.recurringId);
  state.timeline.push({ id: nextId(state, 'tl'), date: state.currentDate, kind: 'staff', title: `Ended ${s.role} employment` });
}
