// Fixed teaching protocol. The fixture contains a deliberately unused TLS flag.
export const SAST_FIXTURE = Object.freeze({
  rootId: 'sast-sample', file: 'sastFixtureApp.js', route: '/inspect', method: 'POST' as const,
  profileId: 'anonymous', field: 'label', normalLabel: 'normal',
  controlSeed: 'sast-normal', candidateSeed: 'sast-empty', ttlMs: 10_000,
  maxTrials: 2, maxConcurrency: 1, ruleId: 'SAST-TLS-DISABLED'
});
