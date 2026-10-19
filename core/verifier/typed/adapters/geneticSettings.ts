import { GENETIC_LIMITS } from '../domain/geneticConfig';
import type { GeneticSettings } from '../domain/geneticTypes';

function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected genetic settings object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw Error('Unexpected genetic settings fields');
  return value;
}
function number(input: unknown, minimum: number, maximum: number, integer = true): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < minimum || input > maximum || integer && !Number.isInteger(input)) throw Error('Invalid genetic setting range');
  return input;
}
/** Unknown input is copied, bounded and frozen before reaching the domain. */
export function validateGeneticSettings(input: unknown): GeneticSettings {
  const value = object(input, ['version', 'population', 'generations', 'elite', 'selection', 'tournament', 'crossoverRate', 'mutationRate', 'minimumDiversity', 'stagnationGenerations', 'randomSeed', 'maxTrials', 'ttlMs', 'weights']);
  if (value.version !== GENETIC_LIMITS.version) throw Error('Unsupported genetic settings version');
  if (value.selection !== 'tournament') throw Error('Unsupported genetic selection method');
  const population = number(value.population, GENETIC_LIMITS.minimumPopulation, GENETIC_LIMITS.maximumPopulation);
  const generations = number(value.generations, 1, GENETIC_LIMITS.maximumGenerations);
  const weights = object(value.weights, ['reachability', 'novelty', 'zap']);
  const boundedWeights = Object.freeze({
    reachability: number(weights.reachability, 0, GENETIC_LIMITS.maximumWeight, false),
    novelty: number(weights.novelty, 0, GENETIC_LIMITS.maximumWeight, false),
    zap: number(weights.zap, 0, GENETIC_LIMITS.maximumWeight, false),
  });
  if (Object.values(boundedWeights).every(weight => weight === 0)) throw Error('At least one fitness weight is required');
  return Object.freeze({
    version: GENETIC_LIMITS.version, population, generations, selection: value.selection,
    elite: number(value.elite, 0, population - 1), tournament: number(value.tournament, 2, population),
    crossoverRate: number(value.crossoverRate, 0, 1, false), mutationRate: number(value.mutationRate, 0, 1, false),
    minimumDiversity: number(value.minimumDiversity, 0, 1, false),
    stagnationGenerations: number(value.stagnationGenerations, 1, generations),
    randomSeed: number(value.randomSeed, 0, GENETIC_LIMITS.maximumSeed),
    maxTrials: number(value.maxTrials, GENETIC_LIMITS.trialsPerPair, GENETIC_LIMITS.maximumTrials),
    ttlMs: number(value.ttlMs, GENETIC_LIMITS.minimumTtlMs, GENETIC_LIMITS.maximumTtlMs), weights: boundedWeights,
  });
}
