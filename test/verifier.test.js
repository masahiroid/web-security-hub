'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validate, assess } = require('../core/verifier/contracts');
const { createRegistry } = require('../core/verifier/policies');
const { createFixture } = require('../training/verifier-site/server');
const seed = () => ({ schemaVersion: 1, seedId: 'seed-1', values: { participants: 1 }, omitFields: [], rationale: 'boundary' });
const feedback = () => ({ schemaVersion: 1, seedId: 'seed-1', outcome: 'completed', status: 200, durationMs: 1, instrumentation: 'unavailable', reachability: 'unavailable', sourceDigest: null, oracle: 'passed', controlPassed: true, evidenceIds: [], zap: 'disabled' });
test('contracts reject authority, malformed data, prototype keys and ambiguous omissions', () => {
  assert.ok(Object.isFrozen(validate('seed', seed())));
  for (const input of [{ ...seed(), url: 'http://evil.test' }, { ...seed(), values: { x: undefined } }, { ...seed(), values: { x: NaN } }, { ...seed(), omitFields: ['participants'] }, { ...seed(), values: JSON.parse('{"__proto__":1}') }, { ...seed(), values: { x: 'x'.repeat(70000) } }]) assert.throws(() => validate('seed', input));
  const getter = {}; Object.defineProperty(getter, 'x', { enumerable: true, get() { throw Error('getter executed'); } });
  assert.throws(() => validate('seed', { ...seed(), values: getter }), /data property/);
  assert.throws(() => validate('seed', '{bad json'));
});
test('finite trials, status, reachability and fitness never issue a safe VEX statement', () => {
  assert.equal(assess(feedback()).vexStatus, 'under_investigation');
  const violation = { ...feedback(), instrumentation: 'verified', reachability: 'observed', sourceDigest: 'a'.repeat(64), oracle: 'violated', evidenceIds: ['e1'] };
  assert.equal(assess(violation).result, 'reproduced');
  for (const change of [{ outcome: 'timeout' }, { controlPassed: false }, { zap: 'incomplete' }, { oracle: 'inconclusive' }]) assert.equal(assess({ ...violation, ...change }).result, 'under_investigation');
  assert.throws(() => validate('feedback', { ...feedback(), reachability: 'not_observed' }));
  assert.throws(() => validate('feedback', { ...violation, evidenceIds: [] }));
});
test('grants enforce scopes, capabilities, expiry, cancellation, concurrency and source confinement', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'route.js'), 'module.exports = {};');
  let clock = 100;
  const registry = createRegistry({ roots: { fixture: root }, authProfileIds: ['learner-a'], now: () => clock });
  const scope = { schemaVersion: 1, sourceRootId: 'fixture', origin: 'http://127.0.0.1:4181', route: '/boundary', method: 'POST', authProfileIds: ['learner-a'], allowedFields: ['participants'], ttlMs: 10, maxTrials: 2, maxConcurrency: 1 };
  for (const change of [{ origin: 'https://example.com' }, { authProfileIds: ['admin'] }, { route: '//evil.test/a' }]) assert.throws(() => registry.create({ ...scope, ...change }));
  const handle = registry.create(scope);
  const trial = { url: scope.origin + scope.route, method: 'POST', authProfileId: 'learner-a', seed: seed() };
  assert.throws(() => registry.begin({ jobId: handle.jobId }, trial));
  for (const change of [{ url: 'http://127.0.0.1:4182/boundary' }, { authProfileId: 'admin' }, { method: 'GET' }, { seed: { ...seed(), values: { secret: 1 } } }]) assert.throws(() => registry.begin(handle, { ...trial, ...change }));
  assert.equal(registry.sourceFile(handle, 'route.js'), fs.realpathSync(path.join(root, 'route.js')));
  assert.throws(() => registry.sourceFile(handle, '../outside.js'));
  try { fs.symlinkSync(__filename, path.join(root, 'escape.js')); assert.throws(() => registry.sourceFile(handle, 'escape.js')); } catch (error) { if (error.code !== 'EPERM') throw error; }
  assert.throws(() => registry.assertRedirect(handle, 'http://example.com'));
  const a = registry.begin(handle, trial);
  assert.throws(() => registry.begin(handle, trial));
  registry.finish(handle, a.trialId);
  registry.begin(handle, trial);
  clock = 111;
  assert.throws(() => registry.begin(handle, trial));
  const next = registry.create(scope); registry.cancel(next); assert.throws(() => registry.begin(next, trial));
  const budget = registry.create({ ...scope, maxTrials: 1 }); const b = registry.begin(budget, trial); registry.finish(budget, b.trialId); assert.throws(() => registry.begin(budget, trial));
});
test('fixture demonstrates ownership and workflow violations only in changed mode', async t => {
  const fixture = createFixture();
  const server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { cookie, body, control, headers } = {}) {
    return fetch(origin + route, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(control ? { 'X-Fixture-Control': fixture.controlToken } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  }
  assert.equal((await request('/control', { body: { action: 'evidence' } })).status, 403);
  assert.equal((await request('/session', { body: { profile: 'admin' }, headers: { Origin: 'https://evil.test' } })).status, 403);
  for (const mode of ['baseline', 'changed', 'fixed']) {
    await request('/control', { control: true, body: { action: 'reset', mode } });
    const cookie = (await request('/session', { body: { profile: 'learner-a' } })).headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/records/record-a', { cookie })).status, 200);
    assert.equal((await request('/records/record-b', { cookie })).status, mode === 'changed' ? 200 : 403);
    assert.equal((await request('/records/record-a/complete', { cookie, body: {} })).status, mode === 'changed' ? 200 : 409);
    await request('/records/record-a/confirm', { cookie, body: {} });
    assert.equal((await request('/records/record-a/complete', { cookie, body: {} })).status, 200);
    const evidence = await (await request('/control', { control: true, body: { action: 'evidence' } })).json();
    assert.equal(evidence.commits.some(c => c.violation), mode === 'changed');
    assert.equal(evidence.sourceDigest.length, 64);
    const other = (await request('/session', { body: { profile: 'learner-b' } })).headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/records/record-b', { cookie: other })).status, 200);
    const anonymous = (await request('/session', { body: { profile: 'anonymous' } })).headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/records/record-a', { cookie: anonymous })).status, 401);
    const admin = (await request('/session', { body: { profile: 'admin' } })).headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/records/record-b', { cookie: admin })).status, 200);
  }
  for (const participants of [1, 5, 0, 6, '1']) assert.equal((await request('/boundary', { body: { participants, label: 'e\u0301' } })).status, [1, 5].includes(participants) ? 200 : 422);
  assert.equal((await request('/boundary', { body: { participants: 1, label: '😀'.repeat(11) } })).status, 422);
});

test('disabled server instrumentation remains explicitly unavailable', async t => {
  const fixture = createFixture({ instrumentation: false });
  const server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture-Control': fixture.controlToken }, body: JSON.stringify({ action: 'evidence' }) });
  const evidence = await response.json();
  assert.equal(evidence.instrumentation, 'unavailable');
  assert.deepEqual(evidence.events, []);
});

test('active trials receive cancellation and real deadline signals; finished jobs release reservations', async t => {
  const registry = createRegistry({ roots: { fixture: __dirname }, authProfileIds: ['learner-a'] });
  const scope = { schemaVersion: 1, sourceRootId: 'fixture', origin: 'http://127.0.0.1:4181', route: '/boundary', method: 'POST', authProfileIds: ['learner-a'], allowedFields: ['participants'], ttlMs: 1000, maxTrials: 2, maxConcurrency: 2 };
  const request = { url: scope.origin + scope.route, method: 'POST', authProfileId: 'learner-a', seed: seed() };
  const handle = registry.create(scope);
  const first = registry.begin(handle, request);
  const second = registry.begin(handle, request);
  assert.equal(first.signal.aborted, false);
  assert.equal(registry.status(handle).running, 2);
  registry.cancel(handle);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.equal(registry.status(handle).state, 'cancelled');
  registry.finish(handle, first.trialId); registry.finish(handle, second.trialId);
  assert.equal(registry.status(handle).running, 0);
  assert.equal(JSON.stringify(registry.status(handle)).includes(handle.capability), false);
  registry.dispose(handle);
  assert.throws(() => registry.status(handle));
  const expiring = registry.create({ ...scope, ttlMs: 40 });
  t.after(() => registry.dispose(expiring));
  const trial = registry.begin(expiring, request);
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 1000);
    trial.signal.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  assert.equal(trial.signal.aborted, true);
  assert.equal(registry.status(expiring).state, 'expired');
  assert.throws(() => registry.begin(expiring, request));
  registry.finish(expiring, trial.trialId);
  assert.equal(registry.status(expiring).running, 0);
});
