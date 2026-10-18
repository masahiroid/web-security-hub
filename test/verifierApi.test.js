'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const express = require('express');
const { createVerifierRouter } = require('../core/verifier/generated/adapters/verifierRouter');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
const { defaultRunOptions } = require('../core/verifier/generated/adapters/fixtureService');
async function server(t) {
 const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wsh-api-'));
 const verifier = createVerifierRouter({ applicationVersion: 'api-test', dataRoot }); const app = express(); app.use('/api/verifier', verifier.router);
 const listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve));
 t.after(async () => { await verifier.close(); await new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }); await fs.rm(dataRoot, {recursive:true,force:true}); });
 const origin = `http://127.0.0.1:${listener.address().port}`;
 const request = (route, { body, cookie, headers = {} } = {}) => fetch(origin + '/api/verifier' + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
 const session = await request('/session'); const cookie = session.headers.get('set-cookie').split(';')[0];
 return { request, cookie, origin };
}
test('verifier API rejects forged hosts, cross-origin writes and absent/forged sessions', async t => {
 const { request, cookie, origin } = await server(t);
 const forgedHost = await new Promise((resolve, reject) => { const request = http.get(origin + '/api/verifier/session', { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
 assert.equal(forgedHost, 403);
 assert.equal((await request('/session', { headers: { Origin: 'https://evil.test' } })).status, 403);
 assert.equal((await request('/jobs', { body: defaultRunOptions() })).status, 401);
 assert.equal((await request('/jobs', { body: defaultRunOptions(), cookie: cookie.split('=')[0] + '=forged' })).status, 401);
 assert.equal((await request('/jobs', { body: defaultRunOptions(), cookie, headers: { Origin: 'null' } })).status, 403);
 assert.equal((await fetch(origin + '/api/verifier/jobs', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(defaultRunOptions()) })).status, 403);
 assert.equal((await request('/jobs', { body: { ...defaultRunOptions(), url: 'https://evil.test' }, cookie })).status, 400);
 const malformed = await fetch(origin + '/api/verifier/jobs', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{bad' });
 assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'invalid_request' });
});
test('verification jobs enforce session ownership, capacity, cancellation and safe report export', async t => {
 const { request, cookie } = await server(t);
 const otherSession = await request('/session'); const other = otherSession.headers.get('set-cookie').split(';')[0];
 const start = await request('/jobs', { body: defaultRunOptions(), cookie }); const job = await start.json();
 assert.equal(start.status, 200); assert.equal(job.state, 'running');
 assert.equal((await request(`/jobs/${job.jobId}`, { cookie: other })).status, 404);
 assert.equal((await request(`/jobs/${job.jobId}/cancel`, { body: {}, cookie: other })).status, 404);
 assert.equal((await request('/jobs', { body: defaultRunOptions(), cookie })).status, 409);
 assert.equal((await request(`/jobs/${job.jobId}/cancel`, { body: {}, cookie })).status, 200);
 let view;
 for (let attempt = 0; attempt < 100; attempt++) {
  view = await (await request(`/jobs/${job.jobId}`, { cookie })).json(); if (view.state !== 'running') break;
  await new Promise(resolve => setTimeout(resolve, 20));
 }
 assert.equal(view.state, 'finished'); assert.equal(view.report.state, 'cancelled');
 assert.equal(JSON.stringify(view).includes('capability'), false);
 assert.equal(JSON.stringify(view).includes('jsonFile'), false);
 const html = await request(`/jobs/${job.jobId}/report.html`, { cookie });
 assert.equal(html.status, 200); assert.match(html.headers.get('content-security-policy'), /default-src 'none'/); assert.match(await html.text(), /検証結果/);
 assert.equal((await request(`/jobs/${job.jobId}/report.html`, { cookie: other })).status, 404);
});

test('source/scope sample API uses session/origin protection and rejects arbitrary sources or targets', async t => {
 const { request, cookie } = await server(t);
 assert.equal((await request('/sast-sample', { body: {} })).status, 401);
 assert.equal((await request('/sast-sample', { body: {}, cookie, headers: { Origin: 'https://evil.test' } })).status, 403);
 for (const body of [null, [], { url: 'https://evil.test' }, { sourceDir: '/tmp' }, { findingInstanceId: 'fake' }]) {
  assert.equal((await request('/sast-sample', { body, cookie })).status, 400);
 }
 const response = await request('/sast-sample', { body: {}, cookie }); assert.equal(response.status, 200);
 const result = await response.json(); assert.equal(result.state, 'completed');
 assert.equal(result.finding.ruleId, 'SAST-TLS-DISABLED'); assert.equal(result.target.route, '/inspect');
 assert.equal(result.runtimeSource, 'unverified'); assert.equal(result.pair.candidate.assessment.result, 'under_investigation');
 assert.equal(JSON.stringify(result).includes('capability'), false);
});
