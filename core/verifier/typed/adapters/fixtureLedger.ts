import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION, ID_PATTERN, LIMITS, TRANSPORT } from '../domain/config';
import type { Correlation, EvidencePoint, Oracle, ServerEvent, Snapshot } from '../domain/types';
export type HeaderMap = Readonly<Record<string, string | string[] | undefined>>;
const matches = (event: Correlation, expected: Correlation) =>
  Object.keys(TRANSPORT.headers).every(key => event[key as keyof Correlation] === expected[key as keyof Correlation]);
export function correlationFromHeaders(headers: HeaderMap): Correlation | null {
  const entries = Object.entries(TRANSPORT.headers).map(([field, header]) => [field, headers[header]] as const);
  if (!entries.every(([, value]) => typeof value === 'string' && new RegExp(ID_PATTERN).test(value))) return null;
  return Object.fromEntries(entries) as unknown as Correlation;
}
export function createFixtureLedger({ sourceDigest, instrumentation, capacity = LIMITS.evidenceEvents }: { sourceDigest: string; instrumentation: boolean; capacity?: number }) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > LIMITS.evidenceEvents) throw Error('Invalid evidence capacity');
  let events: ServerEvent[] = [];
  let finished = new Set<string>();
  let truncated = false;
  const key = (correlation: Correlation) => JSON.stringify([correlation.jobId, correlation.trialId, correlation.seedId, correlation.requestId, correlation.authProfileId]);
  return {
    record(headers: HeaderMap, point: EvidencePoint, profile: string, recordId: string | null, oracle: Oracle, mode: string) {
      const correlation = correlationFromHeaders(headers);
      if (!instrumentation || !correlation) return;
      if (events.length >= capacity) { truncated = true; return; }
      events.push(Object.freeze({ ...correlation, evidenceId: randomUUID(), point, profile, recordId, oracle, mode, sourceDigest }));
    },
    finish(headers: HeaderMap) {
      const correlation = correlationFromHeaders(headers);
      if (instrumentation && correlation && !truncated && finished.size < capacity) finished.add(key(correlation));
      else if (instrumentation && correlation && finished.size >= capacity) truncated = true;
    },
    read(correlation: Correlation): Snapshot {
      return Object.freeze({ schemaVersion: CONTRACT_VERSION, sourceDigest, instrumentation: instrumentation ? 'verified' : 'unavailable', complete: instrumentation && !truncated && finished.has(key(correlation)), events: Object.freeze(events.filter(event => matches(event, correlation))) });
    },
    reset() { events = []; finished = new Set(); truncated = false; }
  };
}
