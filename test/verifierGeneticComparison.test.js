const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGeneticFixtureService } = require('../core/verifier/generated/adapters/geneticFixtureService');
const { validateGeneticFixtureOptions } = require('../core/verifier/generated/adapters/geneticFixtureOptions');
const { validateComparisonOptions } = require('../core/verifier/generated/adapters/geneticComparisonOptions');
const { ruleCandidates } = require('../core/verifier/generated/application/rulesSearch');
const { summarize, runGeneticComparison } = require('../core/verifier/generated/application/geneticComparison');
const { COMPARISON } = require('../core/verifier/generated/domain/comparisonConfig');
const { defaultGeneticFixtureSettings, compoundSpace, GENETIC_FIXTURE } = require('../core/verifier/generated/domain/geneticFixtureConfig');
const { defaultLlmSettings } = require('../core/verifier/generated/domain/llmConfig');
const { parseCommand } = require('../core/verifier/generated/cli/arguments');

const small = { ...defaultGeneticFixtureSettings(), maxTrials: 120, generations: 6, stagnationGenerations: 6 };
const compare = async (changes = {}, extra = {}, signal) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-compare-'));
  try {
    const result = await createGeneticFixtureService({ applicationVersion: 't', dataRoot, ...extra }).compare({ settings: small, seeds: [11, 23], ...changes }, signal ? { signal } : {});
    return { ...result, json: fs.readFileSync(result.saved.jsonFile, 'utf8') };
  }
  finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
};
const mock = { ...defaultLlmSettings(), mode: 'mock' };

test('rule baseline is a deterministic enumeration that cannot contain the challenge', () => {
  const rows = ruleCandidates(compoundSpace, GENETIC_FIXTURE.ruleValues);
  assert.equal(rows.length, GENETIC_FIXTURE.ruleValues.length ** 3);
  assert.deepEqual(rows, ruleCandidates(compoundSpace, GENETIC_FIXTURE.ruleValues));
  const { x, y, z } = GENETIC_FIXTURE.challenge;
  assert.ok(!rows.some(row => row[0] === x && row[1] === y && row[2] === z));
  assert.ok(!GENETIC_FIXTURE.ruleValues.includes(x));
});

test('all methods share one HTTP budget, fixed state never reproduces, and facts are measured', async () => {
  const { report, json } = await compare({ llm: mock });
  assert.equal(report.completed, true);
  const methods = new Set(report.runs.map(run => run.method));
  assert.deepEqual([...methods].sort(), ['ga', 'ga_llm', 'rules']);
  assert.ok(report.runs.every(run => run.trials <= report.maxTrials));
  assert.ok(report.runs.filter(run => run.mode === 'fixed').every(run => !run.reproduced));
  assert.ok(report.runs.filter(run => run.method === 'rules').every(run => !run.reproduced && run.trialsToFirstViolation === null));
  assert.equal(report.runs.filter(run => run.method === 'rules').length, 2);
  assert.equal(report.runs.filter(run => run.method === 'ga' && run.mode === 'changed').length, 2);
  assert.deepEqual(report.runs.filter(run => run.method === 'ga' && run.mode === 'changed').map(run => run.randomSeed), [11, 23]);
  assert.ok(report.runs.filter(run => run.method === 'ga_llm').some(run => run.tokens > 0));
  assert.ok(report.runs.filter(run => run.method !== 'ga_llm').every(run => run.tokens === 0));
  for (const summary of report.summaries) assert.equal(summary.reproductionRate, summary.reproduced / summary.validRuns);
  assert.ok(report.runs.every(run => run.valid && run.attempts === 1));
  assert.equal(JSON.parse(json).comparisonId, report.comparisonId);
});

test('without a model only rules and GA run, and an injected provider is never used', async () => {
  let called = false;
  const { report } = await compare({ modes: ['changed'] }, { llmProvider: { async complete() { called = true; throw Error('must not be called'); } } });
  assert.deepEqual([...new Set(report.runs.map(run => run.method))].sort(), ['ga', 'rules']);
  assert.equal(called, false);
});

test('a cancelled comparison is reported incomplete', async () => {
  const controller = new AbortController(); controller.abort();
  const { report } = await compare({}, {}, controller.signal);
  assert.equal(report.completed, false);
  assert.equal(report.runs.length, 0);
});

