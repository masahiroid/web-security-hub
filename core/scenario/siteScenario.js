'use strict';
// Compatibility entry point; the implementation is TypeScript in core/scenario/typed.
const siteConfig = require('../siteConfig');
const { ACTIONS, MAX_STEPS, normalizeSteps, normalizeStoredScenario } = require('../generated/scenario/typed/stepNormalization');
const { createSiteScenarios } = require('../generated/scenario/typed/siteScenario');
const { expandSharedSteps } = require('./sharedSteps');
const { resolveVariables } = require('./variables');
const { buildVariableOverridesPerRow } = require('./dataDriven');

const { resolveScenarioSteps, buildSiteScenario, buildDataDrivenScenarios } = createSiteScenarios({
  store: siteConfig,
  expandSharedSteps,
  resolveVariables,
  buildVariableOverridesPerRow,
});

module.exports = { ACTIONS, MAX_STEPS, normalizeSteps, normalizeStoredScenario, resolveScenarioSteps, buildSiteScenario, buildDataDrivenScenarios };
