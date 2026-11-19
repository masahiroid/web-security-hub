'use strict';
// Compatibility entry point; the implementation is TypeScript in core/scenario/typed.
const { chromium } = require('playwright');
const { readSiteConfig, buildRunnerConfig } = require('../siteConfig');
const { PlaywrightScenarioRecorder: TypedRecorder } = require('../generated/scenario/typed/recorder');
const { sanitizeRecordedStep } = require('../generated/scenario/typed/recordingPolicy');
const { buildSiteScenario } = require('./siteScenario');
const { runScenario } = require('../security/dynamic/scenarioRunner');

class PlaywrightScenarioRecorder extends TypedRecorder {
  constructor() {
    super({
      readSiteConfig,
      httpCredentials: (siteId) => buildRunnerConfig(siteId).runnerConfig.httpCredentials,
      buildSiteScenario,
      runLogin: runScenario,
      launchVisibleBrowser: () => chromium.launch({ headless: false }),
    });
  }
}

module.exports = { PlaywrightScenarioRecorder, sanitizeRecordedStep };