test('summaries compute rate and median from the measured runs only', () => {
  const run = (reproduced, first, valid = true) => ({ method: 'ga', mode: 'changed', randomSeed: 1, reproduced, reproduction: '', stop: valid ? 'generation_limit' : 'control_failed', valid, attempts: 1, trials: 0,
    trialsToFirstViolation: first, semanticPoints: 2, duplicates: 1, elapsedMs: 10, tokens: 0, cost: 0 });
  const [summary] = summarize([run(true, 10), run(true, 20), run(false, null), run(true, 40)]);
  assert.deepEqual([summary.runs, summary.reproduced, summary.reproductionRate, summary.medianTrialsToFirstViolation], [4, 3, 0.75, 20]);
  const [mixed] = summarize([run(true, 10), run(false, null, false), run(false, null, false)]);
  assert.deepEqual([mixed.runs, mixed.validRuns, mixed.reproductionRate], [3, 1, 1]);
  assert.equal(summarize([run(false, null, false)])[0].reproductionRate, null);
});

test('options reject duplicate or unbounded seeds, bad modes and a model with fixed rules', () => {
  for (const changes of [{ seeds: [] }, { seeds: [1, 1] }, { seeds: [-1] }, { seeds: [1.5] }, { seeds: Array.from({ length: 21 }, (_v, i) => i) }, { modes: [] }, { modes: ['changed', 'changed'] }, { modes: ['nope'] }, { extra: 1 }])
    assert.throws(() => validateComparisonOptions(changes), undefined, JSON.stringify(changes));
  assert.equal(validateComparisonOptions(undefined).seeds.length, 6);
  assert.throws(() => validateGeneticFixtureOptions({ mode: 'changed', method: 'rules', settings: small, llm: mock }));
  assert.throws(() => validateGeneticFixtureOptions({ mode: 'changed', method: 'random', settings: small }));
  assert.equal(parseCommand(['--genetic-compare', '--llm', 'mock']).kind, 'compare');
  assert.equal(parseCommand(['--genetic-fixture', '--method', 'rules']).options.method, 'rules');
  assert.throws(() => parseCommand(['--genetic-compare', '--mode', 'changed']));
});

const fakeReport = (state, mode = 'changed') => ({ options: { mode }, state, reproduction: { state: 'not_attempted' }, trials: 4, executions: [], search: null });
const comparisonOptions = () => ({ settings: small, llm: defaultLlmSettings(), seeds: [1], modes: ['changed'] });

test('environment-failed campaigns are retried after a cooldown and excluded when still invalid', async () => {
  const states = ['control_failed', 'generation_limit', 'error', 'control_failed', 'generation_limit'];
  const pauses = [];
  const ports = { now: Date.now, comparisonId: () => 'c', pause: async ms => { pauses.push(ms); }, run: async () => fakeReport(states.shift()) };
  const report = await runGeneticComparison(ports, comparisonOptions(), new AbortController().signal);
  assert.deepEqual(pauses, [COMPARISON.cooldownMs, COMPARISON.cooldownMs]);
  assert.deepEqual(report.runs.map(run => [run.method, run.valid, run.attempts]), [['rules', true, 2], ['ga', false, 2]]);
  assert.equal(report.summaries.find(summary => summary.method === 'ga').reproductionRate, null);
  assert.equal(report.completed, true);
});

test('cancelling during a cooldown ends the comparison as incomplete', async () => {
  const controller = new AbortController();
  const ports = { now: Date.now, comparisonId: () => 'c', pause: async () => { throw Error('cancelled'); }, run: async () => fakeReport('control_failed') };
  const report = await runGeneticComparison(ports, comparisonOptions(), controller.signal);
  assert.equal(report.completed, false); assert.equal(report.runs.length, 0);
});

test('the search never executes the same genome twice and keeps elites without re-running them', async () => {
  const { report } = await compare({ modes: ['changed'], seeds: [11] });
  assert.ok(report.runs.filter(run => run.method !== 'rules').every(run => run.duplicates === 0));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-dup-'));
  try {
    const { report: single } = await createGeneticFixtureService({ applicationVersion: 't', dataRoot })
      .run({ mode: 'changed', settings: { ...defaultGeneticFixtureSettings(), randomSeed: 11 }, llm: mock });
    const generations = single.search.generations;
    const keys = generations.flatMap(generation => generation.individuals.map(entry => JSON.stringify(entry.individual.seed.values)));
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(generations.slice(1).every(generation => generation.carriedIds.length === single.options.settings.elite));
    const evaluatedIds = new Set(generations.flatMap(generation => generation.individuals.map(entry => entry.individual.id)));
    assert.ok(generations.slice(1).every(generation => generation.carriedIds.every(id => evaluatedIds.has(id))));
    assert.ok(generations.slice(1).every(generation => generation.individuals.every(entry => !generation.carriedIds.includes(entry.individual.id))));
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});
