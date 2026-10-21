'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const express = require('express');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
const { createVerifierRouter } = require('../core/verifier/generated/adapters/verifierRouter');
const { parseGeneticRequest } = require('../core/verifier/generated/adapters/geneticRoute');

async function server(t) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wsh-gen-api-'));
  const verifier = createVerifierRouter({ applicationVersion: 'api-test', dataRoot }); const app = express(); app.use('/api/verifier', verifier.router);
  const listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve));
  t.after(async () => { await verifier.close(); await new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }); await fs.rm(dataRoot, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${listener.address().port}`;
  const request = (route, { body, cookie } = {}) => fetch(origin + '/api/verifier/genetic' + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const session = await fetch(origin + '/api/verifier/session'); const cookie = session.headers.get('set-cookie').split(';')[0];
  const other = (await fetch(origin + '/api/verifier/session')).headers.get('set-cookie').split(';')[0];
  const finish = async (id, who) => { for (let i = 0; i < 400; i++) { const view = await (await request(`/jobs/${id}`, { cookie: who })).json(); if (view.state !== 'running') return view; await new Promise(r => setTimeout(r, 50)); } throw Error('timeout'); };
  return { request, cookie, other, finish };
}
const llm = (mode = 'disabled', extra = {}) => ({ mode, endpoint: null, model: '', ...extra });
const run = (changes = {}) => ({ kind: 'run', mode: 'changed', method: 'ga', randomSeed: 42, maxTrials: 120, llm: llm(), ...changes });

test('request parsing allows only bounded GUI choices and never remote models', () => {
  assert.equal(parseGeneticRequest(run()).options.method, 'ga');
  assert.equal(parseGeneticRequest({ kind: 'compare', maxTrials: 100, llm: llm('mock') }).kind, 'compare');
  for (const bad of [run({ llm: llm('remote') }), run({ llm: llm('local') }), run({ llm: llm('local', { endpoint: 'https://api.example.com', model: 'm' }) }),
    run({ method: 'rules', llm: llm('mock') }), run({ maxTrials: 100000 }), run({ mode: 'nope' }), run({ url: 'http://x' }), run({ kind: 'other' }), run({ randomSeed: -1 })])
    assert.throws(() => parseGeneticRequest(bad), undefined, JSON.stringify(bad));
});

test('genetic jobs are session-owned, validated and return a presentation view without raw evidence', async t => {
  const { request, cookie, other, finish } = await server(t);
  assert.equal((await request('/jobs', { body: run() })).status, 401);
  assert.equal((await request('/jobs', { body: run({ url: 'http://x' }), cookie })).status, 400);
  const defaults = await (await request('/defaults', { cookie })).json();
  assert.deepEqual(Object.keys(defaults).sort(), ['candidateRatio', 'maxTrials', 'randomSeed']);
  const start = await request('/jobs', { body: run({ llm: llm('mock') }), cookie }); const job = await start.json();
  assert.equal(start.status, 200);
  assert.equal((await request(`/jobs/${job.jobId}`, { cookie: other })).status, 404);
  assert.equal((await request(`/jobs/${job.jobId}/cancel`, { body: {}, cookie: other })).status, 404);
  const view = await finish(job.jobId, cookie);
  assert.equal(view.state, 'finished'); assert.equal(view.report.kind, 'run');
  assert.ok(view.report.generations.length > 0); assert.ok(view.report.generations[0].individuals[0].values);
  assert.ok(view.report.trials <= view.report.maxTrials);
  const text = JSON.stringify(view);
  for (const leaked of ['jsonFile', 'htmlFile', 'sourceDigest', 'evidence', 'observation']) assert.ok(!text.includes(leaked), leaked);
});

test('a running genetic job can be cancelled and a comparison reports progress', async t => {
  const { request, cookie, finish } = await server(t);
  const compare = await (await request('/jobs', { body: { kind: 'compare', maxTrials: 60, llm: llm() }, cookie })).json();
  assert.equal((await request('/jobs', { body: run(), cookie })).status, 409);
  await new Promise(r => setTimeout(r, 300));
  await request(`/jobs/${compare.jobId}/cancel`, { body: {}, cookie });
  const view = await finish(compare.jobId, cookie);
  assert.equal(view.state, 'finished'); assert.equal(view.report.kind, 'compare'); assert.equal(view.report.completed, false);
  assert.ok(view.progress === null || view.progress.planned > 0);
});
