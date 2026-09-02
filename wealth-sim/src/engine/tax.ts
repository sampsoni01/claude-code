import type { TaxJurisdictionId, Money, TaxYearAccumulator } from './types';
import { round2 } from './money';

/**
 * SIMPLIFIED, SIMULATED tax estimates. These are not legal or accounting
 * advice and deliberately ignore most real-world detail (AMT, phase-outs,
 * NIIT thresholds, deductions, credits...). They exist so that outcomes in the
 * simulation are not tax-free fantasies.
 */

export interface Bracket { upTo: number; rate: number }

export interface TaxJurisdiction {
  id: TaxJurisdictionId;
  name: string;
  currency: string;
  ordinaryBrackets: Bracket[]; // combined federal + state/regional simplified
  longTermCapitalGainsRate: number;
  shortTermCapitalGainsAsOrdinary: boolean;
  dividendRate: number;
  salesTaxRate: number; // general goods
  vehicleSalesTaxRate: number;
  realEstateTransferTaxRate: number; // paid by buyer (simplified)
  defaultPropertyTaxRate: number; // annual, as fraction of value
  luxuryVehicleSurchargeRate?: number;
  notes: string;
}

const US_FED: Bracket[] = [
  { upTo: 23_850, rate: 0.10 },
  { upTo: 96_950, rate: 0.12 },
  { upTo: 206_700, rate: 0.22 },
  { upTo: 394_600, rate: 0.24 },
  { upTo: 501_050, rate: 0.32 },
  { upTo: 751_600, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];

function withState(stateTop: number, stateBrackets?: Bracket[]): Bracket[] {
  // Simplified: add state's marginal rate to each federal bracket. If state brackets are given, use a blended approach.
  if (!stateBrackets) return US_FED.map((b) => ({ upTo: b.upTo, rate: b.rate + stateTop }));
  // merge breakpoints
  const points = Array.from(new Set([...US_FED.map((b) => b.upTo), ...stateBrackets.map((b) => b.upTo)])).sort((a, b) => a - b);
  return points.map((p) => {
    const f = US_FED.find((b) => p <= b.upTo)!.rate;
    const s = stateBrackets.find((b) => p <= b.upTo)!.rate;
    return { upTo: p, rate: f + s };
  });
}

export const JURISDICTIONS: Record<TaxJurisdictionId, TaxJurisdiction> = {
  'US-CA': {
    id: 'US-CA', name: 'United States — California', currency: 'USD',
    ordinaryBrackets: withState(0, [
      { upTo: 10_756, rate: 0.01 }, { upTo: 25_499, rate: 0.02 }, { upTo: 40_245, rate: 0.04 }, { upTo: 55_866, rate: 0.06 },
      { upTo: 70_606, rate: 0.08 }, { upTo: 360_659, rate: 0.093 }, { upTo: 432_787, rate: 0.103 }, { upTo: 721_314, rate: 0.113 },
      { upTo: 1_000_000, rate: 0.123 }, { upTo: Infinity, rate: 0.133 },
    ]),
    longTermCapitalGainsRate: 0.20 + 0.038 + 0.133, shortTermCapitalGainsAsOrdinary: true, dividendRate: 0.20 + 0.038 + 0.133,
    salesTaxRate: 0.0925, vehicleSalesTaxRate: 0.0925, realEstateTransferTaxRate: 0.0055, defaultPropertyTaxRate: 0.0115,
    notes: 'Simplified federal + CA. CA taxes capital gains as ordinary income; top combined rate used here.',
  },
  'US-NY': {
    id: 'US-NY', name: 'United States — New York (NYC)', currency: 'USD',
    ordinaryBrackets: withState(0, [
      { upTo: 17_150, rate: 0.04 + 0.03078 }, { upTo: 80_650, rate: 0.055 + 0.0376 }, { upTo: 215_400, rate: 0.06 + 0.0376 },
      { upTo: 1_077_550, rate: 0.0685 + 0.03876 }, { upTo: 5_000_000, rate: 0.0965 + 0.03876 }, { upTo: 25_000_000, rate: 0.103 + 0.03876 },
      { upTo: Infinity, rate: 0.109 + 0.03876 },
    ]),
    longTermCapitalGainsRate: 0.20 + 0.038 + 0.109 + 0.03876, shortTermCapitalGainsAsOrdinary: true, dividendRate: 0.20 + 0.038 + 0.109 + 0.03876,
    salesTaxRate: 0.08875, vehicleSalesTaxRate: 0.08875, realEstateTransferTaxRate: 0.0425, defaultPropertyTaxRate: 0.009,
    notes: 'Simplified federal + NY State + NYC. Mansion tax approximated inside transfer tax rate for high-value property.',
  },
  'US-FL': {
    id: 'US-FL', name: 'United States — Florida', currency: 'USD',
    ordinaryBrackets: withState(0),
    longTermCapitalGainsRate: 0.238, shortTermCapitalGainsAsOrdinary: true, dividendRate: 0.238,
    salesTaxRate: 0.07, vehicleSalesTaxRate: 0.07, realEstateTransferTaxRate: 0.007, defaultPropertyTaxRate: 0.0105,
    notes: 'No state income tax. Federal rates plus 3.8% NIIT on investment income.',
  },
  'US-TX': {
    id: 'US-TX', name: 'United States — Texas', currency: 'USD',
    ordinaryBrackets: withState(0),
    longTermCapitalGainsRate: 0.238, shortTermCapitalGainsAsOrdinary: true, dividendRate: 0.238,
    salesTaxRate: 0.0825, vehicleSalesTaxRate: 0.0625, realEstateTransferTaxRate: 0.0, defaultPropertyTaxRate: 0.018,
    notes: 'No state income tax; higher property taxes.',
  },
  'US-WA': {
    id: 'US-WA', name: 'United States — Washington', currency: 'USD',
    ordinaryBrackets: withState(0),
    longTermCapitalGainsRate: 0.238 + 0.07, shortTermCapitalGainsAsOrdinary: true, dividendRate: 0.238,
    salesTaxRate: 0.1025, vehicleSalesTaxRate: 0.1025, realEstateTransferTaxRate: 0.03, defaultPropertyTaxRate: 0.0095,
    notes: 'No state income tax; 7% state capital gains excise on large gains.',
  },
  'US-OTHER': {
    id: 'US-OTHER', name: 'United States — other state (5% flat state tax)', currency: 'USD',
    ordinaryBrackets: withState(0.05),
    longTermCapitalGainsRate: 0.238 + 0.05, shortTermCapitalGainsAsOrdinary: true, dividendRate: 0.238 + 0.05,
    salesTaxRate: 0.07, vehicleSalesTaxRate: 0.07, realEstateTransferTaxRate: 0.01, defaultPropertyTaxRate: 0.012,
    notes: 'Generic US state assumption.',
  },
  UK: {
    id: 'UK', name: 'United Kingdom', currency: 'GBP',
    ordinaryBrackets: [{ upTo: 12_570, rate: 0 }, { upTo: 50_270, rate: 0.20 }, { upTo: 125_140, rate: 0.40 }, { upTo: Infinity, rate: 0.45 }],
    longTermCapitalGainsRate: 0.24, shortTermCapitalGainsAsOrdinary: false, dividendRate: 0.3935,
    salesTaxRate: 0.20, vehicleSalesTaxRate: 0.20, realEstateTransferTaxRate: 0.12, defaultPropertyTaxRate: 0.002,
    notes: 'Simplified income tax bands; VAT 20%; SDLT approximated at top-band 12% for high-value property; council tax approximated as small property tax.',
  },
  CH: {
    id: 'CH', name: 'Switzerland (Zurich, simplified)', currency: 'CHF',
    ordinaryBrackets: [{ upTo: 30_000, rate: 0.05 }, { upTo: 100_000, rate: 0.18 }, { upTo: 250_000, rate: 0.30 }, { upTo: Infinity, rate: 0.40 }],
    longTermCapitalGainsRate: 0.0, shortTermCapitalGainsAsOrdinary: false, dividendRate: 0.35,
    salesTaxRate: 0.081, vehicleSalesTaxRate: 0.081, realEstateTransferTaxRate: 0.01, defaultPropertyTaxRate: 0.003,
    notes: 'Private capital gains on securities generally untaxed; wealth tax not modeled.',
  },
  AE: {
    id: 'AE', name: 'United Arab Emirates (Dubai)', currency: 'AED',
    ordinaryBrackets: [{ upTo: Infinity, rate: 0 }],
    longTermCapitalGainsRate: 0, shortTermCapitalGainsAsOrdinary: false, dividendRate: 0,
    salesTaxRate: 0.05, vehicleSalesTaxRate: 0.05, realEstateTransferTaxRate: 0.04, defaultPropertyTaxRate: 0.0,
    notes: 'No personal income tax; 5% VAT; 4% DLD transfer fee.',
  },
  SG: {
    id: 'SG', name: 'Singapore', currency: 'SGD',
    ordinaryBrackets: [{ upTo: 20_000, rate: 0 }, { upTo: 80_000, rate: 0.07 }, { upTo: 320_000, rate: 0.18 }, { upTo: 1_000_000, rate: 0.23 }, { upTo: Infinity, rate: 0.24 }],
    longTermCapitalGainsRate: 0, shortTermCapitalGainsAsOrdinary: false, dividendRate: 0,
    salesTaxRate: 0.09, vehicleSalesTaxRate: 1.0, realEstateTransferTaxRate: 0.06, defaultPropertyTaxRate: 0.01,
    notes: 'Vehicle taxes (ARF/COE) approximated as 100% surcharge; ABSD not modeled.',
  },
  MC: {
    id: 'MC', name: 'Monaco', currency: 'EUR',
    ordinaryBrackets: [{ upTo: Infinity, rate: 0 }],
    longTermCapitalGainsRate: 0, shortTermCapitalGainsAsOrdinary: false, dividendRate: 0,
    salesTaxRate: 0.20, vehicleSalesTaxRate: 0.20, realEstateTransferTaxRate: 0.045, defaultPropertyTaxRate: 0,
    notes: 'No personal income tax for residents (non-French).',
  },
  OTHER: {
    id: 'OTHER', name: 'Other (generic 35% flat)', currency: 'USD',
    ordinaryBrackets: [{ upTo: 50_000, rate: 0.15 }, { upTo: Infinity, rate: 0.35 }],
    longTermCapitalGainsRate: 0.20, shortTermCapitalGainsAsOrdinary: true, dividendRate: 0.20,
    salesTaxRate: 0.10, vehicleSalesTaxRate: 0.10, realEstateTransferTaxRate: 0.02, defaultPropertyTaxRate: 0.01,
    notes: 'Generic placeholder jurisdiction.',
  },
};

export function bracketTax(income: Money, brackets: Bracket[]): Money {
  if (income <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    const slice = Math.min(income, b.upTo) - prev;
    if (slice <= 0) break;
    tax += slice * b.rate;
    prev = b.upTo;
    if (income <= b.upTo) break;
  }
  return round2(tax);
}

/** Effective withholding rate on a recurring salary, computed on its annualized amount. */
export function salaryWithholdingRate(annualSalary: Money, j: TaxJurisdiction): number {
  if (annualSalary <= 0) return 0;
  return bracketTax(annualSalary, j.ordinaryBrackets) / annualSalary;
}

export interface TaxSettlement {
  ordinaryTax: Money;
  capitalGainsTax: Money;
  dividendTax: Money;
  interestTax: Money;
  businessTax: Money;
  totalLiability: Money;
  withheld: Money;
  balanceDue: Money; // positive → payment due; negative → refund
  breakdown: { label: string; base: Money; tax: Money }[];
}

export function computeAnnualSettlement(acc: TaxYearAccumulator, j: TaxJurisdiction): TaxSettlement {
  const ordinaryBase = Math.max(0, acc.ordinaryIncome + acc.businessIncome + acc.interestIncome + (j.shortTermCapitalGainsAsOrdinary ? Math.max(0, acc.capitalGainsShort) : 0) - acc.deductions);
  const ordinaryTaxAll = bracketTax(ordinaryBase, j.ordinaryBrackets);
  // attribute ordinary tax proportionally for the breakdown
  const parts = {
    salary: Math.max(0, acc.ordinaryIncome),
    business: Math.max(0, acc.businessIncome),
    interest: Math.max(0, acc.interestIncome),
    stcg: j.shortTermCapitalGainsAsOrdinary ? Math.max(0, acc.capitalGainsShort) : 0,
  };
  const partsTotal = parts.salary + parts.business + parts.interest + parts.stcg || 1;
  const share = (x: number) => round2((ordinaryTaxAll * x) / partsTotal);

  // Net long-term gains against short-term losses (simplified loss netting; unused losses are not carried forward).
  let ltg = acc.capitalGainsLong;
  if (acc.capitalGainsShort < 0) ltg += acc.capitalGainsShort;
  const ltgTax = round2(Math.max(0, ltg) * j.longTermCapitalGainsRate);
  const stgTax = j.shortTermCapitalGainsAsOrdinary ? share(parts.stcg) : round2(Math.max(0, acc.capitalGainsShort) * j.longTermCapitalGainsRate);
  const divTax = round2(Math.max(0, acc.dividends) * j.dividendRate);
  const ordinaryTax = share(parts.salary);
  const businessTax = share(parts.business);
  const interestTax = share(parts.interest);
  const total = round2(ordinaryTax + businessTax + interestTax + ltgTax + stgTax + divTax);
  return {
    ordinaryTax,
    capitalGainsTax: round2(ltgTax + stgTax),
    dividendTax: divTax,
    interestTax,
    businessTax,
    totalLiability: total,
    withheld: acc.withheld,
    balanceDue: round2(total - acc.withheld),
    breakdown: [
      { label: 'Ordinary income (salary etc.)', base: parts.salary, tax: ordinaryTax },
      { label: 'Business income (distributed)', base: parts.business, tax: businessTax },
      { label: 'Interest income', base: parts.interest, tax: interestTax },
      { label: 'Long-term capital gains', base: Math.max(0, ltg), tax: ltgTax },
      { label: 'Short-term capital gains', base: Math.max(0, acc.capitalGainsShort), tax: stgTax },
      { label: 'Dividends', base: Math.max(0, acc.dividends), tax: divTax },
    ],
  };
}

export function emptyTaxYear(year: number): TaxYearAccumulator {
  return { year, ordinaryIncome: 0, withheld: 0, capitalGainsLong: 0, capitalGainsShort: 0, dividends: 0, interestIncome: 0, businessIncome: 0, deductions: 0, propertyTaxPaid: 0, salesTaxPaid: 0 };
}
