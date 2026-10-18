import { CONTRACT_VERSION, LIMITS } from '../domain/config';
import { responseOracle } from '../domain/responseOracle';
import type { ContractsPort, EvidencePort, Handle, Observation, RegistryPort, Result, TrialRequest } from '../domain/types';
import { createCatalog, targetKey } from '../adapters/catalog';
import { executeHttpTrial } from '../adapters/httpTrial';
import { collectEvidence } from './collectEvidence';
export interface RunnerOptions { registry: RegistryPort; contracts: ContractsPort; profiles: readonly unknown[]; controls?: readonly unknown[]; timeoutMs?: number; evidenceSource?: EvidencePort }
// Application service composes policy, transport and evidence through explicit ports.
export function createHttpRunner({ registry, contracts, profiles, controls = [], timeoutMs = LIMITS.defaultTrialTimeoutMs, evidenceSource }: RunnerOptions) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < LIMITS.minimumTimeoutMs || timeoutMs > LIMITS.maximumTrialTimeoutMs) throw Error('Invalid trial timeout');
  const catalog = createCatalog(contracts, profiles, controls);
  const evidencePort = evidenceSource ? Object.freeze({
    expectedSourceDigest: evidenceSource.expectedSourceDigest,
    currentSourceDigest: evidenceSource.currentSourceDigest.bind(evidenceSource),
    read: evidenceSource.read.bind(evidenceSource)
  }) : undefined;
  function preflight(handle: Handle, input: unknown) {
    const trial = contracts.validate('trialRequest', input); registry.check(handle, trial);
    const profile = catalog.profile(trial.authProfileId);
    if (!profile || new URL(trial.url).origin !== profile.origin) throw Error('Profile not registered for target');
    return { trial, profile };
  }
  async function execute(handle: Handle, input: TrialRequest, purpose: Observation['purpose']) {
    const { trial, profile } = preflight(handle, input);
    const grant = registry.begin(handle, trial);
    try {
      const transport = await executeHttpTrial({ registry, contracts, handle, input: trial, profile, purpose, timeoutMs, grant });
      const remainingMs = Math.min(timeoutMs - transport.observation.durationMs, transport.expiresAt - Date.now());
      const evidenceSignal = AbortSignal.any([transport.signal, AbortSignal.timeout(Math.max(0, Math.ceil(remainingMs)))]);
      const evidence = await collectEvidence(transport.observation.outcome === 'completed' && remainingMs > 0 ? evidencePort : undefined, transport.observation, contracts, evidenceSignal);
      if ((evidenceSignal.aborted || remainingMs <= 0) && transport.observation.outcome === 'completed') {
        let state: string;
        try { state = registry.status(handle).state; } catch { state = 'disposed'; }
        const cancelled = state === 'cancelled' || state === 'disposed';
        transport.observation = contracts.validate('httpObservation', { ...transport.observation, outcome: cancelled ? 'cancelled' : 'timeout', reason: cancelled ? state === 'disposed' ? 'job_disposed' : 'job_cancelled' : state === 'expired' ? 'job_expired' : 'trial_timeout' });
      }
      const feedback = contracts.validate('feedback', { schemaVersion: CONTRACT_VERSION, seedId: trial.seed.seedId, outcome: transport.observation.outcome, status: transport.observation.status, durationMs: transport.observation.durationMs, instrumentation: evidence.state === 'verified' ? 'verified' : 'unavailable', reachability: evidence.reachability, sourceDigest: evidence.sourceDigest, oracle: transport.observation.outcome === 'completed' ? responseOracle(evidence, transport.body, transport.observation.status) : 'inconclusive', controlPassed: false, evidenceIds: evidence.events.map(event => event.evidenceId), zap: 'disabled' });
      return { ...transport, evidence, feedback };
    } finally {
      try { registry.finish(handle, grant.trialId); } catch { /* dispose already removed the complete job */ }
    }
  }
  function publicResult(result: Awaited<ReturnType<typeof execute>>): Result {
    return Object.freeze({ observation: result.observation, feedback: result.feedback, evidence: result.evidence, assessment: contracts.assess(result.feedback) });
  }
  return {
    async run(handle: Handle, input: TrialRequest) { return publicResult(await execute(handle, input, 'candidate')); },
    async runPair(handle: Handle, input: TrialRequest) {
      const { trial } = preflight(handle, input);
      const url = new URL(trial.url);
      const control = catalog.control(targetKey({ origin: url.origin, route: url.pathname, method: trial.method }));
      if (!control) throw Error('No trusted normal control for target');
      const controlInput = { ...trial, authProfileId: control.authProfileId ?? trial.authProfileId, seed: control.seed };
      preflight(handle, controlInput);
      const normal = await execute(handle, controlInput, 'control');
      const bodyMatches = normal.body !== null && typeof normal.body === 'object'
        && Object.entries(control.expectedJson).every(([key, value]) => Object.hasOwn(normal.body as object, key) && Reflect.get(normal.body as object, key) === value);
      const passed = normal.observation.outcome === 'completed' && normal.observation.status === control.expectedStatus && bodyMatches
        && (!evidencePort || normal.evidence.state === 'verified' && normal.feedback.oracle === 'passed');
      if (!passed) return Object.freeze({ state: 'control_failed' as const, control: publicResult(normal), candidate: null });
      const candidate = await execute(handle, trial, 'candidate');
      candidate.feedback = contracts.validate('feedback', { ...candidate.feedback, controlPassed: true });
      return Object.freeze({ state: 'completed' as const, control: publicResult(normal), candidate: publicResult(candidate) });
    }
  };
}
