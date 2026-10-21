import { FIXTURE } from '../domain/config';
import { validateGeneticSettings } from '../domain/geneticSettings';
import type { GeneticFixtureOptions } from '../domain/geneticCampaignTypes';

export function validateGeneticFixtureOptions(input: unknown): GeneticFixtureOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected genetic fixture options');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'settings') || !Object.hasOwn(value, 'mode') ||
      !FIXTURE.modes.some(mode => mode === value.mode)) throw Error('Invalid genetic fixture options');
  const mode = FIXTURE.modes.find(mode => mode === value.mode);
  if (!mode) throw Error('Invalid fixture mode');
  return Object.freeze({ mode, settings: validateGeneticSettings(value.settings) });
}
