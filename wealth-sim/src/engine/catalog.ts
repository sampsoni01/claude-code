import type { AssetCategory, AssetDetails, Money, SourceInfo } from './types';

/**
 * Built-in reference catalog. These are convenience reference values
 * (approximate list prices / typical ranges as of the reference date), NOT
 * live market prices. Every entry is tagged builtin_reference so the UI can
 * show that. Users and assistants can always create custom items.
 */
export interface CatalogItem {
  id: string;
  name: string;
  category: AssetCategory;
  price: Money;
  range?: { low: Money; high: Money };
  details: AssetDetails;
  costOptions?: { squareFeet?: number; isCondo?: boolean; annualFlightHours?: number; lengthMeters?: number; annualRate?: number };
  description?: string;
  tags: string[];
}

const REF = '2026 reference';
export const CATALOG_SOURCE: SourceInfo = { type: 'builtin_reference', label: `Built-in reference value (${REF})`, retrievedOn: '2026-01-01', confidence: 0.7 };

const car = (id: string, make: string, model: string, year: number, price: number, low: number, high: number, tags: string[] = [], annualRate?: number): CatalogItem => ({
  id, name: `${year} ${make} ${model}`, category: 'vehicle', price, range: { low, high }, details: { kind: 'vehicle', vehicle: { make, model, year, bodyType: 'car' } }, tags: ['car', ...tags], costOptions: annualRate != null ? { annualRate } : undefined,
});

