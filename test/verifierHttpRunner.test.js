'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createRegistry } = require('../core/verifier/policies');
const { createHttpRunner } = require('../core/verifier/runners/httpRunner');
const { createFixture } = require('../training/verifier-site/server');
const seed = (seedId, values = { participants: 1, label: 'test' }) => ({ schemaVersion: 1, seedId, values, omitFields: [], rationale: 'Known fixture input' });
async function within(promise, timeout = 5000) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Timed out waiting for test I/O')), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function serve(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function setup(t, origin, { route = '/boundary', method = 'POST', allowedFields = ['participants', 'label'], timeoutMs = 2000, ttlMs = 10000, profiles, controls = [], maxTrials = 20 } = {}) {
  profiles ||= ['learner-a', 'learner-b'].map(profileId => ({ schemaVersion: 1, profileId, origin, setup: [{ route: '/session', method: 'POST', values: { profile: profileId }, expectedStatus: 200 }] }));
  const registry = createRegistry({ roots: { fixture: __dirname }, authProfileIds: profiles.map(p => p.profileId) });
  const handle = registry.create({ schemaVersion: 1, sourceRootId: 'fixture', origin, route, method, allowedFields, authProfileIds: profiles.map(p => p.profileId), ttlMs, maxTrials, maxConcurrency: 2 });
  t.after(() => { try { registry.dispose(handle); } catch {} });
  const runner = createHttpRunner({ registry, profiles, controls, timeoutMs });
  const input = (s = seed('s1'), authProfileId = profiles[0].profileId) => ({ url: origin + route, method, authProfileId, seed: s });
  return { registry, handle, runner, input };
}
function noAuth(origin) { return [{ schemaVersion: 1, profileId: 'anonymous', origin, setup: [] }]; }
function control(origin, expectedJson = { accepted: true }) { return { schemaVersion: 1, origin, route: '/boundary', method: 'POST', seed: seed('control'), expectedStatus: 200, expectedJson }; }

test('real fixture pairs distinguish normal controls and preserve inconclusive trial assessments', async t => {
  const fixture = createFixture();
  const hits = [];
  const origin = await serve(t, (req, res) => { hits.push({ route: req.url, cookie: req.headers.cookie, id: req.headers['x-verifier-request-id'], trialId: req.headers['x-verifier-trial-id'] }); fixture.app(req, res); });
  const { registry, handle, runner, input } = setup(t, origin, { controls: [control(origin)] });
  const result = await runner.runPair(handle, input(seed('outside-boundary', { participants: 6, label: 'test' })));
  assert.equal(result.state, 'completed');
  assert.equal(result.control.observation.status, 200);
  assert.equal(result.control.observation.purpose, 'control');
  assert.equal(result.candidate.observation.status, 422);
  assert.equal(result.candidate.feedback.controlPassed, true);
  assert.equal(result.candidate.feedback.oracle, 'inconclusive');
  assert.equal(result.candidate.assessment.vexStatus, 'under_investigation');
  const sent = hits.filter(hit => hit.route === '/boundary');
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0].id, sent[1].id);
  assert.notEqual(sent[0].trialId, sent[1].trialId);
  assert.notEqual(sent[0].cookie, sent[1].cookie);
  assert.equal(registry.status(handle).running, 0);
  for (const hit of sent) assert.equal(JSON.stringify(result).includes(hit.cookie.split('=')[1]), false);
  assert.equal(JSON.stringify(result).includes(handle.capability), false);
});

test('profiles and same-profile seeds use independent cookie jars and retain ownership checks', async t => {
  const fixture = createFixture();
  const cookies = [];
  const origin = await serve(t, (req, res) => { if (req.url === '/records/record-a') cookies.push(req.headers.cookie); fixture.app(req, res); });
  const { registry, handle, runner, input } = setup(t, origin, { route: '/records/record-a', method: 'GET', allowedFields: [] });
  const results = await Promise.all([
    runner.run(handle, input(seed('a1', {}), 'learner-a')),
    runner.run(handle, input(seed('b1', {}), 'learner-b'))
  ]);
  assert.deepEqual(results.map(r => r.observation.status), [200, 403]);
  assert.equal((await runner.run(handle, input(seed('a2', {})))).observation.status, 200);
  assert.equal(new Set(cookies).size, 3);
  assert.equal(registry.status(handle).running, 0);
  assert.equal(results[0].observation.executionKind, 'direct-http');
});

