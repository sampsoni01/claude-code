import type { SimulationState, StorageLocation, StorageKind, AssetCategory, Id, Money } from './types';
import { nextId } from './ids';
import { ValidationError } from './errors';
import { createRecurring } from './recurring';

const VEHICLE_LIKE: AssetCategory[] = ['vehicle'];

export function defaultAccepts(kind: StorageKind): AssetCategory[] {
  switch (kind) {
    case 'property_garage': case 'rented_garage': case 'commercial_vehicle_storage': return VEHICLE_LIKE;
    case 'hangar': return ['aircraft'];
    case 'marina': return ['yacht'];
    case 'warehouse': return ['vehicle', 'art', 'collectible', 'furniture', 'luxury_goods', 'custom_physical'];
    case 'property_storage': return ['art', 'collectible', 'jewelry_watches', 'furniture', 'luxury_goods', 'custom_physical'];
    case 'custom': return ['vehicle', 'aircraft', 'yacht', 'art', 'collectible', 'jewelry_watches', 'furniture', 'luxury_goods', 'custom_physical'];
  }
}

export function occupancy(state: SimulationState, locationId: Id): number {
  return Object.values(state.assets).filter((a) => a.status === 'owned' && a.storageLocationId === locationId).length;
}

export function availableCapacity(state: SimulationState, locationId: Id): number {
  const loc = state.storage[locationId];
  if (!loc || loc.status !== 'active') return 0;
  return loc.capacity - occupancy(state, locationId);
}

export function locationsFor(state: SimulationState, category: AssetCategory): StorageLocation[] {
  return Object.values(state.storage).filter((l) => l.status === 'active' && l.accepts.includes(category));
}

/** Finds a location with free capacity for the asset category, preferring owned-property storage. */
export function findAvailableLocation(state: SimulationState, category: AssetCategory): StorageLocation | null {
  const candidates = locationsFor(state, category).filter((l) => availableCapacity(state, l.id) > 0);
  candidates.sort((a, b) => (a.propertyId ? 0 : 1) - (b.propertyId ? 0 : 1));
  return candidates[0] ?? null;
}

export function createStorageLocation(
  state: SimulationState,
  input: { name: string; kind: StorageKind; capacity: number; propertyId?: Id; accepts?: AssetCategory[]; monthlyRent?: Money; accountId?: Id; createdBy?: 'user' | 'assistant' | 'engine' },
): StorageLocation {
  if (input.capacity < 0) throw new ValidationError('Capacity cannot be negative');
  const id = nextId(state, 'stor');
  const loc: StorageLocation = {
    id,
    name: input.name,
    kind: input.kind,
    capacity: input.capacity,
    accepts: input.accepts ?? defaultAccepts(input.kind),
    propertyId: input.propertyId,
    status: 'active',
    createdOn: state.currentDate,
  };
  state.storage[id] = loc;
  if (input.monthlyRent && input.monthlyRent > 0) {
    const r = createRecurring(state, {
      name: `${input.name} rent`,
      direction: 'expense',
      category: 'storage',
      amount: { value: input.monthlyRent, source: { type: 'user_entered' } },
      interval: 'monthly',
      accountId: input.accountId ?? state.settings.defaultAccountId,
      storageLocationId: id,
      createdBy: input.createdBy ?? 'user',
    });
    loc.recurringId = r.id;
  }
  return loc;
}

/**
 * Moves a physical asset into a storage location. The asset can only ever be
 * in one place; capacity is enforced.
 */
export function assignStorage(state: SimulationState, assetId: Id, locationId: Id | null): void {
  const asset = state.assets[assetId];
  if (!asset) throw new ValidationError(`Unknown asset ${assetId}`);
  if (locationId === null) { asset.storageLocationId = null; return; }
  const loc = state.storage[locationId];
  if (!loc || loc.status !== 'active') throw new ValidationError(`Unknown or closed storage location ${locationId}`);
  if (!loc.accepts.includes(asset.category)) throw new ValidationError(`${loc.name} cannot store ${asset.category}`);
  if (asset.storageLocationId === locationId) return;
  if (availableCapacity(state, locationId) <= 0) {
    throw new ValidationError(`${loc.name} is full (${loc.capacity}/${loc.capacity})`);
  }
  asset.storageLocationId = locationId;
}

export function closeStorageLocation(state: SimulationState, locationId: Id): void {
  const loc = state.storage[locationId];
  if (!loc) throw new ValidationError('Unknown storage location');
  if (occupancy(state, locationId) > 0) throw new ValidationError('Storage location still has assets assigned');
  loc.status = 'closed';
  if (loc.recurringId && state.recurring[loc.recurringId]) {
    state.recurring[loc.recurringId].status = 'ended';
    state.recurring[loc.recurringId].endDate = state.currentDate;
  }
}

export function storageOptionsWhenFull(state: SimulationState, category: AssetCategory): string[] {
  const opts = ['Rent additional storage (creates a monthly storage expense)', 'Leave the asset unassigned for now'];
  const props = Object.values(state.assets).filter((a) => a.status === 'owned' && a.details.kind === 'property');
  if (props.length) opts.push('Expand an existing garage (project attached to the property)');
  const others = Object.values(state.assets).filter((a) => a.status === 'owned' && a.category === category);
  if (others.length) opts.push(`Sell or relocate one of your ${others.length} existing ${category.replace('_', ' ')} assets`);
  opts.push('Purchase another property with more capacity');
  return opts;
}
