import type { AssetCategory, Money, SourceInfo, Assumption, ValueRule, RecurrenceInterval, ExpenseCategory, Liquidity } from './types';
import { round2, roundEstimate } from './money';
import type { TaxJurisdiction } from './tax';

/**
 * Category-specific cost models. Each returns the one-time acquisition costs
 * and the recurring ownership costs implied by the purchase price. Every
 * number is a simulation assumption and is labelled as such so the user can
 * inspect and override it.
 */

export interface RecurringSpec {
  name: string;
  category: ExpenseCategory;
  amount: Money;
  interval: RecurrenceInterval;
  source: SourceInfo;
}

export interface AcquisitionCosts {
  salesTax: Money;
  fees: Money; // registration, closing, delivery, legal, broker
  feeBreakdown: { label: string; amount: Money; source: SourceInfo }[];
}

export interface OwnershipModel {
  acquisition: AcquisitionCosts;
  recurring: RecurringSpec[];
  valueRule: ValueRule;
  liquidity: Liquidity;
  assumptions: Assumption[];
  /** Whether purchase price is treated as fully capitalized (asset) — true for everything except consumables. */
  capitalize: boolean;
}

const SA = (label: string, notes?: string): SourceInfo => ({ type: 'calculated_estimate', label, notes });

export interface CostModelOptions {
  /** Real estate: square feet, use, HOA hint; vehicles: exotic flag etc. */
  squareFeet?: number;
  isCondo?: boolean;
  isRental?: boolean;
  monthlyRent?: Money;
  annualFlightHours?: number;
  lengthMeters?: number;
  hasStaff?: boolean;
  /** Custom overrides (already-sourced) for individual lines. */
  overrides?: Partial<Record<string, Money>>;
  /** Annual value rule override */
  annualRate?: number;
}

