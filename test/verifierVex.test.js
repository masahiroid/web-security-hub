const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createVexReview } = require('../core/verifier/generated/application/vexReview');
const { createVexStore } = require('../core/verifier/generated/adapters/vexStore');
const { createVexEvidenceCatalog, summarizeReport } = require('../core/verifier/generated/adapters/vexEvidence');
const { parseStatementInput, checkStatement, suggestStatus } = require('../core/verifier/generated/domain/vexRules');
const { createGeneticFixtureService } = require('../core/verifier/generated/adapters/geneticFixtureService');
const { defaultGeneticFixtureSettings } = require('../core/verifier/generated/domain/geneticFixtureConfig');
const { defaultLlmSettings } = require('../core/verifier/generated/domain/llmConfig');

const REPORT = randomUUID();
const evidence = (observation, kind = 'genetic', reportId = REPORT) => ({ kind, reportId, observation, sourceDigest: null, createdAt: '2026-10-23T00:00:00.000Z' });
const product = { id: 'pkg:npm/example-shop@1.2.3' };
const statement = changes => ({ vulnerability: 'CVE-2026-0001', products: [product], status: 'under_investigation', basis: 'evidence', evidence: [], ...changes });

function memory(refs = {}) {
  const drafts = new Map(); const exports = [];
  let counter = 0;
  const ports = {
    store: { save: async d => { drafts.set(d.draftId, structuredClone(d)); }, load: async id => { const d = drafts.get(id); if (!d) throw Error('missing'); return structuredClone(d); },
      list: async () => [...drafts.values()], saveExport: async (id, doc) => { exports.push([id, doc]); return `/private/${id}/openvex.json`; } },
    evidence: { list: async () => Object.values(refs), resolve: async (kind, id) => refs[`${kind}:${id}`] ?? null },
    now: () => new Date('2026-10-23T01:02:03.000Z'), id: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  };
  return { vex: createVexReview(ports), exports, ports };
}

test('statement input is closed, bounded and typed before any rule is applied', () => {
  assert.equal(parseStatementInput(statement()).status, 'under_investigation');
  for (const changes of [{ vulnerability: '' }, { vulnerability: 'has space' }, { vulnerability: 'x'.repeat(200) }, { products: [] }, { products: [{ id: 'not a purl' }] },
    { products: [{ id: 'pkg:npm/a@1', sha256: 'zz' }] }, { status: 'exploitable' }, { basis: 'guess' }, { justification: 'because' }, { extra: 1 }, { description: 'x'.repeat(5000) },
    { evidence: [{ kind: 'sample', reportId: 'not-a-uuid' }] }, { evidence: [{ kind: 'web', reportId: REPORT }] }])
    assert.throws(() => parseStatementInput(statement(changes)), undefined, JSON.stringify(changes));
  assert.throws(() => parseStatementInput(null));
});

test('no status is derived from absence of findings; affected needs evidence and an action', () => {
  assert.equal(suggestStatus([evidence('not_reproduced'), evidence('inconclusive')]), 'under_investigation');
  assert.equal(suggestStatus([]), 'under_investigation');
  assert.equal(suggestStatus([evidence('inconclusive'), evidence('reproduced')]), 'affected');
  const check = (changes, refs) => checkStatement(parseStatementInput(statement(changes)), refs);
  assert.throws(() => check({ status: 'not_affected', basis: 'evidence', justification: 'component_not_present' }, [evidence('not_reproduced')]), /evidence_cannot_establish_status/);
  assert.throws(() => check({ status: 'fixed', basis: 'evidence' }, [evidence('not_reproduced')]), /evidence_cannot_establish_status/);
  assert.throws(() => check({ status: 'affected', basis: 'evidence' }, [evidence('reproduced')]), /action_statement_required/);
  assert.throws(() => check({ status: 'affected', basis: 'evidence', actionStatement: 'Update' }, [evidence('not_reproduced')]), /evidence_does_not_support_affected/);
  assert.throws(() => check({ status: 'affected', basis: 'evidence', actionStatement: 'Update' }, []), /evidence_does_not_support_affected/);
  assert.throws(() => check({ status: 'not_affected', basis: 'reviewer' }, []), /justification_required/);
  assert.throws(() => check({ status: 'affected', basis: 'reviewer', actionStatement: 'Update', justification: 'component_not_present' }, []), /unexpected_field/);
  assert.throws(() => check({ status: 'under_investigation', justification: 'component_not_present' }, []), /unexpected_field/);
  check({ status: 'affected', basis: 'evidence', actionStatement: 'Update to 1.2.4' }, [evidence('reproduced')]);
  check({ status: 'not_affected', basis: 'reviewer', justification: 'vulnerable_code_not_present' }, []);
  check({ status: 'fixed', basis: 'reviewer' }, []);
});

