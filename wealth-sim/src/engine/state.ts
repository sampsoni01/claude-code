import type { SimulationState, UserProfile, ISODate, Money, Id, TaxJurisdictionId, PropertyDetails, BusinessDetails, SecurityDetails, Asset } from './types';
import { nextId } from './ids';
import { round2 } from './money';
import { SCENARIOS } from './scenarios';
import { emptyTaxYear, JURISDICTIONS } from './tax';
import { yearOf, addMonths } from './dates';
import { postTransaction } from './ledger';
import { createAssetRecord } from './assets';
import { createLiability } from './loans';
import { createRecurring } from './recurring';
import { ownershipModel } from './costModels';
import { snapshotFor } from './metrics';

export const SCHEMA_VERSION = 1;

export interface StartingProperty {
  name: string;
  value: Money;
  address: string;
  propertyType: string;
  use: PropertyDetails['use'];
  squareFeet?: number;
  bedrooms?: number;
  bathrooms?: number;
  garageCapacity: number;
  storageCapacity?: number;
  mortgageBalance?: Money;
  mortgageRate?: number;
  mortgageMonthsRemaining?: number;
  monthlyRent?: Money;
}

export interface StartingBusiness {
  name: string;
  value: Money;
  industry: string;
  annualRevenue: Money;
  annualOperatingExpenses: Money;
  annualPayroll: Money;
  employees: number;
  ownershipPct: number;
  annualGrowthRate: number;
  distributionRate: number;
}

export interface StartingInvestment {
  name: string;
  value: Money;
  assetClass: SecurityDetails['assetClass'];
  expectedAnnualReturn?: number;
  annualVolatility?: number;
  dividendYield?: number;
}

export interface StartingDebt {
  name: string;
  kind: import('./types').LiabilityKind;
  balance: Money;
  annualRate: number;
  monthsRemaining: number;
  interestOnly?: boolean;
}

export interface SimulationConfig {
  name: string;
  location: string;
  currency?: string;
  taxJurisdiction: TaxJurisdictionId;
  startDate?: ISODate;
  annualSalary: Money;
  additionalIncome?: { name: string; annual: Money; category?: import('./types').IncomeCategory }[];
  startingCash: Money;
  investments?: StartingInvestment[];
  properties?: StartingProperty[];
  businesses?: StartingBusiness[];
  debts?: StartingDebt[];
  lifestyle?: { name: string; monthly: Money; category?: import('./types').ExpenseCategory }[];
  realismEvents?: boolean;
  seed?: number;
}