export function ownershipModel(category: AssetCategory, price: Money, j: TaxJurisdiction, opts: CostModelOptions = {}): OwnershipModel {
  const a: Assumption[] = [];
  const rec: RecurringSpec[] = [];
  const fees: AcquisitionCosts['feeBreakdown'] = [];
  let salesTax = 0;
  let valueRule: ValueRule;
  let liquidity: Liquidity = 'illiquid';

  const push = (name: string, category: ExpenseCategory, annual: Money, label: string, interval: RecurrenceInterval = 'monthly') => {
    const ov = opts.overrides?.[name];
    const annualFinal = ov != null ? ov : roundEstimate(annual, 3);
    const perInterval = interval === 'monthly' ? annualFinal / 12 : interval === 'quarterly' ? annualFinal / 4 : interval === 'annual' ? annualFinal : annualFinal / 52;
    rec.push({ name, category, amount: round2(perInterval), interval, source: ov != null ? { type: 'user_override' } : SA(label) });
    a.push({ key: name, label: `${name} (annual)`, value: annualFinal, kind: ov != null ? 'user_override' : 'simulation_assumption', source: SA(label) });
  };

  switch (category) {
    case 'real_estate':
    case 'land': {
      const transfer = round2(price * j.realEstateTransferTaxRate);
      fees.push({ label: 'Transfer / stamp tax', amount: transfer, source: SA(`${(j.realEstateTransferTaxRate * 100).toFixed(2)}% of price (${j.name})`) });
      const closing = round2(price * 0.015);
      fees.push({ label: 'Closing costs (title, legal, escrow)', amount: closing, source: SA('1.5% of price') });
      push('Property tax', 'property_tax', price * j.defaultPropertyTaxRate, `${(j.defaultPropertyTaxRate * 100).toFixed(2)}% of value per year (${j.name})`, 'quarterly');
      if (category === 'real_estate') {
        push('Homeowners insurance', 'insurance', price * 0.0035, '0.35% of value per year');
        const maintRate = price > 20_000_000 ? 0.012 : 0.01;
        push('Maintenance & repairs', 'maintenance', price * maintRate, `${(maintRate * 100).toFixed(1)}% of value per year`);
        const sqft = opts.squareFeet ?? Math.max(1500, Math.min(25_000, price / 1500));
        push('Utilities', 'utilities', sqft * 4.5, '$4.50 per sq ft per year');
        if (opts.isCondo) push('HOA / building charges', 'hoa', Math.max(24_000, price * 0.006), '0.6% of value per year (min $24k)');
        else push('Landscaping & grounds', 'maintenance', Math.max(12_000, sqft * 1.5), '$1.50 per sq ft per year (min $12k)');
        if (price > 15_000_000 && opts.hasStaff !== false) push('Property management', 'professional_services', price * 0.002, '0.2% of value per year for estates over $15M');
      }
      valueRule = { annualRate: opts.annualRate ?? 0.035, annualVolatility: 0.05, source: SA('Long-run residential appreciation ~3.5%/yr with 5% volatility') };
      liquidity = 'illiquid';
      break;
    }
    case 'vehicle': {
      salesTax = round2(price * j.vehicleSalesTaxRate);
      fees.push({ label: 'Registration, title & delivery', amount: round2(Math.min(15_000, 500 + price * 0.005)), source: SA('$500 + 0.5% of price, capped at $15k') });
      const insRate = price > 250_000 ? 0.03 : price > 80_000 ? 0.025 : 0.02;
      push('Auto insurance', 'insurance', Math.max(2_400, price * insRate), `${(insRate * 100).toFixed(1)}% of value per year`);
      push('Maintenance & service', 'maintenance', Math.max(1_200, price * 0.015), '1.5% of value per year');
      push('Fuel / charging', 'vehicle', 3_500, 'Assumes ~6,000 miles per year');
      const dep = price > 1_000_000 ? 0.02 : price > 300_000 ? -0.08 : price > 80_000 ? -0.12 : -0.15;
      valueRule = { annualRate: opts.annualRate ?? dep, annualVolatility: 0.04, floorFraction: 0.1, source: SA(dep > 0 ? 'Collector-tier cars (> $1M) assumed to appreciate slowly' : `Depreciation ${(Math.abs(dep) * 100).toFixed(0)}%/yr, steepest in early years`) };
      liquidity = 'semi_liquid';
      break;
    }
    case 'aircraft': {
      salesTax = round2(price * Math.min(j.salesTaxRate, 0.0825));
      fees.push({ label: 'Pre-buy inspection, legal, registration', amount: round2(Math.max(50_000, price * 0.01)), source: SA('1% of price (min $50k)') });
      const hours = opts.annualFlightHours ?? 300;
      const crew = price > 40_000_000 ? 1_100_000 : price > 15_000_000 ? 750_000 : 400_000;
      push('Flight crew salaries', 'staff', crew, 'Two pilots + cabin attendant, loaded');
      push('Hangar', 'storage', price > 40_000_000 ? 300_000 : 150_000, 'Annual hangar lease');
      push('Aircraft insurance', 'insurance', price * 0.006, '0.6% of hull value per year');
      push('Maintenance reserves', 'aircraft', hours * (price > 40_000_000 ? 2_800 : price > 15_000_000 ? 1_800 : 900), `${hours} hrs/yr × per-hour reserve`);
      push('Fuel', 'aircraft', hours * (price > 40_000_000 ? 3_500 : price > 15_000_000 ? 2_200 : 1_100), `${hours} hrs/yr × fuel burn`);
      push('Management, landing & handling fees', 'aircraft', Math.max(150_000, price * 0.004), '0.4% of value per year');
      valueRule = { annualRate: opts.annualRate ?? -0.07, annualVolatility: 0.05, floorFraction: 0.15, source: SA('Business jet depreciation ~7%/yr') };
      break;
    }
    case 'yacht': {
      salesTax = round2(price * Math.min(j.salesTaxRate, 0.06));
      fees.push({ label: 'Survey, legal, registration', amount: round2(Math.max(40_000, price * 0.01)), source: SA('1% of price (min $40k)') });
      const len = opts.lengthMeters ?? Math.max(20, Math.min(120, Math.pow(price / 1_500_000, 0.5) * 12));
      push('Crew', 'staff', len * 12_000, `~$12k per metre per year loaded crew cost (${len.toFixed(0)}m)`);
      push('Dockage / berth', 'storage', len * 3_500, '$3.5k per metre per year');
      push('Yacht insurance', 'insurance', price * 0.012, '1.2% of value per year');
      push('Maintenance & refit reserve', 'yacht', price * 0.04, '4% of value per year');
      push('Fuel', 'yacht', len * 4_000, 'Seasonal cruising assumption');
      push('Management & provisioning', 'yacht', price * 0.012, '1.2% of value per year');
      valueRule = { annualRate: opts.annualRate ?? -0.06, annualVolatility: 0.05, floorFraction: 0.15, source: SA('Yacht depreciation ~6%/yr') };
      break;
    }
    case 'art':
    case 'collectible': {
      fees.push({ label: "Buyer's premium / dealer commission", amount: round2(price * 0.15), source: SA("15% buyer's premium (auction average)") });
      salesTax = round2(price * j.salesTaxRate);
      push('Fine art insurance', 'insurance', price * 0.003, '0.3% of value per year');
      push('Conservation & handling', 'maintenance', Math.max(500, price * 0.001), '0.1% of value per year');
      valueRule = { annualRate: opts.annualRate ?? 0.04, annualVolatility: 0.12, source: SA('Art index ~4%/yr with high dispersion') };
      break;
    }
    case 'jewelry_watches':
    case 'luxury_goods':
    case 'furniture': {
      salesTax = round2(price * j.salesTaxRate);
      push('Insurance rider', 'insurance', price * 0.01, '1% of value per year');
      valueRule = { annualRate: opts.annualRate ?? (category === 'jewelry_watches' ? -0.02 : -0.15), annualVolatility: 0.05, floorFraction: 0.1, source: SA(category === 'jewelry_watches' ? 'Retail jewelry/watches lose value after purchase' : 'Furniture/luxury goods depreciate quickly') };
      break;
    }
    case 'business': {
      fees.push({ label: 'Transaction, legal & diligence fees', amount: round2(Math.max(50_000, price * 0.03)), source: SA('3% of price (min $50k)') });
      valueRule = { annualRate: 0, annualVolatility: 0, source: SA('Business value driven by profit × multiple, revalued annually') };
      break;
    }
    case 'public_security': {
      fees.push({ label: 'Brokerage commission', amount: round2(Math.min(500, price * 0.0005)), source: SA('0.05% capped at $500') });
      valueRule = { annualRate: 0.07, annualVolatility: 0.16, source: SA('Equity-like return assumption; overridden by holding-specific settings') };
      liquidity = 'liquid';
      break;
    }
    case 'private_investment': {
      fees.push({ label: 'Legal & subscription fees', amount: round2(Math.max(10_000, price * 0.01)), source: SA('1% of commitment (min $10k)') });
      valueRule = { annualRate: 0.12, annualVolatility: 0.35, floorFraction: 0, source: SA('Private/venture: higher return, much higher dispersion') };
      break;
    }
    case 'custom_physical': {
      salesTax = round2(price * j.salesTaxRate);
      push('Insurance', 'insurance', price * 0.01, '1% of value per year');
      push('Upkeep', 'maintenance', price * 0.02, '2% of value per year');
      valueRule = { annualRate: opts.annualRate ?? -0.05, annualVolatility: 0.05, floorFraction: 0.1, source: SA('Generic physical asset depreciation 5%/yr') };
      break;
    }
    case 'custom_financial': {
      valueRule = { annualRate: opts.annualRate ?? 0.05, annualVolatility: 0.1, source: SA('Generic financial asset 5%/yr') };
      liquidity = 'semi_liquid';
      break;
    }
  }

  if (opts.isRental && opts.monthlyRent) {
    // rental income is represented as an income recurring; expressed here as assumption only
    a.push({ key: 'rent', label: 'Monthly rent', value: opts.monthlyRent, kind: 'user_override' });
  }

  const feesTotal = round2(fees.reduce((s, f) => s + f.amount, 0));
  if (salesTax > 0) a.push({ key: 'sales_tax', label: 'Sales / transfer tax', value: salesTax, kind: 'calculated_value', source: SA(`${j.name} rate`) });
  for (const f of fees) a.push({ key: f.label, label: f.label, value: f.amount, kind: 'calculated_value', source: f.source });
  a.push({ key: 'value_rule', label: 'Annual value change assumption', value: `${(valueRule.annualRate * 100).toFixed(1)}% ± ${(valueRule.annualVolatility * 100).toFixed(0)}%`, kind: 'simulation_assumption', source: valueRule.source });

  return { acquisition: { salesTax, fees: feesTotal, feeBreakdown: fees }, recurring: rec, valueRule, liquidity, assumptions: a, capitalize: true };
}

