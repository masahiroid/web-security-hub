import type { GeneticSettings } from './geneticTypes';

/** Bounded operational policy, independent from LLM candidate supply ratios. */
export const GENETIC_LIMITS = Object.freeze({
  version: 'ga-v1' as const,
  minimumPopulation: 2, maximumPopulation: 64, maximumGenerations: 100,
  maximumTrials: 1_000, minimumTtlMs: 1, maximumTtlMs: 3_600_000,
  maximumSeed: 4_294_967_295, maximumWeight: 100, trialsPerPair: 2,
});
export function defaultGeneticSettings(): GeneticSettings {
  return Object.freeze({
    version: GENETIC_LIMITS.version, population: 16, generations: 8, elite: 2, selection: 'tournament', tournament: 3,
    crossoverRate: 0.8, mutationRate: 0.2, minimumDiversity: 0.25,
    stagnationGenerations: 3, randomSeed: 42, maxTrials: 256, ttlMs: 120_000,
    weights: Object.freeze({ reachability: 1, novelty: 1, zap: 1 }),
  });
}
