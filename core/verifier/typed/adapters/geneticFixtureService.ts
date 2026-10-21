import { randomUUID } from 'node:crypto';
import { DATA_ROOT } from '../../../paths';
import { runGeneticCampaign } from '../application/geneticCampaign';
import { validateGeneticFixtureOptions } from './geneticFixtureOptions';
import { startGeneticHttpSession } from './geneticHttpSession';
import { createGeneticReportStore } from './geneticReportStore';
import type { FixtureFactory } from './fixtureRuntime';

export function createGeneticFixtureService({ applicationVersion, dataRoot = DATA_ROOT, factory, timeoutMs }: {
  applicationVersion: string; dataRoot?: string; factory?: FixtureFactory; timeoutMs?: number;
}) {
  const store = createGeneticReportStore(dataRoot);
  return {
    async run(input: unknown, { signal = new AbortController().signal }: { signal?: AbortSignal } = {}) {
      const options = validateGeneticFixtureOptions(input);
      const report = await runGeneticCampaign({ applicationVersion, now: Date.now, reportId: randomUUID,
        start: (mode, nextSignal, deadline, maxTrials) => startGeneticHttpSession(mode, nextSignal, deadline, maxTrials,
          { ...(factory ? { factory } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) }),
      }, options, signal);
      return Object.freeze({ report, saved: await store.save(report) });
    },
  };
}
