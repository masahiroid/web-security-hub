import type { Fitness, GeneticSettings, Metric } from './geneticTypes';
import type { EvidencePoint, Result } from './types';
import { CORRELATION_FIELDS } from './zap';

const unavailable: Metric = Object.freeze({ state: 'unavailable', value: null });
const observed = (value: number): Extract<Metric, { state: 'observed' }> => Object.freeze({ state: 'observed', value });
function rejected(reason: Fitness['reason']): Fitness {
  return Object.freeze({ score: 0, eligible: false, reason, reachability: unavailable,
    coverage: unavailable, novelty: unavailable, zap: unavailable, noveltyKeys: Object.freeze([]) });
}
/** Validated, correlated evidence provides search priority, never a verdict. */
export function evaluateGeneticFitness(result: Result, seen: ReadonlySet<string>, weights: GeneticSettings['weights'], coveragePoints: readonly EvidencePoint[] = []): Fitness {
  const { observation, feedback, evidence } = result;
  if (!feedback.controlPassed) return rejected('invalid_control');
  if (observation.outcome !== 'completed' || feedback.outcome !== 'completed' || !observation.dispatched || feedback.seedId !== observation.seedId) return rejected('invalid_observation');
  if (evidence.state !== 'verified' || feedback.instrumentation !== 'verified' || !evidence.sourceDigest || feedback.sourceDigest !== evidence.sourceDigest ||
      evidence.events.some(event => event.sourceDigest !== evidence.sourceDigest || CORRELATION_FIELDS.some(field => event[field] !== observation[field]))) return rejected('unverified_evidence');
  const keys = new Set(evidence.events.map(event => `point:${event.point}`));
  const noveltyKeys = [...keys].filter(key => !seen.has(key)).sort();
  const reachability = evidence.reachability === 'unavailable' ? unavailable : observed(evidence.reachability === 'observed' ? 1 : 0);
  let zap: Metric = unavailable;
  if (feedback.zap === 'incomplete' || result.zap?.state === 'incomplete') zap = Object.freeze({ state: 'incomplete', value: null });
  else if (feedback.zap === 'completed' && result.zap?.state === 'completed' && result.zap.reason === 'none' && result.zap.sessionId) {
    const alerts = new Set(result.zap.alerts.filter(alert => result.zap?.messageIds.includes(alert.messageId)).map(alert => `zap:${alert.fingerprint}`));
    const newAlerts = [...alerts].filter(key => !seen.has(key));
    noveltyKeys.push(...newAlerts);
    zap = observed(newAlerts.length);
  }
  const coverage = coveragePoints.length ? observed(coveragePoints.filter(point => keys.has(`point:${point}`)).length / coveragePoints.length) : unavailable;
  const novelty = observed(noveltyKeys.filter(key => key.startsWith('point:')).length);
  return Object.freeze({ eligible: true, reason: 'valid_observation',
    score: ((reachability.value ?? 0) + (coverage.value ?? 0)) * weights.reachability + novelty.value * weights.novelty + (zap.value ?? 0) * weights.zap,
    reachability, coverage, novelty, zap, noveltyKeys: Object.freeze(noveltyKeys.sort()) });
}
