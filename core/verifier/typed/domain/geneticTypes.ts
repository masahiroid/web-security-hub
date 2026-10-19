import type { Seed } from './types';

/** Transport, URL, authentication and permissions belong to the trusted runner. */
export interface Individual {
  readonly id: string;
  readonly generation: number;
  readonly parentIds: readonly string[];
  readonly operator: 'initial' | 'elite' | 'crossover' | 'mutation' | 'immigrant';
  readonly seed: Seed;
}
export interface GeneticSettings {
  readonly version: 'ga-v1';
  readonly population: number;
  readonly generations: number;
  readonly elite: number;
  readonly selection: 'tournament';
  readonly tournament: number;
  readonly crossoverRate: number;
  readonly mutationRate: number;
  readonly minimumDiversity: number;
  readonly stagnationGenerations: number;
  readonly randomSeed: number;
  readonly maxTrials: number;
  readonly ttlMs: number;
  readonly weights: Readonly<{ reachability: number; novelty: number; zap: number }>;
}
export type Metric = Readonly<{ state: 'observed'; value: number }> |
  Readonly<{ state: 'unavailable' | 'incomplete'; value: null }>;
export interface Fitness {
  /** Selection priority only; this is never a vulnerability assessment. */
  readonly score: number;
  readonly eligible: boolean;
  readonly reason: 'valid_observation' | 'invalid_control' | 'invalid_observation' | 'unverified_evidence';
  readonly reachability: Metric;
  readonly coverage: Metric;
  readonly novelty: Metric;
  readonly zap: Metric;
  readonly noveltyKeys: readonly string[];
}
export interface EvaluatedIndividual { readonly individual: Individual; readonly fitness: Fitness }
export type GeneticStop = 'generation_limit' | 'trial_budget' | 'deadline' | 'cancelled' |
  'stagnation' | 'diversity_exhausted' | 'control_failed' | 'source_changed' | 'error';
export interface Generation {
  readonly index: number;
  readonly individuals: readonly EvaluatedIndividual[];
  readonly uniqueGenomes: number;
  readonly bestScore: number | null;
}
