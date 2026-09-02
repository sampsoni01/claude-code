import type { SimulationState, PlannedEvent, EventLineItem, Money, Id, ISODate, SourceInfo } from './types';
import { round2, roundEstimate } from './money';
import { nextId } from './ids';
import { compareDates } from './dates';
import { postTransaction } from './ledger';
import { ValidationError } from './errors';

export type EventTier = 'standard' | 'premium' | 'ultra';

export interface EventSpec {
  name: string;
  kind: string;
  date?: ISODate;
  location: string;
  guestCount: number;
  venueTier: EventTier;
  foodTier: EventTier;
  entertainment: 'none' | 'dj' | 'band' | 'headline_act';
  security: boolean;
  transportation: boolean;
  decorTier: EventTier;
  production: boolean;
  custom?: { label: string; amount: Money }[];
  accountId?: Id;
}

const SA = (label: string): SourceInfo => ({ type: 'calculated_estimate', label });

/** Builds a line-item estimate from event variables. All per-guest figures are simulation assumptions. */
export function estimateEvent(spec: EventSpec): { lineItems: EventLineItem[]; total: Money } {
  const g = Math.max(1, spec.guestCount);
  const tier = { standard: 1, premium: 2.2, ultra: 5 } as const;
  const items: EventLineItem[] = [];
  const venue = roundEstimate(Math.max(15_000, g * 150) * tier[spec.venueTier], 2);
  items.push({ label: `Venue (${spec.venueTier})`, amount: venue, source: SA('$150/guest base, min $15k, × tier') });
  const food = roundEstimate(g * { standard: 250, premium: 550, ultra: 1_400 }[spec.foodTier], 2);
  items.push({ label: `Food & beverage (${spec.foodTier})`, amount: food, source: SA('Per-guest catering assumption') });
  const ent = { none: 0, dj: 8_000, band: 60_000, headline_act: 1_000_000 }[spec.entertainment];
  if (ent) items.push({ label: `Entertainment (${spec.entertainment.replace('_', ' ')})`, amount: ent, source: SA('Reference booking fee') });
  if (spec.security) items.push({ label: 'Security', amount: roundEstimate(Math.max(5_000, g * 60), 2), source: SA('$60/guest, min $5k') });
  if (spec.transportation) items.push({ label: 'Guest transportation', amount: roundEstimate(g * 120, 2), source: SA('$120/guest') });
  const decor = roundEstimate(Math.max(10_000, g * { standard: 80, premium: 250, ultra: 900 }[spec.decorTier]), 2);
  items.push({ label: `Decor & florals (${spec.decorTier})`, amount: decor, source: SA('Per-guest decor assumption') });
  if (spec.production) items.push({ label: 'Production (staging, lighting, AV)', amount: roundEstimate(Math.max(25_000, g * 200), 2), source: SA('$200/guest, min $25k') });
  items.push({ label: 'Staffing & planner', amount: roundEstimate(Math.max(15_000, g * 90), 2), source: SA('$90/guest, min $15k') });
  for (const c of spec.custom ?? []) items.push({ label: c.label, amount: round2(c.amount), source: { type: 'user_entered' } });
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  items.push({ label: 'Service charges & gratuities', amount: round2(subtotal * 0.18), source: SA('18% of subtotal') });
  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  return { lineItems: items, total };
}

export function createEvent(state: SimulationState, spec: EventSpec): PlannedEvent {
  const { lineItems, total } = estimateEvent(spec);
  const id = nextId(state, 'evt');
  const ev: PlannedEvent = {
    id,
    name: spec.name,
    kind: spec.kind,
    date: spec.date ?? state.currentDate,
    location: spec.location,
    guestCount: spec.guestCount,
    lineItems,
    totalCost: total,
    status: 'planned',
    accountId: spec.accountId ?? state.settings.defaultAccountId,
    assumptions: lineItems.map((l) => ({ key: l.label, label: l.label, value: l.amount, kind: l.source.type === 'user_entered' ? 'user_override' : 'calculated_value', source: l.source })),
    createdOn: state.currentDate,
  };
  state.events[id] = ev;
  processEvent(state, ev);
  return ev;
}

/** Pays for an event when its date arrives. */
export function processEvent(state: SimulationState, ev: PlannedEvent): void {
  if (ev.status !== 'planned' || compareDates(ev.date, state.currentDate) > 0) return;
  const txn = postTransaction(state, {
    date: ev.date,
    type: 'event',
    category: 'event',
    description: `${ev.name} (${ev.guestCount} guests, ${ev.location})`,
    postings: [
      { kind: 'cash', accountId: ev.accountId, amount: -ev.totalCost },
      { kind: 'expense', category: 'event', amount: ev.totalCost },
    ],
    eventId: ev.id,
    idempotencyKey: `evt:${ev.id}`,
  });
  ev.status = 'held';
  ev.transactionId = txn.id;
  state.timeline.push({ id: nextId(state, 'tl'), date: ev.date, kind: 'event', title: `Hosted ${ev.name}`, amount: ev.totalCost, transactionId: txn.id });
}

export function cancelEvent(state: SimulationState, eventId: Id): void {
  const ev = state.events[eventId];
  if (!ev) throw new ValidationError('Unknown event');
  if (ev.status !== 'planned') throw new ValidationError('Only planned events can be cancelled');
  ev.status = 'cancelled';
}
