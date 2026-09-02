import type { SimulationState, AssetCategory, AssetDetails, Money, Id, Sourced, ExternalListing, Assumption, Posting, ValueRule } from './types';
import { round2 } from './money';
import { JURISDICTIONS } from './tax';
import { ownershipModel, type CostModelOptions } from './costModels';
import { computeMetrics, type Metrics } from './metrics';
import { createAssetRecord, attachLiability } from './assets';
import { createLiability, resolveDownPayment, defaultTerms, type FinancingTerms } from './loans';
import { createRecurring } from './recurring';
import { postTransaction } from './ledger';
import { assignStorage, findAvailableLocation, storageOptionsWhenFull } from './storage';
import { nextId } from './ids';
import { atomic } from './atomic';
import { ValidationError } from './errors';
import { addMonths } from './dates';

export interface PurchaseSpec {
  name: string;
  description?: string;
  category: AssetCategory;
  details: AssetDetails;
  price: Sourced<Money>;
  accountId?: Id;
  financing?: FinancingTerms;
  storageLocationId?: Id | null;
  /** Skip storage auto-assignment (e.g. for properties). */
  costOptions?: CostModelOptions;
  listing?: ExternalListing;
  /** Override the model's value rule (e.g. investment holdings). */
  valueRule?: ValueRule;
  /** Extra recurring specs supplied by user/assistant, already priced. */
  extraRecurring?: { name: string; category: import('./types').ExpenseCategory; amount: Money; interval: import('./types').RecurrenceInterval; source: import('./types').SourceInfo }[];
  /** Skip the model's own recurring specs (when caller provides all). */
  skipModelRecurring?: boolean;
  assumptions?: Assumption[];
  tags?: string[];
  notes?: string;
  createdBy?: 'user' | 'assistant' | 'catalog';
  /** Idempotency key to prevent the same purchase being committed twice. */
  idempotencyKey?: string;
}

export interface PurchasePlan {
  spec: PurchaseSpec;
  price: Money;
  salesTax: Money;
  fees: Money;
  feeBreakdown: { label: string; amount: Money }[];
  downPayment: Money;
  loanAmount: Money;
  loanMonthlyPayment: Money;
  loanRate: number;
  loanTermMonths: number;
  cashRequired: Money;
  cashAvailable: Money;
  cashShortfall: Money;
  recurring: { name: string; category: string; amount: Money; interval: string; annual: Money }[];
  annualOwnershipCost: Money;
  estimatedAnnualValueChange: Money;
  before: Metrics;
  after: Metrics;
  storage: { locationId: Id | null; locationName?: string; needsStorage: boolean; options: string[] };
  warnings: string[];
  assumptions: Assumption[];
}

const PHYSICAL: AssetCategory[] = ['vehicle', 'aircraft', 'yacht', 'art', 'collectible', 'jewelry_watches', 'furniture', 'luxury_goods', 'custom_physical'];

