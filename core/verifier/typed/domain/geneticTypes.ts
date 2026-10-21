import type { EvidencePoint, Result, Seed } from './types';
import type { GenomeSpace } from './geneticGenome';

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
  'stagnation' | 'diversity_exhausted' | 'control_failed' | 'source_changed' | 'timeout' | 'unverified_evidence' | 'zap_incomplete' | 'error';
export interface Generation {
  readonly index: number;
  readonly individuals: readonly EvaluatedIndividual[];
  readonly uniqueGenomes: number;
  readonly bestScore: number | null;
}


export interface GeneticEvaluationPort {
  /** At most one normal-control/candidate pair. Adapter honors fixed scope and cancellation. */
  evaluate(individual: Individual, context: Readonly<{ signal: AbortSignal; deadline: number }>): Promise<Result>;
}
/** Exact private inputs and immutable search decisions. */
export interface GeneticSearchReport {
  readonly genomeSpace: GenomeSpace;
  readonly settings: GeneticSettings;
  readonly randomAlgorithm: 'lcg32-v1';
  /** Measured semantic points, not general code/branch coverage. */
  readonly coveragePoints: readonly EvidencePoint[];
  readonly generations: readonly Generation[];
  readonly reservedTrials: number;
  readonly stop: GeneticStop;
}