test('invalid candidate authority, fields and malformed seeds are rejected before even setup/control sends', async t => {
  let hits = 0;
  const origin = await serve(t, (req, res) => { hits++; res.end('{}'); });
  const { runner, handle, input } = setup(t, origin, { profiles: noAuth(origin), controls: [control(origin)] });
  for (const trial of [
    { ...input(), url: origin + '/other' }, { ...input(), authProfileId: 'admin' }, { ...input(), method: 'GET' },
    { ...input(), headers: { Cookie: 'injected' } }, input(seed('bad', { secret: 1 })),
    input({ ...seed('bad'), omitFields: ['participants'] }), input({ ...seed('bad'), values: { participants: NaN } })
  ]) await assert.rejects(runner.runPair(handle, trial));
  assert.equal(hits, 0);
});

test('all redirects stop before a second server is contacted, including login redirects', async t => {
  let externalHits = 0;
  const external = await serve(t, (req, res) => { externalHits++; res.end('unexpected'); });
  let redirect = external + '/leak?secret=do-not-return';
  const origin = await serve(t, (req, res) => { res.writeHead(302, { Location: redirect, 'Set-Cookie': 'secret=do-not-return' }); res.end('secret'); });
  const { registry, handle, runner, input } = setup(t, origin, { profiles: noAuth(origin) });
  let result = await runner.run(handle, input());
  assert.equal(result.observation.reason, 'redirect_outside_scope');
  assert.equal(result.observation.status, 302);
  assert.equal(result.observation.outcome, 'error');
  assert.equal(externalHits, 0);
  assert.equal(JSON.stringify(result).includes('do-not-return'), false);
  redirect = origin + '/boundary';
  result = await runner.run(handle, input(seed('same-route')));
  assert.equal(result.observation.reason, 'redirect_not_followed');
  assert.equal(registry.status(handle).running, 0);
  redirect = external + '/login-leak';
  const loginRunner = createHttpRunner({ registry, profiles: [{ schemaVersion: 1, profileId: 'anonymous', origin, setup: [{ route: '/login', method: 'POST', values: {}, expectedStatus: 200 }] }] });
  result = await loginRunner.run(handle, input(seed('setup-redirect')));
  assert.equal(result.observation.reason, 'setup_failed');
  assert.equal(result.observation.dispatched, false);
  assert.equal(externalHits, 0);
});

test('a 200 error page fails the business control and skips the candidate', async t => {
  let hits = 0;
  const origin = await serve(t, (req, res) => { hits++; res.setHeader('Content-Type', 'application/json'); res.end('{"accepted":false,"error":"internal-secret"}'); });
  const { registry, handle, runner, input } = setup(t, origin, { profiles: noAuth(origin), controls: [control(origin)] });
  const pair = await runner.runPair(handle, input());
  assert.equal(pair.state, 'control_failed');
  assert.equal(pair.candidate, null);
  assert.equal(pair.control.observation.status, 200);
  assert.equal(pair.control.assessment.result, 'under_investigation');
  assert.equal(hits, 1);
  assert.equal(registry.status(handle).running, 0);
  assert.equal(JSON.stringify(pair).includes('internal-secret'), false);
});

for (const mode of ['cancel', 'deadline', 'timeout', 'dispose']) {
  test(`real stalled request is closed on ${mode} and reservations are released`, async t => {
    let received;
    const started = new Promise(resolve => { received = resolve; });
    let disconnected;
    const closed = new Promise(resolve => { disconnected = resolve; });
    const origin = await serve(t, (req, res) => { res.once('close', disconnected); received(); });
    const { registry, handle, runner, input } = setup(t, origin, { profiles: noAuth(origin), timeoutMs: mode === 'timeout' ? 500 : 3000, ttlMs: mode === 'deadline' ? 750 : 5000 });
    const pending = runner.run(handle, input());
    await within(started);
    if (mode === 'cancel') registry.cancel(handle);
    if (mode === 'dispose') registry.dispose(handle);
    const result = await within(pending);
    assert.equal(result.observation.outcome, ['deadline', 'timeout'].includes(mode) ? 'timeout' : 'cancelled');
    assert.equal(result.observation.reason, { cancel: 'job_cancelled', deadline: 'job_expired', timeout: 'trial_timeout', dispose: 'job_disposed' }[mode]);
    assert.equal(result.feedback.reachability, 'unavailable');
    assert.equal(result.assessment.vexStatus, 'under_investigation');
    await within(closed);
    if (mode !== 'dispose') assert.equal(registry.status(handle).running, 0);
  });
}

