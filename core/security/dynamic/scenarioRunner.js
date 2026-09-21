'use strict';
const { runSteps } = require('../../scenario/stepExecutor');

/**
 * Runs a login (if configured) followed by the scenario's steps, via the
 * shared step executor (core/scenario/stepExecutor.js) so DAST crawling and
 * form-test generation stay behaviorally identical for every step type.
 */
async function runScenario(page, targetUrl, scenario, onProgress = () => {}, siteId) {
  const login = scenario?.login;
  if (login?.url) {
    onProgress('シナリオ: ログイン画面へ移動');
    await page.goto(login.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (login.usernameSelector && login.username !== undefined) await page.locator(login.usernameSelector).fill(login.username);
    if (login.passwordSelector && login.password !== undefined) await page.locator(login.passwordSelector).fill(login.password);
    if (login.submitSelector) {
      await page.locator(login.submitSelector).click();
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    }
  } else {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
  const healEvents = [];
  await runSteps(page, scenario?.steps, { siteId, onProgress, healEvents });
  return { healEvents };
}

module.exports = { runScenario };