export const CATALOG: CatalogItem[] = [
  // Cars
  car('car_911_turbo_s', 'Porsche', '911 Turbo S', 2026, 245_000, 235_000, 275_000, ['sports']),
  car('car_911_gt3', 'Porsche', '911 GT3', 2026, 225_000, 215_000, 260_000, ['sports']),
  car('car_ferrari_12c', 'Ferrari', '12Cilindri', 2026, 470_000, 440_000, 520_000, ['exotic']),
  car('car_ferrari_sf90', 'Ferrari', 'SF90 XX Stradale', 2026, 900_000, 850_000, 1_000_000, ['exotic']),
  car('car_lambo_revuelto', 'Lamborghini', 'Revuelto', 2026, 610_000, 580_000, 680_000, ['exotic']),
  car('car_mclaren_750s', 'McLaren', '750S', 2026, 330_000, 320_000, 380_000, ['exotic']),
  car('car_bugatti_tourbillon', 'Bugatti', 'Tourbillon', 2027, 4_100_000, 3_900_000, 4_500_000, ['hypercar'], 0.02),
  car('car_rr_cullinan', 'Rolls-Royce', 'Cullinan Series II', 2026, 420_000, 400_000, 500_000, ['luxury', 'suv']),
  car('car_rr_phantom', 'Rolls-Royce', 'Phantom', 2026, 520_000, 480_000, 650_000, ['luxury']),
  car('car_bentley_bentayga', 'Bentley', 'Bentayga EWB', 2026, 260_000, 240_000, 320_000, ['luxury', 'suv']),
  car('car_mercedes_g63', 'Mercedes-AMG', 'G 63', 2026, 190_000, 180_000, 230_000, ['suv']),
  car('car_range_rover_sv', 'Range Rover', 'SV', 2026, 200_000, 180_000, 240_000, ['suv']),
  car('car_tesla_model_s', 'Tesla', 'Model S Plaid', 2026, 100_000, 95_000, 110_000, ['ev']),
  car('car_bmw_m5', 'BMW', 'M5', 2026, 125_000, 120_000, 145_000, ['sedan']),
  car('car_aston_vanquish', 'Aston Martin', 'Vanquish', 2026, 430_000, 420_000, 480_000, ['exotic']),
  car('car_f40', 'Ferrari', 'F40', 1991, 3_200_000, 2_800_000, 3_800_000, ['collector'], 0.04),
  car('car_250gto', 'Ferrari', '250 GTO', 1962, 50_000_000, 40_000_000, 70_000_000, ['collector'], 0.05),
  // Real estate
  { id: 're_tribeca_penthouse', name: 'Tribeca penthouse', category: 'real_estate', price: 28_000_000, range: { low: 20_000_000, high: 40_000_000 }, details: { kind: 'property', property: { address: 'Tribeca, New York, NY', propertyType: 'penthouse', use: 'primary_residence', squareFeet: 6_500, bedrooms: 5, bathrooms: 5.5, garageCapacity: 2, parkingSpaces: 2, storageCapacity: 30, annualPropertyTaxRate: 0.009 } }, costOptions: { squareFeet: 6_500, isCondo: true }, tags: ['nyc', 'penthouse'] },
  { id: 're_bel_air_estate', name: 'Bel Air estate', category: 'real_estate', price: 45_000_000, range: { low: 30_000_000, high: 80_000_000 }, details: { kind: 'property', property: { address: 'Bel Air, Los Angeles, CA', propertyType: 'estate', use: 'primary_residence', squareFeet: 14_000, bedrooms: 8, bathrooms: 11, garageCapacity: 10, parkingSpaces: 20, storageCapacity: 80, annualPropertyTaxRate: 0.0115 } }, costOptions: { squareFeet: 14_000 }, tags: ['la', 'estate'] },
  { id: 're_miami_waterfront', name: 'Miami Beach waterfront villa', category: 'real_estate', price: 32_000_000, range: { low: 20_000_000, high: 60_000_000 }, details: { kind: 'property', property: { address: 'Star Island, Miami Beach, FL', propertyType: 'villa', use: 'vacation_residence', squareFeet: 11_000, bedrooms: 7, bathrooms: 9, garageCapacity: 6, parkingSpaces: 10, storageCapacity: 40, annualPropertyTaxRate: 0.0105 } }, costOptions: { squareFeet: 11_000 }, tags: ['miami', 'waterfront'] },
  { id: 're_london_townhouse', name: 'Belgravia townhouse', category: 'real_estate', price: 19_000_000, range: { low: 12_000_000, high: 35_000_000 }, details: { kind: 'property', property: { address: 'Belgravia, London', propertyType: 'townhouse', use: 'vacation_residence', squareFeet: 7_200, bedrooms: 6, bathrooms: 6, garageCapacity: 2, parkingSpaces: 2, storageCapacity: 30, annualPropertyTaxRate: 0.002 } }, costOptions: { squareFeet: 7_200 }, tags: ['london'] },
  { id: 're_aspen_chalet', name: 'Aspen ski chalet', category: 'real_estate', price: 24_000_000, range: { low: 15_000_000, high: 50_000_000 }, details: { kind: 'property', property: { address: 'Red Mountain, Aspen, CO', propertyType: 'chalet', use: 'vacation_residence', squareFeet: 9_000, bedrooms: 6, bathrooms: 7, garageCapacity: 4, parkingSpaces: 6, storageCapacity: 30, annualPropertyTaxRate: 0.006 } }, costOptions: { squareFeet: 9_000 }, tags: ['aspen', 'ski'] },
  { id: 're_hamptons', name: 'Southampton oceanfront estate', category: 'real_estate', price: 38_000_000, range: { low: 25_000_000, high: 70_000_000 }, details: { kind: 'property', property: { address: 'Meadow Lane, Southampton, NY', propertyType: 'estate', use: 'vacation_residence', squareFeet: 12_000, bedrooms: 8, bathrooms: 10, garageCapacity: 6, parkingSpaces: 12, storageCapacity: 50, annualPropertyTaxRate: 0.007 } }, costOptions: { squareFeet: 12_000 }, tags: ['hamptons'] },
  { id: 're_dubai_palm', name: 'Palm Jumeirah signature villa', category: 'real_estate', price: 22_000_000, range: { low: 12_000_000, high: 45_000_000 }, details: { kind: 'property', property: { address: 'Palm Jumeirah, Dubai', propertyType: 'villa', use: 'vacation_residence', squareFeet: 13_000, bedrooms: 7, bathrooms: 8, garageCapacity: 6, parkingSpaces: 8, storageCapacity: 40, annualPropertyTaxRate: 0 } }, costOptions: { squareFeet: 13_000 }, tags: ['dubai'] },
  { id: 're_rental_building', name: 'Brooklyn rental building (12 units)', category: 'real_estate', price: 9_500_000, range: { low: 7_000_000, high: 14_000_000 }, details: { kind: 'property', property: { address: 'Park Slope, Brooklyn, NY', propertyType: 'multifamily', use: 'rental_property', squareFeet: 14_000, garageCapacity: 0, parkingSpaces: 0, storageCapacity: 0, monthlyRentIncome: 62_000, annualPropertyTaxRate: 0.012 } }, costOptions: { squareFeet: 14_000, isCondo: false }, tags: ['rental', 'income'] },
  { id: 're_montana_ranch', name: 'Montana ranch (2,400 acres)', category: 'land', price: 28_000_000, range: { low: 15_000_000, high: 60_000_000 }, details: { kind: 'property', property: { address: 'Paradise Valley, MT', propertyType: 'ranch', use: 'land', squareFeet: 8_000, bedrooms: 6, bathrooms: 6, garageCapacity: 8, parkingSpaces: 20, storageCapacity: 60, annualPropertyTaxRate: 0.004 } }, tags: ['ranch', 'land'] },
  // Aircraft
  { id: 'air_g700', name: 'Gulfstream G700', category: 'aircraft', price: 78_000_000, range: { low: 72_000_000, high: 82_000_000 }, details: { kind: 'aircraft', aircraft: { manufacturer: 'Gulfstream', model: 'G700', year: 2026, annualFlightHours: 350 } }, costOptions: { annualFlightHours: 350 }, tags: ['jet', 'ultra-long-range'] },
  { id: 'air_g650', name: 'Gulfstream G650ER (pre-owned)', category: 'aircraft', price: 48_000_000, range: { low: 38_000_000, high: 58_000_000 }, details: { kind: 'aircraft', aircraft: { manufacturer: 'Gulfstream', model: 'G650ER', year: 2020, annualFlightHours: 350 } }, costOptions: { annualFlightHours: 350 }, tags: ['jet'] },
  { id: 'air_global7500', name: 'Bombardier Global 7500', category: 'aircraft', price: 75_000_000, range: { low: 70_000_000, high: 80_000_000 }, details: { kind: 'aircraft', aircraft: { manufacturer: 'Bombardier', model: 'Global 7500', year: 2026, annualFlightHours: 350 } }, costOptions: { annualFlightHours: 350 }, tags: ['jet'] },
  { id: 'air_challenger', name: 'Bombardier Challenger 3500', category: 'aircraft', price: 27_000_000, range: { low: 25_000_000, high: 30_000_000 }, details: { kind: 'aircraft', aircraft: { manufacturer: 'Bombardier', model: 'Challenger 3500', year: 2026, annualFlightHours: 300 } }, costOptions: { annualFlightHours: 300 }, tags: ['jet', 'super-midsize'] },
  { id: 'air_phenom', name: 'Embraer Phenom 300E', category: 'aircraft', price: 11_500_000, range: { low: 10_500_000, high: 12_500_000 }, details: { kind: 'aircraft', aircraft: { manufacturer: 'Embraer', model: 'Phenom 300E', year: 2026, annualFlightHours: 250 } }, costOptions: { annualFlightHours: 250 }, tags: ['jet', 'light'] },
  { id: 'air_h145', name: 'Airbus H145 helicopter', category: 'aircraft', price: 11_000_000, range: { low: 9_500_000, high: 12_500_000 }, details: { kind: 'aircraft', aircraft: { manufacturer: 'Airbus', model: 'H145', year: 2026, annualFlightHours: 200 } }, costOptions: { annualFlightHours: 200 }, tags: ['helicopter'] },
  // Yachts
  { id: 'yacht_40m', name: '40m Sanlorenzo superyacht', category: 'yacht', price: 24_000_000, range: { low: 18_000_000, high: 32_000_000 }, details: { kind: 'yacht', yacht: { builder: 'Sanlorenzo', model: 'SD126', year: 2025, lengthMeters: 40 } }, costOptions: { lengthMeters: 40 }, tags: ['yacht'] },
  { id: 'yacht_60m', name: '60m Benetti superyacht', category: 'yacht', price: 65_000_000, range: { low: 50_000_000, high: 85_000_000 }, details: { kind: 'yacht', yacht: { builder: 'Benetti', model: 'Oasis 60', year: 2025, lengthMeters: 60 } }, costOptions: { lengthMeters: 60 }, tags: ['yacht'] },
  { id: 'yacht_90m', name: '90m Feadship (custom)', category: 'yacht', price: 250_000_000, range: { low: 180_000_000, high: 350_000_000 }, details: { kind: 'yacht', yacht: { builder: 'Feadship', model: 'Custom', year: 2026, lengthMeters: 90 } }, costOptions: { lengthMeters: 90 }, tags: ['yacht', 'gigayacht'] },
  { id: 'yacht_sport', name: '24m Riva sport yacht', category: 'yacht', price: 7_500_000, range: { low: 6_000_000, high: 9_500_000 }, details: { kind: 'yacht', yacht: { builder: 'Riva', model: '76 Perseo Super', year: 2026, lengthMeters: 24 } }, costOptions: { lengthMeters: 24 }, tags: ['yacht'] },
  // Art & collectibles
  { id: 'art_blue_chip', name: 'Blue-chip contemporary painting', category: 'art', price: 12_000_000, range: { low: 5_000_000, high: 40_000_000 }, details: { kind: 'generic', fields: { medium: 'Oil on canvas', era: 'Post-war / contemporary' } }, tags: ['art'] },
  { id: 'art_emerging', name: 'Emerging artist work', category: 'art', price: 250_000, range: { low: 50_000, high: 800_000 }, details: { kind: 'generic', fields: { medium: 'Mixed media' } }, tags: ['art'] },
  { id: 'art_sculpture', name: 'Monumental outdoor sculpture', category: 'art', price: 3_500_000, range: { low: 1_000_000, high: 10_000_000 }, details: { kind: 'generic', fields: { medium: 'Bronze' } }, tags: ['art', 'sculpture'] },
  { id: 'watch_nautilus', name: 'Patek Philippe Nautilus 5711 (secondary)', category: 'jewelry_watches', price: 140_000, range: { low: 110_000, high: 180_000 }, details: { kind: 'generic', fields: { brand: 'Patek Philippe' } }, costOptions: { annualRate: 0.01 }, tags: ['watch'] },
  { id: 'watch_rm', name: 'Richard Mille RM 11-03', category: 'jewelry_watches', price: 300_000, range: { low: 250_000, high: 400_000 }, details: { kind: 'generic', fields: { brand: 'Richard Mille' } }, costOptions: { annualRate: 0 }, tags: ['watch'] },
  { id: 'jewel_diamond', name: '10ct D-flawless diamond ring', category: 'jewelry_watches', price: 1_800_000, range: { low: 1_200_000, high: 3_000_000 }, details: { kind: 'generic', fields: { carats: 10, grade: 'D FL' } }, tags: ['jewelry'] },
  { id: 'coll_wine', name: 'Fine wine collection (500 bottles)', category: 'collectible', price: 900_000, range: { low: 300_000, high: 3_000_000 }, details: { kind: 'generic', fields: { bottles: 500 } }, costOptions: { annualRate: 0.05 }, tags: ['wine'] },
  { id: 'coll_horse', name: 'Thoroughbred racehorse', category: 'collectible', price: 750_000, range: { low: 200_000, high: 5_000_000 }, details: { kind: 'generic', fields: { breed: 'Thoroughbred' } }, costOptions: { annualRate: -0.10 }, tags: ['horse'] },
  // Businesses
  { id: 'biz_restaurant_group', name: 'Restaurant group (6 locations)', category: 'business', price: 18_000_000, range: { low: 12_000_000, high: 30_000_000 }, details: { kind: 'business', business: { industry: 'Hospitality', annualRevenue: 32_000_000, annualOperatingExpenses: 19_000_000, annualPayroll: 10_500_000, employees: 320, ownershipPct: 1, annualGrowthRate: 0.05, distributionRate: 0.6, valuationMultiple: 7, retainedEarnings: 0 } }, tags: ['business'] },
  { id: 'biz_saas', name: 'B2B software company (minority stake 20%)', category: 'business', price: 25_000_000, range: { low: 15_000_000, high: 50_000_000 }, details: { kind: 'business', business: { industry: 'Software', annualRevenue: 40_000_000, annualOperatingExpenses: 14_000_000, annualPayroll: 18_000_000, employees: 120, ownershipPct: 0.2, annualGrowthRate: 0.25, distributionRate: 0.1, valuationMultiple: 15, retainedEarnings: 0 } }, tags: ['business', 'tech'] },
  { id: 'biz_car_wash', name: 'Car wash chain (8 sites)', category: 'business', price: 22_000_000, range: { low: 15_000_000, high: 35_000_000 }, details: { kind: 'business', business: { industry: 'Consumer services', annualRevenue: 14_000_000, annualOperatingExpenses: 5_500_000, annualPayroll: 4_000_000, employees: 95, ownershipPct: 1, annualGrowthRate: 0.06, distributionRate: 0.7, valuationMultiple: 5, retainedEarnings: 0 } }, tags: ['business'] },
  { id: 'biz_vineyard', name: 'Napa vineyard & winery', category: 'business', price: 45_000_000, range: { low: 25_000_000, high: 90_000_000 }, details: { kind: 'business', business: { industry: 'Agriculture / luxury goods', annualRevenue: 12_000_000, annualOperatingExpenses: 6_000_000, annualPayroll: 4_500_000, employees: 60, ownershipPct: 1, annualGrowthRate: 0.03, distributionRate: 0.5, valuationMultiple: 20, retainedEarnings: 0 } }, tags: ['business', 'wine'] },
  { id: 'biz_sports_stake', name: 'Minority stake in a sports franchise (5%)', category: 'business', price: 150_000_000, range: { low: 80_000_000, high: 400_000_000 }, details: { kind: 'business', business: { industry: 'Sports & entertainment', annualRevenue: 600_000_000, annualOperatingExpenses: 250_000_000, annualPayroll: 300_000_000, employees: 900, ownershipPct: 0.05, annualGrowthRate: 0.08, distributionRate: 0.2, valuationMultiple: 40, retainedEarnings: 0 } }, tags: ['business', 'sports'] },
];

