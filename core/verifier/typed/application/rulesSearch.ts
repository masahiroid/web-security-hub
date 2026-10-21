import { GeneticEvaluationError } from '../domain/geneticCampaignTypes';
import { GENETIC_LIMITS } from '../domain/geneticConfig';
import { evaluateGeneticFitness } from '../domain/geneticFitness';
import { individual } from '../domain/geneticEvolution';
import { genomeKey, makeGenome } from '../domain/geneticGenome';
import { awaitGeneticEvaluation, evaluationStop } from './geneticEvaluation';
import type { GenomeSpace } from '../domain/geneticGenome';
import type { EvaluatedIndividual, Generation, GeneticEvaluationPort, GeneticSearchReport, GeneticSettings, GeneticStop } from '../domain/geneticTypes';
import type { EvidencePoint, Scalar } from '../domain/types';

/** Deterministic Cartesian enumeration of fixed rule values; the non-adaptive baseline for comparison. */
export function ruleCandidates(space: GenomeSpace, values: readonly Scalar[]): readonly (readonly Scalar[])[] {
  return space.reduce<readonly (readonly Scalar[])[]>((rows, gene) =>
    rows.flatMap(row => values.filter(value => gene.values.includes(value)).map(value => [...row, value])), [[]]);
}
/** Same port, budget, deadline, stop rules and report shape as the genetic search, with no adaptation. */
export function createRulesSearch(port: GeneticEvaluationPort, now: () => number, measuredPoints: readonly EvidencePoint[], values: readonly Scalar[]) {
  return async (request: { settings: GeneticSettings; space: GenomeSpace; signal: AbortSignal }): Promise<GeneticSearchReport> => {
    const { settings, space } = request;
    const deadline = now() + settings.ttlMs;
    const expiry = new AbortController();
    const timer = setTimeout(() => expiry.abort(), settings.ttlMs);
    const signal = AbortSignal.any([request.signal, expiry.signal]);
    const interrupted = (): GeneticStop | null => request.signal.aborted ? 'cancelled' : expiry.signal.aborted || now() >= deadline ? 'deadline' : null;
    const generations: Generation[] = [];
    const seen = new Set<string>();
    let reservedTrials = 0;
    let stop: GeneticStop = 'generation_limit';
    let entries: EvaluatedIndividual[] = [];
    const flush = () => {
      if (!entries.length) return;
      const eligible = entries.filter(entry => entry.fitness.eligible);
      generations.push(Object.freeze({ index: generations.length, individuals: Object.freeze(entries), bestScore: eligible.length ? Math.max(...eligible.map(entry => entry.fitness.score)) : null,
        uniqueGenomes: new Set(entries.map(entry => genomeKey(entry.individual.seed, space))).size }));
      entries = [];
    };
    try {
      for (const [index, choices] of ruleCandidates(space, values).entries()) {
        const candidate = individual(`rule-${index}`, generations.length, makeGenome(`rule-${index}`, choices, space), 'initial', [], space);
        const early = interrupted();
        if (early) { stop = early; break; }
        if (reservedTrials + GENETIC_LIMITS.trialsPerPair > settings.maxTrials) { stop = 'trial_budget'; break; }
        reservedTrials += GENETIC_LIMITS.trialsPerPair;
        try {
          const result = await awaitGeneticEvaluation(() => port.evaluate(candidate, { signal, deadline }), signal);
          const fitness = evaluateGeneticFitness(result, seen, settings.weights, measuredPoints);
          const after = interrupted();
          if (after) { stop = after; break; }
          entries.push(Object.freeze({ individual: candidate, fitness }));
          fitness.noveltyKeys.forEach(key => seen.add(key));
          const ended = evaluationStop(result, fitness);
          if (ended) { stop = ended; break; }
        } catch (error: unknown) { stop = interrupted() ?? (error instanceof GeneticEvaluationError ? error.stop : 'error'); break; }
        if (entries.length >= settings.population) flush();
      }
    } finally { clearTimeout(timer); flush(); }
    return Object.freeze({ settings, genomeSpace: space, coveragePoints: Object.freeze([...measuredPoints]), randomAlgorithm: 'lcg32-v1' as const,
      generations: Object.freeze(generations), reservedTrials, proposals: Object.freeze([]), stop });
  };
}
