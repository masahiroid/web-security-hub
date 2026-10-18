'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createFixtureVerificationService, defaultRunOptions } = require('../core/verifier/generated/adapters/fixtureService');
const { generateFixtureCandidates } = require('../core/verifier/generated/domain/candidates');
const { fixtureScenarios } = require('../core/verifier/generated/domain/fixtureScenarios');
const { CAMPAIGN, REPORT_STORAGE, CLI_EXIT } = require('../core/verifier/generated/domain/campaignConfig');
const { FIXTURE } = require('../core/verifier/generated/domain/config');
const { createPrivateReportStore } = require('../core/verifier/generated/adapters/privateReportStore');
const { createFixture } = require('../training/verifier-site/server');
const contracts = require('../core/verifier/contracts');
async function dataDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wsh-campaign-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
const applicationVersion = 'fixture-test';
const service = dataRoot => createFixtureVerificationService({ applicationVersion, dataRoot });

test('candidate generation reproduces order, preserves field types and keeps different profiles', () => {
  for (const scenario of fixtureScenarios('all')) {
    const plan = generateFixtureCandidates(scenario, CAMPAIGN.defaultRandomSeed, CAMPAIGN.maximumCandidates);
    assert.deepEqual(plan, generateFixtureCandidates(scenario, CAMPAIGN.defaultRandomSeed, CAMPAIGN.maximumCandidates));
    assert.equal(new Set(plan.map(candidate => candidate.seed.seedId)).size, plan.length);
    assert.equal(new Set(plan.map(candidate => JSON.stringify([candidate.authProfileId, candidate.seed.values, candidate.seed.omitFields]))).size, plan.length);
    for (const candidate of plan) {
      contracts.validate('seed', candidate.seed);
      assert.equal(candidate.parentSeedId, scenario.baseSeed.seedId);
      for (const [key, value] of Object.entries(candidate.seed.values)) assert.equal(typeof value, typeof scenario.baseSeed.values[key]);
      for (const omitted of candidate.seed.omitFields) assert.equal(Object.hasOwn(candidate.seed.values, omitted), false);
    }
    if (scenario.id === 'ownership') assert.deepEqual([...new Set(plan.map(candidate => candidate.authProfileId))].sort(), [...FIXTURE.roles].sort());
    if (scenario.id === 'boundary') assert.notDeepEqual(plan, generateFixtureCandidates(scenario, CAMPAIGN.defaultRandomSeed + 1, CAMPAIGN.maximumCandidates));
  }
});

test('complete baseline, changed and fixed campaigns persist usable reports with only known changed violations', async t => {
  const root = await dataDirectory(t);
  const verifier = service(root);
  const expectedChangedViolations = 4;
  for (const mode of FIXTURE.modes) {
    const result = await verifier.run({ ...defaultRunOptions(), mode });
    assert.equal(result.report.state, 'completed');
    assert.equal(result.report.totals.planned, result.report.totals.executed);
    assert.equal(result.report.totals.trials, result.report.totals.executed * CAMPAIGN.trialsPerPair);
    assert.equal(result.report.totals.reproduced, mode === FIXTURE.changedMode ? expectedChangedViolations : 0);
    assert.equal(result.report.totals.inconclusive, 0);
    assert.equal(result.report.vexStatus, 'under_investigation');
    const reread = await verifier.readReport(result.report.reportId);
    assert.deepEqual(reread, result.report);
    const json = await fs.readFile(result.saved.jsonFile, 'utf8');
    for (const forbidden of ['capability', 'controlToken', 'cookie', 'storageState', 'jsonFile']) assert.equal(json.includes(`"${forbidden}"`), false);
    assert.equal(json.includes(root), false);
    assert.match(await fs.readFile(result.saved.htmlFile, 'utf8'), /検証結果/);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(result.saved.jsonFile)).mode & 0o777, REPORT_STORAGE.fileMode);
      assert.equal((await fs.stat(path.dirname(result.saved.jsonFile))).mode & 0o777, REPORT_STORAGE.directoryMode);
    }
  }
});

test('trial budget stops before an incomplete pair and records unexecuted plans', async t => {
  const verifier = service(await dataDirectory(t));
  const result = await verifier.run({ ...defaultRunOptions(), maxTrials: CAMPAIGN.trialsPerPair + 1 });
  assert.equal(result.report.state, 'budget_exhausted');
  assert.equal(result.report.totals.trials, CAMPAIGN.trialsPerPair);
  assert.equal(result.report.totals.executed, 1);
  assert.ok(result.report.totals.planned > result.report.totals.executed);
  assert.equal(result.report.scenarios.length, fixtureScenarios('all').length);
});

test('cancellation before startup and between candidates saves partial reports without continuing', async t => {
  const root = await dataDirectory(t); const verifier = service(root);
  const preCancelled = new AbortController(); preCancelled.abort();
  const before = await verifier.run(defaultRunOptions(), { signal: preCancelled.signal });
  assert.equal(before.report.state, 'cancelled');
  assert.equal(before.report.sourceDigest, null);
  assert.equal(before.report.totals.trials, 0);
  const controller = new AbortController(); let notifications = 0;
  const during = await verifier.run(defaultRunOptions(), { signal: controller.signal, onProgress: () => { notifications++; controller.abort(); } });
  assert.equal(during.report.state, 'cancelled');
  assert.equal(notifications, 1);
  assert.equal(during.report.totals.trials, CAMPAIGN.trialsPerPair);
  assert.ok(await verifier.readReport(during.report.reportId));
});

