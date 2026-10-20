import type { Scalar, Seed } from './types';
import { CONTRACT_VERSION } from './config';

/** Trusted per-field mutation vocabulary. Omission is distinct from null. */
export interface Gene { readonly field: string; readonly values: readonly Scalar[]; readonly optional: boolean }
export type GenomeSpace = readonly Gene[];
export type Random = () => number;
export const GENOME_LIMITS = Object.freeze({ maximumFields: 64, maximumVariants: 256, maximumStringLength: 4096,
  /** Bound duplicate recovery independently of the size of the Cartesian space. */
  attemptsPerIndividual: 32 });
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export function validateGenomeSpace(input: GenomeSpace): GenomeSpace {
  if (!input.length || input.length > GENOME_LIMITS.maximumFields) throw Error('Invalid genome field count');
  const fields = new Set<string>();
  return Object.freeze(input.map(gene => {
    if (!gene.field || forbidden.has(gene.field) || fields.has(gene.field) || typeof gene.optional !== 'boolean' ||
        !gene.values.length || gene.values.length > GENOME_LIMITS.maximumVariants) throw Error('Invalid genome field');
    fields.add(gene.field);
    const type = typeof gene.values[0];
    for (const value of gene.values) {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value) || typeof value !== type ||
          typeof value === 'number' && !Number.isFinite(value) || typeof value === 'string' && value.length > GENOME_LIMITS.maximumStringLength) throw Error('Invalid typed gene value');
    }
    if (new Set(gene.values).size !== gene.values.length) throw Error('Duplicate gene value');
    return Object.freeze({ field: gene.field, optional: gene.optional, values: Object.freeze([...gene.values]) });
  }));
}
export function validateGenome(seed: Seed, space: GenomeSpace): void {
  const fields = new Set(space.map(gene => gene.field));
  if (seed.schemaVersion !== CONTRACT_VERSION || Object.keys(seed.values).some(field => !fields.has(field)) ||
      seed.omitFields.some(field => !fields.has(field)) || new Set(seed.omitFields).size !== seed.omitFields.length) throw Error('Genome outside allowed fields');
  for (const gene of space) {
    const present = Object.hasOwn(seed.values, gene.field);
    const value = seed.values[gene.field];
    if (present ? seed.omitFields.includes(gene.field) || (value === undefined || !gene.values.includes(value)) : !gene.optional || !seed.omitFields.includes(gene.field)) throw Error('Genome outside typed vocabulary');
  }
}
export function genomeKey(seed: Seed, space: GenomeSpace): string {
  return JSON.stringify(space.map(gene => Object.hasOwn(seed.values, gene.field) ? [seed.values[gene.field]] : []));
}
export function makeGenome(id: string, choices: readonly (Scalar | undefined)[], space: GenomeSpace): Seed {
  return Object.freeze({ schemaVersion: CONTRACT_VERSION, seedId: id,
    values: Object.freeze(Object.fromEntries(space.flatMap((gene, index) => choices[index] === undefined ? [] : [[gene.field, choices[index]]]))),
    omitFields: Object.freeze(space.filter((_gene, index) => choices[index] === undefined).map(gene => gene.field)), rationale: 'Genetic search candidate' });
}
export function randomGenome(id: string, space: GenomeSpace, random: Random): Seed {
  return makeGenome(id, space.map(gene => gene.values[Math.floor(random() * (gene.values.length + Number(gene.optional)))]), space);
}
/** One-point crossover guarantees both parents contribute when at least two loci differ. */
export function crossGenome(id: string, left: Seed, right: Seed, space: GenomeSpace, random: Random): Seed {
  const differing = space.filter(gene => left.values[gene.field] !== right.values[gene.field]);
  const cut = differing.length > 1 ? 1 + Math.floor(random() * (differing.length - 1)) : 1;
  let index = 0;
  return makeGenome(id, space.map(gene => {
    if (left.values[gene.field] === right.values[gene.field]) return left.values[gene.field];
    return (index++ < cut ? left : right).values[gene.field];
  }), space);
}
/** Change one mutable locus to a different, same-type value or explicit omission. */
export function mutateGenome(id: string, seed: Seed, space: GenomeSpace, random: Random): Seed {
  const mutable = space.filter(gene => gene.values.length + Number(gene.optional) > 1);
  const selected = mutable[Math.floor(random() * mutable.length)];
  return makeGenome(id, space.map(gene => {
    if (gene !== selected) return seed.values[gene.field];
    const alternatives = [...gene.values, ...(gene.optional ? [undefined] : [])].filter(value => value !== seed.values[gene.field]);
    return alternatives[Math.floor(random() * alternatives.length)];
  }), space);
}
