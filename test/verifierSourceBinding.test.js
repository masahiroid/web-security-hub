'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const contracts = require('../core/verifier/contracts');
const { createRegistry } = require('../core/verifier/policies');
const { createSastBoundRunner } = require('../core/verifier/generated/application/sastBoundRunner');
const { createConfinedSourceReader } = require('../core/verifier/generated/adapters/confinedSourceReader');
const { createStaticFileAnalysis } = require('../core/verifier/generated/adapters/staticFileAnalysis');
const { staticMatches } = require('../core/verifier/generated/domain/staticRules');
const { runSastFixture } = require('../core/verifier/generated/adapters/sastFixtureService');
const sourceText = `const express = require('express');
const app = express();
app.post('/inspect', (req, res) => { const settings = { rejectUnauthorized: false }; res.json({accepted: true}); });
module.exports = app;
`;
const seed = (seedId = 'candidate') => ({ schemaVersion: 1, seedId, values: {}, omitFields: [], rationale: 'Bound source test' });
function metadata(bytes = Buffer.from(sourceText)) {
  const match = [...staticMatches(bytes.toString('utf8'))][0]; assert(match);
  return createStaticFileAnalysis(bytes, 'app.js').at(match.id, match.startOffset, match.endOffset);
}
async function setup(t, { setup = [], onRequest, timeoutMs = 2000, ttlMs = 10000, source } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wsh-binding-'));
  const file = path.join(root, 'app.js'); await fs.writeFile(file, sourceText);
  const hits = [];
  const server = http.createServer(async (req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    await onRequest?.({ file, hits, req });
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ accepted: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const scope = { schemaVersion: 1, sourceRootId: 'sample', origin, route: '/inspect', method: 'POST', authProfileIds: ['anonymous'], allowedFields: [], ttlMs, maxTrials: 2, maxConcurrency: 1 };
  const registry = createRegistry({ roots: { sample: root, other: root }, authProfileIds: ['anonymous'] });
  const handle = registry.create(scope);
  t.after(async () => {
    try { registry.dispose(handle); } catch {}
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(root, { recursive: true, force: true });
  });
  const reader = source ?? await createConfinedSourceReader({ sample: root });
  const finding = metadata();
  const options = { contracts, registry, source: reader, finding, scope, timeoutMs,
    profiles: [{ schemaVersion: 1, profileId: 'anonymous', origin, setup }],
    controls: [{ schemaVersion: 1, origin, route: '/inspect', method: 'POST', seed: seed('control'), expectedStatus: 200, expectedJson: { accepted: true } }] };
  const runner = createSastBoundRunner(options);
  const input = { url: origin + '/inspect', method: 'POST', authProfileId: 'anonymous', seed: seed() };
  return { root, file, hits, registry, handle, options, runner, input, scope, finding, reader };
}
function assertRejectedControl(result, hits) {
  assert.equal(result.state, 'source_binding_failed');
  assert.equal(result.pair.control.observation.reason, 'source_binding_failed');
  assert.equal(result.pair.control.observation.dispatched, false);
  assert.equal(result.pair.candidate, null); assert.equal(hits.length, 0);
}

test('binding runs isolated normal/candidate trials with one finding and five correlated identities', async t => {
  const x = await setup(t); const result = await x.runner.runPair(x.handle, x.input);
  assert.equal(result.state, 'completed'); assert.equal(x.hits.length, 2);
  assert.equal(result.finding.findingInstanceId, x.finding.findingInstanceId);
  assert.equal(result.target.sourceRootId, 'sample'); assert.equal(result.target.route, '/inspect');
  assert.equal(result.assurance, 'static-source-only'); assert.equal(result.runtimeSource, 'unverified');
  for (const [index, trial] of [result.pair.control, result.pair.candidate].entries()) {
    const observation = trial.observation;
    for (const [field, header] of Object.entries({jobId: 'job-id', trialId: 'trial-id', seedId: 'seed-id', requestId: 'request-id', authProfileId: 'profile-id'})) {
      assert.equal(x.hits[index].headers['x-verifier-' + header], observation[field]);
    }
    assert.equal(trial.assessment.result, 'under_investigation'); assert.equal(trial.feedback.oracle, 'inconclusive');
  }
  assert.notEqual(result.pair.control.observation.requestId, result.pair.candidate.observation.requestId);
  assert.notEqual(result.pair.control.observation.trialId, result.pair.candidate.observation.trialId);
  assert.equal(x.registry.status(x.handle).running, 0);
  assert(!JSON.stringify(result).includes(x.root)); assert(!JSON.stringify(result).includes(x.handle.capability));
});

test('changed/deleted source is rejected before any setup or target dispatch', async t => {
  for (const remove of [false, true]) await t.test(String(remove), async t => {
    const x = await setup(t, { setup: [{ route: '/session', method: 'POST', values: {}, expectedStatus: 200 }] });
    if (remove) await fs.unlink(x.file); else await fs.appendFile(x.file, '\n// changed');
    const result = await x.runner.runPair(x.handle, x.input); assertRejectedControl(result, x.hits);
    assert.equal(result.pair.control.observation.setupRequests, 0); assert.equal(x.registry.status(x.handle).running, 0);
  });
});

test('source changes during setup prevent target dispatch', async t => {
  const x = await setup(t, { setup: [{ route: '/session', method: 'POST', values: {}, expectedStatus: 200 }],
    onRequest: ({ file }) => fs.appendFile(file, '\n// changed during setup') });
  const result = await x.runner.runPair(x.handle, x.input);
  assert.equal(result.state, 'source_binding_failed'); assert.equal(x.hits.length, 1);
  assert.equal(x.hits[0].url, '/session'); assert.equal(result.pair.control.observation.dispatched, false);
  assert.equal(result.pair.control.observation.setupRequests, 1);
});

test('source changes in a normal response invalidate the result and skip the candidate', async t => {
  const x = await setup(t, { onRequest: ({ file }) => fs.appendFile(file, '\n// changed after dispatch') });
  const result = await x.runner.runPair(x.handle, x.input);
  assert.equal(result.state, 'source_binding_failed'); assert.equal(x.hits.length, 1);
  assert.equal(result.pair.control.observation.dispatched, true); assert.equal(result.pair.candidate, null);
  assert.equal(result.pair.control.feedback.oracle, 'inconclusive');
  assert.equal(result.pair.control.assessment.result, 'under_investigation');
});

test('source changes during candidate execution invalidate its assessment', async t => {
  const x = await setup(t, { onRequest: ({ file, hits }) => hits.length === 2 ? fs.appendFile(file, '\n// candidate change') : undefined });
  const result = await x.runner.runPair(x.handle, x.input);
  assert.equal(result.state, 'source_binding_failed'); assert.equal(x.hits.length, 2);
  assert.equal(result.pair.candidate.observation.reason, 'source_binding_failed');
  assert.equal(result.pair.candidate.assessment.result, 'under_investigation');
});

test('a source-root grant from another catalog cannot be substituted', async t => {
  const x = await setup(t); const other = x.registry.create({ ...x.scope, sourceRootId: 'other' });
  try { assertRejectedControl(await x.runner.runPair(other, x.input), x.hits); }
  finally { x.registry.dispose(other); }
});

test('arbitrary instance IDs, fake spans, rule IDs and mapping metadata fail re-analysis', async t => {
  const x = await setup(t);
  for (const mutate of [
    finding => { finding.findingInstanceId = 'sast-' + 'a'.repeat(64); },
    finding => { finding.ruleId = 'SAST-SECRET'; },
    finding => { finding.sourceSpan.startColumn++; },
    finding => { finding.routeMapping.routes[0].registrationLine++; }
  ]) {
    const finding = JSON.parse(JSON.stringify(x.finding)); mutate(finding);
    const handle = x.registry.create(x.scope);
    try { assertRejectedControl(await createSastBoundRunner({ ...x.options, finding }).runPair(handle, x.input), x.hits); }
    finally { x.registry.dispose(handle); }
  }
});

test('ambiguous/unavailable/parameterized and different method or route never create a bound runner', async t => {
  const x = await setup(t);
  const ambiguous = metadata(Buffer.from(`const express = require('express'); const app = express();
    function shared(req, res) { const settings = { rejectUnauthorized: false }; res.json({accepted: true}); }
    app.post('/inspect', shared); app.post('/second', shared); module.exports = app;`));
  assert.equal(ambiguous.routeMapping.status, 'ambiguous');
  assert.throws(() => createSastBoundRunner({ ...x.options, finding: ambiguous }));
  for (const scope of [{ ...x.scope, route: '/other' }, { ...x.scope, method: 'GET' }]) assert.throws(() => createSastBoundRunner({ ...x.options, scope }));
  const unavailable = JSON.parse(JSON.stringify(x.finding));
  Object.assign(unavailable.routeMapping, { status: 'unavailable', reason: 'unsupported_registration' });
  assert.throws(() => createSastBoundRunner({ ...x.options, finding: unavailable }));
  const template = metadata(Buffer.from(sourceText.replace("'/inspect'", "'/inspect/:id'")));
  assert.throws(() => createSastBoundRunner({ ...x.options, finding: template, scope: { ...x.scope, route: '/inspect/:id' } }));
  assert.equal(x.hits.length, 0);
});

test('outside URL, fields, method or profile remain rejected by the original registry', async t => {
  const x = await setup(t);
  for (const input of [{ ...x.input, url: x.scope.origin + '/other' }, { ...x.input, method: 'GET' },
    { ...x.input, authProfileId: 'admin' }, { ...x.input, seed: { ...seed(), values: { extra: 1 } } }]) {
    await assert.rejects(x.runner.runPair(x.handle, input));
  }
  assert.equal(x.hits.length, 0); assert.equal(x.registry.status(x.handle).trials, 0);
});

test('confined source reads reject traversal, private paths, non-files, oversize files and symlinks', async t => {
  const x = await setup(t); const signal = new AbortController().signal;
  for (const relative of ['../app.js', '/app.js', 'C:/app.js', 'nested/../../app.js', 'nested\\app.js', '.git/app.js', 'internal/app.js', '.env.js', 'app.ts', '']) {
    await assert.rejects(x.reader.read('sample', relative, signal));
  }
  await assert.rejects(x.reader.read('other', 'app.js', signal));
  await fs.mkdir(path.join(x.root, 'directory.js')); await assert.rejects(x.reader.read('sample', 'directory.js', signal));
  await fs.writeFile(path.join(x.root, 'large.js'), Buffer.alloc(1048577)); await assert.rejects(x.reader.read('sample', 'large.js', signal));
  try { await fs.symlink(x.file, path.join(x.root, 'link.js')); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return; throw error; }
  await assert.rejects(x.reader.read('sample', 'link.js', signal));
  await fs.symlink(x.root, path.join(x.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(x.reader.read('sample', 'linked/app.js', signal));
});

test('cancellation and deadline bound a source reader that never resolves, and release reservations', async t => {
  for (const mode of ['cancel', 'deadline', 'timeout']) await t.test(mode, async t => {
    let entered; const reading = new Promise(resolve => { entered = resolve; });
    const x = await setup(t, { timeoutMs: mode === 'timeout' ? 40 : 2000, ttlMs: mode === 'deadline' ? 40 : 10000,
      source: { read: async () => { entered(); return new Promise(() => {}); } } });
    const pending = x.runner.runPair(x.handle, x.input); await reading;
    if (mode === 'cancel') x.registry.cancel(x.handle);
    const result = await pending;
    assert.equal(result.pair.control.observation.outcome, mode === 'cancel' ? 'cancelled' : 'timeout');
    assert.equal(result.pair.candidate, null); assert.equal(x.hits.length, 0); assert.equal(x.registry.status(x.handle).running, 0);
  });
});

test('the shipped source/scope demo runs without evaluating scanned input or claiming a vulnerability', async () => {
  const result = await runSastFixture(new AbortController().signal);
  assert.equal(result.state, 'completed'); assert.equal(result.finding.ruleId, 'SAST-TLS-DISABLED');
  assert.equal(result.pair.control.observation.status, 200); assert.equal(result.pair.candidate.observation.status, 422);
  assert.equal(result.pair.candidate.assessment.result, 'under_investigation'); assert.equal(result.runtimeSource, 'unverified');
  const controller = new AbortController(); controller.abort(); await assert.rejects(runSastFixture(controller.signal));
});

test('CLI source binding demo accepts only its dedicated option and emits no capability', () => {
  const cli = path.resolve(__dirname, '../core/verifier/generated/cli/verifier.js');
  const valid = spawnSync(process.execPath, [cli, '--sast-sample'], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr); const result = JSON.parse(valid.stdout);
  assert.equal(result.state, 'completed'); assert(!valid.stdout.includes('capability'));
  for (const args of [['--sast-sample', '--mode', 'changed'], ['--sast-sample', '--url', 'http://example.test']]) {
    const invalid = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }); assert.equal(invalid.status, 64);
  }
});