test('only an approved draft is exported, as a valid and stable OpenVEX document', async () => {
  const { vex, exports } = memory({ [`genetic:${REPORT}`]: evidence('reproduced') });
  const draft = await vex.createDraft({ author: 'Reviewer A', role: 'Security reviewer' });
  await assert.rejects(() => vex.exportDocument(draft.draftId), /not_approved/);
  await assert.rejects(() => vex.approve(draft.draftId, 'Reviewer A'), /no_statements/);
  let current = await vex.saveStatement(draft.draftId, statement({ status: 'affected', actionStatement: 'Update to 1.2.4', evidence: [{ kind: 'genetic', reportId: REPORT }],
    products: [{ id: product.id, sha256: 'a'.repeat(64) }], description: 'Ownership check missing' }));
  current = await vex.saveStatement(draft.draftId, statement({ vulnerability: 'WSH-2026-0002', status: 'not_affected', basis: 'reviewer', justification: 'component_not_present', statusNotes: 'Module removed in 1.2.0' }));
  assert.equal(current.statements.length, 2);
  await assert.rejects(() => vex.exportDocument(draft.draftId), /not_approved/);
  await assert.rejects(() => vex.approve(draft.draftId, ''), /approver/);
  const approved = await vex.approve(draft.draftId, 'Reviewer B');
  assert.equal(approved.review.approvedBy, 'Reviewer B');
  await assert.rejects(() => vex.saveStatement(draft.draftId, statement()), /draft_approved/);
  await assert.rejects(() => vex.removeStatement(draft.draftId, current.statements[0].statementId), /draft_approved/);
  const { document } = await vex.exportDocument(draft.draftId);
  assert.equal(document['@context'], 'https://openvex.dev/ns/v0.2.0');
  assert.match(document['@id'], /^urn:uuid:/);
  assert.deepEqual([document.author, document.role, document.version, document.timestamp], ['Reviewer A', 'Security reviewer', 1, '2026-10-23T01:02:03.000Z']);
  const [affected, notAffected] = document.statements;
  assert.deepEqual(affected.vulnerability, { name: 'CVE-2026-0001', description: 'Ownership check missing' });
  assert.deepEqual(affected.products, [{ '@id': product.id, hashes: { 'sha-256': 'a'.repeat(64) } }]);
  assert.equal(affected.status, 'affected'); assert.equal(affected.action_statement, 'Update to 1.2.4'); assert.ok(affected.action_statement_timestamp);
  assert.equal(affected.status_notes, undefined);
  assert.equal(notAffected.status, 'not_affected'); assert.equal(notAffected.justification, 'component_not_present');
  assert.match(notAffected.status_notes, /Module removed in 1\.2\.0.*Asserted by the reviewer; no automated evidence/);
  assert.ok(!JSON.stringify(document).includes('exploitable'));
  assert.equal(exports.length, 1);
  const again = await vex.exportDocument(draft.draftId);
  assert.deepEqual(again.document, document);
});

test('evidence must exist, cannot be forged by the reviewer and is re-read at approval', async () => {
  const refs = { [`genetic:${REPORT}`]: evidence('reproduced') };
  const { vex } = memory(refs);
  const draft = await vex.createDraft({ author: 'A' });
  await assert.rejects(() => vex.saveStatement(draft.draftId, statement({ status: 'affected', actionStatement: 'Fix', evidence: [{ kind: 'genetic', reportId: randomUUID() }] })), /evidence_not_found/);
  await assert.rejects(() => vex.saveStatement(draft.draftId, statement({ status: 'affected', actionStatement: 'Fix', evidence: [{ kind: 'genetic', reportId: REPORT, observation: 'reproduced' }] })), /unknown_field/);
  await vex.saveStatement(draft.draftId, statement({ status: 'affected', actionStatement: 'Fix', evidence: [{ kind: 'genetic', reportId: REPORT }] }));
  refs[`genetic:${REPORT}`] = evidence('not_reproduced');
  await assert.rejects(() => vex.approve(draft.draftId, 'B'), /evidence_changed/);
  delete refs[`genetic:${REPORT}`];
  await assert.rejects(() => vex.approve(draft.draftId, 'B'), /evidence_not_found/);
  assert.equal(await vex.suggest([]), 'under_investigation');
});

