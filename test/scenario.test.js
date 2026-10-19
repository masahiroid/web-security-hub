'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { siteDir, writeSiteConfig, writeEnvFile } = require('../core/siteConfig');
const { resolveVariables, listSecretVariableNames, interpolate, interpolateDeep } = require('../core/scenario/variables');
const { writeSharedSteps, expandSharedSteps } = require('../core/scenario/sharedSteps');
const { writeDataSet, readDataSet, buildVariableOverridesPerRow } = require('../core/scenario/dataDriven');
const { resolveScenarioSteps, buildDataDrivenScenarios } = require('../core/scenario/siteScenario');

const SITE_ID = `_test_fixture_${process.pid}`;

test.before(() => {
  writeSiteConfig(SITE_ID, {
    displayName: 'Scenario fixture',
    baseUrl: 'https://example.com',
    variables: { GREETING: 'hello' },
    scenario: { steps: [] },
  });
});

test.after(() => {
  fs.rmSync(siteDir(SITE_ID), { recursive: true, force: true });
});

test('resolveVariables merges standard config values with SECRET_ env values', () => {
  writeEnvFile(SITE_ID, { SECRET_API_TOKEN: 'shh' });
  const vars = resolveVariables(SITE_ID);
  assert.equal(vars.GREETING, 'hello');
  assert.equal(vars.API_TOKEN, 'shh');
  assert.deepEqual(listSecretVariableNames(SITE_ID), ['API_TOKEN']);
});

test('resolveVariables overrides win over stored values (data-driven row)', () => {
  const vars = resolveVariables(SITE_ID, { GREETING: 'bonjour' });
  assert.equal(vars.GREETING, 'bonjour');
});

test('interpolate replaces {{NAME}} tokens and leaves unknown tokens untouched', () => {
  assert.equal(interpolate('{{GREETING}} world', { GREETING: 'hi' }), 'hi world');
  assert.equal(interpolate('{{MISSING}}', {}), '{{MISSING}}');
});

test('interpolateDeep walks nested step objects', () => {
  const steps = [{ action: 'fill', selector: '#name', value: '{{GREETING}}' }];
  assert.equal(interpolateDeep(steps, { GREETING: 'hi' })[0].value, 'hi');
});

test('expandSharedSteps inlines a referenced group and supports nesting', () => {
  writeSharedSteps(SITE_ID, [
    { name: 'inner', steps: [{ action: 'click', selector: '#inner-btn' }] },
    { name: 'outer', steps: [{ action: 'goto', url: 'https://example.com/a' }, { action: 'useSharedStep', name: 'inner' }] },
  ]);
  const expanded = expandSharedSteps([{ action: 'useSharedStep', name: 'outer' }], SITE_ID);
  assert.deepEqual(expanded, [
    { action: 'goto', url: 'https://example.com/a' },
    { action: 'click', selector: '#inner-btn' },
  ]);
});

test('expandSharedSteps throws on an unknown shared step name', () => {
  assert.throws(() => expandSharedSteps([{ action: 'useSharedStep', name: 'does-not-exist' }], SITE_ID), /shared step not found/);
});

test('resolveScenarioSteps expands shared steps then interpolates variables', () => {
  const resolved = resolveScenarioSteps(SITE_ID, [
    { action: 'useSharedStep', name: 'inner' },
    { action: 'fill', selector: '#g', value: '{{GREETING}}' },
  ]);
  assert.deepEqual(resolved, [
    { action: 'click', selector: '#inner-btn' },
    { action: 'fill', selector: '#g', value: 'hello' },
  ]);
});

test('CSV data set round-trips through writeDataSet/readDataSet, including quoted commas', () => {
  writeDataSet(SITE_ID, 'users', [
    { username: 'alice', note: 'a, b' },
    { username: 'bob', note: 'plain' },
  ]);
  const rows = readDataSet(SITE_ID, 'users');
  assert.deepEqual(rows, [
    { username: 'alice', note: 'a, b' },
    { username: 'bob', note: 'plain' },
  ]);
});

test('buildVariableOverridesPerRow returns one override map per CSV row', () => {
  const overrides = buildVariableOverridesPerRow(SITE_ID, 'users');
  assert.equal(overrides.length, 2);
  assert.equal(overrides[0].username, 'alice');
});

test('buildDataDrivenScenarios runs the scenario once per data-set row with per-row variables', () => {
  writeSiteConfig(SITE_ID, {
    displayName: 'Scenario fixture',
    baseUrl: 'https://example.com',
    variables: { GREETING: 'hello' },
    scenario: { steps: [{ action: 'fill', selector: '#u', value: '{{username}}' }], dataSource: 'users' },
  });
  const scenarios = buildDataDrivenScenarios(SITE_ID);
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[0].scenario.steps[0].value, 'alice');
  assert.equal(scenarios[1].scenario.steps[0].value, 'bob');
});

test('buildDataDrivenScenarios falls back to a single run when no dataSource is set', () => {
  writeSiteConfig(SITE_ID, {
    displayName: 'Scenario fixture',
    baseUrl: 'https://example.com',
    variables: { GREETING: 'hello' },
    scenario: { steps: [{ action: 'fill', selector: '#g', value: '{{GREETING}}' }] },
  });
  const scenarios = buildDataDrivenScenarios(SITE_ID);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].scenario.steps[0].value, 'hello');
});
