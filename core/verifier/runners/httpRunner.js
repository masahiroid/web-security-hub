'use strict';
// Compatibility boundary for existing CommonJS callers. Implementation is TypeScript.
const contracts = require('../contracts');
const { createHttpRunner } = require('../generated/application/httpRunner');
module.exports = { createHttpRunner: options => createHttpRunner({ ...options, contracts }) };
