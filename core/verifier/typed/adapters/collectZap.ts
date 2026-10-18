import type { ContractsPort, Observation, TrialRequest } from '../domain/types';
import { zapUnavailable, type ZapEvidence, type ZapPort } from '../domain/zap';

export async function collectZap(port: ZapPort, observation: Observation, trial: TrialRequest, signal: AbortSignal, contracts: ContractsPort): Promise<ZapEvidence> {
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(Error('ZAP collection interrupted')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
  try {
    signal.throwIfAborted();
    return contracts.validate('zapEvidence', await Promise.race([port.collect(observation, trial, signal), cancelled]));
  } catch { return zapUnavailable(signal.aborted ? 'incomplete' : 'error', signal.aborted ? 'queue_pending' : 'unavailable'); }
  finally { signal.removeEventListener('abort', abort); }
}
