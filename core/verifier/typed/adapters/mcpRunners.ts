import { validate } from '../../contracts';
import { createFixtureVerificationService, defaultRunOptions } from './fixtureService';
import { createGeneticFixtureService } from './geneticFixtureService';
import { defaultGeneticFixtureSettings } from '../domain/geneticFixtureConfig';
import { defaultLlmSettings } from '../domain/llmConfig';
import type { McpRunners } from '../application/mcpToolkit';

/** Connects the toolkit to the services the desktop app uses. Models stay off: an AI client cannot choose where candidates come from. */
export function createMcpRunners({ applicationVersion, dataRoot }: { applicationVersion: string; dataRoot: string }): McpRunners {
  const sample = createFixtureVerificationService({ applicationVersion, dataRoot });
  const genetic = createGeneticFixtureService({ applicationVersion, dataRoot });
  return {
    async sample(input, controls) {
      const options = validate('runOptions', { ...defaultRunOptions(), mode: input.mode, scenario: input.scenario,
        ...(input.maxTrials === undefined ? {} : { maxTrials: input.maxTrials }), ...(input.randomSeed === undefined ? {} : { randomSeed: input.randomSeed }) });
      const { report } = await sample.run(options, { signal: controls.signal, onProgress: progress => controls.onProgress({ done: progress.executed, planned: progress.planned }) });
      return report;
    },
    async genetic(input, controls) {
      const defaults = defaultGeneticFixtureSettings();
      const { report } = await genetic.run({ mode: input.mode, method: input.method, llm: defaultLlmSettings(),
        settings: { ...defaults, maxTrials: input.maxTrials ?? defaults.maxTrials, randomSeed: input.randomSeed ?? defaults.randomSeed } }, { signal: controls.signal });
      return report;
    },
  };
}
