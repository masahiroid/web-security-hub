'use strict';
// Compatibility entry point; the implementation is TypeScript in core/scenario/typed.
const siteConfig = require('../siteConfig');
const { createStepExecutor, evaluateCondition, MAX_LOOP_ITERATIONS, MAX_BRANCH_DEPTH } = require('../generated/scenario/typed/stepExecutor');
const { resolveWithHealing } = require('./locatorStrategy');
const { assertWithClaudeCode } = require('../ai/assertionAdapter');

const { runSteps, resolveFixturePath } = createStepExecutor({ store: siteConfig, resolveWithHealing, assertWithClaudeCode });

module.exports = { runSteps, resolveFixturePath, evaluateCondition, MAX_LOOP_ITERATIONS, MAX_BRANCH_DEPTH };
