'use strict';
// Compatibility entry point; the implementation is TypeScript in core/runner/typed.
const { createFormProcessor } = require('../generated/runner/typed/formProcessor');
const { generateValues, mergeValues } = require('../values/generator');
const { buildTestCases, applyCombinationConstraints } = require('../values/combinator');
const { bindSpecsToForm } = require('../spec/apply');

const processForm = createFormProcessor({ generateValues, mergeValues, buildTestCases, applyCombinationConstraints, bindSpecsToForm });

module.exports = { processForm };
