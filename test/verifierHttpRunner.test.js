'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createRegistry } = require('../core/verifier/policies');
const { createHttpRunner } = require('../core/verifier/runners/httpRunner');
const { createFixture } = require('../training/verifier-site/server');
const { FIXTURE, HTTP_STATUS, TRANSPORT, POINTS, CONTRACT_VERSION } = require('../core/verifier/generated/domain/config');
const { collectEvidence } = require('../core/verifier/generated/application/collectEvidence');
const { createFixtureLedger } = require('../core/verifier/generated/adapters/fixtureLedger');
const { sourceFingerprint } = require('../core/verifier/generated/adapters/sourceFingerprint');
const contracts = require('../core/verifier/contracts');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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
function setup(t, origin, { route = '/boundary', method = 'POST', allowedFields = ['participants', 'label'], timeoutMs = 2000, ttlMs = 10000, profiles, controls = [], maxTrials = 20, evidenceSource } = {}) {
  profiles ||= ['learner-a', 'learner-b'].map(profileId => ({ schemaVersion: 1, profileId, origin, setup: [{ route: '/session', method: 'POST', values: { profile: profileId }, expectedStatus: 200 }] }));
  const registry = createRegistry({ roots: { fixture: __dirname }, authProfileIds: profiles.map(p => p.profileId) });
  const handle = registry.create({ schemaVersion: 1, sourceRootId: 'fixture', origin, route, method, allowedFields, authProfileIds: profiles.map(p => p.profileId), ttlMs, maxTrials, maxConcurrency: 2 });
  t.after(() => { try { registry.dispose(handle); } catch {} });
  const runner = createHttpRunner({ registry, profiles, controls, timeoutMs, evidenceSource });
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

function fixtureEvidence(fixture, overrides = {}) {
  return { expectedSourceDigest: fixture.sourceDigest, currentSourceDigest: signal => fixture.currentSourceDigest(signal), read: async correlation => fixture.readEvidence(correlation), ...overrides };
}
async function resetFixture(origin, fixture, mode) {
  const response = await fetch(origin + '/control', { method: 'POST', headers: { 'Content-Type': TRANSPORT.jsonContentType, [FIXTURE.controlHeader]: fixture.controlToken }, body: JSON.stringify({ action: 'reset', mode }) });
  assert.equal(response.status, HTTP_STATUS.ok);
}
function readControl(origin) {
  return { schemaVersion: CONTRACT_VERSION, origin, route: '/records/record-a', method: 'GET', authProfileId: 'learner-a', seed: seed('normal-owner', {}), expectedStatus: HTTP_STATUS.ok, expectedJson: { owner: 'learner-a' } };
}

test('correlated ownership evidence reproduces only the changed fixture and separates every role', async t => {
  const fixture = createFixture();
  const origin = await serve(t, fixture.app);
  const profiles = FIXTURE.roles.map(profileId => ({ schemaVersion: CONTRACT_VERSION, profileId, origin, setup: [{ route: '/session', method: 'POST', values: { profile: profileId }, expectedStatus: HTTP_STATUS.ok }] }));
  const { runner, handle, input } = setup(t, origin, { route: '/records/record-a', method: 'GET', allowedFields: [], profiles, controls: [readControl(origin)], evidenceSource: fixtureEvidence(fixture), maxTrials: 40 });
  for (const mode of FIXTURE.modes) {
    await resetFixture(origin, fixture, mode);
    for (const profile of FIXTURE.roles) {
      const pair = await runner.runPair(handle, input(seed(`${mode}-${profile}`, {}), profile));
      const candidate = pair.candidate;
      assert.equal(pair.state, 'completed');
      assert.equal(candidate.evidence.state, 'verified');
      const violated = mode === FIXTURE.changedMode && profile === 'learner-b';
      assert.equal(candidate.feedback.oracle, violated ? 'violated' : 'passed');
      assert.equal(candidate.assessment.result, violated ? 'reproduced' : 'no_issue_observed_in_scope');
      assert.equal(candidate.assessment.vexStatus, 'under_investigation');
      assert.equal(candidate.feedback.sourceDigest, fixture.sourceDigest);
      assert.ok(candidate.feedback.evidenceIds.length);
      assert.ok(candidate.evidence.events.every(event => event.requestId === candidate.observation.requestId && event.trialId === candidate.observation.trialId && event.seedId === candidate.observation.seedId && event.authProfileId === profile && event.profile === profile));
      assert.equal(candidate.evidence.events.some(event => pair.control.feedback.evidenceIds.includes(event.evidenceId)), false);
      if (profile === FIXTURE.anonymous) assert.equal(candidate.feedback.reachability, 'not_observed');
    }
  }
});

test('confirmation oracle distinguishes a valid confirmed control from missing transitions', async t => {
  const fixture = createFixture();
  const origin = await serve(t, fixture.app);
  const confirmedProfile = 'confirmed-a';
  const sessionStep = { route: '/session', method: 'POST', values: { profile: 'learner-a' }, expectedStatus: HTTP_STATUS.ok };
  const profiles = [
    { schemaVersion: CONTRACT_VERSION, profileId: confirmedProfile, origin, setup: [sessionStep, { route: '/records/record-a/confirm', method: 'POST', values: {}, expectedStatus: HTTP_STATUS.ok }] },
    { schemaVersion: CONTRACT_VERSION, profileId: 'learner-a', origin, setup: [sessionStep] }
  ];
  const normal = { schemaVersion: CONTRACT_VERSION, origin, route: '/records/record-a/complete', method: 'POST', authProfileId: confirmedProfile, seed: seed('normal-confirmed', {}), expectedStatus: HTTP_STATUS.ok, expectedJson: { completed: true } };
  const { runner, handle, input } = setup(t, origin, { route: normal.route, allowedFields: [], profiles, controls: [normal], evidenceSource: fixtureEvidence(fixture) });
  for (const mode of FIXTURE.modes) {
    await resetFixture(origin, fixture, mode);
    const pair = await runner.runPair(handle, input(seed(`${mode}-missing-confirmation`, {}), 'learner-a'));
    const changed = mode === FIXTURE.changedMode;
    assert.equal(pair.control.feedback.oracle, 'passed');
    assert.equal(pair.candidate.observation.status, changed ? HTTP_STATUS.ok : HTTP_STATUS.conflict);
    assert.equal(pair.candidate.feedback.oracle, changed ? 'violated' : 'passed');
    assert.equal(pair.candidate.assessment.result, changed ? 'reproduced' : 'no_issue_observed_in_scope');
    assert.equal(pair.candidate.feedback.reachability, changed ? 'observed' : 'not_observed');
  }
});

test('boundary and Unicode evidence has independent expectations for accepted and rejected values', async t => {
  const fixture = createFixture();
  const origin = await serve(t, fixture.app);
  const { runner, handle, input } = setup(t, origin, { controls: [control(origin)], evidenceSource: fixtureEvidence(fixture) });
  const cases = [
    { participants: FIXTURE.participantsMaximum, label: 'e\u0301' },
    { participants: FIXTURE.participantsMaximum + 1, label: 'boundary' },
    { participants: FIXTURE.participantsMinimum, label: '😀'.repeat(FIXTURE.labelMaximum + 1) }
  ];
  for (const [index, values] of cases.entries()) {
    const pair = await runner.runPair(handle, input(seed(`unicode-${index}`, values)));
    assert.equal(pair.candidate.feedback.oracle, 'passed');
    assert.equal(pair.candidate.feedback.reachability, 'observed');
    assert.equal(pair.candidate.evidence.events[0].point, POINTS.boundary);
    assert.equal(pair.candidate.assessment.vexStatus, 'under_investigation');
  }
});

test('disabled or truncated instrumentation cannot be interpreted as a sink not reached', async t => {
  for (const options of [{ instrumentation: false }, { evidenceCapacity: 1 }]) {
    const fixture = createFixture(options);
    const origin = await serve(t, fixture.app);
    const { runner, handle, input } = setup(t, origin, { evidenceSource: fixtureEvidence(fixture) });
    await runner.run(handle, input(seed('first')));
    const result = await runner.run(handle, input(seed('second')));
    assert.equal(result.evidence.state, options.instrumentation === false ? 'unavailable' : 'incomplete');
    assert.equal(result.feedback.reachability, 'unavailable');
    assert.equal(result.feedback.oracle, 'inconclusive');
    assert.equal(result.assessment.result, 'under_investigation');
  }
});

test('wrong request, role, build or malformed snapshot is discarded rather than mixed into feedback', async t => {
  const fixture = createFixture();
  const origin = await serve(t, fixture.app);
  const corruptions = [
    snapshot => ({ ...snapshot, events: snapshot.events.map(event => ({ ...event, requestId: 'other-request' })) }),
    snapshot => ({ ...snapshot, events: snapshot.events.map(event => ({ ...event, authProfileId: 'other-profile' })) }),
    snapshot => ({ ...snapshot, sourceDigest: 'a'.repeat(fixture.sourceDigest.length) }),
    snapshot => ({ ...snapshot, events: snapshot.events.map(event => ({ ...event, sourceDigest: 'b'.repeat(fixture.sourceDigest.length) })) }),
    snapshot => ({ ...snapshot, extra: 'forbidden' }),
    snapshot => ({ ...snapshot, complete: true, events: [] }),
    snapshot => ({ ...snapshot, events: [...snapshot.events, ...snapshot.events] })
  ];
  for (const [index, corrupt] of corruptions.entries()) {
    const evidenceSource = fixtureEvidence(fixture, { read: async correlation => corrupt(fixture.readEvidence(correlation)) });
    const { runner, handle, input } = setup(t, origin, { evidenceSource });
    const result = await runner.run(handle, input(seed(`corrupt-${index}`)));
    assert.notEqual(result.evidence.state, 'verified');
    assert.equal(result.feedback.reachability, 'unavailable');
    assert.equal(result.feedback.oracle, 'inconclusive');
    assert.deepEqual(result.feedback.evidenceIds, []);
  }
});

test('real source-file changes before or during collection invalidate loaded-build evidence', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'verifier-source-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fixture.js');
  const files = [{ name: 'fixture', file }];
  await fs.writeFile(file, 'initial build');
  const sourceDigest = await sourceFingerprint(files);
  const correlation = { jobId: 'job', trialId: 'trial', seedId: 'seed', requestId: 'request', authProfileId: 'learner-a' };
  const headers = Object.fromEntries(Object.entries(TRANSPORT.headers).map(([field, header]) => [header, correlation[field]]));
  const ledger = createFixtureLedger({ sourceDigest, instrumentation: true });
  ledger.record(headers, POINTS.read, 'learner-a', 'record-a', 'passed', FIXTURE.initialMode); ledger.finish(headers);
  const port = { expectedSourceDigest: sourceDigest, currentSourceDigest: signal => sourceFingerprint(files, signal), read: async () => ledger.read(correlation) };
  const signal = new AbortController().signal;
  assert.equal((await collectEvidence(port, correlation, contracts, signal)).state, 'verified');
  await fs.writeFile(file, 'changed build');
  assert.equal((await collectEvidence(port, correlation, contracts, signal)).state, 'source_mismatch');
  await fs.writeFile(file, 'initial build');
  const changedDuringRead = { ...port, read: async () => { await fs.writeFile(file, 'mid-read change'); return ledger.read(correlation); } };
  assert.equal((await collectEvidence(changedDuringRead, correlation, contracts, signal)).state, 'source_mismatch');
});