test('run deadline and failed instrumented control remain incomplete rather than safe', async t => {
  const root = await dataDirectory(t);
  const expired = await service(root).run({ ...defaultRunOptions(), ttlMs: CAMPAIGN.minimumBudget });
  assert.equal(expired.report.state, 'expired');
  const noEvidence = createFixtureVerificationService({ applicationVersion, dataRoot: root, fixtureFactory: options => createFixture({ ...options, instrumentation: false }) });
  const result = await noEvidence.run(defaultRunOptions());
  assert.equal(result.report.state, 'control_failed');
  assert.equal(result.report.totals.executed, 0);
  assert.equal(result.report.totals.trials, 1);
  assert.equal(result.report.totals.inconclusive, 1);
  assert.equal(result.report.vexStatus, 'under_investigation');
});

test('invalid run authority and limits fail before creating a report directory', async t => {
  const root = await dataDirectory(t); const verifier = service(root);
  for (const change of [{ url: 'https://example.test' }, { profile: 'admin' }, { randomSeed: -1 }, { randomSeed: NaN }, { maxCandidates: CAMPAIGN.maximumCandidates + 1 }, { maxTrials: 0 }, { scenario: 'external' }, { mode: 'production' }]) await assert.rejects(verifier.run({ ...defaultRunOptions(), ...change }));
  await assert.rejects(fs.stat(path.join(root, ...REPORT_STORAGE.segments)), { code: 'ENOENT' });
});

test('private store rejects traversal, extra secrets, altered verdicts and overwrite attempts', async t => {
  const root = await dataDirectory(t);
  const result = await service(root).run({ ...defaultRunOptions(), scenario: 'ownership' });
  const store = createPrivateReportStore(root, contracts);
  await assert.rejects(store.read('../report'));
  await assert.rejects(store.save(result.report), /exists/);
  await assert.rejects(store.save({ ...result.report, capability: 'must-never-be-saved' }));
  const changed = JSON.parse(JSON.stringify(result.report)); changed.totals.reproduced++;
  await assert.rejects(store.save(changed), /totals/);
  const directory = path.join(root, ...REPORT_STORAGE.segments);
  assert.equal((await fs.readdir(directory)).some(name => name.startsWith(REPORT_STORAGE.pendingPrefix)), false);
  const file = result.saved.jsonFile;
  const tampered = JSON.parse(await fs.readFile(file, 'utf8'));
  tampered.scenarios[0].executions[0].control.feedback.oracle = 'violated';
  await fs.writeFile(file, JSON.stringify(tampered));
  await assert.rejects(store.read(result.report.reportId));
});

test('private store rejects symlinked parents and report files', async t => {
  const root = await dataDirectory(t); const outside = await dataDirectory(t);
  const store = createPrivateReportStore(root, contracts);
  try { await fs.symlink(outside, path.join(root, REPORT_STORAGE.segments[0]), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('Symlink creation unavailable on this Windows account'); return; } throw error; }
  const template = await service(outside).run({ ...defaultRunOptions(), scenario: 'ownership' });
  await assert.rejects(store.save(template.report), /Unsafe/);
  await fs.unlink(path.join(root, REPORT_STORAGE.segments[0]));
  const local = await service(root).run({ ...defaultRunOptions(), scenario: 'ownership' });
  await fs.unlink(local.saved.jsonFile);
  try { await fs.symlink(template.saved.jsonFile, local.saved.jsonFile); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('File symlink creation unavailable; parent-junction rejection was verified'); return; } throw error; }
  await assert.rejects(store.read(local.report.reportId), /Unsafe/);
});

test('HTML reports escape stored text and include a restrictive content policy', async t => {
  const root = await dataDirectory(t);
  const verifier = service(root);
  const result = await verifier.run({ ...defaultRunOptions(), scenario: 'ownership' });
  const modified = JSON.parse(JSON.stringify(result.report));
  modified.reportId = require('node:crypto').randomUUID();
  modified.scenarios[0].plan[0].seed.rationale = '<img src="https://example.test/track" onerror="window.reportExecuted=true">';
  const saved = await createPrivateReportStore(root, contracts).save(modified);
  const html = await fs.readFile(saved.htmlFile, 'utf8');
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /<table>/);
});

test('CLI executes the changed fixture and refuses arbitrary endpoints without side effects', async t => {
  const root = await dataDirectory(t);
  const cli = path.resolve('core/verifier/generated/cli/verifier.js');
  const options = { encoding: 'utf8', env: { ...process.env, WEB_SECURITY_HUB_DATA_DIR: root } };
  const invalid = spawnSync(process.execPath, [cli, '--url', 'https://example.test'], options);
  assert.equal(invalid.status, CLI_EXIT.usage);
  await assert.rejects(fs.stat(path.join(root, ...REPORT_STORAGE.segments)), { code: 'ENOENT' });
  const result = spawnSync(process.execPath, [cli, '--mode', 'changed', '--scenario', 'ownership'], options);
  assert.equal(result.status, CLI_EXIT.success, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.state, 'completed');
  assert.equal(summary.totals.reproduced, 1);
  assert.ok(await fs.stat(summary.htmlFile));
});
