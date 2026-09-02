import type { SimulationState, Asset, AssetCategory, AssetDetails, ValueRule, Liquidity, Id, Money, SourceInfo, Assumption, ISODate } from './types';
import { nextId } from './ids';
import { round2 } from './money';
import { postTransaction } from './ledger';
import { ValidationError } from './errors';
import { createStorageLocation } from './storage';

export interface AssetInput {
  name: string;
  description?: string;
  category: AssetCategory;
  details: AssetDetails;
  value: Money;
  costBasis?: Money;
  purchasePrice?: Money;
  purchaseDate?: ISODate;
  valueRule: ValueRule;
  liquidity: Liquidity;
  storageLocationId?: Id | null;
  attachedToAssetId?: Id;
  resaleAllowed?: boolean;
  assumptions?: Assumption[];
  tags?: string[];
  notes?: string;
  createdBy?: Asset['createdBy'];
}

/**
 * Creates an asset record with currentValue = 0. The caller MUST post a ledger
 * transaction with an 'asset' posting to give it value (purchase, opening
 * balance...). This keeps "no balance changes without a ledger entry" true.
 */
export function createAssetRecord(state: SimulationState, input: AssetInput): Asset {
  if (!Number.isFinite(input.value) || input.value < 0) throw new ValidationError(`Asset value invalid for ${input.name}`);
  const id = nextId(state, 'ast');
  const asset: Asset = {
    id,
    name: input.name,
    description: input.description,
    category: input.category,
    liquidity: input.liquidity,
    details: input.details,
    currentValue: 0,
    costBasis: round2(input.costBasis ?? input.purchasePrice ?? input.value),
    purchasePrice: round2(input.purchasePrice ?? input.value),
    purchaseDate: input.purchaseDate ?? state.currentDate,
    valueRule: input.valueRule,
    storageLocationId: input.storageLocationId ?? null,
    attachedToAssetId: input.attachedToAssetId,
    liabilityIds: [],
    recurringIds: [],
    status: 'owned',
    resaleAllowed: input.resaleAllowed ?? true,
    assumptions: input.assumptions ?? [],
    tags: input.tags ?? [],
    notes: input.notes,
    createdBy: input.createdBy ?? 'user',
    createdOn: state.currentDate,
  };
  state.assets[id] = asset;
  // Properties automatically provide storage.
  if (input.details.kind === 'property') {
    const p = input.details.property;
    if (p.garageCapacity > 0) createStorageLocation(state, { name: `${input.name} garage`, kind: 'property_garage', capacity: p.garageCapacity, propertyId: id, createdBy: 'engine' });
    if (p.storageCapacity > 0) createStorageLocation(state, { name: `${input.name} storage`, kind: 'property_storage', capacity: p.storageCapacity, propertyId: id, createdBy: 'engine' });
  }
  return asset;
}

/** Records a valuation change through the ledger. Historical purchase data is never touched. */
export function revalueAsset(state: SimulationState, assetId: Id, newValue: Money, source: SourceInfo, externalEstimate?: Money, reason?: string): void {
  const asset = state.assets[assetId];
  if (!asset || asset.status !== 'owned') throw new ValidationError(`Asset ${assetId} not owned`);
  const nv = round2(Math.max(0, newValue));
  const delta = round2(nv - asset.currentValue);
  const prev = asset.currentValue;
  if (delta !== 0) {
    const txn = postTransaction(state, {
      type: 'valuation',
      category: 'valuation',
      description: reason ?? `Revalued ${asset.name}: ${prev.toFixed(0)} → ${nv.toFixed(0)} (${source.label ?? source.type})`,
      postings: [
        { kind: 'asset', assetId, amount: delta },
        { kind: 'valuation', assetId, amount: delta },
      ],
      assetId,
      createdBy: source.type === 'user_override' || source.type === 'user_entered' ? 'user' : 'engine',
    });
    state.valuations.push({ id: nextId(state, 'val'), assetId, date: state.currentDate, previousValue: prev, newValue: nv, source, transactionId: txn.id });
  }
  asset.lastValuation = { date: state.currentDate, source, externalEstimate };
}

export function updateValueRule(state: SimulationState, assetId: Id, rule: Partial<ValueRule>, note?: string): void {
  const a = state.assets[assetId];
  if (!a) throw new ValidationError('Unknown asset');
  a.valueRule = { ...a.valueRule, ...rule, source: { type: 'user_override', label: note ?? 'User override of value rule' } };
  a.assumptions.push({ key: 'value_rule_override', label: 'Value rule overridden', value: `${((rule.annualRate ?? a.valueRule.annualRate) * 100).toFixed(1)}%/yr`, kind: 'user_override' });
}

export function attachLiability(state: SimulationState, assetId: Id, liabilityId: Id): void {
  const a = state.assets[assetId];
  if (a && !a.liabilityIds.includes(liabilityId)) a.liabilityIds.push(liabilityId);
}

export function assetsByCategory(state: SimulationState): Record<AssetCategory, Asset[]> {
  const out = {} as Record<AssetCategory, Asset[]>;
  for (const a of Object.values(state.assets)) {
    if (a.status !== 'owned') continue;
    (out[a.category] ??= []).push(a);
  }
  return out;
}

export function assetGain(a: Asset): Money {
  return round2(a.currentValue - a.costBasis);
}

/** Total recurring annual carrying cost attached to an asset (expenses + loan interest is separate). */
export function annualCarryingCost(state: SimulationState, assetId: Id): Money {
  let s = 0;
  for (const rid of state.assets[assetId]?.recurringIds ?? []) {
    const r = state.recurring[rid];
    if (!r || r.status !== 'active' || r.direction !== 'expense') continue;
    const per = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, annual: 1 }[r.interval];
    s += r.amount.value * per;
  }
  for (const lid of state.assets[assetId]?.liabilityIds ?? []) {
    const l = state.liabilities[lid];
    if (l && l.status === 'active') s += l.balance * l.annualRate;
  }
  return round2(s);
}
