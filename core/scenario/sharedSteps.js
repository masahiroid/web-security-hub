'use strict';
// Compatibility entry point; the implementation is TypeScript in core/scenario/typed.
const siteConfig = require('../siteConfig');
const { createSharedSteps } = require('../generated/scenario/typed/sharedSteps');

const { listSharedSteps, writeSharedSteps, expandSharedSteps } = createSharedSteps(siteConfig);

module.exports = { listSharedSteps, writeSharedSteps, expandSharedSteps };
