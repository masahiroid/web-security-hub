import { isAbsolute } from 'node:path';
import * as contracts from '../../contracts';
import { createRegistry } from '../../policies';
import { CONTRACT_VERSION } from '../domain/config';
import { ZAP } from '../domain/zap';
import { SOURCE_TRIAL } from '../domain/sourceBinding';
import { createConfinedSourceReader } from './confinedSourceReader';
import { createSastBoundRunner } from '../application/sastBoundRunner';
import { startOwnedZap } from './ownedZapRuntime';

/** User-selected local source and explicitly authorized numeric-loopback target. Never loads source code. */
export async function runSourceTarget(input: unknown, dataRoot: string, signal: AbortSignal) {
  const options = contracts.validate('sourceTrialOptions', input); signal.throwIfAborted();
  if (!isAbsolute(options.sourceDir)) throw Error('Absolute source root required');
  const source = await createConfinedSourceReader({ [SOURCE_TRIAL.rootId]: options.sourceDir });
  const route = options.finding.routeMapping.routes[0];
  if (!route || route.parameterized || options.finding.routeMapping.status !== 'mapped' || !['GET', 'POST'].includes(route.method)) throw Error('Unique literal supported route required');
  const registry = createRegistry({ roots: { [SOURCE_TRIAL.rootId]: options.sourceDir }, authProfileIds: [SOURCE_TRIAL.profileId] });
  const scope = contracts.validate('scope', { schemaVersion: CONTRACT_VERSION, sourceRootId: SOURCE_TRIAL.rootId, origin: options.origin,
    route: route.path, method: route.method, authProfileIds: [SOURCE_TRIAL.profileId],
    allowedFields: [...new Set([...Object.keys(options.normalValues), ...Object.keys(options.candidateValues)])],
    ttlMs: SOURCE_TRIAL.ttlMs, maxTrials: SOURCE_TRIAL.maxTrials, maxConcurrency: SOURCE_TRIAL.maxConcurrency });
  const handle = registry.create(scope); const cancel = () => registry.cancel(handle); signal.addEventListener('abort', cancel, { once: true });
  let engine: Awaited<ReturnType<typeof startOwnedZap>> | undefined;
  try {
    if (signal.aborted) cancel();
    if (options.useZap) engine = await startOwnedZap(dataRoot, signal);
    const seed = (seedId: string, values: typeof options.normalValues) => ({ schemaVersion: CONTRACT_VERSION, seedId, values, omitFields: [], rationale: 'Explicit local source verification input' });
    const runner = createSastBoundRunner({ contracts, registry, source, finding: options.finding, scope, timeoutMs: engine ? ZAP.passiveMs : SOURCE_TRIAL.timeoutMs,
      ...(engine ? { zap: engine.port } : {}), profiles: [{ schemaVersion: CONTRACT_VERSION, profileId: SOURCE_TRIAL.profileId, origin: options.origin, setup: [] }],
      controls: [{ schemaVersion: CONTRACT_VERSION, origin: options.origin, route: scope.route, method: scope.method,
        seed: seed(SOURCE_TRIAL.controlId, options.normalValues), expectedStatus: options.expectedStatus, expectedJson: options.expectedJson }] });
    return await runner.runPair(handle, { url: scope.origin + scope.route, method: scope.method, authProfileId: SOURCE_TRIAL.profileId, seed: seed(SOURCE_TRIAL.candidateId, options.candidateValues) });
  } finally { signal.removeEventListener('abort', cancel); registry.dispose(handle); await engine?.close(); }
}
