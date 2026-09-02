import Anthropic from '@anthropic-ai/sdk';
import type { SimulationState, AssistantReply, Primitive, Assumption } from '../engine';
import { computeMetrics, newProposal, formatMoney, ASSISTANTS } from '../engine';

/**
 * Optional AI research adapter. Claude may *propose* financial objects built
 * from the engine's primitives (assets, recurring expenses, staff, projects,
 * storage...). It cannot post to the ledger or change balances; every
 * proposal is previewed and committed through the same code path as the
 * built-in assistants. Results are validated before they reach the UI.
 */
export interface LLMConfig { apiKey: string; model: string }
const KEY = 'wealth-sim:llm';

export function getLLMConfig(): LLMConfig {
  try { const raw = localStorage.getItem(KEY); if (raw) return { model: 'claude-opus-5', ...JSON.parse(raw) }; } catch { /* ignore */ }
  return { apiKey: '', model: 'claude-opus-5' };
}
export function setLLMConfig(cfg: LLMConfig): void { localStorage.setItem(KEY, JSON.stringify(cfg)); }
export function hasLLM(): boolean { return getLLMConfig().apiKey.length > 0; }

const CATEGORIES = ['vehicle', 'aircraft', 'yacht', 'art', 'jewelry_watches', 'collectible', 'furniture', 'luxury_goods', 'custom_physical', 'custom_financial', 'private_investment', 'land', 'real_estate'];
const EXPENSE_CATEGORIES = ['housing', 'property_tax', 'insurance', 'maintenance', 'utilities', 'hoa', 'staff', 'security', 'vehicle', 'aircraft', 'yacht', 'storage', 'travel', 'dining', 'clothing', 'shopping', 'entertainment', 'membership', 'health', 'education', 'charity', 'subscription', 'professional_services', 'project', 'event', 'fees', 'business', 'custom'];
const INTERVALS = ['weekly', 'monthly', 'quarterly', 'annual'];
const SOURCE_TYPES = ['retrieved_real_world', 'calculated_estimate', 'market_estimate'];

const sourced = {
  type: 'object', additionalProperties: false,
  properties: {
    value: { type: 'number', description: 'Working value. Prefer round numbers; never fake precision.' },
    source_type: { type: 'string', enum: SOURCE_TYPES, description: 'retrieved_real_world only if a web source was actually consulted.' },
    source_label: { type: 'string', description: 'Where the number comes from, e.g. "Range from three recruiter salary guides, 2026".' },
    reference: { type: 'string', description: 'URL if a web source was used, else empty string.' },
    range_low: { type: 'number' },
    range_high: { type: 'number' },
  },
  required: ['value', 'source_type', 'source_label', 'reference', 'range_low', 'range_high'],
} as const;

const assumption = { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, value: { type: 'string' }, kind: { type: 'string', enum: ['real_world_data', 'simulation_assumption', 'calculated_value'] } }, required: ['label', 'value', 'kind'] } as const;

const inputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' },
    explanation: { type: 'string', description: 'Plain-language explanation of the proposed structure, the research basis, and key assumptions. 2–6 sentences.' },
    objects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['custom_asset', 'recurring_expense', 'one_time_expense', 'staff', 'project', 'storage_location'] },
          name: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string', description: `Asset category for custom_asset (one of ${CATEGORIES.join(', ')}) or expense category (one of ${EXPENSE_CATEGORIES.join(', ')}). Empty string when not applicable.` },
          amount: sourced,
          interval: { type: 'string', enum: [...INTERVALS, ''], description: 'For recurring_expense. Empty otherwise.' },
          annual_value_change_pct: { type: 'number', description: 'custom_asset only: expected annual appreciation (+) or depreciation (−) in percent. 0 otherwise.' },
          duration_months: { type: 'integer', description: 'project only. 0 otherwise.' },
          capacity: { type: 'integer', description: 'storage_location only (number of vehicles/items). 0 otherwise.' },
          attached_recurring: {
            type: 'array', description: 'custom_asset only: ongoing costs of owning this specific asset.',
            items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, category: { type: 'string', enum: EXPENSE_CATEGORIES }, annual_amount: { type: 'number' }, source_label: { type: 'string' } }, required: ['name', 'category', 'annual_amount', 'source_label'] },
          },
          assumptions: { type: 'array', items: assumption },
        },
        required: ['kind', 'name', 'description', 'category', 'amount', 'interval', 'annual_value_change_pct', 'duration_months', 'capacity', 'attached_recurring', 'assumptions'],
      },
    },
  },
  required: ['title', 'explanation', 'objects'],
} as const;

