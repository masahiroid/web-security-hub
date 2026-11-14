'use strict';
// Compatibility entry point; the implementation is TypeScript in core/codegen/typed.
const { createTestCaseYaml } = require('../generated/codegen/typed/testCaseYaml');

module.exports = createTestCaseYaml({ buildRunnerConfig: (siteId) => require('../siteConfig').buildRunnerConfig(siteId) });
