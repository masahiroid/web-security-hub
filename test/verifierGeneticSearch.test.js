const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultGeneticSettings } = require('../core/verifier/generated/domain/geneticConfig');
const { geneticRandom, individual, nextPopulation } = require('../core/verifier/generated/domain/geneticEvolution');
const { makeGenome, crossGenome, mutateGenome, validateGenome, validateGenomeSpace, genomeKey } = require('../core/verifier/generated/domain/geneticGenome');
const { createGeneticSearch } = require('../core/verifier/generated/application/geneticSearch');
const space = validateGenomeSpace([
  { field: 'count', values: [0, 1, 2, 3], optional: false },
  { field: 'label', values: ['', 'a', '😀', 'e\u0301'], optional: true },
  { field: 'confirmed', values: [false, true], optional: false },
]);
const settings = changes => ({ ...defaultGeneticSettings(), population: 4, elite: 1, tournament: 4, generations: 4, stagnationGenerations: 3, ...changes });
const initial = [
  makeGenome('a', [0, '', false], space), makeGenome('b', [1, 'a', true], space),
  makeGenome('c', [2, '😀', false], space), makeGenome('d', [3, undefined, true], space),
];
function response(candidate, point = 'record-read') {
  const ids = { jobId: 'job', trialId: candidate.id, requestId: candidate.id, seedId: candidate.seed.seedId, authProfileId: 'fixed-owner' };
  return {
    observation: { ...ids, outcome: 'completed', dispatched: true },
    feedback: { seedId: ids.seedId, outcome: 'completed', controlPassed: true, instrumentation: 'verified', sourceDigest: 'digest', zap: 'disabled' },
    evidence: { state: 'verified', sourceDigest: 'digest', reachability: 'observed', events: [{ ...ids, point, sourceDigest: 'digest' }] },
  };
}
const request = changes => ({ settings: settings(), space, initial, signal: new AbortController().signal, ...changes });
const fitness = score => ({ eligible: true, score });
const evaluated = initial.map((seed, index) => ({ individual: individual(`initial-${index}`, 0, seed, 'initial', [], space), fitness: fitness(index) }));

test('typed operators inherit both parents, mutate values/omissions and preserve input', () => {
  const before = structuredClone(initial);
  const random = geneticRandom(42);
  const crossed = crossGenome('cross', initial[0], initial[1], space, random);
  assert.notEqual(genomeKey(crossed, space), genomeKey(initial[0], space));
  assert.notEqual(genomeKey(crossed, space), genomeKey(initial[1], space));
  for (let index = 0; index < 100; index++) {
    const mutated = mutateGenome('mutation', initial[0], space, random);
    validateGenome(mutated, space);
    assert.notEqual(genomeKey(mutated, space), genomeKey(initial[0], space));
  }
  const nullable = validateGenomeSpace([{ field: 'x', values: [null], optional: true }]);
  const present = makeGenome('null', [null], nullable);
  const missing = mutateGenome('omitted', present, nullable, random);
  validateGenome(missing, nullable);
  assert.deepEqual(missing.omitFields, ['x']);
  assert.notEqual(genomeKey(present, nullable), genomeKey(missing, nullable));
  assert.deepEqual(initial, before);
  assert.throws(() => validateGenome({ ...initial[0], values: { ...initial[0].values, authProfileId: 'admin' } }, space));
  assert.throws(() => validateGenome({ ...initial[0], values: { ...initial[0].values, count: '1' } }, space));
  assert.throws(() => validateGenomeSpace([{ field: '__proto__', values: [0], optional: false }]));
  assert.throws(() => validateGenomeSpace([{ field: 'x', values: [0, '0'], optional: false }]));
  assert.throws(() => validateGenomeSpace([{ field: 'x', values: [Infinity], optional: false }]));
});

test('fitness changes next generation; selection excludes invalid parents and preserves lineage', () => {
  const config = settings({ crossoverRate: 1, mutationRate: 0 });
  const next = nextPopulation(evaluated, 1, config, space, geneticRandom(42));
  const reversed = nextPopulation(evaluated.map(entry => ({ ...entry, fitness: fitness(3 - entry.fitness.score) })), 1, config, space, geneticRandom(42));
  assert.notDeepEqual(next, reversed);
  assert.deepEqual(next, nextPopulation(evaluated, 1, config, space, geneticRandom(42)));
  assert.equal(next.individuals[0].parentIds[0], 'initial-3');
  assert(next.individuals.some(entry => entry.parentIds.length === 2));
  assert.equal(new Set(next.individuals.map(entry => genomeKey(entry.seed, space))).size, 4);
  const excluded = nextPopulation(evaluated.map((entry, index) => ({ ...entry, fitness: { eligible: index !== 3, score: index === 3 ? 999 : index } })), 1, config, space, geneticRandom(42));
  assert(excluded.individuals.every(entry => !entry.parentIds.includes('initial-3')));
  next.individuals.forEach(entry => validateGenome(entry.seed, space));
});