/** Selling costs by category. */
export function sellingCosts(category: AssetCategory, price: Money, _j: TaxJurisdiction): { fees: Money; breakdown: { label: string; amount: Money; source: SourceInfo }[] } {
  const b: { label: string; amount: Money; source: SourceInfo }[] = [];
  switch (category) {
    case 'real_estate': case 'land':
      b.push({ label: 'Broker commission', amount: round2(price * 0.05), source: SA('5% of sale price') });
      b.push({ label: 'Legal & closing', amount: round2(price * 0.005), source: SA('0.5% of sale price') });
      break;
    case 'vehicle':
      b.push({ label: 'Dealer / broker fee', amount: round2(price * 0.05), source: SA('5% consignment') });
      break;
    case 'aircraft': case 'yacht':
      b.push({ label: 'Broker commission', amount: round2(price * 0.05), source: SA('5% of sale price') });
      b.push({ label: 'Survey & legal', amount: round2(Math.max(20_000, price * 0.005)), source: SA('0.5% (min $20k)') });
      break;
    case 'art': case 'collectible': case 'jewelry_watches':
      b.push({ label: "Seller's commission", amount: round2(price * 0.10), source: SA("10% seller's commission") });
      break;
    case 'business':
      b.push({ label: 'M&A advisory & legal', amount: round2(Math.max(50_000, price * 0.03)), source: SA('3% of sale price') });
      break;
    case 'public_security':
      b.push({ label: 'Brokerage commission', amount: round2(Math.min(500, price * 0.0005)), source: SA('0.05% capped') });
      break;
    default:
      b.push({ label: 'Transaction costs', amount: round2(price * 0.05), source: SA('5% generic') });
  }
  return { fees: round2(b.reduce((s, x) => s + x.amount, 0)), breakdown: b };
}
