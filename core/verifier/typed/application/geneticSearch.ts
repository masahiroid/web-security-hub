import { awaitGeneticEvaluation } from './geneticEvaluation';
import { validateGeneticSettings } from '../domain/geneticSettings';
import { GENETIC_LIMITS } from '../domain/geneticConfig';
import { geneticRandom, individual, nextPopulation } from '../domain/geneticEvolution';
import { evaluateGeneticFitness } from '../domain/geneticFitness';
import { genomeKey, validateGenome, validateGenomeSpace } from '../domain/geneticGenome';
import type { GenomeSpace } from '../domain/geneticGenome';
import type { Generation, GeneticStop, Individual } from '../domain/geneticTypes';
import type { Result, Seed } from '../domain/types';

export interface GeneticEvaluationPort {
  /** One normal-control/candidate pair at most. Adapter must honor signal/deadline and fixed scope. */
  evaluate(individual: Individual, context: Readonly<{ signal: AbortSignal; deadline: number }>): Promise<Result>;
}
export interface GeneticSearchRequest {
  readonly settings: unknown;
  readonly space: GenomeSpace;
  readonly initial: readonly Seed[];
  readonly signal: AbortSignal;
}
/** Contains exact private inputs; never publish this object as public feedback. */
export interface GeneticSearchReport {
  readonly genomeSpace: GenomeSpace;
  readonly settings: ReturnType<typeof validateGeneticSettings>;
  readonly randomAlgorithm: 'lcg32-v1';
  readonly generations: readonly Generation[];
  /** Reserved HTTP trial capacity; includes a control for every evaluation, even if adapter sends less. */
  readonly reservedTrials: number;
  readonly stop: GeneticStop;
}
export function createGeneticSearch(port: GeneticEvaluationPort, now: () => number = Date.now) {
  return async (request: GeneticSearchRequest): Promise<GeneticSearchReport> => {
    const settings = validateGeneticSettings(request.settings);
    const space = validateGenomeSpace(request.space);
    if (request.initial.length !== settings.population) throw Error('Initial population must match settings');
    request.initial.forEach(seed => validateGenome(seed, space));
    let population = request.initial.map((seed, index) => individual(`ga-0-${index}`, 0, seed, 'initial', [], space));
    if (new Set(population.map(entry => genomeKey(entry.seed, space))).size !== population.length) throw Error('Duplicate initial genomes');
    const random = geneticRandom(settings.randomSeed);
    const generations: Generation[] = [];
    const seen = new Set<string>();
    let reservedTrials = 0;
    let best = -Infinity;
    let stagnant = 0;
    const deadline = now() + settings.ttlMs;
    const expiry = new AbortController();
    const timer = setTimeout(() => expiry.abort(), settings.ttlMs);
    const signal = AbortSignal.any([request.signal, expiry.signal]);
    const interrupted = (): GeneticStop | null => request.signal.aborted ? 'cancelled' : expiry.signal.aborted || now() >= deadline ? 'deadline' : null;
    const report = (stop: GeneticStop): GeneticSearchReport => Object.freeze({ settings, genomeSpace: space, randomAlgorithm: 'lcg32-v1',
      generations: Object.freeze(generations), reservedTrials, stop });
    try {
      for (let index = 0; index < settings.generations; index++) {
        const entries: Generation['individuals'][number][] = [];
        let stop: GeneticStop | null = null;
        for (const candidate of population) {
          stop = interrupted();
          if (stop) break;
          if (reservedTrials + GENETIC_LIMITS.trialsPerPair > settings.maxTrials) { stop = 'trial_budget'; break; }
          reservedTrials += GENETIC_LIMITS.trialsPerPair;
          let result: Result;
          try { result = await awaitGeneticEvaluation(() => port.evaluate(candidate, { signal, deadline }), signal); }
          catch { stop = interrupted() ?? 'error'; break; }
          stop = interrupted();
          if (stop) break;
          if (result.observation.seedId !== candidate.seed.seedId) { stop = 'error'; break; }
          const fitness = evaluateGeneticFitness(result, seen, settings.weights);
          entries.push(Object.freeze({ individual: candidate, fitness }));
          if (!result.feedback.controlPassed) { stop = 'control_failed'; break; }
          if (result.evidence.state === 'source_mismatch') { stop = 'source_changed'; break; }
        }
        const eligible = entries.filter(entry => entry.fitness.eligible);
        const bestScore = eligible.length ? Math.max(...eligible.map(entry => entry.fitness.score)) : null;
        if (entries.length) generations.push(Object.freeze({ index, individuals: Object.freeze(entries),
          uniqueGenomes: new Set(entries.map(entry => genomeKey(entry.individual.seed, space))).size, bestScore }));
        if (stop) return report(stop);
        // All members of a generation see the same novelty baseline, avoiding order bias.
        eligible.forEach(entry => entry.fitness.noveltyKeys.forEach(key => seen.add(key)));
        if (bestScore !== null && bestScore > best) { best = bestScore; stagnant = 0; } else stagnant++;
        if (index + 1 === settings.generations) return report('generation_limit');
        if (stagnant >= settings.stagnationGenerations) return report('stagnation');
        if (reservedTrials + GENETIC_LIMITS.trialsPerPair > settings.maxTrials) return report('trial_budget');
        const next = nextPopulation(entries, index + 1, settings, space, random);
        if (!next.sufficient) return report('diversity_exhausted');
        population = [...next.individuals];
      }
      return report('generation_limit');
    } catch {
      return report(interrupted() ?? 'error');
    } finally { clearTimeout(timer); }
  };
}
