import { createSimulation, type SimulationConfig } from '../src/engine';

export function baseConfig(over: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    name: 'Test User',
    location: 'New York, NY',
    taxJurisdiction: 'US-NY',
    startDate: '2026-01-01',
    annualSalary: 3_000_000,
    startingCash: 20_000_000,
    investments: [{ name: 'Index ETF portfolio', value: 30_000_000, assetClass: 'etf', expectedAnnualReturn: 0.07, annualVolatility: 0, dividendYield: 0.02 }],
    properties: [{ name: 'Tribeca loft', value: 15_000_000, address: 'Tribeca', propertyType: 'penthouse', use: 'primary_residence', squareFeet: 5000, garageCapacity: 2, mortgageBalance: 5_000_000, mortgageRate: 0.06, mortgageMonthsRemaining: 300 }],
    realismEvents: false,
    seed: 42,
    ...over,
  };
}

export function makeSim(over: Partial<SimulationConfig> = {}) {
  return createSimulation(baseConfig(over));
}
