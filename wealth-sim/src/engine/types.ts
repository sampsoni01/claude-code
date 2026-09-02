/**
 * Core data model for the wealth simulation.
 *
 * Everything in the simulation is fictional. Money values are numbers in the
 * simulation's base currency, always rounded to cents by the ledger.
 *
 * Accounting invariant enforced by the ledger on every transaction:
 *   Δcash + Δassets − Δliabilities = income − expenses + valuationChange
 */

export type Id = string;
export type ISODate = string; // YYYY-MM-DD
export type Money = number;

// ---------------------------------------------------------------------------
// Provenance: where did a number come from?
// ---------------------------------------------------------------------------

export type SourceType =
  | 'user_entered'
  | 'builtin_reference'
  | 'retrieved_real_world'
  | 'calculated_estimate'
  | 'market_estimate'
  | 'simulation_generated'
  | 'user_override';

export interface SourceInfo {
  type: SourceType;
  /** Human-readable description of the source (e.g. "Manufacturer MSRP 2026"). */
  label?: string;
  /** URL / reference identifier when the value came from outside the simulation. */
  reference?: string;
  retrievedOn?: ISODate;
  /** Confidence 0..1 for estimates. */
  confidence?: number;
  /** Realistic range when exact pricing is unavailable. */
  range?: { low: Money; high: Money };
  notes?: string;
}

/** A value that carries its own provenance. */
export interface Sourced<T = Money> {
  value: T;
  source: SourceInfo;
  /** Set when the user manually overrode the value. Original preserved. */
  override?: { original: T; overriddenOn: ISODate; note?: string };
}

