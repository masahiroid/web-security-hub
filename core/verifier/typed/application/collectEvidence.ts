import { DIGEST_PATTERN, POINTS, LIMITS } from '../domain/config';
import type { ContractsPort, Correlation, EvidencePort, EvidenceResult, EvidenceState } from '../domain/types';
function unavailable(state: EvidenceState): EvidenceResult {
  return Object.freeze({ state, reachability: 'unavailable', sourceDigest: null, oracle: 'inconclusive', events: Object.freeze([]) });
}
async function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((resolve, reject) => {
    void resolve;
    abort = () => reject(Error('Evidence collection interrupted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([operation, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}
export async function collectEvidence(port: EvidencePort | undefined, correlation: Correlation, contracts: ContractsPort, signal: AbortSignal): Promise<EvidenceResult> {
  if (!port) return unavailable('disabled');
  try {
    signal.throwIfAborted();
    if (!new RegExp(DIGEST_PATTERN).test(port.expectedSourceDigest)) return unavailable('source_mismatch');
    const before = await bounded(port.currentSourceDigest(signal), signal);
    if (before !== port.expectedSourceDigest) return unavailable('source_mismatch');
    const snapshot = contracts.validate('serverSnapshot', await bounded(port.read(correlation, signal), signal));
    const after = await bounded(port.currentSourceDigest(signal), signal);
    if (snapshot.sourceDigest !== before || after !== before) return unavailable('source_mismatch');
    if (snapshot.instrumentation !== 'verified') return unavailable('unavailable');
    if (!snapshot.complete || !snapshot.events.length || snapshot.events.length > LIMITS.feedbackEvidenceCount) return unavailable('incomplete');
    const fields = ['jobId', 'trialId', 'seedId', 'requestId', 'authProfileId'] as const;
    if (snapshot.events.some(event => event.sourceDigest !== before)) return unavailable('source_mismatch');
    if (snapshot.events.some(event => fields.some(key => event[key] !== correlation[key]))) return unavailable('incomplete');
    if (new Set(snapshot.events.map(event => event.evidenceId)).size !== snapshot.events.length || new Set(snapshot.events.map(event => event.mode)).size !== 1) return unavailable('incomplete');
    const observed = snapshot.events.some(event => event.point === POINTS.read || event.point === POINTS.commit || event.point === POINTS.boundary || event.point === POINTS.confirm);
    const blocked = snapshot.events.some(event => event.point === POINTS.blocked);
    if (observed && blocked || !observed && !blocked) return unavailable('incomplete');
    const oracle = snapshot.events.some(event => event.oracle === 'violated') ? 'violated'
      : snapshot.events.every(event => event.oracle === 'passed') ? 'passed' : 'inconclusive';
    return Object.freeze({ state: 'verified', reachability: observed ? 'observed' : 'not_observed', sourceDigest: before, oracle, events: snapshot.events });
  } catch { return unavailable(signal.aborted ? 'incomplete' : 'error'); }
}
