'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const express = require('express');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
const { createVerifierRouter } = require('../core/verifier/generated/adapters/verifierRouter');
const { createGeneticFixtureService } = require('../core/verifier/generated/adapters/geneticFixtureService');
const { defaultGeneticFixtureSettings } = require('../core/verifier/generated/domain/geneticFixtureConfig');
const { defaultLlmSettings } = require('../core/verifier/generated/domain/llmConfig');

async function server(t) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wsh-vex-api-'));
  const verifier = createVerifierRouter({ applicationVersion: 'api-test', dataRoot }); const app = express(); app.use('/api/verifier', verifier.router);
  const listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve));
  t.after(async () => { await verifier.close(); await new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }); await fs.rm(dataRoot, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${listener.address().port}`;
  const request = (route, { body, cookie } = {}) => fetch(origin + '/api/verifier/vex' + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const cookie = (await fetch(origin + '/api/verifier/session')).headers.get('set-cookie').split(';')[0];
  return { request, cookie, dataRoot };
}
const statement = changes => ({ vulnerability: 'CVE-2026-0001', products: [{ id: 'pkg:npm/example@1.0.0' }], status: 'under_investigation', basis: 'evidence', evidence: [], ...changes });

test('the review API needs a session and rejects invalid, forged or unknown requests', async t => {
  const { request, cookie } = await server(t);
  assert.equal((await request('/drafts')).status, 401);
  assert.equal((await request('/drafts', { body: { author: 'A' } })).status, 401);
  assert.equal((await request('/drafts/not-a-uuid', { cookie })).status, 404);
  assert.equal((await request('/drafts', { body: { author: '' }, cookie })).status, 422);
  assert.equal((await request('/drafts', { body: ['x'], cookie })).status, 422);
  const draft = await (await request('/drafts', { body: { author: 'Reviewer', role: 'Security' }, cookie })).json();
  assert.equal(draft.review.state, 'draft');
  const base = `/drafts/${draft.draftId}`;
  assert.equal((await request(`${base}/statements`, { body: { statement: statement({ status: 'exploitable' }) }, cookie })).status, 422);
  assert.equal((await request(`${base}/statements`, { body: { statement: statement({ url: 'http://x' }) }, cookie })).status, 422);
  assert.equal((await request(`${base}/statements`, { body: { statement: statement({ status: 'not_affected', basis: 'evidence', justification: 'component_not_present' }) }, cookie })).status, 422);
  assert.equal((await request(`${base}/statements`, { body: { statement: statement({ evidence: [{ kind: 'genetic', reportId: '00000000-0000-4000-8000-000000000000' }] }) }, cookie })).status, 404);
  assert.equal((await request(`${base}/approve`, { body: { approver: 'B' }, cookie })).status, 422);
  assert.equal((await request(`${base}/export`, { body: {}, cookie })).status, 422);
  assert.equal((await request('/drafts/00000000-0000-4000-8000-000000000000', { cookie })).status, 404);
});

test('a reviewer can go from real evidence to an exported OpenVEX document through the API', async t => {
  const { request, cookie, dataRoot } = await server(t);
  const service = createGeneticFixtureService({ applicationVersion: 't', dataRoot });
  const changed = await service.run({ mode: 'changed', settings: { ...defaultGeneticFixtureSettings(), randomSeed: 42 }, llm: defaultLlmSettings() });
  const evidence = await (await request('/evidence', { cookie })).json();
  const entry = evidence.evidence.find(item => item.reportId === changed.report.reportId);
  assert.equal(entry.observation, 'reproduced');
  const refs = [{ kind: 'genetic', reportId: entry.reportId }];
  assert.equal((await (await request('/suggest', { body: { evidence: refs }, cookie })).json()).status, 'affected');
  const draft = await (await request('/drafts', { body: { author: 'Reviewer' }, cookie })).json();
  const base = `/drafts/${draft.draftId}`;
  const added = await (await request(`${base}/statements`, { body: { statement: statement({ status: 'affected', actionStatement: 'Apply the vendor fix', evidence: refs }) }, cookie })).json();
  assert.equal(added.statements.length, 1);
  const sid = added.statements[0].statementId;
  const edited = await (await request(`${base}/statements/${sid}`, { body: { statement: statement({ status: 'affected', actionStatement: 'Update to 1.0.1', evidence: refs }) }, cookie })).json();
  assert.equal(edited.statements[0].actionStatement, 'Update to 1.0.1');
  assert.equal((await request(`${base}/approve`, { body: { approver: 'Approver' }, cookie })).status, 200);
  assert.equal((await request(`${base}/statements/${sid}/delete`, { body: {}, cookie })).status, 422);
  const exported = await (await request(`${base}/export`, { body: {}, cookie })).json();
  assert.equal(exported.document.statements[0].status, 'affected');
  assert.equal(exported.document['@context'], 'https://openvex.dev/ns/v0.2.0');
  const list = await (await request('/drafts', { cookie })).json();
  assert.equal(list.drafts.length, 1);
  const revision = await (await request(`${base}/revise`, { body: {}, cookie })).json();
  assert.equal(revision.version, 2);
});
