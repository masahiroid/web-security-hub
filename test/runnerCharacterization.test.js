'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { BrowserSession } = require('../core/crawler/browser');
const { JsonStore } = require('../core/store/jsonStore');
const selectors = require('../core/runner/runtimeSelectors');
const discovery = require('../core/runner/formDiscovery');
const { expandScenarios } = require('../core/runner/scenarioExpansion');
const { executeCase, testCaseHasAbnormalAssignment, buildRunShotName } = require('../core/runner/caseExecutor');
const { processForm } = require('../core/runner/formProcessor');
const { runFormGeneration } = require('../core/runner/formRunner');

// Records what core/runner produces today, so a rewrite can be checked against it.
// UPDATE_GOLDEN=1 re-records. Ports, temporary paths and timestamps are normalized away.
const GOLDEN = path.join(__dirname, 'golden', 'runner');

const PAGES = {
  '/': `<!doctype html><title>Home</title><main><a href="/form">Form</a> <a href="/blocked">Blocked</a> <a href="/login">Login</a>
    <a href="/agree">Agree</a></main>`,
  '/form': `<!doctype html><title>Form</title><main><form id="entry" action="/form" method="post">
    <label for="name">Name</label><input id="name" name="name" type="text" required maxlength="10">
    <input id="age" name="age" type="number" min="18" max="99">
    <select id="plan" name="plan"><option value="a">A</option><option value="b">B</option></select>
    <input type="radio" name="color" id="red" value="red"><input type="radio" name="color" id="blue" value="blue">
    <input type="checkbox" name="news" id="news">
    <button id="send" type="submit">Send</button></form></main>`,
  '/thanks': '<!doctype html><title>Thanks</title><main><h1>Thanks</h1></main>',
  '/invalid': '<!doctype html><title>Form</title><main><p class="error">Name is invalid</p><p>入力してください</p></main>',
  '/blocked': `<!doctype html><title>Blocked</title><main><form id="b" onsubmit="return false"><input name="q" required>
    <button id="go" type="submit">Go</button></form></main>`,
  '/gate': `<!doctype html><title>Gate</title><main><input type="checkbox" id="ok" name="ok"><label for="ok">I agree</label>
    <button type="button" onclick="if(document.getElementById('ok').checked)location.href='/form'">Next</button></main>`,
  '/wizard': `<!doctype html><title>Wizard</title><main><form id="w" action="/form" method="post">
    <input type="radio" name="kind" value="person" onclick="document.getElementById('more').hidden=false">
    <input type="radio" name="kind" value="company">
    <div id="more" hidden><input id="nick" name="nick" type="text"></div><button id="wgo" type="submit">Go</button></form></main>`,
  '/login': `<!doctype html><title>Login</title><main><form method="post" action="/thanks"><input name="user" type="text">
    <input name="pass" type="password"><button type="submit">Login</button></form></main>`,
  '/agree': `<!doctype html><title>Agree</title><main><form id="a" action="/thanks" method="post"><input type="checkbox" name="agree" id="ag">
    <label for="ag">同意する</label><button type="submit">OK</button></form></main>`,
};

