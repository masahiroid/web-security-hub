import { CONTRACT_VERSION } from '../domain/config';
import { CAMPAIGN, RANDOM } from '../domain/campaignConfig';
import { generateFixtureCandidates } from '../domain/candidates';
import { fixtureScenarios } from '../domain/fixtureScenarios';
import { summarizeReports } from '../domain/reportSummary';
import type { CampaignRegistry, CampaignState, Execution, PairRunner, Progress, Report, ReportStore, RunOptions, Runtime, Scenario, ScenarioReport } from '../domain/campaignTypes';
import type { ContractsPort, Handle } from '../domain/types';
export interface CampaignPorts {
  readonly contracts: ContractsPort; readonly registry: CampaignRegistry; readonly store: ReportStore;
  readonly sourceRootId: string; readonly applicationVersion: string;
  readonly now: () => number; readonly reportId: () => string;
  startRuntime(mode: RunOptions['mode'], signal: AbortSignal): Promise<Runtime>;
  runner(scenario: Scenario, runtime: Runtime): PairRunner;
}
export async function runFixtureCampaign(ports: CampaignPorts, input: unknown, signal: AbortSignal, onProgress?: (progress: Progress) => undefined) {
  const options = ports.contracts.validate('runOptions', input);
  const createdAt = ports.now(); const expiresAt = createdAt + options.ttlMs;
  const plans = fixtureScenarios(options.scenario).map(definition => {
    const executions: Execution[] = [];
    return { definition, report: { scenarioId: definition.id, route: definition.route, method: definition.method, plan: generateFixtureCandidates(definition, options.randomSeed, options.maxCandidates), executions } };
  });
  const scenarios: ScenarioReport[] = plans.map(plan => plan.report); let trials = 0;
  let state: CampaignState = signal.aborted ? 'cancelled' : 'completed';
  let runtime: Runtime | undefined;
  const stopState = (handle?: Handle): CampaignState => signal.aborted ? 'cancelled' : ports.now() >= expiresAt || handle && ports.registry.status(handle).state === 'expired' ? 'expired' : 'error';
  try {
    if (!signal.aborted) {
      runtime = await ports.startRuntime(options.mode, signal);
      for (const { definition: scenario, report: scenarioReport } of plans) {
        if (state !== 'completed') break;
        const { plan, executions } = scenarioReport;
        if (signal.aborted || ports.now() >= expiresAt) { state = stopState(); break; }
        if (options.maxTrials - trials < CAMPAIGN.trialsPerPair) { state = 'budget_exhausted'; break; }
        const handle = ports.registry.create({ schemaVersion: CONTRACT_VERSION, sourceRootId: ports.sourceRootId, origin: runtime.origin, route: scenario.route, method: scenario.method, authProfileIds: [...new Set([scenario.normalProfileId, ...scenario.candidateProfiles])], allowedFields: scenario.allowedFields, ttlMs: Math.max(CAMPAIGN.minimumBudget, expiresAt - ports.now()), maxTrials: options.maxTrials - trials, maxConcurrency: CAMPAIGN.concurrency });
        const cancel = () => ports.registry.cancel(handle);
        signal.addEventListener('abort', cancel, { once: true });
        try {
          if (signal.aborted) cancel();
          const runner = ports.runner(scenario, runtime);
          for (const candidate of plan) {
            if (signal.aborted || ports.now() >= expiresAt) { state = stopState(handle); break; }
            if (options.maxTrials - trials < CAMPAIGN.trialsPerPair) { state = 'budget_exhausted'; break; }
            const before = ports.registry.status(handle).trials;
            try {
              const pair = await runner.runPair(handle, { url: runtime.origin + scenario.route, method: scenario.method, authProfileId: candidate.authProfileId, seed: candidate.seed });
              executions.push({ candidateId: candidate.seed.seedId, control: pair.control, candidate: pair.candidate });
              const last = pair.candidate ?? pair.control;
              if (signal.aborted || last.observation.outcome === 'cancelled') state = 'cancelled';
              else if (ports.now() >= expiresAt || last.observation.reason === 'job_expired') state = 'expired';
              else if (last.observation.outcome === 'timeout') state = 'timeout';
              else if (last.evidence.state === 'source_mismatch') state = 'source_changed';
              else if (pair.state === 'control_failed') state = 'control_failed';
              else if (last.observation.outcome === 'error') state = 'error';
            } catch { state = stopState(handle); }
            finally { trials += ports.registry.status(handle).trials - before; }
            const totals = summarizeReports(scenarios, trials);
            try { onProgress?.({ scenarioId: scenario.id, candidateId: candidate.seed.seedId, executed: totals.executed, planned: totals.planned }); } catch { /* Observers cannot change verdicts. */ }
            if (state !== 'completed') break;
          }
        } finally { signal.removeEventListener('abort', cancel); ports.registry.dispose(handle); }
      }
    }
  } catch { state = stopState(); }
  finally {
    if (runtime) { try { await runtime.close(); } catch { state = 'error'; } }
  }
  if (signal.aborted) state = 'cancelled';
  const report: Report = ports.contracts.validate('report', { schemaVersion: CONTRACT_VERSION, reportId: ports.reportId(), createdAt: new Date(createdAt).toISOString(), applicationVersion: ports.applicationVersion, mode: options.mode, sourceDigest: runtime?.sourceDigest ?? null, executionKind: 'direct-http', prngAlgorithm: RANDOM.algorithm, options, state, scenarios, totals: summarizeReports(scenarios, trials), draft: true, vexStatus: 'under_investigation' });
  const saved = await ports.store.save(report);
  return Object.freeze({ report, saved });
}