type ToolInput = {
  title: string; explanation: string;
  objects: { kind: string; name: string; description: string; category: string; amount: { value: number; source_type: string; source_label: string; reference: string; range_low: number; range_high: number }; interval: string; annual_value_change_pct: number; duration_months: number; capacity: number; attached_recurring: { name: string; category: string; annual_amount: number; source_label: string }[]; assumptions: { label: string; value: string; kind: string }[] }[];
};

function systemPrompt(state: SimulationState): string {
  const m = computeMetrics(state);
  const c = state.profile.currency;
  const props = Object.values(state.assets).filter((a) => a.status === 'owned' && a.details.kind === 'property').map((a) => `${a.name} (${a.id})`).join('; ') || 'none';
  return [
    'You are a specialist in a fictional wealth-simulation app. The user runs a simulated ultra-high-net-worth life. Nothing here is financial advice and no money is real.',
    `Simulated date: ${state.currentDate}. Location: ${state.profile.location}. Currency: ${c}. Net worth ${formatMoney(m.netWorth, c, true)}, cash ${formatMoney(m.cash, c, true)}, annual lifestyle burn ${formatMoney(m.annualLifestyleBurn, c, true)}. Owned properties: ${props}.`,
    'Your job: turn the user\'s request into a structure made ONLY of the financial primitives exposed by the propose_financial_objects tool. You cannot change balances, post transactions, or invent accounting rules; the app previews and the user confirms before anything is committed.',
    'Method: identify what the request really involves; use web search when a current price, salary or cost range matters and you don\'t know it; account for geography and employer overhead (the app adds 22% to staff salaries automatically, so give BASE salary); prefer realistic ranges with a rounded working value inside the range; label every number with its source honestly (retrieved_real_world only when you actually consulted a source, else calculated_estimate); list assumptions explicitly.',
    'Break composite requests into pieces, e.g. "keep three horses" → 3 custom_asset objects (each with boarding, vet, insurance as attached_recurring) + one one_time_expense for tack. "Build a wine cellar" → one project attached conceptually to a property (state which in the description) with a cost range. "Charter a helicopter every Friday" → one recurring_expense.',
    'Always call propose_financial_objects exactly once with the full structure when the request is actionable. If the request is a question rather than an instruction, answer in text without calling the tool. Keep text replies concise.',
  ].join('\n');
}

export async function llmRespond(state: SimulationState, userText: string, history: { role: 'user' | 'assistant'; text: string }[]): Promise<AssistantReply | null> {
  const cfg = getLLMConfig();
  if (!cfg.apiKey) return null;
  const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.filter((h) => h.text.trim()).map((h) => ({ role: h.role, content: h.text }) as Anthropic.Beta.BetaMessageParam),
    { role: 'user', content: userText },
  ];
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: systemPrompt(state), cache_control: { type: 'ephemeral' } }],
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
        { name: 'propose_financial_objects', description: 'Propose the simulation objects that implement the user\'s request. Call exactly once with the complete structure.', input_schema: inputSchema as unknown as Anthropic.Beta.BetaTool['input_schema'], strict: true },
      ],
      tool_choice: { type: 'auto' },
      messages,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { assistantId: 'cfo', text: 'The AI API key was rejected. Check it in Settings.' };
    if (e instanceof Anthropic.RateLimitError) return { assistantId: 'cfo', text: 'The AI service is rate-limited right now. Try again in a moment.' };
    if (e instanceof Anthropic.APIError) return { assistantId: 'cfo', text: `AI request failed (${e.status}): ${e.message}` };
    return { assistantId: 'cfo', text: `AI request failed: ${(e as Error).message}` };
  }
  if (response.stop_reason === 'refusal') return { assistantId: 'cfo', text: 'The AI assistant declined that request.' };
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'propose_financial_objects');
  if (!call) return { assistantId: pick(userText), text: text || 'I could not turn that into a concrete structure. Try being more specific about what you want to own, hire, build, or pay for.' };
  const input = call.input as ToolInput;
  try {
    const primitives = toPrimitives(input, state);
    const proposal = newProposal(state, { title: input.title, explanation: input.explanation, primitives, assumptions: input.objects.flatMap((o) => o.assumptions.map(toAssumption)), createdBy: 'llm', assistantId: pick(userText) });
    return { assistantId: proposal.assistantId!, text: `${input.explanation}\n\nReview the ${primitives.length} proposed object${primitives.length > 1 ? 's' : ''} and confirm to commit.`, proposal };
  } catch (e) {
    return { assistantId: 'cfo', text: `The AI proposed something the engine can't represent: ${(e as Error).message}` };
  }
}

