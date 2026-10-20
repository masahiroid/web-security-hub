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
