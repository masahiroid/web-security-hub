import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DATA_ROOT, PROJECT_ROOT } from '../../../paths';
import * as contracts from '../../contracts';
import { createRegistry } from '../../policies';
import { createFixture } from '../../../../training/verifier-site/server';
import { createHttpRunner } from '../application/httpRunner';
import { runFixtureCampaign } from '../application/fixtureCampaign';
import { CAMPAIGN, REPORT_STORAGE } from '../domain/campaignConfig';
import { CONTRACT_VERSION, FIXTURE } from '../domain/config';
import type { Progress, RunOptions } from '../domain/campaignTypes';
import { fixtureCatalog } from './fixtureCatalog';
import { startFixtureRuntime, type FixtureFactory } from './fixtureRuntime';
import { createPrivateReportStore } from './privateReportStore';
export function createFixtureVerificationService({ applicationVersion, dataRoot = DATA_ROOT, fixtureFactory = createFixture }: { applicationVersion: string; dataRoot?: string; fixtureFactory?: FixtureFactory }) {
  const registry = createRegistry({ roots: { fixture: join(PROJECT_ROOT, ...REPORT_STORAGE.fixtureSegments) }, authProfileIds: [...FIXTURE.roles, CAMPAIGN.normalProfile] });
  const store = createPrivateReportStore(dataRoot, contracts);
  return {
    readReport: store.read,
    run(input: unknown, { signal = new AbortController().signal, onProgress }: { signal?: AbortSignal; onProgress?: (progress: Progress) => undefined } = {}) {
      return runFixtureCampaign({ contracts, registry, store, sourceRootId: 'fixture', applicationVersion, now: Date.now, reportId: randomUUID,
        startRuntime: (mode, nextSignal) => startFixtureRuntime(fixtureFactory, mode, nextSignal),
        runner: (scenario, runtime) => {
          const catalog = fixtureCatalog(scenario, runtime.origin);
          return createHttpRunner({ registry, contracts, profiles: catalog.profiles, controls: [catalog.control], evidenceSource: { expectedSourceDigest: runtime.sourceDigest, currentSourceDigest: nextSignal => runtime.currentSourceDigest(nextSignal), read: correlation => runtime.readEvidence(correlation) } });
        }
      }, input, signal, onProgress);
    }
  };
}
export function defaultRunOptions(): RunOptions {
  return Object.freeze({ schemaVersion: CONTRACT_VERSION, mode: FIXTURE.initialMode, scenario: 'all', randomSeed: CAMPAIGN.defaultRandomSeed, maxCandidates: CAMPAIGN.defaultCandidates, maxTrials: CAMPAIGN.defaultTrials, ttlMs: CAMPAIGN.defaultTtlMs });
}
