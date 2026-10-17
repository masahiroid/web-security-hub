'use strict';
const path = require('path');
const { buildRunnerConfig } = require('../../core/siteConfig');
const { BrowserSession } = require('../../core/crawler/browser');
const { exploreSite } = require('../../core/crawler/explorer');
const { writeExploreReport } = require('../../core/report/exploreReport');

/**
 * Runs an exploratory crawl for a saved site: follows same-origin links and
 * clicks non-form, non-destructive-looking controls to map reachable screens
 * (see core/crawler/explorer.js for the safety rules). Reuses the site's
 * configured browser engine/device/client-cert/auth session, same as the
 * form-testing pipeline (core/siteConfig.js's buildRunnerConfig).
 */
async function exploreSiteSession(siteId, log = () => {}) {
  const { runnerConfig, outputBaseDir, sessionId } = buildRunnerConfig(siteId);
  const sessionDir = path.join(outputBaseDir, '..', 'explore-sessions', sessionId);

  const session = new BrowserSession({
    headful: runnerConfig.headful,
    engine: runnerConfig.engine,
    device: runnerConfig.device,
    clientCert: runnerConfig.clientCert,
    storageStatePath: runnerConfig.storageStatePath,
    dialogAction: 'dismiss',
    onDialog: log,
  });
  const initialPage = await session.start();
  await initialPage.close().catch(() => {});
  try {
    const result = await exploreSite(
      session,
      runnerConfig.url,
      {
        maxPages: runnerConfig.maxPages,
        maxDepth: runnerConfig.maxDepth,
        sameOriginOnly: true,
        screenshotDir: path.join(sessionDir, 'screenshots'),
      },
      log,
    );
    const reportPath = writeExploreReport(sessionDir, result);
    return {
      sessionId,
      sessionDir,
      pageCount: result.pageCount,
      stateCount: result.pages.reduce((n, p) => n + p.states.length, 0),
      skippedCount: result.skipped.length,
      reportUrl: `/api/sites/${siteId}/explore-sessions/${sessionId}/explore-report.html`,
      reportPath,
    };
  } finally {
    await session.stop();
  }
}

module.exports = { exploreSiteSession };
