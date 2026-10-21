import { randomUUID } from 'node:crypto';
import { DATA_ROOT } from '../../../paths';
import { runGeneticCampaign } from '../application/geneticCampaign';
import { validateGeneticFixtureOptions } from './geneticFixtureOptions';
import { startGeneticHttpSession } from './geneticHttpSession';
import { createGeneticReportStore } from './geneticReportStore';
import { createLlmProposer } from '../application/llmProposer';
import { compoundSpace } from '../domain/geneticFixtureConfig';
import { createLocalProvider, createMockProvider, createRemoteProvider } from './llmProviders';
import type { FixtureFactory } from './fixtureRuntime';
import type { LlmProvider, LlmSettings } from '../domain/llmTypes';

function providerFor(settings: LlmSettings, env: NodeJS.ProcessEnv): LlmProvider | undefined {
  if (settings.mode === 'mock') return createMockProvider();
  if (settings.mode === 'remote' && settings.endpoint && settings.apiKeyEnv) return createRemoteProvider(settings.endpoint, settings.model, env[settings.apiKeyEnv] ?? '');
  return settings.mode === 'local' && settings.endpoint ? createLocalProvider(settings.endpoint, settings.model) : undefined;
}

export function createGeneticFixtureService({ applicationVersion, dataRoot = DATA_ROOT, factory, timeoutMs, llmProvider, env = process.env }: {
  applicationVersion: string; dataRoot?: string; factory?: FixtureFactory; timeoutMs?: number; llmProvider?: LlmProvider; env?: NodeJS.ProcessEnv;
}) {
  const store = createGeneticReportStore(dataRoot);
  return {
    async run(input: unknown, { signal = new AbortController().signal }: { signal?: AbortSignal } = {}) {
      const options = validateGeneticFixtureOptions(input);
      const provider = llmProvider ?? providerFor(options.llm, env);
      const report = await runGeneticCampaign({ applicationVersion, ...(provider ? { proposer: createLlmProposer(provider, options.llm, compoundSpace) } : {}), now: Date.now, reportId: randomUUID,
        start: (mode, nextSignal, deadline, maxTrials) => startGeneticHttpSession(mode, nextSignal, deadline, maxTrials,
          { ...(factory ? { factory } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) }),
      }, options, signal);
      return Object.freeze({ report, saved: await store.save(report) });
    },
  };
}
