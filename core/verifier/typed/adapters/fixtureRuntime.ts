import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FIXTURE } from '../domain/config';
import { EPHEMERAL_PORT } from '../domain/campaignConfig';
import type { Mode, Runtime } from '../domain/campaignTypes';
import type { Correlation } from '../domain/types';
export interface FixtureInstance { readonly app: (request: IncomingMessage, response: ServerResponse) => void; readonly sourceDigest: string; currentSourceDigest(signal: AbortSignal): Promise<string>; readEvidence(correlation: Correlation): unknown }
export type FixtureFactory = (options: { initialMode: Mode }) => FixtureInstance;
export async function startFixtureRuntime(factory: FixtureFactory, mode: Mode, signal: AbortSignal): Promise<Runtime> {
  signal.throwIfAborted();
  const fixture = factory({ initialMode: mode });
  const server = createServer(fixture.app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(EPHEMERAL_PORT, FIXTURE.host, () => { server.removeListener('error', reject); resolve(); });
    });
    signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Fixture did not bind loopback');
    return {
      origin: `http://${FIXTURE.host}:${address.port}`, sourceDigest: fixture.sourceDigest,
      currentSourceDigest: nextSignal => fixture.currentSourceDigest(nextSignal), readEvidence: async correlation => fixture.readEvidence(correlation),
      close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); })
    };
  } catch (error: unknown) { server.close(); server.closeAllConnections(); throw error; }
}
