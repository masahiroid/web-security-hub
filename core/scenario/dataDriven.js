'use strict';
// Compatibility entry point; the implementation is TypeScript in core/scenario/typed.
const siteConfig = require('../siteConfig');
const { createDataSets } = require('../generated/scenario/typed/dataDriven');

const { listDataSets, readDataSet, writeDataSet, buildVariableOverridesPerRow } = createDataSets(siteConfig);

module.exports = { listDataSets, readDataSet, writeDataSet, buildVariableOverridesPerRow };