test('failed setup does not disclose diagnostics or leak reservations', async t => {
  const origin = await serve(t, (req, res) => { res.writeHead(503); res.end('sensitive'); });
  const { registry, handle, runner, input } = setup(t, origin);
  const result = await runner.run(handle, input());
  assert.equal(result.observation.reason, 'setup_failed');
  assert.equal(result.observation.dispatched, false);
  assert.equal(registry.status(handle).running, 0);
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});

test('trusted catalog changes cannot switch an existing runner to another role or destination', async t => {
  const fixture = createFixture();
  const origin = await serve(t, fixture.app);
  const profiles = [{ schemaVersion: 1, profileId: 'learner-a', origin, setup: [{ route: '/session', method: 'POST', values: { profile: 'learner-a' }, expectedStatus: 200 }] }];
  const { runner, handle, input } = setup(t, origin, { profiles, route: '/records/record-b', method: 'GET', allowedFields: [] });
  profiles[0].setup[0].values.profile = 'admin';
  assert.equal((await runner.run(handle, input(seed('immutable', {})))).observation.status, 403);
  assert.throws(() => createHttpRunner({ registry: {}, profiles: [{ ...profiles[0], origin: 'http://example.com:8080' }] }));
  assert.throws(() => createHttpRunner({ registry: {}, profiles: [{ ...profiles[0], setup: [{ ...profiles[0].setup[0], route: '//example.com' }] }] }));
});

test('socket failures, oversized JSON and non-JSON bodies stay observations rather than verdicts', async t => {
  let mode = 'socket';
  const origin = await serve(t, (req, res) => {
    if (mode === 'socket') return req.socket.destroy();
    if (mode === 'large') return res.end(JSON.stringify({ secret: 'x'.repeat(65537) }));
    res.end('private non-JSON diagnostic');
  });
  const { registry, handle, runner, input } = setup(t, origin, { profiles: noAuth(origin) });
  let result = await runner.run(handle, input());
  assert.equal(result.observation.reason, 'transport_error');
  mode = 'large';
  result = await runner.run(handle, input(seed('large')));
  assert.equal(result.observation.reason, 'response_too_large');
  assert.equal(result.observation.outcome, 'error');
  mode = 'html';
  result = await runner.run(handle, input(seed('html')));
  assert.equal(result.observation.outcome, 'completed');
  assert.equal(result.feedback.oracle, 'inconclusive');
  assert.equal(JSON.stringify(result).includes('private non-JSON'), false);
  assert.equal(registry.status(handle).running, 0);
});

test('trial budgets reject extra work before sending and absent fields remain absent', async t => {
  const fixture = createFixture();
  let requests = 0;
  const origin = await serve(t, (req, res) => { if (req.url === '/boundary') requests++; fixture.app(req, res); });
  const { registry, handle, runner, input } = setup(t, origin, { profiles: noAuth(origin), maxTrials: 1 });
  const omitted = { ...seed('missing', { label: 'test' }), omitFields: ['participants'] };
  const result = await runner.run(handle, input(omitted));
  assert.equal(result.observation.status, 422);
  assert.equal(registry.status(handle).trials, 1);
  await assert.rejects(runner.run(handle, input(seed('extra'))), /budget/);
  assert.equal(requests, 1);
});

test('GET scalar query fields are encoded without changing the granted origin or route', async t => {
  let received;
  const origin = await serve(t, (req, res) => { received = new URL(req.url, 'http://fixture.test'); res.end('{}'); });
  const { runner, handle, input } = setup(t, origin, { profiles: noAuth(origin), method: 'GET', allowedFields: ['label', 'flag'] });
  const result = await runner.run(handle, input(seed('query', { label: 'é?&next=http://example.test', flag: false })));
  assert.equal(result.observation.status, 200);
  assert.equal(received.pathname, '/boundary');
  assert.equal(received.searchParams.get('label'), 'é?&next=http://example.test');
  assert.equal(received.searchParams.get('flag'), 'false');
});

test('cancellation during profile initialization closes setup and never dispatches the target', async t => {
  let received;
  const started = new Promise(resolve => { received = resolve; });
  const routes = [];
  const origin = await serve(t, (req, res) => { routes.push(req.url); received(); });
  const { registry, handle, runner, input } = setup(t, origin);
  const pending = runner.run(handle, input());
  await within(started);
  registry.cancel(handle);
  const result = await pending;
  assert.equal(result.observation.outcome, 'cancelled');
  assert.equal(result.observation.dispatched, false);
  assert.deepEqual(routes, ['/session']);
  assert.equal(registry.status(handle).running, 0);
});
