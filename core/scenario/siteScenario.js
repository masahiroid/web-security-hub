'use strict';

const { readSiteConfig, readEnvFile } = require('../siteConfig');
const { expandSharedSteps } = require('./sharedSteps');
const { resolveVariables, interpolateDeep } = require('./variables');
const { buildVariableOverridesPerRow } = require('./dataDriven');

const ACTIONS = new Set(['goto', 'click', 'fill', 'check', 'select', 'wait', 'useSharedStep']);
const MAX_STEPS = 50;

function normalizeSteps(steps) {
  if (steps === undefined) return [];
  if (!Array.isArray(steps)) throw new Error('scenario.steps must be an array');
  if (steps.length > MAX_STEPS) throw new Error(`scenario can contain at most ${MAX_STEPS} steps`);
  return steps.map((step, index) => normalizeStep(step, index));
}

function normalizeStep(step, index) {
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
  if (typeof step.selector !== 'string' || !step.selector.trim()) throw new Error(`scenario step ${index + 1} requires selector`);
  const normalized = { action: step.action, selector: step.selector.trim() };
  if (step.action === 'fill' || step.action === 'select') normalized.value = String(step.value ?? '');
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
