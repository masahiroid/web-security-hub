import { GENETIC_LIMITS } from './geneticConfig';
import { RANDOM } from './campaignConfig';
import { GENOME_LIMITS, crossGenome, genomeKey, makeGenome, mutateGenome, randomGenome } from './geneticGenome';
import type { GenomeSpace, Random } from './geneticGenome';
import type { EvaluatedIndividual, GeneticSettings, Individual } from './geneticTypes';
import type { Seed } from './types';

export function geneticRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, RANDOM.multiplier) + RANDOM.increment) >>> 0;
    return state / RANDOM.modulus;
  };
}
function rank(left: EvaluatedIndividual, right: EvaluatedIndividual): number {
  return right.fitness.score - left.fitness.score || (left.individual.id < right.individual.id ? -1 : left.individual.id > right.individual.id ? 1 : 0);
}
function tournament(pool: readonly EvaluatedIndividual[], size: number, random: Random): Individual {
  let winner: EvaluatedIndividual | undefined;
  for (let draw = 0; draw < size; draw++) {
    const candidate = pool[Math.floor(random() * pool.length)];
    if (candidate && (!winner || rank(candidate, winner) < 0)) winner = candidate;
  }
  if (!winner) throw Error('No eligible parents');
  return winner.individual;
}
export function individual(id: string, generation: number, seed: Seed, operator: Individual['operator'], parents: readonly string[], space: GenomeSpace): Individual {
  return Object.freeze({ id, generation, operator, parentIds: Object.freeze([...parents]),
    seed: makeGenome(id, space.map(gene => seed.values[gene.field]), space) });
}
export interface Population {
  /** Genomes never evaluated before (absent from the evaluated set); the next generation's only requests. */
  readonly individuals: readonly Individual[];
  /** Best eligible parents kept with their existing observations; they are not re-executed. */
  readonly carried: readonly EvaluatedIndividual[];
  readonly uniqueGenomes: number; readonly sufficient: boolean;
}
/**
 * Invalid observations cannot become parents. Elites are carried forward with their observed fitness instead of
 * being executed again, and no genome in `evaluated` is proposed twice, so every request is new information.
 * Immigrants recover bounded diversity.
 */
export function nextPopulation(previous: readonly EvaluatedIndividual[], generation: number, settings: GeneticSettings, space: GenomeSpace, random: Random, evaluated: ReadonlySet<string> = new Set()): Population {
  const pool = previous.filter(entry => entry.fitness.eligible && Number.isFinite(entry.fitness.score)).sort(rank);
  const result: Individual[] = [];
  const keys = new Set<string>(evaluated);
  const add = (candidate: Individual): boolean => {
    const key = genomeKey(candidate.seed, space);
    if (keys.has(key)) return false;
    keys.add(key); result.push(candidate); return true;
  };
  const id = () => `ga-${generation}-${result.length}`;
  const attempts = settings.population * GENOME_LIMITS.attemptsPerIndividual;
  const breedAttempts = Math.floor(attempts / 2);
  for (let attempt = 0; result.length < settings.population && attempt < attempts; attempt++) {
    let candidate: Individual;
    if (!pool.length || attempt >= breedAttempts) candidate = individual(id(), generation, randomGenome(id(), space, random), 'immigrant', [], space);
    else {
      const first = tournament(pool, settings.tournament, random);
      let seed = first.seed;
      let operator: Individual['operator'] = 'elite';
      const parents = [first.id];
      const other = pool.filter(entry => entry.individual.id !== first.id);
      if (other.length && random() < settings.crossoverRate) {
        const second = tournament(other, settings.tournament, random);
        seed = crossGenome(id(), first.seed, second.seed, space, random);
        parents.push(second.id); operator = 'crossover';
      }
      if (random() < settings.mutationRate) { seed = mutateGenome(id(), seed, space, random); operator = 'mutation'; }
      candidate = individual(id(), generation, seed, operator, parents, space);
    }
    add(candidate);
  }
  return Object.freeze({ individuals: Object.freeze(result), carried: Object.freeze(pool.slice(0, settings.elite)), uniqueGenomes: result.length,
    // A finite vocabulary may produce a smaller, entirely unique population.
    sufficient: result.length >= Math.max(GENETIC_LIMITS.minimumPopulation, Math.ceil(settings.population * settings.minimumDiversity)) });
}
