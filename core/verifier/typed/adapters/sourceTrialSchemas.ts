import { REPORT_STORAGE } from '../domain/campaignConfig';
import { CONTRACT_VERSION, LIMITS } from '../domain/config';
import { assertSourceTarget, type SourceReport } from '../domain/sourceBinding';
import { assertSastMetadata } from '../domain/sastMapping';
import type { ContractsPort } from '../domain/types';
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export function sourceTrialSchemas(base: Record<string, unknown>, result: unknown, values: unknown) {
  const target = object({ sourceRootId: { type: 'string', minLength: 1, maxLength: LIMITS.identifierLength }, origin: { type: 'string', maxLength: 200 },
    route: { type: 'string', maxLength: LIMITS.routeLength }, method: { enum: ['GET', 'POST'] } });
  return {
    sourceTrialOptions: object({ sourceDir: { type: 'string', minLength: 1, maxLength: 4096 }, finding: base.sastMetadata,
      origin: { type: 'string', maxLength: 200 }, normalValues: values, candidateValues: values,
      expectedJson: { ...(values as Record<string, unknown>), minProperties: 1 }, expectedStatus: { type: 'integer', minimum: 200, maximum: 299 }, useZap: { type: 'boolean' }, authorized: { const: true } }),
    sourceReport: object({ schemaVersion: { const: CONTRACT_VERSION }, reportId: { type: 'string', pattern: REPORT_STORAGE.uuidPattern },
      createdAt: { type: 'string', maxLength: REPORT_STORAGE.timestampCharacters }, applicationVersion: { type: 'string', minLength: 1, maxLength: REPORT_STORAGE.versionCharacters },
      state: { enum: ['source_binding_failed', 'control_failed', 'completed', 'incomplete'] }, finding: base.sastMetadata, target,
      assurance: { const: 'static-source-only' }, runtimeSource: { const: 'unverified' },
      pair: object({ state: { enum: ['completed', 'control_failed'] }, control: result, candidate: { anyOf: [result, { type: 'null' }] } }) })
  };
}
export function assertSourceReport(report: SourceReport, contracts: ContractsPort): void {
  if (!Number.isFinite(Date.parse(report.createdAt))) throw Error('Invalid source report time');
  assertSastMetadata(report.finding);
  assertSourceTarget(report.finding, report.target);
  const trials = [report.pair.control, report.pair.candidate].filter(trial => trial !== null);
  for (const trial of trials) {
    const { observation: observation, feedback } = trial;
    if (feedback.seedId !== observation.seedId || feedback.outcome !== observation.outcome || feedback.status !== observation.status ||
        feedback.oracle !== 'inconclusive' || feedback.instrumentation !== 'unavailable' || feedback.sourceDigest !== null ||
        feedback.evidenceIds.length || trial.evidence.events.length || trial.evidence.state !== 'disabled' || trial.assessment.result !== 'under_investigation') throw Error('Invalid source trial evidence');
    if (trial.zap) { contracts.validate('zapEvidence', trial.zap); if (trial.zap.state !== feedback.zap) throw Error('Invalid ZAP state'); }
    else if (feedback.zap !== 'disabled') throw Error('Missing ZAP state');
  }
  const normal = report.pair.control; const candidate = report.pair.candidate;
  if (normal.observation.purpose !== 'control' || candidate && (candidate.observation.purpose !== 'candidate' || !candidate.feedback.controlPassed ||
      candidate.observation.jobId !== normal.observation.jobId || candidate.observation.trialId === normal.observation.trialId || candidate.observation.requestId === normal.observation.requestId || candidate.observation.seedId === normal.observation.seedId)) throw Error('Invalid source trial identity');
  if (candidate?.zap?.state === 'completed' && normal.zap?.state === 'completed' && (candidate.zap.sessionId !== normal.zap.sessionId || candidate.zap.messageIds.some(id => normal.zap?.messageIds.includes(id)))) throw Error('Mixed ZAP message ownership');
  if (report.state === 'completed' && (!candidate || candidate.observation.outcome !== 'completed' || ['incomplete', 'error'].includes(candidate.feedback.zap))) throw Error('Incomplete source report');
}
