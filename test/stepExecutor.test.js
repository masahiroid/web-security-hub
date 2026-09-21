'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { siteDir, writeSiteConfig } = require('../core/siteConfig');
const { normalizeSteps } = require('../core/scenario/siteScenario');
const { resolveFixturePath, evaluateCondition, runSteps } = require('../core/scenario/stepExecutor');

const SITE_ID = `_test_step_fixture_${process.pid}`;

test.before(() => {
  writeSiteConfig(SITE_ID, { displayName: 'Step executor fixture', baseUrl: 'https://example.com' });
});

test.after(() => {
  fs.rmSync(siteDir(SITE_ID), { recursive: true, force: true });
});

test('normalizeSteps accepts back/forward/reload with no extra fields', () => {
  assert.deepEqual(normalizeSteps([{ action: 'back' }, { action: 'forward' }, { action: 'reload' }]), [
    { action: 'back' },
    { action: 'forward' },
    { action: 'reload' },
  ]);
});

test('normalizeSteps validates branch requires a condition and normalizes then/else', () => {
  const [step] = normalizeSteps([
    { action: 'branch', condition: { selector: '#modal', exists: true }, then: [{ action: 'click', selector: '#close' }], else: [] },
  ]);
  assert.equal(step.action, 'branch');
  assert.deepEqual(step.condition, { selector: '#modal', exists: true });
  assert.deepEqual(step.then, [{ action: 'click', selector: '#close' }]);
  assert.deepEqual(step.else, []);
  assert.throws(() => normalizeSteps([{ action: 'branch' }]), /requires a condition/);
});

test('normalizeSteps clamps loop times and rejects deep nesting', () => {
  const [step] = normalizeSteps([{ action: 'loop', times: 999, steps: [{ action: 'wait', value: 100 }] }]);
  assert.equal(step.times, 200);

  var deeplyNested = { action: 'loop', times: 1, steps: [] };
  var cursor = deeplyNested;
  for (let i = 0; i < 6; i++) {
    const inner = { action: 'loop', times: 1, steps: [] };
    cursor.steps = [inner];
    cursor = inner;
  }
  assert.throws(() => normalizeSteps([deeplyNested]), /max depth/);
});

test('normalizeSteps validates setFile/download required fields', () => {
  assert.deepEqual(normalizeSteps([{ action: 'setFile', selector: '#upload', path: 'sample.pdf' }]), [
    { action: 'setFile', selector: '#upload', path: 'sample.pdf' },
  ]);
  assert.throws(() => normalizeSteps([{ action: 'setFile', selector: '#upload' }]), /requires path/);
  assert.deepEqual(normalizeSteps([{ action: 'download', selector: '#export', saveAs: 'out.csv' }]), [
    { action: 'download', selector: '#export', saveAs: 'out.csv' },
  ]);
});

test('resolveFixturePath confines paths to the site fixtures directory', () => {
  const resolved = resolveFixturePath(SITE_ID, 'sample.pdf');
  assert.ok(resolved.endsWith(`fixtures${require('path').sep}sample.pdf`));
  assert.throws(() => resolveFixturePath(SITE_ID, '../../etc/passwd'), /escapes site fixtures directory/);
});

test('evaluateCondition supports exists/visible/equals against a fake locator', async () => {
  const fakePage = {
    locator: () => ({
      count: async () => 1,
      first: () => ({ isVisible: async () => true, textContent: async () => 'Welcome' }),
    }),
  };
  assert.equal(await evaluateCondition(fakePage, { selector: '#x', exists: true }), true);
  assert.equal(await evaluateCondition(fakePage, { selector: '#x', exists: false }), false);
  assert.equal(await evaluateCondition(fakePage, { selector: '#x', visible: true }), true);
  assert.equal(await evaluateCondition(fakePage, { selector: '#x', equals: 'Welcome' }), true);
  assert.equal(await evaluateCondition(fakePage, { selector: '#x', equals: 'Nope' }), false);
});

test('runSteps executes branch.then only when the condition matches, against a fake page', async () => {
  const calls = [];
  const fakePage = {
    locator: (selector) => ({
      count: async () => (selector === '#modal' ? 1 : 0),
      first: () => ({ isVisible: async () => true, textContent: async () => '', waitFor: async () => {} }),
      click: async () => calls.push(`click:${selector}`),
    }),
    waitForLoadState: async () => {},
  };
  await runSteps(fakePage, [
    { action: 'branch', condition: { selector: '#modal', exists: true }, then: [{ action: 'click', selector: '#close' }], else: [{ action: 'click', selector: '#skip' }] },
  ]);
  assert.deepEqual(calls, ['click:#close']);
});

test('runSteps repeats loop.steps loop.times times', async () => {
  let clicks = 0;
  const fakePage = {
    locator: () => ({ first: () => ({ waitFor: async () => {} }), click: async () => { clicks++; } }),
    waitForLoadState: async () => {},
  };
  await runSteps(fakePage, [{ action: 'loop', times: 3, steps: [{ action: 'click', selector: '#next' }] }]);
  assert.equal(clicks, 3);
});