function startSite() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const name = new URLSearchParams(body).get('name');
        const target = url.pathname === '/form' && name !== null && !/^[A-Za-z]+$/.test(name) ? '/invalid' : '/thanks';
        response.writeHead(302, { location: target });
        response.end();
      });
      return;
    }
    const page = PAGES[url.pathname];
    if (!page) { response.writeHead(404, { 'content-type': 'text/html' }); return response.end('<!doctype html><title>Missing</title>missing'); }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function normalize(value, origin) {
  const text = JSON.stringify(value, null, 2).split(origin).join('http://SITE');
  return text
    // Temporary paths differ per platform (Windows: drive letter, short names such as RUNNER~1, backslashes).
    .replace(/[^"\s]*wsh-runner-[\w-]+/g, '<tmp>')
    .replace(/<tmp>((?:\\\\[^"\\]+)+)/g, (_match, rest) => `<tmp>${rest.split('\\\\').join('/')}`)
    .replace(/127-0-0-1-\d+/g, 'SITE')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<time>') + '\n';
}

function compare(name, value, origin = 'http://SITE') {
  const file = path.join(GOLDEN, name);
  const actual = normalize(value, origin);
  if (process.env.UPDATE_GOLDEN === '1') { fs.mkdirSync(GOLDEN, { recursive: true }); fs.writeFileSync(file, actual); }
  assert.equal(actual, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), name);
}

function field(selector, type, extra = {}) {
  return { selector, type, name: selector.replace(/^#/, ''), ...extra };
}

function assignment(selector, value, kind = 'normal') {
  return { fieldSelector: selector, kind, value, rationale: 'test' };
}

function memoryStore() {
  const calls = [];
  return {
    calls,
    saveForm: async (form) => { calls.push(['form', form.url]); },
    saveTestCases: async (url, cases) => { calls.push(['cases', url, cases.length]); },
    saveRunResult: async (url, result) => { calls.push(['run', url, result.testCaseId, result.ok]); },
    saveUrlCatalog: async (catalog) => { calls.push(['catalog', catalog.pages.length]); },
  };
}

test('runtime selector helpers behave as recorded', () => {
  compare('selectors.json', {
    selectors: ['', '#plain', '#a[b]', '#q"[x]', '.cls', 'input[name="x"]'].map((s) => [s, selectors.normalizeSelectorForRuntime(s)]),
    nullSelector: selectors.normalizeSelectorForRuntime(null),
    paths: ['http://h/a/b?x=1#f', 'not a url', 'http://h'].map((u) => [u, selectors.normalizePathForCompare(u)]),
    errors: selectors.extractErrors('<p class="form-error">Bad</p><span class="alert x">Bad</span><div class="invalid" id="i">  </div><b class="warning">Warn</b>'),
    hints: ['', 'エラーがあります', 'Please enter a value; is required', '不正 選択してください 未入力', 'all good']
      .map((t) => [t, selectors.extractErrorTextHints(t)]),
    sha1: selectors.sha1('abc'),
  });
});

test('form discovery behaves as recorded', () => {
  const logs = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-runner-'));
  const manual = path.join(tmp, 'manual.json');
  fs.writeFileSync(manual, JSON.stringify([{ url: 'http://h/m', formSelector: 'form', fields: [] }]));
  const forms = [
    { url: 'http://h/a#x', formSelector: 'form', submitSelector: '#s', fields: [field('#n', 'text', { constraints: { required: true } }), field('#e', 'email')] },
    { url: 'http://h/a#x', formSelector: 'form', submitSelector: '#s', fields: [field('#e', 'email'), field('#n', 'text', { constraints: { required: true } })] },
    { url: 'http://h/login', formSelector: 'form', fields: [field('#u', 'text')] },
    { url: 'http://h/b', formSelector: 'form', fields: [field('#user', 'text'), field('#pw', 'password')] },
    { url: 'http://h/c', formSelector: 'form', fields: [field('#agree', 'checkbox', { label: 'I agree' })] },
    { url: 'http://h/d', formSelector: 'form', fields: [field('#x', 'checkbox', { label: 'News' })] },
  ];
  try {
    compare('discovery.json', {
      manualMissing: discovery.loadManualForms(path.join(tmp, 'none.json'), ['crawled'], (l) => logs.push(l.replace(tmp, '<tmp>'))),
      manualUnset: discovery.loadManualForms(undefined, ['crawled'], (l) => logs.push(l)),
      manualLoaded: discovery.loadManualForms(manual, ['crawled'], (l) => logs.push(l.replace(tmp, '<tmp>'))),
      logs,
      deduped: discovery.dedupeForms(forms).map((f) => f.url),
      classified: forms.map((f) => [f.url, discovery.classifyForm(f)]),
      primeLogin: [{ url: 'http://h/signin' }, { url: 'http://h/x', login: { loginUrl: 'http://h/x' } }, { url: 'http://h/x' }, {}]
        .map((c) => discovery.shouldPrimeLogin(c)),
      catalog: discovery.buildUrlCatalog('http://h/', ['http://h/a#x', 'http://h/z', 'bad url'], [
        { url: 'http://h/a', title: 'A', markers: ['m'], textHash: 'h1' },
      ], forms),
      uniqueFromSnapshots: discovery.uniquePageCaseCount([{ url: 'http://h/a?x=1#y' }, { url: 'http://h/a?x=1' }], ['ignored']),
      uniqueFromVisited: discovery.uniquePageCaseCount([], ['http://h/a', 'http://h/b', 'odd', 'odd']),
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scenario expansion and case naming behave as recorded', () => {
  const form = { url: 'http://h/apply/step1', formSelector: 'form#apply[data-x]', fields: [field('#kind', 'select'), field('#name', 'text')] };
  const cases = [
    { id: 'case-001', name: 'abnormal', assignments: { '#name': assignment('#name', '', 'abnormal') } },
    { id: 'case-002', name: 'normal', assignments: { '#name': assignment('#name', 'Ann'), '#kind': assignment('#kind', 'a') } },
  ];
  const config = [
    { urlPattern: 'apply', triggerSelector: '#kind', templates: [{ name: 'kind b', overrides: { '#kind': 'b' } }, { name: 'same', overrides: { '#kind': 'a' } }] },
    { urlPattern: '([', triggerSelector: '#kind', templates: [{ name: 'broken', overrides: {} }] },
    { urlPattern: 'apply', triggerSelector: '#missing', templates: [{ name: 'absent', overrides: {} }] },
    { urlPattern: 'APPLY', triggerSelector: '#name', templates: [{ name: 'no overrides' }] },
  ];
  compare('scenario.json', {
    none: expandScenarios(form, new Map(), cases, 10, undefined).map((c) => c.id),
    expanded: expandScenarios(form, new Map(), cases, 10, config),
    limited: expandScenarios(form, new Map(), cases, 2, config).map((c) => c.id),
    noCases: expandScenarios(form, new Map(), [], 10, config),
    shotNames: [
      buildRunShotName(form, 'case-001'),
      buildRunShotName({ url: 'http://h/', fields: [] }, 'c'),
      buildRunShotName({ url: 'odd', formSelector: '***', fields: [field('#b', 'text'), field('#a', 'text')] }, 'c'),
    ],
    abnormal: cases.map((c) => testCaseHasAbnormalAssignment(c)),
  });
});

test('case execution and form processing behave as recorded in a real browser', async (t) => {
  const site = await startSite();
  const origin = `http://127.0.0.1:${site.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-runner-'));
  const session = new BrowserSession({ headful: false });
  t.after(async () => { await session.stop(); site.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await session.start();
  const cfg = { outputDir: tmp, maxCasesPerForm: 6 };
  const formFields = [
    field('#name', 'text', { constraints: { required: true } }),
    field('#age', 'number'),
    field('#plan', 'select'),
    { selector: '#red', type: 'radio', name: 'color', constraints: { required: true } },
    field('#news', 'checkbox'),
  ];
  const form = { url: `${origin}/form`, formSelector: 'form#entry', submitSelector: '#send', fields: formFields };
  const logs = [];
  const log = (line) => logs.push(line);
  const run = async (target, id, assignments) => {
    const result = await executeCase(session, cfg, target, { id, name: id, assignments }, log);
    return { ...result, screenshotExists: result.screenshotPath ? fs.existsSync(result.screenshotPath) : false };
  };
  const results = {
    valid: await run(form, 'valid', {
      '#name': assignment('#name', 'Ann'), '#age': assignment('#age', '20'), '#plan': assignment('#plan', 'b'),
      '#red': assignment('#red', 'blue'), '#news': assignment('#news', 'on'), '__gm_meta': assignment('__gm_meta', 'x'),
    }),
    invalid: await run(form, 'invalid', { '#name': assignment('#name', '12'), '#red': assignment('#red', 'on'), '#news': assignment('#news', 'off') }),
    abnormal: await run(form, 'abnormal', { '#name': assignment('#name', '<>', 'abnormal'), '#plan': assignment('#plan', '__not_in_options__') }),
    // A select value outside the option list is not used: selectOption then waits for Playwright's default timeout.
    missing: await run(form, 'missing', { '#age': assignment('#age', '30'), '#plan': assignment('#plan', 'a') }),
    nothingApplied: await run(form, 'nothing', { '#ghost': assignment('#ghost', 'x') }),
    blocked: await run({ url: `${origin}/blocked`, formSelector: 'form#b', submitSelector: '#go', fields: [field('[name="q"]', 'text')] },
      'blocked', { '[name="q"]': assignment('[name="q"]', 'x') }),
    gate: await run({ url: `${origin}/gate`, formSelector: 'form', submitSelector: undefined, fields: [] },
      'gate', { '#name': assignment('#name', 'Ann') }),
    wizard: await run({
      url: `${origin}/wizard`, formSelector: 'form#w', submitSelector: '#wgo', fields: [field('#nick', 'text')],
      preSteps: [
        { action: 'radio', selector: '[name="kind"]', value: 'person' },
        { action: 'check', selector: '#absent-check' },
      ],
    }, 'wizard', { '#nick': assignment('#nick', 'Bo') }),
    brokenPage: await run({ url: 'http://127.0.0.1:1/unreachable', formSelector: 'form', fields: [] }, 'broken', {}),
  };

  const store = memoryStore();
  const llm = { name: 'stub', inferFieldSemantics: async (fields) => fields.slice(0, 1).map((f) => ({ selector: f.selector, semantic: 'person_name' })) };
  const failingLlm = { name: 'failing', inferFieldSemantics: async () => { throw new Error('offline'); } };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const processLogs = [];
  const plog = (line) => processLogs.push(line);
  const dry = await processForm(clone(form), [], llm, { ...cfg, dryRun: true, maxCasesPerForm: 5 }, session, store, plog);
  const normalOnly = await processForm(clone(form), [], failingLlm, { ...cfg, dryRun: true, normalOnlyPairwise: true, maxCasesPerForm: 5 }, session, store, plog);
  // Executed cases use text-only fields so generated select values cannot hit the selectOption wait.
  const textForm = { ...clone(form), fields: clone(form.fields).filter((f) => f.type === 'text' || f.type === 'number') };
  const executed = await processForm(textForm, [], llm, { ...cfg, maxCasesPerForm: 3, fastFail: false }, session, store, plog);

  compare('execution.json', {
    results,
    logs,
    dry,
    normalOnly: normalOnly.item.cases,
    executed: executed.execution,
    storeCalls: store.calls,
    processLogs,
  }, origin);
});

test('form generation runs end to end as recorded', async (t) => {
  const site = await startSite();
  const origin = `http://127.0.0.1:${site.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-runner-'));
  t.after(() => { site.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const outputDir = path.join(tmp, 'out');
  const store = new JsonStore(tmp, 'session');
  const logs = [];
  const summary = await runFormGeneration({
    siteId: 'runner-test', url: `${origin}/`, engine: 'chromium', headful: false, maxDepth: 1, maxPages: 6,
    outputDir, maxCasesPerForm: 3,
  }, store, (line) => logs.push(line));
  const read = (name) => fs.readFileSync(path.join(store.location, name), 'utf8');
  compare('generation.json', {
    summary,
    logs,
    forms: JSON.parse(read('forms.json')).map((f) => f.url),
    testCases: JSON.parse(read('test-cases.json')).map((entry) => [entry.url, entry.count]),
    runs: read('runs.jsonl').trim().split('\n').map((line) => { const r = JSON.parse(line); return [r.url, r.testCaseId, r.ok]; }),
    catalog: JSON.parse(read('url-catalog.json')),
    specHasForms: fs.readFileSync(summary.codePath, 'utf8').includes('/form'),
  }, origin);
});

test('a malformed manual forms file is rejected with a clear message', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-runner-'));
  try {
    const write = (name, value) => { const file = path.join(tmp, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };
    assert.throws(() => discovery.loadManualForms(write('object.json', { url: 'x' }), [], () => {}), /must be a JSON array/);
    assert.throws(() => discovery.loadManualForms(write('nofields.json', [{ url: 'http://h/' }]), [], () => {}), /form 0 needs a url string and a fields array/);
    assert.throws(() => discovery.loadManualForms(write('badfield.json', [{ url: 'http://h/', fields: [{ selector: '#a' }] }]), [], () => {}), /form 0 has a field without selector\/type/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