/** Computes a purchase preview without committing. Deterministic given state. */
export function planPurchase(state: SimulationState, spec: PurchaseSpec): PurchasePlan {
  if (!Number.isFinite(spec.price.value) || spec.price.value <= 0) throw new ValidationError('Purchase price must be positive');
  const j = JURISDICTIONS[state.profile.taxJurisdiction];
  const model = ownershipModel(spec.category, spec.price.value, j, spec.costOptions);
  const price = round2(spec.price.value);
  const accountId = spec.accountId ?? state.settings.defaultAccountId;
  const account = state.accounts[accountId];
  if (!account) throw new ValidationError(`Unknown account ${accountId}`);

  let downPayment = price;
  let loanAmount = 0;
  let loanMonthly = 0;
  let loanRate = 0;
  let loanTerm = 0;
  if (spec.financing) {
    const dt = defaultTerms(spec.financing.kind, state.settings.scenario.rateShift);
    downPayment = resolveDownPayment(price, spec.financing);
    loanAmount = round2(price - downPayment);
    loanRate = spec.financing.annualRate ?? dt.annualRate;
    loanTerm = spec.financing.termMonths ?? dt.termMonths;
    if (loanAmount > 0) {
      const tmp = { ...state, liabilities: {}, counters: { ...state.counters } } as SimulationState;
      const l = createLiability(tmp, { name: 'tmp', kind: spec.financing.kind, principal: loanAmount, annualRate: loanRate, termMonths: loanTerm, interestOnly: spec.financing.interestOnly, balloonPayment: spec.financing.balloonPayment, paymentAccountId: accountId });
      loanMonthly = l.monthlyPayment;
    }
  }

  const cashRequired = round2(downPayment + model.acquisition.salesTax + model.acquisition.fees);
  const recurringSpecs = [...(spec.skipModelRecurring ? [] : model.recurring), ...(spec.extraRecurring ?? [])];
  const per = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, annual: 1 } as const;
  const recurring = recurringSpecs.map((r) => ({ name: r.name, category: r.category, amount: r.amount, interval: r.interval, annual: round2(r.amount * per[r.interval]) }));
  const annualOwnership = round2(recurring.reduce((s, r) => s + r.annual, 0) + loanAmount * loanRate);
  const valueRule = spec.valueRule ?? model.valueRule;

  // Storage
  let storageLocationId: Id | null = null;
  let locationName: string | undefined;
  const needsStorage = PHYSICAL.includes(spec.category);
  let options: string[] = [];
  if (needsStorage) {
    if (spec.storageLocationId) {
      const loc = state.storage[spec.storageLocationId];
      if (!loc) throw new ValidationError('Unknown storage location');
      storageLocationId = loc.id;
      locationName = loc.name;
    } else if (spec.storageLocationId === undefined) {
      const loc = findAvailableLocation(state, spec.category);
      if (loc) { storageLocationId = loc.id; locationName = loc.name; }
      else options = storageOptionsWhenFull(state, spec.category);
    }
  }

  // Before/after: simulate on a clone (cheap enough; keeps preview honest).
  const before = computeMetrics(state);
  const { state: afterState } = atomic(state, (d) => commitPurchaseInternal(d, spec, { skipStorage: true }));
  const after = computeMetrics(afterState);

  const warnings: string[] = [];
  const shortfall = round2(Math.max(0, cashRequired - account.balance));
  if (shortfall > 0) warnings.push(`This purchase requires ${cashRequired.toLocaleString()} in cash but ${account.name} holds ${account.balance.toLocaleString()}. Net worth is ${before.netWorth.toLocaleString()} but liquidity is the constraint: consider financing, selling assets, or a securities-backed line.`);
  if (after.monthlyCashFlow < 0 && before.monthlyCashFlow >= 0) warnings.push('Monthly cash flow turns negative after this purchase.');
  if (needsStorage && !storageLocationId) warnings.push('No storage location has capacity for this asset. It will be left unassigned unless you pick an option.');
  if (loanAmount > 0 && loanMonthly * 12 > before.monthlyIncome * 12 * 0.5) warnings.push('Debt service on this loan exceeds 50% of current income.');

  return {
    spec,
    price,
    salesTax: model.acquisition.salesTax,
    fees: model.acquisition.fees,
    feeBreakdown: model.acquisition.feeBreakdown.map((f) => ({ label: f.label, amount: f.amount })),
    downPayment,
    loanAmount,
    loanMonthlyPayment: loanMonthly,
    loanRate,
    loanTermMonths: loanTerm,
    cashRequired,
    cashAvailable: account.balance,
    cashShortfall: shortfall,
    recurring,
    annualOwnershipCost: annualOwnership,
    estimatedAnnualValueChange: round2(price * valueRule.annualRate),
    before,
    after,
    storage: { locationId: storageLocationId, locationName, needsStorage, options },
    warnings,
    assumptions: [...model.assumptions, ...(spec.assumptions ?? []), { key: 'price', label: 'Purchase price', value: price, kind: spec.price.source.type === 'retrieved_real_world' ? 'real_world_data' : spec.price.source.type === 'user_entered' ? 'user_override' : 'simulation_assumption', source: spec.price.source }],
  };
}

/** Commits a purchase atomically. Returns the new state and the created asset id. */
export function commitPurchase(state: SimulationState, spec: PurchaseSpec): { state: SimulationState; assetId: Id; transactionId: Id } {
  const { state: s, result } = atomic(state, (d) => commitPurchaseInternal(d, spec, { skipStorage: false }));
  return { state: s, ...result };
}

/** Commits a purchase directly into a draft state (no clone). Use inside an outer atomic(). */
export function commitPurchaseInPlace(d: SimulationState, spec: PurchaseSpec): { assetId: Id; transactionId: Id } { return commitPurchaseInternal(d, spec, { skipStorage: false }); }

