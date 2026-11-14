'use strict';
// Compatibility entry point; the implementation is TypeScript in core/runner/typed.
const { createFormRunner } = require('../generated/runner/typed/formRunner');
const { runScenario } = require('../security/dynamic/scenarioRunner');
const { loadRuleSpecs } = require('../spec/loader');
const { processForm } = require('./formProcessor');

const runFormGeneration = createFormRunner({ runScenario, loadRuleSpecs, processForm });

module.exports = { runFormGeneration };
