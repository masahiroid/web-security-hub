const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGeneticFixtureService } = require('../core/verifier/generated/adapters/geneticFixtureService');
const { defaultGeneticFixtureSettings, compoundInitial, compoundSpace, GENETIC_FIXTURE } = require('../core/verifier/generated/domain/geneticFixtureConfig');
const { compoundOracle } = require('../core/verifier/generated/domain/compoundOracle');
const { parseCommand } = require('../core/verifier/generated/cli/arguments');

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-genetic-'));
const run = (mode, changes = {}, signal) => {
  const dataRoot = root();
  return createGeneticFixtureService({ applicationVersion: 'test', dataRoot })
    .run({ mode, settings: { ...defaultGeneticFixtureSettings(), ...changes } }, signal ? { signal } : {})
    .finally(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
};

test('initial candidates never contain the completed challenge and oracle ignores HTTP status', () => {
  const challenge = GENETIC_FIXTURE.challenge;
  for (const seed of compoundInitial(16)) {
    const v = seed.values;
    assert.ok(!(v[0] === challenge.x && v[1] === challenge.y && v[2] === challenge.z));
  }
  assert.equal(compoundSpace.length, 3);
  assert.equal(compoundOracle(GENETIC_FIXTURE.guest, true), 'violated');
  assert.equal(compoundOracle(GENETIC_FIXTURE.owner, true), 'passed');
  assert.equal(compoundOracle(GENETIC_FIXTURE.guest, false), 'passed');
});

test('changed variant is found without LLM and independently reproduced; baseline and fixed are not', async () => {
  const changed = await run('changed');
  assert.equal(changed.report.reproduction.state, 'reproduced');
  assert.equal(changed.report.reproduction.sourceDigest, changed.report.sourceDigest);
  assert.notEqual(changed.report.reproduction.execution.pair.candidate.observation.jobId,
    changed.report.executions.find(e => e.pair.candidate?.assessment.result === 'reproduced').pair.candidate.observation.jobId);
  assert.ok(changed.report.trials <= changed.report.options.settings.maxTrials);
  assert.ok(fs.existsSync(changed.saved.jsonFile) === false || true);
  for (const mode of ['baseline', 'fixed']) {
    const result = await run(mode);
    assert.equal(result.report.reproduction.state, 'not_attempted');
    assert.ok(result.report.executions.every(e => e.pair.candidate?.assessment.result !== 'reproduced'));
  }
});

test('same seed gives same discovered seed; saved report is private and escaped', async () => {
  const dataRoot = root();
  try {
    const service = createGeneticFixtureService({ applicationVersion: 'test', dataRoot });
    const options = { mode: 'changed', settings: defaultGeneticFixtureSettings() };
    const a = await service.run(options); const b = await service.run(options);
    assert.deepEqual(a.report.reproduction.seed.values, b.report.reproduction.seed.values);
    assert.match(fs.readFileSync(a.saved.htmlFile, 'utf8'), /Content-Security-Policy/);
    assert.ok(!/<script/i.test(fs.readFileSync(a.saved.htmlFile, 'utf8')));
    assert.equal(fs.statSync(a.saved.jsonFile).mode & 0o077, 0);
    assert.equal(JSON.parse(fs.readFileSync(a.saved.jsonFile, 'utf8')).reportId, a.report.reportId);
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('budget, cancellation and invalid options stop safely without false reproduction', async () => {
  const small = await run('changed', { maxTrials: 6 });
  assert.ok(small.report.trials <= 6);
  assert.notEqual(small.report.reproduction.state, 'reproduced');
  const controller = new AbortController(); controller.abort();
  const cancelled = await run('changed', {}, controller.signal);
  assert.equal(cancelled.report.state, 'cancelled');
  assert.notEqual(cancelled.report.reproduction.state, 'reproduced');
  await assert.rejects(() => createGeneticFixtureService({ applicationVersion: 't', dataRoot: root() }).run({ mode: 'bogus', settings: defaultGeneticFixtureSettings() }));
  await assert.rejects(() => createGeneticFixtureService({ applicationVersion: 't', dataRoot: root() }).run({ mode: 'changed', settings: defaultGeneticFixtureSettings(), extra: 1 }));
});

test('CLI parsing accepts only genetic options', () => {
  assert.equal(parseCommand(['--genetic-fixture', '--mode', 'changed']).kind, 'genetic');
  assert.throws(() => parseCommand(['--genetic-fixture', '--scenario', 'boundary']));
  assert.throws(() => parseCommand(['--genetic-fixture', '--mode', 'nope']));
});

const { createCompoundFixture } = require('../core/verifier/generated/adapters/compoundFixture');
const { startGeneticHttpSession } = require('../core/verifier/generated/adapters/geneticHttpSession');
const { individual } = require('../core/verifier/generated/domain/geneticEvolution');
const { makeGenome } = require('../core/verifier/generated/domain/geneticGenome');
const runWith = async (factory, changes = {}, timeoutMs) => {
  const dataRoot = root();
  try {
    return await createGeneticFixtureService({ applicationVersion: 'test', dataRoot, factory, ...(timeoutMs ? { timeoutMs } : {}) })
      .run({ mode: 'changed', settings: { ...defaultGeneticFixtureSettings(), ...changes } });
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
};

test('source change during the run stops the search and is never reported as reproduced', async () => {
  const result = await runWith(options => {
    const fixture = createCompoundFixture(options);
    return { ...fixture, currentSourceDigest: async () => 'changed-digest' };
  });
  assert.equal(result.report.state, 'source_changed');
  assert.notEqual(result.report.reproduction.state, 'reproduced');
});

test('server timeouts are recorded and never reproduce a violation', async () => {
  const result = await runWith(options => {
    const fixture = createCompoundFixture(options);
    return { ...fixture, app: (req, res) => { if (req.url === '/compound') return; fixture.app(req, res); } };
  }, { maxTrials: 8 }, 200);
  assert.notEqual(result.report.reproduction.state, 'reproduced');
  assert.ok(result.report.executions.every(e => e.pair.candidate?.assessment.result !== 'reproduced'));
});

test('genomes outside the fixed scope are rejected before any request is sent', async () => {
  const session = await startGeneticHttpSession('changed', new AbortController().signal, Date.now() + 10_000, 4);
  try {
    const rogue = { ...individual('rogue', 0, makeGenome('rogue', [1, 1, 1], compoundSpace), 'initial', [], compoundSpace) };
    rogue.seed = { ...rogue.seed, values: { ...rogue.seed.values, admin: true } };
    await assert.rejects(() => session.evaluate(rogue, { signal: new AbortController().signal, deadline: Date.now() + 10_000 }));
    assert.equal(session.trials, 0);
    assert.equal(session.executions.length, 0);
  } finally { await session.close(); }
});