test('a fake HTTP 200 without a server event stays inconclusive and cannot pass a verified control', async t => {
  const fixture = createFixture();
  const origin = await serve(t, (req, res) => {
    if (req.url === '/boundary') { res.end(JSON.stringify({ accepted: true })); return; }
    fixture.app(req, res);
  });
  const { runner, handle, input } = setup(t, origin, { controls: [control(origin)], evidenceSource: fixtureEvidence(fixture) });
  const pair = await runner.runPair(handle, input());
  assert.equal(pair.state, 'control_failed');
  assert.equal(pair.candidate, null);
  assert.equal(pair.control.evidence.state, 'incomplete');
  assert.equal(pair.control.assessment.result, 'under_investigation');
});

test('evidence collection respects cancellation and releases reservations even if its port stalls', async t => {
  const fixture = createFixture();
  const origin = await serve(t, fixture.app);
  let reading;
  const started = new Promise(resolve => { reading = resolve; });
  const evidenceSource = fixtureEvidence(fixture, { read: async () => { reading(); return new Promise(() => {}); } });
  const { runner, handle, input, registry } = setup(t, origin, { evidenceSource });
  const pending = runner.run(handle, input());
  await within(started);
  registry.cancel(handle);
  const result = await within(pending);
  assert.equal(result.observation.outcome, 'cancelled');
  assert.equal(result.evidence.state, 'incomplete');
  assert.equal(result.feedback.oracle, 'inconclusive');
  assert.equal(registry.status(handle).running, 0);
});


test('a read sink followed by a fake 200 error body does not reproduce a disclosure', async t => {
  const fixture = createFixture();
  const origin = await serve(t, (req, res) => {
    if (req.headers['x-verifier-seed-id'] === 'fake-disclosure') {
      const end = res.end.bind(res);
      res.end = () => { res.removeHeader('Content-Length'); return end(JSON.stringify({ error: 'fake successful error page' })); };
    }
    fixture.app(req, res);
  });
  await resetFixture(origin, fixture, FIXTURE.changedMode);
  const { runner, handle, input } = setup(t, origin, { route: '/records/record-a', method: 'GET', allowedFields: [], controls: [readControl(origin)], evidenceSource: fixtureEvidence(fixture) });
  const pair = await runner.runPair(handle, input(seed('fake-disclosure', {}), 'learner-b'));
  assert.equal(pair.candidate.observation.status, HTTP_STATUS.ok);
  assert.equal(pair.candidate.feedback.reachability, 'observed');
  assert.equal(pair.candidate.feedback.oracle, 'inconclusive');
  assert.equal(pair.candidate.assessment.result, 'under_investigation');
});
