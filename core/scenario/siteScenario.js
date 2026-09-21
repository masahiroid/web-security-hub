'use strict';

const { readSiteConfig, readEnvFile } = require('../siteConfig');
const { expandSharedSteps } = require('./sharedSteps');
const { resolveVariables, interpolateDeep } = require('./variables');
const { buildVariableOverridesPerRow } = require('./dataDriven');

const ACTIONS = new Set([
  'goto', 'click', 'fill', 'check', 'uncheck', 'select', 'wait',
  'back', 'forward', 'reload', 'setFile', 'download',
  'branch', 'loop', 'useSharedStep',
]);
const MAX_STEPS = 50;
const MAX_LOOP_TIMES = 200;
const MAX_NESTING_DEPTH = 5;

function normalizeSteps(steps, depth = 0) {
  if (steps === undefined) return [];
  if (!Array.isArray(steps)) throw new Error('scenario.steps must be an array');
  if (steps.length > MAX_STEPS) throw new Error(`scenario can contain at most ${MAX_STEPS} steps`);
  return steps.map((step, index) => normalizeStep(step, index, depth));
}

function normalizeStep(step, index, depth = 0) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`scenario step ${index + 1} must be an object`);
  if (!ACTIONS.has(step.action)) throw new Error(`scenario step ${index + 1} has an unsupported action`);

  if (step.action === 'useSharedStep') {
    if (typeof step.name !== 'string' || !step.name.trim()) throw new Error(`scenario step ${index + 1} requires a shared step name`);
    return { action: 'useSharedStep', name: step.name.trim() };
  }
  if (step.action === 'goto') {
    if (typeof step.url !== 'string' || !step.url.trim()) throw new Error(`scenario step ${index + 1} requires url`);
    return { action: 'goto', url: step.url.trim() };
  }
  if (step.action === 'wait') {
    const milliseconds = Math.min(Math.max(Number(step.value) || 500, 0), 10_000);
    return { action: 'wait', value: milliseconds };
  }
  if (step.action === 'back' || step.action === 'forward' || step.action === 'reload') {
    return { action: step.action };
  }
  if (step.action === 'setFile') {
    if (typeof step.selector !== 'string' || !step.selector.trim()) throw new Error(`scenario step ${index + 1} requires selector`);
    if (typeof step.path !== 'string' || !step.path.trim()) throw new Error(`scenario step ${index + 1} requires path (relative to sites/<id>/fixtures)`);
    const normalized = { action: 'setFile', selector: step.selector.trim(), path: step.path.trim() };
    const healHint = normalizeHealHint(step, index);
    if (healHint) normalized.healHint = healHint;
    return normalized;
  }
  if (step.action === 'download') {
    if (typeof step.selector !== 'string' || !step.selector.trim()) throw new Error(`scenario step ${index + 1} requires selector`);
    const normalized = { action: 'download', selector: step.selector.trim() };
    if (typeof step.saveAs === 'string' && step.saveAs.trim()) normalized.saveAs = step.saveAs.trim();
    const healHint = normalizeHealHint(step, index);
    if (healHint) normalized.healHint = healHint;
    return normalized;
  }
  if (step.action === 'branch') {
    if (depth >= MAX_NESTING_DEPTH) throw new Error(`scenario step ${index + 1}: branch/loop nesting exceeded max depth`);
    if (!step.condition || typeof step.condition !== 'object') throw new Error(`scenario step ${index + 1} requires a condition object`);
    return {
      action: 'branch',
      condition: normalizeCondition(step.condition, index),
      then: normalizeSteps(step.then, depth + 1),
      else: normalizeSteps(step.else, depth + 1),
    };
  }
  if (step.action === 'loop') {
    if (depth >= MAX_NESTING_DEPTH) throw new Error(`scenario step ${index + 1}: branch/loop nesting exceeded max depth`);
    const times = Math.min(Math.max(Number(step.times) || 0, 0), MAX_LOOP_TIMES);
    return { action: 'loop', times, steps: normalizeSteps(step.steps, depth + 1) };
  }
  if (typeof step.selector !== 'string' || !step.selector.trim()) throw new Error(`scenario step ${index + 1} requires selector`);
  const normalized = { action: step.action, selector: step.selector.trim() };
  if (step.action === 'fill' || step.action === 'select') normalized.value = String(step.value ?? '');
  const healHint = normalizeHealHint(step, index);
  if (healHint) normalized.healHint = healHint;
  return normalized;
}

const HEAL_HINT_STRING_FIELDS = ['tag', 'id', 'dataTestId', 'name', 'type', 'role', 'ariaLabel', 'placeholder', 'text'];

