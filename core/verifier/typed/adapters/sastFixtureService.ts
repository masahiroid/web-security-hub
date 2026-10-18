import { createServer } from 'node:http';
import * as contracts from '../../contracts';
import { createRegistry } from '../../policies';
import { CONTRACT_VERSION, FIXTURE, HTTP_STATUS } from '../domain/config';
import { SAST_FIXTURE as SAMPLE } from '../domain/sastFixtureConfig';
import { staticMatches } from '../domain/staticRules';
import { createSastBoundRunner } from '../application/sastBoundRunner';
import { createConfinedSourceReader } from './confinedSourceReader';
import { createStaticFileAnalysis } from './staticFileAnalysis';
import app = require('./sastFixtureApp');

/** Only the compiled, shipped teaching app is started. No arbitrary source/URL input. */
export async function runSastFixture(signal: AbortSignal) {
  signal.throwIfAborted();
  const source = await createConfinedSourceReader({ [SAMPLE.rootId]: __dirname });
  const bytes = await source.read(SAMPLE.rootId, SAMPLE.file, signal);
  const match = [...staticMatches(Buffer.from(bytes).toString('utf8'))].find(item => item.id === SAMPLE.ruleId);
  if (!match) throw Error('Missing teaching finding');
  const finding = createStaticFileAnalysis(bytes, SAMPLE.file).at(match.id, match.startOffset, match.endOffset);
  const server = createServer(app);
  const registry = createRegistry({ roots: { [SAMPLE.rootId]: __dirname }, authProfileIds: [SAMPLE.profileId] });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, FIXTURE.host, () => { server.removeListener('error', reject); resolve(); });
    });
    signal.throwIfAborted(); const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing fixture address');
    const origin = `http://${FIXTURE.host}:${address.port}`;
    const scope = contracts.validate('scope', { schemaVersion: CONTRACT_VERSION, sourceRootId: SAMPLE.rootId,
      origin, route: SAMPLE.route, method: SAMPLE.method, authProfileIds: [SAMPLE.profileId], allowedFields: [SAMPLE.field],
      ttlMs: SAMPLE.ttlMs, maxTrials: SAMPLE.maxTrials, maxConcurrency: SAMPLE.maxConcurrency });
    const seed = (seedId: string, label: string) => ({ schemaVersion: CONTRACT_VERSION, seedId,
      values: { [SAMPLE.field]: label }, omitFields: [], rationale: 'Known teaching input' });
    const runner = createSastBoundRunner({ contracts, registry, source, finding, scope,
      profiles: [{ schemaVersion: CONTRACT_VERSION, profileId: SAMPLE.profileId, origin, setup: [] }],
      controls: [{ schemaVersion: CONTRACT_VERSION, origin, route: SAMPLE.route, method: SAMPLE.method,
        seed: seed(SAMPLE.controlSeed, SAMPLE.normalLabel), expectedStatus: HTTP_STATUS.ok, expectedJson: { accepted: true } }] });
    const handle = registry.create(scope); const cancel = () => registry.cancel(handle);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) cancel();
      return await runner.runPair(handle, { url: origin + SAMPLE.route, method: SAMPLE.method,
        authProfileId: SAMPLE.profileId, seed: seed(SAMPLE.candidateSeed, '') });
    } finally { signal.removeEventListener('abort', cancel); registry.dispose(handle); }
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }
}