function toAssumption(a: { label: string; value: string; kind: string }): Assumption {
  return { key: a.label, label: a.label, value: a.value, kind: (['real_world_data', 'simulation_assumption', 'calculated_value'].includes(a.kind) ? a.kind : 'simulation_assumption') as Assumption['kind'] };
}

function src(a: ToolInput['objects'][number]['amount']) {
  const type = (SOURCE_TYPES.includes(a.source_type) ? a.source_type : 'calculated_estimate') as 'retrieved_real_world' | 'calculated_estimate' | 'market_estimate';
  return { value: Math.max(0, a.value), source: { type, label: a.source_label, reference: a.reference || undefined, retrievedOn: new Date().toISOString().slice(0, 10), range: a.range_high > 0 ? { low: a.range_low, high: a.range_high } : undefined, confidence: type === 'retrieved_real_world' ? 0.8 : 0.5 } };
}

/** Maps the LLM's constrained output onto engine primitives, rejecting anything outside the allowed sets. */
function toPrimitives(input: ToolInput, state: SimulationState): Primitive[] {
  if (!input.objects.length) throw new Error('no objects proposed');
  if (input.objects.length > 40) throw new Error('too many objects');
  const out: Primitive[] = [];
  const firstProperty = Object.values(state.assets).find((a) => a.status === 'owned' && a.details.kind === 'property');
  for (const o of input.objects) {
    if (!Number.isFinite(o.amount.value) || o.amount.value < 0) throw new Error(`invalid amount for ${o.name}`);
    const amount = src(o.amount);
    const assumptions = o.assumptions.map(toAssumption);
    const expCat = (EXPENSE_CATEGORIES.includes(o.category) ? o.category : 'custom') as import('../engine').ExpenseCategory;
    switch (o.kind) {
      case 'recurring_expense':
        out.push({ kind: 'recurring_expense', name: o.name, category: expCat, amount, interval: (INTERVALS.includes(o.interval) ? o.interval : 'monthly') as import('../engine').RecurrenceInterval, assumptions });
        break;
      case 'one_time_expense':
        out.push({ kind: 'one_time_expense', name: o.name, category: expCat, amount, assumptions });
        break;
      case 'staff':
        out.push({ kind: 'staff', role: o.name, baseSalary: amount, overheadRate: 0.22, assumptions });
        break;
      case 'project':
        out.push({ kind: 'project', input: { name: o.name, description: o.description, estimatedCost: amount, costRange: amount.source.range, durationMonths: Math.max(1, Math.min(60, o.duration_months || 6)), contingencyRate: 0.15 }, assetRef: /property|house|home|residence|estate|apartment|penthouse/i.test(o.description) ? firstProperty?.id : undefined });
        break;
      case 'storage_location':
        out.push({ kind: 'storage_location', name: o.name, storageKind: /hangar/i.test(o.name) ? 'hangar' : /marina|berth|dock/i.test(o.name) ? 'marina' : /warehouse/i.test(o.name) ? 'warehouse' : 'rented_garage', capacity: Math.max(1, o.capacity || 1), monthlyRent: (INTERVALS.includes(o.interval) && o.interval === 'annual') ? amount.value / 12 : amount.value });
        break;
      case 'custom_asset': {
        const category = (CATEGORIES.includes(o.category) ? o.category : 'custom_physical') as import('../engine').AssetCategory;
        const rate = Math.max(-0.5, Math.min(0.3, (o.annual_value_change_pct || 0) / 100));
        out.push({ kind: 'custom_asset', ref: o.name, name: o.name, description: o.description, category, value: amount, valueRule: { annualRate: rate, annualVolatility: 0.05, source: { type: 'calculated_estimate', label: 'AI assistant assumption' } }, storageLocationId: null, assumptions, recurring: o.attached_recurring.map((r) => ({ name: r.name, category: (EXPENSE_CATEGORIES.includes(r.category) ? r.category : 'custom') as import('../engine').ExpenseCategory, amount: Math.max(0, r.annual_amount) / 12, interval: 'monthly' as const, source: { type: 'calculated_estimate' as const, label: r.source_label } })) });
        break;
      }
      default:
        throw new Error(`unknown object kind ${o.kind}`);
    }
  }
  return out;
}

function pick(text: string): string {
  const t = text.toLowerCase();
  const id = /car|garage|vehicle/.test(t) ? 'auto' : /house|property|renovat|cellar|build|garden/.test(t) ? 'realestate' : /invest|fund|stock/.test(t) ? 'invest' : /business|company/.test(t) ? 'business' : /storage|warehouse|maintenance/.test(t) ? 'property' : /hire|chef|staff|charter|horse|event|party|travel|club/.test(t) ? 'lifestyle' : 'cfo';
  return ASSISTANTS.find((a) => a.id === id)!.id;
}
