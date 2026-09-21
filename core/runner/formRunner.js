'use strict';
const fs = require('fs');
const path = require('path');
const { BrowserSession } = require('../crawler/browser');
const { crawlForForms } = require('../crawler/crawler');
const { runScenario } = require('../security/dynamic/scenarioRunner');
const { generatePlaywrightCode } = require('../codegen/playwright');
const { loadRuleSpecs } = require('../spec/loader');
const { processForm } = require('./formProcessor');
const { loadManualForms, dedupeForms, classifyForm, buildUrlCatalog, uniquePageCaseCount } = require('./formDiscovery');

const ruleBasedProvider = { name: 'rule-based', inferFieldSemantics: async () => [] };

async function runFormGeneration(cfg, store, log) {
  const screenshots = path.join(cfg.outputDir, 'screenshots');
  fs.mkdirSync(screenshots, { recursive: true });
  const session = new BrowserSession({
    headful: cfg.headful,
    engine: cfg.engine,
    device: cfg.device,
    clientCert: cfg.clientCert,
    storageStatePath: cfg.storageStatePath,
    httpCredentials: cfg.httpCredentials,
    dialogAction: 'accept',
    onDialog: log,
  });
  const page = await session.start();
  try {
    const loaded = cfg.ruleSpecDir ? loadRuleSpecs(cfg.ruleSpecDir) : { specs: [], warnings: [] };
    loaded.warnings.forEach((w) => log(`spec warning: ${w}`));
    log(`巡回開始: depth=${cfg.maxDepth}, pages=${cfg.maxPages}`);
    let seedUrl = cfg.url;
    if (cfg.scenario?.login?.url || cfg.scenario?.steps?.length) {
      await runScenario(page, cfg.url, cfg.scenario, log, cfg.siteId);
      seedUrl = page.url();
      log(`シナリオ完了: ${seedUrl}`);
    }
    const { forms: crawled, visited, pageSnapshots } = await crawlForForms(page, seedUrl, { maxDepth: cfg.maxDepth, maxPages: cfg.maxPages, sameOriginOnly: true, login: cfg.login, screenshotDir: screenshots }, log);
    const forms = dedupeForms(loadManualForms(cfg.manualFormsPath, crawled, log));
    for (const form of forms) await store.saveForm(form);
    await store.saveUrlCatalog(buildUrlCatalog(cfg.url, visited, pageSnapshots, forms));
    const targets = forms.filter((form) => { const status = classifyForm(form); return !status.auth && !status.agreementOnly; });
    const items = []; let executedCaseCount = 0, okCaseCount = 0, ngCaseCount = 0; const runSummaries = [];
    for (let i = 0; i < targets.length; i++) {
      log(`--- form ${i + 1}/${targets.length}: ${targets[i].url} (${targets[i].fields.length} fields) ---`);
      const processed = await processForm(targets[i], loaded.specs, ruleBasedProvider, cfg, session, store, log);
      items.push(processed.item); executedCaseCount += processed.execution.executed; okCaseCount += processed.execution.ok; ngCaseCount += processed.execution.ng; runSummaries.push(...processed.execution.summaries);
    }
    const codePath = path.join(cfg.outputDir, 'generated.spec.ts');
    fs.writeFileSync(codePath, generatePlaywrightCode(items, { login: cfg.login, scenarioSteps: cfg.scenario?.steps, visitedUrls: visited, visitedPages: pageSnapshots }), 'utf8');
    const formCases = items.reduce((n, item) => n + item.cases.length, 0);
    return { codePath, formCount: items.length, caseCount: formCases + uniquePageCaseCount(pageSnapshots, visited), executedCaseCount, okCaseCount, ngCaseCount, runSummaries };
  } finally { await session.stop(); }
}
module.exports = { runFormGeneration };