/** Transparent assumption record attached to AI/engine generated objects. */
export interface Assumption {
  key: string;
  label: string;
  value: string | number;
  kind: 'real_world_data' | 'simulation_assumption' | 'calculated_value' | 'user_override';
  source?: SourceInfo;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export type TaxJurisdictionId =
  | 'US-CA' | 'US-NY' | 'US-FL' | 'US-TX' | 'US-WA' | 'US-OTHER'
  | 'UK' | 'CH' | 'AE' | 'SG' | 'MC' | 'OTHER';

export interface UserProfile {
  name: string;
  location: string;
  currency: string; // ISO 4217 code, display only for now
  taxJurisdiction: TaxJurisdictionId;
}

// ---------------------------------------------------------------------------
// Accounts (cash)
// ---------------------------------------------------------------------------

export type AccountKind = 'checking' | 'savings' | 'brokerage_cash' | 'private_bank' | 'business';

export interface Account {
  id: Id;
  name: string;
  kind: AccountKind;
  balance: Money;
  currency: string;
  /** Annual interest rate paid on balance (e.g. 0.04). */
  interestRate: number;
  createdOn: ISODate;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetCategory =
  | 'real_estate'
  | 'vehicle'
  | 'aircraft'
  | 'yacht'
  | 'art'
  | 'jewelry_watches'
  | 'collectible'
  | 'business'
  | 'public_security'   // stocks, ETFs, bonds (liquid)
  | 'private_investment' // PE, VC, private company stakes
  | 'land'
  | 'furniture'
  | 'luxury_goods'
  | 'custom_physical'
  | 'custom_financial';

export type Liquidity = 'cash' | 'liquid' | 'semi_liquid' | 'illiquid';

export type PropertyUse =
  | 'primary_residence'
  | 'vacation_residence'
  | 'investment_property'
  | 'rental_property'
  | 'commercial_property'
  | 'land';

export interface PropertyDetails {
  address: string;
  propertyType: string; // penthouse, townhouse, estate, condo, ranch...
  use: PropertyUse;
  squareFeet?: number;
  bedrooms?: number;
  bathrooms?: number;
  garageCapacity: number;
  parkingSpaces: number;
  storageCapacity: number; // generic units for art/collectibles
  monthlyRentIncome?: Money; // for rental/commercial
  annualPropertyTaxRate: number; // e.g. 0.011
}

export interface VehicleDetails {
  make: string;
  model: string;
  year: number;
  bodyType?: string; // car, motorcycle, truck
}

export interface AircraftDetails {
  manufacturer: string;
  model: string;
  year: number;
  annualFlightHours: number;
}

export interface YachtDetails {
  builder: string;
  model: string;
  year: number;
  lengthMeters: number;
}

export interface BusinessDetails {
  industry: string;
  annualRevenue: Money;
  annualOperatingExpenses: Money; // excluding payroll
  annualPayroll: Money;
  employees: number;
  ownershipPct: number; // 0..1
  annualGrowthRate: number; // revenue growth
  /** Fraction of the owner's share of profit paid out as distributions. */
  distributionRate: number; // 0..1
  valuationMultiple: number; // EV/EBITDA-ish multiple applied to profit
  /** Retained earnings that have accumulated inside the business (owner's share). */
  retainedEarnings: Money;
}

export interface SecurityDetails {
  ticker?: string;
  assetClass: 'stock' | 'etf' | 'bond' | 'private_equity' | 'venture' | 'real_estate_fund' | 'alternative' | 'cash_equivalent';
  expectedAnnualReturn: number;
  annualVolatility: number;
  dividendYield: number;
  units?: number;
}

export type AssetDetails =
  | { kind: 'property'; property: PropertyDetails }
  | { kind: 'vehicle'; vehicle: VehicleDetails }
  | { kind: 'aircraft'; aircraft: AircraftDetails }
  | { kind: 'yacht'; yacht: YachtDetails }
  | { kind: 'business'; business: BusinessDetails }
  | { kind: 'security'; security: SecurityDetails }
  | { kind: 'generic'; fields: Record<string, string | number> };

export interface ValueRule {
  /** Annual rate; positive appreciates, negative depreciates. */
  annualRate: number;
  /** Annual volatility around the rate (0 for deterministic). */
  annualVolatility: number;
  /** Floor as fraction of purchase price (e.g. vehicles rarely go below 0.1). */
  floorFraction?: number;
  source: SourceInfo;
}

export interface AcquisitionSnapshot {
  date: ISODate;
  price: Sourced<Money>;
  fees: Money;
  taxes: Money;
  financing?: { liabilityId: Id; downPayment: Money; loanAmount: Money };
  /** Frozen copy of any external listing data. Never mutated after acquisition. */
  listing?: ExternalListing;
  transactionId: Id;
}

export interface ExternalListing {
  source: SourceInfo;
  listingPrice: Money;
  location?: string;
  specifications?: Record<string, string | number>;
  fees?: Record<string, Money>;
  listingId?: string;
}

export interface Asset {
  id: Id;
  name: string;
  description?: string;
  category: AssetCategory;
  liquidity: Liquidity;
  details: AssetDetails;
  /** Current carrying value in the simulation. Changed only via ledger postings. */
  currentValue: Money;
  /** Tax cost basis (purchase price + capitalized costs). */
  costBasis: Money;
  purchasePrice: Money;
  purchaseDate: ISODate;
  acquisition?: AcquisitionSnapshot;
  valueRule: ValueRule;
  /** Where the physical asset is kept (storage location id). */
  storageLocationId: Id | null;
  /** Property this asset is attached to (furniture in a house, etc). */
  attachedToAssetId?: Id;
  liabilityIds: Id[];
  recurringIds: Id[];
  status: 'owned' | 'sold' | 'disposed';
  sale?: { date: ISODate; price: Money; fees: Money; taxes: Money; proceeds: Money; gain: Money; transactionId: Id };
  lastValuation?: { date: ISODate; source: SourceInfo; externalEstimate?: Money };
  resaleAllowed: boolean;
  assumptions: Assumption[];
  tags: string[];
  notes?: string;
  createdBy: 'user' | 'assistant' | 'catalog' | 'engine';
  createdOn: ISODate;
}

// ---------------------------------------------------------------------------
// Liabilities
// ---------------------------------------------------------------------------

export type LiabilityKind =
  | 'mortgage'
  | 'auto_loan'
  | 'securities_backed'
  | 'business_loan'
  | 'personal_loan'
  | 'aircraft_loan'
  | 'marine_loan'
  | 'custom';

export interface Liability {
  id: Id;
  name: string;
  kind: LiabilityKind;
  originalPrincipal: Money;
  balance: Money;
  annualRate: number;
  termMonths: number;
  monthsRemaining: number;
  monthlyPayment: Money;
  balloonPayment: Money;
  /** Interest-only loans pay no principal until maturity. */
  interestOnly: boolean;
  nextPaymentDate: ISODate;
  paymentAccountId: Id;
  securedByAssetId?: Id;
  originatedOn: ISODate;
  status: 'active' | 'paid_off' | 'settled';
  totalInterestPaid: Money;
  totalPrincipalPaid: Money;
  source: SourceInfo;
}

// ---------------------------------------------------------------------------
// Recurring items (expenses & income)
// ---------------------------------------------------------------------------

export type RecurrenceInterval = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

export type ExpenseCategory =
  | 'housing' | 'property_tax' | 'insurance' | 'maintenance' | 'utilities' | 'hoa'
  | 'staff' | 'security' | 'vehicle' | 'aircraft' | 'yacht' | 'storage'
  | 'travel' | 'dining' | 'clothing' | 'shopping' | 'entertainment' | 'membership'
  | 'health' | 'education' | 'charity' | 'subscription' | 'professional_services'
  | 'project' | 'event' | 'interest' | 'tax' | 'fees' | 'business' | 'custom';

export type IncomeCategory =
  | 'salary' | 'bonus' | 'business_distribution' | 'dividend' | 'interest'
  | 'rental' | 'royalty' | 'consulting' | 'custom';

export interface RecurringItem {
  id: Id;
  name: string;
  direction: 'expense' | 'income';
  category: ExpenseCategory | IncomeCategory;
  amount: Sourced<Money>;
  interval: RecurrenceInterval;
  nextDate: ISODate;
  endDate?: ISODate;
  accountId: Id;
  /** Attached asset (e.g. insurance for a specific car). */
  assetId?: Id;
  /** Attached storage location (rent for a garage). */
  storageLocationId?: Id;
  staffId?: Id;
  projectId?: Id;
  /** Annual inflation applied every January (e.g. 0.03). */
  inflationRate: number;
  /** For income: whether taxed as ordinary income. For expenses: deductible flag. */
  taxTreatment: 'ordinary_income' | 'tax_free' | 'deductible' | 'non_deductible' | 'withheld_at_source';
  status: 'active' | 'ended';
  assumptions: Assumption[];
  createdBy: 'user' | 'assistant' | 'catalog' | 'engine';
  createdOn: ISODate;
  notes?: string;
}

export interface StaffMember {
  id: Id;
  role: string;
  name?: string;
  baseSalary: Sourced<Money>;
  /** Employer overhead (payroll taxes, benefits) as fraction of salary. */
  overheadRate: number;
  recurringId: Id;
  assignedAssetId?: Id;
  startDate: ISODate;
  endDate?: ISODate;
  status: 'active' | 'terminated';
  assumptions: Assumption[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type StorageKind =
  | 'property_garage' | 'rented_garage' | 'commercial_vehicle_storage' | 'hangar'
  | 'marina' | 'warehouse' | 'property_storage' | 'custom';

export interface StorageLocation {
  id: Id;
  name: string;
  kind: StorageKind;
  capacity: number;
  /** Asset categories this location can hold. */
  accepts: AssetCategory[];
  propertyId?: Id;
  /** Rented locations have a recurring rent expense. */
  recurringId?: Id;
  status: 'active' | 'closed';
  createdOn: ISODate;
}

// ---------------------------------------------------------------------------
// Projects & events
// ---------------------------------------------------------------------------

export type ProjectStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface Project {
  id: Id;
  name: string;
  description?: string;
  attachedAssetId?: Id;
  estimatedCost: Sourced<Money>;
  costRange?: { low: Money; high: Money };
  contingencyRate: number;
  startDate: ISODate;
  durationMonths: number;
  /** Fraction of spend capitalized into the attached asset's value. Rest is expensed. */
  capitalizationRate: number;
  /** Payment schedule generated at creation. */
  payments: { date: ISODate; amount: Money; paid: boolean; transactionId?: Id }[];
  actualCost: Money;
  overrunRate: number; // applied to remaining payments when realism triggers overrun
  status: ProjectStatus;
  accountId: Id;
  assumptions: Assumption[];
  createdBy: 'user' | 'assistant' | 'engine';
  createdOn: ISODate;
}

export interface EventLineItem {
  label: string;
  amount: Money;
  source: SourceInfo;
}

export interface PlannedEvent {
  id: Id;
  name: string;
  kind: string; // wedding, gala, dinner...
  date: ISODate;
  location: string;
  guestCount: number;
  lineItems: EventLineItem[];
  totalCost: Money;
  status: 'planned' | 'held' | 'cancelled';
  accountId: Id;
  transactionId?: Id;
  assumptions: Assumption[];
  createdOn: ISODate;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type Posting =
  | { kind: 'cash'; accountId: Id; amount: Money }
  | { kind: 'asset'; assetId: Id; amount: Money }
  | { kind: 'liability'; liabilityId: Id; amount: Money }
  | { kind: 'income'; category: IncomeCategory; amount: Money }
  | { kind: 'expense'; category: ExpenseCategory; amount: Money }
  /** Unrealized valuation change (not income). */
  | { kind: 'valuation'; assetId: Id; amount: Money }
  /** Realized gain (+) / loss (−) on disposal relative to carrying value. */
  | { kind: 'realized_gain'; assetId: Id; amount: Money }
  /** Opening balances / user equity edits. */
  | { kind: 'equity'; amount: Money; reason: string };

export type TransactionType =
  | 'opening_balance' | 'salary' | 'income' | 'purchase' | 'sale' | 'loan_payment'
  | 'loan_origination' | 'loan_payoff' | 'recurring_expense' | 'one_time_expense'
  | 'property_tax' | 'insurance' | 'maintenance' | 'staff_payroll' | 'investment_return'
  | 'dividend' | 'interest' | 'valuation' | 'tax_settlement' | 'sales_tax'
  | 'business_result' | 'business_distribution' | 'project_payment' | 'event'
  | 'realism_event' | 'user_adjustment' | 'transfer' | 'charity' | 'reversal';

export interface TaxRelevance {
  ordinaryIncome?: Money;
  capitalGain?: Money; // may be negative
  longTerm?: boolean;
  dividend?: Money;
  interestIncome?: Money;
  deductible?: Money;
  businessIncome?: Money;
  taxPaid?: Money;
}

export interface Transaction {
  id: Id;
  date: ISODate;
  /** Monotonic sequence for stable ordering within a day. */
  seq: number;
  type: TransactionType;
  category: string;
  description: string;
  /** Net cash effect (sum of cash postings), for quick display. */
  cashEffect: Money;
  postings: Posting[];
  assetId?: Id;
  liabilityId?: Id;
  recurringId?: Id;
  projectId?: Id;
  eventId?: Id;
  recurring: boolean;
  tax?: TaxRelevance;
  notes?: string;
  /** Idempotency key. The ledger rejects a second transaction with the same key. */
  idempotencyKey?: string;
  reversedBy?: Id;
  reverses?: Id;
  createdBy: 'user' | 'assistant' | 'engine';
}

// ---------------------------------------------------------------------------
// Valuation, timeline, history
// ---------------------------------------------------------------------------

export interface ValuationRecord {
  id: Id;
  assetId: Id;
  date: ISODate;
  previousValue: Money;
  newValue: Money;
  source: SourceInfo;
  transactionId: Id;
}

export interface TimelineEntry {
  id: Id;
  date: ISODate;
  kind: 'purchase' | 'sale' | 'project' | 'event' | 'business' | 'market' | 'realism' | 'milestone' | 'staff' | 'financing' | 'custom';
  title: string;
  detail?: string;
  amount?: Money;
  transactionId?: Id;
  assetId?: Id;
}

export interface Snapshot {
  date: ISODate;
  netWorth: Money;
  liquidNetWorth: Money;
  cash: Money;
  liquidAssets: Money;
  totalAssets: Money;
  totalLiabilities: Money;
  monthIncome: Money;
  monthExpenses: Money;
}

// ---------------------------------------------------------------------------
// Settings & scenarios
// ---------------------------------------------------------------------------

export type MarketScenarioId =
  | 'normal' | 'bull' | 'recession' | 'high_inflation' | 'real_estate_downturn'
  | 'market_crash' | 'high_rates' | 'custom';

export interface MarketScenario {
  id: MarketScenarioId;
  name: string;
  /** Additive annual drift adjustment per asset class. */
  equityDrift: number;
  bondDrift: number;
  realEstateDrift: number;
  privateDrift: number;
  /** Multiplier on volatility. */
  volatilityMultiplier: number;
  /** Annual inflation applied to recurring expenses. */
  inflation: number;
  /** Additive adjustment to new loan rates and variable rates. */
  rateShift: number;
  /** Multiplier on business growth. */
  businessGrowthMultiplier: number;
}

export interface SimSettings {
  scenario: MarketScenario;
  realismEventsEnabled: boolean;
  /** Probability per month of a realism event. */
  realismEventRate: number;
  /** Default account used for purchases and recurring items. */
  defaultAccountId: Id;
  /** Explicit tax settlement month (1-12). */
  taxSettlementMonth: number;
}

export interface TaxYearAccumulator {
  year: number;
  ordinaryIncome: Money;
  withheld: Money;
  capitalGainsLong: Money;
  capitalGainsShort: Money;
  dividends: Money;
  interestIncome: Money;
  businessIncome: Money;
  deductions: Money;
  propertyTaxPaid: Money;
  salesTaxPaid: Money;
}

// ---------------------------------------------------------------------------
// Assistant history
// ---------------------------------------------------------------------------

export interface AssistantMessage {
  id: Id;
  date: ISODate;
  role: 'user' | 'assistant';
  assistantId?: string;
  text: string;
  proposalId?: Id;
}

// ---------------------------------------------------------------------------
// Root state
// ---------------------------------------------------------------------------

export interface SimulationState {
  schemaVersion: number;
  id: Id;
  profile: UserProfile;
  startDate: ISODate;
  currentDate: ISODate;
  accounts: Record<Id, Account>;
  assets: Record<Id, Asset>;
  liabilities: Record<Id, Liability>;
  recurring: Record<Id, RecurringItem>;
  staff: Record<Id, StaffMember>;
  storage: Record<Id, StorageLocation>;
  projects: Record<Id, Project>;
  events: Record<Id, PlannedEvent>;
  ledger: Transaction[];
  valuations: ValuationRecord[];
  timeline: TimelineEntry[];
  history: Snapshot[];
  settings: SimSettings;
  taxYear: TaxYearAccumulator;
  assistantHistory: AssistantMessage[];
  /** Committed proposals (for audit). */
  proposals: Record<Id, unknown>;
  /** Monotonic counters for stable ids. */
  counters: Record<string, number>;
  rngState: number;
  /** Idempotency keys already consumed by the ledger. */
  idempotencyKeys: Record<string, Id>;
}
