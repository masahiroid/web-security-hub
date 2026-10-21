import { defaultGeneticSettings } from './geneticConfig';
import type { GeneticSettings } from './geneticTypes';
import type { GenomeSpace } from './geneticGenome';
import { makeGenome } from './geneticGenome';
import { FIXTURE, POINTS } from './config';

/** Synthetic protocol/test vectors, never derived from user authentication or URLs. */
export const GENETIC_FIXTURE = Object.freeze({
  route: '/compound', sessionRoute: '/session', rootId: 'genetic-fixture',
  owner: FIXTURE.roles[0], guest: FIXTURE.roles[1], cookie: 'compound',
  fields: ['x', 'y', 'z'] as const, maximumValue: 15,
  challenge: Object.freeze({ x: 7, y: 11, z: 13 }),
  coveragePoints: Object.freeze([POINTS.boundary, POINTS.confirm, POINTS.commit]),
  reportDirectory: Object.freeze(['artifacts', 'private', 'genetic-verifier']),
  reportVersion: 1, reproductionTrials: 2,
  sourceSegments: ['core', 'verifier', 'generated'] as const,
});
export const compoundSpace: GenomeSpace = Object.freeze(GENETIC_FIXTURE.fields.map(field => Object.freeze({
  field, values: Object.freeze(Array.from({ length: GENETIC_FIXTURE.maximumValue + 1 }, (_value, index) => index)), optional: false,
})));
export function compoundInitial(population: number) {
  // A neutral first locus and varying remaining loci; contains no completed challenge.
  return Object.freeze(Array.from({ length: population }, (_value, index) => makeGenome(`initial-${index}`, [
    0, index % (GENETIC_FIXTURE.maximumValue + 1), Math.floor(index / (GENETIC_FIXTURE.maximumValue + 1)),
  ], compoundSpace)));
}
export function defaultGeneticFixtureSettings(): GeneticSettings {
  return Object.freeze({ ...defaultGeneticSettings(), population: 16, generations: 12, elite: 2,
    mutationRate: 0.8, crossoverRate: 0.9, stagnationGenerations: 12, maxTrials: 400 });
}