/**
 * Diagnostic metadata (no field values) saved alongside a recorded step so
 * core/scenario/locatorStrategy.js can still find the element if its primary
 * selector stops matching later — see that module for how it's used.
 */
function normalizeHealHint(step, index) {
  if (step.healHint === undefined || step.healHint === null) return undefined;
  if (typeof step.healHint !== 'object' || Array.isArray(step.healHint)) throw new Error(`scenario step ${index + 1} healHint must be an object`);
  const out = {};
  for (const field of HEAL_HINT_STRING_FIELDS) {
    if (typeof step.healHint[field] === 'string' && step.healHint[field]) out[field] = step.healHint[field];
  }
  if (Array.isArray(step.healHint.classes)) out.classes = step.healHint.classes.filter((c) => typeof c === 'string').slice(0, 3);
  return Object.keys(out).length ? out : undefined;
}

function normalizeCondition(condition, index) {
  if (typeof condition.selector !== 'string' || !condition.selector.trim()) throw new Error(`scenario step ${index + 1} condition requires selector`);
  const normalized = { selector: condition.selector.trim() };
  if (condition.exists !== undefined) normalized.exists = Boolean(condition.exists);
  else if (condition.visible !== undefined) normalized.visible = Boolean(condition.visible);
  else if (condition.equals !== undefined) normalized.equals = String(condition.equals);
  else throw new Error(`scenario step ${index + 1} condition requires exists, visible, or equals`);
  return normalized;
}

function normalizeStoredScenario(scenario) {
  if (scenario === undefined || scenario === null) return undefined;
  if (typeof scenario !== 'object' || Array.isArray(scenario)) throw new Error('scenario must be an object');
  return { steps: normalizeSteps(scenario.steps), dataSource: scenario.dataSource ? String(scenario.dataSource) : undefined };
}

/**
 * Resolves one site's scenario into its final, ready-to-execute form: shared
 * steps expanded, then {{VAR}} tokens in url/value/selector fields replaced
 * using the site's standard + secret variables (optionally overridden by
 * `variableOverrides`, e.g. one row of a data-driven data set).
 */
function resolveScenarioSteps(siteId, steps, variableOverrides = {}) {
  const expanded = expandSharedSteps(steps, siteId);
  const vars = resolveVariables(siteId, variableOverrides);
  return interpolateDeep(expanded, vars);
}

function buildSiteScenario(siteId) {
  const config = readSiteConfig(siteId);
  const env = readEnvFile(siteId);
  const loginConfig = config.login;
  const login = loginConfig?.loginUrl
    ? {
        url: loginConfig.loginUrl,
        usernameSelector: loginConfig.usernameSelector,
        passwordSelector: loginConfig.passwordSelector,
        submitSelector: loginConfig.submitSelector,
        username: env.LOGIN_USER || '',
        password: env.LOGIN_PASS || '',
      }
    : undefined;
  const steps = normalizeSteps(config.scenario?.steps);
  return { targetUrl: config.baseUrl, scenario: { login, steps: resolveScenarioSteps(siteId, steps) } };
}

/**
 * Same as buildSiteScenario, but repeated once per row of the scenario's
 * configured data set (config.scenario.dataSource), for data-driven testing.
 * Falls back to a single-element array (equivalent to buildSiteScenario) when
 * no data source is configured.
 */
function buildDataDrivenScenarios(siteId) {
  const config = readSiteConfig(siteId);
  const env = readEnvFile(siteId);
  const loginConfig = config.login;
  const login = loginConfig?.loginUrl
    ? {
        url: loginConfig.loginUrl,
        usernameSelector: loginConfig.usernameSelector,
        passwordSelector: loginConfig.passwordSelector,
        submitSelector: loginConfig.submitSelector,
        username: env.LOGIN_USER || '',
        password: env.LOGIN_PASS || '',
      }
    : undefined;
  const steps = normalizeSteps(config.scenario?.steps);
  const dataSource = config.scenario?.dataSource;
  const rows = dataSource ? buildVariableOverridesPerRow(siteId, dataSource) : [{}];
  return rows.map((overrides, index) => ({
    row: index,
    variables: overrides,
    targetUrl: config.baseUrl,
    scenario: { login, steps: resolveScenarioSteps(siteId, steps, overrides) },
  }));
}

module.exports = {
  ACTIONS,
  MAX_STEPS,
  normalizeSteps,
  normalizeStoredScenario,
  resolveScenarioSteps,
  buildSiteScenario,
  buildDataDrivenScenarios,
};
