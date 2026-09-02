import type { MarketScenario, MarketScenarioId } from './types';

export const SCENARIOS: Record<MarketScenarioId, MarketScenario> = {
  normal: { id: 'normal', name: 'Normal market', equityDrift: 0, bondDrift: 0, realEstateDrift: 0, privateDrift: 0, volatilityMultiplier: 1, inflation: 0.03, rateShift: 0, businessGrowthMultiplier: 1 },
  bull: { id: 'bull', name: 'Bull market', equityDrift: 0.08, bondDrift: 0.01, realEstateDrift: 0.03, privateDrift: 0.06, volatilityMultiplier: 0.9, inflation: 0.03, rateShift: -0.005, businessGrowthMultiplier: 1.4 },
  recession: { id: 'recession', name: 'Recession', equityDrift: -0.18, bondDrift: 0.02, realEstateDrift: -0.06, privateDrift: -0.12, volatilityMultiplier: 1.6, inflation: 0.02, rateShift: -0.01, businessGrowthMultiplier: 0.3 },
  high_inflation: { id: 'high_inflation', name: 'High inflation', equityDrift: -0.03, bondDrift: -0.06, realEstateDrift: 0.02, privateDrift: -0.02, volatilityMultiplier: 1.3, inflation: 0.08, rateShift: 0.03, businessGrowthMultiplier: 0.9 },
  real_estate_downturn: { id: 'real_estate_downturn', name: 'Real estate downturn', equityDrift: -0.02, bondDrift: 0.01, realEstateDrift: -0.15, privateDrift: -0.03, volatilityMultiplier: 1.2, inflation: 0.03, rateShift: 0.01, businessGrowthMultiplier: 0.9 },
  market_crash: { id: 'market_crash', name: 'Market crash', equityDrift: -0.40, bondDrift: 0.03, realEstateDrift: -0.10, privateDrift: -0.30, volatilityMultiplier: 2.5, inflation: 0.02, rateShift: -0.02, businessGrowthMultiplier: 0.2 },
  high_rates: { id: 'high_rates', name: 'High interest rates', equityDrift: -0.04, bondDrift: -0.03, realEstateDrift: -0.05, privateDrift: -0.05, volatilityMultiplier: 1.2, inflation: 0.04, rateShift: 0.04, businessGrowthMultiplier: 0.8 },
  custom: { id: 'custom', name: 'Custom scenario', equityDrift: 0, bondDrift: 0, realEstateDrift: 0, privateDrift: 0, volatilityMultiplier: 1, inflation: 0.03, rateShift: 0, businessGrowthMultiplier: 1 },
};
