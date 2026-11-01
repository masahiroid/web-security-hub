'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeHtmlReport } = require('../core/report/htmlReport');
const { writeMarkdownReport } = require('../core/report/markdownReport');
const { parseListReporterLines, writeReplayReport } = require('../core/report/replayReport');
const { writeExploreReport } = require('../core/report/exploreReport');

// Outputs are compared with recorded files; UPDATE_GOLDEN=1 re-records them.
const GOLDEN = path.join(__dirname, 'golden', 'report');
const FIXED_TIME = new Date('2026-01-02T03:04:05Z');

// Path separators and line endings differ by platform, not by behavior.
const portable = (text) => text.replace(/\r\n/g, '\n').replace(/screenshots\\/g, 'screenshots/');

function compare(name, actual) {
  const file = path.join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN === '1') fs.writeFileSync(file, portable(actual), 'utf8');
  assert.equal(portable(actual), portable(fs.readFileSync(file, 'utf8')), name);
}

function session(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `wsh-report-${prefix}-`));
  const named = path.join(directory, 'session-fixed');
  fs.mkdirSync(named);
  return named;
}

function writeSession(directory) {
  fs.writeFileSync(path.join(directory, 'forms.json'), JSON.stringify([
    { url: 'https://example.test/signup', fields: [{ selector: 'input[name="agree"]', type: 'checkbox' }, { selector: '#plan', type: 'radio' }, { selector: '', type: 'text' }] },
  ]));
  fs.writeFileSync(path.join(directory, 'test-cases.json'), JSON.stringify([
    { url: 'https://example.test/signup?ref=a|b', cases: [
      { id: 'case-001', name: '正常系: 基本入力', assignments: { 'input[name="email"]': { kind: 'valid', value: 'a@example.test', rationale: 'typical <address>' }, 'input[name="agree"]': { kind: 'valid', value: 'on' }, '#plan': { kind: 'valid', value: 'off' }, '__submit': { kind: 'valid', value: 'x' } } },
      { id: 'case-002', name: '異常系: empty & "quoted"', assignments: { 'input[name="email"]': { kind: 'invalid', value: '', rationale: 'blank' }, '#note': { kind: 'boundary', value: 'a|b\\c\nline' } } },
      { id: 'case-003', name: 'Boundary length', assignments: { '#name': { kind: 'boundary', value: 'x'.repeat(5) } } },
      { id: 'case-004', name: 'abnormal skipped' },
    ] },
    { url: 'not a url', cases: [] },
  ]));
  const inside = path.join(directory, 'screenshots', 'one.png');
  fs.writeFileSync(path.join(directory, 'runs.jsonl'), [
    JSON.stringify({ testCaseId: 'case-001', ok: true, screenshotPath: inside }),
    JSON.stringify({ testCaseId: 'case-002', ok: false, error: 'boom | <pipe>\nsecond line', screenshotPath: path.join(os.tmpdir(), 'wsh-elsewhere', 'shots', 'two.png') }),
    JSON.stringify({ testCaseId: 'case-003', ok: true }),
    '',
    JSON.stringify({ note: 'no case id' }),
  ].join('\n'));
  fs.utimesSync(directory, FIXED_TIME, FIXED_TIME);
}

test('Markdown and HTML session reports match the recorded output', () => {
  const directory = session('session');
  writeSession(directory);
  assert.equal(writeMarkdownReport(directory), path.join(directory, 'report.md'));
  fs.utimesSync(directory, FIXED_TIME, FIXED_TIME); // writing report.md touched the directory
  assert.equal(writeHtmlReport(directory), path.join(directory, 'report.html'));
  compare('report.md', fs.readFileSync(path.join(directory, 'report.md'), 'utf8'));
  compare('report.html', fs.readFileSync(path.join(directory, 'report.html'), 'utf8'));
});

