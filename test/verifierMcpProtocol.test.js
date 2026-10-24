const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../core/verifier/generated/adapters/mcpServer');
const { createMcpToolkit } = require('../core/verifier/generated/application/mcpToolkit');
const { NO_GRANTS, MCP_TOOLS } = require('../core/verifier/generated/domain/mcpPolicy');

const ENTRY = path.resolve(__dirname, '..', 'core/verifier/generated/cli/mcp.js');
const METADATA_TOOLS = ['cancel_job', 'get_job_status', 'get_report_summary', 'list_reports', 'vex_list_drafts', 'vex_suggest_status'];
const textOf = result => result.content.map(part => part.text).join('');
const waitFor = async check => { for (let i = 0; i < 600; i++) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 100)); } throw Error('timeout'); };

async function inMemory(grants) {
  const toolkit = createMcpToolkit({ grants, now: Date.now, id: () => require('node:crypto').randomUUID(),
    evidence: { list: async () => [], resolve: async () => null }, reports: { read: async () => null }, vex: { suggest: async () => 'under_investigation', list: async () => [] },
    runners: { sample: async () => null, genetic: async () => null } });
  const server = createMcpServer(toolkit, grants, 'test');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, close: async () => { await client.close(); await toolkit.close(); } };
}

test('the server offers only the tools its permissions allow, each with a schema and safe annotations', async () => {
  const bare = await inMemory(NO_GRANTS);
  try {
    const { tools } = await bare.client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), METADATA_TOOLS);
    assert.ok(tools.every(tool => tool.annotations.destructiveHint === false && tool.annotations.openWorldHint === false));
    assert.ok(tools.find(tool => tool.name === 'list_reports').annotations.readOnlyHint);
    assert.equal(tools.find(tool => tool.name === 'get_job_status').inputSchema.properties.jobId.type, 'string');
    assert.match((await bare.client.getInstructions?.()) ?? 'ok', /./);
    const refused = await bare.client.callTool({ name: 'start_sample_verification', arguments: { mode: 'changed' } }).then(result => result, error => ({ isError: true, thrown: String(error) }));
    assert.equal(refused.isError, true);
  } finally { await bare.close(); }
  const full = await inMemory({ run: true, codeSnippets: true, vex: true });
  try {
    const names = (await full.client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(names, Object.values(MCP_TOOLS).sort());
    assert.ok(!names.some(name => /approve/.test(name)));
  } finally { await full.close(); }
});

test('malformed arguments are rejected by the schema and never reach a tool', async () => {
  const session = await inMemory({ run: true, codeSnippets: false, vex: false });
  try {
    for (const [name, args] of [['list_reports', { limit: 1000 }], ['list_reports', { kind: 'web' }], ['get_job_status', { jobId: 'job-1' }], ['get_job_status', {}],
      ['start_sample_verification', { mode: 'nope' }], ['start_sample_verification', { mode: 'changed', maxTrials: 100000 }], ['start_genetic_search', { mode: 'changed', method: 'llm' }]]) {
      const result = await session.client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
    }
    const unknown = await session.client.callTool({ name: 'get_job_status', arguments: { jobId: '00000000-0000-4000-8000-000000000000' } });
    assert.equal(unknown.isError, true);
    assert.equal(unknown.structuredContent.code, 'unknown_job');
    const ok = await session.client.callTool({ name: 'list_reports', arguments: {} });
    assert.notEqual(ok.isError, true);
    assert.deepEqual(ok.structuredContent, { reports: [] });
  } finally { await session.close(); }
});

function startProcess(flags, dataRoot) {
  return new StdioClientTransport({ command: process.execPath, args: [ENTRY, ...flags], env: { ...process.env, WEB_SECURITY_HUB_DATA_DIR: dataRoot }, stderr: 'pipe' });
}
test('over real stdio: run a verification, read its report, and prepare a VEX draft that only a person can approve', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-mcp-'));
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(startProcess(['--allow-run', '--allow-code-snippets', '--allow-vex'], dataRoot));
    assert.equal((await client.listTools()).tools.length, Object.values(MCP_TOOLS).length);
    const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); return { ...result, data: result.structuredContent }; };
    const started = await call('start_genetic_search', { mode: 'changed', maxTrials: 400 });
    assert.equal(started.data.state, 'running');
    assert.equal((await call('start_genetic_search', { mode: 'changed' })).isError, true);
    const finished = await waitFor(async () => { const status = (await call('get_job_status', { jobId: started.data.jobId })).data; return status.state === 'running' ? null : status; });
    assert.equal(finished.state, 'finished');
    assert.equal(finished.result.facts.reproduction, 'reproduced');
    const reportId = finished.result.reportId;
    const listed = (await call('list_reports', { kind: 'genetic' })).data.reports;
    assert.deepEqual(listed.map(entry => [entry.reportId, entry.observation]), [[reportId, 'reproduced']]);
    assert.ok(!textOf(await client.callTool({ name: 'get_report_summary', arguments: { kind: 'genetic', reportId } })).includes('"values"'));
    assert.ok(Object.keys((await call('get_report_details', { kind: 'genetic', reportId })).data.details.reproducedValues).length > 0);
    assert.equal((await call('vex_suggest_status', { evidence: [{ kind: 'genetic', reportId }] })).data.status, 'affected');
    const draft = (await call('vex_create_draft', { author: 'Agent' })).data;
    const statement = { vulnerability: 'CVE-2026-0001', products: [{ id: 'pkg:npm/example@1.0.0' }], status: 'affected', basis: 'evidence', actionStatement: 'Update', evidence: [{ kind: 'genetic', reportId }] };
    assert.equal((await call('vex_save_statement', { draftId: draft.draftId, statement })).data.statements, 1);
    const exported = await call('vex_export_document', { draftId: draft.draftId });
    assert.equal(exported.isError, true); assert.equal(exported.data.code, 'not_approved');
    // Only a person approves, in the app; the reports live in the private directory of this data root.
    assert.ok(fs.existsSync(path.join(dataRoot, 'artifacts', 'private', 'genetic-verifier', reportId, 'report.json')));
  } finally { await client.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('a server started without flags offers metadata tools only', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-mcp-'));
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(startProcess([], dataRoot));
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), METADATA_TOOLS);
    assert.deepEqual((await client.callTool({ name: 'list_reports', arguments: {} })).structuredContent, { reports: [] });
  } finally { await client.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('stdout carries only protocol messages; logs go to stderr and the server exits when the client leaves', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-mcp-'));
  const child = spawn(process.execPath, [ENTRY, '--allow-run'], { env: { ...process.env, WEB_SECURITY_HUB_DATA_DIR: dataRoot }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    for (const message of [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'ping' }]) child.stdin.write(`${JSON.stringify(message)}\n`);
    await waitFor(() => out.split('\n').filter(Boolean).length >= 4);
    child.stdin.end();
    assert.deepEqual(await exit, { code: 0, signal: null });
    const lines = out.split('\n').filter(Boolean);
    assert.ok(lines.length >= 4);
    for (const line of lines) { const message = JSON.parse(line); assert.equal(message.jsonrpc, '2.0'); assert.ok('id' in message || 'method' in message); }
    assert.match(err, /MCP server ready \(run=true, codeSnippets=false, vex=false\)/);
  } finally { child.kill(); fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test('unknown options are refused with usage on stderr and nothing on stdout', async () => {
  const child = spawn(process.execPath, [ENTRY, '--allow-everything'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 64); assert.equal(out, ''); assert.match(err, /MCP server \(stdio\)/);
});
