'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-server-routes-'));
process.env.WEB_SECURITY_HUB_DATA_DIR = DATA;
const app = require('../server');

let origin;
let listener;
test.before(async () => {
  listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  origin = `http://127.0.0.1:${listener.address().port}`;
});
test.after(async () => {
  await app.get('closeVerifier')();
  await new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); });
  fs.rmSync(DATA, { recursive: true, force: true });
});

async function call(method, route, body) {
  const response = await fetch(origin + route, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: response.status, type: response.headers.get('content-type') ?? '', text, json };
}
const get = route => call('GET', route);
const put = (route, body) => call('PUT', route, body);
const post = (route, body) => call('POST', route, body);
function events(text) {
  return text.split('\n\n').filter(Boolean).map(block => {
    const name = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    return { name, data: data === undefined ? undefined : JSON.parse(data) };
  });
}
async function stream(route) {
  const result = await get(route);
  return { status: result.status, type: result.type, events: events(result.text) };
}
const SITE = { displayName: 'Demo', baseUrl: 'http://127.0.0.1:1/', folder: 'group', labels: ['smoke'], crawl: { maxDepth: 2 } };

test('site settings: create, merge, list, group and never echo credentials', async () => {
  assert.deepEqual((await get('/api/sites')).json, { sites: [] });
  assert.equal((await put('/api/sites/demo', { ...SITE, credentials: { LOGIN_USER: 'user', LOGIN_PASS: 'secret' } })).status, 200);
  assert.deepEqual((await get('/api/sites')).json.sites, [{ id: 'demo', displayName: 'Demo', baseUrl: SITE.baseUrl, folder: 'group', labels: ['smoke'] }]);
  const config = (await get('/api/sites/demo')).json.config;
  assert.deepEqual([config.id, config.displayName, config.crawl.maxDepth], ['demo', 'Demo', 2]);
  assert.ok(!JSON.stringify(config).includes('secret'));
  // A partial update keeps fields the caller did not mention.
  assert.equal((await put('/api/sites/demo', { displayName: 'Renamed' })).status, 200);
  const merged = (await get('/api/sites/demo')).json.config;
  assert.deepEqual([merged.displayName, merged.baseUrl, merged.folder, merged.crawl.maxDepth], ['Renamed', SITE.baseUrl, 'group', 2]);
  assert.deepEqual((await get('/api/sites-by-folder')).json, { folders: { group: [{ id: 'demo', displayName: 'Renamed', labels: ['smoke'] }] } });
  assert.deepEqual((await get('/api/sites/demo/credentials/status')).json, { hasLoginUser: true, hasLoginPass: true, hasBasicUser: false, hasBasicPass: false });
  assert.equal((await post('/api/sites/demo/credentials', { BASIC_USER: 'b', BASIC_PASS: 'p' })).status, 200);
  assert.deepEqual((await get('/api/sites/demo/credentials/status')).json, { hasLoginUser: true, hasLoginPass: true, hasBasicUser: true, hasBasicPass: true });
  const env = fs.readFileSync(path.join(DATA, 'sites', 'demo', '.env'), 'utf8');
  assert.match(env, /LOGIN_PASS/);
  assert.equal((await get('/api/sites/demo')).text.includes('secret'), false);
});

test('site settings reject unknown or invalid sites and scenarios with explicit errors', async () => {
  assert.deepEqual([(await get('/api/sites/nope')).status, (await get('/api/sites/nope')).json.error], [404, 'site not found: nope']);
  assert.deepEqual([(await get('/api/sites/bad%20id/credentials/status')).status, (await get('/api/sites/bad%20id/credentials/status')).json.error], [400, 'invalid site id: bad id']);
  assert.equal((await put('/api/sites/demo', { scenario: { steps: [{ action: 'goto', url: 'http://127.0.0.1:1/' }] } })).status, 200);
  const invalid = await put('/api/sites/demo', { scenario: { steps: [{ action: 'unknown' }] } });
  assert.deepEqual([invalid.status, invalid.json.error], [400, 'scenario step 1 has an unsupported action']);
  assert.equal((await put('/api/sites/bad%20id', SITE)).status, 400);
  assert.equal((await post('/api/sites/bad%20id/credentials', {})).status, 400);
});

