import type { GeneticSettings, GeneticStop, GeneticSearchReport, GeneticEvaluationPort, GeneticProposer } from './geneticTypes';
import type { LlmSettings } from './llmTypes';
import type { Pair, Mode } from './campaignTypes';
import type { Seed } from './types';
export interface GeneticFixtureOptions { readonly mode: Mode; readonly settings: GeneticSettings; readonly llm: LlmSettings }
export interface GeneticExecution { readonly individualId: string; readonly pair: Pair }
export interface GeneticSession extends GeneticEvaluationPort {
  readonly sourceDigest: string;
  readonly trials: number;
  readonly executions: readonly GeneticExecution[];
  close(): Promise<void>;
}
export interface GeneticReproduction {
  readonly state: 'reproduced' | 'not_reproduced' | 'not_attempted' | 'inconclusive';
  readonly seed: Seed | null;
  readonly sourceDigest: string | null;
  readonly execution: GeneticExecution | null;
}
/** Exact synthetic inputs and correlated observations, for private storage only. */
export interface GeneticCampaignReport {
  readonly schemaVersion: number; readonly reportId: string; readonly applicationVersion: string;
  readonly createdAt: string; readonly options: GeneticFixtureOptions;
  readonly state: GeneticStop; readonly sourceDigest: string | null;
  readonly search: GeneticSearchReport | null; readonly executions: readonly GeneticExecution[];
  readonly reproduction: GeneticReproduction; readonly trials: number;
  readonly draft: true; readonly vexStatus: 'under_investigation';
}
export interface GeneticCampaignPorts {
  now(): number;
  reportId(): string;
  readonly applicationVersion: string;
  /** Optional model-assisted candidate supply; absent means GA only. */
  readonly proposer?: GeneticProposer;
  start(mode: Mode, signal: AbortSignal, deadline: number, maxTrials: number): Promise<GeneticSession>;
}
export class GeneticEvaluationError extends Error {
  constructor(readonly stop: GeneticStop) { super('Genetic evaluation stopped'); }
}