test('search replays every generation and fitness from the same seeds and observations', async () => {
  const run = createGeneticSearch({ evaluate: async candidate => response(candidate) });
  const first = await run(request());
  assert.deepEqual(first, await run(request()));
  assert.equal(first.generations.length, 4);
  assert.equal(first.stop, 'generation_limit');
  assert.equal(first.reservedTrials, 32);
  assert.equal(first.generations[0].individuals[0].fitness.novelty.value, 1);
  assert.equal(first.generations[0].individuals[1].fitness.novelty.value, 1);
  assert.equal(first.generations[1].individuals[0].fitness.novelty.value, 0);
  assert(first.generations[1].individuals.some(entry => entry.individual.parentIds.length > 0));
});

test('search bounds budgets, stagnation and diversity without redundant requests', async () => {
  let calls = 0;
  const run = createGeneticSearch({ evaluate: async candidate => { calls++; return response(candidate); } });
  const budget = await run(request({ settings: settings({ maxTrials: 3 }) }));
  assert.equal(budget.stop, 'trial_budget'); assert.equal(calls, 1); assert.equal(budget.reservedTrials, 2);
  const stagnant = await run(request({ settings: settings({ generations: 8, stagnationGenerations: 1 }) }));
  assert.equal(stagnant.stop, 'stagnation'); assert.equal(stagnant.generations.length, 2);
  const tiny = validateGenomeSpace([{ field: 'x', values: [false, true], optional: false }]);
  // No new genome can be bred from the sole eligible parent with mutations disabled;
  // immigrants must recover the other member of the finite vocabulary.
  const tinyInitial = [makeGenome('a', [false], tiny), makeGenome('b', [true], tiny)];
  const recovered = nextPopulation(tinyInitial.map((seed, index) => ({ individual: individual(`p${index}`, 0, seed, 'initial', [], tiny), fitness: { eligible: index === 0, score: 0 } })), 1, settings({ population: 2, tournament: 2, crossoverRate: 0, mutationRate: 0 }), tiny, geneticRandom(42));
  assert.equal(recovered.sufficient, true);
  assert(recovered.individuals.some(entry => entry.operator === 'immigrant'));
  const exhausted = nextPopulation([], 1, settings({ minimumDiversity: 1 }), tiny, geneticRandom(42));
  assert.equal(exhausted.sufficient, false); assert.equal(exhausted.uniqueGenomes, 2);
  assert.equal(nextPopulation([], 1, settings({ minimumDiversity: 0.5 }), tiny, geneticRandom(42)).sufficient, true);
});

test('cancel, deadline, failed control, changed source and errors stop further evaluation', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const run = createGeneticSearch({ evaluate: async candidate => { calls++; return response(candidate); } });
  assert.equal((await run(request({ signal: controller.signal }))).stop, 'cancelled'); assert.equal(calls, 0);
  for (const [stop, mutate] of [
    ['control_failed', result => { result.feedback.controlPassed = false; }],
    ['source_changed', result => { result.evidence.state = 'source_mismatch'; }],
    ['error', result => { result.observation.seedId = 'foreign'; }],
  ]) {
    calls = 0;
    const result = await createGeneticSearch({ evaluate: async candidate => { calls++; const value = response(candidate); mutate(value); return value; } })(request());
    assert.equal(result.stop, stop); assert.equal(calls, 1);
  }
  assert.equal((await createGeneticSearch({ evaluate: async () => { throw Error('private transport detail'); } })(request())).stop, 'error');
  let time = 0;
  const expired = await createGeneticSearch({ evaluate: async candidate => { time = 10; return response(candidate); } }, () => time)(request({ settings: settings({ ttlMs: 5 }) }));
  assert.equal(expired.stop, 'deadline'); assert.equal(expired.reservedTrials, 2);
  const active = new AbortController();
  const cancelled = await createGeneticSearch({ evaluate: async candidate => { active.abort(); return response(candidate); } })(request({ signal: active.signal }));
  assert.equal(cancelled.stop, 'cancelled'); assert.equal(cancelled.reservedTrials, 2);
  const timeout = await createGeneticSearch({ evaluate: (_candidate, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('expired')), { once: true })) })(request({ settings: settings({ ttlMs: 5 }) }));
  assert.equal(timeout.stop, 'deadline');
});

test('invalid inputs are rejected before invoking the evaluation port', async () => {
  const run = createGeneticSearch({ evaluate: () => { throw Error('must not run'); } });
  await assert.rejects(run(request({ initial: [initial[0], initial[0], initial[2], initial[3]] })), /Duplicate/);
  await assert.rejects(run(request({ settings: settings({ population: Infinity }) })), /range/);
  await assert.rejects(run(request({ initial: [] })), /population/);
});


test('an uncooperative evaluator cannot hold the search open or publish late feedback', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const report = await createGeneticSearch({ evaluate: () => pending })(request({ settings: settings({ ttlMs: 5 }) }));
  assert.equal(report.stop, 'deadline');
  assert.equal(report.generations.length, 0);
  complete(response(individual('late', 0, initial[0], 'initial', [], space)));
  await Promise.resolve();
  assert.equal(report.generations.length, 0);
});

test('a later transport error retains completed members of the partial generation', async () => {
  let calls = 0;
  const report = await createGeneticSearch({ evaluate: async candidate => {
    if (++calls === 2) throw Error('transport failed');
    return response(candidate);
  } })(request());
  assert.equal(report.stop, 'error');
  assert.equal(report.generations[0].individuals.length, 1);
  assert.equal(report.reservedTrials, 4);
});
