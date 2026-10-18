'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { root, startServers, setMode, writeEvidence } = require('./training-runtime');
const { PlaywrightScenarioRecorder } = require('../core/scenario/playwrightRecorder');
const { privateScreenshot } = require('./screenshot-privacy');
const { readSiteConfig } = require('../core/siteConfig');
async function main() {
  for (const lang of ['ja', 'en']) {
    const config = readSiteConfig(`training-${lang}`);
    assert.equal(config.baseUrl, `http://127.0.0.1:4180/${lang}/dashboard`, 'Run training:setup -- --reset first; capture only supports the documented lab configuration');
  }
  const close = await startServers(); let browser;
  fs.mkdirSync(path.join(root, 'artifacts/training'), { recursive: true });
  const manifest = { appVersion: require('../package.json').version, viewport: { width: 1440, height: 1000 }, images: [], runs: [] };
  try {
    browser = await chromium.launch(); manifest.browser = browser.version();
    for (const lang of ['ja', 'en']) {
      console.log(`Capturing ${lang}`);
      const context = await browser.newContext({ viewport: manifest.viewport, locale: lang === 'ja' ? 'ja-JP' : 'en-US', colorScheme: 'light', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const shot = async (name, target = page) => {
        await page.evaluate(() => document.fonts.ready);
        const relative = `docs/training/images/${lang}/${name}.png`;
        await (target===page?options=>privateScreenshot(page,options):options=>target.screenshot(options))({ mask:target===page?[page.locator('#sourceDir')]:[],maskColor:'#dce3ea', animations:'disabled', path: path.join(root, relative), ...(target === page ? { fullPage: true } : {}) });
        manifest.images.push({ lang, step: name, file: relative });
      };
      const tab = async name => { await page.click(`[data-tab="${name}"]`); };
      await page.goto(`http://127.0.0.1:4180/${lang}/login`); await shot('01-sample-login');
      await page.fill('#email', 'learner@example.test'); await page.fill('#password', 'training-only'); await page.click('#sign-in');
      await page.click('#apply-link'); await shot('02-sample-form');
      await page.addInitScript(locale => localStorage.setItem('web-security-hub.locale', locale), lang);
      await page.goto('http://127.0.0.1:4173');
      await page.waitForFunction(l => document.documentElement.lang === l, lang);
      await page.selectOption('#siteSelect', `training-${lang}`);
      await page.waitForFunction(l => document.querySelector('#baseUrl').value.endsWith(`/${l}/dashboard`), lang);
      await shot('03-site-settings');
      await page.click('#panel-siteSetup .workspace-tabs button:nth-child(4)'); await shot('04-scenario', page.locator('#scenarioStepsJson').locator('..').locator('..'));
      const recorder = new PlaywrightScenarioRecorder();
      try {
        await recorder.start({ siteId: `training-${lang}`, includeInputValues: false });
        const recordingPage = recorder.session.page;
        await recordingPage.setViewportSize(manifest.viewport);
        await recordingPage.click('#apply-link');
        await recordingPage.waitForURL(`**/${lang}/apply`);
        await recordingPage.evaluate(() => document.fonts.ready);
        await shot('04-recording-browser', recordingPage);
        const result = await recorder.stop();
        assert(result.steps.some(s => s.action === 'click' && s.selector === '#apply-link'));
        assert(!JSON.stringify(result.steps).includes('training-only'));
        manifest.runs.push({ lang, stage: 'recording', stepCount: result.steps.length });
      } finally { await recorder.stop(); }
      await tab('testCases'); await page.click('#runPipelineBtn');
      await page.waitForFunction(() => !document.querySelector('#runPipelineBtn').disabled, null, { timeout: 240000 });
      assert(await page.locator('#pipelineResult a').count(), await page.locator('#pipelineStatus').innerText());
      await shot('05-generation');
      const reportUrl = await page.locator('#pipelineResult a').first().getAttribute('href');
      const sessionId = reportUrl.split('/')[5];
      await tab('replay'); await page.selectOption('#replaySession', sessionId); await page.click('#panel-replay .workspace-tabs button:nth-child(2)'); await page.click('#loadCaseEditorBtn');
      await page.waitForSelector('#caseEditorTables input');
      // Keep one exercise case using the same table controls used by the learner.
      while (await page.locator('[data-remove-g]').count() > 1) await page.locator('[data-remove-g]').last().click();
      for (const [selector, value] of Object.entries({ '#name': 'Demo Learner', '#contact': 'learner@example.test', '#participants': '5', '#course': 'web', '#updates': 'off' })) {
        const input = page.locator(`#caseEditorTables input[data-sel="${encodeURIComponent(selector)}"]`);
        if (await input.count()) await input.fill(value);
      }
      // Validate the case actually contains the boundary assignment needed by this exercise.
      assert.equal(await page.locator(`#caseEditorTables input[data-sel="${encodeURIComponent('#participants')}"]`).inputValue(), '5');
      await page.click('#saveCaseEditorBtn');
      await page.waitForFunction(() => /保存・再生成しました|Saved and regenerated/.test(document.querySelector('#caseEditorStatus').textContent));
      await shot('06-case-editor');
      async function replay(button, expected, name) {
        await page.click('#panel-replay .workspace-tabs button:first-child'); await page.click(button);
        await page.waitForFunction(() => !document.querySelector('#replayRunBtn').disabled, null, { timeout: 240000 });
        const status = await page.locator('#replayStatus').innerText();
        assert(expected ? status.includes('PASS') : /差分あり|differences/.test(status), status + '\n' + await page.locator('#replayLog').innerText());
        await shot(name); manifest.runs.push({ lang, stage: name, status, sessionId });
      }
      await replay('#replayBaselineBtn', true, '07-baseline');
      await replay('#replayRunBtn', true, '08-unchanged');
      await setMode('changed'); await replay('#replayRunBtn', false, '09-changed');
      await setMode('fixed'); await replay('#replayRunBtn', true, '10-fixed');
      await tab('dynamic'); await page.click('#panel-dynamic .workspace-tabs button:nth-child(3)'); await page.check('#useSiteScenario'); await page.click('#panel-dynamic .workspace-tabs button:first-child'); await page.check('#authorized'); await page.fill('#securityMaxPages', '1');
      const scan = async name => {
        await Promise.all([page.waitForResponse(r => r.url().endsWith('/security/dynamic-scan') && r.request().method() === 'POST', { timeout: 120000 }), page.click('#runDynamic')]); await page.waitForSelector('#dynamicResult .scan-summary', { timeout: 120000 }); await shot(name);
      };
      await scan('11-dast-fixed'); await setMode('changed'); await scan('12-dast-changed'); await setMode('baseline');
      await tab('static');
      for (const stage of ['before', 'after']) {
        await page.fill('#sourceDir', path.join(root, 'training/sast', stage)); await Promise.all([page.waitForResponse(r => r.url().endsWith('/security/static-scan') && r.request().method() === 'POST'), page.click('#runStatic')]);
        await page.waitForSelector('#staticResult .scan-summary'); await shot(`13-sast-${stage}`);
      }
      await page.goto(`http://127.0.0.1:4173/training/README${lang === 'ja' ? '.ja' : ''}.html`);
      assert.equal(await page.locator('h1').count(), 1);
      await page.evaluate(async () => {
        await Promise.all([...document.images].map(img => img.decode()));
        if (document.documentElement.scrollWidth > innerWidth) throw new Error('Manual overflows viewport');
      });
      await page.screenshot({ path: path.join(root, `artifacts/training/manual-${lang}.png`) });
      await context.close(); console.log(`${lang} complete`);
    }
    manifest.capturedAt = new Date().toISOString();
    const manifestPath = path.join(root, 'docs/training/images/manifest.json');
    const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const refreshed = new Set(manifest.images.map(item => item.file));
    manifest.images.push(...previous.images.filter(item => !refreshed.has(item.file)));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    writeEvidence('capture.json', manifest);
  } finally { await browser?.close(); await close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
