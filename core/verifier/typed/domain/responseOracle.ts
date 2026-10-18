import { FIXTURE, HTTP_STATUS, POINTS } from './config';
import type { EvidenceResult, Oracle } from './types';
export function responseOracle(evidence: EvidenceResult, body: unknown, status: number | null): Oracle {
  if (evidence.state !== 'verified') return 'inconclusive';
  const object = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : null;
  for (const event of evidence.events) {
    if (event.point === POINTS.read) {
      // Sink execution alone is insufficient: the response must disclose the fixture record.
      if (!object || status !== HTTP_STATUS.ok || Reflect.get(object, 'id') !== event.recordId
        || Reflect.get(object, 'value') !== FIXTURE.syntheticValue || event.recordId === null
        || Reflect.get(object, 'owner') !== Reflect.get(FIXTURE.records, event.recordId)) return 'inconclusive';
    }
    if (event.point === POINTS.boundary && (!object || typeof Reflect.get(object, 'accepted') !== 'boolean')) return 'inconclusive';
    if (event.point === POINTS.confirm && (!object || Reflect.get(object, 'confirmed') !== true)) return 'inconclusive';
    // A commit event is emitted only after the actual fake state mutation.
  }
  return evidence.oracle;
}
