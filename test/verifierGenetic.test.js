const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultGeneticSettings, GENETIC_LIMITS } = require('../core/verifier/generated/domain/geneticConfig');
const { validateGeneticSettings } = require('../core/verifier/generated/adapters/geneticSettings');
const { evaluateGeneticFitness } = require('../core/verifier/generated/domain/geneticFitness');

const correlation = Object.freeze({ jobId: 'job-a', trialId: 'trial-a', seedId: 'seed-a', requestId: 'request-a', authProfileId: 'owner-a' });
const observation = Object.freeze({ ...correlation, schemaVersion: 1, purpose: 'candidate', executionKind: 'direct-http', outcome: 'completed', reason: 'none', status: 200, durationMs: 1, dispatched: true, setupRequests: 0, redirect: 'none' });
const event = Object.freeze({ ...correlation, evidenceId: 'event-a', point: 'record-read', profile: 'owner-a', recordId: 'record-a', oracle: 'passed', sourceDigest: 'digest-a', mode: 'baseline' });
function result() {
  return {
    observation: { ...observation },
    feedback: { schemaVersion: 1, seedId: correlation.seedId, outcome: 'completed', status: 200, durationMs: 1, instrumentation: 'verified', reachability: 'observed', sourceDigest: 'digest-a', oracle: 'passed', controlPassed: true, evidenceIds: ['event-a'], zap: 'disabled' },
    evidence: { state: 'verified', reachability: 'observed', sourceDigest: 'digest-a', oracle: 'passed', events: [{ ...event }] },
    assessment: { schemaVersion: 1, seedId: correlation.seedId, result: 'no_issue_observed_in_scope', vexStatus: 'under_investigation', draft: true, evidenceIds: ['event-a'] },
  };
}
const weights = defaultGeneticSettings().weights;

test('genetic settings reject unbounded input and scope injection, copy and freeze valid settings', () => {
  const input = structuredClone(defaultGeneticSettings());
  const validated = validateGeneticSettings(input);
  assert.deepEqual(validated, input);
  input.weights.zap = 99;
  assert.equal(validated.weights.zap, weights.zap);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.weights), true);
  for (const change of [
    { population: GENETIC_LIMITS.maximumPopulation + 1 }, { population: 1 }, { population: 2.5 },
    { version: 'future' }, { selection: 'unbounded' }, { generations: 0 }, { elite: input.population }, { tournament: 1 },
    { mutationRate: NaN }, { crossoverRate: Infinity }, { minimumDiversity: -0.1 },
    { stagnationGenerations: input.generations + 1 }, { randomSeed: -1 }, { maxTrials: 1 },
    { ttlMs: Infinity }, { ttlMs: '120000' }, { origin: 'https://untrusted.example' },
    { authProfileId: 'admin' }, { weights: { reachability: 0, novelty: 0, zap: 0 } },
    { weights: { ...weights, status: 100 } }, { weights: { ...weights, zap: NaN } },
  ]) assert.throws(() => validateGeneticSettings({ ...defaultGeneticSettings(), ...change }));
  for (const invalid of [null, [], {}, true, 'settings']) assert.throws(() => validateGeneticSettings(invalid));
  assert.throws(() => validateGeneticSettings({ ...input, weights: null }));
});

test('fitness distinguishes missing measurements from zero without changing vulnerability decisions', () => {
  const input = result();
  const original = structuredClone(input);
  const fitness = evaluateGeneticFitness(input, new Set(), weights);
  assert.equal(fitness.score, weights.reachability + weights.novelty);
  assert.deepEqual(fitness.coverage, { state: 'unavailable', value: null });
  assert.deepEqual(fitness.zap, { state: 'unavailable', value: null });
  assert.deepEqual(input, original);
  input.evidence.reachability = 'unavailable';
  assert.deepEqual(evaluateGeneticFitness(input, new Set(), weights).reachability, { state: 'unavailable', value: null });
  input.evidence.reachability = 'not_observed';
  assert.deepEqual(evaluateGeneticFitness(input, new Set(), weights).reachability, { state: 'observed', value: 0 });
  input.feedback.zap = 'incomplete';
  assert.deepEqual(evaluateGeneticFitness(input, new Set(), weights).zap, { state: 'incomplete', value: null });
});

test('HTTP statuses alone do not earn fitness and repeated semantic evidence earns no novelty', () => {
  const input = result();
  const score = evaluateGeneticFitness(input, new Set(), weights).score;
  for (const status of [200, 401, 403, 404, 500, 503]) {
    input.observation.status = status;
    input.feedback.status = status;
    assert.equal(evaluateGeneticFitness(input, new Set(), weights).score, score);
  }
  input.evidence.events.push({ ...event, evidenceId: 'event-b' });
  const first = evaluateGeneticFitness(input, new Set(), weights);
  assert.equal(first.novelty.value, 1);
  assert.equal(evaluateGeneticFitness(input, new Set(first.noveltyKeys), weights).novelty.value, 0);
});

test('failed controls, transport failures and foreign evidence are excluded from selection fitness', () => {
  for (const mutate of [
    value => { value.feedback.controlPassed = false; },
    value => { value.observation.outcome = 'timeout'; },
    value => { value.observation.dispatched = false; },
    value => { value.feedback.seedId = 'another-seed'; },
    value => { value.evidence.state = 'incomplete'; },
    value => { value.feedback.instrumentation = 'unavailable'; },
    value => { value.feedback.sourceDigest = 'changed-digest'; },
    ...Object.keys(correlation).map(key => value => { value.evidence.events[0][key] = 'foreign'; }),
    value => { value.evidence.events[0].sourceDigest = 'foreign'; },
  ]) {
    const input = result(); mutate(input);
    const fitness = evaluateGeneticFitness(input, new Set(), weights);
    assert.equal(fitness.eligible, false);
    assert.equal(fitness.score, 0);
    assert.equal(fitness.noveltyKeys.length, 0);
  }
});

test('only completed message-bound ZAP evidence contributes deduplicated novelty', () => {
  const input = result();
  input.feedback.zap = 'completed';
  input.zap = { state: 'completed', reason: 'none', sessionId: 'session-a', messageIds: ['message-a'], alerts: [
    { fingerprint: 'alert-a', messageId: 'message-a', pluginId: '10021', risk: 1, confidence: 2 },
    { fingerprint: 'alert-a', messageId: 'message-a', pluginId: '10021', risk: 1, confidence: 2 },
    { fingerprint: 'alert-foreign', messageId: 'message-b', pluginId: '10021', risk: 1, confidence: 2 },
  ] };
  const first = evaluateGeneticFitness(input, new Set(), weights);
  assert.equal(first.zap.value, 1);
  assert.equal(evaluateGeneticFitness(input, new Set(first.noveltyKeys), weights).zap.value, 0);
  input.zap.state = 'incomplete';
  assert.deepEqual(evaluateGeneticFitness(input, new Set(), weights).zap, { state: 'incomplete', value: null });
});
