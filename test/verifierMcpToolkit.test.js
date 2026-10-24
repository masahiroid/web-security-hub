const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMcpToolkit } = require('../core/verifier/generated/application/mcpToolkit');
const { createVexReview } = require('../core/verifier/generated/application/vexReview');
const { MCP_LIMITS, MCP_TOOLS, NO_GRANTS, McpToolError, createRateLimiter, TOOL_GRANTS } = require('../core/verifier/generated/domain/mcpPolicy');
const { summarizeReport, reportDetails } = require('../core/verifier/generated/domain/mcpSummary');
const { redirectConsoleToStderr } = require('../core/verifier/generated/adapters/stdoutGuard');
const { parseMcpArguments } = require('../core/verifier/generated/cli/mcpArguments');

const SECRET_VALUE = 'candidate-value-1234';
const GENETIC_REPORT = randomUUID(); const SAMPLE_REPORT = randomUUID();
const stored = {
  [`genetic:${GENETIC_REPORT}`]: { reportId: GENETIC_REPORT, createdAt: '2026-10-24T00:00:00.000Z', state: 'generation_limit', trials: 384, options: { mode: 'changed', method: 'ga' },
    reproduction: { state: 'reproduced', seed: { values: { x: SECRET_VALUE } } }, search: { generations: [{ index: 0, bestScore: 2, individuals: [{ individual: { operator: 'initial', seed: { values: { x: SECRET_VALUE } } }, fitness: { score: 2 } }] }], proposals: [] } },
  [`sample:${SAMPLE_REPORT}`]: { reportId: SAMPLE_REPORT, createdAt: '2026-10-24T00:00:01.000Z', state: 'completed', mode: 'changed', totals: { executed: 22, trials: 44, reproduced: 4, observedNoIssue: 18, inconclusive: 0 }, scenarios: [] },
};
const evidenceRows = [
  { kind: 'genetic', reportId: GENETIC_REPORT, observation: 'reproduced', sourceDigest: null, createdAt: '2026-10-24T00:00:00.000Z' },
  { kind: 'sample', reportId: SAMPLE_REPORT, observation: 'reproduced', sourceDigest: null, createdAt: '2026-10-24T00:00:01.000Z' },
];
function memoryVex(refs) {
  const drafts = new Map(); let counter = 0;
  return createVexReview({ store: { save: async d => { drafts.set(d.draftId, structuredClone(d)); }, load: async id => { const d = drafts.get(id); if (!d) throw Error('missing'); return structuredClone(d); },
    list: async () => [...drafts.values()], saveExport: async id => `/private/${id}` }, evidence: { list: async () => refs, resolve: async (kind, id) => refs.find(r => r.kind === kind && r.reportId === id) ?? null },
  now: () => new Date('2026-10-24T01:00:00.000Z'), id: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` });
}
function build(grants = NO_GRANTS, { clock = { now: 1_000 }, sample, genetic } = {}) {
  const vex = memoryVex(evidenceRows);
  const toolkit = createMcpToolkit({ grants, vex, now: () => clock.now, id: randomUUID,
    evidence: { list: async () => evidenceRows, resolve: async (kind, id) => evidenceRows.find(r => r.kind === kind && r.reportId === id) ?? null },
    reports: { read: async (kind, id) => stored[`${kind}:${id}`] ?? null },
    runners: { sample: sample ?? (async () => stored[`sample:${SAMPLE_REPORT}`]), genetic: genetic ?? (async () => stored[`genetic:${GENETIC_REPORT}`]) } });
  return { toolkit, vex, clock, call: (tool, input = {}) => toolkit.tools[tool](input) };
}
const refused = async (promise, code) => assert.rejects(promise, error => error instanceof McpToolError && error.code === code, code);
const all = Object.freeze({ run: true, codeSnippets: true, vex: true });
const waitFor = async (check) => { for (let i = 0; i < 200; i++) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 10)); } throw Error('timeout'); };

test('without any grant only summaries and status are available', async () => {
  const { call } = build();
  const listed = (await call(MCP_TOOLS.listReports, {})).structured.reports;
  assert.deepEqual(listed.map(r => r.kind).sort(), ['genetic', 'sample']);
  assert.ok(listed.every(r => !('sourceDigest' in r)));
  assert.equal((await call(MCP_TOOLS.getReportSummary, { kind: 'sample', reportId: SAMPLE_REPORT })).structured.summary.facts.reproduced, 4);
  assert.equal((await call(MCP_TOOLS.vexListDrafts, {})).structured.drafts.length, 0);
  assert.equal((await call(MCP_TOOLS.vexSuggestStatus, { evidence: [{ kind: 'genetic', reportId: GENETIC_REPORT }] })).structured.status, 'affected');
  for (const [tool, input] of [[MCP_TOOLS.getReportDetails, { kind: 'genetic', reportId: GENETIC_REPORT }], [MCP_TOOLS.startSampleVerification, { mode: 'changed' }], [MCP_TOOLS.startGeneticSearch, { mode: 'changed' }],
    [MCP_TOOLS.vexCreateDraft, { author: 'A' }], [MCP_TOOLS.vexSaveStatement, {}], [MCP_TOOLS.vexExportDocument, {}]]) await refused(call(tool, input), 'grant_required');
});

test('every tool declares its required permission and only metadata tools need none', () => {
  assert.deepEqual(Object.keys(TOOL_GRANTS).sort(), Object.values(MCP_TOOLS).sort());
  assert.deepEqual(Object.entries(TOOL_GRANTS).filter(([, grant]) => grant === null).map(([tool]) => tool).sort(), ['cancel_job', 'get_job_status', 'get_report_summary', 'list_reports', 'vex_list_drafts', 'vex_suggest_status']);
  assert.ok(!Object.keys(build(all).toolkit.tools).some(name => /approve/.test(name)), 'approval must never be a tool');
  assert.deepEqual(parseMcpArguments([]).grants, NO_GRANTS);
  assert.deepEqual(parseMcpArguments(['--allow-run', '--allow-vex']).grants, { run: true, codeSnippets: false, vex: true });
  assert.throws(() => parseMcpArguments(['--allow-everything']));
  assert.throws(() => parseMcpArguments(['extra']));
});

test('summaries never carry exact values, details do and need the snippet grant', async () => {
  const summary = JSON.stringify(summarizeReport('genetic', stored[`genetic:${GENETIC_REPORT}`]));
  assert.ok(!summary.includes(SECRET_VALUE));
  assert.equal(summarizeReport('genetic', stored[`genetic:${GENETIC_REPORT}`]).facts.reproduction, 'reproduced');
  assert.equal(summarizeReport('genetic', { reportId: 'bad' }), null);
  const { call } = build({ ...NO_GRANTS, codeSnippets: true });
  const details = (await call(MCP_TOOLS.getReportDetails, { kind: 'genetic', reportId: GENETIC_REPORT })).structured.details;
  assert.deepEqual(details.reproducedValues, { x: SECRET_VALUE });
  assert.equal(JSON.stringify(reportDetails('source', {}, 5)), '{}');
  await refused(call(MCP_TOOLS.getReportDetails, { kind: 'genetic', reportId: randomUUID() }), 'not_found');
  const without = await build().call(MCP_TOOLS.getReportSummary, { kind: 'genetic', reportId: GENETIC_REPORT });
  assert.ok(!JSON.stringify(without).includes(SECRET_VALUE));
});

test('inputs are bounded and malformed values are refused before anything runs', async () => {
  const { call, clock } = build(all);
  let started = 0;
  const counting = build(all, { sample: async () => { started++; return stored[`sample:${SAMPLE_REPORT}`]; }, genetic: async () => { started++; return null; } });
  // Refused starts still count against the allowance, so the clock moves on between windows.
  const sampleInputs = [{}, { mode: 'nope' }, { mode: 'changed', scenario: 'x' }, { mode: 'changed', maxTrials: 0 }, { mode: 'changed', maxTrials: MCP_LIMITS.maximumTrials + 1 }, { mode: 'changed', maxTrials: 1.5 }, { mode: 'changed', randomSeed: -1 }];
  for (const input of sampleInputs) { await refused(counting.call(MCP_TOOLS.startSampleVerification, input), 'invalid_input'); counting.clock.now += MCP_LIMITS.windowMs; }
  for (const input of [{ mode: 'changed', maxTrials: 1 }, { mode: 'changed', method: 'llm' }]) { await refused(counting.call(MCP_TOOLS.startGeneticSearch, input), 'invalid_input'); counting.clock.now += MCP_LIMITS.windowMs; }
  assert.equal(started, 0);
  clock.now += MCP_LIMITS.windowMs;
  await refused(call(MCP_TOOLS.listReports, { kind: 'web' }), 'invalid_input');
  await refused(call(MCP_TOOLS.listReports, { limit: MCP_LIMITS.listMaximum + 1 }), 'invalid_input');
  for (const jobId of ['', 'job-1', '../x', 123, undefined]) await refused(call(MCP_TOOLS.getJobStatus, { jobId }), 'invalid_input');
  await refused(call(MCP_TOOLS.getReportSummary, { kind: 'sample', reportId: 'not-a-uuid' }), 'invalid_input');
  assert.equal((await call(MCP_TOOLS.listReports, { limit: 1 })).structured.reports.length, 1);
});

test('jobs: one at a time, results are aggregate, handles are scoped to this server', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { call } = build(all, { sample: async (input, controls) => { controls.onProgress({ done: 1, planned: 4 }); await gate; return stored[`sample:${SAMPLE_REPORT}`]; } });
  const started = (await call(MCP_TOOLS.startSampleVerification, { mode: 'changed' })).structured;
  assert.equal(started.state, 'running');
  await refused(call(MCP_TOOLS.startGeneticSearch, { mode: 'changed' }), 'busy');
  const running = (await call(MCP_TOOLS.getJobStatus, { jobId: started.jobId })).structured;
  assert.deepEqual(running.progress, { done: 1, planned: 4 });
  release();
  const finished = await waitFor(async () => { const status = (await call(MCP_TOOLS.getJobStatus, { jobId: started.jobId })).structured; return status.state === 'finished' ? status : null; });
  assert.equal(finished.result.facts.reproduced, 4);
  assert.ok(!JSON.stringify(finished).includes('scenarios'));
  await refused(call(MCP_TOOLS.getJobStatus, { jobId: randomUUID() }), 'unknown_job');
  await refused(call(MCP_TOOLS.cancelJob, { jobId: randomUUID() }), 'unknown_job');
  const other = build(all);
  await refused(other.call(MCP_TOOLS.getJobStatus, { jobId: started.jobId }), 'unknown_job');
  await refused(other.call(MCP_TOOLS.cancelJob, { jobId: started.jobId }), 'unknown_job');
});

test('a running job can be cancelled and a failing runner is reported without internals', async () => {
  const cancelled = build(all, { genetic: (input, controls) => new Promise((_resolve, reject) => controls.signal.addEventListener('abort', () => reject(Error('private detail /etc/secret')), { once: true })) });
  const job = (await cancelled.call(MCP_TOOLS.startGeneticSearch, { mode: 'changed' })).structured;
  assert.equal((await cancelled.call(MCP_TOOLS.cancelJob, { jobId: job.jobId })).structured.cancelRequested, true);
  const view = await waitFor(async () => { const status = (await cancelled.call(MCP_TOOLS.getJobStatus, { jobId: job.jobId })).structured; return status.state !== 'running' ? status : null; });
  assert.equal(view.state, 'failed');
  assert.ok(!JSON.stringify(view).includes('private detail'));
  await cancelled.toolkit.close();
});

test('rate limits apply per class of tool and reset with the window', async () => {
  const clock = { now: 0 };
  const limiter = createRateLimiter(() => clock.now, { read: 2, write: 1, start: 1 }, 1000);
  assert.deepEqual([limiter.take('read'), limiter.take('read'), limiter.take('read'), limiter.take('write')], [true, true, false, true]);
  clock.now = 1000;
  assert.equal(limiter.take('read'), true);
  const { call, clock: toolkitClock } = build(all);
  for (let i = 0; i < MCP_LIMITS.callsPerWindow.read; i++) await call(MCP_TOOLS.listReports, {});
  await refused(call(MCP_TOOLS.listReports, {}), 'rate_limited');
  await refused(call(MCP_TOOLS.getReportSummary, { kind: 'sample', reportId: SAMPLE_REPORT }), 'rate_limited');
  assert.equal((await call(MCP_TOOLS.vexCreateDraft, { author: 'A' })).structured.state, 'draft');
  toolkitClock.now += MCP_LIMITS.windowMs;
  assert.equal((await call(MCP_TOOLS.listReports, {})).structured.reports.length, 2);
});

test('VEX through the toolkit: no approval, export only after a person approved', async () => {
  const { call, vex } = build(all);
  const draft = (await call(MCP_TOOLS.vexCreateDraft, { author: 'Agent', role: 'assistant' })).structured;
  const saved = (await call(MCP_TOOLS.vexSaveStatement, { draftId: draft.draftId, statement: { vulnerability: 'CVE-2026-0001', products: [{ id: 'pkg:npm/example@1.0.0' }], status: 'affected', basis: 'evidence',
    actionStatement: 'Update', evidence: [{ kind: 'genetic', reportId: GENETIC_REPORT }] } })).structured;
  assert.equal(saved.statements, 1);
  await refused(call(MCP_TOOLS.vexSaveStatement, { draftId: draft.draftId, statement: { vulnerability: 'CVE-2026-0001', products: [{ id: 'pkg:npm/example@1.0.0' }], status: 'not_affected', basis: 'evidence', justification: 'component_not_present' } }), 'invalid_input');
  await refused(call(MCP_TOOLS.vexSaveStatement, { draftId: draft.draftId, statement: { vulnerability: 'CVE-2026-0002', products: [{ id: 'pkg:npm/x@1' }], status: 'under_investigation', basis: 'evidence', evidence: [{ kind: 'genetic', reportId: randomUUID() }] } }), 'not_found');
  await refused(call(MCP_TOOLS.vexSaveStatement, { draftId: draft.draftId, statement: { url: 'http://x' } }), 'invalid_input');
  await refused(call(MCP_TOOLS.vexExportDocument, { draftId: draft.draftId }), 'not_approved');
  await vex.approve(draft.draftId, 'Human Reviewer');
  const exported = (await call(MCP_TOOLS.vexExportDocument, { draftId: draft.draftId })).structured.document;
  assert.equal(exported.statements[0].status, 'affected');
  await refused(call(MCP_TOOLS.vexSaveStatement, { draftId: draft.draftId, statement: {} }), 'invalid_input');
  assert.equal((await call(MCP_TOOLS.vexListDrafts, {})).structured.drafts[0].state, 'approved');
});

test('console output is redirected so stdout can only carry the protocol', () => {
  const original = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, trace: console.trace, stderr: process.stderr.write, stdout: process.stdout.write };
  const captured = []; let leaked = 0;
  process.stderr.write = chunk => { captured.push(String(chunk)); return true; };
  process.stdout.write = () => { leaked++; return true; };
  try { redirectConsoleToStderr(); console.log('a %s', 'b'); console.info('c'); console.debug('d'); console.warn('e'); console.trace('f'); }
  finally { Object.assign(console, { log: original.log, info: original.info, debug: original.debug, warn: original.warn, trace: original.trace }); process.stderr.write = original.stderr; process.stdout.write = original.stdout; }
  assert.equal(leaked, 0);
  assert.deepEqual(captured, ['a b\n', 'c\n', 'd\n', 'e\n', 'f\n']);
});
