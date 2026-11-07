'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { generatePlaywrightCode } = require('../core/codegen/playwright');
const { writeTestCasesYaml, regenerateFromYaml } = require('../core/codegen/testCaseYaml');

// Generated specs are compared with recorded files. UPDATE_GOLDEN=1 re-records them.
const GOLDEN = path.join(__dirname, 'golden', 'codegen');
function compare(name, actual) {
  const file = path.join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN) { fs.mkdirSync(GOLDEN, { recursive: true }); fs.writeFileSync(file, actual); }
  assert.equal(actual, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
}
const assignment = (value, kind = 'normal', rationale = 'typical') => ({ value, kind, rationale });
const form = {
  url: 'https://site.example/signup?step=1',
  submitSelector: '#items[0]',
  preSteps: [{ action: 'click', selector: '#open' }],
  fields: [
    { selector: '#email', tag: 'input', type: 'email', name: 'email' },
    { selector: '#items[0]', tag: 'input', type: 'text', name: 'item"\\' },
    { selector: '#plan', tag: 'select', type: 'select-one', name: 'plan' },
    { selector: '#plan2', tag: 'select', type: 'select-one', name: 'plan2' },
    { selector: '#agree', tag: 'input', type: 'checkbox', name: 'agree' },
    { selector: '#news', tag: 'input', type: 'checkbox', name: 'news' },
    { selector: '#r1', tag: 'input', type: 'radio', name: 'color' },
    { selector: '#r2', tag: 'input', type: 'radio', name: 'color' },
    { selector: '#r3', tag: 'input', type: 'radio', name: '' },
  ],
};
const items = [
  { form, expectations: [{ kind: 'error', messageContains: 'Required' }, { kind: 'error' }, { kind: 'ok', messageContains: 'ignored' }], cases: [
    { id: 'case-001', name: 'all kinds', assignments: {
      '#email': assignment('a@example.test'), '#items[0]': assignment('x"y', 'abnormal', 'quote'), '#plan': assignment('b'), '#plan2': assignment('__not_in_options__', 'abnormal', 'missing'),
      '#agree': assignment('on'), '#news': assignment('off'), '#r1': assignment('red'), '#r2': assignment('blue'), '#r3': assignment('off'), '#gone': assignment('skipped'),
    } },
    { id: 'case-002', name: 'normal only', assignments: { '#email': assignment('b@example.test') } },
  ] },
  { form: { url: 'not a url', fields: [] }, expectations: [], cases: [] },
  { form: { url: 'not a url', fields: [{ selector: '#only', tag: 'textarea', type: 'textarea' }] }, expectations: [], cases: [{ id: 'case-003', name: 'no submit', assignments: { '#only': assignment('t') } }] },
];
const pages = [
  { url: 'https://site.example/a/b?c=1', title: 'T'.repeat(50), markers: ['m1', 'm2'], textHash: 'abcd' },
  { url: 'https://site.example/a/b?c=1', title: 'duplicate', markers: [], textHash: '' },
  { url: 'https://site.example/', title: '', markers: [], textHash: '' },
];
const login = { username: 'u', usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s', loginUrl: 'https://site.example/login' };
const steps = [{ action: 'goto', url: '/start' }];

test('forms, login, scenario and page snapshots produce the recorded spec', () => {
  compare('full.spec.txt', generatePlaywrightCode(items, { login, scenarioSteps: steps, visitedUrls: ['https://site.example/a', 'https://site.example/a'], visitedPages: pages }));
});
test('no options fall back to a local origin and the login-free helper', () => {
  compare('empty.spec.txt', generatePlaywrightCode([]));
  compare('login-partial.spec.txt', generatePlaywrightCode([], { login: { username: 'u' }, scenarioSteps: 'invalid' }));
});
test('visited URLs alone produce page regression tests', () => {
  compare('urls.spec.txt', generatePlaywrightCode([], { visitedUrls: ['https://site.example/x', 'bad url'] }));
});
test('YAML export round-trips and regenerates the spec', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-codegen-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = path.join(root, 'no-such-site', '.golden-master', 'session');
  fs.mkdirSync(session, { recursive: true });
  assert.throws(() => regenerateFromYaml(session), /test-cases\.yaml not found/);
  assert.equal(path.basename(writeTestCasesYaml(session)), 'test-cases.yaml');
  assert.deepEqual(YAML.parse(fs.readFileSync(path.join(session, 'test-cases.yaml'), 'utf8')), { forms: [], testCaseGroups: [] });
  fs.writeFileSync(path.join(session, 'forms.json'), JSON.stringify([form]));
  fs.writeFileSync(path.join(session, 'test-cases.json'), JSON.stringify([{ url: form.url, cases: items[0].cases }, { url: 'https://other.example/' }]));
  fs.writeFileSync(path.join(session, 'url-catalog.json'), JSON.stringify({ visited: ['https://site.example/x'], pages }));
  const yaml = writeTestCasesYaml(session);
  compare('test-cases.yaml', fs.readFileSync(yaml, 'utf8'));
  const spec = regenerateFromYaml(session);
  assert.equal(path.basename(spec), 'generated.spec.ts');
  compare('regenerated.spec.txt', fs.readFileSync(spec, 'utf8'));
  fs.writeFileSync(yaml, '');
  fs.rmSync(path.join(session, 'url-catalog.json'));
  compare('regenerated-empty.spec.txt', fs.readFileSync(regenerateFromYaml(session), 'utf8'));
});
