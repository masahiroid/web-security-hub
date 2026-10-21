import { COMPARISON } from '../domain/comparisonConfig';
import { GENETIC_LIMITS } from '../domain/geneticConfig';
import { genomeKey } from '../domain/geneticGenome';
import type { GeneticCampaignReport, GeneticFixtureOptions } from '../domain/geneticCampaignTypes';
import type { ComparisonMethod, ComparisonOptions, ComparisonReport, ComparisonRun, ComparisonSummary } from '../domain/geneticComparisonTypes';
import type { Mode } from '../domain/campaignTypes';

export interface ComparisonPorts {
  now(): number;
  comparisonId(): string;
  /** Runs one complete campaign on a fresh fixture; the budget lives in options.settings. */
  run(options: GeneticFixtureOptions, signal: AbortSignal): Promise<GeneticCampaignReport>;
}
function measure(report: GeneticCampaignReport, method: ComparisonMethod, seed: number, elapsedMs: number): ComparisonRun {
  const generations = report.search?.generations ?? [];
  const individuals = generations.flatMap(generation => generation.individuals);
  const space = report.search?.genomeSpace ?? [];
  const firstIndex = report.executions.findIndex(execution => execution.pair.candidate?.assessment.result === 'reproduced');
  const points = new Set(report.executions.flatMap(execution => execution.pair.candidate?.evidence.events.map(event => event.point) ?? []));
  const proposals = report.search?.proposals ?? [];
  return Object.freeze({ method, mode: report.options.mode, randomSeed: seed, reproduced: report.reproduction.state === 'reproduced',
    reproduction: report.reproduction.state, stop: report.state, trials: report.trials,
    trialsToFirstViolation: firstIndex < 0 ? null : (firstIndex + 1) * GENETIC_LIMITS.trialsPerPair,
    semanticPoints: points.size, duplicates: individuals.length - new Set(individuals.map(entry => genomeKey(entry.individual.seed, space))).size,
    elapsedMs, tokens: proposals.reduce((sum, entry) => sum + entry.tokens, 0), cost: proposals.reduce((sum, entry) => sum + entry.cost, 0) });
}
const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] ?? null : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
export function summarize(runs: readonly ComparisonRun[]): readonly ComparisonSummary[] {
  const groups = new Map<string, ComparisonRun[]>();
  for (const run of runs) groups.set(`${run.method}/${run.mode}`, [...groups.get(`${run.method}/${run.mode}`) ?? [], run]);
  return Object.freeze([...groups.values()].map((group): ComparisonSummary => {
    const first = group[0];
    if (!first) throw Error('Empty comparison group');
    const reproduced = group.filter(run => run.reproduced);
    return Object.freeze({ method: first.method, mode: first.mode, runs: group.length, reproduced: reproduced.length, reproductionRate: reproduced.length / group.length,
      medianTrialsToFirstViolation: median(reproduced.flatMap(run => run.trialsToFirstViolation === null ? [] : [run.trialsToFirstViolation])),
      meanSemanticPoints: mean(group.map(run => run.semanticPoints)), meanDuplicates: mean(group.map(run => run.duplicates)), meanElapsedMs: mean(group.map(run => run.elapsedMs)),
      totalTokens: group.reduce((sum, run) => sum + run.tokens, 0), totalCost: group.reduce((sum, run) => sum + run.cost, 0),
      stops: Object.freeze(group.reduce<Record<string, number>>((counts, run) => ({ ...counts, [run.stop]: (counts[run.stop] ?? 0) + 1 }), {})) });
  }));
}
export function validateComparisonSeeds(seeds: readonly number[]): readonly number[] {
  if (!seeds.length || seeds.length > COMPARISON.maximumSeeds || new Set(seeds).size !== seeds.length ||
      seeds.some(seed => !Number.isSafeInteger(seed) || seed < 0 || seed > GENETIC_LIMITS.maximumSeed)) throw Error('Invalid comparison seeds');
  return Object.freeze([...seeds]);
}
/**
 * Fixed rules, GA and GA+model run on the same fixture states with the same HTTP trial budget and a pre-fixed seed set.
 * The rule baseline is deterministic, so it runs once per mode. An interrupted comparison is reported as incomplete.
 */
export async function runGeneticComparison(ports: ComparisonPorts, options: ComparisonOptions, signal: AbortSignal): Promise<ComparisonReport> {
  const seeds = validateComparisonSeeds(options.seeds);
  const runs: ComparisonRun[] = [];
  const plan: { method: ComparisonMethod; mode: Mode; seed: number }[] = [];
  for (const mode of options.modes) {
    plan.push({ method: 'rules', mode, seed: options.settings.randomSeed });
    for (const seed of seeds) plan.push({ method: 'ga', mode, seed });
    if (options.llm.mode !== 'disabled') for (const seed of seeds) plan.push({ method: 'ga_llm', mode, seed });
  }
  let completed = true;
  for (const step of plan) {
    if (signal.aborted) { completed = false; break; }
    const started = ports.now();
    const report = await ports.run({ mode: step.mode, method: step.method === 'rules' ? 'rules' : 'ga', settings: { ...options.settings, randomSeed: step.seed },
      llm: step.method === 'ga_llm' ? options.llm : { ...options.llm, mode: 'disabled', endpoint: null, sendPermission: false, apiKeyEnv: null }, }, signal);
    if (report.state === 'cancelled') { completed = false; break; }
    runs.push(measure(report, step.method, step.seed, ports.now() - started));
  }
  return Object.freeze({ schemaVersion: COMPARISON.schemaVersion, comparisonId: ports.comparisonId(), createdAt: new Date(ports.now()).toISOString(),
    maxTrials: options.settings.maxTrials, seeds, llmMode: options.llm.mode, runs: Object.freeze(runs), summaries: summarize(runs), completed });
}
