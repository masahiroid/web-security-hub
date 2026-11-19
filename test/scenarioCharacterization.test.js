'use strict';
// Characterization of core/scenario: pure rules must keep the same results across refactoring.
// Regenerate deliberately with UPDATE_GOLDEN=1 only when a behavior change is intended.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeSteps, normalizeStoredScenario } = require('../core/scenario/siteScenario');
const { sanitizeRecordedStep } = require('../core/scenario/playwrightRecorder');
const { candidatesFromDescriptor, similarityScore } = require('../core/scenario/locatorStrategy');
const { interpolate, interpolateDeep, secretEnvKey } = require('../core/scenario/variables');

const GOLDEN_DIR = path.join(__dirname, 'golden', 'scenario');

function outcome(fn) {
  try {
    return { ok: fn() ?? null };
  } catch (error) {
    return { error: error.message };
  }
}

function checkGolden(name, actual) {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const serialized = JSON.stringify(actual, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, serialized, 'utf8');
  }
  assert.equal(serialized, fs.readFileSync(file, 'utf8'));
}

const STEP_VECTORS = [
  undefined,
  'not-an-array',
  [null],
  [[]],
  [{ action: 'eval' }],
  [{ action: 'goto', url: '  https://example.test/a  ' }],
  [{ action: 'goto' }],
  [{ action: 'wait' }],
  [{ action: 'wait', value: '20000' }],
  [{ action: 'wait', value: -5 }],
  [{ action: 'back', selector: '#x' }, { action: 'forward' }, { action: 'reload' }],
  [{ action: 'aiAssert', description: `  ${'d'.repeat(320)}  ` }],
  [{ action: 'aiAssert' }],
  [{ action: 'useSharedStep', name: ' login ' }],
  [{ action: 'useSharedStep', name: '' }],
  [{ action: 'setFile', selector: '#f', path: ' a.pdf ', healHint: { tag: 'input', id: '', classes: ['a', 1, 'b', 'c', 'd'] } }],
  [{ action: 'setFile', selector: '#f' }],
  [{ action: 'download', selector: '#d', saveAs: ' out.csv ' }],
  [{ action: 'download', selector: '#d', saveAs: '  ' }],
  [{ action: 'fill', selector: ' #name ', value: 12 }],
  [{ action: 'select', selector: '#s' }],
  [{ action: 'check', selector: '#c', value: 'ignored' }],
  [{ action: 'click' }],
  [{ action: 'click', selector: '#b', healHint: 'bad' }],
  [{ action: 'click', selector: '#b', healHint: { foo: 'bar' } }],
  [{ action: 'click', selector: '#b', healHint: null }],
  [{ action: 'branch' }],
  [{ action: 'branch', condition: { selector: '#x' } }],
  [{ action: 'branch', condition: { selector: '#x', exists: 0, visible: true }, then: [{ action: 'reload' }] }],
  [{ action: 'branch', condition: { selector: '#x', visible: 'yes' }, else: [{ action: 'back' }] }],
  [{ action: 'branch', condition: { selector: '#x', equals: 5 } }],
  [{ action: 'loop', times: '3', steps: [{ action: 'click', selector: '#n' }] }],
  [{ action: 'loop', times: 999 }],
  [{ action: 'loop', times: 'abc' }],
  [{ action: 'loop', times: 1, steps: [{ action: 'loop', times: 1, steps: [{ action: 'loop', times: 1, steps: [{ action: 'loop', times: 1, steps: [{ action: 'loop', times: 1, steps: [{ action: 'loop', times: 1 }] }] }] }] }] }],
  Array.from({ length: 51 }, () => ({ action: 'reload' })),
];

test('normalizeSteps characterization', () => {
  checkGolden('normalizeSteps', STEP_VECTORS.map((steps) => outcome(() => normalizeSteps(steps))));
});

test('normalizeStoredScenario characterization', () => {
  const vectors = [undefined, null, [], 'x', {}, { steps: [{ action: 'reload' }], dataSource: 7 }, { dataSource: '' }];
  checkGolden('normalizeStoredScenario', vectors.map((value) => outcome(() => normalizeStoredScenario(value))));
});

test('sanitizeRecordedStep characterization', () => {
  const hint = { tag: 'input' };
  const vectors = [
    [null, true],
    ['x', true],
    [{ action: 'fill', selector: '#q', value: 'hello', healHint: hint }, true],
    [{ action: 'fill', selector: '#q', value: 'hello' }, false],
    [{ action: 'fill', selector: '#password', value: 'pw' }, true],
    [{ action: 'fill', selector: '[name="api_key"]', value: 'k' }, true],
    [{ action: 'select', selector: '#s', healHint: 'bad' }, false],
    [{ action: 'check', selector: '#c', value: 'v' }, false],
    [{ action: 'click' }, false],
    [{ action: 'goto', url: 'https://x' }, true],
  ];
  checkGolden('sanitizeRecordedStep', vectors.map(([step, include]) => outcome(() => sanitizeRecordedStep(step, include))));
});

test('locator candidates and similarity characterization', () => {
  const descriptors = [
    undefined,
    {},
    { tag: 'button', id: 'go:1', dataTestId: 'a"b', name: 'n\\x', ariaLabel: 'Go', role: 'button', text: 'Go now', placeholder: 'p', classes: ['btn', 'btn-primary'] },
    { tag: 'a', text: 'x'.repeat(41) },
    { tag: 'div', classes: [] },
  ];
  const hint = { tag: 'input', type: 'text', name: 'q', role: 'searchbox', ariaLabel: 'Search', placeholder: 'Find', text: 'abc' };
  const candidates = [
    { ...hint },
    { tag: 'input', text: 'xabcx' },
    { tag: 'input', text: 'ab' },
    { tag: 'select' },
  ];
  checkGolden('locator', {
    candidates: descriptors.map((d) => candidatesFromDescriptor(d)),
    scores: candidates.map((c) => similarityScore(hint, c)),
  });
});

test('variable interpolation characterization', () => {
  const vars = { A: 'one', B: 2, toString: 'shadow' };
  checkGolden('variables', {
    interpolate: ['{{A}}-{{ B }}-{{C}}-{{toString}}', '{{ 1A }}', 5, undefined].map((v) => interpolate(v, vars) ?? null),
    deep: interpolateDeep({ url: 'https://{{A}}', list: ['{{B}}', 3, null, { v: '{{A}}' }], flag: true }, vars),
    secretKeys: ['TOKEN', '_x9', '9bad', 'a-b'].map((name) => outcome(() => secretEnvKey(name))),
  });
});