test('rule specs, variables, shared steps and data sets', async () => {
  const specs = (await get('/api/sites/demo/rule-specs')).json;
  assert.deepEqual(specs.files, []);
  assert.ok(specs.dir.endsWith(path.join('sites', 'demo', 'rule-spec')));
  fs.mkdirSync(specs.dir, { recursive: true });
  fs.writeFileSync(path.join(specs.dir, 'a.yaml'), 'x: 1'); fs.writeFileSync(path.join(specs.dir, 'b.json'), '{}'); fs.writeFileSync(path.join(specs.dir, 'c.txt'), '');
  assert.deepEqual((await get('/api/sites/demo/rule-specs')).json.files.sort(), ['a.yaml', 'b.json']);
  assert.equal((await put('/api/sites/demo/variables', { standard: { PLAN: 'free' }, secrets: { API_TOKEN: 'top-secret' } })).status, 200);
  const variables = await get('/api/sites/demo/variables');
  assert.deepEqual(variables.json, { standard: { PLAN: 'free' }, secretNames: ['API_TOKEN'] });
  assert.ok(!variables.text.includes('top-secret'));
  assert.equal((await put('/api/sites/demo/variables', { standard: [1] })).json.error, 'standard variables must be an object');
  assert.equal((await put('/api/sites/demo/variables', { secrets: [1] })).json.error, 'secret variables must be an object');
  const groups = [{ name: 'login', steps: [{ action: 'wait', ms: 1 }] }];
  assert.equal((await put('/api/sites/demo/shared-steps', { groups })).status, 200);
  assert.deepEqual((await get('/api/sites/demo/shared-steps')).json, { groups });
  assert.equal((await put('/api/sites/demo/data-sets/rows', { rows: [{ a: '1' }] })).status, 200);
  assert.deepEqual((await get('/api/sites/demo/data-sets')).json, { names: ['rows'] });
  assert.deepEqual((await get('/api/sites/demo/data-sets/rows')).json, { rows: [{ a: '1' }] });
  const traversal = await get('/api/sites/demo/data-sets/..%2fx');
  assert.deepEqual([traversal.status, traversal.json.error], [400, 'invalid data set name: ../x']);
  assert.equal((await get('/api/sites/bad%20id/variables')).status, 400);
});

test('system information reports the running environment', async () => {
  const info = (await get('/api/system-info')).json;
  assert.deepEqual(Object.keys(info).sort(), ['app', 'node', 'npm', 'os', 'playwright', 'server']);
  assert.equal(info.app.name, require('../package.json').name);
  assert.equal(info.app.version, require('../package.json').version);
  assert.equal(info.node.version, process.version);
  assert.equal(info.server.pid, process.pid);
  assert.equal(typeof info.os.cpus, 'number');
});

test('security routes require authorization, validate input and report unreachable ZAP', async () => {
  const unauthorized = await post('/api/security/dynamic-scan', { targetUrl: 'http://127.0.0.1:1/' });
  assert.deepEqual([unauthorized.status, unauthorized.json.error], [400, '対象システムの診断許可を確認してください']);
  const protocol = await post('/api/security/dynamic-scan', { targetUrl: 'ftp://example/', authorizationConfirmed: true });
  assert.deepEqual([protocol.status, protocol.json.error], [400, 'http(s) URL を指定してください']);
  const zap = await post('/api/security/zap-status', { zap: { baseUrl: 'http://127.0.0.1:1' } });
  assert.equal(zap.status, 503); assert.match(zap.json.error, /^ZAP に接続できません: /);
  const missing = await post('/api/security/static-scan', { sourceDir: path.join(DATA, 'missing') });
  assert.deepEqual([missing.status, missing.json.error], [400, '読み取り可能なソースディレクトリを指定してください']);
  assert.equal((await post('/api/security/static-scan', {})).status, 400);
});

