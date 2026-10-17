// Policy defaults live here; factories accept bounded operational overrides.
export const CONTRACT_VERSION = 1;
export const DIGEST_ALGORITHM = 'sha256';
export const LIMITS = Object.freeze({
  defaultTrialTimeoutMs: 5_000, maximumTrialTimeoutMs: 60_000,
  minimumTimeoutMs: 1, jsonPayloadBytes: 65_536, feedbackEvidenceCount: 100, responseInspectionBytes: 65_536,
  evidenceEvents: 10_000, profileSetupSteps: 4, identifierLength: 80,
  digestHexLength: 64, sourceFileBytes: 1_048_576
});
export const HTTP_STATUS = Object.freeze({
  ok: 200, unauthorized: 401, forbidden: 403, notFound: 404, conflict: 409,
  invalidInput: 422, badRequest: 400, capacity: 429,
  redirectMinimum: 300, redirectLimit: 400
});
export const TRANSPORT = Object.freeze({
  protocol: 'http:', loopbackHosts: ['127.0.0.1', '[::1]'] as readonly string[],
  maxRedirects: 0, maxRetries: 0, jsonContentType: 'application/json',
  headers: Object.freeze({ jobId: 'x-verifier-job-id', trialId: 'x-verifier-trial-id',
    seedId: 'x-verifier-seed-id', requestId: 'x-verifier-request-id', authProfileId: 'x-verifier-profile-id' })
});
export const FIXTURE = Object.freeze({
  port: 4181, host: '127.0.0.1', sessionCapacity: 1_000, sessionTokenBytes: 24,
  controlTokenBytes: 32, jsonLimit: '16kb', controlHeader: 'x-fixture-control',
  modes: ['baseline', 'changed', 'fixed'] as const,
  roles: ['learner-a', 'learner-b', 'admin', 'anonymous'] as const,
  records: Object.freeze({ 'record-a': 'learner-a', 'record-b': 'learner-b' }),
  admin: 'admin', anonymous: 'anonymous', changedMode: 'changed', initialMode: 'baseline',
  participantsMinimum: 1, participantsMaximum: 5, labelMinimum: 1, labelMaximum: 10,
  routes: Object.freeze({ control: '/control', session: '/session', record: '/records/:id', confirm: '/records/:id/confirm', complete: '/records/:id/complete', boundary: '/boundary' }),
  normalization: 'NFC' as const, syntheticValue: 'synthetic-record'
});
export const POINTS = Object.freeze({ blocked: 'guard-blocked', read: 'record-read',
  commit: 'record-commit', confirm: 'confirmation-recorded', boundary: 'boundary-checked' } as const);
export const ID_PATTERN = `^[a-zA-Z0-9_-]{1,${LIMITS.identifierLength}}$`;
export const DIGEST_PATTERN = `^[a-f0-9]{${LIMITS.digestHexLength}}$`;
