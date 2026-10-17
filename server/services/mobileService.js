'use strict';
const path = require('path');
const { readSiteConfig, siteDir } = require('../../core/siteConfig');
const { MobileSession } = require('../../core/mobile/mobileSession');
const { runMobileSteps } = require('../../core/mobile/mobileStepExecutor');
const { normalizeMobileSteps } = require('../../core/mobile/mobileScenario');

/**
 * Runs one site's mobile scenario end to end: starts a local Appium server +
 * session (core/mobile/mobileSession.js) against the configured simulator/
 * emulator, runs mobileScenario.steps, then tears the session down.
 * Requires site.config.json's `platform` to be "ios" or "android" and its
 * `mobile` block to be filled in (see schema/site-config.schema.json).
 */
async function runMobileSession(siteId, log = () => {}) {
  const cfg = readSiteConfig(siteId);
  if (cfg.platform !== 'ios' && cfg.platform !== 'android') {
    throw new Error(`site "${siteId}" is not configured for mobile (platform must be "ios" or "android", got ${cfg.platform || 'web'})`);
  }
  if (!cfg.mobile?.deviceName) throw new Error(`site "${siteId}" is missing mobile.deviceName in site.config.json`);

  const dir = siteDir(siteId);
  const sessionId = `mobile-session-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const steps = normalizeMobileSteps(cfg.mobileScenario?.steps);

  const session = new MobileSession({
    platform: cfg.platform,
    deviceName: cfg.mobile.deviceName,
    platformVersion: cfg.mobile.platformVersion,
    app: cfg.mobile.app ? path.resolve(dir, cfg.mobile.app) : undefined,
    bundleId: cfg.mobile.bundleId,
    log,
  });

  log(`モバイルセッション開始: platform=${cfg.platform} device=${cfg.mobile.deviceName}`);
  const driver = await session.start();
  try {
    await runMobileSteps(driver, steps, { siteId, sessionId, onProgress: log });
    return { sessionId, stepCount: steps.length };
  } finally {
    await session.stop();
    log('モバイルセッション終了');
  }
}

module.exports = { runMobileSession };
