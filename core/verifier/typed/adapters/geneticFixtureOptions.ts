import { FIXTURE } from '../domain/config';
import { defaultLlmSettings } from '../domain/llmConfig';
import { validateLlmSettings } from '../domain/llmSettings';
import { validateGeneticSettings } from '../domain/geneticSettings';
import type { GeneticFixtureOptions } from '../domain/geneticCampaignTypes';

export function validateGeneticFixtureOptions(input: unknown): GeneticFixtureOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected genetic fixture options');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['settings', 'mode', 'llm', 'method'].includes(key)) || !Object.hasOwn(value, 'settings') || !Object.hasOwn(value, 'mode') ||
      !FIXTURE.modes.some(mode => mode === value.mode)) throw Error('Invalid genetic fixture options');
  const mode = FIXTURE.modes.find(mode => mode === value.mode);
  if (!mode) throw Error('Invalid fixture mode');
  const method = Object.hasOwn(value, 'method') ? (['rules', 'ga'] as const).find(name => name === value.method) : 'ga';
  if (!method) throw Error('Invalid search method');
  const llm = validateLlmSettings(Object.hasOwn(value, 'llm') ? value.llm : defaultLlmSettings());
  if (method === 'rules' && llm.mode !== 'disabled') throw Error('Fixed rules do not use a language model');
  return Object.freeze({ mode, method, settings: validateGeneticSettings(value.settings), llm });
}
