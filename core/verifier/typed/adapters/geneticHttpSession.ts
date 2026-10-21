import { join } from 'node:path';
import { PROJECT_ROOT } from '../../../paths';
import * as contracts from '../../contracts';
import { createRegistry } from '../../policies';
import { createHttpRunner } from '../application/httpRunner';
import { GENETIC_LIMITS } from '../domain/geneticConfig';
import { CAMPAIGN } from '../domain/campaignConfig';
import { CONTRACT_VERSION, HTTP_STATUS, LIMITS } from '../domain/config';
import { GENETIC_FIXTURE, compoundSpace } from '../domain/geneticFixtureConfig';
import { validateGenome } from '../domain/geneticGenome';
import { GeneticEvaluationError } from '../domain/geneticCampaignTypes';
import type { GeneticExecution, GeneticSession } from '../domain/geneticCampaignTypes';
import type { Individual } from '../domain/geneticTypes';
import type { Profile, Result } from '../domain/types';
import type { Mode } from '../domain/campaignTypes';
import { createCompoundFixture } from './compoundFixture';
import { startFixtureRuntime } from './fixtureRuntime';
import type { FixtureFactory } from './fixtureRuntime';

export async function startGeneticHttpSession(mode: Mode, signal: AbortSignal, deadline: number, maxTrials: number,
  { factory = createCompoundFixture, timeoutMs = LIMITS.defaultTrialTimeoutMs }: { factory?: FixtureFactory; timeoutMs?: number } = {}): Promise<GeneticSession> {
  const runtime = await startFixtureRuntime(factory, mode, signal);
  const registry = createRegistry({ roots: { [GENETIC_FIXTURE.rootId]: join(PROJECT_ROOT, ...GENETIC_FIXTURE.sourceSegments) }, authProfileIds: [GENETIC_FIXTURE.owner, GENETIC_FIXTURE.guest] });
  let handle: ReturnType<typeof registry.create>;
  try {
    handle = registry.create({ schemaVersion: CONTRACT_VERSION, sourceRootId: GENETIC_FIXTURE.rootId, origin: runtime.origin,
      route: GENETIC_FIXTURE.route, method: 'POST', authProfileIds: [GENETIC_FIXTURE.owner, GENETIC_FIXTURE.guest],
      allowedFields: GENETIC_FIXTURE.fields, ttlMs: Math.max(GENETIC_LIMITS.minimumTtlMs, Math.floor(deadline - Date.now())), maxTrials, maxConcurrency: CAMPAIGN.concurrency });
  } catch (error: unknown) { await runtime.close(); throw error; }
  try {
    const profiles: readonly Profile[] = [GENETIC_FIXTURE.owner, GENETIC_FIXTURE.guest].map(profileId => ({ schemaVersion: CONTRACT_VERSION, profileId,
      origin: runtime.origin, setup: [{ route: GENETIC_FIXTURE.sessionRoute, method: 'POST', values: { profile: profileId }, expectedStatus: HTTP_STATUS.ok }] }));
    const runner = createHttpRunner({ registry, contracts, profiles, timeoutMs, controls: [{ schemaVersion: CONTRACT_VERSION,
      origin: runtime.origin, route: GENETIC_FIXTURE.route, method: 'POST', authProfileId: GENETIC_FIXTURE.owner,
      seed: { schemaVersion: CONTRACT_VERSION, seedId: 'compound-normal', values: { x: 0, y: 0, z: 0 }, omitFields: [], rationale: 'Authorized owner control' },
      expectedStatus: HTTP_STATUS.ok, expectedJson: { accepted: true, completed: true } }],
      evidenceSource: { expectedSourceDigest: runtime.sourceDigest, currentSourceDigest: nextSignal => runtime.currentSourceDigest(nextSignal), read: correlation => runtime.readEvidence(correlation) } });
    const executions: GeneticExecution[] = [];
    let trials = 0;
    let inFlight: Promise<Result> | undefined;
    let closed = false;
    return {
      sourceDigest: runtime.sourceDigest,
      get trials() { return trials; },
      get executions() { return Object.freeze([...executions]); },
      evaluate(candidate: Individual, context) {
        if (closed || inFlight) return Promise.reject(Error('Session unavailable'));
        const abort = () => registry.cancel(handle);
        const evaluate = async () => {
          context.signal.throwIfAborted();
          if (Date.now() >= context.deadline) throw new GeneticEvaluationError('deadline');
          validateGenome(candidate.seed, compoundSpace);
          if (await runtime.currentSourceDigest(context.signal) !== runtime.sourceDigest) throw new GeneticEvaluationError('source_changed');
          context.signal.throwIfAborted();
          const pair = await runner.runPair(handle, { url: runtime.origin + GENETIC_FIXTURE.route, method: 'POST', authProfileId: GENETIC_FIXTURE.guest, seed: candidate.seed });
          executions.push(Object.freeze({ individualId: candidate.id, pair }));
          return pair.candidate ?? pair.control;
        };
        context.signal.addEventListener('abort', abort, { once: true });
        if (context.signal.aborted) abort();
        inFlight = evaluate().finally(() => {
          trials = registry.status(handle).trials;
          context.signal.removeEventListener('abort', abort);
          inFlight = undefined;
        });
        return inFlight;
      },
      async close() {
        if (closed) return;
        closed = true; registry.cancel(handle);
        try { await inFlight; } catch { /* The application records the stop reason; cleanup still completes. */ }
        finally { registry.dispose(handle); await runtime.close(); }
      },
    };
  } catch (error: unknown) { registry.dispose(handle); await runtime.close(); throw error; }
}