export function findCatalog(query: string): CatalogItem[] {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  return CATALOG.map((c) => {
    const hay = `${c.name} ${c.tags.join(' ')} ${c.category}`.toLowerCase();
    const score = q.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    return { c, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.c);
}

export function catalogById(id: string): CatalogItem | undefined { return CATALOG.find((c) => c.id === id); }

/** Reference roles and salary ranges for domestic/professional staff (annual base, simulation reference). */
export const STAFF_REFERENCE: Record<string, { role: string; low: Money; high: Money; typical: Money; notes: string }> = {
  chef: { role: 'Private chef', low: 120_000, high: 300_000, typical: 180_000, notes: 'Michelin-trained chefs command the top of the range; food budget is separate.' },
  michelin_chef: { role: 'Michelin-level private chef', low: 200_000, high: 400_000, typical: 260_000, notes: 'Top-tier; typically includes a sous chef in larger households.' },
  housekeeper: { role: 'Housekeeper', low: 55_000, high: 110_000, typical: 75_000, notes: 'Live-in arrangements add housing cost.' },
  estate_manager: { role: 'Estate manager', low: 150_000, high: 400_000, typical: 220_000, notes: 'Runs multiple properties and staff.' },
  personal_assistant: { role: 'Personal assistant', low: 90_000, high: 200_000, typical: 130_000, notes: '' },
  security: { role: 'Executive protection agent', low: 110_000, high: 250_000, typical: 150_000, notes: '24/7 coverage requires 4–5 agents.' },
  driver: { role: 'Chauffeur', low: 70_000, high: 140_000, typical: 95_000, notes: '' },
  nanny: { role: 'Nanny', low: 70_000, high: 180_000, typical: 100_000, notes: '' },
  groundskeeper: { role: 'Groundskeeper', low: 55_000, high: 100_000, typical: 70_000, notes: '' },
  trainer: { role: 'Private trainer', low: 80_000, high: 200_000, typical: 120_000, notes: '' },
  pilot: { role: 'Captain (pilot)', low: 180_000, high: 350_000, typical: 240_000, notes: '' },
  captain: { role: 'Yacht captain', low: 120_000, high: 300_000, typical: 180_000, notes: 'Scales with vessel length.' },
  art_manager: { role: 'Art collection manager / curator', low: 90_000, high: 220_000, typical: 140_000, notes: '' },
  historian: { role: 'Private historian / archivist', low: 80_000, high: 180_000, typical: 110_000, notes: '' },
  cfo: { role: 'Family office CFO', low: 300_000, high: 900_000, typical: 450_000, notes: '' },
  butler: { role: 'Butler / house manager', low: 90_000, high: 250_000, typical: 140_000, notes: '' },
};

/** Reference recurring services / memberships (annual). */
export const SERVICE_REFERENCE: Record<string, { name: string; category: import('./types').ExpenseCategory; low: Money; high: Money; typical: Money; interval: 'monthly' | 'annual'; notes: string }> = {
  golf_club: { name: 'Private golf club membership', category: 'membership', low: 30_000, high: 250_000, typical: 80_000, interval: 'annual', notes: 'Initiation fees at top clubs can exceed $500k; modeled as annual dues only.' },
  yacht_club: { name: 'Yacht club membership', category: 'membership', low: 10_000, high: 60_000, typical: 25_000, interval: 'annual', notes: '' },
  private_members_club: { name: 'Private members club', category: 'membership', low: 5_000, high: 50_000, typical: 15_000, interval: 'annual', notes: '' },
  concierge_medicine: { name: 'Concierge medicine', category: 'health', low: 20_000, high: 150_000, typical: 50_000, interval: 'annual', notes: '' },
  private_school: { name: 'Private school tuition (per child)', category: 'education', low: 40_000, high: 90_000, typical: 65_000, interval: 'annual', notes: '' },
  jet_card: { name: 'Jet card (100 hours)', category: 'travel', low: 700_000, high: 1_800_000, typical: 1_100_000, interval: 'annual', notes: '' },
  helicopter_charter_weekly: { name: 'Weekly helicopter charter', category: 'travel', low: 300_000, high: 900_000, typical: 520_000, interval: 'annual', notes: '~$10k per round trip × 52.' },
  stable_boarding: { name: 'Full-service stable boarding (per horse)', category: 'custom', low: 24_000, high: 60_000, typical: 36_000, interval: 'annual', notes: 'Includes feed and turnout; vet and farrier separate.' },
  vet_care: { name: 'Veterinary & farrier (per horse)', category: 'custom', low: 6_000, high: 20_000, typical: 10_000, interval: 'annual', notes: '' },
  horse_insurance: { name: 'Equine mortality insurance (per horse)', category: 'insurance', low: 3_000, high: 15_000, typical: 6_000, interval: 'annual', notes: '~3% of value.' },
  wine_storage: { name: 'Professional wine storage', category: 'storage', low: 5_000, high: 40_000, typical: 12_000, interval: 'annual', notes: '' },
  car_storage: { name: 'Climate-controlled vehicle storage (per car)', category: 'storage', low: 6_000, high: 18_000, typical: 9_600, interval: 'annual', notes: '' },
  warehouse_lease: { name: 'Warehouse lease for collection (20 cars)', category: 'storage', low: 120_000, high: 400_000, typical: 220_000, interval: 'annual', notes: '' },
  security_24_7: { name: '24/7 residential security detail', category: 'security', low: 600_000, high: 2_000_000, typical: 950_000, interval: 'annual', notes: '4–5 agents rotating.' },
  travel_luxury: { name: 'Luxury travel budget', category: 'travel', low: 250_000, high: 3_000_000, typical: 800_000, interval: 'annual', notes: '' },
  wardrobe: { name: 'Wardrobe & luxury shopping', category: 'shopping', low: 100_000, high: 2_000_000, typical: 350_000, interval: 'annual', notes: '' },
  dining: { name: 'Dining & entertainment', category: 'dining', low: 100_000, high: 1_000_000, typical: 250_000, interval: 'annual', notes: '' },
  charity: { name: 'Charitable giving', category: 'charity', low: 100_000, high: 50_000_000, typical: 1_000_000, interval: 'annual', notes: '' },
  wellness: { name: 'Wellness, spa & longevity', category: 'health', low: 50_000, high: 500_000, typical: 150_000, interval: 'annual', notes: '' },
};
