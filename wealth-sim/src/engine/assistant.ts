import type { SimulationState, Money, Sourced, Assumption, ExpenseCategory, AssetCategory, Id, MarketScenarioId } from './types';
import { round2, roundEstimate, formatMoney } from './money';
import { computeMetrics } from './metrics';
import { findCatalog, CATALOG_SOURCE, STAFF_REFERENCE, SERVICE_REFERENCE, type CatalogItem } from './catalog';
import { PROJECT_REFERENCE } from './projects';
import { newProposal, type Proposal, type Primitive } from './proposals';
import { planPurchase, type PurchaseSpec } from './purchase';
import type { FinancingTerms } from './loans';
import { planSale } from './sell';
import { estimateEvent } from './events';
import { runScenario, type ScenarioAction, type ScenarioResult } from './scenarioLab';
import { JURISDICTIONS } from './tax';
import { nextId } from './ids';
import { storageOptionsWhenFull, findAvailableLocation } from './storage';

/**
 * Built-in assistants. They read the live state, build Proposals from the
 * shared primitives, and never touch balances directly. Everything they
 * create goes through the same preview → confirm → commit pipeline.
 */
export interface AssistantPersona { id: string; name: string; title: string; focus: string; style: string }

export const ASSISTANTS: AssistantPersona[] = [
  { id: 'cfo', name: 'Margaret Okafor', title: 'Chief Financial Officer', focus: 'Liquidity, cash flow, taxes, leverage, net worth', style: 'Direct, numbers first, flags risk.' },
  { id: 'lifestyle', name: 'Julien Marchetti', title: 'Lifestyle & Personal Assistant', focus: 'Staff, travel, events, memberships, day-to-day', style: 'Warm, practical, anticipates needs.' },
  { id: 'realestate', name: 'Priya Venkataraman', title: 'Real Estate Advisor', focus: 'Properties, renovations, carrying costs, financing', style: 'Market-aware, detail-oriented.' },
  { id: 'auto', name: 'Diego Ferrante', title: 'Automotive Specialist', focus: 'Cars, storage, collection strategy', style: 'Enthusiast, candid on depreciation.' },
  { id: 'invest', name: 'Helena Strand', title: 'Investment Advisor', focus: 'Portfolio, allocation, scenarios, market risk', style: 'Measured, probabilistic.' },
  { id: 'business', name: 'Samuel Adeyemi', title: 'Business Advisor', focus: 'Acquisitions, operations, distributions, valuation', style: 'Operator mindset.' },
  { id: 'property', name: 'Ines Carvalho', title: 'Property Manager', focus: 'Maintenance, staff, storage, property operations', style: 'Organized, proactive.' },
];

export interface AssistantReply {
  assistantId: string;
  text: string;
  proposal?: Proposal;
  scenario?: ScenarioResult;
  action?: { kind: 'advance'; unit: 'day' | 'month' | 'quarter' | 'year'; n: number } | { kind: 'sell'; assetId: Id; price: Sourced<Money> } | { kind: 'scenario_set'; scenario: MarketScenarioId } | { kind: 'navigate'; screen: string };
  choices?: { label: string; command: string }[];
}

const money = (n: number, s: SimulationState) => formatMoney(n, s.profile.currency, true);

function parseMoney(text: string): Money | null {
  const m = text.replace(/,/g, '').match(/(?:\$|£|€)?\s*(\d+(?:\.\d+)?)\s*(billion|bn|b|million|mm|m|thousand|k)?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  if (['billion', 'bn', 'b'].includes(unit)) return n * 1e9;
  if (['million', 'mm', 'm'].includes(unit)) return n * 1e6;
  if (['thousand', 'k'].includes(unit)) return n * 1e3;
  return n;
}

function parseFinancing(text: string, category: AssetCategory): FinancingTerms | undefined {
  const t = text.toLowerCase();
  if (!/financ|mortgage|loan|down|borrow|lever/.test(t)) return undefined;
  const kind: FinancingTerms['kind'] = category === 'real_estate' || category === 'land' ? 'mortgage' : category === 'vehicle' ? 'auto_loan' : category === 'aircraft' ? 'aircraft_loan' : category === 'yacht' ? 'marine_loan' : category === 'business' ? 'business_loan' : 'personal_loan';
  const down = t.match(/(\d+(?:\.\d+)?)\s*%\s*down/);
  const rate = t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:rate|interest|apr)/);
  const term = t.match(/(\d+)\s*[- ]?(year|yr|month|mo)/);
  const terms: FinancingTerms = { kind, annualRate: rate ? parseFloat(rate[1]) / 100 : (undefined as any), termMonths: term ? parseInt(term[1]) * (/year|yr/.test(term[2]) ? 12 : 1) : (undefined as any) };
  if (down) terms.downPaymentPct = parseFloat(down[1]) / 100;
  return terms;
}

function pickAssistant(text: string): string {
  const t = text.toLowerCase();
  if (/car|porsche|ferrari|lamborghini|garage|vehicle|bugatti|rolls|bentley|mclaren/.test(t)) return 'auto';
  if (/house|penthouse|estate|villa|apartment|townhouse|property|renovat|kitchen|mortgage|ranch|chalet/.test(t)) return 'realestate';
  if (/stock|etf|bond|portfolio|invest|market|crash|recession|scenario|what if/.test(t)) return 'invest';
  if (/business|company|acqui|stake|revenue|distribution/.test(t)) return 'business';
  if (/hire|chef|staff|party|event|wedding|gala|travel|membership|club|charter|horse|butler|nanny/.test(t)) return 'lifestyle';
  if (/storage|maintenance|warehouse|hangar|marina/.test(t)) return 'property';
  return 'cfo';
}

