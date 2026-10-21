import type { Fitness, GeneticStop } from '../domain/geneticTypes';
import type { Result } from '../domain/types';

/** Why one evaluated candidate must end the search, or null to continue. Shared by every search strategy. */
export function evaluationStop(result: Result, fitness: Fitness): GeneticStop | null {
  if (result.evidence.state === 'source_mismatch') return 'source_changed';
  if (result.observation.outcome === 'timeout') return 'timeout';
  if (!result.feedback.controlPassed) return 'control_failed';
  if (result.observation.outcome !== 'completed') return 'error';
  if (result.feedback.zap === 'incomplete') return 'zap_incomplete';
  return fitness.eligible ? null : 'unverified_evidence';
}
/** Bound waiting even when an adapter ignores abort. The adapter still owns transport cleanup. */
export async function awaitGeneticEvaluation<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(Error('Genetic evaluation interrupted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([operation(), interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}