function commitPurchaseInternal(d: SimulationState, spec: PurchaseSpec, opts: { skipStorage: boolean }): { assetId: Id; transactionId: Id } {
  const j = JURISDICTIONS[d.profile.taxJurisdiction];
  const model = ownershipModel(spec.category, spec.price.value, j, spec.costOptions);
  const price = round2(spec.price.value);
  const accountId = spec.accountId ?? d.settings.defaultAccountId;
  if (!d.accounts[accountId]) throw new ValidationError(`Unknown account ${accountId}`);
  const valueRule = spec.valueRule ?? model.valueRule;

  const asset = createAssetRecord(d, {
    name: spec.name,
    description: spec.description,
    category: spec.category,
    details: spec.details,
    value: price,
    purchasePrice: price,
    costBasis: round2(price + model.acquisition.fees + model.acquisition.salesTax),
    valueRule,
    liquidity: model.liquidity,
    storageLocationId: null,
    assumptions: [...model.assumptions, ...(spec.assumptions ?? [])],
    tags: spec.tags,
    notes: spec.notes,
    createdBy: spec.createdBy ?? 'user',
  });

  const postings: Posting[] = [];
  let downPayment = price;
  let liabilityId: Id | undefined;
  let loanAmount = 0;
  if (spec.financing) {
    downPayment = resolveDownPayment(price, spec.financing);
    loanAmount = round2(price - downPayment);
    if (loanAmount > 0) {
      const dt = defaultTerms(spec.financing.kind, d.settings.scenario.rateShift);
      const l = createLiability(d, {
        name: `${spec.financing.kind.replace('_', ' ')} — ${spec.name}`,
        kind: spec.financing.kind,
        principal: loanAmount,
        annualRate: spec.financing.annualRate ?? dt.annualRate,
        termMonths: spec.financing.termMonths ?? dt.termMonths,
        interestOnly: spec.financing.interestOnly,
        balloonPayment: spec.financing.balloonPayment,
        paymentAccountId: accountId,
        securedByAssetId: asset.id,
        source: spec.financing.source,
        firstPaymentDate: addMonths(d.currentDate, 1),
      });
      liabilityId = l.id;
      attachLiability(d, asset.id, l.id);
      postings.push({ kind: 'liability', liabilityId: l.id, amount: loanAmount });
    }
  }
  const cashOut = round2(downPayment + model.acquisition.salesTax + model.acquisition.fees);
  postings.push({ kind: 'cash', accountId, amount: -cashOut });
  postings.push({ kind: 'asset', assetId: asset.id, amount: price });
  if (model.acquisition.salesTax > 0) postings.push({ kind: 'expense', category: 'tax', amount: model.acquisition.salesTax });
  if (model.acquisition.fees > 0) postings.push({ kind: 'expense', category: 'fees', amount: model.acquisition.fees });

  const txn = postTransaction(d, {
    type: 'purchase',
    category: spec.category,
    description: `Purchased ${spec.name}${loanAmount > 0 ? ` (financed ${loanAmount.toLocaleString()})` : ''}`,
    postings,
    assetId: asset.id,
    liabilityId,
    notes: spec.notes,
    idempotencyKey: spec.idempotencyKey,
    createdBy: spec.createdBy === 'assistant' ? 'assistant' : 'user',
  });
  d.taxYear.salesTaxPaid = round2(d.taxYear.salesTaxPaid + model.acquisition.salesTax);

  asset.acquisition = {
    date: d.currentDate,
    price: spec.price,
    fees: model.acquisition.fees,
    taxes: model.acquisition.salesTax,
    financing: liabilityId ? { liabilityId, downPayment, loanAmount } : undefined,
    listing: spec.listing ? structuredClone(spec.listing) : undefined,
    transactionId: txn.id,
  };

  // Recurring ownership costs
  const specs = [...(spec.skipModelRecurring ? [] : model.recurring), ...(spec.extraRecurring ?? [])];
  for (const r of specs) {
    if (r.amount <= 0) continue;
    createRecurring(d, {
      name: `${r.name} — ${spec.name}`,
      direction: 'expense',
      category: r.category,
      amount: { value: r.amount, source: r.source },
      interval: r.interval,
      accountId,
      assetId: asset.id,
      createdBy: spec.createdBy === 'assistant' ? 'assistant' : 'catalog',
    });
  }
  // Rental income for rental properties
  if (spec.details.kind === 'property' && spec.details.property.monthlyRentIncome && spec.details.property.monthlyRentIncome > 0) {
    createRecurring(d, {
      name: `Rent — ${spec.name}`,
      direction: 'income',
      category: 'rental',
      amount: { value: spec.details.property.monthlyRentIncome, source: { type: 'user_entered' } },
      interval: 'monthly',
      accountId,
      assetId: asset.id,
      taxTreatment: 'ordinary_income',
      createdBy: 'catalog',
    });
  }

  // Storage
  if (!opts.skipStorage && PHYSICAL.includes(spec.category)) {
    if (spec.storageLocationId) assignStorage(d, asset.id, spec.storageLocationId);
    else if (spec.storageLocationId === undefined) {
      const loc = findAvailableLocation(d, spec.category);
      if (loc) assignStorage(d, asset.id, loc.id);
    }
  }

  d.timeline.push({ id: nextId(d, 'tl'), date: d.currentDate, kind: 'purchase', title: `Purchased ${spec.name}`, amount: price, transactionId: txn.id, assetId: asset.id, detail: loanAmount > 0 ? `Financed ${loanAmount.toLocaleString()} with ${downPayment.toLocaleString()} down` : 'Paid in cash' });
  return { assetId: asset.id, transactionId: txn.id };
}
