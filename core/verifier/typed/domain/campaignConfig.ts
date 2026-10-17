export const SCENARIO_IDS = ['boundary', 'ownership', 'workflow'] as const;
export const CAMPAIGN = Object.freeze({
  defaultRandomSeed: 42, maximumRandomSeed: 4_294_967_295,
  defaultCandidates: 16, maximumCandidates: 64,
  defaultTrials: 128, maximumTrials: 1_000,
  defaultTtlMs: 120_000, maximumTtlMs: 3_600_000,
  minimumBudget: 1, trialsPerPair: 2, concurrency: 1,
  normalProfile: 'confirmed-owner', targetRecord: 'record-a', owner: 'learner-a',
  candidateSuffix: 'candidate', candidateDigits: 3,
  baselineLabel: 'demo', asciiLabel: 'a', combiningLabel: 'e\u0301', supplementaryLabel: '😀'
});
// Numerical Recipes LCG32. This orders tests; never use it for capabilities.
export const RANDOM = Object.freeze({ algorithm: 'lcg32-fisher-yates-v1', multiplier: 1_664_525, increment: 1_013_904_223, modulus: 4_294_967_296 });
export const REPORT_STORAGE = Object.freeze({
  segments: ['artifacts', 'private', 'verifier'] as readonly string[],
  fixtureSegments: ['training', 'verifier-site'] as readonly string[],
  jsonName: 'report.json', htmlName: 'report.html', pendingPrefix: '.pending-',
  timestampCharacters: 40, versionCharacters: 80, directoryMode: 0o700, fileMode: 0o600, maximumBytes: 4 * 1_048_576,
  uuidPattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
});
export const CLI_EXIT = Object.freeze({ success: 0, incomplete: 2, usage: 64, interrupted: 130 });
export const EPHEMERAL_PORT = 0;
