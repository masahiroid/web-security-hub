'use strict';
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
// CLI preserves repository-relative storage; installed apps use writable user data.
const DATA_ROOT = process.env.WEB_SECURITY_HUB_DATA_DIR ? path.resolve(process.env.WEB_SECURITY_HUB_DATA_DIR) : PROJECT_ROOT;
module.exports = { PROJECT_ROOT, DATA_ROOT, SITES_DIR: path.join(DATA_ROOT, 'sites'), ARTIFACTS_DIR: path.join(DATA_ROOT, 'artifacts') };