test('revising an approved document keeps its identity and raises the version', async () => {
  const { vex } = memory();
  const draft = await vex.createDraft({ author: 'A' });
  await assert.rejects(() => vex.revise(draft.draftId), /draft_not_approved/);
  await vex.saveStatement(draft.draftId, statement());
  const approved = await vex.approve(draft.draftId, 'B');
  const revision = await vex.revise(draft.draftId);
  assert.notEqual(revision.draftId, approved.draftId);
  assert.equal(revision.documentId, approved.documentId); assert.equal(revision.version, 2); assert.equal(revision.review.state, 'draft');
  assert.equal(revision.statements.length, 1);
  await vex.approve(revision.draftId, 'B');
  assert.equal((await vex.exportDocument(revision.draftId)).document.version, 2);
  assert.equal((await vex.exportDocument(approved.draftId)).document.version, 1);
});

test('real reports: evidence observations come from stored reports and the private store keeps drafts local', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-vex-'));
  try {
    const service = createGeneticFixtureService({ applicationVersion: 't', dataRoot });
    const settings = { ...defaultGeneticFixtureSettings(), randomSeed: 42 };
    const changed = await service.run({ mode: 'changed', settings, llm: defaultLlmSettings() });
    const fixed = await service.run({ mode: 'fixed', settings, llm: defaultLlmSettings() });
    const catalog = createVexEvidenceCatalog(dataRoot);
    const listed = await catalog.list();
    assert.equal(listed.find(entry => entry.reportId === changed.report.reportId).observation, 'reproduced');
    assert.equal(listed.find(entry => entry.reportId === fixed.report.reportId).observation, 'not_reproduced');
    assert.equal(await catalog.resolve('genetic', randomUUID()), null);
    assert.equal(await catalog.resolve('genetic', '../../etc'), null);
    const vex = createVexReview({ store: createVexStore(dataRoot), evidence: catalog, now: () => new Date(), id: randomUUID });
    assert.equal(await vex.suggest([{ kind: 'genetic', reportId: changed.report.reportId }]), 'affected');
    assert.equal(await vex.suggest([{ kind: 'genetic', reportId: fixed.report.reportId }]), 'under_investigation');
    const draft = await vex.createDraft({ author: 'Reviewer' });
    await assert.rejects(() => vex.saveStatement(draft.draftId, statement({ status: 'affected', actionStatement: 'Fix', evidence: [{ kind: 'genetic', reportId: fixed.report.reportId }] })), /evidence_does_not_support_affected/);
    await vex.saveStatement(draft.draftId, statement({ status: 'affected', actionStatement: 'Fix', evidence: [{ kind: 'genetic', reportId: changed.report.reportId }] }));
    await vex.approve(draft.draftId, 'Reviewer');
    const { document, file } = await vex.exportDocument(draft.draftId);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).statements[0].status, 'affected');
    assert.equal(fs.statSync(file).mode & 0o077, 0);
    assert.ok(!JSON.stringify(document).includes(changed.report.reportId));
    assert.equal((await vex.list()).length, 1);
    assert.equal((await vex.get(draft.draftId)).review.state, 'approved');
    await assert.rejects(() => vex.get('../escape'), /Invalid draft ID/);
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('report summaries never turn incomplete or source-only reports into a negative result', () => {
  const base = { reportId: REPORT, createdAt: '2026-10-23T00:00:00.000Z' };
  assert.equal(summarizeReport('sample', { ...base, state: 'completed', totals: { reproduced: 0, inconclusive: 0 } }).observation, 'not_reproduced');
  assert.equal(summarizeReport('sample', { ...base, state: 'completed', totals: { reproduced: 0, inconclusive: 2 } }).observation, 'inconclusive');
  assert.equal(summarizeReport('sample', { ...base, state: 'cancelled', totals: { reproduced: 0, inconclusive: 0 } }).observation, 'inconclusive');
  assert.equal(summarizeReport('sample', { ...base, state: 'completed', totals: { reproduced: 3, inconclusive: 0 } }).observation, 'reproduced');
  assert.equal(summarizeReport('genetic', { ...base, state: 'timeout', reproduction: { state: 'not_attempted' } }).observation, 'inconclusive');
  assert.equal(summarizeReport('genetic', { ...base, state: 'generation_limit', reproduction: { state: 'inconclusive' } }).observation, 'inconclusive');
  assert.equal(summarizeReport('source', { ...base, state: 'completed', assurance: 'static-source-only', totals: { reproduced: 1 } }).observation, 'inconclusive');
  assert.equal(summarizeReport('genetic', { reportId: 'bad', createdAt: 'x' }), null);
  assert.equal(summarizeReport('genetic', null), null);
});
