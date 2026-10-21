import { COMPARISON } from '../domain/comparisonConfig';
import { FIXTURE } from '../domain/config';
import { defaultGeneticFixtureSettings } from '../domain/geneticFixtureConfig';
import { defaultLlmSettings } from '../domain/llmConfig';
import { validateLlmSettings } from '../domain/llmSettings';
import { validateGeneticSettings } from '../domain/geneticSettings';
import { validateComparisonSeeds } from '../application/geneticComparison';
import type { Mode } from '../domain/campaignTypes';
import type { ComparisonOptions } from '../domain/geneticComparisonTypes';

/** Unknown input becomes bounded comparison options; omitted parts use the pre-fixed conditions. */
export function validateComparisonOptions(input: unknown): ComparisonOptions {
  const value: Record<string, unknown> = input === undefined ? {} : input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : (() => { throw Error('Expected comparison options'); })();
  if (Object.keys(value).some(key => !['settings', 'llm', 'seeds', 'modes'].includes(key))) throw Error('Unexpected comparison options');
  const seeds = Object.hasOwn(value, 'seeds') ? value.seeds : COMPARISON.seeds;
  if (!Array.isArray(seeds) || seeds.some(seed => typeof seed !== 'number')) throw Error('Invalid comparison seeds');
  const modes: Mode[] = (Object.hasOwn(value, 'modes') ? value.modes : COMPARISON.modes) as unknown[] as Mode[];
  if (!Array.isArray(modes) || !modes.length || new Set(modes).size !== modes.length || modes.some(mode => !FIXTURE.modes.includes(mode))) throw Error('Invalid comparison modes');
  return Object.freeze({ settings: validateGeneticSettings(Object.hasOwn(value, 'settings') ? value.settings : defaultGeneticFixtureSettings()),
    llm: validateLlmSettings(Object.hasOwn(value, 'llm') ? value.llm : defaultLlmSettings()), seeds: validateComparisonSeeds(seeds as number[]), modes: Object.freeze([...modes]) });
}