export function createSimulation(cfg: SimulationConfig): SimulationState {
  const startDate = cfg.startDate ?? '2026-01-01';
  const profile: UserProfile = { name: cfg.name, location: cfg.location, currency: cfg.currency ?? JURISDICTIONS[cfg.taxJurisdiction].currency, taxJurisdiction: cfg.taxJurisdiction };
  const state: SimulationState = {
    schemaVersion: SCHEMA_VERSION,
    id: `sim_${Date.now().toString(36)}`,
    profile,
    startDate,
    currentDate: startDate,
    accounts: {},
    assets: {},
    liabilities: {},
    recurring: {},
    staff: {},
    storage: {},
    projects: {},
    events: {},
    ledger: [],
    valuations: [],
    timeline: [],
    history: [],
    settings: { scenario: { ...SCENARIOS.normal }, realismEventsEnabled: cfg.realismEvents ?? true, realismEventRate: 0.08, defaultAccountId: '', taxSettlementMonth: 4 },
    taxYear: emptyTaxYear(yearOf(startDate)),
    assistantHistory: [],
    proposals: {},
    counters: {},
    rngState: cfg.seed ?? 20260101,
    idempotencyKeys: {},
  };

  // Primary cash account
  const acctId = nextId(state, 'acct');
  state.accounts[acctId] = { id: acctId, name: 'Private banking — operating account', kind: 'private_bank', balance: 0, currency: profile.currency, interestRate: 0.035, createdOn: startDate };
  state.settings.defaultAccountId = acctId;

  const j = JURISDICTIONS[cfg.taxJurisdiction];
  const opening: import('./types').Posting[] = [];
  if (cfg.startingCash > 0) opening.push({ kind: 'cash', accountId: acctId, amount: round2(cfg.startingCash) });

  // Investments
  for (const inv of cfg.investments ?? []) {
    if (inv.value <= 0) continue;
    const defaults = securityDefaults(inv.assetClass);
    const a = createAssetRecord(state, {
      name: inv.name,
      category: inv.assetClass === 'private_equity' || inv.assetClass === 'venture' ? 'private_investment' : 'public_security',
      details: { kind: 'security', security: { assetClass: inv.assetClass, expectedAnnualReturn: inv.expectedAnnualReturn ?? defaults.ret, annualVolatility: inv.annualVolatility ?? defaults.vol, dividendYield: inv.dividendYield ?? defaults.div } },
      value: inv.value,
      valueRule: { annualRate: inv.expectedAnnualReturn ?? defaults.ret, annualVolatility: inv.annualVolatility ?? defaults.vol, source: { type: 'user_entered', label: 'Starting portfolio assumption' } },
      liquidity: inv.assetClass === 'private_equity' || inv.assetClass === 'venture' ? 'illiquid' : 'liquid',
      createdBy: 'user',
    });
    opening.push({ kind: 'asset', assetId: a.id, amount: round2(inv.value) });
  }

  // Properties
  for (const p of cfg.properties ?? []) {
    if (p.value <= 0) continue;
    const details: PropertyDetails = {
      address: p.address, propertyType: p.propertyType, use: p.use, squareFeet: p.squareFeet, bedrooms: p.bedrooms, bathrooms: p.bathrooms,
      garageCapacity: p.garageCapacity, parkingSpaces: p.garageCapacity, storageCapacity: p.storageCapacity ?? 10, monthlyRentIncome: p.monthlyRent, annualPropertyTaxRate: j.defaultPropertyTaxRate,
    };
    const model = ownershipModel('real_estate', p.value, j, { squareFeet: p.squareFeet, isCondo: /condo|apartment|penthouse/i.test(p.propertyType) });
    const a = createAssetRecord(state, {
      name: p.name, category: 'real_estate', details: { kind: 'property', property: details }, value: p.value, valueRule: model.valueRule, liquidity: 'illiquid', assumptions: model.assumptions, createdBy: 'user',
    });
    opening.push({ kind: 'asset', assetId: a.id, amount: round2(p.value) });
    for (const r of model.recurring) createRecurring(state, { name: `${r.name} — ${p.name}`, direction: 'expense', category: r.category, amount: { value: r.amount, source: r.source }, interval: r.interval, accountId: acctId, assetId: a.id, createdBy: 'catalog' });
    if (p.monthlyRent && p.monthlyRent > 0) createRecurring(state, { name: `Rent — ${p.name}`, direction: 'income', category: 'rental', amount: { value: p.monthlyRent, source: { type: 'user_entered' } }, interval: 'monthly', accountId: acctId, assetId: a.id, createdBy: 'user' });
    if (p.mortgageBalance && p.mortgageBalance > 0) {
      const l = createLiability(state, { name: `Mortgage — ${p.name}`, kind: 'mortgage', principal: p.mortgageBalance, annualRate: p.mortgageRate ?? 0.06, termMonths: p.mortgageMonthsRemaining ?? 300, paymentAccountId: acctId, securedByAssetId: a.id, source: { type: 'user_entered' }, firstPaymentDate: addMonths(startDate, 1) });
      a.liabilityIds.push(l.id);
      opening.push({ kind: 'liability', liabilityId: l.id, amount: round2(p.mortgageBalance) });
    }
  }

  // Businesses
  for (const b of cfg.businesses ?? []) {
    if (b.value <= 0) continue;
    const profit = b.annualRevenue - b.annualOperatingExpenses - b.annualPayroll;
    const details: BusinessDetails = { industry: b.industry, annualRevenue: b.annualRevenue, annualOperatingExpenses: b.annualOperatingExpenses, annualPayroll: b.annualPayroll, employees: b.employees, ownershipPct: b.ownershipPct, annualGrowthRate: b.annualGrowthRate, distributionRate: b.distributionRate, valuationMultiple: profit > 0 ? round2(b.value / (profit * b.ownershipPct)) : 8, retainedEarnings: 0 };
    const a = createAssetRecord(state, { name: b.name, category: 'business', details: { kind: 'business', business: details }, value: b.value, valueRule: { annualRate: 0, annualVolatility: 0, source: { type: 'simulation_generated', label: 'Business valued on profit × multiple' } }, liquidity: 'illiquid', createdBy: 'user' });
    opening.push({ kind: 'asset', assetId: a.id, amount: round2(b.value) });
  }

  // Other debts
  for (const dbt of cfg.debts ?? []) {
    if (dbt.balance <= 0) continue;
    const l = createLiability(state, { name: dbt.name, kind: dbt.kind, principal: dbt.balance, annualRate: dbt.annualRate, termMonths: dbt.monthsRemaining, interestOnly: dbt.interestOnly, paymentAccountId: acctId, source: { type: 'user_entered' }, firstPaymentDate: addMonths(startDate, 1) });
    opening.push({ kind: 'liability', liabilityId: l.id, amount: round2(dbt.balance) });
  }

  // Balance the opening entry with an equity posting.
  const openingNet = opening.reduce((s, p) => s + (p.kind === 'liability' ? -p.amount : p.kind === 'cash' || p.kind === 'asset' ? p.amount : 0), 0);
  opening.push({ kind: 'equity', amount: round2(openingNet), reason: 'Opening balances' });
  postTransaction(state, { type: 'opening_balance', category: 'opening', description: 'Opening balances', postings: opening, createdBy: 'user', idempotencyKey: 'opening' });

  // Income streams
  if (cfg.annualSalary > 0) {
    createRecurring(state, { name: 'Salary', direction: 'income', category: 'salary', amount: { value: round2(cfg.annualSalary / 12), source: { type: 'user_entered' } }, interval: 'monthly', accountId: acctId, taxTreatment: 'withheld_at_source', inflationRate: 0, createdBy: 'user' });
  }
  for (const inc of cfg.additionalIncome ?? []) {
    if (inc.annual <= 0) continue;
    createRecurring(state, { name: inc.name, direction: 'income', category: inc.category ?? 'custom', amount: { value: round2(inc.annual / 12), source: { type: 'user_entered' } }, interval: 'monthly', accountId: acctId, inflationRate: 0, createdBy: 'user' });
  }
  for (const l of cfg.lifestyle ?? []) {
    if (l.monthly <= 0) continue;
    createRecurring(state, { name: l.name, direction: 'expense', category: l.category ?? 'custom', amount: { value: l.monthly, source: { type: 'user_entered' } }, interval: 'monthly', accountId: acctId, createdBy: 'user' });
  }

  state.history.push(snapshotFor(state, startDate));
  state.timeline.push({ id: nextId(state, 'tl'), date: startDate, kind: 'milestone', title: 'Simulation started', detail: `${profile.name}, ${profile.location}` });
  return state;
}

export function securityDefaults(cls: SecurityDetails['assetClass']): { ret: number; vol: number; div: number } {
  switch (cls) {
    case 'stock': return { ret: 0.08, vol: 0.22, div: 0.012 };
    case 'etf': return { ret: 0.075, vol: 0.16, div: 0.015 };
    case 'bond': return { ret: 0.045, vol: 0.06, div: 0.04 };
    case 'private_equity': return { ret: 0.13, vol: 0.30, div: 0 };
    case 'venture': return { ret: 0.15, vol: 0.55, div: 0 };
    case 'real_estate_fund': return { ret: 0.07, vol: 0.12, div: 0.035 };
    case 'alternative': return { ret: 0.06, vol: 0.14, div: 0 };
    case 'cash_equivalent': return { ret: 0.04, vol: 0.005, div: 0.04 };
  }
}

export function findAsset(state: SimulationState, id: Id): Asset | undefined { return state.assets[id]; }
