import type { GeneticCampaignReport } from '../domain/geneticCampaignTypes';
import type { ComparisonReport } from '../domain/geneticComparisonTypes';

/** Presentation model for the local GUI: reasons, generations and aggregates; no raw evidence or model output. */
export function runView(report: GeneticCampaignReport) {
  return Object.freeze({ kind: 'run' as const, reportId: report.reportId, mode: report.options.mode, method: report.options.method, llmMode: report.options.llm.mode,
    state: report.state, reproduction: report.reproduction.state, reproducedSeed: report.reproduction.state === 'reproduced' ? report.reproduction.seed?.values ?? null : null,
    trials: report.trials, maxTrials: report.options.settings.maxTrials, randomSeed: report.options.settings.randomSeed,
    generations: (report.search?.generations ?? []).map(generation => ({ index: generation.index, bestScore: generation.bestScore, uniqueGenomes: generation.uniqueGenomes,
      individuals: generation.individuals.map(entry => ({ id: entry.individual.id, operator: entry.individual.operator, parents: entry.individual.parentIds, values: entry.individual.seed.values,
        score: entry.fitness.score, eligible: entry.fitness.eligible, novelty: entry.fitness.novelty.value, reachability: entry.fitness.reachability.value })) })),
    proposals: report.search?.proposals ?? [] });
}
export function compareView(report: ComparisonReport) {
  return Object.freeze({ kind: 'compare' as const, comparisonId: report.comparisonId, completed: report.completed, maxTrials: report.maxTrials, seeds: report.seeds, llmMode: report.llmMode, summaries: report.summaries, runs: report.runs });
}
export type GeneticJobReport = ReturnType<typeof runView> | ReturnType<typeof compareView>;
