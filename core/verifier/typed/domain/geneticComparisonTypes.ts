import type { Mode } from './campaignTypes';
import type { GeneticSettings, GeneticStop } from './geneticTypes';
import type { LlmSettings } from './llmTypes';

export type ComparisonMethod = 'rules' | 'ga' | 'ga_llm';
export interface ComparisonOptions {
  readonly settings: GeneticSettings;
  readonly llm: LlmSettings;
  readonly seeds: readonly number[];
  readonly modes: readonly Mode[];
}
/** One campaign, reduced to measured facts. */
export interface ComparisonRun {
  readonly method: ComparisonMethod; readonly mode: Mode; readonly randomSeed: number;
  readonly reproduced: boolean; readonly reproduction: string; readonly stop: GeneticStop;
  /** False when the run ended for environmental reasons; such runs are reported but excluded from rates. */
  readonly valid: boolean; readonly attempts: number;
  readonly trials: number; readonly trialsToFirstViolation: number | null;
  readonly semanticPoints: number; readonly duplicates: number; readonly elapsedMs: number;
  readonly tokens: number; readonly cost: number;
}
export interface ComparisonSummary {
  readonly method: ComparisonMethod; readonly mode: Mode; readonly runs: number; readonly validRuns: number; readonly reproduced: number;
  /** reproduced / validRuns, or null when no run was valid. */
  readonly reproductionRate: number | null; readonly medianTrialsToFirstViolation: number | null;
  readonly meanSemanticPoints: number; readonly meanDuplicates: number; readonly meanElapsedMs: number;
  readonly totalTokens: number; readonly totalCost: number; readonly stops: Readonly<Record<string, number>>;
}
export interface ComparisonReport {
  readonly schemaVersion: number; readonly comparisonId: string; readonly createdAt: string;
  readonly maxTrials: number; readonly seeds: readonly number[]; readonly llmMode: LlmSettings['mode'];
  readonly runs: readonly ComparisonRun[]; readonly summaries: readonly ComparisonSummary[];
  readonly completed: boolean;
}
