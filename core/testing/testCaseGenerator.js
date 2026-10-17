'use strict';
const fs = require('fs');
const path = require('path');
const { BrowserSession } = require('../crawler/browser');
const { crawlForForms } = require('../crawler/crawler');
const { generatePlaywrightCode } = require('../codegen/playwright');
const { JsonStore } = require('../store/jsonStore');
const { writeHtmlReport } = require('../report/htmlReport');
const { writeMarkdownReport } = require('../report/markdownReport');
const { writeTestCasesYaml } = require('../codegen/testCaseYaml');
const { processForm } = require('../runner/formProcessor');
const { dedupeForms, buildUrlCatalog } = require('../runner/formDiscovery');
const { runSteps } = require('../scenario/stepExecutor');

const OUTPUT_ROOT = path.join(require('../paths').ARTIFACTS_DIR, 'test-sessions');
const ruleBasedSemantics = { name: 'rule-based', inferFieldSemantics: async () => [] };

async function generateTestCases({ targetUrl, maxPages = 20, maxDepth = 2, maxCasesPerForm = 25, scenario, execute = false, onProgress = () => {} }) {
  const target = new URL(targetUrl);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('http(s) URL を指定してください');
  const sessionId = `session-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const store = new JsonStore(OUTPUT_ROOT, sessionId);
  const cfg = {
    url: targetUrl, outputDir: store.location, headful: false, dryRun: !execute,
    maxCasesPerForm: clamp(maxCasesPerForm, 1, 100, 25), maxDepth: clamp(maxDepth, 0, 10, 2), maxPages: clamp(maxPages, 1, 100, 20),
    fastFail: true, normalOnlyPairwise: false, scenarioExpansion: [],
    login: toLogin(scenario?.login),
  };
  const session = new BrowserSession({ headful: false, dialogAction: 'dismiss', onDialog: onProgress });
  const page = await session.start();
  try {
    await runScenarioPrelude(page, scenario, onProgress);
    onProgress(`フォームを巡回中（最大 ${cfg.maxPages} ページ）`);
    const { forms: found, visited, pageSnapshots } = await crawlForForms(page, targetUrl, { maxDepth: cfg.maxDepth, maxPages: cfg.maxPages, sameOriginOnly: true, login: cfg.login }, onProgress);
    const forms = dedupeForms(found);
    for (const form of forms) await store.saveForm(form);
    await store.saveUrlCatalog(buildUrlCatalog(targetUrl, visited, pageSnapshots, forms));
    const items = [];
    for (let i = 0; i < forms.length; i++) {
      onProgress(`テストケース生成 ${i + 1}/${forms.length}: ${forms[i].url}`);
      const output = await processForm(forms[i], [], ruleBasedSemantics, cfg, session, store, onProgress);
      items.push(output.item);
    }
    const specPath = path.join(store.location, 'generated.spec.ts');
    fs.writeFileSync(specPath, generatePlaywrightCode(items, { login: cfg.login, visitedUrls: visited, visitedPages: pageSnapshots }), 'utf8');
    writeTestCasesYaml(store.location);
    const reportPath = writeHtmlReport(store.location);
    const markdownPath = writeMarkdownReport(store.location);
    return { sessionId, sessionDir: store.location, forms: forms.length, cases: items.reduce((n, item) => n + item.cases.length, 0), visited: visited.length, executed: execute, urls: { report: `/api/test-sessions/${sessionId}/report.html`, spec: `/api/test-sessions/${sessionId}/generated.spec.ts`, yaml: `/api/test-sessions/${sessionId}/test-cases.yaml`, markdown: `/api/test-sessions/${sessionId}/report.md` }, reportPath, markdownPath };
  } finally { await session.stop(); }
}

function toLogin(login) { if (!login?.url || login.username === undefined) return undefined; return { loginUrl: login.url, username: login.username, password: login.password || '', usernameSelector: login.usernameSelector, passwordSelector: login.passwordSelector, submitSelector: login.submitSelector }; }
async function runScenarioPrelude(page, scenario, log) {
  const login = scenario?.login;
  if (login?.url) {
    log('シナリオ: ログインを実行'); await page.goto(login.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (login.usernameSelector && login.username !== undefined) await page.locator(login.usernameSelector).fill(login.username);
    if (login.passwordSelector && login.password !== undefined) await page.locator(login.passwordSelector).fill(login.password);
    if (login.submitSelector) await page.locator(login.submitSelector).click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
  }
  // No siteId here: this ad-hoc URL-driven path isn't bound to a saved site, so
  // setFile/download steps (which resolve paths under sites/<id>/fixtures) will
  // fail clearly rather than silently reading from the wrong place.
  await runSteps(page, scenario?.steps, { onProgress: log });
}
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback; }
module.exports = { generateTestCases, OUTPUT_ROOT };
