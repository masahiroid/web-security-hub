'use strict';
const { remote } = require('webdriverio');
const { AppiumServer } = require('./appiumServer');

const DEFAULT_PORT = 4723;

/**
 * @typedef {Object} MobileOptions
 * @property {'ios'|'android'} platform
 * @property {string} deviceName Simulator/emulator name, e.g. "iPhone 17".
 * @property {string} [platformVersion]
 * @property {string} [app] Path to a .app/.ipa/.apk to install and launch. Omit to attach to an already-installed app via bundleId.
 * @property {string} [bundleId] iOS bundle id (or Android app package) of an already-installed app to launch instead of `app`.
 * @property {number} [port] Appium server port (default 4723).
 * @property {(line:string)=>void} [log]
 */

/** Lifecycle wrapper around one local Appium server + one WebdriverIO mobile session. */
class MobileSession {
  /** @param {MobileOptions} opts */
  constructor(opts) {
    this.opts = opts;
    this.server = undefined;
    this.driver = undefined;
  }

  async start() {
    const log = this.opts.log || (() => {});
    this.server = new AppiumServer({ port: this.opts.port || DEFAULT_PORT, log });
    await this.server.start();

    const capabilities = buildCapabilities(this.opts);
    this.driver = await remote({
      hostname: '127.0.0.1',
      port: this.opts.port || DEFAULT_PORT,
      path: '/',
      capabilities,
      logLevel: 'silent',
    });
    return this.driver;
  }

  async stop() {
    await this.driver?.deleteSession().catch(() => {});
    await this.server?.stop();
  }
}

function buildCapabilities(opts) {
  if (opts.platform === 'ios') {
    const caps = {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': opts.deviceName,
      'appium:platformVersion': opts.platformVersion,
      'appium:newCommandTimeout': 120,
    };
    if (opts.app) caps['appium:app'] = opts.app;
    else if (opts.bundleId) caps['appium:bundleId'] = opts.bundleId;
    return caps;
  }
  if (opts.platform === 'android') {
    const caps = {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': opts.deviceName,
      'appium:platformVersion': opts.platformVersion,
      'appium:newCommandTimeout': 120,
    };
    if (opts.app) caps['appium:app'] = opts.app;
    else if (opts.bundleId) caps['appium:appPackage'] = opts.bundleId;
    return caps;
  }
  throw new Error(`unsupported mobile platform: ${opts.platform}`);
}

module.exports = { MobileSession, buildCapabilities };
