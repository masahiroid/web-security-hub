/** Pre-fixed comparison conditions; changing them changes the experiment, so they are versioned. */
export const COMPARISON = Object.freeze({
  schemaVersion: 1,
  seeds: Object.freeze([11, 23, 37, 41, 53, 67]),
  modes: Object.freeze(['changed', 'fixed'] as const),
  maximumSeeds: 20,
});