test('reports of an empty or unreadable session are well-formed', () => {
  const directory = session('empty');
  fs.writeFileSync(path.join(directory, 'test-cases.json'), '{ broken');
  fs.utimesSync(directory, FIXED_TIME, FIXED_TIME);
  writeMarkdownReport(directory);
  fs.utimesSync(directory, FIXED_TIME, FIXED_TIME);
  writeHtmlReport(directory);
  compare('empty-report.md', fs.readFileSync(path.join(directory, 'report.md'), 'utf8'));
  const html = fs.readFileSync(path.join(directory, 'report.html'), 'utf8');
  assert.match(html, /<h1>Test results<\/h1>/);
  assert.match(html, /0 forms &middot; <strong>0<\/strong> cases total/);
});

test('list reporter lines are parsed into results', () => {
  const lines = [
    '  ✓  1 [chromium] › a.spec.js:3:1 › signup › normal / case-001 (1.2s)',
    '  ✘  2 [chromium] › a.spec.js:9:1 › signup › abnormal | pipe / case-002 (300ms)',
    '  -  3 [chromium] › a.spec.js:12:1 › skipped page / page-007 (0ms)',
    '  ✓  4 plain title (5ms)',
    'Running 4 tests using 1 worker',
    '',
  ];
  assert.deepEqual(parseListReporterLines(lines), [
    { id: 'case-001', title: 'normal / case-001', ok: true, skipped: false, duration: '1.2s' },
    { id: 'case-002', title: 'abnormal | pipe / case-002', ok: false, skipped: false, duration: '300ms' },
    { id: 'page-007', title: 'skipped page / page-007', ok: false, skipped: true, duration: '0ms' },
    { id: undefined, title: 'plain title', ok: true, skipped: false, duration: '5ms' },
  ]);
});

test('replay reports match the recorded output apart from the timestamp', () => {
  const directory = session('replay');
  const results = parseListReporterLines([
    '  ✓  1 a › normal / case-001 (1.2s)',
    '  ✘  2 a › bad <title> | pipe / case-002 (300ms)',
    '  -  3 a › skipped / case-003 (0ms)',
  ]);
  const out = writeReplayReport(directory, { results, exitCode: 1, baseUrl: 'http://127.0.0.1:3000/?a="1"&b=2' });
  assert.deepEqual(out, { htmlPath: path.join(directory, 'replay-report.html'), mdPath: path.join(directory, 'replay-report.md') });
  const stamp = /\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g;
  compare('replay-report.html', fs.readFileSync(out.htmlPath, 'utf8').replace(stamp, '<time>'));
  compare('replay-report.md', fs.readFileSync(out.mdPath, 'utf8').replace(stamp, '<time>'));
  const empty = writeReplayReport(session('replay-empty'), { results: [], exitCode: null, baseUrl: '' });
  assert.doesNotMatch(fs.readFileSync(empty.mdPath, 'utf8'), /BASE_URL/);
});

test('exploration reports match the recorded output', () => {
  const directory = path.join(session('explore'), 'nested', 'dir');
  const result = {
    startUrl: 'https://example.test/', pageCount: 2,
    pages: [
      { url: 'https://example.test/', title: 'Home <b>', screenshot: 'home.png', linkCount: 3, skipped: 1, states: [
        { trigger: 'Open "menu"', resultingUrl: 'https://example.test/', screenshot: 's1.png' },
        { trigger: 'Go', resultingUrl: 'https://example.test/next' },
      ] },
      { url: 'https://example.test/next', title: '', linkCount: 0, skipped: 0, states: [] },
    ],
    skipped: [{ pageUrl: 'https://example.test/', label: 'Delete & go', reason: 'destructive' }],
  };
  const out = writeExploreReport(directory, result);
  assert.equal(out, path.join(directory, 'explore-report.html'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'explore-report.json'), 'utf8')), result);
  compare('explore-report.html', fs.readFileSync(out, 'utf8'));
  const none = writeExploreReport(path.join(session('explore-none'), 'x'), { startUrl: 'u', pageCount: 0, pages: [], skipped: [] });
  assert.doesNotMatch(fs.readFileSync(none, 'utf8'), /スキップした操作/);
});