test('static analysis saves reports that are served only for valid run IDs and files', async () => {
  const source = path.join(DATA, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'app.js'), 'eval(input);\n');
  const result = await post('/api/security/static-scan', { sourceDir: source });
  assert.equal(result.status, 200);
  assert.equal(result.json.filesScanned, 1);
  assert.equal(result.json.findings[0].id, 'SAST-DANGEROUS-EVAL');
  assert.equal(result.json.findings[0].owasp.id, 'A03');
  const runId = result.json.report.runId;
  assert.match(runId, /^sast-[0-9]{14}/);
  for (const file of ['report.html', 'report.md', 'report.sarif', 'sast-result.json']) assert.equal((await get(`/api/security/static-scans/${runId}/${file}`)).status, 200, file);
  assert.equal((await get(`/api/security/static-scans/${runId}/other.txt`)).status, 400);
  assert.equal((await get('/api/security/static-scans/bad/report.html')).status, 400);
  assert.equal((await get('/api/security/static-scans/sast-20260101000000/report.html')).json.error, 'report not found');
});

test('sessions: list, table editor, YAML export and regeneration', async () => {
  const dir = path.join(DATA, 'sites', 'demo', '.golden-master', 'session-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'generated.spec.ts'), '// original');
  fs.writeFileSync(path.join(dir, 'forms.json'), JSON.stringify([{ url: 'http://127.0.0.1:1/form', formIndex: 0, fields: [] }]));
  fs.writeFileSync(path.join(dir, 'test-cases.json'), JSON.stringify([{ formUrl: 'http://127.0.0.1:1/form', cases: [] }]));
  fs.mkdirSync(path.join(path.dirname(dir), 'session-2'));
  assert.deepEqual((await get('/api/sites/demo/sessions')).json, { sessions: ['session-2', 'session-1'] });
  assert.deepEqual((await get('/api/sites/demo/sessions/session-1/test-cases')).json, { testCaseGroups: [{ formUrl: 'http://127.0.0.1:1/form', cases: [] }] });
  assert.ok(fs.existsSync(path.join(dir, 'test-cases.yaml')));
  assert.deepEqual((await post('/api/sites/demo/sessions/session-1/yaml/export', {})).json, { yamlUrl: '/api/sites/demo/sessions/session-1/test-cases.yaml' });
  const rejected = await put('/api/sites/demo/sessions/session-1/test-cases', { testCaseGroups: 'x' });
  assert.deepEqual([rejected.status, rejected.json.error], [400, 'testCaseGroups must be an array']);
  assert.equal((await put('/api/sites/demo/sessions/session-1/test-cases', { testCaseGroups: [] })).status, 200);
  assert.match(fs.readFileSync(path.join(dir, 'generated.spec.ts'), 'utf8'), /Auto-generated by Web Security Hub Test Generator/);
  assert.deepEqual((await get('/api/sites/demo/sessions/session-1/test-cases')).json, { testCaseGroups: [] });
  assert.deepEqual((await post('/api/sites/demo/sessions/session-1/yaml/regenerate', {})).json, { ok: true });
  assert.equal((await get('/api/sites/demo/sessions/bad!/test-cases')).json.error, 'invalid session id: bad!');
  assert.equal((await post('/api/sites/demo/sessions/session-2/yaml/export', {})).json.error, 'no generated.spec.ts in session: session-2');
  assert.deepEqual((await get('/api/sites/demo/explore-sessions')).json, { sessions: [] });
  fs.mkdirSync(path.join(DATA, 'sites', 'demo', 'explore-sessions', 'session-a'), { recursive: true });
  assert.deepEqual((await get('/api/sites/demo/explore-sessions')).json, { sessions: ['session-a'] });
});

test('test generation rejects an invalid request', async () => {
  const result = await post('/api/test-cases/generate', {});
  assert.deepEqual([result.status, result.json.error], [400, 'Invalid URL']);
  assert.equal((await get('/api/test-sessions/not-a-session/report.html')).status, 400);
});

test('optional AI review needs explicit authorization and a scan', async () => {
  const status = (await get('/api/ai/claude-code/status')).json;
  assert.equal(typeof status.available, 'boolean');
  assert.equal(typeof status.message, 'string');
  assert.match((await post('/api/ai/claude-code/review', {})).json.error, /Confirm that you authorize sending the displayed SAST findings/);
  const missing = await post('/api/ai/claude-code/review', { authorizationConfirmed: true });
  assert.deepEqual([missing.status, missing.json.error], [400, 'A static-analysis result is required']);
});

test('saved sign-in and scenario recording validate before opening any browser', async () => {
  assert.deepEqual((await get('/api/auth-session/status')).json, { active: false });
  assert.deepEqual((await get('/api/sites/demo/auth-session/saved')).json, { saved: false });
  assert.equal((await get('/api/sites/bad%20id/auth-session/saved')).status, 400);
  assert.equal((await post('/api/auth-session/start', { siteId: 'demo' })).json.error, 'explicit authorization is required before opening a login session');
  assert.equal((await post('/api/auth-session/start', { authorized: true })).json.error, 'siteId is required');
  assert.equal((await post('/api/auth-session/start', { authorized: true, siteId: 'nope' })).json.error, 'site not found: nope');
  assert.deepEqual((await post('/api/auth-session/stop', {})).json, { active: false, saved: false });
  assert.deepEqual((await post('/api/auth-session/cancel', {})).json, { active: false });
  assert.deepEqual((await get('/api/scenario-recorder/status')).json, { active: false });
  assert.equal((await post('/api/scenario-recorder/start', { siteId: 'demo' })).json.error, 'explicit authorization is required before recording');
  assert.equal((await post('/api/scenario-recorder/start', { authorized: true })).json.error, 'siteId is required');
  assert.deepEqual((await post('/api/scenario-recorder/stop', {})).json, { active: false, steps: [] });
});

test('long-running routes stream errors as events', async () => {
  for (const [route, message] of [
    ['/api/sites/nope/pipeline/run', 'site not found: nope'],
    ['/api/sites/nope/explore/run', 'site not found: nope'],
    ['/api/sites/demo/mobile/run', /not configured for mobile/],
    ['/api/sites/demo/sessions/session-2/replay', 'no generated.spec.ts in session: session-2'],
  ]) {
    const result = await stream(route);
    assert.equal(result.status, 200); assert.match(result.type, /^text\/event-stream/);
    assert.equal(result.events.length, 1); assert.equal(result.events[0].name, 'error');
    if (typeof message === 'string') assert.equal(result.events[0].data.message, message); else assert.match(result.events[0].data.message, message);
  }
  process.env.WEB_SECURITY_HUB_PACKAGED = '1';
  try {
    const packaged = await stream('/api/sites/demo/mobile/run');
    assert.match(packaged.events[0].data.message, /web automation only/);
  } finally { delete process.env.WEB_SECURITY_HUB_PACKAGED; }
});

test('managed runtime refuses stop and restart; static pages are served', async () => {
  process.env.WEB_SECURITY_HUB_MANAGED = '1';
  try {
    assert.deepEqual([(await post('/api/control/stop', {})).status, (await post('/api/control/stop', {})).json.error], [409, 'Close the application window to stop the managed runtime.']);
    assert.deepEqual([(await post('/api/control/restart', {})).status, (await post('/api/control/restart', {})).json.error], [409, 'Close and reopen the application to restart the managed runtime.']);
  } finally { delete process.env.WEB_SECURITY_HUB_MANAGED; }
  const home = await get('/');
  assert.equal(home.status, 200); assert.match(home.type, /^text\/html/); assert.match(home.text, /<title>Web Security Hub<\/title>/);
  assert.equal((await get('/styles.css')).status, 200);
  assert.equal((await get('/training/README.html')).status, 200);
  assert.equal((await get('/nonexistent.xyz')).status, 404);
});

test('the server entry point listens on loopback and stops on request', async () => {
  const port = await new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env: { ...process.env, PORT: String(port), WEB_SECURITY_HUB_DATA_DIR: DATA, WEB_SECURITY_HUB_MANAGED: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', chunk => { if (String(chunk).includes('listening on')) resolve(); }); child.once('exit', () => reject(Error('server exited early'))); });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/sites`)).status, 200);
    const stopped = await fetch(`${base}/api/control/stop`, { method: 'POST' });
    assert.deepEqual(await stopped.json(), { ok: true, message: 'stopping' });
    assert.deepEqual(await exit, { code: 0, signal: null });
  } finally { child.kill(); }
});
