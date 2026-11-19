'use strict';
// Compatibility entry point; the implementation is TypeScript in core/scenario/typed.
const { chromium } = require('playwright');
const siteConfig = require('../siteConfig');
const { AuthSessionCapture: TypedCapture, createStorageStatePaths } = require('../generated/scenario/typed/authSession');

const { storageStatePath, hasStorageState } = createStorageStatePaths(siteConfig);

class AuthSessionCapture extends TypedCapture {
  constructor() {
    super({ storageStatePath, launchVisibleBrowser: () => chromium.launch({ headless: false }) });
  }
}

module.exports = { AuthSessionCapture, storageStatePath, hasStorageState };
