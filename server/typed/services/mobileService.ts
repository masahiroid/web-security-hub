import path from 'node:path';
import { readSiteConfig, siteDir } from '../../../core/siteConfig';
import { MobileSession } from '../../../core/mobile/mobileSession';
import { runMobileSteps } from '../../../core/mobile/mobileStepExecutor';
import { normalizeMobileSteps } from '../../../core/mobile/mobileScenario';

const SESSION_TIMESTAMP_CHARACTERS = 14;
/**
 * Runs one site's mobile scenario end to end: starts a local Appium server and session for the configured simulator,
 * emulator or device, runs the scenario's steps, then tears the session down. The site must be configured for iOS or Android.
 */
export async function runMobileSession(siteId: string, log: (line: string) => void = () => {}) {
  const config = readSiteConfig(siteId);
  const platform = config.platform;
  if (platform !== 'ios' && platform !== 'android') throw new Error(`site "${siteId}" is not configured for mobile (platform must be "ios" or "android", got ${platform || 'web'})`);
  const deviceName = config.mobile?.deviceName;
  if (!deviceName) throw new Error(`site "${siteId}" is missing mobile.deviceName in site.config.json`);
  const directory = siteDir(siteId);
  const sessionId = `mobile-session-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, SESSION_TIMESTAMP_CHARACTERS)}`;
  const steps = normalizeMobileSteps(config.mobileScenario?.steps);
  const session = new MobileSession({
    platform, deviceName, platformVersion: config.mobile?.platformVersion,
    app: config.mobile?.app ? path.resolve(directory, config.mobile.app) : undefined, bundleId: config.mobile?.bundleId, log,
  });
  log(`モバイルセッション開始: platform=${platform} device=${deviceName}`);
  const driver = await session.start();
  try {
    await runMobileSteps(driver, steps, { siteId, sessionId, onProgress: log });
    return { sessionId, stepCount: steps.length };
  } finally {
    await session.stop();
    log('モバイルセッション終了');
  }
}
