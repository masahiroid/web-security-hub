import { randomUUID } from 'node:crypto';
import { DATA_ROOT } from '../../../paths';
import { runGeneticCampaign } from '../application/geneticCampaign';
import { validateGeneticFixtureOptions } from './geneticFixtureOptions';
import { startGeneticHttpSession } from './geneticHttpSession';
import { createGeneticReportStore } from './geneticReportStore';
import { createLlmProposer } from '../application/llmProposer';
import { compoundSpace } from '../domain/geneticFixtureConfig';
import { createLocalProvider, createMockProvider, createRemoteProvider } from './llmProviders';
import { runGeneticComparison } from '../application/geneticComparison';
import { validateComparisonOptions } from './geneticComparisonOptions';
import type { GeneticFixtureOptions } from '../domain/geneticCampaignTypes';
import type { Mode } from '../domain/campaignTypes';
import type { FixtureFactory } from './fixtureRuntime';
import type { LlmProvider, LlmSettings } from '../domain/llmTypes';

function pauseFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { done(); reject(Error('Comparison cancelled')); };
    const timer = setTimeout(() => { done(); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
function providerFor(settings: LlmSettings, env: NodeJS.ProcessEnv): LlmProvider | undefined {
  if (settings.mode === 'mock') return createMockProvider();
  if (settings.mode === 'remote' && settings.endpoint && settings.apiKeyEnv) return createRemoteProvider(settings.endpoint, settings.model, env[settings.apiKeyEnv] ?? '');
  return settings.mode === 'local' && settings.endpoint ? createLocalProvider(settings.endpoint, settings.model) : undefined;
}

export function createGeneticFixtureService({ applicationVersion, dataRoot = DATA_ROOT, factory, timeoutMs, llmProvider, env = process.env }: {
  applicationVersion: string; dataRoot?: string; factory?: FixtureFactory; timeoutMs?: number; llmProvider?: LlmProvider; env?: NodeJS.ProcessEnv;
}) {
  const store = createGeneticReportStore(dataRoot);
  const campaignPorts = (options: GeneticFixtureOptions) => {
    // The model is consulted only when this campaign enables it, even if a provider was injected.
    const provider = options.llm.mode === 'disabled' ? undefined : llmProvider ?? providerFor(options.llm, env);
    return { applicationVersion, now: Date.now, reportId: randomUUID, ...(provider && options.method === 'ga' ? { proposer: createLlmProposer(provider, options.llm, compoundSpace) } : {}),
      start: (mode: Mode, nextSignal: AbortSignal, deadline: number, maxTrials: number) => startGeneticHttpSession(mode, nextSignal, deadline, maxTrials,
        { ...(factory ? { factory } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) }) };
  };
  return {
    /** Fixed rules, GA and GA+model under one budget and a pre-fixed seed set; only the aggregate is saved. */
    async compare(input: unknown, { signal = new AbortController().signal, progress }: { signal?: AbortSignal; progress?: (done: number, planned: number) => void } = {}) {
      const options = validateComparisonOptions(input);
      const report = await runGeneticComparison({ now: Date.now, comparisonId: randomUUID, pause: pauseFor, ...(progress ? { progress } : {}),
        run: (campaign, nextSignal) => runGeneticCampaign(campaignPorts(campaign), campaign, nextSignal) }, options, signal);
      return Object.freeze({ report, saved: await store.saveComparison(report) });
    },
    async run(input: unknown, { signal = new AbortController().signal }: { signal?: AbortSignal } = {}) {
      const options = validateGeneticFixtureOptions(input);
      const report = await runGeneticCampaign(campaignPorts(options), options, signal);
      return Object.freeze({ report, saved: await store.save(report) });
    },
  };
}
