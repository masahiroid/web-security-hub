import path from 'node:path';
import { buildRunnerConfig } from '../../../core/siteConfig';
import { BrowserSession } from '../../../core/crawler/browser';
import { exploreSite } from '../../../core/crawler/explorer';
import { writeExploreReport } from '../../../core/report/exploreReport';
import { DEFAULTS } from '../config';

/**
 * Explores a saved site: follows same-origin links and clicks controls that look neither like forms nor destructive,
 * mapping the reachable screens. It reuses the site's browser engine, device, certificate and saved sign-in.
 */
export async function exploreSiteSession(siteId: string, log: (line: string) => void = () => {}) {
  const { runnerConfig, outputBaseDir, sessionId } = buildRunnerConfig(siteId);
  const sessionDir = path.join(outputBaseDir, '..', DEFAULTS.exploreSessionsDirectory, sessionId);
  const session = new BrowserSession({
    headful: runnerConfig.headful, engine: runnerConfig.engine, device: runnerConfig.device, clientCert: runnerConfig.clientCert,
    storageStatePath: runnerConfig.storageStatePath, dialogAction: 'dismiss', onDialog: log,
  });
  const initialPage = await session.start();
  await initialPage.close().catch(() => {});
  try {
    const result = await exploreSite(session, runnerConfig.url,
      { maxPages: runnerConfig.maxPages, maxDepth: runnerConfig.maxDepth, sameOriginOnly: true, screenshotDir: path.join(sessionDir, 'screenshots') }, log);
    const reportPath = writeExploreReport(sessionDir, result);
    return {
      sessionId, sessionDir, pageCount: result.pageCount,
      stateCount: result.pages.reduce((total, page) => total + page.states.length, 0), skippedCount: result.skipped.length,
      reportUrl: `/api/sites/${siteId}/explore-sessions/${sessionId}/${DEFAULTS.defaultExploreFile}`, reportPath,
    };
  } finally { await session.stop(); }
}
