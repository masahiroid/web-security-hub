/** Pre-fixed comparison conditions; changing them changes the experiment, so they are versioned. */
export const COMPARISON = Object.freeze({
  schemaVersion: 1,
  seeds: Object.freeze([11, 23, 37, 41, 53, 67]),
  modes: Object.freeze(['changed', 'fixed'] as const),
  maximumSeeds: 20,
  /**
   * A campaign that ends because the environment failed (not because of the method) is retried after a cooldown.
   * Sustained fresh-connection churn can exhaust the OS ephemeral ports; 32 s exceeds the 30 s TIME_WAIT window of macOS.
   */
  retries: 1, cooldownMs: 32_000,
  validStops: Object.freeze(['generation_limit', 'stagnation', 'trial_budget', 'diversity_exhausted'] as const),
});
