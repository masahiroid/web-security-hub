/** Fixed protocol vocabulary and operational limits of the local HTTP server. */
export const SERVER = Object.freeze({
  defaultPort: 4173,
  host: '127.0.0.1',
  /** Largest JSON request body accepted by the assessment APIs. */
  jsonLimit: '5mb',
  maximumPort: 65_535,
});
export const HTTP_STATUS = Object.freeze({ ok: 200, badRequest: 400, notFound: 404, conflict: 409, internalError: 500, unavailable: 503 });
/** Per-client limits for local file-backed report and welcome endpoints; each route gets its own store. */
export const FILE_SERVING_LIMITS = Object.freeze({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-8' as const, legacyHeaders: false });
/** Per-client ceiling for ordinary API calls; generous enough for the screens' polling, small enough to stop runaway clients. */
export const API_LIMITS = Object.freeze({ windowMs: 60_000, limit: 1_200, standardHeaders: 'draft-8' as const, legacyHeaders: false });
export const DEFAULTS = Object.freeze({
  zapUrl: 'http://127.0.0.1:8090',
  sessionsDirectory: '.golden-master',
  ruleSpecDirectory: 'rule-spec',
  exploreSessionsDirectory: 'explore-sessions',
  defaultSessionFile: 'report.html',
  defaultExploreFile: 'explore-report.html',
  generatedSpec: 'generated.spec.ts',
  testCasesYaml: 'test-cases.yaml',
  commandTimeoutMs: 3_000,
});