function specFromCatalog(state: SimulationState, item: CatalogItem, text: string, priceOverride?: Money): PurchaseSpec {
  const price: Sourced<Money> = priceOverride != null ? { value: priceOverride, source: { type: 'user_entered', label: 'Price specified by user' } } : { value: item.price, source: { ...CATALOG_SOURCE, range: item.range } };
  return {
    name: item.name,
    description: item.description,
    category: item.category,
    details: structuredClone(item.details),
    price,
    financing: parseFinancing(text, item.category),
    costOptions: item.costOptions,
    listing: { source: price.source, listingPrice: item.price, specifications: {} },
    createdBy: 'assistant',
    idempotencyKey: `buy:${item.id}:${state.currentDate}:${nextId(state, 'ik')}`,
  };
}

function financialSummary(state: SimulationState): string {
  const m = computeMetrics(state);
  return `Net worth ${money(m.netWorth, state)} · cash ${money(m.cash, state)} · liquid ${money(m.liquidAssets, state)} · debt ${money(m.totalLiabilities, state)} · monthly cash flow ${money(m.monthlyCashFlow, state)} · annual burn ${money(m.annualLifestyleBurn, state)}.`;
}

/** Main entry: turns a user instruction into a reply, possibly with a proposal or action. Pure (no state mutation except id counters). */
export function respond(state: SimulationState, text: string, assistantIdHint?: string): AssistantReply {
  const t = text.trim();
  const tl = t.toLowerCase();
  const assistantId = assistantIdHint ?? pickAssistant(tl);
  const m = computeMetrics(state);

  // --- Time ---
  const adv = tl.match(/^(?:advance|skip|move|go|forward|wait)\s+(?:ahead\s+|forward\s+)?(?:by\s+)?(\d+)?\s*(day|week|month|quarter|year)s?/);
  if (adv) {
    const n = adv[1] ? parseInt(adv[1]) : 1;
    const unitRaw = adv[2];
    const unit = unitRaw === 'week' ? 'day' : (unitRaw as 'day' | 'month' | 'quarter' | 'year');
    return { assistantId: 'cfo', text: `Advancing ${n} ${unitRaw}${n > 1 ? 's' : ''}. I'll process salary, expenses, loan payments, market moves and anything scheduled.`, action: { kind: 'advance', unit, n: unitRaw === 'week' ? n * 7 : n } };
  }

  // --- Status questions ---
  if (/^(how|what).*(net worth|cash|afford|liquid|position|doing|status|summary)/.test(tl) || tl === 'status') {
    const warn = m.cash < m.annualLifestyleBurn ? ` Heads-up: cash covers less than a year of lifestyle burn (${money(m.annualLifestyleBurn, state)}/yr).` : '';
    return { assistantId: 'cfo', text: `${financialSummary(state)}${warn}` };
  }
  const afford = tl.match(/can i afford (.+)/);
  if (afford) {
    const price = parseMoney(afford[1]);
    if (price) {
      const ok = m.cash >= price;
      return { assistantId: 'cfo', text: ok ? `Yes in cash terms: ${money(price, state)} against ${money(m.cash, state)} available, leaving ${money(m.cash - price, state)}. Whether it's wise depends on carrying costs; ask me to buy it and I'll show the full picture.` : `Not in cash. You have ${money(m.cash, state)} against ${money(price, state)}. Net worth is ${money(m.netWorth, state)}, but net worth isn't liquidity. Options: finance it, sell liquid holdings (${money(m.liquidAssets - m.cash, state)} in securities), or a securities-backed line.` };
    }
  }

  // --- Scenario / what-if ---
  if (/^what if|^what happens if|^scenario:/.test(tl)) return scenarioReply(state, tl);
  const mk = tl.match(/(?:set|switch|change)\s+(?:the\s+)?(?:market\s+)?scenario\s+to\s+(\w[\w ]*)/);
  if (mk) {
    const id = (['normal', 'bull', 'recession', 'high_inflation', 'real_estate_downturn', 'market_crash', 'high_rates'] as MarketScenarioId[]).find((s) => mk[1].replace(/ /g, '_').startsWith(s.split('_')[0]));
    if (id) return { assistantId: 'invest', text: `Switching the market scenario to ${id.replace('_', ' ')}. This changes drift, volatility, inflation and rates going forward; it doesn't rewrite history.`, action: { kind: 'scenario_set', scenario: id } };
  }

  // --- Sell ---
  const sell = tl.match(/^sell\s+(?:the\s+|my\s+)?(.+?)(?:\s+for\s+(.+))?$/);
  if (sell) {
    const owned = Object.values(state.assets).filter((a) => a.status === 'owned' && a.resaleAllowed);
    const q = sell[1].split(/\s+/);
    const match = owned.map((a) => ({ a, score: q.reduce((s, w) => s + (a.name.toLowerCase().includes(w) ? 1 : 0), 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)[0]?.a;
    if (!match) return { assistantId, text: `I couldn't find an owned asset matching "${sell[1]}". Owned: ${owned.slice(0, 8).map((a) => a.name).join(', ')}${owned.length > 8 ? '…' : ''}.` };
    const price = sell[2] ? parseMoney(sell[2]) : null;
    const salePrice: Sourced<Money> = price ? { value: price, source: { type: 'user_entered' } } : { value: match.currentValue, source: { type: 'market_estimate', label: 'Current simulated carrying value' } };
    const plan = planSale(state, match.id, salePrice);
    return {
      assistantId,
      text: `Sale of ${match.name} at ${money(plan.salePrice, state)}: fees ${money(plan.fees, state)}${plan.loanPayoff ? `, loan payoff ${money(plan.loanPayoff, state)}` : ''}, net proceeds ${money(plan.netProceeds, state)}. Gain vs basis ${money(plan.taxableGain, state)} (${plan.longTerm ? 'long-term' : 'short-term'}); estimated tax ${money(plan.estimatedCapitalGainsTax, state)} at the next settlement. Ends ${money(plan.endedRecurringAnnual, state)}/yr of carrying costs. Cash ${money(plan.before.cash, state)} → ${money(plan.after.cash, state)}, net worth ${money(plan.before.netWorth, state)} → ${money(plan.after.netWorth, state)}. Confirm to proceed.`,
      action: { kind: 'sell', assetId: match.id, price: salePrice },
    };
  }

  // --- Hire staff ---
  const hire = tl.match(/^(?:hire|employ|get)\s+(?:a|an|me a|me an|\d+)?\s*(.+)/);
  if (hire) return hireReply(state, hire[1], t);

  // --- Projects / renovations ---
  if (/renovat|remodel|build (?:a|an) |install|convert|redesign|refit|refurbish|expand (?:the )?garage/.test(tl)) return projectReply(state, tl, t);

  // --- Events ---
  if (/party|wedding|gala|dinner|fundraiser|retreat|ball|concert/.test(tl) && /host|throw|plan|hold|organi/.test(tl)) return eventReply(state, tl, t);

  // --- Custom recurring / services ---
  if (/^(?:add|start|subscribe|join|get|book|charter|keep|board|rent)\b/.test(tl)) return serviceReply(state, tl, t);

  // --- Purchase ---
  if (/^(?:buy|purchase|acquire|get me|find me|find|look for|search)/.test(tl)) return purchaseReply(state, tl, t, assistantId);

  // --- Fallback: help ---
  return {
    assistantId,
    text: `I can act on instructions like these. Everything I create goes through a review screen before it touches the books.\n${financialSummary(state)}`,
    choices: [
      { label: 'Buy a Ferrari 12Cilindri', command: 'Buy a Ferrari 12Cilindri' },
      { label: 'Find a penthouse under $30M', command: 'Find me a penthouse under 30 million' },
      { label: 'Hire a Michelin-level chef', command: 'Hire a Michelin-level private chef' },
      { label: 'Keep three horses', command: 'Keep three horses at a stable' },
      { label: 'What if the market falls 30%?', command: 'What if the stock market falls 30%?' },
      { label: 'Advance one year', command: 'Advance 1 year' },
    ],
  };
}

function purchaseReply(state: SimulationState, tl: string, original: string, assistantId: string): AssistantReply {
  const under = tl.match(/(?:under|below|less than|up to|around|about|for)\s+((?:\$|£|€)?\s*\d[\d.,]*\s*(?:billion|bn|million|mm|m|thousand|k)?)/);
  const maxPrice = under ? parseMoney(under[1]) : null;
  const explicitPrice = /\bfor\s+(?:\$|£|€)?\s*\d/.test(tl) && maxPrice ? maxPrice : undefined;
  const query = tl.replace(/^(?:buy|purchase|acquire|get me|find me|find|look for|search)\s*(?:me\s+)?(?:a|an|the)?\s*/, '').replace(/\s+(?:under|below|less than|up to|around|about|for)\s+.*$/, '').replace(/\s+(?:with|and)\s+.*(?:down|financ|mortgage|loan).*$/, '');
  const results = findCatalog(query).filter((c) => !maxPrice || explicitPrice || c.price <= maxPrice * 1.15);
  if (results.length === 0) {
    const price = explicitPrice ?? maxPrice;
    if (price) {
      const category = guessCategory(query);
      return customAssetReply(state, query, category, price, original);
    }
    return { assistantId, text: `I don't have "${query}" in the reference catalog and no price was given. Tell me the price ("buy ${query} for $2.5M") and I'll model it as a custom asset with realistic secondary costs, or import a listing on the Purchase screen with the source and retrieval date.` };
  }
  if (results.length > 1 && !explicitPrice && /find|look|search|penthouse|house|estate|villa/.test(tl) && !/^buy/.test(tl)) {
    return {
      assistantId,
      text: `Here's what I found in the reference catalog (built-in reference values, not live listings). Pick one and I'll build the full purchase review.`,
      choices: results.slice(0, 6).map((c) => ({ label: `${c.name} — ${money(c.price, state)}`, command: `Buy ${c.name}${/down|financ|mortgage/.test(tl) ? ' ' + original.slice(original.toLowerCase().indexOf('with')) : ''}` })),
    };
  }
  const item = results[0];
  const spec = specFromCatalog(state, item, tl, explicitPrice);
  const proposal = newProposal(state, {
    title: `Purchase ${item.name}`,
    explanation: buildPurchaseExplanation(state, spec, item),
    primitives: [{ kind: 'asset', spec }],
    assumptions: [],
    createdBy: 'assistant',
    assistantId,
  });
  return { assistantId, text: proposal.explanation, proposal };
}

function guessCategory(q: string): AssetCategory {
  if (/car|porsche|ferrari|lambo|bugatti|rolls|bentley|mercedes|bmw|tesla|vehicle|truck|motorcycle/.test(q)) return 'vehicle';
  if (/jet|aircraft|plane|helicopter|gulfstream|bombardier|falcon/.test(q)) return 'aircraft';
  if (/yacht|boat|catamaran|sailboat/.test(q)) return 'yacht';
  if (/house|home|penthouse|estate|villa|apartment|condo|townhouse|chalet|mansion|residence/.test(q)) return 'real_estate';
  if (/land|acre|ranch|plot/.test(q)) return 'land';
  if (/painting|art|sculpture|picasso|warhol|basquiat|monet/.test(q)) return 'art';
  if (/watch|rolex|patek|ring|diamond|necklace|jewel/.test(q)) return 'jewelry_watches';
  if (/wine|whisky|card|coin|stamp|horse|guitar|comic/.test(q)) return 'collectible';
  if (/company|business|firm|restaurant|hotel|franchise|stake/.test(q)) return 'business';
  if (/stock|etf|shares|bond|fund|index/.test(q)) return 'public_security';
  if (/furniture|sofa|table|piano/.test(q)) return 'furniture';
  return 'custom_physical';
}

function customAssetReply(state: SimulationState, name: string, category: AssetCategory, price: Money, original: string): AssistantReply {
  const j = JURISDICTIONS[state.profile.taxJurisdiction];
  const details: PurchaseSpec['details'] =
    category === 'real_estate' ? { kind: 'property', property: { address: state.profile.location, propertyType: 'residence', use: 'vacation_residence', garageCapacity: 2, parkingSpaces: 2, storageCapacity: 20, annualPropertyTaxRate: j.defaultPropertyTaxRate } } :
    category === 'vehicle' ? { kind: 'vehicle', vehicle: { make: name.split(' ')[0] ?? 'Custom', model: name.split(' ').slice(1).join(' ') || name, year: 2026 } } :
    category === 'public_security' ? { kind: 'security', security: { assetClass: 'etf', expectedAnnualReturn: 0.075, annualVolatility: 0.16, dividendYield: 0.015 } } :
    { kind: 'generic', fields: {} };
  const spec: PurchaseSpec = {
    name: titleCase(name), category, details,
    price: { value: price, source: { type: 'user_entered', label: 'Price given by user' } },
    financing: parseFinancing(original.toLowerCase(), category),
    createdBy: 'assistant',
    assumptions: [{ key: 'custom', label: 'Custom asset', value: 'Not in reference catalog; secondary costs use the category cost model', kind: 'simulation_assumption' }],
    idempotencyKey: `buy:custom:${state.currentDate}:${nextId(state, 'ik')}`,
  };
  const proposal = newProposal(state, { title: `Purchase ${spec.name}`, explanation: buildPurchaseExplanation(state, spec), primitives: [{ kind: 'asset', spec }], assumptions: spec.assumptions ?? [], createdBy: 'assistant', assistantId: pickAssistant(name) });
  return { assistantId: proposal.assistantId!, text: proposal.explanation, proposal };
}

function titleCase(s: string): string { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }

function buildPurchaseExplanation(state: SimulationState, spec: PurchaseSpec, item?: CatalogItem): string {
  const plan = planPurchase(state, spec);
  const src = spec.price.source.type === 'builtin_reference' ? `built-in reference value${item?.range ? ` (typical range ${money(item.range.low, state)}–${money(item.range.high, state)})` : ''}, not a live quote` : spec.price.source.type === 'user_entered' ? 'price you specified' : spec.price.source.label ?? spec.price.source.type;
  const lines = [
    `${spec.name}: ${money(plan.price, state)} (${src}).`,
    `Taxes & fees: ${money(plan.salesTax + plan.fees, state)}. ${plan.loanAmount > 0 ? `Financing ${money(plan.loanAmount, state)} at ${(plan.loanRate * 100).toFixed(2)}% over ${Math.round(plan.loanTermMonths / 12)} yrs (${money(plan.loanMonthlyPayment, state)}/mo), ${money(plan.downPayment, state)} down. ` : ''}Cash needed now: ${money(plan.cashRequired, state)} of ${money(plan.cashAvailable, state)} available.`,
    `Estimated ownership cost ${money(plan.annualOwnershipCost, state)}/yr; expected value change ${money(plan.estimatedAnnualValueChange, state)}/yr.`,
    `After purchase: cash ${money(plan.before.cash, state)} → ${money(plan.after.cash, state)}, net worth ${money(plan.before.netWorth, state)} → ${money(plan.after.netWorth, state)}, annual burn ${money(plan.before.annualLifestyleBurn, state)} → ${money(plan.after.annualLifestyleBurn, state)}.`,
  ];
  if (plan.storage.needsStorage) lines.push(plan.storage.locationId ? `Storage: ${plan.storage.locationName}.` : `No storage has space. Options: ${plan.storage.options.slice(0, 3).join('; ')}.`);
  if (plan.warnings.length) lines.push(`⚠ ${plan.warnings.join(' ')}`);
  lines.push('Review the breakdown and confirm to commit.');
  return lines.join('\n');
}

function hireReply(state: SimulationState, roleText: string, original: string): AssistantReply {
  const countMatch = original.match(/(\d+)\s+/);
  const count = countMatch ? Math.min(20, parseInt(countMatch[1])) : 1;
  const key = Object.keys(STAFF_REFERENCE).find((k) => {
    const ref = STAFF_REFERENCE[k];
    return roleText.includes(k.replace('_', ' ')) || roleText.includes(ref.role.toLowerCase().split(' ')[0]) || (k === 'michelin_chef' && /michelin/.test(roleText)) || (k === 'security' && /security|bodyguard|protection/.test(roleText)) || (k === 'driver' && /driver|chauffeur/.test(roleText)) || (k === 'art_manager' && /art/.test(roleText) && /manag|curat/.test(roleText)) || (k === 'historian' && /historian|archiv/.test(roleText));
  });
  const salaryGiven = original.match(/(?:at|for|paying)\s+((?:\$|£|€)?\s*\d[\d.,]*\s*(?:k|thousand|m|million)?)\s*(?:\/|per|a)?\s*(year|yr|month|mo)?/i);
  let salary: Sourced<Money>;
  let role: string;
  const assumptions: Assumption[] = [];
  if (salaryGiven) {
    let v = parseMoney(salaryGiven[1]) ?? 0;
    if (salaryGiven[2] && /month|mo/.test(salaryGiven[2])) v *= 12;
    salary = { value: v, source: { type: 'user_entered', label: 'Salary given by user' } };
    role = key ? STAFF_REFERENCE[key].role : titleCase(roleText.replace(/\s+(?:at|for|paying).*$/, ''));
  } else if (key) {
    const ref = STAFF_REFERENCE[key];
    const local = /new york|london|california|los angeles|san francisco|monaco|dubai|geneva|zurich/i.test(state.profile.location) ? 1.15 : 1.0;
    salary = { value: roundEstimate(ref.typical * local, 2), source: { type: 'calculated_estimate', label: `Reference range ${money(ref.low, state)}–${money(ref.high, state)} (built-in compensation reference), geography ×${local}`, range: { low: ref.low, high: ref.high }, confidence: 0.6 } };
    role = ref.role;
    assumptions.push({ key: 'range', label: 'Market salary range', value: `${money(ref.low, state)}–${money(ref.high, state)}`, kind: 'real_world_data', source: salary.source });
    assumptions.push({ key: 'geo', label: 'Geography adjustment', value: `×${local}`, kind: 'simulation_assumption' });
    if (ref.notes) assumptions.push({ key: 'notes', label: 'Notes', value: ref.notes, kind: 'simulation_assumption' });
  } else {
    return { assistantId: 'lifestyle', text: `I don't have a reference salary for "${roleText}". Tell me what to pay ("hire a ${roleText} at $150k/year") and I'll model it with employer overhead, or pick a similar role: ${Object.values(STAFF_REFERENCE).slice(0, 8).map((r) => r.role).join(', ')}.` };
  }
  const primitives: Primitive[] = [];
  for (let i = 0; i < count; i++) primitives.push({ kind: 'staff', role, baseSalary: salary, overheadRate: 0.22, assumptions });
  if (key === 'chef' || key === 'michelin_chef') primitives.push({ kind: 'recurring_expense', name: 'Food purchasing budget (chef)', category: 'dining', amount: { value: 7_500, source: { type: 'calculated_estimate', label: 'Typical household provisioning budget with a full-time chef' } }, interval: 'monthly' });
  const loaded = round2(salary.value * 1.22);
  const proposal = newProposal(state, {
    title: `Hire ${count > 1 ? `${count} × ` : ''}${role}`,
    explanation: `${role}: base ${money(salary.value, state)}/yr (${salary.source.label ?? salary.source.type}) + 22% employer payroll/benefits (simulation assumption) = ${money(loaded, state)}/yr each${count > 1 ? `, ${money(loaded * count, state)} total` : ''}.${key === 'chef' || key === 'michelin_chef' ? ' Adds a $7,500/month food purchasing budget as a separate line you can edit.' : ''} Monthly burn rises by ${money((loaded * count + ((key === 'chef' || key === 'michelin_chef') ? 90_000 : 0)) / 12, state)}. Confirm to add to payroll.`,
    primitives,
    assumptions,
    createdBy: 'assistant',
    assistantId: 'lifestyle',
  });
  return { assistantId: 'lifestyle', text: proposal.explanation, proposal };
}

function projectReply(state: SimulationState, tl: string, original: string): AssistantReply {
  const props = Object.values(state.assets).filter((a) => a.status === 'owned' && (a.details.kind === 'property' || a.category === 'aircraft' || a.category === 'yacht'));
  const target = props.map((a) => ({ a, score: a.name.toLowerCase().split(/\s+/).reduce((s, w) => s + (w.length > 2 && tl.includes(w) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score)[0];
  const attached = target && target.score > 0 ? target.a : props.find((a) => a.details.kind === 'property' && a.details.property.use === 'primary_residence') ?? props[0];
  const keyMap: [RegExp, string][] = [[/kitchen/, 'kitchen_renovation'], [/dressing room|closet/, 'dressing_room'], [/complete|entire|whole|full|gut/, 'full_renovation'], [/interior design|redecorat/, 'interior_design'], [/garage/, 'garage_expansion'], [/pool/, 'pool'], [/landscap|garden/, 'landscaping'], [/theater|theatre|cinema/, 'home_theater'], [/wine cellar|cellar/, 'wine_cellar'], [/aircraft|jet|cabin/, 'aircraft_refurb'], [/yacht|refit/, 'yacht_refit'], [/art installation|install.*art/, 'art_installation']];
  const keys = keyMap.filter(([re]) => re.test(tl)).map(([, k]) => k);
  if (keys.length === 0) keys.push('interior_design');
  const given = original.match(/(?:for|budget(?: of)?|costing)\s+((?:\$|£|€)?\s*\d[\d.,]*\s*(?:k|thousand|m|million)?)/i);
  const budget = given ? parseMoney(given[1]) : null;
  const sqft = attached?.details.kind === 'property' ? attached.details.property.squareFeet ?? 5_000 : 5_000;
  const primitives: Primitive[] = [];
  const assumptions: Assumption[] = [];
  const parts: string[] = [];
  let months = 0;
  for (const k of keys) {
    const ref = PROJECT_REFERENCE[k];
    const low = ref.lowPerSqFt ? ref.lowPerSqFt * sqft : ref.low!;
    const high = ref.highPerSqFt ? ref.highPerSqFt * sqft : ref.high!;
    const est = budget && keys.length === 1 ? budget : roundEstimate((low + high) / 2, 2);
    const src = budget && keys.length === 1 ? { type: 'user_entered' as const, label: 'Budget given by user' } : { type: 'calculated_estimate' as const, label: `${ref.label}: ${ref.lowPerSqFt ? `${money(ref.lowPerSqFt, state)}–${money(ref.highPerSqFt!, state)}/sq ft × ${sqft.toLocaleString()} sq ft` : `${money(low, state)}–${money(high, state)}`} (built-in reference), midpoint`, range: { low, high } };
    primitives.push({ kind: 'project', input: { name: `${ref.label}${attached ? ` — ${attached.name}` : ''}`, estimatedCost: { value: est, source: src }, costRange: { low, high }, durationMonths: ref.months, contingencyRate: 0.15 }, assetRef: attached?.id });
    assumptions.push({ key: k, label: ref.label, value: `${money(low, state)}–${money(high, state)}; working estimate ${money(est, state)}`, kind: src.type === 'user_entered' ? 'user_override' : 'calculated_value', source: src });
    parts.push(`${ref.label}: ${money(est, state)} (range ${money(low, state)}–${money(high, state)}, ${ref.months} months)`);
    months = Math.max(months, ref.months);
  }
  const total = primitives.reduce((s, p) => s + (p.kind === 'project' ? p.input.estimatedCost.value : 0), 0);
  const proposal = newProposal(state, {
    title: `Project: ${keys.map((k) => PROJECT_REFERENCE[k].label).join(' + ')}`,
    explanation: `${parts.join('. ')}. Plus 15% contingency (simulation assumption) → budget ${money(total * 1.15, state)}, paid 25% up front then monthly over ${months} months${attached ? `, attached to ${attached.name}` : ''}. ${attached?.category === 'real_estate' ? '50% of spend is capitalized into the property value; the rest is expensed.' : 'Spend is expensed as it is paid.'} You can edit every figure before confirming.`,
    primitives,
    assumptions,
    createdBy: 'assistant',
    assistantId: 'realestate',
  });
  return { assistantId: 'realestate', text: proposal.explanation, proposal };
}

function eventReply(state: SimulationState, tl: string, original: string): AssistantReply {
  const guests = parseInt((tl.match(/(\d+)[- ]?(?:person|people|guest)/) ?? [])[1] ?? '150');
  const kind = /wedding/.test(tl) ? 'wedding' : /gala|ball|fundraiser/.test(tl) ? 'gala' : /dinner/.test(tl) ? 'private dinner' : /retreat/.test(tl) ? 'corporate retreat' : /concert/.test(tl) ? 'concert' : /yacht/.test(tl) ? 'yacht party' : 'party';
  const ultra = /masquerade|black tie|lavish|ultra|spectacular|over the top/.test(tl);
  const spec: import('./events').EventSpec = {
    name: titleCase(original.replace(/^(?:host|throw|plan|hold|organi[sz]e)\s+(?:a|an)?\s*/i, '')),
    kind, location: state.profile.location, guestCount: guests,
    venueTier: ultra ? 'ultra' : kind === 'wedding' || kind === 'gala' ? 'premium' : 'standard',
    foodTier: ultra ? 'ultra' : 'premium',
    entertainment: /concert|headline/.test(tl) ? 'headline_act' : ultra || kind === 'wedding' || kind === 'gala' ? 'band' : 'dj',
    security: guests >= 100, transportation: guests >= 100 && ultra,
    decorTier: ultra ? 'ultra' : kind === 'wedding' ? 'premium' : 'standard',
    production: ultra || kind === 'gala' || kind === 'concert',
  };
  const est = estimateEvent(spec);
  const proposal = newProposal(state, {
    title: `Event: ${spec.name}`,
    explanation: `${spec.name}: ${guests} guests, ${spec.venueTier} venue, ${spec.foodTier} catering, ${spec.entertainment.replace('_', ' ')}${spec.security ? ', security' : ''}${spec.production ? ', full production' : ''}. Estimated ${money(est.total, state)} from per-guest reference rates (simulation assumptions; every line editable). Paid in full on the event date.`,
    primitives: [{ kind: 'event', spec }],
    assumptions: est.lineItems.map((l) => ({ key: l.label, label: l.label, value: l.amount, kind: 'calculated_value' as const, source: l.source })),
    createdBy: 'assistant', assistantId: 'lifestyle',
  });
  return { assistantId: 'lifestyle', text: proposal.explanation, proposal };
}

function serviceReply(state: SimulationState, tl: string, original: string): AssistantReply {
  // Horses: composite structure
  const horses = tl.match(/(\d+|a|one|two|three|four|five)\s+horses?/);
  if (horses) {
    const n = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 }[horses[1]] ?? parseInt(horses[1]);
    const prims: Primitive[] = [];
    for (let i = 1; i <= n; i++) {
      prims.push({ kind: 'custom_asset', ref: `horse${i}`, name: `Horse ${i}`, category: 'collectible', value: { value: 75_000, source: { type: 'calculated_estimate', label: 'Quality riding horse reference $40k–$150k; midpoint used', range: { low: 40_000, high: 150_000 } } }, valueRule: { annualRate: -0.08, annualVolatility: 0.05 }, storageLocationId: null, recurring: [
        { name: 'Stable boarding', category: 'custom', amount: SERVICE_REFERENCE.stable_boarding.typical / 12, interval: 'monthly', source: { type: 'calculated_estimate', label: 'Full-service boarding reference', range: { low: SERVICE_REFERENCE.stable_boarding.low, high: SERVICE_REFERENCE.stable_boarding.high } } },
        { name: 'Veterinary & farrier', category: 'custom', amount: SERVICE_REFERENCE.vet_care.typical / 12, interval: 'monthly', source: { type: 'calculated_estimate', label: 'Vet/farrier reference' } },
        { name: 'Equine insurance', category: 'insurance', amount: SERVICE_REFERENCE.horse_insurance.typical, interval: 'annual', source: { type: 'calculated_estimate', label: '~3% of value' } },
      ] });
    }
    prims.push({ kind: 'one_time_expense', name: 'Tack & equipment', category: 'custom', amount: { value: 8_000 * n, source: { type: 'calculated_estimate', label: '$8k per horse' } } });
    const annual = n * (SERVICE_REFERENCE.stable_boarding.typical + SERVICE_REFERENCE.vet_care.typical + SERVICE_REFERENCE.horse_insurance.typical);
    const proposal = newProposal(state, { title: `Keep ${n} horse${n > 1 ? 's' : ''} at a stable`, explanation: `Structure: ${n} physical assets (horses, ~$75k each, depreciating 8%/yr), each with boarding (${money(SERVICE_REFERENCE.stable_boarding.typical, state)}/yr), vet & farrier (${money(SERVICE_REFERENCE.vet_care.typical, state)}/yr) and mortality insurance (${money(SERVICE_REFERENCE.horse_insurance.typical, state)}/yr), plus one-time tack. Purchase ${money(75_000 * n, state)}; ongoing ${money(annual, state)}/yr. No stable staff included; ask me to hire a groom if you want one.`, primitives: prims, assumptions: [{ key: 'ref', label: 'Cost basis', value: 'Built-in equine cost references', kind: 'real_world_data' }], createdBy: 'assistant', assistantId: 'lifestyle' });
    return { assistantId: 'lifestyle', text: proposal.explanation, proposal };
  }
  // Warehouse / storage rental
  if (/warehouse|storage|garage/.test(tl) && /rent|lease|get/.test(tl)) {
    const cap = parseInt((tl.match(/(\d+)\s*(?:car|vehicle|space|bay)/) ?? [])[1] ?? '20');
    const rent = roundEstimate((SERVICE_REFERENCE.warehouse_lease.typical / 20) * cap / 12, 2);
    const proposal = newProposal(state, { title: `Rent storage for ${cap} vehicles`, explanation: `Warehouse lease with ${cap} vehicle spaces at ~${money(rent, state)}/month (${money(rent * 12, state)}/yr; reference $220k/yr per 20 cars). Creates a storage location you can assign cars to and a monthly rent expense.`, primitives: [{ kind: 'storage_location', name: `Rented warehouse (${cap} cars)`, storageKind: 'warehouse', capacity: cap, monthlyRent: rent, accepts: ['vehicle', 'art', 'collectible'] }], assumptions: [], createdBy: 'assistant', assistantId: 'property' });
    return { assistantId: 'property', text: proposal.explanation, proposal };
  }
  // Helicopter charter
  if (/helicopter|chopper/.test(tl)) {
    const weekly = /every (?:week|friday|monday|weekend)|weekly/.test(tl);
    const ref = SERVICE_REFERENCE.helicopter_charter_weekly;
    const annual = weekly ? ref.typical : ref.typical / 4;
    const proposal = newProposal(state, { title: 'Helicopter charter', explanation: `${weekly ? 'Weekly' : 'Monthly'} helicopter charter at ~$10k per round trip (reference range ${money(ref.low, state)}–${money(ref.high, state)}/yr for weekly). Modeled as a recurring travel expense of ${money(annual / 12, state)}/month.`, primitives: [{ kind: 'recurring_expense', name: `${weekly ? 'Weekly' : 'Monthly'} helicopter charter`, category: 'travel', amount: { value: annual / 12, source: { type: 'calculated_estimate', label: ref.notes, range: { low: ref.low, high: ref.high } } }, interval: 'monthly' }], assumptions: [], createdBy: 'assistant', assistantId: 'lifestyle' });
    return { assistantId: 'lifestyle', text: proposal.explanation, proposal };
  }
  // Generic service lookup
  const key = Object.keys(SERVICE_REFERENCE).find((k) => { const r = SERVICE_REFERENCE[k]; return r.name.toLowerCase().split(' ').filter((w) => w.length > 3).some((w) => tl.includes(w)); });
  const given = original.match(/((?:\$|£|€)?\s*\d[\d.,]*\s*(?:k|thousand|m|million)?)\s*(?:\/|per|a|each)?\s*(year|yr|month|mo|week)/i);
  if (given) {
    let v = parseMoney(given[1]) ?? 0; const unit = given[2].toLowerCase();
    const interval = /week/.test(unit) ? 'weekly' : /month|mo/.test(unit) ? 'monthly' : 'annual';
    const name = titleCase(original.replace(/^(?:add|start|subscribe to|join|get|book|charter|keep|board|rent)\s+(?:a|an)?\s*/i, '').replace(/\s+(?:at|for|costing)?\s*(?:\$|£|€)?\s*\d.*$/i, ''));
    const cat: ExpenseCategory = key ? SERVICE_REFERENCE[key].category : 'custom';
    const proposal = newProposal(state, { title: `Add: ${name}`, explanation: `${name}: ${money(v, state)} per ${unit} as a recurring ${cat.replace('_', ' ')} expense (${money(v * ({ weekly: 52, monthly: 12, annual: 1 }[interval]), state)}/yr). Price from your instruction.`, primitives: [{ kind: 'recurring_expense', name, category: cat, amount: { value: v, source: { type: 'user_entered' } }, interval }], assumptions: [], createdBy: 'assistant', assistantId: 'lifestyle' });
    return { assistantId: 'lifestyle', text: proposal.explanation, proposal };
  }
  if (key) {
    const r = SERVICE_REFERENCE[key];
    const proposal = newProposal(state, { title: `Add: ${r.name}`, explanation: `${r.name}: reference range ${money(r.low, state)}–${money(r.high, state)}/yr; using ${money(r.typical, state)}/yr${r.notes ? ` (${r.notes})` : ''}. Edit the amount before confirming if you'd like.`, primitives: [{ kind: 'recurring_expense', name: r.name, category: r.category, amount: { value: r.interval === 'monthly' ? r.typical / 12 : r.typical, source: { type: 'calculated_estimate', label: 'Built-in service reference', range: { low: r.low, high: r.high } } }, interval: r.interval }], assumptions: [{ key, label: r.name, value: `${money(r.low, state)}–${money(r.high, state)}/yr`, kind: 'real_world_data' }], createdBy: 'assistant', assistantId: 'lifestyle' });
    return { assistantId: 'lifestyle', text: proposal.explanation, proposal };
  }
  return { assistantId: 'lifestyle', text: `I don't have a reference cost for that. Give me a figure ("add a wine subscription at $2,000/month") and I'll create it as a recurring expense with your number recorded as the source. Reference services I know: ${Object.values(SERVICE_REFERENCE).slice(0, 10).map((s) => s.name).join(', ')}.` };
}

function scenarioReply(state: SimulationState, tl: string): AssistantReply {
  const actions: ScenarioAction[] = [];
  let label = tl.replace(/^(what if|what happens if|scenario:)\s*/, '');
  const pctDrop = tl.match(/(?:falls?|drops?|declines?|crash(?:es)?|down)\s+(?:by\s+)?(\d+)\s*%/);
  if (pctDrop) {
    const cat = /real estate|property|housing/.test(tl) ? 'real_estate' : /everything|all/.test(tl) ? 'all' : 'public_security';
    actions.push({ kind: 'shock', assetCategory: cat, pct: -parseInt(pctDrop[1]) / 100 });
  }
  if (/quit|leave|retire|stop working|lose my job/.test(tl)) actions.push({ kind: 'quit_job' });
  const spend = tl.match(/spend\s+((?:\$|£|€)?\s*\d[\d.,]*\s*(?:k|thousand|m|million)?)\s*(?:per|a|\/)?\s*(year|yr|month)/);
  if (spend) { let v = parseMoney(spend[1]) ?? 0; if (/month/.test(spend[2])) v *= 12; actions.push({ kind: 'set_annual_spend', annual: v }); }
  const buy = tl.match(/(?:buy|purchase)\s+(?:a|an)?\s*((?:\$|£|€)\s*\d[\d.,]*\s*(?:k|thousand|m|million)?)\s+(.+?)(?:\s+(?:with|and)\s+.*)?$/) ?? tl.match(/(?:buy|purchase)\s+(?:a|an)?\s*(.+?)\s+(?:for|at)\s+((?:\$|£|€)?\s*\d[\d.,]*\s*(?:k|thousand|m|million)?)/);
  if (buy) {
    const priceStr = /\d/.test(buy[1]) ? buy[1] : buy[2];
    const nameStr = /\d/.test(buy[1]) ? buy[2] : buy[1];
    const price = parseMoney(priceStr);
    if (price) {
      const cat = guessCategory(nameStr);
      const j = JURISDICTIONS[state.profile.taxJurisdiction];
      const details: PurchaseSpec['details'] = cat === 'real_estate' ? { kind: 'property', property: { address: 'Scenario', propertyType: 'house', use: 'primary_residence', garageCapacity: 3, parkingSpaces: 3, storageCapacity: 20, annualPropertyTaxRate: j.defaultPropertyTaxRate } } : { kind: 'generic', fields: {} };
      actions.push({ kind: 'purchase', spec: { name: titleCase(nameStr), category: cat, details, price: { value: price, source: { type: 'user_entered' } }, financing: parseFinancing(tl, cat), createdBy: 'assistant' } });
    }
  }
  const mk = (['recession', 'market_crash', 'high_inflation', 'high_rates', 'bull', 'real_estate_downturn'] as MarketScenarioId[]).find((s) => tl.includes(s.replace('_', ' ')) || (s === 'market_crash' && /crash/.test(tl) && !pctDrop) || (s === 'high_rates' && /rates? (?:go|rise|jump)/.test(tl)));
  if (mk) actions.push({ kind: 'market', scenario: mk });
  const comp = tl.match(/(?:buy|purchase|acquire)\s+(?:a\s+|the\s+)?(?:company|business)/);
  if (comp && !buy) {
    const price = parseMoney(tl) ?? 20_000_000;
    actions.push({ kind: 'purchase', spec: { name: 'Scenario business acquisition', category: 'business', details: { kind: 'business', business: { industry: 'Scenario', annualRevenue: price * 1.2, annualOperatingExpenses: price * 0.6, annualPayroll: price * 0.4, employees: 50, ownershipPct: 1, annualGrowthRate: 0.05, distributionRate: 0.6, valuationMultiple: 5, retainedEarnings: 0 } }, price: { value: price, source: { type: 'calculated_estimate', label: 'Scenario assumption' } }, createdBy: 'assistant' } });
  }
  if (actions.length === 0) return { assistantId: 'invest', text: `I can model: "what if the stock market falls 30%", "what if I quit my job", "what if I spend $5M per year", "what if I buy a $45M house with 40% down", "what if there's a recession", "what if I purchase a company for $20M". Try one of those phrasings.` };
  const res = runScenario(state, label, actions, 10);
  const s5 = res.scenario[5].metrics, b5 = res.baseline[5].metrics, s10 = res.scenario[10].metrics, b10 = res.baseline[10].metrics;
  const text = [
    `Scenario "${label}" vs baseline (10-year projection, realism events off, same market seed):`,
    `Now: cash ${money(res.immediate.before.cash, state)} → ${money(res.immediate.after.cash, state)}; net worth ${money(res.immediate.before.netWorth, state)} → ${money(res.immediate.after.netWorth, state)}; monthly cash flow ${money(res.immediate.before.monthlyCashFlow, state)} → ${money(res.immediate.after.monthlyCashFlow, state)}.`,
    `Year 5: net worth ${money(s5.netWorth, state)} (baseline ${money(b5.netWorth, state)}), cash ${money(s5.cash, state)} (baseline ${money(b5.cash, state)}), debt ${money(s5.totalLiabilities, state)}.`,
    `Year 10: net worth ${money(s10.netWorth, state)} (baseline ${money(b10.netWorth, state)}), cash ${money(s10.cash, state)} (baseline ${money(b10.cash, state)}), liquid ${money(s10.liquidAssets, state)}.`,
    res.warnings.length ? `⚠ ${res.warnings.join(' ')}` : 'No liquidity problems detected in the projection.',
    'Nothing has been applied to your live simulation. Open Scenario Lab for the full curve, or tell me to apply it.',
  ].join('\n');
  return { assistantId: 'invest', text, scenario: res };
}

export { storageOptionsWhenFull, findAvailableLocation };
