import { LLM_LIMITS } from './llmConfig';
import { genomeKey, makeGenome } from './geneticGenome';
import { LlmError } from './llmTypes';
import type { GenomeSpace } from './geneticGenome';
import type { EvaluatedIndividual } from './geneticTypes';
import type { LlmContext, LlmFeedback } from './llmTypes';
import type { Scalar, Seed } from './types';

export const LLM_SYSTEM_PROMPT = 'You propose test inputs as JSON only. Use only the listed fields and allowed values. Output nothing else.';
/** Strict response schema; unknown fields are never accepted. */
export function proposalSchema(maxProposals: number, space: GenomeSpace): Readonly<Record<string, unknown>> {
  const values = { type: 'object', additionalProperties: false, required: space.filter(gene => !gene.optional).map(gene => gene.field),
    properties: Object.fromEntries(space.map(gene => [gene.field, { enum: gene.values }])) };
  return Object.freeze({ type: 'object', additionalProperties: false, required: ['candidates'], properties: { candidates: {
    type: 'array', maxItems: maxProposals, items: { type: 'object', additionalProperties: false, required: ['values'], properties: { values } } } } });
}
/** Keeps only typed gene values and aggregate numbers: no ids, URLs, headers, evidence or profiles. */
export function redactFeedback(evaluated: readonly EvaluatedIndividual[]): readonly LlmFeedback[] {
  return Object.freeze(evaluated.filter(entry => entry.fitness.eligible && Number.isFinite(entry.fitness.score))
    .sort((left, right) => right.fitness.score - left.fitness.score || (left.individual.id < right.individual.id ? -1 : 1))
    .slice(0, LLM_LIMITS.feedbackEntries).map(entry => Object.freeze({ values: Object.freeze({ ...entry.individual.seed.values }), score: entry.fitness.score,
      reachability: entry.fitness.reachability.state === 'observed' ? entry.fitness.reachability.value : null })));
}
export function buildPrompt(context: LlmContext): string {
  const fields = context.space.map(gene => ({ field: gene.field, allowed: gene.values, optional: gene.optional }));
  return JSON.stringify({ task: `Return up to ${context.maxProposals} new candidates as {"candidates":[{"values":{...}}]}. Omit an optional field to leave it unset.`,
    fields, previous: context.feedback });
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Untrusted text becomes genomes only after bounds, shape, field and vocabulary checks. Duplicates are dropped. */
export function parseProposals(text: string, space: GenomeSpace, maxProposals: number, maxBytes: number): readonly Seed[] {
  if (Buffer.byteLength(text) > maxBytes) throw new LlmError('oversized');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new LlmError('invalid_json'); }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.candidates)) throw new LlmError('invalid_shape');
  if (parsed.candidates.length > maxProposals) throw new LlmError('too_many');
  const keys = new Set<string>();
  const seeds: Seed[] = [];
  for (const candidate of parsed.candidates as unknown[]) {
    if (!isRecord(candidate) || Object.keys(candidate).length !== 1 || !isRecord(candidate.values)) throw new LlmError('invalid_shape');
    const values = candidate.values;
    if (Object.keys(values).some(field => !space.some(gene => gene.field === field))) throw new LlmError('unknown_field');
    const choices = space.map((gene): Scalar | undefined => {
      if (!Object.hasOwn(values, gene.field)) { if (!gene.optional) throw new LlmError('invalid_value'); return undefined; }
      const value = values[gene.field];
      if (value === undefined || !gene.values.includes(value as Scalar)) throw new LlmError('invalid_value');
      return value as Scalar;
    });
    const seed = makeGenome('llm', choices, space);
    const key = genomeKey(seed, space);
    if (!keys.has(key)) { keys.add(key); seeds.push(seed); }
  }
  if (!seeds.length) throw new LlmError('empty');
  return Object.freeze(seeds);
}
