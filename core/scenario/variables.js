'use strict';
// Compatibility entry point; the implementation is TypeScript in core/scenario/typed.
const siteConfig = require('../siteConfig');
const { createVariableStore, secretEnvKey, interpolate, interpolateDeep } = require('../generated/scenario/typed/variables');

const { resolveVariables, listSecretVariableNames } = createVariableStore(siteConfig);

module.exports = { resolveVariables, listSecretVariableNames, secretEnvKey, interpolate, interpolateDeep };
