import { assertSourceTarget, type SourceReader } from '../domain/sourceBinding';
import type { Handle, TrialRequest } from '../domain/types';
import { createSastSourceGuard } from '../adapters/sastSourceGuard';
import { createHttpRunner, type RunnerOptions } from './httpRunner';

export interface SastRunnerOptions extends Omit<RunnerOptions, 'guard' | 'evidenceSource'> {
  readonly finding: unknown; readonly scope: unknown; readonly source: SourceReader;
}
/** The returned runner cannot accept a different finding or target on a later call. */
export function createSastBoundRunner(options: SastRunnerOptions) {
  const finding = options.contracts.validate('sastMetadata', options.finding);
  const scope = options.contracts.validate('scope', options.scope);
  assertSourceTarget(finding, scope);
  const guard = createSastSourceGuard(options.source, finding, scope);
  const runner = createHttpRunner({ registry: options.registry, contracts: options.contracts, profiles: options.profiles,
    controls: options.controls ?? [], ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }), guard });
  return Object.freeze({
    async runPair(handle: Handle, input: TrialRequest) {
      const pair = await runner.runPair(handle, input);
      const observations = [pair.control.observation, pair.candidate?.observation];
      const state = observations.some(item => item?.reason === 'source_binding_failed') ? 'source_binding_failed'
        : pair.state === 'control_failed' ? 'control_failed' : pair.candidate?.observation.outcome === 'completed' ? 'completed' : 'incomplete';
      return Object.freeze({ state, finding, target: Object.freeze({ sourceRootId: scope.sourceRootId, origin: scope.origin, route: scope.route, method: scope.method }), assurance: 'static-source-only' as const, runtimeSource: 'unverified' as const, pair });
    }
  });
}
