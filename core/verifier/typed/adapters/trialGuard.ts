import { SourceBindingError, type TrialGuard } from '../domain/sourceBinding';
import type { TrialGrant, TrialRequest } from '../domain/types';

/** Bound even a reader that ignores cancellation; remove listeners after every check. */
export async function verifyTrialGuard(guard: TrialGuard | undefined, grant: TrialGrant, input: TrialRequest, signal: AbortSignal): Promise<void> {
  if (!guard) return;
  signal.throwIfAborted();
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new SourceBindingError());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { await Promise.race([guard.verify(grant, input, signal), cancelled]); signal.throwIfAborted(); }
  finally { signal.removeEventListener('abort', abort); }
}
